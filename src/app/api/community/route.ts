import { NextRequest, NextResponse } from "next/server";
import { readFeedPage } from "@/lib/community-feed";
import { FEED_MAX_LIMIT, FEED_PAGE_SIZE, type FeedOrder } from "@/lib/feed-page";

export const dynamic = "force-dynamic";

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
    const n = Number.parseInt(raw ?? '', 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(Math.max(n, min), max);
}

/**
 * A page of the public showcase.
 *
 * `offset`/`limit` walk the feed sorted set directly, so "Load more" costs one
 * pipelined ZRANGE + ZCARD plus one HMGET of the cached summaries regardless of
 * how deep the visitor has scrolled - the old hard-coded top 50 meant everything
 * older was simply unreachable.
 *
 * `order=old` reads the same set forwards. Sorting has to happen here rather
 * than in the browser: the client only ever holds the pages it has loaded, so
 * client-side sorting would reorder a slice, not the feed.
 *
 * The response is cacheable at the edge for a minute. The feed is the same for
 * everyone and a grid arriving a minute late is not a problem anyone has; in
 * exchange a burst of visitors becomes one Redis read rather than one each,
 * which matters on a free instance shared with everything else here.
 */
export async function GET(req: NextRequest) {
    try {
        const params = req.nextUrl.searchParams;
        const offset = clampInt(params.get('offset') ?? params.get('cursor'), 0, 0, 100_000);
        const limit = clampInt(params.get('limit'), FEED_PAGE_SIZE, 1, FEED_MAX_LIMIT);
        const order: FeedOrder = params.get('order') === 'old' ? 'old' : 'new';

        const page = await readFeedPage(offset, limit, order);

        return NextResponse.json(page, {
            headers: {
                "Cache-Control":
                    "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
            },
        });
    } catch (e: unknown) {
        console.error("Community Feed Error:", e);
        return NextResponse.json({ error: "Failed to fetch feed" }, { status: 500 });
    }
}
