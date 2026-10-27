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
import { configureGacha, type RoundDto } from "@/server/gacha/service";
import { memoryGachaStore } from "@/server/gacha/store";
import { FIXTURE_CATALOG } from "@/server/gacha/test-fixture";
import { GET as albumGET } from "./album/route";
import { GET as archiveGET } from "./archive/route";
import { POST as guessPOST } from "./guess/route";
import { POST as hintPOST } from "./hint/route";
import { POST as recoveryPOST } from "./recovery/route";
import { POST as restorePOST } from "./restore/route";
import { GET as hintImageGET } from "./hint-image/route";
import { POST as storySeenPOST } from "./story-seen/route";
import { GET as practiceGET, POST as practicePOST } from "./practice/route";
import { POST as practiceGuessPOST } from "./practice/guess/route";
import { POST as shieldPOST } from "./shield/route";
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
let clock = T0;

beforeEach(() => {
    store = memoryGachaStore();
    touched = 0;
    clock = T0;
    const spy = {
        ...store,
        load: async (id: string) => (touched++, store.load(id)),
        save: async (id: string, p: Parameters<typeof store.save>[1]) => (touched++, store.save(id, p)),
        getRecovery: async (hash: string) => (touched++, store.getRecovery(hash)),
    };
    // no salt override: the routes resolve DAILY_SALT from the environment
    configureGacha({ store: spy, now: () => clock });
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
        ["story-seen", () => storySeenPOST(req("story-seen", "POST", { animeId: 9001 }))],
        ["shield", () => shieldPOST(req("shield", "POST", {}))],
        ["practice", () => practicePOST(req("practice", "POST", {}))],
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
        // r2: hints open only by buying, so give the profile enough coins for all five
        const p = (await store.load(ID))!;
        p.coins = 1000;
        await store.save(ID, p);
        let round: { hints: { open: { key: string; src?: string }[] } } | null = null;
        for (let slot = 1; slot <= 5; slot++) round = await (await hintPOST(req("hint", "POST", { slot }))).json();
        expect((round as unknown as RoundDto).hints.missing).toEqual([]); // fixture answer has every field
        const images = round!.hints.open.filter((h) => h.key === "blur" || h.key === "silhouette" || h.key === "eyes");
        expect(images.map((h) => h.key).sort()).toEqual(["blur", "eyes", "silhouette"]);
        for (const h of images) expect(h.src).toMatch(/^\/api\/gacha\/hint-image\?t=[A-Za-z0-9_-]+$/);
        const body = JSON.stringify(round);
        expect(body).not.toContain(answer.image);
        expect(body).not.toContain(answer.silhouette!);
    });

    it("serves the rendered hint with only type, cache and nosniff headers", async () => {
        vi.mocked(getModeratedImage).mockResolvedValue({ ok: true, hash: "h", jpeg, checked: true });
        for (const kind of ["blur", "silhouette", "eyes"] as const) {
            const res = await hintImageGET(imgReq(hintImageToken({ day, charId: 101, kind }, SALT)));
            expect(res.status).toBe(200);
            expect([...res.headers.keys()].map((k) => k.toLowerCase()).sort()).toEqual(["cache-control", "content-type", "x-content-type-options"]);
            expect(res.headers.get("content-type")).toBe(kind === "silhouette" ? "image/png" : "image/webp");
            // T0 is 12:00 in Bangkok: the token dies at midnight, so no cache may hold it longer
            expect(res.headers.get("cache-control")).toBe("public, max-age=43200, s-maxage=43200, immutable");
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

    it("a token is bound to its round's day: today any card character, a past day only that day's answer, in the window", async () => {
        vi.mocked(getModeratedImage).mockResolvedValue({ ok: true, hash: "h", jpeg, checked: true });
        const y = addDays(day, -1);
        const yAnswer = dailyPick(FIXTURE_CATALOG, y, SALT).answerId;
        const yOther = FIXTURE_CATALOG.anime.flatMap((a) => a.characters).find((c) => c.id !== yAnswer)!.id;
        const todays = hintImageToken({ day, charId: 101, kind: "blur" }, SALT);
        expect((await hintImageGET(imgReq(todays))).status).toBe(200);
        // yesterday's round: its own answer is served, any other character is not
        const yOk = await hintImageGET(imgReq(hintImageToken({ day: y, charId: yAnswer, kind: "blur" }, SALT)));
        expect(yOk.status).toBe(200);
        expect(yOk.headers.get("cache-control")).toBe("public, max-age=43200, s-maxage=43200, immutable");
        const old = await hintImageGET(imgReq(hintImageToken({ day: y, charId: yOther, kind: "blur" }, SALT)));
        expect(old.status).toBe(404);
        expect(old.headers.get("cache-control")).toBe("no-store");

        // one minute before Bangkok midnight: still valid, cached for at most that minute
        clock = Date.parse("2026-10-27T16:59:00Z");
        const late = await hintImageGET(imgReq(todays));
        expect(late.status).toBe(200);
        expect(late.headers.get("cache-control")).toBe("public, max-age=60, s-maxage=60, immutable");
        // the next Bangkok day: the token is now a past day's and serves only if 101 was that day's answer
        clock = Date.parse("2026-10-27T17:00:00Z");
        const next = await hintImageGET(imgReq(todays));
        expect(next.status).toBe(dailyPick(FIXTURE_CATALOG, day, SALT).answerId === 101 ? 200 : 404);
        // and tomorrow's (now today's) token never worked before its day: checked in the 404 test above
    });

    it("a legacy-shaped stored round whose answer != the new dailyPick: its hint images serve 200, any other character 404", async () => {
        vi.mocked(getModeratedImage).mockResolvedValue({ ok: true, hash: "h", jpeg, checked: true });
        const y = addDays(day, -1);
        const newPick = dailyPick(FIXTURE_CATALOG, y, SALT);
        const anime = FIXTURE_CATALOG.anime.find((a) => a.id !== newPick.animeId)!;
        const oldAnswer = anime.characters.find((c) => c.image)!;
        const wrong = anime.characters.filter((c) => c.id !== oldAnswer.id).map((c) => c.id);
        // 7ad2672 shape: no `rules`, no `archive`; answer chosen by the old picker
        await store.save(ID, {
            v: 1, createdAt: T0 - 2 * 86_400_000, coins: 50, recoveryHash: null, storySeen: [], collection: {}, finishedDays: [y],
            rounds: { [y]: { day: y, animeId: anime.id, answerId: oldAnswer.id, guesses: wrong.slice(0, 2), bought: 0, done: "lost", dailyCoins: 10, bonus: 0, pull: null, storyUnlockedNow: false } },
        } as never);
        const res = await todayGET(req(`today?day=${y}`));
        expect(res.status).toBe(200);
        const round = (await res.json()) as RoundDto;
        expect(round.result!.answer.id).toBe(oldAnswer.id);
        const srcs = round.hints.open.flatMap((h) => ("src" in h && typeof h.src === "string" ? [h.src] : []));
        expect(srcs.length).toBeGreaterThan(0);
        for (const src of srcs) {
            const img = await hintImageGET(imgReq(new URL(src, "http://x").searchParams.get("t")!));
            expect(img.status).toBe(200);
            expect(img.headers.get("content-type")).toMatch(/^image\/(webp|png)$/);
        }
        expect(vi.mocked(getModeratedImage).mock.calls.every((c) => c[0] === oldAnswer.image)).toBe(true);
        // still bound: the new picker's answer, another character of that anime, or another player's token are 404
        for (const t of [
            hintImageToken({ day: y, charId: newPick.answerId, kind: "blur", pid: ID }, SALT),
            hintImageToken({ day: y, charId: wrong[0], kind: "blur", pid: ID }, SALT),
            hintImageToken({ day: y, charId: oldAnswer.id, kind: "blur", pid: "7a2b3c4d-5e6f-4a1b-9c2d-3e4f5a6b7c8d" }, SALT),
        ]) {
            const bad = await hintImageGET(imgReq(t));
            expect(bad.status).toBe(404);
            expect(bad.headers.get("cache-control")).toBe("no-store");
        }
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

describe("POST /api/gacha/hint (fixed slot ladder)", () => {
    beforeEach(() => vi.stubEnv("DAILY_SALT", "hint-salt"));
    const coins = async () => (await store.load(ID))!.coins;

    it("rejects kind-specific and malformed bodies with 400, before any store access", async () => {
        await todayGET(req("today"));
        const before = touched;
        for (const body of [{ kind: "blur" }, { key: "hair" }, { slot: 1, kind: "role" }, { slot: "1" }, { slot: 0 }, { slot: 6 }, { slot: 1.5 }]) {
            const res = await hintPOST(req("hint", "POST", body));
            expect(res.status).toBe(400);
            expect(await res.json()).toMatchObject({ code: "invalid_hint_request" });
            expect(res.headers.get("cache-control")).toBe("no-store");
        }
        for (const body of [[1], "1", null]) {
            const res = await hintPOST(req("hint", "POST", body));
            expect(res.status).toBe(400);
            expect(await res.json()).toMatchObject({ code: "invalid_body" });
        }
        expect(touched).toBe(before);
    });

    it("rejects an out-of-order slot with 409 and charges nothing; the next slot works", async () => {
        await todayGET(req("today"));
        const rich = (await store.load(ID))!;
        rich.coins = 100; // 30 + 40 for the two buys below
        await store.save(ID, rich);
        const start = await coins();
        const skip = await hintPOST(req("hint", "POST", { slot: 3 }));
        expect(skip.status).toBe(409);
        expect(await skip.json()).toMatchObject({ code: "hint_out_of_order" });
        expect(await coins()).toBe(start);

        const ok = await hintPOST(req("hint", "POST", { slot: 1 }));
        expect(ok.status).toBe(200);
        const round = (await ok.json()) as RoundDto;
        expect(round.hints).not.toHaveProperty("total");
        expect(round.hints.next).toMatchObject({ slot: 2, price: 40 });
        expect(await coins()).toBe(start - 30);

        // a retried slot-1 request must not silently buy slot 2
        expect((await hintPOST(req("hint", "POST", { slot: 1 }))).status).toBe(409);
        expect(await coins()).toBe(start - 30);
        // an empty body still buys "the next slot" (older clients)
        expect((await hintPOST(req("hint", "POST", {}))).status).toBe(200);
        expect(await coins()).toBe(start - 70);
        // short of the next price (50): 409 not_enough_coins with a readable message, nothing charged
        const short = await hintPOST(req("hint", "POST", {}));
        expect(short.status).toBe(409);
        expect(await short.json()).toMatchObject({ code: "not_enough_coins", error: "Not enough coins." });
        expect(await coins()).toBe(start - 70);
    });

    it("T-0024: the free first guess + 6 counted = 7 guesses; the 8th is 409 round_over", async () => {
        const first = (await (await todayGET(req("today"))).json()) as RoundDto;
        expect(first).toMatchObject({ maxGuesses: 6, freeGuess: { on: true, used: false }, steps: { used: 0 } });
        // pin the round to the fixture anime with enough wrong names (9001: 7 besides the answer)
        const p = (await store.load(ID))!;
        Object.assign(p.rounds[bangkokDayKey(T0)], { animeId: 9001, answerId: 101 });
        await store.save(ID, p);
        const answer = { answerId: 101 };
        const wrong = FIXTURE_CATALOG.anime.find((a) => a.id === 9001)!.characters.filter((c) => c.id !== 101).map((c) => c.id);
        let last: RoundDto | undefined;
        for (const id of wrong.slice(0, 7)) {
            const res = await guessPOST(req("guess", "POST", { charId: id }));
            expect(res.status).toBe(200);
            last = (await res.json()) as RoundDto;
        }
        expect(last).toMatchObject({ done: "lost", steps: { used: 6 }, freeGuess: { on: true, used: true } });
        expect(last!.guesses).toHaveLength(7);
        const eighth = await guessPOST(req("guess", "POST", { charId: answer.answerId }));
        expect(eighth.status).toBe(409);
        expect(await eighth.json()).toMatchObject({ code: "round_over" });
    });
});

describe("POST /api/gacha/story-seen", () => {
    beforeEach(() => vi.stubEnv("DAILY_SALT", "story-salt"));

    it("validates the body, refuses a locked story, then marks an unlocked one idempotently", async () => {
        expect((await storySeenPOST(req("story-seen", "POST", { animeId: "9001" }))).status).toBe(400);
        expect((await storySeenPOST(req("story-seen", "POST", { animeId: 9001 }))).status).toBe(404); // no profile yet
        await todayGET(req("today"));
        const locked = await storySeenPOST(req("story-seen", "POST", { animeId: 9001 }));
        expect(locked.status).toBe(409);
        expect(await locked.json()).toMatchObject({ code: "story_locked" });

        const p = (await store.load(ID))!;
        const frieren = FIXTURE_CATALOG.anime[0];
        p.collection = Object.fromEntries(frieren.characters.slice(0, 3).map((c) => [c.id, { tier: "rare" as const, day: "2026-10-20", animeId: frieren.id }]));
        await store.save(ID, p);

        // loading the album twice does not consume "new"
        await albumGET(req("album"));
        const album = await (await albumGET(req("album"))).json();
        expect(album.anime[0].story).toEqual({ unlocked: true, fresh: true });

        for (let i = 0; i < 2; i++) {
            const res = await storySeenPOST(req("story-seen", "POST", { animeId: frieren.id }));
            expect(res.status).toBe(200);
            expect(res.headers.get("cache-control")).toBe("no-store");
        }
        expect((await store.load(ID))!.storySeen).toEqual([frieren.id]);
        expect((await (await albumGET(req("album"))).json()).anime[0].story).toEqual({ unlocked: true, fresh: false });
    });
});

describe("archive (past days) routes", () => {
    beforeEach(() => vi.stubEnv("DAILY_SALT", "arch-salt"));
    const day = bangkokDayKey(T0);
    const y = addDays(day, -1);

    it("GET /archive lists 30 past days, newest first, never future; 404 for an unknown player; rate-limited as a read", async () => {
        expect((await archiveGET(req("archive"))).status).toBe(404);
        await todayGET(req("today"));
        const res = await archiveGET(req("archive"));
        expect(res.status).toBe(200);
        expect(res.headers.get("cache-control")).toBe("no-store");
        const body = await res.json();
        expect(body.today).toMatchObject({ key: day, state: "playing" });
        expect(body.days).toHaveLength(30);
        expect(body.days[0]).toMatchObject({ key: y, state: "new", tier: null });
        expect(body.days.every((d: { key: string }) => d.key < day)).toBe(true);
        vi.mocked(enforceRateLimit).mockResolvedValueOnce(new Response("slow down", { status: 429 }) as never);
        expect((await archiveGET(req("archive"))).status).toBe(429);
        expect(vi.mocked(enforceRateLimit).mock.calls.at(-1)![1]).toMatchObject({ name: "gacha-read" });
    });

    it("GET /today?day= : 400 malformed, 404 future / out of window, 200 for a past day (not stored)", async () => {
        await todayGET(req("today"));
        for (const bad of ["2026-13-01", "2026-02-31", "yesterday", "2026-10-26T00:00"]) {
            const res = await todayGET(req(`today?day=${encodeURIComponent(bad)}`));
            expect(res.status).toBe(400);
            expect(await res.json()).toMatchObject({ code: "invalid_day" });
        }
        for (const gone of [addDays(day, 1), addDays(day, -31), "2020-01-01"]) {
            const res = await todayGET(req(`today?day=${gone}`));
            expect(res.status).toBe(404);
            expect(await res.json()).toMatchObject({ code: "day_unavailable" });
        }
        const ok = await todayGET(req(`today?day=${y}`));
        expect(ok.status).toBe(200);
        expect(await ok.json()).toMatchObject({ archive: true, dailyCoins: 0, day: { key: y } });
        expect(Object.keys((await store.load(ID))!.rounds)).toEqual([day]);
    });

    it("POST guess / hint take an optional day: 400 malformed, 404 future, 200 for a past day; a finished day is 409", async () => {
        await todayGET(req("today"));
        expect((await guessPOST(req("guess", "POST", { charId: 101, day: "nope" }))).status).toBe(400);
        expect((await hintPOST(req("hint", "POST", { slot: 1, day: 20261026 }))).status).toBe(400);
        const fut = await guessPOST(req("guess", "POST", { charId: 101, day: addDays(day, 1) }));
        expect(fut.status).toBe(404);
        expect((await hintPOST(req("hint", "POST", { slot: 1, day: addDays(day, 1) }))).status).toBe(404);
        const h = await hintPOST(req("hint", "POST", { slot: 1, day: y }));
        expect(h.status).toBe(200);
        expect(await h.json()).toMatchObject({ archive: true, coins: 15 });
        const answer = dailyPick(FIXTURE_CATALOG, y, "arch-salt").answerId;
        const won = await guessPOST(req("guess", "POST", { charId: answer, day: y }));
        expect(await won.json()).toMatchObject({ done: "won", archive: true, coins: 25, dailyCoins: 10, streak: 0 }); // that day's daily coins, paid on finish
        const again = await guessPOST(req("guess", "POST", { charId: answer, day: y }));
        expect(again.status).toBe(409);
        expect(await again.json()).toMatchObject({ code: "round_over" });
        const view = await todayGET(req(`today?day=${y}`));
        expect(await view.json()).toMatchObject({ done: "won", archive: true, coins: 25 });
        expect(vi.mocked(enforceRateLimit).mock.calls.some((c) => (c[1] as { name: string }).name === "gacha-write")).toBe(true);
    });

    it("a page open past Bangkok midnight: guess and hint sent with the round's day land on that round, never the new day", async () => {
        await todayGET(req("today"));
        const p = (await store.load(ID))!;
        p.coins = 100;
        await store.save(ID, p);
        clock = Date.parse("2026-10-27T17:01:00Z"); // 00:01 the next Bangkok day
        const next = addDays(day, 1);
        const h = await hintPOST(req("hint", "POST", { slot: 1, day }));
        expect(h.status).toBe(200);
        expect(await h.json()).toMatchObject({ day: { key: day }, archive: true });
        const r0 = (await store.load(ID))!.rounds[day];
        const wrong = FIXTURE_CATALOG.anime.find((a) => a.id === r0.animeId)!.characters.find((c) => c.id !== r0.answerId)!.id;
        const g = await guessPOST(req("guess", "POST", { charId: wrong, day }));
        expect(g.status).toBe(200);
        expect(await g.json()).toMatchObject({ day: { key: day } });
        const saved = (await store.load(ID))!;
        expect(saved.rounds[day]).toMatchObject({ bought: 1, guesses: [wrong] });
        expect(saved.rounds[next]?.bought ?? 0).toBe(0);
        expect(saved.rounds[next]?.guesses ?? []).toEqual([]);
        // a day the page could not have had: future or out of the window is still 404, nothing written
        expect((await guessPOST(req("guess", "POST", { charId: wrong, day: addDays(next, 1) }))).status).toBe(404);
        expect((await hintPOST(req("hint", "POST", { slot: 1, day: addDays(next, -31) }))).status).toBe(404);
    });

    it("GET /archive gives today's tier once today is won", async () => {
        await todayGET(req("today"));
        const answer = dailyPick(FIXTURE_CATALOG, day, "arch-salt").answerId;
        const won = await (await guessPOST(req("guess", "POST", { charId: answer, day }))).json();
        expect(won.done).toBe("won");
        const body = await (await archiveGET(req("archive"))).json();
        expect(body.today).toEqual({ key: day, number: expect.any(Number), state: "won", tier: won.result.pull.tier });
        expect(body.today.tier).not.toBeNull();
    });
});

describe("shield and practice routes", () => {
    it("a shield costs 30 and a practice win does not touch today's round", async () => {
        const today = await todayGET(req("today"));
        expect(today.status).toBe(200);
        const before = await today.json();
        const shield = await shieldPOST(req("shield", "POST", {}));
        expect(shield.status).toBe(200);
        expect(await shield.json()).toMatchObject({ coins: before.coins - 30, shields: 1 });
        const started = await practicePOST(req("practice", "POST", {}));
        expect(started.status).toBe(200);
        const practice = await started.json();
        expect(practice.practice).toBe(true);
        const won = await practiceGuessPOST(req("practice/guess", "POST", { charId: (await store.load(ID))!.practice!.answerId }));
        expect(won.status).toBe(200);
        expect(await won.json()).toMatchObject({ done: "won", practice: true });
        const saved = (await store.load(ID))!;
        expect(saved.rounds[before.day.key].guesses).toEqual([]);
        expect(saved.collection).toEqual({});
        expect((await practiceGET(req("practice"))).status).toBe(200);
    });
});
