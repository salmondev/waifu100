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
 *
 * A round with a free first guess (T-0024) says so: the score counts the other
 * guesses only, "+free" follows it, and the free guess's row is marked 🆓:
 *
 *   waifu100 Daily #12 2/6 +free
 *   🆓 ⬛🟨⬛⬛🟩⬛
 *   🟨🟨⬛🟩🟩⬛
 *   🟩🟩🟩🟩🟩🟩
 *
 *   waifu100 Daily #12 FREE/6        (won on the free guess)
 *   🆓 🟩🟩🟩🟩🟩🟩
 *
 * A loss is "X/6 +free".
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

/** free: the round's first guess was free (guesses[0]); maxGuesses counts the other guesses. */
export function shareText(dayNumber: number, maxGuesses: number, guesses: readonly ShareGuess[], won: boolean, free = false): string {
    const counted = guesses.length - (free ? 1 : 0);
    const score = !won ? "X" : free && counted <= 0 ? "FREE" : String(counted);
    const head = `waifu100 Daily #${dayNumber} ${score}/${maxGuesses}${free && score !== "FREE" ? " +free" : ""}`;
    const rows = guesses.map(
        (g, i) => (free && i === 0 ? "🆓 " : "") + g.feedback.map((c) => (g.correct ? SHARE_SQUARE.hit : SHARE_SQUARE[c.state] ?? SHARE_SQUARE.unknown)).join(""),
    );
    return [head, ...rows].join("\n");
}
