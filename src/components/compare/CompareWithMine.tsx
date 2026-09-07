"use client";

import Link, { useLinkStatus } from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, GitCompareArrows, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMyGrids } from "@/lib/my-grids";

/**
 * The compare icon, or a spinner once its link has been followed.
 *
 * `useLinkStatus` only reports on the Link it is rendered inside, which is why
 * this is a component rather than a hook call up in the parent: these are real
 * navigations to a page that reads two grids from Redis, and without this the
 * tap looks like it missed.
 */
function CompareIcon({ size }: { size: number }) {
    const { pending } = useLinkStatus();
    return pending ? (
        <Loader2 size={size} className="shrink-0 animate-spin" />
    ) : (
        <GitCompareArrows size={size} className="shrink-0" />
    );
}

/** Occupies no space until its row is the one being navigated to. */
function MenuSpinner() {
    const { pending } = useLinkStatus();
    return pending ? (
        <Loader2 size={14} className="shrink-0 animate-spin text-purple-300" />
    ) : null;
}

/**
 * The way into a comparison, from someone else's grid.
 *
 * It only appears for a browser that already has a grid of its own, because
 * that is the only case where one click can produce a result. Someone without
 * one is not offered a broken button - the "Create Your Own" link next to it is
 * the honest path for them, and the comparison is the reason to take it.
 *
 * The list comes from the shared store in src/lib/my-grids.ts: cached in
 * localStorage so the button lands with the rest of the page rather than after
 * a Redis round trip, and fetched once per page no matter how many cards ask.
 */
export function CompareWithMine({
    shareId,
    variant = "button",
}: {
    shareId: string;
    /** "button" sits in the view page header; "card" is the showcase overlay. */
    variant?: "button" | "card";
}) {
    const mine = useMyGrids();
    // Comparing a grid with itself is a 100% match and no fun.
    const grids = mine.filter((g) => g.id !== shareId);

    const [open, setOpen] = useState(false);
    const boxRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const onClick = (e: MouseEvent) => {
            if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") setOpen(false);
        };
        document.addEventListener("mousedown", onClick);
        window.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("mousedown", onClick);
            window.removeEventListener("keydown", onKey);
        };
    }, [open]);

    const isCard = variant === "card";

    const className = isCard
        ? "flex items-center gap-1.5 rounded-full border border-white/10 bg-black/70 px-2.5 py-1.5 text-[11px] font-medium text-purple-200 backdrop-blur-sm transition-colors hover:bg-purple-600/70 hover:text-white"
        : "flex w-full items-center justify-center gap-2 rounded-lg border border-purple-500/30 bg-purple-500/10 px-3 py-2 text-sm font-medium text-purple-300 transition-colors hover:bg-purple-500/20 sm:text-base";

    const iconSize = isCard ? 14 : 18;

    // Someone with no grid of their own is not shut out any more: the button
    // takes them to the picker with this grid already in one slot, so they can
    // put any two grids side by side (and see what they would get by making
    // one). Only the wording changes.
    if (grids.length === 0) {
        return (
            <Link
                href={`/compare?b=${shareId}`}
                title="Compare this grid with another"
                className={className}
            >
                <CompareIcon size={iconSize} />
                <span className="truncate">{isCard ? "Compare" : "Compare with another grid"}</span>
            </Link>
        );
    }

    const label = isCard ? "Compare" : "Compare with my grid";

    // Their own grid goes in side A, so the page reads "only in <the other
    // grid>" as the list of characters they themselves have not picked.
    if (grids.length === 1) {
        return (
            <Link
                href={`/compare?a=${grids[0].id}&b=${shareId}`}
                title={`Compare with "${grids[0].title}"`}
                className={className}
            >
                <CompareIcon size={iconSize} />
                <span className="truncate">{label}</span>
            </Link>
        );
    }

    return (
        <div ref={boxRef} className={cn("relative", !isCard && "w-full")}>
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                aria-haspopup="menu"
                className={className}
            >
                {/* Not a CompareIcon: this one only opens the menu, and there is
                    nothing to wait for until a grid in it is chosen. */}
                <GitCompareArrows size={iconSize} className="shrink-0" />
                <span className="truncate">{label}</span>
                <ChevronDown
                    size={isCard ? 12 : 16}
                    className={cn("shrink-0 transition-transform", open && "rotate-180")}
                />
            </button>

            {open && (
                <div
                    role="menu"
                    className={cn(
                        "absolute right-0 z-50 max-h-72 w-max min-w-[220px] max-w-[280px] overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-900 p-1 shadow-2xl shadow-black/60",
                        // On a card the control sits at the bottom edge, so the
                        // menu opens upwards or it would fall out of the tile.
                        isCard ? "bottom-full mb-2" : "mt-2 w-full"
                    )}
                >
                    {grids.map((grid) => (
                        <Link
                            key={grid.id}
                            role="menuitem"
                            href={`/compare?a=${grid.id}&b=${shareId}`}
                            className="flex items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-zinc-800"
                        >
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-sm text-white">{grid.title}</p>
                                <p className="text-[11px] text-zinc-500">
                                    {grid.count} characters
                                </p>
                            </div>
                            {/* The menu stays open while the page loads, so the
                                chosen row is the only thing that can show which
                                one is on its way. */}
                            <MenuSpinner />
                        </Link>
                    ))}

                    {/* The other side does not have to be one of theirs. */}
                    <Link
                        role="menuitem"
                        href={`/compare?b=${shareId}`}
                        className="mt-1 block border-t border-zinc-800 px-3 py-2 text-left text-xs text-zinc-400 transition-colors hover:text-purple-300"
                    >
                        Pick another grid…
                    </Link>
                </div>
            )}
        </div>
    );
}
