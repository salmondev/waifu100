import { withRedis } from "@/lib/redis";
import { summariesFor } from "@/lib/share-summary-cache";
import { EMPTY_FEED_PAGE, type FeedOrder, type FeedPage } from "@/lib/feed-page";

/**
 * Reading a page of the public showcase.
 *
 * Lives here rather than in the route so the page itself can render the first
 * page on the server. The old flow shipped an empty page, hydrated, and only
 * then started the fetch that fills it - a spinner for the length of a round
 * trip plus a Redis read, every single visit. The route stays for "Load more"
 * and for re-sorting.
 *
 * Server-only: it opens a Redis connection. The types and page sizes live in
 * feed-page.ts so the client can share them.
 */

export const FEED_KEY = "waifu100:feed";

export async function readFeedPage(
    offset: number,
    limit: number,
    order: FeedOrder
): Promise<FeedPage> {
    const start = offset;
    const stop = offset + limit - 1;

    const [ids, total] = await withRedis(async (redis) => {
        // One pipeline: the page and the count are always wanted together, and
        // as two awaits they cost two round trips to the same server.
        const results = await redis
            .pipeline()
            [order === "old" ? "zrange" : "zrevrange"](FEED_KEY, start, stop)
            .zcard(FEED_KEY)
            .exec();

        const page = (results?.[0]?.[1] as string[] | undefined) ?? [];
        const count = (results?.[1]?.[1] as number | undefined) ?? 0;
        return [page, count] as const;
    });

    if (ids.length === 0) {
        return { ...EMPTY_FEED_PAGE, total };
    }

    const { grids } = await summariesFor(ids);

    // hasMore counts feed positions, not returned cards: a page can come back
    // short because some entries were filtered out, and that must not look like
    // the end of the feed.
    const nextOffset = offset + ids.length;
    const hasMore = nextOffset < total;

    return { grids, total, nextOffset: hasMore ? nextOffset : null, hasMore };
}
