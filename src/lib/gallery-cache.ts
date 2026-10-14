/**
 * Client-side cache of /api/gallery answers (T-0013). Clicking a filled cell
 * re-opens that character's gallery; when it was already loaded this session,
 * reuse it instead of another request (each one can spend Serper credit).
 * Only non-empty successful answers are kept, for 10 minutes, at most 50.
 */
export interface GalleryKey {
    characterName: string;
    animeSource?: string;
    malId?: number | null;
    isGif: boolean;
}
const TTL_MS = 10 * 60_000;
const MAX = 50;
const cache = new Map<string, { at: number; images: unknown[] }>();
const k = (q: GalleryKey) => JSON.stringify([q.characterName.trim().toLowerCase(), q.animeSource ?? "", q.malId ?? null, q.isGif]);

export function getCachedGallery<T>(q: GalleryKey, now = Date.now()): T[] | null {
    const hit = cache.get(k(q));
    if (!hit || now - hit.at > TTL_MS) return null;
    return hit.images as T[];
}
export function cacheGallery(q: GalleryKey, images: unknown[], now = Date.now()) {
    if (!images.length) return;
    if (cache.size >= MAX) cache.delete(cache.keys().next().value as string);
    cache.set(k(q), { at: now, images });
}
/** Test hook. */
export function clearGalleryCache() {
    cache.clear();
}
