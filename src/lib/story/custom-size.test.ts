import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { clampSide, isStoryLayout, storyColumns, storySizeLabel, STORY_MAX_CELLS } from "@/lib/story/config";
import { buildStoryPayload, cleanStoryCells, decodeShare, ShareValidationError } from "@/lib/share-schema";
import { emptyDraft, parseDraft, resizeDraft } from "@/lib/story/draft";
import { boardFromFile, boardToFile } from "@/lib/story/board-file";
import { exportLayout } from "@/lib/story/export";
import { summarizeShare } from "@/lib/share-summary";
import { makeMemoryShareRepo } from "@/server/share-repo";
import { createShare } from "@/server/share-service";

const img = "https://s4.anilist.co/file/a/1.jpg";
const cell = (i: number) => ({ i, a: i + 1, t: "ANIME", img });
const run = <A, E>(eff: Effect.Effect<A, E, never>) => Effect.runPromise(Effect.match(eff, { onFailure: (e) => ({ err: e as { _tag: string; reason?: string } }), onSuccess: (a) => ({ ok: a }) }));

describe("custom layout limits (1-10 per side, 2-100 cells, integers)", () => {
    it.each([
        [9, undefined, true], [10, null, true], [25, undefined, true], [100, undefined, true],
        [12, undefined, false], // not a preset, and no cols
        [12, 4, true], [12, 3, true], [2, 1, true], [2, 2, true], [10, 1, true], [10, 10, true], [10, 11, false], [100, 10, true],
        [1, 1, false], // 1 cell
        [110, 10, false], [11, 11, false], [20, 0, false], [20, -2, false], [-4, 2, false], [12, 5, false],
        [12, 4.5, false], [12.5, 5, false], [12, "4", false], ["12", 4, false], [NaN, 2, false], [Infinity, 10, false], [12, true, false],
    ] as [unknown, unknown, boolean][])("isStoryLayout(%s, %s) = %s", (size, cols, ok) => {
        expect(isStoryLayout(size, cols)).toBe(ok);
    });
    it("clampSide keeps typed input in 1-10 integers", () => {
        expect([clampSide("abc"), clampSide(0), clampSide(-3), clampSide(11), clampSide(3.6), clampSide("7"), clampSide("")]).toEqual([1, 1, 1, 10, 4, 7, 1]);
    });
    it("never more cells than the largest preset", () => expect(STORY_MAX_CELLS).toBe(100));
    it("columns and labels", () => {
        expect(storyColumns(12, 4)).toBe(4);
        expect(storyColumns(12, 5)).toBe(10); // invalid cols are ignored, never trusted
        expect(storyColumns(10)).toBe(5);
        expect(storySizeLabel(9)).toBe("3×3");
        expect(storySizeLabel(24, 6)).toBe("4×6");
        expect(storySizeLabel(10, 1)).toBe("10×1");
    });
});

describe("server validation (cleanStoryCells / createShare)", () => {
    it("accepts a custom rows x cols and drops cells past the end", () => {
        const r = cleanStoryCells(12, [cell(0), cell(11), cell(12)], 4);
        expect(r).toMatchObject({ size: 12, cols: 4 });
        expect(r.cells.map((c) => c.i)).toEqual([0, 11]);
    });
    it.each([[12, undefined], [12, 5], [12, 4.5], [12, "4"], [110, 10], [1, 1], [12, 0]])("rejects size %s cols %s", (size, cols) => {
        expect(() => cleanStoryCells(size, [cell(0)], cols)).toThrow(ShareValidationError);
    });
    it("POST /api/share path: custom stored with meta.cols; out-of-range or non-integer rejected", async () => {
        const mem = makeMemoryShareRepo();
        const ok = await run(createShare({ kind: "story", size: 12, cols: 4, grid: [cell(0)] }, { id: "c1" }).pipe(Effect.provide(mem.layer)));
        expect("ok" in ok).toBe(true);
        expect(JSON.parse(mem.strings.get("waifu100:share:c1")!).meta).toMatchObject({ kind: "story", size: 12, cols: 4 });
        for (const [size, cols] of [[12, 11], [12, 2.5], [121, 11], [12, "4"], [13, 4]] as [unknown, unknown][]) {
            const bad = await run(createShare({ kind: "story", size, cols, grid: [cell(0)] }, { id: "x" }).pipe(Effect.provide(mem.layer)));
            expect("err" in bad && bad.err._tag).toBe("InvalidShare");
        }
        expect(mem.strings.has("waifu100:share:x")).toBe(false);
    });
    it("preset shares keep exactly the old payload (no cols key)", () => {
        const p = buildStoryPayload({ title: "t", size: 10, cells: [cell(0) as never], createdAt: "2026-01-01T00:00:00Z" });
        expect(Object.keys(p.meta).sort()).toEqual(["createdAt", "hasImage", "imageUrl", "kind", "size", "title", "titleStyle", "userId", "v"].sort());
        expect(p.meta).not.toHaveProperty("cols");
    });
});

