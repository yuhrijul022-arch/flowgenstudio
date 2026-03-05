import { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabase';

interface CreditState {
    credits: number;
    available: number;
    loading: boolean;
    refresh: () => Promise<void>;
}

const CREDITS_FETCH_TIMEOUT = 10_000; // 10 seconds max

export function useCredits(uid: string | null): CreditState {
    const [credits, setCredits] = useState(0);
    const [loading, setLoading] = useState(true);

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
                setCredits((result.data as any).credits ?? 0);
            }
        } catch (e) {
            console.warn('[Credits] fetch error:', e);
            // Don't reset credits on error — keep last known value
        }
        setLoading(false);
    }, [uid]);

    useEffect(() => {
        fetchCredits();

        // Simple polling every 30 seconds
        const interval = setInterval(fetchCredits, 30000);

        // Loading guard: force exit loading after 5 seconds
        const guard = setTimeout(() => setLoading(false), 5000);

        return () => {
            clearInterval(interval);
            clearTimeout(guard);
        };
    }, [uid, fetchCredits]);

    return {
        credits,
        available: credits,
        loading,
        refresh: fetchCredits,
    };
}
