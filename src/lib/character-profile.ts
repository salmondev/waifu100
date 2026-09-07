import { withRedis } from "@/lib/redis";
import { matchKey, normalizeName } from "@/lib/character-match";
import {
    agreesWithHint,
    characterById,
    pickCharacter,
    searchCandidates,
    usableSeriesHint,
    bestKnownSeries,
    type AniListCandidate,
    type MatchConfidence,
} from "@/lib/anilist-character";
import { researchCharacter } from "@/lib/character-web";
import { getFlashModel } from "@/lib/gemini";

/**
 * One character's card: who they are, what they are from, a few lines about
 * them.
 *
 * Which character AniList meant is decided in anilist-character.ts, using the
 * series the grid stored alongside the name. This file is the caching around
 * that decision, and the caching is where the old version did the most damage:
 * the profile was stored under the character's *name*, so every Rin in every
 * grid shared one entry for six months. One bad lookup became everyone's
 * answer, and a fixed matcher would still have served the poisoned copy.
 *
 * So there are two caches now, and the split is the point:
 *
 *   cmatch:<name>|<series hint>  ->  which AniList character this is
 *   char:<anilist id>            ->  what that character is
 *
 * The first is per question asked, the second is per actual character. Two
 * different "Rin" questions get two different answers; two spellings of the
 * same character share one profile and one paid-for translation.
 *
 * A miss is cached too. Plenty of grids are full of VTubers and original art
 * that AniList has never heard of, and re-asking on every tap would spend the
 * shared rate limit on answers that will not change.
 */

