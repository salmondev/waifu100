import { NextRequest, NextResponse } from "next/server";
import fs from 'fs/promises';
import path from 'path';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        
        // Define Path
        const dataDir = path.join(process.cwd(), 'src', 'data', 'shares');
        const imagePath = path.join(dataDir, `${id}.png`);

        try {
            await fs.access(imagePath);
            const fileBuffer = await fs.readFile(imagePath);
            
            return new NextResponse(fileBuffer, {
                headers: {
                    'Content-Type': 'image/png',
                    'Cache-Control': 'public, max-age=86400, mutable'
                }
            });
        } catch {
            return new NextResponse("Image not found", { status: 404 });
        }

    } catch (e) {
        console.error("Image Serve Error:", e);
        return new NextResponse("Internal Error", { status: 500 });
    }
}
