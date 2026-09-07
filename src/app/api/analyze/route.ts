import { NextRequest, NextResponse } from "next/server";
import { getFlashModel } from "@/lib/gemini";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import {
  buildGridVerdictPrompt,
  parseVerdictJson,
  GRID_VERDICT_STYLE_VERSION,
} from "@/lib/verdict-tone";

export async function POST(request: NextRequest) {
  try {
    // This route spends a Gemini call per request and has to stay open to the
    // public, so it cannot sit behind ADMIN_TOKEN - the public gets a budget.
    const limited = await enforceRateLimit(request, LIMITS.analyze);
    if (limited) return limited;

    const { characterNames } = await request.json();

    if (!characterNames || characterNames.length === 0) {
      return NextResponse.json(
        { error: "No characters provided. Add some characters to get judged!" },
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
    const result = await model.generateContent(buildGridVerdictPrompt(characterNames));
    const text = (await result.response).text();

    const analysis = parseVerdictJson(text);
    if (!analysis) {
      console.error("Failed to parse Gemini analysis response:", text);
      return NextResponse.json(
        { error: "Failed to generate analysis. The AI was too stunned to speak." },
        { status: 500 }
      );
    }

    // Stamped so a later tone change can find the verdicts written under the
    // old rules - see GRID_VERDICT_STYLE_VERSION.
    return NextResponse.json({ ...analysis, styleVersion: GRID_VERDICT_STYLE_VERSION });
  } catch (error) {
    console.error("Gemini API error (Analyze):", error);
    return NextResponse.json(
      { error: "Failed to analyze taste" },
      { status: 500 }
    );
  }
}
