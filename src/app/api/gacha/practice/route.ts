import { LIMITS } from "@/lib/rate-limit";
import { gachaErrorResponse, gachaJson, gachaRateLimit, requireGachaId } from "@/server/gacha/http";
import { getPractice, startPractice } from "@/server/gacha/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/gacha/practice -> the open practice round, or 404 no_practice. */
export async function GET(req: Request) {
    const auth = requireGachaId(req);
    if ("response" in auth) return auth.response;
    const limited = await gachaRateLimit(req, LIMITS.gachaRead);
    if (limited) return limited;
    try {
        return gachaJson(await getPractice(auth.id));
    } catch (e) {
        return gachaErrorResponse(e, "practice");
    }
}

/** POST /api/gacha/practice -> a new practice character. Replaces the previous one. */
export async function POST(req: Request) {
    const auth = requireGachaId(req);
    if ("response" in auth) return auth.response;
    const limited = await gachaRateLimit(req, LIMITS.gachaWrite);
    if (limited) return limited;
    try {
        return gachaJson(await startPractice(auth.id));
    } catch (e) {
        return gachaErrorResponse(e, "practice");
    }
}
