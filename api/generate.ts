import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const openrouterApiKey = process.env.OPENROUTER_API_KEY!;
const imageModel = process.env.OPENROUTER_IMAGE_MODEL || 'google/gemini-2.5-flash-image';

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// ── Prompt builder (same prompts from original geminiService / runGeneration) ──
const PRESETS: Record<string, { name: string; description: string }> = {
    "ecommerce-white": { name: "Studio White", description: "Clean pure white background, soft even lighting, professional commercial photography, crystal clear details, no distractions." },
    "fnb-gourmet": { name: "Gourmet", description: "Warm wooden table setting, appetizing restaurant lighting, shallow depth of field, fresh ingredients in background, delicious atmosphere." },
    "fashion-urban": { name: "Urban Edge", description: "Cool grey concrete background, hard natural sunlight, modern streetwear vibe, edgy shadows, high contrast editorial look." },
    "nature-organic": { name: "Organic", description: "Lush green moss and foliage, dappled forest sunlight, morning dew, soft and dreamy, perfect for natural products and skincare." },
    "luxury-dark": { name: "Luxury Noir", description: "Deep black textures, dramatic moody lighting, elegant reflections, premium high-end aesthetic, minimalist and sophisticated." },
    "sunlit-minimal": { name: "Sunlit", description: "Bright airy space, distinct window shadows, soft beige tones, aesthetic lifestyle vibe, warm and welcoming." },
};

