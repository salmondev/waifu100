import { withRedis } from "@/lib/redis";
import { GridCell, AnalysisResult, VerdictFeedback } from "@/types";

/**
 * Reading a stored share back into a grid.
 *
 * The parsing rules live here rather than in each route because they are not
 * obvious and they are easy to get subtly wrong: the payload has two historical
 * shapes (a bare array from the earliest shares, an object with `meta`/`grid`
 * since), and cells carry their own index, so a grid must be rebuilt into 100
 * slots rather than read positionally.
 */

export const SHARE_KEY_PREFIX = "waifu100:share:";
export const GRID_SIZE = 100;

export interface StoredShare {
    id: string;
    title: string;
    grid: GridCell[];
    imageUrl: string | null;
    createdAt: string | null;
    verdict: AnalysisResult | null;
    verdictFeedback: VerdictFeedback;
}

export function shareKey(id: string): string {
    return `${SHARE_KEY_PREFIX}${id}`;
}

/**
 * Ids reach us from query strings, so they get the same shape check the delete
 * route applies before they are ever concatenated into a Redis key.
 */
export function isValidShareId(value: unknown): value is string {
    return typeof value === "string" && value.length > 0 && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

export function parseShare(id: string, raw: string): StoredShare | null {
    try {
        const parsed = JSON.parse(raw);
        const isArray = Array.isArray(parsed);

        const cells: unknown[] = isArray ? parsed : parsed.grid || [];
        const meta = isArray ? {} : parsed.meta || {};

        const grid: GridCell[] = Array.from({ length: GRID_SIZE }, () => ({ character: null }));

        cells.forEach((entry) => {
            const item = entry as { i?: number; character?: GridCell["character"] };
            const index = item?.i ?? -1;
            if (index < 0 || index >= GRID_SIZE || !item.character) return;
            grid[index] = { character: item.character };
        });

        return {
            id,
            title: meta.title || "Waifu100 Grid",
            grid,
            imageUrl: meta.imageUrl || null,
            createdAt: meta.createdAt || null,
            verdict: (!isArray && parsed.verdict) || null,
            verdictFeedback: (!isArray && parsed.verdictFeedback) || null,
        };
    } catch {
        return null;
    }
}

export async function readShare(id: string): Promise<StoredShare | null> {
    if (!isValidShareId(id)) return null;
    const raw = await withRedis((redis) => redis.get(shareKey(id)));
    return raw ? parseShare(id, raw) : null;
}

/**
 * Reads several shares in one pipeline.
 *
 * The compare page needs two grids to render anything at all, and doing that as
 * two sequential GETs would pay the round trip twice on every page view.
 */
export async function readShares(ids: string[]): Promise<(StoredShare | null)[]> {
    if (ids.length === 0) return [];
    if (ids.some((id) => !isValidShareId(id))) {
        return ids.map(() => null);
    }

    const results = await withRedis((redis) => {
        const pipeline = redis.pipeline();
        ids.forEach((id) => pipeline.get(shareKey(id)));
        return pipeline.exec();
    });

    return ids.map((id, index) => {
        const entry = results?.[index];
        if (!entry) return null;
        const [err, data] = entry;
        if (err || !data) return null;
        return parseShare(id, data as string);
    });
}