export interface CharacterProfile {
    /** AniList's id, and the handle for "no, I meant the other one". */
    id: number | null;
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

/** One of the other characters who share this name. */
export interface CharacterAlternative {
    id: number;
    name: string;
    series: string | null;
    image: string | null;
}

export interface ProfileAnswer {
    profile: CharacterProfile;
    /**
     * "low" means several characters share this name and nothing in the grid
     * said which one. The card must show that rather than assert the guess.
     */
    confidence: MatchConfidence;
    alternatives: CharacterAlternative[];
    /** The Thai blurb, when one has already been written. */
    th: string | null;
    /**
     * AniList either had nothing or could not tell which character this is, so
     * a web lookup is worth a try. The card asks for it in a second request -
     * it costs a search and a generation, and nothing should wait on it.
     */
    enrichable: boolean;
    /** Set when the text came from the web rather than AniList. */
    webSources: string[];
}

const HIT_TTL_SEC = 60 * 60 * 24 * 180;
const MISS_TTL_SEC = 60 * 60 * 24 * 14;
/**
 * For an answer written while AniList was unreachable. Long enough to carry an
 * outage, short enough that the real matcher gets its say soon after.
 */
const PROVISIONAL_TTL_SEC = 60 * 60 * 24 * 3;
const THAI_TTL_SEC = 60 * 60 * 24 * 365;

export const EMPTY_PROFILE: CharacterProfile = {
    id: null,
    name: null,
    series: null,
    image: null,
    description: null,
    unknown: true,
};

const EMPTY_ANSWER: ProfileAnswer = {
    profile: EMPTY_PROFILE,
    confidence: "high",
    alternatives: [],
    th: null,
    // Nothing found is exactly the case the web is for - most of all for games,
    // which AniList does not index at all.
    enrichable: true,
    webSources: [],
};

/**
 * Cache version. Everything written by the name-only matcher is suspect -
 * silently wrong in a way no reader could detect - so it is abandoned rather
 * than trusted. scripts/prune-cache.mjs deletes the old keys outright.
 */
const V = "v3";

/**
 * One question, one key, one round trip.
 *
 * The whole answer is stored here - which character, the profile, the Thai, the
 * runners-up - because the previous shape needed two sequential GETs to a Redis
 * that is not in the same datacentre, and a warm card was paying for both
 * before it could render. The Thai also lives under its own id-keyed entry,
 * which is the copy shared between two spellings of one character; this one is
 * a snapshot that heals itself when it turns out to be behind.
 */
function answerCacheKey(name: string, source: string | null | undefined): string {
    const hint = usableSeriesHint(source)
        ? normalizeName(source).sort().join(" ")
        : "";
    return `waifu100:cmatch:${V}:${matchKey(name)}|${hint}`;
}

/** The same store, for a character the reader picked by id. */
function idCacheKey(id: number): string {
    return `waifu100:cmatch:${V}:id:${id}`;
}

/**
 * The Thai blurb, keyed by character rather than by name so the two spellings
 * of one character never pay Gemini twice.
 *
 * Versioned separately, because a prompt fix cannot reach translations already
 * written and a year-long cache would go on serving them. Bump it whenever the
 * prompt changes in a way that changes the output.
 */
const THAI_PROMPT_VERSION = 3;

function thaiCacheKey(id: number): string {
    // Deliberately outside `V`: this is keyed by AniList id and prompt, which is
    // already exact. A translation is the one thing here that costs real money,
    // so a future change to how questions are cached must not throw it away.
    return `waifu100:char-th:p${THAI_PROMPT_VERSION}:${id}`;
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

function toProfile(candidate: AniListCandidate, series: string | null): CharacterProfile {
    return {
        id: candidate.id ?? null,
        name: candidate.name?.full ?? null,
        series: series ?? bestKnownSeries(candidate),
        image: candidate.image?.large || candidate.image?.medium || null,
        description: cleanDescription(candidate.description),
        unknown: false,
    };
}

/* -------------------------------------------------------------------------- */
/* Cache plumbing - every read and write here is best-effort by design          */
/* -------------------------------------------------------------------------- */

interface CachedAnswer {
    /** null means "AniList had nobody", which is still an answer worth caching. */
    id: number | null;
    confidence: MatchConfidence;
    alternatives: CharacterAlternative[];
    profile: CharacterProfile;
    /** Snapshot of the translation; the id-keyed entry is the shared original. */
    th: string | null;
    /** Sites the text came from, when it came from the web rather than AniList. */
    webSources?: string[];
    /** The web has already been asked about this one; asking again is waste. */
    researched?: boolean;
}

async function readCache(key: string): Promise<string | null> {
    try {
        return await withRedis((redis) => redis.get(key));
    } catch (e) {
        console.error("Profile cache read failed:", e);
        return null;
    }
}

async function writeCache(key: string, value: string, ttl: number): Promise<void> {
    try {
        await withRedis((redis) => redis.set(key, value, "EX", ttl));
    } catch (e) {
        console.error("Profile cache write failed:", e);
    }
}

async function readAnswer(key: string): Promise<CachedAnswer | null> {
    const raw = await readCache(key);
    if (!raw) return null;
    try {
        return JSON.parse(raw) as CachedAnswer;
    } catch {
        return null;
    }
}

function saveAnswer(key: string, answer: CachedAnswer, ttl?: number): Promise<void> {
    return writeCache(
        key,
        JSON.stringify(answer),
        ttl ??
            (answer.id === null && !answer.profile.description ? MISS_TTL_SEC : HIT_TTL_SEC)
    );
}

/** The cached shape as the route wants it. */
function toAnswer(cached: CachedAnswer): ProfileAnswer {
    const profile = cached.profile ?? EMPTY_PROFILE;
    return {
        profile,
        confidence: cached.confidence,
        alternatives: cached.alternatives ?? [],
        th: cached.th ?? null,
        // Worth a web lookup only if one has not already happened: an unknown
        // character stays unknown, and a second search would just spend the
        // Serper budget to learn that again.
        enrichable: !cached.researched && (profile.unknown || cached.confidence === "low"),
        webSources: cached.webSources ?? [],
    };
}

/* -------------------------------------------------------------------------- */
/* Lookups                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The profile for one name, given whatever the grid knew about it.
 *
 * `source` is the cell's stored source. When it names a series it decides
 * between same-name characters; when it is "Uploaded" or a Pinterest URL it is
 * ignored, and the answer comes back marked `low` with the other candidates
 * attached. Never throws - a failed lookup is an "unknown" card.
 *
 * A warm answer is one Redis GET, deliberately: this fires from a tap.
 */
export async function getCharacterProfile(
    name: string,
    source?: string | null
): Promise<ProfileAnswer> {
    if (!matchKey(name)) return EMPTY_ANSWER;

    const key = answerCacheKey(name, source);
    const cached = await readAnswer(key);
    if (cached) return toAnswer(cached);

    let candidates: AniListCandidate[] = [];
    try {
        candidates = await searchCandidates(name, true);
    } catch (e) {
        console.error("AniList profile lookup failed:", e instanceof Error ? e.message : e);
        // Not cached: a network blip should not pin this character as unknown
        // for a fortnight.
        return EMPTY_ANSWER;
    }

    const match = pickCharacter(name, source, candidates);

    if (!match || !match.best.candidate.id) {
        const miss: CachedAnswer = {
            id: null,
            confidence: "high",
            alternatives: [],
            profile: EMPTY_PROFILE,
            th: null,
        };
        await saveAnswer(key, miss);
        return toAnswer(miss);
    }

    const profile = toProfile(match.best.candidate, match.best.series);
    const alternatives: CharacterAlternative[] = match.alternatives
        .filter((a) => a.candidate.id)
        .map((a) => ({
            id: a.candidate.id!,
            name: a.candidate.name?.full || name,
            series: a.series,
            image: a.candidate.image?.large || a.candidate.image?.medium || null,
        }));

    // A character resolved under another spelling may already have been
    // translated; picking that up costs one GET and saves a Gemini call.
    const th = profile.id ? await readThaiDescription(profile.id) : null;

    const answer: CachedAnswer = {
        id: profile.id,
        confidence: match.confidence,
        alternatives,
        profile,
        th,
    };
    await saveAnswer(key, answer);
    return toAnswer(answer);
}

/**
 * One exact character, by AniList id - what the card asks for when the reader
 * says the guess was wrong. No matching involved, so nothing to be unsure of.
 */
export async function getProfileById(id: number): Promise<ProfileAnswer> {
    const key = idCacheKey(id);
    const cached = await readAnswer(key);
    if (cached) return toAnswer(cached);

    let candidate: AniListCandidate | null = null;
    try {
        candidate = await characterById(id, true);
    } catch (e) {
        console.error("AniList id lookup failed:", e instanceof Error ? e.message : e);
        return EMPTY_ANSWER;
    }
    if (!candidate) return EMPTY_ANSWER;

    const profile = toProfile(candidate, null);
    const answer: CachedAnswer = {
        id: profile.id,
        confidence: "high",
        alternatives: [],
        profile,
        th: profile.id ? await readThaiDescription(profile.id) : null,
    };
    await saveAnswer(key, answer);
    return toAnswer(answer);
}

/**
 * Records a translation against the question that asked for it, so the next
 * reader gets it from the same single GET as everything else on the card.
 */
export async function attachThai(
    name: string,
    source: string | null | undefined,
    id: number | null,
    th: string
): Promise<void> {
    const key = id ? idCacheKey(id) : answerCacheKey(name, source);
    const cached = await readAnswer(key);
    if (!cached) return;
    await saveAnswer(key, { ...cached, th });
}

/**
 * The web fallback, for the characters AniList is wrong about or has never
 * heard of - which, for a grid full of game characters, is most of them.
 *
 * Search results only get to replace AniList on terms this app already trusts:
 * either AniList had nothing at all, or it was unsure *and* nothing it offered
 * fits the series the grid itself recorded. A more confident-sounding paragraph
 * is not evidence, and letting one win on tone is how the wrong answers got
 * here in the first place.
 */
export async function enrichFromWeb(
    name: string,
    source: string | null | undefined
): Promise<ProfileAnswer> {
    if (!matchKey(name)) return EMPTY_ANSWER;

    const key = answerCacheKey(name, source);
    let cached = await readAnswer(key);

    /**
     * Nothing cached means AniList never answered at all - it has been known to
     * return 403 across the board for hours ("temporarily disabled due to
     * severe stability issues"), and a lookup that failed is deliberately not
     * cached. That is precisely when this fallback is worth the most, so it
     * runs anyway, against an empty profile.
     *
     * The result is held briefly rather than for six months: it was written
     * without AniList having a say, and once AniList is back it should get one.
     */
    const provisional = !cached;
    if (!cached) {
        cached = {
            id: null,
            confidence: "high",
            alternatives: [],
            profile: EMPTY_PROFILE,
            th: null,
        };
    }

    const current = toAnswer(cached);
    if (!current.enrichable) return current;

    const web = await researchCharacter(name, source);

    // Remember that the web was asked even when it had nothing, so the next
    // reader does not spend another Serper credit on the same dead end.
    if (!web.description) {
        const marked: CachedAnswer = { ...cached, researched: true };
        await saveAnswer(key, marked, provisional ? PROVISIONAL_TTL_SEC : undefined);
        return toAnswer(marked);
    }

    const anilistFitsTheGrid = agreesWithHint(source, cached.profile?.series);
    const webFitsTheGrid = agreesWithHint(source, web.series);
    const replace =
        cached.profile.unknown ||
        (!anilistFitsTheGrid && (webFitsTheGrid || !usableSeriesHint(source)));

    if (!replace) {
        const marked: CachedAnswer = { ...cached, researched: true };
        await saveAnswer(key, marked, provisional ? PROVISIONAL_TTL_SEC : undefined);
        return toAnswer(marked);
    }

    const profile: CharacterProfile = {
        // No id: this character is not an AniList record, and pretending
        // otherwise would file its translation under someone else's id.
        id: null,
        name: cached.profile.name ?? null,
        series: web.series,
        image: cached.profile.unknown ? null : cached.profile.image,
        description: web.description,
        unknown: false,
    };

    const answer: CachedAnswer = {
        id: null,
        /**
         * The doubt is about the *name*, not about the web.
         *
         * A bare "Asuna" comes back as Sword Art Online's, which is right most
         * of the time and silently wrong for the Blue Archive grid that
         * prompted this work - so with nothing else to go on that answer is a
         * guess and the card says so. "Asuna Ichinose" is not that: a full name
         * picks one character out, and warning about it would be noise on a
         * card that is right.
         */
        confidence:
            usableSeriesHint(source) || normalizeName(name).length >= 2 ? "high" : "low",
        alternatives: [],
        profile,
        th: web.th,
        webSources: web.sources,
        researched: true,
    };
    await saveAnswer(key, answer, provisional ? PROVISIONAL_TTL_SEC : undefined);
    return toAnswer(answer);
}

/* -------------------------------------------------------------------------- */
/* Thai                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The cached Thai text, or null when nobody has paid for it yet.
 *
 * Split from the generating call so the route can tell those two apart: a cache
 * hit is free and unlimited, a miss costs a Gemini call and has to be budgeted.
 */
export async function readThaiDescription(id: number): Promise<string | null> {
    const cached = await readCache(thaiCacheKey(id));
    return cached ? cached : null;
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
 * Keyed by AniList id for the same reason the profile is: a translation of the
 * wrong character's bio, cached for a year under a shared name, was the most
 * expensive way this app could be wrong.
 */
export async function getThaiDescription(
    profile: CharacterProfile
): Promise<string | null> {
    const { id, name, series, description } = profile;
    if (!id || !description?.trim()) return null;

    const cached = await readThaiDescription(id);
    if (cached) return cached;

    if (!process.env.GEMINI_API_KEY) return null;

    // The passage is fenced and the context is labelled as context: the first
    // version simply put the name and series above the text, and Gemini
    // dutifully translated those two lines into the card as well.
    const prompt = `You are translating one character description into Thai.

Context - for your understanding only. Do NOT translate or repeat these lines:
- Character: ${name ?? "unknown"}
- Series: ${series ?? "unknown"}

Translate ONLY the text between the markers.

<<<TEXT
${description}
TEXT>>>

Rules:
- Write the way a Thai fan who actually knows this character would write, not like a translation. Natural word order, everyday words.
- **Do not add anything.** No facts, no opinions, no flourishes that are not in the English. If the English is dry, the Thai is dry.
- Keep proper nouns (names of people, places, guilds, weapons, series) in their original spelling.
- Keep stat lines like "Height: 154 cm" as short Thai labels ("ส่วนสูง: 154 ซม.").
- No exclamation marks. No emoji. Do not address the reader.
- Same length or shorter than the English. Plain paragraphs, keep the line breaks.

Return ONLY the Thai translation of the fenced text. No markers, no headings, no character name line, no series line.`;

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

    // Belt and braces for the same failure the prompt now guards against: strip
    // the fence and any echoed context header before it can be cached.
    thai = thai
        .replace(/<<<TEXT/g, "")
        .replace(/TEXT>>>/g, "")
        .replace(/^\s*(ตัวละคร|ชื่อ|จาก|เรื่อง|ซีรีส์|Character|Series)\s*[:：].*$/gim, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

    if (!thai) return null;

    await writeCache(thaiCacheKey(id), thai, THAI_TTL_SEC);
    return thai;
}
