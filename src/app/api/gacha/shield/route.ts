import { LIMITS } from "@/lib/rate-limit";
import { gachaErrorResponse, gachaJson, gachaRateLimit, requireGachaId } from "@/server/gacha/http";
import { buyShield } from "@/server/gacha/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/gacha/shield -> spends SHIELD_PRICE and returns today's round. */
export async function POST(req: Request) {
    const auth = requireGachaId(req);
    if ("response" in auth) return auth.response;
    const limited = await gachaRateLimit(req, LIMITS.gachaWrite);
    if (limited) return limited;
    try {
        return gachaJson(await buyShield(auth.id));
    } catch (e) {
        return gachaErrorResponse(e, "shield");
    }
}
