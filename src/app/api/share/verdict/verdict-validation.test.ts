import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const redisImpl = vi.fn<(fn: (r: unknown) => unknown) => Promise<unknown>>();
vi.mock("@/lib/redis", async (orig) => ({ ...(await orig<typeof import("@/lib/redis")>()), withRedis: (fn: (r: unknown) => unknown) => redisImpl(fn) }));

import { PATCH } from "@/app/api/share/verdict/route";

const req = (body: unknown) =>
    new NextRequest("http://localhost/api/share/verdict", { method: "PATCH", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

beforeEach(() => {
    redisImpl.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("PATCH /api/share/verdict input validation", () => {
    it("rejects share ids that are not share ids, without touching Redis", async () => {
        for (const shareId of ["a:b", "../x", "x y", "a".repeat(65), 123]) {
            const res = await PATCH(req({ shareId, verdict: { title: "t" } }));
            expect(res.status).toBe(404);
        }
        expect(redisImpl).not.toHaveBeenCalled();
    });

    it("rejects non-object or oversized verdicts", async () => {
        for (const verdict of ["str", [1], { big: "x".repeat(40 * 1024) }]) {
            const res = await PATCH(req({ shareId: "abc123", verdict }));
            expect(res.status).toBe(400);
        }
        expect(redisImpl).not.toHaveBeenCalled();
    });

    it("still fills a missing verdict on a valid share", async () => {
        const store = new Map<string, string>([["waifu100:share:abc123", JSON.stringify({ meta: {}, grid: [] })]]);
        const fake = { get: async (k: string) => store.get(k) ?? null, set: async (k: string, v: string) => { store.set(k, v); return "OK"; } };
        redisImpl.mockImplementation(async (fn) => fn(fake));
        const res = await PATCH(req({ shareId: "abc123", verdict: { title: "Verdict" } }));
        expect(res.status).toBe(200);
        expect(JSON.parse(store.get("waifu100:share:abc123")!).verdict).toEqual({ title: "Verdict" });
    });
});
