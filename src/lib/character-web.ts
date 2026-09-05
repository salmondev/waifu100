import { withRedis } from "@/lib/redis";
import { matchKey, normalizeName } from "@/lib/character-match";
import { usableSeriesHint } from "@/lib/anilist-character";
import { getFlashModel } from "@/lib/gemini";
import { assertUpstreamUp, reportUpstreamStatus } from "@/lib/upstream-health";

/**
 * The answer for characters AniList does not have.
 *
 * AniList indexes anime and manga. A large part of these grids is neither:
 * Genshin, Honkai, Blue Archive, Arknights, Nikke, Fate/Grand Order servants
 * with no anime, VTubers, idol franchises. Asking it about them returns either
 * nothing or - worse - a same-named character from an unrelated show, which is
 * exactly the confident-and-wrong card this app has been getting.
 *
 * So when AniList cannot answer, the web can: Serper retrieves, Gemini writes
 * the two paragraphs from what was retrieved, and nothing else is invented. The
 * grounding is the point - a model asked "who is Kokomi" from memory will
 * happily produce a fluent description of the wrong Kokomi, which is the
 * failure mode this whole path exists to avoid.
 *
 * It is not on the fast path. A card renders from AniList (or as "not found")
 * and this runs afterwards, exactly like the Thai translation does, because a
 * search plus a generation is seconds and the card must not wait for it.
 *
 * Both budgets are real: Serper credit has run out here before, and Gemini is
 * metered. Hence the rate limit on the route, and hence caching the misses too.
 */

const SERPER_URL = "https://google.serper.dev/search";

/** Name this service goes by in the circuit breaker. */
const SERPER = "serper";

const HIT_TTL_SEC = 60 * 60 * 24 * 180;
const MISS_TTL_SEC = 60 * 60 * 24 * 14;

export interface WebProfile {
    /** What the character is from, as the sources name it. */
    series: string | null;
    /** A few sentences in English, drawn only from the search results. */
    description: string | null;
    /** The same, in Thai. Written in the same call so it costs one, not two. */
    th: string | null;
    /** Which sites it came from, for the card's attribution line. */
    sources: string[];
}

/** Cached as "asked the web, and the web had nothing useful either". */
const NOTHING: WebProfile = { series: null, description: null, th: null, sources: [] };

function cacheKey(name: string, source: string | null | undefined): string {
    const hint = usableSeriesHint(source) ? normalizeName(source).sort().join(" ") : "";
    return `waifu100:cweb:v1:${matchKey(name)}|${hint}`;
}

/* -------------------------------------------------------------------------- */
/* Retrieval                                                                   */
/* -------------------------------------------------------------------------- */

interface SerperOrganic {
    title?: string;
    link?: string;
    snippet?: string;
}

interface SerperSearchResponse {
    knowledgeGraph?: {
        title?: string;
        type?: string;
        description?: string;
        attributes?: Record<string, string>;
    };
    organic?: SerperOrganic[];
}

interface Passage {
    title: string;
    site: string;
    text: string;
}

function siteOf(link: string | undefined): string {
    if (!link) return "";
    try {
        return new URL(link).hostname.replace(/^www\./, "");
    } catch {
        return "";
    }
}

/**
 * What to ask Google.
 *
 * The series goes in the query when the grid knows it, which is what makes this
 * better than AniList rather than differently wrong: "Kokomi Genshin Impact"
 * has one answer, "Kokomi" has several.
 */
function buildQuery(name: string, source: string | null | undefined): string {
    const hint = usableSeriesHint(source) ? ` ${source.trim()}` : "";
    return `"${name.trim()}"${hint} character wiki`;
}

