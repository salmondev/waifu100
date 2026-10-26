import { LIMITS } from "@/lib/rate-limit";
import { gachaErrorResponse, gachaJson, gachaRateLimit, requireGachaId } from "@/server/gacha/http";
import { buyHint } from "@/server/gacha/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/gacha/hint -> buys the next locked hint with coins; returns the updated round. */
export async function POST(req: Request) {
    const auth = requireGachaId(req);
    if ("response" in auth) return auth.response;
    const limited = await gachaRateLimit(req, LIMITS.gachaWrite);
    if (limited) return limited;

    try {
        return gachaJson(await buyHint(auth.id));
    } catch (e) {
        return gachaErrorResponse(e, "hint");
    }
}
