import { NextRequest, NextResponse } from "next/server";
import { withRedis } from "@/lib/redis";
import { isAdminRequest } from "@/lib/admin-auth";
import { shareOwnerId } from "@/lib/share-summary";
import { userIdFromRequest, userSharesKey } from "@/lib/user-id";

export const dynamic = "force-dynamic";

interface RouteContext {
    params: Promise<{ id: string }>;
}

/**
 * Takes a grid down.
 *
 * Two ways in, and only two:
 *  - the browser that created it, proving ownership with the anonymous owner id
 *    it sent at share time (see src/lib/user-id.ts);
 *  - an admin holding ADMIN_TOKEN, because until now nothing that reached the
 *    public showcase could be removed by anyone, at all.
 *
 * Shares created before owner ids were minted have meta.userId === null. Nobody
 * can prove ownership of those, so they are permanently admin-only; that is
 * accepted rather than fixed, because the alternative - letting any caller claim
 * an unowned grid - is strictly worse.
 */
export async function DELETE(req: NextRequest, { params }: RouteContext) {
    const { id } = await params;

    if (!id || id.length > 64) {
        return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    try {
        const key = `waifu100:share:${id}`;
        const raw = await withRedis((redis) => redis.get(key));

        if (!raw) {
            return NextResponse.json({ error: "Not found" }, { status: 404 });
        }

        const owner = shareOwnerId(raw);
        const isAdmin = isAdminRequest(req);
        const caller = userIdFromRequest(req);
        const isOwner = !!owner && !!caller && owner === caller;

        if (!isAdmin && !isOwner) {
            return NextResponse.json(
                { error: "You can only delete grids you created." },
                { status: 403 }
            );
        }

        // Delete the payload and every index pointing at it, so the grid leaves
        // the showcase and the owner's list in the same round trip. An admin
        // deleting someone else's grid still has to clean that person's index,
        // hence reading the owner from the payload rather than the caller.
        await withRedis((redis) => {
            const tx = redis.multi().del(key).zrem("waifu100:feed", id);
            if (owner) {
                tx.zrem(userSharesKey(owner), id);
            }
            return tx.exec();
        });

        return NextResponse.json({ ok: true, id });
    } catch (e: unknown) {
        console.error("Share Delete Error:", e);
        return NextResponse.json({ error: "Failed to delete share" }, { status: 500 });
    }
}
