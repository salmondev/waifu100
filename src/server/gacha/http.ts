/** Shared plumbing for the /api/gacha/* route handlers. */
import { NextResponse } from "next/server";
import { gachaIdFromRequest } from "@/lib/gacha-id";
import { enforceRateLimit, type RateLimit } from "@/lib/rate-limit";
import { GachaBusy } from "./store";
import { GachaConfigError } from "./config";
import { GachaError } from "./service";

/** Every gacha response is per-player state: never cache it anywhere. */
export const NO_STORE = { "Cache-Control": "no-store" } as const;

/** The only bodies these routes take are a char id or a recovery code. */
export const MAX_BODY_BYTES = 1024;

export function gachaJson(body: unknown, status = 200): NextResponse {
    return NextResponse.json(body, { status, headers: NO_STORE });
}

export function gachaFail(status: number, code: string, error: string): NextResponse {
    return gachaJson({ code, error }, status);
}

export const invalidId = () => gachaFail(400, "invalid_id", "Missing or invalid player id.");

/** Rate limit + no-store on the 429, or null to proceed. */
export async function gachaRateLimit(request: Request, rule: RateLimit): Promise<NextResponse | null> {
    const limited = await enforceRateLimit(request, rule);
    if (limited) limited.headers.set("Cache-Control", "no-store");
    return limited;
}

/** Validated player id from the header, or the 400 to return. */
export function requireGachaId(request: Request): { id: string } | { response: NextResponse } {
    const id = gachaIdFromRequest(request);
    return id ? { id } : { response: invalidId() };
}

/** Size-checked JSON object body, or the 400/413 to return. */
export async function readJsonBody(request: Request): Promise<{ body: Record<string, unknown> } | { response: NextResponse }> {
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (declared > MAX_BODY_BYTES) return { response: gachaFail(413, "body_too_large", "Request body is too large.") };
    let text: string;
    try {
        text = await request.text();
    } catch {
        return { response: gachaFail(400, "invalid_body", "Invalid request body.") };
    }
    if (text.length > MAX_BODY_BYTES) return { response: gachaFail(413, "body_too_large", "Request body is too large.") };
    try {
        const body: unknown = JSON.parse(text);
        if (body && typeof body === "object" && !Array.isArray(body)) return { body: body as Record<string, unknown> };
    } catch {
        // fall through
    }
    return { response: gachaFail(400, "invalid_body", "Invalid request body.") };
}

const MESSAGES: Record<string, string> = {
    create_limited: "Too many new players from this network - try again later.",
    no_profile: "No game found for this player.",
    invalid_character: "That character is not in today's anime.",
    already_guessed: "Already guessed that character.",
    round_over: "Today's round is already over.",
    no_hint: "No hint left to buy.",
    not_enough_coins: "Not enough coins.",
    hint_out_of_order: "Hints open in ladder order; that slot is not the next one.",
    day_unavailable: "That day is not open: only today and the archive window can be played.",
    no_card: "This round has no card to share.",
};

const UUID_ANYWHERE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * Typed game errors become their status + code; anything else is logged
 * (message only, ids scrubbed - a Redis error can quote the key) and answered
 * with a generic 503.
 */
export function gachaErrorResponse(e: unknown, where: string): NextResponse {
    if (e instanceof GachaError) return gachaFail(e.status, e.code, MESSAGES[e.code] ?? "Request failed.");
    if (e instanceof GachaConfigError) {
        // Names the missing setting only; never a value.
        console.error(`[gacha] ${where} refused: ${e.setting} is not set in this deployment`);
        return gachaFail(503, "gacha_misconfigured", "The daily game is not configured on this server.");
    }
    if (e instanceof GachaBusy) return gachaFail(409, "busy", "Another request is still being processed - try again.");
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[gacha] ${where} failed:`, message.replace(UUID_ANYWHERE, "<id>").slice(0, 300));
    return gachaFail(503, "gacha_unavailable", "The daily game is unavailable right now.");
}

export const invalidDay = () => gachaFail(400, "invalid_day", "day must be a YYYY-MM-DD calendar day.");
