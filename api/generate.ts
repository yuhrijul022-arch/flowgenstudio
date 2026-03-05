import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const openrouterApiKey = process.env.OPENROUTER_API_KEY!;
const imageModel = process.env.OPENROUTER_IMAGE_MODEL || 'google/gemini-2.5-flash-image';

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// ── Config ──
const RATE_LIMIT_MAX = 5;          // max generations per window
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const FAIL_MAX = 5;                // max failures before cooldown
const FAIL_WINDOW_MS = 600_000;    // 10 minutes
const COOLDOWN_MS = 180_000;       // 3 minutes cooldown
const TIMEOUT_MS = 30_000;         // 30 seconds API timeout
const MIN_INTERVAL_MS = 3_000;     // 3 seconds between requests

// ── Bot detection ──
const BOT_PATTERNS = [
    /bot/i, /crawl/i, /spider/i, /curl/i, /wget/i, /python-requests/i,
    /go-http-client/i, /scrapy/i, /httpclient/i, /libwww/i
];

function isBot(userAgent: string | undefined): boolean {
    if (!userAgent || userAgent.length < 10) return true;
    return BOT_PATTERNS.some(p => p.test(userAgent));
}

// ── Prompt builder ──
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

// ── Rate limit helpers ──
async function getRateLimitData(uid: string) {
    const { data } = await supabase
        .from('generation_rate_limits')
        .select('*')
        .eq('user_id', uid)
        .single();
    return data as any;
}

async function upsertRateLimitData(uid: string, updates: Record<string, any>) {
    await supabase
        .from('generation_rate_limits')
        .upsert({ user_id: uid, ...updates, updated_at: new Date().toISOString() } as never, { onConflict: 'user_id' } as any);
}

