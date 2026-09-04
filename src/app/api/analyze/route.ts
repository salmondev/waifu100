import { NextRequest, NextResponse } from "next/server";
import { getFlashModel } from "@/lib/gemini";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { THAI_VOICE_RULES } from "@/lib/verdict-tone";

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

    const prompt = `You are an observant, warm expert in Anime, Manga, Games, and VTubers.
    You are judging a user's "10x10 Favorite Characters Grid".
    You write in two voices: English is playful, Thai is calm and gentle. They are not translations of each other.
    
    User's characters:
    ${characterNames.map((name: string, i: number) => `${i + 1}. ${name}`).join("\n")}
    
    Your task:
    1.  **Analyze**: Look for patterns (e.g., "Wholesome Slice-of-Life", "Shonen Powerhouses", "Strategy & Mind Games", "Nostalgic Classics").
    3.  **Generate a Verdict**:
        - **English**: A short, punchy title, a 3-4 sentence fun/insightful analysis, and 3-4 short hashtags. **Use simple, conversational English.**
        - **Thai**: **DO NOT TRANSLATE FROM ENGLISH.** Write a completely new Thai analysis. The Thai voice is NOT the English one - it is quieter.
${THAI_VOICE_RULES}
        - **Tone (English only - the Thai voice follows its own guidance above)**: Playful and appreciative. **ABSOLUTELY NO meaningful insults, mean-spirited sarcasm, or medical/health metaphors.**
        - **NEGATIVE CONSTRAINTS**: Do NOT use words like "diabetes", "insulin", "heart attack", "stroke", "addiction", "overdose", or "filling a void". Instead use phrases like "levels of sweetness", "heart-melting", "pure joy", "maximum comfiness".
    4.  **Vibe Check**: 
        - Choose a single **Emoji** that best represents their grid.
    
    IMPORTANT: Return ONLY valid JSON in this exact format:
    {
      "emoji": "💀",
      "en": {
        "title": "The Edgelord",
        "content": "You love suffering and tragic backstories...",
        "tags": ["#Emo", "#Tragedy", "#DarkFantasies"]
      },
      "th": {
        "title": "คนที่ชอบเรื่องเงียบ ๆ",
        "content": "เลือกแต่ตัวละครที่แบกอะไรไว้ในใจเยอะเลยนะ ดูเป็นคนที่อ่านคนเก่ง และชอบเรื่องที่ค่อย ๆ เล่ามากกว่าเรื่องที่ตะโกนใส่ ใครได้คุยด้วยคงสบายใจน่าดู",
        "tags": ["#สายดาร์กอบอุ่น", "#ชอบเรื่องลึก", "#ใจดีแบบเงียบ ๆ"]
      }
    }`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    // Parse the JSON response
    let analysis;
    try {
      const cleanedText = text.replace(/```(?:json)?\s*/gi, "").replace(/\s*```$/g, "").trim();
      analysis = JSON.parse(cleanedText);
    } catch {
      console.error("Failed to parse Gemini analysis response:", text);
      return NextResponse.json(
        { error: "Failed to generate analysis. The AI was too stunned to speak." },
        { status: 500 }
      );
    }

    return NextResponse.json(analysis);
  } catch (error) {
    console.error("Gemini API error (Analyze):", error);
    return NextResponse.json(
      { error: "Failed to analyze taste" },
      { status: 500 }
    );
  }
}
