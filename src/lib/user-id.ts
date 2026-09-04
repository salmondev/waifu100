/**
 * An anonymous, per-browser owner id.
 *
 * It exists for one reason: so the person who made a grid can find it again and
 * delete it. It is NOT an account and NOT an identity - it never appears in the
 * UI, never goes into a URL (the API takes it as a header so it stays out of
 * request logs and Referer), and is never returned by any public endpoint. It
 * lives in localStorage only, so it deliberately does not follow anyone across
 * devices or browsers; clearing site data means giving up ownership, which is
 * the trade we want over anything that could track a visitor.
 */

export const USER_ID_STORAGE_KEY = "waifu100-user-id";

/** Header the client sends the owner id in. Never a query parameter. */
export const USER_ID_HEADER = "x-waifu100-user-id";

/**
 * Shape check for anything arriving from the network. We only ever mint v4
 * UUIDs, so anything else is either a stale value or someone probing - and a
 * loose id would let a caller write junk Redis keys.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidUserId(value: unknown): value is string {
    return typeof value === "string" && UUID_RE.test(value);
}

function randomUuid(): string {
    // randomUUID needs a secure context; fall back so a http:// preview or an
    // older in-app browser still gets an owner id rather than silently none.
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }
    return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => {
        const n = Number(c);
        return (n ^ (Math.floor(Math.random() * 256) & (15 >> (n / 4)))).toString(16);
    });
}

/**
 * Returns this browser's owner id, minting and storing one on first call.
 * Returns null on the server or when storage is unavailable (private mode,
 * blocked cookies) - callers must treat "no id" as "cannot own grids", not as
 * an error.
 */
export function ensureUserId(): string | null {
    if (typeof window === "undefined") return null;
    try {
        const existing = window.localStorage.getItem(USER_ID_STORAGE_KEY);
        if (isValidUserId(existing)) return existing;

        const minted = randomUuid();
        window.localStorage.setItem(USER_ID_STORAGE_KEY, minted);
        return minted;
    } catch {
        return null;
    }
}

/** Reads the stored id without minting one. */
export function readUserId(): string | null {
    if (typeof window === "undefined") return null;
    try {
        const existing = window.localStorage.getItem(USER_ID_STORAGE_KEY);
        return isValidUserId(existing) ? existing : null;
    } catch {
        return null;
    }
}

/** Redis key holding the ids of every share this browser created. */
export function userSharesKey(userId: string): string {
    return `waifu100:user:${userId}:shares`;
}

/** Pulls a validated owner id off an incoming request's header. */
export function userIdFromRequest(request: Request): string | null {
    const raw = request.headers.get(USER_ID_HEADER);
    return isValidUserId(raw) ? raw : null;
}
