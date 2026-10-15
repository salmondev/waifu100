import { describe, expect, it } from "vitest";
import { parseWaifuStorage, resizeWaifuGrid, waifuSyncBody } from "@/lib/waifu-board";
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
});
