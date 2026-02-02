import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

export async function POST(request: NextRequest) {
  try {
    const { characterName, animeSource, malId } = await request.json();

    if (!characterName) {
      return NextResponse.json( { error: "Name required" }, { status: 400 } );
    }

    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const images: any[] = [];

    // EXECUTE PARALLEL WORKFLOWS
    // 1. Official Art (Jikan) - Fast & Precise via ID
    const officialArtPromise = (async () => {
         try {
             let targetId = malId;
             
             // If no ID provided, we must search (slower/less precise)
             // But usually frontend provides ID now.
             if (!targetId) {
                 // Enhance Jikan Search: Use "Name Source" to disambiguate
                 let q = characterName;
                 if (animeSource && animeSource !== "MyAnimeList" && animeSource !== "AniList") {
                     q += ` ${animeSource}`;
                 }
                 const res = await fetch(`https://api.jikan.moe/v4/characters?q=${encodeURIComponent(q)}&limit=1`);
                 if (res.ok) {
                     const data = await res.json();
                     targetId = data.data?.[0]?.mal_id;
                 }
             }

             if (targetId) {
                 const picRes = await fetch(`https://api.jikan.moe/v4/characters/${targetId}/pictures`);
                 if (picRes.ok) {
                     const picData = await picRes.json();
                     return (picData.data || []).map((img: any) => ({
                         url: img.jpg.image_url,
                         thumbnail: img.jpg.image_url,
                         title: `Official Art`,
                         source: "Official (MAL)"
                     }));
                 }
             }
         } catch (e) {
             console.error("Jikan fetch failed", e);
         }
         return [];
    })();

    // 2. Fanart (Konachan) - Require Gemini for Tags
    const fanartPromise = (async () => {
         try {
            console.log(`[Gallery] Starting Fanart Search for: ${characterName} (Source: ${animeSource})`);
            
            // Step A: Gemini Tag Gen
            const prompt = `Generate Konachan/Danbooru tags for:
Character: "${characterName}"
Source: "${animeSource || "Anime"}"

Output JSON:
{
  "tags": "character_name_(series) rating:general",
  "confidence": "high"
}`;
            
            let tags = `${characterName} rating:general`;
            try {
                const result = await model.generateContent(prompt);
                const text = result.response.text();
                // Robust Extract: Find the first { ... } block
                const jsonMatch = text.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    const json = JSON.parse(jsonMatch[0]);
                    if (json.tags) tags = json.tags;
                }
                console.log(`[Gallery] Gemini Tags: ${tags}`);
            } catch (e) {
                console.warn("[Gallery] Gemini Tag Gen failed, using raw fallback", e);
            }

            // Step B: Fetch Konachan
            let searchTags = tags;
            // Sanitize: Remove placeholders and fix rating (Use Regex for safety)
            searchTags = searchTags.replace(/character_name_\(series\)/gi, "");
            if (!searchTags.includes("rating:")) searchTags += " rating:safe";
            searchTags = searchTags.replace(/rating:explicit/g, "rating:safe");
            searchTags = searchTags.replace(/rating:general/g, "rating:safe"); 

            // Multi-Provider Strategy
            // Danbooru is often DNS-blocked, so we go straight to Konachan (more accessible)
            
            let data: any[] = [];
            let usedProvider = "";
            
            // Clean tags - extract the main character tag
            const rawTags = searchTags.replace(/rating:[a-z]+/g, "").trim().split(/\s+/);
            const mainTag = rawTags[0] || characterName;
            const searchQuery = `${mainTag} rating:safe`;
            
            // Encode function
            const enc = (t: string) => encodeURIComponent(t).replace(/\(/g, "%28").replace(/\)/g, "%29");
            
            // Use a standard Browser UA to avoid blocking
            const browserUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

            // Provider 1: Konachan.net (Primary - most accessible)
            try {
                const url = `https://konachan.net/post.json?limit=20&tags=${enc(searchQuery)}`;
                console.log(`[Gallery] Fetching Konachan: ${url}`);
                const res = await fetch(url, { headers: { "User-Agent": browserUA } });
                if (res.ok) {
                    const json = await res.json();
                    if (Array.isArray(json) && json.length > 0) {
                         data = json.map((p: any) => ({
                            url: p.file_url,
                            thumbnail: p.preview_url || p.file_url,
                            title: `Fanart (Konachan)`,
                            source: "Konachan"
                         }));
                         usedProvider = "Konachan";
                    }
                }
            } catch (e) { console.warn("[Gallery] Konachan failed:", e); }
            
            // Provider 3: Konachan Fallback (Broad Search "Name Source")
            if (data.length === 0 && animeSource && animeSource !== "MyAnimeList" && animeSource !== "AniList") {
                 try {
                    const broadTags = `${characterName} ${animeSource} rating:safe`;
                    const url = `https://konachan.net/post.json?limit=20&tags=${enc(broadTags)}`;
                    console.log(`[Gallery] Fetching Konachan (Broad): ${url}`);
                    const res = await fetch(url, { headers: { "User-Agent": browserUA } });
                    if (res.ok) {
                        const json = await res.json();
                        if (Array.isArray(json) && json.length > 0) {
                             data = json.map((p: any) => ({
                                url: p.file_url,
                                thumbnail: p.preview_url || p.file_url,
                                title: `Fanart (Konachan)`,
                                source: "Konachan"
                             }));
                        }
                    }
                 } catch (e) { console.warn("[Gallery] Konachan Broad failed:", e); }
            }

            return data;

         } catch (e) {
             console.error("Fanart fetch failed", e);
             return [];
         }
    })();

    // Wait for BOTH (Parallel Execution)
    const [officialResult, fanartResult] = await Promise.allSettled([officialArtPromise, fanartPromise]);

    if (officialResult.status === "fulfilled") images.push(...officialResult.value);
    if (fanartResult.status === "fulfilled") images.push(...fanartResult.value);

    return NextResponse.json({ images });

  } catch (error) {
    return NextResponse.json({ error: "Gallery failed" }, { status: 500 });
  }
}
