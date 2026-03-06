import React, { useState } from 'react';
import { supabase } from '../src/lib/supabaseClient';
import { useToast } from '../src/components/ui/ToastProvider';
import { useNavigate } from 'react-router-dom';

interface LoginPageProps {
    onSignIn: () => Promise<void>;
    loading: boolean;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onSignIn, loading }) => {
    const [loginMode, setLoginMode] = useState(true);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [emailSignInLoading, setEmailSignInLoading] = useState(false);
    const [forgotPasswordLoading, setForgotPasswordLoading] = useState(false);

    const { toast } = useToast();
    const navigate = useNavigate();

    const handleEmailSignIn = async (e: React.FormEvent) => {
        e.preventDefault();
        setEmailSignInLoading(true);
        try {
            const { error } = await supabase.auth.signInWithPassword({
                email,
                password,
            });
            if (error) {
                let errMsg = 'Gagal masuk. Silakan cek email dan password Anda.';
                if (error.message.includes('Invalid login credentials')) {
                    errMsg = 'Email atau password salah.';
                } else if (error.message.includes('too many requests')) {
                    errMsg = 'Akses ditolak karena terlalu sering mencoba. Silahkan reset password atau coba lagi nanti.';
                }
                toast({ type: 'error', title: 'Login Gagal', description: errMsg });
            }
            // onAuthStateChange in AuthGate handles the rest
        } catch (err: any) {
            console.error('Email sign-in failed:', err);
            toast({ type: 'error', title: 'Login Gagal', description: 'Terjadi kesalahan. Coba lagi.' });
        } finally {
            setEmailSignInLoading(false);
        }
    };

    const handleForgotPassword = async () => {
        if (!email) {
            toast({ type: 'warning', title: 'Email Diperlukan', description: 'Masukkan email Anda di atas sebelum klik Lupa Password.' });
            return;
        }
        setForgotPasswordLoading(true);
        try {
            const { error } = await supabase.auth.resetPasswordForEmail(email, {
                redirectTo: `${window.location.origin}/`,
            });
            if (error) {
                toast({ type: 'error', title: 'Gagal', description: 'Gagal mengirim email reset. Pastikan email terdaftar.' });
            } else {
                toast({ type: 'success', title: 'Email Terkirim', description: 'Silahkan periksa kotak masuk email Anda untuk instruksi reset password.' });
            }
        } catch (err: any) {
            toast({ type: 'error', title: 'Gagal', description: 'Gagal mengirim email reset. Pastikan email terdaftar.' });
        } finally {
            setForgotPasswordLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-white font-sans flex items-center justify-center selection:bg-[#0071e3]/30 p-4">

            <div className="w-full max-w-sm flex flex-col items-center">
                {/* Logo + Title */}
                <div className="flex items-center gap-3 mb-8">
                    <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center -rotate-3 hover:rotate-0 transition-all duration-300">
                        <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 text-black">
                            <rect x="5" y="5" width="5" height="14" />
                            <path d="M12 5V19C16.5 19 19 16 19 12C19 8 16.5 5 12 5Z" />
                        </svg>
                    </div>
                    <span className="font-semibold text-xl tracking-tight">Flowgen Studio</span>
                </div>

                {/* Card */}
                <div className="bg-[#1c1c1e] border border-white/5 rounded-3xl p-8 w-full shadow-2xl relative overflow-hidden backdrop-blur-xl">
                    <h1 className="text-xl font-semibold mb-2 text-center tracking-tight">Login</h1>
                    <p className="text-sm text-gray-400 mb-8 text-center px-4">Ubah Foto Produk Jadi Lebih Profesional Dalam Hitungan Detik</p>

                    <form onSubmit={handleEmailSignIn} className="space-y-4">
                        <div>
                            <input
                                type="email"
                                required
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="Alamat Email"
                                className="w-full bg-[#2c2c2e] text-white text-[15px] rounded-2xl px-5 py-[14px] border border-transparent focus:border-[#0071e3]/50 focus:ring-2 focus:ring-[#0071e3]/20 outline-none transition-all placeholder:text-gray-500"
                            />
                        </div>
                        <div>
                            <input
                                type="password"
                                required
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="Password"
                                className="w-full bg-[#2c2c2e] text-white text-[15px] rounded-2xl px-5 py-[14px] border border-transparent focus:border-[#0071e3]/50 focus:ring-2 focus:ring-[#0071e3]/20 outline-none transition-all placeholder:text-gray-500"
                            />
                        </div>

                        <div className="flex justify-between items-center px-1 mb-2">
                            <button
                                type="button"
                                onClick={handleForgotPassword}
                                disabled={forgotPasswordLoading}
                                className="text-[12px] text-gray-400 hover:text-white transition-colors"
                            >
                                {forgotPasswordLoading ? 'Mengirim...' : 'Lupa Password?'}
                            </button>
                        </div>

                        <button
                            type="submit"
                            disabled={emailSignInLoading}
                            className={`w-full py-[14px] rounded-2xl font-medium text-[15px] transition-all flex items-center justify-center gap-2 
                            ${emailSignInLoading ? 'bg-[#0071e3]/50 text-white/50 cursor-not-allowed' : 'bg-[#0071e3] text-white hover:bg-[#005fb8] active:scale-[0.98] shadow-lg shadow-[#0071e3]/20'}`}
                        >
                            {emailSignInLoading ? (
                                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            ) : 'Login'}
                        </button>
                    </form>

                    <div className="relative my-7">
                        <div className="absolute inset-0 flex items-center">
                            <div className="w-full border-t border-white/5"></div>
                        </div>
                        <div className="relative flex justify-center text-xs">
                            <span className="bg-[#1c1c1e] px-3 text-gray-500">ATAU</span>
                        </div>
                    </div>

                    <button
                        onClick={onSignIn}
                        disabled={loading}
                        className={`w-full py-[14px] rounded-2xl font-medium text-[15px] transition-all flex items-center justify-center gap-3
                        ${loading
                                ? 'bg-[#2c2c2e] text-gray-500 cursor-not-allowed'
                                : 'bg-white text-black hover:bg-gray-200 active:scale-[0.98]'
                            }`}
                    >
                        {loading ? (
                            <div className="w-5 h-5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                        ) : (
                            <>
                                <svg width="18" height="18" viewBox="0 0 24 24">
                                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                                </svg>
                                <span>Continue with Google</span>
                            </>
                        )}
                    </button>

                    <button
                        onClick={() => navigate('/formorder')}
                        className="w-full mt-4 py-[14px] rounded-2xl font-medium text-[14px] transition-all flex items-center justify-center gap-2 text-gray-400 bg-transparent border border-white/5 hover:bg-white/5 active:scale-[0.98]"
                    >
                        Daftar Sekarang!
                    </button>

                </div>

                <p className="mt-8 text-[11px] text-gray-600">© 2026 Calyx Inc. All rights reserved.</p>
            </div>
        </div>
    );
};
