import { describe, expect, it, vi } from "vitest";
import { expectNoOutsideCalls, outside, redis } from "./setup";
import { req } from "./helpers";
import { GET as webSearch } from "@/app/api/story/web-search/route";

describe("story Serper fallback (/api/story/web-search)", () => {
  it("no Serper key -> 503 and nothing leaves the process", async () => {
    const res = await webSearch(req("/api/story/web-search?q=frieren&type=ANIME"));
    expect(res.status).toBe(503);
    expectNoOutsideCalls();
  });
  for (const type of ["ANIME", "MANGA", "NOVEL"]) {
    it(`with a key: ${type} results parsed from a mocked Serper reply, then cached`, async () => {
      vi.stubEnv("SERPER_API_KEY", "e2e-dummy-serper");
      const serper = vi.fn(async () => new Response(JSON.stringify({ images: [{ title: "Frieren cover", imageUrl: "https://img.example.com/f.jpg", link: "https://example.com/f" }] }), { status: 200 }));
      const guard = globalThis.fetch;
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const u = String(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
        return u.startsWith("https://google.serper.dev/") ? serper() : guard(input, init);
      }) as typeof fetch;
      const res = await webSearch(req(`/api/story/web-search?q=frieren&type=${type}`));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(Array.isArray(json.items)).toBe(true);
      expect(serper).toHaveBeenCalledTimes(1);
      const again = await (await webSearch(req(`/api/story/web-search?q=frieren&type=${type}`))).json();
      expect(again.cached).toBe(true);
      expect(serper).toHaveBeenCalledTimes(1);
      expect([...redis.strings.keys()].some((k) => /web/i.test(k))).toBe(true);
      expect(outside).toEqual([]);
    });
  }
  it("Serper failure -> 502, generic message", async () => {
    vi.stubEnv("SERPER_API_KEY", "e2e-dummy-serper");
    const guard = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).startsWith("https://google.serper.dev/") ? new Response("nope", { status: 500 }) : guard(input, init)) as typeof fetch;
    const res = await webSearch(req("/api/story/web-search?q=zzz&type=ANIME"));
    expect(res.status).toBe(502);
    expect(await res.text()).not.toMatch(/SERPER|serper\.dev/);
  });
});
