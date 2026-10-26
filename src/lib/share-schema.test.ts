import { describe, expect, it } from "vitest";
import {
    buildStoryPayload,
    buildWaifuPayload,
    cleanStoryCells,
    decodeShare,
    ShareValidationError,
} from "@/lib/share-schema";
import { parseShare } from "@/lib/share-store";
import { summarizeShare } from "@/lib/share-summary";
import type { GridCell } from "@/types";

/** The parser as it was before T-0009, kept verbatim as the golden reference. */
function legacyParseShare(id: string, raw: string) {
    try {
        const parsed = JSON.parse(raw);
        const isArray = Array.isArray(parsed);
        const cells: unknown[] = isArray ? parsed : parsed.grid || [];
        const meta = isArray ? {} : parsed.meta || {};
        const grid: GridCell[] = Array.from({ length: 100 }, () => ({ character: null }));
        cells.forEach((entry) => {
            const item = entry as { i?: number; character?: GridCell["character"] };
            const index = item?.i ?? -1;
            if (index < 0 || index >= 100 || !item.character) return;
            grid[index] = { character: item.character };
        });
        return {
            id,
            title: meta.title || "Waifu100 Grid",
            grid,
            imageUrl: meta.imageUrl || null,
            createdAt: meta.createdAt || null,
            verdict: (!isArray && parsed.verdict) || null,
            verdictFeedback: (!isArray && parsed.verdictFeedback) || null,
        };
    } catch {
        return null;
    }
}

const char = (n: number) => ({
    mal_id: n,
    name: `Char ${n}`,
    images: { jpg: { image_url: `https://cdn.example.com/${n}.jpg` } },
    source: "Some Show",
});

const FIXTURES: Record<string, string> = {
    legacyArray: JSON.stringify([
        { i: 0, character: char(1) },
        { i: 42, character: char(2) },
        { i: 120, character: char(3) },
    ]),
    v1: JSON.stringify({
        meta: { title: "My grid", createdAt: "2025-01-01T00:00:00.000Z", hasImage: true, imageUrl: "https://abc.public.blob.vercel-storage.com/x.png" },
        grid: [{ i: 3, character: char(9) }, { i: 99, character: { ...char(5), customImageUrl: "https://media.tenor.com/y.gif" } }],
    }),
    v1Verdict: JSON.stringify({
        meta: { title: "V", createdAt: "2025-02-01T00:00:00.000Z", userId: "u" },
        grid: [{ i: 0, character: char(1) }],
        verdict: { emoji: "x", en: { title: "a", content: "b", tags: [] }, th: { title: "a", content: "b", tags: [] } },
        verdictFeedback: "agree",
    }),
    v1NoTitle: JSON.stringify({ meta: {}, grid: [] }),
    v2Waifu: JSON.stringify(
        buildWaifuPayload({ title: "New", grid: [{ i: 1, character: char(7) }], createdAt: "2026-10-14T00:00:00.000Z" })
    ),
};

describe("share schema: old shares keep reading", () => {
    for (const [name, raw] of Object.entries(FIXTURES)) {
        it(`${name} decodes exactly as before`, () => {
            const now = parseShare("abc", raw);
            const before = legacyParseShare("abc", raw);
            expect(now).toMatchObject(before!);
            expect(now?.kind).toBe("waifu");
            expect(now?.size).toBe(100);
        });
    }

    it("garbage returns null, like before", () => {
        expect(parseShare("abc", "{not json")).toBeNull();
        expect(legacyParseShare("abc", "{not json")).toBeNull();
    });

    it("waifu summaries carry no kind field (cache stays identical)", () => {
        const s = summarizeShare("abc", FIXTURES.v1)!;
        expect(s.kind).toBeUndefined();
        expect(s.count).toBe(2);
        expect(s.hasGif).toBe(true);
    });

    it("v2 waifu payload keeps the v1 fields", () => {
        const p = JSON.parse(FIXTURES.v2Waifu);
        expect(p.meta).toMatchObject({ title: "New", v: 2, kind: "waifu", size: 100 });
        expect(p.meta.cols).toBeUndefined();
        expect(p.grid).toHaveLength(1);
    });

    it("a waifu share can be a smaller or custom layout; a size-less one stays 100", () => {
        const raw = JSON.stringify(buildWaifuPayload({ title: "Top", size: 9, grid: [{ i: 0, character: char(1) }, { i: 20, character: char(2) }] }));
        const d = decodeShare(raw)!;
        expect(d).toMatchObject({ kind: "waifu", size: 9, cols: null, count: 1 });
        expect(d.grid[0]?.character?.name).toBe("Char 1");
        const custom = decodeShare(JSON.stringify(buildWaifuPayload({ title: "C", size: 24, cols: 6, grid: [{ i: 5, character: char(3) }] })))!;
        expect(custom).toMatchObject({ size: 24, cols: 6 });
        expect(custom.grid[5]?.character?.name).toBe("Char 3");
        expect(summarizeShare("abc", raw)).toMatchObject({ size: 9, count: 1 });
        expect(summarizeShare("abc", FIXTURES.v1)?.size).toBeUndefined();
    });
});

