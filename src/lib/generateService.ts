import { supabase } from './supabaseClient';

interface GenerateParams {
    qty: number;
    ratio: string;
    preset: string | null;
    customPrompt: string;
    compositionMode: string;
    productImages: string[]; // base64 data URIs
    referenceImage: string | null;
}

interface GenerateResult {
    status: string;
    outputs: Array<{ downloadUrl: string; storagePath: string; mimeType: string }>;
    successCount: number;
    failedCount: number;
    error: string | null;
}

const GENERATE_TIMEOUT_MS = 30_000; // 30 seconds

/**
 * Convert File objects to base64 data URIs
 */
export async function filesToBase64(files: File[]): Promise<string[]> {
    return Promise.all(
        files.map(
            (file) =>
                new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result as string);
                    reader.onerror = reject;
                    reader.readAsDataURL(file);
                })
        )
    );
}

/**
 * Mengambil riwayat gambar yang pernah di-generate oleh user dari Supabase.
 * Backend menyimpan image_urls sebagai array di tabel generations.
 */
export async function fetchUserGenerations(uid: string): Promise<Array<{ url: string; filename: string }>> {
    try {
        const { data, error } = await supabase
            .from('generations')
            .select('image_urls, created_at')
            .eq('user_id', uid)
            .order('created_at', { ascending: false })
            .limit(5); // Ambil 5 generation terakhir

        if (error) {
            console.error('[generateService] Error fetching history:', error);
            return [];
        }

        if (!data || data.length === 0) return [];

        // Flatten: setiap row punya image_urls[] → kita pecah jadi item-item individual
        const results: Array<{ url: string; filename: string }> = [];
        for (const row of data) {
            const urls = (row as any).image_urls as string[] | null;
            if (!urls) continue;
            for (let i = 0; i < urls.length; i++) {
                results.push({
                    url: urls[i],
                    filename: `flowgen-history-${i + 1}.png`,
                });
            }
        }

        return results;
    } catch (err) {
        console.error('[generateService] fetchUserGenerations failed:', err);
        return [];
    }
}

/**
 * Call the /api/generate Vercel serverless function.
 * Includes 30s timeout via AbortController.
 * Handles auth token injection and returns generation results.
 */
export async function reserveAndGenerate(
    params: GenerateParams
): Promise<GenerateResult> {
    // Get current session token
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
        throw new Error('Not authenticated. Please sign in.');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GENERATE_TIMEOUT_MS);

    try {
        const baseUrl = import.meta.env.PROD ? '' : (import.meta.env.VITE_BASE_URL || '');
        const response = await fetch(`${baseUrl}/api/generate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
                qty: params.qty,
                ratio: params.ratio,
                preset: params.preset,
                customPrompt: params.customPrompt,
                compositionMode: params.compositionMode,
                productImages: params.productImages,
                referenceImage: params.referenceImage,
            }),
            signal: controller.signal,
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => null);
            throw new Error(errData?.error || `Generation failed (${response.status})`);
        }

        const result = await response.json();
        return result as GenerateResult;
    } catch (err: any) {
        if (err.name === 'AbortError') {
            throw new Error('Server sedang sibuk, coba beberapa saat lagi.');
        }
        throw err;
    } finally {
        clearTimeout(timer);
    }
}
