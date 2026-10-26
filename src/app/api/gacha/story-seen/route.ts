import { LIMITS } from "@/lib/rate-limit";
import { gachaErrorResponse, gachaFail, gachaJson, gachaRateLimit, readJsonBody, requireGachaId } from "@/server/gacha/http";
import { markStorySeen } from "@/server/gacha/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/gacha/story-seen { animeId } -> the player tapped a new story card. Idempotent. */
export async function POST(req: Request) {
    const auth = requireGachaId(req);
    if ("response" in auth) return auth.response;
    const limited = await gachaRateLimit(req, LIMITS.gachaWrite);
    if (limited) return limited;

    const parsed = await readJsonBody(req);
    if ("response" in parsed) return parsed.response;
    const animeId = parsed.body.animeId;
    if (typeof animeId !== "number" || !Number.isSafeInteger(animeId) || animeId <= 0) {
        return gachaFail(400, "invalid_anime", "animeId must be an anime id.");
    }

    try {
        return gachaJson(await markStorySeen(auth.id, animeId));
    } catch (e) {
        return gachaErrorResponse(e, "story-seen");
    }
}
