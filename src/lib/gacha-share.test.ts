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
});
