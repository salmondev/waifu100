import { NextRequest } from "next/server";
import { consume, LIMITS } from "@/lib/rate-limit";
import { gachaErrorResponse, gachaRateLimit } from "@/server/gacha/http";
import { renderBlurHint, renderSilhouetteHint } from "@/server/gacha/hint-image";
import { resolveHintImage } from "@/server/gacha/service";
import { getModeratedImage } from "@/server/moderation/moderator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Same neutral placeholder /api/img uses: nothing about the character in it. */
const PLACEHOLDER = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" fill="#18181b"/><path d="M22 42l8-10 6 7 4-5 6 8z" fill="#3f3f46"/></svg>`;

const BASE_HEADERS = { "X-Content-Type-Options": "nosniff" } as const;

/** Public cache policy, capped so no cache keeps serving a token past the day it is valid for. */
const cachePolicy = (maxAge: number, sMaxAge: number, ttl: number, immutable = false) =>
    `public, max-age=${Math.min(maxAge, ttl)}, s-maxage=${Math.min(sMaxAge, ttl)}${immutable ? ", immutable" : ""}`;

/**
 * GET /api/gacha/hint-image?t=<token>
 *
 * The blur and silhouette hints, rendered here so the client never sees the
 * art's URL or a sharp copy of it. The art goes through the same allow-listed,
 * moderated fetch as /api/img, then is reduced server-side. The response
 * carries only the image, its type and a cache policy: no source URL, hash,
 * moderation header or ETag. The token is the same for every player that day,
 * so a checked image is CDN-cached - but only until that Bangkok day ends: a
 * token is valid for one day, and is 404 on any other.
 */
export async function GET(req: NextRequest) {
    const limited = await gachaRateLimit(req, LIMITS.gachaImage);
    if (limited) return limited;
    try {
        const ref = await resolveHintImage(req.nextUrl.searchParams.get("t"));
        if (!ref) {
            return new Response("not found", { status: 404, headers: { ...BASE_HEADERS, "Content-Type": "text/plain", "Cache-Control": "no-store" } });
        }
        const art = await getModeratedImage(ref.artUrl, 256, {
            animated: false,
            beforeClassify: async () => (await consume(req, LIMITS.imgModerate)).allowed,
        });
        if (!art.ok) {
            if (!art.definitive) console.warn(`[gacha] hint image not served: ${art.reason}`);
            return new Response(PLACEHOLDER, {
                headers: {
                    ...BASE_HEADERS,
                    "Content-Type": "image/svg+xml",
                    "Cache-Control": art.definitive ? cachePolicy(3600, 86400, ref.expiresInSec) : cachePolicy(30, 60, ref.expiresInSec),
                },
            });
        }
        const body = ref.kind === "blur" ? await renderBlurHint(art.jpeg) : await renderSilhouetteHint(art.jpeg);
        return new Response(new Uint8Array(body), {
            headers: {
                ...BASE_HEADERS,
                "Content-Type": ref.kind === "blur" ? "image/webp" : "image/png",
                // Unchecked (moderation gave no answer): shown, re-checked soon.
                "Cache-Control": art.checked
                    ? cachePolicy(86400, 86400, ref.expiresInSec, true)
                    : cachePolicy(60, 60, ref.expiresInSec),
            },
        });
    } catch (e) {
        return gachaErrorResponse(e, "hint-image");
    }
}
