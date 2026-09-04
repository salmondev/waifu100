import { ImageResult } from "@/types";
import { fetchJson, words } from "./http";

/**
 * Fandom (MediaWiki) - keyless, and the source Google was mostly surfacing
 * anyway. Look at any existing grid: a large share of its characters carry
 * `Google (something.fandom.com)`. Serper was acting as an index into Fandom,
 * so querying the wikis directly removes the metered middleman rather than
 * finding a substitute for it.
 *
 * A character page plus its /Gallery subpage came to 42 images for Eru
 * Chitanda, official stills included.
 */

interface MediaWikiImagesResponse {
  query?: {
    pages?: Record<string, { title?: string; imageinfo?: { url?: string }[] }>;
  };
}

interface UnifiedSearchResponse {
  results?: { title?: string; url?: string; sitename?: string }[];
}

/** Wiki chrome that every MediaWiki page drags along with the real artwork. */
const CHROME = /site-?logo|favicon|wiki-?wordmark|wordmark|placeholder|badge|icon|\.svg$/i;
const IMAGE_EXT = /\.(jpe?g|png|gif|webp)$/i;

/**
 * static.wikia.nocookie.net serves resized derivatives from the same URL, so
 * the picker can load 320px thumbnails instead of full-size stills.
 */
function thumbnailFor(url: string): string {
  return url.includes("/revision/latest")
    ? url.replace("/revision/latest", "/revision/latest/scale-to-width-down/320")
    : url;
}

async function imagesFromWiki(host: string, title: string, isGif: boolean): Promise<ImageResult[]> {
  // One call resolves the page's own images and its /Gallery subpage's, and
  // hands back direct URLs - no second round trip to turn File: names into
  // links.
  const url =
    `https://${host}/api.php?action=query&generator=images&gimlimit=60` +
    `&titles=${encodeURIComponent(`${title}|${title}/Gallery`)}` +
    `&prop=imageinfo&iiprop=url&format=json`;

  const { data } = await fetchJson<MediaWikiImagesResponse>(url, { timeoutMs: 9000 });
  const pages = data?.query?.pages;
  if (!pages) return [];

  return Object.values(pages)
    .map((p) => ({ name: p.title ?? "", url: p.imageinfo?.[0]?.url ?? "" }))
    // Test the File: title, not the URL: wikia serves every image from a path
    // that continues past the extension (.../Foo.jpg/revision/latest?cb=...),
    // so an extension check against the URL matches nothing at all.
    .filter((p) => p.url && IMAGE_EXT.test(p.name))
    .filter((p) => !CHROME.test(p.name))
    // Same reason: the .gif test has to look at the File: name, not the URL.
    .filter((p) => (isGif ? /\.gif$/i.test(p.name) : true))
    .map((p) => ({
      url: p.url,
      thumbnail: thumbnailFor(p.url),
      title: p.name.replace(/^File:/, "").replace(IMAGE_EXT, ""),
      source: `Fandom (${host})`,
    }));
}

/**
 * Ask one wiki for its own title for a character. The subdomain guess is often
 * right while the exact page title is not - the Sword Art Online wiki files
 * Asuna Yuuki under "Asuna" - and without this the code falls through to
 * cross-wiki search, which happily returns a parody wiki instead.
 */
async function findTitleOnWiki(host: string, characterName: string): Promise<string | null> {
  const url =
    `https://${host}/api.php?action=query&list=search&srlimit=1&srnamespace=0&format=json` +
    `&srsearch=${encodeURIComponent(characterName)}`;
  const { data } = await fetchJson<{ query?: { search?: { title?: string }[] } }>(url, {
    timeoutMs: 9000,
  });
  return data?.query?.search?.[0]?.title ?? null;
}

/** Cross-wiki search, for when the subdomain guess misses. */
async function findPage(
  characterName: string,
  animeSource?: string
): Promise<{ host: string; title: string } | null> {
  // `namespace=0` is mandatory - without it this endpoint answers 400.
  const url =
    `https://services.fandom.com/unified-search/page-search?limit=8&lang=en&namespace=0` +
    `&query=${encodeURIComponent(characterName)}`;

  const { data } = await fetchJson<UnifiedSearchResponse>(url, { timeoutMs: 9000 });
  const results = (data?.results ?? []).filter((r) => r.url && r.title);
  if (results.length === 0) return null;

  const nameWords = words(characterName);
  const sourceWords = animeSource ? words(animeSource) : [];

  const score = (r: { title?: string; url?: string }) => {
    const title = words(r.title ?? "");
    const host = (r.url ?? "").toLowerCase();
    let s = 0;
    // An exact title match beats a page that merely mentions the character.
    if (nameWords.every((w) => title.includes(w)) && title.length === nameWords.length) s += 4;
    else if (nameWords.every((w) => title.includes(w))) s += 2;
    // Search puts crossover/fan wikis near the top; a host that looks like the
    // series is far more likely to be the character's real home wiki.
    if (sourceWords.length > 0 && sourceWords.some((w) => w.length > 3 && host.includes(w))) s += 3;
    return s;
  };

  const best = [...results].sort((a, b) => score(b) - score(a))[0];
  try {
    const u = new URL(best.url!);
    const title = decodeURIComponent(u.pathname.replace(/^\/wiki\//, "")).replace(/_/g, " ");
    return { host: u.hostname, title };
  } catch {
    return null;
  }
}

export async function fandomImages({
  characterName,
  animeSource,
  isGif,
  limit = 30,
}: {
  characterName: string;
  animeSource?: string;
  isGif?: boolean;
  limit?: number;
}): Promise<ImageResult[]> {
  // Guessing the subdomain from the series name resolves often enough to be
  // worth one request before paying for cross-wiki search: `hyouka`,
  // `konosuba` and `frieren` all land, while `sao` does not.
  if (animeSource) {
    const slug = words(animeSource).join("");
    if (slug.length > 2) {
      const host = `${slug}.fandom.com`;
      const direct = await imagesFromWiki(host, characterName, Boolean(isGif));
      if (direct.length > 0) return direct.slice(0, limit);

      const title = await findTitleOnWiki(host, characterName);
      if (title && title.toLowerCase() !== characterName.toLowerCase()) {
        const retry = await imagesFromWiki(host, title, Boolean(isGif));
        if (retry.length > 0) return retry.slice(0, limit);
      }
    }
  }

  const page = await findPage(characterName, animeSource);
  if (!page) return [];

  // Wikis are almost entirely static stills; in GIF mode they contribute the
  // occasional animation rather than carrying the feature.
  const found = await imagesFromWiki(page.host, page.title, Boolean(isGif));
  return found.slice(0, limit);
}
