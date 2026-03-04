import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export const PaymentPending: React.FC = () => {
    const navigate = useNavigate();
    const [timeLeft, setTimeLeft] = useState(15 * 60); // 15 minutes
    const snapToken = localStorage.getItem('flowgen_pending_snap_token');

    useEffect(() => {
        if (!snapToken) {
            navigate('/');
            return;
        }

        const timer = setInterval(() => {
            setTimeLeft(prev => {
                if (prev <= 1) {
                    clearInterval(timer);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
        return () => clearInterval(timer);
    }, [snapToken, navigate]);

    const formatTime = (seconds: number) => {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m}:${s.toString().padStart(2, '0')}`;
    };

    const handleResumePayment = () => {
        if (!snapToken) return;
        if (typeof window !== 'undefined' && (window as any).snap) {
            (window as any).snap.pay(snapToken, {
                onSuccess: function () {
                    localStorage.removeItem('flowgen_pending_snap_token');
                    navigate('/success');
                },
                onPending: function () {
                    alert("Pembayaran masih tertunda. Segera selesaikan.");
                },
                onError: function () {
                    alert("Pembayaran gagal. Silakan coba lagi nanti.");
                },
                onClose: function () {
                    // Stay on pending
                }
            });
        } else {
            alert("Sistem pembayaran belum siap. Coba muat ulang halaman.");
        }
    };

    return (
        <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-6 selection:bg-[#0071e3]/30">
            <div className="bg-[#1c1c1e] p-8 rounded-3xl border border-white/10 max-w-sm w-full text-center shadow-2xl animate-fade-in-up">
                <div className="w-20 h-20 bg-yellow-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
                    <svg className="w-10 h-10 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                </div>

                <h1 className="text-2xl font-semibold mb-2 tracking-tight">Menunggu Pembayaran</h1>
                <p className="text-gray-400 text-sm mb-6">
                    Silakan selesaikan pembayaran Anda sebelum waktu habis.
                </p>

                <div className="bg-black/50 p-4 rounded-xl border border-white/5 mb-8">
                    <p className="text-xs text-gray-500 mb-1">Sisa Waktu</p>
                    <p className="text-2xl font-mono font-medium text-white">{formatTime(timeLeft)}</p>
                </div>

                <div className="space-y-3">
                    <button
                        onClick={handleResumePayment}
                        className="w-full bg-[#0071e3] text-white py-3.5 rounded-xl font-medium text-[15px] shadow-lg shadow-blue-500/20 hover:bg-[#409cff] transition-all active:scale-[0.98]"
                    >
                        Bayar Sekarang
                    </button>
                    <button
                        onClick={() => navigate('/')}
                        className="w-full bg-transparent text-gray-400 hover:text-white py-3.5 rounded-xl font-medium text-[15px] transition-colors"
                    >
                        Kembali ke Home
                    </button>
                </div>
            </div>
        </div>
    );
};
