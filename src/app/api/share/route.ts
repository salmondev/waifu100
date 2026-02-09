import { NextRequest, NextResponse } from "next/server";
import { nanoid } from 'nanoid';
import { redis } from '@/lib/redis';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { grid, customTitle, imageUrl, verdict, verdictFeedback } = body;

        // ... validation logic ...
        if (!grid || !Array.isArray(grid)) {
             return NextResponse.json({ error: "Invalid grid data" }, { status: 400 });
        }

        // Generate Short ID
        const id = nanoid(10); 
        
        // ... (data reconstruction logic remains same, implicit in target range or not touched) ...

        // 2. Grid is already processed by Client (URLs only)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cleanGrid = grid.map((c: any) => {
            if (typeof c.i === 'undefined' || !c.m || !c.n) return null;
            return {
                i: c.i,
                character: {
                    mal_id: c.m,
                    name: c.n,
                    images: { jpg: { image_url: c.img } },
                    customImageUrl: c.c_img || undefined,
                    source: c.s || undefined
                }
            };
        }).filter(Boolean);

        // 3. Versioning Logic (If userId is present)
        let finalTitle = customTitle || "Waifu100 Grid";
        const { userId } = body;

        if (userId && customTitle) {
            const userTitleKey = `waifu100:user:${userId}:titles`;
            // Increment usage count for this specific title
            // HINCRBY returns the new value after incrementing
            const count = await redis.hincrby(userTitleKey, customTitle, 1);
            
            if (count > 1) {
                finalTitle = `${customTitle} V.${count}`;
            }
        }

        // 4. Construct Payload
        const fileData = {
            meta: {
                title: finalTitle,
                createdAt: new Date().toISOString(),
                hasImage: !!imageUrl,
                imageUrl: imageUrl,
                userId: userId || undefined // Store userId in metadata if useful for debugging/future
            },
            grid: cleanGrid,
            verdict,
            verdictFeedback
        };

        // 4. Save to Redis (ioredis)
        // Store as stringified JSON
        await redis.set(`waifu100:share:${id}`, JSON.stringify(fileData));
        
        // 5. Add to Community Feed (Sorted Set: Score = Timestamp)
        // We only store the ID in the feed to keep it lightweight. 
        // The community API will hydrate data.
        await redis.zadd('waifu100:feed', Date.now(), id);
        
        // Trim feed to keep only last 1000 items (optional maintenance)
        // await redis.zremrangebyrank('waifu100:feed', 0, -1001);

        return NextResponse.json({ id, url: `/view/${id}` });

    } catch (e: unknown) {
        console.error("Share Save Error:", e);
        // Return exact error to help debugging
        const errMsg = e instanceof Error ? e.message : String(e);
        return NextResponse.json({ 
            error: "Failed to save share", 
            details: errMsg 
        }, { status: 500 });
    }
}
