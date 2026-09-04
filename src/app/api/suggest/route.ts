import { NextRequest, NextResponse } from "next/server";
import { getFlashModel } from "@/lib/gemini";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  try {
    // Same Gemini budget as /api/analyze - both are one model call per request.
    const limited = await enforceRateLimit(request, LIMITS.suggest);
    if (limited) return limited;

    const { characterNames } = await request.json();

    if (!characterNames || characterNames.length === 0) {
      return NextResponse.json(
        { error: "No characters provided" },
        { status: 400 }
      );
    }

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY not configured" },
        { status: 500 }
      );
    }

    const model = getFlashModel();

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
    console.error("Gemini API error:", error);
    return NextResponse.json(
      { error: "Failed to get suggestions" },
      { status: 500 }
    );
  }
}
