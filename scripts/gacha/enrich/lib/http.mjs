// Polite HTTP for the enrichment scripts: a min gap between requests, a per-minute cap,
// retries with exponential back-off on 429 / 5xx / network errors, Retry-After honoured.

const sleepReal = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {{ minIntervalMs: number, perMinute: number, now?: () => number, sleep?: (ms: number) => Promise<void> }} o
 */
export function createLimiter({ minIntervalMs, perMinute, now = Date.now, sleep = sleepReal }) {
  const stamps = [];
  let last = -Infinity;
  return async function wait() {
    for (;;) {
      const t = now();
      while (stamps.length && t - stamps[0] >= 60_000) stamps.shift();
      const gap = last + minIntervalMs - t;
      const window = stamps.length >= perMinute ? stamps[0] + 60_000 - t : 0;
      const ms = Math.max(gap, window);
      if (ms <= 0) break;
      await sleep(ms);
    }
    last = now();
    stamps.push(last);
  };
}

/**
 * GET/POST JSON with retries. Returns { status, body } (body null on 404). Throws after maxTries.
 * Never logs request headers (they may carry a key).
 * @param {string} url
 * @param {RequestInit & { label?: string }} init
 * @param {{ wait: () => Promise<void>, maxTries?: number, baseDelayMs?: number, log?: (s: string) => void,
 *           fetchImpl?: typeof fetch, sleep?: (ms: number) => Promise<void>, onRequest?: () => void }} o
 */
export async function fetchJson(url, init, { wait, maxTries = 5, baseDelayMs = 2000, log = console.log, fetchImpl = fetch, sleep = sleepReal, onRequest = () => {} }) {
  const label = init?.label ?? new URL(url).pathname;
  let lastErr;
  for (let attempt = 1; attempt <= maxTries; attempt++) {
    await wait();
    onRequest();
    let res;
    try {
      res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(30_000) });
    } catch (err) {
      lastErr = new Error(`network error (${err?.cause?.code ?? err?.name ?? "Error"})`);
      if (attempt < maxTries) { const ms = baseDelayMs * 2 ** (attempt - 1); log(`  ${label}: ${lastErr.message}, retry in ${ms / 1000}s (${attempt}/${maxTries})`); await sleep(ms); }
      continue;
    }
    if (res.status === 404) return { status: 404, body: null };
    if (res.status === 429 || res.status >= 500) {
      const ra = Number(res.headers.get("retry-after"));
      const ms = Number.isFinite(ra) && ra > 0 ? ra * 1000 : baseDelayMs * 2 ** (attempt - 1);
      lastErr = new Error(`HTTP ${res.status}`);
      if (attempt < maxTries) { log(`  ${label}: HTTP ${res.status}, retry in ${Math.round(ms / 1000)}s (${attempt}/${maxTries})`); await sleep(ms); }
      continue;
    }
    if (!res.ok) throw new Error(`${label}: HTTP ${res.status}`);
    return { status: res.status, body: await res.json() };
  }
  throw new Error(`${label}: ${lastErr?.message ?? "failed"} after ${maxTries} tries`);
}
