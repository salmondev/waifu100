import { NextRequest, NextResponse } from "next/server";
import { getFlashModel } from "@/lib/gemini";

export async function POST(request: NextRequest) {
  try {
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

    const prompt = `You are a fun, observant, and enthusiastic expert in Anime, Manga, Games, and VTubers. 
    You are judging a user's "10x10 Favorite Characters Grid".
    
    User's characters:
    ${characterNames.map((name: string, i: number) => `${i + 1}. ${name}`).join("\n")}
    
    Your task:
    1.  **Analyze**: Look for patterns (e.g., "Wholesome Slice-of-Life", "Shonen Powerhouses", "Strategy & Mind Games", "Nostalgic Classics").
    3.  **Generate a Verdict**:
        - **English**: A short, punchy title, a 3-4 sentence fun/insightful analysis, and 3-4 short hashtags. **Use simple, conversational English.**
        - **Thai**: **DO NOT TRANSLATE FROM ENGLISH.** Write a completely new, natural Thai analysis that fits the context. Use **Natural / Casual Thai**, specific anime terminology where appropriate, but keep it grounded.
            - **Tone**: Fun, friendly, and teasing (like a close friend), but NOT "try-hard" or overly slang-heavy.
            - **Avoid**: "Phasa Wibat" (intentional misspellings), forced trendy slang (e.g., "ตัวแม่จะแคร์เพื่อ", "โฮกปิ๊บ"), or sounding like a bot trying too hard to be cool.
            - Examples of good tone: "งานดี", "สุดจัด", "เบียวได้ใจ", "หวานเจี๊ยบ", "ตึงๆ".
            - Focus on the *insight* and *humor* of the analysis rather than just using slang words.
        - **Tone**: Playful, hyperbolic, and appreciative. **ABSOLUTELY NO meaningful insults, mean-spirited sarcasm, or medical/health metaphors.** 
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
        "title": "จอมมารเบียวตัวพ่อ",
        "content": "รสนิยมแบบนี้มัน... ตึงจัดครับพี่น้อง! ชอบแต่ตัวละครที่แบกโลกไว้คนเดียวหรอ? ระวังตับพังนะบอกก่อน...",
        "tags": ["#เบียว", "#ดาร์ก", "#ตับพังยับ"]
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
