"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Library, Loader2 } from "lucide-react";
import {
    compareSeries,
    unresolvedNames,
    type SeriesInput,
    type SeriesResolution,
    type SeriesRow,
} from "@/lib/series-stats";
import { cn } from "@/lib/utils";

/**
 * Where the two grids draw from.
 *
 * Three views of one count: what both drew from, and then each side on its own.
 * The shared one leads because it answers what the character list cannot - two
 * people can both live in Fairy Tail and still share no single character.
 *
 * The counting runs here rather than on the server because it has to run twice:
 * once with what the server already knew, and again when the AniList lookups
 * come back for every character whose stored source was "Uploaded" or a
 * Pinterest URL. The inputs are names the page has already sent anyway.
 */

const COLLAPSED_ROWS = 6;

type Tab = "shared" | "a" | "b";

function Bars({
    rows,
    mode,
    max,
}: {
    rows: SeriesRow[];
    mode: Tab;
    max: number;
}) {
    if (mode === "shared") {
        return (
            <div className="flex flex-col gap-2">
                {rows.map((row) => (
                    <div key={row.name} className="flex items-center gap-2">
                        <div className="flex flex-1 justify-end">
                            <div
                                className="h-6 rounded-l-md bg-gradient-to-l from-purple-500 to-purple-600/70"
                                style={{ width: `${(row.a / max) * 100}%` }}
                            />
                        </div>
                        <span className="w-5 shrink-0 text-right text-[11px] tabular-nums text-purple-300">
                            {row.a}
                        </span>
                        <div
                            className="min-w-0 shrink-0 basis-[36%] truncate px-1 text-center text-[11px] text-zinc-300 sm:basis-[30%] sm:text-xs"
                            title={row.name}
                        >
                            {row.name}
                        </div>
                        <span className="w-5 shrink-0 text-[11px] tabular-nums text-pink-300">
                            {row.b}
                        </span>
                        <div className="flex flex-1">
                            <div
                                className="h-6 rounded-r-md bg-gradient-to-r from-pink-500 to-pink-600/70"
                                style={{ width: `${(row.b / max) * 100}%` }}
                            />
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    // One side on its own: a plain left-to-right bar, no centre line to read
    // across, since there is nothing to compare it against.
    const side = mode === "a" ? "a" : "b";
    return (
        <div className="flex flex-col gap-2">
            {rows.map((row) => {
                const value = side === "a" ? row.a : row.b;
                return (
                    <div key={row.name} className="flex items-center gap-3">
                        <div
                            className="w-[38%] shrink-0 truncate text-right text-[11px] text-zinc-300 sm:w-[30%] sm:text-xs"
                            title={row.name}
                        >
                            {row.name}
                        </div>
                        <div className="flex flex-1 items-center gap-2">
                            <div
                                className={cn(
                                    "h-6 rounded-md",
                                    side === "a"
                                        ? "bg-gradient-to-r from-purple-600/70 to-purple-500"
                                        : "bg-gradient-to-r from-pink-600/70 to-pink-500"
                                )}
                                style={{ width: `${(value / max) * 100}%` }}
                            />
                            <span
                                className={cn(
                                    "text-[11px] tabular-nums",
                                    side === "a" ? "text-purple-300" : "text-pink-300"
                                )}
                            >
                                {value}
                            </span>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

export function SeriesBreakdown({
    charactersA,
    charactersB,
    titleA,
    titleB,
    initialResolved = {},
}: {
    charactersA: SeriesInput[];
    charactersB: SeriesInput[];
    titleA: string;
    titleB: string;
    /** Name -> series already in the server's cache. */
    initialResolved?: SeriesResolution;
}) {
    const [resolved, setResolved] = useState<SeriesResolution>(initialResolved);
    // Computed at first render rather than switched on inside the effect: the
    // spinner is on exactly when there is something left to look up.
    const [looking, setLooking] = useState(
        () => unresolvedNames([...charactersA, ...charactersB], initialResolved).length > 0
    );
    const [tab, setTab] = useState<Tab>("shared");
    const [expanded, setExpanded] = useState(false);

    const everyone = useMemo(
        () => [...charactersA, ...charactersB],
        [charactersA, charactersB]
    );

    // Ask once per mount for whatever the cache could not answer. The endpoint
    // caps how many it will look up, so a grid of unknowns fills in over a
    // couple of visits rather than holding one visitor hostage.
    const asked = useRef(false);
    useEffect(() => {
        if (asked.current) return;
        asked.current = true;

        let alive = true;

        // A few rounds, because the endpoint caps how many names it looks up in
        // one call (AniList is a shared community API). Two grids of a hundred
        // unknowns finish in three passes instead of over three page visits.
        const run = async () => {
            try {
                let known = resolved;
                for (let round = 0; round < 3; round++) {
                    const missing = unresolvedNames(everyone, known);
                    if (missing.length === 0) break;

                    const res = await fetch("/api/series", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ names: missing }),
                    });
                    if (!res.ok) break;

                    const data = await res.json();
                    const series = data?.series;
                    if (!series || Object.keys(series).length === 0) break;

                    known = { ...known, ...series };
                    if (!alive) return;
                    setResolved(known);
                }
            } catch {
                // The chart still shows whatever was already known.
            } finally {
                if (alive) setLooking(false);
            }
        };

        run();
        return () => {
            alive = false;
        };
    }, [everyone, resolved]);

    const stats = useMemo(
        () => compareSeries(charactersA, charactersB, resolved),
        [charactersA, charactersB, resolved]
    );

    const rows = tab === "shared" ? stats.shared : tab === "a" ? stats.aOnly : stats.bOnly;
    const empty =
        stats.shared.length === 0 && stats.aOnly.length === 0 && stats.bOnly.length === 0;
    // Nothing known and nothing on the way: no section at all, rather than an
    // empty box. While lookups are in flight it stays, so it does not pop in
    // and shove the page around a second later.
    if (empty && !looking) return null;

    const visible = expanded ? rows : rows.slice(0, COLLAPSED_ROWS);
    const hidden = rows.length - visible.length;
    // One scale across the visible rows, so a 9-character series looks three
    // times the 3-character one instead of every row filling its own width.
    const max = Math.max(
        1,
        ...rows.map((row) => (tab === "b" ? row.b : tab === "a" ? row.a : Math.max(row.a, row.b)))
    );

    const tabs: { id: Tab; label: string; count: number }[] = [
        { id: "shared", label: "Both", count: stats.shared.length },
        { id: "a", label: titleA, count: stats.aOnly.length },
        { id: "b", label: titleB, count: stats.bOnly.length },
    ];

    return (
        <section className="mt-12">
            <h2 className="mb-1 flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-zinc-500">
                <Library size={14} className="text-purple-400" />
                Where these grids come from
                {looking && <Loader2 size={12} className="animate-spin text-zinc-600" />}
            </h2>
            <p className="mb-4 text-xs text-zinc-600">
                {/* Said out loud rather than hidden: a series is known from the
                    stored source or from an AniList lookup by name, and some
                    characters - original art, VTuber alts - are neither. */}
                Series known for {stats.knownA} of {stats.countA} and {stats.knownB} of{" "}
                {stats.countB} characters.
            </p>

            <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/30 p-3 sm:p-4">
                <div className="mb-4 flex gap-1 overflow-x-auto rounded-xl bg-zinc-900/60 p-1">
                    {tabs.map(({ id, label, count }) => (
                        <button
                            key={id}
                            onClick={() => {
                                setTab(id);
                                setExpanded(false);
                            }}
                            className={cn(
                                "flex min-w-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                                tab === id
                                    ? "bg-purple-600/25 text-purple-100"
                                    : "text-zinc-500 hover:text-zinc-300"
                            )}
                        >
                            <span className="max-w-[9rem] truncate">{label}</span>
                            <span className="text-[10px] tabular-nums text-zinc-500">
                                {count}
                            </span>
                        </button>
                    ))}
                </div>

                {rows.length === 0 ? (
                    <p className="py-6 text-center text-sm text-zinc-600">
                        No series in common here.
                    </p>
                ) : (
                    <>
                        {tab === "shared" && (
                            <div className="mb-3 flex items-center justify-between text-[11px]">
                                <span className="truncate text-purple-300/80">{titleA}</span>
                                <span className="truncate text-pink-300/80">{titleB}</span>
                            </div>
                        )}
                        <Bars rows={visible} mode={tab} max={max} />
                        {hidden > 0 && (
                            <button
                                onClick={() => setExpanded(true)}
                                className="mt-3 w-full rounded-lg border border-zinc-800 py-2 text-xs text-zinc-400 transition-colors hover:border-purple-500/40 hover:text-purple-300"
                            >
                                Show {hidden} more
                            </button>
                        )}
                    </>
                )}
            </div>
        </section>
    );
}
