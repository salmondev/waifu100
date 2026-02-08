import { NextRequest, NextResponse } from "next/server";

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

    const images: ImageResult[] = [];

    // PARALLEL EXECUTION: All 3 sources at once
    const [serperResult, officialResult, fanartResult] = await Promise.allSettled([
      // 1. SERPER (Primary) - Google Images
      (async (): Promise<ImageResult[]> => {
        if (!process.env.SERPER_API_KEY) return [];

        try {
          // Fast heuristic query without Gemini
          const serperQuery = `${characterName} ${animeSource || ""} anime character official art`.trim();
          // console.log(`[Gallery] Serper: Searching "${serperQuery}"`);
          
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

          if (!res.ok) return [];

          const data = await res.json();
          const results = (data.images || []).map((img: SerperImage) => ({
            url: img.imageUrl,
            thumbnail: img.thumbnailUrl || img.imageUrl,
            title: img.title || "Google Images",
            source: `Google (${img.domain || "Serper"})`,
          }));

          // console.log(`[Gallery] Serper: Found ${results.length} images`);
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
        } catch { /* ignore */ }
        return [];
      })(),

      // 3. KONACHAN (Fanart) - Fast tags without Gemini
      (async (): Promise<ImageResult[]> => {
        try {
          // Heuristic tag generation: "name_(series)" or just "name"
          // Konachan uses underscores for spaces
          const cleanName = characterName.toLowerCase().replace(/\s+/g, "_");
          const tags = `${cleanName} rating:safe`;
          
          const url = `https://konachan.net/post.json?limit=15&tags=${encodeURIComponent(tags)}`;
          // console.log(`[Gallery] Konachan: Fetching ${cleanName}`);

          const browserUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
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
          
          // Retry with broader query if strict failed
          if (animeSource) {
             const cleanSource = animeSource.toLowerCase().replace(/\s+/g, "_");
             // Try "series_name" tag if character tag failed
             const broadUrl = `https://konachan.net/post.json?limit=10&tags=${encodeURIComponent(cleanSource + " rating:safe")}`;
             const broadRes = await fetch(broadUrl, { headers: { "User-Agent": browserUA } });
             if (broadRes.ok) {
               const json = await broadRes.json();
               if (Array.isArray(json) && json.length > 0) {
                 return json.map((p: { file_url: string; preview_url?: string }) => ({
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
      // Normalize URL for deduplication (ignore query params)
      try {
          const urlObj = new URL(img.url);
          const cleanUrl = urlObj.origin + urlObj.pathname;
          if (seen.has(cleanUrl)) return false;
          seen.add(cleanUrl);
          return true;
      } catch {
          // Fallback for invalid URLs or relative paths
          if (seen.has(img.url)) return false;
          seen.add(img.url);
          return true;
      }
    });

    // console.log(`[Gallery] Total: ${uniqueImages.length} unique images`);

    return NextResponse.json({ images: uniqueImages });
  } catch (error) {
    console.error("[Gallery] Failed:", error);
    return NextResponse.json({ error: "Gallery failed" }, { status: 500 });
  }
}
