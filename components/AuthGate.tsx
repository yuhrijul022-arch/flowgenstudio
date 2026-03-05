import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../src/lib/supabaseClient';
import { ensureUserRow, toAppUser } from '../src/lib/auth';
import { LoginPage } from './LoginPage';
import { AppUser } from '../types';

export const AuthGate: React.FC<{ children: (user: AppUser) => React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<AppUser | null>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const initialized = useRef(false);

    useEffect(() => {
        if (initialized.current) return;
        initialized.current = true;

        // LANGKAH 1: Ambil session yang ada di storage secara instan
        const syncAuth = async () => {
            try {
                const { data: { session } } = await supabase.auth.getSession();
                if (session?.user) {
                    setUser(toAppUser(session.user));
                    // Background sync: jangan pakai 'await' agar tidak menghalangi UI
                    ensureUserRow(session.user).catch(console.error);
                }
            } catch (err) {
                console.error('[AuthGate] Bootstrap error:', err);
            } finally {
                setAuthLoading(false); // Langsung buka loading screen
            }
        };

        syncAuth();

        // LANGKAH 2: Pasang listener untuk semua perubahan status
        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
            console.log(`[AuthGate] Event: ${event}`);

            if (session?.user) {
                setUser(toAppUser(session.user));
                // Sync user data tanpa memblokir aplikasi
                ensureUserRow(session.user).catch(console.error);
            } else {
                setUser(null);
            }
            setAuthLoading(false);
        });

        return () => subscription.unsubscribe();
    }, []);

    if (authLoading) {
        return (
            <div className="min-h-screen bg-black flex items-center justify-center">
                <div className="w-8 h-8 border-2 border-[#0071e3] border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    if (!user) {
        return <LoginPage onSignIn={async () => { await supabase.auth.signInWithOAuth({ provider: 'google' }); }} loading={false} />;
    }

    return <>{children(user)}</>;
};

export const handleSignOut = () => supabase.auth.signOut();
