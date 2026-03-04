import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { defineSecret } from "firebase-functions/params";
import { GoogleGenAI } from "@google/genai";
import * as logger from "firebase-functions/logger";
import { v4 as uuidv4 } from "uuid";

const db = getFirestore();
const storage = getStorage();
const geminiApiKey = defineSecret("GEMINI_API_KEY");

// ── Prompt builder (ported from client geminiService) ──────────
function buildPrompt(
    preset: string | null,
    customPrompt: string | null,
    referenceImage: string | null,
    productCount: number
): string {
    // Preset definitions (same as client)
    const PRESETS: Record<string, { name: string; description: string }> = {
        "ecommerce-white": { name: "Studio White", description: "Clean pure white background, soft even lighting, professional commercial photography, crystal clear details, no distractions." },
        "fnb-gourmet": { name: "Gourmet", description: "Warm wooden table setting, appetizing restaurant lighting, shallow depth of field, fresh ingredients in background, delicious atmosphere." },
        "fashion-urban": { name: "Urban Edge", description: "Cool grey concrete background, hard natural sunlight, modern streetwear vibe, edgy shadows, high contrast editorial look." },
        "nature-organic": { name: "Organic", description: "Lush green moss and foliage, dappled forest sunlight, morning dew, soft and dreamy, perfect for natural products and skincare." },
        "luxury-dark": { name: "Luxury Noir", description: "Deep black textures, dramatic moody lighting, elegant reflections, premium high-end aesthetic, minimalist and sophisticated." },
        "sunlit-minimal": { name: "Sunlit", description: "Bright airy space, distinct window shadows, soft beige tones, aesthetic lifestyle vibe, warm and welcoming." },
    };

    let promptText = "";

    if (productCount > 1) {
        promptText = `Create a professional high-end studio composition featuring ALL ${productCount} products shown in the provided images.
Task: Arrange these products together naturally in a single scene.
Important: Maintain the shape, branding, and details of every product provided. Do not hallucinate new products. `;
    } else {
        promptText = `Professional product photography of the subject in the image.
Task: Re-create the product in a professional setting.
Important: Maintain the product's integrity (shape, labels, branding). `;
    }

    if (referenceImage) {
        promptText += `\nStyle Reference: Use the LAST image as a STRICT visual blueprint. Using camera Sony A7R V.

Recreate the exact scene composition from the reference, including:
- lighting direction, softness, and intensity
- background structure, depth, and environment details
- camera angle, focal length, perspective, and framing
- color palette, contrast, and mood

Replace ONLY the product while preserving:
- accurate product shape, proportions, materials, and surface details
- correct label placement and logo geometry
- perfectly readable, sharp text with zero distortion, including very small text

If a human model is present:
- match the same pose, hand placement, gaze direction, body angle, and styling
- ensure natural physical interaction between model and product
- maintain correct perspective and scale relative to the model

Seamlessly blend the product into the scene:
- match shadows, reflections, contact points, and depth of field
- match color temperature, grain, and lighting falloff
- avoid any cut-out, sticker, floating, or pasted appearance

OPTICAL LOGIC SCHEMA (THE "IF" RULES):
- SCENARIO A: lifestyle context → Sony A7R V + 50mm f/1.2, aperture f/2.0–f/2.8
- SCENARIO B: hero shot → Canon EOS R5 + 85mm f/1.4, aperture f/4.0–f/5.6
- SCENARIO C: macro/detail → Sony A7R V + 100mm f/2.8 Macro, aperture f/8.0–f/11

GLOBAL: Physics-based DoF, pinpoint focus on logo/texture, natural bokeh, 8K.

Maintain full photorealism: no warped labels, no bent text, no geometry defects, no artifacts.
`;
    } else if (preset && PRESETS[preset]) {
        const p = PRESETS[preset];
        promptText += `\nStyle: ${p.name}.
Atmosphere: ${p.description}.
Lighting: Soft studio lighting with natural depth of field.
Quality: Ultra-detailed, crisp textures.`;
    } else {
        promptText += `\nBackground: Minimalist aesthetic.
Lighting: High-end commercial lighting, soft shadows.`;
    }

    promptText += "\nNo text, no watermarks.";

    if (customPrompt) {
        promptText += `\nAdditional requirements: ${customPrompt}`;
    }

    return promptText;
}

