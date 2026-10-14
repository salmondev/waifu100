import { describe, expect, it, vi } from "vitest";
import { createStorySearch, parseRetryAfter, ANILIST_GRAPHQL } from "@/lib/story/search";

const anilistOk = () =>
    new Response(
        JSON.stringify({
            data: {
                Page: {
                    media: [
                        { id: 1, type: "ANIME", format: "TV", seasonYear: 1998, title: { english: "Cowboy Bebop", romaji: "Cowboy Bebop" }, coverImage: { extraLarge: "https://s4.anilist.co/file/a/1xl.jpg", large: "https://s4.anilist.co/file/a/1.jpg" } },
                        { id: 3, type: "MANGA", format: "MANGA", title: { romaji: "Bebop Manga" }, coverImage: { large: "https://s4.anilist.co/file/a/3.jpg" } },
                        { id: 2, type: "ANIME", title: { romaji: "Private" }, coverImage: { large: "https://127.0.0.1/2.jpg" } },
                        { id: 4, type: "ANIME", title: { romaji: "Plain http" }, coverImage: { large: "http://s4.anilist.co/4.jpg" } },
                    ],
                },
            },
        }),
        { status: 200 }
    );
const jikanOk = () =>
    new Response(
        JSON.stringify({ data: [{ mal_id: 9, title: "Monster", images: { jpg: { large_image_url: "https://cdn.myanimelist.net/images/manga/9.jpg" } } }] }),
        { status: 200 }
    );

function setup(responses: (url: string) => Response) {
    let t = 1_000_000;
    const calls: { url: string; body?: string }[] = [];
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(url), body: init?.body as string | undefined });
        return responses(String(url));
    });
    const s = createStorySearch({ fetch: fetchMock as unknown as typeof fetch, now: () => t });
    return { s, calls, advance: (ms: number) => (t += ms) };
}

describe("story search", () => {
    it("one search over anime AND manga, no adult filter, keeps only public https covers", async () => {
        const { s, calls } = setup(() => anilistOk());
        const r = await s.search("bebop");
        expect(r.source).toBe("anilist");
        expect(r.items).toEqual([
            { id: 1, type: "ANIME", title: "Cowboy Bebop", cover: "https://s4.anilist.co/file/a/1xl.jpg", src: "anilist", format: "TV", year: 1998 },
            { id: 3, type: "MANGA", title: "Bebop Manga", cover: "https://s4.anilist.co/file/a/3.jpg", src: "anilist", format: "Manga" },
        ]);
        const vars = JSON.parse(calls[0].body!).variables;
        expect(vars).toMatchObject({ search: "bebop" });
        expect(vars).not.toHaveProperty("type");
        expect(vars).not.toHaveProperty("isAdult");
        expect(JSON.parse(calls[0].body!).query).not.toContain("isAdult");
    });

    it("falls back to Jikan (anime + manga, no sfw filter) on 5xx", async () => {
        const { s, calls } = setup((url) => (url === ANILIST_GRAPHQL ? new Response("x", { status: 503 }) : jikanOk()));
        const r = await s.search("monster");
        expect(r.source).toBe("jikan");
        expect(r.items.map((i) => i.type)).toEqual(["ANIME", "MANGA"]);
        expect(r.items[1]).toMatchObject({ id: 9, src: "mal", type: "MANGA" });
        expect(calls.slice(1).map((c) => c.url.match(/v4\/(\w+)\?/)![1]).sort()).toEqual(["anime", "manga"]);
        expect(calls.some((c) => c.url.includes("sfw"))).toBe(false);
    });

    it("Jikan fallback: one side failing still returns the other", async () => {
        const { s } = setup((url) => (url === ANILIST_GRAPHQL ? new Response("x", { status: 502 }) : url.includes("/anime?") ? new Response("x", { status: 500 }) : jikanOk()));
        const r = await s.search("monster");
        expect(r.items).toHaveLength(1);
        expect(r.items[0].type).toBe("MANGA");
    });

    it("does NOT fall back on other 4xx", async () => {
        const { s, calls } = setup(() => new Response("bad", { status: 400 }));
        await expect(s.search("x y")).rejects.toThrow("Search failed");
        expect(calls).toHaveLength(1);
    });

    it("on 429 honours Retry-After: no AniList calls during the cooldown", async () => {
        let anilistCalls = 0;
        const { s, calls, advance } = setup((url) => {
            if (url === ANILIST_GRAPHQL) {
                anilistCalls++;
                return anilistCalls === 1 ? new Response("", { status: 429, headers: { "Retry-After": "30" } }) : anilistOk();
            }
            return jikanOk();
        });
        const first = await s.search("bebop");
        expect(first.source).toBe("jikan");
        expect(first.anilistCooldownUntil).toBe(1_000_000 + 30_000);

        advance(29_000);
        const during = await s.search("bebop");
        expect(during.source).toBe("jikan");
        expect(anilistCalls).toBe(1);

        advance(1_000);
        const after = await s.search("bebop");
        expect(after.source).toBe("anilist");
        expect(anilistCalls).toBe(2);
        expect(calls.some((c) => c.url.includes("sfw"))).toBe(false);
    });

    it("ignores queries shorter than 2 chars", async () => {
        const { s, calls } = setup(() => anilistOk());
        expect((await s.search(" a ")).items).toEqual([]);
        expect(calls).toHaveLength(0);
    });

    it("parses Retry-After seconds and dates", () => {
        expect(parseRetryAfter("12", 0)).toBe(12);
        expect(parseRetryAfter(null, 0)).toBe(60);
        expect(parseRetryAfter(new Date(10_000).toUTCString(), 0)).toBe(10);
    });
});
