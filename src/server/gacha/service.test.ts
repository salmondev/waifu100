import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Belt and braces: nothing in these tests may reach a real Redis.
vi.mock("@/lib/redis", () => ({
    withRedis: async () => {
        throw new Error("Redis must not be used in gacha unit tests");
    },
}));

import { setCatalog } from "./catalog";
import { addDays, bangkokDayKey, dailyPick, guessRoster, hintLadder, type Tier } from "./rules";
import { hintImageToken } from "./hint-image";
import { ARCHIVE_DAYS, FIRST_DAY_KEY } from "./rules";
import {
    buyHint,
    configureGacha,
    GachaError,
    getAlbum,
    getArchive,
    getDay,
    getToday,
    guess,
    markStorySeen,
    mintRecovery,
    resolveHintImage,
    restore,
    type RoundDto,
} from "./service";
import { memoryGachaStore, type GachaProfile } from "./store";
import { FIXTURE_CATALOG } from "./test-fixture";

const SALT = "test-salt";
const ID = "3f1c2b7a-9d4e-4a6b-8c1d-2e3f4a5b6c7d";
const ID2 = "7a2b3c4d-5e6f-4a1b-9c2d-3e4f5a6b7c8d";
const T0 = Date.parse("2026-10-27T05:00:00Z"); // 12:00 in Bangkok

let store: ReturnType<typeof memoryGachaStore>;
let now = T0;

const today = () => bangkokDayKey(now);
const pick = () => dailyPick(FIXTURE_CATALOG, today(), SALT);
const animeOf = (id: number) => FIXTURE_CATALOG.anime.find((a) => a.id === id)!;
const answer = () => animeOf(pick().animeId).characters.find((c) => c.id === pick().answerId)!;
const wrongIds = () => animeOf(pick().animeId).characters.filter((c) => c.id !== pick().answerId).map((c) => c.id);
const profile = async (id = ID) => JSON.parse(store.profiles.get(id)!) as GachaProfile;

async function code(p: Promise<unknown>): Promise<string> {
    try {
        await p;
    } catch (e) {
        return e instanceof GachaError ? e.code : String(e);
    }
    return "ok";
}

/** The DTO minus the autocomplete pool, which legitimately lists every character. */
function withoutCandidates(dto: RoundDto) {
    const rest: Partial<RoundDto> = { ...dto };
    delete rest.candidates;
    return JSON.stringify(rest);
}

beforeEach(() => {
    now = T0;
    store = memoryGachaStore();
    configureGacha({ store, now: () => now, salt: () => SALT });
    setCatalog(FIXTURE_CATALOG);
});
afterEach(() => {
    configureGacha();
    setCatalog(null);
});

describe("getToday", () => {
    it("creates the profile with 35 + 10 coins and today's round", async () => {
        const dto = await getToday(ID);
        expect(dto.created).toBe(true);
        expect(dto.coins).toBe(45);
        expect(dto.dailyCoins).toBe(10);
        expect(dto.day).toEqual({ key: "2026-10-27", number: 31 });
        expect(dto.archive).toBe(false);
        expect(dto.anime.id).toBe(pick().animeId);
        expect(dto.candidates).toHaveLength(guessRoster(animeOf(pick().animeId)).length);
        expect(dto.steps).toEqual({ used: 0, hintsCostTier: true });
        expect((await profile()).rounds[today()].rules).toBe(2);
        expect(dto.done).toBeNull();
        expect(dto.result).toBeNull();
        expect(dto.hints.open).toEqual([]);
        expect(dto.hints.next).toEqual({ slot: 1, price: 15, affordable: true });
    });

    it("grants the daily coins once per Bangkok day", async () => {
        await getToday(ID);
        await getToday(ID);
        expect((await getToday(ID)).coins).toBe(45);
        now = Date.parse("2026-10-27T16:59:00Z"); // still the 27th in Bangkok
        expect((await getToday(ID)).coins).toBe(45);
        now = Date.parse("2026-10-27T17:00:00Z"); // the 28th
        const next = await getToday(ID);
        expect(next.day.key).toBe("2026-10-28");
        expect(next.coins).toBe(55);
        expect((await getToday(ID)).coins).toBe(55);
    });

    it("refuses to create a profile when canCreate says no, but never asks for an existing one", async () => {
        expect(await code(getToday(ID, { canCreate: async () => false }))).toBe("create_limited");
        expect(store.profiles.size).toBe(0);
        const canCreate = vi.fn(async () => true);
        await getToday(ID, { canCreate });
        await getToday(ID, { canCreate });
        expect(canCreate).toHaveBeenCalledTimes(1);
    });

    it("keeps only the last 60 days of rounds", async () => {
        await getToday(ID);
        now += 61 * 86_400_000;
        await getToday(ID);
        expect(Object.keys((await profile()).rounds)).toEqual([today()]);
    });
});

