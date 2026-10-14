import { describe, expect, it, vi } from "vitest";
import { storyWebSearch, webCacheKey } from "@/server/story-web-search";

function deps(over: Partial<Parameters<typeof storyWebSearch>[2]> = {}) {
    const cache = new Map<string, string>();
    const fetchMock = vi.fn(async () =>
        new Response(JSON.stringify({ images: [
            { title: "Bebop cover", imageUrl: "https://img.example.com/b.jpg" },
            { title: "private", imageUrl: "https://192.168.0.2/x.jpg" },
            { title: "http", imageUrl: "http://img.example.com/c.jpg" },
        ] }), { status: 200 })
    );
    return {
        cache,
        fetchMock,
        d: {
            apiKey: "test-key",
            fetch: fetchMock as unknown as typeof fetch,
            cacheGet: async (k: string) => cache.get(k) ?? null,
            cacheSet: async (k: string, v: string) => void cache.set(k, v),
            allowMiss: async () => true,
            ...over,
        },
    };
}

describe("story web search (Serper, fake key)", () => {
    it("disabled without a key", async () => {
        const { d, fetchMock } = deps({ apiKey: undefined });
        expect(await storyWebSearch("bebop", "ANIME", d)).toMatchObject({ ok: false, status: 503 });
        expect(fetchMock).not.toHaveBeenCalled();
    });
    it("maps only public https images and caches by normalised query", async () => {
        const { d, fetchMock, cache } = deps();
        const r = await storyWebSearch("  Bebop ", "ANIME", d);
        expect(r).toMatchObject({ ok: true, cached: false });
        if (r.ok) expect(r.items.map((i) => [i.cover, i.src])).toEqual([["https://img.example.com/b.jpg", "web"]]);
        expect(cache.has(webCacheKey("bebop", "ANIME"))).toBe(true);
        const again = await storyWebSearch("BEBOP", "ANIME", d);
        expect(again).toMatchObject({ ok: true, cached: true });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    it("rate limit applies to misses only", async () => {
        const { d, fetchMock } = deps({ allowMiss: async () => false });
        expect(await storyWebSearch("monster", "MANGA", d)).toMatchObject({ ok: false, status: 429 });
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
