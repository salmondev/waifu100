import { describe, expect, it } from "vitest";
import {
    ARCHIVE_DAYS,
    archiveDays,
    FIRST_DAY_KEY,
    isArchiveDay,
    isDayKey,
    LAUNCH_DAY_KEY,
    addDays, answerPool, answerWeight, bangkokDayKey, dailyPick, dayNumber, fastBonus, FEEDBACK_COLUMNS, guessFeedback, guessRoster, hintLadder, hintValue,
    HINT_ORDER, HINT_SLOTS, isEmptySlot, missingHints, nameShape, nextBuyableSlot, openHintCount, playableAnime, secondsUntilNextBangkokDay, pullResult,
    storyUnlocked, streak, tierForGuesses, tierSteps,
} from "./rules";
import { KEEP_ROUND_DAYS } from "./store";
import { FIXTURE_CATALOG } from "./test-fixture";

const frieren = FIXTURE_CATALOG.anime[0];
const img = (kind: string) => `/opaque/${kind}`;
const char = (id: number) => FIXTURE_CATALOG.anime.flatMap((a) => a.characters).find((c) => c.id === id)!;

describe("tiers", () => {
    it("1 SSR, 2 SR, 3-4 Rare, 5+ Common", () => {
        expect([1, 2, 3, 4, 5, 6, 9].map(tierForGuesses)).toEqual(["ssr", "sr", "rare", "rare", "common", "common", "common"]);
    });
    it("fast bonus only for 1-3 guesses", () => {
        expect([1, 2, 3, 4, 6].map(fastBonus)).toEqual([30, 20, 10, 0, 0]);
    });
});

describe("tier steps (r2)", () => {
    it("r2 rounds count bought hints as steps; legacy rounds count guesses only", () => {
        expect(tierSteps(1, 0, true)).toBe(1);
        expect(tierSteps(1, 1, true)).toBe(2);
        expect(tierSteps(2, 3, true)).toBe(5);
        expect(tierSteps(2, 3, false)).toBe(2);
        expect(tierForGuesses(tierSteps(1, 1, true))).toBe("sr");
        expect(tierForGuesses(tierSteps(4, 5, true))).toBe("common"); // beyond 6 stays common
        expect(fastBonus(tierSteps(1, 2, true))).toBe(10);
    });
});

describe("hint ladder", () => {
    it("is eyes -> JP voice actor -> silhouette -> blur -> first letter", () => {
        expect(HINT_ORDER).toEqual(["eyes", "va", "silhouette", "blur", "initial"]);
        expect(hintLadder(char(101))).toEqual(["eyes", "va", "silhouette", "blur", "initial"]);
    });
    it("skips missing data so later hints move up", () => {
        expect(hintLadder(char(105))).toEqual(["eyes", "silhouette", "blur", "initial"]); // no voice actor
        expect(hintLadder({ ...char(105), image: "" })).toEqual(["initial"]); // no art: no image hints
        expect(hintLadder({ ...char(101), va: { id: 1, name: "  ", nameNative: null } })).not.toContain("va");
    });
    it("voice actor hint is the JP name with the native spelling", () => {
        expect(hintValue(char(101), "va", img)).toEqual({ key: "va", name: "Atsumi Tanezaki", nameNative: "Atsumi Tanezaki-jp" });
    });
    it("first-letter hint gives the initial and the length of each word only", () => {
        expect(hintValue(char(101), "initial", img)).toEqual({ key: "initial", first: "F", words: [7] });
        expect(nameShape("  Himmel  the Hero ")).toEqual({ first: "H", words: [6, 3, 4] });
        expect(nameShape("ai hoshino")).toEqual({ first: "A", words: [2, 7] });
        expect(nameShape("Émilia")).toEqual({ first: "É", words: [6] });
    });
    it("open slots = free (legacy wrong guesses) + bought, capped at the fixed 5; all when done", () => {
        expect(HINT_SLOTS).toBe(5);
        expect(openHintCount(0, 0, false)).toBe(0);
        expect(openHintCount(0, 2, false)).toBe(2);
        expect(openHintCount(2, 1, false)).toBe(3);
        expect(openHintCount(4, 3, false)).toBe(5);
        expect(openHintCount(0, 0, true)).toBe(5);
    });
    it("next slot and price depend only on the slot index (15/20/25/30/35), never on the answer", () => {
        expect([0, 1, 2, 3, 4].map((n) => nextBuyableSlot(n, false))).toEqual([
            { slot: 1, price: 15 }, { slot: 2, price: 20 }, { slot: 3, price: 25 }, { slot: 4, price: 30 }, { slot: 5, price: 35 },
        ]);
        expect(nextBuyableSlot(5, false)).toBeNull();
        expect(nextBuyableSlot(1, true)).toBeNull();
    });
    it("empty slots are always after every real hint", () => {
        for (const c of [char(101), char(104), char(105), { ...char(105), image: "" }]) {
            const ladder = hintLadder(c);
            const flags = Array.from({ length: HINT_SLOTS }, (_, i) => isEmptySlot(ladder, i));
            const firstEmpty = flags.indexOf(true);
            if (firstEmpty >= 0) expect(flags.slice(firstEmpty).every(Boolean)).toBe(true);
            expect(flags.filter((f) => !f)).toHaveLength(ladder.length);
            expect(ladder).toEqual(HINT_ORDER.filter((k) => ladder.includes(k)));
            expect(ladder.length + missingHints(ladder).length).toBe(HINT_SLOTS);
        }
    });
    it("missing slots are exactly the kinds the ladder lacks, in display order", () => {
        expect(missingHints(hintLadder(char(101)))).toEqual([]);
        expect(missingHints(hintLadder(char(105)))).toEqual(["va"]);
        expect(missingHints(hintLadder({ ...char(105), image: "" }))).toEqual(["eyes", "va", "silhouette", "blur"]);
    });
    it("image hints carry only the opaque src they are given, never the art URL", () => {
        for (const key of ["eyes", "silhouette", "blur"] as const) {
            const v = hintValue(char(101), key, img);
            expect(v).toEqual({ key, src: `/opaque/${key}` });
            expect(JSON.stringify(v)).not.toContain(char(101).image);
        }
    });
});

