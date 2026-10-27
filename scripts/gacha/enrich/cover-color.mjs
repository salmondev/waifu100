#!/usr/bin/env node
// coverColor for anime whose AniList entry has none: the most prominent saturated colour of the
// AniList cover (pixel buckets weighted by saturation; deterministic, no AI). Dry-run unless --live.
//   node scripts/gacha/enrich/cover-color.mjs --live [--out scripts/gacha/enrich/out/cover-color-candidates.json]
import path from "node:path";
import { parseArgs } from "./lib/args.mjs";
import { createLimiter } from "./lib/http.mjs";
import { CATALOG_FILE, ENRICHMENT_FILE, OUT_DIR, readJson, rel, writeJson } from "./lib/io.mjs";
import { accentColor } from "./lib/color.mjs";
import { candidate, nowIso } from "./lib/provenance.mjs";

const { flags, opts } = parseArgs(process.argv.slice(2));
const live = flags.has("live") && !flags.has("dry-run");
const out = path.resolve(opts.out ?? path.join(OUT_DIR, "cover-color-candidates.json"));
const catalog = await readJson(CATALOG_FILE);
const enrichment = await readJson(ENRICHMENT_FILE, { characters: {}, anime: {} });
const todo = catalog.anime.filter((a) => (!a.coverColor || (a.enriched ?? []).includes("coverColor")) && !enrichment.anime?.[a.id]?.coverColor && a.cover);
console.log(`[cover-color] ${live ? "LIVE" : "dry-run"}: ${todo.length} anime without coverColor (${todo.length} image downloads)`);
if (!live) process.exit(0);

const { default: sharp } = await import("sharp");
const wait = createLimiter({ minIntervalMs: 1000, perMinute: 30 });
const candidates = [];
for (const a of todo) {
  await wait();
  const res = await fetch(a.cover, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) { console.log(`  ${a.titleRomaji}: HTTP ${res.status}, skipped`); continue; }
  const { data, info } = await sharp(Buffer.from(await res.arrayBuffer())).resize(64, 64, { fit: "inside" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const value = accentColor(data, info.channels);
  candidates.push(candidate("anime", a.id, "coverColor", { value, source: "derived-cover", url: a.cover, confidence: "high", fetchedAt: nowIso(), note: "saturation-weighted pixel buckets" }, { title: a.titleRomaji }));
  console.log(`  ${a.titleRomaji}: ${value}`);
}
await writeJson(out, { generatedAt: nowIso(), tool: "cover-color", source: "AniList cover images", candidates });
console.log(`[cover-color] ${candidates.length} candidates -> ${rel(out)}`);

