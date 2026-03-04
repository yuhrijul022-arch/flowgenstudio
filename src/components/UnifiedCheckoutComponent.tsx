import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from './ui/ToastProvider';
import { Icon } from '../../components/Icon';
import { formatIDR } from '../utils/currency';

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

    const openSnap = (token: string, clientKey: string, isProd: boolean) => {
        const scriptId = 'midtrans-script';
        let script = document.getElementById(scriptId) as HTMLScriptElement;

        const openPopup = () => {
            if ((window as any).snap) {
                (window as any).snap.pay(token, {
                    onSuccess: function (result: any) {
                        localStorage.removeItem('lastSnapToken');
                        localStorage.removeItem('lastSnapClientKey');
                        localStorage.removeItem('lastSnapIsProd');
                        setPendingToken(null);
                        toast({ type: 'success', title: 'Sukses', description: 'Pembayaran berhasil dan akun Pro aktif!' });
                        navigate('/');
                    },
                    onPending: function (result: any) {
                        toast({ type: 'warning', title: 'Pembayaran belum selesai', description: 'Silakan selesaikan instruksi pembayaran.' });
                        localStorage.setItem('lastSnapToken', token);
                        localStorage.setItem('lastSnapClientKey', clientKey);
                        localStorage.setItem('lastSnapIsProd', String(isProd));
                        setPendingToken(token);
                    },
                    onError: function (result: any) {
                        toast({ type: 'error', title: 'Gagal', description: 'Transaksi gagal diproses.' });
                        localStorage.removeItem('lastSnapToken');
                        setPendingToken(null);
                    },
                    onClose: function () {
                        toast({ type: 'warning', title: 'Tertunda', description: 'Pembayaran tertunda. Cek tab Billing untuk melanjutkan pembayaran.' });
                        localStorage.setItem('lastSnapToken', token);
                        localStorage.setItem('lastSnapClientKey', clientKey);
                        localStorage.setItem('lastSnapIsProd', String(isProd));
                        setPendingToken(token);
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
            openPopup();
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);

        try {
            const baseUrl = import.meta.env.VITE_BASE_URL || '';
            const response = await fetch(`${baseUrl}/api/create-transaction`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: form.email,
                    username: form.username,
                    password: form.password,
                    promoCode: form.promoCode,
                }),
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => null);
                throw new Error(errData?.error || "Failed to create transaction.");
            }

            const result = await response.json();
            const data = result.data;
            openSnap(data.snapToken, data.clientKey, data.isProduction);

        } catch (err: any) {
            console.error("Create Tx Error:", err);
            toast({ type: 'error', title: 'Kesalahan', description: err.message || 'Gagal membuat transaksi. Coba lagi sebentar.' });
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
                                    onClick={() => openSnap(pendingToken, pendingClientKey, pendingIsProd)}
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
