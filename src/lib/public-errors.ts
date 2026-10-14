import { NextResponse } from "next/server";

/**
 * User-facing error text (T-0011). Config/internal details (env names, stack
 * messages) go to server logs only; responses carry a generic message + code.
 */
export const UNAVAILABLE = {
    ai: { code: "ai_unavailable", error: "AI features are unavailable right now." },
    imageSearch: { code: "image_search_unavailable", error: "Image search is unavailable right now." },
    webSearch: { code: "web_search_unavailable", error: "Web search is unavailable right now." },
    uploads: { code: "uploads_unavailable", error: "Uploads are unavailable right now." },
} as const;

export type UnavailableFeature = keyof typeof UNAVAILABLE;

/** 503 for a feature that is simply not configured; logs which env var is missing. */
export function featureUnavailable(feature: UnavailableFeature, logDetail: string) {
    console.error(`[config] ${feature} unavailable: ${logDetail}`);
    return NextResponse.json(UNAVAILABLE[feature], { status: 503 });
}

/** Anything that looks like an env var name, secret or internal config detail. */
export const LEAK_PATTERN = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*_(?:API_KEY|TOKEN|SECRET|KEY|URL)\b|not configured|is not defined|process\.env/i;

/**
 * Client-side guard: show a server message only if it is short, readable and
 * free of internal details; otherwise the friendly fallback.
 */
export function friendlyError(message: unknown, fallback: string): string {
    if (typeof message !== "string") return fallback;
    const m = message.trim();
    if (!m || m.length > 200 || LEAK_PATTERN.test(m)) return fallback;
    return m;
}
