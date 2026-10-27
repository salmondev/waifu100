#!/usr/bin/env node
// Serper (Google search) candidates for CARD characters that still miss age or birth month after
// AniList + Jikan. Web values are review-only: they always land in review.json, never straight in
// enrichment.json. Dry-run unless --live.
//
//   node scripts/gacha/enrich/serper.mjs                          # dry-run: prints only the queries
//   SERPER_API_KEY must already be in the shell's environment for --live (it is never printed or written):
//   node scripts/gacha/enrich/serper.mjs --live --max 50 --after scripts/gacha/enrich/out/jikan-candidates.json
//
// Options: --live, --dry-run (default), --max <n queries, default 50>, --out <file>,
//          --after <candidates.json> (skip fields an earlier run already found), --include-guess-only,
//          --ledger <file> (per-day query count, default scripts/gacha/enrich/.cache/serper-ledger.json)
// Env: SERPER_API_KEY (live only), SERPER_DAILY_CAP (optional; caps queries per day across runs).
import path from "node:path";
import { intOpt, parseArgs } from "./lib/args.mjs";
import { AGE_LABELS, BIRTHDAY_LABELS, labelledFields, monthFromText, pickLabel } from "./lib/about.mjs";
import { normaliseAge } from "./lib/age.mjs";
import { createLimiter, fetchJson } from "./lib/http.mjs";
import { CACHE_DIR, CATALOG_FILE, ENRICHMENT_FILE, OUT_DIR, readJson, rel, writeJson } from "./lib/io.mjs";
import { candidate, nowIso } from "./lib/provenance.mjs";
import { missingByAnime } from "./lib/targets.mjs";
import { assertNoSecret, effectiveCap, serperEndpoint } from "./lib/serper-safety.mjs";

const { flags, opts } = parseArgs(process.argv.slice(2));
const live = flags.has("live") && !flags.has("dry-run");
const out = path.resolve(opts.out ?? path.join(OUT_DIR, "serper-candidates.json"));
const ledgerFile = path.resolve(opts.ledger ?? path.join(CACHE_DIR, "serper-ledger.json"));

function fail(msg) {
  console.error(`[serper] ${msg}`);
  process.exit(2);
}

let max;
try { max = intOpt(opts, "max", 50); } catch (e) { fail(e.message); }

// Read the key once, only in live mode, and keep it out of every log line and file.
const key = live ? process.env.SERPER_API_KEY?.trim() : undefined;
if (live && !key) fail("SERPER_API_KEY is not set in this shell's environment. --live needs it (export it from .env.local in the same shell; see scripts/gacha/enrich/README.md). A dry-run needs no key.");

const catalog = await readJson(CATALOG_FILE);
const enrichment = await readJson(ENRICHMENT_FILE, { characters: {}, anime: {} });
const found = new Set();
if (opts.after) {
  for (const f of opts.after.split(",")) {
    const prev = await readJson(path.resolve(f));
    for (const c of prev.candidates ?? []) found.add(`${c.id}:${c.field}`);
  }
}
const groups = missingByAnime(catalog, enrichment, { fields: ["ageGame", "birthMonth"], cardsOnly: !flags.has("include-guess-only") });
const targets = [];
for (const g of groups) {
  for (const c of g.chars) {
    const missing = c.missing.filter((f) => !found.has(`${c.id}:${f}`));
    if (!missing.length) continue;
    const title = g.anime.titleEnglish || g.anime.titleRomaji;
    targets.push({ c, anime: g.anime, missing, query: `"${c.name}" ${title} character age birthday` });
  }
}
targets.sort((a, b) => b.c.favourites - a.c.favourites);

const ledger = await readJson(ledgerFile, {});
const today = new Date().toISOString().slice(0, 10);
const usedToday = ledger[today] ?? 0;
const cap = effectiveCap({ max, dailyCap: process.env.SERPER_DAILY_CAP, usedToday });
const planned = targets.slice(0, cap);

if (!live) {
  for (const t of planned) console.log(t.query);
  console.error(`[serper] dry-run: ${planned.length} of ${targets.length} queries (cap ${cap}: --max ${max}${process.env.SERPER_DAILY_CAP ? `, SERPER_DAILY_CAP minus ${usedToday} used today` : ""}). No request made. Add --live to run.`);
  process.exit(0);
}

const endpoint = serperEndpoint(process.env.SERPER_ENDPOINT);
const wait = createLimiter({ minIntervalMs: 1000, perMinute: 50 });
const candidates = [];
const stats = { targets: targets.length, queries: 0, withValue: 0, byField: {} };
for (const t of planned) {
  let body;
  try {
    ({ body } = await fetchJson(endpoint, {
      method: "POST",
      headers: { "X-API-KEY": key, "content-type": "application/json" },
      body: JSON.stringify({ q: t.query, num: 10 }),
      label: `serper query ${stats.queries + 1}`,
    }, { wait, maxTries: 3 }));
  } catch (e) {
    console.error(`[serper] ${String(e.message).split(key).join("[redacted]")}; stopping`);
    break;
  }
  stats.queries++;
  ledger[today] = (ledger[today] ?? 0) + 1;
  const fetchedAt = nowIso();
  const context = { name: t.c.name, anime: t.anime.titleRomaji, card: t.c.card, query: t.query };
  const hits = [];
  for (const [k, v] of Object.entries(body?.knowledgeGraph?.attributes ?? {})) hits.push({ text: `${k}: ${v}`, url: body.knowledgeGraph.descriptionLink || body.knowledgeGraph.website, where: "knowledgeGraph" });
  for (const o of body?.organic ?? []) hits.push({ text: o.snippet ?? "", url: o.link, where: "organic" });
  const got = {};
  for (const h of hits) {
    if (!h.url || !/^https:\/\//.test(h.url)) continue;
    // the snippet must name the character, or we cannot tell whose age it is
    if (!h.text.toLowerCase().includes(t.c.name.split(" ")[0].toLowerCase()) && h.where === "organic") continue;
    const f = labelledFields(h.text);
    const conf = /fandom\.com|wikia/.test(h.url) ? "medium" : "low";
    const age = pickLabel(f, AGE_LABELS);
    if (t.missing.includes("ageGame") && !got.ageGame && age) {
      const r = normaliseAge(age);
      if (r.ageGame) got.ageGame = { value: r.ageGame, source: "serper", url: h.url, confidence: r.confidence === "high" ? conf : "low", fetchedAt, raw: age, note: `${h.where}; ${r.reason}` };
    }
    const bd = pickLabel(f, BIRTHDAY_LABELS);
    const month = monthFromText(bd);
    if (t.missing.includes("birthMonth") && !got.birthMonth && month) got.birthMonth = { value: month, source: "serper", url: h.url, confidence: conf, fetchedAt, raw: bd, note: h.where };
  }
  for (const [field, v] of Object.entries(got)) {
    candidates.push(candidate("character", t.c.id, field, v, context));
    stats.byField[field] = (stats.byField[field] ?? 0) + 1;
  }
  if (Object.keys(got).length) stats.withValue++;
}

const result = { generatedAt: nowIso(), tool: "serper", source: "Serper web search (review-only)", stats, candidates };
assertNoSecret(result, key);
await writeJson(out, result);
await writeJson(ledgerFile, ledger);
console.log(`[serper] done: ${stats.queries} queries, ${candidates.length} candidates for review -> ${rel(out)}`);
