import { describe, expect, it, vi } from "vitest";
import { Effect } from "effect";

vi.mock("@/lib/share-summary-cache", async () => {
    const { summarizeShare } = await import("@/lib/share-summary");
    return {
        summariesFor: async (ids: string[]) => ({
            grids: ids.map((id) => summarizeShare(id, store.get(`waifu100:share:${id}`)!)).filter(Boolean),
            missing: [],
        }),
    };
});

const store = new Map<string, string>();

describe("community feed kinds", async () => {
    const { makeMemoryShareRepo } = await import("@/server/share-repo");
    const { createShare } = await import("@/server/share-service");
    const { feedPageProgram } = await import("@/lib/community-feed");
    const mem = makeMemoryShareRepo();
    const cover = "https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/b1.jpg";
    // A legacy share, written straight into the feed with no kind.
    mem.strings.set("waifu100:share:old", JSON.stringify({ meta: { title: "Old" }, grid: [{ i: 0, character: { mal_id: 1, name: "A", images: { jpg: { image_url: "https://x/a.jpg" } } } }] }));
    await Effect.runPromise(
        Effect.gen(function* () {
            yield* createShare({ grid: [{ i: 0, m: 2, n: "B", img: "https://x/b.jpg" }] }, { id: "w1", now: 2 });
            yield* createShare({ kind: "story", size: 9, grid: [{ i: 0, a: 1, t: "MANGA", img: cover }] }, { id: "s1", now: 3 });
        }).pipe(Effect.provide(mem.layer))
    );
    mem.zsets.get("waifu100:feed")!.set("old", 1);
    for (const [k, v] of mem.strings) store.set(k, v);

    const page = (kind: "all" | "waifu" | "story") =>
        Effect.runPromise(feedPageProgram(0, 10, "new", kind).pipe(Effect.provide(mem.layer)));

    it("all shows both kinds, newest first", async () => {
        expect((await page("all")).grids.map((g) => g.id)).toEqual(["s1", "w1", "old"]);
    });
    it("waifu keeps legacy shares and drops story", async () => {
        expect((await page("waifu")).grids.map((g) => g.id)).toEqual(["w1", "old"]);
    });
    it("story reads its own index", async () => {
        const p = await page("story");
        expect(p.grids.map((g) => g.id)).toEqual(["s1"]);
        expect(p.total).toBe(1);
        expect(p.grids[0]).toMatchObject({ kind: "story", size: 9 });
    });
    it("story cards without an imageUrl get previews from their cells; waifu/all responses don't", async () => {
        const p = await page("story");
        expect(p.grids[0].imageUrl).toBeNull();
        expect(p.grids[0].previews).toEqual([cover]);
        for (const k of ["all", "waifu"] as const) expect((await page(k)).grids.every((g) => g.previews === undefined)).toBe(true);
    });
    it("previews are read-only: the summary cache and the store are not written", async () => {
        const before = JSON.stringify([...mem.strings]);
        await page("story");
        expect(JSON.stringify([...mem.strings])).toBe(before);
    });
});
