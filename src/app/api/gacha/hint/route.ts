import { LIMITS } from "@/lib/rate-limit";
import { gachaErrorResponse, gachaFail, gachaJson, gachaRateLimit, readJsonBody, requireGachaId } from "@/server/gacha/http";
import { HINT_SLOTS } from "@/server/gacha/rules";
import { buyHint } from "@/server/gacha/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const badRequest = () => gachaFail(400, "invalid_hint_request", "Hints open in ladder order; only the next slot can be bought.");

/**
 * POST /api/gacha/hint -> buys the next closed hint slot with coins; returns the updated round.
 *
 * Body: `{}` or `{ "slot": n }` (1-based, must be the next closed slot). Hints
 * open strictly in ladder order, so any other field (a kind, an index) is
 * refused with 400, and a slot other than the next one with 409.
 */
export async function POST(req: Request) {
    const auth = requireGachaId(req);
    if ("response" in auth) return auth.response;
    const limited = await gachaRateLimit(req, LIMITS.gachaWrite);
    if (limited) return limited;

    let slot: number | undefined;
    if (req.body !== null) {
        const parsed = await readJsonBody(req);
        if ("response" in parsed) return parsed.response;
        const { slot: raw, ...rest } = parsed.body;
        if (Object.keys(rest).length > 0) return badRequest();
        if (raw !== undefined) {
            if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1 || raw > HINT_SLOTS) return badRequest();
            slot = raw;
        }
    }

    try {
        return gachaJson(await buyHint(auth.id, slot));
    } catch (e) {
        return gachaErrorResponse(e, "hint");
    }
}
