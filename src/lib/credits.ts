import { useState, useEffect } from 'react';
import { supabase } from './supabase';

interface CreditState {
    credits: number;
    available: number;
    loading: boolean;
}

export function useCredits(uid: string | null): CreditState {
    const [credits, setCredits] = useState(0);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!uid) {
            setCredits(0);
            setLoading(false);
            return;
        }

        // Initial fetch
        const fetchCredits = async () => {
            const { data, error } = await supabase
                .from('users')
                .select('credits')
                .eq('id', uid)
                .single();

            if (data && !error) {
                setCredits(data.credits ?? 0);
            }
            setLoading(false);
        };

        fetchCredits();

        // Subscribe to realtime changes on this user's row
        const channel = supabase
            .channel(`credits-${uid}`)
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'users',
                    filter: `id=eq.${uid}`,
                },
                (payload) => {
                    const newCredits = (payload.new as any)?.credits;
                    if (typeof newCredits === 'number') {
                        setCredits(newCredits);
                    }
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [uid]);

    return {
        credits,
        available: credits,
        loading,
    };
}
