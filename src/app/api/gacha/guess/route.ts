import { LIMITS } from "@/lib/rate-limit";
import { gachaErrorResponse, gachaFail, gachaJson, gachaRateLimit, invalidDay, readJsonBody, requireGachaId } from "@/server/gacha/http";
import { isDayKey } from "@/server/gacha/rules";
import { guess } from "@/server/gacha/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/gacha/guess { charId, day? } -> the updated round (answer included only once it is over).
 * `day` (YYYY-MM-DD) is the round's own day (the client always sends it, so a page open past
 * Bangkok midnight still writes to its own round); it must be today or an archive day, never
 * future. Omitted = today, kept only for tabs loaded before the client sent it.
 */
export async function POST(req: Request) {
    const auth = requireGachaId(req);
    if ("response" in auth) return auth.response;
    const limited = await gachaRateLimit(req, LIMITS.gachaWrite);
    if (limited) return limited;

    const parsed = await readJsonBody(req);
    if ("response" in parsed) return parsed.response;
    const charId = parsed.body.charId;
    if (typeof charId !== "number" || !Number.isSafeInteger(charId) || charId <= 0) {
        return gachaFail(400, "invalid_character", "charId must be a character id.");
    }

    const day = parsed.body.day;
    if (day !== undefined && !isDayKey(day)) return invalidDay();

    try {
        return gachaJson(await guess(auth.id, charId, day));
    } catch (e) {
        return gachaErrorResponse(e, "guess");
    }
}
