import { createHash } from "node:crypto";
import { safeFetchImage, type SafeFetchOptions } from "@/server/moderation/safe-fetch";
import { isPublicHttpsUrl } from "@/lib/url-safety";
import { ANILIST_GRAPHQL } from "@/lib/story/search";
import { STORY_TITLE_MAX } from "@/lib/story/config";
import { upstreamType, type MediaType } from "@/lib/share-schema";

/**
 * T-0010: every image choice for one title, for the "pick an image" panel.
 *  - AniList (one query): coverImage extraLarge/large/medium, bannerImage,
 *    relation covers, idMal.
 *  - Web images for the title.
 *  - Serper image results (cached; credits are no longer a concern).
 * Deduped by sha256 of the fetched bytes - the same hash /api/img moderates
 * by - so the same picture under different URLs is offered once. Display is
 * still ONLY via proxied() -> /api/img (moderation); this module never serves bytes.
 */

export type ChoiceSource = "anilist" | "banner" | "relation" | "mal" | "web";
export interface ImageChoice {
    url: string;
    source: ChoiceSource;
    label: string;
    /** sha256 of the bytes (dedupe key); absent when hashing was skipped. */
    hash?: string;
}
export interface ImageChoices {
    id: number;
    type: MediaType;
    title: string;
    idMal: number | null;
    color: string | null;
    choices: ImageChoice[];
    /** A source failed: cache briefly so it is retried soon. */
    partial: boolean;
}

export const MAX_CANDIDATES = 40;
export const HASH_CONCURRENCY = 10;
export const CHOICES_CACHE_TTL_SEC = 7 * 24 * 3600;
export const PARTIAL_CACHE_TTL_SEC = 3600;
/** Fetch-for-hash cap. A bigger image is just dropped from the choices (NOT a source failure). */
export const HASH_MAX_BYTES = 2 * 1024 * 1024;

/** sha256 of an image's bytes, fetched SSRF-safely and capped at HASH_MAX_BYTES (throws over the cap). */
export async function hashImage(url: string, opts: Omit<SafeFetchOptions, "maxBytes"> = {}): Promise<string> {
    return sha256Hex((await safeFetchImage(url, { ...opts, maxBytes: HASH_MAX_BYTES })).bytes);
}

/** 7 days, or 1 hour when a source (AniList or Serper) failed. Dropped images never count. */
export function choicesTtl(result: Pick<ImageChoices, "partial">): number {
    return result.partial ? PARTIAL_CACHE_TTL_SEC : CHOICES_CACHE_TTL_SEC;
}

const MEDIA_BY_ID = `query ($id: Int, $idMal: Int, $type: MediaType) {
  Media(id: $id, idMal: $idMal, type: $type) {
    id
    idMal
    type
    title { english romaji }
    coverImage { extraLarge large medium color }
    bannerImage
    relations { edges { relationType node { id type title { english romaji } coverImage { extraLarge } } } }
  }
}`;

export interface MediaById {
    id?: number;
    idMal?: number | null;
    type?: string;
    title?: { english?: string | null; romaji?: string | null };
    coverImage?: { extraLarge?: string | null; large?: string | null; medium?: string | null; color?: string | null };
    bannerImage?: string | null;
    relations?: { edges?: { relationType?: string; node?: { id?: number; type?: string; title?: { english?: string | null; romaji?: string | null }; coverImage?: { extraLarge?: string | null } } }[] };
}

export function choicesCacheKey(src: "anilist" | "mal", id: number, type: MediaType): string {
    return `waifu100:storyimg:v1:${src}:${type}:${id}`;
}

const nice = (s: string) => s.toLowerCase().replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

/** Ordered candidate list from the three sources (URL-deduped, public https only). */
export function collectCandidates(media: MediaById | null, malPictures: string[], web: { url: string; title?: string }[]): ImageChoice[] {
    const out: ImageChoice[] = [];
    const seen = new Set<string>();
    const add = (url: string | null | undefined, source: ChoiceSource, label: string) => {
        if (!url || !isPublicHttpsUrl(url) || seen.has(url) || out.length >= MAX_CANDIDATES) return;
        seen.add(url);
        out.push({ url, source, label: label.slice(0, STORY_TITLE_MAX) });
    };
    const c = media?.coverImage;
    // One AniList cover (the largest): the large/medium files are the same picture at
    // other sizes - different bytes, so the hash dedupe would not merge them.
    add(c?.extraLarge || c?.large || c?.medium, "anilist", "Cover (AniList)");
    add(media?.bannerImage, "banner", "Banner (AniList, cropped)");
    malPictures.forEach((u, i) => add(u, "mal", `MyAnimeList picture ${i + 1}`));
    for (const e of media?.relations?.edges ?? []) {
        const n = e.node;
        const t = n?.title?.english || n?.title?.romaji || "Related";
        add(n?.coverImage?.extraLarge, "relation", `${nice(e.relationType || "related")}: ${t}`);
    }
    web.forEach((w) => add(w.url, "web", w.title || "Web image"));
    return out;
}

/** Keeps the first choice per byte hash; choices whose bytes could not be fetched are dropped. */
export async function dedupeByHash(choices: ImageChoice[], hashOf: (url: string) => Promise<string | null>, concurrency = HASH_CONCURRENCY): Promise<ImageChoice[]> {
    const hashes: (string | null)[] = new Array(choices.length).fill(null);
    let next = 0;
    await Promise.all(
        Array.from({ length: Math.min(concurrency, choices.length) }, async () => {
            while (next < choices.length) {
                const i = next++;
                hashes[i] = await hashOf(choices[i].url).catch(() => null);
            }
        })
    );
    const seen = new Set<string>();
    return choices.flatMap((c, i) => {
        const h = hashes[i];
        if (!h || seen.has(h)) return [];
        seen.add(h);
        return [{ ...c, hash: h }];
    });
}

