"use client";

import { AlertCircle, Check, Info, Lightbulb, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Story copies of waifu's builder popups (src/app/page.tsx): the toast, the "Found them!" search
 * hint, the AI Suggestions hint and the "Did you know?" hint. Same classes; only the wording says
 * "titles" where waifu says "characters".
 */
export type NoticeType = "success" | "error" | "info";

export function StoryToast({ message, type }: { message: string; type: NoticeType }) {
    return (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] animate-in slide-in-from-bottom-5 fade-in duration-300">
            <div
                role="status"
                data-testid="notice"
                data-type={type}
                className={cn(
                    "flex items-center gap-3 px-6 py-3 rounded-full shadow-2xl backdrop-blur-md border",
                    type === "success" ? "bg-green-950/80 border-green-500/50 text-green-200" : type === "error" ? "bg-red-950/80 border-red-500/50 text-red-200" : "bg-zinc-800/80 border-zinc-700/50 text-zinc-200"
                )}
            >
                {type === "success" && <Check className="w-5 h-5 text-green-500" />}
                {type === "error" && <AlertCircle className="w-5 h-5 text-red-500" />}
                {type === "info" && <Info className="w-5 h-5 text-blue-400" />}
                <span className="font-medium text-sm">{message}</span>
            </div>
        </div>
    );
}

/**
 * Waifu: desktop only (hidden below lg, as in waifu), next to the sidebar, after the first results of
 * the session. Waifu pins it at top-24; story's search input is taller, so that put the arrow on the gap
 * above the results. Here the arrow is centred on the first result row (`anchor`), measured when the
 * hint mounts; top-24 stays as the fallback.
 */
export function SearchHint({ onClose, anchor }: { onClose: () => void; anchor?: () => Element | null }) {
    const place = (el: HTMLDivElement | null) => {
        const a = el && anchor?.();
        if (!el || !a) return;
        const r = a.getBoundingClientRect();
        const side = a.closest("aside")?.getBoundingClientRect();
        el.style.top = `${Math.round(r.top + r.height / 2)}px`;
        el.style.transform = "translateY(-50%)";
        if (side) el.style.left = `${Math.round(side.right)}px`;
    };
    return (
        <div ref={place} data-testid="search-hint" className="hidden lg:flex fixed left-80 top-24 z-50 animate-in slide-in-from-left-2 fade-in duration-300 ml-1">
            <div className="flex items-center">
                <div className="w-0 h-0 border-t-[8px] border-t-transparent border-b-[8px] border-b-transparent border-r-[12px] border-r-pink-600"></div>
                <div className="bg-gradient-to-r from-pink-600 to-purple-600 rounded-lg shadow-xl p-4 w-60 text-white relative">
                    <h4 className="font-bold text-sm mb-1 flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-yellow-300 animate-pulse" />
                        Found them!
                    </h4>
                    <p className="text-xs text-pink-100 leading-snug">Click them to see more images.</p>
                    <button type="button" aria-label="Close hint" onClick={onClose} className="absolute top-2 right-2 text-pink-200 hover:text-white">
                        <X className="w-3 h-3" />
                    </button>
                </div>
            </div>
        </div>
    );
}

export function AISuggestionHint({ onTry, onClose }: { onTry: () => void; onClose: () => void }) {
    return (
        <div data-testid="ai-hint" className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[90] animate-in slide-in-from-bottom-5 fade-in duration-500">
            <div className="relative group">
                <div className="absolute -inset-0.5 bg-gradient-to-r from-purple-600 to-indigo-600 rounded-lg blur opacity-75 group-hover:opacity-100 transition duration-1000 group-hover:duration-200 animate-tilt"></div>
                <div className="relative flex items-center gap-4 px-6 py-4 bg-zinc-900 rounded-lg leading-none">
                    <div className="p-2 bg-zinc-800 rounded-full text-purple-500 animate-pulse">
                        <Sparkles className="w-5 h-5" />
                    </div>
                    <div className="text-left">
                        <h4 className="text-zinc-100 font-bold text-sm mb-1">Looking for more titles?</h4>
                        <p className="text-zinc-400 text-xs">Try the <span className="text-purple-400 font-medium">AI Suggestions</span> tab!</p>
                    </div>
                    <button type="button" onClick={onTry} className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white text-xs font-medium rounded-lg transition-colors">Try it</button>
                    <button type="button" aria-label="Close hint" onClick={onClose} className="p-1 hover:bg-zinc-800 rounded-full text-zinc-500 hover:text-white transition-colors">
                        <X className="w-4 h-4" />
                    </button>
                </div>
            </div>
        </div>
    );
}

export function ChangeImageHint({ onClose }: { onClose: () => void }) {
    return (
        <div data-testid="image-hint" className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[90] animate-in slide-in-from-bottom-5 fade-in duration-500">
            <div className="relative group">
                <div className="absolute -inset-0.5 bg-gradient-to-r from-pink-600 to-purple-600 rounded-lg blur opacity-75 group-hover:opacity-100 transition duration-1000 group-hover:duration-200 animate-tilt"></div>
                <div className="relative flex items-center gap-4 px-6 py-4 bg-zinc-900 rounded-lg leading-none">
                    <div className="p-2 bg-zinc-800 rounded-full text-pink-500 animate-bounce">
                        <Lightbulb className="w-5 h-5" />
                    </div>
                    <div className="text-left">
                        <h4 className="text-zinc-100 font-bold text-sm mb-1">Did you know?</h4>
                        <p className="text-zinc-400 text-xs">Click any title on the grid to change its image!</p>
                    </div>
                    <button type="button" aria-label="Close hint" onClick={onClose} className="p-1 hover:bg-zinc-800 rounded-full text-zinc-500 hover:text-white transition-colors ml-2">
                        <X className="w-4 h-4" />
                    </button>
                </div>
            </div>
        </div>
    );
}
