import { describe, expect, it } from "vitest";
import { cardShareToken, readCardShareToken, type CardShareRef } from "./card-share";

const SALT = "card-share-test-salt";
const REF: CardShareRef = { day: "2026-10-28", charId: 101, tier: "ssr", guesses: 0 };

describe("card share codes", () => {
    it("round-trips and stays the same for the same pull", () => {
        const code = cardShareToken(REF, SALT);
        expect(readCardShareToken(code, SALT)).toEqual(REF);
        expect(cardShareToken(REF, SALT)).toBe(code);
        expect(cardShareToken({ ...REF, tier: "rare", guesses: 3 }, SALT)).not.toBe(code);
    });

    it("rejects a different salt, an edit, and a code that is not ours", () => {
        const code = cardShareToken(REF, SALT);
        expect(readCardShareToken(code, "other-salt")).toBeNull();
        const flipped = `${code.slice(0, -2)}${code.endsWith("a") ? "b" : "a"}`;
        expect(readCardShareToken(flipped, SALT)).toBeNull();
        expect(readCardShareToken("not-a-card-code", SALT)).toBeNull();
        expect(readCardShareToken(`${code}=`, SALT)).toBeNull();
    });

    it("refuses to mint a tier or a day that is not real", () => {
        expect(() => cardShareToken({ ...REF, tier: "mythic" as CardShareRef["tier"] }, SALT)).toThrow();
        expect(() => cardShareToken({ ...REF, day: "2026-02-31" }, SALT)).toThrow();
        expect(() => cardShareToken({ ...REF, guesses: -1 }, SALT)).toThrow();
    });
});
