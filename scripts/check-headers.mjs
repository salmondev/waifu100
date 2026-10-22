#!/usr/bin/env node
// Security headers check (read-only GET). Usage: node scripts/check-headers.mjs [url]
const url = process.argv[2] || process.env.SMOKE_URL || "https://waifu100.vercel.app";
const REQUIRED = ["strict-transport-security", "x-content-type-options"];
const RECOMMENDED = ["content-security-policy", "x-frame-options", "referrer-policy", "permissions-policy"];
export async function checkHeaders(target = url) {
  const res = await fetch(target, { method: "GET", redirect: "follow", headers: { "user-agent": "waifu100-smoke/1.0" } });
  const missingReq = REQUIRED.filter((h) => !res.headers.get(h));
  const missingRec = RECOMMENDED.filter((h) => !res.headers.get(h));
  const xpb = res.headers.get("x-powered-by");
  return { status: res.status, missingReq, missingRec, xPoweredBy: xpb };
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await checkHeaders();
  console.log(`headers ${url}: status ${r.status}`);
  console.log(`  required missing:    ${r.missingReq.join(", ") || "none"}`);
  console.log(`  recommended missing: ${r.missingRec.join(", ") || "none"} (WARN only)`);
  if (r.xPoweredBy) console.log(`  WARN x-powered-by exposed: ${r.xPoweredBy}`);
  process.exit(r.missingReq.length ? 1 : 0);
}
