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
            - **Tone**: soft, warm and gently endearing - like a friend who noticed something lovely about your taste and says it kindly. Cute, not loud.
            - **Write plainly.** Calm sentences, ordinary words, a light smile behind them. End sentences softly ("...นะ", "...เลยล่ะ", "...ครับ/ค่ะ" sparingly). One gentle observation is worth more than three exclamations.
            - **Do NOT be theatrical.** No screaming enthusiasm, no drama-queen voice, no "จริต", no performative flirting or camp. Avoid stacked exclamation marks and ALL-CAPS energy.
            - **Avoid**: "Phasa Wibat" (intentional misspellings), forced trendy slang ("ตัวแม่", "จัดหนักจัดเต็ม", "โฮกปิ๊บ", "สาดดด"), overused hype words ("ปังมาก", "สุดจัดปลัดบอก"), and anything that sounds like a bot trying to be cool.
            - Examples of the right register: "รสนิยมนุ่มนวลใช้ได้เลยนะ", "เลือกตัวละครที่อบอุ่นเป็นส่วนใหญ่", "ดูเป็นคนใจดีนะเนี่ย", "ชอบเรื่องที่ค่อย ๆ เล่าสินะ".
            - Focus on the *insight* and quiet warmth of the analysis, not on slang or volume.
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
