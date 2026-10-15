import { Effect } from "effect";
import { nanoid } from "nanoid";
import { ShareRepo } from "@/server/share-repo";
import { Forbidden, InvalidShare, ShareNotFound } from "@/server/errors";
import {
    buildStoryPayload,
    buildWaifuPayload,
    cleanStoryCells,
    cleanTitle,
    decodeShare,
    ShareValidationError,
    WAIFU_GRID_SIZE,
    type DecodedShare,
    type ShareKind,
} from "@/lib/share-schema";
import { isValidShareId } from "@/lib/share-keys";
import { isValidUserId } from "@/lib/user-id";
import { isStoryLayout, storyViewPath } from "@/lib/story/config";

/** Reads and decodes one share. */
export const readDecoded = (id: string) =>
    Effect.gen(function* () {
        if (!isValidShareId(id)) return yield* Effect.fail(new ShareNotFound({ id }));
        const repo = yield* ShareRepo;
        const raw = yield* repo.getRaw(id);
        const decoded = raw ? decodeShare(raw) : null;
        if (!decoded) return yield* Effect.fail(new ShareNotFound({ id }));
        return decoded;
    });

/** The waifu cell shape the browser sends today (short keys). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cleanWaifuGrid(grid: any[], size = WAIFU_GRID_SIZE) {
    return grid
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((c: any) => {
            if (typeof c?.i !== "number" || c.i < 0 || c.i >= size || !c.m || !c.n) return null;
            return {
                i: c.i,
                character: {
                    mal_id: c.m,
                    name: c.n,
                    images: { jpg: { image_url: c.img } },
                    customImageUrl: c.c_img || undefined,
                    source: c.s || undefined,
                },
            };
        })
        .filter(Boolean);
}

/** Preset size, or a custom rows×cols. Invalid input is null. Absent cols means a preset. */
function layoutFrom(size: unknown, cols: unknown): { size: number; cols: number | null } | null {
    const c = cols === undefined ? null : cols;
    if (!isStoryLayout(size, c)) return null;
    return { size: size as number, cols: c == null ? null : (c as number) };
}

export interface CreateShareBody {
    kind?: unknown;
    size?: unknown;
    /** Story custom layout columns (validated by cleanStoryCells). */
    cols?: unknown;
    grid?: unknown;
    customTitle?: unknown;
    imageUrl?: unknown;
    verdict?: unknown;
    verdictFeedback?: unknown;
    userId?: unknown;
    /** Story only (T-0010): overlay | below | hidden. */
    titleStyle?: unknown;
}

/**
 * POST /api/share. A body without `kind` is a waifu share exactly as before;
 * the stored payload only gains meta.v/kind/size.
 */
export const createShare = (body: CreateShareBody, opts: { now?: number; id?: string } = {}) =>
    Effect.gen(function* () {
        const repo = yield* ShareRepo;
        const kind: ShareKind = body.kind === "story" ? "story" : "waifu";
        if (!Array.isArray(body.grid)) return yield* Effect.fail(new InvalidShare({ reason: "Invalid grid data" }));

        const id = opts.id ?? nanoid(10);
        const userId = isValidUserId(body.userId) ? body.userId : null;
        const customTitle = typeof body.customTitle === "string" && body.customTitle ? body.customTitle : null;

        let finalTitle = kind === "story" ? cleanTitle(customTitle, "story") : customTitle || "Waifu100 Grid";
        if (userId && customTitle) {
            const count = yield* repo.bumpTitle(userId, kind === "story" ? finalTitle : customTitle);
            if (count > 1) finalTitle = `${finalTitle} V.${count}`;
        }

        const imageUrl = typeof body.imageUrl === "string" && body.imageUrl ? body.imageUrl : null;
        let payload: string;
        if (kind === "story") {
            const cleaned = yield* Effect.try({
                try: () => cleanStoryCells(body.size, body.grid, body.cols),
                catch: (e) => new InvalidShare({ reason: e instanceof ShareValidationError ? e.message : "Invalid grid data" }),
            });
            payload = JSON.stringify(
                buildStoryPayload({ title: finalTitle, imageUrl, userId, size: cleaned.size, cols: cleaned.cols, cells: cleaned.cells, titleStyle: body.titleStyle })
            );
        } else {
            const layout = layoutFrom(body.size === undefined ? WAIFU_GRID_SIZE : body.size, body.cols);
            if (!layout) return yield* Effect.fail(new InvalidShare({ reason: "Invalid grid size" }));
            payload = JSON.stringify(
                buildWaifuPayload({
                    title: finalTitle,
                    imageUrl,
                    userId,
                    size: layout.size,
                    cols: layout.cols,
                    grid: cleanWaifuGrid(body.grid, layout.size),
                    verdict: body.verdict,
                    verdictFeedback: body.verdictFeedback,
                })
            );
        }

        yield* repo.create({ id, payload, createdAt: opts.now ?? Date.now(), userId, kind });
        return { id, url: kind === "story" ? storyViewPath(id) : `/view/${id}`, payload, kind };
    });

