import { withRedis } from "@/lib/redis";
import { matchKey } from "@/lib/character-match";
import { ANILIST_URL, namesAgree, pickTitle, type AniListCharacter } from "@/lib/series-resolve";

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
