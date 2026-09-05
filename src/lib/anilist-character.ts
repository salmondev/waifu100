import { matchKey, normalizeName } from "@/lib/character-match";

/**
 * Deciding *which* character AniList just handed back.
 *
 * The lookups here used to take `Page(perPage: 1)` - AniList's single top hit
 * for a fuzzy search - and accept it if the names agreed. That is wrong in the
 * one case that matters most: a name shared by several characters. "Rin",
 * "Sakura", "Miku", "Asuka", "Yuki" belong to a dozen characters each, the
 * names agree perfectly, and the search ranks by its own relevance rather than
 * by which one is in this grid. The result was a confident, completely wrong
 * card - a worse failure than no card at all, because nothing on it looks
 * uncertain.
 *
 * So: ask for several candidates and choose deliberately.
 *
 * - The name has to actually match, and a bare mononym ("Miku") is no longer
 *   allowed to match a longer name ("Miku Nakano") on its own.
 * - What the grid says the character is from decides between same-name
 *   candidates. That hint was sitting on the cell all along and was never sent.
 * - With no hint and several candidates left, the most popular one is a guess,
 *   and it says so: `confidence: "low"` plus the runners-up, so the card can
 *   admit the ambiguity and let the reader pick the right one instead of
 *   asserting the wrong one.
 *
 * Nothing here is a per-character fix; the scoring is the whole mechanism.
 */

export const ANILIST_URL = "https://graphql.anilist.co";

export interface AniListMediaEdge {
    characterRole?: string | null;
    node?: {
        title?: { english?: string | null; romaji?: string | null; native?: string | null } | null;
    } | null;
}

export interface AniListCandidate {
    id?: number | null;
    name?: {
        full?: string | null;
        native?: string | null;
        alternative?: (string | null)[] | null;
    } | null;
    image?: { large?: string | null; medium?: string | null } | null;
    description?: string | null;
    favourites?: number | null;
    media?: { edges?: AniListMediaEdge[] | null } | null;
}

/** How sure we are that this is the character the grid meant. */
export type MatchConfidence = "high" | "low";

export interface ScoredCandidate {
    candidate: AniListCandidate;
    /** The series that decided it, or the character's best-known one. */
    series: string | null;
    score: number;
    nameScore: number;
    seriesScore: number;
}

export interface CharacterMatch {
    best: ScoredCandidate;
    confidence: MatchConfidence;
    /**
     * Other characters with the same name, best first. Empty when the choice
     * was not a choice - which is the common case and the reassuring one.
     */
    alternatives: ScoredCandidate[];
}

/** The fields every lookup needs. Kept in one place so scoring can rely on them. */
const CANDIDATE_FIELDS = `
    id
    name { full native alternative }
    favourites
    media(sort: POPULARITY_DESC, perPage: 6) {
        edges { characterRole node { title { english romaji native } } }
    }`;

/** The profile card also needs a portrait and a blurb; the series chart doesn't. */
const PROFILE_FIELDS = `${CANDIDATE_FIELDS}
    image { large medium }
    description(asHtml: false)`;

export function candidateFields(withProfile: boolean): string {
    return withProfile ? PROFILE_FIELDS : CANDIDATE_FIELDS;
}

/** How many same-name characters one search considers. */
export const CANDIDATES_PER_NAME = 8;

/* -------------------------------------------------------------------------- */
/* Scoring                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Every title a media entry is known by. English and romaji disagree constantly
 * ("Attack on Titan" / "Shingeki no Kyojin"), and a grid may store either.
 */
function titlesOf(edge: AniListMediaEdge): string[] {
    const title = edge?.node?.title;
    return [title?.english, title?.romaji, title?.native].filter(
        (t): t is string => !!t && t.trim().length > 0
    );
}

function tokenSet(value: string): Set<string> {
    return new Set(normalizeName(value));
}

/**
 * How well a stored source agrees with a series title, 0-4.
 *
 * Only containment counts. A looser rule - "share any word" - would file every
 * "... no Monogatari" under every other one, which is the same class of false
 * confidence this module exists to remove.
 */
