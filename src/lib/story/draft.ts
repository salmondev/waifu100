import { isStorySize, isStoryLayout, DEFAULT_STORY_SIZE, isAllowedStoryImage, STORY_DRAFT_KEY, DEFAULT_TITLE_STYLE, isTitleStyle, type TitleStyle } from "@/lib/story/config";
import { isValidShareId } from "@/lib/share-keys";
import { isMediaType, toMediaType, type MediaType, type StoryItem } from "@/lib/share-schema";

/** The builder's local state, saved in localStorage (never sent anywhere). */
export interface StoryDraft {
    /** Total slots: a preset (9/10/25/50/100) or a custom rows*cols. */
    size: number;
    /** Custom layout columns; absent/null = the preset layout of `size` (all older drafts). */
    cols?: number | null;
    type: MediaType;
    title: string;
    items: (StoryItem | null)[];
    titleStyle: TitleStyle;
    /** Set once this board has a public link. Further edits update that same link. */
    shareId?: string | null;
}

export function emptyDraft(size: number = DEFAULT_STORY_SIZE, cols: number | null = null): StoryDraft {
    if (!isStoryLayout(size, cols)) { size = DEFAULT_STORY_SIZE; cols = null; }
    return { size, cols, type: "ANIME", title: "", items: Array.from({ length: size }, () => null), titleStyle: DEFAULT_TITLE_STYLE, shareId: null };
}

function isItem(v: unknown): v is StoryItem {
    const i = v as StoryItem | null;
    return !!i && typeof i.id === "number" && isMediaType(i.type) && typeof i.title === "string" && isAllowedStoryImage(i.src, i.cover);
}

/** Tolerant parse: anything odd falls back to an empty draft. */
export function parseDraft(raw: string | null): StoryDraft {
    if (!raw) return emptyDraft();
    try {
        const d = JSON.parse(raw) as Partial<StoryDraft>;
        const cols = d.cols != null && isStoryLayout(d.size, d.cols) ? d.cols : null;
        const size = cols !== null || isStorySize(d.size) ? (d.size as number) : DEFAULT_STORY_SIZE;
        const items = Array.from({ length: size }, (_, i) => (Array.isArray(d.items) && isItem(d.items[i]) ? d.items[i] : null));
        return { size, cols, type: toMediaType(d.type), title: typeof d.title === "string" ? d.title.slice(0, 120) : "", items, titleStyle: isTitleStyle(d.titleStyle) ? d.titleStyle : DEFAULT_TITLE_STYLE, shareId: isValidShareId(d.shareId) ? d.shareId : null };
    } catch {
        return emptyDraft();
    }
}

/** Changes the board size, keeping items in order (extra ones drop off the end). */
export function resizeDraft(d: StoryDraft, size: number, cols: number | null = null): StoryDraft {
    if (!isStoryLayout(size, cols)) return d;
    return { ...d, size, cols, items: Array.from({ length: size }, (_, i) => d.items[i] ?? null) };
}

/** Puts an item in `at` (or the first empty slot). Returns null if full or a duplicate. */
export function placeItem(d: StoryDraft, item: StoryItem, at: number | null): StoryDraft | null {
    if (d.items.some((x) => x && x.id === item.id && x.type === item.type && (x.src ?? "anilist") === (item.src ?? "anilist"))) return null;
    const index = at !== null && at >= 0 && at < d.size ? at : d.items.findIndex((x) => x === null);
    if (index < 0) return null;
    const items = d.items.slice();
    items[index] = item;
    return { ...d, items };
}

export const loadDraft = (): StoryDraft => {
    try {
        return parseDraft(window.localStorage.getItem(STORY_DRAFT_KEY));
    } catch {
        return emptyDraft();
    }
};

export const saveDraft = (d: StoryDraft) => {
    try {
        window.localStorage.setItem(STORY_DRAFT_KEY, JSON.stringify(d));
    } catch {
        // private mode / full quota: the board still works this session
    }
};
