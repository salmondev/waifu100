import type { Character, GridCell } from "@/types";

/**
 * The waifu grid's drop rules, pulled out of page.tsx unchanged (T-0009
 * item 1) so they are testable:
 *  - grid item -> trash: slot emptied;
 *  - grid item -> another cell: swap (same cell: nothing);
 *  - new item (sidebar/gallery) -> empty cell: placed;
 *  - new item -> occupied cell: nothing yet, ask to replace (pendingReplace).
 */
export interface DropSource {
    index?: number | null;
    character?: Character | null;
    type?: string;
}
export interface DropTarget {
    type?: string;
    index?: number;
}
export interface DropResult {
    grid: GridCell[];
    pendingReplace?: { index: number; newChar: Character; oldChar: Character };
    /** The cell that received something (for the drop animation/hints). */
    droppedAt?: number;
}

export function applyGridDrop(grid: GridCell[], source: DropSource | undefined, target: DropTarget | undefined): DropResult {
    if (!target) return { grid };
    if (target.type === "trash") {
        if (source?.index !== undefined && source.index !== null) {
            const next = [...grid];
            next[source.index] = { character: null };
            return { grid: next };
        }
        return { grid };
    }
    if (target.type === "cell" && typeof target.index === "number") {
        const targetIndex = target.index;
        const char = source?.character;
        if (!char) return { grid };
        const sourceIndex = source?.index;
        if (sourceIndex !== undefined && sourceIndex !== null) {
            if (sourceIndex === targetIndex) return { grid };
            const next = [...grid];
            const targetChar = next[targetIndex].character;
            next[targetIndex] = { character: char };
            next[sourceIndex] = { character: targetChar };
            return { grid: next, droppedAt: targetIndex };
        }
        const existing = grid[targetIndex].character;
        if (existing) return { grid, pendingReplace: { index: targetIndex, newChar: char, oldChar: existing }, droppedAt: targetIndex };
        const next = [...grid];
        next[targetIndex] = { character: char };
        return { grid: next, droppedAt: targetIndex };
    }
    return { grid };
}

/** Click-to-place on an empty cell (occupied cells open details instead). */
export function placeOnEmpty(grid: GridCell[], index: number, char: Character): GridCell[] | null {
    if (grid[index]?.character) return null;
    const next = [...grid];
    next[index] = { character: char };
    return next;
}
