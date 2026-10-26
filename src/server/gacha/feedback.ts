// Pure guess-feedback helpers: parse AniList free-text ages and compare guess vs answer per column.

export interface AgeRange { lo: number; hi: number }

export type CellState = "hit" | "near" | "miss" | "up" | "down" | "unknown";

const MAX_AGE = 100_000;
const SUFFIX = /\s*(?:years\s+old|years|yrs)$/;
const SINGLE = /^(\d+)$/;
const APPROX = /^(?:~|approximately|approx\.|about|around|ca\.)\s*(\d+)$/;
const RANGE = /^(\d+)\s*(?:-|~|–|\s+to\s+)\s*(\d+)$/;
const PLUS = /^(\d+)\s*\+$/;

function toInt(s: string): number | null {
    const n = Number(s);
    return Number.isSafeInteger(n) && n >= 0 && n <= MAX_AGE ? n : null;
}

/** Strict parse of an AniList age string; anything ambiguous (multiple values, words, decimals) is null. */
export function parseAge(raw: string | null | undefined): AgeRange | null {
    if (typeof raw !== "string") return null;
    const s = raw.trim().toLowerCase().replace(SUFFIX, "").trim();
    if (!s) return null;
    let m = SINGLE.exec(s) ?? APPROX.exec(s);
    if (m) {
        const n = toInt(m[1]);
        return n === null ? null : { lo: n, hi: n };
    }
    if ((m = PLUS.exec(s))) {
        const n = toInt(m[1]);
        return n === null ? null : { lo: n, hi: Infinity };
    }
    if ((m = RANGE.exec(s))) {
        const lo = toInt(m[1]);
        const hi = toInt(m[2]);
        return lo === null || hi === null || lo > hi ? null : { lo, hi };
    }
    return null;
}

/** "up" means the answer is older than the guess; overlapping-but-different ranges are "near". */
export function compareAge(guess: AgeRange | null, answer: AgeRange | null): CellState {
    if (!guess || !answer) return "unknown";
    if (guess.lo === answer.lo && guess.hi === answer.hi) return "hit";
    if (guess.hi < answer.lo) return "up";
    if (guess.lo > answer.hi) return "down";
    return "near";
}

const isMonth = (m: number | null): m is number => m !== null && Number.isInteger(m) && m >= 1 && m <= 12;

/** Calendar order, no wrap: December guessed for a January answer is "down". */
export function compareMonth(guess: number | null, answer: number | null): CellState {
    if (!isMonth(guess) || !isMonth(answer)) return "unknown";
    if (guess === answer) return "hit";
    return guess < answer ? "up" : "down";
}

/** Rank never gives a direction, only closeness. */
export function compareRank(guess: number, answer: number): CellState {
    if (guess === answer) return "hit";
    return Math.abs(guess - answer) <= 2 ? "near" : "miss";
}

export function compareExact<T>(guess: T | null | undefined, answer: T | null | undefined): CellState {
    if (guess === null || guess === undefined || answer === null || answer === undefined) return "unknown";
    return guess === answer ? "hit" : "miss";
}

const GENDERS = new Set(["Male", "Female", "Non-binary"]);

export function compareGender(g: string | null, a: string | null): CellState {
    if (g === null || a === null || !GENDERS.has(g) || !GENDERS.has(a)) return "unknown";
    return compareExact(g, a);
}
