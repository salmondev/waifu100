import { NextRequest, NextResponse } from "next/server";
import { serperFetch } from "@/server/serper-budget";

// Simple in-memory cache (resets on server restart)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const searchCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
/** The whole search, including a dead upstream, has to answer inside this. */
const SEARCH_BUDGET_MS = 1800;

// Simple rate limiting
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT = 10;
const RATE_WINDOW = 10 * 1000;

interface CharacterResult {
  id: number;
  jikan_id: number | null;
  name: string;
  images: { jpg: { image_url: string } };
  source: string;
  _score?: number;
  _allTitles?: string[];
}

/**
 * Character Search API - Works like Google
 * 
 * No hardcoded patterns - dynamically searches:
 * 1. AniList (anime database)
 * 2. Jikan/MAL (anime database)
 * 3. Serper (Google) for anything not found in anime DBs
 */
export async function POST(request: NextRequest) {
  // const _startTime = Date.now();
  
  try {
    const { characterName, more } = await request.json();
    // Serper only on an explicit "more images" request (T-0009 budget).
    const wantMore = more === true;

    if (!characterName) {
      return NextResponse.json({ error: "Name required" }, { status: 400 });
    }

    const cleanQuery = characterName.trim();
    const cacheKey = cleanQuery.toLowerCase() + (wantMore ? "|more" : "");
    
    // Check cache first
    const cached = searchCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      // console.log(`[Search] Cache hit "${cleanQuery}" (${Date.now() - startTime}ms)`);
      return NextResponse.json(cached.data);
    }

    // Rate limiting
    const clientIP = request.headers.get("x-forwarded-for") || "unknown";
    const now = Date.now();
    const rateData = rateLimitMap.get(clientIP);
    
    if (rateData) {
      if (now > rateData.resetTime) {
        rateLimitMap.set(clientIP, { count: 1, resetTime: now + RATE_WINDOW });
      } else if (rateData.count >= RATE_LIMIT) {
        return NextResponse.json({ error: "Too many requests", characters: [] }, { status: 429 });
      } else {
        rateData.count++;
      }
    } else {
      rateLimitMap.set(clientIP, { count: 1, resetTime: now + RATE_WINDOW });
    }

    // console.log(`[Search] "${cleanQuery}"`);

    const headers = { "Content-Type": "application/json" };

    // RUN ALL SOURCES IN PARALLEL
    const [animeResult, anilistResult, jikanResult, serperResult] = await Promise.allSettled([
      
      // Source 1: Check if query is an anime title
      (async (): Promise<CharacterResult[]> => {
        try {
          const query = `
            query ($search: String) {
              Media(search: $search, type: ANIME) {
                id
                title { userPreferred english romaji }
                characters(sort: FAVOURITES_DESC, perPage: 12) {
                  nodes { id name { full } image { large } }
                }
              }
            }
          `;
          const res = await fetch("https://graphql.anilist.co", {
            method: "POST",
            headers,
            body: JSON.stringify({ query, variables: { search: cleanQuery } }),
            signal: AbortSignal.timeout(SEARCH_BUDGET_MS),
          });
          const data = await res.json();
          const media = data.data?.Media;
          
          if (media) {
            const animeTitle = media.title?.userPreferred || media.title?.english || media.title?.romaji;
            const titleClean = (animeTitle || "").toLowerCase().replace(/[:\-\s]/g, "");
            const queryClean = cleanQuery.toLowerCase().replace(/[:\-\s]/g, "");
            
            // Only return if query closely matches anime title
            if (titleClean.includes(queryClean) || queryClean.includes(titleClean.substring(0, 4))) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              return media.characters?.nodes?.map((c: any) => ({
                id: c.id,
                jikan_id: null,
                name: c.name.full,
                images: { jpg: { image_url: c.image?.large || "" } },
                source: animeTitle,
                _score: 200,
              })) || [];
            }
          }
          return [];
        } catch { return []; }
      })(),

      // Source 2: AniList character search
      (async (): Promise<CharacterResult[]> => {
        try {
          const searchName = cleanQuery.split(/\s+/)[0] || cleanQuery;
          const query = `
            query ($search: String) {
              Page(perPage: 10) {
                characters(search: $search) {
                  id name { full } image { large }
                  media(sort: FAVOURITES_DESC, perPage: 1) {
                    nodes { title { userPreferred english romaji } }
                  }
                }
              }
            }
          `;
          const res = await fetch("https://graphql.anilist.co", {
            method: "POST",
            headers,
            body: JSON.stringify({ query, variables: { search: searchName } }),
            signal: AbortSignal.timeout(SEARCH_BUDGET_MS),
          });
          const data = await res.json();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (data.data?.Page?.characters || []).map((c: any) => {
            const media = c.media?.nodes?.[0];
            return {
              id: c.id,
              jikan_id: null,
              name: c.name.full,
              images: { jpg: { image_url: c.image?.large || "" } },
              source: media?.title?.userPreferred || media?.title?.english || "Unknown",
              _allTitles: [media?.title?.english, media?.title?.romaji, media?.title?.userPreferred]
                .filter(Boolean).map((t: string) => t.toLowerCase()),
            };
          });
        } catch { return []; }
      })(),

      // Source 3: Jikan (MAL)
      (async (): Promise<CharacterResult[]> => {
        try {
          const searchName = cleanQuery.split(/\s+/)[0] || cleanQuery;
          const res = await fetch(`https://api.jikan.moe/v4/characters?q=${encodeURIComponent(searchName)}&limit=10`, {
            signal: AbortSignal.timeout(1200),
          });
          if (!res.ok) return [];
          const data = await res.json();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (data.data || []).map((c: any) => ({
            id: c.mal_id,
            jikan_id: c.mal_id,
            name: c.name,
            images: { jpg: { image_url: c.images?.jpg?.image_url || "" } },
            source: c.anime?.[0]?.anime?.title || "MyAnimeList",
            _allTitles: [c.anime?.[0]?.anime?.title].filter(Boolean).map((t: string) => t.toLowerCase()),
          }));
        } catch { return []; }
      })(),

      // Source 4: Serper runs with the anime databases, not after them.
      // Gemini used to name these pictures and blew the time budget, so the
      // title is taken from the image caption and ranked below a real database hit.
      (async (): Promise<CharacterResult[]> => {
        if (!process.env.SERPER_API_KEY) return [];
        try {
          const searchQuery = wantMore ? `${cleanQuery} character` : `${cleanQuery} anime character`;
          const res = await serperFetch("https://google.serper.dev/images", {
            method: "POST",
            headers: {
              "X-API-KEY": process.env.SERPER_API_KEY,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ q: searchQuery, num: 10, gl: "us", hl: "en" }),
            signal: AbortSignal.timeout(SEARCH_BUDGET_MS),
          });
          if (!res.ok) return [];
          const data = await res.json();
          const images = (data.images || []) as { title?: string; imageUrl?: string }[];
          return images.slice(0, 8).flatMap((img, i) => {
            if (!img.imageUrl) return [];
            const caption = (img.title || "").split(/\s[-–|:(]/)[0]?.trim() ?? "";
            const named = caption.length >= 2 && caption.length <= 40 && !/wallpaper|png|jpe?g|icon/i.test(caption);
            return [{
              id: Date.now() + i,
              jikan_id: null,
              name: named ? caption : cleanQuery,
              images: { jpg: { image_url: img.imageUrl } },
              source: "Web Search",
              _score: named ? 40 : 20,
            }];
          });
        } catch { return []; }
      })(),
    ]);

    // Collect results
    const allResults: CharacterResult[] = [];
    
    // If anime title matched, prioritize those results
    if (animeResult.status === "fulfilled" && animeResult.value.length >= 3) {
      // console.log(`[Search] Anime match (${Date.now() - startTime}ms)`);
      const response = { characters: animeResult.value.slice(0, 12), debugQuery: cleanQuery };
      searchCache.set(cacheKey, { data: response, timestamp: Date.now() });
      return NextResponse.json(response);
    }

    // Add all results
    if (animeResult.status === "fulfilled") allResults.push(...animeResult.value);
    if (anilistResult.status === "fulfilled") allResults.push(...anilistResult.value);
    if (jikanResult.status === "fulfilled") allResults.push(...jikanResult.value);
    if (serperResult.status === "fulfilled") allResults.push(...serperResult.value);

    // Score results based on query match
    const queryWords = cleanQuery.toLowerCase().split(/\s+/);
    const hintWords = queryWords.slice(1).filter((w: string) => w.length > 1);
    
    allResults.forEach((c) => {
      if (c._score) return; // Already scored
      
      let score = 0;
      const nameLower = c.name.toLowerCase();
      const allTitles = (c._allTitles || []).join(" ");

      // Name match
      if (nameLower === queryWords[0]) score += 50;
      else if (nameLower.includes(queryWords[0])) score += 30;

      // Source match
      for (const word of hintWords) {
        if (allTitles.includes(word)) score += 40;
      }

      if (c.source === "MyAnimeList" || c.source === "Unknown") score -= 20;
      if (c.images.jpg.image_url?.length > 10) score += 5;

      c._score = score;
    });

    // Sort and deduplicate
    allResults.sort((a, b) => (b._score || 0) - (a._score || 0));
    
    const seenUrls = new Set<string>();
    const seenNames = new Set<string>();
    const results = allResults.filter((c) => {
      const url = c.images.jpg.image_url;
      const nameLower = c.name.toLowerCase();
      if (!url || seenUrls.has(url)) return false;
      // Allow same name but different images (different versions of character)
      if (seenNames.has(nameLower) && seenNames.size > 5) return false;
      seenUrls.add(url);
      seenNames.add(nameLower);
      return true;
    });

    const finalResults = results.slice(0, 12).map((c) => {
      delete c._score;
      delete c._allTitles;
      return c;
    });

    const response = { characters: finalResults, debugQuery: cleanQuery };
    searchCache.set(cacheKey, { data: response, timestamp: Date.now() });

    // console.log(`[Search] Found ${finalResults.length} (${Date.now() - startTime}ms)`);
    return NextResponse.json(response);
  } catch (error) {
    console.error("[Search] Failed:", error);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