describe("guess roster + feedback", () => {
    const roster = guessRoster(frieren);
    const entry = (id: number) => roster.find((r) => r.id === id)!;
    const cells = (g: number, a: number) => Object.fromEntries(guessFeedback(entry(g), entry(a), roster).map((c) => [c.col, c]));

    it("roster = AniList roster plus every card, by favourites; falls back to the cards alone", () => {
        expect(roster.map((r) => r.id)).toEqual([101, 102, 103, 104, 108, 106, 105, 107, 151, 152]);
        expect(roster.filter((r) => !r.card).map((r) => r.id)).toEqual([151, 152]);
        const osk = guessRoster(FIXTURE_CATALOG.anime[1]);
        expect(osk.map((r) => r.id).sort()).toEqual(FIXTURE_CATALOG.anime[1].characters.map((c) => c.id).sort());
        expect(osk.every((r) => r.card)).toBe(true);
        // a card missing from the roster (AniList dropped it) is still guessable
        const partial = { ...frieren, roster: frieren.roster!.filter((r) => r.id !== 105) };
        expect(guessRoster(partial).some((r) => r.id === 105)).toBe(true);
    });
    it("has six columns in a fixed order", () => {
        expect(guessFeedback(entry(102), entry(101), roster).map((c) => c.col)).toEqual([...FEEDBACK_COLUMNS]);
        expect(FEEDBACK_COLUMNS).toEqual(["gender", "role", "age", "month", "rank", "va"]);
    });
    it("gender, role and voice actor are exact matches; values are the guess's own", () => {
        const c = cells(103, 101); // Stark vs Frieren
        expect(c.gender).toEqual({ col: "gender", state: "miss", value: "Male" });
        expect(c.role).toEqual({ col: "role", state: "miss", value: "SUPPORTING" });
        expect(c.va).toEqual({ col: "va", state: "miss", value: "Chiaki Kobayashi" });
        expect(cells(152, 103).va.state).toBe("hit"); // Wirbel shares Stark's VA
        expect(cells(107, 101).va.state).toBe("hit");
        expect(cells(102, 101).gender.state).toBe("hit");
    });
    it("age and month give a direction; unknown data is '?' never a guess", () => {
        expect(cells(103, 101).age).toEqual({ col: "age", state: "up", value: "17" }); // 17 vs 1000+
        expect(cells(101, 103).age).toEqual({ col: "age", state: "down", value: "1000+" });
        expect(cells(102, 103).age.state).toBe("near"); // 16-17 overlaps 17
        expect(cells(104, 101).age).toEqual({ col: "age", state: "unknown", value: null }); // "Unknown"
        expect(cells(103, 101).month).toEqual({ col: "month", state: "up", value: "2" });
        expect(cells(101, 103).month.state).toBe("down");
        expect(cells(104, 101).month).toEqual({ col: "month", state: "unknown", value: null });
        expect(cells(105, 101).va).toEqual({ col: "va", state: "unknown", value: null });
    });
    it("popularity rank is hit / within 2 / miss, never an arrow", () => {
        expect(cells(101, 101).rank).toEqual({ col: "rank", state: "hit", value: "1" });
        expect(cells(102, 104).rank).toEqual({ col: "rank", state: "near", value: "2" });
        expect(cells(101, 104).rank.state).toBe("miss"); // #1 vs #4
        expect(cells(152, 101).rank).toEqual({ col: "rank", state: "miss", value: "10" });
    });
    it("a correct guess is a hit on every column that has data", () => {
        expect(guessFeedback(entry(101), entry(101), roster).every((c) => c.state === "hit")).toBe(true);
    });
});

