/**
 * Gacha Guess (/daily) game rules. Everything here is pure: no I/O, no clock,
 * no randomness that is not seeded by its arguments - the service passes in
 * "now", the catalog and the salt, so every rule can be unit-tested directly.
 */
import type { Catalog, CatalogAnime, CatalogCharacter, HairKey } from "./catalog-types";

// ---- calendar ---------------------------------------------------------------

/** Asia/Bangkok is UTC+7 all year (no DST), so a fixed offset is exact. */
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Puzzle #1 is this Bangkok calendar day. */
export const FIRST_DAY_KEY = "2026-10-26";

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDayKey(value: unknown): value is string {
    return typeof value === "string" && DAY_KEY_RE.test(value) && !Number.isNaN(epochDay(value));
}

/** YYYY-MM-DD of the Bangkok calendar day containing `nowMs`. */
export function bangkokDayKey(nowMs: number): string {
    return new Date(nowMs + BANGKOK_OFFSET_MS).toISOString().slice(0, 10);
}

/** Whole days since 1970-01-01 for a day key (a plain calendar count, no zone). */
export function epochDay(dayKey: string): number {
    const [y, m, d] = dayKey.split("-").map(Number);
    return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);
}

export function dayKeyFromEpochDay(n: number): string {
    return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

export function addDays(dayKey: string, delta: number): string {
    return dayKeyFromEpochDay(epochDay(dayKey) + delta);
}

/** "#<n>" shown in the UI; #1 = FIRST_DAY_KEY. Days before it are <= 0. */
export function dayNumber(dayKey: string): number {
    return epochDay(dayKey) - epochDay(FIRST_DAY_KEY) + 1;
}

// ---- deterministic daily pick -----------------------------------------------

/** Used when DAILY_SALT is unset (local dev, tests). Production sets its own. */
export const DEV_DAILY_SALT = "waifu100-gacha-guess-dev-salt";

/** cyrb53: small, well-mixed string hash; good enough to seed a shuffle. */
export function hashString(str: string, seed = 0): number {
    let h1 = 0xdeadbeef ^ seed;
    let h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < str.length; i++) {
        const ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** mulberry32: seeded PRNG returning floats in [0, 1). */
export function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Fisher-Yates over 0..n-1 driven by a seeded PRNG. */
export function seededPermutation(n: number, seedText: string): number[] {
    const rand = mulberry32(hashString(seedText));
    const out = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

export interface DailyPick {
    animeId: number;
    answerId: number;
    /** Which pass through the whole character pool this day belongs to. */
    cycle: number;
}

/**
 * Every playable character in a stable order (anime id, then character id), so
 * reordering the catalog file does not reshuffle history.
 */
export function characterPool(catalog: Catalog): { animeId: number; charId: number }[] {
    const pool: { animeId: number; charId: number }[] = [];
    const seen = new Set<number>();
    for (const anime of [...catalog.anime].sort((a, b) => a.id - b.id)) {
        for (const c of [...anime.characters].sort((a, b) => a.id - b.id)) {
            // A character listed under two anime is played under the first only.
            if (c.image && !seen.has(c.id)) pool.push({ animeId: anime.id, charId: c.id });
            seen.add(c.id);
        }
    }
    return pool;
}

/**
 * The day's anime + hidden character. Days are numbered from FIRST_DAY_KEY and
 * cut into cycles of pool-size days; each cycle walks its own seeded
 * permutation of the pool, so no character repeats until the cycle is spent.
 * (Regenerating the catalog mid-cycle changes the pool and can repeat a
 * character once - acceptable for a daily game.)
 */
export function dailyPick(catalog: Catalog, dayKey: string, salt: string): DailyPick {
    const pool = characterPool(catalog);
    if (pool.length === 0) throw new Error("gacha catalog has no playable characters");
    const index = epochDay(dayKey) - epochDay(FIRST_DAY_KEY);
    const cycle = Math.floor(index / pool.length);
    const pos = index - cycle * pool.length;
    const perm = seededPermutation(pool.length, `${salt}:cycle:${cycle}`);
    const { animeId, charId } = pool[perm[pos]];
    return { animeId, answerId: charId, cycle };
}

// ---- hints ------------------------------------------------------------------

export type HintKey = "role" | "hair" | "quote" | "silhouette" | "blur";
export const HINT_ORDER: readonly HintKey[] = ["role", "hair", "quote", "silhouette", "blur"];

/** Price of buying the hint at ladder position i (0-based), whatever its kind. */
export const HINT_PRICES: readonly number[] = [15, 20, 25, 30, 35];

export const HAIR_KEYS = [
    "black", "brown", "blonde", "red", "orange", "pink", "purple",
    "blue", "green", "white", "silver", "grey", "multicolour",
] as const satisfies readonly HairKey[];

/** Thai label + a PICO-8 palette swatch for each hair key. */
export const HAIR_STYLE: Record<HairKey, { th: string; hex: string }> = {
    black: { th: "ดำ", hex: "#000000" },
    brown: { th: "น้ำตาล", hex: "#ab5236" },
    blonde: { th: "บลอนด์", hex: "#ffec27" },
    red: { th: "แดง", hex: "#ff004d" },
    orange: { th: "ส้ม", hex: "#ffa300" },
    pink: { th: "ชมพู", hex: "#ff77a8" },
    purple: { th: "ม่วง", hex: "#7e2553" },
    blue: { th: "ฟ้า", hex: "#29adff" },
    green: { th: "เขียว", hex: "#008751" },
    white: { th: "ขาว", hex: "#fff1e8" },
    silver: { th: "เงิน", hex: "#c2c3c7" },
    grey: { th: "เทา", hex: "#5f574f" },
    multicolour: { th: "หลายสี", hex: "#83769c" },
};

/** Multicolour hair is drawn as hard stripes of these instead of one swatch. */
export const HAIR_MULTI_STRIPES = ["#ff004d", "#ffec27", "#29adff"] as const;

export type HintValue =
    | { key: "role"; gender: string | null; occupation: string | null; role: "MAIN" | "SUPPORTING" | null }
    | { key: "hair"; hair: HairKey; label: string; hex: string; stripes: string[] | null }
    | { key: "quote"; quote: string }
    | { key: "silhouette"; image: string }
    | { key: "blur"; image: string };

const nonEmpty = (s: string | null | undefined): s is string => typeof s === "string" && s.trim().length > 0;

/**
 * The answer's hint ladder: HINT_ORDER minus the fields this character does not
 * have, so later hints move up (prototype HINTS filtering). Role and blur always
 * exist. Never invents a value.
 */
export function hintLadder(answer: CatalogCharacter): HintKey[] {
    return HINT_ORDER.filter((key) => {
        if (key === "hair") return !!answer.hair && answer.hair.key in HAIR_STYLE;
        if (key === "quote") return nonEmpty(answer.quote);
        if (key === "silhouette") return nonEmpty(answer.silhouette);
        return true;
    });
}

export function hintValue(answer: CatalogCharacter, key: HintKey): HintValue {
    switch (key) {
        case "role":
            // Occupation is the better clue; MAIN/SUPPORTING only stands in for it.
            return nonEmpty(answer.occupation)
                ? { key, gender: answer.gender ?? null, occupation: answer.occupation, role: null }
                : { key, gender: answer.gender ?? null, occupation: null, role: answer.role ?? null };
        case "hair": {
            const hair = answer.hair!.key;
            const style = HAIR_STYLE[hair];
            return { key, hair, label: style.th, hex: style.hex, stripes: hair === "multicolour" ? [...HAIR_MULTI_STRIPES] : null };
        }
        case "quote":
            return { key, quote: answer.quote! };
        case "silhouette":
            return { key, image: answer.silhouette! };
        case "blur":
            // Accepted weakness: the blurred hint is the real image URL (blurred
            // client-side), so a determined player can read the answer from the
            // network tab once hint 5 is open. Nothing else leaks it early.
            return { key, image: answer.image };
    }
}

/** How many ladder hints are open: one per wrong guess plus one per purchase, all when done. */
export function openHintCount(ladderLength: number, wrongGuesses: number, bought: number, done: boolean): number {
    if (done) return ladderLength;
    return Math.min(ladderLength, Math.max(0, wrongGuesses) + Math.max(0, bought));
}

/** The next locked hint and its price, or null when every hint is open or the round is over. */
export function nextBuyableHint(ladder: readonly HintKey[], openCount: number, done: boolean): { index: number; key: HintKey; price: number } | null {
    if (done || openCount >= ladder.length) return null;
    return { index: openCount, key: ladder[openCount], price: HINT_PRICES[openCount] ?? HINT_PRICES[HINT_PRICES.length - 1] };
}

// ---- guesses, tiers, pulls --------------------------------------------------

export const MAX_GUESSES = 6;

export type Tier = "common" | "rare" | "sr" | "ssr";
/** Lowest to highest. */
export const TIERS: readonly Tier[] = ["common", "rare", "sr", "ssr"];

export const tierRank = (t: Tier): number => TIERS.indexOf(t);

/** 1 guess SSR, 2 SR, 3-4 Rare, 5-6 Common. */
export function tierForGuesses(guessCount: number): Tier {
    if (guessCount <= 1) return "ssr";
    if (guessCount === 2) return "sr";
    if (guessCount <= 4) return "rare";
    return "common";
}

export type PullResult = "new" | "upgrade" | "same";

/** One card per character, highest tier kept: equal or lower is "same" and writes nothing. */
export function pullResult(owned: Tier | null | undefined, pulled: Tier): PullResult {
    if (!owned) return "new";
    return tierRank(pulled) > tierRank(owned) ? "upgrade" : "same";
}

/** Characters of one anime needed for its story card. */
export const STORY_UNLOCK = 3;

export const storyUnlocked = (ownedInAnime: number): boolean => ownedInAnime >= STORY_UNLOCK;

// ---- coins ------------------------------------------------------------------

export const START_COINS = 35;
export const DAILY_COINS = 10;
export const FAST_BONUS: Readonly<Record<number, number>> = { 1: 30, 2: 20, 3: 10 };

export const fastBonus = (guessCount: number): number => FAST_BONUS[guessCount] ?? 0;

// ---- streak -----------------------------------------------------------------

/**
 * Consecutive Bangkok days with a finished round, ending today - or yesterday
 * while today's round is still open, so a streak does not "break" at midnight.
 */
export function streak(finishedDays: readonly string[], todayKey: string): number {
    const days = new Set(finishedDays);
    let d = days.has(todayKey) ? todayKey : addDays(todayKey, -1);
    let n = 0;
    while (days.has(d)) {
        n++;
        d = addDays(d, -1);
    }
    return n;
}

// ---- catalog helpers --------------------------------------------------------

/** Card number within its anime: catalog order, "001".. */
export function cardNumber(anime: CatalogAnime, charId: number): string {
    const i = anime.characters.findIndex((c) => c.id === charId);
    return String(i + 1).padStart(3, "0");
}
