import { describe, expect, it } from "vitest";
import { compareAge, compareExact, compareGender, compareMonth, compareRank, parseAge, type CellState } from "./feedback";

describe("parseAge accepts", () => {
    it.each<[string, { lo: number; hi: number }]>([
        ["17", { lo: 17, hi: 17 }],
        ["0", { lo: 0, hi: 0 }],
        ["100000", { lo: 100000, hi: 100000 }],
        ["  17  ", { lo: 17, hi: 17 }],
        ["17-18", { lo: 17, hi: 18 }],
        ["17 - 18", { lo: 17, hi: 18 }],
        ["17 ~ 18", { lo: 17, hi: 18 }],
        ["17~18", { lo: 17, hi: 18 }],
        ["17–18", { lo: 17, hi: 18 }],
        ["17 to 18", { lo: 17, hi: 18 }],
        ["17-17", { lo: 17, hi: 17 }],
        ["~20", { lo: 20, hi: 20 }],
        ["~ 20", { lo: 20, hi: 20 }],
        ["approx. 20", { lo: 20, hi: 20 }],
        ["approximately 20", { lo: 20, hi: 20 }],
        ["About 20", { lo: 20, hi: 20 }],
        ["around 20", { lo: 20, hi: 20 }],
        ["ca. 20", { lo: 20, hi: 20 }],
        ["17 years old", { lo: 17, hi: 17 }],
        ["17 years", { lo: 17, hi: 17 }],
        ["17 yrs", { lo: 17, hi: 17 }],
        ["17-18 years old", { lo: 17, hi: 18 }],
        ["~20 years old", { lo: 20, hi: 20 }],
    ])("%j", (raw, want) => {
        expect(parseAge(raw)).toEqual(want);
    });
    it("trailing + is open-ended", () => {
        expect(parseAge("1000+")).toEqual({ lo: 1000, hi: Infinity });
        expect(parseAge("1000+ years")).toEqual({ lo: 1000, hi: Infinity });
    });
});

describe("parseAge rejects", () => {
    it.each<string | null | undefined>([
        null,
        undefined,
        "",
        "   ",
        "15 (Part 1), 17 (Part 2)",
        "16/17",
        "17, 18",
        "17 (canon)",
        "(17)",
        "teens",
        "late teens",
        "20s",
        "Unknown",
        "Immortal",
        "17.5",
        "-5",
        "18-17",
        "100001",
        "~17-18",
        "~1000+",
        "17 18",
        "17to18",
        "years old",
        "1e3",
        "seventeen",
    ])("%j", (raw) => {
        expect(parseAge(raw)).toBeNull();
    });
});

describe("compareAge", () => {
    const r = (lo: number, hi = lo) => ({ lo, hi });
    it("unknown when either side is unparsed", () => {
        expect(compareAge(null, r(17))).toBe("unknown");
        expect(compareAge(r(17), null)).toBe("unknown");
        expect(compareAge(null, null)).toBe("unknown");
    });
    it("hit only when both bounds match", () => {
        expect(compareAge(r(17), r(17))).toBe("hit");
        expect(compareAge(r(17, 18), r(17, 18))).toBe("hit");
        expect(compareAge(r(1000, Infinity), r(1000, Infinity))).toBe("hit");
    });
    it("up when the answer is older, down when younger", () => {
        expect(compareAge(r(15), r(17))).toBe("up");
        expect(compareAge(r(15, 16), r(17, 18))).toBe("up");
        expect(compareAge(r(20), r(17))).toBe("down");
        expect(compareAge(r(19), r(17, 18))).toBe("down");
        expect(compareAge(r(500), r(1000, Infinity))).toBe("up");
        expect(compareAge(r(1000, Infinity), r(17))).toBe("down");
    });
    it("near when ranges overlap but differ", () => {
        expect(compareAge(r(17), r(17, 18))).toBe("near");
        expect(compareAge(r(17, 18), r(18))).toBe("near");
        expect(compareAge(r(16, 18), r(17, 19))).toBe("near");
        expect(compareAge(r(2000), r(1000, Infinity))).toBe("near");
    });
});

describe("compareMonth", () => {
    it("hit / up / down in calendar order without wrap", () => {
        expect(compareMonth(5, 5)).toBe("hit");
        expect(compareMonth(3, 7)).toBe("up");
        expect(compareMonth(9, 2)).toBe("down");
        expect(compareMonth(12, 1)).toBe("down");
        expect(compareMonth(1, 12)).toBe("up");
    });
    it("unknown for null or out-of-range months", () => {
        for (const [g, a] of [[null, 5], [5, null], [0, 5], [5, 13], [1.5, 2], [Number.NaN, 3]] as [number | null, number | null][]) {
            expect(compareMonth(g, a)).toBe("unknown");
        }
    });
});

describe("compareRank", () => {
    it("hit, near within 2, else miss — never directional", () => {
        expect(compareRank(10, 10)).toBe("hit");
        expect(compareRank(8, 10)).toBe("near");
        expect(compareRank(12, 10)).toBe("near");
        expect(compareRank(7, 10)).toBe("miss");
        expect(compareRank(13, 10)).toBe("miss");
        const seen = new Set<CellState>();
        for (let g = 1; g <= 30; g++) seen.add(compareRank(g, 15));
        expect([...seen].sort()).toEqual(["hit", "miss", "near"]);
    });
});

describe("compareExact", () => {
    it("unknown for null/undefined, else strict equality", () => {
        expect(compareExact(null, "a")).toBe("unknown");
        expect(compareExact("a", undefined)).toBe("unknown");
        expect(compareExact("a", "a")).toBe("hit");
        expect(compareExact("a", "b")).toBe("miss");
        expect(compareExact(0, 0)).toBe("hit");
        expect(compareExact<number | string>(1, "1")).toBe("miss");
    });
});

describe("compareGender", () => {
    it("compares only Male/Female/Non-binary", () => {
        expect(compareGender("Female", "Female")).toBe("hit");
        expect(compareGender("Male", "Female")).toBe("miss");
        expect(compareGender("Non-binary", "Non-binary")).toBe("hit");
        expect(compareGender("Non-binary", "Male")).toBe("miss");
    });
    it("unknown for null or free-text genders", () => {
        expect(compareGender(null, "Male")).toBe("unknown");
        expect(compareGender("Male", null)).toBe("unknown");
        expect(compareGender("Female, Male", "Female")).toBe("unknown");
        expect(compareGender("female", "female")).toBe("unknown");
        expect(compareGender("Male", "Unknown")).toBe("unknown");
    });
});
