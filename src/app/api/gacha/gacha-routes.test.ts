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

vi.mock("@/server/moderation/moderator", () => ({ getModeratedImage: vi.fn() }));

import sharp from "sharp";
import { GACHA_ID_HEADER } from "@/lib/gacha-id";
import { enforceRateLimit } from "@/lib/rate-limit";
import { hintImageToken } from "@/server/gacha/hint-image";
import { getModeratedImage } from "@/server/moderation/moderator";
import { NextRequest } from "next/server";
import { setCatalog } from "@/server/gacha/catalog";
import { addDays, bangkokDayKey, dailyPick, DEV_DAILY_SALT } from "@/server/gacha/rules";
import { configureGacha } from "@/server/gacha/service";
import { memoryGachaStore } from "@/server/gacha/store";
import { FIXTURE_CATALOG } from "@/server/gacha/test-fixture";
import { GET as albumGET } from "./album/route";
import { POST as guessPOST } from "./guess/route";
import { POST as hintPOST } from "./hint/route";
import { POST as recoveryPOST } from "./recovery/route";
import { POST as restorePOST } from "./restore/route";
import { GET as hintImageGET } from "./hint-image/route";
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
    vi.mocked(getModeratedImage).mockReset();
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

describe("image hints never expose the art URL", () => {
    const SALT = "route-salt";
    const day = bangkokDayKey(T0);
    const pick = () => dailyPick(FIXTURE_CATALOG, day, SALT);
    const answerChar = () => FIXTURE_CATALOG.anime.flatMap((a) => a.characters).find((c) => c.id === pick().answerId)!;
    const imgReq = (t: string) => new NextRequest(`http://localhost/api/gacha/hint-image?t=${encodeURIComponent(t)}`);
    let jpeg: Buffer;

    beforeEach(async () => {
        vi.stubEnv("DAILY_SALT", SALT);
        jpeg = await sharp({ create: { width: 230, height: 320, channels: 3, background: "#336" } }).jpeg().toBuffer();
    });

    it("an all-hints-open round DTO carries only opaque hint-image URLs", async () => {
        await todayGET(req("today"));
        const answer = answerChar();
        const wrong = FIXTURE_CATALOG.anime.find((a) => a.id === pick().animeId)!.characters.filter((c) => c.id !== answer.id);
        let round: { hints: { open: { key: string; src?: string }[] } } | null = null;
        for (const c of wrong.slice(0, 5)) round = await (await guessPOST(req("guess", "POST", { charId: c.id }))).json();
        const images = round!.hints.open.filter((h) => h.key === "blur" || h.key === "silhouette");
        expect(images.map((h) => h.key).sort()).toEqual(["blur", "silhouette"]);
        for (const h of images) expect(h.src).toMatch(/^\/api\/gacha\/hint-image\?t=[A-Za-z0-9_-]+$/);
        const body = JSON.stringify(round);
        expect(body).not.toContain(answer.image);
        expect(body).not.toContain(answer.silhouette!);
    });

    it("serves the rendered hint with only type, cache and nosniff headers", async () => {
        vi.mocked(getModeratedImage).mockResolvedValue({ ok: true, hash: "h", jpeg, checked: true });
        for (const kind of ["blur", "silhouette"] as const) {
            const res = await hintImageGET(imgReq(hintImageToken({ day, charId: 101, kind }, SALT)));
            expect(res.status).toBe(200);
            expect([...res.headers.keys()].map((k) => k.toLowerCase()).sort()).toEqual(["cache-control", "content-type", "x-content-type-options"]);
            expect(res.headers.get("content-type")).toBe(kind === "blur" ? "image/webp" : "image/png");
            expect(res.headers.get("cache-control")).toContain("s-maxage=604800");
            expect(Buffer.from(await res.arrayBuffer()).equals(jpeg)).toBe(false);
        }
        // fetched through the moderated, allow-listed proxy path, from the server-side art URL
        expect(vi.mocked(getModeratedImage).mock.calls[0][0]).toBe(FIXTURE_CATALOG.anime[0].characters[0].image);
    });

    it("unchecked art is cached briefly; refused art gets the neutral placeholder", async () => {
        const t = hintImageToken({ day, charId: 101, kind: "blur" }, SALT);
        vi.mocked(getModeratedImage).mockResolvedValueOnce({ ok: true, hash: "h", jpeg, checked: false, reason: "no-key" });
        expect((await hintImageGET(imgReq(t))).headers.get("cache-control")).toBe("public, max-age=60, s-maxage=60");
        vi.mocked(getModeratedImage).mockResolvedValueOnce({ ok: false, hash: "h", reason: "blocked", definitive: true });
        const res = await hintImageGET(imgReq(t));
        expect(res.headers.get("content-type")).toBe("image/svg+xml");
        expect([...res.headers.keys()].map((k) => k.toLowerCase()).sort()).toEqual(["cache-control", "content-type", "x-content-type-options"]);
    });

    it("404s forged, foreign-salt, future, expired and unknown-character tokens without fetching", async () => {
        const bad = [
            "not-a-token-at-all-but-long-enough",
            hintImageToken({ day, charId: 101, kind: "blur" }, "someone-elses-salt"),
            hintImageToken({ day: addDays(day, 1), charId: 101, kind: "blur" }, SALT),
            hintImageToken({ day: addDays(day, -60), charId: 101, kind: "blur" }, SALT),
            hintImageToken({ day, charId: 999999, kind: "blur" }, SALT),
        ];
        for (const t of bad) {
            const res = await hintImageGET(imgReq(t));
            expect(res.status).toBe(404);
            expect(res.headers.get("cache-control")).toBe("no-store");
        }
        expect(getModeratedImage).not.toHaveBeenCalled();
    });

    it("is rate-limited before any work", async () => {
        vi.mocked(enforceRateLimit).mockResolvedValueOnce(new Response("slow down", { status: 429 }) as never);
        const res = await hintImageGET(imgReq(hintImageToken({ day, charId: 101, kind: "blur" }, SALT)));
        expect(res.status).toBe(429);
        expect(res.headers.get("cache-control")).toBe("no-store");
        expect(vi.mocked(enforceRateLimit).mock.calls.at(-1)![1]).toMatchObject({ name: "gacha-image" });
        expect(getModeratedImage).not.toHaveBeenCalled();
    });
});
