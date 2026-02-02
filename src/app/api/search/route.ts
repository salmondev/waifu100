import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

// Simple in-memory cache for common searches (resets on server restart)
const searchCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Simple rate limiting (per IP, resets on server restart)
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT = 10; // max requests
const RATE_WINDOW = 10 * 1000; // per 10 seconds


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
 * Character Search API - Optimized for speed
 * 
 * Strategy:
 * 1. Check cache first
 * 2. Run ALL sources in parallel (anime detection, AniList, Jikan, Serper)
 * 3. Smart ranking and deduplication
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    const { characterName } = await request.json();

    if (!characterName) {
      return NextResponse.json({ error: "Name required" }, { status: 400 });
    }

    const cleanQuery = characterName.trim();
    const cacheKey = cleanQuery.toLowerCase();
    
    // Check cache first (always allow cached results)
    const cached = searchCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      console.log(`[Search] Cache hit for "${cleanQuery}" (${Date.now() - startTime}ms)`);
      return NextResponse.json(cached.data);
    }

    // Rate limiting check (only for non-cached requests)
    const clientIP = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown";
    const now = Date.now();
    const rateData = rateLimitMap.get(clientIP);
    
    if (rateData) {
      if (now > rateData.resetTime) {
        // Reset window
        rateLimitMap.set(clientIP, { count: 1, resetTime: now + RATE_WINDOW });
      } else if (rateData.count >= RATE_LIMIT) {
        // Rate limited - return last cached result if available or 429
        console.log(`[Search] Rate limited: ${clientIP}`);
        return NextResponse.json(
          { error: "Too many requests, please slow down", characters: [] },
          { status: 429 }
        );
      } else {
        rateData.count++;
      }
    } else {
      rateLimitMap.set(clientIP, { count: 1, resetTime: now + RATE_WINDOW });
    }

    const queryWords = cleanQuery.toLowerCase().split(/\s+/);
    const searchName = queryWords[0] || cleanQuery;
    const sourceHint = queryWords.slice(1).join(" ");
    const hintWords = sourceHint.split(/[\s:]+/).filter((w: string) => w.length > 1);

    // Detect if this looks like a non-anime query
    const nonAnimePatterns = ["hololive", "nijisanji", "vtuber", "genshin", "honkai", "final fantasy", "persona", "fate/grand", "azur lane", "arknights", "blue archive", "nier", "league", "valorant", "apex"];
    const isNonAnimeQuery = nonAnimePatterns.some(kw => cleanQuery.toLowerCase().includes(kw));

    console.log(`[Search] "${cleanQuery}" (parallel mode)`);

    const headers = { "Content-Type": "application/json" };

    // RUN ALL SOURCES IN PARALLEL
    const [animeResult, anilistResult, jikanResult, serperResult] = await Promise.allSettled([
      // Source 1: Anime detection (check if query is an anime name)
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
          });
          const data = await res.json();
          const media = data.data?.Media;
          
          if (media) {
            const animeTitle = media.title?.userPreferred || media.title?.english || media.title?.romaji;
            const titleClean = (animeTitle || "").toLowerCase().replace(/[:\-\s]/g, "");
            const queryClean = cleanQuery.toLowerCase().replace(/[:\-\s]/g, "");
            
            // Check if query matches anime title
            if (titleClean.includes(queryClean) || queryClean.includes(titleClean.substring(0, 5))) {
              return media.characters?.nodes?.map((c: any) => ({
                id: c.id,
                jikan_id: null,
                name: c.name.full,
                images: { jpg: { image_url: c.image?.large || "" } },
                source: animeTitle,
                _score: 200, // High priority for anime matches
              })) || [];
            }
          }
          return [];
        } catch { return []; }
      })(),

      // Source 2: AniList character search
      (async (): Promise<CharacterResult[]> => {
        try {
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
          });
          const data = await res.json();
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
          const res = await fetch(`https://api.jikan.moe/v4/characters?q=${encodeURIComponent(searchName)}&limit=10`);
          if (!res.ok) return [];
          const data = await res.json();
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

      // Source 4: Serper (Google) + Gemini for accurate extraction
      (async (): Promise<CharacterResult[]> => {
        if (!isNonAnimeQuery || !process.env.SERPER_API_KEY || !process.env.GEMINI_API_KEY) return [];
        
        try {
          // Search for character images
          const searchQuery = `${cleanQuery} character`;
          const res = await fetch("https://google.serper.dev/images", {
            method: "POST",
            headers: {
              "X-API-KEY": process.env.SERPER_API_KEY,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ q: searchQuery, num: 15, gl: "us", hl: "en" }),
          });

          if (!res.ok) return [];
          const data = await res.json();
          const images = data.images || [];
          if (images.length === 0) return [];

          // Use Gemini to get ACCURATE character names (not just extracting from titles)
          const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
          
          // Better prompt: Ask Gemini to list KNOWN characters from the franchise
          const prompt = `You are an expert on ${cleanQuery}.

List 8 of the most POPULAR and WELL-KNOWN characters from "${cleanQuery}".

For games like Genshin Impact, Honkai Star Rail: list playable characters (e.g., Kafka, Acheron, Seele, Bronya).
For VTubers/Hololive: list actual VTuber names (e.g., Gawr Gura, Mori Calliope, Shion Murasaki).
For other franchises: list main characters.

Return ONLY a JSON array with no explanation:
[{"name": "Kafka", "source": "Honkai Star Rail"}, {"name": "Acheron", "source": "Honkai Star Rail"}]

IMPORTANT: Return REAL character names, not generic terms like "Characters" or "Tier List".`;

          const result = await model.generateContent(prompt);
          const text = result.response.text().trim();
          const jsonMatch = text.match(/\[[\s\S]*?\]/);
          
          if (!jsonMatch) return [];
          
          const parsed = JSON.parse(jsonMatch[0]);
          const validChars = parsed.filter((c: any) => {
            const name = (c.name || "").toLowerCase();
            return name.length > 1 
              && !name.includes("character") 
              && !name.includes("tier")
              && !name.includes("list")
              && !name.includes("guide");
          });
          
          // Match each character to an image by searching titles
          return validChars.slice(0, 8).map((char: any, i: number) => {
            // Try to find an image that matches this character name
            const charNameLower = char.name.toLowerCase();
            const matchingImg = images.find((img: any) => 
              img.title?.toLowerCase().includes(charNameLower)
            ) || images[i] || images[0];
            
            return {
              id: Date.now() + i,
              jikan_id: null,
              name: char.name,
              images: { jpg: { image_url: matchingImg.imageUrl } },
              source: char.source || cleanQuery,
              _score: 150 + (8 - i) * 10,
            };
          });
        } catch (e) { 
          console.error("[Serper] Error:", e);
          return []; 
        }
      })(),
    ]);

    // Collect all results
    const allResults: CharacterResult[] = [];
    
    // Check if anime detection found results - if so, return immediately
    if (animeResult.status === "fulfilled" && animeResult.value.length >= 3) {
      console.log(`[Search] Anime match (${Date.now() - startTime}ms)`);
      const response = { characters: animeResult.value.slice(0, 12), debugQuery: cleanQuery };
      searchCache.set(cacheKey, { data: response, timestamp: Date.now() });
      return NextResponse.json(response);
    }

    // Add results from all sources
    if (animeResult.status === "fulfilled") allResults.push(...animeResult.value);
    if (anilistResult.status === "fulfilled") allResults.push(...anilistResult.value);
    if (jikanResult.status === "fulfilled") allResults.push(...jikanResult.value);
    if (serperResult.status === "fulfilled") allResults.push(...serperResult.value);

    // Score results
    allResults.forEach((c) => {
      if (c._score) return; // Already scored (Serper results)
      
      let score = 0;
      const nameLower = c.name.toLowerCase();
      const allTitles = (c._allTitles || []).join(" ");

      if (nameLower === searchName) score += 50;
      else if (nameLower.includes(searchName)) score += 30;

      if (hintWords.length > 0) {
        for (const word of hintWords) {
          if (allTitles.includes(word)) score += 50;
        }
      }

      if (c.source === "MyAnimeList" || c.source === "Unknown") score -= 30;
      if (c.images.jpg.image_url?.length > 10) score += 5;

      c._score = score;
    });

    // Sort and deduplicate
    allResults.sort((a, b) => (b._score || 0) - (a._score || 0));
    
    const seenUrls = new Set<string>();
    const results = allResults.filter((c) => {
      const url = c.images.jpg.image_url;
      if (!url || seenUrls.has(url)) return false;
      seenUrls.add(url);
      return true;
    });

    const finalResults = results.slice(0, 12).map((c) => {
      delete c._score;
      delete c._allTitles;
      return c;
    });

    const response = { characters: finalResults, debugQuery: cleanQuery };
    searchCache.set(cacheKey, { data: response, timestamp: Date.now() });

    console.log(`[Search] Found ${finalResults.length} (${Date.now() - startTime}ms)`);
    return NextResponse.json(response);
  } catch (error) {
    console.error("[Search] Failed:", error);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
