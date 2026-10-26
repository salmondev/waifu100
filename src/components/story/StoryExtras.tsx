"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, Loader2, Sparkles } from "lucide-react";
import type { StoryItem } from "@/lib/share-schema";
import type { TitleStyle } from "@/lib/story/config";
import type { AnalysisResult, VerdictFeedback } from "@/types";
import { StoryAnalysisModal } from "@/components/story/StoryAnalysisModal";
import { cn } from "@/lib/utils";
import { downloadBlob, exportStoryPng } from "@/lib/story/export";
import { storyVerdictTitles } from "@/lib/story/verdict-titles";
import { loadLocalVerdict, requestStoryVerdict, saveLocalVerdict, seedStoryVerdict, storyVerdictSig, voteStoryVerdict } from "@/lib/story/verdict-client";
import { useMyGrids } from "@/lib/my-grids";

const btn = "px-3 py-1.5 rounded-lg text-sm bg-zinc-900 border border-zinc-800 hover:border-purple-500/60 inline-flex items-center gap-1 disabled:opacity-50";

/** PNG download (item 2). */
export function StoryPngButton({ title, items, titleStyle, cols, className, label = "Save PNG" }: { title: string; items: (StoryItem | null)[]; titleStyle?: TitleStyle; cols?: number | null; className?: string; label?: string }) {
    const [busy, setBusy] = useState(false);
    return (
        <button
            type="button"
            className={className ?? btn}
            disabled={busy || !items.some(Boolean)}
            onClick={async () => {
                setBusy(true);
                const blob = await exportStoryPng(title, items, titleStyle, cols).catch(() => null);
                setBusy(false);
                if (blob) downloadBlob(blob, `${(title || "story100").replace(/[^\w-]+/g, "_").slice(0, 40)}.png`);
            }}
        >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} {label}
        </button>
    );
}

const titlesOf = storyVerdictTitles;

/**
 * Builder trigger, like waifu's "Ask AI About My Taste": disabled under 2 titles, opens the verdict
 * modal (which analyses on open when there is no verdict yet).
 *
 * Generated once: the verdict and the vote are remembered on this device for this exact board
 * (lib/story/verdict-client.ts), so reopening - or reloading the page - shows the same verdict
 * without another AI call. Only a "disagree" vote makes the next open generate a new one.
 * (Waifu's builder also re-runs after an "agree"; story deliberately does not.)
 */
