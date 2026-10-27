#!/usr/bin/env node
// Merge candidate files (and review items a human set to "approved") into
// src/server/gacha/enrichment.json; everything not auto-mergeable goes to src/server/gacha/review.json.
//   node scripts/gacha/enrich/merge.mjs out/age-candidates.json out/anilist-desc-candidates.json [--dry-run]
// Rules (lib/merge.mjs): never overwrites an AniList value or an existing sidecar value; values without
// full provenance are rejected; only high-confidence, non-review-only values merge without review.
// Then run `npm run gacha:catalog` to apply enrichment.json to catalog.json.
import path from "node:path";
import { parseArgs } from "./lib/args.mjs";
import { CATALOG_FILE, ENRICHMENT_FILE, REVIEW_FILE, readJson, rel, writeJson } from "./lib/io.mjs";
import { EMPTY_ENRICHMENT, EMPTY_REVIEW, mergeCandidates } from "./lib/merge.mjs";

const { flags, rest } = parseArgs(process.argv.slice(2));
const catalog = await readJson(CATALOG_FILE);
const enrichment = await readJson(ENRICHMENT_FILE, EMPTY_ENRICHMENT);
const review = await readJson(REVIEW_FILE, EMPTY_REVIEW);
const candidates = [];
for (const f of rest) {
  const data = await readJson(path.resolve(f));
  candidates.push(...(data.candidates ?? []));
  console.log(`[merge] ${f}: ${(data.candidates ?? []).length} candidates (${data.tool ?? "?"})`);
}
const result = mergeCandidates({ catalog, enrichment, review, candidates });
const r = result.report;
const count = (list) => Object.entries(list.reduce((m, x) => ((m[x.reason] = (m[x.reason] ?? 0) + 1), m), {})).map(([k, v]) => `${k} ${v}`).join(", ") || "0";
console.log(`[merge] merged ${r.merged.length}, approved-from-review ${r.approvedMerged.length}, to review ${r.toReview.length}`);
console.log(`[merge] skipped: ${count(r.skipped)}`);
console.log(`[merge] rejected: ${count(r.rejected)}`);
if (flags.has("dry-run")) { console.log("[merge] dry-run: nothing written"); process.exit(0); }
await writeJson(ENRICHMENT_FILE, result.enrichment);
await writeJson(REVIEW_FILE, result.review);
console.log(`[merge] wrote ${rel(ENRICHMENT_FILE)} and ${rel(REVIEW_FILE)}. Next: npm run gacha:catalog`);
