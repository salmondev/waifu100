import type { AnalysisResult, GridCell, VerdictFeedback } from "@/types";
import {
    isAllowedStoryImage,
    type StorySource,
    isStorySize,
    isStoryLayout,
    SHARE_TITLE_MAX,
    STORY_TITLE_MAX,
    type StorySize,
    DEFAULT_TITLE_STYLE,
    isTitleStyle,
    type TitleStyle,
} from "@/lib/story/config";
import { isPublicHttpsUrl } from "@/lib/url-safety";

/**
 * The one decoder for `waifu100:share:<id>` payloads.
 *
 * Every shape ever written must keep reading (T-0009 rule: no destructive
 * migration, ever):
 *  - legacy array: the oldest shares, a bare array of `{i, character}` cells;
 *  - v1 object: `{meta, grid, verdict?, verdictFeedback?}` with no `meta.v`;
 *  - v2: v1 plus `meta.v = 2`, `meta.kind`, `meta.size`.
 * Missing kind means waifu, missing size means 100.
 */

export const SHARE_SCHEMA_VERSION = 2;
export const WAIFU_GRID_SIZE = 100;

export type ShareKind = "waifu" | "story";
/** Story cell type. "NOVEL" (light novel, 2026-10-15) is AniList's MANGA type with format NOVEL. */
export type MediaType = "ANIME" | "MANGA" | "NOVEL";
export const MEDIA_TYPES: readonly MediaType[] = ["ANIME", "MANGA", "NOVEL"];

export function isMediaType(v: unknown): v is MediaType {
    return v === "ANIME" || v === "MANGA" || v === "NOVEL";
}

/** Parse a query/form value; anything unknown is ANIME (the old default). */
export function toMediaType(v: unknown): MediaType {
    return isMediaType(v) ? v : "ANIME";
}

/** AniList / Jikan only know ANIME and MANGA; a light novel is looked up as MANGA. */
export function upstreamType(t: MediaType): "ANIME" | "MANGA" {
    return t === "ANIME" ? "ANIME" : "MANGA";
}

/** One story cell as the app uses it. */
export interface StoryItem {
    /** AniList media id (or MAL id when it came from the fallback). */
    id: number;
    type: MediaType;
    title: string;
    cover: string;
    /** Where it came from: anilist (default), mal (Jikan), web (Serper), upload (our Blob). */
    src?: StorySource;
}

/** Stored form of a story cell. Short keys, like the waifu cells. */
export interface StoredStoryCell {
    i: number;
    a: number;
    t: MediaType;
    img: string;
    n?: string;
    src?: Exclude<StorySource, "anilist">;
}

export interface DecodedShare {
    version: 0 | 1 | 2;
    kind: ShareKind;
    size: number;
    /** Story custom layout (2026-10-15): columns, rows = size / cols. Null = preset layout of `size`. */
    cols: number | null;
    title: string;
    imageUrl: string | null;
    createdAt: string | null;
    userId: string | null;
    /** Waifu cells rebuilt into `size` slots; empty slots for a story share. */
    grid: GridCell[];
    /** Story cells rebuilt into `size` slots; all null for a waifu share. */
    items: (StoryItem | null)[];
    /** Display image per slot, for cards. */
    images: (string | null)[];
    count: number;
    /** Story only (T-0010); "overlay" for old shares. */
    titleStyle: TitleStyle;
    /** Published from a build-grid-together session. Absent on every other share. */
    together: boolean;
    verdict: AnalysisResult | null;
    verdictFeedback: VerdictFeedback;
}

export const DEFAULT_TITLES: Record<ShareKind, string> = {
    waifu: "Waifu100 Grid",
    story: "Story100 Grid",
};

/**
 * Image URLs in a saved share must be public https (T-0009 review M3): data:,
 * blob:, http:, javascript: and private hosts are dropped on write AND on read,
 * so even an old or hand-written payload cannot carry inline bytes past
 * /api/img (proxied() passes data:/blob: through for local, unsaved images).
 */
export function safeImageUrl(value: unknown): string | null {
    return isPublicHttpsUrl(value) ? value : null;
}

/** Copy of a waifu character with every image URL made safe. */
export function sanitizeCharacter<T>(character: T): T {
    if (!character || typeof character !== "object") return character;
    const c = character as Record<string, unknown> & { images?: Record<string, Record<string, unknown> | undefined> };
    const out: Record<string, unknown> = { ...c };
    if ("customImageUrl" in c) out.customImageUrl = safeImageUrl(c.customImageUrl) ?? undefined;
    if (c.images && typeof c.images === "object") {
        const images: Record<string, unknown> = {};
        for (const [fmt, set] of Object.entries(c.images)) {
            if (!set || typeof set !== "object") continue;
            const clean: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(set)) clean[k] = typeof v === "string" ? safeImageUrl(v) ?? "" : v;
            images[fmt] = clean;
        }
        out.images = images;
    }
    return out as T;
}

