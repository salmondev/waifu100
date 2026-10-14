import { NextRequest, NextResponse } from "next/server";
import { featureUnavailable } from "@/lib/public-errors";
import { getFlashModel } from "@/lib/gemini";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { buildStorySuggestPrompt, cleanStorySuggestions, isQuotaError } from "@/lib/story/suggest";

/** Polite answer when Gemini is out of quota or failing - no server details. */
const AI_BUSY = { code: "ai_busy", error: "The AI is busy right now. Please try again in a few minutes." };

export async function POST(request: NextRequest) {
  try {
    // Same Gemini budget as /api/analyze - both are one model call per request.
    const limited = await enforceRateLimit(request, LIMITS.suggest);
    if (limited) return limited;

    const { characterNames, kind } = await request.json();

    if (!characterNames || characterNames.length === 0 || (kind === "story" && !Array.isArray(characterNames))) {
      return NextResponse.json(
        { error: "No characters provided" },
        { status: 400 }
      );
    }

    if (!process.env.GEMINI_API_KEY) {
      return featureUnavailable("ai", "GEMINI_API_KEY is not set");
    }

    const model = getFlashModel();

    // Story100 (parity item 5): titles in, text-only suggestions out (no URLs from the model).
    if (kind === "story") {
      const titles = (characterNames as unknown[]).slice(0, 100).map((n) => String(n).slice(0, 120));
      const res = await model.generateContent(buildStorySuggestPrompt(titles));
      const text = (await res.response).text();
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(text.replace(/```(?:json)?\s*/gi, "").replace(/\s*```$/g, "").trim());
      } catch {
        console.error("[suggest] story: unparsable model reply");
        return NextResponse.json(AI_BUSY, { status: 502 });
      }
      const onBoard = titles.map((t) => t.replace(/\s*\((anime|manga)\)$/i, ""));
      return NextResponse.json({ suggestions: cleanStorySuggestions(parsed, onBoard) });
    }

    const prompt = `You are an expert in Anime, Manga, VTubers, and Video Games (Gacha, JRPG, Visual Novels). Based on the following list of characters that a user has selected as their favorites, suggest 15 similar characters they might also like.

User's favorite characters:
${characterNames.map((name: string, i: number) => `${i + 1}. ${name}`).join("\n")}

Analyze the themes, personality types, art styles, genres, and appeal of these characters. Then suggest 15 OTHER characters (not in the list above) that share similar qualities. 
You MUST include a mix of characters from Anime, Video Games (e.g., Genshin Impact, Fate/Grand Order, Persona, Nier, etc.), and VTubers (Hololive, Nijisanji, etc.) if they fit the vibe.

IMPORTANT: Return ONLY valid JSON in this exact format, no markdown, no code blocks:
{
  "suggestions": [
    {"name": "Character Name", "from": "Anime/Game Title", "reason": "Brief reason why similar (max 15 words)"},
    ... (15 items total)
  ]
}`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    // Parse the JSON response
    let suggestions;
    try {
      // Remove any markdown code blocks if present (handles ```json, ``` with whitespace variations)
      const cleanedText = text.replace(/```(?:json)?\s*/gi, "").replace(/\s*```$/g, "").trim();
      suggestions = JSON.parse(cleanedText);
    } catch {
      console.error("Failed to parse Gemini response:", text);
      return NextResponse.json(
        { error: "Failed to parse AI response" },
        { status: 500 }
      );
    }

    return NextResponse.json(suggestions);
  } catch (error) {
    // Full details stay in the server log; the client gets a polite, generic answer.
    console.error("Gemini API error:", error);
    if (isQuotaError(error)) return NextResponse.json(AI_BUSY, { status: 503 });
    return NextResponse.json(
      { ...AI_BUSY, error: "Failed to get suggestions" },
      { status: 500 }
    );
  }
}
