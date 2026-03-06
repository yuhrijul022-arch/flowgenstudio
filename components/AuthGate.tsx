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

        // 1. Ambil session awal
        supabase.auth.getSession().then(({ data: { session } }) => {
            if (session?.user) {
                setUser(toAppUser(session.user));
                ensureUserRow(session.user).catch(console.error);
            }
            setAuthLoading(false);
        });

        // 2. Listener perubahan auth (WAJIB ADA)
        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
            console.log(`[AuthGate] Auth event: ${event}`);
            if (session?.user) {
                setUser(toAppUser(session.user));
                ensureUserRow(session.user).catch(console.error);
            } else if (event === 'SIGNED_OUT') {
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
        return <LoginPage onSignIn={async () => { await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } }); }} loading={false} />;
    }

    return <>{children(user)}</>;
};

export const handleSignOut = () => supabase.auth.signOut();
