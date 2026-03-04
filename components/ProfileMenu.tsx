import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppUser } from '../types';

interface ProfileMenuProps {
    user: AppUser;
    credits: number;
    creditsLoading: boolean;
    onSignOut: () => void;
    onTopUp: () => void;
}

export const ProfileMenu: React.FC<ProfileMenuProps> = ({
    user,
    credits,
    creditsLoading,
    onSignOut,
    onTopUp,
}) => {
    const [open, setOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    const navigate = useNavigate();

    // Close on click outside
    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    // Close on ESC
    useEffect(() => {
        if (!open) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false);
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [open]);

    const displayName = user.displayName || 'User';
    const email = user.email || 'No email';
    const initial = displayName[0].toUpperCase();

    return (
        <div className="relative" ref={menuRef}>
            {/* Trigger — Avatar button */}
            <button
                onClick={() => setOpen((v) => !v)}
                className="flex items-center justify-center hover:opacity-80 transition-opacity"
                aria-label="Profile menu"
                style={{ marginLeft: 4, width: 32, height: 32, minWidth: 32, minHeight: 32 }}
            >
                {user.photoURL ? (
                    <img
                        src={user.photoURL}
                        alt=""
                        className="rounded-full border border-white/10"
                        style={{ width: 32, height: 32, objectFit: 'cover' }}
                        referrerPolicy="no-referrer"
                    />
                ) : (
                    <div
                        className="rounded-full bg-[#0071e3] flex items-center justify-center font-bold text-white"
                        style={{ width: 32, height: 32, fontSize: 12 }}
                    >
                        {initial}
                    </div>
                )}
            </button>

            {/* Popup panel */}
            {open && (
                <div
                    className="absolute right-0 top-full mt-2 w-64 bg-[#1c1c1e] border border-white/10 rounded-xl shadow-2xl shadow-black/50 overflow-hidden z-[100]"
                    role="menu"
                >
                    {/* Profile header */}
                    <div className="flex items-center gap-3 p-4">
                        {user.photoURL ? (
                            <img
                                src={user.photoURL}
                                alt=""
                                className="w-10 h-10 rounded-full border border-white/10 flex-shrink-0"
                                referrerPolicy="no-referrer"
                            />
                        ) : (
                            <div className="w-10 h-10 rounded-full bg-[#0071e3] flex items-center justify-center text-sm font-bold text-white flex-shrink-0">
                                {initial}
                            </div>
                        )}
                        <div className="min-w-0">
                            <p className="text-sm font-semibold text-white truncate">{displayName}</p>
                            <p className="text-[11px] text-gray-400 truncate">{email}</p>
                        </div>
                    </div>

                    <div className="h-px bg-white/5" />

                    {/* Credits row */}
                    <div className="flex items-center justify-between px-4 py-3">
                        <div className="flex items-center gap-2">
                            <span className="text-[13px]">⚡</span>
                            <span className="text-[13px] text-gray-300">Credits</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-[13px] font-semibold text-white">
                                {creditsLoading ? '—' : credits}
                            </span>
                            <button
                                onClick={() => { setOpen(false); onTopUp(); }}
                                className="w-5 h-5 rounded-md bg-[#2c2c2e] hover:bg-[#3a3a3c] flex items-center justify-center transition-colors px-1 text-xs text-gray-400 flex-shrink-0"
                                aria-label="Top up credits"
                                title="Top Up"
                            >
                                +
                            </button>
                        </div>
                    </div>

                    <div className="h-px bg-white/5" />

                    {/* Billing */}
                    <button
                        onClick={() => {
                            setOpen(false);
                            navigate('/billing');
                        }}
                        className="w-full text-left px-4 py-3 text-[13px] text-gray-300 hover:text-white hover:bg-white/5 transition-colors flex justify-between items-center"
                        role="menuitem"
                    >
                        <span>Billing & Transaksi</span>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-50">
                            <path d="M9 18l6-6-6-6" />
                        </svg>
                    </button>

                    <div className="h-px bg-white/5" />

                    {/* Logout */}
                    <button
                        onClick={() => {
                            setOpen(false);
                            onSignOut();
                        }}
                        className="w-full text-left px-4 py-3 text-[13px] text-red-400 hover:bg-white/5 transition-colors"
                        role="menuitem"
                    >
                        Sign out
                    </button>
                </div>
            )}
        </div>
    );
};
