import { isAllowedCoverUrl, STORY_TITLE_MAX } from "@/lib/story/config";
import { upstreamType, type MediaType, type StoryItem } from "@/lib/share-schema";

/**
 * Anime/manga search for the story builder. Runs in the visitor's browser, so
 * the AniList per-IP budget is per visitor, not shared by the whole site.
 *
 * Rules (research notes + Research review, T-0009 U5):
 *  - AniList GraphQL first. No isAdult/sfw filter (decision B): every cover
 *    is shown only through the moderated image proxy instead.
 *  - Jikan (MyAnimeList) only when AniList answers 429 or 5xx.
 *  - A 429's Retry-After is honoured: AniList is not called again until the
 *    cooldown passes; searches during it go straight to Jikan.
 *  - No bulk crawling: one page of results per (debounced) query.
 */

export const ANILIST_GRAPHQL = "https://graphql.anilist.co";
export const JIKAN_BASE = "https://api.jikan.moe/v4";
export const DEFAULT_RETRY_AFTER_SEC = 60;
export const SEARCH_PER_PAGE = 16;
export const SEARCH_DEBOUNCE_MS = 300;

export type SearchSource = "anilist" | "jikan";

export interface SearchResult {
    items: SearchItem[];
    source: SearchSource;
    /** Set while AniList is cooling down after a 429 (epoch ms). */
    anilistCooldownUntil: number | null;
    /** The real title(s) the query was resolved to, when AniList found nothing for the text as typed. */
    resolvedTitles?: string[];
}

export class SearchError extends Error {
    constructor(
        message: string,
        readonly status?: number,
        readonly retryAfterSec?: number
    ) {
        super(message);
        this.name = "SearchError";
    }
}

/**
 * T-0010: results carry a type badge. 2026-10-14: the builder searches one type at a time
 * (anime / manga toggle); `$type` null keeps the old "both" search.
 * AniList matches Thai titles through its synonyms (e.g. "นารูโตะ" -> NARUTO), so the query
 * text is passed through as-is (Unicode, NFC-normalised), never ASCII-filtered.
 */
const MEDIA_QUERY = `query ($search: String, $perPage: Int, $type: MediaType, $format_in: [MediaFormat], $format_not_in: [MediaFormat]) {
  Page(perPage: $perPage) {
    media(search: $search, type: $type, format_in: $format_in, format_not_in: $format_not_in, sort: SEARCH_MATCH) {
      id
      idMal
      type
      format
      seasonYear
      startDate { year }
      title { english romaji }
      coverImage { extraLarge large medium color }
    }
  }
}`;

interface AniListMedia {
    id?: number;
    idMal?: number | null;
    type?: string;
    format?: string | null;
    seasonYear?: number | null;
    startDate?: { year?: number | null } | null;
    title?: { english?: string | null; romaji?: string | null } | null;
    coverImage?: { extraLarge?: string | null; large?: string | null; medium?: string | null; color?: string | null } | null;
}

interface JikanEntry {
    mal_id?: number;
    title?: string;
    title_english?: string | null;
    type?: string | null;
    year?: number | null;
    published?: { prop?: { from?: { year?: number | null } } } | null;
    images?: { jpg?: { large_image_url?: string | null; image_url?: string | null } };
}

/** A search hit: a StoryItem plus display-only extras (never stored). */
export interface SearchItem extends StoryItem {
    format?: string;
    year?: number;
    color?: string;
    idMal?: number;
}

/** Retry-After as seconds (number or HTTP date), with a sane default. */
export function parseRetryAfter(header: string | null, now: number): number {
    if (!header) return DEFAULT_RETRY_AFTER_SEC;
    const n = Number(header);
    if (Number.isFinite(n) && n >= 0) return Math.min(Math.ceil(n), 3600);
    const date = Date.parse(header);
    if (Number.isFinite(date)) return Math.max(1, Math.min(Math.ceil((date - now) / 1000), 3600));
    return DEFAULT_RETRY_AFTER_SEC;
}

const short = (s: string) => s.trim().slice(0, STORY_TITLE_MAX);

const FORMAT_LABELS: Record<string, string> = { TV: "TV", TV_SHORT: "TV Short", MOVIE: "Movie", SPECIAL: "Special", OVA: "OVA", ONA: "ONA", MUSIC: "Music", MANGA: "Manga", NOVEL: "Light Novel", ONE_SHOT: "One-shot" };

