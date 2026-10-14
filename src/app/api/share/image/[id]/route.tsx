import { NextRequest } from "next/server";
import { withRedis } from '@/lib/redis';
import { renderShareOg, resolveCells } from '@/lib/share-og';
import { isAdminRequest } from '@/lib/admin-auth';
import { decodeShare } from '@/lib/share-schema';

// ioredis speaks TCP, so this cannot run on the edge runtime.
export const runtime = 'nodejs';
// A cold render fetches and resizes 100 images; measured at ~8s in production.
// Capped by the plan's own limit, whichever is lower.
export const maxDuration = 30;

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

        // One decoder for every stored shape (legacy array, v1, v2 waifu/story).
        const decoded = decodeShare(raw);
        if (!decoded) return new Response("Share not found", { status: 404 });
        const { title, count, kind, size } = decoded;
        const images = decoded.images;

        // ?debug=1 reports how each cell resolved instead of drawing the card -
        // a blank cell otherwise gives no clue whether the link is dead, the
        // optimizer refused it, or the fetch timed out.
        const debugAllowed = isAdminRequest(req);

        if (debugAllowed && new URL(req.url).searchParams.get('debug') === 'cells') {
            const { stats } = await resolveCells(images);
            return Response.json({ id, title, count, stats });
        }

        const rendered = await renderShareOg({ title, images, count, kind, size });

        // Draining the body here keeps render failures inside this try: a
        // streamed ImageResponse would otherwise blow up past the handler and
        // surface as a bare framework 500 with nothing to go on.
        const png = await rendered.arrayBuffer();
        return new Response(png, { headers: rendered.headers });
    } catch (e) {
        console.error("Share OG Image Error:", e);
        const detail = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
        return new Response(
            isAdminRequest(req) ? detail : "Failed to render image",
            { status: 500 }
        );
    }
}
