import { isPublicHttpsUrl } from "@/lib/url-safety";

/**
 * Story100 settings in one place, so product decisions stay one-line changes.
 * (T-0009 defaults: Q1 All tab, Q2 store title <=120, Q3 no AI verdict,
 * Q4 same-kind compare only, Q5 hide adult, Q6 /story/v/[id] + "Story100",
 * Q7 no uploaded covers.)
 */

export const STORY_BRAND = "Story100";

/** Grid sizes a story grid may have. 9 is the 3x3 board. */
export const STORY_SIZES = [9, 10, 50, 100] as const;
export type StorySize = (typeof STORY_SIZES)[number];
export const DEFAULT_STORY_SIZE: StorySize = 10;

export function isStorySize(value: unknown): value is StorySize {
    return typeof value === "number" && (STORY_SIZES as readonly number[]).includes(value);
}

/** Columns used to lay a grid of this size out (page and OG card). */
export function storyColumns(size: number): number {
    if (size === 9) return 3;
    if (size === 10) return 5;
    return 10;
}

export const STORY_SIZE_LABELS: Record<StorySize, string> = {
    9: "3×3",
    10: "Top 10",
    50: "Top 50",
    100: "Top 100",
};

/** Q2: a short title is stored per cell, capped. */
export const STORY_TITLE_MAX = 120;
export const SHARE_TITLE_MAX = 120;

/** C (2026-10-14): story grids get the AI verdict too (shares Gemini quota). */
export const STORY_VERDICT_ENABLED = true;

/** Q4: compare only grids of the same kind. */
export const COMPARE_SAME_KIND_ONLY = true;

/**
 * B (2026-10-14): no isAdult/sfw filter at the source; every image is
 * moderated by content instead (src/server/moderation). Titles are text only.
 */

/** The AniList / MyAnimeList image CDNs (strict allowlist, used by fetchCover). */
export const COVER_HOSTS = ["s4.anilist.co", "cdn.myanimelist.net"] as const;

/**
 * T-0010 (SECURITY REVIEW NEEDED): story covers may now be ANY public https
 * image (Serper web results, MAL pictures, relation covers), the same rule as
 * the waifu side. Safety comes from display: every image is shown only via
 * proxied() -> /api/img (SSRF guard + content-hash moderation).
 */
export function isAllowedCoverUrl(value: unknown): value is string {
    return isPublicHttpsUrl(value);
}

/** Strict CDN allowlist (exact host, https, no userinfo/port). */
export function isCdnCoverUrl(value: unknown): value is string {
    if (typeof value !== "string" || value.length > 500) return false;
    try {
        const url = new URL(value);
        // https only, exact host match, no userinfo, default port.
        return (
            url.protocol === "https:" &&
            !url.username &&
            !url.password &&
            url.port === "" &&
            (COVER_HOSTS as readonly string[]).includes(url.hostname)
        );
    } catch {
        return false;
    }
}

/** Vercel Blob public host for our uploads (D). Store id label + fixed suffix. */
export function isOwnBlobUrl(value: unknown): value is string {
    if (typeof value !== "string" || value.length > 500) return false;
    try {
        const url = new URL(value);
        return (
            url.protocol === "https:" && !url.username && !url.password && url.port === "" &&
            /^[a-z0-9]+\.public\.blob\.vercel-storage\.com$/.test(url.hostname)
        );
    } catch {
        return false;
    }
}

export type StorySource = "anilist" | "mal" | "web" | "upload";

/** Which image URLs a story cell may hold, by where the item came from. */
export function isAllowedStoryImage(src: StorySource | undefined, value: unknown): value is string {
    if (src === "upload") return isOwnBlobUrl(value);
    return isAllowedCoverUrl(value); // anilist, mal, web: any public https (T-0010)
}

/** Q6 */
export function storyViewPath(id: string): string {
    return `/story/v/${id}`;
}

export const STORY_DRAFT_KEY = "story100-draft";

/** T-0010: where a cell's title is drawn. Old shares without it read as "overlay". */
export const TITLE_STYLES = ["overlay", "below", "hidden"] as const;
export type TitleStyle = (typeof TITLE_STYLES)[number];
export const DEFAULT_TITLE_STYLE: TitleStyle = "overlay";
export const TITLE_STYLE_LABELS: Record<TitleStyle, string> = { overlay: "On image", below: "Below", hidden: "Hidden" };
export function isTitleStyle(v: unknown): v is TitleStyle {
    return typeof v === "string" && (TITLE_STYLES as readonly string[]).includes(v);
}
