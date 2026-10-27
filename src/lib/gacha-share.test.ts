import { describe, expect, it } from "vitest";
import { SHARE_INVITE, SHARE_URL, shareText } from "./gacha-share";

const row = (...states: ("hit" | "near" | "miss" | "up" | "down" | "unknown")[]) => states.map((state) => ({ state }));
const miss = { correct: false, feedback: row("miss", "near", "miss", "miss", "hit", "miss") };
const win = { correct: true, feedback: row("hit", "hit", "hit", "hit", "hit", "hit") };
const tail = [SHARE_INVITE, SHARE_URL];

describe("shareText", () => {
    it("is a day line, one square row per guess, then the invite and the link", () => {
        const text = shareText(30, 6, [
            { correct: false, feedback: row("hit", "miss", "up", "down", "near", "unknown") },
            win,
        ], true);
        expect(text.split("\n")).toEqual(["waifu100 Daily #30", "🟩⬛⬛⬛🟨⬛", "🟩🟩🟩🟩🟩🟩", ...tail]);
        expect(SHARE_INVITE).toBe("ทายตัวละครอนิเมะ สะสมการ์ด 👇");
        expect(SHARE_URL).toBe("https://waifu100.vercel.app/daily");
        expect(text).not.toMatch(/\/6/);
    });

    it("a loss is the same shape, with no green row and no name", () => {
        const lines = shareText(3, 6, Array.from({ length: 6 }, () => miss), false).split("\n");
        expect(lines[0]).toBe("waifu100 Daily #3");
        expect(lines.slice(1, 7).every((l) => l === "⬛🟨⬛⬛🟩⬛")).toBe(true);
        expect(lines.slice(7)).toEqual(tail);
        expect(lines.join("\n")).not.toMatch(/Frieren|X\/6|🆓|ย้อนหลัง/);
    });

    it("draws a correct guess all green", () => {
        expect(shareText(1, 6, [{ correct: true, feedback: row("hit", "unknown", "hit", "unknown", "hit", "hit") }], true).split("\n")[1]).toBe("🟩🟩🟩🟩🟩🟩");
    });

    it("free and archive rounds use the same words", () => {
        const plain = shareText(12, 6, [miss, win], true);
        expect(shareText(12, 6, [miss, win], true, true)).toBe(plain);
        expect(shareText(12, 6, [miss, win], true, true, true)).toBe(plain);
        expect(plain.split("\n")[1]).toBe("⬛🟨⬛⬛🟩⬛");
    });
});