describe("guess", () => {
    it("win flow: tier by guess count, fast bonus, pull committed", async () => {
        await getToday(ID);
        const miss = await guess(ID, wrongIds()[0]);
        expect(miss.done).toBeNull();
        expect(miss.guesses).toEqual([expect.objectContaining({ id: wrongIds()[0], correct: false })]);
        expect(miss.guesses[0].feedback.map((c) => c.col)).toEqual(["gender", "role", "age", "month", "rank", "va"]);
        // r2: a wrong guess gives feedback, not a free hint
        expect(miss.hints.open).toHaveLength(0);
        expect(miss.steps.used).toBe(1);

        const won = await guess(ID, pick().answerId);
        expect(won.done).toBe("won");
        expect(won.coins).toBe(45 + 20);
        expect(won.streak).toBe(1);
        expect(won.result).toMatchObject({
            answer: { id: answer().id, name: answer().name, image: answer().image, setCode: animeOf(pick().animeId).setCode, tier: "sr" },
            pull: { result: "new", prevTier: null, tier: "sr" },
            bonus: 20,
            storyUnlockedNow: false,
        });
        expect(won.result!.answer.number).toMatch(/^\d{3}$/);
        expect(won.hints.locked).toBe(0);
        const p = await profile();
        expect(p.collection[String(answer().id)]).toEqual({ tier: "sr", day: today(), animeId: pick().animeId });
        expect(p.finishedDays).toEqual([today()]);
    });

    it("lose flow: six wrong guesses end the round, answer shown, nothing pulled", async () => {
        await getToday(ID);
        let dto: RoundDto | undefined;
        for (const w of wrongIds().slice(0, 6)) dto = await guess(ID, w);
        expect(dto!.done).toBe("lost");
        expect(dto!.coins).toBe(45);
        expect(dto!.result).toMatchObject({ answer: { id: answer().id, tier: null }, pull: null, bonus: 0 });
        expect((await profile()).collection).toEqual({});
        expect(dto!.streak).toBe(1);
        expect(await code(guess(ID, pick().answerId))).toBe("round_over");
    });

    it("never pulls twice: repeat and concurrent submits", async () => {
        await getToday(ID);
        const [a, b] = await Promise.allSettled([guess(ID, pick().answerId), guess(ID, pick().answerId)]);
        const ok = [a, b].filter((r) => r.status === "fulfilled");
        expect(ok).toHaveLength(1);
        expect([a, b].find((r) => r.status === "rejected")).toMatchObject({ reason: { code: "round_over" } });
        expect(await code(guess(ID, pick().answerId))).toBe("round_over");
        const reload = await getToday(ID);
        expect(reload.result!.pull).toEqual({ result: "new", prevTier: null, tier: "ssr" });
        expect(reload.coins).toBe(45 + 30);
        expect(Object.keys((await profile()).collection)).toHaveLength(1);
    });

    it("upgrade keeps the higher tier; same writes nothing", async () => {
        await getToday(ID);
        const p = await profile();
        p.collection[String(pick().answerId)] = { tier: "common", day: "2026-10-01", animeId: pick().animeId };
        await store.save(ID, p);
        const won = await guess(ID, pick().answerId);
        expect(won.result!.pull).toEqual({ result: "upgrade", prevTier: "common", tier: "ssr" });
        expect((await profile()).collection[String(pick().answerId)].tier).toBe("ssr");

        await getToday(ID2);
        const q = await profile(ID2);
        q.collection[String(pick().answerId)] = { tier: "ssr", day: "2026-10-01", animeId: pick().animeId };
        await store.save(ID2, q);
        await guess(ID2, wrongIds()[0]);
        const same = await guess(ID2, pick().answerId);
        expect(same.result!.pull).toEqual({ result: "same", prevTier: "ssr", tier: "sr" });
        expect(same.result!.answer.tier).toBe("sr");
        expect((await profile(ID2)).collection[String(pick().answerId)]).toEqual({ tier: "ssr", day: "2026-10-01", animeId: pick().animeId });
    });

    it("unlocks the story on the third card of an anime", async () => {
        await getToday(ID);
        const p = await profile();
        for (const w of wrongIds().slice(0, 2)) p.collection[String(w)] = { tier: "rare" as Tier, day: "2026-10-01", animeId: pick().animeId };
        await store.save(ID, p);
        expect((await guess(ID, pick().answerId)).result!.storyUnlockedNow).toBe(true);
    });

    it("validates the character", async () => {
        await getToday(ID);
        const otherAnime = FIXTURE_CATALOG.anime.find((a) => a.id !== pick().animeId)!.characters[0].id;
        expect(await code(guess(ID, otherAnime))).toBe("invalid_character");
        expect(await code(guess(ID, 999_999))).toBe("invalid_character");
        await guess(ID, wrongIds()[0]);
        expect(await code(guess(ID, wrongIds()[0]))).toBe("already_guessed");
        expect(await code(guess(ID2, wrongIds()[0]))).toBe("no_profile");
    });

    it("never leaks the answer before the round is done", async () => {
        const a = answer();
        const ladder = hintLadder(a);
        const leaks = (dto: RoundDto) => {
            const s = withoutCandidates(dto);
            expect(s).not.toContain(a.name);
            expect(s).not.toContain(a.image);
            expect(s).not.toContain(`"id":${a.id},`);
            expect(s).not.toContain(`"id":${a.id}}`);
        };
        leaks(await getToday(ID));
        // every hint before blur may open; blur (the image) is the accepted exception
        for (const w of wrongIds().slice(0, ladder.length - 1)) leaks(await guess(ID, w));
        expect(JSON.stringify((await getToday(ID)).candidates.map((c) => Object.keys(c).sort()))).not.toContain("image");
    });
});

