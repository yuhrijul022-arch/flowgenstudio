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

    // Quota / rate limit
    if (
        lower.includes('429') ||
        lower.includes('resource_exhausted') ||
        lower.includes('quota exceeded') ||
        lower.includes('rate limit') ||
        lower.includes('too many requests')
    ) {
        return {
            title: 'Limit tercapai',
            message: 'We’re hitting a temporary capacity limit. Please try again in a minute.',
            severity: 'warning',
            isQuota: true,
        };
    }

    // Auth / permission
    if (
        lower.includes('unauthenticated') ||
        lower.includes('permission-denied') ||
        lower.includes('401') ||
        lower.includes('sign in required')
    ) {
        return {
            title: 'Sesi berakhir',
            message: 'Sesi login bermasalah. Silakan login ulang.',
            severity: 'error',
            isQuota: false,
        };
    }

    // Insufficient credits
    if (lower.includes('insufficient credit') || lower.includes('credit')) {
        return {
            title: 'Credit tidak cukup',
            message: 'Credit kamu tidak cukup untuk generate. Silakan top up.',
            severity: 'warning',
            isQuota: false,
        };
    }

    // Max active jobs
    if (lower.includes('max 2 active') || lower.includes('rate limit')) {
        return {
            title: 'Terlalu banyak proses',
            message: 'Kamu sudah punya 2 proses aktif. Tunggu selesai dulu.',
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
