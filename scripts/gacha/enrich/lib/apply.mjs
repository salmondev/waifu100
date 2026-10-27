// Used by build-catalog.mjs: fill catalog gaps from enrichment.json without touching AniList values.
import { parseAgeStrict } from "./age.mjs";

const empty = (v) => v === null || v === undefined;

/** Removes a previous run's sidecar values (listed in `enriched`) so a fresh run starts from AniList only. */
export function undoCharacter(row) {
  for (const f of row.enriched ?? []) if (f !== "ageGame") row[f] = null;
  delete row.ageGame;
  delete row.enriched;
  return row;
}

/**
 * Applies one character's sidecar values to a catalog row (card or roster) in place.
 * Adds `ageGame` only when AniList's own age does not parse, and lists the filled fields in `enriched`.
 * @param {Record<string, any>} row
 * @param {Record<string, any> | undefined} e  enrichment.characters[id]
 * @param {{ card: boolean }} o
 */
export function applyCharacter(row, e, { card }) {
  undoCharacter(row);
  if (!e) return row;
  const filled = [];
  if (empty(row.gender) && e.gender) { row.gender = e.gender.value; filled.push("gender"); }
  if (empty(row.birthMonth) && e.birthMonth) { row.birthMonth = e.birthMonth.value; filled.push("birthMonth"); }
  // va is compared by AniList staff id: a value without one (e.g. MAL-only) is not applied
  if (empty(row.va) && e.va && Number.isInteger(e.va.value?.id)) {
    const { id, name, nameNative = null } = e.va.value;
    row.va = { id, name, nameNative };
    filled.push("va");
  }
  if (card && empty(row.occupation) && e.occupation) { row.occupation = e.occupation.value; filled.push("occupation"); }
  if (parseAgeStrict(row.age) === null && e.ageGame) { row.ageGame = e.ageGame.value; filled.push("ageGame"); }
  if (filled.length) row.enriched = filled;
  return row;
}

/** Applies anime-level sidecar values (coverColor) in place. */
export function applyAnime(anime, e) {
  for (const f of anime.enriched ?? []) anime[f] = null;
  delete anime.enriched;
  if (!e) return anime;
  const filled = [];
  if (empty(anime.coverColor) && e.coverColor) { anime.coverColor = e.coverColor.value; filled.push("coverColor"); }
  if (filled.length) anime.enriched = filled;
  return anime;
}
