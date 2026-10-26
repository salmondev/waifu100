import { describe, expect, it } from "vitest";
import {
    addDays, bangkokDayKey, characterPool, dailyPick, dayNumber, fastBonus, hintLadder, hintValue, HAIR_KEYS, HAIR_STYLE,
    missingHints, nextBuyableHint, openHintCount, plainAge, pullResult, storyUnlocked, streak, tierForGuesses,
} from "./rules";
import { FIXTURE_CATALOG } from "./test-fixture";

const frieren = FIXTURE_CATALOG.anime[0];
const img = (kind: string) => `/opaque/${kind}`;
const char = (id: number) => FIXTURE_CATALOG.anime.flatMap((a) => a.characters).find((c) => c.id === id)!;

describe("tiers", () => {
    it("1 SSR, 2 SR, 3-4 Rare, 5-6 Common", () => {
        expect([1, 2, 3, 4, 5, 6].map(tierForGuesses)).toEqual(["ssr", "sr", "rare", "rare", "common", "common"]);
    });
    it("fast bonus only for 1-3 guesses", () => {
        expect([1, 2, 3, 4, 6].map(fastBonus)).toEqual([30, 20, 10, 0, 0]);
    });
});

describe("hint ladder", () => {
    it("has all five hints when every field exists", () => {
        expect(hintLadder(char(101))).toEqual(["role", "hair", "quote", "silhouette", "blur"]);
    });
    it("skips missing fields so later hints move up", () => {
        expect(hintLadder(char(104))).toEqual(["role", "hair", "silhouette", "blur"]); // no quote
        // silhouette is generated from the art, so a missing catalog silhouette no longer drops it
        expect(hintLadder(char(106))).toEqual(["role", "hair", "quote", "silhouette", "blur"]);
        expect(hintLadder(char(105))).toEqual(["role", "silhouette", "blur"]); // no hair, quote
        expect(hintLadder({ ...char(105), image: "" })).toEqual(["role"]); // no art: no image hints
        expect(hintLadder({ ...char(101), quote: "   " })).not.toContain("quote");
    });
    it("role hint: gender + occupation, else gender + MAIN/SUPPORTING", () => {
        expect(hintValue(char(101), "role", img)).toEqual({ key: "role", gender: "Female", occupation: "Mage", role: null, age: null });
        expect(hintValue(char(105), "role", img)).toEqual({ key: "role", gender: "Male", occupation: null, role: "SUPPORTING", age: null });
    });
    it("hair hint carries the Thai label and swatch; multicolour gets stripes", () => {
        expect(hintValue(char(103), "hair", img)).toMatchObject({ hair: "red", label: HAIR_STYLE.red.th, hex: HAIR_STYLE.red.hex, stripes: null });
        expect(hintValue(char(107), "hair", img)).toMatchObject({ hair: "multicolour", stripes: expect.any(Array) });
        for (const k of HAIR_KEYS) expect(HAIR_STYLE[k].hex).toMatch(/^#[0-9a-f]{6}$/);
    });
    it("open hints = wrong guesses + bought, capped; all when done", () => {
        expect(openHintCount(5, 0, 0, false)).toBe(0);
        expect(openHintCount(5, 2, 1, false)).toBe(3);
        expect(openHintCount(2, 4, 1, false)).toBe(2);
        expect(openHintCount(4, 0, 0, true)).toBe(4);
    });
    it("next hint price is positional (15/20/25/30/35)", () => {
        const ladder = hintLadder(char(101));
        expect([0, 1, 2, 3, 4].map((n) => nextBuyableHint(ladder, n, false)?.price)).toEqual([15, 20, 25, 30, 35]);
        expect(nextBuyableHint(ladder, 5, false)).toBeNull();
        expect(nextBuyableHint(ladder, 1, true)).toBeNull();
        // a shorter ladder still charges by position, not by kind
        expect(nextBuyableHint(hintLadder(char(105)), 1, false)).toEqual({ index: 1, key: "silhouette", price: 20 });
    });
    it("role hint adds the AniList age only when it is a plain number or range", () => {
        expect(hintValue({ ...char(101), age: "17" }, "role", img)).toMatchObject({ age: "17" });
        expect(hintValue({ ...char(101), age: "16 - 17" }, "role", img)).toMatchObject({ age: "16-17" });
        for (const age of ["15 (past), 27 (present)", "1 month+ (2000+ including previous life)", "", null, "unknown"])
            expect(hintValue({ ...char(101), age }, "role", img)).toMatchObject({ age: null });
        expect(plainAge("1000+")).toBe("1000+");
    });
    it("missing slots are exactly the kinds the ladder lacks, in display order", () => {
        expect(missingHints(hintLadder(char(101)))).toEqual([]);
        expect(missingHints(hintLadder(char(105)))).toEqual(["hair", "quote"]);
        expect(missingHints(hintLadder({ ...char(105), image: "" }))).toEqual(["hair", "quote", "silhouette", "blur"]);
    });
    it("never fabricates hair or quote", () => {
        const bare = { ...char(105), quote: null, hair: null };
        const ladder = hintLadder(bare);
        expect(ladder).not.toContain("hair");
        expect(ladder).not.toContain("quote");
    });
    it("image hints carry only the opaque src they are given, never the art URL", () => {
        for (const key of ["silhouette", "blur"] as const) {
            const v = hintValue(char(101), key, img);
            expect(v).toEqual({ key, src: `/opaque/${key}` });
            expect(JSON.stringify(v)).not.toContain(char(101).image);
        }
    });
});

describe("Bangkok calendar", () => {
    it("day key flips at Bangkok midnight (17:00 UTC)", () => {
        expect(bangkokDayKey(Date.parse("2026-10-25T16:59:59.999Z"))).toBe("2026-10-25");
        expect(bangkokDayKey(Date.parse("2026-10-25T17:00:00.000Z"))).toBe("2026-10-26");
        expect(bangkokDayKey(Date.parse("2026-12-31T17:30:00.000Z"))).toBe("2027-01-01");
    });
    it("day number #1 is 2026-10-26", () => {
        expect(dayNumber("2026-10-26")).toBe(1);
        expect(dayNumber("2026-10-27")).toBe(2);
        expect(dayNumber("2027-10-26")).toBe(366);
        expect(addDays("2026-10-26", -1)).toBe("2026-10-25");
    });
});

describe("daily pick", () => {
    const pool = characterPool(FIXTURE_CATALOG);
    const days = (from: string, n: number) => Array.from({ length: n }, (_, i) => addDays(from, i));

    it("is deterministic for the same day + salt", () => {
        expect(dailyPick(FIXTURE_CATALOG, "2026-11-03", "s1")).toEqual(dailyPick(FIXTURE_CATALOG, "2026-11-03", "s1"));
    });
    it("depends on the salt", () => {
        const seq = (salt: string) => days("2026-10-26", pool.length).map((d) => dailyPick(FIXTURE_CATALOG, d, salt).answerId);
        expect(seq("s1")).not.toEqual(seq("s2"));
    });
    it("never repeats a character within a cycle, and each cycle covers the whole pool", () => {
        for (const cycle of [0, 1, 2]) {
            const start = addDays("2026-10-26", cycle * pool.length);
            const picks = days(start, pool.length).map((d) => dailyPick(FIXTURE_CATALOG, d, "s1"));
            expect(new Set(picks.map((p) => p.answerId)).size).toBe(pool.length);
            expect(picks.every((p) => p.cycle === cycle)).toBe(true);
        }
    });
    it("answer belongs to the picked anime", () => {
        for (const d of days("2026-10-26", 20)) {
            const p = dailyPick(FIXTURE_CATALOG, d, "x");
            expect(FIXTURE_CATALOG.anime.find((a) => a.id === p.animeId)!.characters.some((c) => c.id === p.answerId)).toBe(true);
        }
    });
    it("days before #1 still pick (negative index wraps into a cycle)", () => {
        expect(dailyPick(FIXTURE_CATALOG, "2026-10-20", "x").cycle).toBe(-1);
    });
    it("ignores catalog order", () => {
        const shuffled = { ...FIXTURE_CATALOG, anime: [...FIXTURE_CATALOG.anime].reverse().map((a) => ({ ...a, characters: [...a.characters].reverse() })) };
        expect(dailyPick(shuffled, "2026-11-01", "s")).toEqual(dailyPick(FIXTURE_CATALOG, "2026-11-01", "s"));
        expect(frieren.characters.length).toBeGreaterThan(0);
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
