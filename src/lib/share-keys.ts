/**
 * Redis key names and id validation for shares. Dependency-free, so both the
 * read helpers (share-store.ts) and the Effect repo (server/share-repo.ts) can
 * import it without a cycle.
 */
export const SHARE_KEY_PREFIX = "waifu100:share:";
export const FEED_KEY = "waifu100:feed";
export const STORY_FEED_KEY = "waifu100:feed:story";

export function shareKey(id: string): string {
    return `${SHARE_KEY_PREFIX}${id}`;
}

/** Ids reach us from query strings; shape-check before building a key. */
export function isValidShareId(value: unknown): value is string {
    return typeof value === "string" && value.length > 0 && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}
