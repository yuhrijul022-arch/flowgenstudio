import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useToast } from './ui/ToastProvider';
import { Icon } from '../../components/Icon';
import { formatIDR } from '../utils/currency';

interface TopUpModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const TOPUP_PACKAGES = [
    { credits: 15, price: 30000 },
    { credits: 25, price: 50000 },
    { credits: 50, price: 100000 },
    { credits: 100, price: 200000 },
];

export const TopUpModal: React.FC<TopUpModalProps> = ({ isOpen, onClose }) => {
    const { toast } = useToast();
    const [selectedPackage, setSelectedPackage] = useState<number | null>(null);
    const [customQty, setCustomQty] = useState<string>('');
    const [isLoading, setIsLoading] = useState(false);

    if (!isOpen) return null;

    const handleTopUp = async () => {
        const finalQty = customQty ? parseInt(customQty) : selectedPackage;

        if (!finalQty || finalQty < 1) {
            toast({ type: 'error', title: 'Pilih Paket', description: 'Silakan pilih paket atau masukkan jumlah credits minimal 1.' });
            return;
        }

        setIsLoading(true);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
                toast({ type: 'error', title: 'Error', description: 'Silakan login terlebih dahulu.' });
                return;
            }

            const baseUrl = import.meta.env.PROD ? '' : (import.meta.env.VITE_BASE_URL || '');
            const response = await fetch(`${baseUrl}/api/topup`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session.access_token}`,
                },
                body: JSON.stringify({ creditsQty: finalQty }),
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => null);
                throw new Error(errData?.error || 'Failed to create topup transaction.');
            }

            const result = await response.json();
            const snapToken = result.snapToken || result.data?.snapToken;
            const clientKey = import.meta.env.VITE_MIDTRANS_CLIENT_KEY || result.clientKey;
            const isProduction = import.meta.env.VITE_MIDTRANS_IS_PROD === 'true';
            // Load Snap JS if not loaded
            if (!(window as any).snap) {
                const script = document.createElement('script');
                script.src = isProduction
                    ? 'https://app.midtrans.com/snap/snap.js'
                    : 'https://app.sandbox.midtrans.com/snap/snap.js';
                script.setAttribute('data-client-key', clientKey);
                document.body.appendChild(script);

                await new Promise((resolve) => {
                    script.onload = resolve;
                });
            }

            const pollAndClose = async (userId: string) => {
                toast({ type: 'info', title: 'Memverifikasi', description: 'Memeriksa status Top Up & update credits...' });
                let attempts = 0;
                const interval = setInterval(async () => {
                    attempts++;
                    if (attempts > 15) { // 30 seconds
                        clearInterval(interval);
                        onClose();
                        return;
                    }
                    const { data } = await supabase.from('users').select('credits').eq('id', userId).single();
                    if (data && data.credits > 0) {
                        clearInterval(interval);
                        toast({ type: 'success', title: 'Berhasil', description: 'Credits kamu sudah bertambah!' });
                        onClose();
                        setTimeout(() => window.location.reload(), 500); // hard refresh to update UI state across app
                    }
                }, 2000);
            };

            (window as any).snap.pay(snapToken, {
                onSuccess: function (res: any) {
                    pollAndClose(session.user.id);
                },
                onPending: function (res: any) {
                    toast({ type: 'warning', title: 'Menunggu Pembayaran', description: 'Silakan selesaikan pembayaran sesuai instruksi.' });
                    pollAndClose(session.user.id);
                },
                onError: function (res: any) {
                    toast({ type: 'error', title: 'Pembayaran Gagal', description: 'Terjadi kesalahan pada pembayaran.' });
                },
                onClose: function () {
                    toast({ type: 'warning', title: 'Tertunda', description: 'Jika sudah bayar, credits akan masuk sebentar lagi.' });
                    pollAndClose(session.user.id);
                }
            });

        } catch (error: any) {
            console.error("TopUp Error:", error);
            toast({ type: 'error', title: 'Gagal', description: error.message || 'Gagal membuat transaksi topup.' });
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 pt-10 sm:pt-4">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-md" onClick={onClose} />
            <div className="bg-[#1c1c1e] w-full max-w-lg rounded-3xl border border-white/10 shadow-2xl relative flex flex-col max-h-[90vh] overflow-hidden animate-fade-in z-10">
                <div className="px-6 py-5 border-b border-white/5 flex items-center justify-between sticky top-0 bg-[#1c1c1e]/80 backdrop-blur-md z-20">
                    <h2 className="text-xl font-bold text-white tracking-tight">Top Up Credits ⚡</h2>
                    <button
                        onClick={onClose}
                        className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-gray-400 hover:text-white transition-colors"
                        aria-label="Close modal"
                    >
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M13 1L1 13M1 1L13 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    </button>
                </div>

                <div className="p-6 overflow-y-auto custom-scrollbar">
                    <div className="mb-6">
                        <p className="text-sm text-gray-400 mb-4">Pilih paket credits yang ingin dibeli</p>
                        <div className="grid grid-cols-2 gap-3">
                            {TOPUP_PACKAGES.map((pkg) => (
                                <button
                                    key={pkg.credits}
                                    onClick={() => {
                                        setSelectedPackage(pkg.credits);
                                        setCustomQty('');
                                    }}
                                    className={`relative p-4 rounded-2xl border text-left transition-all overflow-hidden ${selectedPackage === pkg.credits && !customQty
                                        ? 'border-[#0071e3] bg-[#0071e3]/10'
                                        : 'border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10'
                                        }`}
                                >
                                    {selectedPackage === pkg.credits && !customQty && (
                                        <div className="absolute top-0 right-0 p-2 text-[#0071e3]">
                                            <Icon icon="check" className="w-5 h-5" />
                                        </div>
                                    )}
                                    <div className="text-2xl font-bold text-white mb-1">{pkg.credits}</div>
                                    <div className="text-xs text-gray-400 font-medium">Credits</div>
                                    <div className="mt-3 text-sm font-semibold text-white/90">
                                        {formatIDR(pkg.price)}
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="mb-6 space-y-4 pt-2 border-t border-white/10">
                        <label className="block text-sm font-medium text-white mb-2">Atau isi nominal custom:</label>
                        <div className="relative">
                            <input
                                type="number"
                                min={1}
                                step={1}
                                placeholder="Min. 1 Credit"
                                value={customQty}
                                onChange={(e) => {
                                    setCustomQty(e.target.value);
                                    setSelectedPackage(null);
                                }}
                                className="w-full h-[52px] bg-[#2c2c2e] border border-white/10 rounded-xl px-4 text-sm text-white focus:ring-2 focus:ring-[#0071e3] focus:border-transparent outline-none transition-all placeholder:text-gray-500"
                            />
                            {customQty && parseInt(customQty) > 0 && (
                                <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-[#0071e3] font-semibold">
                                    {formatIDR(parseInt(customQty) * 2000)}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <div className="p-6 border-t border-white/5 bg-[#1c1c1e] sticky bottom-0 z-20">
                    <button
                        onClick={handleTopUp}
                        disabled={isLoading || (!selectedPackage && (!customQty || parseInt(customQty) < 1))}
                        className="w-full h-[52px] bg-[#0071e3] hover:bg-[#0077ED] text-white font-semibold rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        {isLoading ? (
                            <>
                                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                <span>Memproses...</span>
                            </>
                        ) : (
                            <span>Bayar & Top Up</span>
                        )}
                    </button>
                    <p className="mt-4 text-center text-xs text-gray-500">
                        Pembayaran aman & otomatis diproses oleh Midtrans.
                    </p>
                </div>
            </div>
        </div>
    );
};
