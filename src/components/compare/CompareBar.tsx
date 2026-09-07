"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { GitCompareArrows, Loader2, X } from "lucide-react";
import type { ShareSummary } from "@/lib/share-summary";
import { shareCardPath } from "@/lib/share-card";
import { cn } from "@/lib/utils";

/**
 * The compare bar that sits above the showcase.
 *
 * It is deliberately not a button that opens something: two empty slots and a
 * × between them say what the feature does without anyone pressing anything,
 * which is the whole reason it lives here rather than behind a toggle. Picking
 * happens by tapping the cards below, so a comparison starts and finishes on
 * one page.
 *
 * Sticky, because the second pick is usually further down the feed than the
 * first, and a bar that scrolled away would mean scrolling back up to press it.
 */

export type CompareSlot = "a" | "b";

interface CompareBarProps {
    a: ShareSummary | null;
    b: ShareSummary | null;
    /** Which slot the next tapped card goes into. */
    active: CompareSlot;
    onFocus: (slot: CompareSlot) => void;
    onClear: (slot: CompareSlot) => void;
}

function Slot({
    slot,
    grid,
    active,
    onFocus,
    onClear,
}: {
    slot: CompareSlot;
    grid: ShareSummary | null;
    active: boolean;
    onFocus: () => void;
    onClear: () => void;
}) {
    const label = slot === "a" ? "Grid A" : "Grid B";

    return (
        <button
            type="button"
            onClick={onFocus}
            aria-label={grid ? `${label}: ${grid.title}` : `Choose ${label}`}
            className={cn(
                "flex min-w-0 flex-1 items-center gap-2 rounded-xl px-2 py-1.5 text-left transition-colors sm:gap-3 sm:px-3 sm:py-2",
                grid
                    ? "border border-purple-500/40 bg-purple-500/10"
                    : "border border-dashed border-zinc-700 bg-zinc-900/40",
                // The active slot is where the next tap lands, so it has to be
                // obvious which one that is before the tap, not after.
                active && "ring-2 ring-purple-500/60"
            )}
        >
            <div className="h-8 w-8 shrink-0 overflow-hidden rounded-lg bg-zinc-800 sm:h-9 sm:w-9">
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
                <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-500 sm:text-[10px]">
                    {label}
                </p>
                <p
                    className={cn(
                        "truncate text-xs sm:text-sm",
                        grid ? "text-white" : "text-zinc-600"
                    )}
                >
                    {grid ? grid.title : "Tap a grid below"}
                </p>
            </div>
            {grid && (
                <span
                    role="button"
                    tabIndex={0}
                    aria-label={`Clear ${label}`}
                    onClick={(e) => {
                        e.stopPropagation();
                        onClear();
                    }}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            e.stopPropagation();
                            onClear();
                        }
                    }}
                    className="shrink-0 cursor-pointer rounded-full p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-white"
                >
                    <X className="h-3.5 w-3.5" />
                </span>
            )}
        </button>
    );
}

export function CompareBar({ a, b, active, onFocus, onClear }: CompareBarProps) {
    const router = useRouter();
    const ready = !!a && !!b && a.id !== b.id;

    /**
     * Navigating to /compare reads two grids out of Redis before the browser
     * gets anything to paint, and until it does the visitor is still looking at
     * this page with this button apparently unpressed. The route has a skeleton
     * of its own now, but the first acknowledgement has to be here, on the thing
     * they actually touched.
     */
    const [navigating, startNavigating] = useTransition();

    return (
        <div className="sticky top-0 z-30 -mx-4 mb-6 border-b border-zinc-800/60 bg-black/80 px-4 py-3 backdrop-blur-md">
            <div className="flex items-center gap-2 sm:gap-3">
                <Slot
                    slot="a"
                    grid={a}
                    active={active === "a"}
                    onFocus={() => onFocus("a")}
                    onClear={() => onClear("a")}
                />
                <span className="shrink-0 text-sm font-bold text-purple-500 sm:text-lg">×</span>
                <Slot
                    slot="b"
                    grid={b}
                    active={active === "b"}
                    onFocus={() => onFocus("b")}
                    onClear={() => onClear("b")}
                />

                <button
                    type="button"
                    disabled={!ready || navigating}
                    aria-busy={navigating}
                    onClick={() =>
                        ready &&
                        startNavigating(() => router.push(`/compare?a=${a.id}&b=${b.id}`))
                    }
                    className={cn(
                        "flex shrink-0 items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition-all sm:px-5",
                        ready
                            ? // Same sweeping gradient as the GIF chip and GIF MODE, so
                              // the app has one "this is the lively thing" treatment
                              // rather than a new accent per feature.
                              "gif-badge text-white hover:brightness-110"
                            : "cursor-not-allowed bg-zinc-900 text-zinc-600",
                        navigating && "cursor-wait"
                    )}
                >
                    {/* The spinner takes the icon's place rather than being
                        added beside it, so the button does not change width and
                        shove the slots along at the moment it is pressed. */}
                    {navigating ? (
                        <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                    ) : (
                        <GitCompareArrows className="h-4 w-4 shrink-0" />
                    )}
                    {/* The word "compare" stays on the button in both states -
                        the disabled label used to read "Pick two grids", which
                        never said what picking them was for. */}
                    <span className="hidden sm:inline">
                        {navigating
                            ? "Comparing…"
                            : ready
                              ? "Compare these two"
                              : "Compare two grids"}
                    </span>
                </button>
            </div>
        </div>
    );
}
