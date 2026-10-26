import { describe, expect, it, vi } from "vitest";
import { heuristicTitles, parseTitles, resolveCacheKey, resolveStoryTitles, RESOLVE_HIT_TTL_SEC, RESOLVE_MISS_TTL_SEC, type ResolveDeps } from "@/server/story-resolve";

const organic = [
    { title: "Demon Slayer: Kimetsu no Yaiba - Wikipedia", snippet: "ดาบพิฆาตอสูร ..." },
    { title: "Kimetsu no Yaiba (Demon Slayer) - MyAnimeList.net", snippet: "..." },
    { title: "Random blog post", snippet: "..." },
];

function deps(over: Partial<ResolveDeps> = {}) {
    const store = new Map<string, { v: string; ttl: number }>();
    const serper = vi.fn(async () => new Response(JSON.stringify({ organic })));
    const allowMiss = vi.fn(async () => true);
    const d: ResolveDeps = {
        apiKey: "test-key",
        cacheGet: async (k) => store.get(k)?.v ?? null,
        cacheSet: async (k, v, ttl) => { store.set(k, { v, ttl }); },
        allowMiss,
        serper,
        ...over,
    };
    return { d, store, serper, allowMiss };
}

describe("story title resolver", () => {
    it("miss: one Serper call, Gemini titles, cached ~180 days; a repeat costs nothing", async () => {
        const extract = vi.fn(async () => '```json\n{"titles":["Demon Slayer: Kimetsu no Yaiba"]}\n```');
        const { d, store, serper, allowMiss } = deps({ extract });
        const r = await resolveStoryTitles("ดาบพิฆาตอสูร", "ANIME", d);
        expect(r).toEqual({ ok: true, titles: ["Demon Slayer: Kimetsu no Yaiba"], cached: false });
        expect(serper).toHaveBeenCalledTimes(1);
        expect(JSON.parse(String((serper.mock.calls[0] as unknown[])[1] && ((serper.mock.calls[0] as unknown[])[1] as RequestInit).body)).q).toContain("anime");
        expect([...store.values()][0].ttl).toBe(RESOLVE_HIT_TTL_SEC);
        const again = await resolveStoryTitles("  ดาบพิฆาตอสูร ", "ANIME", d);
        expect(again).toMatchObject({ ok: true, cached: true, titles: ["Demon Slayer: Kimetsu no Yaiba"] });
        expect(serper).toHaveBeenCalledTimes(1);
        expect(extract).toHaveBeenCalledTimes(1);
        expect(allowMiss).toHaveBeenCalledTimes(1);
    });

    it("no Gemini: heuristic titles from site-suffixed results", async () => {
        const { d } = deps();
        const r = await resolveStoryTitles("kny", "ANIME", d);
        expect(r).toMatchObject({ ok: true, titles: ["Demon Slayer: Kimetsu no Yaiba", "Kimetsu no Yaiba (Demon Slayer)"] });
    });

    it("nothing found is cached for ~14 days", async () => {
        const { d, store } = deps({ serper: vi.fn(async () => new Response(JSON.stringify({ organic: [{ title: "blog" }] }))) });
        const r = await resolveStoryTitles("zzqx", "MANGA", d);
        expect(r).toMatchObject({ ok: true, titles: [] });
        expect([...store.values()][0].ttl).toBe(RESOLVE_MISS_TTL_SEC);
    });

    it("rate-limited miss: 429, no Serper credit spent", async () => {
        const { d, serper } = deps({ allowMiss: async () => false });
        const r = await resolveStoryTitles("หมอยา", "NOVEL", d);
        expect(r).toMatchObject({ ok: false, status: 429 });
        expect(serper).not.toHaveBeenCalled();
    });

    it("Serper budget refusal / outage is not cached (retried later)", async () => {
        const { d, store } = deps({ serper: vi.fn(async () => new Response("{}", { status: 429 })) });
        expect(await resolveStoryTitles("หมอยา", "NOVEL", d)).toMatchObject({ ok: true, titles: [] });
        expect(store.size).toBe(0);
    });

    it("no key: nothing spent, empty answer; short query: no work", async () => {
        const { d, serper, allowMiss } = deps({ apiKey: undefined });
        expect(await resolveStoryTitles("หมอยา", null, d)).toMatchObject({ ok: true, titles: [] });
        expect(await resolveStoryTitles("a", null, deps().d)).toMatchObject({ ok: true, titles: [] });
        expect(serper).not.toHaveBeenCalled();
        expect(allowMiss).not.toHaveBeenCalled();
    });

    it("light novel queries say so; cache keys differ per type", async () => {
        const { d, serper } = deps();
        await resolveStoryTitles("mushoku", "NOVEL", d);
        expect(JSON.parse(((serper.mock.calls[0] as unknown[])[1] as RequestInit).body as string).q).toBe("mushoku light novel");
        expect(resolveCacheKey("x y", "NOVEL")).not.toBe(resolveCacheKey("x y", "MANGA"));
        expect(resolveCacheKey("X  Y", "NOVEL")).toBe(resolveCacheKey("x y", "NOVEL"));
    });

    it("parsers tolerate junk", () => {
        expect(parseTitles("nope")).toEqual([]);
        expect(parseTitles('{"titles":[1,"ok title","x"]}')).toEqual(["ok title"]);
        expect(heuristicTitles([{ title: "Frieren - วิกิพีเดีย" }])).toEqual(["Frieren"]);
    });
});
