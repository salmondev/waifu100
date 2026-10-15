import { upstreamType, type MediaType } from "@/lib/share-schema";
import { ANILIST_GRAPHQL, JIKAN_BASE } from "@/lib/story/search";

/**
 * Details for the story cell card (2026-10-15): synopsis + basic info for one title, by id.
 * AniList for src "anilist"; Jikan (MyAnimeList) for src "mal". Cached in Redis by the route
 * (found: 30 days, not found: 1 day); an upstream failure is not cached.
 */

export const INFO_HIT_TTL_SEC = 30 * 24 * 3600;
export const INFO_MISS_TTL_SEC = 24 * 3600;
export const SYNOPSIS_MAX = 1500;

export interface StoryInfo {
    title: string;
    /** Other names (romaji / native / English) different from `title`. */
    altTitles: string[];
    type: MediaType;
    synopsis: string | null;
    format: string | null;
    year: number | null;
    status: string | null;
    episodes: number | null;
    chapters: number | null;
    volumes: number | null;
    genres: string[];
    /** 0-100 (AniList averageScore; MAL score x10). */
    score: number | null;
    url: string | null;
    source: "anilist" | "mal";
}

export function infoCacheKey(src: "anilist" | "mal", id: number, type: MediaType): string {
    return `waifu100:storyinfo:v1:${src}:${type}:${id}`;
}

/** AniList/MAL descriptions carry light HTML and source credits; the card wants plain text. */
export function cleanSynopsis(raw: string | null | undefined): string | null {
    if (!raw) return null;
    const text = raw
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
        .replace(/\[Written by MAL Rewrite\]/gi, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    if (!text) return null;
    return text.length > SYNOPSIS_MAX ? `${text.slice(0, SYNOPSIS_MAX).replace(/\s+\S*$/, "")}…` : text;
}

const FORMAT: Record<string, string> = { TV: "TV", TV_SHORT: "TV Short", MOVIE: "Movie", SPECIAL: "Special", OVA: "OVA", ONA: "ONA", MUSIC: "Music", MANGA: "Manga", NOVEL: "Light Novel", ONE_SHOT: "One-shot" };
const STATUS: Record<string, string> = { FINISHED: "Finished", RELEASING: "Ongoing", NOT_YET_RELEASED: "Not yet released", CANCELLED: "Cancelled", HIATUS: "On hiatus" };

const INFO_QUERY = `query ($id: Int) {
  Media(id: $id) {
    id type format status episodes chapters volumes seasonYear startDate { year }
    genres averageScore siteUrl isAdult
    description(asHtml: false)
    title { english romaji native }
  }
}`;

interface AniListInfo {
    type?: string; format?: string | null; status?: string | null;
    episodes?: number | null; chapters?: number | null; volumes?: number | null;
    seasonYear?: number | null; startDate?: { year?: number | null } | null;
    genres?: string[] | null; averageScore?: number | null; siteUrl?: string | null;
    description?: string | null;
    title?: { english?: string | null; romaji?: string | null; native?: string | null } | null;
}

interface JikanInfo {
    title?: string; title_english?: string | null; title_japanese?: string | null;
    type?: string | null; status?: string | null; episodes?: number | null; chapters?: number | null; volumes?: number | null;
    year?: number | null; aired?: { prop?: { from?: { year?: number | null } } } | null; published?: { prop?: { from?: { year?: number | null } } } | null;
    genres?: { name?: string }[]; score?: number | null; url?: string | null; synopsis?: string | null;
}

const alts = (main: string, ...xs: (string | null | undefined)[]) =>
    [...new Set(xs.filter((x): x is string => !!x && x.trim() !== "" && x !== main))].slice(0, 3);

export function mapAniListInfo(m: AniListInfo, type: MediaType): StoryInfo | null {
    const title = m.title?.english || m.title?.romaji || "";
    if (!title) return null;
    return {
        title, altTitles: alts(title, m.title?.romaji, m.title?.native, m.title?.english),
        type: m.type === "ANIME" ? "ANIME" : m.format === "NOVEL" ? "NOVEL" : m.type === "MANGA" ? "MANGA" : type,
        synopsis: cleanSynopsis(m.description),
        format: m.format ? FORMAT[m.format] ?? m.format : null,
        year: m.seasonYear || m.startDate?.year || null,
        status: m.status ? STATUS[m.status] ?? m.status : null,
        episodes: m.episodes ?? null, chapters: m.chapters ?? null, volumes: m.volumes ?? null,
        genres: (m.genres ?? []).slice(0, 6),
        score: typeof m.averageScore === "number" ? m.averageScore : null,
        url: m.siteUrl ?? null, source: "anilist",
    };
}

export function mapJikanInfo(e: JikanInfo, type: MediaType): StoryInfo | null {
    const title = e.title_english || e.title || "";
    if (!title) return null;
    return {
        title, altTitles: alts(title, e.title, e.title_japanese, e.title_english),
        type,
        synopsis: cleanSynopsis(e.synopsis),
        format: e.type ?? null,
        year: e.year || e.aired?.prop?.from?.year || e.published?.prop?.from?.year || null,
        status: e.status ?? null,
        episodes: e.episodes ?? null, chapters: e.chapters ?? null, volumes: e.volumes ?? null,
        genres: (e.genres ?? []).map((g) => g.name ?? "").filter(Boolean).slice(0, 6),
        score: typeof e.score === "number" ? Math.round(e.score * 10) : null,
        url: e.url ?? null, source: "mal",
    };
}

/** found => info; null => the source answered "no such title"; throws on upstream failure (not cached). */
export async function fetchStoryInfo(src: "anilist" | "mal", id: number, type: MediaType, f: typeof fetch = fetch): Promise<StoryInfo | null> {
    if (src === "mal") {
        const res = await f(`${JIKAN_BASE}/${upstreamType(type) === "ANIME" ? "anime" : "manga"}/${id}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`jikan ${res.status}`);
        const body = (await res.json()) as { data?: JikanInfo };
        return body.data ? mapJikanInfo(body.data, type) : null;
    }
    const res = await f(ANILIST_GRAPHQL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query: INFO_QUERY, variables: { id } }),
        signal: AbortSignal.timeout(8000),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`anilist ${res.status}`);
    const body = (await res.json()) as { data?: { Media?: AniListInfo | null } };
    return body.data?.Media ? mapAniListInfo(body.data.Media, type) : null;
}
