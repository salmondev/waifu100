import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { makeMemoryShareRepo, FEED_KEY, STORY_FEED_KEY } from "@/server/share-repo";
import { createShare, deleteShare, readDecoded } from "@/server/share-service";

const USER = "123e4567-e89b-42d3-a456-426614174000";
const cover = "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx1-x.jpg";

function run<A, E>(eff: Effect.Effect<A, E, never>) {
    return Effect.runPromise(Effect.match(eff, { onFailure: (e) => ({ err: e as { _tag: string } }), onSuccess: (a) => ({ ok: a }) }));
}

describe("share service (memory Redis)", () => {
    it("waifu share: same keys and payload shape as before", async () => {
        const mem = makeMemoryShareRepo();
        const res = await run(
            createShare(
                { grid: [{ i: 0, m: 5, n: "Rin", img: "https://img.example.com/1.jpg", s: "Fate" }], customTitle: "Mine", userId: USER },
                { id: "abc123", now: 1000 }
            ).pipe(Effect.provide(mem.layer))
        );
        expect("ok" in res && res.ok.url).toBe("/view/abc123");
        const stored = JSON.parse(mem.strings.get("waifu100:share:abc123")!);
        expect(stored.meta).toMatchObject({ title: "Mine", userId: USER, kind: "waifu", v: 2, size: 100 });
        expect(stored.grid[0]).toEqual({
            i: 0,
            character: { mal_id: 5, name: "Rin", images: { jpg: { image_url: "https://img.example.com/1.jpg" } }, source: "Fate" },
        });
        expect(mem.zsets.get(FEED_KEY)!.get("abc123")).toBe(1000);
        expect(mem.zsets.get(STORY_FEED_KEY)?.size ?? 0).toBe(0);
        expect(mem.zsets.get(`waifu100:user:${USER}:shares`)!.has("abc123")).toBe(true);
    });

    it("title versioning still appends V.n", async () => {
        const mem = makeMemoryShareRepo();
        const body = { grid: [{ i: 0, m: 1, n: "A", img: "https://x/a.jpg" }], customTitle: "T", userId: USER };
        await run(createShare(body, { id: "a1" }).pipe(Effect.provide(mem.layer)));
        await run(createShare(body, { id: "a2" }).pipe(Effect.provide(mem.layer)));
        expect(JSON.parse(mem.strings.get("waifu100:share:a2")!).meta.title).toBe("T V.2");
    });

    it("story share: own feed index, /story/v url, no verdict", async () => {
        const mem = makeMemoryShareRepo();
        const res = await run(
            createShare(
                { kind: "story", size: 9, grid: [{ i: 0, a: 1, t: "ANIME", img: cover, n: "Bebop" }], verdict: { x: 1 } },
                { id: "s1", now: 5 }
            ).pipe(Effect.provide(mem.layer))
        );
        expect("ok" in res && res.ok.url).toBe("/story/v/s1");
        expect(mem.zsets.get(STORY_FEED_KEY)!.has("s1")).toBe(true);
        expect(mem.zsets.get(FEED_KEY)!.has("s1")).toBe(true);
        const d = await Effect.runPromise(readDecoded("s1").pipe(Effect.provide(mem.layer)));
        expect(d).toMatchObject({ kind: "story", size: 9, count: 1, verdict: null });
    });

    it("rejects bad story input with InvalidShare", async () => {
        const mem = makeMemoryShareRepo();
        const res = await run(createShare({ kind: "story", size: 7, grid: [] }).pipe(Effect.provide(mem.layer)));
        expect("err" in res && res.err._tag).toBe("InvalidShare");
        expect(mem.strings.size).toBe(0);
    });

    it("delete: owner ok, stranger forbidden, cleans story feed", async () => {
        const mem = makeMemoryShareRepo();
        await run(
            createShare({ kind: "story", size: 10, grid: [{ i: 0, a: 1, t: "MANGA", img: cover }], userId: USER }, { id: "d1" }).pipe(
                Effect.provide(mem.layer)
            )
        );
        const stranger = await run(deleteShare("d1", null, false).pipe(Effect.provide(mem.layer)));
        expect("err" in stranger && stranger.err._tag).toBe("Forbidden");
        const owner = await run(deleteShare("d1", USER, false).pipe(Effect.provide(mem.layer)));
        expect("ok" in owner).toBe(true);
        expect(mem.strings.has("waifu100:share:d1")).toBe(false);
        expect(mem.zsets.get(STORY_FEED_KEY)!.has("d1")).toBe(false);
        const missing = await run(readDecoded("d1").pipe(Effect.provide(mem.layer)));
        expect("err" in missing && missing.err._tag).toBe("ShareNotFound");
    });
});
