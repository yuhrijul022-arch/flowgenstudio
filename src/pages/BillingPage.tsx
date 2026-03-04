import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';
import { formatIDR } from '../utils/currency';
import { useToast } from '../components/ui/ToastProvider';

interface Transaction {
    order_id: string;
    type: string;
    user_id: string | null;
    email: string;
    credits: number;
    amount: number;
    status: string;
    snap_token: string;
    created_at: string;
}

export const BillingPage: React.FC = () => {
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [loading, setLoading] = useState(true);
    const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
    const navigate = useNavigate();
    const { toast } = useToast();

    useEffect(() => {
        const loadTransactions = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session?.user) {
                navigate('/');
                return;
            }

            const uid = session.user.id;

            // Fetch transactions
            const { data, error } = await supabase
                .from('billing_transactions')
                .select('*')
                .eq('user_id', uid)
                .order('created_at', { ascending: false });

            if (error) {
                console.error('Error fetching transactions:', error);
                toast({ type: 'error', title: 'Error', description: 'Gagal memuat data billing.' });
            } else {
                setTransactions(data || []);
            }
            setLoading(false);

            // Subscribe to realtime changes
            const channel = supabase
                .channel(`billing-${uid}`)
                .on(
                    'postgres_changes',
                    {
                        event: '*',
                        schema: 'public',
                        table: 'billing_transactions',
                        filter: `user_id=eq.${uid}`,
                    },
                    () => {
                        // Refetch on any change
                        supabase
                            .from('billing_transactions')
                            .select('*')
                            .eq('user_id', uid)
                            .order('created_at', { ascending: false })
                            .then(({ data }) => {
                                if (data) setTransactions(data);
                            });
                    }
                )
                .subscribe();

            return () => {
                supabase.removeChannel(channel);
            };
        };

        loadTransactions();
    }, [navigate, toast]);

    const handleResumePayment = async (tx: Transaction) => {
        if (!tx.snap_token) {
            toast({ type: 'error', title: 'Token Kosong', description: 'Gagal melanjutkan pembayaran karena token tidak ditemukan.' });
            return;
        }

        setActionLoadingId(tx.order_id);

        try {
            const isProd = import.meta.env.VITE_MIDTRANS_IS_PROD === 'true';
            const clientKey = import.meta.env.VITE_MIDTRANS_CLIENT_KEY || '';

            if (!(window as any).snap) {
                const script = document.createElement('script');
                script.src = isProd
                    ? 'https://app.midtrans.com/snap/snap.js'
                    : 'https://app.sandbox.midtrans.com/snap/snap.js';
                script.setAttribute('data-client-key', clientKey);
                document.body.appendChild(script);

                await new Promise((resolve) => {
                    script.onload = resolve;
                });
            }

            (window as any).snap.pay(tx.snap_token, {
                onSuccess: function (res: any) {
                    toast({ type: 'success', title: 'Pembayaran Berhasil', description: 'Tranksaksi sedang diproses.' });
                },
                onPending: function (res: any) {
                    toast({ type: 'warning', title: 'Menunggu', description: 'Pembayaran masih tertunda.' });
                },
                onError: function (res: any) {
                    toast({ type: 'error', title: 'Gagal', description: 'Transaksi gagal diproses oleh sistem.' });
                },
                onClose: function () {
                    toast({ type: 'warning', title: 'Dibatalkan', description: 'Popup ditutup.' });
                }
            });
        } catch (err: any) {
            console.error(err);
            toast({ type: 'error', title: 'Error', description: err.message || 'Gagal memutar popup Midtrans.' });
        } finally {
            setActionLoadingId(null);
        }
    };

    const renderStatusBadge = (status: string) => {
        switch (status) {
            case 'success':
                return <span className="px-2.5 py-1 text-[10px] uppercase font-bold tracking-wider rounded-md bg-green-500/10 text-green-400 border border-green-500/20">Berhasil</span>;
            case 'pending':
                return <span className="px-2.5 py-1 text-[10px] uppercase font-bold tracking-wider rounded-md bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">Tertunda</span>;
            case 'expired':
                return <span className="px-2.5 py-1 text-[10px] uppercase font-bold tracking-wider rounded-md bg-gray-500/10 text-gray-400 border border-gray-500/20">Kadaluarsa</span>;
            case 'failed':
                return <span className="px-2.5 py-1 text-[10px] uppercase font-bold tracking-wider rounded-md bg-red-500/10 text-red-400 border border-red-500/20">Gagal</span>;
            default:
                return <span className="px-2.5 py-1 text-[10px] uppercase font-bold tracking-wider rounded-md bg-gray-500/10 text-gray-400 border border-gray-500/20">{status}</span>;
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-[#0a0a0a] text-white flex items-center justify-center font-sans tracking-tight">
                <div className="w-8 h-8 border-2 border-[#0071e3] border-t-transparent rounded-full animate-spin"></div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-white font-sans tracking-tight pt-24 pb-12 px-4 selection:bg-[#0071e3]/30">
            <div className="max-w-4xl mx-auto">
                <div className="flex items-center gap-4 mb-8">
                    <button
                        onClick={() => navigate('/')}
                        className="w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors border border-white/5"
                    >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M19 12H5M12 19l-7-7 7-7" />
                        </svg>
                    </button>
                    <div>
                        <h1 className="text-3xl font-semibold tracking-tight">Billing & Transaksi</h1>
                        <p className="text-gray-400 text-sm mt-1">Riwayat pembelian Pro dan top-up credits Anda.</p>
                    </div>
                </div>

                {transactions.length === 0 ? (
                    <div className="bg-[#1c1c1e] rounded-2xl border border-white/5 p-12 text-center">
                        <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-4">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400">
                                <rect x="2" y="5" width="20" height="14" rx="2" />
                                <line x1="2" y1="10" x2="22" y2="10" />
                            </svg>
                        </div>
                        <h3 className="text-lg font-medium text-white mb-2">Belum Ada Transaksi</h3>
                        <p className="text-sm text-gray-400">Anda belum melakukan pembelian atau top-up credits.</p>
                    </div>
                ) : (
                    <div className="bg-[#1c1c1e] rounded-[1.5rem] border border-white/5 overflow-hidden shadow-2xl">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="border-b border-white/5 bg-white/[0.02]">
                                        <th className="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Tanggal</th>
                                        <th className="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Tipe / Item</th>
                                        <th className="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Jumlah</th>
                                        <th className="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Status</th>
                                        <th className="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right">Aksi</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/5">
                                    {transactions.map((tx) => (
                                        <tr key={tx.order_id} className="hover:bg-white/[0.02] transition-colors">
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <div className="text-sm text-white">
                                                    {new Date(tx.created_at).toLocaleDateString('id-ID', { year: 'numeric', month: 'short', day: 'numeric' })}
                                                </div>
                                                <div className="text-[11px] text-gray-500 mt-0.5">
                                                    {new Date(tx.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="text-sm font-medium text-white">
                                                    {tx.type === 'signup_pro' ? 'Flowgen Studio Pro' : 'Top Up Credits'}
                                                </div>
                                                <div className="text-[12px] text-gray-400 mt-0.5 flex items-center gap-1.5">
                                                    <span className="w-1.5 h-1.5 rounded-full bg-[#0071e3]"></span>
                                                    {tx.credits || 0} Credits
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <div className="text-sm font-semibold text-white">
                                                    {formatIDR(tx.amount || 0)}
                                                </div>
                                                <div className="text-[10px] text-gray-500 mt-1 uppercase font-mono tracking-wider">{tx.order_id.split('-').slice(-2).join('-')}</div>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                {renderStatusBadge(tx.status)}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-right">
                                                {tx.status === 'pending' && (
                                                    <button
                                                        onClick={() => handleResumePayment(tx)}
                                                        disabled={actionLoadingId === tx.order_id}
                                                        className="px-4 py-2 bg-[#0071e3] hover:bg-[#0077ED] text-white text-[13px] font-medium rounded-lg transition-colors shadow-lg shadow-[#0071e3]/20 disabled:opacity-50"
                                                    >
                                                        {actionLoadingId === tx.order_id ? 'Memuat...' : 'Bayar Sekarang'}
                                                    </button>
                                                )}
                                                {tx.status !== 'pending' && (
                                                    <span className="text-[13px] text-gray-500 font-medium">-</span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
