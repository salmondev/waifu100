"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, GitCompareArrows } from "lucide-react";
import { cn } from "@/lib/utils";
import { readUserId, USER_ID_HEADER } from "@/lib/user-id";
import type { ShareSummary } from "@/lib/share-summary";

/**
 * The way into a comparison, on someone else's grid.
 *
 * It only appears for a browser that already has a grid of its own, because
 * that is the only case where one click can produce a result. Someone without
 * one is not offered a broken button - the "Create Your Own" link next to it is
 * the honest path for them, and the comparison is the reason to take it.
 *
 * The owner id is read from localStorage and sent as a header, never a query
 * parameter, exactly as /api/my-grids requires (see src/lib/user-id.ts).
 */
export function CompareWithMine({ shareId }: { shareId: string }) {
    const [grids, setGrids] = useState<ShareSummary[]>([]);
    const [open, setOpen] = useState(false);
    const boxRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const userId = readUserId();
        if (!userId) return;

        let cancelled = false;
        fetch("/api/my-grids", { headers: { [USER_ID_HEADER]: userId } })
            .then((res) => (res.ok ? res.json() : { grids: [] }))
            .then((data) => {
                if (cancelled) return;
                const mine: ShareSummary[] = Array.isArray(data.grids) ? data.grids : [];
                // Comparing a grid with itself is a 100% match and no fun.
                setGrids(mine.filter((g) => g.id !== shareId));
            })
            .catch(() => {
                // A failed lookup means no button, not an error message: this is
                // an extra on someone else's page.
            });

        return () => {
            cancelled = true;
        };
    }, [shareId]);

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

    if (grids.length === 0) return null;

    const buttonClass =
        "flex w-full items-center justify-center gap-2 rounded-lg border border-purple-500/30 bg-purple-500/10 px-3 py-2 text-sm font-medium text-purple-300 transition-colors hover:bg-purple-500/20 sm:text-base";

    // The visitor's grid is side A, so the page reads "only in <their grid>" as
    // the list of characters they themselves have not picked.
    if (grids.length === 1) {
        return (
            <Link href={`/compare?a=${grids[0].id}&b=${shareId}`} className={buttonClass}>
                <GitCompareArrows size={18} className="shrink-0" />
                <span className="truncate">Compare with my grid</span>
            </Link>
        );
    }

    return (
        <div ref={boxRef} className="relative w-full">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                aria-haspopup="menu"
                className={buttonClass}
            >
                <GitCompareArrows size={18} className="shrink-0" />
                <span className="truncate">Compare with my grid</span>
                <ChevronDown
                    size={16}
                    className={cn("shrink-0 transition-transform", open && "rotate-180")}
                />
            </button>

            {open && (
                <div
                    role="menu"
                    className="absolute right-0 z-50 mt-2 max-h-72 w-full min-w-[240px] overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-900 p-1 shadow-2xl shadow-black/60"
                >
                    {grids.map((grid) => (
                        <Link
                            key={grid.id}
                            role="menuitem"
                            href={`/compare?a=${grid.id}&b=${shareId}`}
                            className="block rounded-lg px-3 py-2 text-left transition-colors hover:bg-zinc-800"
                        >
                            <p className="truncate text-sm text-white">{grid.title}</p>
                            <p className="text-[11px] text-zinc-500">{grid.count} characters</p>
                        </Link>
                    ))}
                </div>
            )}
        </div>
    );
}