describe("buyHint", () => {
    it("opens the next hint at its ladder price; a wrong guess opens nothing (r2)", async () => {
        await getToday(ID);
        const dto = await buyHint(ID);
        expect(dto.coins).toBe(30);
        expect(dto.hints.open.map((h) => h.key)).toEqual(["eyes"]);
        expect(dto.hints.next?.price).toBe(20);
        expect(dto.steps.used).toBe(1);
        const after = await guess(ID, wrongIds()[0]);
        expect(after.hints.open).toHaveLength(1);
        expect(after.hints.next?.price).toBe(20);
        expect(after.steps.used).toBe(2);
    });

    it("coins never go negative", async () => {
        await getToday(ID);
        const results: string[] = [];
        for (let i = 0; i < 6; i++) results.push(await code(buyHint(ID)));
        const p = await profile();
        expect(p.coins).toBeGreaterThanOrEqual(0);
        expect(results).toContain("not_enough_coins");
        // 45 coins: 15 + 20 = 35 leaves 10, below the next price of 25
        expect(p.coins).toBe(10);
        expect(p.rounds[today()].bought).toBe(2);
    });

    it("refuses when every hint is open or the round is over", async () => {
        await getToday(ID);
        const p = await profile();
        p.coins = 1000;
        await store.save(ID, p);
        for (let i = 0; i < 5; i++) await buyHint(ID);
        expect(await code(buyHint(ID))).toBe("no_hint");
        await guess(ID, pick().answerId);
        expect(await code(buyHint(ID))).toBe("round_over");
    });
});

describe("fixed hint ladder (P3: no hint-count leak)", () => {
    const FRIEREN = FIXTURE_CATALOG.anime[0];
    /** Pins today's answer to a fixture character (105 Eisen: no hair, no quote -> 3 real hints). */
    async function pinAnswer(answerId: number, coins = 1000, id = ID) {
        await getToday(id);
        const p = await profile(id);
        p.coins = coins;
        Object.assign(p.rounds[today()], { animeId: FRIEREN.id, answerId });
        await store.save(id, p);
    }
    const wrongFor = (answerId: number) => FRIEREN.characters.filter((c) => c.id !== answerId).map((c) => c.id);
    const KIND = /"(eyes|va|silhouette|blur|initial)"/;

    it("before the end the round state has no total and no kinds, and is the same for 3 or 5 real hints", async () => {
        await pinAnswer(105);
        await pinAnswer(101, 1000, ID2);
        for (let n = 0; n < 3; n++) {
            const gap = await getToday(ID);
            const full = await getToday(ID2);
            for (const dto of [gap, full]) {
                expect(Object.keys(dto.hints).sort()).toEqual(["empty", "locked", "missing", "next", "open", "slots"]);
                expect(dto.hints).not.toHaveProperty("total");
                expect(dto.hints.slots).toBe(5);
                expect(dto.hints.locked).toBe(5 - n);
                expect(dto.hints.missing).toEqual([]);
                expect(dto.hints.empty).toBe(0);
                // no kind name anywhere except in the values of hints already open
                const { open, ...rest } = dto.hints;
                expect(JSON.stringify(rest)).not.toMatch(KIND);
                expect(open).toHaveLength(n);
            }
            // a 3-hint answer and a 5-hint answer look identical apart from the opened hints themselves
            const strip = (d: RoundDto) => ({ ...d.hints, open: d.hints.open.length });
            expect(strip(gap)).toEqual(strip(full));
            await buyHint(ID);
            await buyHint(ID2);
        }
    });

    it("hints open strictly in ladder order: a wrong or repeated slot is refused and costs nothing", async () => {
        await pinAnswer(101);
        expect(await code(buyHint(ID, 2))).toBe("hint_out_of_order");
        expect(await code(buyHint(ID, 0))).toBe("hint_out_of_order");
        expect((await profile()).coins).toBe(1000);
        expect((await profile()).rounds[today()].bought).toBe(0);

        const first = await buyHint(ID, 1);
        expect(first.hints.open.map((h) => h.key)).toEqual(["eyes"]);
        expect(first.coins).toBe(985);
        // a retried request for the same slot does not buy slot 2
        expect(await code(buyHint(ID, 1))).toBe("hint_out_of_order");
        expect((await profile()).coins).toBe(985);
        expect((await profile()).rounds[today()].bought).toBe(1);
        // r2: a wrong guess opens nothing, so slot 2 is still the next one
        await guess(ID, wrongFor(101)[0]);
        expect(await code(buyHint(ID, 3))).toBe("hint_out_of_order");
        expect((await buyHint(ID, 2)).hints.open.map((h) => h.key)).toEqual(["eyes", "va"]);
    });

    it("buying an empty slot refunds the full price; repeating it never adds coins", async () => {
        await pinAnswer(105); // Eisen: no JP voice actor -> 4 real hints
        let dto = await buyHint(ID, 1);
        dto = await buyHint(ID, 2);
        dto = await buyHint(ID, 3);
        dto = await buyHint(ID, 4);
        expect(dto.coins).toBe(1000 - 15 - 20 - 25 - 30);
        expect(dto.hints.open.map((h) => h.key)).toEqual(["eyes", "silhouette", "blur", "initial"]);
        expect(dto.hints.next).toEqual({ slot: 5, price: 35, affordable: true });
        expect(dto.steps.used).toBe(4);

        const before = dto.coins;
        dto = await buyHint(ID, 5); // empty: charged 35, refunded 35, and it costs no tier step
        expect(dto.coins).toBe(before);
        expect(dto.hints.empty).toBe(1);
        expect(dto.hints.open).toHaveLength(4);
        expect(dto.hints.locked).toBe(0);
        expect(dto.hints.next).toBeNull();
        expect(dto.hints.missing).toEqual(["va"]); // every slot open: structure may show now
        expect(dto.steps.used).toBe(4);
        expect((await profile()).rounds[today()]).toMatchObject({ bought: 5, refunded: 35 });

        for (const slot of [5, 4, undefined]) expect(await code(buyHint(ID, slot))).toBe("no_hint");
        const p = await profile();
        expect(p.coins).toBe(before);
        expect(p.rounds[today()]).toMatchObject({ bought: 5, refunded: 35 });
        expect((await getToday(ID)).coins).toBe(before);
        // 4 real hints + a first-try guess = 5 steps = Common
        const won = await guess(ID, 105);
        expect(won.result?.pull?.tier).toBe("common");
        expect(won.result?.bonus).toBe(0);
    });

    it("an empty slot needs the same coins as a real one (affordability says nothing about the slot)", async () => {
        await pinAnswer(105, 15 + 20 + 25 + 30 + 34);
        await buyHint(ID, 1);
        await buyHint(ID, 2);
        await buyHint(ID, 3);
        const dto = await buyHint(ID, 4);
        expect(dto.hints.next).toEqual({ slot: 5, price: 35, affordable: false });
        expect(await code(buyHint(ID, 5))).toBe("not_enough_coins");
        expect((await profile()).coins).toBe(34);
    });

    it("legacy round (stored before r2): wrong guesses still open hints free and tier counts guesses only", async () => {
        await pinAnswer(105);
        const p = await profile();
        delete p.rounds[today()].rules; // the shape rounds had before r2
        await store.save(ID, p);
        let dto: RoundDto | undefined;
        for (const w of wrongFor(105).slice(0, 3)) dto = await guess(ID, w);
        expect(dto!.steps).toEqual({ used: 3, hintsCostTier: false });
        expect(dto!.hints.open.map((h) => h.key)).toEqual(["eyes", "silhouette", "blur"]);
        expect(dto!.hints.missing).toEqual([]);
        expect(dto!.coins).toBe(1000);
        dto = await buyHint(ID, 4); // bought on a legacy round: no tier step
        expect(dto.steps.used).toBe(3);
        const won = await guess(ID, 105);
        expect(won.hints).toMatchObject({ slots: 5, empty: 1, locked: 0, missing: ["va"], next: null });
        expect(won.result?.pull?.tier).toBe("rare"); // 4 guesses
        expect(won.result?.bonus).toBe(0);
        expect((await profile()).rounds[today()].rules).toBeUndefined(); // never migrated in place
    });
});

