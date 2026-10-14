"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { friendlyError } from "@/lib/public-errors";
import Link from "next/link";
import { Download, GitCompareArrows, Loader2, Sparkles } from "lucide-react";
import type { StoryItem } from "@/lib/share-schema";
import type { TitleStyle } from "@/lib/story/config";
import type { AnalysisResult, VerdictFeedback } from "@/types";
import { StoryAnalysisModal } from "@/components/story/StoryAnalysisModal";
import { cn } from "@/lib/utils";
import { downloadBlob, exportStoryPng } from "@/lib/story/export";
import { storyComparePath } from "@/lib/story/compare";
import { useMyGrids } from "@/lib/my-grids";

const btn = "px-3 py-1.5 rounded-lg text-sm bg-zinc-900 border border-zinc-800 hover:border-purple-500/60 inline-flex items-center gap-1 disabled:opacity-50";

/** PNG download (item 2). */
export function StoryPngButton({ title, items, titleStyle, className, label = "Save PNG" }: { title: string; items: (StoryItem | null)[]; titleStyle?: TitleStyle; className?: string; label?: string }) {
    const [busy, setBusy] = useState(false);
    return (
        <button
            type="button"
            className={className ?? btn}
            disabled={busy || !items.some(Boolean)}
            onClick={async () => {
                setBusy(true);
                const blob = await exportStoryPng(title, items, titleStyle).catch(() => null);
                setBusy(false);
                if (blob) downloadBlob(blob, `${(title || "story100").replace(/[^\w-]+/g, "_").slice(0, 40)}.png`);
            }}
        >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} {label}
        </button>
    );
}

/** AI verdict for a story grid (C). Not stored; uses the shared Gemini quota. */
const titlesOf = (items: (StoryItem | null)[]) => items.filter((x): x is StoryItem => !!x).map((x) => `${x.title} (${x.type === "MANGA" ? "manga" : "anime"})`);

/**
 * Builder trigger, like waifu's "Ask AI About My Taste": disabled under 2 titles, opens the verdict
 * modal (which analyses on open); a rated verdict is re-run on the next open, as in waifu.
 */
export function StoryVerdict({ items, className, label = "Ask AI About My Taste", gridTitle }: { items: (StoryItem | null)[]; className?: string; label?: string; gridTitle?: string }) {
    const titles = titlesOf(items);
    const [open, setOpen] = useState(false);
    const [verdict, setVerdict] = useState<AnalysisResult | null>(null);
    const [feedback, setFeedback] = useState<VerdictFeedback>(null);
    const [unavailable, setUnavailable] = useState(false);
    if (unavailable) return null;
    return (
        <>
            <button
                type="button"
                data-testid="story-verdict"
                className={className ?? btn}
                disabled={titles.length < 2}
                onClick={() => {
                    if (feedback) {
                        setVerdict(null);
                        setFeedback(null);
                    }
                    setOpen(true);
                }}
            >
                <Sparkles className="w-4 h-4 group-hover:rotate-12 transition-transform" /> {label}
            </button>
            {/* Portalled: the builder's left footer has backdrop-blur, which would trap a fixed overlay inside it. */}
            {open && createPortal(<StoryAnalysisModal isOpen onClose={() => setOpen(false)} titles={titles} result={verdict} onResult={setVerdict} feedback={feedback} onFeedback={setFeedback} gridTitle={gridTitle} onUnavailable={() => setUnavailable(true)} />, document.body)}
        </>
    );
}

const VIEW_VERDICT_BTN = "flex flex-1 lg:flex-none items-center gap-2 px-3 sm:px-4 py-2 rounded-lg border transition-all duration-200 font-medium text-sm sm:text-base lg:min-w-[140px] justify-center";

/**
 * View-page trigger, like waifu's ViewGrid header button: "✨ Generate AI Verdict" runs the analysis
 * in the button ("Generating..."), then opens the read-only modal; afterwards it reads "AI Verdict".
 * The share link is the clean origin + path (never the visitor's query string), as in waifu.
 * Like waifu, a failed run only logs. Unlike waifu nothing is saved back (story verdicts are not
 * stored on the share, and this page must not write).
 */
export function StoryViewVerdict({ items, sharePath, gridTitle }: { items: (StoryItem | null)[]; sharePath?: string; gridTitle?: string }) {
    const titles = titlesOf(items);
    const [show, setShow] = useState(false);
    const [verdict, setVerdict] = useState<AnalysisResult | null>(null);
    const [generating, setGenerating] = useState(false);
    const [unavailable, setUnavailable] = useState(false);
    if (unavailable) return null;
    const click = async () => {
        if (verdict) {
            setShow(true);
            return;
        }
        if (titles.length === 0) return;
        setGenerating(true);
        try {
            const res = await fetch("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ characterNames: titles, kind: "story" }) });
            if (!res.ok) {
                const code = res.status === 403 ? "off" : ((await res.json().catch(() => ({}))) as { code?: string }).code;
                if (code === "off" || code === "ai_unavailable") {
                    setUnavailable(true);
                    return;
                }
                throw new Error("Failed to analyze");
            }
            setVerdict(await res.json());
            setShow(true);
        } catch (e) {
            console.error("Failed to generate verdict:", e);
        } finally {
            setGenerating(false);
        }
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
                <span className="truncate">{generating ? "Generating..." : verdict ? "AI Verdict" : "✨ Generate AI Verdict"}</span>
            </button>
            <StoryAnalysisModal isOpen={show} onClose={() => setShow(false)} titles={titles} result={verdict} onResult={() => {}} feedback={null} onFeedback={() => {}} readonly shareUrl={show && sharePath ? `${window.location.origin}${sharePath}` : undefined} gridTitle={gridTitle} />
        </>
    );
}

/** Story-vs-story compare entry (item 5): only this browser's story grids. */
export function StoryCompareWithMine({ shareId }: { shareId: string }) {
    const mine = useMyGrids().filter((g) => g.kind === "story" && g.id !== shareId);
    if (mine.length === 0) return null;
    return (
        <details className="relative">
            <summary className={`${btn} cursor-pointer list-none`}>
                <GitCompareArrows className="w-4 h-4" /> Compare with mine
            </summary>
            <ul className="absolute z-40 mt-1 right-0 w-60 max-h-64 overflow-y-auto rounded-lg bg-zinc-900 border border-zinc-700 text-sm">
                {mine.map((g) => (
                    <li key={g.id}>
                        <Link className="block px-3 py-2 hover:bg-zinc-800 truncate" href={storyComparePath(g.id, shareId)}>
                            {g.title}
                        </Link>
                    </li>
                ))}
            </ul>
        </details>
    );
}
