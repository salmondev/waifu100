import { ImageResult } from "@/types";
import { isGifUrl } from "@/lib/utils";
import { fetchJson, fetchText, words } from "./http";

/**
 * Safebooru - keyless, SFW-only, and by far the deepest of the free sources.
 *
 * Measured 2026-09-03/04: `chitanda_eru`, `megumin`, `yuuki_asuna` and
 * `frieren` each return the full 100 posts asked for, and `<tag> animated`
 * returns real .gif files where Konachan returns nothing at all. This is the
 * source that lets GIF mode survive without Serper.
 */

const BASE = "https://safebooru.org/index.php";

interface SafebooruPost {
  file_url?: string;
  sample_url?: string;
  preview_url?: string;
}

/**
 * Character tags are permanent, so one lookup per character per instance is
 * plenty. Serverless means several instances each keep their own copy - that
 * is fine, the cost of a miss is one extra request.
 */
const tagCache = new Map<string, string | null>();

/**
 * Resolve a display name to a booru tag. Never guess this: boorus tag
 * surname-first (`chitanda_eru`), and some characters live under a different
 * name entirely - `asuna_(sword_art_online)` has no posts while `yuuki_asuna`
 * has hundreds.
 */
export async function resolveTag(name: string): Promise<string | null> {
  const parts = words(name);
  if (parts.length === 0) return null;

  const key = parts.join("_");
  const cached = tagCache.get(key);
  if (cached !== undefined) return cached;

  // Search on the longest word - the most distinctive one, and the one least
  // likely to be a common given name shared by hundreds of characters.
  const pattern = [...parts].sort((a, b) => b.length - a.length)[0];

  const res = await fetchText(
    `${BASE}?page=dapi&s=tag&q=index&limit=100&orderby=count&name_pattern=${encodeURIComponent(
      `%${pattern}%`
    )}`
  );

  let tag: string | null = null;
  if (res.ok) {
    // This endpoint answers in XML even with json=1, unlike the post endpoint.
    const candidates: { name: string; count: number }[] = [];
    for (const m of res.body.matchAll(/<tag\b[^>]*\/?>/g)) {
      const el = m[0];
      const type = /\btype="(\d+)"/.exec(el)?.[1];
      const tagName = /\bname="([^"]*)"/.exec(el)?.[1];
      const count = Number(/\bcount="(\d+)"/.exec(el)?.[1] ?? 0);
      // type 4 is the character namespace; everything else is a series,
      // an artist or a generic descriptor.
      if (type === "4" && tagName && count > 0) candidates.push({ name: tagName, count });
    }
    candidates.sort((a, b) => b.count - a.count);

    // Prefer a tag that accounts for every word of the name - that is what
    // rules out `chitanda_eru_(cosplay)` and same-surname characters.
    tag =
      candidates.find((c) => parts.every((w) => c.name.includes(w)))?.name ??
      candidates[0]?.name ??
      null;
  }

  tagCache.set(key, tag);
  return tag;
}

async function posts(tags: string, limit: number): Promise<SafebooruPost[]> {
  const { data } = await fetchJson<SafebooruPost[]>(
    `${BASE}?page=dapi&s=post&q=index&json=1&limit=${limit}&tags=${encodeURIComponent(tags)}`
  );
  return Array.isArray(data) ? data : [];
}

function toResults(raw: SafebooruPost[], isGif: boolean): ImageResult[] {
  return raw
    .map((p) => ({
      url: p.file_url ?? "",
      preview: p.preview_url || p.sample_url || p.file_url || "",
    }))
    .filter((p) => Boolean(p.url))
    // The `animated` tag covers .webm and .mp4 as well, and neither can go in
    // an <img> cell. Only real .gif files survive GIF mode.
    .filter((p) => (isGif ? isGifUrl(p.url) : true))
    .map((p) => ({
      url: p.url,
      // In GIF mode the preview is a static jpg, which would show a still
      // image in a picker whose whole point is that the art moves.
      thumbnail: isGif ? p.url : p.preview,
      title: "Fanart",
      source: "Safebooru",
    }));
}

export async function safebooruImages({
  characterName,
  animeSource,
  isGif,
  limit = 40,
}: {
  characterName: string;
  animeSource?: string;
  isGif?: boolean;
  limit?: number;
}): Promise<ImageResult[]> {
  // Safebooru is SFW by definition, so unlike Konachan no tag slot is spent on
  // a rating filter - it stays free for `animated`.
  const suffix = isGif ? " animated" : "";

  const tag = await resolveTag(characterName);
  if (tag) {
    const found = toResults(await posts(tag + suffix, limit), Boolean(isGif));
    if (found.length > 0) return found;
  }

  // Fall back to the series tag when the character has nothing - a rare
  // character in a popular series still gets a gallery this way.
  if (animeSource) {
    const seriesTag = words(animeSource).join("_");
    if (seriesTag) {
      return toResults(await posts(seriesTag + suffix, Math.min(limit, 20)), Boolean(isGif));
    }
  }

  return [];
}
