import { describe, expect, it, vi } from "vitest";
import { createStorySearch } from "@/lib/story/search";
import { cacheGallery, clearGalleryCache, getCachedGallery } from "@/lib/gallery-cache";

describe("T-0013 client caches", () => {
    it("story search: same title twice = one request; Jikan fallbacks are not cached", async () => {
        const f = vi.fn(async () => new Response(JSON.stringify({ data: { Page: { media: [] } } })));
        const s = createStorySearch({ fetch: f as unknown as typeof fetch });
        await s.search("Frieren");
        await s.search(" frieren ");
        expect(f).toHaveBeenCalledTimes(1);
        const g = vi.fn(async (url: RequestInfo | URL) => String(url).includes("anilist") ? new Response("x", { status: 503 }) : new Response(JSON.stringify({ data: [] })));
        const s2 = createStorySearch({ fetch: g as unknown as typeof fetch });
        await s2.search("Bebop");
        await s2.search("Bebop");
        expect(g.mock.calls.filter((c) => String(c[0]).includes("anilist")).length).toBe(2);
    });
    it("story search cache expires after 5 minutes", async () => {
        let t = 0;
        const f = vi.fn(async () => new Response(JSON.stringify({ data: { Page: { media: [] } } })));
        const s = createStorySearch({ fetch: f as unknown as typeof fetch, now: () => t });
        await s.search("Frieren");
        t = 5 * 60_000 + 1;
        await s.search("Frieren");
        expect(f).toHaveBeenCalledTimes(2);
    });
    it("gallery cache: hit by name/source/mal/gif, ignores empty answers, expires after 10 minutes", () => {
        clearGalleryCache();
        const q = { characterName: "Frieren", animeSource: "Sousou no Frieren", malId: 1, isGif: false };
        cacheGallery(q, [], 0);
        expect(getCachedGallery(q, 0)).toBeNull();
        cacheGallery(q, [{ url: "u" }], 0);
        expect(getCachedGallery({ ...q, characterName: " frieren " }, 1000)).toEqual([{ url: "u" }]);
        expect(getCachedGallery({ ...q, isGif: true }, 1000)).toBeNull();
        expect(getCachedGallery(q, 10 * 60_000 + 1)).toBeNull();
    });
});
