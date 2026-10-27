import { describe, expect, it } from "vitest";
import { parseAge } from "./feedback";
import { formatAge, normaliseAge, parseAgeStrict } from "../../../scripts/gacha/enrich/lib/age.mjs";

// Same strings feedback.test.ts feeds to parseAge. parseAgeStrict must agree on every one.
const PARSE_AGE_CASES: Array<string | null | undefined> = [
    "17",
    "0",
    "100000",
    "  17  ",
    "17-18",
    "17 - 18",
    "17 ~ 18",
    "17~18",
    "17–18",
    "17 to 18",
    "17-17",
    "~20",
    "~ 20",
    "approx. 20",
    "approximately 20",
    "About 20",
    "around 20",
    "ca. 20",
    "17 years old",
    "17 years",
    "17 yrs",
    "17-18 years old",
    "~20 years old",
    "1000+",
    "1000+ years",
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
];

describe("parseAgeStrict stays in step with parseAge", () => {
    it.each(PARSE_AGE_CASES)("%j", (raw) => {
        expect(parseAgeStrict(raw)).toEqual(parseAge(raw));
    });
});

describe("normaliseAge", () => {
    it("keeps a strict age as high confidence and does not ask for review", () => {
        expect(normaliseAge("17")).toMatchObject({ ageGame: "17", confidence: "high", review: false, reason: "strict" });
        expect(normaliseAge("16-18")).toMatchObject({ ageGame: "16-18", confidence: "high", review: false });
        expect(normaliseAge("1000+")).toMatchObject({ ageGame: "1000+", confidence: "high", review: false });
    });

    it("stores nothing for empty or unknown text", () => {
        expect(normaliseAge("")).toMatchObject({ ageGame: null, review: false, reason: "empty" });
        expect(normaliseAge(null)).toMatchObject({ ageGame: null, review: false, reason: "empty" });
        expect(normaliseAge("Unknown")).toMatchObject({ ageGame: null, review: false, reason: "unknown" });
    });

    it("accepts one value plus a qualifier without review", () => {
        expect(normaliseAge("10-11 (Past)")).toMatchObject({
            ageGame: "10-11",
            confidence: "high",
            review: false,
            reason: "single value with qualifier",
        });
        expect(normaliseAge("6 (self asserted)")).toMatchObject({ ageGame: "6", confidence: "high", review: false });
    });

    it("sends open-ended wording, decades, and non-year units to review", () => {
        expect(normaliseAge("34 or older")).toMatchObject({ ageGame: "34+", confidence: "medium", review: true, reason: "open-ended" });
        expect(normaliseAge("30s")).toMatchObject({ ageGame: "30-39", confidence: "medium", review: true, reason: "decade" });
        expect(normaliseAge("17 months")).toMatchObject({ ageGame: null, confidence: "low", review: true, reason: "non-year unit" });
    });

    it("suggests the first number when the text has several", () => {
        expect(normaliseAge("15 (Part 1), 17 (Part 2)")).toMatchObject({
            ageGame: "15",
            confidence: "low",
            review: true,
            reason: "multiple values",
        });
    });
});

describe("formatAge", () => {
    it("prints a point, a range, or an open end", () => {
        expect(formatAge({ lo: 17, hi: 17 })).toBe("17");
        expect(formatAge({ lo: 16, hi: 18 })).toBe("16-18");
        expect(formatAge({ lo: 1000, hi: Infinity })).toBe("1000+");
        expect(formatAge(null)).toBeNull();
    });
});
