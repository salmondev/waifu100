import { NextRequest, NextResponse } from "next/server";
import { withRedis } from "@/lib/redis";
import { getFlashModel } from "@/lib/gemini";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { readShares, isValidShareId } from "@/lib/share-store";
import { compareGrids } from "@/lib/character-match";
import { THAI_VOICE_RULES_FLAT } from "@/lib/verdict-tone";
import { AnalysisResult } from "@/types";

export const dynamic = "force-dynamic";

/**
 * Redis key for a pair, with the ids sorted.
 *
 * Sorting is the whole point: a comparison is symmetric, so `?a=x&b=y` and
 * `?a=y&b=x` must hit the same cache entry. Without it the same pair would pay
 * for two Gemini calls, and the two pages would disagree about the verdict.
 */
export function comparePairKey(idA: string, idB: string): string {
    const [lo, hi] = [idA, idB].sort();
    return `waifu100:compare:${lo}:${hi}`;
}

// Neither grid can change after it is shared, so the verdict for a pair is
// stable - the TTL is only there to stop dead pairs accumulating forever.
const CACHE_TTL_SEC = 60 * 60 * 24 * 30;

// How many names of each kind reach the prompt. The verdict is about a shape,
// not an inventory, and 200 names is mostly tokens spent on the tail.
const MAX_SHARED = 40;
const MAX_UNIQUE = 20;

interface CachedVerdict {
    verdict: AnalysisResult;
    createdAt: string;
}

function isVerdictShaped(value: unknown): value is AnalysisResult {
    const v = value as AnalysisResult | null;
    return !!v && !!v.en?.title && !!v.en?.content && !!v.th?.title && !!v.th?.content;
}

/**
 * The AI verdict on a pair of grids.
 *
 * Cached in Redis under the sorted pair, because this is the only place in the
 * app where someone can spend a Gemini call by pressing a button on a page they
 * did not create - and a compare link is exactly the kind of thing that gets
 * opened by a hundred people in a Discord channel at once. The first of them
 * pays for the call; everyone after reads the same answer.
 *
 * The verdict never mentions which grid is which, deliberately: one cache entry
 * has to read correctly from both directions.
 */
