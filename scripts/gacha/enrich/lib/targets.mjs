// Which characters still miss which fields (catalog = AniList, plus what enrichment.json already fills).
import { anilistHas, indexCatalog } from "./merge.mjs";

export const CHARACTER_FIELDS = ["ageGame", "birthMonth", "gender", "va", "occupation"];

/**
 * @param {any} catalog
 * @param {any} enrichment
 * @param {{ fields?: string[], cardsOnly?: boolean, animeIds?: number[] | null }} o
 * @returns {{ anime: any, chars: { id: number, name: string, nameNative: string | null, alternative: string[],
 *            card: boolean, siteUrl: string, missing: string[], ageRaw: string | null, favourites: number }[] }[]}
 */
export function missingByAnime(catalog, enrichment, { fields = CHARACTER_FIELDS, cardsOnly = false, animeIds = null } = {}) {
  const index = indexCatalog(catalog);
  const seen = new Set();
  const out = [];
  for (const a of catalog.anime) {
    if (animeIds && !animeIds.includes(a.id)) continue;
    const chars = [];
    for (const r of a.roster ?? a.characters) {
      if (seen.has(r.id)) continue; // a character shared by two anime belongs to the first
      seen.add(r.id);
      const c = index.characters.get(r.id);
      const card = Boolean(c.card);
      if (cardsOnly && !card) continue;
      const missing = fields.filter((f) => {
        if (f === "occupation" && !card) return false; // only cards show it
        if (anilistHas(index, "character", r.id, f)) return false;
        return !enrichment?.characters?.[r.id]?.[f];
      });
      if (!missing.length) continue;
      chars.push({
        id: r.id,
        name: c.name,
        nameNative: c.nameNative ?? null,
        alternative: c.alternative ?? [],
        card,
        siteUrl: c.siteUrl ?? `https://anilist.co/character/${r.id}`,
        missing,
        ageRaw: c.age ?? null,
        favourites: c.favourites ?? 0,
      });
    }
    if (chars.length) out.push({ anime: a, chars });
  }
  return out;
}