function titleAgreement(hint: Set<string>, title: string): number {
    const found = tokenSet(title);
    if (hint.size === 0 || found.size === 0) return 0;

    const [small, large] = hint.size <= found.size ? [hint, found] : [found, hint];
    let shared = 0;
    for (const token of small) if (large.has(token)) shared += 1;
    if (shared === 0) return 0;

    if (shared === small.size) {
        // Same title, or one is the other plus a season/subtitle.
        return small.size === large.size ? 4 : 3;
    }
    // Most of a title, e.g. "Fate/stay night" against "Fate/stay night: UBW".
    return shared / small.size >= 0.7 ? 2 : 0;
}

/**
 * How well the name matches, 0-3.
 *
 * 3 - the same name, token order ignored ("Hatsune Miku" / "Miku Hatsune").
 * 2 - every token of the query appears in a longer name, and the query had more
 *     than one token to go on.
 * 1 - a single-token query found inside a longer name. This is the mononym
 *     case, and on its own it is not evidence: "Miku" is inside "Miku Nakano",
 *     "Miku Izayoi" and "Hatsune Miku" alike. Accepted only when the series
 *     agrees - see `pickCharacter`.
 * 0 - not this character.
 */
function nameScore(query: string, candidate: AniListCandidate): number {
    const wanted = matchKey(query);
    if (!wanted) return 0;
    const wantedTokens = wanted.split(" ");

    const names = [
        candidate.name?.full,
        candidate.name?.native,
        ...(candidate.name?.alternative ?? []),
    ];

    let best = 0;
    for (const name of names) {
        if (!name) continue;
        const key = matchKey(name);
        if (!key) continue;
        if (key === wanted) return 3;

        const found = new Set(key.split(" "));
        if (!wantedTokens.every((token) => found.has(token))) continue;
        best = Math.max(best, wantedTokens.length >= 2 ? 2 : 1);
    }
    return best;
}

/**
 * The series a character is best known for.
 *
 * A main role wins over a more popular cameo: sorting by popularity alone filed
 * Hatsune Miku under a Sayonara Zetsubou-Sensei episode she appears in.
 */
export function bestKnownSeries(candidate: AniListCandidate): string | null {
    const edges = candidate.media?.edges ?? [];
    const edge = edges.find((e) => e?.characterRole === "MAIN") ?? edges[0];
    const titles = edge ? titlesOf(edge) : [];
    return titles[0]?.trim() || null;
}

/** True when the stored source is a series title rather than "Uploaded". */
export function usableSeriesHint(source: string | null | undefined): source is string {
    if (!source) return false;
    const value = source.trim().toLowerCase();
    if (!value || value.length < 2) return false;
    // Where the picture came from, not what the character is from. A URL is the
    // clearest case: nobody's series is called "www.pinterest.com".
    return !/^(google|official|gallery|custom|uploaded|imported|url|web search|myanimelist|anilist|shared|unknown|search|manual|other)\b/.test(
        value
    ) && !/^https?:|\.(com|net|org|jp|io)\b/.test(value);
}

/**
 * Whether a series title is the one the grid said this character is from.
 *
 * The same containment rule the scoring uses, exposed so the web fallback can
 * be held to it: a search result only gets to overrule AniList when it agrees
 * with the grid, never merely because it sounds more confident.
 */
export function agreesWithHint(
    source: string | null | undefined,
    title: string | null | undefined
): boolean {
    if (!usableSeriesHint(source) || !title) return false;
    return titleAgreement(tokenSet(source), title) >= 3;
}

