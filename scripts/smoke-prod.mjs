#!/usr/bin/env node
// Read-only post-deploy smoke. GET only, no /api calls (nothing that writes or
// triggers AI/search/Redis-heavy paths). Usage: node scripts/smoke-prod.mjs [baseUrl]
import { checkHeaders } from "./check-headers.mjs";
const BASE = (process.argv[2] || process.env.SMOKE_URL || "https://waifu100.vercel.app").replace(/\/$/, "");
const CHECKS = [
  ["/", 200, /Waifu100/i],
  ["/story", 200, /Story100/i],
  ["/compare", 200, /compare/i],
  ["/community", 200, /<html/i],
  ["/manifest.webmanifest", 200, /"name"/],
  ["/icon-512.png", 200, null],
  ["/favicon.ico", 200, null],
  ["/view", [200, 307, 308], null], // no hash -> redirect home
];
let fail = 0;
const t0 = Date.now();
for (const [path, expect, re] of CHECKS) {
  const t = Date.now();
  try {
    const res = await fetch(BASE + path, { method: "GET", redirect: "manual", headers: { "user-agent": "waifu100-smoke/1.0" } });
    const okStatus = Array.isArray(expect) ? expect.includes(res.status) : res.status === expect;
    const body = re ? await res.text() : "";
    const okBody = !re || re.test(body);
    const ok = okStatus && okBody;
    if (!ok) fail++;
    console.log(`${ok ? "PASS" : "FAIL"} GET ${path} -> ${res.status} ${okBody ? "" : "(body check failed)"} ${Date.now() - t}ms`);
  } catch (e) { fail++; console.log(`FAIL GET ${path} -> ${e.message}`); }
}
try {
  const h = await checkHeaders(BASE + "/");
  const ok = h.missingReq.length === 0;
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} security headers: required missing [${h.missingReq.join(", ") || "none"}], recommended missing [${h.missingRec.join(", ") || "none"}] (warn)`);
} catch (e) { fail++; console.log(`FAIL headers -> ${e.message}`); }
console.log(`SMOKE ${BASE}: ${fail ? `FAIL (${fail})` : "PASS"} in ${Date.now() - t0}ms`);
process.exit(fail ? 1 : 0);
