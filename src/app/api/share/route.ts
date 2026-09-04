import { NextRequest, NextResponse } from "next/server";
import { nanoid } from 'nanoid';
import { withRedis } from '@/lib/redis';
import { isValidUserId, userSharesKey } from '@/lib/user-id';

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
        // Anything that is not one of our minted UUIDs is treated as absent: an
        // unvalidated value here would become part of a Redis key.
        const userId = isValidUserId(body.userId) ? body.userId : null;

        if (userId && customTitle) {
            const userTitleKey = `waifu100:user:${userId}:titles`;
            // Increment usage count for this specific title
            // HINCRBY returns the new value after incrementing
            const count = await withRedis((redis) => redis.hincrby(userTitleKey, customTitle, 1));
            
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
                // The owner of record. Delete authorises against this, so it has
                // to be written even when there is no custom title to version.
                userId: userId || undefined
            },
            grid: cleanGrid,
            verdict,
            verdictFeedback
        };

        // 4. Save to Redis + register in the Community Feed (Sorted Set:
        // Score = Timestamp) in a single round trip. Only the ID goes into the
        // feed to keep it lightweight; the community API hydrates the data.
        // The owner index is written in the same transaction: scanning the whole
        // feed to find one person's grids would get slower for everyone as the
        // feed grows, so ownership gets its own sorted set from the start.
        const createdAt = Date.now();
        const txResults = await withRedis((redis) => {
            const tx = redis
                .multi()
                .set(`waifu100:share:${id}`, JSON.stringify(fileData))
                .zadd('waifu100:feed', createdAt, id);
            if (userId) {
                tx.zadd(userSharesKey(userId), createdAt, id);
            }
            return tx.exec();
        });

        // MULTI reports per-command failures inside the result array instead of
        // rejecting, so surface them rather than returning a broken share id.
        const txError = txResults?.find(([err]) => err)?.[0];
        if (txError) throw txError;
        
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
