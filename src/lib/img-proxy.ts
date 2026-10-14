/**
 * The one way the browser loads a remote image: through /api/img, which
 * moderates by content hash and serves only checked bytes (T-0009 A).
 * Local previews (data:/blob:) and same-origin paths pass through untouched.
 */
export const IMG_PROXY_PATH = "/api/img";

export function proxied(url: string | null | undefined, width = 256): string {
    if (!url) return "";
    if (url.startsWith("data:") || url.startsWith("blob:")) return url;
    // Same-origin path only; "//host" and "/\\host" are protocol-relative remote URLs (review M4).
    if (url.startsWith("/")) return /^\/[\/\\]/.test(url) ? "" : url;
    if (!/^https:\/\//i.test(url)) return ""; // http and others are never shown
    return `${IMG_PROXY_PATH}?u=${encodeURIComponent(url)}&w=${width}`;
}

/** Absolute proxied URL (og:image needs one). */
export function proxiedAbsolute(origin: string, url: string | null | undefined, width = 512): string {
    const p = proxied(url, width);
    return p.startsWith("/") ? `${origin}${p}` : p;
}