export const sha256Hex = (b: Buffer) => createHash("sha256").update(b).digest("hex");

export interface ChoiceDeps {
    fetch?: typeof fetch;
    /** Serper images for a query: [] when not configured (no key), null when Serper FAILED. */
    webImages: (query: string, type: MediaType) => Promise<{ url: string; title?: string }[] | null>;
    hashOf: (url: string) => Promise<string | null>;
}

export async function storyImageChoices(src: "anilist" | "mal", id: number, type: MediaType, deps: ChoiceDeps): Promise<ImageChoices | null> {
    const f = deps.fetch ?? fetch;
    const variables = src === "mal" ? { idMal: id, type: upstreamType(type) } : { id };
    const res = await f(ANILIST_GRAPHQL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query: MEDIA_BY_ID, variables }),
        signal: AbortSignal.timeout(8000),
    }).catch(() => null);
    const media: MediaById | null = res?.ok ? (((await res.json().catch(() => ({}))) as { data?: { Media?: MediaById } }).data?.Media ?? null) : null;

    const mediaType: MediaType = type === "NOVEL" ? "NOVEL" : media?.type === "MANGA" ? "MANGA" : media?.type === "ANIME" ? "ANIME" : type;
    const idMal = media?.idMal ?? (src === "mal" ? id : null);
    const title = media?.title?.english || media?.title?.romaji || "";

    let partial = !media;
    const web = title
        ? await deps.webImages(title, mediaType).then(
              (w) => w ?? ((partial = true), []),
              () => ((partial = true), [])
          )
        : [];
    if (!media && web.length === 0) return null;

    const choices = await dedupeByHash(collectCandidates(media, [], web), deps.hashOf);
    return {
        id: media?.id ?? id,
        type: mediaType,
        title: title.slice(0, STORY_TITLE_MAX),
        idMal,
        color: media?.coverImage?.color ?? null,
        choices,
        partial,
    };
}


/* ------------------------- per-source (streamed picker) ------------------------- */
/*
 * T-0010 perf: the picker asks for each SOURCE separately, so a slow source
 * never blocks the other. The client sends only id, type, src and a
 * source NAME - never a URL. Every URL hashed here came from AniList or
 * Serper, fetched by the server. Each source hashes within its own budget so a
 * title never costs more than 40 hash fetches in total. Cross-source dedupe
 * happens in the client by comparing the server-computed hashes.
 */

export const IMAGE_SOURCES = ["anilist", "web"] as const;
export type ImageSourceName = (typeof IMAGE_SOURCES)[number];
export function isImageSource(v: unknown): v is ImageSourceName {
    return typeof v === "string" && (IMAGE_SOURCES as readonly string[]).includes(v);
}
/** Max hash fetches per source; sums to MAX_CANDIDATES (40) per title. */
export const SOURCE_HASH_BUDGET: Record<ImageSourceName, number> = { anilist: 20, web: 20 };

export interface SourceChoices {
    source: ImageSourceName;
    id: number;
    type: MediaType;
    title: string;
    choices: ImageChoice[];
    /** This source failed (or its input, the AniList record, was unavailable): 1 h cache. */
    partial: boolean;
}

export function mediaCacheKey(src: "anilist" | "mal", id: number, type: MediaType): string {
    return `waifu100:storymedia:v1:${src}:${type}:${id}`;
}
export function sourceCacheKey(source: ImageSourceName, src: "anilist" | "mal", id: number, type: MediaType): string {
    return `waifu100:storyimg:v2:${source}:${src}:${type}:${id}`;
}

/** The one AniList query for a title (by AniList id, or by MAL id). null = not found / failed. */
export async function fetchMedia(src: "anilist" | "mal", id: number, type: MediaType, f: typeof fetch = fetch): Promise<MediaById | null> {
    const variables = src === "mal" ? { idMal: id, type: upstreamType(type) } : { id };
    const res = await f(ANILIST_GRAPHQL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query: MEDIA_BY_ID, variables }),
        signal: AbortSignal.timeout(8000),
    }).catch(() => null);
    if (!res?.ok) return null;
    return ((await res.json().catch(() => ({}))) as { data?: { Media?: MediaById } }).data?.Media ?? null;
}

export interface SourceDeps {
    fetch?: typeof fetch;
    webImages: ChoiceDeps["webImages"];
    hashOf: ChoiceDeps["hashOf"];
}

/** Choices from ONE source for a title whose AniList record (`media`) is already known. */
export async function sourceImageChoices(
    source: ImageSourceName,
    ctx: { src: "anilist" | "mal"; id: number; type: MediaType; media: MediaById | null },
    deps: SourceDeps
): Promise<SourceChoices> {
    const { media } = ctx;
    const type: MediaType = ctx.type === "NOVEL" ? "NOVEL" : media?.type === "MANGA" ? "MANGA" : media?.type === "ANIME" ? "ANIME" : ctx.type;
    const title = (media?.title?.english || media?.title?.romaji || "").slice(0, STORY_TITLE_MAX);
    const base = { source, id: media?.id ?? ctx.id, type, title };
    let partial = false;
    let candidates: ImageChoice[] = [];

    if (source === "anilist") {
        if (!media) return { ...base, choices: [], partial: true };
        candidates = collectCandidates(media, [], []);
    } else {
        if (!title) return { ...base, choices: [], partial: !media };
        const web = await deps.webImages(title, type).then(
            (w) => w ?? ((partial = true), []),
            () => ((partial = true), [])
        );
        candidates = collectCandidates(null, [], web);
    }
    const choices = await dedupeByHash(candidates.slice(0, SOURCE_HASH_BUDGET[source]), deps.hashOf);
    return { ...base, choices, partial };
}
