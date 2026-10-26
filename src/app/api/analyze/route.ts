import { NextRequest, NextResponse } from "next/server";
import { featureUnavailable } from "@/lib/public-errors";
import { getFlashModel } from "@/lib/gemini";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { STORY_VERDICT_ENABLED } from "@/lib/story/config";
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

    const { characterNames, kind } = await request.json();
    const mode = kind === "story" ? "story" : "waifu";
    if (mode === "story" && !STORY_VERDICT_ENABLED) {
      return NextResponse.json({ error: "Story verdicts are disabled." }, { status: 403 });
    }

    if (!characterNames || characterNames.length === 0) {
      return NextResponse.json(
        { error: "No characters provided. Add some characters to get judged!" },
        { status: 400 }
      );
    }

    if (!process.env.GEMINI_API_KEY) {
      return featureUnavailable("ai", "GEMINI_API_KEY is not set");
    }

    const model = getFlashModel();
    const result = await model.generateContent(buildGridVerdictPrompt(characterNames.slice(0, 100).map((n: unknown) => String(n).slice(0, 120)), mode));
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
