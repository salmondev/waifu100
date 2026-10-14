import { cn } from "@/lib/utils";
import type { MediaType } from "@/lib/share-schema";

/** Anime / Manga badge (T-0010: one search, both types). */
export function TypeBadge({ type, className }: { type: MediaType | "CUSTOM"; className?: string }) {
    const label = type === "MANGA" ? "Manga" : type === "ANIME" ? "Anime" : "Custom";
    return (
        <span
            className={cn(
                "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide border",
                type === "MANGA" ? "bg-pink-500/15 text-pink-300 border-pink-500/30" : type === "ANIME" ? "bg-sky-500/15 text-sky-300 border-sky-500/30" : "bg-amber-500/15 text-amber-300 border-amber-500/30",
                className
            )}
        >
            {label}
        </span>
    );
}
