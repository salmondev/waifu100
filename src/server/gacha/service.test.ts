import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Belt and braces: nothing in these tests may reach a real Redis.
vi.mock("@/lib/redis", () => ({
    withRedis: async () => {
        throw new Error("Redis must not be used in gacha unit tests");
    },
}));

import { setCatalog } from "./catalog";
import { addDays, bangkokDayKey, dailyPick, hintLadder, type Tier } from "./rules";
import { buyHint, configureGacha, GachaError, getAlbum, getToday, guess, markStorySeen, mintRecovery, restore, type RoundDto } from "./service";
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
        expect(dto.day).toEqual({ key: "2026-10-27", number: 2 });
        expect(dto.anime.id).toBe(pick().animeId);
        expect(dto.candidates).toHaveLength(animeOf(pick().animeId).characters.length);
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
        expect(miss.hints.open).toHaveLength(1);
        expect(miss.hints.open[0].key).toBe("role");

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
    it("opens the next hint at its ladder price", async () => {
        await getToday(ID);
        const dto = await buyHint(ID);
        expect(dto.coins).toBe(30);
        expect(dto.hints.open.map((h) => h.key)).toEqual(["role"]);
        expect(dto.hints.next?.price).toBe(20);
        const after = await guess(ID, wrongIds()[0]);
        expect(after.hints.open).toHaveLength(2);
        expect(after.hints.next?.price).toBe(25);
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
    const KIND = /"(hair|quote|silhouette|blur)"/;

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
        expect(first.hints.open.map((h) => h.key)).toEqual(["role"]);
        expect(first.coins).toBe(985);
        // a retried request for the same slot does not buy slot 2
        expect(await code(buyHint(ID, 1))).toBe("hint_out_of_order");
        expect((await profile()).coins).toBe(985);
        expect((await profile()).rounds[today()].bought).toBe(1);
        // a wrong guess opens slot 2, so slot 2 can no longer be bought
        await guess(ID, wrongFor(101)[0]);
        expect(await code(buyHint(ID, 2))).toBe("hint_out_of_order");
        expect((await buyHint(ID, 3)).hints.open.map((h) => h.key)).toEqual(["role", "hair", "quote"]);
    });

    it("buying an empty slot refunds the full price; repeating it never adds coins", async () => {
        await pinAnswer(105);
        let dto = await buyHint(ID, 1);
        dto = await buyHint(ID, 2);
        dto = await buyHint(ID, 3);
        expect(dto.coins).toBe(1000 - 15 - 20 - 25);
        expect(dto.hints.open.map((h) => h.key)).toEqual(["role", "silhouette", "blur"]);
        expect(dto.hints.next).toEqual({ slot: 4, price: 30, affordable: true });

        const before = dto.coins;
        dto = await buyHint(ID, 4); // empty: charged 30, refunded 30
        expect(dto.coins).toBe(before);
        expect(dto.hints.empty).toBe(1);
        expect(dto.hints.open).toHaveLength(3);
        expect(dto.hints.locked).toBe(1);
        expect(dto.hints.next).toEqual({ slot: 5, price: 35, affordable: true });
        expect((await profile()).rounds[today()]).toMatchObject({ bought: 4, refunded: 30 });

        // farming attempts: same slot again, then every way of asking again
        expect(await code(buyHint(ID, 4))).toBe("hint_out_of_order");
        dto = await buyHint(ID, 5);
        expect(dto.coins).toBe(before);
        expect(dto.hints.empty).toBe(2);
        expect(dto.hints.missing).toEqual(["hair", "quote"]); // every slot open: structure may show now
        for (const slot of [5, 4, undefined]) expect(await code(buyHint(ID, slot))).toBe("no_hint");
        const p = await profile();
        expect(p.coins).toBe(before);
        expect(p.rounds[today()]).toMatchObject({ bought: 5, refunded: 65 });
        expect((await getToday(ID)).coins).toBe(before);
    });

    it("an empty slot needs the same coins as a real one (affordability says nothing about the slot)", async () => {
        await pinAnswer(105, 15 + 20 + 25 + 29);
        await buyHint(ID, 1);
        await buyHint(ID, 2);
        const dto = await buyHint(ID, 3);
        expect(dto.hints.next).toEqual({ slot: 4, price: 30, affordable: false });
        expect(await code(buyHint(ID, 4))).toBe("not_enough_coins");
        expect((await profile()).coins).toBe(29);
    });

    it("wrong guesses walk the same ladder; empty slots come last and are named only after the end", async () => {
        await pinAnswer(105);
        let dto: RoundDto | undefined;
        for (const w of wrongFor(105).slice(0, 4)) dto = await guess(ID, w);
        expect(dto!.hints.open.map((h) => h.key)).toEqual(["role", "silhouette", "blur"]);
        expect(dto!.hints.empty).toBe(1);
        expect(dto!.hints.missing).toEqual([]);
        expect(dto!.coins).toBe(1000);
        const won = await guess(ID, 105);
        expect(won.hints).toMatchObject({ slots: 5, empty: 2, locked: 0, missing: ["hair", "quote"], next: null });
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