describe("r2 rules", () => {
    const FRIEREN = FIXTURE_CATALOG.anime[0];
    async function pin(answerId: number, coins = 1000) {
        await getToday(ID);
        const p = await profile();
        p.coins = coins;
        Object.assign(p.rounds[today()], { animeId: FRIEREN.id, answerId });
        await store.save(ID, p);
    }

    it("each bought hint costs a tier step; first-try win with one hint is SR with the 2-step bonus", async () => {
        await pin(101);
        await buyHint(ID, 1);
        const won = await guess(ID, 101);
        expect(won.steps.used).toBe(2);
        expect(won.result).toMatchObject({ pull: { tier: "sr" }, bonus: 20 });
        expect((await profile()).collection["101"].tier).toBe("sr");
    });

    it("no hints, first guess right = SSR + 30", async () => {
        await pin(102);
        const won = await guess(ID, 102);
        expect(won.result).toMatchObject({ pull: { tier: "ssr" }, bonus: 30 });
    });

    it("guess-only roster characters can be guessed and get feedback, but are never answers", async () => {
        await pin(101);
        const dto = await getToday(ID);
        expect(dto.candidates.map((c) => c.id)).toEqual(expect.arrayContaining([151, 152]));
        const miss = await guess(ID, 151);
        expect(miss.guesses[0]).toMatchObject({ id: 151, name: "Sein", image: null, correct: false });
        const fb = Object.fromEntries(miss.guesses[0].feedback.map((c) => [c.col, c]));
        expect(fb.gender).toEqual({ col: "gender", state: "miss", value: "Male" });
        expect(fb.age).toEqual({ col: "age", state: "up", value: "30" });
        expect(fb.month).toEqual({ col: "month", state: "up", value: "6" });
        expect(fb.rank.state).toBe("miss");
        expect(await code(guess(ID, 999))).toBe("invalid_character");
        expect(await code(guess(ID, 151))).toBe("already_guessed");
    });

    it("feedback never leaks the answer's values, only the guess's own", async () => {
        await pin(101);
        const miss = await guess(ID, 103);
        const text = JSON.stringify(miss.guesses);
        expect(text).not.toContain("Atsumi Tanezaki");
        expect(text).not.toContain("1000+");
        const { candidates: _c, ...rest } = miss;
        void _c;
        expect(JSON.stringify(rest)).not.toContain("Frieren");
    });

    it("candidates come sorted by name and carry no feedback data", async () => {
        const dto = await getToday(ID);
        const names = dto.candidates.map((c) => c.name);
        expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "en")));
        for (const c of dto.candidates) expect(Object.keys(c).sort()).toEqual(["alternative", "id", "name", "nameNative"]);
    });

    it("reads a legacy-shaped profile (pre-r2 round, no rules / refunded) without rewriting it", async () => {
        const legacy = {
            v: 1,
            createdAt: new Date(now - 86_400_000).toISOString(),
            recoveryHash: null,
            coins: 70,
            rounds: {
                [today()]: { day: today(), animeId: FRIEREN.id, answerId: 104, guesses: [101], bought: 1, done: null, dailyCoins: 10, bonus: 0, pull: null, storyUnlockedNow: false },
                [addDays(today(), -1)]: {
                    day: addDays(today(), -1), animeId: FRIEREN.id, answerId: 102, guesses: [101, 102], bought: 0, done: "won", dailyCoins: 10, bonus: 20,
                    pull: { result: "new", prevTier: null, tier: "sr" }, storyUnlockedNow: false,
                },
            },
            finishedDays: [addDays(today(), -1)],
            collection: { "102": { tier: "sr", day: addDays(today(), -1), animeId: FRIEREN.id } },
            storySeen: [],
        };
        store.profiles.set(ID, JSON.stringify(legacy));
        const dto = await getToday(ID);
        expect(dto.coins).toBe(70);
        expect(dto.steps).toEqual({ used: 1, hintsCostTier: false });
        expect(dto.hints.open).toHaveLength(2); // 1 free from the wrong guess + 1 bought
        expect(dto.guesses[0]).toMatchObject({ id: 101, correct: false });
        expect(dto.guesses[0].feedback).toHaveLength(6);
        expect(dto.streak).toBe(1);
        const album = await getAlbum(ID);
        expect(album.owned).toBe(1);
        const won = await guess(ID, 104);
        expect(won.result?.pull?.tier).toBe("sr"); // 2 guesses; the bought hint does not count on a legacy round
        expect((await profile()).collection["102"].tier).toBe("sr");
    });
});

