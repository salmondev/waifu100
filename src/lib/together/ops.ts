import { isStoryLayout, isTitleStyle, STORY_TITLE_MAX, DEFAULT_STORY_SIZE, DEFAULT_TITLE_STYLE, type TitleStyle } from "@/lib/story/config";
import { isMediaType, type MediaType, type StoryItem } from "@/lib/share-schema";
import { isPublicHttpsUrl } from "@/lib/url-safety";

/** One story cell in a together room. Covers must be public https. */
export type TogetherItem = StoryItem;

/** One waifu cell. `img` is the picture currently on the grid. */
export interface WaifuCell {
    mal_id: number;
    name: string;
    img: string;
    source?: string;
}

export type TogetherKind = "story" | "waifu";
export type TogetherCell = TogetherItem | WaifuCell;

export interface TogetherState {
    kind: TogetherKind;
    size: number;
    cols: number | null;
    title: string;
    titleStyle: TitleStyle;
    items: (TogetherCell | null)[];
}

export type TogetherOp =
    | { t: "place"; i: number; item: TogetherCell }
    | { t: "swap"; from: number; to: number }
    | { t: "lift"; i: number }
    | { t: "title"; title: string }
    | { t: "layout"; size: number; cols: number | null }
    | { t: "style"; titleStyle: TitleStyle }
    | { t: "kind"; kind: TogetherKind }
    | { t: "cover"; i: number; cover: string };

export function isWaifuCell(cell: TogetherCell): cell is WaifuCell {
    return "mal_id" in cell;
}

const keyOf = (item: TogetherCell) => isWaifuCell(item) ? `waifu:${item.mal_id}:${item.name}` : `${item.src ?? "anilist"}:${item.type}:${item.id}`;

export function emptyTogether(size = DEFAULT_STORY_SIZE, cols: number | null = null, title = "", kind: TogetherKind = "story", titleStyle: TitleStyle = DEFAULT_TITLE_STYLE): TogetherState {
    const ok = isStoryLayout(size, cols);
    const s = ok ? size : DEFAULT_STORY_SIZE;
    const c = ok ? cols : null;
    return { kind, size: s, cols: c, title: title.slice(0, STORY_TITLE_MAX), titleStyle: isTitleStyle(titleStyle) ? titleStyle : DEFAULT_TITLE_STYLE, items: Array.from({ length: s }, () => null) };
}

export function cleanTogetherItem(value: unknown): TogetherItem | null {
    const v = value as Partial<TogetherItem> | null;
    if (!v || typeof v.id !== "number" || !Number.isInteger(v.id) || v.id <= 0) return null;
    if (!isMediaType(v.type)) return null;
    if (typeof v.title !== "string" || !v.title.trim()) return null;
    if (!isPublicHttpsUrl(v.cover)) return null;
    const src = v.src === "mal" || v.src === "web" || v.src === "upload" ? v.src : "anilist";
    return { id: v.id, type: v.type as MediaType, title: v.title.trim().slice(0, STORY_TITLE_MAX), cover: v.cover, src };
}

export function cleanWaifuCell(value: unknown): WaifuCell | null {
    const v = value as Partial<WaifuCell> | null;
    if (!v || typeof v.mal_id !== "number" || !Number.isInteger(v.mal_id)) return null;
    if (typeof v.name !== "string" || !v.name.trim()) return null;
    if (!isPublicHttpsUrl(v.img)) return null;
    return { mal_id: v.mal_id, name: v.name.trim().slice(0, STORY_TITLE_MAX), img: v.img, source: typeof v.source === "string" ? v.source.slice(0, 80) : undefined };
}

export function cleanTogetherCell(kind: TogetherKind, value: unknown): TogetherCell | null {
    return kind === "waifu" ? cleanWaifuCell(value) : cleanTogetherItem(value);
}

/** Apply one edit. Returns null when the room rejects it (occupied cell, duplicate, guest renaming). */
export function applyTogetherOp(state: TogetherState, op: TogetherOp, owner: boolean): TogetherState | null {
    if (op.t === "title") {
        if (!owner) return null;
        const title = typeof op.title === "string" ? op.title.slice(0, STORY_TITLE_MAX) : "";
        return { ...state, title };
    }
    if (op.t === "lift") {
        if (!Number.isInteger(op.i) || op.i < 0 || op.i >= state.size || !state.items[op.i]) return null;
        const items = state.items.slice();
        items[op.i] = null;
        return { ...state, items };
    }
    if (op.t === "swap") {
        const { from, to } = op;
        if (!Number.isInteger(from) || !Number.isInteger(to) || from === to) return null;
        if (from < 0 || to < 0 || from >= state.size || to >= state.size) return null;
        const items = state.items.slice();
        [items[from], items[to]] = [items[to], items[from]];
        return { ...state, items };
    }
    if (op.t === "place") {
        const item = cleanTogetherCell(state.kind, op.item);
        if (!item || !Number.isInteger(op.i) || op.i < 0 || op.i >= state.size) return null;
        if (state.items[op.i]) return null;
        if (state.items.some((x) => x && keyOf(x) === keyOf(item))) return null;
        const items = state.items.slice();
        items[op.i] = item;
        return { ...state, items };
    }
    if (op.t === "layout") {
        if (!owner || !isStoryLayout(op.size, op.cols)) return null;
        const items = Array.from({ length: op.size }, (_, i) => state.items[i] ?? null);
        return { ...state, size: op.size, cols: op.cols, items };
    }
    if (op.t === "style") {
        if (!owner || !isTitleStyle(op.titleStyle)) return null;
        return { ...state, titleStyle: op.titleStyle };
    }
    if (op.t === "kind") {
        if (!owner || (op.kind !== "story" && op.kind !== "waifu") || op.kind === state.kind) return null;
        return { ...state, kind: op.kind, items: Array.from({ length: state.size }, () => null) };
    }
    if (op.t === "cover") {
        const cell = state.items[op.i];
        if (!cell || !isPublicHttpsUrl(op.cover)) return null;
        const items = state.items.slice();
        items[op.i] = isWaifuCell(cell) ? { ...cell, img: op.cover } : { ...cell, cover: op.cover };
        return { ...state, items };
    }
    return null;
}
