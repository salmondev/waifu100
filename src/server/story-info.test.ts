import { describe, expect, it, vi } from "vitest";
import { cleanSynopsis, fetchStoryInfo, mapAniListInfo, storyRecordSuspect } from "@/server/story-info";

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

    it("a stored MAL id is looked up on AniList, not Jikan", async () => {
        const f = vi.fn(async () => new Response(JSON.stringify({ data: { Media: {
            type: "MANGA", format: "MANGA", chapters: 162, averageScore: 92, description: "Dr. Tenma",
            title: { english: "Monster" }, genres: ["Mystery"],
        } } })));
        const info = await fetchStoryInfo("mal", 9, "MANGA", f as unknown as typeof fetch);
        const init = (f.mock.calls[0] as unknown as [string, RequestInit])[1];
        expect(JSON.parse(init.body as string).variables).toEqual({ idMal: 9, type: "MANGA" });
        expect(String((f.mock.calls[0] as unknown as [string])[0])).not.toContain("jikan");
        expect(info).toMatchObject({ title: "Monster", chapters: 162, score: 92, source: "anilist" });
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

    it("a music-video record is suspect for an anime the grid already named", () => {
        const mv = { title: "Idol", altTitles: [], type: "ANIME" as const, synopsis: null, format: "Music", year: 2023, status: null, episodes: 1, chapters: null, volumes: null, genres: [], score: null, url: null, source: "anilist" as const };
        expect(storyRecordSuspect(mv, "ANIME", "Oshi no Ko")).toBe(true);
        expect(storyRecordSuspect(mv, "ANIME", "Idol MV")).toBe(false);
        expect(storyRecordSuspect({ ...mv, format: "TV", title: "Oshi no Ko" }, "ANIME", "Oshi no Ko")).toBe(false);
    });

    it("replaces a music-video id with the anime the cell is actually titled", async () => {
        const f = vi.fn(async (_url: string, init?: RequestInit) => {
            const body = JSON.parse(String(init?.body)) as { variables: { id?: number } };
            if (body.variables.id) {
                return new Response(JSON.stringify({ data: { Media: { type: "ANIME", format: "MUSIC", title: { english: "Idol" }, description: "A song" } } }));
            }
            return new Response(JSON.stringify({ data: { Page: { media: [{ type: "ANIME", format: "TV", episodes: 11, title: { english: "Oshi no Ko" }, description: "Idols" }] } } }));
        });
        const info = await fetchStoryInfo("anilist", 1, "ANIME", f as unknown as typeof fetch, "Oshi no Ko");
        expect(info).toMatchObject({ title: "Oshi no Ko", format: "TV", episodes: 11 });
        expect(f).toHaveBeenCalledTimes(2);
    });
});
