"use client";

import { useEffect, useRef, useState } from "react";
import { X, Copy, Check, Twitter, Link as LinkIcon, AlertCircle, Loader2, Share2, ExternalLink } from "lucide-react";
import NextLink from "next/link";
import { cn } from "@/lib/utils";
import { SHARE_TITLE_MAX, STORY_BRAND } from "@/lib/story/config";

/**
 * Story100 share modal: a copy of waifu's ShareModal (src/components/share/ShareModal.tsx)
 * - same layout, copy, buttons and loading / error / result states - kept separate so
 * waifu's file stays untouched. The title is only trimmed here; the server
 * (share-service cleanTitle, SHARE_TITLE_MAX) is what validates it.
 */
export interface StoryShareResult { id?: string; viewPath?: string; error?: string }

interface Props {
    isOpen: boolean;
    onClose: () => void;
    hasItems: boolean;
    initialTitle?: string;
    onTitleUpdate?: (title: string) => void;
    onShare: (title: string) => Promise<StoryShareResult>;
}

export const STORY_DEFAULT_SHARE_TITLE = `My ${STORY_BRAND} Grid`;

export function StoryShareModal({ isOpen, onClose, hasItems, initialTitle, onTitleUpdate, onShare }: Props) {
    const [step, setStep] = useState<"customize" | "result">("customize");
    const [customTitle, setCustomTitle] = useState("");
    const [url, setUrl] = useState("");
    const [viewPath, setViewPath] = useState("");
    const [copied, setCopied] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [loadingState, setLoadingState] = useState("");

    // Seed when the modal OPENS (same fix as waifu's modal).
    const wasOpen = useRef(false);
    // In-flight guard: state updates are async, so rapid Enter/clicks could pass an isLoading check twice.
    const inFlight = useRef(false);
    useEffect(() => {
        if (isOpen && !wasOpen.current) {
            setStep("customize");
            setCustomTitle(initialTitle || STORY_DEFAULT_SHARE_TITLE);
            setUrl("");
            setError(null);
            setLoadingState("");
        }
        wasOpen.current = isOpen;
    }, [isOpen, initialTitle]);

    const handleGenerateLink = async () => {
        if (!hasItems) return setError("Go add some titles first!");
        if (!customTitle.trim()) return setError("Please enter a title for your grid.");
        if (inFlight.current) return;
        inFlight.current = true;
        setIsLoading(true);
        setError(null);
        setLoadingState("Saving...");
        try {
            onTitleUpdate?.(customTitle.trim());
            const r = await onShare(customTitle.trim());
            if (!r.id || !r.viewPath) throw new Error(r.error || "");
            setViewPath(r.viewPath);
            setUrl(`${window.location.origin}${r.viewPath}`);
            setStep("result");
        } catch (e) {
            setError((e instanceof Error && e.message) || "Failed to create share link. Try again.");
        } finally {
            inFlight.current = false;
            setIsLoading(false);
            setLoadingState("");
        }
    };

    const handleCopy = () => {
        if (!url) return;
        void navigator.clipboard?.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const socialShare = () => {
        if (!url) return;
        const text = encodeURIComponent(`Check out my "${customTitle}" grid!`);
        window.open(`https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${text}&hashtags=${STORY_BRAND}`, "_blank", "width=600,height=400");
    };

    if (!isOpen) return null;

    return (
        <div role="dialog" aria-modal="true" aria-label="Share Your Grid" className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="w-full max-w-xl bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl relative overflow-hidden animate-in zoom-in-95 duration-200">
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-purple-500 via-pink-500 to-orange-500" />
                <button type="button" aria-label="Close" onClick={onClose} disabled={isLoading} className="absolute top-4 right-4 text-zinc-500 hover:text-white transition-colors p-2 rounded-full hover:bg-zinc-800 disabled:opacity-50">
                    <X size={20} />
                </button>
                <div className="p-6 pt-8 text-center">
                    <div className="inline-flex items-center justify-center p-3 bg-zinc-800 rounded-full mb-4 shadow-inner">
                        <Share2 className="w-6 h-6 text-pink-500" />
                    </div>
                    <h2 className="text-2xl font-bold bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent mb-2">Share Your Grid</h2>
                    {step === "customize" ? (
                        <>
                            <p className="text-zinc-500 text-sm mb-6">Name your grid to create a clean, shareable link.</p>
                            <div className="space-y-4">
                                <div className="text-left">
                                    <label htmlFor="story-share-title" className="text-xs font-bold text-zinc-400 uppercase tracking-wider ml-1">Grid Title</label>
                                    <input
                                        id="story-share-title"
                                        type="text"
                                        value={customTitle}
                                        onChange={(e) => setCustomTitle(e.target.value)}
                                        onKeyDown={(e) => { if (e.key === "Enter" && !isLoading) void handleGenerateLink(); }}
                                        maxLength={SHARE_TITLE_MAX}
                                        className="w-full mt-1 bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-pink-500 placeholder-zinc-600 transition-all"
                                        placeholder="e.g. My Top 10 Anime"
                                        autoFocus
                                    />
                                </div>
                                {error && (
                                    <div role="alert" className="p-3 bg-red-900/20 text-red-400 rounded-xl text-sm flex items-center gap-2 border border-red-900/50">
                                        <AlertCircle size={16} />
                                        {error}
                                    </div>
                                )}
                                <button type="button" onClick={handleGenerateLink} disabled={isLoading} className="w-full py-3 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 rounded-xl font-bold text-white hover:scale-[1.02] transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:hover:scale-100 shadow-lg shadow-pink-900/20">
                                    {isLoading ? <Loader2 className="animate-spin w-4 h-4" /> : <LinkIcon className="w-4 h-4" />}
                                    {isLoading ? loadingState || "Generating..." : "Generate Link"}
                                </button>
                            </div>
                        </>
                    ) : (
                        <>
                            <p className="text-zinc-500 text-sm mb-6">Your clean link is ready!</p>
                            <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-3 flex items-center gap-2 relative group mb-6 text-left">
                                <div className="flex-1 overflow-hidden">
                                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-0.5">Your Link</p>
                                    <p className="text-base text-pink-400 font-mono truncate" data-testid="share-url">{url}</p>
                                </div>
                                <button type="button" onClick={handleCopy} className={cn("py-2 px-4 rounded-lg transition-all font-medium flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-white shrink-0 text-sm text-nowrap", copied && "bg-green-500/20 text-green-400")} title="Copy Link">
                                    {copied ? <Check size={16} /> : <Copy size={16} />}
                                    {copied ? "Copied" : "Copy Link"}
                                </button>
                            </div>
                            <div className="grid grid-cols-1 gap-3">
                                <button type="button" onClick={socialShare} className="flex items-center justify-between px-6 bg-black hover:bg-zinc-800 border border-zinc-800 text-white py-4 rounded-xl transition-colors font-bold text-lg hover:border-zinc-600 shadow-lg shadow-blue-500/10 group">
                                    <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current text-white" aria-hidden="true">
                                        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                                    </svg>
                                    <span>Post on X</span>
                                    <Twitter size={24} className="text-[#1D9BF0] group-hover:scale-110 transition-transform" />
                                </button>
                                {/* Story extra: the builder used to jump to the view page after sharing. */}
                                <NextLink href={viewPath} className="flex items-center justify-center gap-2 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-sm font-medium">
                                    <ExternalLink className="w-4 h-4" /> View your grid
                                </NextLink>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
