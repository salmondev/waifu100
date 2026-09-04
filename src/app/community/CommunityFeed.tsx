"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Search, SlidersHorizontal, LayoutGrid, X } from "lucide-react";
import { GridCard } from "@/components/community/GridCard";
import type { ShareSummary } from "@/lib/share-summary";
import { cn } from "@/lib/utils";

type SortOrder = "new" | "old";
type Filter = "all" | "gif" | "complete";

const PAGE_SIZE = 50;

export default function CommunityFeed() {
  const [grids, setGrids] = useState<ShareSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextOffset, setNextOffset] = useState<number | null>(null);

  const [order, setOrder] = useState<SortOrder>("new");
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  /**
   * Sort is a server concern (it reorders the whole feed, not the loaded page),
   * so changing it refetches from offset 0. Filter and search stay on the client
   * for now, which is why `loadPage` doesn't know about them.
   */
  const loadPage = useCallback(async (offset: number, sortOrder: SortOrder) => {
    const first = offset === 0;
    if (first) setLoading(true);
    else setLoadingMore(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/community?offset=${offset}&limit=${PAGE_SIZE}&order=${sortOrder}`
      );
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const data = await res.json();
      const page: ShareSummary[] = data.grids ?? [];

      setGrids((prev) => {
        if (first) return page;
        // Guard against a duplicate id slipping in if the feed shifted between
        // pages (someone shared a grid while the visitor was reading).
        const seen = new Set(prev.map((g) => g.id));
        return [...prev, ...page.filter((g) => !seen.has(g.id))];
      });
      setNextOffset(data.nextOffset ?? null);
    } catch (e) {
      console.error("Failed to fetch community grids", e);
      setError("Couldn't load the showcase. Try again in a moment.");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    loadPage(0, order);
  }, [order, loadPage]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return grids.filter((g) => {
      if (filter === "gif" && !g.hasGif) return false;
      if (filter === "complete" && g.count < 100) return false;
      if (needle && !g.title.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [grids, filter, query]);

  const isFiltered = filter !== "all" || query.trim().length > 0;
  const hasMore = nextOffset !== null;

  const clearFilters = () => {
    setFilter("all");
    setQuery("");
  };

  return (
    <div className="min-h-screen bg-black text-white selection:bg-purple-500/30">
      {/* Background Gradients */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-0 w-[500px] h-[500px] bg-purple-900/20 blur-[120px] rounded-full mix-blend-screen" />
        <div className="absolute bottom-0 right-0 w-[500px] h-[500px] bg-indigo-900/20 blur-[120px] rounded-full mix-blend-screen" />
      </div>

      <div className="relative z-10 container mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row items-center justify-between mb-8 gap-6">
          <div className="flex items-center gap-4 self-start md:self-auto">
            <Link
              href="/"
              className="p-2 bg-zinc-900/50 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 rounded-full transition-all group shrink-0"
            >
              <ArrowLeft className="w-5 h-5 text-zinc-400 group-hover:text-white" />
            </Link>
            <div>
              <h1 className="text-4xl md:text-5xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 pb-1">
                Community Showcase
              </h1>
              <p className="text-zinc-500 mt-1">
                Discover curated collections from the Waifu100 community.
              </p>
            </div>
          </div>

          <Link
            href="/my-grids"
            className="self-start md:self-auto inline-flex items-center gap-2 px-4 py-2 bg-zinc-900/60 hover:bg-zinc-800 border border-zinc-800 rounded-lg text-sm text-zinc-300 transition-colors shrink-0"
          >
            <LayoutGrid className="w-4 h-4 text-purple-400" />
            My Grids
          </Link>
        </div>

        {/* Controls. Search narrows what has been loaded; the filters and the
            sort sit beside it so it reads as one toolbar on a phone too. */}
        <div className="mb-8 flex flex-col lg:flex-row lg:items-center gap-3">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600 pointer-events-none" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search loaded grids by name..."
              aria-label="Search grids by name"
              className="w-full bg-zinc-900/60 border border-zinc-800 rounded-xl pl-9 pr-9 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-purple-500/60 focus:border-transparent transition-all"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1 bg-zinc-900/60 border border-zinc-800 rounded-xl p-1">
              <SlidersHorizontal className="w-3.5 h-3.5 text-zinc-600 ml-2 mr-1 shrink-0" />
              <Chip active={filter === "all"} onClick={() => setFilter("all")}>All</Chip>
              <Chip active={filter === "gif"} onClick={() => setFilter("gif")}>Has GIF</Chip>
              <Chip active={filter === "complete"} onClick={() => setFilter("complete")}>
                Full 100
              </Chip>
            </div>

            <div className="flex items-center gap-1 bg-zinc-900/60 border border-zinc-800 rounded-xl p-1">
              <Chip active={order === "new"} onClick={() => setOrder("new")}>Newest</Chip>
              <Chip active={order === "old"} onClick={() => setOrder("old")}>Oldest</Chip>
            </div>
          </div>
        </div>

        {error && (
          <div className="mb-6 px-4 py-3 rounded-xl border border-red-900/50 bg-red-950/30 text-red-300 text-sm">
            {error}
          </div>
        )}

        {/* Grid */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-40">
            <Loader2 className="w-12 h-12 text-purple-500 animate-spin mb-4" />
            <p className="text-zinc-500 animate-pulse">Loading amazing collections...</p>
          </div>
        ) : grids.length === 0 ? (
          <div className="text-center py-20 bg-zinc-900/30 rounded-3xl border border-zinc-800/50">
            <p className="text-zinc-500 text-lg">No grids found yet. Be the first to share one!</p>
            <Link
              href="/"
              className="inline-flex items-center gap-2 mt-4 px-6 py-3 bg-purple-600 hover:bg-purple-500 rounded-lg font-medium transition-colors"
            >
              Create a Grid
            </Link>
          </div>
        ) : visible.length === 0 ? (
          /* Filtered down to nothing. Saying so - and offering the way out -
             beats a blank page that reads as a broken feed. */
          <div className="text-center py-20 bg-zinc-900/30 rounded-3xl border border-zinc-800/50 px-6">
            <p className="text-zinc-400 text-lg">No grids match these filters.</p>
            <p className="text-zinc-600 text-sm mt-2">
              Searching {grids.length} loaded grid{grids.length === 1 ? "" : "s"}
              {hasMore ? " — load more to widen the search." : "."}
            </p>
            <div className="flex flex-wrap justify-center gap-3 mt-6">
              <button
                type="button"
                onClick={clearFilters}
                className="px-6 py-2.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg font-medium transition-colors"
              >
                Clear filters
              </button>
              {hasMore && (
                <button
                  type="button"
                  onClick={() => loadPage(nextOffset, order)}
                  disabled={loadingMore}
                  className="px-6 py-2.5 bg-purple-600 hover:bg-purple-500 rounded-lg font-medium transition-colors disabled:opacity-60"
                >
                  {loadingMore ? "Loading..." : "Load more"}
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {visible.map((grid) => (
                <GridCard key={grid.id} grid={grid} />
              ))}
            </div>

            <div className="flex flex-col items-center gap-3 mt-10">
              {isFiltered && (
                <p className="text-xs text-zinc-600">
                  Showing {visible.length} of {grids.length} loaded grids.
                </p>
              )}
              {hasMore ? (
                <button
                  type="button"
                  onClick={() => loadPage(nextOffset, order)}
                  disabled={loadingMore}
                  className="inline-flex items-center gap-2 px-8 py-3 bg-zinc-900/60 hover:bg-zinc-800 border border-zinc-800 hover:border-purple-500/40 rounded-xl font-medium transition-colors disabled:opacity-60 disabled:cursor-wait"
                >
                  {loadingMore && <Loader2 className="w-4 h-4 animate-spin" />}
                  {loadingMore ? "Loading..." : "Load more grids"}
                </button>
              ) : (
                <p className="text-xs text-zinc-700">That&apos;s every grid so far.</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors",
        active
          ? "bg-purple-600/25 text-purple-200 border border-purple-500/40"
          : "text-zinc-500 hover:text-zinc-200 border border-transparent"
      )}
    >
      {children}
    </button>
  );
}
