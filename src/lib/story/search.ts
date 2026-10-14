import { isAllowedCoverUrl, STORY_TITLE_MAX } from "@/lib/story/config";
import type { MediaType, StoryItem } from "@/lib/share-schema";

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

/** T-0010: one search over anime AND manga (no type filter); results carry a badge. */
const MEDIA_QUERY = `query ($search: String, $perPage: Int) {
  Page(perPage: $perPage) {
    media(search: $search, sort: SEARCH_MATCH) {
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
        const type: MediaType | null = m.type === "MANGA" ? "MANGA" : m.type === "ANIME" ? "ANIME" : null;
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

export interface StorySearchDeps {
    fetch?: typeof fetch;
    now?: () => number;
}

export function createStorySearch(deps: StorySearchDeps = {}) {
    const doFetch = deps.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
    const now = deps.now ?? Date.now;
    let cooldownUntil = 0;

    const inCooldown = () => now() < cooldownUntil;

    async function jikanOne(query: string, type: MediaType, signal?: AbortSignal): Promise<SearchItem[]> {
        const path = type === "MANGA" ? "manga" : "anime";
        const url = `${JIKAN_BASE}/${path}?q=${encodeURIComponent(query)}&limit=${Math.ceil(SEARCH_PER_PAGE / 2)}`;
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

    /** Fallback: anime and manga in parallel; one side failing still shows the other. */
    async function jikan(query: string, signal?: AbortSignal): Promise<SearchItem[]> {
        const [a, m] = await Promise.allSettled([jikanOne(query, "ANIME", signal), jikanOne(query, "MANGA", signal)]);
        if (a.status === "rejected" && m.status === "rejected") throw a.reason;
        return interleave(a.status === "fulfilled" ? a.value : [], m.status === "fulfilled" ? m.value : []);
    }

    /** Recent results per query (T-0013): re-searching the same title (e.g. from a filled cell) costs no request. */
    const cache = new Map<string, { at: number; r: SearchResult }>();
    const CACHE_MS = 5 * 60_000;
    const CACHE_MAX = 50;

    async function search(query: string, signal?: AbortSignal): Promise<SearchResult> {
        const key = query.trim().toLowerCase();
        const hit = cache.get(key);
        if (hit && now() - hit.at < CACHE_MS) return hit.r;
        const r = await searchUncached(query, signal);
        // Only full AniList answers are kept; a Jikan fallback should be retried against AniList.
        if (r.source === "anilist" && key.length >= 2) {
            if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
            cache.set(key, { at: now(), r });
        }
        return r;
    }

    async function searchUncached(query: string, signal?: AbortSignal): Promise<SearchResult> {
        const q = query.trim();
        if (q.length < 2) return { items: [], source: "anilist", anilistCooldownUntil: inCooldown() ? cooldownUntil : null };

        if (inCooldown()) {
            return { items: await jikan(q, signal), source: "jikan", anilistCooldownUntil: cooldownUntil };
        }

        const variables: Record<string, unknown> = { search: q, perPage: SEARCH_PER_PAGE };
        const res = await doFetch(ANILIST_GRAPHQL, {
            method: "POST",
            signal,
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ query: MEDIA_QUERY, variables }),
        });

        if (res.status === 429) {
            cooldownUntil = now() + parseRetryAfter(res.headers.get("Retry-After"), now()) * 1000;
            return { items: await jikan(q, signal), source: "jikan", anilistCooldownUntil: cooldownUntil };
        }
        if (res.status >= 500) {
            return { items: await jikan(q, signal), source: "jikan", anilistCooldownUntil: null };
        }
        if (!res.ok) throw new SearchError("Search failed. Please try a different title.", res.status);

        const body = (await res.json()) as { data?: { Page?: { media?: AniListMedia[] } } };
        return { items: mapAniList(body.data?.Page?.media ?? []), source: "anilist", anilistCooldownUntil: null };
    }

    return { search, cooldownUntil: () => (inCooldown() ? cooldownUntil : null) };
}

/** Browser-wide instance, so the cooldown is shared by every search box. */
export const storySearch = createStorySearch();
