import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const consume = vi.fn(async () => ({ allowed: true, retryAfter: 60, remaining: 1 }));
vi.mock("@/lib/rate-limit", async (orig) => ({ ...(await orig<typeof import("@/lib/rate-limit")>()), consume: () => consume() }));
const store = new Map<string, string>();
vi.mock("@/lib/redis", () => ({
    withRedis: async (fn: (r: unknown) => unknown) => fn({ get: async (k: string) => store.get(k) ?? null, set: async (k: string, v: string) => { store.set(k, v); return "OK"; } }),
}));
const fetchStoryInfo = vi.fn();
vi.mock("@/server/story-info", async (orig) => ({ ...(await orig<typeof import("@/server/story-info")>()), fetchStoryInfo: (...a: unknown[]) => fetchStoryInfo(...a) }));

import { GET } from "@/app/api/story/info/route";

const get = (qs: string) => GET(new NextRequest(`http://localhost/api/story/info?${qs}`));

afterEach(() => { vi.unstubAllEnvs(); consume.mockClear(); fetchStoryInfo.mockReset(); store.clear(); });

describe("/api/story/info", () => {
    it("cache-first: second request costs no upstream call and no rate-limit credit", async () => {
        vi.stubEnv("REDIS_URL", "redis://mock");
        fetchStoryInfo.mockResolvedValue({ title: "T", type: "NOVEL" });
        const a = await get("id=5&type=NOVEL");
        expect(await a.json()).toMatchObject({ info: { title: "T" }, cached: false });
        expect(fetchStoryInfo).toHaveBeenCalledWith("anilist", 5, "NOVEL");
        const b = await get("id=5&type=NOVEL");
        expect(await b.json()).toMatchObject({ info: { title: "T" }, cached: true });
        expect(fetchStoryInfo).toHaveBeenCalledTimes(1);
        expect(consume).toHaveBeenCalledTimes(1);
    });

    it("bad id 400; upstream failure 502 and not cached; rate limit 429", async () => {
        vi.stubEnv("REDIS_URL", "redis://mock");
        expect((await get("id=abc")).status).toBe(400);
        fetchStoryInfo.mockRejectedValueOnce(new Error("down"));
        expect((await get("id=7&src=mal&type=MANGA")).status).toBe(502);
        expect(store.size).toBe(0);
        consume.mockResolvedValueOnce({ allowed: false, retryAfter: 60, remaining: 0 });
        expect((await get("id=8")).status).toBe(429);
    });
});
