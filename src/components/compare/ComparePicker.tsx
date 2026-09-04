"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, GitCompareArrows, Loader2, Search, X } from "lucide-react";
import type { ShareSummary } from "@/lib/share-summary";
import { shareCardPath } from "@/lib/share-card";
import { useMyGrids } from "@/lib/my-grids";
import { cn } from "@/lib/utils";

/**
 * Choosing the two grids to compare.
 *
 * The feature started as "compare this grid with mine", which quietly required
 * owning a grid at all - so a visitor who had not built one yet could not use
 * the thing that is supposed to convince them to build one, and nobody could
 * put two other people's grids side by side. Any two grids in the showcase can
 * be picked here, with the visitor's own offered first when they have any.
 *
 * Pages come from the same /api/community endpoint the showcase uses, so this
 * costs no new server work; search filters what is loaded, exactly as it does
 * there.
 */

const PAGE_SIZE = 50;

type SlotName = "a" | "b";

function GridTile({
    grid,
    picked,
    onPick,
}: {
    grid: ShareSummary;
    picked: SlotName | null;
    onPick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onPick}
            className={cn(
                "group relative overflow-hidden rounded-xl border bg-zinc-900/40 text-left transition-all",
                picked
                    ? "border-purple-500 ring-2 ring-purple-500/40"
                    : "border-zinc-800/60 hover:-translate-y-0.5 hover:border-purple-500/50"
            )}
        >
            <div className="relative aspect-square bg-zinc-950">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                    src={grid.imageUrl || shareCardPath(grid.id)}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover"
                />
                {picked && (
                    <span className="absolute right-2 top-2 rounded-full bg-purple-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-white">
                        {picked}
                    </span>
                )}
            </div>
            <div className="p-2">
                <p className="truncate text-xs font-medium text-white">{grid.title}</p>
                <p className="text-[10px] text-zinc-500">{grid.count}/100</p>
            </div>
        </button>
    );
}

function SlotBox({
    label,
    grid,
    active,
    onFocus,
    onClear,
}: {
    label: string;
    grid: ShareSummary | null;
    active: boolean;
    onFocus: () => void;
    onClear: () => void;
}) {
    return (
        <div
            onClick={onFocus}
            className={cn(
                "flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-2xl border p-3 transition-colors",
                active
                    ? "border-purple-500/60 bg-purple-500/5"
                    : "border-zinc-800 bg-zinc-900/50 hover:border-zinc-700"
            )}
        >
            <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-zinc-800">
                {grid && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        src={grid.imageUrl || shareCardPath(grid.id)}
                        alt=""
                        className="h-full w-full object-cover"
                    />
                )}
            </div>
            <div className="min-w-0 flex-1">
                <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                    {label}
                </p>
                <p className={cn("truncate text-sm", grid ? "text-white" : "text-zinc-600")}>
                    {grid ? grid.title : "Pick a grid below"}
                </p>
            </div>
            {grid && (
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        onClear();
                    }}
                    aria-label={`Clear ${label}`}
                    className="shrink-0 rounded-full p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-white"
                >
                    <X size={14} />
                </button>
            )}
        </div>
    );
}