function buildPrompt(
    preset: string | null,
    customPrompt: string | null,
    hasReferenceImage: boolean,
    productCount: number
): string {
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

    if (hasReferenceImage) {
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

OPTICAL LOGIC SCHEMA:
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

function parseBase64(dataUri: string): { data: string; mimeType: string } {
    if (dataUri.startsWith("data:")) {
        const match = dataUri.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
            return { mimeType: match[1], data: match[2] };
        }
    }
    return { data: dataUri, mimeType: "image/png" };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        return res.status(204).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    res.setHeader('Access-Control-Allow-Origin', '*');

    try {
        // 1. Verify auth
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Missing auth token' });
        }
        const token = authHeader.split(' ')[1];
        const { data: { user }, error: authError } = await supabase.auth.getUser(token);
        if (authError || !user) {
            return res.status(401).json({ error: 'Invalid auth token' });
        }

        const uid = user.id;
        const { qty, ratio, preset, customPrompt, compositionMode, productImages, referenceImage } = req.body;

        if (!productImages || !Array.isArray(productImages) || productImages.length === 0) {
            return res.status(400).json({ error: 'At least one product image is required.' });
        }
        const numImages = Math.min(Math.max(Number(qty) || 1, 1), 10);

        // 2. Check credits
        const { data: userData, error: userError } = await supabase
            .from('users')
            .select('credits')
            .eq('id', uid)
            .single();

        if (userError || !userData) {
            return res.status(404).json({ error: 'User not found.' });
        }

        if (userData.credits < numImages) {
            return res.status(402).json({ error: `Insufficient credits. Available: ${userData.credits}, required: ${numImages}` });
        }

        // 3. Build prompt
        const promptText = buildPrompt(preset, customPrompt, !!referenceImage, productImages.length);

        // 4. Build OpenRouter content parts
        const contentParts: any[] = [];

        for (const img of productImages) {
            const { data, mimeType } = parseBase64(img);
            contentParts.push({
                type: "image_url",
                image_url: { url: `data:${mimeType};base64,${data}` }
            });
        }

        if (referenceImage) {
            const { data, mimeType } = parseBase64(referenceImage);
            contentParts.push({
                type: "image_url",
                image_url: { url: `data:${mimeType};base64,${data}` }
            });
        }

        contentParts.push({ type: "text", text: promptText });

        // 5. Generate images
        const outputs: Array<{ downloadUrl: string; storagePath: string; mimeType: string }> = [];
        let successCount = 0;
        let failedCount = 0;
        let lastError = "";

        for (let i = 0; i < numImages; i++) {
            try {
                const openrouterResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${openrouterApiKey}`,
                        "Content-Type": "application/json",
                        "HTTP-Referer": process.env.VITE_BASE_URL || "https://flowgenstudio.com",
                        "X-Title": "Flowgen Studio",
                    },
                    body: JSON.stringify({
                        model: imageModel,
                        messages: [
                            {
                                role: "user",
                                content: contentParts,
                            }
                        ],
                    }),
                });

                if (!openrouterResponse.ok) {
                    const errText = await openrouterResponse.text();
                    throw new Error(`OpenRouter API error (${openrouterResponse.status}): ${errText.substring(0, 200)}`);
                }

                const openrouterData = await openrouterResponse.json();

                // Extract image from response
                let imageData: string | null = null;
                let imageMime = "image/png";

                const choices = openrouterData.choices;
                if (choices && choices.length > 0) {
                    const message = choices[0].message;
                    if (message?.content) {
                        // Handle array content (multimodal response)
                        if (Array.isArray(message.content)) {
                            for (const part of message.content) {
                                if (part.type === 'image_url' && part.image_url?.url) {
                                    const url = part.image_url.url;
                                    if (url.startsWith('data:')) {
                                        const match = url.match(/^data:([^;]+);base64,(.+)$/);
                                        if (match) {
                                            imageMime = match[1];
                                            imageData = match[2];
                                        }
                                    }
                                    break;
                                }
                            }
                        }
                        // Handle string content with inline base64
                        else if (typeof message.content === 'string') {
                            const b64Match = message.content.match(/data:image\/([^;]+);base64,([A-Za-z0-9+/=]+)/);
                            if (b64Match) {
                                imageMime = `image/${b64Match[1]}`;
                                imageData = b64Match[2];
                            }
                        }
                    }
                }

                if (!imageData) {
                    throw new Error("No image data in OpenRouter response");
                }

                // 6. Upload to Supabase Storage
                const ext = imageMime.includes("jpeg") || imageMime.includes("jpg") ? "jpg" : "png";
                const filePath = `${uid}/${Date.now()}-${i}.${ext}`;
                const buffer = Buffer.from(imageData, "base64");

                const { error: uploadError } = await supabase.storage
                    .from('outputs')
                    .upload(filePath, buffer, {
                        contentType: imageMime,
                        upsert: false,
                    });

                if (uploadError) {
                    throw new Error(`Storage upload failed: ${uploadError.message}`);
                }

                // Get public URL
                const { data: urlData } = supabase.storage
                    .from('outputs')
                    .getPublicUrl(filePath);

                outputs.push({
                    downloadUrl: urlData.publicUrl,
                    storagePath: filePath,
                    mimeType: imageMime,
                });
                successCount++;

            } catch (err: any) {
                failedCount++;
                lastError = err.message || err.toString();
                console.error(`Image ${i + 1}/${numImages} FAILED:`, lastError);
            }
        }

        // 7. Deduct credits (only for successful generations)
        if (successCount > 0) {
            const { error: rpcError } = await supabase.rpc('deduct_credits_safe', { p_user_id: uid, p_amount: successCount });
            if (rpcError) {
                // Fallback: direct update if RPC doesn't exist
                await supabase
                    .from('users')
                    .update({ credits: Math.max(0, userData.credits - successCount) })
                    .eq('id', uid);
            }

            // Insert credit ledger entry
            await supabase.from('credit_ledger').insert({
                user_id: uid,
                amount: -successCount,
                type: 'generate',
                reference: `gen-${Date.now()}`,
            });

            // Insert generation record
            await supabase.from('generations').insert({
                user_id: uid,
                prompt: promptText.substring(0, 500),
                image_urls: outputs.map(o => o.downloadUrl),
                credits_used: successCount,
            });
        }

        // 8. Refund ledger for failed images
        if (failedCount > 0 && successCount < numImages) {
            // No credit was deducted for failed ones since we only deducted successCount
            await supabase.from('credit_ledger').insert({
                user_id: uid,
                amount: 0,
                type: 'refund',
                reference: `refund-${Date.now()}: ${failedCount} failed`,
            });
        }

        // 9. Determine status
        let finalStatus: string;
        if (successCount === numImages) {
            finalStatus = "SUCCEEDED";
        } else if (successCount > 0) {
            finalStatus = "PARTIAL";
        } else {
            finalStatus = "FAILED";
        }

        return res.status(200).json({
            status: finalStatus,
            outputs,
            successCount,
            failedCount,
            error: failedCount > 0 ? lastError : null,
        });

    } catch (err: any) {
        console.error("Generate API error:", err);
        return res.status(500).json({ error: err.message || "Internal server error" });
    }
}
