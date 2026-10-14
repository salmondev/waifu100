import { describe, expect, it, vi } from "vitest";
import { Effect } from "effect";
import { makeMemoryShareRepo } from "@/server/share-repo";

const mem = makeMemoryShareRepo();
vi.mock("@/server/run", () => ({
    runApp: (p: Effect.Effect<unknown, unknown, never>) => Effect.runPromise(p.pipe(Effect.provide(mem.layer)) as never),
}));

describe("readShare / readShares on the Effect repo", async () => {
    const { readShare, readShares } = await import("@/lib/share-store");
    mem.strings.set("waifu100:share:old", JSON.stringify([{ i: 3, character: { mal_id: 1, name: "A", images: { jpg: { image_url: "https://x/a.jpg" } } } }]));

    it("reads a legacy bare-array share", async () => {
        const s = await readShare("old");
        expect(s?.grid[3].character?.name).toBe("A");
        expect(s?.kind).toBe("waifu");
    });
    it("null for missing / invalid ids", async () => {
        expect(await readShare("nope")).toBeNull();
        expect(await readShare("bad id!")).toBeNull();
        expect(await readShares(["old", "nope"])).toEqual([expect.objectContaining({ id: "old" }), null]);
    });
});
