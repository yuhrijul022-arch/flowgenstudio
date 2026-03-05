import { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabase';

interface CreditState {
    credits: number;
    available: number;
    loading: boolean;
    refresh: () => Promise<void>;
}

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
            const { data, error } = await supabase
                .from('users')
                .select('credits')
                .eq('id', uid)
                .single();

            if (data && !error) {
                setCredits((data as any).credits ?? 0);
            }
        } catch (e) {
            console.warn('Credits fetch error:', e);
        }
        setLoading(false);
    }, [uid]);

    useEffect(() => {
        fetchCredits();

        // Simple polling every 30 seconds instead of Realtime WebSocket
        // This avoids the ws://localhost:8081 connection error
        const interval = setInterval(fetchCredits, 30000);

        return () => {
            clearInterval(interval);
        };
    }, [uid, fetchCredits]);

    return {
        credits,
        available: credits,
        loading,
        refresh: fetchCredits,
    };
}
