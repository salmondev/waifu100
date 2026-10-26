import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { makeMemoryShareRepo } from "@/server/share-repo";
import { createShare } from "@/server/share-service";
import { SHARE_TITLE_MAX } from "@/lib/story/config";
import { DEFAULT_TITLES } from "@/lib/share-schema";

const cover = "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/a1.jpg";
const run = async (customTitle: unknown) => {
    const mem = makeMemoryShareRepo();
    await Effect.runPromise(createShare({ kind: "story", size: 9, grid: [{ i: 0, a: 1, t: "ANIME", img: cover }], customTitle }, { id: "t1", now: 1 }).pipe(Effect.provide(mem.layer)));
    return JSON.parse(mem.strings.get("waifu100:share:t1")!).meta.title as string;
};

describe("story share title is validated on the server (the modal only trims)", () => {
    it("over-long titles are cut to SHARE_TITLE_MAX server-side", async () => {
        const t = await run("  " + "x".repeat(SHARE_TITLE_MAX + 80) + "  ");
        expect(t).toHaveLength(SHARE_TITLE_MAX);
    });
    it("blank / non-string titles fall back to the story default", async () => {
        expect(await run("   ")).toBe(DEFAULT_TITLES.story);
        expect(await run({ evil: 1 })).toBe(DEFAULT_TITLES.story);
    });
});
