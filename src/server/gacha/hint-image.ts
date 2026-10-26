import { createCipheriv, createDecipheriv, createHash, createHmac } from "node:crypto";
import sharp from "sharp";
import { isValidGachaId } from "@/lib/gacha-id";
import { hintImagePath, isHintImageToken, type HintImageKind } from "@/lib/gacha-hint-image";

/**
 * Opaque hint-image tokens and the server-side renderers behind
 * /api/gacha/hint-image.
 *
 * Token = base64url(iv | AES-256-GCM(day|charId|kind) | tag), keyed from the
 * daily salt AND the Bangkok day key, so a token is only readable on the day
 * it was minted for: the reader derives today's key, a token from any other
 * day fails GCM authentication, and the day inside the payload must match too.
 * The IV is an HMAC of the plaintext, so the token is deterministic: every
 * player gets the same URL for the same day's hint, and the CDN can cache it
 * (until that day ends). Without the salt a token cannot be minted or read,
 * and GCM rejects any edited token.
 *
 * Tokens minted for a player's round also carry that player's id (encrypted,
 * never readable without the salt): the resolver then checks the token's
 * character against the answer STORED in that player's round for that day, so
 * a round created under an older answer picker (e.g. pre-r2 rounds) keeps
 * working, and a token for any other character is refused. Such tokens are
 * per player, so the CDN shares them less, which is the price of that check.
 */

const KINDS: readonly HintImageKind[] = ["eyes", "blur", "silhouette"];

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Per-day keys: the same salt gives unrelated keys on different days. */
function keys(salt: string, day: string) {
    const enc = createHash("sha256").update(`gacha-hint-image:enc:v2:${day}:${salt}`).digest();
    const iv = createHash("sha256").update(`gacha-hint-image:iv:v2:${day}:${salt}`).digest();
    return { enc, iv };
}

export interface HintImageRef {
    day: string;
    charId: number;
    kind: HintImageKind;
    /** The player whose stored round this token was minted for (absent on older, shared tokens). */
    pid?: string;
}


export function hintImageToken(ref: HintImageRef, salt: string): string {
    if (!DAY_RE.test(ref.day)) throw new Error("hint image token needs a YYYY-MM-DD day");
    if (ref.pid !== undefined && !isValidGachaId(ref.pid)) throw new Error("hint image token pid must be a player id");
    const { enc, iv: ivKey } = keys(salt, ref.day);
    const plain = Buffer.from(`${ref.day}|${ref.charId}|${ref.kind}${ref.pid ? `|${ref.pid}` : ""}`, "utf8");
    const iv = createHmac("sha256", ivKey).update(plain).digest().subarray(0, 12);
    const cipher = createCipheriv("aes-256-gcm", enc, iv);
    const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
    return Buffer.concat([iv, ct, cipher.getAuthTag()]).toString("base64url");
}

export function hintImageUrl(ref: HintImageRef, salt: string): string {
    return hintImagePath(hintImageToken(ref, salt));
}

/**
 * null for anything that is not a token this server minted with this salt for
 * `day` (the reader's current Bangkok day): a token from another day is
 * unreadable, not merely rejected afterwards.
 */
export function readHintImageToken(token: unknown, salt: string, day: string): HintImageRef | null {
    if (!isHintImageToken(token) || !DAY_RE.test(day)) return null;
    const raw = Buffer.from(token, "base64url");
    if (raw.length < 12 + 16 + 5) return null;
    try {
        const decipher = createDecipheriv("aes-256-gcm", keys(salt, day).enc, raw.subarray(0, 12));
        decipher.setAuthTag(raw.subarray(raw.length - 16));
        const plain = Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]).toString("utf8");
        const parts = plain.split("|");
        if (parts.length !== 3 && parts.length !== 4) return null;
        const [tokenDay, id, kind, pid] = parts;
        const charId = Number(id);
        if (tokenDay !== day || !Number.isSafeInteger(charId) || charId <= 0) return null;
        if (!KINDS.includes(kind as HintImageKind)) return null;
        if (pid !== undefined && !isValidGachaId(pid)) return null;
        return pid === undefined ? { day, charId, kind: kind as HintImageKind } : { day, charId, kind: kind as HintImageKind, pid };
    } catch {
        return null;
    }
}

