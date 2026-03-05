import { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabaseClient';

interface CreditState {
    credits: number;
    available: number;
    loading: boolean;
    refresh: () => Promise<void>;
    startFastPolling: () => void;
}

const CREDITS_FETCH_TIMEOUT = 10_000; // 10 seconds max

export function useCredits(uid: string | null): CreditState {
    const [credits, setCredits] = useState(0);
    const [loading, setLoading] = useState(true);

    const [fastPolling, setFastPolling] = useState(false);

    const fetchCredits = useCallback(async () => {
        if (!uid) {
            setCredits(0);
            setLoading(false);
            return;
        }
        try {
            // Use Promise.race for timeout since Supabase query builders aren't standard Promises
            const result = await Promise.race([
                supabase
                    .from('users')
                    .select('credits')
                    .eq('id', uid)
                    .single()
                    .then(res => res),
                new Promise<never>((_, reject) =>
                    setTimeout(() => reject(new Error('Credits fetch timeout')), CREDITS_FETCH_TIMEOUT)
                ),
            ]);

            if (result.data && !result.error) {
                const newCredits = (result.data as any).credits ?? 0;
                setCredits((prev) => {
                    if (fastPolling && newCredits > prev) {
                        // Value increased, stop fast polling
                        setFastPolling(false);
                    }
                    return newCredits;
                });
            }
        } catch (e) {
            console.warn('[Credits] fetch error:', e);
            // Don't reset credits on error — keep last known value
        }
        setLoading(false);
    }, [uid, fastPolling]);

    useEffect(() => {
        fetchCredits();

        // Standard polling every 30 seconds, or 3 seconds if fastPolling is active
        const interval = setInterval(fetchCredits, fastPolling ? 3000 : 30000);

        // Loading guard: force exit loading after 5 seconds
        const guard = setTimeout(() => setLoading(false), 5000);

        // ── Realtime Sync ──
        let channel: ReturnType<typeof supabase.channel> | null = null;
        if (uid) {
            channel = supabase.channel(`public:users:id=eq.${uid}`)
                .on(
                    'postgres_changes',
                    { event: 'UPDATE', schema: 'public', table: 'users', filter: `id=eq.${uid}` },
                    (payload) => {
                        console.log('[Credits] Realtime update:', payload.new);
                        if (payload.new && 'credits' in payload.new) {
                            setCredits((prev) => {
                                const newCredits = Number(payload.new.credits);
                                if (fastPolling && newCredits > prev) {
                                    setFastPolling(false);
                                }
                                return newCredits;
                            });
                        }
                    }
                )
                .subscribe();
        }

        return () => {
            clearInterval(interval);
            clearTimeout(guard);
            if (channel) supabase.removeChannel(channel);
        };
    }, [uid, fetchCredits, fastPolling]);

    return {
        credits,
        available: credits,
        loading,
        refresh: fetchCredits,
        startFastPolling: () => setFastPolling(true),
    };
}
