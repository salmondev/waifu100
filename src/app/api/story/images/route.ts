import { NextRequest, NextResponse } from "next/server";
import { withRedis } from "@/lib/redis";
import { consume, LIMITS } from "@/lib/rate-limit";
import { toMediaType, type MediaType } from "@/lib/share-schema";
import {
    choicesTtl,
    fetchMedia,
    hashImage,
    isImageSource,
    mediaCacheKey,
    sourceCacheKey,
    sourceImageChoices,
    type MediaById,
    CHOICES_CACHE_TTL_SEC,
} from "@/server/story-images";
import { storyWebSearch, WEB_CACHE_TTL_SEC } from "@/server/story-web-search";

export const runtime = "nodejs";
export const maxDuration = 30;

const redisGet = (k: string) => (process.env.REDIS_URL ? withRedis((r) => r.get(k)) : Promise.resolve(null));
const redisSet = async (k: string, v: string, ttl: number) => {
    if (process.env.REDIS_URL) await withRedis((r) => r.set(k, v, "EX", ttl));
};

/** In-process de-dup of concurrent work (the picker's 3 parallel requests share one AniList lookup). */
const inflight = new Map<string, Promise<unknown>>();
function once<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const hit = inflight.get(key) as Promise<T> | undefined;
    if (hit) return hit;
    const p = fn().finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
}

type Limited = { limited: true };

/** Media records also kept in memory (works without Redis; keeps "one limit per title"). */
const mediaMemo = new Map<string, { v: MediaById; exp: number }>();
const MEMO_MAX = 500;
function memoGet(k: string): MediaById | null {
    const e = mediaMemo.get(k);
    if (!e || e.exp < Date.now()) return null;
    return e.v;
}
function memoSet(k: string, v: MediaById) {
    if (mediaMemo.size >= MEMO_MAX) mediaMemo.delete(mediaMemo.keys().next().value as string);
    mediaMemo.set(k, { v, exp: Date.now() + CHOICES_CACHE_TTL_SEC * 1000 });
}

/**
 * The title's AniList record, cached 7 days. The per-IP limit is consumed
 * HERE, once per new title (not once per source request).
 */
async function getMedia(req: NextRequest, src: "anilist" | "mal", id: number, type: MediaType): Promise<MediaById | null | Limited> {
    const key = mediaCacheKey(src, id, type);
    const mem = memoGet(key);
    if (mem) return mem;
    const hit = await redisGet(key).catch(() => null);
    if (hit) {
        try {
            return JSON.parse(hit) as MediaById;
        } catch {
            /* refetch */
        }
    }
    return once(key, async () => {
        if (!(await consume(req, LIMITS.storyImages)).allowed) return { limited: true } as Limited;
        const media = await fetchMedia(src, id, type);
        if (media) {
            memoSet(key, media);
            await redisSet(key, JSON.stringify(media), CHOICES_CACHE_TTL_SEC).catch(() => {});
        }
        return media;
    });
}

/**
 * GET /api/story/images?id=&type=ANIME|MANGA&src=anilist|mal&source=anilist|jikan|web
 * T-0010: one request per SOURCE so the picker fills in progressively. The
 * client sends only ids and a source name; every URL hashed here came from the
 * sources themselves. Per source: 7-day cache, 1 hour when that source failed.
 * URLs returned are only ever displayed via /api/img.
 */
export async function GET(req: NextRequest) {
    const p = req.nextUrl.searchParams;
    const id = Number(p.get("id"));
    const type = toMediaType(p.get("type"));
    const src = p.get("src") === "mal" ? "mal" : "anilist";
    const source = p.get("source") ?? "anilist";
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Invalid title id." }, { status: 400 });
    if (!isImageSource(source)) return NextResponse.json({ error: "Unknown image source." }, { status: 400 });

    const key = sourceCacheKey(source, src, id, type);
    const hit = await redisGet(key).catch(() => null);
    if (hit) {
        try {
            return NextResponse.json({ ...JSON.parse(hit), cached: true });
        } catch {
            /* fall through */
        }
    }

    const media = await getMedia(req, src, id, type).catch(() => null);
    if (media && "limited" in media) {
        return NextResponse.json({ error: "Too many new titles at once - wait a few seconds and try again." }, { status: 429 });
    }

    const result = await once(key, () =>
        sourceImageChoices(source, { src, id, type, media }, {
            webImages: async (q, t) => {
                const r = await storyWebSearch(q, t, {
                    apiKey: process.env.SERPER_API_KEY,
                    cacheGet: (k) => redisGet(k).catch(() => null),
                    cacheSet: (k, v) => redisSet(k, v, WEB_CACHE_TTL_SEC).catch(() => {}),
                    allowMiss: async () => true, // the per-title limit was applied in getMedia
                });
                if (r.ok) return r.items.map((i) => ({ url: i.cover, title: i.title }));
                return r.status === 503 ? [] : null; // 503 = no key: quietly none; anything else is a Serper failure
            },
            hashOf: (url) => hashImage(url), // over HASH_MAX_BYTES => dropped, not partial
        })
    ).catch(() => null);

    if (!result) return NextResponse.json({ error: "Couldn't load images from this source right now." }, { status: 502 });
    await redisSet(key, JSON.stringify(result), choicesTtl(result)).catch(() => {});
    return NextResponse.json({ ...result, cached: false });
}