// ── Main function ──────────────────────────────────────────────
export const runGeneration = onCall(
    {
        region: "asia-southeast1",
        maxInstances: 10,
        timeoutSeconds: 300,
        memory: "1GiB",
        secrets: [geminiApiKey],
    },
    async (request) => {
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "Sign in required.");
        }
        const uid = request.auth.uid;
        const { jobId, productImages, referenceImage } = request.data as {
            jobId: string;
            productImages: string[];
            referenceImage: string | null
        };

        if (!jobId) {
            throw new HttpsError("invalid-argument", "jobId is required.");
        }
        if (!productImages || !Array.isArray(productImages) || productImages.length === 0) {
            throw new HttpsError("invalid-argument", "At least one product image is required.");
        }

        const startTime = Date.now();
        const jobRef = db.collection("jobs").doc(jobId);
        const userRef = db.collection("users").doc(uid);

        // ── Load & validate job ────────────────────────────
        const jobSnap = await jobRef.get();
        if (!jobSnap.exists) {
            throw new HttpsError("not-found", "Job not found.");
        }
        const job = jobSnap.data()!;

        // Ownership check
        if (job.uid !== uid) {
            throw new HttpsError("permission-denied", "Not your job.");
        }

        // Double-run guard (transaction)
        await db.runTransaction(async (tx) => {
            const freshSnap = await tx.get(jobRef);
            const freshJob = freshSnap.data()!;
            if (freshJob.status !== "QUEUED") {
                throw new HttpsError(
                    "failed-precondition",
                    `Job already processed (status: ${freshJob.status}).`
                );
            }
            tx.update(jobRef, {
                status: "RUNNING",
                updatedAt: Timestamp.now(),
            });
        });

        // ── Prepare Gemini call ────────────────────────────
        const ai = new GoogleGenAI({ apiKey: geminiApiKey.value() });
        const model = "gemini-2.5-flash-image";
        const qty = job.qty as number;
        // productImages and referenceImage are passed directly from the client now
        const promptText = buildPrompt(
            job.preset,
            job.customPrompt,
            referenceImage,
            productImages.length
        );

        // Build parts: product images + optional reference + prompt
        const parts: Array<{ inlineData: { data: string; mimeType: string } } | { text: string }> = [];

        for (const img of productImages) {
            // img is "data:image/png;base64,..." or raw base64
            let data = img;
            let mimeType = "image/png";
            if (img.startsWith("data:")) {
                const match = img.match(/^data:([^;]+);base64,(.+)$/);
                if (match) {
                    mimeType = match[1];
                    data = match[2];
                }
            }
            parts.push({ inlineData: { data, mimeType } });
        }

        if (referenceImage) {
            let data = referenceImage;
            let mimeType = "image/png";
            if (referenceImage.startsWith("data:")) {
                const match = referenceImage.match(/^data:([^;]+);base64,(.+)$/);
                if (match) {
                    mimeType = match[1];
                    data = match[2];
                }
            }
            parts.push({ inlineData: { data, mimeType } });
        }

        parts.push({ text: promptText });

        // ── Generate images ────────────────────────────────
        const outputs: Array<{ downloadUrl: string, storagePath: string, mimeType: string }> = [];
        let successCount = 0;
        let failedCount = 0;
        let lastError = "";
        const bucket = storage.bucket("flowgen-studio.firebasestorage.app");
        const genStart = Date.now();

        for (let i = 0; i < qty; i++) {
            try {
                logger.info(`Starting Gemini call ${i + 1}/${qty}`, {
                    jobId, model, partsCount: parts.length, ratio: job.ratio,
                });

                const response = await ai.models.generateContent({
                    model,
                    contents: { parts },
                    config: {
                        imageConfig: {
                            aspectRatio: (job.ratio as string) || "1:1",
                        },
                    },
                });

                const candidates = response.candidates;
                if (!candidates || candidates.length === 0) {
                    logger.error("No candidates in Gemini response", {
                        jobId,
                        responseKeys: Object.keys(response || {}),
                        promptFeedback: JSON.stringify((response as any)?.promptFeedback ?? null),
                    });
                    throw new Error(
                        `No candidates returned. promptFeedback: ${JSON.stringify((response as any)?.promptFeedback ?? "none")}`
                    );
                }

                let imageData: string | null = null;
                let imageMime = "image/png";
                const contentParts = candidates[0]?.content?.parts;
                if (!contentParts) {
                    logger.error("No content parts", {
                        jobId,
                        candidate0Keys: Object.keys(candidates[0] || {}),
                        finishReason: (candidates[0] as any)?.finishReason,
                    });
                    throw new Error(
                        `No content parts. finishReason: ${(candidates[0] as any)?.finishReason ?? "unknown"}`
                    );
                }
                for (const part of contentParts) {
                    if ((part as any).inlineData) {
                        imageData = (part as any).inlineData.data;
                        imageMime = (part as any).inlineData.mimeType || "image/png";
                        break;
                    }
                }

                if (!imageData) {
                    const partTypes = contentParts.map((p: any) => Object.keys(p));
                    logger.error("No inlineData in parts", { jobId, partTypes });
                    throw new Error(`No image data. Part types: ${JSON.stringify(partTypes)}`);
                }

                logger.info(`Got image data (${imageData.length} chars)`, { jobId });

                // Upload to Storage
                let outputUrl: string;
                const ext = imageMime.includes("jpeg") || imageMime.includes("jpg") ? "jpg" : "png";
                const filePath = `outputs/${uid}/${jobId}/${i}.${ext}`;
                const file = bucket.file(filePath);

                // Use a UUID token for Firebase Storage download URL
                const token = uuidv4();

                await file.save(Buffer.from(imageData, "base64"), {
                    metadata: {
                        contentType: imageMime,
                        metadata: {
                            firebaseStorageDownloadTokens: token
                        }
                    },
                });

                // Construct authentic Firebase download URL
                outputUrl = `https://firebasestorage.googleapis.com/v0/b/flowgen-studio.firebasestorage.app/o/${encodeURIComponent(filePath)}?alt=media&token=${token}`;

                outputs.push({
                    downloadUrl: outputUrl,
                    storagePath: filePath,
                    mimeType: imageMime
                });
                successCount++;
                logger.info(`Image ${i + 1}/${qty} uploaded to Storage`, { jobId, filePath });
            } catch (err: any) {
                failedCount++;
                lastError = err.message || err.toString();
                logger.error(`Image ${i + 1}/${qty} FAILED`, {
                    jobId, error: lastError, stack: err.stack?.substring(0, 500),
                });
            }
        }

        const genMs = Date.now() - genStart;
        const totalMs = Date.now() - startTime;

        // ── Finalize: capture/refund in transaction ────────
        let finalStatus: string;
        if (successCount === qty) {
            finalStatus = "SUCCEEDED";
        } else if (successCount > 0) {
            finalStatus = "PARTIAL";
        } else {
            finalStatus = "FAILED";
        }

        const now = Timestamp.now();

        await db.runTransaction(async (tx) => {
            // Update job
            tx.update(jobRef, {
                status: finalStatus,
                outputs,
                successCount,
                failedCount,
                error: failedCount > 0 ? lastError : null,
                updatedAt: now,
                timings: { reserveMs: 0, genMs, totalMs },
            });

            // Release reserved credits and deduct for successes
            tx.update(userRef, {
                reservedCredits: FieldValue.increment(-qty),
                credits: FieldValue.increment(-successCount),
                updatedAt: now,
            });

            // Capture ledger (for successful images)
            if (successCount > 0) {
                const captureRef = userRef.collection("ledger").doc(`capture_${jobId}`);
                tx.set(captureRef, {
                    type: "CAPTURE",
                    amount: successCount,
                    jobId,
                    createdAt: now,
                    note: null,
                });
            }

            // Refund ledger (for failed images)
            if (failedCount > 0) {
                const refundRef = userRef.collection("ledger").doc(`refund_${jobId}`);
                tx.set(refundRef, {
                    type: "REFUND",
                    amount: failedCount,
                    jobId,
                    createdAt: now,
                    note: lastError.slice(0, 200),
                });
            }

            // Save output to user's generations subcollection
            const userGenerationsRef = userRef.collection("generations").doc(jobId);
            tx.set(userGenerationsRef, {
                uid,
                createdAt: job.createdAt,
                model,
                preset: job.preset || null,
                aspectRatio: job.ratio || null,
                quantity: job.qty,
                status: finalStatus === "SUCCEEDED" || finalStatus === "PARTIAL" ? "success" : "failed",
                input: { preset: job.preset || null, ratio: job.ratio || null, quantity: job.qty },
                outputs: outputs,
                costCredits: successCount,
                promptSummary: typeof job.customPrompt === 'string' && job.customPrompt.length > 0 ? job.customPrompt.substring(0, 50) : (job.preset || "Generation"),
                error: failedCount > 0 ? { code: "GENERATION_ERROR", message: lastError.substring(0, 100) } : null,
            });
        });

        logger.info("Job finalized", { jobId, finalStatus, successCount, failedCount });

        return {
            status: finalStatus,
            outputs,
            successCount,
            failedCount,
            error: failedCount > 0 ? lastError : null,
        };
    }
);
