import { withRedis } from "@/lib/redis";
import { matchKey } from "@/lib/character-match";
import { ANILIST_URL, namesAgree, pickTitle, type AniListCharacter } from "@/lib/series-resolve";
import { getFlashModel } from "@/lib/gemini";

/**
 * One character's card: who they are, what they are from, a few lines about
 * them.
 *
 * Same source and the same caching rules as the series lookup next door - the
 * profile is just a richer answer to the same question, so it reuses the name
 * check that keeps "Eula" from coming back as an unrelated "Seul-A".
 *
 * A miss is cached too. Plenty of grids are full of VTubers and original art
 * that AniList has never heard of, and re-asking on every tap would spend the
 * shared rate limit on answers that will not change.
 */

export interface CharacterProfile {
    /** As AniList spells it, which is often nicer than the grid's spelling. */
    name: string | null;
    series: string | null;
    /** AniList's portrait, when there is one - never replaces the grid's image. */
    image: string | null;
    /** A few sentences, cleaned of AniList's markup and spoiler blocks. */
    description: string | null;
    /** True when AniList had nothing; the modal says so rather than sitting empty. */
    unknown: boolean;
}

const HIT_TTL_SEC = 60 * 60 * 24 * 180;
const MISS_TTL_SEC = 60 * 60 * 24 * 14;

const EMPTY: CharacterProfile = {
    name: null,
    series: null,
    image: null,
    description: null,
    unknown: true,
};

function cacheKey(name: string): string {
    return `waifu100:profile:${matchKey(name)}`;
}

/**
 * AniList descriptions are wiki text: `__bold__`, `~!spoilers!~`, HTML breaks,
 * and stat lines like "Age: 17". Spoilers go entirely - someone browsing a grid
 * of favourites did not ask to be told how a story ends.
 */
function cleanDescription(raw: string | null | undefined): string | null {
    if (!raw) return null;

    const text = raw
        .replace(/~!([\s\S]*?)!~/g, " ")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/__(.*?)__/g, "$1")
        .replace(/\*\*(.*?)\*\*/g, "$1")
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .replace(/[ \t]+/g, " ")
        .replace(/\n{2,}/g, "\n")
        .trim();

    if (!text) return null;

    const MAX = 420;
    if (text.length <= MAX) return text;

    // Cut on a sentence if there is one nearby, so it does not end mid-word.
    const cut = text.slice(0, MAX);
    const stop = Math.max(cut.lastIndexOf("."), cut.lastIndexOf("。"), cut.lastIndexOf("!"));
    return (stop > MAX * 0.5 ? cut.slice(0, stop + 1) : cut.trimEnd() + "…").trim();
}

const QUERY = `query ($search: String) {
  Page(perPage: 1) {
    characters(search: $search) {
      name { full native }
      image { large medium }
      description(asHtml: false)
      media(sort: POPULARITY_DESC, perPage: 6) {
        edges { characterRole node { title { english romaji } } }
      }
    }
  }
}`;

interface FullCharacter extends AniListCharacter {
    image?: { large?: string | null; medium?: string | null } | null;
    description?: string | null;
}

async function askAniList(name: string): Promise<CharacterProfile> {
    const res = await fetch(ANILIST_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query: QUERY, variables: { search: name } }),
        signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) throw new Error(`AniList ${res.status}`);

    const body = (await res.json()) as {
        data?: { Page?: { characters?: FullCharacter[] | null } | null } | null;
    };
    const character = body.data?.Page?.characters?.[0];

    const agrees =
        namesAgree(name, character?.name?.full) || namesAgree(name, character?.name?.native);
    if (!character || !agrees) return EMPTY;

    return {
        name: character.name?.full ?? null,
        series: pickTitle(character),
        image: character.image?.large || character.image?.medium || null,
        description: cleanDescription(character.description),
        unknown: false,
    };
}

/**
 * The profile for one name: from Redis when it has been asked before, from
 * AniList otherwise. Never throws - a failed lookup is an "unknown" card.
 */