describe("Bangkok calendar", () => {
    it("day key flips at Bangkok midnight (17:00 UTC)", () => {
        expect(bangkokDayKey(Date.parse("2026-10-25T16:59:59.999Z"))).toBe("2026-10-25");
        expect(bangkokDayKey(Date.parse("2026-10-25T17:00:00.000Z"))).toBe("2026-10-26");
        expect(bangkokDayKey(Date.parse("2026-12-31T17:30:00.000Z"))).toBe("2027-01-01");
    });
    it("seconds until the next Bangkok midnight", () => {
        expect(secondsUntilNextBangkokDay(Date.parse("2026-10-27T16:59:00Z"))).toBe(60);
        expect(secondsUntilNextBangkokDay(Date.parse("2026-10-27T17:00:00Z"))).toBe(86400);
        expect(secondsUntilNextBangkokDay(Date.parse("2026-10-27T05:00:00Z"))).toBe(12 * 3600);
    });
    it("day number #1 is the epoch: launch day minus 30, so launch day is #31", () => {
        expect(LAUNCH_DAY_KEY).toBe("2026-10-27");
        expect(FIRST_DAY_KEY).toBe("2026-09-27");
        expect(dayNumber(FIRST_DAY_KEY)).toBe(1);
        expect(dayNumber("2026-09-28")).toBe(2);
        expect(dayNumber(LAUNCH_DAY_KEY)).toBe(ARCHIVE_DAYS + 1);
        expect(dayNumber("2027-09-27")).toBe(366);
        expect(addDays("2026-10-26", -1)).toBe("2026-10-25");
    });
    it("isDayKey takes real calendar days only", () => {
        expect(isDayKey("2026-10-27")).toBe(true);
        expect(isDayKey("2028-02-29")).toBe(true);
        for (const bad of ["2026-02-31", "2026-13-01", "2026-10-7", "2026-10-27T00", "", null, 20261027]) expect(isDayKey(bad)).toBe(false);
    });
});

describe("archive window", () => {
    it("is the 30 days before today, never today or the future", () => {
        const today = "2026-11-15";
        expect(isArchiveDay("2026-11-14", today)).toBe(true);
        expect(isArchiveDay(addDays(today, -30), today)).toBe(true);
        expect(isArchiveDay(addDays(today, -31), today)).toBe(false);
        expect(isArchiveDay(today, today)).toBe(false);
        expect(isArchiveDay("2026-11-16", today)).toBe(false);
        expect(isArchiveDay("2027-01-01", today)).toBe(false);
        expect(isArchiveDay("2026-02-31", today)).toBe(false);
        const days = archiveDays(today);
        expect(days).toHaveLength(ARCHIVE_DAYS);
        expect(days[0]).toBe("2026-11-14");
        expect(days.at(-1)).toBe(addDays(today, -30));
    });
    it("on launch day the window is full and ends exactly at the epoch", () => {
        const days = archiveDays(LAUNCH_DAY_KEY);
        expect(days).toHaveLength(30);
        expect(days.at(-1)).toBe(FIRST_DAY_KEY);
        expect(days.map(dayNumber)).toEqual(Array.from({ length: 30 }, (_, i) => 30 - i));
    });
    it("never reaches before the epoch", () => {
        expect(isArchiveDay(addDays(FIRST_DAY_KEY, -1), addDays(FIRST_DAY_KEY, 5))).toBe(false);
        expect(archiveDays(addDays(FIRST_DAY_KEY, 5))).toEqual([4, 3, 2, 1, 0].map((n) => addDays(FIRST_DAY_KEY, n)));
        expect(archiveDays(FIRST_DAY_KEY)).toEqual([]);
        expect(archiveDays(addDays(FIRST_DAY_KEY, -10))).toEqual([]);
    });
    it("keeps played rounds longer than the window, so a played day stays view-only", () => {
        expect(KEEP_ROUND_DAYS).toBeGreaterThan(ARCHIVE_DAYS + 1);
    });
});

