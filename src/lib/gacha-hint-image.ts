/**
 * Image hints (blur, silhouette) are served by /api/gacha/hint-image from an
 * opaque per-round token, never from the character's real image URL.
 * Shared by the server (builds the URL) and the client (checks it before it
 * reaches an <img>), so it must stay free of node-only imports.
 */
export const HINT_IMAGE_PATH = "/api/gacha/hint-image";

export type HintImageKind = "blur" | "silhouette";

/** base64url token, see src/server/gacha/hint-image.ts for its shape. */
const TOKEN = /^[A-Za-z0-9_-]{24,200}$/;

export function isHintImageToken(token: unknown): token is string {
    return typeof token === "string" && TOKEN.test(token);
}

export function hintImagePath(token: string): string {
    return `${HINT_IMAGE_PATH}?t=${token}`;
}

/**
 * The only way a hint image reaches an <img>: same-origin hint endpoint or
 * nothing. Anything else (a raw AniList URL from a stale or tampered DTO)
 * becomes "" and the slot shows its missing state.
 */
export function hintImageSrc(src: unknown): string {
    if (typeof src !== "string" || !src.startsWith(`${HINT_IMAGE_PATH}?t=`)) return "";
    return isHintImageToken(src.slice(HINT_IMAGE_PATH.length + 3)) ? src : "";
}
