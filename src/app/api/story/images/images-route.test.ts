import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const consume = vi.fn(async () => ({ allowed: true, retryAfter: 60, remaining: 1 }));
vi.mock("@/lib/rate-limit", async (orig) => ({ ...(await orig<typeof import("@/lib/rate-limit")>()), consume: () => consume() }));
const fetchMedia = vi.fn();
const hashImage = vi.fn(async (u: string) => `h:${u}`);
vi.mock("@/server/story-images", async (orig) => ({
    ...(await orig<typeof import("@/server/story-images")>()),
    fetchMedia: (...a: unknown[]) => fetchMedia(...a),
    hashImage: (u: string) => hashImage(u),
}));

import { GET } from "@/app/api/story/images/route";

const media = (id: number) => ({ id, idMal: id + 1000, type: "ANIME", title: { english: `T${id}` }, coverImage: { extraLarge: `https://s4.anilist.co/${id}.jpg` }, bannerImage: null, relations: { edges: [] } });
const get = (qs: string) => GET(new NextRequest(`http://localhost/api/story/images?${qs}`));

afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    consume.mockClear();
    fetchMedia.mockReset();
    hashImage.mockClear();
});

describe("/api/story/images per-source (T-0010 perf)", () => {
    it("rate limit is counted ONCE per title across the source requests", async () => {
        vi.stubEnv("REDIS_URL", "");
        vi.stubEnv("SERPER_API_KEY", "");
        fetchMedia.mockImplementation(async (_s: string, id: number) => media(id));
        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: [] }))));
        const rs = await Promise.all(["anilist", "web"].map((s) => get(`id=501&type=ANIME&source=${s}`)));
        expect(rs.map((r) => r.status)).toEqual([200, 200]);
        const again = await get("id=501&type=ANIME&source=web");
        expect(again.status).toBe(200);
        expect(consume).toHaveBeenCalledTimes(1);
        expect(fetchMedia).toHaveBeenCalledTimes(1);
        const [a, w] = await Promise.all(rs.map((r) => r.json()));
        expect(a.choices.map((c: { url: string }) => c.url)).toEqual(["https://s4.anilist.co/501.jpg"]);
        expect(w).toMatchObject({ choices: [], partial: false }); // no Serper key: not a failure
    });

    it("never takes an image URL from the client: extra params are ignored, unknown sources refused", async () => {
        vi.stubEnv("REDIS_URL", "");
        fetchMedia.mockImplementation(async (_s: string, id: number) => media(id));
        const r = await get("id=502&type=ANIME&source=anilist&u=https%3A%2F%2Fevil.example.com%2Fx.jpg&url=https%3A%2F%2Fevil.example.com%2Fy.jpg");
        const d = await r.json();
        expect(hashImage.mock.calls.map((c) => c[0])).toEqual(["https://s4.anilist.co/502.jpg"]);
        expect(JSON.stringify(d)).not.toContain("evil.example.com");
        expect((await get("id=502&type=ANIME&source=https://evil.example.com/x.jpg")).status).toBe(400);
        expect((await get("id=abc&type=ANIME&source=anilist")).status).toBe(400);
    });

    it("over the per-title limit => 429 for the source requests", async () => {
        vi.stubEnv("REDIS_URL", "");
        consume.mockResolvedValueOnce({ allowed: false, retryAfter: 60, remaining: 0 });
        fetchMedia.mockImplementation(async (_s: string, id: number) => media(id));
        expect((await get("id=503&type=ANIME&source=anilist")).status).toBe(429);
        expect(fetchMedia).not.toHaveBeenCalled();
    });
});
