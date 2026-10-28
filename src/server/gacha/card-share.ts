import { createCipheriv, createDecipheriv, createHash, createHmac } from "node:crypto";
import { isDayKey, type Tier } from "./rules";

/**
 * Opaque card-share codes for /c/<code>.
 *
 * Code = base64url(iv | AES-256-GCM(day|charId|tier|guesses) | tag), keyed from
 * the daily salt. The IV is an HMAC of the plaintext, so the same won round
 * always mints the same link. Without the salt a code cannot be minted or
 * read, and GCM rejects any edited code. The code carries no player id.
 */

const TIERS: readonly Tier[] = ["common", "rare", "sr", "ssr"];
const MAX_GUESSES_ON_CARD = 12;

export interface CardShareRef {
    day: string;
    charId: number;
    tier: Tier;
    /** Counted guesses printed on the card. A free-guess win is 0. */
    guesses: number;
}

function keys(salt: string) {
    const enc = createHash("sha256").update(`gacha-card-share:enc:v1:${salt}`).digest();
    const ivKey = createHash("sha256").update(`gacha-card-share:iv:v1:${salt}`).digest();
    return { enc, ivKey };
}

export function cardShareToken(ref: CardShareRef, salt: string): string {
    if (!isDayKey(ref.day)) throw new Error("card share needs a real calendar day");
    if (!Number.isSafeInteger(ref.charId) || ref.charId <= 0) throw new Error("card share needs a character id");
    if (!TIERS.includes(ref.tier)) throw new Error("card share needs a tier");
    if (!Number.isSafeInteger(ref.guesses) || ref.guesses < 0 || ref.guesses > MAX_GUESSES_ON_CARD) {
        throw new Error("card share guesses are out of range");
    }
    const { enc, ivKey } = keys(salt);
    const plain = Buffer.from(`${ref.day}|${ref.charId}|${ref.tier}|${ref.guesses}`, "utf8");
    const iv = createHmac("sha256", ivKey).update(plain).digest().subarray(0, 12);
    const cipher = createCipheriv("aes-256-gcm", enc, iv);
    const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
    return Buffer.concat([iv, ct, cipher.getAuthTag()]).toString("base64url");
}

/** null for anything this salt did not mint, including a truncated or edited code. */
export function readCardShareToken(token: unknown, salt: string): CardShareRef | null {
    if (typeof token !== "string" || token.length < 20 || token.length > 200) return null;
    if (!/^[A-Za-z0-9_-]+$/.test(token)) return null;
    const raw = Buffer.from(token, "base64url");
    if (raw.length < 12 + 16 + 8) return null;
    try {
        const decipher = createDecipheriv("aes-256-gcm", keys(salt).enc, raw.subarray(0, 12));
        decipher.setAuthTag(raw.subarray(raw.length - 16));
        const plain = Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]).toString("utf8");
        const parts = plain.split("|");
        if (parts.length !== 4) return null;
        const [day, id, tier, guessesText] = parts;
        const charId = Number(id);
        const guesses = Number(guessesText);
        if (!isDayKey(day) || !Number.isSafeInteger(charId) || charId <= 0) return null;
        if (!TIERS.includes(tier as Tier)) return null;
        if (!Number.isSafeInteger(guesses) || guesses < 0 || guesses > MAX_GUESSES_ON_CARD) return null;
        return { day, charId, tier: tier as Tier, guesses };
    } catch {
        return null;
    }
}
