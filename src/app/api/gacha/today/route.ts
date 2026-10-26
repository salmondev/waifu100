import type { NextResponse } from "next/server";
import { LIMITS } from "@/lib/rate-limit";
import { gachaErrorResponse, gachaJson, gachaRateLimit, requireGachaId } from "@/server/gacha/http";
import { getToday } from "@/server/gacha/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/gacha/today -> today's round for the player in `x-gacha-guess-id`.
 * The first call for a new id creates its profile, which is limited per IP
 * separately (gachaCreate) because a profile starts with free coins.
 */
export async function GET(req: Request) {
    const auth = requireGachaId(req);
    if ("response" in auth) return auth.response;
    const limited = await gachaRateLimit(req, LIMITS.gachaRead);
    if (limited) return limited;

    let createLimited: NextResponse | null = null;
    try {
        const round = await getToday(auth.id, {
            canCreate: async () => !(createLimited = await gachaRateLimit(req, LIMITS.gachaCreate)),
        });
        return gachaJson(round);
    } catch (e) {
        if (createLimited) return createLimited;
        return gachaErrorResponse(e, "today");
    }
}