describe("share schema: story", () => {
    const cover = (n: number) => `https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/${n}.jpg`;

    for (const size of [9, 10, 50, 100] as const) {
        it(`round-trips a ${size}-slot story grid`, () => {
            const { cells } = cleanStoryCells(size, [
                { i: 0, a: 1, t: "ANIME", img: cover(1), n: "Cowboy Bebop" },
                { i: size - 1, a: 2, t: "MANGA", img: cover(2) },
            ]);
            const raw = JSON.stringify(buildStoryPayload({ title: "S", size, cells }));
            const d = decodeShare(raw)!;
            expect(d.kind).toBe("story");
            expect(d.size).toBe(size);
            expect(d.count).toBe(2);
            expect(d.items[0]).toMatchObject({ id: 1, type: "ANIME", title: "Cowboy Bebop" });
            expect(d.images[size - 1]).toBe(cover(2));
            const s = summarizeShare("x", raw)!;
            expect(s).toMatchObject({ kind: "story", size, count: 2 });
            // Old-style readers see an empty waifu grid, never a crash.
            expect(parseShare("x", raw)!.grid.every((c) => c.character === null)).toBe(true);
        });
    }

    it("drops bad cells, non-public hosts, duplicates; caps titles", () => {
        const { cells } = cleanStoryCells(9, [
            { i: 0, a: 1, t: "ANIME", img: cover(1), n: "x".repeat(300) },
            { i: 0, a: 2, t: "ANIME", img: cover(2) },
            { i: 1, a: 3, t: "ANIME", img: "http://evil.example.com/a.jpg" },
            { i: 9, a: 4, t: "ANIME", img: cover(4) },
            { i: 2, a: 5, t: "BOOK", img: cover(5) },
        ]);
        expect(cells).toHaveLength(1);
        expect(cells[0].n).toHaveLength(120);
    });

    it("rejects invalid sizes and empty grids", () => {
        expect(() => cleanStoryCells(12, [])).toThrow(ShareValidationError);
        expect(() => cleanStoryCells(9, [])).toThrow(ShareValidationError);
    });
});

describe("og layout", () => {
    it("keeps the waifu card at 10x10", async () => {
        const { ogLayout } = await import("@/lib/share-og");
        expect(ogLayout()).toMatchObject({ columns: 10, rows: 10, total: 100, cell: 80 });
        expect(ogLayout("waifu", 9)).toMatchObject({ columns: 3, rows: 3, total: 9 });
        expect(ogLayout("waifu", 24, 6)).toMatchObject({ columns: 6, rows: 4, total: 24 });
    });
    it("lays out story sizes", async () => {
        const { ogLayout } = await import("@/lib/share-og");
        expect(ogLayout("story", 9)).toMatchObject({ columns: 3, rows: 3 });
        expect(ogLayout("story", 10)).toMatchObject({ columns: 5, rows: 2, cell: 160 });
        expect(ogLayout("story", 50)).toMatchObject({ columns: 10, rows: 5 });
        expect(ogLayout("story", 100)).toMatchObject({ columns: 10, rows: 10 });
    });
});

describe("feedKeysForShare (scripts/add-to-feed.ts)", async () => {
    const { feedKeysForShare } = await import("@/lib/share-schema");
    it("waifu and legacy shares go to the main feed only", () => {
        expect(feedKeysForShare(FIXTURES.legacyArray)).toEqual(["waifu100:feed"]);
        expect(feedKeysForShare(FIXTURES.v1)).toEqual(["waifu100:feed"]);
        expect(feedKeysForShare("{bad")).toEqual(["waifu100:feed"]);
    });
    it("story shares also go to feed:story", () => {
        expect(feedKeysForShare(JSON.stringify({ meta: { kind: "story", size: 9 }, grid: [] }))).toEqual(["waifu100:feed", "waifu100:feed:story"]);
    });
});

describe("story image sources", async () => {
    const { cleanStoryCells } = await import("@/lib/share-schema");
    it("T-0010: anilist/mal/web need public https; upload needs our Blob host", () => {
        const { cells } = cleanStoryCells(9, [
            { i: 0, a: 1, t: "ANIME", img: "https://img.example.com/a.jpg", src: "web" },
            { i: 1, a: 2, t: "ANIME", img: "https://10.0.0.1/a.jpg", src: "web" },
            { i: 2, a: 3, t: "ANIME", img: "https://abc123.public.blob.vercel-storage.com/x.jpg", src: "upload" },
            { i: 3, a: 4, t: "ANIME", img: "https://evil.com/x.public.blob.vercel-storage.com.jpg", src: "upload" },
            { i: 4, a: 5, t: "ANIME", img: "https://img.example.com/b.jpg" },
            { i: 5, a: 6, t: "ANIME", img: "https://192.168.0.2/b.jpg", src: "mal" },
            { i: 6, a: 7, t: "ANIME", img: "data:image/png;base64,AA" },
        ]);
        expect(cells.map((c) => [c.i, c.src])).toEqual([[0, "web"], [2, "upload"], [4, undefined]]);
    });
});
