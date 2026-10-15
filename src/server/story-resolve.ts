import { createHash } from "node:crypto";
import type { MediaType } from "@/lib/share-schema";

/**
 * Story title resolver (2026-10-15): turns an informal / Thai / misspelt name that AniList
 * cannot match ("ดาบพิฆาตอสูร", "kimetsu", "หมอยา") into real title(s) to search AniList with.
 *
 * QUOTA: Serper and Gemini credits are shared with waifu and may be one-time, so
 *  - the client asks only after a debounced search came back EMPTY from AniList;
 *  - every answer is cached in Redis per (type, normalised query): hits ~180 days, misses ~14 days;
 *  - only cache misses are rate-limited and spend a Serper credit (serperFetch => daily cap);
 *  - Gemini is optional: one call per miss, only when Serper returned something; a failed
 *    upstream (budget 429, outage) is NOT cached, so it is retried later instead of pinned.
 */

export const RESOLVE_HIT_TTL_SEC = 180 * 24 * 3600;
export const RESOLVE_MISS_TTL_SEC = 14 * 24 * 3600;
export const RESOLVE_MAX_TITLES = 3;
const SERPER_SEARCH = "https://google.serper.dev/search";

export function normaliseResolveQuery(q: string): string {
    return q.normalize("NFC").replace(/[\u200B-\u200D\uFEFF]/g, "").trim().toLowerCase().replace(/\s+/g, " ").slice(0, 100);
}

export function resolveCacheKey(q: string, type: MediaType | null): string {
    return `waifu100:storyresolve:v1:${createHash("sha1").update(`${type ?? "ALL"}|${normaliseResolveQuery(q)}`).digest("hex")}`;
}

const TYPE_WORD: Record<MediaType, string> = { ANIME: "anime", MANGA: "manga", NOVEL: "light novel" };

export interface SerperOrganic {
    title?: string;
    snippet?: string;
    link?: string;
}

/** Site suffixes whose page titles are "<real title> - <site>". */
const TITLE_SITES: RegExp[] = [
    /^(.+?)\s*(?:\((?:TV series|anime|manga|light novel|novel series|film)\))?\s*[-|–—]\s*(?:Wikipedia|MyAnimeList(?:\.net)?|AniList|Anime News Network|Fandom|Crunchyroll|Netflix|Kitsu|MangaDex|NovelUpdates|Novel Updates)\b/i,
    /^(.+?)\s*[-|–—]\s*วิกิพีเดีย/,
];

/** Heuristic extraction from result titles (no AI). Used alone without Gemini, or as its fallback. */
export function heuristicTitles(results: SerperOrganic[]): string[] {
    const out: string[] = [];
    for (const r of results) {
        const t = (r.title ?? "").trim();
        for (const re of TITLE_SITES) {
            const m = t.match(re);
            const name = m?.[1]?.replace(/\s*\((?:Manga|Anime|Light Novel|TV)\)\s*$/i, "").replace(/\s*[-|–—]\s*$/, "").trim();
            if (name && name.length >= 2 && name.length <= 120 && !out.some((x) => x.toLowerCase() === name.toLowerCase())) {
                out.push(name);
                break;
            }
        }
        if (out.length >= RESOLVE_MAX_TITLES) break;
    }
    return out;
}

export function resolvePrompt(query: string, type: MediaType | null, results: SerperOrganic[]): string {
    const lines = results.slice(0, 8).map((r, i) => `${i + 1}. ${(r.title ?? "").slice(0, 150)} :: ${(r.snippet ?? "").slice(0, 200)}`).join("\n");
    return `A user searched an anime/manga database for "${query}"${type ? ` (looking for a ${TYPE_WORD[type]})` : ""} and found nothing. The name may be Thai, a nickname, an abbreviation or misspelt.
Using ONLY the web results below, give the official title(s) it refers to, as they would appear on AniList (English or romaji). At most ${RESOLVE_MAX_TITLES}, best first. If the results do not clearly identify a ${type ? TYPE_WORD[type] : "title"}, return an empty list.
Results:
${lines}
Reply with bare JSON only: {"titles":["..."]}`;
}

