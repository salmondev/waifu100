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

        // 2. Reconstruct Grid Data & Upload Custom Images
        // optimizing: upload all images in parallel
        const processedGrid = await Promise.all(grid.map(async (c: any) => {
            // Check for essential valid data
            if (typeof c.i === 'undefined' || !c.m || !c.n) return null;

            let finalImg = c.img;
            let finalCustomImg = c.c_img;

            // Helper to upload base64
            const uploadBase64 = async (base64Str: string, namePrefix: string) => {
                try {
                    const base64Data = base64Str.replace(/^data:image\/\w+;base64,/, "");
                    const buffer = Buffer.from(base64Data, 'base64');
                    const blob = await put(`shares/assets/${id}-${namePrefix}-${Date.now()}.png`, buffer, {
                        access: 'public',
                        contentType: 'image/png'
                    });
                    return blob.url;
                } catch (e) {
                    console.error("Asset Upload Error", e);
                    return base64Str; // Fallback to original if fail (though it might fail KV)
                }
            };

            // Check c.img
            if (finalImg && finalImg.startsWith("data:image")) {
                finalImg = await uploadBase64(finalImg, `img-${c.i}`);
            }

            // Check c.c_img
            if (finalCustomImg && finalCustomImg.startsWith("data:image")) {
                finalCustomImg = await uploadBase64(finalCustomImg, `custom-${c.i}`);
            }

            return {
                i: c.i,
                character: {
                    mal_id: c.m,
                    name: c.n,
                    images: {
                        jpg: {
                            image_url: finalImg
                        }
                    },
                    customImageUrl: finalCustomImg || undefined,
                    source: c.s || undefined
                }
            };
        }));

        const cleanGrid = processedGrid.filter(Boolean);

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
