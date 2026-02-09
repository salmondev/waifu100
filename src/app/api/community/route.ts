import { NextRequest, NextResponse } from "next/server";
import { redis } from '@/lib/redis';

export const dynamic = 'force-dynamic'; // Always fetch fresh data

export async function GET(req: NextRequest) {
    try {
        // 1. Fetch latest 50 IDs from feed (Sorted Set, Reverse Order by Time)
        // range: 0 to 49
        const ids = await redis.zrevrange('waifu100:feed', 0, 49);

        if (!ids || ids.length === 0) {
            return NextResponse.json({ grids: [] });
        }

        // 2. Fetch Grid Metadata (Pipeline for efficiency)
        const pipeline = redis.pipeline();
        ids.forEach((id) => {
            pipeline.get(`waifu100:share:${id}`);
        });

        const results = await pipeline.exec();

        // 3. Process Results
        const grids = results?.map((result, index) => {
            const [err, data] = result;
            if (err || !data) return null;

            try {
                // We stored it as stringified JSON
                 const parsed = JSON.parse(data as string);
                 return {
                     id: ids[index],
                     title: parsed.meta?.title || "Untitled Grid",
                     imageUrl: parsed.meta?.imageUrl || null, // Create thumbnail availability
                     createdAt: parsed.meta?.createdAt,
                     // We don't send the full grid to list, just meta
                 };
            } catch (e) {
                return null;
            }
        }).filter(Boolean); // Remove nulls

        return NextResponse.json({ grids: grids || [] });

    } catch (e: unknown) {
        console.error("Community Feed Error:", e);
        return NextResponse.json({ error: "Failed to fetch feed" }, { status: 500 });
    }
}
