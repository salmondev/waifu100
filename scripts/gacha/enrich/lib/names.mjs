// Character-name matching across AniList ("First Last") and MyAnimeList ("Last, First").
const fold = (s) => (s ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9fff]+/g, " ").trim();

/** Order-insensitive keys for a name: "Last, First" and "First Last" give the same key. */
export function nameKey(name) {
  const parts = fold(String(name ?? "").replace(/,/g, " ")).split(" ").filter(Boolean);
  return parts.sort().join(" ");
}

/**
 * How well a MAL entry matches an AniList character.
 * @returns {"exact" | "native" | "partial" | null}
 */
export function matchName(anilist, malName) {
  const k = nameKey(malName);
  if (!k) return null;
  if (k === nameKey(anilist.name)) return "exact";
  for (const alt of anilist.alternative ?? []) if (k === nameKey(alt)) return "exact";
  if (anilist.nameNative && fold(malName).replace(/ /g, "") === fold(anilist.nameNative).replace(/ /g, "")) return "native";
  // one-word MAL names ("Saber") vs AniList "Saber" + alternatives; or a shared surname+given subset
  const a = new Set(nameKey(anilist.name).split(" "));
  const m = k.split(" ");
  if (m.length >= 1 && m.every((p) => a.has(p)) && a.size <= m.length + 1 && m.join("").length >= 4) return "partial";
  return null;
}
