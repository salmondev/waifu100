#!/usr/bin/env node
// Release gate runner: typecheck -> lint -> unit -> build -> bundle budget -> e2e.
// Works the same under `npm run verify` and `bun run verify`.
// Flags: --skip=lint,e2e   --only=typecheck,unit
import { spawnSync } from "node:child_process";
import { SAFE_ENV } from "../tests/e2e/safe-env.mjs";

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1]?.split(",") ?? null;
const skip = arg("skip") ?? [];
const only = arg("only");

const steps = [
  ["typecheck", "npx tsc --noEmit"],
  ["lint", "npx eslint"],
  ["unit", "npx vitest run"],
  // In-process route/server tests; Redis/Blob/Gemini/Serper mocked, outside fetch blocked.
  ["integration", "npx vitest run -c vitest.integration.config.mts", SAFE_ENV],
  // Build with dummy env so nothing at build time can reach shared Redis/Blob/AI.
  ["build", "npx next build", SAFE_ENV],
  ["bundle", "node scripts/bundle-budget.mjs"],
  ["e2e", "npx playwright test", { ...SAFE_ENV, E2E_PREBUILT: "1" }],
];

const results = [];
let failed = false;
for (const [name, cmd, env] of steps) {
  if ((only && !only.includes(name)) || skip.includes(name)) { results.push([name, "SKIP", 0]); continue; }
  if (failed && !process.env.VERIFY_CONTINUE) { results.push([name, "NOT RUN", 0]); continue; }
  console.log(`\n=== [verify] ${name}: ${cmd}`);
  const t = Date.now();
  const r = spawnSync(cmd, { shell: true, stdio: "inherit", env: { ...process.env, ...(env || {}) } });
  const ok = r.status === 0;
  results.push([name, ok ? "PASS" : `FAIL(${r.status})`, Date.now() - t]);
  if (!ok) failed = true;
}
console.log("\n=== [verify] summary");
for (const [n, s, ms] of results) console.log(`${n.padEnd(12)} ${s.padEnd(10)} ${(ms / 1000).toFixed(1)}s`);
console.log(failed ? "VERIFY: FAIL" : "VERIFY: PASS");
process.exit(failed ? 1 : 0);