export function mapAniList(media: AniListMedia[]): SearchItem[] {
    return media.flatMap((m) => {
        const cover = m.coverImage?.extraLarge || m.coverImage?.large || m.coverImage?.medium || "";
        const title = m.title?.english || m.title?.romaji || "";
        const type: MediaType | null = m.type === "MANGA" ? (m.format === "NOVEL" ? "NOVEL" : "MANGA") : m.type === "ANIME" ? "ANIME" : null;
        if (!m.id || !title || !type || !isAllowedCoverUrl(cover)) return [];
        const year = m.seasonYear || m.startDate?.year || undefined;
        return [{
            id: m.id, type, title: short(title), cover, src: "anilist" as const,
            ...(m.format ? { format: FORMAT_LABELS[m.format] ?? m.format } : {}),
            ...(year ? { year } : {}),
            ...(m.coverImage?.color ? { color: m.coverImage.color } : {}),
            ...(m.idMal ? { idMal: m.idMal } : {}),
        }];
    });
}

export function mapJikan(entries: JikanEntry[], type: MediaType): SearchItem[] {
    return entries.flatMap((e) => {
        const cover = e.images?.jpg?.large_image_url || e.images?.jpg?.image_url || "";
        const title = e.title_english || e.title || "";
        if (!e.mal_id || !title || !isAllowedCoverUrl(cover)) return [];
        const year = e.year || e.published?.prop?.from?.year || undefined;
        return [{ id: e.mal_id, type, title: short(title), cover, src: "mal" as const, idMal: e.mal_id, ...(e.type ? { format: e.type } : {}), ...(year ? { year } : {}) }];
    });
}

/** Interleave two lists (anime, manga) so both types show near the top. */
function interleave<T>(a: T[], b: T[]): T[] {
    const out: T[] = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (a[i]) out.push(a[i]);
        if (b[i]) out.push(b[i]);
    }
    return out;
}

/**
 * Search text as sent upstream: NFC (Thai typed on different keyboards can arrive decomposed,
 * e.g. sara am as nikhahit + sara aa), zero-width characters removed, whitespace collapsed.
 * Nothing is stripped by script, so Thai / Japanese / Korean queries pass through.
 */
