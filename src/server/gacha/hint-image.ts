import { createCipheriv, createDecipheriv, createHash, createHmac } from "node:crypto";
import sharp from "sharp";
import { hintImagePath, isHintImageToken, type HintImageKind } from "@/lib/gacha-hint-image";

/**
 * Opaque hint-image tokens and the server-side renderers behind
 * /api/gacha/hint-image.
 *
 * Token = base64url(iv | AES-256-GCM(day|charId|kind) | tag), keyed from the
 * daily salt. The IV is an HMAC of the plaintext, so the token is
 * deterministic: every player gets the same URL for the same day's hint, and
 * the CDN can cache it. Without the salt a token cannot be minted or read, and
 * GCM rejects any edited token.
 */

const KINDS: readonly HintImageKind[] = ["blur", "silhouette"];

function keys(salt: string) {
    const enc = createHash("sha256").update(`gacha-hint-image:enc:${salt}`).digest();
    const iv = createHash("sha256").update(`gacha-hint-image:iv:${salt}`).digest();
    return { enc, iv };
}

export interface HintImageRef {
    day: string;
    charId: number;
    kind: HintImageKind;
}

export function hintImageToken(ref: HintImageRef, salt: string): string {
    const { enc, iv: ivKey } = keys(salt);
    const plain = Buffer.from(`${ref.day}|${ref.charId}|${ref.kind}`, "utf8");
    const iv = createHmac("sha256", ivKey).update(plain).digest().subarray(0, 12);
    const cipher = createCipheriv("aes-256-gcm", enc, iv);
    const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
    return Buffer.concat([iv, ct, cipher.getAuthTag()]).toString("base64url");
}

export function hintImageUrl(ref: HintImageRef, salt: string): string {
    return hintImagePath(hintImageToken(ref, salt));
}

/** null for anything that is not a token this server minted with this salt. */
export function readHintImageToken(token: unknown, salt: string): HintImageRef | null {
    if (!isHintImageToken(token)) return null;
    const raw = Buffer.from(token, "base64url");
    if (raw.length < 12 + 16 + 5) return null;
    try {
        const decipher = createDecipheriv("aes-256-gcm", keys(salt).enc, raw.subarray(0, 12));
        decipher.setAuthTag(raw.subarray(raw.length - 16));
        const plain = Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]).toString("utf8");
        const [day, id, kind] = plain.split("|");
        const charId = Number(id);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day ?? "") || !Number.isSafeInteger(charId) || charId <= 0) return null;
        if (!KINDS.includes(kind as HintImageKind)) return null;
        return { day, charId, kind: kind as HintImageKind };
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
