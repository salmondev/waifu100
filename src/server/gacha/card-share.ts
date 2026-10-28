import { createHmac } from "node:crypto";
import { withRedis } from "@/lib/redis";
import { isDayKey, type Tier } from "./rules";

/**
 * Short card-share codes for /c/<code>.
 *
 * The public code is 8 characters from [A-Za-z0-9], an HMAC of the pull under
 * the daily salt, so the same won round always mints the same code and a code
 * cannot be forged without the salt. The payload (day, character, tier, guess
 * count) lives at `waifu100:gg:cs:<code>`. Reading it back checks the HMAC, so
 * a planted value under a guessed key does not resolve. No player id.
 *
 * Without REDIS_URL (local dev, tests) the map is process memory, same as the
 * profile store. A Redis error is not hidden behind that map.
 */

const TIERS: readonly Tier[] = ["common", "rare", "sr", "ssr"];
const MAX_GUESSES_ON_CARD = 12;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const CODE_LENGTH = 8;

export const CARD_SHARE_PREFIX = "waifu100:gg:cs:";

export interface CardShareRef {
    day: string;
    charId: number;
    tier: Tier;
    /** Counted guesses printed on the card. A free-guess win is 0. */
    guesses: number;
}

const memory = new Map<string, string>();

function canonical(ref: CardShareRef): string {
    return `${ref.day}|${ref.charId}|${ref.tier}|${ref.guesses}`;
}

function assertRef(ref: CardShareRef): void {
    if (!isDayKey(ref.day)) throw new Error("card share needs a real calendar day");
    if (!Number.isSafeInteger(ref.charId) || ref.charId <= 0) throw new Error("card share needs a character id");
    if (!TIERS.includes(ref.tier)) throw new Error("card share needs a tier");
    if (!Number.isSafeInteger(ref.guesses) || ref.guesses < 0 || ref.guesses > MAX_GUESSES_ON_CARD) {
        throw new Error("card share guesses are out of range");
    }
}

/** The public code for this pull. Deterministic for a salt; not stored yet. */
export function cardShareCode(ref: CardShareRef, salt: string): string {
    assertRef(ref);
    const mac = createHmac("sha256", `gacha-card-share:code:v1:${salt}`).update(canonical(ref)).digest();
    let n = BigInt(0);
    for (let i = 0; i < 6; i++) n = (n << BigInt(8)) | BigInt(mac[i]!);
    const base = BigInt(62);
    let out = "";
    for (let i = 0; i < CODE_LENGTH; i++) {
        out = ALPHABET[Number(n % base)] + out;
        n = n / base;
    }
    return out;
}

function key(code: string): string {
    return CARD_SHARE_PREFIX + code;
}

/** true when the key is new or already holds this exact payload. */
async function put(code: string, payload: string): Promise<boolean> {
    if (!process.env.REDIS_URL) {
        const prev = memory.get(code);
        if (prev === undefined) {
            memory.set(code, payload);
            return true;
        }
        return prev === payload;
    }
    const created = await withRedis((r) => r.set(key(code), payload, "NX"));
    if (created === "OK") return true;
    return (await withRedis((r) => r.get(key(code)))) === payload;
}

async function get(code: string): Promise<string | null> {
    if (!process.env.REDIS_URL) return memory.get(code) ?? null;
    return withRedis((r) => r.get(key(code)));
}

/** Stores the pull and returns its short code. The same pull returns the same code. */
export async function publishCardShare(ref: CardShareRef, salt: string): Promise<string> {
    const code = cardShareCode(ref, salt);
    const ok = await put(code, canonical(ref));
    if (!ok) throw new Error("card share code collision");
    return code;
}

function parse(payload: string): CardShareRef | null {
    const parts = payload.split("|");
    if (parts.length !== 4) return null;
    const [day, id, tier, guessesText] = parts;
    const charId = Number(id);
    const guesses = Number(guessesText);
    if (!isDayKey(day) || !Number.isSafeInteger(charId) || charId <= 0) return null;
    if (!TIERS.includes(tier as Tier)) return null;
    if (!Number.isSafeInteger(guesses) || guesses < 0 || guesses > MAX_GUESSES_ON_CARD) return null;
    return { day, charId, tier: tier as Tier, guesses };
}

/** null unless this salt published that code and the stored pull still matches it. */
export async function readCardShare(code: unknown, salt: string): Promise<CardShareRef | null> {
    if (typeof code !== "string" || !/^[A-Za-z0-9]{8}$/.test(code)) return null;
    const payload = await get(code);
    if (!payload) return null;
    const ref = parse(payload);
    if (!ref) return null;
    let expected: string;
    try {
        expected = cardShareCode(ref, salt);
    } catch {
        return null;
    }
    return expected === code ? ref : null;
}