export async function POST(req: NextRequest) {
    try {
        const limited = await enforceRateLimit(req, LIMITS.compareVerdict);
        if (limited) return limited;

        const { a, b } = await req.json();

        if (!isValidShareId(a) || !isValidShareId(b) || a === b) {
            return NextResponse.json({ error: "Two different grid ids are required." }, { status: 400 });
        }

        const key = comparePairKey(a, b);

        const cached = await withRedis((redis) => redis.get(key));
        if (cached) {
            try {
                const parsed: CachedVerdict = JSON.parse(cached);
                if (isVerdictShaped(parsed.verdict)) {
                    return NextResponse.json({ verdict: parsed.verdict, cached: true });
                }
            } catch {
                // A malformed entry just means regenerating it.
            }
        }

        if (!process.env.GEMINI_API_KEY) {
            return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 });
        }

        const [shareA, shareB] = await readShares([a, b]);
        if (!shareA || !shareB) {
            return NextResponse.json({ error: "Grid not found" }, { status: 404 });
        }

        const result = compareGrids(shareA.grid, shareB.grid);

        // Nothing to say about two grids that have not met.
        if (result.countA === 0 || result.countB === 0) {
            return NextResponse.json({ error: "Both grids need characters." }, { status: 400 });
        }

        const shared = result.shared.slice(0, MAX_SHARED).map((pair) => pair.name);
        const uniqueOne = result.onlyA.slice(0, MAX_UNIQUE).map((c) => c.name);
        const uniqueTwo = result.onlyB.slice(0, MAX_UNIQUE).map((c) => c.name);

        const prompt = `You are an observant, warm expert in Anime, Manga, Games, and VTubers.
Two people have each built a "100 favorite characters" grid, and you are describing what the pair of them look like side by side.
You write in two voices: English is playful, Thai is calm and gentle. They are not translations of each other.

They overlap on ${result.shared.length} characters (${result.similarity}% similar).

Characters BOTH of them picked:
${shared.length ? shared.map((n, i) => `${i + 1}. ${n}`).join("\n") : "(none at all)"}

Only the first person picked:
${uniqueOne.map((n, i) => `${i + 1}. ${n}`).join("\n") || "(none)"}

Only the second person picked:
${uniqueTwo.map((n, i) => `${i + 1}. ${n}`).join("\n") || "(none)"}

Your task:
1. **Analyze the pair**: what the shared picks say about where their taste meets, and what the differences say about where it splits. Talk about the two of them together - "you two", "ทั้งสองคน" - never "person A" or "the first grid", and never refer to the order they were given in.
2. **Generate a Verdict**:
   - **English**: a short, punchy title for this pairing, a 3-4 sentence read on the two of them, and 3-4 short hashtags. Use simple, conversational English.
   - **Thai**: **DO NOT TRANSLATE FROM ENGLISH.** Write a completely new Thai text. The Thai voice is NOT the English one - it is quieter.
${THAI_VOICE_RULES_FLAT}
   - **Tone (English only)**: playful and appreciative about both sides. **ABSOLUTELY NO meaningful insults, mean-spirited sarcasm, or medical/health metaphors.** Never suggest one person's taste is better than the other's.
   - **NEGATIVE CONSTRAINTS**: do NOT use words like "diabetes", "insulin", "heart attack", "stroke", "addiction", "overdose", or "filling a void".
   - When the overlap is small, say what they could show each other rather than treating it as a failure.
3. **Vibe Check**: choose a single **Emoji** for this pairing.

IMPORTANT: Return ONLY valid JSON in this exact format:
{
  "emoji": "🤝",
  "en": {
    "title": "Same Shelf, Different Rows",
    "content": "You both went straight for the quiet ones...",
    "tags": ["#SharedTaste", "#SoftBois", "#SwapLists"]
  },
  "th": {
    "title": "คนสองคนที่ชอบเรื่องเงียบ ๆ เหมือนกัน",
    "content": "ทั้งสองคนเลือกตัวละครที่ไม่ค่อยส่งเสียงดังเหมือนกัน ต่างกันตรงที่อีกฝ่ายชอบเรื่องที่ยาวกว่าหน่อย ถ้าแลกลิสต์กันน่าจะมีอะไรให้ดูอีกเยอะ",
    "tags": ["#ชอบเหมือนกัน", "#คนละมุม", "#แลกลิสต์กัน"]
  }
}`;

        const model = getFlashModel();
        const generated = await model.generateContent(prompt);
        const text = (await generated.response).text();

        let verdict: AnalysisResult;
        try {
            const cleaned = text
                .replace(/```(?:json)?\s*/gi, "")
                .replace(/\s*```$/g, "")
                .trim();
            verdict = JSON.parse(cleaned);
        } catch {
            console.error("Failed to parse compare verdict response:", text);
            return NextResponse.json({ error: "Failed to generate a verdict." }, { status: 500 });
        }

        if (!isVerdictShaped(verdict)) {
            return NextResponse.json({ error: "Failed to generate a verdict." }, { status: 500 });
        }

        const payload: CachedVerdict = { verdict, createdAt: new Date().toISOString() };
        // Cache failures must not lose a verdict already paid for.
        try {
            await withRedis((redis) => redis.set(key, JSON.stringify(payload), "EX", CACHE_TTL_SEC));
        } catch (e) {
            console.error("Compare verdict cache write failed:", e);
        }

        return NextResponse.json({ verdict, cached: false });
    } catch (e) {
        console.error("Compare Verdict Error:", e);
        return NextResponse.json({ error: "Failed to generate a verdict." }, { status: 500 });
    }
}
