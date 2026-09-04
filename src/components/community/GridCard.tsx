"use client";

import Link from "next/link";
import { Calendar, ExternalLink, Grid3x3, Loader2, Trash2 } from "lucide-react";
import { shareCardPath } from "@/lib/share-card";
import type { ShareSummary } from "@/lib/share-summary";

interface GridCardProps {
    grid: ShareSummary;
    /** Present only on the owner's own list; absent on the public showcase. */
    onDelete?: (id: string) => void;
    deleting?: boolean;
}

/**
 * One share, as a card. Shared by the public showcase and "My Grids" so a grid
 * looks the same wherever it is listed - the count and GIF chips in particular
 * only teach people what they mean if they never move.
 */
export function GridCard({ grid, onDelete, deleting = false }: GridCardProps) {
    // A share whose thumbnail upload failed has no imageUrl; the OG route draws
    // one from the grid data so the card is never blank.
    const preview = grid.imageUrl || shareCardPath(grid.id);
    const isComplete = grid.count >= 100;

    return (
        <div className="group relative bg-zinc-900/40 border border-zinc-800/50 rounded-2xl overflow-hidden hover:border-purple-500/50 hover:shadow-2xl hover:shadow-purple-900/20 transition-all duration-300 hover:-translate-y-1 h-fit">
            <Link
                href={`/view/${grid.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block"
            >
                {/* Image Container */}
                <div className="aspect-square relative overflow-hidden bg-zinc-950">
                    {/* Blur Backlayer */}
                    <img
                        src={preview}
                        alt=""
                        className="absolute inset-0 w-full h-full object-cover blur-xl opacity-50 scale-110"
                    />
                    {/* Main Image */}
                    <img
                        src={preview}
                        alt={grid.title}
                        className="relative w-full h-full object-contain z-10 transition-transform duration-500 group-hover:scale-105"
                    />

                    {/* Overlay Gradient */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent opacity-60 group-hover:opacity-40 transition-opacity z-20" />

                    {/* View Button Overlay on Hover */}
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 z-30 bg-black/20 backdrop-blur-[2px]">
                        <span className="px-5 py-2 bg-white/10 hover:bg-white/20 border border-white/20 backdrop-blur-md rounded-full text-white font-medium flex items-center gap-2 transform translate-y-4 group-hover:translate-y-0 transition-transform duration-300 shadow-xl">
                            View Grid <ExternalLink className="w-4 h-4" />
                        </span>
                    </div>
                </div>

                {/* Content */}
                <div className="p-4 relative z-20 bg-zinc-900/80 backdrop-blur-sm border-t border-white/5">
                    <h3
                        className="font-bold text-lg text-white truncate group-hover:text-purple-300 transition-colors"
                        title={grid.title}
                    >
                        {grid.title || "Untitled Grid"}
                    </h3>

                    <div className="flex items-center justify-between mt-3 text-xs text-zinc-500 gap-2">
                        <div className="flex items-center gap-3 min-w-0">
                            <span className="flex items-center gap-1.5 shrink-0">
                                <Calendar className="w-3.5 h-3.5" />
                                {grid.createdAt
                                    ? new Date(grid.createdAt).toLocaleDateString(undefined, {
                                          month: "short",
                                          day: "numeric",
                                          year: "numeric",
                                      })
                                    : "—"}
                            </span>

                            {/* How full the grid is. A 20-character grid and a
                                finished one used to look identical from here. */}
                            <span
                                title={`${grid.count} of 100 slots filled`}
                                className={
                                    "flex items-center gap-1 shrink-0 tabular-nums " +
                                    (isComplete ? "text-amber-400 font-semibold" : "")
                                }
                            >
                                <Grid3x3 className="w-3.5 h-3.5" />
                                {grid.count}
                                <span className="text-zinc-600">/100</span>
                            </span>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                            {/* Animated grids get a chip beside the id, in the GIF MODE
                                palette so the toggle and the badge teach each other. */}
                            {grid.hasGif && (
                                <span
                                    title="This grid contains animated characters"
                                    className="gif-badge inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-widest text-white"
                                >
                                    <span className="h-1 w-1 rounded-full bg-white/90 animate-pulse" />
                                    GIF
                                </span>
                            )}

                            {/* ID Badge */}
                            <span className="font-mono bg-zinc-800 px-1.5 py-0.5 rounded text-[9px] text-zinc-600 uppercase tracking-widest">
                                {grid.id.slice(0, 5)}
                            </span>
                        </div>
                    </div>
                </div>
            </Link>

            {/* Delete sits outside the Link so it is never a stray click on the
                way to opening a grid. */}
            {onDelete && (
                <button
                    type="button"
                    onClick={() => onDelete(grid.id)}
                    disabled={deleting}
                    aria-label={`Delete "${grid.title}"`}
                    title="Delete this grid"
                    className="absolute top-3 right-3 z-40 p-2 rounded-full bg-black/70 backdrop-blur-sm border border-white/10 text-zinc-300 hover:text-white hover:bg-red-600/80 hover:border-red-400/40 transition-colors disabled:opacity-60 disabled:cursor-wait"
                >
                    {deleting ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                        <Trash2 className="w-4 h-4" />
                    )}
                </button>
            )}
        </div>
    );
}
