import { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabaseClient';
import { AppUser } from '../../types';
import type { User as SupabaseUser } from '@supabase/supabase-js';

/**
 * Map Supabase auth user to our AppUser shape expected by UI components.
 */
function toAppUser(user: SupabaseUser): AppUser {
    return {
        uid: user.id,
        email: user.email ?? null,
        displayName: user.user_metadata?.full_name ?? user.user_metadata?.name ?? null,
        photoURL: user.user_metadata?.avatar_url ?? null,
    };
}

/**
 * Ensure a row exists in public.users for this auth user.
 * Creates with credits=0, tier='FREE' if new.
 */
async function ensureUserRow(user: SupabaseUser) {
    const { error } = await supabase
        .from('users')
        .upsert(
            {
                id: user.id,
                email: user.email ?? null,
                username: user.user_metadata?.full_name ?? user.user_metadata?.name ?? null,
            },
            { onConflict: 'id', ignoreDuplicates: true }
        );
    if (error) {
        console.error('ensureUserRow error:', error);
    }
}

export function useAuth() {
    const [user, setUser] = useState<AppUser | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Get initial session
        supabase.auth.getSession().then(({ data: { session } }) => {
            if (session?.user) {
                setUser(toAppUser(session.user));
                ensureUserRow(session.user);
            }
            setLoading(false);
        });

        // Listen for auth changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            async (_event, session) => {
                if (session?.user) {
                    setUser(toAppUser(session.user));
                    await ensureUserRow(session.user);
                } else {
                    setUser(null);
                }
                setLoading(false);
            }
        );

        return () => subscription.unsubscribe();
    }, []);

    const signIn = useCallback(async () => {
        const { error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: import.meta.env.VITE_SITE_URL || window.location.origin,
            },
        });
        if (error) {
            console.error('Google sign-in failed:', error);
            throw error;
        }
    }, []);

    const signOut = useCallback(async () => {
        await supabase.auth.signOut();
    }, []);

    return { user, loading, signIn, signOut };
}

export { toAppUser, ensureUserRow };
