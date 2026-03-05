import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../src/lib/supabase';
import { ensureUserRow, toAppUser } from '../src/lib/auth';
import { LoginPage } from './LoginPage';
import { AppUser } from '../types';
import type { User as SupabaseUser } from '@supabase/supabase-js';

const AUTH_TIMEOUT_MS = 5000; // 5 seconds max for session load
const LOADING_GUARD_MS = 15000; // 15 seconds max loading state

// ── Storage self-healing keys ──
const SUPABASE_AUTH_KEYS = [
    'supabase.auth.token',
    'sb-session',
];

function clearCorruptedAuthStorage() {
    console.log('[AuthGate] Clearing corrupted auth storage...');
    try {
        // Clear known Supabase auth keys
        for (const key of SUPABASE_AUTH_KEYS) {
            localStorage.removeItem(key);
        }
        // Clear any key that starts with 'sb-' (Supabase storage prefix)
        const keysToRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && (key.startsWith('sb-') || key.includes('supabase'))) {
                keysToRemove.push(key);
            }
        }
        keysToRemove.forEach(key => localStorage.removeItem(key));
        console.log('[AuthGate] Cleared', keysToRemove.length, 'auth keys');
    } catch (e) {
        console.error('[AuthGate] Storage clear failed:', e);
    }
}

interface AuthGateProps {
    children: (user: AppUser) => React.ReactNode;
}

export const AuthGate: React.FC<AuthGateProps> = ({ children }) => {
    const [user, setUser] = useState<AppUser | null>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [signInLoading, setSignInLoading] = useState(false);
    const [recoveryAttempted, setRecoveryAttempted] = useState(false);
    const bootstrappedUid = useRef<string | null>(null);

    // ── SAFE SESSION BOOTSTRAP WITH TIMEOUT ──
    useEffect(() => {
        console.log('[AuthGate] app_boot: starting auth bootstrap');

        let timeoutId: ReturnType<typeof setTimeout>;
        let resolved = false;

        const resolveAuth = (sessionUser: SupabaseUser | null) => {
            if (resolved) return;
            resolved = true;
            clearTimeout(timeoutId);

            if (sessionUser) {
                const appUser = toAppUser(sessionUser);
                setUser(appUser);
                if (bootstrappedUid.current !== sessionUser.id) {
                    bootstrappedUid.current = sessionUser.id;
                    ensureUserRow(sessionUser).catch(err =>
                        console.error('[AuthGate] ensureUserRow failed:', err)
                    );
                }
                console.log('[AuthGate] session_loaded:', sessionUser.id);
            } else {
                console.log('[AuthGate] session_loaded: no user');
            }
            setAuthLoading(false);
        };

        // Attempt to get session with timeout protection
        const bootstrap = async () => {
            try {
                const { data: { session }, error } = await supabase.auth.getSession();
                if (error) {
                    console.error('[AuthGate] session_failed:', error.message);
                    // Try self-healing
                    if (!recoveryAttempted) {
                        console.log('[AuthGate] recovery_triggered: clearing corrupted storage');
                        clearCorruptedAuthStorage();
                        setRecoveryAttempted(true);
                        // Try once more
                        const { data: { session: retrySession } } = await supabase.auth.getSession();
                        resolveAuth(retrySession?.user ?? null);
                        return;
                    }
                    resolveAuth(null);
                    return;
                }
                resolveAuth(session?.user ?? null);
            } catch (err) {
                console.error('[AuthGate] session_failed (exception):', err);
                if (!recoveryAttempted) {
                    console.log('[AuthGate] recovery_triggered: clearing storage after exception');
                    clearCorruptedAuthStorage();
                    setRecoveryAttempted(true);
                }
                resolveAuth(null);
            }
        };

        // Timeout protection: if bootstrap takes > 5s, give up and show login
        timeoutId = setTimeout(() => {
            if (!resolved) {
                console.warn('[AuthGate] auth_timeout: session load exceeded 5s, falling back');
                resolveAuth(null);
            }
        }, AUTH_TIMEOUT_MS);

        bootstrap();

        // ── AUTH STATE CHANGE LISTENER ──
        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            async (_event, session) => {
                if (session?.user) {
                    const appUser = toAppUser(session.user);
                    if (bootstrappedUid.current !== session.user.id) {
                        bootstrappedUid.current = session.user.id;
                        try {
                            await ensureUserRow(session.user);
                        } catch (err) {
                            console.error('[AuthGate] ensureUserRow failed:', err);
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

        return () => {
            clearTimeout(timeoutId);
            subscription.unsubscribe();
        };
    }, [recoveryAttempted]);

    // ── TAB VISIBILITY RECOVERY ──
    useEffect(() => {
        const handleVisibilityChange = async () => {
            if (document.visibilityState === 'visible') {
                console.log('[AuthGate] tab_visible: refreshing session');
                try {
                    const { data: { session }, error } = await supabase.auth.getSession();
                    if (error || !session?.user) {
                        // Session expired — sign out gracefully
                        console.log('[AuthGate] session_expired_on_return');
                        bootstrappedUid.current = null;
                        setUser(null);
                    } else {
                        // Session valid — update user state
                        setUser(toAppUser(session.user));
                    }
                } catch (err) {
                    console.error('[AuthGate] visibility_recovery_error:', err);
                }
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, []);

    // ── LOADING GUARD: force exit loading after 15s ──
    useEffect(() => {
        if (!authLoading) return;

        const guardTimer = setTimeout(() => {
            if (authLoading) {
                console.warn('[AuthGate] loading_guard: forced exit after 15s');
                setAuthLoading(false);
            }
        }, LOADING_GUARD_MS);

        return () => clearTimeout(guardTimer);
    }, [authLoading]);

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
                console.error('[AuthGate] sign_in_failed:', error);
            }
        } catch (err: any) {
            console.error('[AuthGate] sign_in_failed:', err);
        } finally {
            setSignInLoading(false);
        }
    }, []);

    // Loading state — with auto-recovery
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
