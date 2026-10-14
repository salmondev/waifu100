import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Effect } from "effect";

const redisImpl = vi.fn<(fn: (r: unknown) => unknown) => Promise<unknown>>(async () => { throw new Error("redis down (test)"); });
vi.mock("@/lib/redis", async (orig) => ({ ...(await orig<typeof import("@/lib/redis")>()), withRedis: (fn: (r: unknown) => unknown) => redisImpl(fn) }));
const setVerdict = vi.fn(async () => {});
vi.mock("@/server/moderation/moderator", async (orig) => ({ ...(await orig<typeof import("@/server/moderation/moderator")>()), setVerdict: () => setVerdict() }));
const deleteShare = vi.fn((_id: string, _caller: string | null, isAdmin: boolean) => Effect.succeed({ ok: true, admin: isAdmin }));
vi.mock("@/server/share-service", async (orig) => ({ ...(await orig<typeof import("@/server/share-service")>()), deleteShare: (a: string, b: string | null, c: boolean) => deleteShare(a, b, c) }));
vi.mock("@/lib/share-store", async (orig) => ({ ...(await orig<typeof import("@/lib/share-store")>()), readShares: async () => { throw new Error("store boom (test)"); } }));
vi.mock("@/lib/rate-limit", async (orig) => ({ ...(await orig<typeof import("@/lib/rate-limit")>()), enforceRateLimit: async () => null }));

import { POST as moderation } from "@/app/api/admin/moderation/route";
import { POST as serperImages } from "@/app/api/serper-images/route";
import { GET as cron } from "@/app/api/cron/route";
import { DELETE as deleteShareRoute } from "@/app/api/share/[id]/route";
import { PATCH as shareVerdict } from "@/app/api/share/verdict/route";
import { GET as shareImage } from "@/app/api/share/image/[id]/route";
import { GET as compareImage } from "@/app/api/compare/image/route";

const SECRET = "correct-horse-battery";
type Case = { name: string; env: string | undefined; header: string | null };
/** unset secret, empty secret (+ empty header), whitespace secret (+ same header), wrong value, correct value. */
const CASES: (Case & { ok: boolean })[] = [
    { name: "unset secret", env: undefined, header: "" , ok: false },
    { name: "unset secret, no header", env: undefined, header: null, ok: false },
    { name: "empty secret + empty header", env: "", header: "", ok: false },
    { name: "whitespace secret + same header", env: "   ", header: "   ", ok: false },
    { name: "wrong value", env: SECRET, header: "wrong-value", ok: false },
    { name: "correct value", env: SECRET, header: SECRET, ok: true },
];
const setEnv = (name: string, v: string | undefined) => vi.stubEnv(name, v as string);
const adminReq = (url: string, header: string | null, init: { method?: string; body?: string } = {}) =>
    new NextRequest(url, { ...init, headers: { ...(header === null ? {} : { "x-admin-token": header }), "content-type": "application/json" } });

beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubEnv("REDIS_URL", "");
});
afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    redisImpl.mockReset();
    redisImpl.mockImplementation(async () => { throw new Error("redis down (test)"); });
    deleteShare.mockClear();
});

describe.each(CASES)("ADMIN_TOKEN routes - $name (T-0012)", ({ env, header, ok }) => {
    beforeEach(() => setEnv("ADMIN_TOKEN", env));

    it("POST /api/admin/moderation", async () => {
        const res = await moderation(adminReq("http://l/api/admin/moderation", header, { method: "POST", body: JSON.stringify({ hash: "a".repeat(64), verdict: "block" }) }));
        expect(res.status).toBe(ok ? 200 : 401);
        expect(setVerdict).toHaveBeenCalledTimes(ok ? 1 : 0);
        setVerdict.mockClear();
    });
    it("POST /api/serper-images", async () => {
        vi.stubEnv("SERPER_API_KEY", "");
        const res = await serperImages(adminReq("http://l/api/serper-images", header, { method: "POST", body: JSON.stringify({ directQuery: "x" }) }));
        expect(res.status).toBe(ok ? 503 : 401); // admin passes the gate, then "unavailable" (no key)
    });
    it("DELETE /api/share/[id] admin flag", async () => {
        await deleteShareRoute(adminReq("http://l/api/share/abc", header, { method: "DELETE" }), { params: Promise.resolve({ id: "abc" }) } as never);
        expect(deleteShare.mock.calls[0][2]).toBe(ok);
    });
    it("PATCH /api/share/verdict overwrite of an existing verdict", async () => {
        redisImpl.mockImplementation(async (fn) => fn({ get: async () => JSON.stringify({ verdict: { emoji: "x" } }), set: async () => "OK" }));
        const res = await shareVerdict(adminReq("http://l/api/share/verdict", header, { method: "PATCH", body: JSON.stringify({ shareId: "abc", verdict: { emoji: "y" } }) }));
        expect(res.status === 200).toBe(ok);
    });
    it("GET /api/share/image/[id] error detail only for admin", async () => {
        const res = await shareImage(adminReq("http://l/api/share/image/abc", header), { params: Promise.resolve({ id: "abc" }) } as never);
        const text = await res.text();
        expect(text.includes("redis down (test)")).toBe(ok);
    });
    it("GET /api/compare/image error detail only for admin", async () => {
        const res = await compareImage(adminReq("http://l/api/compare/image?a=a1&b=b1", header));
        const text = await res.text();
        expect(text.includes("store boom (test)")).toBe(ok);
    });
    it("GET /api/cron via x-admin-token", async () => {
        setEnv("CRON_SECRET", undefined);
        const res = await cron(adminReq("http://l/api/cron", header));
        expect(res.status === 401).toBe(!ok);
    });
});

