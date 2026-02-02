import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

interface ImageResult {
  url: string;
  thumbnail: string;
  title: string;
  source: string;
}

interface SerperImage {
  title: string;
  imageUrl: string;
  thumbnailUrl: string;
  domain: string;
}

/**
 * Gallery API - Multi-source Image Search
 * 
 * Priority order:
 * 1. Serper (Google Images) - Primary source for accurate results
 * 2. Jikan (MAL) - Official character art
 * 3. Konachan - Anime fanart
 * 
 * All sources run in parallel for speed.
 */
export async function POST(request: NextRequest) {
  try {
    const { characterName, animeSource, malId } = await request.json();

    if (!characterName) {
      return NextResponse.json({ error: "Name required" }, { status: 400 });
    }

    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const images: ImageResult[] = [];

    // Generate optimized search query for Serper using Gemini
    let serperQuery = `${characterName} ${animeSource || ""} anime character`.trim();
    
    if (process.env.GEMINI_API_KEY) {
      try {
        const queryPrompt = `Generate the optimal Google Image search query for this anime/game character:

Character: "${characterName}"
Source: "${animeSource || "Unknown"}"

Rules:
- Include full character name and source
- For VTubers, include agency (Hololive, Nijisanji)
- Add "official art" or "fanart" 
- Keep it concise and specific
- Avoid cosplay/unrelated results

Return ONLY the search query, nothing else.`;

        const queryResult = await model.generateContent(queryPrompt);
        const optimized = queryResult.response.text().trim();
        if (optimized) serperQuery = optimized;
      } catch (e) {
        console.warn("[Gallery] Gemini query generation failed:", e);
      }
    }

    // PARALLEL EXECUTION: All 3 sources at once
    const [serperResult, officialResult, fanartResult] = await Promise.allSettled([
      // 1. SERPER (Primary) - Google Images
      (async (): Promise<ImageResult[]> => {
        if (!process.env.SERPER_API_KEY) {
          console.log("[Gallery] Serper: API key not configured, skipping");
          return [];
        }

        try {
          console.log(`[Gallery] Serper: Searching "${serperQuery}"`);
          
          const res = await fetch("https://google.serper.dev/images", {
            method: "POST",
            headers: {
              "X-API-KEY": process.env.SERPER_API_KEY,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              q: serperQuery,
              num: 15,
              gl: "us",
              hl: "en",
            }),
          });

          if (!res.ok) {
            console.error("[Gallery] Serper failed:", res.status);
            return [];
          }

          const data = await res.json();
          const results = (data.images || []).map((img: SerperImage) => ({
            url: img.imageUrl,
            thumbnail: img.thumbnailUrl || img.imageUrl,
            title: img.title || "Google Images",
            source: `Google (${img.domain || "Serper"})`,
          }));

          console.log(`[Gallery] Serper: Found ${results.length} images`);
          return results;
        } catch (e) {
          console.error("[Gallery] Serper error:", e);
          return [];
        }
      })(),

      // 2. JIKAN (Official Art) - Fast via ID lookup
      (async (): Promise<ImageResult[]> => {
        try {
          let targetId = malId;

          if (!targetId) {
            let q = characterName;
            if (animeSource && animeSource !== "MyAnimeList" && animeSource !== "AniList") {
              q += ` ${animeSource}`;
            }
            const res = await fetch(
              `https://api.jikan.moe/v4/characters?q=${encodeURIComponent(q)}&limit=1`
            );
            if (res.ok) {
              const data = await res.json();
              targetId = data.data?.[0]?.mal_id;
            }
          }

          if (targetId) {
            const picRes = await fetch(
              `https://api.jikan.moe/v4/characters/${targetId}/pictures`
            );
            if (picRes.ok) {
              const picData = await picRes.json();
              return (picData.data || []).map((img: { jpg: { image_url: string } }) => ({
                url: img.jpg.image_url,
                thumbnail: img.jpg.image_url,
                title: "Official Art",
                source: "Official (MAL)",
              }));
            }
          }
        } catch (e) {
          console.error("[Gallery] Jikan error:", e);
        }
        return [];
      })(),

      // 3. KONACHAN (Fanart) - Uses Gemini for tags
      (async (): Promise<ImageResult[]> => {
        try {
          console.log(`[Gallery] Konachan: Starting search for ${characterName}`);

          // Generate Konachan tags
          let tags = `${characterName} rating:safe`;

          if (process.env.GEMINI_API_KEY) {
            try {
              const tagPrompt = `Generate Konachan/Danbooru tags for:
Character: "${characterName}"
Source: "${animeSource || "Anime"}"

Output JSON: {"tags": "character_name_(series) rating:safe", "confidence": "high"}`;

              const result = await model.generateContent(tagPrompt);
              const text = result.response.text();
              const jsonMatch = text.match(/\{[\s\S]*\}/);
              if (jsonMatch) {
                const json = JSON.parse(jsonMatch[0]);
                if (json.tags) tags = json.tags;
              }
            } catch (e) {
              console.warn("[Gallery] Konachan tag gen failed:", e);
            }
          }

          // Sanitize tags
          let searchTags = tags
            .replace(/character_name_\(series\)/gi, "")
            .replace(/rating:explicit/g, "rating:safe")
            .replace(/rating:general/g, "rating:safe");

          if (!searchTags.includes("rating:")) searchTags += " rating:safe";

          const rawTags = searchTags.replace(/rating:[a-z]+/g, "").trim().split(/\s+/);
          const mainTag = rawTags[0] || characterName;
          const searchQuery = `${mainTag} rating:safe`;

          const enc = (t: string) =>
            encodeURIComponent(t).replace(/\(/g, "%28").replace(/\)/g, "%29");

          const browserUA =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

          // Try Konachan
          const url = `https://konachan.net/post.json?limit=15&tags=${enc(searchQuery)}`;
          console.log(`[Gallery] Konachan: Fetching ${url}`);

          const res = await fetch(url, { headers: { "User-Agent": browserUA } });
          if (res.ok) {
            const json = await res.json();
            if (Array.isArray(json) && json.length > 0) {
              return json.map((p: { file_url: string; preview_url?: string }) => ({
                url: p.file_url,
                thumbnail: p.preview_url || p.file_url,
                title: "Fanart",
                source: "Konachan",
              }));
            }
          }

          // Fallback: Broader search
          if (animeSource && animeSource !== "MyAnimeList" && animeSource !== "AniList") {
            const broadTags = `${characterName} ${animeSource} rating:safe`;
            const broadUrl = `https://konachan.net/post.json?limit=15&tags=${enc(broadTags)}`;
            const broadRes = await fetch(broadUrl, { headers: { "User-Agent": browserUA } });
            if (broadRes.ok) {
              const broadJson = await broadRes.json();
              if (Array.isArray(broadJson) && broadJson.length > 0) {
                return broadJson.map((p: { file_url: string; preview_url?: string }) => ({
                  url: p.file_url,
                  thumbnail: p.preview_url || p.file_url,
                  title: "Fanart",
                  source: "Konachan",
                }));
              }
            }
          }
        } catch (e) {
          console.error("[Gallery] Konachan error:", e);
        }
        return [];
      })(),
    ]);

    // Combine results: Serper first (primary), then Official, then Fanart
    if (serperResult.status === "fulfilled") images.push(...serperResult.value);
    if (officialResult.status === "fulfilled") images.push(...officialResult.value);
    if (fanartResult.status === "fulfilled") images.push(...fanartResult.value);

    // Deduplicate by URL
    const seen = new Set<string>();
    const uniqueImages = images.filter((img) => {
      if (seen.has(img.url)) return false;
      seen.add(img.url);
      return true;
    });

    console.log(`[Gallery] Total: ${uniqueImages.length} unique images`);

    return NextResponse.json({ images: uniqueImages });
  } catch (error) {
    console.error("[Gallery] Failed:", error);
    return NextResponse.json({ error: "Gallery failed" }, { status: 500 });
  }
}
