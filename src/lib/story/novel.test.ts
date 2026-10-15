import { describe, expect, it, vi } from "vitest";
import { buildStoryPayload, cleanStoryCells, decodeShare, isMediaType, toMediaType, upstreamType } from "@/lib/share-schema";
import { parseDraft } from "@/lib/story/draft";
import { createStorySearch, mapAniList, typeVariables } from "@/lib/story/search";

const C = "https://s4.anilist.co/file/x.jpg";

describe("light novel (NOVEL) type", () => {
    it("helpers", () => {
        expect(isMediaType("NOVEL")).toBe(true);
        expect(toMediaType("bogus")).toBe("ANIME");
        expect(upstreamType("NOVEL")).toBe("MANGA");
    });

    it("NOVEL cells survive share save + parse; old ANIME/MANGA shares unchanged", () => {
        const { cells } = cleanStoryCells(9, [{ i: 0, a: 1, t: "NOVEL", img: C, n: "LN" }, { i: 1, a: 2, t: "MANGA", img: C }, { i: 2, a: 3, t: "BOOK", img: C }]);
        expect(cells.map((c) => c.t)).toEqual(["NOVEL", "MANGA"]);
        const raw = JSON.stringify(buildStoryPayload({ title: "x", size: 9, cells }));
        const d = decodeShare(raw)!;
        expect(d.items[0]).toMatchObject({ type: "NOVEL", title: "LN" });
        expect(d.items[1]).toMatchObject({ type: "MANGA" });
        const legacy = decodeShare(JSON.stringify({ meta: { v: 2, kind: "story", size: 9 }, grid: [{ i: 0, a: 5, t: "ANIME", img: C }] }))!;
        expect(legacy.items[0]).toMatchObject({ type: "ANIME", id: 5 });
    });

    it("drafts keep NOVEL items and mode", () => {
        const d = parseDraft(JSON.stringify({ size: 9, type: "NOVEL", items: [{ id: 1, type: "NOVEL", title: "a", cover: C }] }));
        expect(d.type).toBe("NOVEL");
        expect(d.items[0]?.type).toBe("NOVEL");
    });

    it("AniList filters: NOVEL = MANGA+format_in NOVEL; MANGA excludes NOVEL; format NOVEL maps to NOVEL", () => {
        expect(typeVariables("NOVEL")).toEqual({ type: "MANGA", format_in: ["NOVEL"] });
        expect(typeVariables("MANGA")).toEqual({ type: "MANGA", format_not_in: ["NOVEL"] });
        expect(typeVariables("ANIME")).toEqual({ type: "ANIME" });
        expect(typeVariables()).toEqual({});
        expect(mapAniList([{ id: 1, type: "MANGA", format: "NOVEL", title: { romaji: "LN" }, coverImage: { large: C } }])[0]).toMatchObject({ type: "NOVEL", format: "Light Novel" });
    });

    it("Jikan fallback for NOVEL asks /manga?type=lightnovel", async () => {
        const calls: string[] = [];
        const s = createStorySearch({ fetch: (async (u: string) => { calls.push(String(u)); return u.includes("graphql") ? new Response("x", { status: 503 }) : new Response(JSON.stringify({ data: [{ mal_id: 3, title: "LN", images: { jpg: { image_url: C } } }] })); }) as unknown as typeof fetch });
        const r = await s.search("ln title", undefined, "NOVEL");
        expect(calls[1]).toMatch(/\/manga\?.*type=lightnovel/);
        expect(r.items[0]).toMatchObject({ type: "NOVEL", src: "mal" });
    });
});

describe("resolver fallback in the client search", () => {
    const empty = () => new Response(JSON.stringify({ data: { Page: { media: [] } } }));
    const hit = () => new Response(JSON.stringify({ data: { Page: { media: [{ id: 7, type: "ANIME", title: { english: "Frieren" }, coverImage: { large: C } }] } } }));

    it("only asked when AniList is empty; re-queries AniList with the resolved title; cached client-side", async () => {
        const bodies: string[] = [];
        const fetchMock = vi.fn(async (_u: string, init?: RequestInit) => {
            const vars = JSON.parse(init!.body as string).variables;
            bodies.push(vars.search);
            return vars.search === "Frieren" ? hit() : empty();
        });
        const resolve = vi.fn(async () => ["Frieren"]);
        const s = createStorySearch({ fetch: fetchMock as unknown as typeof fetch, resolve });
        const r = await s.search("ฟรีเรน", undefined, "ANIME");
        expect(r.items.map((i) => i.id)).toEqual([7]);
        expect(r.resolvedTitles).toEqual(["Frieren"]);
        expect(bodies).toEqual(["ฟรีเรน", "Frieren"]);
        await s.search("ฟรีเรน", undefined, "ANIME");
        expect(resolve).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("not asked when AniList has results", async () => {
        const resolve = vi.fn(async () => ["x"]);
        const s = createStorySearch({ fetch: (async () => hit()) as unknown as typeof fetch, resolve });
        await s.search("frieren");
        expect(resolve).not.toHaveBeenCalled();
    });
});
