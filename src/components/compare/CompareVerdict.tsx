"use client";

import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { AnalysisResult } from "@/types";

/**
 * The AI's read on the pair.
 *
 * Behind a button rather than generated with the page: every press that reaches
 * the API costs a Gemini call, and a compare link is the kind of thing a
 * hundred people open at once from one Discord message. The API caches the
 * answer per sorted pair, so only the first of them pays - but the button is
 * still what decides whether the call happens at all.
 */
export function CompareVerdict({ a, b }: { a: string; b: string }) {
    const [verdict, setVerdict] = useState<AnalysisResult | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // Thai first, like the grid verdict: the Thai text is written for the
    // reader rather than translated at them.
    const [lang, setLang] = useState<"en" | "th">("th");

    const generate = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch("/api/compare/verdict", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ a, b }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Failed to generate a verdict.");
            setVerdict(data.verdict);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to generate a verdict.");
        } finally {
            setLoading(false);
        }
    };

    if (!verdict) {
        return (
            <div className="mt-8 flex flex-col items-center gap-2">
                <button
                    onClick={generate}
                    disabled={loading}
                    className={cn(
                        "flex items-center gap-2 rounded-lg border border-yellow-600/30 bg-gradient-to-r from-yellow-600/20 to-orange-600/20 px-4 py-2 font-medium text-yellow-500 transition-all hover:from-yellow-600/30 hover:to-orange-600/30",
                        loading && "cursor-wait opacity-70"
                    )}
                >
                    {loading ? (
                        <Loader2 size={18} className="animate-spin" />
                    ) : (
                        <Sparkles size={18} />
                    )}
                    {loading ? "Reading both grids..." : "✨ AI Verdict on this pair"}
                </button>
                {error && <p className="text-xs text-red-400">{error}</p>}
            </div>
        );
    }

    const side = lang === "en" ? verdict.en : verdict.th;

    return (
        <div className="mt-8 rounded-2xl border border-yellow-600/20 bg-gradient-to-b from-yellow-950/20 to-zinc-900/40 p-5 sm:p-6">
            <div className="mb-3 flex items-center justify-between gap-3">
                <span className="text-3xl">{verdict.emoji}</span>
                <div className="flex rounded-lg bg-zinc-900 p-0.5 text-xs font-medium">
                    <button
                        onClick={() => setLang("en")}
                        className={cn(
                            "rounded-md px-2.5 py-1 transition-colors",
                            lang === "en"
                                ? "bg-zinc-700 text-white shadow-sm"
                                : "text-zinc-600 hover:text-zinc-400"
                        )}
                    >
                        EN
                    </button>
                    <button
                        onClick={() => setLang("th")}
                        className={cn(
                            "rounded-md px-2.5 py-1 transition-colors",
                            lang === "th"
                                ? "bg-gradient-to-r from-blue-600 to-red-600 text-white shadow-sm"
                                : "text-zinc-600 hover:text-zinc-400"
                        )}
                    >
                        TH
                    </button>
                </div>
            </div>

            <h3 className="text-lg font-bold text-yellow-500 sm:text-xl">{side.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-zinc-300 sm:text-base">
                {side.content}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
                {side.tags?.map((tag) => (
                    <span
                        key={tag}
                        className="rounded-full bg-zinc-800/80 px-2.5 py-1 text-xs text-zinc-400"
                    >
                        {tag}
                    </span>
                ))}
            </div>
        </div>
    );
}
