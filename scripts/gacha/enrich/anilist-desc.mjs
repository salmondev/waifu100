#!/usr/bin/env node
// AniList description candidates for roster characters missing gender, age or birth month:
//   - labelled "__Age:__" / "__Birthday:__" fields (source anilist-desc),
//   - gender from pronoun counts (source anilist-pronouns: ALWAYS review-only, never auto-merged).
// Public AniList API, no key, 1 request / 2.5 s, 50 characters per request. Dry-run unless --live.
//   node scripts/gacha/enrich/anilist-desc.mjs --live [--out scripts/gacha/enrich/out/anilist-desc-candidates.json]
import path from "node:path";
import { intOpt, parseArgs } from "./lib/args.mjs";
import { AGE_LABELS, BIRTHDAY_LABELS, genderFromPronouns, labelledFields, monthFromText, pickLabel } from "./lib/about.mjs";
import { normaliseAge } from "./lib/age.mjs";
import { createLimiter, fetchJson } from "./lib/http.mjs";
import { CATALOG_FILE, ENRICHMENT_FILE, OUT_DIR, readJson, rel, writeJson } from "./lib/io.mjs";
import { candidate, nowIso } from "./lib/provenance.mjs";
import { missingByAnime } from "./lib/targets.mjs";

const { flags, opts } = parseArgs(process.argv.slice(2));
const live = flags.has("live") && !flags.has("dry-run");
const max = intOpt(opts, "max", 100);
const out = path.resolve(opts.out ?? path.join(OUT_DIR, "anilist-desc-candidates.json"));
const catalog = await readJson(CATALOG_FILE);
const enrichment = await readJson(ENRICHMENT_FILE, { characters: {}, anime: {} });
const chars = missingByAnime(catalog, enrichment, { fields: ["gender", "ageGame", "birthMonth"] }).flatMap((g) => g.chars.map((c) => ({ ...c, anime: g.anime.titleRomaji })));
const batches = Math.ceil(chars.length / 50);
console.log(`[anilist-desc] ${live ? "LIVE" : "dry-run"}: ${chars.length} characters, ${Math.min(batches, max)} AniList requests (--max ${max}), ~${Math.ceil((Math.min(batches, max) * 2.5) / 60)} min`);
if (!live) { console.log("[anilist-desc] dry-run only. Add --live to query AniList."); process.exit(0); }

const wait = createLimiter({ minIntervalMs: 2500, perMinute: 24 });
const candidates = [];
const stats = { characters: chars.length, requests: 0, byField: {} };
const Q = "query($ids:[Int]){Page(perPage:50){characters(id_in:$ids){id description}}}";
for (let i = 0; i < chars.length && stats.requests < max; i += 50) {
  const chunk = chars.slice(i, i + 50);
  const { body } = await fetchJson("https://graphql.anilist.co", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ query: Q, variables: { ids: chunk.map((c) => c.id) } }),
    label: "anilist descriptions",
  }, { wait, onRequest: () => stats.requests++ });
  const desc = new Map((body?.data?.Page?.characters ?? []).map((c) => [c.id, c.description ?? ""]));
  const fetchedAt = nowIso();
  for (const c of chunk) {
    const d = desc.get(c.id);
    if (!d) continue;
    const context = { name: c.name, anime: c.anime, card: c.card };
    const add = (field, v) => { candidates.push(candidate("character", c.id, field, { ...v, url: c.siteUrl, fetchedAt }, context)); stats.byField[`${field}:${v.source}`] = (stats.byField[`${field}:${v.source}`] ?? 0) + 1; };
    const f = labelledFields(d);
    const age = pickLabel(f, AGE_LABELS);
    if (c.missing.includes("ageGame") && age) {
      const r = normaliseAge(age);
      if (r.ageGame) add("ageGame", { value: r.ageGame, source: "anilist-desc", confidence: r.review ? "low" : r.confidence, raw: age, note: r.reason });
    }
    const bd = pickLabel(f, BIRTHDAY_LABELS);
    const month = monthFromText(bd);
    if (c.missing.includes("birthMonth") && month) add("birthMonth", { value: month, source: "anilist-desc", confidence: "high", raw: bd });
    if (c.missing.includes("gender")) {
      const g = genderFromPronouns(d);
      if (g) add("gender", { value: g.value, source: "anilist-pronouns", confidence: g.confidence, note: `pronouns he=${g.he} she=${g.she}` });
    }
  }
}
await writeJson(out, { generatedAt: nowIso(), tool: "anilist-desc", source: "AniList character descriptions", stats, candidates });
console.log(`[anilist-desc] ${candidates.length} candidates (${Object.entries(stats.byField).map(([k, v]) => `${k} ${v}`).join(", ")}) -> ${rel(out)}`);