/** Parse the model's JSON (fences tolerated). */
export function parseTitles(text: string): string[] {
    const m = text.replace(/```(?:json)?/gi, "").match(/\{[\s\S]*\}/);
    if (!m) return [];
    try {
        const t = (JSON.parse(m[0]) as { titles?: unknown }).titles;
        if (!Array.isArray(t)) return [];
        return t.filter((x): x is string => typeof x === "string").map((x) => x.trim().slice(0, 120)).filter((x) => x.length >= 2).slice(0, RESOLVE_MAX_TITLES);
    } catch {
        return [];
    }
}

export interface ResolveDeps {
    apiKey?: string;
    cacheGet: (key: string) => Promise<string | null>;
    cacheSet: (key: string, value: string, ttlSec: number) => Promise<void>;
    /** Called only on a cache miss, before spending a credit. Return false to refuse (rate limit). */
    allowMiss: () => Promise<boolean>;
    /** serperFetch in production (counts the credit, honours SERPER_DAILY_CAP). */
    serper: (url: string, init: RequestInit) => Promise<Response>;
    /** Optional Gemini extraction. Absent / throwing => heuristics only. */
    extract?: (prompt: string) => Promise<string>;
}

export type ResolveResult =
    | { ok: true; titles: string[]; cached: boolean }
    | { ok: false; status: number; error: string };

export async function resolveStoryTitles(q: string, type: MediaType | null, deps: ResolveDeps): Promise<ResolveResult> {
    const query = normaliseResolveQuery(q);
    if (query.length < 2) return { ok: true, titles: [], cached: false };
    const key = resolveCacheKey(query, type);

    const hit = await deps.cacheGet(key).catch(() => null);
    if (hit) {
        try {
            const titles = (JSON.parse(hit) as { titles?: unknown }).titles;
            if (Array.isArray(titles)) return { ok: true, titles: titles.filter((t): t is string => typeof t === "string"), cached: true };
        } catch {
            /* fall through */
        }
    }
    if (!deps.apiKey) return { ok: true, titles: [], cached: false };
    if (!(await deps.allowMiss())) return { ok: false, status: 429, error: "Too many new searches - try again in a minute." };

    const res = await deps
        .serper(SERPER_SEARCH, {
            method: "POST",
            headers: { "X-API-KEY": deps.apiKey, "Content-Type": "application/json" },
            body: JSON.stringify({ q: `${query} ${type ? TYPE_WORD[type] : "anime manga"}`, num: 10 }),
            signal: AbortSignal.timeout(8000),
        })
        .catch(() => null);
    // Budget refusal / outage: answer "nothing" but do not cache, so it is retried later.
    if (!res || !res.ok) return { ok: true, titles: [], cached: false };
    const body = (await res.json().catch(() => ({}))) as { organic?: SerperOrganic[]; knowledgeGraph?: { title?: string; type?: string } };
    const organic = (body.organic ?? []).slice(0, 10);

    let titles: string[] = [];
    if (organic.length && deps.extract) {
        titles = parseTitles(await deps.extract(resolvePrompt(query, type, organic)).catch(() => ""));
    }
    if (!titles.length) titles = heuristicTitles(organic);
    if (!titles.length && body.knowledgeGraph?.title) titles = [body.knowledgeGraph.title.trim().slice(0, 120)];
    titles = titles.filter((t) => normaliseResolveQuery(t) !== query);

    await deps.cacheSet(key, JSON.stringify({ titles }), titles.length ? RESOLVE_HIT_TTL_SEC : RESOLVE_MISS_TTL_SEC).catch(() => {});
    return { ok: true, titles, cached: false };
}
