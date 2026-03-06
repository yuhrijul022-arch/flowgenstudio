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

        // Gunakan onAuthStateChange sebagai satu-satunya sumber kebenaran (Source of Truth)
        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
            console.log(`[AuthGate] Event: ${event}`);

            if (session?.user) {
                setUser(toAppUser(session.user));
                // Sync ke DB tanpa memblokir UI
                ensureUserRow(session.user).catch(console.error);
            } else {
                setUser(null);
            }

            // HANYA set loading false setelah event INITIAL_SESSION atau SIGNED_IN diterima
            setAuthLoading(false);
        });

        // Pengecekan sesi awal tetap dilakukan untuk mempercepat proses jika token masih segar
        supabase.auth.getSession().then(({ data: { session } }) => {
            if (session?.user) {
                setUser(toAppUser(session.user));
                setAuthLoading(false);
            }
            // Jika null, biarkan onAuthStateChange yang memutuskan di atas
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
        return <LoginPage onSignIn={async () => { await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } }); }} loading={false} />;
    }

    return <>{children(user)}</>;
};

export const handleSignOut = () => supabase.auth.signOut();
