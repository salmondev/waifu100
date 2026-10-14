import { isCdnCoverUrl } from "@/lib/story/config";
import { ImageFetchError, safeFetchImage, type SafeFetchOptions } from "@/server/moderation/safe-fetch";

/** Story cover fetch: safe-fetch plus the exact-host CDN allowlist on every hop. */
export const COVER_MAX_BYTES = 5 * 1024 * 1024;
export { ImageFetchError as CoverFetchError };

export async function fetchCover(url: string, opts: Omit<SafeFetchOptions, "allow"> = {}) {
    return safeFetchImage(url, { maxBytes: COVER_MAX_BYTES, ...opts, allow: isCdnCoverUrl });
}
