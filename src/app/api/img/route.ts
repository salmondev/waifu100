import { NextRequest } from "next/server";
import { clampWidth, getModeratedImage } from "@/server/moderation/moderator";
import { consume, LIMITS } from "@/lib/rate-limit";
import { isAdminRequest } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Neutral placeholder for anything not (yet) approved. */
const PLACEHOLDER = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" fill="#18181b"/><path d="M22 42l8-10 6 7 4-5 6 8z" fill="#3f3f46"/></svg>`;

/**
 * Moderated image proxy. See src/server/moderation/moderator.ts.
 * 200 image/jpeg only for approved bytes (CDN-cacheable: those exact bytes
 * passed). Anything else: placeholder SVG with X-Moderation header; blocked
 * is cached a day. Unchecked (Gemini gave no answer) is SHOWN with a 60 s cache.
 */
export async function GET(req: NextRequest) {
    const params = req.nextUrl.searchParams;
    const url = params.get("u") ?? "";
    const width = clampWidth(Number(params.get("w")));
    // Per-IP limit on cache misses only (T-0009 review M2): a known verdict never counts.
    const result = await getModeratedImage(url, width, {
        animated: params.get("a") !== "0",
        beforeClassify: async () => (await consume(req, LIMITS.imgModerate)).allowed,
    });

    // Reason detail (e.g. "no-key") only for a valid ADMIN_TOKEN (constant-time
    // compare in isAdminRequest); everyone else sees X-Moderation only. Always logged.
    const admin = isAdminRequest(req);
    const reason = result.ok ? (result.checked ? null : (result.reason ?? "unchecked")) : result.reason;
    if (reason) console.warn(`[img] moderation ${result.ok ? "unchecked" : "not served"}: ${reason}`);
    const reasonHeader: Record<string, string> = admin && reason ? { "X-Moderation-Reason": reason } : {};
    // Admin responses carry diagnostics: never let a CDN cache them for others.
    const adminCache = admin ? { "Cache-Control": "private, no-store" } : {};

    if (result.ok) {
        const body = result.gif ?? result.jpeg;
        return new Response(new Uint8Array(body), {
            headers: {
                "Content-Type": result.gif ? "image/gif" : "image/jpeg",
                // Unchecked (Gemini gave no answer): shown, but never cached long so it is re-checked soon.
                "Cache-Control": result.checked
                    ? "public, max-age=86400, s-maxage=2592000, stale-while-revalidate=86400"
                    : "public, max-age=60, s-maxage=60",
                "X-Moderation": result.checked ? "allowed" : "unchecked",
                ...reasonHeader,
                "X-Content-Type-Options": "nosniff",
                ...adminCache,
            },
        });
    }
    return new Response(PLACEHOLDER, {
        status: 200,
        headers: {
            "Content-Type": "image/svg+xml",
            "Cache-Control": result.definitive ? "public, max-age=3600, s-maxage=86400" : "public, max-age=30, s-maxage=60",
            "X-Moderation": result.definitive ? "blocked" : result.reason === "rate-limited" ? "rate-limited" : "unavailable",
            ...reasonHeader,
            "X-Content-Type-Options": "nosniff",
            ...adminCache,
        },
    });
}
