import type { AnalysisResult, Character, GridCell, VerdictFeedback } from "@/types";

/** The home builder's localStorage key. /daily uses the same key to drop a card onto the grid. */
export const WAIFU_GRID_KEY = "waifu100-grid";
import { isValidShareId } from "@/lib/share-keys";
import { WAIFU_GRID_SIZE } from "@/lib/share-schema";
import { DEFAULT_TITLE_STYLE, isStoryLayout, isStorySize, isTitleStyle, type TitleStyle } from "@/lib/story/config";

export function defaultWaifuTitle(size: number): string {
    return size === 100 ? "My 100 Favorite Characters" : `My ${size} Favorite Characters`;
}

export interface WaifuPersisted {
    grid: GridCell[];
    size: number;
    cols: number | null;
    title: string;
    titleStyle: TitleStyle;
    shareId: string | null;
    verdict: AnalysisResult | null;
    verdictFeedback: VerdictFeedback;
}

export function blankWaifuGrid(size: number): GridCell[] {
    return Array.from({ length: size }, () => ({ character: null }));
}

/** Keeps cells in order. Slots past `size` drop off the end; new slots are empty. */
export function resizeWaifuGrid(grid: GridCell[], size: number): GridCell[] {
    return Array.from({ length: size }, (_, i) => grid[i] ?? { character: null });
}

function blank(): WaifuPersisted {
    return {
        grid: blankWaifuGrid(WAIFU_GRID_SIZE),
        size: WAIFU_GRID_SIZE,
        cols: null,
        title: defaultWaifuTitle(WAIFU_GRID_SIZE),
        titleStyle: DEFAULT_TITLE_STYLE,
        shareId: null,
        verdict: null,
        verdictFeedback: null,
    };
}

/** localStorage draft. A bare array or a size-less object is still a 100-cell board. */
export function parseWaifuStorage(raw: string | null): WaifuPersisted {
    if (!raw) return blank();
    try {
        const parsed = JSON.parse(raw) as Record<string, unknown> | unknown[];
        const gridRaw = Array.isArray(parsed) ? parsed : parsed.grid;
        if (!Array.isArray(gridRaw)) return blank();
        const meta = Array.isArray(parsed) ? {} : parsed;
        const cols = meta.cols != null && isStoryLayout(meta.size, meta.cols) ? (meta.cols as number) : null;
        const size = cols !== null || isStorySize(meta.size) ? (meta.size as number) : WAIFU_GRID_SIZE;
        return {
            grid: resizeWaifuGrid(gridRaw as GridCell[], size),
            size,
            cols,
            title: typeof meta.title === "string" && meta.title.trim() ? meta.title : defaultWaifuTitle(size),
            titleStyle: isTitleStyle(meta.titleStyle) ? meta.titleStyle : DEFAULT_TITLE_STYLE,
            shareId: isValidShareId(meta.shareId) ? meta.shareId : null,
            verdict: (meta.verdict as AnalysisResult | null) ?? null,
            verdictFeedback: (meta.verdictFeedback as VerdictFeedback) ?? null,
        };
    } catch {
        return blank();
    }
}

/**
 * Puts a character in the first empty cell of the saved grid.
 * `placed` is false when that character is already on the board or the board is full.
 */
export function placeCharacterOnWaifuGrid(raw: string | null, character: Character): { stored: string; placed: boolean; full: boolean } {
    const board = parseWaifuStorage(raw);
    if (board.grid.some((cell) => cell.character?.mal_id === character.mal_id)) {
        return { stored: JSON.stringify(board), placed: false, full: false };
    }
    const index = board.grid.findIndex((cell) => !cell.character);
    if (index < 0) return { stored: JSON.stringify(board), placed: false, full: true };
    const grid = board.grid.slice();
    grid[index] = { character };
    return { stored: JSON.stringify({ ...board, grid }), placed: true, full: false };
}

/** Cells for PUT. Null when nothing is placed, or a picture is still a local data/blob URL. */
export function waifuSyncBody(p: Pick<WaifuPersisted, "grid" | "size" | "cols" | "title" | "verdict" | "verdictFeedback">): Record<string, unknown> | null {
    const grid = [];
    for (let i = 0; i < p.grid.length; i++) {
        const c = p.grid[i]?.character;
        if (!c) continue;
        const img = c.images?.jpg?.image_url || "";
        const custom = c.customImageUrl;
        if (img.startsWith("data:") || img.startsWith("blob:")) return null;
        if (custom && (custom.startsWith("data:") || custom.startsWith("blob:"))) return null;
        grid.push({ i, m: c.mal_id, n: c.name, img, c_img: custom, s: c.source });
    }
    if (grid.length === 0) return null;
    return {
        kind: "waifu",
        size: p.size,
        ...(p.cols ? { cols: p.cols } : {}),
        grid,
        customTitle: p.title,
        verdict: p.verdict,
        verdictFeedback: p.verdictFeedback,
    };
}