function scoreCandidate(
    query: string,
    hint: Set<string>,
    candidate: AniListCandidate
): ScoredCandidate | null {
    const name = nameScore(query, candidate);
    if (name === 0) return null;

    let seriesScore = 0;
    let matchedSeries: string | null = null;
    let matchedRole: string | null = null;

    for (const edge of candidate.media?.edges ?? []) {
        for (const title of titlesOf(edge)) {
            const agreement = titleAgreement(hint, title);
            if (agreement > seriesScore) {
                seriesScore = agreement;
                matchedSeries = title.trim();
                matchedRole = edge.characterRole ?? null;
            }
        }
    }

    // Popularity breaks ties and nothing more - a hundredth of a name grade, so
    // it can never outrank actual evidence.
    const favourites = candidate.favourites ?? 0;
    const popularity = Math.min(favourites / 5000, 1);
    const role = matchedRole === "MAIN" ? 2 : 0;

    return {
        candidate,
        series: matchedSeries ?? bestKnownSeries(candidate),
        nameScore: name,
        seriesScore,
        score: name * 100 + seriesScore * 20 + role + popularity,
    };
}

/**
 * Chooses among the characters a search returned, or returns null rather than
 * guessing.
 *
 * `hint` is what the grid says the character is from - usually absent, since a
 * cell that knows its series is exactly the cell that never needed a lookup.
 * When it is there it is decisive; when it is not, the honest answer to "which
 * Rin?" is "the best known one, and here are the others".
 */
export function pickCharacter(
    query: string,
    source: string | null | undefined,
    candidates: (AniListCandidate | null | undefined)[]
): CharacterMatch | null {
    const hint = usableSeriesHint(source) ? tokenSet(source) : new Set<string>();

    const scored = candidates
        .filter((c): c is AniListCandidate => !!c)
        .map((c) => scoreCandidate(query, hint, c))
        .filter((s): s is ScoredCandidate => s !== null)
        .sort((a, b) => b.score - a.score);

    if (scored.length === 0) return null;

    const [best, ...rest] = scored;

    // Same-name rivals: candidates the name alone cannot separate from the
    // winner. A rival the series hint ruled out is not one of these.
    const rivals = rest.filter((s) => s.nameScore >= best.nameScore && s.seriesScore === 0);

    const decidedBySeries = best.seriesScore >= 3;
    /**
     * A bare mononym found inside a longer name is never evidence on its own:
     * "Miku" sits inside "Miku Nakano", "Miku Izayoi" and "Hatsune Miku"
     * alike. Refusing outright would blank the card for some of the most
     * common names in these grids, so the answer stands - as a guess, which is
     * what `low` means and what the card is required to show.
     */
    const guessing = best.nameScore < 2 || rivals.length > 0;
    const confidence: MatchConfidence = decidedBySeries || !guessing ? "high" : "low";

    return { best, confidence, alternatives: rivals.slice(0, 4) };
}

/* -------------------------------------------------------------------------- */
/* Fetching                                                                    */
/* -------------------------------------------------------------------------- */

async function askAniList<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const res = await fetch(ANILIST_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) throw new Error(`AniList ${res.status}`);
    const body = (await res.json()) as { data?: T };
    if (!body.data) throw new Error("AniList returned no data");
    return body.data;
}

/** The candidates for one name, unscored. */
export async function searchCandidates(
    name: string,
    withProfile: boolean
): Promise<AniListCandidate[]> {
    const data = await askAniList<{ Page?: { characters?: AniListCandidate[] | null } | null }>(
        `query ($search: String, $per: Int) {
            Page(perPage: $per) {
                characters(search: $search) {${candidateFields(withProfile)}}
            }
        }`,
        { search: name, per: CANDIDATES_PER_NAME }
    );
    return data.Page?.characters ?? [];
}

/**
 * One exact character, by AniList id.
 *
 * This is how "no, it's the other one" is answered: the card offers the rivals
 * by id, so choosing one is a lookup with nothing left to guess about.
 */
export async function characterById(
    id: number,
    withProfile: boolean
): Promise<AniListCandidate | null> {
    const data = await askAniList<{ Character?: AniListCandidate | null }>(
        `query ($id: Int) { Character(id: $id) {${candidateFields(withProfile)}} }`,
        { id }
    );
    return data.Character ?? null;
}
