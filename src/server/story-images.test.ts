import { describe, expect, it, vi } from "vitest";
import { JIKAN_TIMEOUT_MS, SOURCE_HASH_BUDGET, sourceImageChoices, CHOICES_CACHE_TTL_SEC, choicesTtl, collectCandidates, dedupeByHash, HASH_MAX_BYTES, hashImage, PARTIAL_CACHE_TTL_SEC, storyImageChoices } from "@/server/story-images";

const media = {
    id: 1,
    idMal: 11,
    type: "ANIME",
    title: { english: "Bebop" },
    coverImage: { extraLarge: "https://s4.anilist.co/xl.jpg", large: "https://s4.anilist.co/l.jpg", medium: "https://s4.anilist.co/m.jpg", color: "#e4a" },
    bannerImage: "https://s4.anilist.co/banner.jpg",
    relations: { edges: [{ relationType: "SIDE_STORY", node: { id: 2, type: "ANIME", title: { romaji: "Movie" }, coverImage: { extraLarge: "https://s4.anilist.co/r.jpg" } } }] },
};

describe("story image choices (T-0010)", () => {
    it("collects AniList covers, banner, MAL pictures, relations, web; public https only, URL-deduped", () => {
        const c = collectCandidates(media, ["https://cdn.myanimelist.net/p1.jpg", "http://cdn.myanimelist.net/p2.jpg"], [
            { url: "https://i.pinimg.com/w.jpg", title: "Fan art" },
            { url: "https://127.0.0.1/x.jpg" },
            { url: "https://s4.anilist.co/xl.jpg" },
        ]);
        expect(c.map((x) => [x.source, x.url])).toEqual([
            ["anilist", "https://s4.anilist.co/xl.jpg"],
            ["banner", "https://s4.anilist.co/banner.jpg"],
            ["mal", "https://cdn.myanimelist.net/p1.jpg"],
            ["relation", "https://s4.anilist.co/r.jpg"],
            ["web", "https://i.pinimg.com/w.jpg"],
        ]);
        expect(c[3].label).toBe("Side story: Movie");
    });

    it("dedupes by sha256 of the bytes and drops unfetchable images", async () => {
        const choices = ["a", "b", "c", "d"].map((k) => ({ url: `https://x.example.com/${k}.jpg`, source: "web" as const, label: k }));
        const hashes: Record<string, string | null> = { a: "H1", b: "H2", c: "H1", d: null };
        const out = await dedupeByHash(choices, async (u) => hashes[u.slice(-5, -4)]);
        expect(out.map((c) => [c.label, c.hash])).toEqual([["a", "H1"], ["b", "H2"]]);
    });

    it("one AniList query by id, Jikan pictures by idMal, web via injected Serper; no key => no web, no error", async () => {
        const calls: string[] = [];
        const f = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
            calls.push(String(url));
            if (String(url).includes("graphql")) {
                const body = JSON.parse(String(init?.body));
                expect(body.query).toContain("bannerImage");
                expect(body.query).toContain("relations");
                expect(body.query).toContain("extraLarge");
                expect(body.query).toContain("idMal");
                return new Response(JSON.stringify({ data: { Media: media } }));
            }
            return new Response(JSON.stringify({ data: [{ jpg: { large_image_url: "https://cdn.myanimelist.net/p1.jpg" } }] }));
        });
        let n = 0;
        const r = await storyImageChoices("anilist", 1, "ANIME", { fetch: f as unknown as typeof fetch, webImages: async () => [], hashOf: async () => `h${n++}` });
        expect(calls[1]).toBe("https://api.jikan.moe/v4/anime/11/pictures");
        expect(r?.choices.some((c) => c.source === "web")).toBe(false);
        expect(r?.choices).toHaveLength(4);
        expect(r?.title).toBe("Bebop");
        expect(r?.partial).toBe(false);
    });

    it("Jikan down => partial (short cache), AniList choices still returned", async () => {
        const f = vi.fn(async (url: RequestInfo | URL) =>
            String(url).includes("graphql") ? new Response(JSON.stringify({ data: { Media: media } })) : new Response("busy", { status: 504 })
        );
        let n = 0;
        const r = await storyImageChoices("anilist", 1, "ANIME", { fetch: f as unknown as typeof fetch, webImages: async () => [], hashOf: async () => `h${n++}` });
        expect(r?.partial).toBe(true);
        expect(r?.choices.length).toBe(3);
    });

    it("returns null when nothing is found", async () => {
        const f = vi.fn(async () => new Response("x", { status: 404 }));
        expect(await storyImageChoices("anilist", 999, "ANIME", { fetch: f as unknown as typeof fetch, webImages: async () => [], hashOf: async () => "h" })).toBeNull();
    });

    it("2 MB hash cap: an oversized image is dropped, the rest kept, NOT partial, cached 7 days", async () => {
        const f = vi.fn(async (url: RequestInfo | URL) => {
            const u = String(url);
            if (u.includes("graphql")) return new Response(JSON.stringify({ data: { Media: media } }));
            if (u.includes("jikan")) return new Response(JSON.stringify({ data: [] }));
            const size = u.endsWith("banner.jpg") ? HASH_MAX_BYTES + 1 : 100 + u.length;
            const body = new Uint8Array(size).fill(u.length % 251);
            return new Response(body, { headers: { "content-type": "image/jpeg" } });
        });
        const fetchImpl = f as unknown as typeof fetch;
        const r = await storyImageChoices("anilist", 1, "ANIME", {
            fetch: fetchImpl,
            webImages: async () => [{ url: "https://i.pinimg.com/w.jpg", title: "Fan art" }],
            hashOf: (u) => hashImage(u, { fetch: fetchImpl }),
        });
        expect(HASH_MAX_BYTES).toBe(2 * 1024 * 1024);
        expect(r?.choices.map((c) => c.url)).toEqual(["https://s4.anilist.co/xl.jpg", "https://s4.anilist.co/r.jpg", "https://i.pinimg.com/w.jpg"]);
        expect(r?.choices.some((c) => c.url.endsWith("banner.jpg"))).toBe(false);
        expect(r?.partial).toBe(false);
        expect(choicesTtl(r!)).toBe(CHOICES_CACHE_TTL_SEC);
        expect(CHOICES_CACHE_TTL_SEC).toBe(7 * 24 * 3600);
    });

    it("an image exactly at the cap is kept", async () => {
        const f = vi.fn(async () => new Response(new Uint8Array(HASH_MAX_BYTES), { headers: { "content-type": "image/png" } }));
        await expect(hashImage("https://s4.anilist.co/x.png", { fetch: f as unknown as typeof fetch })).resolves.toMatch(/^[0-9a-f]{64}$/);
    });

    it("real source failures => partial => 1 hour: Serper failure (null) and Serper throwing", async () => {
        const f = vi.fn(async (url: RequestInfo | URL) =>
            String(url).includes("graphql") ? new Response(JSON.stringify({ data: { Media: media } })) : new Response(JSON.stringify({ data: [] }))
        );
        for (const webImages of [async () => null, async () => { throw new Error("serper down"); }]) {
            const r = await storyImageChoices("anilist", 1, "ANIME", { fetch: f as unknown as typeof fetch, webImages, hashOf: async (u) => u });
            expect(r?.partial).toBe(true);
            expect(choicesTtl(r!)).toBe(PARTIAL_CACHE_TTL_SEC);
        }
        // no key ([]) is not a failure
        const ok = await storyImageChoices("anilist", 1, "ANIME", { fetch: f as unknown as typeof fetch, webImages: async () => [], hashOf: async (u) => u });
        expect(ok?.partial).toBe(false);
    });

    it("per source: Jikan timeout is 3 s and a Jikan failure marks ONLY jikan partial", async () => {
        expect(JIKAN_TIMEOUT_MS).toBe(3000);
        const f = vi.fn(async () => new Response("busy", { status: 504 }));
        const ctx = { src: "anilist" as const, id: 1, type: "ANIME" as const, media };
        const deps = { fetch: f as unknown as typeof fetch, webImages: async () => [], hashOf: async (u: string) => u };
        const [a, j, w] = await Promise.all((["anilist", "jikan", "web"] as const).map((s) => sourceImageChoices(s, ctx, deps)));
        expect([a.partial, j.partial, w.partial]).toEqual([false, true, false]);
        expect(choicesTtl(a)).toBe(CHOICES_CACHE_TTL_SEC);
        expect(choicesTtl(j)).toBe(PARTIAL_CACHE_TTL_SEC);
        expect(a.choices.map((c) => c.source)).toEqual(["anilist", "banner", "relation"]);
    });

    it("per source: at most 40 hash fetches per title in total (20 + 10 + 10)", async () => {
        expect(SOURCE_HASH_BUDGET.anilist + SOURCE_HASH_BUDGET.jikan + SOURCE_HASH_BUDGET.web).toBe(40);
        const many = Array.from({ length: 60 }, (_, i) => `https://img.example.com/${i}.jpg`);
        const big = { ...media, relations: { edges: many.map((u, i) => ({ relationType: "OTHER", node: { id: i, title: { romaji: `R${i}` }, coverImage: { extraLarge: u } } })) } };
        const f = vi.fn(async () => new Response(JSON.stringify({ data: many.map((u) => ({ jpg: { large_image_url: u.replace("img.", "mal.") } })) })));
        const hashOf = vi.fn(async (u: string) => u);
        const ctx = { src: "anilist" as const, id: 1, type: "ANIME" as const, media: big };
        const deps = { fetch: f as unknown as typeof fetch, webImages: async () => many.map((u) => ({ url: u.replace("img.", "web.") })), hashOf };
        await Promise.all((["anilist", "jikan", "web"] as const).map((s) => sourceImageChoices(s, ctx, deps)));
        expect(hashOf).toHaveBeenCalledTimes(40);
    });

    it("per source: oversized image dropped, not partial; no Serper key not partial; Serper failure partial", async () => {
        const f = vi.fn(async (url: RequestInfo | URL) => new Response(new Uint8Array(String(url).endsWith("banner.jpg") ? HASH_MAX_BYTES + 1 : 50).fill(String(url).length % 200), { headers: { "content-type": "image/jpeg" } }));
        const fetchImpl = f as unknown as typeof fetch;
        const ctx = { src: "anilist" as const, id: 1, type: "ANIME" as const, media };
        const a = await sourceImageChoices("anilist", ctx, { fetch: fetchImpl, webImages: async () => [], hashOf: (u) => hashImage(u, { fetch: fetchImpl }) });
        expect(a.partial).toBe(false);
        expect(a.choices.some((c) => c.url.endsWith("banner.jpg"))).toBe(false);
        expect((await sourceImageChoices("web", ctx, { webImages: async () => [], hashOf: async (u) => u })).partial).toBe(false);
        expect((await sourceImageChoices("web", ctx, { webImages: async () => null, hashOf: async (u) => u })).partial).toBe(true);
        // AniList record missing => anilist partial
        expect((await sourceImageChoices("anilist", { ...ctx, media: null }, { webImages: async () => [], hashOf: async (u) => u })).partial).toBe(true);
    });
});
