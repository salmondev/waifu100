"use client";

import { useState } from "react";
import { Library } from "lucide-react";
import type { SeriesStats } from "@/lib/series-stats";
import { cn } from "@/lib/utils";

/**
 * Where the two grids draw from, as a diverging bar chart.
 *
 * One row per series, A growing left of the centre line and B right, so the
 * shape of the row says which way a series leans before any number is read -
 * a stacked or side-by-side chart makes that a subtraction exercise.
 *
 * Rows are the series both grids used, because that is the answer to "how much
 * do these two overlap" that the character list cannot give: two people can
 * both live in Fairy Tail and still share no single character.
 */

const COLLAPSED_ROWS = 6;

export function SeriesBreakdown({
    stats,
    titleA,
    titleB,
}: {
    stats: SeriesStats;
    titleA: string;
    titleB: string;
}) {
    const [expanded, setExpanded] = useState(false);

    const rows = stats.shared;
    if (rows.length === 0) return null;

    const visible = expanded ? rows : rows.slice(0, COLLAPSED_ROWS);
    const hidden = rows.length - visible.length;

    // One scale for every row, so a 9-character series looks three times the
    // 3-character one instead of every row filling its own width.
    const max = Math.max(...rows.map((row) => Math.max(row.a, row.b)));

    return (
        <section className="mt-12">
            <h2 className="mb-1 flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-zinc-500">
                <Library size={14} className="text-purple-400" />
                Series you both drew from
            </h2>
            <p className="mb-4 text-xs text-zinc-600">
                {/* Said out loud rather than hidden: most grids have cells whose
                    series was never recorded, and a chart that quietly ignored
                    them would overstate what it knows. */}
                Counted from {stats.knownA} of {stats.countA} and {stats.knownB} of{" "}
                {stats.countB} characters whose series is known.
            </p>

            <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/30 p-3 sm:p-4">
                <div className="mb-3 flex items-center justify-between text-[11px] text-zinc-500">
                    <span className="truncate text-purple-300/80">{titleA}</span>
                    <span className="truncate text-pink-300/80">{titleB}</span>
                </div>

                <div className="flex flex-col gap-2">
                    {visible.map((row) => (
                        <div key={row.name} className="flex items-center gap-2">
                            <div className="flex flex-1 justify-end">
                                <div
                                    className="h-6 rounded-l-md bg-gradient-to-l from-purple-500 to-purple-600/70"
                                    style={{ width: `${(row.a / max) * 100}%` }}
                                />
                            </div>

                            <div className="flex w-6 shrink-0 justify-end">
                                <span className="text-[11px] tabular-nums text-purple-300">
                                    {row.a}
                                </span>
                            </div>

                            <div
                                className="min-w-0 shrink-0 basis-[34%] truncate px-1 text-center text-[11px] text-zinc-300 sm:basis-[28%] sm:text-xs"
                                title={row.name}
                            >
                                {row.name}
                            </div>

                            <div className="flex w-6 shrink-0">
                                <span className="text-[11px] tabular-nums text-pink-300">
                                    {row.b}
                                </span>
                            </div>

                            <div className="flex flex-1">
                                <div
                                    className="h-6 rounded-r-md bg-gradient-to-r from-pink-500 to-pink-600/70"
                                    style={{ width: `${(row.b / max) * 100}%` }}
                                />
                            </div>
                        </div>
                    ))}
                </div>

                {hidden > 0 && (
                    <button
                        onClick={() => setExpanded(true)}
                        className={cn(
                            "mt-3 w-full rounded-lg border border-zinc-800 py-2 text-xs text-zinc-400",
                            "transition-colors hover:border-purple-500/40 hover:text-purple-300"
                        )}
                    >
                        Show {hidden} more shared series
                    </button>
                )}
            </div>
        </section>
    );
}
