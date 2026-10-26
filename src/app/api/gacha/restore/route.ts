import { LIMITS } from "@/lib/rate-limit";
import { gachaErrorResponse, gachaFail, gachaJson, gachaRateLimit, readJsonBody } from "@/server/gacha/http";
import { restore } from "@/server/gacha/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/gacha/restore { code } -> { id }: the player id a recovery code
 * belongs to, which the browser then stores as its own. Needs no current id
 * (a fresh browser has none worth keeping). Strictly rate-limited: every
 * attempt counts, right or wrong.
 */
export async function POST(req: Request) {
    const limited = await gachaRateLimit(req, LIMITS.gachaRestore);
    if (limited) return limited;

    const parsed = await readJsonBody(req);
    if ("response" in parsed) return parsed.response;

    try {
        const id = await restore(parsed.body.code);
        if (!id) return gachaFail(404, "invalid_code", "That recovery code does not match any game.");
        return gachaJson({ id });
    } catch (e) {
        return gachaErrorResponse(e, "restore");
    }
}
