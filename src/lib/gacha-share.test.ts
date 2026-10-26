import { describe, expect, it } from "vitest";
import { shareText } from "./gacha-share";

const row = (...states: ("hit" | "near" | "miss" | "up" | "down" | "unknown")[]) => states.map((state) => ({ state }));

describe("shareText", () => {
    it("prints the header and one square row per guess", () => {
        const text = shareText(12, 6, [
            { correct: false, feedback: row("hit", "miss", "up", "down", "near", "unknown") },
            { correct: true, feedback: row("hit", "hit", "hit", "hit", "hit", "hit") },
        ], true);
        expect(text).toBe("waifu100 Daily #12 2/6\n🟩⬛⬛⬛🟨⬛\n🟩🟩🟩🟩🟩🟩");
    });

    it("marks a loss with X and never contains a name or a value", () => {
        const guesses = Array.from({ length: 6 }, () => ({ correct: false, feedback: row("miss", "miss", "miss", "miss", "miss", "miss") }));
        const text = shareText(3, 6, guesses, false);
        expect(text.split("\n")[0]).toBe("waifu100 Daily #3 X/6");
        expect(text.split("\n")).toHaveLength(7);
        expect(text).toMatch(/^waifu100 Daily #3 X\/6(\n(⬛){6}){6}$/u);
    });

    it("draws a correct guess all green even if its cells were not all hits", () => {
        expect(shareText(1, 6, [{ correct: true, feedback: row("hit", "unknown", "hit", "unknown", "hit", "hit") }], true)).toBe(
            "waifu100 Daily #1 1/6\n🟩🟩🟩🟩🟩🟩",
        );
    });

    describe("free first guess (T-0024)", () => {
        const miss = { correct: false, feedback: row("miss", "near", "miss", "miss", "hit", "miss") };
        const win = { correct: true, feedback: row("hit", "hit", "hit", "hit", "hit", "hit") };

        it("a win on the free guess reads FREE/6, never 0/6 or 1/6", () => {
            const text = shareText(12, 6, [win], true, true);
            expect(text).toBe("waifu100 Daily #12 FREE/6\n🆓 🟩🟩🟩🟩🟩🟩");
            expect(text).not.toMatch(/ [01]\/6/);
        });

        it("counts only the guesses after the free one, says +free and marks only the free row", () => {
            const text = shareText(12, 6, [miss, miss, win], true, true);
            expect(text).toBe("waifu100 Daily #12 2/6 +free\n🆓 ⬛🟨⬛⬛🟩⬛\n⬛🟨⬛⬛🟩⬛\n🟩🟩🟩🟩🟩🟩");
            expect(text.split("\n").filter((l) => l.startsWith("🆓"))).toHaveLength(1);
        });

        it("right on counted guess 1 after a wrong free guess reads 1/6 +free", () => {
            expect(shareText(5, 6, [miss, win], true, true).split("\n")[0]).toBe("waifu100 Daily #5 1/6 +free");
        });

        it("a loss after 7 guesses reads X/6 +free with 7 rows", () => {
            const text = shareText(3, 6, Array.from({ length: 7 }, () => miss), false, true);
            expect(text.split("\n")[0]).toBe("waifu100 Daily #3 X/6 +free");
            expect(text.split("\n")).toHaveLength(8);
            expect(text.split("\n").slice(1).every((l) => /^(🆓 )?[🟩🟨⬛⬆⬇️]+$/u.test(l))).toBe(true); // squares only, no names
        });

        it("old-rule rounds (no free guess) keep the old format", () => {
            expect(shareText(12, 6, [miss, win], true, false)).toBe("waifu100 Daily #12 2/6\n⬛🟨⬛⬛🟩⬛\n🟩🟩🟩🟩🟩🟩");
        });
    });
});
