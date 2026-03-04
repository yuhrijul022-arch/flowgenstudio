import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';

/* ── Types ────────────────────────────────────────── */
type ToastType = 'success' | 'warning' | 'error' | 'info';

interface Toast {
    id: number;
    type: ToastType;
    title: string;
    description?: string;
    duration?: number;
}

interface ToastContextValue {
    toast: (opts: Omit<Toast, 'id'>) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export const useToast = (): ToastContextValue => {
    const ctx = useContext(ToastContext);
    if (!ctx) throw new Error('useToast must be used inside ToastProvider');
    return ctx;
};

/* ── Icons ────────────────────────────────────────── */
const icons: Record<ToastType, string> = {
    success: '✓',
    warning: '⚠',
    error: '✕',
    info: 'ℹ',
};

const borderColors: Record<ToastType, string> = {
    success: 'border-green-500/30',
    warning: 'border-yellow-500/30',
    error: 'border-red-500/30',
    info: 'border-blue-500/30',
};

const iconColors: Record<ToastType, string> = {
    success: 'text-green-400',
    warning: 'text-yellow-400',
    error: 'text-red-400',
    info: 'text-blue-400',
};

/* ── Single Toast ─────────────────────────────────── */
const ToastItem: React.FC<{ toast: Toast; onDismiss: (id: number) => void }> = ({
    toast: t,
    onDismiss,
}) => {
    const [exiting, setExiting] = useState(false);
    const timerRef = useRef<ReturnType<typeof setTimeout>>();

    useEffect(() => {
        const dur = t.duration ?? 5000;
        timerRef.current = setTimeout(() => {
            setExiting(true);
            setTimeout(() => onDismiss(t.id), 250);
        }, dur);
        return () => clearTimeout(timerRef.current);
    }, [t.id, t.duration, onDismiss]);

    const handleClose = () => {
        setExiting(true);
        setTimeout(() => onDismiss(t.id), 250);
    };

    return (
        <div
            className={`
        flex items-start gap-3 w-80 max-w-[calc(100vw-2rem)]
        bg-[#1c1c1e]/95 backdrop-blur-xl
        border ${borderColors[t.type]}
        rounded-xl p-3.5 shadow-2xl shadow-black/40
        transition-all duration-250 ease-out
        ${exiting ? 'opacity-0 translate-x-4' : 'opacity-100 translate-x-0'}
      `}
            role="alert"
        >
            {/* Icon */}
            <span className={`text-sm mt-0.5 flex-shrink-0 ${iconColors[t.type]}`}>
                {icons[t.type]}
            </span>

            {/* Text */}
            <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-white leading-tight">{t.title}</p>
                {t.description && (
                    <p className="text-[12px] text-gray-400 mt-1 leading-snug">{t.description}</p>
                )}
            </div>

            {/* Close */}
            <button
                onClick={handleClose}
                className="text-gray-500 hover:text-white transition-colors text-xs mt-0.5 flex-shrink-0"
                aria-label="Close"
            >
                ✕
            </button>
        </div>
    );
};

/* ── Provider ─────────────────────────────────────── */
export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [toasts, setToasts] = useState<Toast[]>([]);
    const nextId = useRef(0);

    const dismiss = useCallback((id: number) => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
    }, []);

    const toast = useCallback((opts: Omit<Toast, 'id'>) => {
        const id = nextId.current++;
        setToasts((prev) => [...prev.slice(-4), { ...opts, id }]); // max 5
    }, []);

    return (
        <ToastContext.Provider value={{ toast }}>
            {children}

            {/* Toast container — top-right, above everything */}
            <div className="fixed top-16 right-4 z-[200] flex flex-col gap-2 pointer-events-none">
                {toasts.map((t) => (
                    <div key={t.id} className="pointer-events-auto">
                        <ToastItem toast={t} onDismiss={dismiss} />
                    </div>
                ))}
            </div>
        </ToastContext.Provider>
    );
};
