import { isValidUserId } from "@/lib/user-id";

/**
 * The anonymous Gacha Guess (/daily) player id. Same idea as the grid owner id
 * in user-id.ts, but a separate value under its own storage key: the game
 * profile and grid ownership must not be linkable through a shared id.
 */
export const GACHA_ID_STORAGE_KEY = "gacha-guess-id";

/** Header the client sends the player id in. Never a query parameter. */
export const GACHA_ID_HEADER = "x-gacha-guess-id";

/** A v4 UUID - the only kind the client mints. */
export function isValidGachaId(value: unknown): value is string {
    return isValidUserId(value) && value[14] === "4";
}

/** Pulls a validated player id off an incoming request's header. */
export function gachaIdFromRequest(request: Request): string | null {
    const raw = request.headers.get(GACHA_ID_HEADER);
    return isValidGachaId(raw) ? raw : null;
}