function sanitizeWaifuCells(cells: unknown[]): unknown[] {
    return cells.map((entry) => {
        const e = entry as { character?: unknown } | null;
        return e && typeof e === "object" && e.character ? { ...e, character: sanitizeCharacter(e.character) } : entry;
    });
}

function asString(value: unknown): string | null {
    return typeof value === "string" && value ? value : null;
}

/** Preset or custom layout stored on a share. Anything else is the original 100. */
function readLayout(meta: Record<string, unknown>): { size: number; cols: number | null } {
    const cols = meta.cols != null && isStoryLayout(meta.size, meta.cols) ? (meta.cols as number) : null;
    if (cols !== null) return { size: meta.size as number, cols };
    if (isStorySize(meta.size)) return { size: meta.size as number, cols: null };
    return { size: WAIFU_GRID_SIZE, cols: null };
}

export function shareKindOf(parsed: unknown): ShareKind {
    if (Array.isArray(parsed)) return "waifu";
    const kind = (parsed as { meta?: { kind?: unknown } } | null)?.meta?.kind;
    return kind === "story" ? "story" : "waifu";
}

function decodeStoryCell(entry: unknown, size: number): StoredStoryCell | null {
    const c = entry as Partial<StoredStoryCell> | null;
    if (!c || typeof c.i !== "number" || !Number.isInteger(c.i) || c.i < 0 || c.i >= size) return null;
    if (typeof c.a !== "number" || typeof c.img !== "string") return null;
    if (!isMediaType(c.t)) return null;
    const src = c.src === "mal" || c.src === "web" || c.src === "upload" ? c.src : undefined;
    if (!isAllowedStoryImage(src, c.img)) return null;
    return c as StoredStoryCell;
}

export function decodeShareObject(parsed: unknown): DecodedShare | null {
    if (parsed === null || typeof parsed !== "object") return null;
    const isArray = Array.isArray(parsed);
    const obj = parsed as {
        meta?: Record<string, unknown>;
        grid?: unknown[];
        verdict?: AnalysisResult;
        verdictFeedback?: VerdictFeedback;
    };
    const meta = (isArray ? {} : obj.meta || {}) as Record<string, unknown>;
    const cells: unknown[] = isArray ? (parsed as unknown[]) : Array.isArray(obj.grid) ? obj.grid : [];
    const kind = shareKindOf(parsed);
    const version: 0 | 1 | 2 = isArray ? 0 : meta.v === 2 ? 2 : 1;
    // Custom layouts carry meta.cols. A missing or invalid size is 100, so every
    // legacy waifu share (no meta.size) still reads as a 10×10 board.
    const layout = readLayout(meta);
    const cols = layout.cols;
    const size = layout.size;

    const grid: GridCell[] = Array.from({ length: size }, () => ({ character: null }));
    const items: (StoryItem | null)[] = Array.from({ length: size }, () => null);
    const images: (string | null)[] = Array.from({ length: size }, () => null);

    if (kind === "waifu") {
        cells.forEach((entry) => {
            const item = entry as { i?: number; character?: GridCell["character"] } | null;
            const index = item?.i ?? -1;
            if (index < 0 || index >= size || !item?.character) return;
            const character = sanitizeCharacter(item.character);
            grid[index] = { character };
            images[index] = character.customImageUrl || character.images?.jpg?.image_url || null;
        });
    } else {
        cells.forEach((entry) => {
            const c = decodeStoryCell(entry, size);
            if (!c) return;
            items[c.i] = {
                id: c.a,
                type: c.t,
                title: c.n ?? "",
                cover: c.img,
                src: c.src === "mal" || c.src === "web" || c.src === "upload" ? c.src : "anilist",
            };
            images[c.i] = c.img;
        });
    }

    const count =
        kind === "waifu" ? grid.filter((c) => c.character).length : items.filter(Boolean).length;

    return {
        version,
        kind,
        size,
        cols,
        title: asString(meta.title) || DEFAULT_TITLES[kind],
        imageUrl: safeImageUrl(meta.imageUrl),
        createdAt: asString(meta.createdAt),
        userId: asString(meta.userId),
        titleStyle: isTitleStyle(meta.titleStyle) ? meta.titleStyle : DEFAULT_TITLE_STYLE,
        together: meta.together === true,
        grid,
        items,
        images,
        count,
        verdict: (!isArray && obj.verdict) || null,
        verdictFeedback: (!isArray && obj.verdictFeedback) || null,
    };
}

export function decodeShare(raw: string): DecodedShare | null {
    try {
        return decodeShareObject(JSON.parse(raw));
    } catch {
        return null;
    }
}

/* ---------------------------------- write --------------------------------- */

export interface ShareMetaInput {
    title: string;
    imageUrl?: string | null;
    userId?: string | null;
    createdAt?: string;
    /** Set only by a together-session publish. Omitted otherwise so old payloads stay unchanged. */
    together?: boolean;
}

