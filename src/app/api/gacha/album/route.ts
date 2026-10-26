import { LIMITS } from "@/lib/rate-limit";
import { gachaErrorResponse, gachaJson, gachaRateLimit, requireGachaId } from "@/server/gacha/http";
import { getAlbum } from "@/server/gacha/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/gacha/album -> owned cards grouped by anime; never creates a profile. */
export async function GET(req: Request) {
    const auth = requireGachaId(req);
    if ("response" in auth) return auth.response;
    const limited = await gachaRateLimit(req, LIMITS.gachaRead);
    if (limited) return limited;

    try {
        return gachaJson(await getAlbum(auth.id));
    } catch (e) {
        return gachaErrorResponse(e, "album");
    }
}