describe("album", () => {
    it("groups owned cards by anime; story stays fresh until tapped", async () => {
        await getToday(ID);
        const p = await profile();
        const frieren = FIXTURE_CATALOG.anime[0];
        const osk = FIXTURE_CATALOG.anime[1];
        p.collection = {
            [frieren.characters[2].id]: { tier: "ssr", day: "2026-10-20", animeId: frieren.id },
            [frieren.characters[0].id]: { tier: "rare", day: "2026-10-21", animeId: frieren.id },
            [frieren.characters[5].id]: { tier: "common", day: "2026-10-22", animeId: frieren.id },
            [osk.characters[1].id]: { tier: "sr", day: "2026-10-25", animeId: osk.id },
        };
        await store.save(ID, p);

        const album = await getAlbum(ID);
        expect(album.owned).toBe(4);
        expect(album.total).toBe(15);
        expect(album.anime.map((a) => a.id)).toEqual([osk.id, frieren.id]); // most recent first
        const f = album.anime.find((a) => a.id === frieren.id)!;
        expect(f).toMatchObject({ owned: 3, total: 8, story: { unlocked: true, fresh: true } });
        expect(f.cards.map((c) => c.number)).toEqual(["001", "003", "006"]);
        expect(f.cards[0]).toMatchObject({ id: frieren.characters[0].id, tier: "rare", image: frieren.characters[0].image });
        expect(album.anime.find((a) => a.id === osk.id)!.story).toEqual({ unlocked: false, fresh: false });

        // loading is read-only: a second load (StrictMode double effect) still shows it as new
        const again = await getAlbum(ID);
        expect(again.anime.find((a) => a.id === frieren.id)!.story).toEqual({ unlocked: true, fresh: true });
        expect((await profile()).storySeen).toEqual([]);

        // the explicit tap marks it, idempotently
        expect(await markStorySeen(ID, frieren.id)).toEqual({ animeId: frieren.id, fresh: false });
        expect(await markStorySeen(ID, frieren.id)).toEqual({ animeId: frieren.id, fresh: false });
        expect((await profile()).storySeen).toEqual([frieren.id]);
        const after = await getAlbum(ID);
        expect(after.anime.find((a) => a.id === frieren.id)!.story).toEqual({ unlocked: true, fresh: false });
    });

    it("getAlbum never writes the profile", async () => {
        await getToday(ID);
        const p = await profile();
        p.collection = Object.fromEntries(
            FIXTURE_CATALOG.anime[0].characters.slice(0, 3).map((c, i) => [c.id, { tier: "rare" as const, day: `2026-10-2${i}`, animeId: FIXTURE_CATALOG.anime[0].id }])
        );
        await store.save(ID, p);
        const before = store.profiles.get(ID);
        await getAlbum(ID);
        await getAlbum(ID);
        expect(store.profiles.get(ID)).toBe(before);
    });

    it("markStorySeen refuses locked stories and unknown players", async () => {
        expect(await code(markStorySeen(ID, FIXTURE_CATALOG.anime[0].id))).toBe("no_profile");
        await getToday(ID);
        expect(await code(markStorySeen(ID, FIXTURE_CATALOG.anime[0].id))).toBe("story_locked");
        expect(await code(markStorySeen(ID, 424242))).toBe("story_locked");
        expect((await profile()).storySeen).toEqual([]);
    });

    it("empty for an unknown id, without creating a profile", async () => {
        expect(await getAlbum(ID2)).toMatchObject({ owned: 0, anime: [], coins: 0 });
        expect(store.profiles.has(ID2)).toBe(false);
    });
});

