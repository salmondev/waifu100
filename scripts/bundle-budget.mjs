#!/usr/bin/env node
// Perf/bundle budget: fails if client JS in .next/static grows past budget.
// Override with BUDGET_TOTAL_KB / BUDGET_CHUNK_KB.
import { readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";

const dir = ".next/static/chunks";
if (!existsSync(dir)) { console.error("No .next/static/chunks - run `npx next build` first."); process.exit(2); }
const TOTAL_KB = Number(process.env.BUDGET_TOTAL_KB || 1500); // gzip, all client chunks
const CHUNK_KB = Number(process.env.BUDGET_CHUNK_KB || 350); // gzip, largest single chunk
const files = [];
(function walk(d) { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : p.endsWith(".js") && files.push(p); } })(dir);
const sized = files.map((f) => ({ f, gz: gzipSync(readFileSync(f)).length / 1024 })).sort((a, b) => b.gz - a.gz);
const total = sized.reduce((s, x) => s + x.gz, 0);
console.log(`client chunks: ${sized.length}, total gzip ${total.toFixed(0)} KB (budget ${TOTAL_KB}), largest ${sized[0]?.gz.toFixed(0)} KB (budget ${CHUNK_KB})`);
sized.slice(0, 5).forEach((x) => console.log(`  ${x.gz.toFixed(1).padStart(7)} KB  ${x.f}`));
const bad = total > TOTAL_KB || (sized[0]?.gz ?? 0) > CHUNK_KB;
console.log(bad ? "BUNDLE BUDGET: FAIL" : "BUNDLE BUDGET: PASS");
process.exit(bad ? 1 : 0);
