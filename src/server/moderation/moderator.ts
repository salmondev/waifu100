import { createHash } from "node:crypto";
import sharp from "sharp";
import { ClassifyError, geminiClassifier, type Classifier } from "@/server/moderation/classifier";
import { redisVerdictStore, type Verdict, type VerdictStore } from "@/server/moderation/verdict-store";
import { ImageFetchError, safeFetchImage, type SafeFetchOptions } from "@/server/moderation/safe-fetch";

/**
 * Best-effort image moderation (NOT a guarantee; no CSAM hash matching).
 *
 * getModeratedImage(url): fetch (SSRF-safe) -> sha256(bytes) -> verdict by
 * hash (cache) -> on miss, batched Gemini check -> serve bytes derived from
 * exactly the bytes that were hashed and checked.
 *
 * Outcomes (user decision 2026-10-14):
 *  - "a" allowed (cached)                 -> served, long CDN cache
 *  - "b" blocked (AI said no / safety)    -> placeholder (cached)
 *  - "u" unchecked: Gemini could not give an answer (quota/429, timeout,
 *    error, empty or malformed reply, no key) -> served, NEVER cached, short
 *    CDN cache, re-checked on the next miss. See PLAN.md "fail open".
 *  - our own per-IP limit hit             -> placeholder (abuser only)
 * Uploads (persistent storage) and OG cards (long-cached) still require "a".
 */

export const BATCH_MAX = 8;
export const BATCH_WINDOW_MS = 60;
export const MODERATION_INPUT_PX = 384;
export const SERVE_WIDTHS = [64, 128, 160, 256, 384, 512] as const;
/** Animated GIFs above these are served (and checked) as their first frame only. */
export const GIF_MAX_BYTES = 8 * 1024 * 1024;
export const GIF_MAX_FRAMES = 300;
const GIF_FRAME_PX = 256;

export type Outcome = Verdict | "u";

export type ModerationResult =
    | { ok: true; hash: string; jpeg: Buffer; gif?: Buffer; checked: boolean; reason?: string }
    | { ok: false; reason: string; hash?: string; definitive: boolean };

interface Deps {
    classify: Classifier;
    store: VerdictStore;
    fetchOptions: SafeFetchOptions;
    bypass: () => boolean;
}

const defaultDeps: Deps = {
    classify: geminiClassifier,
    store: redisVerdictStore,
    fetchOptions: {},
    bypass: () => process.env.MODERATION_DEV_BYPASS === "1" && process.env.NODE_ENV !== "production",
};
let deps: Deps = { ...defaultDeps };

/** Test hook. Pass nothing to reset. */
export function configureModeration(next?: Partial<Deps>) {
    deps = next ? { ...defaultDeps, ...next } : { ...defaultDeps };
    queue = [];
}

export function sha256(bytes: Buffer): string {
    return createHash("sha256").update(bytes).digest("hex");
}

/* ------------------------------ micro-batcher ----------------------------- */