describe("recovery", () => {
    it("mints XXXX-XXXX-XXXX codes, stores only the hash, restores loosely typed input", async () => {
        await getToday(ID);
        const { code: c } = await mintRecovery(ID);
        expect(c).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
        expect(JSON.stringify([...store.profiles.values()])).not.toContain(c);
        expect((await profile()).recoveryHash).toMatch(/^[0-9a-f]{64}$/);
        expect(await restore(c)).toBe(ID);
        expect(await restore(c.toLowerCase().replace(/-/g, " "))).toBe(ID);
    });

    it("rotating invalidates the old code; junk and unknown codes restore nothing", async () => {
        await getToday(ID);
        const first = (await mintRecovery(ID)).code;
        const second = (await mintRecovery(ID)).code;
        expect(second).not.toBe(first);
        expect(await restore(first)).toBeNull();
        expect(await restore(second)).toBe(ID);
        for (const junk of ["", "abc", "UUUU-UUUU-UUUU", 42, null, "0000-0000-0000"]) expect(await restore(junk)).toBeNull();
    });

    it("needs an existing profile", async () => {
        expect(await code(mintRecovery(ID2))).toBe("no_profile");
    });
});

describe("day rollover", () => {
    it("streak survives an unfinished today and counts consecutive days", async () => {
        await getToday(ID);
        await guess(ID, pick().answerId);
        now += 86_400_000;
        const next = await getToday(ID);
        expect(next.streak).toBe(1);
        await guess(ID, pick().answerId);
        expect((await getToday(ID)).streak).toBe(2);
        expect(addDays(today(), -1)).toBe("2026-10-27");
    });
});

