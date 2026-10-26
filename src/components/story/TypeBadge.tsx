import { cn } from "@/lib/utils";
import type { MediaType } from "@/lib/share-schema";

const LABEL: Record<MediaType | "CUSTOM", string> = { ANIME: "Anime", MANGA: "Manga", NOVEL: "Light Novel", CUSTOM: "Custom" };
const COLOR: Record<MediaType | "CUSTOM", string> = {
    ANIME: "bg-sky-500/15 text-sky-300 border-sky-500/30",
    MANGA: "bg-pink-500/15 text-pink-300 border-pink-500/30",
    NOVEL: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    CUSTOM: "bg-amber-500/15 text-amber-300 border-amber-500/30",
};

/** Anime / Manga / Light Novel / Custom badge (T-0010: one search, both types; NOVEL 2026-10-15). */
export function TypeBadge({ type, className }: { type: MediaType | "CUSTOM"; className?: string }) {
    const key = type in LABEL ? type : "CUSTOM";
    return (
        <span
            className={cn(
                "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide border whitespace-nowrap",
                COLOR[key],
                className
            )}
        >
            {LABEL[key]}
        </span>
    );
}
