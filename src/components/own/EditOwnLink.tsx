"use client";

import Link from "next/link";
import { Pencil } from "lucide-react";
import { useMyGrids } from "@/lib/my-grids";

/** Shown only when this browser created the grid. Opens the builder on that same link. */
export function EditOwnLink({ id, kind, className }: { id: string; kind: "waifu" | "story"; className?: string }) {
    const mine = useMyGrids();
    if (!mine.some((g) => g.id === id)) return null;
    const href = kind === "story" ? `/story?edit=${id}` : `/?edit=${id}`;
    return (
        <Link href={href} className={className}>
            <Pencil size={18} className="shrink-0" />
            <span className="truncate">Edit</span>
        </Link>
    );
}
