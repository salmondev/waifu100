import type { ShareSummary } from "@/lib/share-summary";

/**
 * The shape of one page of the showcase, and the numbers that define it.
 *
 * Apart from `readFeedPage` in community-feed.ts, which speaks to Redis and so
 * can never be imported from a client component - the feed component needs the
 * type and the page size, and pulling those from the same module would drag
 * ioredis into the browser bundle.
 */

export type FeedOrder = "new" | "old";

export const FEED_PAGE_SIZE = 24;
export const FEED_MAX_LIMIT = 50;

export interface FeedPage {
    grids: ShareSummary[];
    total: number;
    nextOffset: number | null;
    hasMore: boolean;
}

export const EMPTY_FEED_PAGE: FeedPage = {
    grids: [],
    total: 0,
    nextOffset: null,
    hasMore: false,
};
