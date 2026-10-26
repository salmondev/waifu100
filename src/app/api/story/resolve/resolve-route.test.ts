import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const consume = vi.fn(async () => ({ allowed: true, retryAfter: 60, remaining: 1 }));
vi.mock("@/lib/rate-limit", async (orig) => ({ ...(await orig<typeof import("@/lib/rate-limit")>()), consume: () => consume() }));
const serperFetch = vi.fn(async () => new Response(JSON.stringify({ organic: [{ title: "Frieren: Beyond Journey's End - Wikipedia" }] })));
vi.mock("@/server/serper-budget", () => ({ serperFetch: (...a: unknown[]) => (serperFetch as (...x: unknown[]) => unknown)(...a) }));
const generateContent = vi.fn();
vi.mock("@/lib/gemini", () => ({ getFlashModel: () => ({ generateContent }) }));
vi.mock("@/lib/redis", () => ({ withRedis: vi.fn() }));

import { GET } from "@/app/api/story/resolve/route";

const get = (qs: string) => GET(new NextRequest(`http://localhost/api/story/resolve?${qs}`));
afterEach(() => { vi.unstubAllEnvs(); consume.mockClear(); serperFetch.mockClear(); generateContent.mockReset(); });

describe("/api/story/resolve (mocked Serper/Gemini/Redis)", () => {
    it("uses serperFetch (budgeted) and the shared rate limit; no Gemini key => heuristics", async () => {
        vi.stubEnv("REDIS_URL", "");
        vi.stubEnv("SERPER_API_KEY", "k");
        vi.stubEnv("GEMINI_API_KEY", "");
        const r = await get("q=ฟรีเรน&type=ANIME");
        expect(await r.json()).toMatchObject({ titles: ["Frieren: Beyond Journey's End"] });
        expect(serperFetch).toHaveBeenCalledTimes(1);
        expect(consume).toHaveBeenCalledTimes(1);
        expect(generateContent).not.toHaveBeenCalled();
    });

    it("no Serper key: no call, empty titles", async () => {
        vi.stubEnv("REDIS_URL", "");
        vi.stubEnv("SERPER_API_KEY", "");
        expect(await (await get("q=abc")).json()).toMatchObject({ titles: [] });
        expect(serperFetch).not.toHaveBeenCalled();
    });

    it("429 when the miss is rate-limited", async () => {
        vi.stubEnv("REDIS_URL", "");
        vi.stubEnv("SERPER_API_KEY", "k");
        consume.mockResolvedValueOnce({ allowed: false, retryAfter: 60, remaining: 0 });
        expect((await get("q=abcd")).status).toBe(429);
        expect(serperFetch).not.toHaveBeenCalled();
    });
});
