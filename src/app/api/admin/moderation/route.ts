import { NextRequest, NextResponse } from "next/server";
import { adminOnlyResponse, isAdminRequest } from "@/lib/admin-auth";
import { setVerdict, sha256 } from "@/server/moderation/moderator";
import { safeFetchImage } from "@/server/moderation/safe-fetch";

export const dynamic = "force-dynamic";

/**
 * Admin override of an image verdict, by content hash or by URL (fetched and
 * hashed now). {"hash"|"url", "verdict": "block"|"allow"}. Cached CDN copies
 * of /api/img for that URL expire within s-maxage (30 days) unless purged.
 */
export async function POST(req: NextRequest) {
    if (!isAdminRequest(req)) return adminOnlyResponse();
    const body = (await req.json().catch(() => ({}))) as { hash?: unknown; url?: unknown; verdict?: unknown };
    const verdict = body.verdict === "allow" ? "a" : body.verdict === "block" ? "b" : null;
    if (!verdict) return NextResponse.json({ error: "verdict must be block or allow" }, { status: 400 });
    let hash = typeof body.hash === "string" && /^[0-9a-f]{64}$/.test(body.hash) ? body.hash : null;
    if (!hash && typeof body.url === "string") {
        try {
            hash = sha256((await safeFetchImage(body.url)).bytes);
        } catch (e) {
            return NextResponse.json({ error: `fetch failed: ${(e as Error).message}` }, { status: 400 });
        }
    }
    if (!hash) return NextResponse.json({ error: "hash or url required" }, { status: 400 });
    await setVerdict(hash, verdict);
    return NextResponse.json({ ok: true, hash, verdict });
}
