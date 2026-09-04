import { NextRequest, NextResponse } from "next/server";
import { withRedis } from '@/lib/redis';
import { isAdminRequest } from '@/lib/admin-auth';

/**
 * PATCH: fill in a share's verdict.
 *
 * Grids shared before verdicts existed have none, and the view page generates
 * one the first time somebody opens them - that path has to stay open. What was
 * never intended is what it also allowed: anyone holding a share id could
 * rewrite the verdict on anybody's grid, any number of times. Replacing an
 * existing verdict now needs the admin token.
 */
export async function PATCH(req: NextRequest) {
    try {
        const { shareId, verdict } = await req.json();

        if (!shareId || !verdict) {
            return NextResponse.json(
                { error: "shareId and verdict are required" },
                { status: 400 }
            );
        }

        // Read existing share data
        const rawString = await withRedis((redis) => redis.get(`waifu100:share:${shareId}`));
        if (!rawString) {
            return NextResponse.json(
                { error: "Share not found" },
                { status: 404 }
            );
        }

        const data = JSON.parse(rawString);

        if (data.verdict && !isAdminRequest(req)) {
            return NextResponse.json(
                { error: "This grid already has a verdict." },
                { status: 403 }
            );
        }

        // Patch verdict into existing data
        data.verdict = verdict;

        // Write back to Redis
        await withRedis((redis) => redis.set(`waifu100:share:${shareId}`, JSON.stringify(data)));

        return NextResponse.json({ success: true });
    } catch (e: unknown) {
        console.error("Share Verdict Update Error:", e);
        const errMsg = e instanceof Error ? e.message : String(e);
        return NextResponse.json(
            { error: "Failed to update verdict", details: errMsg },
            { status: 500 }
        );
    }
}
