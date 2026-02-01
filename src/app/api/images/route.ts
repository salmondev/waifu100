import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

interface ImageResult {
  url: string;
  thumbnail: string;
  title: string;
}

export async function POST(request: NextRequest) {
  try {
    const { characterName, animeSource } = await request.json();

    if (!characterName) {
      return NextResponse.json(
        { error: "Character name required" },
        { status: 400 }
      );
    }

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY not configured" },
        { status: 500 }
      );
    }

    if (!process.env.GOOGLE_CSE_API_KEY || !process.env.GOOGLE_CSE_ID) {
      return NextResponse.json(
        { error: "Google Custom Search not configured" },
        { status: 500 }
      );
    }

    // Step 1: Use Gemini to generate a precise search query
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    const prompt = `You are helping find the correct anime/game character image. Given this character name and optional source, generate the best Google Image search query to find accurate official character art or fan art.

Character Name: ${characterName}
${animeSource ? `Source (Anime/Game): ${animeSource}` : ""}

Rules:
- Include the full character name
- Include the anime/game/manga source if known
- Add "anime character" or "game character" as appropriate
- Avoid generic terms that might return wrong results
- If the name is common, add distinguishing details

Return ONLY the search query, nothing else. No quotes, no explanation.`;

    const result = await model.generateContent(prompt);
    const searchQuery = (await result.response.text()).trim();

    // Step 2: Call Google Custom Search API
    const searchUrl = new URL("https://www.googleapis.com/customsearch/v1");
    searchUrl.searchParams.set("key", process.env.GOOGLE_CSE_API_KEY);
    searchUrl.searchParams.set("cx", process.env.GOOGLE_CSE_ID);
    searchUrl.searchParams.set("q", searchQuery);
    searchUrl.searchParams.set("searchType", "image");
    searchUrl.searchParams.set("num", "8");
    searchUrl.searchParams.set("safe", "active");
    searchUrl.searchParams.set("imgType", "photo");

    const searchResponse = await fetch(searchUrl.toString());
    
    if (!searchResponse.ok) {
      const errorData = await searchResponse.json();
      console.error("Google CSE error:", errorData);
      const errorMessage = errorData.error?.message || "Unknown error";
      const errorReason = errorData.error?.errors?.[0]?.reason || "";
      return NextResponse.json(
        { 
          error: `Image search failed: ${errorMessage}`,
          details: errorReason,
          hint: errorReason === "accessNotConfigured" 
            ? "Enable the Custom Search API at: https://console.cloud.google.com/apis/library/customsearch.googleapis.com"
            : undefined
        },
        { status: 500 }
      );
    }

    const searchData = await searchResponse.json();

    // Step 3: Format and return results
    const images: ImageResult[] = (searchData.items || []).map((item: {
      link: string;
      image?: { thumbnailLink?: string };
      title: string;
    }) => ({
      url: item.link,
      thumbnail: item.image?.thumbnailLink || item.link,
      title: item.title,
    }));

    return NextResponse.json({
      query: searchQuery,
      images,
    });
  } catch (error) {
    console.error("Image search error:", error);
    return NextResponse.json(
      { error: "Failed to search images" },
      { status: 500 }
    );
  }
}
