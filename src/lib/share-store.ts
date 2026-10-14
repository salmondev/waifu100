import { Effect } from "effect";
import { SHARE_KEY_PREFIX, shareKey, isValidShareId } from "@/lib/share-keys";
import { ShareRepo } from "@/server/share-repo";
import { runApp } from "@/server/run";
import { GridCell, AnalysisResult, VerdictFeedback } from "@/types";
import { decodeShare, type ShareKind, type StoryItem } from "@/lib/share-schema";

/**
 * Reading a stored share back into a grid.
 *
 * The parsing rules live here rather than in each route because they are not
 * obvious and they are easy to get subtly wrong: the payload has two historical
 * shapes (a bare array from the earliest shares, an object with `meta`/`grid`
 * since), and cells carry their own index, so a grid must be rebuilt into 100
 * slots rather than read positionally.
 */

export { SHARE_KEY_PREFIX, shareKey, isValidShareId };
export const GRID_SIZE = 100;

export interface StoredShare {
    id: string;
    title: string;
    grid: GridCell[];
    imageUrl: string | null;
    createdAt: string | null;
    verdict: AnalysisResult | null;
    verdictFeedback: VerdictFeedback;
    /** "waifu" for every share written before story100 existed. */
    kind: ShareKind;
    /** Slots in the grid: 100 for waifu, 9/10/50/100 for story. */
    size: number;
    /** Story custom layout columns (null = preset layout of `size`). */
    cols: number | null;
    /** Story cells (all null for a waifu share). */
    items: (StoryItem | null)[];
}

export function parseShare(id: string, raw: string): StoredShare | null {
    // All shapes (legacy array, v1 object, v2 waifu/story) are decoded in
    // share-schema.ts; this keeps the historical StoredShare contract.
    const d = decodeShare(raw);
    if (!d) return null;
    return {
        id,
        title: d.title,
        grid: d.kind === "waifu" ? d.grid : Array.from({ length: GRID_SIZE }, () => ({ character: null })),
        imageUrl: d.imageUrl,
        createdAt: d.createdAt,
        verdict: d.verdict,
        verdictFeedback: d.verdictFeedback,
        kind: d.kind,
        size: d.size,
        cols: d.cols,
        items: d.items,
    };
}

/**
 * Reads one share (Effect ShareRepo underneath). Null when missing or invalid;
 * a Redis failure rejects, as before.
 */
export async function readShare(id: string): Promise<StoredShare | null> {
    if (!isValidShareId(id)) return null;
    const raw = await runApp(Effect.gen(function* () { return yield* (yield* ShareRepo).getRaw(id); }));
    return raw ? parseShare(id, raw) : null;
}

/** Reads several shares in one pipeline (compare needs two at once). */
export async function readShares(ids: string[]): Promise<(StoredShare | null)[]> {
    if (ids.length === 0) return [];
    if (ids.some((id) => !isValidShareId(id))) return ids.map(() => null);
    const raws = await runApp(Effect.gen(function* () { return yield* (yield* ShareRepo).getRawMany(ids); }));
    return ids.map((id, i) => (raws[i] ? parseShare(id, raws[i]!) : null));
}
