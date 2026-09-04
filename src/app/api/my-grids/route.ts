import { NextRequest, NextResponse } from "next/server";
import { withRedis } from "@/lib/redis";
import { summarizeShare } from "@/lib/share-summary";
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

        const results = await withRedis((redis) => {
            const pipeline = redis.pipeline();
            ids.forEach((id) => pipeline.get(`waifu100:share:${id}`));
            return pipeline.exec();
        });

        // A share whose payload is gone (deleted straight from Redis, or expired)
        // leaves a dangling id in the index; collect those to prune. Note this is
        // narrower than "not listed": a grid dropped by summarizeShare still
        // exists, so its index entry stays.
        const missing: string[] = [];
        const grids = (results ?? [])
            .map((result, index) => {
                const [err, data] = result;
                if (err) return null;
                if (!data) {
                    missing.push(ids[index]);
                    return null;
                }
                return summarizeShare(ids[index], data as string);
            })
            .filter((g) => g !== null);

        if (missing.length > 0) {
            await withRedis((redis) => redis.zrem(userSharesKey(userId), ...missing));
        }

        return NextResponse.json({ grids });
    } catch (e: unknown) {
        console.error("My Grids Error:", e);
        return NextResponse.json({ error: "Failed to fetch your grids" }, { status: 500 });
    }
}
