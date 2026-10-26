import { Effect } from "effect";
import { summariesFor } from "@/lib/share-summary-cache";
import { decodeShareObject } from "@/lib/share-schema";
import type { ShareSummary } from "@/lib/share-summary";
import { EMPTY_FEED_PAGE, filterByKind, type FeedKind, type FeedOrder, type FeedPage } from "@/lib/feed-page";
import { ShareRepo, FEED_KEY as REPO_FEED_KEY } from "@/server/share-repo";
import { runApp } from "@/server/run";

/**
 * Reading a page of the public showcase (server-only: it opens Redis).
 *
 * `kind`:
 *  - "all"   - the original `waifu100:feed` (every share ever, both kinds);
 *  - "story" - `waifu100:feed:story`, written only for story shares;
 *  - "waifu" - the original feed with story cards filtered out. Old shares
 *    have no kind and count as waifu, so no index backfill is needed. A page
 *    may come back short; hasMore counts feed positions, not cards.
 */

export const FEED_KEY = REPO_FEED_KEY;

/** How many cell images a story card mosaic gets. */
export const STORY_PREVIEW_CELLS = 4;

/**
 * Story shares are saved without a rendered thumbnail, so their summary's imageUrl is null and a
 * card had nothing to show. For the story feed only, add `previews` (the first few validated cell
 * images) from the payloads: one pipelined GET for the cards that need it, read-only. Nothing is
 * written back (the summary cache shape is unchanged). Waifu / "all" responses are untouched.
 */
const withStoryPreviews = (grids: ShareSummary[]) =>
    Effect.gen(function* () {
        const need = grids.filter((g) => g.kind === "story" && !g.imageUrl);
        if (need.length === 0) return grids;
        const repo = yield* ShareRepo;
        const raws = yield* repo.getRawMany(need.map((g) => g.id)).pipe(Effect.orElseSucceed(() => need.map(() => null)));
        const previews = new Map<string, string[]>();
        need.forEach((g, i) => {
            const raw = raws[i];
            if (!raw) return;
            try {
                const d = decodeShareObject(JSON.parse(raw));
                const urls = (d?.images ?? []).filter((u): u is string => !!u).slice(0, STORY_PREVIEW_CELLS);
                if (urls.length) previews.set(g.id, urls);
            } catch {
                // unreadable payload: the card falls back to "No Preview"
            }
        });
        return grids.map((g) => (previews.has(g.id) ? { ...g, previews: previews.get(g.id) } : g));
    });

export const feedPageProgram = (offset: number, limit: number, order: FeedOrder, kind: FeedKind = "all") =>
    Effect.gen(function* () {
        const repo = yield* ShareRepo;
        const { ids, total } = yield* repo.feedPage(kind === "story" ? "story" : "all", offset, offset + limit - 1, order === "old");
        if (ids.length === 0) return { ...EMPTY_FEED_PAGE, total } satisfies FeedPage;
        const { grids } = yield* Effect.promise(() => summariesFor(ids));
        const nextOffset = offset + ids.length;
        const hasMore = nextOffset < total;
        const listed = filterByKind(grids, kind);
        return { grids: kind === "story" ? yield* withStoryPreviews(listed) : listed, total, nextOffset: hasMore ? nextOffset : null, hasMore } satisfies FeedPage;
    });

export async function readFeedPage(
    offset: number,
    limit: number,
    order: FeedOrder,
    kind: FeedKind = "all"
): Promise<FeedPage> {
    return runApp(feedPageProgram(offset, limit, order, kind));
}
