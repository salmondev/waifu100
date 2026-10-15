import { getFlashModel } from "@/lib/gemini";
import { SHARE_TITLE_MAX } from "@/lib/story/config";

/**
 * Basic safety screen for text a visitor typed (grid title, a custom cover's
 * name, a custom character name). Ordinary titles, nicknames and any language
 * pass. A model failure allows the text: this must not take sharing down.
 * The answer is cached per exact string so a repeat submit does not call again.
 */

const CACHE_MAX = 500;
const cache = new Map<string, boolean>();

function remember(key: string, ok: boolean) {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(key, ok);
}

/** True when every label may be stored. Empty input is allowed. */
export async function screenUserTexts(texts: string[]): Promise<boolean> {
    const pending: string[] = [];
    for (const raw of texts) {
        const text = raw.trim().slice(0, SHARE_TITLE_MAX);
        if (!text) continue;
        const known = cache.get(text);
        if (known === false) return false;
        if (known === undefined) pending.push(text);
    }
    const unique = [...new Set(pending)];
    if (unique.length === 0) return true;
    if (!process.env.GEMINI_API_KEY) return true;

    for (let i = 0; i < unique.length; i += 40) {
        const chunk = unique.slice(i, i + 40);
        const ok = await screenChunk(chunk);
        if (!ok) return false;
    }
    return true;
}

async function screenChunk(chunk: string[]): Promise<boolean> {
    const numbered = chunk.map((t, i) => `${i + 1}. ${t.replace(/\s+/g, " ")}`).join("\n");
    const prompt = `You check short labels a person typed for their own fan grid: a grid title, or the name of a show, movie, game, book, or character.
Reply with exactly one word per label, in order, either ALLOW or BLOCK. No other text.

ALLOW names in any language, nicknames, jokes, informal wording, and titles that sound dark, violent, or strange as fiction.
BLOCK only basic safety problems: sexual content involving anyone under 18, slurs, threats of real-world violence, doxxing, scams, or text that is clearly abuse rather than a name.

Labels:
${numbered}`;
    try {
        const reply = (await getFlashModel().generateContent(prompt)).response.text();
        const words = reply.trim().toUpperCase().split(/\s+/).filter(Boolean);
        if (words.length !== chunk.length || words.some((w) => w !== "ALLOW" && w !== "BLOCK")) {
            console.error("[text-screen] unexpected reply, allowing");
            return true;
        }
        let allOk = true;
        words.forEach((w, i) => {
            const ok = w === "ALLOW";
            remember(chunk[i], ok);
            if (!ok) allOk = false;
        });
        return allOk;
    } catch (e) {
        console.error("[text-screen] check failed, allowing:", e);
        return true;
    }
}

/** Test hook. */
export function clearTextScreenCache() {
    cache.clear();
}
