import { isStorySize, DEFAULT_STORY_SIZE, isAllowedStoryImage, STORY_DRAFT_KEY, type StorySize, DEFAULT_TITLE_STYLE, isTitleStyle, type TitleStyle } from "@/lib/story/config";
import type { MediaType, StoryItem } from "@/lib/share-schema";

/** The builder's local state, saved in localStorage (never sent anywhere). */
export interface StoryDraft {
    size: StorySize;
    type: MediaType;
    title: string;
    items: (StoryItem | null)[];
    titleStyle: TitleStyle;
}

export function emptyDraft(size: StorySize = DEFAULT_STORY_SIZE): StoryDraft {
    return { size, type: "ANIME", title: "", items: Array.from({ length: size }, () => null), titleStyle: DEFAULT_TITLE_STYLE };
}

function isItem(v: unknown): v is StoryItem {
    const i = v as StoryItem | null;
    return !!i && typeof i.id === "number" && (i.type === "ANIME" || i.type === "MANGA") && typeof i.title === "string" && isAllowedStoryImage(i.src, i.cover);
}

/** Tolerant parse: anything odd falls back to an empty draft. */
export function parseDraft(raw: string | null): StoryDraft {
    if (!raw) return emptyDraft();
    try {
        const d = JSON.parse(raw) as Partial<StoryDraft>;
        const size = isStorySize(d.size) ? d.size : DEFAULT_STORY_SIZE;
        const items = Array.from({ length: size }, (_, i) => (Array.isArray(d.items) && isItem(d.items[i]) ? d.items[i] : null));
        return { size, type: d.type === "MANGA" ? "MANGA" : "ANIME", title: typeof d.title === "string" ? d.title.slice(0, 120) : "", items, titleStyle: isTitleStyle(d.titleStyle) ? d.titleStyle : DEFAULT_TITLE_STYLE };
    } catch {
        return emptyDraft();
    }
}

/** Changes the board size, keeping items in order (extra ones drop off the end). */
export function resizeDraft(d: StoryDraft, size: StorySize): StoryDraft {
    return { ...d, size, items: Array.from({ length: size }, (_, i) => d.items[i] ?? null) };
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