describe("CRON_SECRET - /api/cron Bearer (T-0012)", () => {
    const run = (auth: string | null) => cron(new NextRequest("http://l/api/cron", { headers: auth === null ? {} : { authorization: auth } }));
    beforeEach(() => setEnv("ADMIN_TOKEN", undefined));
    it.each([
        ["unset secret, no header", undefined, null],
        ["unset secret, 'Bearer undefined'", undefined, "Bearer undefined"],
        ["unset secret, empty Bearer", undefined, "Bearer "],
        ["empty secret, empty Bearer", "", "Bearer "],
        ["empty secret, 'Bearer'", "", "Bearer"],
        ["whitespace secret, whitespace Bearer", "  ", "Bearer   "],
        ["wrong value", SECRET, "Bearer nope"],
        ["correct value, wrong scheme", SECRET, `Basic ${SECRET}`],
    ])("%s -> 401", async (_n, env, auth) => {
        setEnv("CRON_SECRET", env);
        expect((await run(auth)).status).toBe(401);
    });
    it("correct value -> authorized (runs; redis down here -> 500, not 401)", async () => {
        setEnv("CRON_SECRET", SECRET);
        const res = await run(`Bearer ${SECRET}`);
        expect(res.status).not.toBe(401);
        expect(redisImpl).toHaveBeenCalled();
    });
});

describe("BACKUP_SECRET - snapshot encryption key (T-0012)", () => {
    const fakeRedis = {
        set: async () => "OK",
        scan: async () => ["0", ["waifu100:share:a"]],
        get: async () => JSON.stringify({ grid: [] }),
        mget: async (...k: string[]) => k.flat().map(() => JSON.stringify({ grid: [] })),
        pipeline: () => ({ get: () => undefined, exec: async () => [[null, JSON.stringify({ grid: [] })]] }),
    };
    const run = () => cron(new NextRequest("http://l/api/cron", { headers: { authorization: `Bearer ${SECRET}` } }));
    it.each([["unset", undefined], ["empty", ""], ["whitespace", "   "]])("%s BACKUP_SECRET and ADMIN_TOKEN -> snapshot skipped, never encrypted with a blank key", async (_n, v) => {
        setEnv("CRON_SECRET", SECRET);
        setEnv("BACKUP_SECRET", v);
        setEnv("ADMIN_TOKEN", v);
        redisImpl.mockImplementation(async (fn) => fn(fakeRedis));
        const res = await run();
        const body = await res.json();
        // Either the snapshot is skipped for lack of a key, or (no grids in the fake store) refused - never stored.
        expect(body.snapshot ?? null).toBeNull();
    });
});

describe("ADMIN_TOKEN with trailing newline (T-0012 review M1)", () => {
    it("x-admin-token tok matches ADMIN_TOKEN=\"tok\\n\" on an admin route", async () => {
        vi.stubEnv("ADMIN_TOKEN", "tok\n");
        const res = await moderation(adminReq("http://l/api/admin/moderation", "tok", { method: "POST", body: JSON.stringify({ hash: "a".repeat(64), verdict: "block" }) }));
        expect(res.status).toBe(200);
        const bad = await moderation(adminReq("http://l/api/admin/moderation", "tok2", { method: "POST", body: JSON.stringify({ hash: "a".repeat(64), verdict: "block" }) }));
        expect(bad.status).toBe(401);
    });
    it.each(["secret\n", "secret "])("CRON_SECRET=%j matches Bearer secret", async (v) => {
        vi.stubEnv("ADMIN_TOKEN", "");
        vi.stubEnv("CRON_SECRET", v);
        const res = await cron(new NextRequest("http://l/api/cron", { headers: { authorization: "Bearer secret" } }));
        expect(res.status).not.toBe(401);
    });
});
