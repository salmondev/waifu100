import { describe, expect, it } from "vitest";
import { cardShareCode, publishCardShare, readCardShare, type CardShareRef } from "./card-share";

const SALT = "card-share-test-salt";
const REF: CardShareRef = { day: "2026-10-28", charId: 101, tier: "ssr", guesses: 0 };

describe("card share codes", () => {
    it("is a short code, and the same pull always publishes the same one", async () => {
        const code = cardShareCode(REF, SALT);
        expect(code).toMatch(/^[A-Za-z0-9]{8}$/);
        expect(await readCardShare(code, SALT)).toBeNull();
        expect(await publishCardShare(REF, SALT)).toBe(code);
        expect(await readCardShare(code, SALT)).toEqual(REF);
        expect(await publishCardShare(REF, SALT)).toBe(code);
        const other = await publishCardShare({ ...REF, tier: "rare", guesses: 3 }, SALT);
        expect(other).toMatch(/^[A-Za-z0-9]{8}$/);
        expect(other).not.toBe(code);
        expect(await readCardShare(other, SALT)).toEqual({ ...REF, tier: "rare", guesses: 3 });
    });

    it("rejects a different salt, an edit, and a code that was not published", async () => {
        const code = await publishCardShare(REF, SALT);
        expect(await readCardShare(code, "other-salt")).toBeNull();
        expect(cardShareCode(REF, "other-salt")).not.toBe(code);
        const flipped = `${code.slice(0, 7)}${code.endsWith("a") ? "b" : "a"}`;
        expect(flipped).not.toBe(code);
        expect(await readCardShare(flipped, SALT)).toBeNull();
        expect(await readCardShare("not-a-card-code", SALT)).toBeNull();
        expect(await readCardShare(`${code}=`, SALT)).toBeNull();
        expect(await readCardShare("aaaaaaaa", SALT)).toBeNull();
    });

    it("refuses to mint a tier or a day that is not real", async () => {
        expect(() => cardShareCode({ ...REF, tier: "mythic" as CardShareRef["tier"] }, SALT)).toThrow();
        expect(() => cardShareCode({ ...REF, day: "2026-02-31" }, SALT)).toThrow();
        expect(() => cardShareCode({ ...REF, guesses: -1 }, SALT)).toThrow();
        await expect(publishCardShare({ ...REF, charId: 0 }, SALT)).rejects.toThrow();
    });
});
