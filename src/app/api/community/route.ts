import { NextRequest, NextResponse } from "next/server";
import { withRedis } from '@/lib/redis';
import { isGifUrl } from '@/lib/utils';

export const dynamic = 'force-dynamic'; // Always fetch fresh data

export async function GET(req: NextRequest) {
    try {
        // 1. Fetch latest 50 IDs from feed (Sorted Set, Reverse Order by Time)
        // range: 0 to 49
        const ids = await withRedis((redis) => redis.zrevrange('waifu100:feed', 0, 49));

        if (!ids || ids.length === 0) {
            return NextResponse.json({ grids: [] });
        }

        // 2. Fetch Grid Metadata (Pipeline for efficiency)
        const results = await withRedis((redis) => {
            const pipeline = redis.pipeline();
            ids.forEach((id) => {
                pipeline.get(`waifu100:share:${id}`);
            });
            return pipeline.exec();
        });

        // 3. Process Results
        const grids = results?.map((result, index) => {
            const [err, data] = result;
            if (err || !data) return null;

            try {
                // We stored it as stringified JSON
                 const parsed = JSON.parse(data as string);
                 const title = parsed.meta?.title || "Untitled Grid";
                 
                 // FIX: Filter out grids that were saved with "Loading" title (likely due to a bug or race condition)
                 // Broadened filter to catch "Loading...", "generating", etc.
                 if (/loading|generating|captioning/i.test(title)) return null;

                 // Whether the grid holds any animated cells - the feed shows a
                 // badge for it, and the full grid is far too heavy to send.
                 const cells: unknown[] = Array.isArray(parsed) ? parsed : parsed.grid || [];
                 const hasGif = cells.some((cell) => {
                     const character = (cell as { character?: { customImageUrl?: string; images?: { jpg?: { image_url?: string } } } })?.character;
                     return isGifUrl(character?.customImageUrl) || isGifUrl(character?.images?.jpg?.image_url);
                 });

                 return {
                     id: ids[index],
                     title: title,
                     imageUrl: parsed.meta?.imageUrl || null, // Create thumbnail availability
                     createdAt: parsed.meta?.createdAt,
                     hasGif,
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
