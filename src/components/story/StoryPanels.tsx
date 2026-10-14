"use client";

import { Loader2, Share2 } from "lucide-react";
import { proxied } from "@/lib/img-proxy";
import { storyViewPath } from "@/lib/story/config";
import type { ShareSummary } from "@/lib/share-summary";
import { cn } from "@/lib/utils";

/** Waifu's right-panel tab styles, verbatim. */
export type PanelTab = "suggestions" | "community";
const TAB_BASE = "flex-1 text-xs py-1.5 rounded-md font-medium transition-colors cursor-pointer";
const TAB_ACTIVE: Record<PanelTab, string> = {
    suggestions: "bg-zinc-800 text-white shadow-sm",
    community: "bg-indigo-900/30 text-indigo-200 shadow-sm",
};
const TAB_LABEL: Record<PanelTab, string> = { suggestions: "Suggestions", community: "Community" };

export function PanelTabs({ tab, onTab }: { tab: PanelTab; onTab: (t: PanelTab) => void }) {
    return (
        <div role="tablist" aria-label="Panel" className="flex gap-2 p-1 bg-zinc-900 rounded-lg flex-1 mr-2">
            {(["suggestions", "community"] as const).map((t) => (
                <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => onTab(t)} className={cn(TAB_BASE, tab === t ? TAB_ACTIVE[t] : "text-zinc-500 hover:text-zinc-300")}>
                    {TAB_LABEL[t]}
                </button>
            ))}
        </div>
    );
}

/**
 * Story shares carry no rendered thumbnail (imageUrl is null), so the card shows up to 4 of the
 * grid's own cell images, via the image proxy, as a 2x2 mosaic (1 image fills the square).
 */
function PreviewMosaic({ urls, title }: { urls: string[]; title: string }) {
    const shown = urls.slice(0, 4);
    return (
        <div data-testid="community-mosaic" role="img" aria-label={title} className={cn("w-full h-full grid gap-px bg-zinc-800", shown.length === 1 ? "grid-cols-1" : "grid-cols-2 grid-rows-2")}>
            {shown.map((u, i) => (
                <img key={i} src={proxied(u, 192)} alt="" referrerPolicy="no-referrer" loading="lazy" className={cn("w-full h-full object-cover min-h-0", shown.length === 3 && i === 0 && "row-span-2")} />
            ))}
        </div>
    );
}

export function StoryCommunity({ grids, loading, error, hasMore, onLoadMore, onRefresh }: { grids: ShareSummary[]; loading: boolean; error: boolean; hasMore: boolean; onLoadMore: () => void; onRefresh: () => void }) {
    return (
        <div className="p-4">
            <div className="text-center mb-6 relative">
                <button type="button" onClick={onRefresh} disabled={loading} className="absolute right-0 top-0 p-1.5 text-zinc-500 hover:text-indigo-400 hover:bg-zinc-800 rounded-lg transition-all" title="Refresh Feed" aria-label="Refresh feed">
                    <Loader2 className={cn("w-4 h-4", loading && "animate-spin")} />
                </button>
                <Share2 className="w-8 h-8 text-indigo-500 mx-auto mb-2" />
                <h3 className="font-bold text-lg text-transparent bg-clip-text bg-gradient-to-r from-indigo-500 to-blue-500">Community Grids</h3>
                <p className="text-xs text-zinc-500">Discover what others are building</p>
            </div>
            {loading && grids.length === 0 ? (
                <div className="flex items-center justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-indigo-500" /></div>
            ) : grids.length > 0 ? (
                <>
                    <div data-testid="story-community" className="grid grid-cols-2 gap-3">
                        {grids.map((g) => (
                            <a key={g.id} href={storyViewPath(g.id)} target="_blank" rel="noopener noreferrer" className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden hover:border-indigo-500/50 transition-all group">
                                <div className="aspect-square bg-zinc-950 relative">
                                    {g.imageUrl ? (
                                        <img src={proxied(g.imageUrl, 384)} alt={g.title} className="w-full h-full object-cover" />
                                    ) : g.previews && g.previews.length > 0 ? (
                                        <PreviewMosaic urls={g.previews} title={g.title} />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-zinc-700"><span className="text-xs">No Preview</span></div>
                                    )}
                                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                        <span className="text-xs font-bold text-white bg-indigo-600 px-2 py-1 rounded-full">View</span>
                                    </div>
                                </div>
                                <div className="p-2">
                                    <h4 className="text-xs font-medium text-zinc-300 truncate">{g.title || "Untitled Grid"}</h4>
                                    <p className="text-[10px] text-zinc-500">{g.createdAt ? new Date(g.createdAt).toLocaleDateString() : ""}</p>
                                </div>
                            </a>
                        ))}
                    </div>
                    {hasMore && (
                        <button type="button" onClick={onLoadMore} disabled={loading} className="mt-4 w-full py-2 text-xs rounded-lg bg-zinc-900 border border-zinc-800 text-indigo-300 hover:border-indigo-500/50 disabled:opacity-60">
                            {loading ? "Loading…" : "Load more"}
                        </button>
                    )}
                </>
            ) : (
                <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
                    <p className="text-zinc-500 text-sm font-medium mb-1">{error ? "Couldn't load the feed." : "No grids yet."}</p>
                    <button type="button" onClick={onRefresh} className="text-indigo-400 text-xs hover:underline">Click to refresh</button>
                </div>
            )}
        </div>
    );
}
