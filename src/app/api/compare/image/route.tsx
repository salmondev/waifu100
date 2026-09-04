import { NextRequest } from "next/server";
import { readShares } from "@/lib/share-store";
import { compareGrids } from "@/lib/character-match";
import { renderCompareOg } from "@/lib/compare-og";
import { isAdminRequest } from "@/lib/admin-auth";

// ioredis speaks TCP, so this cannot run on the edge runtime.
export const runtime = "nodejs";
// Far cheaper than the share card - at most 18 images instead of 100 - but it
// still pays a cold Redis dial plus network for every face.
export const maxDuration = 30;

/**
 * Social card for `/compare?a=…&b=…`.
 *
 * A compare link exists to be pasted at another person, and a link with no
 * preview in a Discord embed is a link nobody clicks. The card is drawn from
 * the two shares' own data for the same reason the share card is: it needs no
 * capture step that could fail, and it works for grids created years ago.
 */
export async function GET(req: NextRequest) {
    try {
        const params = req.nextUrl.searchParams;
        const idA = params.get("a") || "";
        const idB = params.get("b") || "";

        const [shareA, shareB] = await readShares([idA, idB]);
        if (!shareA || !shareB) {
            return new Response("Comparison not found", { status: 404 });
        }

        const result = compareGrids(shareA.grid, shareB.grid);

        const rendered = await renderCompareOg({
            titleA: shareA.title,
            titleB: shareB.title,
            similarity: result.similarity,
            sharedCount: result.shared.length,
            faces: result.shared.map((pair) => pair.a.image || pair.b.image),
        });

        // Drained inside the try for the same reason as the share card: a
        // streamed ImageResponse that fails mid-render escapes the handler and
        // surfaces as a bare platform 500 with nothing to debug.
        const png = await rendered.arrayBuffer();
        return new Response(png, { headers: rendered.headers });
    } catch (e) {
        console.error("Compare OG Image Error:", e);
        const detail = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
        return new Response(isAdminRequest(req) ? detail : "Failed to render image", {
            status: 500,
        });
    }
}
