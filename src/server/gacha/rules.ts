/**
 * Gacha Guess (/daily) game rules. Everything here is pure: no I/O, no clock,
 * no randomness that is not seeded by its arguments - the service passes in
 * "now", the catalog and the salt, so every rule can be unit-tested directly.
 */
import type { Catalog, CatalogAnime, CatalogCharacter, RosterCharacter } from "./catalog-types";
import { compareAge, compareExact, compareGender, compareMonth, compareRank, parseAge, type CellState } from "./feedback";

export type { CellState } from "./feedback";

// ---- calendar ---------------------------------------------------------------

/** Asia/Bangkok is UTC+7 all year (no DST), so a fixed offset is exact. */
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Archive window: besides today, a player can play any of the ARCHIVE_DAYS
 * Bangkok days before it that they have never played.
 */
export const ARCHIVE_DAYS = 30;

/**
 * The production launch day (Bangkok). To move the launch, change this one
 * constant: the game's first day (FIRST_DAY_KEY, puzzle #1) is ARCHIVE_DAYS
 * before it, so on launch day the archive is already full (30 playable past
 * days), and no day before FIRST_DAY_KEY is ever shown or playable. Setting it
 * a day or two before the real deploy is harmless (the window is still full);
 * setting it after the deploy day leaves the window short until then.
 */
export const LAUNCH_DAY_KEY = "2026-10-27";

/** Puzzle #1 (the game epoch): LAUNCH_DAY_KEY - ARCHIVE_DAYS. Derived, never set by hand. */
export const FIRST_DAY_KEY = (() => {
    const [y, m, d] = LAUNCH_DAY_KEY.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d) - ARCHIVE_DAYS * DAY_MS).toISOString().slice(0, 10);
})();

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar day written as YYYY-MM-DD (2026-02-31 is not one). */
export function isDayKey(value: unknown): value is string {
    if (typeof value !== "string" || !DAY_KEY_RE.test(value)) return false;
    const n = epochDay(value);
    return Number.isFinite(n) && dayKeyFromEpochDay(n) === value;
}

/**
 * Whether `day` is a past day a player may open from the archive on `today`:
 * strictly before today, at most ARCHIVE_DAYS back, and not before the epoch.
 * Today itself is not an archive day (it is the normal round); future days never are.
 */
export function isArchiveDay(day: unknown, today: string): day is string {
    if (!isDayKey(day) || !isDayKey(today)) return false;
    const back = epochDay(today) - epochDay(day);
    return back >= 1 && back <= ARCHIVE_DAYS && epochDay(day) >= epochDay(FIRST_DAY_KEY);
}

/** The archive days for `today`, newest first (empty before the epoch has 1 past day). */
export function archiveDays(today: string): string[] {
    const out: string[] = [];
    for (let back = 1; back <= ARCHIVE_DAYS; back++) {
        const day = addDays(today, -back);
        if (!isArchiveDay(day, today)) break;
        out.push(day);
    }
    return out;
}

/** YYYY-MM-DD of the Bangkok calendar day containing `nowMs`. */
export function bangkokDayKey(nowMs: number): string {
    return new Date(nowMs + BANGKOK_OFFSET_MS).toISOString().slice(0, 10);
}

/** Whole seconds (at least 1) from `nowMs` until the next Bangkok midnight. */
export function secondsUntilNextBangkokDay(nowMs: number): number {
    const local = nowMs + BANGKOK_OFFSET_MS;
    const nextMidnight = (Math.floor(local / DAY_MS) + 1) * DAY_MS;
    return Math.max(1, Math.ceil((nextMidnight - local) / 1000));
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
    /** Which pass through the anime list this day belongs to. */
    cycle: number;
}

/** The answer is drawn from the anime's this-many most-favourited card characters. */
export const ANSWER_TOP = 10;

/** Card characters that can be a day's answer: with art, most favourited first, at most ANSWER_TOP. */
export function answerPool(anime: CatalogAnime): CatalogCharacter[] {
    return anime.characters
        .filter((c) => nonEmpty(c.image))
        .sort((a, b) => (b.favourites ?? 0) - (a.favourites ?? 0) || a.id - b.id)
        .slice(0, ANSWER_TOP);
}

/**
 * Anime that can host a day: at least one possible answer, in a stable order
 * (anime id), so reordering the catalog file does not reshuffle history. A
 * character listed under two anime is only an answer under the first (lowest id).
 */
export function playableAnime(catalog: Catalog): CatalogAnime[] {
    const seen = new Set<number>();
    const out: CatalogAnime[] = [];
    for (const anime of [...catalog.anime].sort((a, b) => a.id - b.id)) {
        const own = { ...anime, characters: anime.characters.filter((c) => !seen.has(c.id)) };
        for (const c of anime.characters) seen.add(c.id);
        if (answerPool(own).length > 0) out.push(own);
    }
    return out;
}

/** sqrt(favourites) weights: popular characters come up more often, the rest still do. */
export function answerWeight(c: Pick<CatalogCharacter, "favourites">): number {
    return Math.sqrt(Math.max(0, c.favourites ?? 0) + 1);
}

