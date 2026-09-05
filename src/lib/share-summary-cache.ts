import { withRedis } from "@/lib/redis";
import { summarizeShare, type ShareSummary } from "@/lib/share-summary";

/**
 * The card-sized view of a share, kept beside the share instead of recomputed.
 *
 * Listing a page of the showcase used to mean fetching the full payload of
 * every grid on it - a hundred cells with image URLs each, tens of kilobytes
 * per grid - across the wire from Redis, only to count the filled cells and
 * throw the rest away. Fifty of those is megabytes of traffic and JSON parsing
 * per page view, and it was the single slowest thing on the page.
 *
 * So the summary is stored once, in one hash, and read back with a single
 * HMGET. The whole hash is a couple of hundred bytes per grid: on a 30 MB
 * instance where the payloads themselves are the thing that fills the disk,
 * this is rounding error, and it removes the payloads from the read path
 * entirely.
 *
 * A miss is not an error - the hash is a cache, and any share written before it
 * existed simply gets summarised on first read and backfilled. That also means
 * it never needs a migration.
 */

/** Bumped when ShareSummary's shape changes, so stale entries are ignored. */
const SUMMARY_HASH = "waifu100:summaries:v1";

/** Marks a share that exists but must not be listed (see summarizeShare). */
const EXCLUDED = "-";

function encode(summary: ShareSummary | null): string {
    return summary ? JSON.stringify(summary) : EXCLUDED;
}

function decode(raw: string | null): ShareSummary | null | undefined {
    if (raw === null) return undefined; // not cached
    if (raw === EXCLUDED) return null; // cached "do not list"
    try {
        return JSON.parse(raw) as ShareSummary;
    } catch {
        return undefined;
    }
}

/** Records the summary for a share as it is written. Never throws. */
export async function cacheSummary(id: string, rawJson: string): Promise<void> {
    try {
        await withRedis((redis) =>
            redis.hset(SUMMARY_HASH, id, encode(summarizeShare(id, rawJson)))
        );
    } catch (e) {
        console.error("Summary cache write failed:", e);
    }
}

/** Forgets a deleted share. Never throws - a stray entry is harmless. */
export async function dropSummary(id: string): Promise<void> {
    try {
        await withRedis((redis) => redis.hdel(SUMMARY_HASH, id));
    } catch (e) {
        console.error("Summary cache delete failed:", e);
    }
}

export interface SummaryPage {
    /** Listable summaries, in the order the ids were given. */
    grids: ShareSummary[];
    /** Ids whose payload is gone - the caller may want to prune its index. */
    missing: string[];
}

/**
 * Summaries for a page of share ids: one HMGET, plus one pipelined GET for
 * whatever was not cached yet.
 */
export async function summariesFor(ids: string[]): Promise<SummaryPage> {
    if (ids.length === 0) return { grids: [], missing: [] };

    let cached: (string | null)[] = ids.map(() => null);
    try {
        cached = await withRedis((redis) => redis.hmget(SUMMARY_HASH, ...ids));
    } catch (e) {
        console.error("Summary cache read failed:", e);
    }

    const summaries = new Map<string, ShareSummary | null>();
    const cold: string[] = [];

    ids.forEach((id, i) => {
        const hit = decode(cached[i] ?? null);
        if (hit === undefined) cold.push(id);
        else summaries.set(id, hit);
    });

    const missing: string[] = [];

    if (cold.length > 0) {
        const results = await withRedis((redis) => {
            const pipeline = redis.pipeline();
            cold.forEach((id) => pipeline.get(`waifu100:share:${id}`));
            return pipeline.exec();
        });

        const backfill: [string, string][] = [];

        cold.forEach((id, i) => {
            const entry = results?.[i];
            const [err, data] = entry ?? [new Error("no result"), null];
            if (err) {
                summaries.set(id, null);
                return;
            }
            if (!data) {
                // The index points at a payload that is gone; nothing to cache.
                missing.push(id);
                summaries.set(id, null);
                return;
            }
            const summary = summarizeShare(id, data as string);
            summaries.set(id, summary);
            backfill.push([id, encode(summary)]);
        });

        if (backfill.length > 0) {
            try {
                await withRedis((redis) => redis.hset(SUMMARY_HASH, Object.fromEntries(backfill)));
            } catch (e) {
                console.error("Summary cache backfill failed:", e);
            }
        }
    }

    const grids = ids
        .map((id) => summaries.get(id) ?? null)
        .filter((g): g is ShareSummary => g !== null);

    return { grids, missing };
}