// PICO-8 navy / cream, the game's palette.
const INK = { r: 0x1d, g: 0x2b, b: 0x53 };
const PAPER = { r: 0xff, g: 0xf1, b: 0xe8 };

/**
 * Blur hint: shrunk to 14 px wide, then scaled back up and blurred, so the
 * served bytes only carry colour blobs. Nothing sharper ever leaves the server.
 */
export async function renderBlurHint(jpeg: Buffer): Promise<Buffer> {
    const tiny = await sharp(jpeg).resize(14, null, { fit: "inside" }).removeAlpha().png().toBuffer();
    return sharp(tiny).resize(224, null, { kernel: "cubic" }).blur(6).webp({ quality: 60 }).toBuffer();
}

/**
 * Eye / face crop hint. There is no face detection here (no new deps, nothing
 * guessed), so it is a fixed top-centre crop: AniList character art is a
 * portrait, and its upper-middle band is where the eyes usually sit. The crop
 * is cut from a 160 px-wide copy and enlarged, so the served bytes hold that
 * band only, never the rest of the art.
 */
export const EYE_CROP = { left: 0.2, top: 0.16, width: 0.6, height: 0.2 } as const;

export async function renderEyesHint(jpeg: Buffer): Promise<Buffer> {
    const small = await sharp(jpeg).resize(160, null, { fit: "inside" }).removeAlpha().png().toBuffer({ resolveWithObject: true });
    const { width, height } = small.info;
    const left = Math.round(width * EYE_CROP.left);
    const top = Math.round(height * EYE_CROP.top);
    const w = Math.max(1, Math.min(width - left, Math.round(width * EYE_CROP.width)));
    const h = Math.max(1, Math.min(height - top, Math.round(height * EYE_CROP.height)));
    return sharp(small.data).extract({ left, top, width: w, height: h }).resize(w * 3, h * 3, { kernel: "nearest" }).webp({ quality: 70 }).toBuffer();
}

/** Otsu threshold over a 256-bin histogram. */
export function otsuThreshold(gray: Uint8Array): number {
    const hist = new Array<number>(256).fill(0);
    for (const v of gray) hist[v]++;
    const total = gray.length;
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0;
    let wB = 0;
    let best = 0;
    let threshold = 127;
    for (let t = 0; t < 256; t++) {
        wB += hist[t];
        if (wB === 0) continue;
        const wF = total - wB;
        if (wF === 0) break;
        sumB += t * hist[t];
        const mB = sumB / wB;
        const mF = (sum - sumB) / wF;
        const between = wB * wF * (mB - mF) ** 2;
        if (between > best) {
            best = between;
            threshold = t;
        }
    }
    return threshold;
}

/**
 * "Silhouette" hint: a two-tone shadow stencil of the character art. AniList
 * portraits are tight crops with busy backgrounds, so a true cut-out silhouette
 * is not reliable; instead the art is reduced to 40 px, greyscaled and split
 * into ink/paper at its Otsu threshold, then scaled up with hard pixels. Shape
 * and pose survive, colours and detail do not.
 */
export async function renderSilhouetteHint(jpeg: Buffer): Promise<Buffer> {
    const { data, info } = await sharp(jpeg)
        .resize(40, null, { fit: "inside" })
        .greyscale()
        .blur(0.6)
        .raw()
        .toBuffer({ resolveWithObject: true });
    const t = otsuThreshold(data);
    const out = Buffer.alloc(info.width * info.height * 3);
    for (let i = 0; i < info.width * info.height; i++) {
        const c = data[i * info.channels] <= t ? INK : PAPER;
        out[i * 3] = c.r;
        out[i * 3 + 1] = c.g;
        out[i * 3 + 2] = c.b;
    }
    return sharp(out, { raw: { width: info.width, height: info.height, channels: 3 } })
        .resize(info.width * 5, info.height * 5, { kernel: "nearest" })
        .png({ palette: true, colours: 2, compressionLevel: 9 })
        .toBuffer();
}
