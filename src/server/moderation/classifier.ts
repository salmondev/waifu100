import { GoogleGenerativeAI } from "@google/generative-ai";
import { warnIfNoGeminiKey } from "@/server/gemini-key-warning";

/**
 * Batched image classification with Gemini (free tier, existing key).
 * Returns per-image ok/blocked, or throws ClassifyError for anything that is
 * not a clean, complete answer - the caller fails closed.
 */

export class ClassifyError extends Error {
    constructor(
        readonly reason: "no-key" | "safety" | "empty" | "malformed" | "rate-limited" | "timeout" | "error",
        message?: string
    ) {
        super(message ?? reason);
        this.name = "ClassifyError";
    }
}

export interface ClassifyInput {
    jpeg: Buffer;
}

/** ok[i] true = allowed. Must return exactly inputs.length entries. */
export type Classifier = (inputs: ClassifyInput[]) => Promise<boolean[]>;

export const MODERATION_PROMPT = `You are an image safety filter for a public anime/manga fan site.
You will receive N images, numbered from 0 in the order given.
Mark an image "ok": false if it contains ANY of: sexual activity, exposed genitals or nipples, sexualised depiction of anyone who looks under 18 (including anime/chibi characters in sexual or fetish poses), sexual fetish content, graphic gore or mutilation, real-world violent or hateful extremist imagery, or anything illegal.
Ordinary anime art, swimsuits without sexual focus, action violence without gore, and normal covers are "ok": true.
When unsure, answer false.
Reply with ONLY a JSON array of N objects: [{"i":0,"ok":true}, ...]. No prose.`;

/** Strict parser; anything off throws (fail closed). Exported for tests. */
export function parseClassification(text: string, n: number): boolean[] {
    const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    if (!trimmed) throw new ClassifyError("empty");
    let parsed: unknown;
    try {
        parsed = JSON.parse(trimmed);
    } catch {
        throw new ClassifyError("malformed");
    }
    if (!Array.isArray(parsed) || parsed.length !== n) throw new ClassifyError("malformed");
    const out: (boolean | null)[] = Array(n).fill(null);
    for (const entry of parsed) {
        const e = entry as { i?: unknown; ok?: unknown };
        if (typeof e?.i !== "number" || !Number.isInteger(e.i) || e.i < 0 || e.i >= n) throw new ClassifyError("malformed");
        if (typeof e.ok !== "boolean" || out[e.i] !== null) throw new ClassifyError("malformed");
        out[e.i] = e.ok;
    }
    if (out.some((v) => v === null)) throw new ClassifyError("malformed");
    return out as boolean[];
}

export const MODERATION_TIMEOUT_MS = 12_000;

export const geminiClassifier: Classifier = async (inputs) => {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
        warnIfNoGeminiKey();
        throw new ClassifyError("no-key");
    }
    const model = new GoogleGenerativeAI(key).getGenerativeModel({
        model: process.env.MODERATION_MODEL || "gemini-2.5-flash-lite",
        generationConfig: { temperature: 0, responseMimeType: "application/json" },
    });
    const parts = [
        { text: `${MODERATION_PROMPT}\nN = ${inputs.length}` },
        ...inputs.map((x) => ({ inlineData: { mimeType: "image/jpeg", data: x.jpeg.toString("base64") } })),
    ];
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        const result = await Promise.race([
            model.generateContent(parts),
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new ClassifyError("timeout")), MODERATION_TIMEOUT_MS);
            }),
        ]);
        const response = result.response;
        if (response.promptFeedback?.blockReason) throw new ClassifyError("safety");
        const candidate = response.candidates?.[0];
        if (!candidate) throw new ClassifyError("empty");
        if (candidate.finishReason && candidate.finishReason !== "STOP") {
            throw new ClassifyError(String(candidate.finishReason).includes("SAFETY") ? "safety" : "malformed");
        }
        return parseClassification(response.text(), inputs.length);
    } catch (e) {
        if (e instanceof ClassifyError) throw e;
        const msg = e instanceof Error ? e.message : String(e);
        if (/429|quota|rate/i.test(msg)) throw new ClassifyError("rate-limited", msg);
        throw new ClassifyError("error", msg);
    } finally {
        if (timer) clearTimeout(timer);
    }
};
