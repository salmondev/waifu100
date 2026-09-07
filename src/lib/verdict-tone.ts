/**
 * The Thai voice, in one place.
 *
 * These rules were not written in one go - they are what is left after several
 * rounds of the model sounding like a game-show host in Thai while sounding
 * fine in English. The banned openers, the ban on exclamation marks and the
 * "no particles in the title" rule each exist because a real verdict broke
 * that way.
 *
 * Any new verdict that speaks Thai starts from this text rather than inventing
 * a tone of its own, so a fix applied here reaches all of them and the two
 * prompts cannot drift apart.
 */
export const THAI_VOICE_RULES = "            - **Voice**: a calm, kind friend sitting next to the user, saying one true thing about their taste in a soft, slightly cute way. Think of someone smiling gently, not someone cheering.\n            - **HARD RULES for the Thai text (these override everything else):**\n                1. **No exclamation marks at all.** Not one, in the title, content or tags.\n                2. **Banned openers and interjections**: \"โอ้โห\", \"โห\", \"ว้าว\", \"อู้หู\", \"โอ้\", \"เฮ้ย\", \"อุ๊ย\".\n                3. **Banned hype phrases**: \"สุดๆ\", \"ตัวจริงเสียงจริง\", \"ฟรุ้งฟริ้ง\", \"ชัดๆ\", \"ปัง\", \"จัดเต็ม\", \"ที่สุดในกาแล็กซี\", \"โลกเป็นสีชมพู\", \"ขบวนการ...\", \"รวมดาว\", \"ตัวแม่\", \"สายแข็ง\".\n                4. Use \"นะ\" or \"เลยล่ะ\" at most **once** in the whole content, and **never** \"นะเนี่ย\".\n                5. The Thai **title** is a plain short noun phrase (4-8 words) describing the person - no particles at all (\"นะ\", \"เนี่ย\", \"ล่ะ\", \"ค่ะ\", \"ครับ\"), no punctuation.\n                6. 2-3 short sentences. Plain everyday words. No emoji inside the text.\n            - Say something about *the person* that only their grid could reveal - what they seem to enjoy, what they seem to care about - rather than praising the characters.\n            - **Wrong (theatrical, do not write like this):** \"โอ้โห! นี่มันรวมดาวตัวละครที่ใจดีที่สุดในกาแล็กซีชัดๆ! คุณนี่มันนักสะสมความฟรุ้งฟริ้งตัวจริงเสียงจริงเลยนะเนี่ย!\"\n            - **Right (calm and warm, write like this):** \"ตัวละครที่เลือกมาส่วนใหญ่เป็นคนที่ใจดีกับคนอื่นเงียบ ๆ ไม่ค่อยเรียกร้องอะไร น่าจะเป็นคนที่ชอบเรื่องอบอุ่นมากกว่าเรื่องที่ตื่นเต้น อยู่ใกล้ ๆ แล้วคงสบายใจดี\"\n            - Thai tags: short, plain, no exclamation marks, e.g. \"#อบอุ่น\", \"#ชอบเรื่องเรียบง่าย\", \"#ใจดีเงียบ ๆ\".";

/**
 * The same guidance with no leading indentation, for prompts that are not
 * nested inside a numbered list.
 */
export const THAI_VOICE_RULES_FLAT = THAI_VOICE_RULES.split("\n")
    .map((line) => line.replace(/^ {12}/, ""))
    .join("\n");

/**
 * Bumped whenever the tone rules above change in a way that makes verdicts
 * written under the old rules look wrong next to new ones.
 *
 * A verdict is stored inside its share and never regenerated, so a tone fix
 * only reaches grids shared after it. The stamp is what lets
 * `scripts/migrate-verdicts.mjs` tell an old verdict from a current one -
 * anything without it predates the calm Thai voice.
 *
 * v2 = the THAI_VOICE_RULES above (calm, no exclamation marks, no hype words).
 */
export const GRID_VERDICT_STYLE_VERSION = 2;

/**
 * The prompt behind a grid's AI verdict.
 *
 * It lives here, next to the voice rules, so the migration script can build the
 * exact same prompt the route builds. The script runs under plain `node`, which
 * is why this file has no imports of its own - keep it that way.
 */
export function buildGridVerdictPrompt(characterNames: string[]): string {
    return `You are an observant, warm expert in Anime, Manga, Games, and VTubers.
    You are judging a user's "10x10 Favorite Characters Grid".
    You write in two voices: English is playful, Thai is calm and gentle. They are not translations of each other.
    
    User's characters:
    ${characterNames.map((name, i) => `${i + 1}. ${name}`).join("\n")}
    
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
}

/**
 * Parses the model's reply. Gemini wraps JSON in a ```json fence often enough
 * that stripping it is part of reading the answer, not error handling.
 */
export function parseVerdictJson(text: string): Record<string, unknown> | null {
    try {
        const cleaned = text
            .replace(/```(?:json)?\s*/gi, "")
            .replace(/\s*```$/g, "")
            .trim();
        const parsed = JSON.parse(cleaned);
        return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
        return null;
    }
}