/** DELETE /api/share/[id]: owner (by anonymous id) or admin only. */
export const deleteShare = (id: string, caller: string | null, isAdmin: boolean) =>
    Effect.gen(function* () {
        if (!id || id.length > 64) return yield* Effect.fail(new InvalidShare({ reason: "Invalid id" }));
        const repo = yield* ShareRepo;
        const raw = yield* repo.getRaw(id);
        if (!raw) return yield* Effect.fail(new ShareNotFound({ id }));
        const owner = ownerOf(raw);
        if (!isAdmin && !(owner && caller && owner === caller)) {
            return yield* Effect.fail(new Forbidden({ reason: "You can only delete grids you created." }));
        }
        yield* repo.remove(id, owner);
        return { ok: true as const, id };
    });

/** What the builder needs to reopen a grid. The owner id stays off this object. */
export function editorShare(share: DecodedShare, owned: boolean) {
    return {
        kind: share.kind,
        title: share.title,
        size: share.size,
        cols: share.cols,
        titleStyle: share.titleStyle,
        owned,
        grid: share.kind === "waifu" ? share.grid : [],
        items: share.kind === "story" ? share.items : [],
        verdict: share.verdict,
        verdictFeedback: share.verdictFeedback,
    };
}

/**
 * PUT /api/share/[id]. The creating browser rewrites the same id.
 * Feed position, owner and createdAt stay. Title versioning does not run.
 */
export const updateShare = (id: string, caller: string | null, body: CreateShareBody) =>
    Effect.gen(function* () {
        if (!caller) return yield* Effect.fail(new Forbidden({ reason: "You can only edit grids you created." }));
        const existing = yield* readDecoded(id);
        if (!existing.userId || existing.userId !== caller) {
            return yield* Effect.fail(new Forbidden({ reason: "You can only edit grids you created." }));
        }
        const kind: ShareKind = body.kind === "story" ? "story" : body.kind === "waifu" ? "waifu" : existing.kind;
        if (kind !== existing.kind) return yield* Effect.fail(new InvalidShare({ reason: "Invalid grid data" }));
        if (!Array.isArray(body.grid)) return yield* Effect.fail(new InvalidShare({ reason: "Invalid grid data" }));

        const layout = layoutFrom(body.size === undefined ? existing.size : body.size, body.cols === undefined ? existing.cols : body.cols);
        if (!layout) return yield* Effect.fail(new InvalidShare({ reason: "Invalid grid size" }));

        const customTitle = typeof body.customTitle === "string" && body.customTitle.trim() ? body.customTitle.trim() : null;
        const title = customTitle ? (kind === "story" ? cleanTitle(customTitle, "story") : customTitle) : existing.title;
        const imageUrl = typeof body.imageUrl === "string" && body.imageUrl ? body.imageUrl : existing.imageUrl;
        const meta = { title, imageUrl, userId: existing.userId, createdAt: existing.createdAt ?? undefined };

        let payload: string;
        if (kind === "story") {
            const cleaned = yield* Effect.try({
                try: () => cleanStoryCells(layout.size, body.grid, layout.cols),
                catch: (e) => new InvalidShare({ reason: e instanceof ShareValidationError ? e.message : "Invalid grid data" }),
            });
            payload = JSON.stringify(
                buildStoryPayload({ ...meta, size: cleaned.size, cols: cleaned.cols, cells: cleaned.cells, titleStyle: body.titleStyle ?? existing.titleStyle })
            );
        } else {
            payload = JSON.stringify(
                buildWaifuPayload({
                    ...meta,
                    size: layout.size,
                    cols: layout.cols,
                    grid: cleanWaifuGrid(body.grid, layout.size),
                    verdict: body.verdict !== undefined ? body.verdict : existing.verdict,
                    verdictFeedback: body.verdictFeedback !== undefined ? body.verdictFeedback : existing.verdictFeedback,
                })
            );
        }

        const repo = yield* ShareRepo;
        yield* repo.replace(id, payload);
        return { id, url: kind === "story" ? storyViewPath(id) : `/view/${id}`, payload, kind };
    });

function ownerOf(raw: string): string | null {
    try {
        const owner = JSON.parse(raw)?.meta?.userId;
        return typeof owner === "string" && owner ? owner : null;
    } catch {
        return null;
    }
}

export type { DecodedShare };
