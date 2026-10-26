import { LIMITS } from "@/lib/rate-limit";
import { gachaErrorResponse, gachaJson, gachaRateLimit, requireGachaId } from "@/server/gacha/http";
import { mintRecovery } from "@/server/gacha/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/gacha/recovery -> { code }: a new recovery code for this player.
 * Each call rotates it - the previous code stops working. Only its hash is kept.
 */
export async function POST(req: Request) {
    const auth = requireGachaId(req);
    if ("response" in auth) return auth.response;
    const limited = await gachaRateLimit(req, LIMITS.gachaWrite);
    if (limited) return limited;

    try {
        return gachaJson(await mintRecovery(auth.id));
    } catch (e) {
        return gachaErrorResponse(e, "recovery");
    }
}
