/**
 * Browser side of the Gacha Guess API (/api/gacha/*). The anonymous player id
 * lives in localStorage and travels in a header, never in the URL. The server
 * is the only source of truth for the round, coins and album.
 */
import { GACHA_ID_HEADER, GACHA_ID_STORAGE_KEY, isValidGachaId } from "@/lib/gacha-id";
import type { AlbumDto, ArchiveDto, RoundDto } from "@/server/gacha/service";

export type { AlbumDto, ArchiveDto, ArchiveDayState, CardDto, RoundDto } from "@/server/gacha/service";

export class GachaClientError extends Error {
    constructor(public status: number, public code: string, message: string) {
        super(message);
    }
}

function mintId(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
    // RFC 4122 v4 from getRandomValues (older Safari has no randomUUID)
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function gachaId(): string {
    let id: string | null = null;
    try {
        id = localStorage.getItem(GACHA_ID_STORAGE_KEY);
    } catch {
        /* storage blocked: a per-tab id still lets today's round work */
    }
    if (isValidGachaId(id)) return id;
    const next = mintId();
    try {
        localStorage.setItem(GACHA_ID_STORAGE_KEY, next);
    } catch {
        /* ignore */
    }
    return next;
}

export function setGachaId(id: string): void {
    if (!isValidGachaId(id)) throw new GachaClientError(400, "bad_id", "invalid id");
    localStorage.setItem(GACHA_ID_STORAGE_KEY, id);
}

async function call<T>(path: string, method: "GET" | "POST" = "GET", body?: unknown, withId = true): Promise<T> {
    const headers: Record<string, string> = {};
    if (withId) headers[GACHA_ID_HEADER] = gachaId();
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await fetch(`/api/gacha/${path}`, {
        method,
        headers,
        cache: "no-store",
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new GachaClientError(res.status, String(data.code ?? "error"), String(data.error ?? res.statusText));
    return data as T;
}

export const gachaApi = {
    today: () => call<RoundDto & { created?: boolean }>("today"),
    /** A past day from the archive (YYYY-MM-DD); viewing it never uses the day up. */
    day: (day: string) => call<RoundDto>(`today?day=${encodeURIComponent(day)}`),
    archive: () => call<ArchiveDto>("archive"),
    /** `day` only for archive rounds; today's round sends none (old servers ignore nothing new). */
    guess: (charId: number, day?: string) => call<RoundDto>("guess", "POST", day ? { charId, day } : { charId }),
    /** Buys ladder slot `slot` (1-based); the server refuses any slot but the next closed one. */
    hint: (slot: number, day?: string) => call<RoundDto>("hint", "POST", day ? { slot, day } : { slot }),
    album: () => call<AlbumDto>("album"),
    storySeen: (animeId: number) => call<{ animeId: number; fresh: false }>("story-seen", "POST", { animeId }),
    recovery: () => call<{ code: string }>("recovery", "POST", {}),
    restore: (code: string) => call<{ id: string }>("restore", "POST", { code }, false),
};

/** Thai copy for the error codes the routes return. */
export function errorText(e: unknown): string {
    if (e instanceof GachaClientError) {
        if (e.status === 429) return "เล่นเร็วเกินไป รอสักครู่แล้วลองใหม่";
        if (e.code === "invalid_code") return "ไม่พบรหัสนี้ ตรวจตัวอักษรอีกครั้ง";
        if (e.code === "not_enough_coins") return "เหรียญไม่พอ";
        if (e.code === "already_guessed") return "เดาชื่อนี้ไปแล้ว";
        if (e.code === "round_over") return "รอบนี้จบแล้ว";
        if (e.code === "day_unavailable" || e.code === "invalid_day") return "วันนี้ยังเล่นไม่ได้ เลือกวันอื่นจากรายการย้อนหลัง";
    }
    return "เชื่อมต่อไม่ได้ ลองใหม่อีกครั้ง";
}
