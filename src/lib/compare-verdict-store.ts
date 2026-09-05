import { withRedis } from "@/lib/redis";
import { AnalysisResult } from "@/types";

/**
 * Where a pair's AI verdict is kept.
 *
 * Split out of the API route because the compare page reads the same entry: a
 * verdict that already exists is rendered with the page, so the common case
 * costs no request at all and nobody watches a spinner for something that was
 * computed days ago.
 */

/**
 * Redis key for a pair, with the ids sorted.
 *
 * Sorting is the whole point: a comparison is symmetric, so `?a=x&b=y` and
 * `?a=y&b=x` must hit the same entry. Without it the same pair would pay for
 * two Gemini calls, and the two pages would disagree about the verdict.
 */
export function comparePairKey(idA: string, idB: string): string {
    const [lo, hi] = [idA, idB].sort();
    return `waifu100:compare:${lo}:${hi}`;
}

// Neither grid can change after it is shared, so a pair's verdict is stable -
// the TTL only stops dead pairs accumulating forever. Long, because the page
// now generates on sight: a short TTL would quietly re-buy the same verdict.
export const CACHE_TTL_SEC = 60 * 60 * 24 * 180;

export interface CachedVerdict {
    verdict: AnalysisResult;
    createdAt: string;
}

export function isVerdictShaped(value: unknown): value is AnalysisResult {
    const v = value as AnalysisResult | null;
    return !!v && !!v.en?.title && !!v.en?.content && !!v.th?.title && !!v.th?.content;
}

/** The stored verdict for a pair, or null. Never throws. */
export async function readCachedVerdict(
    idA: string,
    idB: string
): Promise<AnalysisResult | null> {
    try {
        const raw = await withRedis((redis) => redis.get(comparePairKey(idA, idB)));
        if (!raw) return null;
        const parsed: CachedVerdict = JSON.parse(raw);
        return isVerdictShaped(parsed.verdict) ? parsed.verdict : null;
    } catch {
        // A malformed entry, or Redis being unreachable, just means "not cached".
        return null;
    }
}

/** Stores a verdict. A failed write must never lose one already paid for. */
export async function writeCachedVerdict(
    idA: string,
    idB: string,
    verdict: AnalysisResult
): Promise<void> {
    const payload: CachedVerdict = { verdict, createdAt: new Date().toISOString() };
    try {
        await withRedis((redis) =>
            redis.set(comparePairKey(idA, idB), JSON.stringify(payload), "EX", CACHE_TTL_SEC)
        );
    } catch (e) {
        console.error("Compare verdict cache write failed:", e);
    }
}
