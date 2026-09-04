import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/admin-auth";
import { isGifUrl } from "@/lib/utils";
import { ImageResult } from "@/types";
import { safebooruImages } from "@/lib/image-sources/safebooru";
import { fandomImages } from "@/lib/image-sources/fandom";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";

interface SerperImage {
  title: string;
  imageUrl: string;
  thumbnailUrl: string;
  domain: string;
}

interface KonachanPost {
  file_url: string;
  preview_url?: string;
}

interface AniListCharacter {
  id: number;
  name?: { full?: string };
  image?: { large?: string };
}

interface AniListResponse {
  data?: { Page?: { characters?: AniListCharacter[] } };
}

/**
 * These are free services being asked for a favour - identify the caller so a
 * misbehaving deployment can be told apart from anonymous scraping.
 */
const ANILIST_UA = "waifu100/1.0 (+https://waifu100.vercel.app)";

/**
 * Jikan has been returning 504 to every query since MAL went down upstream.
 * Without a cap the gallery waits on a source that is not going to answer.
 */
const JIKAN_TIMEOUT_MS = 5000;

/**
 * How thin the keyless sources have to come back before a paid Serper call is
 * worth making. A picker with a dozen options is already usable; below that it
 * looks broken, which is the only case worth spending credit on.
 */
const SERPER_TOP_UP_BELOW = 12;

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
 * Every source here is keyless and free; they all run in parallel:
 * 1. Official art - AniList, with Jikan (MAL) alongside it
 * 2. Safebooru - the deep one, and the only source of real GIFs
 * 3. Fandom wikis - what Google was indexing on the gallery's behalf anyway
 * 4. Konachan - more fanart
 *
 * Serper (Google Images) is metered and no longer part of that set. It runs
 * afterwards, and only when the four above have produced too little to fill a
 * picker - see SERPER_TOP_UP_BELOW.
 */
