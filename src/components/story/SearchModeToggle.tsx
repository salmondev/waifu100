"use client";

import { useRef, type KeyboardEvent } from "react";
import type { MediaType } from "@/lib/share-schema";
import { cn } from "@/lib/utils";

/** The two search modes under the main search box, in display order. */
export const SEARCH_MODES: { type: MediaType; label: string }[] = [
    { type: "ANIME", label: "Anime" },
    { type: "MANGA", label: "Manga" },
];

/**
 * Anime / manga segmented control (a radio group): click, or arrow keys to move, Home/End to jump.
 * Only the checked option is in the tab order, as for any radio group.
 */
export function SearchModeToggle({ value, onChange }: { value: MediaType; onChange: (t: MediaType) => void }) {
    const refs = useRef<(HTMLButtonElement | null)[]>([]);
    const pick = (i: number) => {
        const next = SEARCH_MODES[(i + SEARCH_MODES.length) % SEARCH_MODES.length];
        onChange(next.type);
        refs.current[SEARCH_MODES.indexOf(next)]?.focus();
    };
    const onKey = (e: KeyboardEvent, i: number) => {
        if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); pick(i + 1); }
        else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); pick(i - 1); }
        else if (e.key === "Home") { e.preventDefault(); pick(0); }
        else if (e.key === "End") { e.preventDefault(); pick(SEARCH_MODES.length - 1); }
    };
    return (
        <div role="radiogroup" aria-label="Search for" data-testid="search-mode" className="mt-2 grid grid-cols-2 gap-1 p-1 rounded-lg bg-zinc-900 border border-zinc-800">
            {SEARCH_MODES.map((m, i) => {
                const on = value === m.type;
                return (
                    <button
                        key={m.type}
                        ref={(el) => { refs.current[i] = el; }}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        tabIndex={on ? 0 : -1}
                        onClick={() => onChange(m.type)}
                        onKeyDown={(e) => onKey(e, i)}
                        className={cn(
                            "py-1.5 rounded-md text-sm font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-purple-500",
                            on ? "bg-purple-600 text-white shadow" : "text-zinc-400 hover:text-white hover:bg-zinc-800"
                        )}
                    >
                        {m.label}
                    </button>
                );
            })}
        </div>
    );
}
