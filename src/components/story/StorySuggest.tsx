"use client";

import { useState } from "react";
import { Lightbulb, Loader2, Search, Sparkles } from "lucide-react";
import { WAIFU_BTN } from "@/components/story/waifu-styles";
import type { StoryItem } from "@/lib/share-schema";
import { friendlyError } from "@/lib/public-errors";
import { cleanStorySuggestions, type StorySuggestion } from "@/lib/story/suggest";

/**
 * Parity item 5: "Suggest titles" like waifu's suggest.
 * - Runs ONLY on an explicit click (no effect, no retry) - dev uses the prod Gemini key.
 * - Shows text only. Picking a suggestion searches its title, so any image comes from
 *   /api/story/images through proxied(), never from the model.
 */
export function StorySuggest({ items, onPick }: { items: (StoryItem | null)[]; onPick: (title: string) => void }) {
    const [loading, setLoading] = useState(false);
    const [list, setList] = useState<StorySuggestion[] | null>(null);
    const [error, setError] = useState("");
    const [hidden, setHidden] = useState(false);
    const titles = items.filter((x): x is StoryItem => !!x).map((x) => x.title);
    if (hidden) return null;

    const run = async () => {
        if (loading || titles.length < 2) return;
        setLoading(true);
        setError("");
        try {
            const res = await fetch("/api/suggest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "story", characterNames: titles }) });
            const data = await res.json().catch(() => ({}));
            if (data.code === "ai_unavailable") return setHidden(true);
            if (!res.ok) return setError(friendlyError(data.error, "The AI is busy right now. Please try again in a few minutes."));
            // Clean again on the client: text fields only, whatever the server sent.
            setList(cleanStorySuggestions(data, titles));
        } catch {
            setError("The AI is busy right now. Please try again in a few minutes.");
        } finally {
            setLoading(false);
        }
    };

    // Layout copied from waifu's right panel "Suggestions" tab.
    return (
        <section className="p-4" aria-label="AI title suggestions">
            <div className="text-center mb-6">
                <Sparkles className="w-8 h-8 text-purple-500 mx-auto mb-2" />
                <h3 className="font-bold text-lg text-transparent bg-clip-text bg-gradient-to-r from-pink-500 to-purple-500">AI Suggestions</h3>
                <p className="text-xs text-zinc-500">Based on your current grid</p>
            </div>
            <button type="button" onClick={run} disabled={loading || titles.length < 2} className={`${WAIFU_BTN.ideas} mb-6`}>
                {loading ? <Loader2 className="animate-spin w-4 h-4" /> : <Lightbulb className="w-4 h-4" />} Generate Ideas
            </button>
            {error && <div role="alert" className="p-2 bg-red-900/20 text-red-300 text-xs rounded mb-4">{error}</div>}
            {list && list.length === 0 && <p className="text-center text-zinc-500 text-xs mb-4">No new suggestions this time.</p>}
            {list && list.length > 0 && (
                <ul className="space-y-3" data-testid="story-suggestions">
                    {list.map((s) => (
                        <li key={s.title}>
                            {/* Story: a real button (keyboard reachable); picking searches the title, so images come from /api/story/images. */}
                            <button type="button" onClick={() => onPick(s.title)} className="w-full text-left p-3 bg-zinc-900/50 border border-zinc-800 rounded-lg hover:border-pink-500/50 transition-colors cursor-pointer">
                                <span className="flex justify-between items-start gap-2">
                                    <span className="min-w-0">
                                        <span className="block font-bold text-sm text-zinc-200">{s.title}</span>
                                        <span className="block text-xs text-zinc-500">{s.type === "MANGA" ? "Manga" : "Anime"}</span>
                                    </span>
                                    <span className="p-1.5 bg-zinc-800 rounded text-purple-400 shrink-0"><Search className="w-3 h-3" /></span>
                                </span>
                                {s.reason && <span className="block text-xs text-zinc-500 mt-2 italic border-t border-zinc-800/50 pt-2">&quot;{s.reason}&quot;</span>}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            {!list && !loading && <p className="text-center text-zinc-700 text-xs">Fill the grid with at least 2 titles to unlock AI powers.</p>}
        </section>
    );
}
