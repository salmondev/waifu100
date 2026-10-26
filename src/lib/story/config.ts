import { isPublicHttpsUrl } from "@/lib/url-safety";

/**
 * Story100 settings in one place, so product decisions stay one-line changes.
 * (T-0009 defaults: Q1 All tab, Q2 store title <=120, Q3 no AI verdict,
 * Q4 same-kind compare only, Q5 hide adult, Q6 /story/v/[id] + "Story100",
 * Q7 no uploaded covers.)
 */

export const STORY_BRAND = "Story100";

/** Grid sizes a story grid may have. 9 is the 3x3 board, 25 the 5x5 one. */
export const STORY_SIZES = [9, 10, 25, 50, 100] as const;
export type StorySize = (typeof STORY_SIZES)[number];
/** New boards start as 3x3 (2026-10-14). Saved drafts and shares keep their own size. */
export const DEFAULT_STORY_SIZE: StorySize = 9;

export function isStorySize(value: unknown): value is StorySize {
    return typeof value === "number" && (STORY_SIZES as readonly number[]).includes(value);
}

/**
 * Custom grids (2026-10-15): rows x cols, each side 1-10, total 2-100.
 *  - 10 per side / 100 cells is the largest preset (Top 100), so nothing new gets bigger than
 *    what the share payload, the OG card (80px cells at 10 wide) and the PNG export already handle.
 *  - 2 cells minimum: a 1x1 "grid" is not a list.
 * A custom layout is stored as `size` (total) plus `cols`; rows = size / cols. Shares and
 * drafts without `cols` (everything before this) keep the preset layout of their size.
 */
export const STORY_MIN_SIDE = 1;
export const STORY_MAX_SIDE = 10;
export const STORY_MIN_CELLS = 2;
export const STORY_MAX_CELLS = 100;

/** Columns of the preset layout for a size (legacy shares/drafts have no `cols`). */
function presetColumns(size: number): number {
    if (size === 9) return 3;
    if (size === 10 || size === 25) return 5;
    return 10;
}

/** Columns used to lay a grid out (builder, page, PNG, OG). `cols` wins when it is a valid layout. */
export function storyColumns(size: number, cols?: number | null): number {
    return cols != null && isStoryLayout(size, cols) ? cols : presetColumns(size);
}

const sideOk = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= STORY_MIN_SIDE && n <= STORY_MAX_SIDE;

/**
 * A valid story layout: a preset size with no `cols` (legacy), or a custom rows x cols with
 * integer sides in 1-10 and 2-100 cells. Used by the client, the board file and the server.
 */
export function isStoryLayout(size: unknown, cols?: unknown): size is number {
    if (cols === undefined || cols === null) return isStorySize(size);
    if (!sideOk(cols) || typeof size !== "number" || !Number.isInteger(size)) return false;
    if (size < STORY_MIN_CELLS || size > STORY_MAX_CELLS || size % cols !== 0) return false;
    return sideOk(size / cols);
}

/** Clamps user input to a valid custom side (1-10, integer); rows*cols >= 2 is fixed up by the caller. */
export function clampSide(value: unknown): number {
    const n = Math.round(Number(value));
    return Number.isFinite(n) ? Math.min(STORY_MAX_SIDE, Math.max(STORY_MIN_SIDE, n)) : STORY_MIN_SIDE;
}

/** "3×3", "Top 10", or "4×6" for a custom grid (rows × cols). */
export function storySizeLabel(size: number, cols?: number | null): string {
    if (cols == null && isStorySize(size)) return STORY_SIZE_LABELS[size];
    const c = storyColumns(size, cols);
    return `${Math.ceil(size / c)}×${c}`;
}

export const STORY_SIZE_LABELS: Record<StorySize, string> = {
    9: "3×3",
    10: "Top 10",
    25: "5×5",
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
