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

/** True when the URL points at an actual .gif file (query strings ignored). */
function isGifUrl(url: string): boolean {
  try {
    return new URL(url).pathname.toLowerCase().endsWith(".gif");
  } catch {
    return url.toLowerCase().split("?")[0].endsWith(".gif");
  }
}

/**
 * Animation-first hosts. They serve GIFs through .webp/.mp4 derivatives, so the
 * URL never ends in .gif even though the image really is animated.
 */
function isAnimatedHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return ["tenor.com", "giphy.com", "gfycat.com", "redgifs.com"].some(
      (h) => host === h || host.endsWith(`.${h}`)
    );
  } catch {
    return false;
  }
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
    const { characterName, animeSource, malId, isGif } = await request.json();

    if (!characterName) {
      return NextResponse.json({ error: "Name required" }, { status: 400 });
    }

    const images: ImageResult[] = [];

    // PARALLEL EXECUTION: All 3 sources at once
    const [serperResult, officialResult, fanartResult] = await Promise.allSettled([
      // 1. SERPER (Primary) - Google Images
      (async (): Promise<ImageResult[]> => {
        if (!process.env.SERPER_API_KEY) return [];

        const baseQuery = `${characterName} ${animeSource || ""}`.trim();

        const searchSerper = async (q: string, tbs?: string): Promise<ImageResult[]> => {
          const res = await fetch("https://google.serper.dev/images", {
            method: "POST",
            headers: {
              "X-API-KEY": process.env.SERPER_API_KEY as string,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              q,
              num: isGif ? 50 : 15, // GIF mode filters most results out, so ask for more
              gl: "us",
              hl: "en",
              ...(tbs ? { tbs } : {}),
            }),
          });

          if (!res.ok) {
            console.error("[Gallery] Serper API error:", res.status, await res.text());
            return [];
          }

          const data = await res.json();
          return (data.images || []).map((img: SerperImage) => ({
            url: img.imageUrl,
            thumbnail: img.thumbnailUrl || img.imageUrl,
            title: img.title || "Google Images",
            source: `Google (${img.domain || "Serper"})`,
          }));
        };

        try {
          if (!isGif) {
            return await searchSerper(`${baseQuery} anime character official art`.trim());
          }

          // GIF mode: the old query pasted "fileType:gif" into q, where Google
          // Images treats it as a literal keyword instead of a filter - which is
          // why every GIF search came back empty. Filtering happens through tbs
          // (itp:animated = animated images, ift:gif = GIF file type). Each
          // attempt is only paid for if the previous one found nothing, and the
          // last one drops tbs entirely in case Serper ignores the parameter.
          const attempts: [string, string | undefined][] = [
            [`${baseQuery} anime`.trim(), "itp:animated"],
            [`${baseQuery} anime gif`.trim(), "ift:gif"],
            [`${baseQuery} anime gif`.trim(), undefined],
          ];

          for (const [q, tbs] of attempts) {
            const results = await searchSerper(q, tbs);

            const gifs = results.filter((img: ImageResult) => isGifUrl(img.url));
            if (gifs.length > 0) return gifs;

            // Nothing ends in .gif - keep results from animation-only hosts rather
            // than handing back an empty gallery.
            const animated = results.filter((img: ImageResult) => isAnimatedHost(img.url));
            if (animated.length > 0) return animated;
          }

          return [];
        } catch (e) {
          console.error("[Gallery] Serper error:", e);
          return [];
        }
      })(),

      // 2. JIKAN (Official Art) - Fast via ID lookup
      (async (): Promise<ImageResult[]> => {
        if (isGif) return []; // Jikan only has static JPG/WEBP

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
          // Konachan tags animations as `animated`. The old `gif` tag technically
          // exists but is nearly unused (a single safe post site-wide), so it
          // guaranteed an empty result.
          const tags = isGif
            ? `${cleanName} animated rating:safe`
            : `${cleanName} rating:safe`;

          const url = `https://konachan.net/post.json?limit=15&tags=${encodeURIComponent(tags)}`;
          // console.log(`[Gallery] Konachan: Fetching ${cleanName}`);

          const browserUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
          const res = await fetch(url, { headers: { "User-Agent": browserUA } });
          
          if (res.ok) {
            const json = await res.json();
            if (Array.isArray(json) && json.length > 0) {
              const posts = isGif
                ? json.filter((p: { file_url: string }) => isGifUrl(p.file_url))
                : json;
              if (posts.length > 0) {
                return posts.map((p: { file_url: string; preview_url?: string }) => ({
                  url: p.file_url,
                  thumbnail: p.preview_url || p.file_url,
                  title: "Fanart",
                  source: "Konachan",
                }));
              }
            }
          }
          
          // Retry with broader query if strict failed
          if (animeSource && !isGif) { // Skip broad retry for GIF to keep relevance high
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

    // Per-source counts. An empty gallery otherwise gives no clue whether a source
    // returned nothing, threw, or (for Serper) has no API key configured at all.
    const count = (r: PromiseSettledResult<ImageResult[]>) =>
      r.status === "fulfilled" ? r.value.length : "error";

    return NextResponse.json({
      images: uniqueImages,
      sources: {
        serper: process.env.SERPER_API_KEY ? count(serperResult) : "no-api-key",
        official: count(officialResult),
        fanart: count(fanartResult),
      },
    });
  } catch (error) {
    console.error("[Gallery] Failed:", error);
    return NextResponse.json({ error: "Gallery failed" }, { status: 500 });
  }
}
