import { NextRequest, NextResponse } from "next/server";
import { redis } from '@/lib/redis';

// PATCH: Update an existing share's verdict in Redis
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
        const rawString = await redis.get(`waifu100:share:${shareId}`);
        if (!rawString) {
            return NextResponse.json(
                { error: "Share not found" },
                { status: 404 }
            );
        }

        const data = JSON.parse(rawString);

        // Patch verdict into existing data
        data.verdict = verdict;

        // Write back to Redis
        await redis.set(`waifu100:share:${shareId}`, JSON.stringify(data));

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
