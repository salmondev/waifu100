import { describe, expect, it } from "vitest";
import { parseWaifuStorage, placeCharacterOnWaifuGrid, resizeWaifuGrid, waifuSyncBody } from "@/lib/waifu-board";
import type { GridCell } from "@/types";

const cell = (name: string, img = "https://img.example.com/a.jpg"): GridCell => ({
    character: { mal_id: 1, name, images: { jpg: { image_url: img } } },
});

describe("waifu board", () => {
    it("an old size-less save stays a 100-cell board", () => {
        const d = parseWaifuStorage(JSON.stringify({ grid: [cell("Rin")], verdict: null }));
        expect(d.size).toBe(100);
        expect(d.grid).toHaveLength(100);
        expect(d.grid[0]?.character?.name).toBe("Rin");
        expect(d.shareId).toBeNull();
    });

    it("keeps a saved layout and share id", () => {
        const d = parseWaifuStorage(JSON.stringify({ size: 9, grid: [cell("A")], title: "Nine", shareId: "abc123" }));
        expect(d).toMatchObject({ size: 9, cols: null, title: "Nine", shareId: "abc123" });
        expect(resizeWaifuGrid(d.grid, 4)).toHaveLength(4);
        expect(resizeWaifuGrid(d.grid, 4)[0]?.character?.name).toBe("A");
    });

    it("will not sync a local-only image or an empty board", () => {
        const base = { size: 9, cols: null, title: "T", verdict: null, verdictFeedback: null };
        expect(waifuSyncBody({ ...base, grid: resizeWaifuGrid([], 9) })).toBeNull();
        expect(waifuSyncBody({ ...base, grid: resizeWaifuGrid([cell("A", "data:image/png;base64,AA")], 9) })).toBeNull();
        const body = waifuSyncBody({ ...base, grid: resizeWaifuGrid([cell("A")], 9) });
        expect(body).toMatchObject({ kind: "waifu", size: 9, customTitle: "T" });
    });

    it("places a gacha card in the first empty cell and refuses a duplicate or a full board", () => {
        const rin = { mal_id: 10, name: "Rin", images: { jpg: { image_url: "https://s4.anilist.co/rin.png" } } };
        const first = placeCharacterOnWaifuGrid(null, rin);
        expect(first.placed).toBe(true);
        expect(parseWaifuStorage(first.stored).grid[0]?.character?.name).toBe("Rin");
        const again = placeCharacterOnWaifuGrid(first.stored, rin);
        expect(again.placed).toBe(false);
        expect(again.full).toBe(false);
        const full = placeCharacterOnWaifuGrid(JSON.stringify({ size: 9, grid: Array.from({ length: 9 }, () => cell("A")) }), { mal_id: 11, name: "Saber", images: { jpg: { image_url: "https://s4.anilist.co/s.png" } } });
        expect(full.full).toBe(true);
        expect(full.placed).toBe(false);
    });
});
