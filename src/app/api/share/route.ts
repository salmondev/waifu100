import { NextRequest, NextResponse } from "next/server";
import { nanoid } from 'nanoid';
import { redis } from '@/lib/redis';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { grid, customTitle, imageUrl } = body;

        // ... validation logic ...
        if (!grid || !Array.isArray(grid)) {
             return NextResponse.json({ error: "Invalid grid data" }, { status: 400 });
        }

        // Generate Short ID
        const id = nanoid(10); 
        
        // ... (data reconstruction logic remains same, implicit in target range or not touched) ...

        // 2. Grid is already processed by Client (URLs only)
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

        // 3. Construct Payload
        const fileData = {
            meta: {
                title: customTitle || "Waifu100 Grid",
                createdAt: new Date().toISOString(),
                hasImage: !!imageUrl,
                imageUrl: imageUrl 
            },
            grid: cleanGrid
        };

        // 4. Save to Redis (ioredis)
        // Store as stringified JSON
        await redis.set(`waifu100:share:${id}`, JSON.stringify(fileData));

        return NextResponse.json({ id, url: `/view/${id}` });

    } catch (e: any) {
        console.error("Share Save Error:", e);
        // Return exact error to help debugging
        return NextResponse.json({ 
            error: "Failed to save share", 
            details: e.message || String(e) 
        }, { status: 500 });
    }
}