interface Pending {
    hash: string;
    jpeg: Buffer;
    resolve: (v: { outcome: Outcome; reason?: string }) => void;
}
let queue: Pending[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

async function classifyBatch(batch: Pending[]): Promise<void> {
    try {
        const oks = await deps.classify(batch.map((p) => ({ jpeg: p.jpeg })));
        const entries: [string, Verdict][] = batch.map((p, i) => [p.hash, oks[i] ? "a" : "b"]);
        await deps.store.set(entries).catch((e) => console.warn("[moderation] verdict store write failed:", e));
        batch.forEach((p, i) => p.resolve({ outcome: entries[i][1] }));
    } catch (e) {
        const reason = e instanceof ClassifyError ? e.reason : "error";
        if (reason === "safety" && batch.length > 1) {
            // Which image tripped it is unknown: re-check one by one.
            await Promise.all(batch.map((p) => classifyBatch([p])));
            return;
        }
        if (reason === "safety") {
            await deps.store.set([[batch[0].hash, "b"]]).catch(() => undefined);
            batch[0].resolve({ outcome: "b" });
            return;
        }
        // No answer from Gemini is not a judgement about the image: unchecked, not cached.
        console.warn(`[moderation] batch of ${batch.length} unchecked: ${reason}`);
        batch.forEach((p) => p.resolve({ outcome: "u", reason }));
    }
}

function flush() {
    timer = null;
    const pending = queue;
    queue = [];
    for (let i = 0; i < pending.length; i += BATCH_MAX) void classifyBatch(pending.slice(i, i + BATCH_MAX));
}

function enqueue(hash: string, jpeg: Buffer): Promise<{ outcome: Outcome; reason?: string }> {
    return new Promise((resolve) => {
        const dup = queue.find((p) => p.hash === hash);
        if (dup) {
            const prev = dup.resolve;
            dup.resolve = (v) => {
                prev(v);
                resolve(v);
            };
            return;
        }
        queue.push({ hash, jpeg, resolve });
        if (queue.length >= BATCH_MAX) {
            if (timer) clearTimeout(timer);
            flush();
        } else if (!timer) {
            timer = setTimeout(flush, BATCH_WINDOW_MS);
        }
    });
}

/* ---------------------------------- GIFs ---------------------------------- */

/** Frame count when the bytes are an animated GIF we will serve animated, else 0. */
export async function animatedGifFrames(bytes: Buffer): Promise<number> {
    if (bytes.length > GIF_MAX_BYTES || bytes.subarray(0, 4).toString("latin1") !== "GIF8") return 0;
    try {
        const meta = await sharp(bytes, { animated: true, limitInputPixels: 50_000_000 }).metadata();
        const pages = meta.pages ?? 1;
        return pages > 1 && pages <= GIF_MAX_FRAMES ? pages : 0;
    } catch {
        return 0;
    }
}

/** First, middle and last frame side by side: ONE image in ONE Gemini request. */
async function gifCheckImage(bytes: Buffer, pages: number): Promise<Buffer> {
    const idx = [...new Set([0, Math.floor(pages / 2), pages - 1])];
    const frames = await Promise.all(
        idx.map((page) =>
            sharp(bytes, { page, limitInputPixels: 50_000_000 })
                .resize(GIF_FRAME_PX, GIF_FRAME_PX, { fit: "contain", background: "#000" })
                .png()
                .toBuffer()
        )
    );
    return sharp({ create: { width: GIF_FRAME_PX * frames.length, height: GIF_FRAME_PX, channels: 3, background: "#000" } })
        .composite(frames.map((input, i) => ({ input, left: i * GIF_FRAME_PX, top: 0 })))
        .jpeg({ quality: 75 })
        .toBuffer();
}

/* --------------------------------- public --------------------------------- */

export interface ModerateOptions {
    /** Called only on a cache miss, right before a classifier call. false = refuse (rate limited). */
    beforeClassify?: () => Promise<boolean>;
}

/**
 * Verdict for bytes already in hand. verdict: "a" | "b" | "u" (unchecked,
 * Gemini gave no answer) | null (our per-IP limit refused the check).
 */
export async function moderateBytes(
    bytes: Buffer,
    opts: ModerateOptions = {}
): Promise<{ hash: string; verdict: Outcome | null; reason?: string; limited?: boolean }> {
    const hash = sha256(bytes);
    if (deps.bypass()) return { hash, verdict: "a" };
    const [cached] = await deps.store.get([hash]).catch(() => [null]);
    if (cached) return { hash, verdict: cached };
    if (opts.beforeClassify && !(await opts.beforeClassify())) return { hash, verdict: null, limited: true };
    let input: Buffer;
    try {
        const pages = await animatedGifFrames(bytes);
        input = pages
            ? await gifCheckImage(bytes, pages)
            : await sharp(bytes, { limitInputPixels: 50_000_000 })
                  .resize(MODERATION_INPUT_PX, MODERATION_INPUT_PX, { fit: "inside", withoutEnlargement: true })
                  .jpeg({ quality: 70 })
                  .toBuffer();
    } catch {
        await deps.store.set([[hash, "b"]]).catch(() => undefined); // undecodable: never servable
        return { hash, verdict: "b" };
    }
    const { outcome, reason } = await enqueue(hash, input);
    return { hash, verdict: outcome, reason };
}

export function clampWidth(w: number | null | undefined): number {
    const n = Number(w) || 256;
    return SERVE_WIDTHS.find((x) => x >= n) ?? SERVE_WIDTHS[SERVE_WIDTHS.length - 1];
}

export async function getModeratedImage(
    url: string,
    width: number,
    opts: { allow?: (u: string) => boolean; square?: boolean; height?: number; animated?: boolean } & ModerateOptions = {}
): Promise<ModerationResult> {
    let bytes: Buffer;
    try {
        ({ bytes } = await safeFetchImage(url, { ...deps.fetchOptions, allow: opts.allow }));
    } catch (e) {
        return { ok: false, reason: e instanceof ImageFetchError ? e.reason : "fetch", definitive: false };
    }
    const { hash, verdict, reason, limited } = await moderateBytes(bytes, { beforeClassify: opts.beforeClassify });
    if (verdict !== "a" && verdict !== "u") {
        return { ok: false, hash, reason: limited ? "rate-limited" : "blocked", definitive: verdict === "b" };
    }
    try {
        // Served bytes are derived from exactly the bytes that were hashed and checked.
        const jpeg = await sharp(bytes, { limitInputPixels: 50_000_000 })
            .resize(width, opts.square ? width : opts.height, { fit: opts.square || opts.height ? "cover" : "inside", withoutEnlargement: !opts.square && !opts.height })
            .jpeg({ quality: 78 })
            .toBuffer();
        // Animated GIF within caps: the original, already-hashed bytes (never refetched).
        const gif = opts.animated && (await animatedGifFrames(bytes)) ? bytes : undefined;
        return { ok: true, hash, jpeg, gif, checked: verdict === "a", reason: verdict === "u" ? reason : undefined };
    } catch {
        return { ok: false, hash, reason: "decode", definitive: true };
    }
}

/** Admin override (POST /api/admin/moderation). */
export async function setVerdict(hash: string, verdict: Verdict) {
    await deps.store.set([[hash, verdict]]);
}
