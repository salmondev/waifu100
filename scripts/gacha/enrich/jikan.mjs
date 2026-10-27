#!/usr/bin/env node
// Jikan (MyAnimeList) candidates for roster characters that still miss age, birth month,
// occupation (cards) or a Japanese VA. No API key. Dry-run unless --live.
//
//   node scripts/gacha/enrich/jikan.mjs                 # dry-run: plan only, no network
//   node scripts/gacha/enrich/jikan.mjs --live --max 300 --out scripts/gacha/enrich/out/jikan-candidates.json
//
// Options: --live, --dry-run (default), --max <n Jikan requests, default 300>, --out <file>,
//          --cache <dir> (default scripts/gacha/enrich/.cache/jikan), --cards-only,
//          --fields ageGame,birthMonth,occupation,va, --anime <id,id>
// Rate: >= 1.1 s between Jikan requests and <= 55 per minute (Jikan: 3/s, 60/min); 429/5xx/network
// errors retry 5x with back-off and Retry-After. AniList (idMal lookup) is 1 request / 2.5 s.
// Output: { generatedAt, tool, stats, candidates[] }, each candidate with full provenance.
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { intOpt, parseArgs } from "./lib/args.mjs";
import { AGE_LABELS, BIRTHDAY_LABELS, OCCUPATION_LABELS, labelledFields, monthFromText, pickLabel } from "./lib/about.mjs";
import { normaliseAge } from "./lib/age.mjs";
import { createLimiter, fetchJson } from "./lib/http.mjs";
import { CACHE_DIR, CATALOG_FILE, ENRICHMENT_FILE, OUT_DIR, readJson, rel, writeJson } from "./lib/io.mjs";
import { matchName } from "./lib/names.mjs";
import { candidate, nowIso } from "./lib/provenance.mjs";
import { missingByAnime } from "./lib/targets.mjs";

const JIKAN = "https://api.jikan.moe/v4";
const ANILIST = "https://graphql.anilist.co";
const DEFAULT_FIELDS = ["ageGame", "birthMonth", "occupation", "va"];

const { flags, opts } = parseArgs(process.argv.slice(2));
const live = flags.has("live") && !flags.has("dry-run");
const max = intOpt(opts, "max", 300);
const out = path.resolve(opts.out ?? path.join(OUT_DIR, "jikan-candidates.json"));
const cacheDir = path.resolve(opts.cache ?? path.join(CACHE_DIR, "jikan"));
const fields = opts.fields ? opts.fields.split(",") : DEFAULT_FIELDS;
const animeIds = opts.anime ? opts.anime.split(",").map(Number) : null;

const catalog = await readJson(CATALOG_FILE);
const enrichment = await readJson(ENRICHMENT_FILE, { characters: {}, anime: {} });
const groups = missingByAnime(catalog, enrichment, { fields, cardsOnly: flags.has("cards-only"), animeIds });
// card characters first (they can be answers), then by favourites
groups.sort((a, b) => b.chars.filter((c) => c.card).length - a.chars.filter((c) => c.card).length || b.anime.popularity - a.anime.popularity);
const nChars = groups.reduce((s, g) => s + g.chars.length, 0);
const needsFull = (c) => c.missing.some((f) => f !== "va");
const nFull = groups.reduce((s, g) => s + g.chars.filter(needsFull).length, 0);
const planned = groups.length + nFull;

console.log(`[jikan] ${live ? "LIVE" : "dry-run"}: ${groups.length} anime, ${nChars} characters missing ${fields.join("/")}`);
console.log(`[jikan] requests: AniList ${Math.ceil(groups.length / 50)} (idMal), Jikan up to ${planned} (${groups.length} cast lists + ${nFull} character pages); --max ${max} caps Jikan`);
console.log(`[jikan] estimated time at <=55/min: ~${Math.ceil(Math.min(planned, max) / 55)} min; cache ${rel(cacheDir)}`);
if (!live) {
  for (const g of groups.slice(0, 5)) console.log(`  would fetch cast of "${g.anime.titleRomaji}" (${g.chars.length} chars: ${g.chars.slice(0, 3).map((c) => c.name).join(", ")}${g.chars.length > 3 ? ", ..." : ""})`);
  console.log(`[jikan] dry-run only. Add --live to call Jikan; output would go to ${rel(out)}`);
  process.exit(0);
}

const jikanWait = createLimiter({ minIntervalMs: 1100, perMinute: 55 });
const anilistWait = createLimiter({ minIntervalMs: 2500, perMinute: 24 });
let jikanRequests = 0;

async function cached(name, fn) {
  const file = path.join(cacheDir, `${name}.json`);
  if (existsSync(file)) return JSON.parse(await readFile(file, "utf8"));
  const data = await fn();
  if (data !== undefined) {
    await mkdir(cacheDir, { recursive: true });
    await writeFile(file, JSON.stringify(data));
  }
  return data;
}

