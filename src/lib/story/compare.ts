import type { StoryItem } from "@/lib/share-schema";

/** Story-vs-story comparison (item 5). Pure; same kind only by construction. */
export const storyItemKey = (i: StoryItem) => `${i.src ?? "anilist"}:${i.type}:${i.id}`;

export interface StoryCompareResult {
    shared: { item: StoryItem; rankA: number; rankB: number }[];
    onlyA: StoryItem[];
    onlyB: StoryItem[];
    /** Shared / smaller grid's filled count, 0-100. */
    similarity: number;
}

export function compareStoryGrids(a: (StoryItem | null)[], b: (StoryItem | null)[]): StoryCompareResult {
    const rankB = new Map<string, number>();
    b.forEach((it, i) => it && !rankB.has(storyItemKey(it)) && rankB.set(storyItemKey(it), i + 1));
    const seenA = new Set<string>();
    const shared: StoryCompareResult["shared"] = [];
    const onlyA: StoryItem[] = [];
    a.forEach((it, i) => {
        if (!it) return;
        const k = storyItemKey(it);
        if (seenA.has(k)) return;
        seenA.add(k);
        const r = rankB.get(k);
        if (r) shared.push({ item: it, rankA: i + 1, rankB: r });
        else onlyA.push(it);
    });
    const onlyB = b.filter((it): it is StoryItem => !!it && !seenA.has(storyItemKey(it)));
    const filledA = a.filter(Boolean).length;
    const filledB = b.filter(Boolean).length;
    const denom = Math.min(filledA, filledB);
    return { shared, onlyA, onlyB, similarity: denom ? Math.round((shared.length / denom) * 100) : 0 };
}

export const storyComparePath = (a: string, b: string) => `/story/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`;
