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
    type DecodedShare,
    type ShareKind,
} from "@/lib/share-schema";
import { isValidShareId } from "@/lib/share-keys";
import { isValidUserId } from "@/lib/user-id";
import { STORY_VERDICT_ENABLED, storyViewPath } from "@/lib/story/config";

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
function cleanWaifuGrid(grid: any[]) {
    return grid
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((c: any) => {
            if (typeof c?.i === "undefined" || !c.m || !c.n) return null;
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
            payload = JSON.stringify(
                buildWaifuPayload({
                    title: finalTitle,
                    imageUrl,
                    userId,
                    grid: cleanWaifuGrid(body.grid),
                    verdict: STORY_VERDICT_ENABLED || kind === "waifu" ? body.verdict : undefined,
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

function ownerOf(raw: string): string | null {
    try {
        const owner = JSON.parse(raw)?.meta?.userId;
        return typeof owner === "string" && owner ? owner : null;
    } catch {
        return null;
    }
}

export type { DecodedShare };
