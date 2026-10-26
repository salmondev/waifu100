import { LIMITS } from "@/lib/rate-limit";
import { gachaErrorResponse, gachaJson, gachaRateLimit, requireGachaId } from "@/server/gacha/http";
import { getArchive } from "@/server/gacha/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/gacha/archive -> today plus the playable past days (newest first)
 * with this player's state for each: new / playing / won / lost. Read-only,
 * same read limit as /today; an unknown player is 404 (it never creates one).
 */
export async function GET(req: Request) {
    const auth = requireGachaId(req);
    if ("response" in auth) return auth.response;
    const limited = await gachaRateLimit(req, LIMITS.gachaRead);
    if (limited) return limited;
    try {
        return gachaJson(await getArchive(auth.id));
    } catch (e) {
        return gachaErrorResponse(e, "archive");
    }
}
