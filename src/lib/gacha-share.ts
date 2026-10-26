/**
 * Spoiler-free share text for a finished Gacha Guess round (Wordle-style):
 *
 *   waifu100 Daily #12 3/6
 *   🟨⬛🟩🟨⬛🟩
 *   🟩🟨🟩⬛🟨🟩
 *   🟩🟩🟩🟩🟩🟩
 *
 * One row per guess, one square per feedback column. Only the cell states go
 * in: no names, values or anime, so it gives nothing away. Client-safe (no
 * server imports).
 */
export type ShareCellState = "hit" | "near" | "miss" | "up" | "down" | "unknown";

/**
 * Same colours as the grid: exact = green, close = yellow, anything else
 * black. An arrow (up/down) is a wrong value with a direction, so it is black
 * like any other miss (Loldle does the same).
 */
export const SHARE_SQUARE: Record<ShareCellState, string> = { hit: "🟩", near: "🟨", up: "⬛", down: "⬛", miss: "⬛", unknown: "⬛" };

export interface ShareGuess {
    correct: boolean;
    feedback: { state: ShareCellState }[];
}

export function shareText(dayNumber: number, maxGuesses: number, guesses: readonly ShareGuess[], won: boolean): string {
    const head = `waifu100 Daily #${dayNumber} ${won ? guesses.length : "X"}/${maxGuesses}`;
    const rows = guesses.map((g) => g.feedback.map((c) => (g.correct ? SHARE_SQUARE.hit : SHARE_SQUARE[c.state] ?? SHARE_SQUARE.unknown)).join(""));
    return [head, ...rows].join("\n");
}
