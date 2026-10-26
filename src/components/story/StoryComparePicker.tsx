"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, GitCompareArrows, Loader2, Search, X } from "lucide-react";
import { proxied } from "@/lib/img-proxy";
import type { ShareSummary } from "@/lib/share-summary";
import { useMyGrids } from "@/lib/my-grids";
import { cn } from "@/lib/utils";
import { SHOWCASE_LINK_CLASS } from "@/components/community/showcase-link";
import { storyComparePath } from "@/lib/story/compare";
import { CMP } from "@/components/story/compare-styles";

/** Choosing two story grids: a copy of waifu's ComparePicker, story feed and story grids only. */

const PAGE_SIZE = 50;
type SlotName = "a" | "b";

const thumbUrl = (g: ShareSummary) => g.imageUrl || g.previews?.[0] || null;

function GridTile({ grid, picked, onPick }: { grid: ShareSummary; picked: SlotName | null; onPick: () => void }) {
    const src = thumbUrl(grid);
    return (
        <button type="button" onClick={onPick} className={cn("group relative overflow-hidden rounded-xl border bg-zinc-900/40 text-left transition-all", picked ? CMP.tilePicked : CMP.tileIdle)}>
            <div className="relative aspect-square bg-zinc-950">
                {src ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={proxied(src, 256)} alt="" loading="lazy" className="h-full w-full object-cover" />
                ) : (
                    <div className="flex h-full w-full items-center justify-center text-[10px] text-zinc-600">No Preview</div>
                )}
                {picked && (
                    <span className="absolute right-2 top-2 rounded-full bg-purple-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-white">{picked}</span>
                )}
            </div>
            <div className="p-2">
                <p className="truncate text-xs font-medium text-white">{grid.title}</p>
                <p className="text-[10px] text-zinc-500">
                    {grid.count}/{grid.size ?? 100}
                </p>
            </div>
        </button>
    );
}

function SlotBox({ label, grid, active, onFocus, onClear }: { label: string; grid: ShareSummary | null; active: boolean; onFocus: () => void; onClear: () => void }) {
    const src = grid ? thumbUrl(grid) : null;
    return (
        <div onClick={onFocus} className={cn("flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-2xl border p-3 transition-colors", active ? CMP.slotActive : CMP.slotIdle)}>
            <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-zinc-800">
                {src && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={proxied(src, 256)} alt="" className="h-full w-full object-cover" />
                )}
            </div>
            <div className="min-w-0 flex-1">
                <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">{label}</p>
                <p className={cn("truncate text-sm", grid ? "text-white" : "text-zinc-600")}>{grid ? grid.title : "Pick a grid below"}</p>
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

export function StoryComparePicker({ initialA = null, initialB = null, notice = null }: { initialA?: ShareSummary | null; initialB?: ShareSummary | null; notice?: string | null }) {
    const router = useRouter();
    const [navigating, startNavigating] = useTransition();
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
            const res = await fetch(`/api/community?offset=${offset}&limit=${PAGE_SIZE}&kind=story`);
            if (!res.ok) throw new Error(`Request failed (${res.status})`);
            const data = await res.json();
            const page: ShareSummary[] = (data.grids ?? []).filter((g: ShareSummary) => g.kind === "story");
            setGrids((prev) => {
                if (offset === 0) return page;
                const seen = new Set(prev.map((g) => g.id));
                return [...prev, ...page.filter((g) => !seen.has(g.id))];
            });
            setNextOffset(data.nextOffset ?? null);
        } catch (e) {
            console.error("Failed to load story grids for compare", e);
            setError("Couldn't load the showcase. Try again in a moment.");
        } finally {
            setLoading(false);
            setLoadingMore(false);
        }
    }, []);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- existing effect-driven state sync; refactoring would change render timing
        loadPage(0);
    }, [loadPage]);

    const listed = useMemo(() => {
        const seen = new Set<string>();
        const all = [...mine.filter((g) => g.kind === "story"), ...grids].filter((g) => {
            if (seen.has(g.id)) return false;
            seen.add(g.id);
            return true;
        });
        const needle = query.trim().toLowerCase();
        return needle ? all.filter((g) => g.title.toLowerCase().includes(needle)) : all;
    }, [mine, grids, query]);

    const pick = (grid: ShareSummary) => {
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
        <div className={CMP.page} data-testid="story-compare-picker">
            <div className={CMP.container}>
                <div className="mb-6 flex items-center gap-3">
                    <Link href="/community?kind=story" aria-label="Back to the Community Showcase" className={cn("rounded-full p-2", SHOWCASE_LINK_CLASS)}>
                        <ArrowLeft size={18} />
                    </Link>
                    <div>
                        <h1 className={CMP.pickerTitle}>Compare two story grids</h1>
                        <p className="text-sm text-zinc-500">Any two story grids - they don&apos;t have to be yours.</p>
                    </div>
                </div>

                {notice && (
                    <p role="status" className="mb-4 rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-400">
                        {notice}
                    </p>
                )}

                <div className="flex items-stretch gap-2 sm:gap-3">
                    <SlotBox label="Grid A" grid={a} active={active === "a"} onFocus={() => setActive("a")} onClear={() => { setA(null); setActive("a"); }} />
                    <div className={CMP.times}>×</div>
                    <SlotBox label="Grid B" grid={b} active={active === "b"} onFocus={() => setActive("b")} onClear={() => { setB(null); setActive("b"); }} />
                </div>

                <button
                    type="button"
                    disabled={!ready || navigating}
                    aria-busy={navigating}
                    onClick={() => ready && startNavigating(() => router.push(storyComparePath(a.id, b.id)))}
                    className={cn(CMP.goBase, ready ? CMP.goReady : CMP.goIdle, navigating && "cursor-wait")}
                >
                    {navigating ? <Loader2 size={18} className="animate-spin" /> : <GitCompareArrows size={18} />}
                    {navigating ? "Comparing…" : ready ? "Compare these two" : "Pick two grids to compare"}
                </button>

                <div className="relative mt-8">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600" />
                    <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search loaded grids by name..." className={CMP.search} />
                </div>

                {loading ? (
                    <div className="flex justify-center py-16" role="status" aria-label="Loading grids">
                        <Loader2 className="h-6 w-6 animate-spin text-purple-500" />
                    </div>
                ) : error ? (
                    <p className="py-16 text-center text-sm text-red-400">{error}</p>
                ) : listed.length === 0 ? (
                    <p className="py-16 text-center text-sm text-zinc-600">{query.trim() ? "No grids match that name." : "No story grids yet."}</p>
                ) : (
                    <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-3 lg:grid-cols-5">
                        {listed.map((grid) => (
                            <GridTile key={grid.id} grid={grid} picked={a?.id === grid.id ? "a" : b?.id === grid.id ? "b" : null} onPick={() => pick(grid)} />
                        ))}
                    </div>
                )}

                {nextOffset !== null && !query.trim() && (
                    <button type="button" onClick={() => loadPage(nextOffset)} disabled={loadingMore} className={CMP.loadMore}>
                        {loadingMore && <Loader2 className="h-4 w-4 animate-spin" />}
                        Load more grids
                    </button>
                )}
                <div className="h-16" />
            </div>
        </div>
    );
}
