interface FormattedError {
    title: string;
    message: string;
    severity: 'error' | 'warning';
    isQuota: boolean;
    retrySeconds?: number;
}

/**
 * Converts raw error objects into user-friendly Indonesian messages.
 * Raw details stay in console.error only.
 */
export function formatUserFacingError(err: unknown): FormattedError {
    const raw = extractMessage(err);
    const lower = raw.toLowerCase();

    // Timeout / server busy
    if (
        lower.includes('server sedang sibuk') ||
        lower.includes('aborterror') ||
        lower.includes('aborted') ||
        lower.includes('timeout')
    ) {
        return {
            title: 'Server Sibuk',
            message: 'Server sedang sibuk, coba beberapa saat lagi.',
            severity: 'warning',
            isQuota: false,
            retrySeconds: 10,
        };
    }

    // Rate limit / cooldown
    if (
        lower.includes('429') ||
        lower.includes('rate limit') ||
        lower.includes('too many requests') ||
        lower.includes('batas generate') ||
        lower.includes('maks 5 per menit') ||
        lower.includes('coba lagi dalam') ||
        lower.includes('coba beberapa saat')
    ) {
        return {
            title: 'Limit Tercapai',
            message: raw, // Use the already-Indonesian message from backend
            severity: 'warning',
            isQuota: true,
            retrySeconds: 60,
        };
    }

    // Concurrent generation
    if (lower.includes('proses generate yang berjalan') || lower.includes('tunggu selesai')) {
        return {
            title: 'Proses Aktif',
            message: 'Kamu masih punya proses generate yang berjalan. Tunggu selesai dulu.',
            severity: 'warning',
            isQuota: false,
            retrySeconds: 10,
        };
    }

    // Quota / resource exhausted (OpenRouter)
    if (
        lower.includes('resource_exhausted') ||
        lower.includes('quota exceeded')
    ) {
        return {
            title: 'Limit tercapai',
            message: 'Server sedang sibuk, coba beberapa saat lagi.',
            severity: 'warning',
            isQuota: true,
        };
    }

    // Auth / permission
    if (
        lower.includes('unauthenticated') ||
        lower.includes('permission-denied') ||
        lower.includes('401') ||
        lower.includes('sign in required') ||
        lower.includes('missing auth') ||
        lower.includes('invalid auth')
    ) {
        return {
            title: 'Sesi berakhir',
            message: 'Sesi login bermasalah. Silakan login ulang.',
            severity: 'error',
            isQuota: false,
        };
    }

    // Insufficient credits
    if (lower.includes('credit tidak cukup') || lower.includes('insufficient credit') || lower.includes('credit')) {
        return {
            title: 'Credit tidak cukup',
            message: 'Credit kamu tidak cukup untuk generate. Silakan top up.',
            severity: 'warning',
            isQuota: false,
        };
    }

    // Max active jobs
    if (lower.includes('max 2 active') || lower.includes('proses aktif')) {
        return {
            title: 'Terlalu banyak proses',
            message: 'Kamu sudah punya proses aktif. Tunggu selesai dulu.',
            severity: 'warning',
            isQuota: false,
        };
    }

    // Job already processed
    if (lower.includes('already processed') || lower.includes('failed-precondition')) {
        return {
            title: 'Job sudah diproses',
            message: 'Job ini sudah selesai atau sedang berjalan.',
            severity: 'warning',
            isQuota: false,
        };
    }

    // Generic fallback
    return {
        title: 'Gagal generate',
        message: 'Terjadi kendala saat generate. Coba lagi.',
        severity: 'error',
        isQuota: false,
    };
}

function extractMessage(err: unknown): string {
    if (!err) return '';
    if (typeof err === 'string') return err;
    if (err instanceof Error) return err.message;
    const obj = err as Record<string, unknown>;
    if (typeof obj.message === 'string') return obj.message;
    if (typeof obj.details === 'string') return obj.details;
    try {
        return JSON.stringify(err);
    } catch {
        return String(err);
    }
}
