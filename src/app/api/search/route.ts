import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

// Simple in-memory cache (resets on server restart)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const searchCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

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
    const { characterName } = await request.json();

    if (!characterName) {
      return NextResponse.json({ error: "Name required" }, { status: 400 });
    }

    const cleanQuery = characterName.trim();
    const cacheKey = cleanQuery.toLowerCase();
    
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
          const res = await fetch(`https://api.jikan.moe/v4/characters?q=${encodeURIComponent(searchName)}&limit=10`);
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

      // Source 4: Serper (Google) - ALWAYS runs for any query
      // This is the "Google-like" fallback that handles games, VTubers, etc.
      (async (): Promise<CharacterResult[]> => {
        if (!process.env.SERPER_API_KEY) return [];
        
        try {
          const searchQuery = `${cleanQuery} character`;
          const res = await fetch("https://google.serper.dev/images", {
            method: "POST",
            headers: {
              "X-API-KEY": process.env.SERPER_API_KEY,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ q: searchQuery, num: 12, gl: "us", hl: "en" }),
          });

          if (!res.ok) return [];
          const data = await res.json();
          const images = data.images || [];
          if (images.length === 0) return [];

          // If Gemini is available, use it to extract character names
          if (process.env.GEMINI_API_KEY) {
            try {
              const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
              
              // Generic prompt - works for ANY franchise
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const imageTitles = images.slice(0, 8).map((img: any, i: number) => `${i}. ${img.title}`).join("\n");
              const prompt = `From these image search results for "${cleanQuery}", identify individual character names.

Image titles:
${imageTitles}

Return JSON array of characters found:
[{"name": "CharacterName", "source": "Franchise/Game/Series"}]

Rules:
- Only return INDIVIDUAL character names (not "All Characters", "Tier List", etc.)
- Include the source franchise/game/series for each character
- Return up to 6 characters
- ONLY return JSON, no explanation`;

              const result = await model.generateContent(prompt);
              const text = result.response.text().trim();
              const jsonMatch = text.match(/\[[\s\S]*?\]/);
              
              if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const validChars = parsed.filter((c: any) => {
                  const name = (c.name || "").toLowerCase();
                  return name.length > 1 
                    && !name.includes("character") 
                    && !name.includes("tier")
                    && !name.includes("list")
                    && !name.includes("all ");
                });
                
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                return validChars.slice(0, 6).map((char: any, i: number) => {
                  const charNameLower = char.name.toLowerCase();
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const matchingImg = images.find((img: any) => 
                    img.title?.toLowerCase().includes(charNameLower)
                  ) || images[i] || images[0];
                  
                  return {
                    id: Date.now() + i,
                    jikan_id: null,
                    name: char.name,
                    images: { jpg: { image_url: matchingImg.imageUrl } },
                    source: char.source || cleanQuery,
                    _score: 100 + (6 - i) * 10, // Lower than anime DB results
                  };
                });
              }
            } catch { /* Gemini failed, continue */ }
          }
          
          // Fallback: Just return images with query as name
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return images.slice(0, 4).map((img: any, i: number) => ({
            id: Date.now() + i,
            jikan_id: null,
            name: cleanQuery,
            images: { jpg: { image_url: img.imageUrl } },
            source: "Web Search",
            _score: 50,
          }));
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
