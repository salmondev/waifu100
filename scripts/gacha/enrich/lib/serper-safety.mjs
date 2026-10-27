// Key-handling helpers for serper.mjs (kept small so they can be unit-tested).

/** Queries allowed this run: min(--max, SERPER_DAILY_CAP - used today). */
export function effectiveCap({ max, dailyCap, usedToday = 0 }) {
  let cap = Infinity;
  if (dailyCap !== undefined && dailyCap !== "") {
    const n = Number(dailyCap);
    cap = Number.isFinite(n) && n >= 0 ? n : 0; // a malformed cap means "no queries", never "unlimited"
  }
  return Math.max(0, Math.min(max, cap - usedToday));
}

/** The real endpoint, or a localhost override for tests only (the key must never leave for another host). */
export function serperEndpoint(override) {
  if (!override) return "https://google.serper.dev/search";
  const u = new URL(override);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)) throw new Error("SERPER_ENDPOINT may only point at localhost (tests)");
  return u.toString();
}

/** Throws if the key appears anywhere in the data about to be written. */
export function assertNoSecret(data, key) {
  if (!key) return;
  if (JSON.stringify(data).includes(key)) throw new Error("refusing to write output: it contains the API key");
}
