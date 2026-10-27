/**
 * Spoiler-free share text for a finished Gacha Guess round (Wordle-style), with
 * an invite and the game link (T-0025) so a stranger knows what it is:
 *
 *   waifu100 Daily #12 · ทายถูกใน 2/6 ครั้ง (+เดาฟรี 1)
 *   🆓 ⬛🟨⬛⬛🟩⬛
 *   🟨🟨⬛🟩🟩⬛
 *   🟩🟩🟩🟩🟩🟩
 *   ทายตัวละครอนิเมะประจำวัน คุณทายได้กี่ครั้ง? 👇
 *   https://waifu100.vercel.app/daily
 *
 * One row per guess, one square per feedback column. Only the cell states go
 * in: no names, values or anime, so it gives nothing away. The link is on its
 * own line so chat apps show the /daily preview card. Client-safe (no server
 * imports).
 *
 * Header by result (a free first guess, T-0024, is not counted in N; its row
 * is marked 🆓):
 *   won on the free guess   "ทายถูกตั้งแต่ครั้งแรก! 🆓"
 *   won after N counted     "ทายถูกใน N/6 ครั้ง" + " (+เดาฟรี 1)" when the round had one
 *   lost                    "ทายไม่ถูก X/6" + " (+เดาฟรี 1)" when the round had one
 * An archive day says "(ย้อนหลัง)" after the number and its invite says it does
 * not count for the streak, so it never reads like a streak brag.
 */
export const SHARE_URL = "https://waifu100.vercel.app/daily";
export const SHARE_INVITE = "ทายตัวละครอนิเมะประจำวัน คุณทายได้กี่ครั้ง? 👇";
export const SHARE_INVITE_ARCHIVE = "เล่นย้อนหลัง (ไม่นับสตรีค) · มาทายของวันนี้กัน 👇";

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

/**
 * free: the round's first guess was free (guesses[0]); maxGuesses counts the other guesses.
 * archive: a past day played from the archive (no streak).
 */
export function shareText(
    dayNumber: number, maxGuesses: number, guesses: readonly ShareGuess[], won: boolean, free = false, archive = false,
): string {
    const counted = guesses.length - (free ? 1 : 0);
    const freeNote = free ? " (+เดาฟรี 1)" : "";
    const result = !won ? `ทายไม่ถูก X/${maxGuesses}${freeNote}` : free && counted <= 0 ? "ทายถูกตั้งแต่ครั้งแรก! 🆓" : `ทายถูกใน ${counted}/${maxGuesses} ครั้ง${freeNote}`;
    const head = `waifu100 Daily #${dayNumber}${archive ? " (ย้อนหลัง)" : ""} · ${result}`;
    const rows = guesses.map(
        (g, i) => (free && i === 0 ? "🆓 " : "") + g.feedback.map((c) => (g.correct ? SHARE_SQUARE.hit : SHARE_SQUARE[c.state] ?? SHARE_SQUARE.unknown)).join(""),
    );
    return [head, ...rows, archive ? SHARE_INVITE_ARCHIVE : SHARE_INVITE, SHARE_URL].join("\n");
}