async function retrieve(name: string, source: string | null | undefined): Promise<Passage[]> {
    const key = process.env.SERPER_API_KEY;
    if (!key) return [];

    // An exhausted Serper quota answers every call the same way, and this is
    // the budget that has actually run out here before.
    assertUpstreamUp(SERPER);

    const res = await fetch(SERPER_URL, {
        method: "POST",
        headers: { "X-API-KEY": key, "Content-Type": "application/json" },
        body: JSON.stringify({ q: buildQuery(name, source), num: 8 }),
        signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
        reportUpstreamStatus(SERPER, res.status);
        throw new Error(`Serper ${res.status}`);
    }

    const body = (await res.json()) as SerperSearchResponse;
    const passages: Passage[] = [];

    // Google's own summary when it has one; it is usually the cleanest sentence
    // about the character on the page.
    const graph = body.knowledgeGraph;
    if (graph?.description) {
        const attributes = Object.entries(graph.attributes ?? {})
            .slice(0, 6)
            .map(([k, v]) => `${k}: ${v}`)
            .join("; ");
        passages.push({
            title: graph.title || name,
            site: "Google",
            text: [graph.description, attributes].filter(Boolean).join(" "),
        });
    }

    for (const result of body.organic ?? []) {
        if (!result.snippet) continue;
        passages.push({
            title: result.title ?? "",
            site: siteOf(result.link),
            text: result.snippet,
        });
        if (passages.length >= 7) break;
    }

    return passages;
}

/* -------------------------------------------------------------------------- */
/* Writing                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Gemini is given the passages and told twice, in different words, that it may
 * not use anything else. The instruction that matters most is the refusal: a
 * model that cannot tell which character these snippets are about must say so,
 * because the alternative is a fluent paragraph about somebody else - and this
 * path exists precisely because that has been happening.
 */
function buildPrompt(name: string, source: string | null | undefined, passages: Passage[]): string {
    const evidence = passages
        .map((p, i) => `[${i + 1}] ${p.site}${p.title ? ` — ${p.title}` : ""}\n${p.text}`)
        .join("\n\n");

    return `You are writing one short profile of a fictional character, using ONLY the search results below.

Character name as the user typed it: ${name}
${usableSeriesHint(source) ? `The user says they are from: ${source.trim()}` : "The user did not say what they are from."}

SEARCH RESULTS
${evidence}
END OF SEARCH RESULTS

Rules:
- Use ONLY facts stated in the search results. You may not use anything you know from elsewhere, and you may not guess.
- If the results are about several different characters who share this name, or you cannot tell which one they describe, set "found" to false. Do not pick one to be helpful.
- If the results are clearly about a real person, a product, or anything that is not a fictional character, set "found" to false.
- "series" is the work they are from - a game, anime, manga, VTuber agency or franchise - exactly as the results name it.
- "en" is 2-4 plain sentences: who they are, their role in that work, and what they are known for. No spoilers about how a story ends. No marketing language.
- "th" is the same content in natural Thai, the way a Thai fan who knows this character would write it. Same facts, same length or shorter. Keep proper nouns in their original spelling. No emoji, no exclamation marks, do not address the reader.

Reply with ONLY this JSON object and nothing else:
{"found": true|false, "series": "...", "en": "...", "th": "..."}`;
}

/** Gemini is told to return bare JSON; models add fences anyway. */
function parseJson(raw: string): { found?: boolean; series?: string; en?: string; th?: string } | null {
    const text = raw.replace(/```(?:json)?/gi, "").trim();
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
        return JSON.parse(text.slice(start, end + 1));
    } catch {
        return null;
    }
}

/* -------------------------------------------------------------------------- */
/* The lookup                                                                  */
/* -------------------------------------------------------------------------- */

/** The cached web profile, or undefined when nobody has asked yet. */
export async function readWebProfile(
    name: string,
    source: string | null | undefined
): Promise<WebProfile | undefined> {
    try {
        const raw = await withRedis((redis) => redis.get(cacheKey(name, source)));
        if (!raw) return undefined;
        return JSON.parse(raw) as WebProfile;
    } catch (e) {
        console.error("Web profile cache read failed:", e);
        return undefined;
    }
}

async function write(name: string, source: string | null | undefined, profile: WebProfile) {
    try {
        await withRedis((redis) =>
            redis.set(
                cacheKey(name, source),
                JSON.stringify(profile),
                "EX",
                profile.description ? HIT_TTL_SEC : MISS_TTL_SEC
            )
        );
    } catch (e) {
        console.error("Web profile cache write failed:", e);
    }
}

/**
 * Searches the web for one character and writes up what it finds. Never throws;
 * every failure is "nothing found", which the card already knows how to show.
 */
export async function researchCharacter(
    name: string,
    source: string | null | undefined
): Promise<WebProfile> {
    if (!matchKey(name)) return NOTHING;

    const cached = await readWebProfile(name, source);
    if (cached) return cached;

    if (!process.env.SERPER_API_KEY || !process.env.GEMINI_API_KEY) return NOTHING;

    let passages: Passage[] = [];
    try {
        passages = await retrieve(name, source);
    } catch (e) {
        console.error("Serper lookup failed:", e instanceof Error ? e.message : e);
        // Uncached: a Serper outage or an exhausted quota must not pin this
        // character to "nothing found" for a fortnight.
        return NOTHING;
    }

    // Two snippets is not enough to tell one Sakura from another.
    if (passages.length < 2) {
        await write(name, source, NOTHING);
        return NOTHING;
    }

    let answer: ReturnType<typeof parseJson> = null;
    try {
        const result = await getFlashModel().generateContent(buildPrompt(name, source, passages));
        answer = parseJson((await result.response).text());
    } catch (e) {
        console.error("Web profile generation failed:", e instanceof Error ? e.message : e);
        return NOTHING;
    }

    if (!answer?.found || !answer.en?.trim()) {
        // A refusal is a real answer and worth remembering: it means the name is
        // ambiguous or unindexed, and it will still be next month.
        await write(name, source, NOTHING);
        return NOTHING;
    }

    const profile: WebProfile = {
        series: answer.series?.trim() || null,
        description: answer.en.trim(),
        th: answer.th?.trim() || null,
        sources: [...new Set(passages.map((p) => p.site).filter(Boolean))].slice(0, 3),
    };

    await write(name, source, profile);
    return profile;
}
