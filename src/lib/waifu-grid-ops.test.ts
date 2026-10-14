import { describe, expect, it } from "vitest";
import { applyGridDrop, placeOnEmpty } from "@/lib/waifu-grid-ops";
import type { GridCell } from "@/types";

const c = (n: number) => ({ mal_id: n, name: `C${n}`, images: { jpg: { image_url: `https://x/${n}.jpg` } } });
const grid = (): GridCell[] => Array.from({ length: 100 }, (_, i) => ({ character: i === 0 ? c(1) : i === 5 ? c(2) : null }));

describe("waifu drop rules (characterization)", () => {
    it("trash empties the source slot; trash from sidebar does nothing", () => {
        expect(applyGridDrop(grid(), { index: 0, character: c(1), type: "grid" }, { type: "trash" }).grid[0].character).toBeNull();
        const g = grid();
        expect(applyGridDrop(g, { character: c(9), type: "sidebar" }, { type: "trash" }).grid).toBe(g);
    });
    it("grid -> grid swaps; same cell is a no-op", () => {
        const r = applyGridDrop(grid(), { index: 0, character: c(1) }, { type: "cell", index: 5 });
        expect(r.grid[5].character?.name).toBe("C1");
        expect(r.grid[0].character?.name).toBe("C2");
        const g = grid();
        expect(applyGridDrop(g, { index: 0, character: c(1) }, { type: "cell", index: 0 }).grid).toBe(g);
        const toEmpty = applyGridDrop(grid(), { index: 0, character: c(1) }, { type: "cell", index: 99 });
        expect(toEmpty.grid[99].character?.name).toBe("C1");
        expect(toEmpty.grid[0].character).toBeNull();
    });
    it("new item fills an empty cell, asks before replacing", () => {
        expect(applyGridDrop(grid(), { character: c(7), type: "sidebar" }, { type: "cell", index: 2 }).grid[2].character?.name).toBe("C7");
        const r = applyGridDrop(grid(), { character: c(7), type: "sidebar" }, { type: "cell", index: 5 });
        expect(r.grid[5].character?.name).toBe("C2");
        expect(r.pendingReplace).toMatchObject({ index: 5, newChar: { name: "C7" }, oldChar: { name: "C2" } });
    });
    it("no target / no character does nothing", () => {
        const g = grid();
        expect(applyGridDrop(g, { index: 0, character: c(1) }, undefined).grid).toBe(g);
        expect(applyGridDrop(g, { index: 3, character: null }, { type: "cell", index: 4 }).grid).toBe(g);
    });
    it("click-to-place only on empty cells", () => {
        expect(placeOnEmpty(grid(), 1, c(3))![1].character?.name).toBe("C3");
        expect(placeOnEmpty(grid(), 0, c(3))).toBeNull();
    });
});
