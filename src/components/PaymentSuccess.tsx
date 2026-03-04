import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../../components/Icon';

export const PaymentSuccess: React.FC = () => {
    const navigate = useNavigate();
    const [countdown, setCountdown] = useState(5);

    useEffect(() => {
        // Fire Facebook Pixel Purchase Event
        if (typeof window !== 'undefined' && (window as any).fbq) {
            (window as any).fbq('track', 'Purchase', { value: 99000, currency: 'IDR' });
        }

        const timer = setInterval(() => {
            setCountdown(c => c > 0 ? c - 1 : 0);
        }, 1000);

        const redirect = setTimeout(() => {
            navigate('/');
        }, 5000);

        return () => {
            clearInterval(timer);
            clearTimeout(redirect);
        };
    }, [navigate]);

    return (
        <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-6 selection:bg-[#0071e3]/30">
            <div className="bg-[#1c1c1e] p-8 rounded-3xl border border-white/10 max-w-sm w-full text-center shadow-2xl animate-fade-in-up">
                <div className="w-20 h-20 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
                    <svg className="w-10 h-10 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                </div>

                <h1 className="text-2xl font-semibold mb-2 tracking-tight">Pembayaran Berhasil</h1>
                <p className="text-gray-400 text-sm mb-6">
                    Akun Pro Anda telah aktif. Anda sekarang memiliki 60 Credits untuk digunakan di Flowgen Studio.
                </p>

                <div className="bg-black/50 p-4 rounded-xl border border-white/5 mb-8">
                    <p className="text-xs text-gray-500 mb-1">Mengarahkan ke Dashboard dalam</p>
                    <p className="text-xl font-medium text-white">{countdown} detik</p>
                </div>

                <button
                    onClick={() => navigate('/')}
                    className="w-full bg-white text-black py-3.5 rounded-xl font-medium text-[15px] hover:bg-gray-200 transition-all active:scale-[0.98]"
                >
                    Mulai Sekarang
                </button>
            </div>
        </div>
    );
};
