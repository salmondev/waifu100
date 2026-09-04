import { NextRequest, NextResponse } from "next/server";
import { withRedis } from '@/lib/redis';
import { summarizeShare } from '@/lib/share-summary';

export const dynamic = 'force-dynamic'; // Always fetch fresh data

const FEED_KEY = 'waifu100:feed';
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 50;

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
    const n = Number.parseInt(raw ?? '', 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(Math.max(n, min), max);
}

/**
 * A page of the public showcase.
 *
 * `offset`/`limit` walk the feed sorted set directly, so "Load more" costs one
 * ZRANGE plus one pipeline of GETs regardless of how deep the visitor has
 * scrolled - the old hard-coded top 50 meant everything older was simply
 * unreachable.
 *
 * `order=old` reads the same set forwards. Sorting has to happen here rather
 * than in the browser: the client only ever holds the pages it has loaded, so
 * client-side sorting would reorder a slice, not the feed.
 */
export async function GET(req: NextRequest) {
    try {
        const params = req.nextUrl.searchParams;
        const offset = clampInt(params.get('offset') ?? params.get('cursor'), 0, 0, 100_000);
        const limit = clampInt(params.get('limit'), DEFAULT_LIMIT, 1, MAX_LIMIT);
        const order = params.get('order') === 'old' ? 'old' : 'new';

        const start = offset;
        const stop = offset + limit - 1;

        const [ids, total] = await withRedis(async (redis) => {
            const page =
                order === 'old'
                    ? await redis.zrange(FEED_KEY, start, stop)
                    : await redis.zrevrange(FEED_KEY, start, stop);
            return [page, await redis.zcard(FEED_KEY)] as const;
        });

        if (!ids || ids.length === 0) {
            return NextResponse.json({ grids: [], total, nextOffset: null, hasMore: false });
        }

        // One pipelined GET per id. Everything the card shows is derived from
        // these payloads server-side; the full grids never go over the wire.
        const results = await withRedis((redis) => {
            const pipeline = redis.pipeline();
            ids.forEach((id) => pipeline.get(`waifu100:share:${id}`));
            return pipeline.exec();
        });

        const grids = (results ?? [])
            .map((result, index) => {
                const [err, data] = result;
                if (err || !data) return null;
                return summarizeShare(ids[index], data as string);
            })
            .filter((g) => g !== null);

        // hasMore counts feed positions, not returned cards: a page can come back
        // short because some entries were filtered out, and that must not look
        // like the end of the feed.
        const nextOffset = offset + ids.length;
        const hasMore = nextOffset < total;

        return NextResponse.json({
            grids,
            total,
            nextOffset: hasMore ? nextOffset : null,
            hasMore,
        });

    } catch (e: unknown) {
        console.error("Community Feed Error:", e);
        return NextResponse.json({ error: "Failed to fetch feed" }, { status: 500 });
    }
}
