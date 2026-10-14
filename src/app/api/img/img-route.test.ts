import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { NextRequest } from "next/server";

const consume = vi.fn(async () => ({ allowed: false, retryAfter: 60, remaining: 0 }));
vi.mock("@/lib/rate-limit", async (orig) => ({ ...(await orig<typeof import("@/lib/rate-limit")>()), consume: () => consume() }));

import { GET } from "@/app/api/img/route";
import { configureModeration, sha256 } from "@/server/moderation/moderator";
import { memoryVerdictStore } from "@/server/moderation/verdict-store";
import { ClassifyError } from "@/server/moderation/classifier";

const png = (c: string) => sharp({ create: { width: 16, height: 16, channels: 3, background: c } }).png().toBuffer();
const get = (headers: Record<string, string> = {}) =>
    GET(new NextRequest("http://localhost/api/img?u=" + encodeURIComponent("https://img.example.com/a.png") + "&w=64", { headers }));

afterEach(() => {
    configureModeration();
    consume.mockClear();
});

describe("/api/img rate limit applies to cache misses only (review M2)", () => {
    it("serves a cached verdict even when the IP is over its limit, without counting", async () => {
        const bytes = await png("#ff0000");
        const store = memoryVerdictStore();
        store.map.set(sha256(bytes), "a");
        const classify = vi.fn(async (xs: unknown[]) => xs.map(() => true));
        configureModeration({ classify, store, fetchOptions: { fetch: (async () => new Response(new Uint8Array(bytes), { headers: { "content-type": "image/png" } })) as unknown as typeof fetch } });
        const res = await get();
        expect(res.headers.get("X-Moderation")).toBe("allowed");
        expect(consume).not.toHaveBeenCalled();
        expect(classify).not.toHaveBeenCalled();
    });
    it("refuses a miss over the limit without calling the classifier, and does not cache", async () => {
        const bytes = await png("#00ff00");
        const store = memoryVerdictStore();
        const classify = vi.fn(async (xs: unknown[]) => xs.map(() => true));
        configureModeration({ classify, store, fetchOptions: { fetch: (async () => new Response(new Uint8Array(bytes), { headers: { "content-type": "image/png" } })) as unknown as typeof fetch } });
        const res = await get();
        expect(res.headers.get("X-Moderation")).toBe("rate-limited");
        expect(res.headers.get("Content-Type")).toBe("image/svg+xml");
        expect(res.headers.get("Cache-Control")).toContain("max-age=30");
        expect(consume).toHaveBeenCalledTimes(1);
        expect(classify).not.toHaveBeenCalled();
        expect(store.map.has(sha256(bytes))).toBe(false);
    });
    it("lets a miss under the limit through to the classifier", async () => {
        consume.mockResolvedValueOnce({ allowed: true, retryAfter: 60, remaining: 1 });
        const bytes = await png("#0000ff");
        const classify = vi.fn(async (xs: unknown[]) => xs.map(() => true));
        configureModeration({ classify, store: memoryVerdictStore(), fetchOptions: { fetch: (async () => new Response(new Uint8Array(bytes), { headers: { "content-type": "image/png" } })) as unknown as typeof fetch } });
        const res = await get();
        expect(res.headers.get("X-Moderation")).toBe("allowed");
        expect(classify).toHaveBeenCalledTimes(1);
    });
    it("no Gemini key: served unchecked, NO reason header for the public, reason logged, short cache, not stored", async () => {
        consume.mockResolvedValueOnce({ allowed: true, retryAfter: 60, remaining: 1 });
        vi.stubEnv("GEMINI_API_KEY", "");
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        const bytes = await png("#0f0f0f");
        const store = memoryVerdictStore();
        configureModeration({ store, fetchOptions: { fetch: (async () => new Response(new Uint8Array(bytes), { headers: { "content-type": "image/png" } })) as unknown as typeof fetch } });
        const res = await get();
        expect(res.headers.get("Content-Type")).toBe("image/jpeg");
        expect(res.headers.get("X-Moderation")).toBe("unchecked");
        expect(res.headers.get("X-Moderation-Reason")).toBeNull();
        expect(res.headers.get("Cache-Control")).toBe("public, max-age=60, s-maxage=60");
        expect(store.map.size).toBe(0);
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
    });
    const unchecked = async (reason: "no-key" | "timeout", headers: Record<string, string>) => {
        consume.mockResolvedValueOnce({ allowed: true, retryAfter: 60, remaining: 1 });
        const bytes = await png("#0e0e0e");
        configureModeration({ classify: async () => { throw new ClassifyError(reason); }, store: memoryVerdictStore(), fetchOptions: { fetch: (async () => new Response(new Uint8Array(bytes), { headers: { "content-type": "image/png" } })) as unknown as typeof fetch } });
        return get(headers);
    };
    it.each([["no token", {}], ["wrong token", { "x-admin-token": "nope-wrong" }], ["wrong length", { "x-admin-token": "s3cret-admin-token-x" }]])(
        "%s: no X-Moderation-Reason, reason still logged server-side",
        async (_n, headers) => {
            vi.stubEnv("ADMIN_TOKEN", "s3cret-admin-token");
            const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
            const res = await unchecked("timeout", headers as Record<string, string>);
            expect(res.headers.get("X-Moderation")).toBe("unchecked");
            expect(res.headers.get("X-Moderation-Reason")).toBeNull();
            expect(warn.mock.calls.flat().join(" ")).toContain("timeout");
            vi.unstubAllEnvs();
            vi.restoreAllMocks();
        }
    );
    it("valid ADMIN_TOKEN: gets X-Moderation-Reason (no-key / timeout), never CDN-cached", async () => {
        vi.stubEnv("ADMIN_TOKEN", "s3cret-admin-token");
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        for (const reason of ["no-key", "timeout"] as const) {
            const res = await unchecked(reason, { "x-admin-token": "s3cret-admin-token" });
            expect(res.headers.get("X-Moderation")).toBe("unchecked");
            expect(res.headers.get("X-Moderation-Reason")).toBe(reason);
            expect(res.headers.get("Cache-Control")).toBe("private, no-store");
        }
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
    });
    it.each([["unset", undefined, ""], ["whitespace", "   ", "   "]])("%s ADMIN_TOKEN: matching blank header gets no reason (fail closed)", async (_n, env, hdr) => {
        vi.stubEnv("ADMIN_TOKEN", env as string);
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const res = await unchecked("timeout", { "x-admin-token": hdr as string });
        expect(res.headers.get("X-Moderation-Reason")).toBeNull();
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
    });
    it("no ADMIN_TOKEN configured: even a sent token gets no reason (fail closed)", async () => {
        vi.stubEnv("ADMIN_TOKEN", "");
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const res = await unchecked("timeout", { "x-admin-token": "" });
        expect(res.headers.get("X-Moderation-Reason")).toBeNull();
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
    });
});
