import { supabase } from './supabase';

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
 * Call the /api/generate Vercel serverless function.
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

    const baseUrl = import.meta.env.VITE_BASE_URL || '';

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
    });

    if (!response.ok) {
        const errData = await response.json().catch(() => null);
        throw new Error(errData?.error || `Generation failed (${response.status})`);
    }

    const result = await response.json();
    return result as GenerateResult;
}
