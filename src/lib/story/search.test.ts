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

    it("falls through to the web fallback on 5xx and does not call Jikan", async () => {
        const web = [{ id: 9, type: "MANGA" as const, title: "Monster", cover: "https://cdn.example.com/9.jpg", src: "web" as const }];
        const { s, calls } = setup((url) => (url === ANILIST_GRAPHQL ? new Response("x", { status: 503 }) : jikanOk()));
        const wired = createStorySearch({ fetch: (async (url: string) => (url === ANILIST_GRAPHQL ? new Response("x", { status: 503 }) : jikanOk())) as unknown as typeof fetch, now: () => 1_000_000, web: async () => web });
        const r = await wired.search("monster");
        expect(r.source).toBe("web");
        expect(r.items).toEqual(web);
        expect(calls.every((c) => c.url === ANILIST_GRAPHQL || !c.url.includes("jikan"))).toBe(true);
        expect((await s.search("monster")).items).toEqual([]);
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
        expect(first.source).toBe("web");
        expect(first.anilistCooldownUntil).toBe(1_000_000 + 30_000);

        advance(29_000);
        const during = await s.search("bebop");
        expect(during.source).toBe("web");
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