export function normalizeQuery(query: string): string {
    return query
        .normalize("NFC")
        .replace(/\u0E4D\u0E32/g, "\u0E33")
        .replace(/[\u200B-\u200D\uFEFF]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * AniList filter for a search mode: light novels are MANGA with format NOVEL; the manga mode
 * excludes NOVEL so the two modes do not overlap. No type = the old "both" search.
 */
export function typeVariables(type?: MediaType): Record<string, unknown> {
    if (!type) return {};
    if (type === "NOVEL") return { type: "MANGA", format_in: ["NOVEL"] };
    if (type === "MANGA") return { type: "MANGA", format_not_in: ["NOVEL"] };
    return { type: upstreamType(type) };
}

/**
 * Server-side title resolver (/api/story/resolve): informal / Thai / misspelt names -> real titles.
 * Only asked when AniList found NOTHING, so it never costs anything on a normal search.
 */
export type ResolveTitles = (query: string, type: MediaType | undefined, signal?: AbortSignal) => Promise<string[]>;

export const fetchResolve: ResolveTitles = async (query, type, signal) => {
    const qs = new URLSearchParams({ q: query, ...(type ? { type } : {}) });
    const res = await fetch(`/api/story/resolve?${qs}`, { signal }).catch(() => null);
    if (!res?.ok) return [];
    const body = (await res.json().catch(() => ({}))) as { titles?: unknown };
    return Array.isArray(body.titles) ? body.titles.filter((t): t is string => typeof t === "string" && !!t.trim()).slice(0, 3) : [];
};

export interface StorySearchDeps {
    fetch?: typeof fetch;
    now?: () => number;
    /** Optional fallback for empty AniList answers. Absent = no fallback (tests, server). */
    resolve?: ResolveTitles;
}

export function createStorySearch(deps: StorySearchDeps = {}) {
    const doFetch = deps.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
    const now = deps.now ?? Date.now;
    let cooldownUntil = 0;

    const inCooldown = () => now() < cooldownUntil;

    async function jikanOne(query: string, type: MediaType, signal?: AbortSignal): Promise<SearchItem[]> {
        const path = type === "ANIME" ? "anime" : "manga";
        const kind = type === "NOVEL" ? "&type=lightnovel" : "";
        const url = `${JIKAN_BASE}/${path}?q=${encodeURIComponent(query)}&limit=${Math.ceil(SEARCH_PER_PAGE / 2)}${kind}`;
        const res = await doFetch(url, { signal, headers: { Accept: "application/json" } });
        if (!res.ok) {
            throw new SearchError(
                res.status === 429 ? "Search is busy - try again in a few seconds." : "Search is unavailable right now. Please try again shortly.",
                res.status,
                res.status === 429 ? parseRetryAfter(res.headers.get("Retry-After"), now()) : undefined
            );
        }
        const body = (await res.json()) as { data?: JikanEntry[] };
        return mapJikan(body.data ?? [], type);
    }

    /** Fallback: anime and manga in parallel (or the one asked for); one side failing still shows the other. */
    async function jikan(query: string, signal?: AbortSignal, type?: MediaType): Promise<SearchItem[]> {
        if (type) return jikanOne(query, type, signal);
        const [a, m] = await Promise.allSettled([jikanOne(query, "ANIME", signal), jikanOne(query, "MANGA", signal)]);
        if (a.status === "rejected" && m.status === "rejected") throw a.reason;
        return interleave(a.status === "fulfilled" ? a.value : [], m.status === "fulfilled" ? m.value : []);
    }

    /** Recent results per query (T-0013): re-searching the same title (e.g. from a filled cell) costs no request. */
    const cache = new Map<string, { at: number; r: SearchResult }>();
    const CACHE_MS = 5 * 60_000;
    const CACHE_MAX = 50;

    async function search(query: string, signal?: AbortSignal, type?: MediaType): Promise<SearchResult> {
        const text = normalizeQuery(query);
        const key = `${type ?? "ALL"}:${text.toLowerCase()}`;
        const hit = cache.get(key);
        if (hit && now() - hit.at < CACHE_MS) return hit.r;
        let r = await searchUncached(text, signal, type);
        if (deps.resolve && r.source === "anilist" && r.items.length === 0 && text.length >= 2) {
            r = await resolveAndRetry(text, r, signal, type);
        }
        // Only full AniList answers are kept; a Jikan fallback should be retried against AniList.
        if (r.source === "anilist" && text.length >= 2) {
            if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
            cache.set(key, { at: now(), r });
        }
        return r;
    }

    /** AniList had nothing: ask the server for real titles, then search AniList for each (deduped). */
    async function resolveAndRetry(text: string, empty: SearchResult, signal?: AbortSignal, type?: MediaType): Promise<SearchResult> {
        const titles = (await deps.resolve!(text, type, signal).catch(() => [] as string[]))
            .map(normalizeQuery)
            .filter((t) => t.length >= 2 && t.toLowerCase() !== text.toLowerCase());
        if (!titles.length) return empty;
        const seen = new Set<string>();
        const items: SearchItem[] = [];
        let source: SearchSource = "anilist";
        for (const t of titles) {
            const r = await searchUncached(t, signal, type).catch(() => null);
            if (!r) continue;
            if (r.source === "jikan") source = "jikan";
            for (const it of r.items) {
                const k = `${it.src}:${it.type}:${it.id}`;
                if (!seen.has(k)) { seen.add(k); items.push(it); }
            }
        }
        return { items: items.slice(0, SEARCH_PER_PAGE), source, anilistCooldownUntil: inCooldown() ? cooldownUntil : null, resolvedTitles: titles };
    }

    async function searchUncached(query: string, signal?: AbortSignal, type?: MediaType): Promise<SearchResult> {
        const q = query;
        if (q.length < 2) return { items: [], source: "anilist", anilistCooldownUntil: inCooldown() ? cooldownUntil : null };

        if (inCooldown()) {
            return { items: await jikan(q, signal, type), source: "jikan", anilistCooldownUntil: cooldownUntil };
        }

        const variables: Record<string, unknown> = { search: q, perPage: SEARCH_PER_PAGE, ...typeVariables(type) };
        const res = await doFetch(ANILIST_GRAPHQL, {
            method: "POST",
            signal,
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ query: MEDIA_QUERY, variables }),
        });

        if (res.status === 429) {
            cooldownUntil = now() + parseRetryAfter(res.headers.get("Retry-After"), now()) * 1000;
            return { items: await jikan(q, signal, type), source: "jikan", anilistCooldownUntil: cooldownUntil };
        }
        if (res.status >= 500) {
            return { items: await jikan(q, signal, type), source: "jikan", anilistCooldownUntil: null };
        }
        if (!res.ok) throw new SearchError("Search failed. Please try a different title.", res.status);

        const body = (await res.json()) as { data?: { Page?: { media?: AniListMedia[] } } };
        return { items: mapAniList(body.data?.Page?.media ?? []), source: "anilist", anilistCooldownUntil: null };
    }

    return { search, cooldownUntil: () => (inCooldown() ? cooldownUntil : null) };
}

/** Browser-wide instance, so the cooldown is shared by every search box. */
export const storySearch = createStorySearch({ resolve: fetchResolve });
