import { withRedis } from "@/lib/redis";
import { matchKey, normalizeName } from "@/lib/character-match";
import {
    ANILIST_URL,
    CANDIDATES_PER_NAME,
    candidateFields,
    pickCharacter,
    type AniListCandidate,
} from "@/lib/anilist-character";

/**
 * Looking up which series a character is from, by name.
 *
 * The `source` stored on a cell is only a series title when the character came
 * from a search; image picks store "Google (www.pinterest.com)" and uploads
 * store "Uploaded", which is why the breakdown could read a grid's series for
 * as little as 19 of its 100 cells. The name, though, is nearly always the
 * character's real name - so it can be asked.
 *
 * The hard part is that a name is not an identity. "Rin", "Sakura" and "Miku"
 * belong to a dozen characters each, and taking AniList's top search hit filed
 * them under whichever series that character happened to be most famous in -
 * silently, and then for a year, because the answer was cached under the bare
 * name. Two things changed:
 *
 * - Candidates are scored rather than taken (see anilist-character.ts), using
 *   the series already known from the *rest of the same grid* as context. A
 *   grid with thirty Fate characters in it is very good evidence about which
 *   Rin this is - and unlike the cell's own source, that evidence exists
 *   exactly when it is needed, since a cell that knows its own series is never
 *   looked up at all.
 * - Only an unambiguous answer is written to Redis. A guess that depended on
 *   one grid's context must never become every grid's cached answer; that is
 *   the bug this whole file used to have, and no amount of better scoring would
 *   have saved it.
 */

export { ANILIST_URL };

/** Series titles don't change. Misses expire sooner in case AniList adds one. */
const HIT_TTL_SEC = 60 * 60 * 24 * 365;
const MISS_TTL_SEC = 60 * 60 * 24 * 14;

/** Sentinel for "asked, and AniList had nothing" - distinct from "never asked". */
const MISS = "";

/**
 * Bumped past everything the name-only matcher wrote. Those entries are wrong
 * in a way nothing downstream can detect, so they are abandoned rather than
 * trusted; scripts/prune-cache.mjs deletes them.
 */
const KEY_PREFIX = "waifu100:series:v2:";

/**
 * How many names ride along in one GraphQL request. Lower than it was: each
 * name now brings back several candidates to choose between.
 */
const BATCH = 6;
/** Ceiling per API call, so one page cannot hold AniList (or us) for long. */
export const MAX_LOOKUPS = 60;

export function seriesCacheKey(name: string): string {
    return `${KEY_PREFIX}${matchKey(name)}`;
}

/**
 * Cached answers for these names: name -> series, or null when never asked.
 * Never throws - an unreachable Redis just means nothing is known yet.
 */
export async function readCachedSeries(
    names: string[]
): Promise<Record<string, string | null>> {
    const out: Record<string, string | null> = {};
    const keys = [...new Set(names.map((n) => matchKey(n)).filter(Boolean))];
    if (keys.length === 0) return out;

    try {
        const values = await withRedis((redis) =>
            redis.mget(...keys.map((k) => `${KEY_PREFIX}${k}`))
        );
        keys.forEach((key, i) => {
            const value = values?.[i];
            out[key] = value === null || value === undefined ? null : value;
        });
    } catch (e) {
        console.error("Series cache read failed:", e);
    }
    return out;
}

async function writeCachedSeries(entries: Record<string, string>): Promise<void> {
    const pairs = Object.entries(entries);
    if (pairs.length === 0) return;
    try {
        await withRedis((redis) => {
            const tx = redis.multi();
            pairs.forEach(([key, value]) => {
                tx.set(
                    `${KEY_PREFIX}${key}`,
                    value,
                    "EX",
                    value === MISS ? MISS_TTL_SEC : HIT_TTL_SEC
                );
            });
            return tx.exec();
        });
    } catch (e) {
        console.error("Series cache write failed:", e);
    }
}

function buildQuery(names: string[]): string {
    const fields = names
        .map(
            (name, i) =>
                `q${i}: Page(perPage: ${CANDIDATES_PER_NAME}) { characters(search: ${JSON.stringify(
                    name
                )}) {${candidateFields(false)}} }`
        )
        .join("\n");
    return `query {\n${fields}\n}`;
}

