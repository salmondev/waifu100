import { withRedis } from "@/lib/redis";
import { matchKey } from "@/lib/character-match";

/**
 * Looking up which series a character is from, by name.
 *
 * The `source` stored on a cell is only a series title when the character came
 * from a search; image picks store "Google (www.pinterest.com)" and uploads
 * store "Uploaded", which is why the breakdown could read a grid's series for
 * as little as 19 of its 100 cells. The name, though, is nearly always the
 * character's real name - so it can be asked.
 *
 * AniList answers it: no API key, no per-call cost, and one GraphQL request can
 * carry a dozen lookups as aliased fields. That matters because the alternative
 * (Gemini, which this app already pays for) would be both slower and a guess.
 *
 * Every answer - including "not found" - is cached in Redis by normalised name,
 * so a character looked up once is never looked up again, whoever's grid it
 * turns up in next.
 */

const ANILIST_URL = "https://graphql.anilist.co";

/** Series titles don't change. Misses expire sooner in case AniList adds one. */
const HIT_TTL_SEC = 60 * 60 * 24 * 365;
const MISS_TTL_SEC = 60 * 60 * 24 * 14;

/** Sentinel for "asked, and AniList had nothing" - distinct from "never asked". */
const MISS = "";

/** How many names ride along in one GraphQL request. */
const BATCH = 10;
/** Ceiling per API call, so one page cannot hold AniList (or us) for long. */
export const MAX_LOOKUPS = 60;

export function seriesCacheKey(name: string): string {
    return `waifu100:series:${matchKey(name)}`;
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
            redis.mget(...keys.map((k) => `waifu100:series:${k}`))
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
                    `waifu100:series:${key}`,
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

interface AniListEdge {
    characterRole?: string | null;
    node?: {
        title?: { romaji?: string | null; english?: string | null } | null;
    } | null;
}

interface AniListCharacter {
    name?: { full?: string | null; native?: string | null } | null;
    media?: { edges?: AniListEdge[] | null } | null;
}

/**
 * Guards against AniList's fuzzy search answering with someone else.
 *
 * Searching "Eula" returns a character called "Seul-A" from an unrelated show;
 * without this check that grid would be filed under "My Daughter". Accepting
 * only a result whose name contains every token of the query keeps the obvious
 * matches ("Hatsune Miku" -> "Miku Hatsune", token order ignored) and drops the
 * near-misses.
 */
function namesAgree(query: string, found: string | null | undefined): boolean {
    if (!found) return false;
    const queryKey = matchKey(query);
    const foundKey = matchKey(found);
    if (!queryKey || !foundKey) return false;
    if (queryKey === foundKey) return true;

    const foundTokens = new Set(foundKey.split(" "));
    return queryKey.split(" ").every((token) => foundTokens.has(token));
}

/**
 * The series a character is best known for.
 *
 * A main role wins over a more popular cameo: sorting by popularity alone filed
 * Hatsune Miku under a Sayonara Zetsubou-Sensei episode she appears in.
 */
function pickTitle(character: AniListCharacter | null | undefined): string | null {
    const edges = character?.media?.edges ?? [];
    const edge = edges.find((e) => e?.characterRole === "MAIN") ?? edges[0];
    const title = edge?.node?.title;
    const picked = title?.english || title?.romaji;
    return picked ? picked.trim() : null;
}

function buildQuery(names: string[]): string {
    const fields = names
        .map(
            (name, i) =>
                `q${i}: Page(perPage: 1) { characters(search: ${JSON.stringify(
                    name
                )}) { name { full native } media(sort: POPULARITY_DESC, perPage: 6) { edges { characterRole node { title { english romaji } } } } } }`
        )
        .join("\n");
    return `query {\n${fields}\n}`;
}

async function askAniList(names: string[]): Promise<Record<string, string>> {
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
        data?: Record<string, { characters?: AniListCharacter[] | null } | null>;
    };

    const found: Record<string, string> = {};
    names.forEach((name, i) => {
        const key = matchKey(name);
        if (!key) return;
        const character = body.data?.[`q${i}`]?.characters?.[0];
        const agrees =
            namesAgree(name, character?.name?.full) ||
            namesAgree(name, character?.name?.native);
        found[key] = agrees ? pickTitle(character) ?? MISS : MISS;
    });
    return found;
}

/**
 * Resolves names that have no cached answer yet, writing what it learns.
 *
 * Returns the same shape as the cache read: normalised name -> series (or the
 * empty string for "AniList doesn't know this one").
 */
export async function resolveSeries(names: string[]): Promise<Record<string, string>> {
    const unique: string[] = [];
    const seen = new Set<string>();
    for (const name of names) {
        const key = matchKey(name);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        unique.push(name);
        if (unique.length >= MAX_LOOKUPS) break;
    }
    if (unique.length === 0) return {};

    const resolved: Record<string, string> = {};

    // Sequential batches on purpose: AniList's limit is per minute and shared by
    // everyone using it, and a page that resolves slightly slower is much better
    // than one that gets the whole app rate-limited.
    for (let i = 0; i < unique.length; i += BATCH) {
        const slice = unique.slice(i, i + BATCH);
        try {
            Object.assign(resolved, await askAniList(slice));
        } catch (e) {
            console.error("AniList lookup failed:", e instanceof Error ? e.message : e);
            break;
        }
    }

    await writeCachedSeries(resolved);
    return resolved;
}
