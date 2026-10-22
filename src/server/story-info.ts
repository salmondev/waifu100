import { upstreamType, type MediaType } from "@/lib/share-schema";
import { ANILIST_GRAPHQL } from "@/lib/story/search";
import { serperFetch } from "@/server/serper-budget";
import { getFlashModel } from "@/lib/gemini";

/**
 * Details for the story cell card (2026-10-15): synopsis + basic info for one title, by id.
 * AniList id, or AniList looked up by a stored MAL id. Cached in Redis by the route
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

/** v2 includes the cell title, so a corrected answer is shared by the same cell and a music-video id is not reused for a different title. */
export function infoCacheKey(src: "anilist" | "mal", id: number, type: MediaType, title = ""): string {
    const name = title.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 80);
    return `waifu100:storyinfo:v2:${src}:${type}:${id}:${name}`;
}

const MUSIC_TITLE = /\b(music video|mv|op|ed|opening|ending|theme song)\b/i;

function sharesTitle(a: string, b: string): boolean {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\u0E00-\u0E7F]+/g, " ").trim();
    const na = norm(a);
    const nb = norm(b);
    if (!na || !nb) return false;
    if (na.includes(nb) || nb.includes(na)) return true;
    const words = (s: string) => new Set(s.split(" ").filter((w) => w.length > 2));
    const left = words(na);
    return [...words(nb)].some((w) => left.has(w));
}

/** The grid already knows the title and type. AniList is wrong when those disagree — a TV anime filed as a music video is the usual case. */
export function storyRecordSuspect(info: StoryInfo | null, type: MediaType, title: string): boolean {
    const name = title.trim();
    if (!info) return name.length >= 2;
    if (type === "ANIME" && /^music$/i.test(info.format ?? "") && !MUSIC_TITLE.test(name)) return true;
    if (name.length >= 3 && !sharesTitle(name, info.title) && !info.altTitles.some((t) => sharesTitle(name, t))) return true;
    return false;
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

const MAL_INFO_QUERY = `query ($idMal: Int, $type: MediaType) {
  Media(idMal: $idMal, type: $type) {
    id type format status episodes chapters volumes seasonYear startDate { year }
    genres averageScore siteUrl isAdult
    description(asHtml: false)
    title { english romaji native }
  }
}`;

const SEARCH_QUERY = `query ($search: String, $type: MediaType, $format_not_in: [MediaFormat]) {
  Page(perPage: 5) {
    media(search: $search, type: $type, format_not_in: $format_not_in, sort: SEARCH_MATCH) {
      id type format status episodes chapters volumes seasonYear startDate { year }
      genres averageScore siteUrl description(asHtml: false)
      title { english romaji native }
    }
  }
}`;

async function searchByTitle(title: string, type: MediaType, f: typeof fetch): Promise<StoryInfo | null> {
    const res = await f(ANILIST_GRAPHQL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
            query: SEARCH_QUERY,
            variables: { search: title, type: upstreamType(type), ...(type === "ANIME" ? { format_not_in: ["MUSIC"] } : {}) },
        }),
        signal: AbortSignal.timeout(4000),
    }).catch(() => null);
    if (!res?.ok) return null;
    const body = (await res.json()) as { data?: { Page?: { media?: AniListInfo[] } } };
    const hit = (body.data?.Page?.media ?? []).find((m) => {
        const info = mapAniListInfo(m, type);
        return info && !storyRecordSuspect(info, type, title);
    });
    return hit ? mapAniListInfo(hit, type) : null;
}

async function correctWithWeb(title: string, type: MediaType, current: StoryInfo | null): Promise<StoryInfo | null> {
    if (!process.env.SERPER_API_KEY || !process.env.GEMINI_API_KEY) return current;
    const kind = type === "NOVEL" ? "light novel" : type === "MANGA" ? "manga" : "anime";
    const res = await serperFetch("https://google.serper.dev/search", {
        method: "POST",
        headers: { "X-API-KEY": process.env.SERPER_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ q: `${title} ${kind}`, num: 6 }),
        signal: AbortSignal.timeout(4000),
    }).catch(() => null);
    if (!res?.ok) return current;
    const data = (await res.json().catch(() => ({}))) as { organic?: { title?: string; snippet?: string }[]; knowledgeGraph?: { title?: string; description?: string; type?: string } };
    const lines = [
        data.knowledgeGraph?.description ? `Google: ${data.knowledgeGraph.title ?? ""} (${data.knowledgeGraph.type ?? ""}) ${data.knowledgeGraph.description}` : "",
        ...(data.organic ?? []).slice(0, 5).map((r) => `${r.title ?? ""}\n${r.snippet ?? ""}`),
    ].filter(Boolean);
    if (lines.length === 0) return current;
    const prompt = `The grid already says this is a ${kind} titled "${title}". AniList returned ${current ? `"${current.title}" format ${current.format ?? "unknown"}` : "nothing"}.
Use ONLY these search results. If they describe a TV anime, movie, manga, or light novel, do not call it a music video.
Reply with ONLY JSON: {"found":true|false,"title":"...","format":"TV|Movie|OVA|ONA|Manga|Light Novel|Music","year":2020|null,"synopsis":"2 sentences"}

RESULTS
${lines.join("\n\n")}`;
    try {
        const text = (await getFlashModel().generateContent(prompt)).response.text();
        const start = text.indexOf("{");
        const end = text.lastIndexOf("}");
        const parsed = start >= 0 && end > start ? JSON.parse(text.slice(start, end + 1)) as { found?: boolean; title?: string; format?: string; year?: number | null; synopsis?: string } : null;
        if (!parsed?.found || !parsed.title) return current;
        const keepFacts = !!current && sharesTitle(parsed.title, current.title);
        return {
            title: parsed.title.slice(0, 200),
            altTitles: keepFacts ? current.altTitles : [],
            type,
            synopsis: cleanSynopsis(parsed.synopsis),
            format: parsed.format ?? (keepFacts ? current.format : null),
            year: typeof parsed.year === "number" ? parsed.year : keepFacts ? current.year : null,
            status: keepFacts ? current.status : null,
            episodes: keepFacts ? current.episodes : null,
            chapters: keepFacts ? current.chapters : null,
            volumes: keepFacts ? current.volumes : null,
            genres: keepFacts ? current.genres : [],
            score: keepFacts ? current.score : null,
            url: keepFacts ? current.url : null,
            source: "anilist",
        };
    } catch {
        return current;
    }
}

/** found => info; null => the source answered "no such title"; throws on upstream failure (not cached). */
export async function fetchStoryInfo(src: "anilist" | "mal", id: number, type: MediaType, f: typeof fetch = fetch, title = ""): Promise<StoryInfo | null> {
    const res = await f(ANILIST_GRAPHQL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(src === "mal"
            ? { query: MAL_INFO_QUERY, variables: { idMal: id, type: upstreamType(type) } }
            : { query: INFO_QUERY, variables: { id } }),
        signal: AbortSignal.timeout(8000),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`anilist ${res.status}`);
    const body = (await res.json()) as { data?: { Media?: AniListInfo | null } };
    const info = body.data?.Media ? mapAniListInfo(body.data.Media, type) : null;
    if (!title.trim() || !storyRecordSuspect(info, type, title)) return info;
    const better = await searchByTitle(title.trim(), type, f);
    if (better && !storyRecordSuspect(better, type, title)) return better;
    return correctWithWeb(title.trim(), type, better ?? info);
}