export function ComparePicker({
    initialA = null,
    initialB = null,
}: {
    /** Pre-filled sides, e.g. arriving from a card's "compare this one" link. */
    initialA?: ShareSummary | null;
    initialB?: ShareSummary | null;
}) {
    const router = useRouter();
    const mine = useMyGrids();

    const [a, setA] = useState<ShareSummary | null>(initialA);
    const [b, setB] = useState<ShareSummary | null>(initialB);
    const [active, setActive] = useState<SlotName>(initialA && !initialB ? "b" : "a");

    const [grids, setGrids] = useState<ShareSummary[]>([]);
    const [nextOffset, setNextOffset] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [query, setQuery] = useState("");

    const loadPage = useCallback(async (offset: number) => {
        if (offset === 0) setLoading(true);
        else setLoadingMore(true);
        setError(null);
        try {
            const res = await fetch(`/api/community?offset=${offset}&limit=${PAGE_SIZE}`);
            if (!res.ok) throw new Error(`Request failed (${res.status})`);
            const data = await res.json();
            const page: ShareSummary[] = data.grids ?? [];
            setGrids((prev) => {
                if (offset === 0) return page;
                const seen = new Set(prev.map((g) => g.id));
                return [...prev, ...page.filter((g) => !seen.has(g.id))];
            });
            setNextOffset(data.nextOffset ?? null);
        } catch (e) {
            console.error("Failed to load grids for compare", e);
            setError("Couldn't load the showcase. Try again in a moment.");
        } finally {
            setLoading(false);
            setLoadingMore(false);
        }
    }, []);

    useEffect(() => {
        loadPage(0);
    }, [loadPage]);

    /**
     * The visitor's own grids first, then the feed. Their own may not be in the
     * public feed at all (an older share, or one further back than the pages
     * loaded so far), and they are the most likely pick.
     */
    const listed = useMemo(() => {
        const seen = new Set<string>();
        const all = [...mine, ...grids].filter((g) => {
            if (seen.has(g.id)) return false;
            seen.add(g.id);
            return true;
        });
        const needle = query.trim().toLowerCase();
        return needle ? all.filter((g) => g.title.toLowerCase().includes(needle)) : all;
    }, [mine, grids, query]);

    const pick = (grid: ShareSummary) => {
        // Tapping a chosen grid again takes it back out, so a mis-tap costs one
        // tap rather than a hunt for the clear button.
        if (a?.id === grid.id) {
            setA(null);
            setActive("a");
            return;
        }
        if (b?.id === grid.id) {
            setB(null);
            setActive("b");
            return;
        }

        if (active === "a") {
            setA(grid);
            setActive("b");
        } else {
            setB(grid);
            setActive("a");
        }
    };

    const ready = a && b && a.id !== b.id;

    return (
        <div className="min-h-screen bg-zinc-950 py-6 text-white sm:py-10">
            <div className="mx-auto w-full max-w-[1000px] px-3 sm:px-4">
                <div className="mb-6 flex items-center gap-3">
                    <Link
                        href="/community"
                        className="rounded-full border border-zinc-800 bg-zinc-900/50 p-2 text-zinc-400 transition-colors hover:text-white"
                    >
                        <ArrowLeft size={18} />
                    </Link>
                    <div>
                        <h1 className="bg-gradient-to-r from-purple-400 via-pink-400 to-purple-400 bg-clip-text text-2xl font-bold text-transparent sm:text-3xl">
                            Compare two grids
                        </h1>
                        <p className="text-sm text-zinc-500">
                            Any two grids - they don&apos;t have to be yours.
                        </p>
                    </div>
                </div>

                {/* The two slots */}
                <div className="flex items-stretch gap-2 sm:gap-3">
                    <SlotBox
                        label="Grid A"
                        grid={a}
                        active={active === "a"}
                        onFocus={() => setActive("a")}
                        onClear={() => {
                            setA(null);
                            setActive("a");
                        }}
                    />
                    <div className="flex shrink-0 items-center text-lg font-bold text-purple-500 sm:text-2xl">
                        ×
                    </div>
                    <SlotBox
                        label="Grid B"
                        grid={b}
                        active={active === "b"}
                        onFocus={() => setActive("b")}
                        onClear={() => {
                            setB(null);
                            setActive("b");
                        }}
                    />
                </div>

                <button
                    type="button"
                    disabled={!ready}
                    onClick={() => ready && router.push(`/compare?a=${a.id}&b=${b.id}`)}
                    className={cn(
                        "mt-4 flex w-full items-center justify-center gap-2 rounded-xl py-3 font-medium transition-all",
                        ready
                            ? "bg-purple-600 text-white hover:bg-purple-500"
                            : "cursor-not-allowed bg-zinc-900 text-zinc-600"
                    )}
                >
                    <GitCompareArrows size={18} />
                    {ready ? "Compare these two" : "Pick two grids to compare"}
                </button>

                {/* Search over what is loaded, same as the showcase does. */}
                <div className="relative mt-8">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600" />
                    <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search loaded grids by name..."
                        className="w-full rounded-xl border border-zinc-800 bg-zinc-900/60 py-2.5 pl-9 pr-3 text-sm text-white placeholder:text-zinc-600 focus:border-purple-500/60 focus:outline-none"
                    />
                </div>

                {loading ? (
                    <div className="flex justify-center py-16">
                        <Loader2 className="h-6 w-6 animate-spin text-purple-500" />
                    </div>
                ) : error ? (
                    <p className="py-16 text-center text-sm text-red-400">{error}</p>
                ) : listed.length === 0 ? (
                    <p className="py-16 text-center text-sm text-zinc-600">
                        No grids match that name.
                    </p>
                ) : (
                    <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-3 lg:grid-cols-5">
                        {listed.map((grid) => (
                            <GridTile
                                key={grid.id}
                                grid={grid}
                                picked={a?.id === grid.id ? "a" : b?.id === grid.id ? "b" : null}
                                onPick={() => pick(grid)}
                            />
                        ))}
                    </div>
                )}

                {nextOffset !== null && !query.trim() && (
                    <button
                        type="button"
                        onClick={() => loadPage(nextOffset)}
                        disabled={loadingMore}
                        className="mx-auto mt-6 flex items-center gap-2 rounded-lg border border-zinc-800 px-4 py-2 text-sm text-zinc-400 transition-colors hover:border-purple-500/40 hover:text-purple-300"
                    >
                        {loadingMore && <Loader2 className="h-4 w-4 animate-spin" />}
                        Load more grids
                    </button>
                )}

                <div className="h-16" />
            </div>
        </div>
    );
}