describe("backward compatibility", () => {
    const legacy = (meta: Record<string, unknown>) => JSON.stringify({ meta: { title: "Old", v: 2, kind: "story", ...meta }, grid: [cell(0), cell(9)] });
    it("an old story share (size only) decodes unchanged, preset layout", () => {
        const d = decodeShare(legacy({ size: 10 }))!;
        expect(d).toMatchObject({ kind: "story", size: 10, cols: null, count: 2 });
        expect(storyColumns(d.size, d.cols)).toBe(5);
        expect(summarizeShare("o", legacy({ size: 10 }))).not.toHaveProperty("cols");
    });
    it("a custom share round-trips (decode + summary)", () => {
        const raw = legacy({ size: 12, cols: 4 });
        expect(decodeShare(raw)).toMatchObject({ size: 12, cols: 4 });
        expect(summarizeShare("c", raw)).toMatchObject({ size: 12, cols: 4 });
    });
    it("garbage cols on a stored share is ignored, never trusted", () => {
        expect(decodeShare(legacy({ size: 10, cols: "x" }))).toMatchObject({ size: 10, cols: null });
        expect(decodeShare(legacy({ size: 10, cols: 3 }))).toMatchObject({ size: 10, cols: null }); // 10 % 3 != 0
    });
    it("old drafts (no cols) load unchanged; bad custom drafts fall back to 3x3", () => {
        expect(parseDraft(JSON.stringify({ size: 10, items: [] }))).toMatchObject({ size: 10, cols: null });
        expect(parseDraft(JSON.stringify({ size: 24, cols: 6, items: [] }))).toMatchObject({ size: 24, cols: 6 });
        expect(parseDraft(JSON.stringify({ size: 24, items: [] }))).toMatchObject({ size: 9, cols: null });
        expect(parseDraft(JSON.stringify({ size: 24, cols: 5, items: [] }))).toMatchObject({ size: 9, cols: null });
        expect(parseDraft(JSON.stringify({ size: 400, cols: 20, items: [] }))).toMatchObject({ size: 9, cols: null });
        expect(parseDraft(JSON.stringify({ size: 24, cols: 6, items: [] })).items).toHaveLength(24);
    });
    it("resize ignores out-of-range layouts", () => {
        const d = emptyDraft();
        expect(resizeDraft(d, 121, 11)).toBe(d);
        expect(resizeDraft(d, 24, 6)).toMatchObject({ size: 24, cols: 6 });
    });
    it("board files: old ones load, custom ones round-trip, bad cols rejected", () => {
        const old = JSON.stringify({ format: "story100-board", version: 1, size: 10, cells: [cell(0)] });
        expect(boardFromFile(old).draft).toMatchObject({ size: 10, cols: null });
        const custom = { ...emptyDraft(24, 6), items: Array.from({ length: 24 }, (_, i) => (i === 0 ? { id: 1, type: "ANIME" as const, title: "A", cover: img, src: "anilist" as const } : null)) };
        expect(boardFromFile(boardToFile(custom)).draft).toMatchObject({ size: 24, cols: 6 });
        expect(() => boardFromFile(JSON.stringify({ format: "story100-board", version: 1, size: 24, cols: 7, cells: [cell(0)] }))).toThrow(/damaged/);
    });
});

describe("non-square rendering geometry", () => {
    it("OG card fits any custom layout inside the 800px grid box, 2:3 cells", async () => {
        const { ogLayout } = await import("@/lib/share-og");
        for (let r = 1; r <= 10; r++) for (let c = 1; c <= 10; c++) {
            if (r * c < 2) continue;
            const l = ogLayout("story", r * c, c);
            expect([l.columns, l.rows]).toEqual([c, r]);
            expect(l.width).toBeLessThanOrEqual(800);
            expect(l.height).toBeLessThanOrEqual(800);
            expect(l.cell).toBeGreaterThanOrEqual(53);
        }
        expect(ogLayout()).toEqual({ columns: 10, rows: 10, total: 100, cell: 80, cellH: 80, width: 800, height: 800 }); // waifu unchanged
    });
    it("PNG export uses the custom columns", () => {
        expect(exportLayout(24, "overlay", 6)).toMatchObject({ cols: 6, rows: 4 });
        expect(exportLayout(10)).toMatchObject({ cols: 5, rows: 2 });
    });
});
