import type { NextResponse } from "next/server";
import { LIMITS } from "@/lib/rate-limit";
import { gachaErrorResponse, gachaJson, gachaRateLimit, invalidDay, requireGachaId } from "@/server/gacha/http";
import { isDayKey } from "@/server/gacha/rules";
import { getDay, getToday } from "@/server/gacha/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/gacha/today -> today's round for the player in `x-gacha-guess-id`.
 * The first call for a new id creates its profile, which is limited per IP
 * separately (gachaCreate) because a profile starts with free coins.
 *
 * GET /api/gacha/today?day=YYYY-MM-DD -> that day's round from the archive
 * (an existing profile only; never creates one). 400 for a malformed day,
 * 404 day_unavailable for a future day, one older than the window or one
 * before the game's first day.
 */
export async function GET(req: Request) {
    const auth = requireGachaId(req);
    if ("response" in auth) return auth.response;
    const limited = await gachaRateLimit(req, LIMITS.gachaRead);
    if (limited) return limited;

    const day = new URL(req.url).searchParams.get("day");
    if (day !== null) {
        if (!isDayKey(day)) return invalidDay();
        try {
            return gachaJson(await getDay(auth.id, day));
        } catch (e) {
            return gachaErrorResponse(e, "today");
        }
    }

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
