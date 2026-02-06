import { NextRequest, NextResponse } from "next/server";
import { nanoid } from 'nanoid';
import { kv } from '@vercel/kv';
import { put } from '@vercel/blob';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { grid, customTitle, imageUrl } = body;

        if (!grid || !Array.isArray(grid)) {
            return NextResponse.json({ error: "Invalid grid data" }, { status: 400 });
        }

        // Generate Short ID
        const id = nanoid(10); 
        // 1. Image is already uploaded by Client
        // We just use the imageUrl provided
        if (!imageUrl && body.image) {
            // Fallback: If legacy client sent base64 'image', we ignore or log.
            // But we assume client is updated.
        }

        // 2. Grid is already processed by Client (URLs only)
        // Just validate minimal structure
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
                imageUrl: imageUrl // Directly save the blob URL
            },
            grid: cleanGrid
        };

        // 4. Save to Vercel KV (Redis)
        await kv.set(`waifu100:share:${id}`, fileData);

        return NextResponse.json({ id, url: `/view/${id}` });

    } catch (e) {
        console.error("Share Save Error:", e);
        return NextResponse.json({ error: "Failed to save share" }, { status: 500 });
    }
}
