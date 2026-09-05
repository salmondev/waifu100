import { NextRequest, NextResponse } from "next/server";
import { withRedis } from "@/lib/redis";
import { summariesFor } from "@/lib/share-summary-cache";
import { userIdFromRequest, userSharesKey } from "@/lib/user-id";

export const dynamic = "force-dynamic";

/**
 * The grids this browser created, newest first.
 *
 * The owner id arrives as a header rather than a query parameter on purpose:
 * query strings end up in server logs, browser history and Referer headers, and
 * this value is the only thing standing between a stranger and someone else's
 * delete button.
 *
 * Backed by the `waifu100:user:<id>:shares` index written at share time - the
 * alternative, reading the whole feed and filtering by meta.userId, would do
 * O(all grids ever shared) work to answer a question about one person.
 */
export async function GET(req: NextRequest) {
    const userId = userIdFromRequest(req);

    // No id yet (first visit, or storage blocked) is a normal empty result, not
    // an error - there is nothing to authenticate here.
    if (!userId) {
        return NextResponse.json({ grids: [] });
    }

    try {
        const ids = await withRedis((redis) => redis.zrevrange(userSharesKey(userId), 0, 99));

        if (!ids || ids.length === 0) {
            return NextResponse.json({ grids: [] });
        }

        // Cards come from the summary hash, so listing someone's grids no longer
        // pulls a hundred full payloads across the wire. `missing` is the ids
        // whose payload is gone (deleted straight from Redis, or expired),
        // leaving a dangling index entry to prune - narrower than "not listed",
        // since a grid dropped by summarizeShare still exists.
        const { grids, missing } = await summariesFor(ids);

        if (missing.length > 0) {
            await withRedis((redis) => redis.zrem(userSharesKey(userId), ...missing));
        }

        return NextResponse.json({ grids });
    } catch (e: unknown) {
        console.error("My Grids Error:", e);
        return NextResponse.json({ error: "Failed to fetch your grids" }, { status: 500 });
    }
}