// ── Fetch with timeout using AbortController ──
async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        return response;
    } finally {
        clearTimeout(timer);
    }
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
        // ── BOT PROTECTION ──
        const userAgent = req.headers['user-agent'] as string | undefined;
        if (isBot(userAgent)) {
            console.log('[Generate] BOT_BLOCKED:', userAgent?.substring(0, 80));
            return res.status(403).json({ error: 'Forbidden' });
        }

        // ── AUTH CHECK ──
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

        // ── GET RATE LIMIT DATA ──
        let rateData = await getRateLimitData(uid);
        const now = Date.now();

        // ── CONCURRENT GENERATION GUARD ──
        if (rateData?.is_generating) {
            console.log(`[Generate] CONCURRENT_BLOCKED: user=${uid}`);
            return res.status(429).json({
                error: 'Kamu masih punya proses generate yang berjalan. Tunggu selesai dulu.',
                retryAfter: 10
            });
        }

        // ── MIN INTERVAL CHECK (3s between requests) ──
        if (rateData?.request_timestamps?.length > 0) {
            const lastRequest = new Date(rateData.request_timestamps[rateData.request_timestamps.length - 1]).getTime();
            if (now - lastRequest < MIN_INTERVAL_MS) {
                console.log(`[Generate] INTERVAL_BLOCKED: user=${uid}, gap=${now - lastRequest}ms`);
                return res.status(429).json({
                    error: 'Server sedang sibuk, coba beberapa saat lagi.',
                    retryAfter: 3
                });
            }
        }

        // ── RATE LIMIT CHECK (max 5 per minute) ──
        if (rateData?.request_timestamps) {
            const windowStart = now - RATE_LIMIT_WINDOW_MS;
            const recentRequests = (rateData.request_timestamps as string[])
                .filter((ts: string) => new Date(ts).getTime() > windowStart);
            if (recentRequests.length >= RATE_LIMIT_MAX) {
                console.log(`[Generate] RATE_LIMITED: user=${uid}, count=${recentRequests.length}`);
                return res.status(429).json({
                    error: 'Batas generate tercapai (maks 5 per menit). Coba beberapa saat lagi.',
                    retryAfter: 60
                });
            }
        }

        // ── FAILURE COOLDOWN CHECK ──
        if (rateData?.fail_count >= FAIL_MAX && rateData?.last_fail_at) {
            const lastFail = new Date(rateData.last_fail_at).getTime();
            const timeSinceLastFail = now - lastFail;
            if (timeSinceLastFail < COOLDOWN_MS) {
                const remainingSec = Math.ceil((COOLDOWN_MS - timeSinceLastFail) / 1000);
                console.log(`[Generate] COOLDOWN_BLOCKED: user=${uid}, remaining=${remainingSec}s`);
                return res.status(429).json({
                    error: `Server sedang sibuk. Coba lagi dalam ${remainingSec} detik.`,
                    retryAfter: remainingSec
                });
            }
            // Cooldown expired, reset fail count
            await upsertRateLimitData(uid, { fail_count: 0, last_fail_at: null });
            rateData = { ...rateData, fail_count: 0, last_fail_at: null };
        }

        // ── CREDIT CHECK ──
        const { data: userData, error: userError } = await supabase
            .from('users')
            .select('credits')
            .eq('id', uid)
            .single();

        if (userError || !userData) {
            return res.status(404).json({ error: 'User not found.' });
        }

        if ((userData as any).credits < numImages) {
            return res.status(402).json({
                error: `Credit tidak cukup. Tersedia: ${(userData as any).credits}, dibutuhkan: ${numImages}`
            });
        }

        // ── ALL CHECKS PASSED — SET GENERATING LOCK ──
        const currentTimestamps = (rateData?.request_timestamps || []) as string[];
        const windowStart = now - RATE_LIMIT_WINDOW_MS;
        const filteredTimestamps = currentTimestamps.filter((ts: string) => new Date(ts).getTime() > windowStart);
        filteredTimestamps.push(new Date().toISOString());

        await upsertRateLimitData(uid, {
            is_generating: true,
            request_timestamps: filteredTimestamps,
        });

        console.log(`[Generate] STARTED: user=${uid}, qty=${numImages}, model=${imageModel}`);

        // ── BUILD PROMPT ──
        const promptText = buildPrompt(preset, customPrompt, !!referenceImage, productImages.length);

        // ── BUILD CONTENT PARTS ──
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

        // ── GENERATE SINGLE IMAGE (with 30s timeout) ──
        const generateSingleImage = async (index: number): Promise<{ downloadUrl: string; storagePath: string; mimeType: string }> => {
            const openrouterResponse = await fetchWithTimeout(
                "https://openrouter.ai/api/v1/chat/completions",
                {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${openrouterApiKey}`,
                        "Content-Type": "application/json",
                        "HTTP-Referer": process.env.VITE_BASE_URL || "https://flowgenstudio.vercel.app",
                        "X-Title": "Flowgen Studio",
                    },
                    body: JSON.stringify({
                        model: imageModel,
                        modalities: ["image", "text"],
                        stream: false,
                        messages: [{ role: "user", content: contentParts }],
                    }),
                },
                TIMEOUT_MS
            );

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

                // Priority 1: message.images[]
                if (message?.images && Array.isArray(message.images) && message.images.length > 0) {
                    for (const img of message.images) {
                        const url = img?.image_url?.url || img?.url;
                        if (url && url.startsWith('data:')) {
                            const match = url.match(/^data:([^;]+);base64,(.+)$/);
                            if (match) {
                                imageMime = match[1];
                                imageData = match[2];
                                break;
                            }
                        }
                    }
                }

                // Priority 2: message.content (array)
                if (!imageData && message?.content) {
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
                    // Priority 3: message.content (string)
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
                const debugInfo = {
                    hasChoices: !!openrouterData.choices,
                    hasImages: !!openrouterData.choices?.[0]?.message?.images,
                    messageKeys: Object.keys(openrouterData.choices?.[0]?.message || {}),
                };
                console.error('[Generate] No image data. Debug:', JSON.stringify(debugInfo));
                throw new Error("No image data in OpenRouter response");
            }

            // Upload to Supabase Storage
            const ext = imageMime.includes("jpeg") || imageMime.includes("jpg") ? "jpg" : "png";
            const filePath = `${uid}/${Date.now()}-${index}.${ext}`;
            const buffer = Buffer.from(imageData, "base64");

            const { error: uploadError } = await supabase.storage
                .from('outputs')
                .upload(filePath, buffer, { contentType: imageMime, upsert: false });

            if (uploadError) {
                throw new Error(`Storage upload failed: ${uploadError.message}`);
            }

            const { data: urlData } = supabase.storage
                .from('outputs')
                .getPublicUrl(filePath);

            return {
                downloadUrl: urlData.publicUrl,
                storagePath: filePath,
                mimeType: imageMime,
            };
        };

        // ── FIRE ALL IN PARALLEL ──
        const promises = Array.from({ length: numImages }, (_, i) => generateSingleImage(i));
        const results = await Promise.allSettled(promises);

        const outputs: Array<{ downloadUrl: string; storagePath: string; mimeType: string }> = [];
        let successCount = 0;
        let failedCount = 0;
        let lastError = "";

        for (let i = 0; i < results.length; i++) {
            const result = results[i];
            if (result.status === 'fulfilled') {
                outputs.push(result.value);
                successCount++;
            } else {
                failedCount++;
                const reason = result.reason;
                if (reason?.name === 'AbortError') {
                    lastError = 'Server sedang sibuk, coba beberapa saat lagi.';
                } else {
                    lastError = reason?.message || reason?.toString() || 'Unknown error';
                }
                console.error(`[Generate] Image ${i + 1}/${numImages} FAILED:`, lastError);
            }
        }

        // ── RELEASE GENERATING LOCK & UPDATE RATE DATA ──
        if (successCount > 0) {
            // Deduct credits
            const { error: rpcError } = await supabase.rpc('deduct_credits_safe', { p_user_id: uid, p_amount: successCount });
            if (rpcError) {
                await supabase
                    .from('users')
                    .update({ credits: Math.max(0, (userData as any).credits - successCount) } as never)
                    .eq('id', uid);
            }

            // Insert generation record (ignore errors)
            try {
                await supabase.from('generations').insert({
                    user_id: uid,
                    prompt: promptText.substring(0, 500),
                    image_urls: outputs.map(o => o.downloadUrl),
                    credits_used: successCount,
                } as never);
            } catch (_) { /* ignore if generations table doesn't exist */ }

            // Reset fail count on success
            await upsertRateLimitData(uid, { is_generating: false, fail_count: 0, last_fail_at: null });
            console.log(`[Generate] SUCCESS: user=${uid}, success=${successCount}, failed=${failedCount}`);
        } else {
            // All failed — increment failure count
            const newFailCount = (rateData?.fail_count || 0) + 1;
            await upsertRateLimitData(uid, {
                is_generating: false,
                fail_count: newFailCount,
                last_fail_at: new Date().toISOString(),
            });
            console.log(`[Generate] ALL_FAILED: user=${uid}, fail_count=${newFailCount}, error=${lastError}`);
        }

        // ── DETERMINE STATUS ──
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
            outputCount: outputs.length,
            successCount,
            failedCount,
            error: failedCount > 0 ? lastError : null,
        });

    } catch (err: any) {
        console.error("[Generate] UNHANDLED_ERROR:", err);
        // Safety: release lock if we crash
        try {
            const authHeader = req.headers.authorization;
            if (authHeader?.startsWith('Bearer ')) {
                const token = authHeader.split(' ')[1];
                const { data: { user } } = await supabase.auth.getUser(token);
                if (user) {
                    await upsertRateLimitData(user.id, { is_generating: false });
                }
            }
        } catch (_) { /* ignore */ }

        const message = err?.name === 'AbortError'
            ? 'Server sedang sibuk, coba beberapa saat lagi.'
            : (err.message || "Internal server error");

        return res.status(500).json({ error: message });
    }
}
