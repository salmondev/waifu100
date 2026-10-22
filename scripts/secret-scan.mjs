#!/usr/bin/env node
// Secret scan: uses gitleaks if installed (free), else a regex scan over tracked files.
import { spawnSync, execSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
const has = spawnSync("gitleaks", ["version"], { stdio: "ignore" }).status === 0;
if (has && !process.env.SECRET_SCAN_FALLBACK) {
  // full git history, findings redacted
  const r = spawnSync("gitleaks", ["git", "--no-banner", "--redact", "."], { stdio: "inherit" });
  console.log(r.status ? "SECRET SCAN (gitleaks): FAIL" : "SECRET SCAN (gitleaks): PASS");
  process.exit(r.status ? 1 : 0);
}
const PATTERNS = [
  ["google api key", /AIza[0-9A-Za-z_\-]{35}/],
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["vercel blob token", /vercel_blob_rw_[A-Za-z0-9]{16,}/],
  ["redis url with password", /rediss?:\/\/[^:\s]*:[^@\s]{8,}@/],
  ["github token", /gh[pousr]_[A-Za-z0-9]{36,}/],
  ["aws key", /AKIA[0-9A-Z]{16}/],
  ["slack token", /xox[baprs]-[A-Za-z0-9-]{10,}/],
  ["generic assignment", /(api[_-]?key|secret|token)["']?\s*[:=]\s*["'][A-Za-z0-9_\-]{24,}["']/i],
];
const files = execSync("git ls-files", { encoding: "utf8" }).split("\n").filter((f) => f && !/^\.env/.test(f.split("/").pop()) && !/\.(png|jpg|jpeg|gif|ico|webp|lock|woff2?)$/.test(f));
let hits = 0;
for (const f of files) {
  try { if (statSync(f).size > 1_000_000) continue; } catch { continue; }
  const lines = readFileSync(f, "utf8").split("\n");
  lines.forEach((l, i) => { for (const [n, re] of PATTERNS) if (re.test(l) && !/e2e[-_]dummy|e2e_dummy/.test(l)) { hits++; console.log(`${f}:${i + 1}: ${n}`); } });
}
const tracked = execSync("git ls-files", { encoding: "utf8" }).split("\n").filter((f) => /(^|\/)\.env(\..*)?$/.test(f) && !f.endsWith(".example"));
if (tracked.length) { hits++; console.log(`tracked env files: ${tracked.join(", ")}`); }
console.log(hits ? `SECRET SCAN: FAIL (${hits})` : "SECRET SCAN: PASS");
process.exit(hits ? 1 : 0);
