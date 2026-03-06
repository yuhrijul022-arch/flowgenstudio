import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from './ui/ToastProvider';
import { Icon } from '../../components/Icon';
import { formatIDR } from '../utils/currency';
import { supabase } from '../lib/supabaseClient';

interface CreateTxResponse {
    snapToken: string;
    orderId: string;
    totalPrice: number;
    clientKey: string;
    isProduction: boolean;
}

export const UnifiedCheckoutComponent: React.FC = () => {
    const navigate = useNavigate();
    const { toast } = useToast();

    const [form, setForm] = useState({
        email: '',
        username: '',
        password: '',
        promoCode: ''
    });
    const [loading, setLoading] = useState(false);
    const basePrice = 99000;

    // Resume Token States
    const [pendingToken, setPendingToken] = useState<string | null>(() => localStorage.getItem('lastSnapToken'));
    const pendingClientKey = localStorage.getItem('lastSnapClientKey') || '';
    const pendingIsProd = localStorage.getItem('lastSnapIsProd') === 'true';

    // Pixel ViewContent
    useEffect(() => {
        if (typeof window !== 'undefined' && (window as any).fbq) {
            (window as any).fbq('track', 'ViewContent');
        }
    }, []);

    const handleFormChange = (key: string, val: string) => {
        if (form.email === '' && form.username === '' && form.password === '' && val !== '') {
            if (typeof window !== 'undefined' && (window as any).fbq) {
                (window as any).fbq('track', 'InitiateCheckout');
            }
        }
        setForm(prev => ({ ...prev, [key]: val }));
    };

    const openSnap = async (token: string, clientKey: string, isProd: boolean, userId: string) => {
        const scriptId = 'midtrans-script';
        let script = document.getElementById(scriptId) as HTMLScriptElement;

        // Fetch current credits before polling
        let startingCredits = 0;
        try {
            const { data } = await supabase.from('users').select('credits').eq('id', userId).single();
            startingCredits = data ? (data as any).credits : 0;
        } catch (e) {
            console.error('Failed to fetch initial credits', e);
        }

        const pollAndRedirect = async () => {
            // Toast SEKALI saja di awal — tidak di dalam loop
            toast({ type: 'info', title: 'Memverifikasi', description: 'Sistem sedang memverifikasi pembayaran Anda...' });
            let attempts = 0;
            const interval = setInterval(async () => {
                attempts++;
                if (attempts > 30) { // 60 seconds timeout (30 × 2s)
                    clearInterval(interval);
                    toast({ type: 'success', title: 'Pembayaran Diterima', description: 'Credits akan masuk dalam beberapa saat.' });
                    navigate('/');
                    return;
                }
                try {
                    const { data } = await supabase.from('users').select('pro_active, credits').eq('id', userId).single();
                    if (data && (data as any).pro_active) {
                        clearInterval(interval);
                        toast({ type: 'success', title: 'Sukses!', description: `Pembayaran berhasil! Credits Anda: ${(data as any).credits}` });
                        navigate('/');
                    }
                } catch (e) {
                    // ignore fetch errors during polling
                }
            }, 2000);
        };

        const openPopup = () => {
            if ((window as any).snap) {
                (window as any).snap.pay(token, {
                    onSuccess: function (result: any) {
                        localStorage.removeItem('lastSnapToken');
                        localStorage.removeItem('lastSnapClientKey');
                        localStorage.removeItem('lastSnapIsProd');
                        setPendingToken(null);
                        pollAndRedirect();
                    },
                    onPending: function (result: any) {
                        toast({ type: 'warning', title: 'Pembayaran belum diselesaikan', description: 'Selesaikan instruksi, refresh jika sudah bayar.' });
                        localStorage.setItem('lastSnapToken', token);
                        localStorage.setItem('lastSnapClientKey', clientKey);
                        localStorage.setItem('lastSnapIsProd', String(isProd));
                        setPendingToken(token);
                        pollAndRedirect();
                    },
                    onError: function (result: any) {
                        toast({ type: 'error', title: 'Gagal', description: 'Transaksi gagal diproses.' });
                        localStorage.removeItem('lastSnapToken');
                        setPendingToken(null);
                    },
                    onClose: function () {
                        toast({ type: 'warning', title: 'Tertunda', description: 'Jika sudah bayar, credits akan otomatis masuk sebentar lagi.' });
                        localStorage.setItem('lastSnapToken', token);
                        localStorage.setItem('lastSnapClientKey', clientKey);
                        localStorage.setItem('lastSnapIsProd', String(isProd));
                        setPendingToken(token);
                        pollAndRedirect();
                    }
                });
            }
        };

        if (!script) {
            script = document.createElement('script');
            script.id = scriptId;
            script.src = isProd ? 'https://app.midtrans.com/snap/snap.js' : 'https://app.sandbox.midtrans.com/snap/snap.js';
            script.setAttribute('data-client-key', clientKey);
            document.body.appendChild(script);
            script.onload = () => {
                openPopup();
            };
        } else {
            // Check if the loaded script matches current environment (sandbox vs production)
            const expectedSrc = isProd ? 'https://app.midtrans.com/snap/snap.js' : 'https://app.sandbox.midtrans.com/snap/snap.js';
            if (script.src !== expectedSrc) {
                // Remove old script and reload with correct environment
                script.remove();
                delete (window as any).snap;
                const newScript = document.createElement('script');
                newScript.id = scriptId;
                newScript.src = expectedSrc;
                newScript.setAttribute('data-client-key', clientKey);
                document.body.appendChild(newScript);
                newScript.onload = () => {
                    openPopup();
                };
            } else {
                openPopup();
            }
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);

        try {
            // STEP 1: Authenticate the user first
            let sessionResponse = await supabase.auth.signUp({
                email: form.email,
                password: form.password,
                options: {
                    data: {
                        username: form.username,
                    }
                }
            });

            // If user already registered, signup returns data but with a specific error or no session
            if (sessionResponse.error || !sessionResponse.data.session) {
                // Fallback to signIn
                sessionResponse = await supabase.auth.signInWithPassword({
                    email: form.email,
                    password: form.password,
                });
                if (sessionResponse.error) {
                    throw new Error("Gagal login atau mendaftar: " + sessionResponse.error.message);
                }
            }

            const token = sessionResponse.data.session?.access_token;
            if (!token) {
                throw new Error("Gagal mendapatkan sesi valid.");
            }

            // STEP 2: Create Transaction with Authorized token
            const baseUrl = import.meta.env.PROD ? '' : (import.meta.env.VITE_BASE_URL || '');

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

            const response = await fetch(`${baseUrl}/api/create-transaction`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    email: form.email,
                    username: form.username,
                    promoCode: form.promoCode,
                }),
                signal: controller.signal,
            });
            clearTimeout(timeoutId);

            if (!response.ok) {
                const errData = await response.json().catch(() => null);
                throw new Error(errData?.error || "Failed to create transaction.");
            }

            const result = await response.json();
            const data = result.data;
            const clientKey = import.meta.env.VITE_MIDTRANS_CLIENT_KEY || data.clientKey;
            const isProd = import.meta.env.VITE_MIDTRANS_IS_PROD === 'true';

            const userId = sessionResponse.data.session?.user?.id || '';
            await openSnap(data.snapToken, clientKey, isProd, userId);

        } catch (err: any) {
            console.error("Create Tx Error:", err);
            const msg = err.name === 'AbortError' ? 'Koneksi timeout. Silakan coba lagi.' : (err.message || 'Gagal membuat transaksi. Coba lagi sebentar.');
            toast({ type: 'error', title: 'Kesalahan', description: msg });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-white flex items-center justify-center p-4 selection:bg-[#0071e3]/30 font-sans">
            <div className="w-full max-w-5xl grid grid-cols-1 md:grid-cols-2 gap-8 items-start">

                {/* Visual / Info Left Side */}
                <div className="hidden md:flex flex-col justify-center sticky top-8">
                    <img src="/logo.svg" alt="Flowgen" className="w-12 h-12 mb-8 bg-white/10 rounded-xl p-2" onError={(e) => { e.currentTarget.style.display = 'none' }} />
                    <h1 className="text-4xl lg:text-5xl font-semibold tracking-tight leading-tight mb-4">
                        Tingkatkan Kualitas <br /><span className="text-[#0071e3]">Visual Produk Anda.</span>
                    </h1>
                    <p className="text-gray-400 text-lg mb-8 max-w-sm leading-relaxed">
                        Akses penuh Flowgen Studio Pro. Buat foto produk kualitas studio hanya dalam hitungan detik.
                    </p>
                    <ul className="space-y-4 text-gray-300 border-t border-white/10 pt-8">
                        <li className="flex items-center gap-3">
                            <Icon icon="check" className="w-5 h-5 text-[#0071e3]" />
                            <span>Akses Lifetime</span>
                        </li>
                        <li className="flex items-center gap-3">
                            <Icon icon="check" className="w-5 h-5 text-[#0071e3]" />
                            <span>Kualitas Foto Hingga 4K</span>
                        </li>
                        <li className="flex items-center gap-3">
                            <Icon icon="check" className="w-5 h-5 text-[#0071e3]" />
                            <span>100% Commercial Use</span>
                        </li>
                    </ul>
                </div>

                {/* Form Right Side */}
                <div className="bg-[#1c1c1e] rounded-[2rem] p-8 border border-white/5 shadow-2xl relative overflow-hidden backdrop-blur-xl">
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-1/2 bg-[#0071e3]/10 blur-[100px] pointer-events-none rounded-full"></div>

                    <div className="relative z-10">
                        <div className="mb-6 border-b border-white/10 pb-6">
                            <h2 className="text-xl font-semibold mb-1 tracking-tight">Buat Akun Pro</h2>
                            <p className="text-sm text-gray-400">Isi data di bawah untuk membuat akun & melanjutkan pembayaran.</p>
                        </div>

                        <form onSubmit={handleSubmit} className="space-y-5">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-[11px] font-semibold text-gray-500 uppercase mb-1">Nama Lengkap</label>
                                    <input
                                        type="text" required
                                        value={form.username} onChange={e => handleFormChange('username', e.target.value)}
                                        className="w-full bg-[#2c2c2e] text-white text-sm rounded-xl px-4 py-3 border-none focus:ring-1 focus:ring-[#0071e3] outline-none transition-all placeholder:text-gray-600"
                                        placeholder="John Doe"
                                    />
                                </div>
                                <div>
                                    <label className="block text-[11px] font-semibold text-gray-500 uppercase mb-1">Email Aktif</label>
                                    <input
                                        type="email" required
                                        value={form.email} onChange={e => handleFormChange('email', e.target.value)}
                                        className="w-full bg-[#2c2c2e] text-white text-sm rounded-xl px-4 py-3 border-none focus:ring-1 focus:ring-[#0071e3] outline-none transition-all placeholder:text-gray-600"
                                        placeholder="john@email.com"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-[11px] font-semibold text-gray-500 uppercase mb-1">Buat Password</label>
                                <input
                                    type="password" required minLength={6}
                                    value={form.password} onChange={e => handleFormChange('password', e.target.value)}
                                    className="w-full bg-[#2c2c2e] text-white text-sm rounded-xl px-4 py-3 border-none focus:ring-1 focus:ring-[#0071e3] outline-none transition-all placeholder:text-gray-600"
                                    placeholder="Min. 6 karakter"
                                />
                            </div>

                            {/* Summary */}
                            <div className="bg-black/40 rounded-xl p-5 border border-white/5 space-y-3 mt-8">
                                <div className="flex justify-between text-sm">
                                    <span className="text-gray-400">Harga</span>
                                    <div className="text-right">
                                        <span className="text-gray-500 line-through text-xs mr-2">{formatIDR(250000)}</span>
                                        <span className="text-white font-medium">{formatIDR(basePrice)}</span>
                                    </div>
                                </div>
                                <div className="border-t border-white/10 pt-3 flex justify-between">
                                    <span className="text-white font-semibold">Total</span>
                                    <span className="text-[#0071e3] font-bold text-lg tracking-tight">{formatIDR(basePrice)}</span>
                                </div>
                            </div>

                            <button
                                type="submit"
                                disabled={loading}
                                className={`w-full py-4 rounded-xl font-medium text-[15px] transition-all flex items-center justify-center gap-2 mt-4
                                ${loading
                                        ? 'bg-[#2c2c2e] text-gray-500 cursor-not-allowed'
                                        : 'bg-white text-black hover:bg-gray-200 shadow-lg shadow-white/10 active:scale-[0.98]'
                                    }`}
                            >
                                {loading ? (
                                    <>
                                        <div className="w-5 h-5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                                        <span>Memproses...</span>
                                    </>
                                ) : (
                                    'Lanjutkan Pembayaran'
                                )}
                            </button>

                            {pendingToken && (
                                <button
                                    type="button"
                                    onClick={async () => {
                                        const { data } = await supabase.auth.getSession();
                                        const userId = data.session?.user?.id || '';
                                        await openSnap(pendingToken, pendingClientKey, pendingIsProd, userId);
                                    }}
                                    className="w-full py-4 rounded-xl font-medium text-[15px] transition-all flex items-center justify-center gap-2 mt-3 bg-[#0071e3] text-white hover:bg-[#005bb5] shadow-lg shadow-[#0071e3]/20 active:scale-[0.98]"
                                >
                                    Bayar Sekarang (Transaksi Tertunda)
                                </button>
                            )}

                            <p className="text-[10px] text-gray-500 text-center mt-3">Transaksi Anda aman dan terenkripsi. Dengan melanjutkan, Anda menyetujui Syarat & Ketentuan kami.</p>
                        </form>
                    </div>
                </div>

            </div>
        </div>
    );
};
