import React, { useEffect } from 'react';

interface AlertModalProps {
    open: boolean;
    onClose: () => void;
    title: string;
    message: string;
    learnMoreUrl?: string;
}

export const AlertModal: React.FC<AlertModalProps> = ({
    open,
    onClose,
    title,
    message,
    learnMoreUrl,
}) => {
    // Close on ESC
    useEffect(() => {
        if (!open) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [open, onClose]);

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-[300] flex items-center justify-center">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* Dialog */}
            <div className="relative bg-[#1c1c1e] border border-white/10 rounded-2xl w-full max-w-sm mx-4 shadow-2xl shadow-black/50 overflow-hidden">
                <div className="p-6 text-center">
                    {/* Warning icon */}
                    <div className="w-12 h-12 rounded-full bg-yellow-500/10 flex items-center justify-center mx-auto mb-4">
                        <span className="text-yellow-400 text-xl">⚠</span>
                    </div>

                    <h3 className="text-base font-semibold text-white mb-2">{title}</h3>
                    <p className="text-[13px] text-gray-400 leading-relaxed">{message}</p>
                </div>

                {/* Actions */}
                <div className="border-t border-white/5 flex">
                    {learnMoreUrl && (
                        <a
                            href={learnMoreUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex-1 py-3 text-center text-[13px] font-medium text-[#0071e3] hover:bg-white/5 transition-colors border-r border-white/5"
                        >
                            Pelajari Lebih Lanjut
                        </a>
                    )}
                    <button
                        onClick={onClose}
                        className="flex-1 py-3 text-center text-[13px] font-semibold text-white hover:bg-white/5 transition-colors"
                    >
                        OK
                    </button>
                </div>
            </div>
        </div>
    );
};
