/**
 * Limits for the together room server.
 *
 * Each number sits above what a person actually does: one room, one socket,
 * a title typed by hand, a cursor every 50ms. They exist to stop a script
 * from opening unbounded rooms or holding the process open.
 */

export const MAX_ROOMS = 2000;
export const MAX_PEERS = 40;
export const MAX_MESSAGE_CHARS = 16_384;
export const MAX_ROOM_BODY_CHARS = 1024;
export const CREATE_LIMIT = 20;
export const CREATE_WINDOW_MS = 60_000;
export const UPGRADE_LIMIT = 150;
export const UPGRADE_WINDOW_MS = 60_000;
export const SOCKETS_PER_IP = 80;
export const OPS_PER_SEC = 40;
export const NOISE_PER_SEC = 40;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

/** Browser pages that may open a room. Missing or other origins are refused. */
export function allowedOrigin(origin: string | null | undefined): boolean {
    if (!origin) return false;
    let url: URL;
    try {
        url = new URL(origin);
    } catch {
        return false;
    }
    const host = url.hostname.toLowerCase();
    if (url.protocol === "http:" && LOCAL_HOSTS.has(host)) return true;
    if (url.protocol !== "https:") return false;
    if (host === "waifu100.vercel.app") return true;
    return /^waifu100-[a-z0-9-]+-salmondevs-projects\.vercel\.app$/.test(host);
}

export function corsHeaders(origin: string | null | undefined): HeadersInit {
    return {
        "Access-Control-Allow-Origin": origin && allowedOrigin(origin) ? origin : "https://waifu100.vercel.app",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        Vary: "Origin",
    };
}

/** First forwarded address, else the socket address. Capped so it can be a map key. */
export function clientIp(forwardedFor: string | null | undefined, socketAddress: string | null | undefined): string {
    const first = forwardedFor?.split(",")[0]?.trim();
    const ip = first || socketAddress || "unknown";
    return ip.slice(0, 64);
}

/** Display name a peer may choose. Control characters are dropped; the server still assigns one when this is empty. */
export function cleanPeerName(value: unknown): string {
    if (typeof value !== "string") return "";
    return value.replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, 16);
}

export function messageWithinLimit(raw: unknown): boolean {
    const text = typeof raw === "string" ? raw : raw == null ? "" : String(raw);
    return text.length <= MAX_MESSAGE_CHARS;
}

/** Sliding window. `allow` records the hit when it fits. */
export function createWindow(max: number, windowMs: number) {
    const hits = new Map<string, number[]>();
    return {
        allow(key: string, now = Date.now()): boolean {
            const fresh = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
            if (fresh.length >= max) {
                hits.set(key, fresh);
                return false;
            }
            fresh.push(now);
            hits.set(key, fresh);
            if (hits.size > 8000) {
                const oldest = hits.keys().next().value;
                if (oldest) hits.delete(oldest);
            }
            return true;
        },
    };
}

/** How many open sockets one address may hold at once. */
export function createGauge(max: number) {
    const counts = new Map<string, number>();
    return {
        take(key: string): boolean {
            const n = counts.get(key) ?? 0;
            if (n >= max) return false;
            counts.set(key, n + 1);
            return true;
        },
        release(key: string): void {
            const n = (counts.get(key) ?? 1) - 1;
            if (n <= 0) counts.delete(key);
            else counts.set(key, n);
        },
    };
}

/** In-place burst limit for one connection. Drops the hit when it does not fit. */
export function burst(bucket: number[], max: number, windowMs: number, now = Date.now()): boolean {
    while (bucket.length > 0 && now - bucket[0] >= windowMs) bucket.shift();
    if (bucket.length >= max) return false;
    bucket.push(now);
    return true;
}
