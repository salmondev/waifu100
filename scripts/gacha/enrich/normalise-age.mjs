#!/usr/bin/env node
// Normalises AniList's own age text (catalog `age`) that the game cannot parse ("16 (past), 28 (present)",
// "30s", "17 (physically)") into ageGame candidates. Offline: reads catalog.json only.
//   node scripts/gacha/enrich/normalise-age.mjs [--out scripts/gacha/enrich/out/age-candidates.json]
import path from "node:path";
import { parseArgs } from "./lib/args.mjs";
import { normaliseAge } from "./lib/age.mjs";
import { CATALOG_FILE, ENRICHMENT_FILE, OUT_DIR, readJson, rel, writeJson } from "./lib/io.mjs";
import { candidate, nowIso } from "./lib/provenance.mjs";
import { missingByAnime } from "./lib/targets.mjs";

const { opts } = parseArgs(process.argv.slice(2));
const out = path.resolve(opts.out ?? path.join(OUT_DIR, "age-candidates.json"));
const catalog = await readJson(CATALOG_FILE);
const enrichment = await readJson(ENRICHMENT_FILE, { characters: {}, anime: {} });
const fetchedAt = nowIso();
const candidates = [];
const stats = { checked: 0, high: 0, review: 0, nothing: 0, reasons: {} };
for (const g of missingByAnime(catalog, enrichment, { fields: ["ageGame"] })) {
  for (const c of g.chars) {
    if (!c.ageRaw) continue; // AniList has no age at all: Serper territory
    stats.checked++;
    const r = normaliseAge(c.ageRaw);
    stats.reasons[r.reason] = (stats.reasons[r.reason] ?? 0) + 1;
    const context = { name: c.name, anime: g.anime.titleRomaji, card: c.card, reason: r.reason };
    if (!r.ageGame && !r.review) { stats.nothing++; continue; }
    if (!r.ageGame) {
      // nothing to suggest, but a human may still know: list it for review with a placeholder-free note
      stats.nothing++;
      continue;
    }
    candidates.push(candidate("character", c.id, "ageGame", { value: r.ageGame, source: "anilist-normalised", url: c.siteUrl, confidence: r.review ? "low" : r.confidence, fetchedAt, raw: c.ageRaw, note: r.reason }, context));
    if (r.review) stats.review++; else stats.high++;
  }
}
await writeJson(out, { generatedAt: fetchedAt, tool: "normalise-age", source: "AniList age text in catalog.json", stats, candidates });
console.log(`[age] ${stats.checked} unparseable AniList ages: ${stats.high} high-confidence, ${stats.review} to review, ${stats.nothing} with no usable number -> ${rel(out)}`);
