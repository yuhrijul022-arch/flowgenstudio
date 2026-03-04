import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../src/lib/supabase';
import { ensureUserRow, toAppUser } from '../src/lib/auth';
import { LoginPage } from './LoginPage';
import { AppUser } from '../types';
import type { User as SupabaseUser } from '@supabase/supabase-js';

interface AuthGateProps {
    children: (user: AppUser) => React.ReactNode;
}

export const AuthGate: React.FC<AuthGateProps> = ({ children }) => {
    const [user, setUser] = useState<AppUser | null>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [signInLoading, setSignInLoading] = useState(false);
    const bootstrappedUid = useRef<string | null>(null);

    // Listen to auth state
    useEffect(() => {
        // Get initial session
        supabase.auth.getSession().then(({ data: { session } }) => {
            if (session?.user) {
                const appUser = toAppUser(session.user);
                setUser(appUser);
                if (bootstrappedUid.current !== session.user.id) {
                    bootstrappedUid.current = session.user.id;
                    ensureUserRow(session.user).catch(err =>
                        console.error('ensureUserRow failed:', err)
                    );
                }
            }
            setAuthLoading(false);
        });

        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            async (_event, session) => {
                if (session?.user) {
                    const appUser = toAppUser(session.user);
                    // Only bootstrap once per uid session
                    if (bootstrappedUid.current !== session.user.id) {
                        bootstrappedUid.current = session.user.id;
                        try {
                            await ensureUserRow(session.user);
                        } catch (err) {
                            console.error('ensureUserRow failed:', err);
                        }
                    }
                    setUser(appUser);
                } else {
                    bootstrappedUid.current = null;
                    setUser(null);
                }
                setAuthLoading(false);
            }
        );

        return () => subscription.unsubscribe();
    }, []);

    const handleSignIn = useCallback(async () => {
        setSignInLoading(true);
        try {
            const { error } = await supabase.auth.signInWithOAuth({
                provider: 'google',
                options: {
                    redirectTo: window.location.origin,
                },
            });
            if (error) {
                console.error('Sign-in failed:', error);
            }
        } catch (err: any) {
            console.error('Sign-in failed:', err);
        } finally {
            setSignInLoading(false);
        }
    }, []);

    // Loading state — prevent flash of wrong UI
    if (authLoading) {
        return (
            <div className="min-h-screen bg-black flex items-center justify-center">
                <div className="w-10 h-10 border-2 border-[#0071e3] border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    // Not logged in → show login page
    if (!user) {
        return <LoginPage onSignIn={handleSignIn} loading={signInLoading} />;
    }

    // Logged in → render children (main app)
    return <>{children(user)}</>;
};

// Export signOut for use in App
export const handleSignOut = () => supabase.auth.signOut();