export function StoryVerdict({ items, className, label = "Ask AI About My Taste", gridTitle }: { items: (StoryItem | null)[]; className?: string; label?: string; gridTitle?: string }) {
    const titles = titlesOf(items);
    const sig = storyVerdictSig(titles);
    const [open, setOpen] = useState(false);
    const [verdict, setVerdict] = useState<AnalysisResult | null>(null);
    const [feedback, setFeedback] = useState<VerdictFeedback>(null);
    const [unavailable, setUnavailable] = useState(false);
    // Restore after mount (not during render: the server has no localStorage) and whenever the board changes.
    useEffect(() => {
        const local = loadLocalVerdict(titles);
        // eslint-disable-next-line react-hooks/set-state-in-effect -- existing effect-driven state sync; refactoring would change render timing
        setVerdict(local?.verdict ?? null);
        setFeedback(local?.feedback ?? null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sig]);
    const onResult = (v: AnalysisResult | null) => {
        setVerdict(v);
        if (v) {
            setFeedback(null);
            saveLocalVerdict(titles, v, null);
        }
    };
    const onFeedback = (f: VerdictFeedback) => {
        setFeedback(f);
        if (verdict) saveLocalVerdict(titles, verdict, f);
    };
    if (unavailable) return null;
    return (
        <>
            <button
                type="button"
                data-testid="story-verdict"
                className={className ?? btn}
                disabled={titles.length < 2}
                onClick={() => {
                    if (feedback === "disagree") {
                        setVerdict(null);
                        setFeedback(null);
                    }
                    setOpen(true);
                }}
            >
                <Sparkles className="w-4 h-4 group-hover:rotate-12 transition-transform" /> {label}
            </button>
            {/* Portalled: the builder's left footer has backdrop-blur, which would trap a fixed overlay inside it. */}
            {open && createPortal(<StoryAnalysisModal isOpen onClose={() => setOpen(false)} titles={titles} result={verdict} onResult={onResult} feedback={feedback} onFeedback={onFeedback} gridTitle={gridTitle} onUnavailable={() => setUnavailable(true)} />, document.body)}
        </>
    );
}

const VIEW_VERDICT_BTN = "flex flex-1 lg:flex-none items-center gap-2 px-3 sm:px-4 py-2 rounded-lg border transition-all duration-200 font-medium text-sm sm:text-base lg:min-w-[140px] justify-center";

/**
 * View-page trigger, like waifu's ViewGrid header button: "✨ Generate AI Verdict" runs the analysis
 * in the button ("Generating..."), then opens the modal; afterwards it reads "AI Verdict".
 *
 * Like waifu, the verdict belongs to the share: the page renders the stored one (no request), and a
 * grid without one generates it ONCE via /api/story/verdict, which stores it for every later visitor.
 * The owner's builder verdict for the same board is carried over on first visit (no AI call).
 * Visitors get the read-only modal (copy / save / share). The grid's owner can also vote; after a
 * "disagree" the next press regenerates (server-side, owner only).
 */
export function StoryViewVerdict({ shareId, items, sharePath, gridTitle, initialVerdict = null, initialFeedback = null }: { shareId: string; items: (StoryItem | null)[]; sharePath?: string; gridTitle?: string; initialVerdict?: AnalysisResult | null; initialFeedback?: VerdictFeedback }) {
    const titles = titlesOf(items);
    const isOwner = useMyGrids().some((g) => g.id === shareId);
    const [show, setShow] = useState(false);
    const [verdict, setVerdict] = useState<AnalysisResult | null>(initialVerdict);
    const [feedback, setFeedback] = useState<VerdictFeedback>(initialFeedback);
    const [generating, setGenerating] = useState(false);
    const [unavailable, setUnavailable] = useState(false);
    const inflight = useRef(false);
    // The owner's builder verdict for this exact board, when the share has none yet: show it and
    // carry it onto the share (waifu sends it inside the share payload) - no second AI call.
    const seeded = useRef(false);
    useEffect(() => {
        if (!isOwner || verdict || seeded.current) return;
        const local = loadLocalVerdict(titles);
        if (!local || local.feedback === "disagree") return;
        seeded.current = true;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- existing effect-driven state sync; refactoring would change render timing
        setVerdict(local.verdict);
        setFeedback(local.feedback);
        void seedStoryVerdict(shareId, titles);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOwner]);
    if (unavailable && !verdict) return null;
    const click = async () => {
        const regenerate = isOwner && feedback === "disagree";
        if (verdict && !regenerate) {
            setShow(true);
            return;
        }
        if (titles.length === 0 || inflight.current) return;
        inflight.current = true;
        setGenerating(true);
        try {
            const r = await requestStoryVerdict(shareId);
            if (!r.ok) {
                if (r.unavailable) setUnavailable(true);
                else console.error("Failed to generate verdict");
                return;
            }
            setVerdict(r.verdict);
            setFeedback(r.feedback);
            setShow(true);
        } catch (e) {
            console.error("Failed to generate verdict:", e);
        } finally {
            inflight.current = false;
            setGenerating(false);
        }
    };
    const vote = (f: VerdictFeedback) => {
        setFeedback(f);
        void voteStoryVerdict(shareId, f);
    };
    return (
        <>
            <button
                type="button"
                data-testid="story-verdict"
                onClick={click}
                disabled={generating}
                className={cn(
                    VIEW_VERDICT_BTN,
                    verdict ? "bg-yellow-500/10 text-yellow-500 hover:bg-yellow-500/20 border-yellow-500/20" : "bg-gradient-to-r from-yellow-600/20 to-orange-600/20 text-yellow-500 border-yellow-600/30 hover:from-yellow-600/30 hover:to-orange-600/30",
                    generating && "opacity-70 cursor-wait"
                )}
            >
                {generating ? <Loader2 size={18} className="animate-spin shrink-0" /> : <Sparkles size={18} className="shrink-0" />}
                <span className="truncate">{generating ? "Generating..." : verdict ? (isOwner && feedback === "disagree" ? "New AI Verdict" : "AI Verdict") : "✨ Generate AI Verdict"}</span>
            </button>
            <StoryAnalysisModal isOpen={show} onClose={() => setShow(false)} titles={titles} result={verdict} onResult={() => {}} feedback={feedback} onFeedback={vote} readonly={!isOwner} shareUrl={show && sharePath ? `${window.location.origin}${sharePath}` : undefined} gridTitle={gridTitle} />
        </>
    );
}

