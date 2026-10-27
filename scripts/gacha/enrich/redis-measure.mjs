#!/usr/bin/env node
// READ-ONLY measurement of the main app's Redis-only "no data" states (T-0027 audit S10/S11).
// Uses only SCAN / GET / TYPE (see lib/redis-readonly.mjs; any write command throws).
// Output is COUNTS ONLY: no key names, ids, character names, profile text, share data or secrets.
// Dry-run unless --live. Needs REDIS_URL in the shell environment (never printed or written).
//   node scripts/gacha/enrich/redis-measure.mjs --live [--sample 500] [--max-keys 20000] [--out scripts/gacha/enrich/out/redis-counts.json]
import path from "node:path";
import { intOpt, parseArgs } from "./lib/args.mjs";
import { OUT_DIR, rel, writeJson } from "./lib/io.mjs";
import { readOnly, tallyCharacterEntry, tallyShare } from "./lib/redis-readonly.mjs";

const { flags, opts } = parseArgs(process.argv.slice(2));
const live = flags.has("live") && !flags.has("dry-run");
const sample = intOpt(opts, "sample", 500); // GETs per family
const maxKeys = intOpt(opts, "max-keys", 20000); // SCAN stops counting after this many keys per family
const out = path.resolve(opts.out ?? path.join(OUT_DIR, "redis-counts.json"));
const FAMILIES = [
  { name: "characterMatch", match: "waifu100:cmatch:v4:*", tally: "character" },
  { name: "characterThai", match: "waifu100:char-th:p3:*", tally: null },
  { name: "share", match: "waifu100:share:*", tally: "share" },
];

console.log(`[redis] ${live ? "LIVE (read-only)" : "dry-run"}: SCAN ${FAMILIES.map((f) => f.match).join(", ")}; up to ${maxKeys} keys counted and ${sample} values read per family; counts only -> ${rel(out)}`);
if (!live) { console.log("[redis] dry-run only. Add --live (REDIS_URL must be in the environment)."); process.exit(0); }
const url = process.env.REDIS_URL;
if (!url) { console.error("[redis] REDIS_URL is not set in this shell's environment; nothing was contacted."); process.exit(2); }

const { default: Redis } = await import("ioredis");
const raw = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 2, enableOfflineQueue: false });
await raw.connect();
const redis = readOnly(raw);
const result = { generatedAt: new Date().toISOString(), readOnly: true, sample, maxKeys, families: {} };
try {
  for (const fam of FAMILIES) {
    let cursor = "0";
    let keys = 0;
    let truncated = false;
    const toRead = [];
    do {
      const [next, batch] = await redis.scan(cursor, "MATCH", fam.match, "COUNT", 500);
      cursor = next;
      for (const k of batch) {
        keys++;
        if (fam.tally && toRead.length < sample && (toRead.length < sample / 2 || Math.random() < 0.5)) toRead.push(k);
      }
      if (keys >= maxKeys) { truncated = true; break; }
    } while (cursor !== "0");
    const entry = { keys, truncated };
    if (fam.tally === "character") Object.assign(entry, { read: 0, unparseable: 0, unknown: 0, noSeries: 0, noImage: 0, noDescription: 0, researched: 0, confidence: {} });
    if (fam.tally === "share") Object.assign(entry, { read: 0, unparseable: 0, legacyArray: 0, noCreatedAt: 0, nonString: 0 });
    for (const k of toRead) {
      if ((await redis.type(k)) !== "string") { entry.nonString = (entry.nonString ?? 0) + 1; continue; }
      const v = await redis.get(k);
      if (v === null) continue;
      if (fam.tally === "character") tallyCharacterEntry(entry, v);
      else tallyShare(entry, v);
    }
    result.families[fam.name] = entry;
    console.log(`[redis] ${fam.name}: ${keys}${truncated ? "+" : ""} keys${entry.read !== undefined ? `, ${entry.read} read` : ""}`);
  }
} finally {
  await redis.quit();
}
await writeJson(out, result);
console.log(`[redis] counts written to ${rel(out)} (no keys, ids, names or contents)`);
