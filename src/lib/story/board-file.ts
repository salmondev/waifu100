import { cleanStoryCells, ShareValidationError, toMediaType, toStoredStoryCell, type StoryItem } from "@/lib/share-schema";
import { DEFAULT_TITLE_STYLE, isTitleStyle, STORY_TITLE_MAX } from "@/lib/story/config";
import type { StoryDraft } from "@/lib/story/draft";

/**
 * Story board as a JSON file (parity item 2). Same cell shape as a share
 * (StoredStoryCell), so import goes through the share validator
 * cleanStoryCells: allowed sizes, integer ids, ANIME/MANGA, allowed image
 * hosts per source. The localStorage draft is unchanged.
 */
export const BOARD_FILE_FORMAT = "story100-board";
export const BOARD_FILE_VERSION = 1;
export const BOARD_FILE_MAX_BYTES = 512 * 1024;
export const BOARD_TOO_BIG = "That file is too big to be a Story100 board.";

export class BoardFileError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "BoardFileError";
    }
}

export function boardToFile(d: StoryDraft): string {
    const cells = d.items.flatMap((item, i) => (item ? [toStoredStoryCell(i, item)] : []));
    return JSON.stringify({ format: BOARD_FILE_FORMAT, version: BOARD_FILE_VERSION, title: d.title, size: d.size, ...(d.cols ? { cols: d.cols } : {}), type: d.type, titleStyle: d.titleStyle, cells }, null, 2);
}

export function boardFileName(d: StoryDraft, now = new Date()): string {
    const stamp = now.toISOString().replace("T", "_").replace(/:/g, "-").split(".")[0];
    return `story100-board-${stamp}.json`;
}

/** Parse + validate a board file. Throws BoardFileError with a user-readable message. */
export function boardFromFile(text: string): { draft: StoryDraft; dropped: number } {
    if (text.length > BOARD_FILE_MAX_BYTES) throw new BoardFileError(BOARD_TOO_BIG);
    let data: unknown;
    try {
        data = JSON.parse(text);
    } catch {
        throw new BoardFileError("That file isn't a valid board file (it isn't JSON).");
    }
    const o = data as Record<string, unknown> | null;
    if (!o || typeof o !== "object" || o.format !== BOARD_FILE_FORMAT) throw new BoardFileError("That isn't a Story100 board file. Use a file saved with “Save board”.");
    if (typeof o.version !== "number" || o.version > BOARD_FILE_VERSION) throw new BoardFileError("This board file is from a newer version. Please refresh the page and try again.");
    let clean;
    try {
        clean = cleanStoryCells(o.size, o.cells, o.cols);
    } catch (e) {
        if (e instanceof ShareValidationError) {
            throw new BoardFileError(e.message === "Grid is empty" ? "That board file has no valid titles in it." : "That board file is damaged (bad size or cells).");
        }
        throw e;
    }
    const items: (StoryItem | null)[] = Array.from({ length: clean.size }, () => null);
    for (const c of clean.cells) {
        items[c.i] = { id: c.a, type: c.t, title: c.n ?? "", cover: c.img, src: c.src ?? "anilist" };
    }
    const sent = Array.isArray(o.cells) ? o.cells.length : 0;
    return {
        draft: {
            size: clean.size,
            cols: clean.cols,
            type: toMediaType(o.type),
            title: typeof o.title === "string" ? o.title.slice(0, STORY_TITLE_MAX) : "",
            items,
            titleStyle: isTitleStyle(o.titleStyle) ? o.titleStyle : DEFAULT_TITLE_STYLE,
        },
        dropped: Math.max(0, sent - clean.cells.length),
    };
}
