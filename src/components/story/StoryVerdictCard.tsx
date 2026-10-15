import { forwardRef } from "react";
import { Sparkles } from "lucide-react";
import type { AnalysisResult } from "@/types";
import { STORY_BRAND } from "@/lib/story/config";

/**
 * The share picture for a story verdict: what Copy Image / Save Image / Share produce.
 *
 * A separate, fixed-width layout rather than a screenshot of the modal: the modal card carries the
 * EN/TH toggle, the vote / share / copy buttons and a phone-height scroll clip, none of which belong
 * in a picture posted somewhere else. Same look as the modal's result card (badge, quoted title,
 * Vibe Check emoji, tags, quote block), plus a footer naming the grid and the brand.
 * Contains no buttons, inputs or links by construction (pinned by test).
 */
export const STORY_VERDICT_CARD_WIDTH = 640;

export const StoryVerdictCard = forwardRef<HTMLDivElement, { result: AnalysisResult; lang: "en" | "th"; gridTitle?: string; host?: string }>(function StoryVerdictCard({ result, lang, gridTitle, host }, ref) {
    const v = lang === "en" ? result.en : result.th;
    return (
        <div ref={ref} data-testid="story-verdict-card" style={{ width: STORY_VERDICT_CARD_WIDTH }} className="relative overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-900 text-center text-white">
            <div className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-yellow-500 via-orange-500 to-red-500" />
            <div className="space-y-6 px-10 pb-8 pt-10">
                <div className="flex justify-center">
                    <div className="inline-flex items-center gap-2 rounded-full border border-yellow-500/20 bg-yellow-500/10 px-3 py-1 text-xs font-bold uppercase tracking-wider text-yellow-500">
                        <Sparkles size={12} />
                        <span>AI Verdict</span>
                    </div>
                </div>
                <h2 className="bg-gradient-to-br from-white via-zinc-200 to-zinc-400 bg-clip-text px-2 py-1 text-4xl font-black italic leading-relaxed text-transparent">&quot;{v.title}&quot;</h2>
                <div className="flex justify-center">
                    <div className="relative flex h-32 w-32 flex-col items-center justify-center rounded-full border-4 border-zinc-800 bg-zinc-900/50 shadow-xl shadow-purple-500/20">
                        <span className="text-6xl">{result.emoji}</span>
                        <div className="absolute -bottom-3 whitespace-nowrap rounded-full border border-zinc-800 bg-zinc-950 px-3 py-1 text-[9px] font-bold uppercase tracking-wider text-zinc-400">Vibe Check</div>
                    </div>
                </div>
                <div className="flex flex-wrap justify-center gap-2">
                    {v.tags.map((t, i) => (
                        <span key={i} className="rounded-full border border-zinc-700/50 bg-zinc-800/80 px-3 py-1 text-xs font-medium text-zinc-300">{t}</span>
                    ))}
                </div>
                <div className="rounded-2xl border border-zinc-800/80 bg-zinc-950/50 p-6">
                    <p className="text-lg font-medium italic leading-relaxed text-zinc-300">{v.content}</p>
                </div>
            </div>
            <div className="flex items-center justify-between gap-4 border-t border-zinc-800 bg-zinc-950/60 px-10 py-4 text-left">
                <div className="min-w-0">
                    {gridTitle?.trim() && <p className="truncate text-sm font-bold text-white">{gridTitle}</p>}
                    <p className="text-xs text-zinc-500">AI verdict on an anime &amp; manga grid</p>
                </div>
                <div className="shrink-0 text-right">
                    <p className="bg-gradient-to-r from-purple-400 via-pink-500 to-purple-400 bg-clip-text text-lg font-black text-transparent">{STORY_BRAND}</p>
                    {host && <p className="text-[11px] text-zinc-500">{host}</p>}
                </div>
            </div>
        </div>
    );
});
