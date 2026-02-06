import { NextRequest, NextResponse } from "next/server";
import { nanoid } from 'nanoid';
import { kv } from '@vercel/kv';
import { put } from '@vercel/blob';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { grid, customTitle, image } = body;

        if (!grid || !Array.isArray(grid)) {
            return NextResponse.json({ error: "Invalid grid data" }, { status: 400 });
        }

        // Generate Short ID
        const id = nanoid(10); 
        
        let imageUrl = null;

        // 1. Upload Image to Vercel Blob (if provided)
        if (image) {
            try {
                // Convert Base64 (data:image/png;base64,...) to Buffer
                const base64Data = image.replace(/^data:image\/\w+;base64,/, "");
                const buffer = Buffer.from(base64Data, 'base64');
                
                // Upload to Vercel Blob
                const blob = await put(`shares/${id}.png`, buffer, {
                    access: 'public',
                    contentType: 'image/png'
                });
                
                imageUrl = blob.url;
            } catch (err) {
                console.error("Failed to upload image to Blob:", err);
                // Continue without image
            }
        }

        // 2. Reconstruct Grid Data
        const cleanGrid = grid.map((c: any) => {
            // Check for essential valid data
            if (typeof c.i === 'undefined' || !c.m || !c.n) return null;

            return {
                i: c.i,
                character: {
                    mal_id: c.m,
                    name: c.n,
                    images: {
                        jpg: {
                            image_url: c.img
                        }
                    },
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