export async function getCharacterProfile(name: string): Promise<CharacterProfile> {
    const key = matchKey(name);
    if (!key) return EMPTY;

    try {
        const raw = await withRedis((redis) => redis.get(cacheKey(name)));
        if (raw) return JSON.parse(raw) as CharacterProfile;
    } catch (e) {
        console.error("Profile cache read failed:", e);
    }

    let profile = EMPTY;
    try {
        profile = await askAniList(name);
    } catch (e) {
        console.error("AniList profile lookup failed:", e instanceof Error ? e.message : e);
        // Not cached: a network blip should not pin this character as unknown
        // for a fortnight.
        return EMPTY;
    }

    try {
        await withRedis((redis) =>
            redis.set(
                cacheKey(name),
                JSON.stringify(profile),
                "EX",
                profile.unknown ? MISS_TTL_SEC : HIT_TTL_SEC
            )
        );
    } catch (e) {
        console.error("Profile cache write failed:", e);
    }

    return profile;
}

/**
 * The Thai version of a profile's blurb.
 *
 * A machine translation of a wiki paragraph reads like a machine translation,
 * so this asks Gemini for Thai that someone who actually knows the character
 * would write - and forbids it from adding anything the English did not say,
 * which is the failure mode that matters here. A bio people trust is worth more
 * than a bio that flows.
 *
 * Cached in Redis for a year under its own key. Characters do not change, the
 * cache is shared by every grid they appear in, and the whole point of paying
 * for a translation once is never paying for it again.
 */
const THAI_TTL_SEC = 60 * 60 * 24 * 365;

function thaiCacheKey(name: string): string {
    return `waifu100:profile-th:${matchKey(name)}`;
}

/**
 * The cached Thai text, or null when nobody has paid for it yet.
 *
 * Split from the generating call so the route can tell those two apart: a cache
 * hit is free and unlimited, a miss costs a Gemini call and has to be budgeted.
 */
export async function readThaiDescription(name: string): Promise<string | null> {
    const key = matchKey(name);
    if (!key) return null;

    try {
        const cached = await withRedis((redis) => redis.get(thaiCacheKey(name)));
        return cached ? cached : null;
    } catch (e) {
        console.error("Thai profile cache read failed:", e);
        return null;
    }
}

export async function getThaiDescription(
    name: string,
    english: string,
    series: string | null
): Promise<string | null> {
    const key = matchKey(name);
    if (!key || !english.trim()) return null;

    const cached = await readThaiDescription(name);
    if (cached) return cached;

    if (!process.env.GEMINI_API_KEY) return null;

    const prompt = `Translate this character description into Thai.

Character: ${name}${series ? `\nFrom: ${series}` : ""}

English:
${english}

Rules:
- Write the way a Thai fan who actually knows this character would write, not like a translation. Natural word order, everyday words.
- **Do not add anything.** No facts, no opinions, no flourishes that are not in the English. If the English is dry, the Thai is dry.
- Keep proper nouns (names of people, places, guilds, weapons, series) in their original spelling.
- Keep stat lines like "Height: 154 cm" as short Thai labels ("ส่วนสูง: 154 ซม.").
- No exclamation marks. No emoji. Do not address the reader.
- Same length or shorter than the English. Plain paragraphs, keep the line breaks.

Return ONLY the Thai text.`;

    let thai = "";
    try {
        const model = getFlashModel();
        const result = await model.generateContent(prompt);
        thai = (await result.response).text().trim();
    } catch (e) {
        console.error("Thai profile translation failed:", e);
        // Not cached: a transient failure must not pin this character to English
        // for a year.
        return null;
    }

    if (!thai) return null;

    try {
        await withRedis((redis) => redis.set(thaiCacheKey(name), thai, "EX", THAI_TTL_SEC));
    } catch (e) {
        console.error("Thai profile cache write failed:", e);
    }

    return thai;
}
