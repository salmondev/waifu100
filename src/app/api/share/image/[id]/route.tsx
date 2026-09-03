import { NextRequest } from "next/server";
import { withRedis } from '@/lib/redis';
import { renderShareOg, resolveCells } from '@/lib/share-og';

// ioredis speaks TCP, so this cannot run on the edge runtime.
export const runtime = 'nodejs';

interface StoredCell {
    i?: number;
    character?: {
        images?: { jpg?: { image_url?: string } };
        customImageUrl?: string;
    };
}

/**
 * Social card for a shared grid, drawn server-side from the share's own data.
 *
 * This is the fallback for every share whose browser-side thumbnail never made
 * it to blob storage: those had no image at all, so the Community Showcase card
 * was blank and link embeds carried no picture. Rendering from stored data
 * covers old shares and any future capture failure without a backfill.
 *
 * (It replaces an older version of this route that read PNGs off the local
 * filesystem - a path that never existed on Vercel.)
 */
export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;

        const raw = await withRedis((redis) => redis.get(`waifu100:share:${id}`));
        if (!raw) return new Response("Share not found", { status: 404 });

        const parsed = JSON.parse(raw);
        // Old shares stored a bare array; newer ones wrap it with metadata.
        const cells: StoredCell[] = Array.isArray(parsed) ? parsed : parsed.grid || [];
        const title: string = (!Array.isArray(parsed) && parsed.meta?.title) || "Waifu100 Grid";

        const images: (string | null)[] = Array(100).fill(null);
        let count = 0;

        cells.forEach((item) => {
            const index = item?.i ?? -1;
            if (index < 0 || index > 99 || !item.character) return;
            count++;
            images[index] =
                item.character.customImageUrl ||
                item.character.images?.jpg?.image_url ||
                null;
        });

        // ?debug=1 reports how each cell resolved instead of drawing the card -
        // a blank cell otherwise gives no clue whether the link is dead, the
        // optimizer refused it, or the fetch timed out.
        if (new URL(req.url).searchParams.get('debug') === 'cells') {
            const { stats } = await resolveCells(images);
            return Response.json({ id, title, count, stats });
        }

        const rendered = await renderShareOg({ title, images, count });

        // Draining the body here keeps render failures inside this try: a
        // streamed ImageResponse would otherwise blow up past the handler and
        // surface as a bare framework 500 with nothing to go on.
        const png = await rendered.arrayBuffer();
        return new Response(png, { headers: rendered.headers });
    } catch (e) {
        console.error("Share OG Image Error:", e);
        const detail = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
        return new Response(
            new URL(req.url).searchParams.get('debug') ? detail : "Failed to render image",
            { status: 500 }
        );
    }
}
