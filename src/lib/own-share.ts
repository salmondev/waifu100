import type { AnalysisResult, GridCell, VerdictFeedback } from "@/types";
import { toStoredStoryCell, type ShareKind, type StoryItem } from "@/lib/share-schema";
import type { TitleStyle } from "@/lib/story/config";
import type { StoryDraft } from "@/lib/story/draft";
import { USER_ID_HEADER, ensureUserId } from "@/lib/user-id";

/** The board the editor fetches. No owner id. */
export interface EditShare {
    kind: ShareKind;
    title: string;
    size: number;
    cols: number | null;
    titleStyle: TitleStyle;
    owned: boolean;
    grid: GridCell[];
    items: (StoryItem | null)[];
    verdict: AnalysisResult | null;
    verdictFeedback: VerdictFeedback;
}

export async function loadShareForEdit(id: string): Promise<EditShare | null> {
    const userId = ensureUserId();
    const res = await fetch(`/api/share/${id}`, {
        headers: userId ? { [USER_ID_HEADER]: userId } : {},
    }).catch(() => null);
    if (!res || !res.ok) return null;
    const data = (await res.json().catch(() => null)) as EditShare | null;
    if (!data || (data.kind !== "waifu" && data.kind !== "story")) return null;
    return data;
}

export async function updateOwnShare(id: string, body: Record<string, unknown>): Promise<{ ok: true } | { ok: false; error: string }> {
    const userId = ensureUserId();
    if (!userId) return { ok: false, error: "This browser can't remember which grids are yours." };
    const res = await fetch(`/api/share/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", [USER_ID_HEADER]: userId },
        body: JSON.stringify(body),
    }).catch(() => null);
    if (!res) return { ok: false, error: "Couldn't reach the server." };
    if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        return { ok: false, error: data.error || "Couldn't save your grid." };
    }
    return { ok: true };
}

/** Story cells ready to PUT. Null when the board is empty or still holds a local image. */
export function storySyncBody(d: StoryDraft): Record<string, unknown> | null {
    const cells = [];
    for (let i = 0; i < d.items.length; i++) {
        const item = d.items[i];
        if (!item) continue;
        if (item.cover.startsWith("data:") || item.cover.startsWith("blob:")) return null;
        cells.push(toStoredStoryCell(i, item));
    }
    if (cells.length === 0) return null;
    return {
        kind: "story",
        size: d.size,
        ...(d.cols ? { cols: d.cols } : {}),
        grid: cells,
        customTitle: d.title,
        titleStyle: d.titleStyle,
    };
}
