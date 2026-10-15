import { describe, expect, it, vi } from "vitest";
import { cleanSynopsis, fetchStoryInfo, mapAniListInfo } from "@/server/story-info";

describe("story info", () => {
    it("AniList by id: plain-text synopsis and basic facts; light novel stays NOVEL", async () => {
        const f = vi.fn(async () => new Response(JSON.stringify({ data: { Media: {
            type: "MANGA", format: "NOVEL", status: "RELEASING", volumes: 26, chapters: null, startDate: { year: 2014 },
            genres: ["Fantasy"], averageScore: 84, siteUrl: "https://anilist.co/manga/1",
            description: "A <i>jobless</i> man<br>is reborn.<br><br>(Source: X)", title: { english: "Mushoku Tensei", romaji: "Mushoku Tensei: Isekai Ittara Honki Dasu", native: "無職転生" },
        } } })));
        const info = await fetchStoryInfo("anilist", 1, "NOVEL", f as unknown as typeof fetch);
        expect(info).toMatchObject({ title: "Mushoku Tensei", type: "NOVEL", format: "Light Novel", status: "Ongoing", volumes: 26, year: 2014, score: 84, genres: ["Fantasy"], source: "anilist" });
        expect(info!.synopsis).toBe("A jobless man\nis reborn.\n\n(Source: X)");
        expect(info!.altTitles[0]).toContain("Isekai");
        expect(JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).variables).toEqual({ id: 1 });
    });

    it("MAL cells go to Jikan (light novel -> /manga), score scaled to 100", async () => {
        const f = vi.fn(async () => new Response(JSON.stringify({ data: { title: "Monster", type: "Manga", chapters: 162, score: 9.15, synopsis: "Dr. Tenma [Written by MAL Rewrite]", genres: [{ name: "Mystery" }] } })));
        const info = await fetchStoryInfo("mal", 9, "NOVEL", f as unknown as typeof fetch);
        expect(String((f.mock.calls[0] as unknown as [string])[0])).toMatch(/\/v4\/manga\/9$/);
        expect(info).toMatchObject({ title: "Monster", chapters: 162, score: 92, synopsis: "Dr. Tenma", source: "mal" });
    });

    it("not found -> null; upstream failure throws (so it is not cached)", async () => {
        await expect(fetchStoryInfo("anilist", 1, "ANIME", (async () => new Response(JSON.stringify({ data: { Media: null } }))) as unknown as typeof fetch)).resolves.toBeNull();
        await expect(fetchStoryInfo("anilist", 1, "ANIME", (async () => new Response("x", { status: 500 })) as unknown as typeof fetch)).rejects.toThrow();
    });

    it("helpers", () => {
        expect(cleanSynopsis("")).toBeNull();
        expect(cleanSynopsis("x".repeat(2000))!.length).toBeLessThanOrEqual(1501);
        expect(mapAniListInfo({ title: {} }, "ANIME")).toBeNull();
    });
});