class CapReached extends Error {}
async function jikan(pathname) {
  return cached(`jikan-${pathname.replace(/[^a-z0-9]+/gi, "_")}`, async () => {
    if (jikanRequests >= max) throw new CapReached();
    const { body } = await fetchJson(`${JIKAN}${pathname}`, { headers: { accept: "application/json" }, label: `jikan ${pathname}` }, { wait: jikanWait, onRequest: () => jikanRequests++ });
    return body ?? null;
  });
}

async function idMalMap(ids) {
  const map = {};
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const data = await cached(`anilist-idmal-${chunk[0]}-${chunk.length}`, async () => {
      const { body } = await fetchJson(ANILIST, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ query: "query($ids:[Int]){Page(perPage:50){media(id_in:$ids){id idMal}}}", variables: { ids: chunk } }),
        label: "anilist idMal",
      }, { wait: anilistWait });
      return body?.data?.Page?.media ?? [];
    });
    for (const m of data) map[m.id] = m.idMal ?? null;
  }
  return map;
}

const candidates = [];
const stats = { anime: groups.length, characters: nChars, noIdMal: 0, castMissing: 0, matched: 0, unmatched: 0, partialMatch: 0, jikanRequests: 0, stoppedAtMax: false, byField: {} };
const unmatched = [];
const add = (id, field, value, context) => {
  candidates.push(candidate("character", id, field, value, context));
  stats.byField[field] = (stats.byField[field] ?? 0) + 1;
};
const save = () => writeJson(out, { generatedAt: nowIso(), tool: "jikan", source: "https://api.jikan.moe/v4 (MyAnimeList)", stats: { ...stats, jikanRequests }, unmatched, candidates });

const idMal = await idMalMap(groups.map((g) => g.anime.id));
try {
  for (const [gi, g] of groups.entries()) {
    const mal = idMal[g.anime.id];
    if (!mal) { stats.noIdMal++; continue; }
    const cast = await jikan(`/anime/${mal}/characters`);
    if (!cast?.data) { stats.castMissing++; continue; }
    for (const c of g.chars) {
      let best = null;
      for (const e of cast.data) {
        const how = matchName(c, e.character?.name);
        if (how && (!best || (best.how === "partial" && how !== "partial"))) best = { how, e };
      }
      if (!best) { stats.unmatched++; unmatched.push({ id: c.id, name: c.name, anime: g.anime.titleRomaji }); continue; }
      stats.matched++;
      if (best.how === "partial") stats.partialMatch++;
      const matchLow = best.how === "partial";
      const url = best.e.character.url;
      const fetchedAt = nowIso();
      const context = { name: c.name, anime: g.anime.titleRomaji, card: c.card, malId: best.e.character.mal_id, malName: best.e.character.name, match: best.how };

      if (c.missing.includes("va")) {
        const ja = (best.e.voice_actors ?? []).find((v) => v.language === "Japanese");
        // MAL person ids are not AniList staff ids: id stays null until mapped, so this always goes to review
        if (ja) add(c.id, "va", { value: { id: null, malId: ja.person.mal_id, name: ja.person.name.split(", ").reverse().join(" "), nameNative: null }, source: "jikan", url: ja.person.url, confidence: "medium", fetchedAt, note: "needs AniList staff id" }, context);
      }
      if (!needsFull(c)) continue;
      const full = await jikan(`/characters/${best.e.character.mal_id}`);
      const about = full?.data?.about ?? "";
      const f = labelledFields(about);
      const ageText = pickLabel(f, AGE_LABELS);
      if (c.missing.includes("ageGame") && ageText) {
        const r = normaliseAge(ageText);
        if (r.ageGame) add(c.id, "ageGame", { value: r.ageGame, source: "jikan", url, confidence: matchLow ? "low" : r.confidence, fetchedAt, raw: ageText, note: r.reason }, context);
      }
      const bday = pickLabel(f, BIRTHDAY_LABELS);
      const month = monthFromText(bday);
      if (c.missing.includes("birthMonth") && month) add(c.id, "birthMonth", { value: month, source: "jikan", url, confidence: matchLow ? "low" : "high", fetchedAt, raw: bday }, context);
      const occ = pickLabel(f, OCCUPATION_LABELS);
      if (c.missing.includes("occupation") && occ && occ.length <= 60) add(c.id, "occupation", { value: occ, source: "jikan", url, confidence: matchLow ? "low" : "medium", fetchedAt, raw: occ }, context);
    }
    if ((gi + 1) % 10 === 0) { await save(); console.log(`[jikan] ${gi + 1}/${groups.length} anime, ${candidates.length} candidates, ${jikanRequests} requests`); }
  }
} catch (err) {
  if (err instanceof CapReached) { stats.stoppedAtMax = true; console.log(`[jikan] --max ${max} reached; re-run to continue (cached pages are free)`); }
  else { await save(); throw err; }
}
await save();
console.log(`[jikan] done: ${candidates.length} candidates (${Object.entries(stats.byField).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}), ${stats.unmatched} unmatched, ${jikanRequests} Jikan requests -> ${rel(out)}`);
