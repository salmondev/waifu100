import { LIMITS } from "@/lib/rate-limit";
import { gachaErrorResponse, gachaJson, gachaRateLimit, invalidDay, readJsonBody, requireGachaId } from "@/server/gacha/http";
import { isDayKey } from "@/server/gacha/rules";
import { issueCardShare } from "@/server/gacha/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/gacha/card-share { day? } -> { url, text } for a round this player already won. */
export async function POST(req: Request) {
    const auth = requireGachaId(req);
    if ("response" in auth) return auth.response;
    const limited = await gachaRateLimit(req, LIMITS.gachaWrite);
    if (limited) return limited;
    const parsed = await readJsonBody(req);
    if ("response" in parsed) return parsed.response;
    const day = parsed.body.day;
    if (day !== undefined && !isDayKey(day)) return invalidDay();
    try {
        return gachaJson(await issueCardShare(auth.id, typeof day === "string" ? day : undefined));
    } catch (e) {
        return gachaErrorResponse(e, "card-share");
    }
}
