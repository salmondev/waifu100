import { describe, expect, it } from "vitest";
import { hintImagePath, hintImageSrc, isHintImageToken } from "./gacha-hint-image";

const SAMPLE_ID = "AbCdEf0123456789_-AbCdEf0123456789";

describe("hintImageSrc", () => {
    it("passes only same-origin hint-image URLs with a well-formed token", () => {
        expect(hintImageSrc(hintImagePath(SAMPLE_ID))).toBe(`/api/gacha/hint-image?t=${SAMPLE_ID}`);
    });

    it.each([
        "https://s4.anilist.co/file/anilistcdn/character/large/b1.png",
        "//evil.example/api/gacha/hint-image?t=" + SAMPLE_ID,
        "/api/img?u=https%3A%2F%2Fs4.anilist.co%2Fx.png",
        "/api/gacha/hint-image?t=short",
        `/api/gacha/hint-image?t=${SAMPLE_ID}&u=https://s4.anilist.co/x.png`,
        "javascript:alert(1)",
        "",
        null,
        42,
    ])("rejects %s", (src) => expect(hintImageSrc(src)).toBe(""));

    it("token shape", () => {
        expect(isHintImageToken(SAMPLE_ID)).toBe(true);
        expect(isHintImageToken("a".repeat(201))).toBe(false);
        expect(isHintImageToken("abc/def+ghi=".repeat(3))).toBe(false);
    });
});
