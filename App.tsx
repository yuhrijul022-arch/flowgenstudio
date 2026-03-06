
import React, { useState, useEffect } from 'react';
import { AppUser, AspectRatio, ImageQuality } from './types';
import { FileUpload } from './components/FileUpload';
import { StylePresetCard } from './components/StylePresetCard';
import { PRESETS } from './src/lib/presets';
import { Icon } from './components/Icon';
import { ProfileMenu } from './components/ProfileMenu';
import { handleSignOut } from './components/AuthGate';
import { useCredits } from './src/lib/credits';
import { useToast } from './src/components/ui/ToastProvider';
import { AlertModal } from './src/components/ui/AlertModal';
import { TopUpModal } from './src/components/TopUpModal';
import { formatUserFacingError } from './src/utils/errors';
import { reserveAndGenerate, filesToBase64, fetchUserGenerations } from './src/lib/generateService';
import { downloadImage, downloadAll } from './src/utils/download';

const LOADING_MESSAGES = [
    "Analyzing contours...",
    "Applying texture...",
    "Lighting scene...",
    "Computing shadows...",
    "Finalizing render...",
    "Polishing..."
];

interface AppProps {
    user: AppUser;
}

export const App: React.FC<AppProps> = ({ user }) => {
    const { available: availableCredits, loading: creditsLoading, refresh: refreshCredits } = useCredits(user.uid);
    const { toast } = useToast();
    const [quotaModal, setQuotaModal] = useState(false);
    const [topUpModalOpen, setTopUpModalOpen] = useState(false);

    const [productPhotos, setProductPhotos] = useState<File[]>([]);
    const [referencePhoto, setReferencePhoto] = useState<File | null>(null);
    const [selectedPreset, setSelectedPreset] = useState<string | null>(PRESETS[0].id);
    const [aspectRatio, setAspectRatio] = useState<AspectRatio>('1:1');
    const [quality, setQuality] = useState<ImageQuality>('Standard');
    const [numImages, setNumImages] = useState<number>(2);
    const [customPrompt, setCustomPrompt] = useState<string>('');

    const [generatedImages, setGeneratedImages] = useState<Array<{ url: string; storagePath?: string; filename: string }>>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isDownloadingAll, setIsDownloadingAll] = useState(false);
    const [loadingMessage, setLoadingMessage] = useState(LOADING_MESSAGES[0]);

    // No warmup needed — Vercel functions don't have cold-start issues
    const [error, setError] = useState<string | null>(null);
    const [partialWarning, setPartialWarning] = useState<string | null>(null);

    const [styleMode, setStyleMode] = useState<'preset' | 'reference'>('preset');
    const [compositionMode, setCompositionMode] = useState<'batch' | 'group'>('batch');

    const [generateCooldown, setGenerateCooldown] = useState(false);

    // Loading message rotation
    useEffect(() => {
        let interval: any;
        if (isLoading) {
            let i = 0;
            interval = setInterval(() => {
                i = (i + 1) % LOADING_MESSAGES.length;
                setLoadingMessage(LOADING_MESSAGES[i]);
            }, 3000);
        }
        return () => clearInterval(interval);
    }, [isLoading]);

    // ── LOADING GUARD: auto-cancel after 30s to prevent infinite loading ──
    useEffect(() => {
        if (!isLoading) return;
        const guard = setTimeout(() => {
            if (isLoading) {
                console.warn('[App] loading_guard: generation exceeded 30s, forcing cancel');
                setIsLoading(false);
                toast({
                    type: 'warning',
                    title: 'Server Sibuk',
                    description: 'Server sedang sibuk, coba beberapa saat lagi.',
                });
            }
        }, 30_000);
        return () => clearTimeout(guard);
    }, [isLoading]);

    // ── LOAD GENERATION HISTORY ON MOUNT ──
    useEffect(() => {
        const loadHistory = async () => {
            if (!user?.uid) return;
            try {
                const history = await fetchUserGenerations(user.uid);
                if (history.length > 0) {
                    setGeneratedImages(history);
                }
            } catch (err) {
                console.error('[App] Failed to load generation history:', err);
            }
        };
        loadHistory();
    }, [user.uid]);

    // ── Credit gate ─────────────────────────────────────
    const noCredits = !creditsLoading && availableCredits <= 0;
    const canGenerate = !isLoading && productPhotos.length > 0 && !noCredits && availableCredits >= numImages;

    let generateHint = '';
    if (noCredits) {
        generateHint = 'Credit kamu habis. Silakan top up untuk melanjutkan.';
    } else if (!creditsLoading && availableCredits < numImages) {
        generateHint = `Need ${numImages} credits, ${availableCredits} available`;
    }

    const handleGenerate = async () => {
        if (isLoading) return;

        if (!productPhotos || productPhotos.length === 0) {
            toast({ type: 'error', title: 'Input Error', description: 'Please upload at least 1 product image.' });
            return;
        }

        // Double-check credits
        if (availableCredits <= 0) {
            toast({ type: 'error', title: 'Credit habis', description: 'Hubungi admin untuk top up (manual).' });
            setError('Credit kamu habis. Hubungi admin untuk top up (manual).');
            return;
        }

        if (availableCredits < numImages) {
            toast({ type: 'error', title: 'Credit kurang', description: `Need ${numImages} credits, ${availableCredits} available` });
            return;
        }

        setIsLoading(true);
        setError(null);
        setPartialWarning(null);
        // Tidak menghapus gambar lama agar tetap terlihat selama proses generate baru

        try {
            const productBase64 = await filesToBase64(productPhotos);
            let refBase64: string | null = null;
            if (styleMode === 'reference' && referencePhoto) {
                const refArr = await filesToBase64([referencePhoto]);
                refBase64 = refArr[0];
            }

            setLoadingMessage("Reserving credits...");

            const result = await reserveAndGenerate({
                qty: numImages,
                ratio: aspectRatio,
                preset: styleMode === 'preset' ? selectedPreset : null,
                customPrompt,
                compositionMode,
                productImages: productBase64,
                referenceImage: refBase64,
            });

            // Debug only in console
            console.log('[Flowgen] Generation result:', JSON.stringify({
                status: result.status,
                outputCount: result.outputs?.length ?? 0,
                successCount: result.successCount,
                failedCount: result.failedCount,
                error: result.error,
            }));

            // Handle outputs
            if (result.outputs && result.outputs.length > 0) {
                const fetchedOutputs = result.outputs.map((o, idx) => ({
                    url: o.downloadUrl,
                    storagePath: o.storagePath,
                    filename: `flowgen-${selectedPreset || "image"}-${Date.now()}-${idx + 1}.png`
                }));
                setGeneratedImages(fetchedOutputs.filter(o => o.url));
            }

            // Handle error statuses via toast (never dump raw text)
            if (result.status === 'FAILED') {
                const formatted = formatUserFacingError(result.error || 'Generation failed');
                toast({ type: formatted.severity, title: formatted.title, description: formatted.message });
                if (formatted.isQuota) setQuotaModal(true);
                setError(formatted.title); // single-line hint only
            } else if (result.status === 'PARTIAL') {
                toast({
                    type: 'warning',
                    title: 'Sebagian berhasil',
                    description: `${result.successCount} dari ${result.successCount + result.failedCount} gambar berhasil. ${result.failedCount} gagal \u2014 credit dikembalikan.`,
                });
                setPartialWarning(`${result.successCount} berhasil, ${result.failedCount} gagal.`);
            } else if (result.status === 'SUCCEEDED' && (!result.outputs || result.outputs.length === 0)) {
                toast({ type: 'error', title: 'Gagal generate', description: 'Tidak ada output yang dikembalikan.' });
            } else if (result.status === 'SUCCEEDED') {
                toast({ type: 'success', title: 'Berhasil!', description: `${result.successCount} gambar berhasil dibuat.`, duration: 3000 });
            }

        } catch (err: unknown) {
            console.error('[Flowgen] Error:', err);
            const formatted = formatUserFacingError(err);
            toast({ type: formatted.severity, title: formatted.title, description: formatted.message });
            if (formatted.isQuota) setQuotaModal(true);
            setError(formatted.title); // single-line hint only
        } finally {
            setIsLoading(false);
        }
    };

    const handleDownloadSingle = async (item: { url: string; storagePath?: string; filename: string }) => {
        try {
            await downloadImage(item.url, item.filename);
        } catch (err: any) {
            console.error('Download failed:', err);
            toast({ type: 'error', title: 'Download failed', description: 'Please try again.' });
        }
    };

    const handleDownloadAll = async () => {
        setIsDownloadingAll(true);
        try {
            toast({ type: 'info', title: 'Downloading...', description: 'Please wait a moment', duration: 2000 });
            await downloadAll(generatedImages);
            toast({ type: 'success', title: 'Download complete', description: 'All images saved.' });
        } catch (err: any) {
            console.error('Download All failed:', err);
            toast({ type: 'error', title: 'Download failed', description: 'Please try again.' });
        } finally {
            setIsDownloadingAll(false);
        }
    };

    return (
        <div className="min-h-screen bg-black text-white font-sans selection:bg-[#0071e3]/30">

            {/* Navbar — Apple-style 8pt grid */}
            <nav
                className="fixed top-0 left-0 right-0 z-50 bg-black/80 backdrop-blur-xl border-b border-white/[0.06]"
                style={{ height: 56, paddingInline: 16 }}
            >
                <div className="flex items-center justify-between h-full">
                    {/* Left — Logo + Title */}
                    <div className="flex items-center gap-2 min-w-0">
                        <div
                            className="flex-shrink-0 bg-white rounded-lg flex items-center justify-center"
                            style={{ width: 24, height: 24 }}
                        >
                            <svg viewBox="0 0 24 24" fill="currentColor" className="text-black" style={{ width: 15, height: 15 }}>
                                <rect x="5" y="5" width="5" height="14" />
                                <path d="M12 5V19C16.5 19 19 16 19 12C19 8 16.5 5 12 5Z" />
                            </svg>
                        </div>
                        <span
                            className="truncate text-white"
                            style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em', maxWidth: 130 }}
                        >
                            Flowgen Studio
                        </span>
                    </div>

                    {/* Right — Credit · Segmented · Avatar */}
                    <div className="flex items-center" style={{ gap: 8 }}>

                        {/* Credit Pill */}
                        {!creditsLoading && (
                            <div
                                className="flex items-center"
                                style={{
                                    height: 32,
                                    paddingInline: 12,
                                    borderRadius: 9999,
                                    gap: 6,
                                    background: 'rgba(255,255,255,0.06)',
                                    border: '1px solid rgba(255,255,255,0.08)',
                                }}
                            >
                                <span style={{ fontSize: 13, lineHeight: 1 }}>⚡</span>
                                <span style={{ fontSize: 13, fontWeight: 500, color: '#fff' }}>{availableCredits}</span>
                            </div>
                        )}

                        {/* Segmented Control */}
                        <div
                            className="flex"
                            style={{
                                height: 32,
                                padding: 2,
                                borderRadius: 9999,
                                background: 'rgba(255,255,255,0.06)',
                                border: '1px solid rgba(255,255,255,0.08)',
                            }}
                        >
                            <button
                                onClick={() => setQuality('Standard')}
                                className="flex items-center justify-center whitespace-nowrap transition-all"
                                style={{
                                    height: 28,
                                    paddingInline: 14,
                                    borderRadius: 9999,
                                    fontSize: 13,
                                    fontWeight: 500,
                                    minWidth: 32,
                                    background: quality === 'Standard' ? 'rgba(255,255,255,0.14)' : 'transparent',
                                    color: '#fff',
                                    opacity: quality === 'Standard' ? 1 : 0.6,
                                    border: 'none',
                                    cursor: 'pointer',
                                }}
                            >
                                Standard
                            </button>
                            <button
                                onClick={() => setQuality('High Quality')}
                                className="flex items-center justify-center whitespace-nowrap transition-all"
                                style={{
                                    height: 28,
                                    paddingInline: 14,
                                    borderRadius: 9999,
                                    fontSize: 13,
                                    fontWeight: 500,
                                    minWidth: 32,
                                    background: quality === 'High Quality' ? 'rgba(255,255,255,0.14)' : 'transparent',
                                    color: '#fff',
                                    opacity: quality === 'High Quality' ? 1 : 0.6,
                                    border: 'none',
                                    cursor: 'pointer',
                                }}
                            >
                                HQ
                            </button>
                        </div>

                        {/* Profile Menu */}
                        <ProfileMenu
                            user={user}
                            credits={availableCredits}
                            creditsLoading={creditsLoading}
                            onSignOut={handleSignOut}
                            onTopUp={() => setTopUpModalOpen(true)}
                        />
                    </div>
                </div>
            </nav>

            {/* Main Layout */}
            <div className="pt-20 pb-12 px-6 max-w-[1600px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">

                {/* Left Panel: Controls */}
                <aside className="lg:col-span-4 flex flex-col gap-6">

                    {/* 1. Import Section */}
                    <div className="bg-[#1c1c1e] rounded-2xl p-5 border border-white/5">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-sm font-semibold text-gray-200 uppercase tracking-wider opacity-80">Import</h2>

                            <div className="flex bg-black/50 rounded-lg p-0.5 border border-white/5">
                                <button
                                    onClick={() => setCompositionMode('batch')}
                                    disabled={isLoading}
                                    className={`px-3 py-1 rounded-[6px] text-[11px] font-medium transition-all ${compositionMode === 'batch' ? 'bg-[#636366] text-white shadow-sm' : 'text-gray-500 hover:text-gray-300'}`}
                                >
                                    Batch
                                </button>
                                <button
                                    onClick={() => setCompositionMode('group')}
                                    disabled={isLoading}
                                    className={`px-3 py-1 rounded-[6px] text-[11px] font-medium transition-all ${compositionMode === 'group' ? 'bg-[#636366] text-white shadow-sm' : 'text-gray-500 hover:text-gray-300'}`}
                                >
                                    Group
                                </button>
                            </div>
                        </div>

                        <FileUpload
                            files={productPhotos}
                            onFilesChange={setProductPhotos}
                            maxFiles={10}
                            id="product-upload"
                            note={compositionMode === 'group' ? "Combine items into one scene." : "Process items individually."}
                        />
                    </div>

                    {/* 2. Styling Section */}
                    <div className="bg-[#1c1c1e] rounded-2xl p-5 border border-white/5">
                        <div className="flex items-center gap-4 mb-5 border-b border-white/5 pb-3">
                            <button
                                onClick={() => setStyleMode('preset')}
                                disabled={isLoading}
                                className={`text-sm font-semibold transition-colors ${styleMode === 'preset' ? 'text-white' : 'text-gray-500 hover:text-gray-300'}`}
                            >
                                Presets
                            </button>
                            <button
                                onClick={() => setStyleMode('reference')}
                                disabled={isLoading}
                                className={`text-sm font-semibold transition-colors ${styleMode === 'reference' ? 'text-white' : 'text-gray-500 hover:text-gray-300'}`}
                            >
                                Reference
                            </button>
                        </div>

                        {styleMode === 'preset' ? (
                            <div className="grid grid-cols-2 gap-2">
                                {PRESETS.map(preset => (
                                    <StylePresetCard
                                        key={preset.id}
                                        preset={preset}
                                        isSelected={selectedPreset === preset.id}
                                        onSelect={setSelectedPreset}
                                        disabled={isLoading}
                                    />
                                ))}
                            </div>
                        ) : (
                            <div>
                                <FileUpload
                                    files={referencePhoto ? [referencePhoto] : []}
                                    onFilesChange={(files) => setReferencePhoto(files[0] || null)}
                                    maxFiles={1}
                                    id="ref-upload"
                                    title="Reference Image"
                                    className="aspect-square"
                                />
                            </div>
                        )}
                    </div>

                    {/* 3. Output Settings */}
                    <div className="bg-[#1c1c1e] rounded-2xl p-5 border border-white/5 space-y-5">

                        <div>
                            <label className="text-[11px] font-semibold text-gray-500 uppercase mb-2 block">Aspect Ratio</label>
                            <div className="grid grid-cols-4 gap-2">
                                {(['1:1', '4:5', '9:16', '16:9'] as AspectRatio[]).map((ratio) => (
                                    <button
                                        key={ratio}
                                        onClick={() => setAspectRatio(ratio)}
                                        disabled={isLoading}
                                        className={`py-2 rounded-lg text-xs font-medium transition-all ${aspectRatio === ratio
                                            ? 'bg-[#0071e3] text-white shadow-lg shadow-blue-500/20'
                                            : 'bg-[#2c2c2e] text-gray-400 hover:text-white hover:bg-[#3a3a3c]'
                                            }`}
                                    >
                                        {ratio}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div>
                            <label className="text-[11px] font-semibold text-gray-500 uppercase mb-2 block">Quantity</label>
                            <div className="grid grid-cols-4 gap-2">
                                {[1, 2, 3, 4].map((num) => (
                                    <button
                                        key={num}
                                        onClick={() => setNumImages(num)}
                                        disabled={isLoading}
                                        className={`py-2 rounded-lg text-xs font-medium transition-all ${numImages === num
                                            ? 'bg-[#0071e3] text-white shadow-lg shadow-blue-500/20'
                                            : 'bg-[#2c2c2e] text-gray-400 hover:text-white hover:bg-[#3a3a3c]'
                                            }`}
                                    >
                                        {num}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div>
                            <label className="text-[11px] font-semibold text-gray-500 uppercase mb-2 block">Custom Instructions</label>
                            <textarea
                                className="w-full bg-[#2c2c2e] text-white text-sm rounded-lg p-3 border-none focus:ring-1 focus:ring-[#0071e3] outline-none resize-none h-20 placeholder:text-gray-600"
                                placeholder="E.g. Soft morning light, marble surface..."
                                value={customPrompt}
                                onChange={(e) => setCustomPrompt(e.target.value)}
                                disabled={isLoading}
                            />
                        </div>

                        <button
                            onClick={handleGenerate}
                            disabled={!canGenerate}
                            className={`w-full py-3.5 rounded-xl font-medium text-[15px] transition-all flex items-center justify-center gap-2
                        ${!canGenerate
                                    ? 'bg-[#2c2c2e] text-gray-500 cursor-not-allowed'
                                    : 'bg-white text-black hover:bg-gray-200 active:scale-[0.98]'
                                }`}
                        >
                            {isLoading ? (
                                <>
                                    <Icon icon="spinner" className="w-4 h-4 animate-spin text-gray-500" />
                                    <span>Processing...</span>
                                </>
                            ) : (
                                <>
                                    <span>Generate</span>
                                    <Icon icon="magic" className="w-4 h-4" />
                                </>
                            )}
                        </button>

                        {/* Hints */}
                        {generateHint && !isLoading && (
                            <p className="text-[11px] text-gray-500 text-center">{generateHint}</p>
                        )}

                        {partialWarning && (
                            <p className="text-[11px] text-yellow-400/80 text-center">{partialWarning}</p>
                        )}

                        {error && (
                            <p className="text-[11px] text-red-400/80 text-center">{error}</p>
                        )}
                    </div>

                </aside>

                {/* Right Panel: Showcase */}
                <main className="lg:col-span-8 flex flex-col gap-4">
                    <div className="bg-[#1c1c1e] rounded-3xl border border-white/5 relative min-h-[600px] flex flex-col">

                        <div className="absolute top-0 left-0 right-0 p-4 flex justify-between items-center z-10 bg-gradient-to-b from-[#1c1c1e] to-transparent rounded-t-3xl">
                            <h2 className="text-sm font-semibold text-gray-400 pl-2">Showcase</h2>
                            {generatedImages.length > 0 && (
                                <button
                                    onClick={handleDownloadAll}
                                    disabled={isDownloadingAll}
                                    className={`text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${isDownloadingAll
                                        ? 'text-gray-400 bg-[#2c2c2e] cursor-not-allowed'
                                        : 'text-[#0071e3] hover:text-[#409cff] bg-[#0071e3]/10'
                                        }`}
                                >
                                    {isDownloadingAll ? 'Downloading...' : 'Download All'}
                                </button>
                            )}
                        </div>

                        <div className="p-4 pt-14 flex-1">
                            {generatedImages.length > 0 ? (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {generatedImages.map((imgObj, idx) => (
                                        <div key={idx} className="group relative rounded-2xl overflow-hidden bg-black aspect-[4/5] shadow-2xl">
                                            <img src={imgObj.url} alt={`Result ${idx}`} className="w-full h-full object-cover" />
                                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                                                <button
                                                    onClick={() => handleDownloadSingle(imgObj)}
                                                    className="bg-white/90 text-black px-4 py-2 rounded-full text-sm font-medium hover:scale-105 transition-transform backdrop-blur-md"
                                                >
                                                    Save
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="h-full min-h-[500px] flex flex-col items-center justify-center text-center opacity-40">
                                    {isLoading ? (
                                        <div className="flex flex-col items-center">
                                            <div className="w-12 h-12 border-2 border-[#0071e3] border-t-transparent rounded-full animate-spin mb-4"></div>
                                            <p className="text-sm font-medium text-gray-300">{loadingMessage}</p>
                                        </div>
                                    ) : (
                                        <>
                                            <Icon icon="photo" className="w-16 h-16 text-gray-600 mb-4" />
                                            <p className="text-sm font-medium text-gray-500">No output generated yet.</p>
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>

                    <footer className="mt-4 flex justify-between items-center text-[10px] text-gray-600 px-2 pb-8">
                        <span>Flowgen Studio v2.0</span>
                        <span>Powered by OpenRouter</span>
                    </footer>
                </main>
            </div>

            {/* Quota exceeded modal */}
            <AlertModal
                open={quotaModal}
                onClose={() => setQuotaModal(false)}
                title="Limit penggunaan tercapai"
                message="Kuota generate untuk saat ini habis. Coba lagi beberapa menit lagi, atau upgrade billing jika ingin tanpa limit."
                learnMoreUrl="https://ai.google.dev/pricing"
            />

            {/* Top Up Modal */}
            <TopUpModal
                isOpen={topUpModalOpen}
                onClose={() => setTopUpModalOpen(false)}
                currentCredits={availableCredits}
                onSuccess={refreshCredits}
            />
        </div>
    );
};