function baseMeta(kind: ShareKind, input: ShareMetaInput, size: number) {
    return {
        title: input.title,
        createdAt: input.createdAt ?? new Date().toISOString(),
        hasImage: !!safeImageUrl(input.imageUrl),
        imageUrl: safeImageUrl(input.imageUrl) ?? undefined,
        userId: input.userId || undefined,
        v: SHARE_SCHEMA_VERSION,
        kind,
        size,
        ...(input.together ? { together: true } : {}),
    };
}

/**
 * Waifu payload: the v1 shape plus meta.v/kind/size.
 * `size` / `cols` follow the story layout rules. Omitted size stays 100, and
 * `cols` is written only for a custom layout so a preset payload is unchanged.
 */
export function buildWaifuPayload(
    input: ShareMetaInput & {
        grid: unknown[];
        size?: number;
        cols?: number | null;
        verdict?: unknown;
        verdictFeedback?: unknown;
        titleStyle?: unknown;
    }
) {
    const cols = input.cols != null && isStoryLayout(input.size, input.cols) ? input.cols : null;
    const size = cols !== null || isStorySize(input.size) ? (input.size as number) : WAIFU_GRID_SIZE;
    return {
        meta: { ...baseMeta("waifu", input, size), ...(cols != null ? { cols } : {}), titleStyle: isTitleStyle(input.titleStyle) ? input.titleStyle : DEFAULT_TITLE_STYLE },
        grid: sanitizeWaifuCells(input.grid),
        verdict: input.verdict,
        verdictFeedback: input.verdictFeedback,
    };
}

export class ShareValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ShareValidationError";
    }
}

/**
 * Cleans what a browser sent for a story share, or throws ShareValidationError.
 * `cols` (optional): a custom layout; it must be an integer 1-10 dividing `size` into 1-10 rows
 * (2-100 cells). Absent/null = a preset size, as before.
 */
export function cleanStoryCells(size: unknown, cells: unknown, cols?: unknown): { size: number; cols: number | null; cells: StoredStoryCell[] } {
    if (!isStoryLayout(size, cols)) throw new ShareValidationError("Invalid grid size");
    if (!Array.isArray(cells)) throw new ShareValidationError("Invalid grid data");
    const seen = new Set<number>();
    const out: StoredStoryCell[] = [];
    for (const entry of cells) {
        const c = entry as Partial<StoredStoryCell & { n: unknown }> | null;
        if (!c || typeof c.i !== "number" || !Number.isInteger(c.i) || c.i < 0 || c.i >= size) continue;
        if (seen.has(c.i)) continue;
        if (typeof c.a !== "number" || !Number.isInteger(c.a) || c.a <= 0) continue;
        if (!isMediaType(c.t)) continue;
        const src: StorySource = c.src === "mal" || c.src === "web" || c.src === "upload" ? c.src : "anilist";
        if (!isAllowedStoryImage(src, c.img)) continue;
        seen.add(c.i);
        const cell: StoredStoryCell = { i: c.i, a: c.a, t: c.t, img: c.img };
        if (typeof c.n === "string" && c.n.trim()) cell.n = c.n.trim().slice(0, STORY_TITLE_MAX);
        if (src !== "anilist") cell.src = src;
        out.push(cell);
    }
    if (out.length === 0) throw new ShareValidationError("Grid is empty");
    return { size, cols: cols == null ? null : (cols as number), cells: out.sort((a, b) => a.i - b.i) };
}

export function buildStoryPayload(input: ShareMetaInput & { size: number; cols?: number | null; cells: StoredStoryCell[]; titleStyle?: unknown }) {
    // `cols` only for custom layouts, so preset shares keep exactly the old payload shape.
    const cols = input.cols != null && isStoryLayout(input.size, input.cols) ? { cols: input.cols } : {};
    return {
        meta: { ...baseMeta("story", input, input.size), ...cols, titleStyle: isTitleStyle(input.titleStyle) ? input.titleStyle : DEFAULT_TITLE_STYLE },
        grid: input.cells,
    };
}

export function cleanTitle(value: unknown, kind: ShareKind): string {
    if (typeof value !== "string" || !value.trim()) return DEFAULT_TITLES[kind];
    return value.trim().slice(0, SHARE_TITLE_MAX);
}

/** Story item -> stored cell (client side, before POST). */
export function toStoredStoryCell(i: number, item: StoryItem): StoredStoryCell {
    const cell: StoredStoryCell = { i, a: item.id, t: item.type, img: item.cover };
    if (item.title) cell.n = item.title.slice(0, STORY_TITLE_MAX);
    if (item.src && item.src !== "anilist") cell.src = item.src;
    return cell;
}

/** Feed indexes a share belongs in: every share in the main feed, story shares also in feed:story. */
export function feedKeysForShare(raw: string): string[] {
    try {
        return shareKindOf(JSON.parse(raw)) === "story" ? ["waifu100:feed", "waifu100:feed:story"] : ["waifu100:feed"];
    } catch {
        return ["waifu100:feed"];
    }
}
