import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const serperFetch = vi.fn(async () => new Response(JSON.stringify({ images: [] }), { status: 200 }));
vi.mock("@/server/serper-budget", () => ({ serperFetch: (...a: unknown[]) => serperFetch(...(a as [])) }));

import { POST } from "@/app/api/search/route";

const req = (name: string) =>
    new NextRequest("http://localhost/api/search", { method: "POST", body: JSON.stringify({ characterName: name }), headers: { "content-type": "application/json", "x-forwarded-for": `10.0.0.${Math.floor(Math.random() * 200)}` } });

beforeEach(() => {
    serperFetch.mockClear();
    // AniList (and any other upstream) is mocked: no network.
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: { Page: { media: [], characters: [] } } }), { status: 200 })));
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

describe("/api/search Serper guard", () => {
    it("never calls Serper when the key is not configured", async () => {
        vi.stubEnv("SERPER_API_KEY", "");
        const res = await POST(req(`nokey-${Date.now()}`));
        expect(res.status).toBe(200);
        expect(serperFetch).not.toHaveBeenCalled();
    });

    it("uses the (mocked) Serper path when a key is present", async () => {
        vi.stubEnv("SERPER_API_KEY", "test-key");
        const res = await POST(req(`withkey-${Date.now()}`));
        expect(res.status).toBe(200);
        expect(serperFetch).toHaveBeenCalled();
    });
});