/**
 * The day's anime + hidden character. Days are numbered from FIRST_DAY_KEY and
 * cut into cycles of one day per anime; each cycle walks its own seeded
 * permutation of the anime, so no anime repeats until the cycle is spent. The
 * character is then drawn from that anime's top-ANSWER_TOP card characters,
 * weighted by sqrt(favourites), seeded by salt + day (so it is the same for
 * every player and every server). Stored rounds keep the answer they were
 * created with, so changing this rule never changes a round in progress.
 */
export function dailyPick(catalog: Catalog, dayKey: string, salt: string): DailyPick {
    const list = playableAnime(catalog);
    if (list.length === 0) throw new Error("gacha catalog has no playable characters");
    const index = epochDay(dayKey) - epochDay(FIRST_DAY_KEY);
    const cycle = Math.floor(index / list.length);
    const pos = index - cycle * list.length;
    const anime = list[seededPermutation(list.length, `${salt}:anime-cycle:${cycle}`)[pos]];
    const pool = answerPool(anime);
    const total = pool.reduce((s, c) => s + answerWeight(c), 0);
    let r = mulberry32(hashString(`${salt}:answer:${dayKey}`))() * total;
    let answer = pool[pool.length - 1];
    for (const c of pool) {
        r -= answerWeight(c);
        if (r < 0) {
            answer = c;
            break;
        }
    }
    return { animeId: anime.id, answerId: answer.id, cycle };
}

// ---- guess roster + feedback --------------------------------------------------

function fromCard(c: CatalogCharacter): RosterCharacter {
    return {
        id: c.id,
        name: c.name,
        nameNative: c.nameNative,
        alternative: c.alternative,
        gender: c.gender,
        age: c.age,
        role: c.role ?? null,
        favourites: c.favourites ?? 0,
        birthMonth: c.birthMonth ?? null,
        va: c.va ?? null,
        card: true,
    };
}

/**
 * Everyone the player may guess for this anime: the catalog roster when there
 * is one (older catalogs have none: then the card characters), plus any card
 * character missing from it, so every possible answer is always guessable.
 * Most favourited first; that order is the popularity rank.
 */
export function guessRoster(anime: CatalogAnime): RosterCharacter[] {
    const roster = anime.roster ? [...anime.roster] : [];
    const ids = new Set(roster.map((r) => r.id));
    for (const c of anime.characters) if (!ids.has(c.id)) roster.push(fromCard(c));
    return roster.sort((a, b) => b.favourites - a.favourites || a.id - b.id);
}

export const FEEDBACK_COLUMNS = ["gender", "role", "age", "month", "rank", "va"] as const;
export type FeedbackColumn = (typeof FEEDBACK_COLUMNS)[number];

/** One feedback cell: how the guessed character compares, and the guess's own value (null = "?"). */
export interface FeedbackCell {
    col: FeedbackColumn;
    state: CellState;
    value: string | null;
}

function ageText(raw: string | null): string | null {
    const a = parseAge(raw);
    if (!a) return null;
    if (a.hi === Infinity) return `${a.lo}+`;
    return a.lo === a.hi ? String(a.lo) : `${a.lo}-${a.hi}`;
}

/**
 * Loldle-style comparison of a guess with the answer. Up/down on age and birth
 * month say which way the answer lies; rank (position in the roster by
 * favourites) is only hit / within 2 / miss, never a direction. Anything
 * AniList lacks is "unknown" ("?"), never guessed.
 */
export function guessFeedback(guess: RosterCharacter, answer: RosterCharacter, roster: readonly RosterCharacter[]): FeedbackCell[] {
    const rank = (id: number) => roster.findIndex((r) => r.id === id) + 1;
    const g = rank(guess.id);
    const a = rank(answer.id);
    return [
        { col: "gender", state: compareGender(guess.gender, answer.gender), value: guess.gender },
        { col: "role", state: compareExact(guess.role, answer.role), value: guess.role },
        { col: "age", state: compareAge(parseAge(guess.age), parseAge(answer.age)), value: ageText(guess.age) },
        { col: "month", state: compareMonth(guess.birthMonth, answer.birthMonth), value: guess.birthMonth ? String(guess.birthMonth) : null },
        { col: "rank", state: g > 0 && a > 0 ? compareRank(g, a) : "unknown", value: g > 0 ? String(g) : null },
        { col: "va", state: compareExact(guess.va?.id, answer.va?.id), value: guess.va?.name ?? null },
    ];
}

// ---- hints ------------------------------------------------------------------

/**
 * r2 ladder: eye/face crop -> JP voice actor -> silhouette -> blur -> first
 * letter + name length. The three image hints are rendered server-side from
 * the art behind an opaque token, so the art URL never reaches the client.
 */
export type HintKey = "eyes" | "va" | "silhouette" | "blur" | "initial";
export const HINT_ORDER: readonly HintKey[] = ["eyes", "va", "silhouette", "blur", "initial"];