describe("archive (past days)", () => {
    const pickOn = (day: string) => dailyPick(FIXTURE_CATALOG, day, SALT);
    const wrongOn = (day: string) => animeOf(pickOn(day).animeId).characters.filter((c) => c.id !== pickOn(day).answerId).map((c) => c.id);
    const yesterday = () => addDays(today(), -1);
    const tokenOf = (dto: RoundDto) => {
        const h = dto.hints.open.find((x) => "src" in x && typeof x.src === "string") as { src: string } | undefined;
        return new URL(h!.src, "http://x").searchParams.get("t")!;
    };

    it("rejects future days, days past the window and days before the epoch (reads and writes)", async () => {
        await getToday(ID);
        for (const day of [addDays(today(), 1), addDays(today(), 400), addDays(today(), -(ARCHIVE_DAYS + 1)), addDays(FIRST_DAY_KEY, -1)]) {
            expect(await code(getDay(ID, day))).toBe("day_unavailable");
            expect(await code(guess(ID, 101, day))).toBe("day_unavailable");
            expect(await code(buyHint(ID, 1, day))).toBe("day_unavailable");
        }
        expect(Object.keys((await profile()).rounds)).toEqual([today()]);
    });

    it("epoch boundary: on launch day #1 (the epoch) is open, the day before it never is", async () => {
        expect(today()).toBe("2026-10-27"); // T0 is launch day
        await getToday(ID);
        const first = await getDay(ID, FIRST_DAY_KEY);
        expect(first.day).toEqual({ key: FIRST_DAY_KEY, number: 1 });
        expect(first.archive).toBe(true);
        expect(await code(getDay(ID, addDays(FIRST_DAY_KEY, -1)))).toBe("day_unavailable");
        const list = await getArchive(ID);
        expect(list.days).toHaveLength(30);
        expect(list.days.at(-1)!.key).toBe(FIRST_DAY_KEY);
        expect(list.days.every((d) => d.state === "new" && d.key < today())).toBe(true);
        expect(list.today).toEqual({ key: today(), number: 31, state: "playing" });
    });

    it("window edges follow Bangkok midnight, not UTC", async () => {
        now = Date.parse("2026-11-10T16:59:59Z"); // 23:59:59 on Nov 10 in Bangkok
        await getToday(ID);
        expect(today()).toBe("2026-11-10");
        expect(await code(getDay(ID, "2026-11-11"))).toBe("day_unavailable"); // still tomorrow in Bangkok
        expect((await getDay(ID, "2026-10-11")).archive).toBe(true); // 30 back
        expect(await code(getDay(ID, "2026-10-10"))).toBe("day_unavailable"); // 31 back
        now += 1000; // 00:00:00 Nov 11 in Bangkok (17:00 UTC Nov 10)
        await getToday(ID);
        const t = await getDay(ID, "2026-11-11");
        expect(t.archive).toBe(false);
        expect(t.dailyCoins).toBe(10);
        expect(await code(getDay(ID, "2026-10-11"))).toBe("day_unavailable"); // fell out at Bangkok midnight
        expect((await getDay(ID, "2026-10-12")).archive).toBe(true);
        expect(await code(getDay(ID, "2026-11-12"))).toBe("day_unavailable");
    });

    it("viewing a past day does not use it up and needs an existing player", async () => {
        expect(await code(getDay(ID, yesterday()))).toBe("no_profile");
        await getToday(ID);
        const dto = await getDay(ID, yesterday());
        expect(dto.archive).toBe(true);
        expect(dto.dailyCoins).toBe(0);
        expect(dto.done).toBeNull();
        expect(dto.anime.id).toBe(pickOn(yesterday()).animeId);
        expect(dto.coins).toBe(45);
        expect(Object.keys((await profile()).rounds)).toEqual([today()]);
        expect(withoutCandidates(dto)).not.toContain(`"id":${pickOn(yesterday()).answerId},`);
    });

    it("an archive win gives the tier card and the daily coins once on finish, but no fast bonus and no streak", async () => {
        await getToday(ID);
        const day = yesterday();
        expect((await guess(ID, wrongOn(day)[0], day)).coins).toBe(45); // nothing until the round finishes
        expect((await profile()).rounds[day].dailyCoins).toBe(0);
        const dto = await guess(ID, pickOn(day).answerId, day);
        expect(dto.done).toBe("won");
        expect(dto.archive).toBe(true);
        expect(dto.result?.pull?.tier).toBe("sr");
        expect(dto.result?.bonus).toBe(0);
        expect(dto.dailyCoins).toBe(10);
        expect(dto.coins).toBe(55); // 35 start + today's 10 + that day's 10, no fast bonus
        expect(dto.streak).toBe(0);
        const p = await profile();
        expect(p.finishedDays).toEqual([]);
        expect(p.rounds[day]).toMatchObject({ archive: true, dailyCoins: 10, bonus: 0, rules: 2, day });
        expect(p.collection[String(pickOn(day).answerId)]).toBeTruthy();
        expect((await getToday(ID)).streak).toBe(0);
    });

    it("a played day is view only: the result shows, further guesses and hints are refused", async () => {
        await getToday(ID);
        const day = yesterday();
        for (const w of wrongOn(day).slice(0, 6)) await guess(ID, w, day);
        let dto = await getDay(ID, day);
        if (dto.done !== "lost") {
            // fixture anime may have fewer than 6 wrong names: finish with the answer instead
            dto = await guess(ID, pickOn(day).answerId, day);
        }
        expect(dto.done).not.toBeNull();
        const view = await getDay(ID, day);
        expect(view.done).toBe(dto.done);
        expect(view.result?.answer?.id).toBe(pickOn(day).answerId);
        expect(view.guesses.length).toBe(dto.guesses.length);
        expect(await code(guess(ID, pickOn(day).answerId, day))).toBe("round_over");
        expect(await code(buyHint(ID, undefined, day))).toBe("round_over");
        const list = await getArchive(ID);
        expect(list.days.find((d) => d.key === day)!.state).toBe(dto.done);
    });

    it("an archive loss gives no card and leaves the streak alone", async () => {
        await getToday(ID);
        await guess(ID, pick().answerId); // today won: streak 1
        const day = addDays(today(), -2);
        const p0 = await profile();
        await store.save(ID, { ...p0, rounds: { ...p0.rounds, [day]: { ...p0.rounds[today()], day, animeId: pickOn(day).animeId, answerId: pickOn(day).answerId, guesses: wrongOn(day).slice(0, 5), done: null, pull: null, dailyCoins: 0, bonus: 0, archive: true } } });
        const before = Object.keys(p0.collection).length;
        const last = wrongOn(day)[5] ?? FIXTURE_CATALOG.anime.flatMap((a) => a.characters).find((c) => c.id !== pickOn(day).answerId && !wrongOn(day).slice(0, 5).includes(c.id))!.id;
        const coins0 = p0.coins;
        const dto = await guess(ID, last, day);
        expect(dto.done).toBe("lost");
        expect(dto.result?.pull ?? null).toBeNull();
        expect(dto.coins).toBe(coins0 + 10); // a loss still pays that day's daily coins, once
        expect((await profile()).rounds[day].dailyCoins).toBe(10);
        expect(Object.keys((await profile()).collection).length).toBe(before);
        expect(dto.streak).toBe(1);
        expect((await profile()).finishedDays).toEqual([today()]);
    });

    it("an archive day's daily coins are paid once: replay, refresh and a parallel finish add nothing", async () => {
        await getToday(ID);
        const day = yesterday();
        const [a, b] = await Promise.all([code(guess(ID, pickOn(day).answerId, day)), code(guess(ID, pickOn(day).answerId, day))]);
        expect([a, b].sort()).toEqual(["ok", "round_over"]);
        expect((await profile()).coins).toBe(55);
        expect(await code(guess(ID, wrongOn(day)[0], day))).toBe("round_over");
        expect(await code(buyHint(ID, 1, day))).toBe("round_over");
        expect((await getDay(ID, day)).coins).toBe(55);
        expect((await getArchive(ID)).days.find((d) => d.key === day)!.state).toBe("won");
        expect((await getToday(ID)).coins).toBe(55);
        // today's round still pays exactly once, on creation, and nothing more when it finishes
        await guess(ID, wrongIds()[0]);
        expect((await profile()).coins).toBe(55);
        // a different past day pays its own daily coins once
        const d2 = addDays(today(), -3);
        expect((await guess(ID, pickOn(d2).answerId, d2)).coins).toBe(65);
    });

    it("archive play never extends or repairs a streak", async () => {
        // Played and finished the day before yesterday on its own day, skipped yesterday, won today.
        now -= 2 * 86_400_000;
        await getToday(ID);
        await guess(ID, pick().answerId);
        now += 2 * 86_400_000;
        await getToday(ID);
        await guess(ID, pick().answerId);
        expect((await getToday(ID)).streak).toBe(1);
        // Filling yesterday from the archive does not repair the gap.
        const dto = await guess(ID, pickOn(yesterday()).answerId, yesterday());
        expect(dto.done).toBe("won");
        expect(dto.streak).toBe(1);
        expect((await profile()).finishedDays).not.toContain(yesterday());
    });

    it("a round left unfinished on its own day can be finished later, without bonus or streak", async () => {
        await getToday(ID);
        await guess(ID, wrongIds()[0]);
        const day = today();
        now += 86_400_000;
        const dto = await guess(ID, pickOn(day).answerId, day);
        expect(dto.done).toBe("won");
        expect(dto.archive).toBe(true);
        expect(dto.result?.bonus).toBe(0);
        expect((await profile()).finishedDays).toEqual([]);
        expect((await profile()).rounds[day].dailyCoins).toBe(10); // granted back on its own day, once
    });

    it("archive hints cost coins from the existing balance; a failed buy stores nothing", async () => {
        await getToday(ID);
        const day = yesterday();
        const dto = await buyHint(ID, 1, day);
        expect(dto.coins).toBe(30);
        expect(dto.hints.open).toHaveLength(1);
        expect(dto.steps.used).toBe(1);
        const p = await profile();
        await store.save(ID, { ...p, coins: 5 });
        const other = addDays(today(), -3);
        expect(await code(buyHint(ID, 1, other))).toBe("not_enough_coins");
        expect((await profile()).rounds[other]).toBeUndefined();
        expect((await profile()).coins).toBe(5);
    });

    it("hint-image tokens are bound to their round's day and the window", async () => {
        await getToday(ID);
        const day = yesterday();
        const dto = await buyHint(ID, 1, day);
        const token = tokenOf(dto);
        const ref = await resolveHintImage(token);
        expect(ref).toMatchObject({ day, charId: pickOn(day).answerId });
        // Another day's character, even well formed for that day, is refused.
        const notAnswer = wrongOn(day)[0];
        expect(await resolveHintImage(hintImageToken({ day, charId: notAnswer, kind: "eyes" }, SALT))).toBeNull();
        // A future day's token is never readable, even with the right answer.
        const tomorrow = addDays(today(), 1);
        expect(await resolveHintImage(hintImageToken({ day: tomorrow, charId: pickOn(tomorrow).answerId, kind: "eyes" }, SALT))).toBeNull();
        // Before the epoch: refused.
        const pre = addDays(FIRST_DAY_KEY, -1);
        expect(await resolveHintImage(hintImageToken({ day: pre, charId: pickOn(pre).answerId, kind: "eyes" }, SALT))).toBeNull();
        // Cache never outlives the next Bangkok midnight.
        expect(ref!.expiresInSec).toBeLessThanOrEqual(12 * 3600);
        // Once the day leaves the 30-day window, its token dies.
        now += (ARCHIVE_DAYS - 1) * 86_400_000; // the day is now 30 back
        expect(await resolveHintImage(token)).not.toBeNull(); // exactly 30 back
        now += 86_400_000;
        expect(await resolveHintImage(token)).toBeNull();
    });

    it("legacy profile: old-shape rounds show in the archive and stay view only", async () => {
        const legacyDay = yesterday();
        const legacy = {
            v: 1,
            createdAt: now - 86_400_000,
            coins: 50,
            recoveryHash: null,
            storySeen: [],
            collection: {},
            finishedDays: [legacyDay],
            rounds: {
                [legacyDay]: {
                    day: legacyDay,
                    animeId: pickOn(legacyDay).animeId,
                    answerId: pickOn(legacyDay).answerId,
                    guesses: wrongOn(legacyDay).slice(0, 2),
                    bought: 0,
                    done: "lost",
                    dailyCoins: 10,
                    bonus: 0,
                    pull: null,
                    storyUnlockedNow: false,
                },
            },
        };
        store.profiles.set(ID, JSON.stringify(legacy));
        const list = await getArchive(ID);
        expect(list.days[0]).toMatchObject({ key: legacyDay, state: "lost", tier: null });
        expect((await getDay(ID, legacyDay)).done).toBe("lost");
        expect(await code(guess(ID, pickOn(legacyDay).answerId, legacyDay))).toBe("round_over");
        expect((await getToday(ID)).streak).toBe(1);
        expect((await profile()).rounds[legacyDay].archive).toBeUndefined();
    });
});
