/**
 * Story100 AI suggest (parity item 5). The model may only give us TEXT:
 * a title, ANIME/MANGA and a short reason. Anything else it sends (image
 * URLs, links, ids it made up) is dropped here; images for a suggestion come
 * from the normal search -> /api/story/images -> proxied() flow.
 */
import type { MediaType } from "@/lib/share-schema";

export interface StorySuggestion {
    title: string;
    type: MediaType;
    reason: string;
}
export const STORY_SUGGEST_MAX = 10;
const URLISH = /(?:[a-z][a-z0-9+.-]*:\/\/|www\.|data:|blob:)/i;

export function buildStorySuggestPrompt(titles: string[]): string {
    return `You are an expert in anime and manga. A user ranked these titles as their favourites:
${titles.map((t, i) => `${i + 1}. ${t}`).join("\n")}

Suggest ${STORY_SUGGEST_MAX} OTHER anime or manga (not in the list) they would likely enjoy, based on themes, genre, tone and appeal.
Return ONLY valid JSON, no markdown, in exactly this shape:
{"suggestions":[{"title":"Official English or romaji title","type":"ANIME" or "MANGA","reason":"max 15 words"}]}
Do not include links, image URLs or ids.`;
}

/** Keep only well-formed text suggestions; drop URLs, duplicates and titles already on the board. */
export function cleanStorySuggestions(raw: unknown, onBoard: string[]): StorySuggestion[] {
    const list = (raw as { suggestions?: unknown })?.suggestions;
    if (!Array.isArray(list)) return [];
    const seen = new Set(onBoard.map((t) => t.trim().toLowerCase()));
    const out: StorySuggestion[] = [];
    for (const s of list) {
        const o = s as Record<string, unknown> | null;
        const title = typeof o?.title === "string" ? o.title.trim().replace(/\s+/g, " ").slice(0, 120) : "";
        if (title.length < 2 || URLISH.test(title)) continue;
        const key = title.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const reasonRaw = typeof o?.reason === "string" ? o.reason : "";
        const reason = URLISH.test(reasonRaw) ? "" : reasonRaw.trim().slice(0, 160);
        out.push({ title, type: o?.type === "MANGA" ? "MANGA" : "ANIME", reason });
        if (out.length >= STORY_SUGGEST_MAX) break;
    }
    return out;
}

/** Gemini quota / rate errors look like this; used to give a polite "busy" answer. */
export function isQuotaError(e: unknown): boolean {
    const m = e instanceof Error ? `${e.message} ${(e as { status?: unknown }).status ?? ""}` : String(e);
    return /\b429\b|quota|RESOURCE_EXHAUSTED|rate.?limit|Too Many Requests/i.test(m);
}
