import { createHash } from "node:crypto";
import { serperFetch } from "@/server/serper-budget";
import { isPublicHttpsUrl } from "@/lib/url-safety";
import { STORY_TITLE_MAX } from "@/lib/story/config";
import type { MediaType, StoryItem } from "@/lib/share-schema";

/**
 * Story search via Serper Google Images (T-0009 E).
 * QUOTA RISK: Serper free credits may be one-time, so every answer (including
 * "nothing found") is cached for 30 days per normalised query, and the route
 * is rate-limited on cache misses only. No key => disabled (503).
 */

export const WEB_CACHE_TTL_SEC = 30 * 24 * 3600;
export const WEB_RESULTS = 12;

export function normaliseQuery(q: string): string {
    return q.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 100);
}

export function webCacheKey(q: string, type: MediaType): string {
    return `waifu100:storyweb:v1:${createHash("sha1").update(`${type}|${normaliseQuery(q)}`).digest("hex")}`;
}

/** Stable positive id for a URL (web items have no database id). */
export function webItemId(url: string): number {
    return parseInt(createHash("sha1").update(url).digest("hex").slice(0, 7), 16) + 1;
}

interface SerperImage {
    title?: string;
    imageUrl?: string;
}

export function mapSerper(images: SerperImage[], type: MediaType): StoryItem[] {
    const seen = new Set<string>();
    return images.flatMap((img) => {
        const url = img.imageUrl;
        if (!url || !isPublicHttpsUrl(url) || seen.has(url)) return [];
        seen.add(url);
        const title = (img.title || "").trim().slice(0, STORY_TITLE_MAX) || "Web image";
        return [{ id: webItemId(url), type, title, cover: url, src: "web" as const }];
    }).slice(0, WEB_RESULTS);
}

export interface WebSearchDeps {
    fetch?: typeof fetch;
    apiKey?: string;
    cacheGet: (key: string) => Promise<string | null>;
    cacheSet: (key: string, value: string) => Promise<void>;
    /** Called only on a cache miss, before spending a credit. Return false to refuse. */
    allowMiss: () => Promise<boolean>;
}

export type WebSearchResult =
    | { ok: true; items: StoryItem[]; cached: boolean }
    | { ok: false; status: number; error: string };

export async function storyWebSearch(q: string, type: MediaType, deps: WebSearchDeps): Promise<WebSearchResult> {
    if (!deps.apiKey) return { ok: false, status: 503, error: "Web search is unavailable right now." };
    const query = normaliseQuery(q);
    if (query.length < 2) return { ok: true, items: [], cached: false };
    const key = webCacheKey(query, type);

    const hit = await deps.cacheGet(key).catch(() => null);
    if (hit) {
        try {
            return { ok: true, items: JSON.parse(hit) as StoryItem[], cached: true };
        } catch {
            /* fall through */
        }
    }
    if (!(await deps.allowMiss())) return { ok: false, status: 429, error: "Too many new web searches - try again in a minute." };

    const res = await (deps.fetch ?? ((u: string, i: RequestInit) => serperFetch(u, i)))("https://google.serper.dev/images", {
        method: "POST",
        headers: { "X-API-KEY": deps.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ q: `${query} ${type === "MANGA" ? "manga" : "anime"} cover`, num: 10 }),
        signal: AbortSignal.timeout(8000),
    }).catch(() => null);
    if (!res || !res.ok) return { ok: false, status: 502, error: "Web search is unavailable right now." };
    const body = (await res.json().catch(() => ({}))) as { images?: SerperImage[] };
    const items = mapSerper(body.images ?? [], type);
    await deps.cacheSet(key, JSON.stringify(items)).catch(() => {});
    return { ok: true, items, cached: false };
}
