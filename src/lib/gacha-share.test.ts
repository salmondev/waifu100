import { describe, expect, it } from "vitest";
import { SHARE_INVITE, SHARE_INVITE_ARCHIVE, SHARE_URL, shareText } from "./gacha-share";

const row = (...states: ("hit" | "near" | "miss" | "up" | "down" | "unknown")[]) => states.map((state) => ({ state }));
const miss = { correct: false, feedback: row("miss", "near", "miss", "miss", "hit", "miss") };
const win = { correct: true, feedback: row("hit", "hit", "hit", "hit", "hit", "hit") };
const tail = [SHARE_INVITE, SHARE_URL];

describe("shareText", () => {
    it("prints a readable header, one square row per guess, the invite and the link on its own line", () => {
        const text = shareText(12, 6, [
            { correct: false, feedback: row("hit", "miss", "up", "down", "near", "unknown") },
            { correct: true, feedback: row("hit", "hit", "hit", "hit", "hit", "hit") },
        ], true);
        expect(text.split("\n")).toEqual(["waifu100 Daily #12 · ทายถูกใน 2/6 ครั้ง", "🟩⬛⬛⬛🟨⬛", "🟩🟩🟩🟩🟩🟩", ...tail]);
        expect(SHARE_URL).toBe("https://waifu100.vercel.app/daily");
    });

    it("marks a loss with X and never contains a name or a value", () => {
        const guesses = Array.from({ length: 6 }, () => ({ correct: false, feedback: row("miss", "miss", "miss", "miss", "miss", "miss") }));
        const lines = shareText(3, 6, guesses, false).split("\n");
        expect(lines[0]).toBe("waifu100 Daily #3 · ทายไม่ถูก X/6");
        expect(lines).toHaveLength(9);
        expect(lines.slice(1, 7).every((l) => l === "⬛⬛⬛⬛⬛⬛")).toBe(true);
        expect(lines.slice(7)).toEqual(tail);
    });

    it("draws a correct guess all green even if its cells were not all hits", () => {
        expect(shareText(1, 6, [{ correct: true, feedback: row("hit", "unknown", "hit", "unknown", "hit", "hit") }], true).split("\n")[1]).toBe("🟩🟩🟩🟩🟩🟩");
    });

    it("the link is alone on its line and the text has no URL anywhere else", () => {
        const text = shareText(7, 6, [miss, win], true, true);
        expect(text.split("\n").filter((l) => l.includes("http"))).toEqual([SHARE_URL]);
    });

    describe("free first guess (T-0024)", () => {
        it("a win on the free guess is a brag line, never 0/6 or 1/6 (4 lines)", () => {
            const text = shareText(31, 6, [win], true, true);
            expect(text.split("\n")).toEqual(["waifu100 Daily #31 · ทายถูกตั้งแต่ครั้งแรก! 🆓", "🆓 🟩🟩🟩🟩🟩🟩", ...tail]);
            expect(text).not.toMatch(/ [01]\/6/);
        });

        it("counts only the guesses after the free one, notes the free guess and marks only the free row", () => {
            const lines = shareText(12, 6, [miss, miss, win], true, true).split("\n");
            expect(lines).toEqual(["waifu100 Daily #12 · ทายถูกใน 2/6 ครั้ง (+เดาฟรี 1)", "🆓 ⬛🟨⬛⬛🟩⬛", "⬛🟨⬛⬛🟩⬛", "🟩🟩🟩🟩🟩🟩", ...tail]);
            expect(lines.filter((l) => l.startsWith("🆓"))).toHaveLength(1);
        });

        it("right on counted guess 1 after a wrong free guess reads 1/6 (+เดาฟรี 1)", () => {
            expect(shareText(5, 6, [miss, win], true, true).split("\n")[0]).toBe("waifu100 Daily #5 · ทายถูกใน 1/6 ครั้ง (+เดาฟรี 1)");
        });

        it("a loss after 7 guesses reads X/6 (+เดาฟรี 1) with 7 rows", () => {
            const lines = shareText(3, 6, Array.from({ length: 7 }, () => miss), false, true).split("\n");
            expect(lines[0]).toBe("waifu100 Daily #3 · ทายไม่ถูก X/6 (+เดาฟรี 1)");
            expect(lines).toHaveLength(10);
            expect(lines.slice(1, 8).every((l) => /^(🆓 )?[🟩🟨⬛]+$/u.test(l))).toBe(true); // squares only, no names
        });

        it("old-rule rounds (no free guess) have no free note and no 🆓 row", () => {
            expect(shareText(12, 6, [miss, win], true, false).split("\n")).toEqual(["waifu100 Daily #12 · ทายถูกใน 2/6 ครั้ง", "⬛🟨⬛⬛🟩⬛", "🟩🟩🟩🟩🟩🟩", ...tail]);
        });
    });

    describe("archive day (T-0025)", () => {
        it("says ย้อนหลัง in the header and that it does not count for the streak", () => {
            const lines = shareText(12, 6, [miss, miss, miss, win], true, true, true).split("\n");
            expect(lines[0]).toBe("waifu100 Daily #12 (ย้อนหลัง) · ทายถูกใน 3/6 ครั้ง (+เดาฟรี 1)");
            expect(lines.slice(-2)).toEqual([SHARE_INVITE_ARCHIVE, SHARE_URL]);
            expect(SHARE_INVITE_ARCHIVE).toContain("ไม่นับสตรีค");
            expect(lines.join("\n")).not.toContain(SHARE_INVITE);
        });

        it("a free-guess win on an archive day keeps the archive mark", () => {
            expect(shareText(4, 6, [win], true, true, true).split("\n")[0]).toBe("waifu100 Daily #4 (ย้อนหลัง) · ทายถูกตั้งแต่ครั้งแรก! 🆓");
        });
    });
});
