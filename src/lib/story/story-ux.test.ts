import { describe, expect, it, vi } from "vitest";
import { createStorySearch, normalizeQuery, JIKAN_BASE } from "@/lib/story/search";
import { DEFAULT_STORY_SIZE, STORY_SIZES, STORY_SIZE_LABELS, isStorySize, storyColumns } from "@/lib/story/config";
import { emptyDraft, parseDraft } from "@/lib/story/draft";
import { exportLayout } from "@/lib/story/export";
import { cleanStoryCells } from "@/lib/share-schema";

const media = (type: string) => ({ data: { Page: { media: [{ id: 20, type, title: { romaji: "NARUTO" }, coverImage: { large: "https://s4.anilist.co/n.jpg" } }] } } });

function setup(status = 200) {
    const calls: { url: string; body?: string }[] = [];
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(url), body: init?.body as string | undefined });
        if (String(url).startsWith(JIKAN_BASE)) return new Response(JSON.stringify({ data: [] }));
        if (status !== 200) return new Response("", { status, headers: { "Retry-After": "30" } });
        const type = JSON.parse(String(init?.body)).variables.type ?? "ANIME";
        return new Response(JSON.stringify(media(type)));
    });
    return { s: createStorySearch({ fetch: fetchMock as unknown as typeof fetch, now: () => 1_000 }), calls };
}

describe("Thai search", () => {
    it("normalises Thai input without stripping it (NFC, decomposed sara am, zero-width, spaces)", () => {
        expect(normalizeQuery("  นารูโตะ  ")).toBe("นารูโตะ");
        expect(normalizeQuery("วันพีซ\u200B")).toBe("วันพีซ");
        expect(normalizeQuery("ดาบพิฆาต\u0E4D\u0E32")).toBe("ดาบพิฆาตำ");
        expect(normalizeQuery("Attack   on\tTitan")).toBe("Attack on Titan");
    });
    it("sends the Thai text to AniList as UTF-8 JSON, unchanged", async () => {
        const { s, calls } = setup();
        const r = await s.search("นารูโตะ", undefined, "ANIME");
        expect(JSON.parse(calls[0].body!).variables).toMatchObject({ search: "นารูโตะ", type: "ANIME" });
        expect(r.items[0].title).toBe("NARUTO");
    });
    it("percent-encodes Thai for the Jikan fallback and only asks the chosen type", async () => {
        const { s, calls } = setup(503);
        await s.search("นารูโตะ", undefined, "MANGA");
        const jikan = calls.filter((c) => c.url.startsWith(JIKAN_BASE));
        expect(jikan.map((c) => c.url)).toEqual([`${JIKAN_BASE}/manga?q=${encodeURIComponent("นารูโตะ")}&limit=8`]);
    });
});

describe("anime / manga search mode", () => {
    it("passes the type to AniList and caches each mode separately", async () => {
        const { s, calls } = setup();
        const a = await s.search("naruto", undefined, "ANIME");
        const m = await s.search("naruto", undefined, "MANGA");
        expect(calls.map((c) => JSON.parse(c.body!).variables.type)).toEqual(["ANIME", "MANGA"]);
        expect(a.items[0].type).toBe("ANIME");
        expect(m.items[0].type).toBe("MANGA");
        await s.search("naruto", undefined, "MANGA");
        expect(calls).toHaveLength(2);
    });
    it("without a type the request is the old one (no type variable)", async () => {
        const { s, calls } = setup();
        await s.search("bebop");
        expect(JSON.parse(calls[0].body!).variables).not.toHaveProperty("type");
    });
});

describe("grid sizes", () => {
    it("new boards default to 3x3; saved drafts keep their size", () => {
        expect(DEFAULT_STORY_SIZE).toBe(9);
        expect(emptyDraft().items).toHaveLength(9);
        expect(parseDraft(JSON.stringify({ size: 10, items: [] })).size).toBe(10);
        expect(parseDraft(JSON.stringify({ size: 100, items: [] })).size).toBe(100);
    });
    it("5x5 is a valid size laid out 5 wide in the builder, export and shares", () => {
        expect(STORY_SIZES).toContain(25);
        expect(isStorySize(25)).toBe(true);
        expect(STORY_SIZE_LABELS[25]).toBe("5×5");
        expect(storyColumns(25)).toBe(5);
        expect(exportLayout(25)).toMatchObject({ cols: 5, rows: 5 });
        const { size, cells } = cleanStoryCells(25, [{ i: 24, a: 1, t: "ANIME", img: "https://s4.anilist.co/x.jpg" }, { i: 25, a: 2, t: "ANIME", img: "https://s4.anilist.co/y.jpg" }]);
        expect(size).toBe(25);
        expect(cells.map((c) => c.i)).toEqual([24]);
    });
});

describe("story OG card", () => {
    it("story cells are 2:3 (whole cover); the waifu card geometry is unchanged", async () => {
        const { ogLayout, STORY_CELL_RATIO } = await import("@/lib/share-og");
        expect(ogLayout()).toEqual({ columns: 10, rows: 10, total: 100, cell: 80, cellH: 80, width: 800, height: 800 });
        for (const size of STORY_SIZES) {
            const l = ogLayout("story", size);
            expect(l.cellH).toBe(Math.floor(l.cell * STORY_CELL_RATIO));
            expect(l.width).toBeLessThanOrEqual(800);
            expect(l.height).toBeLessThanOrEqual(800);
        }
        expect(ogLayout("story", 25)).toMatchObject({ columns: 5, rows: 5 });
    });
});
