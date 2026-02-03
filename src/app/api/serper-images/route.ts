import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

interface SerperImage {
  title: string;
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  thumbnailUrl: string;
  thumbnailWidth: number;
  thumbnailHeight: number;
  source: string;
  domain: string;
  link: string;
  position: number;
}

interface SerperResponse {
  images: SerperImage[];
  searchParameters: {
    q: string;
    type: string;
    engine: string;
  };
}

interface ImageResult {
  url: string;
  thumbnail: string;
  title: string;
  source: string;
}

/**
 * Serper API Image Search Endpoint
 * 
 * Uses Google's Serper API to search for character images.
 * Gemini AI generates optimized search queries for better accuracy.
 */
export async function POST(request: NextRequest) {
  try {
    const { characterName, animeSource, directQuery } = await request.json();

    if (!characterName && !directQuery) {
      return NextResponse.json(
        { error: "Character name or query required" },
        { status: 400 }
      );
    }

    if (!process.env.SERPER_API_KEY) {
      return NextResponse.json(
        { error: "SERPER_API_KEY not configured" },
        { status: 500 }
      );
    }

    let searchQuery = directQuery || characterName;

    // Use Gemini to optimize the search query for better image results
    if (!directQuery && process.env.GEMINI_API_KEY) {
      try {
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

        const prompt = `Generate the optimal Google Image search query to find accurate anime/game character images.

Character Name: ${characterName}
${animeSource ? `Source (Anime/Game/VTuber): ${animeSource}` : ""}

Rules:
- Include the full character name
- Include the source anime/game/agency if known
- For VTubers, include the agency (Hololive, Nijisanji, etc.)
- Add "official art" or "fanart" as appropriate
- Keep the query concise but specific
- Avoid terms that might return cosplay or unrelated results

Return ONLY the search query, nothing else. No quotes, no explanation.`;

        const result = await model.generateContent(prompt);
        const optimizedQuery = result.response.text().trim();
        
        if (optimizedQuery && optimizedQuery.length > 0) {
          searchQuery = optimizedQuery;
        }
      } catch (e) {
        console.warn("[Serper] Gemini query optimization failed, using raw query:", e);
      }
    }

    // console.log(`[Serper] Searching images for: "${searchQuery}"`);

    // Call Serper API
    const serperResponse = await fetch("https://google.serper.dev/images", {
      method: "POST",
      headers: {
        "X-API-KEY": process.env.SERPER_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        q: searchQuery,
        num: 20,
        gl: "us",
        hl: "en",
      }),
    });

    if (!serperResponse.ok) {
      const errorText = await serperResponse.text();
      console.error("[Serper] API error:", serperResponse.status, errorText);
      return NextResponse.json(
        { error: `Serper API error: ${serperResponse.status}` },
        { status: serperResponse.status }
      );
    }

    const data: SerperResponse = await serperResponse.json();

    // Format results
    const images: ImageResult[] = (data.images || []).map((img) => ({
      url: img.imageUrl,
      thumbnail: img.thumbnailUrl || img.imageUrl,
      title: img.title || "Image",
      source: `Serper (${img.domain || "Google Images"})`,
    }));

    // console.log(`[Serper] Found ${images.length} images`);

    return NextResponse.json({
      query: searchQuery,
      images,
    });
  } catch (error) {
    console.error("[Serper] Image search error:", error);
    return NextResponse.json(
      { error: "Failed to search images" },
      { status: 500 }
    );
  }
}