describe("daily pick", () => {
    const list = playableAnime(FIXTURE_CATALOG);
    const days = (from: string, n: number) => Array.from({ length: n }, (_, i) => addDays(from, i));

    it("is deterministic for the same day + salt", () => {
        expect(dailyPick(FIXTURE_CATALOG, "2026-11-03", "s1")).toEqual(dailyPick(FIXTURE_CATALOG, "2026-11-03", "s1"));
    });
    it("depends on the salt", () => {
        const seq = (salt: string) => days("2026-10-26", 30).map((d) => dailyPick(FIXTURE_CATALOG, d, salt).answerId);
        expect(seq("s1")).not.toEqual(seq("s2"));
    });
    it("each anime comes once per cycle", () => {
        for (const cycle of [0, 1, 2]) {
            const start = addDays(FIRST_DAY_KEY, cycle * list.length);
            const picks = days(start, list.length).map((d) => dailyPick(FIXTURE_CATALOG, d, "s1"));
            expect(new Set(picks.map((p) => p.animeId)).size).toBe(list.length);
            expect(picks.every((p) => p.cycle === cycle)).toBe(true);
        }
    });
    it("answers come only from the anime's top-10 card characters by favourites", () => {
        const big = {
            ...FIXTURE_CATALOG,
            anime: [{
                ...frieren,
                characters: Array.from({ length: 14 }, (_, i) => ({ ...frieren.characters[0], id: 300 + i, favourites: 1000 - i * 10 })),
            }],
        };
        expect(answerPool(big.anime[0]).map((c) => c.id)).toEqual(Array.from({ length: 10 }, (_, i) => 300 + i));
        const seen = new Set(days("2026-10-26", 400).map((d) => dailyPick(big, d, "x").answerId));
        for (const id of seen) expect(id).toBeLessThan(310);
        expect(seen.size).toBe(10);
    });
    it("weights answers by sqrt(favourites)", () => {
        expect(answerWeight({ favourites: 99 })).toBe(10);
        const two = {
            ...FIXTURE_CATALOG,
            anime: [{ ...frieren, characters: [{ ...frieren.characters[0], id: 1, favourites: 9999 }, { ...frieren.characters[0], id: 2, favourites: 99 }] }],
        };
        const picks = days("2026-10-26", 3000).map((d) => dailyPick(two, d, "w").answerId);
        const share = picks.filter((id) => id === 1).length / picks.length; // expected 100 / 110 = 0.909
        expect(share).toBeGreaterThan(0.87);
        expect(share).toBeLessThan(0.95);
    });
    it("never picks a guess-only (no card) or art-less character", () => {
        for (const d of days("2026-10-26", 60)) {
            const p = dailyPick(FIXTURE_CATALOG, d, "x");
            const anime = FIXTURE_CATALOG.anime.find((a) => a.id === p.animeId)!;
            expect(anime.characters.some((c) => c.id === p.answerId && c.image)).toBe(true);
        }
    });
    it("days before #1 still pick (negative index wraps into a cycle)", () => {
        expect(dailyPick(FIXTURE_CATALOG, addDays(FIRST_DAY_KEY, -6), "x").cycle).toBe(-3); // 6 days early, 2 anime per cycle
    });
    it("ignores catalog order", () => {
        const shuffled = { ...FIXTURE_CATALOG, anime: [...FIXTURE_CATALOG.anime].reverse().map((a) => ({ ...a, characters: [...a.characters].reverse() })) };
        expect(dailyPick(shuffled, "2026-11-01", "s")).toEqual(dailyPick(FIXTURE_CATALOG, "2026-11-01", "s"));
    });
});

describe("pulls and story", () => {
    it("new / upgrade / same keeps the highest tier", () => {
        expect(pullResult(null, "common")).toBe("new");
        expect(pullResult("common", "rare")).toBe("upgrade");
        expect(pullResult("sr", "ssr")).toBe("upgrade");
        expect(pullResult("sr", "sr")).toBe("same");
        expect(pullResult("ssr", "common")).toBe("same");
    });
    it("story unlocks at 3 owned", () => {
        expect([2, 3, 4].map(storyUnlocked)).toEqual([false, true, true]);
    });
});

describe("streak", () => {
    it("counts consecutive finished days ending today", () => {
        expect(streak(["2026-10-28", "2026-10-29", "2026-10-30"], "2026-10-30")).toBe(3);
    });
    it("ends yesterday while today is unfinished", () => {
        expect(streak(["2026-10-28", "2026-10-29"], "2026-10-30")).toBe(2);
    });
    it("breaks on a gap", () => {
        expect(streak(["2026-10-26", "2026-10-28", "2026-10-30"], "2026-10-30")).toBe(1);
        expect(streak(["2026-10-27"], "2026-10-30")).toBe(0);
        expect(streak([], "2026-10-30")).toBe(0);
    });
});