export async function POST(request: NextRequest) {
  try {
    // Looser than the Gemini routes: someone filling a 100-cell grid opens the
    // picker once per character, and a fast worker should not hit a wall. It
    // still stops a script from running the free sources - and any Serper
    // top-up - flat out.
    const limited = await enforceRateLimit(request, LIMITS.gallery);
    if (limited) return limited;

    const { characterName, animeSource, malId, isGif, debug } = await request.json();

    if (!characterName) {
      return NextResponse.json({ error: "Name required" }, { status: 400 });
    }

    const images: ImageResult[] = [];

    // Last non-OK HTTP status per source, reported back so an empty gallery can be
    // told apart from an upstream rejection (bad key, out of credits, rate limit).
    let serperStatus: string | null = null;
    let konachanStatus: string | null = null;
    let anilistStatus: string | null = null;
    let jikanStatus: string | null = null;
    // Upstream error body, echoed back only when the caller asks for it.
    let serperError: string | null = null;

    // SERPER (top-up only) - Google Images.
    //
    // Serper is metered and shared with other projects; when its credits ran
    // out the gallery lost its only broad source and went blank. It is no
    // longer in the hot path: the keyless sources below run first, and this
    // only runs to top up a thin result. Defined here, called after them.
    const searchSerperImages = async (): Promise<ImageResult[]> => {
      {
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
              // Serper pages in tens, like Google - keep num a multiple of 10 as
              // the sibling /api/serper-images route does.
              num: isGif ? 50 : 20, // GIF mode filters most results out, so ask for more
              gl: "us",
              hl: "en",
              ...(tbs ? { tbs } : {}),
            }),
          });

          if (!res.ok) {
            const detail = await res.text();
            serperStatus = `http-${res.status}`;
            serperError = detail.slice(0, 200);
            console.error("[Gallery] Serper API error:", res.status, detail);
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
      }
    };

    // The keyless sources, all at once. None of them costs anything, so they
    // all run on every request.
    const [officialResult, safebooruResult, fandomResult, fanartResult] = await Promise.allSettled([
      // 1. OFFICIAL ART - AniList first, Jikan (MyAnimeList) alongside it.
      //
      // Jikan used to be the only official source and it has been answering 504
      // to every query for days (MAL upstream), so `sources.official` was
      // permanently 0. AniList is keyless, answers in well under a second, and
      // carries one canonical portrait per character - enough to keep the
      // section alive on its own.
      //
      // Jikan is kept because it returns *several* pictures per character when
      // MAL is up, which AniList cannot. It runs in parallel rather than only
      // on AniList's failure: AniList almost always answers, so a true
      // "only if empty" fallback would mean Jikan never runs again. A short
      // timeout keeps its outage from holding up the whole gallery.
      (async (): Promise<ImageResult[]> => {
        if (isGif) return []; // Neither source has animations - static JPG/PNG only.

        const anilist = async (): Promise<ImageResult[]> => {
          // Series name helps AniList disambiguate common given names, but its
          // search is AND-ish across the string, so an unmatched series wipes
          // out the result. Try the qualified query first, then the bare name.
          const queries = [
            animeSource && animeSource !== "MyAnimeList" && animeSource !== "AniList"
              ? `${characterName} ${animeSource}`
              : null,
            characterName,
          ].filter(Boolean) as string[];

          for (const q of queries) {
            const res = await fetch("https://graphql.anilist.co", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                "User-Agent": ANILIST_UA,
              },
              body: JSON.stringify({
                query:
                  "query($s:String){Page(perPage:5){characters(search:$s){id name{full} image{large}}}}",
                variables: { s: q },
              }),
              signal: AbortSignal.timeout(8000),
            });

            if (!res.ok) {
              anilistStatus = `http-${res.status}`;
              console.error("[Gallery] AniList API error:", res.status, q);
              continue;
            }

            const data: AniListResponse = await res.json();
            const chars = data.data?.Page?.characters ?? [];
            const results = chars
              .map((c) => ({ url: c.image?.large ?? "", name: c.name?.full ?? "" }))
              // AniList hands out a grey silhouette for characters with no
              // artwork; it is worse than showing nothing.
              .filter((c) => c.url && !c.url.includes("default.jpg"))
              .map(
                (c): ImageResult => ({
                  url: c.url,
                  thumbnail: c.url,
                  title: c.name || "Official Art",
                  source: "Official (AniList)",
                })
              );

            // Only the top hit: further down the page are same-name characters
            // from other series, which look like mistakes in the gallery.
            if (results.length > 0) return results.slice(0, 1);
          }
          return [];
        };

        const jikan = async (): Promise<ImageResult[]> => {
          let targetId = malId;

          if (!targetId) {
            let q = characterName;
            if (animeSource && animeSource !== "MyAnimeList" && animeSource !== "AniList") {
              q += ` ${animeSource}`;
            }
            const res = await fetch(
              `https://api.jikan.moe/v4/characters?q=${encodeURIComponent(q)}&limit=1`,
              { headers: { "User-Agent": ANILIST_UA }, signal: AbortSignal.timeout(JIKAN_TIMEOUT_MS) }
            );
            if (!res.ok) {
              jikanStatus = `http-${res.status}`;
              return [];
            }
            const data = await res.json();
            targetId = data.data?.[0]?.mal_id;
          }

          if (!targetId) return [];

          const picRes = await fetch(
            `https://api.jikan.moe/v4/characters/${targetId}/pictures`,
            { headers: { "User-Agent": ANILIST_UA }, signal: AbortSignal.timeout(JIKAN_TIMEOUT_MS) }
          );
          if (!picRes.ok) {
            jikanStatus = `http-${picRes.status}`;
            return [];
          }
          const picData = await picRes.json();
          return (picData.data || []).map((img: { jpg: { image_url: string } }) => ({
            url: img.jpg.image_url,
            thumbnail: img.jpg.image_url,
            title: "Official Art",
            source: "Official (MAL)",
          }));
        };

        const [a, j] = await Promise.allSettled([anilist(), jikan()]);
        const out: ImageResult[] = [];
        // AniList first: it is the one that is actually reliable right now.
        if (a.status === "fulfilled") out.push(...a.value);
        else console.error("[Gallery] AniList error:", a.reason);
        if (j.status === "fulfilled") out.push(...j.value);
        else jikanStatus = jikanStatus ?? "timeout";
        return out;
      })(),

      // 2. SAFEBOORU - the deepest keyless source, and the only one that
      // reliably has animations. This is what replaces Serper for both the
      // normal gallery and GIF mode.
      safebooruImages({ characterName, animeSource, isGif, limit: 40 }).catch((e) => {
        console.error("[Gallery] Safebooru error:", e);
        return [];
      }),

      // 3. FANDOM - the wikis Serper was mostly indexing in the first place.
      fandomImages({ characterName, animeSource, isGif, limit: 30 }).catch((e) => {
        console.error("[Gallery] Fandom error:", e);
        return [];
      }),

      // 4. KONACHAN (Fanart) - Fast tags without Gemini
      (async (): Promise<ImageResult[]> => {
        const browserUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

        // Konachan rate-limits shared cloud IPs, and a rejected request used to be
        // indistinguishable from "this tag has no posts". Retry once before
        // treating the tag as empty, and remember the status for diagnostics.
        const fetchPosts = async (tags: string, limit: number): Promise<KonachanPost[]> => {
          const url = `https://konachan.net/post.json?limit=${limit}&tags=${encodeURIComponent(tags)}`;

          for (let attempt = 0; attempt < 2; attempt++) {
            const res = await fetch(url, { headers: { "User-Agent": browserUA } });
            if (res.ok) {
              const json = await res.json();
              return Array.isArray(json) ? json : [];
            }
            konachanStatus = `http-${res.status}`;
            console.error("[Gallery] Konachan API error:", res.status, tags);
            if (attempt === 0) await new Promise((r) => setTimeout(r, 600));
          }
          return [];
        };

        const toResults = (posts: KonachanPost[]): ImageResult[] =>
          (isGif ? posts.filter((p) => isGifUrl(p.file_url)) : posts).map((p) => ({
            url: p.file_url,
            thumbnail: p.preview_url || p.file_url,
            title: "Fanart",
            source: "Konachan",
          }));

        try {
          // Konachan uses underscores for spaces
          const cleanName = characterName.toLowerCase().replace(/\s+/g, "_");
          const cleanSource = (animeSource || "").toLowerCase().replace(/\s+/g, "_");
          // Konachan tags animations as `animated`. The `gif` tag the old code used
          // has a single safe post site-wide, so GIF mode was guaranteed to be empty.
          const suffix = isGif ? " animated rating:safe" : " rating:safe";

          const strict = toResults(await fetchPosts(cleanName + suffix, 15));
          if (strict.length > 0) return strict;

          // Fall back to the series tag when the character tag has nothing. GIF mode
          // used to skip this fallback entirely, which left it with a single shot at
          // a tag most characters do not have.
          if (cleanSource) {
            return toResults(await fetchPosts(cleanSource + suffix, 10));
          }
        } catch (e) {
          console.error("[Gallery] Konachan error:", e);
        }
        return [];
      })(),
    ]);

    const take = (r: PromiseSettledResult<ImageResult[]>) =>
      r.status === "fulfilled" ? r.value : [];

    // Order the free sources by how likely each is to be the picture someone
    // actually wants. In GIF mode Safebooru leads outright - it is the only
    // one of these with real animations.
    if (isGif) {
      images.push(...take(safebooruResult), ...take(fanartResult), ...take(fandomResult));
    } else {
      images.push(
        ...take(officialResult),
        ...take(fandomResult),
        ...take(safebooruResult),
        ...take(fanartResult)
      );
    }

    // Only now, and only if the free sources came up short, spend a Serper
    // credit. A typical character never reaches this line.
    const serperResult: PromiseSettledResult<ImageResult[]> | null =
      images.length < SERPER_TOP_UP_BELOW
        ? (await Promise.allSettled([searchSerperImages()]))[0]
        : null;
    if (serperResult) images.push(...take(serperResult));

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

    // An HTTP status only explains an empty source - a retry may well have
    // succeeded after the first attempt was rejected.
    const report = (r: PromiseSettledResult<ImageResult[]>, status: string | null) => {
      const c = count(r);
      return c === 0 && status ? status : c;
    };

    return NextResponse.json({
      images: uniqueImages,
      sources: {
        serper: !serperResult
          ? "not-needed"
          : !process.env.SERPER_API_KEY
            ? "no-api-key"
            : report(serperResult, serperStatus),
        official: report(officialResult, anilistStatus ?? jikanStatus),
        safebooru: count(safebooruResult),
        fandom: count(fandomResult),
        fanart: report(fanartResult, konachanStatus),
      },
      // Upstream error bodies are for whoever runs this, not for callers.
      ...(debug && serperError && isAdminRequest(request) ? { serperError } : {}),
    });
  } catch (error) {
    console.error("[Gallery] Failed:", error);
    return NextResponse.json({ error: "Gallery failed" }, { status: 500 });
  }
}
