"use client";

import { useState } from "react";
import { clampSide, STORY_MAX_SIDE, STORY_MIN_CELLS, STORY_MIN_SIDE } from "@/lib/story/config";
import { cn } from "@/lib/utils";

/**
 * Custom rows x cols for a story grid (2026-10-15). Each side is clamped to 1-10 as it is typed
 * (non-numbers fall back to 1) and Apply stays disabled below 2 cells, so the builder can only
 * ever produce a layout the server also accepts (isStoryLayout).
 */
export function CustomSizeControl({ rows, cols, active, onApply }: { rows: number; cols: number; active: boolean; onApply: (rows: number, cols: number) => void }) {
    const [open, setOpen] = useState(false);
    const [r, setR] = useState(rows);
    const [c, setC] = useState(cols);
    const ok = r * c >= STORY_MIN_CELLS;
    const field = (label: string, value: number, set: (n: number) => void) => (
        <label className="flex items-center gap-1.5 text-xs text-zinc-400">
            {label}
            <input
                type="number"
                inputMode="numeric"
                min={STORY_MIN_SIDE}
                max={STORY_MAX_SIDE}
                step={1}
                value={value}
                aria-label={label}
                onChange={(e) => set(clampSide(e.target.value))}
                className="w-14 px-2 py-1 rounded-md bg-zinc-950 border border-zinc-700 text-center text-sm text-white tabular-nums outline-none focus:border-purple-500"
            />
        </label>
    );
    return (
        <div className="relative">
            <button
                type="button"
                aria-expanded={open}
                aria-pressed={active}
                onClick={() => { setR(rows); setC(cols); setOpen((o) => !o); }}
                className={cn("px-3 py-1.5 text-sm rounded-lg border border-zinc-800", active ? "bg-purple-600 text-white font-semibold" : "bg-zinc-900 text-zinc-400 hover:text-white")}
            >
                {active ? `Custom ${rows}×${cols}` : "Custom…"}
            </button>
            {open && (
                <div role="group" aria-label="Custom grid size" data-testid="custom-size" className="absolute z-30 left-0 mt-2 w-64 p-3 rounded-xl bg-zinc-900 border border-zinc-700 shadow-xl space-y-3">
                    <div className="flex items-center justify-between gap-2">
                        {field("Rows", r, setR)}
                        <span className="text-zinc-600">×</span>
                        {field("Columns", c, setC)}
                    </div>
                    <p className="text-[11px] text-zinc-500">
                        {ok ? `${r * c} slots. Each side ${STORY_MIN_SIDE}–${STORY_MAX_SIDE}.` : `At least ${STORY_MIN_CELLS} slots.`}
                    </p>
                    <div className="flex justify-end gap-2">
                        <button type="button" onClick={() => setOpen(false)} className="px-3 py-1.5 text-xs rounded-lg text-zinc-400 hover:text-white">Cancel</button>
                        <button type="button" disabled={!ok} onClick={() => { onApply(r, c); setOpen(false); }} className="px-3 py-1.5 text-xs rounded-lg bg-purple-600 text-white font-semibold disabled:opacity-40">Apply</button>
                    </div>
                </div>
            )}
        </div>
    );
}
