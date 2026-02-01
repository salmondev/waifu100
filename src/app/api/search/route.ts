import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

export async function POST(request: NextRequest) {
  try {
    const { characterName } = await request.json();

    if (!characterName) {
      return NextResponse.json( { error: "Name required" }, { status: 400 } );
    }

    // Optimization: Skip Gemini for initial search to ensure speed (<2s).
    const cleanQuery = characterName;
    console.log(`Character Discovery: "${cleanQuery}" (Fast Mode)`);

    const headers = { "Content-Type": "application/json" };
    const characters: any[] = [];

    // Parallel Search: Jikan + AniList
    const results = await Promise.allSettled([
        // 1. AniList (Prioritized for richer metadata)
        (async () => {
             const query = `
            query ($search: String) {
                Page(perPage: 6) {
                    characters(search: $search) {
                        id
                        name { full }
                        image { large }
                        media(sort: FAVOURITES_DESC, perPage: 1) {
                           nodes { title { userPreferred } }
                        }
                    }
                }
            }
            `;
            const res = await fetch("https://graphql.anilist.co", {
                method: "POST", 
                headers, 
                body: JSON.stringify({ query, variables: { search: cleanQuery } })
            });
            const data = await res.json();
            return (data.data?.Page?.characters || []).map((c: any) => ({
                id: c.id, // Generic ID for UI key
                jikan_id: null, // AniList ID is NOT Jikan ID
                name: c.name.full,
                images: { jpg: { image_url: c.image.large } },
                source: c.media?.nodes?.[0]?.title?.userPreferred || "AniList"
            }));
        })(),

        // 2. Jikan (Secondary, but provides valid MAL IDs)
        (async () => {
            const res = await fetch(`https://api.jikan.moe/v4/characters?q=${encodeURIComponent(cleanQuery)}&limit=6`);
            const data = await res.json();
            return (data.data || []).map((c: any) => ({
                id: c.mal_id, // Generic ID
                jikan_id: c.mal_id, // Valid Jikan ID
                name: c.name,
                images: { jpg: { image_url: c.images.jpg.image_url } },
                source: "MyAnimeList" 
            }));
        })()
    ]);

    results.forEach(res => {
        if (res.status === "fulfilled" && res.value) {
            characters.push(...res.value);
        }
    });

    // Deduplication + Ranking Strategy:
    // Score results based on how well they match both name AND source from the query.
    // Example: Query "Rem Re:Zero" -> prioritize results with source containing "Re:Zero"
    
    const uniqueChars = new Map();
    const queryLower = cleanQuery.toLowerCase();
    
    // Extract potential source hint from query (anything after the name)
    // e.g., "Rem Re:Zero" -> source hint = "re:zero"
    // e.g., "Nadeshiko Laid-back Camp" -> source hint could be "laid-back camp"
    const queryWords = queryLower.split(/\s+/);
    
    // Score function: higher = better match
    const scoreResult = (c: any): number => {
        let score = 0;
        const nameLower = c.name.toLowerCase();
        const sourceLower = (c.source || "").toLowerCase();
        
        // Name match bonus
        if (queryLower.includes(nameLower)) score += 10;
        if (nameLower.includes(queryWords[0])) score += 5;
        
        // Source match bonus (critical for disambiguation)
        for (const word of queryWords) {
            if (word.length > 2 && sourceLower.includes(word)) {
                score += 20; // Strong bonus for source match
            }
        }
        
        // Penalty for generic sources
        if (c.source === "MyAnimeList" || c.source === "AniList") {
            score -= 5;
        }
        
        return score;
    };
    
    characters.forEach(c => {
        // Source Inference: If source is generic, try to extract from user query
        if (c.source === "MyAnimeList" || c.source === "AniList") {
             const nameLower = c.name.toLowerCase();
             
             if (queryLower.includes(nameLower)) {
                 const remainder = queryLower.replace(nameLower, "").trim();
                 if (remainder.length > 2) {
                     c.source = remainder.charAt(0).toUpperCase() + remainder.slice(1);
                 }
             }
        }

        // Normalize name for matching
        const key = c.name.toLowerCase().trim();
        
        if (!uniqueChars.has(key)) {
            c._score = scoreResult(c);
            uniqueChars.set(key, c);
        } else {
            const existing = uniqueChars.get(key);
            const newScore = scoreResult(c);
            
            // Replace if new result has higher score
            if (newScore > (existing._score || 0)) {
                c._score = newScore;
                uniqueChars.set(key, c);
            }
        }
    });

    // Sort by score (highest first)
    const sortedResults = Array.from(uniqueChars.values())
        .sort((a, b) => (b._score || 0) - (a._score || 0))
        .map(c => { delete c._score; return c; }); // Clean up internal score

    return NextResponse.json({ 
        characters: sortedResults, 
        debugQuery: cleanQuery 
    });

  } catch (error) {
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