/** Price of buying ladder slot i (0-based): set by the slot index alone, never by its kind. */
export const HINT_PRICES: readonly number[] = [15, 20, 25, 30, 35];

export type HintImageHintKind = "eyes" | "silhouette" | "blur";

export type HintValue =
    /** src: an opaque /api/gacha/hint-image URL, never the art's real URL. */
    | { key: "eyes"; src: string }
    | { key: "va"; name: string; nameNative: string | null }
    | { key: "silhouette"; src: string }
    | { key: "blur"; src: string }
    /** First letter of the name as shown in the guess list, and the letter count of each word. */
    | { key: "initial"; first: string; words: number[] };

const nonEmpty = (s: string | null | undefined): s is string => typeof s === "string" && s.trim().length > 0;

/** The hints a character cannot have, in HINT_ORDER: shown as an honest "no data" slot. */
export function missingHints(ladder: readonly HintKey[]): HintKey[] {
    return HINT_ORDER.filter((k) => !ladder.includes(k));
}

/**
 * The answer's hint ladder: HINT_ORDER minus the fields this character does not
 * have, so later hints move up. Image hints exist whenever the art does (every
 * pickable answer has art); the voice actor only when AniList lists a Japanese
 * one. Never invents a value.
 */
export function hintLadder(answer: CatalogCharacter): HintKey[] {
    return HINT_ORDER.filter((key) => {
        if (key === "va") return !!answer.va && nonEmpty(answer.va.name);
        if (key === "initial") return nonEmpty(answer.name);
        return nonEmpty(answer.image);
    });
}

/** "Levi Ackerman" -> first "L", words [4, 8] (letters counted as code points). */
export function nameShape(name: string): { first: string; words: number[] } {
    const words = name.trim().split(/\s+/).filter(Boolean);
    return { first: (Array.from(words[0] ?? "")[0] ?? "").toUpperCase(), words: words.map((w) => Array.from(w).length) };
}

/**
 * imageSrc builds the opaque hint-image URL for the image hints (see
 * src/server/gacha/hint-image.ts); the answer's image URL never goes in a hint.
 */
export function hintValue(answer: CatalogCharacter, key: HintKey, imageSrc: (kind: HintImageHintKind) => string): HintValue {
    switch (key) {
        case "va":
            return { key, name: answer.va!.name, nameNative: answer.va!.nameNative ?? null };
        case "initial":
            return { key, ...nameShape(answer.name) };
        case "eyes":
        case "silhouette":
        case "blur":
            return { key, src: imageSrc(key) };
    }
}

/**
 * Every round shows the same fixed ladder of HINT_SLOTS slots, whatever the
 * answer has: its real hints first (hintLadder order), then one empty "no
 * data" slot per missing kind, always at the end. So the slot count, the
 * prices and the shop never say how many real hints exist; only reaching an
 * empty slot does, and that can only happen after every real hint is open.
 */
export const HINT_SLOTS = HINT_ORDER.length;

/**
 * How many ladder slots are open, all when done. r2 rounds open hints only by
 * buying them (pass freeFromWrong = 0: the feedback grid is the free clue);
 * rounds created before r2 also opened one per wrong guess and keep that.
 */
export function openHintCount(freeFromWrong: number, bought: number, done: boolean): number {
    if (done) return HINT_SLOTS;
    return Math.min(HINT_SLOTS, Math.max(0, freeFromWrong) + Math.max(0, bought));
}

/**
 * The next slot to buy (1-based) and its price, or null when every slot is open
 * or the round is over. Depends only on how many slots are open, never on the
 * answer, so the price and the offer cannot leak what sits behind the slot.
 */
export function nextBuyableSlot(openCount: number, done: boolean): { slot: number; price: number } | null {
    if (done || openCount >= HINT_SLOTS) return null;
    return { slot: openCount + 1, price: HINT_PRICES[openCount] ?? HINT_PRICES[HINT_PRICES.length - 1] };
}

/** Whether ladder slot `index` (0-based) is an empty "no data" slot for this ladder. */
export function isEmptySlot(ladder: readonly HintKey[], index: number): boolean {
    return index >= ladder.length && index < HINT_SLOTS;
}

// ---- guesses, tiers, pulls --------------------------------------------------

export const MAX_GUESSES = 6;

export type Tier = "common" | "rare" | "sr" | "ssr";
/** Lowest to highest. */
export const TIERS: readonly Tier[] = ["common", "rare", "sr", "ssr"];

export const tierRank = (t: Tier): number => TIERS.indexOf(t);

/**
 * Tier from "steps" used: guesses, plus (r2 rounds) hints bought. 1 SSR, 2 SR,
 * 3-4 Rare, 5+ Common. A lost round gets no card at all.
 */
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

/** Keyed by the same steps value as the tier (guesses + bought hints in r2 rounds). */
export const fastBonus = (steps: number): number => FAST_BONUS[steps] ?? 0;

/** The steps a round's tier and fast bonus are read from. Pre-r2 rounds count guesses only. */
export function tierSteps(guesses: number, bought: number, r2: boolean): number {
    return guesses + (r2 ? Math.max(0, bought) : 0);
}

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
