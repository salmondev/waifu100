import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mocks only: no Redis, no network.
vi.mock("@/lib/redis", () => ({
    withRedis: async () => {
        throw new Error("Redis must not be used in gacha route tests");
    },
}));
vi.mock("@/lib/rate-limit", async (orig) => ({
    ...(await orig<typeof import("@/lib/rate-limit")>()),
    enforceRateLimit: vi.fn(async () => null),
    consume: vi.fn(async () => ({ allowed: true, remaining: 1, resetSec: 60 })),
}));

import { GACHA_ID_HEADER } from "@/lib/gacha-id";
import { setCatalog } from "@/server/gacha/catalog";
import { bangkokDayKey, dailyPick, DEV_DAILY_SALT } from "@/server/gacha/rules";
import { configureGacha } from "@/server/gacha/service";
import { memoryGachaStore } from "@/server/gacha/store";
import { FIXTURE_CATALOG } from "@/server/gacha/test-fixture";
import { GET as albumGET } from "./album/route";
import { POST as guessPOST } from "./guess/route";
import { POST as hintPOST } from "./hint/route";
import { POST as recoveryPOST } from "./recovery/route";
import { POST as restorePOST } from "./restore/route";
import { GET as todayGET } from "./today/route";

const ID = "3f1c2b7a-9d4e-4a6b-8c1d-2e3f4a5b6c7d";
const T0 = Date.parse("2026-10-27T05:00:00Z");

const req = (path: string, method = "GET", body?: unknown) =>
    new Request(`http://localhost/api/gacha/${path}`, {
        method,
        headers: { [GACHA_ID_HEADER]: ID, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
    });

let store: ReturnType<typeof memoryGachaStore>;
let touched = 0;

beforeEach(() => {
    store = memoryGachaStore();
    touched = 0;
    const spy = {
        ...store,
        load: async (id: string) => (touched++, store.load(id)),
        save: async (id: string, p: Parameters<typeof store.save>[1]) => (touched++, store.save(id, p)),
        getRecovery: async (hash: string) => (touched++, store.getRecovery(hash)),
    };
    // no salt override: the routes resolve DAILY_SALT from the environment
    configureGacha({ store: spy, now: () => T0 });
    setCatalog(FIXTURE_CATALOG);
});
afterEach(() => {
    vi.unstubAllEnvs();
    configureGacha();
    setCatalog(null);
});

describe("DAILY_SALT fails closed in production", () => {
    const calls: [string, () => Promise<Response>][] = [
        ["today", () => todayGET(req("today"))],
        ["guess", () => guessPOST(req("guess", "POST", { charId: 101 }))],
        ["hint", () => hintPOST(req("hint", "POST", {}))],
        ["album", () => albumGET(req("album"))],
        ["recovery", () => recoveryPOST(req("recovery", "POST", {}))],
        ["restore", () => restorePOST(req("restore", "POST", { code: "ABCD-EFGH-JKMN" }))],
    ];

    it.each(calls)("%s -> 503 gacha_misconfigured without touching the store (NODE_ENV=production)", async (_n, call) => {
        vi.stubEnv("NODE_ENV", "production");
        vi.stubEnv("DAILY_SALT", "");
        const errors = vi.spyOn(console, "error").mockImplementation(() => {});
        const res = await call();
        expect(res.status).toBe(503);
        expect(await res.json()).toMatchObject({ code: "gacha_misconfigured" });
        expect(res.headers.get("cache-control")).toBe("no-store");
        expect(touched).toBe(0);
        expect(errors.mock.calls.flat().join(" ")).toContain("DAILY_SALT is not set");
        errors.mockRestore();
    });

    it("also on a Vercel preview deployment", async () => {
        vi.stubEnv("NODE_ENV", "development");
        vi.stubEnv("VERCEL_ENV", "preview");
        vi.stubEnv("DAILY_SALT", "");
        vi.spyOn(console, "error").mockImplementation(() => {});
        const res = await todayGET(req("today"));
        expect(res.status).toBe(503);
        expect(touched).toBe(0);
    });

    it("works in production once DAILY_SALT is set, and uses it", async () => {
        vi.stubEnv("NODE_ENV", "production");
        vi.stubEnv("DAILY_SALT", "prod-salt-for-test");
        const res = await todayGET(req("today"));
        expect(res.status).toBe(200);
        const round = await res.json();
        const pick = dailyPick(FIXTURE_CATALOG, bangkokDayKey(T0), "prod-salt-for-test");
        expect(round.anime.id).toBe(pick.animeId);
        const saved = await store.load(ID);
        expect(saved!.rounds[bangkokDayKey(T0)].answerId).toBe(pick.answerId);
    });

    it("falls back to the dev salt outside production", async () => {
        vi.stubEnv("NODE_ENV", "development");
        vi.stubEnv("VERCEL_ENV", "");
        vi.stubEnv("DAILY_SALT", "");
        const res = await todayGET(req("today"));
        expect(res.status).toBe(200);
        const saved = await store.load(ID);
        expect(saved!.rounds[bangkokDayKey(T0)].answerId).toBe(dailyPick(FIXTURE_CATALOG, bangkokDayKey(T0), DEV_DAILY_SALT).answerId);
    });
});
