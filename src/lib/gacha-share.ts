/**
 * Spoiler-free share text for a finished Gacha Guess round.
 *
 *   waifu100 Daily #30
 *   🟩⬛⬛⬛🟨⬛
 *   🟩🟩🟩🟩🟩🟩
 *   ทายตัวละครอนิเมะ สะสมการ์ด 👇
 *   https://waifu100.vercel.app/daily
 *
 * One row of squares per guess. A correct guess is a full green row, so the
 * text has no score like 1/6. Free and archive rounds use the same words.
 * No names, values, or anime. The link is on its own line. Client-safe.
 */
export const SHARE_URL = "https://waifu100.vercel.app/daily";
export const SHARE_INVITE = "ทายตัวละครอนิเมะ สะสมการ์ด 👇";

export type ShareCellState = "hit" | "near" | "miss" | "up" | "down" | "unknown";

/** Exact = green, close = yellow, anything else black. */
export const SHARE_SQUARE: Record<ShareCellState, string> = { hit: "🟩", near: "🟨", up: "⬛", down: "⬛", miss: "⬛", unknown: "⬛" };

export interface ShareGuess {
    correct: boolean;
    feedback: { state: ShareCellState }[];
}

/** free and archive are accepted so older callers still compile. They do not change the text. */
export function shareText(
    dayNumber: number, _maxGuesses: number, guesses: readonly ShareGuess[], _won: boolean, _free = false, _archive = false,
): string {
    const head = `waifu100 Daily #${dayNumber}`;
    const rows = guesses.map((g) => g.feedback.map((c) => (g.correct ? SHARE_SQUARE.hit : SHARE_SQUARE[c.state] ?? SHARE_SQUARE.unknown)).join(""));
    return [head, ...rows, SHARE_INVITE, SHARE_URL].join("\n");
}