interface Resolved {
    /** Safe to cache and share: nothing about this depended on one grid. */
    certain: Record<string, string>;
    /** Good enough for this page, wrong to store. */
    contextual: Record<string, string>;
}

async function askAniList(names: string[], context: string[]): Promise<Resolved> {
    const res = await fetch(ANILIST_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query: buildQuery(names) }),
        signal: AbortSignal.timeout(9000),
    });

    if (!res.ok) {
        // 429 included: back off by simply returning nothing. The names stay
        // uncached, so the next visitor asks again rather than us storing a
        // wrong answer.
        throw new Error(`AniList ${res.status}`);
    }

    const body = (await res.json()) as {
        data?: Record<string, { characters?: AniListCandidate[] | null } | null>;
    };

    const certain: Record<string, string> = {};
    const contextual: Record<string, string> = {};

    names.forEach((name, i) => {
        const key = matchKey(name);
        if (!key) return;

        const candidates = body.data?.[`q${i}`]?.characters ?? [];

        // The grid's other series, tried one at a time: the first that picks a
        // candidate out of the crowd is the one that explains this character.
        for (const hint of context) {
            const guided = pickCharacter(name, hint, candidates);
            if (guided && guided.best.seriesScore >= 3) {
                contextual[key] = guided.best.series ?? MISS;
                return;
            }
        }

        const match = pickCharacter(name, null, candidates);
        if (!match) {
            certain[key] = MISS;
            return;
        }

        const series = match.best.series ?? MISS;
        // Ambiguous means "several characters answer to this name and nothing
        // here chose between them". The chart can live with the best guess; the
        // shared cache cannot.
        if (match.confidence === "high") certain[key] = series;
        else contextual[key] = series;
    });

    return { certain, contextual };
}

/**
 * Resolves names that have no cached answer yet, writing what it learns.
 *
 * `context` is the series already known for this grid - pass it, and ambiguous
 * names get resolved by the company they keep. Returns the same shape as the
 * cache read: normalised name -> series (or the empty string for "AniList
 * doesn't know this one").
 */
export interface ResolveResult {
    /** Normalised name -> series, or "" for "asked, and nobody knows". */
    series: Record<string, string>;
    /**
     * The lookup could not be made at all - AniList has been known to answer
     * 403 across the board for hours. An empty result then means "we could not
     * ask", which is a different thing from "these characters have no series",
     * and the chart is required to say so rather than draw the second.
     */
    upstreamFailed: boolean;
}

export async function resolveSeries(
    names: string[],
    context: string[] = []
): Promise<ResolveResult> {
    const unique: string[] = [];
    const seen = new Set<string>();
    for (const name of names) {
        const key = matchKey(name);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        unique.push(name);
        if (unique.length >= MAX_LOOKUPS) break;
    }
    if (unique.length === 0) return { series: {}, upstreamFailed: false };

    // Distinct titles only, and a bounded number of them: this list is tried
    // per name, and a grid of a hundred different shows would turn one lookup
    // into a hundred comparisons for no gain.
    const hints = [...new Map(context
        .filter((t) => t && t.trim().length > 1)
        .map((t) => [normalizeName(t).sort().join(" "), t.trim()])
    ).values()].slice(0, 25);

    const resolved: Record<string, string> = {};
    const cacheable: Record<string, string> = {};
    let upstreamFailed = false;

    // Sequential batches on purpose: AniList's limit is per minute and shared by
    // everyone using it, and a page that resolves slightly slower is much better
    // than one that gets the whole app rate-limited.
    for (let i = 0; i < unique.length; i += BATCH) {
        const slice = unique.slice(i, i + BATCH);
        try {
            const { certain, contextual } = await askAniList(slice, hints);
            Object.assign(resolved, certain, contextual);
            Object.assign(cacheable, certain);
        } catch (e) {
            console.error("AniList lookup failed:", e instanceof Error ? e.message : e);
            upstreamFailed = true;
            break;
        }
    }

    await writeCachedSeries(cacheable);
    return { series: resolved, upstreamFailed };
}
