/**
 * Shared plumbing for the keyless image sources (Safebooru, Fandom).
 *
 * These are free services being asked for a favour, so every request carries a
 * User-Agent that says who is calling and where to complain. Vercel's outbound
 * IPs are shared and get rejected at random by these sites - a single retry
 * turns most of those rejections back into results, and stops a 403 from being
 * mistaken for "this character has no art".
 */

export const SOURCE_UA = "waifu100/1.0 (+https://waifu100.vercel.app)";

export interface FetchResult {
  ok: boolean;
  status: number;
  body: string;
}

export async function fetchText(
  url: string,
  { timeoutMs = 8000, retries = 1 }: { timeoutMs?: number; retries?: number } = {}
): Promise<FetchResult> {
  let status = 0;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": SOURCE_UA, Accept: "*/*" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      status = res.status;
      if (res.ok) return { ok: true, status, body: await res.text() };
    } catch {
      status = status || 0; // network error or timeout
    }
    if (attempt < retries) await new Promise((r) => setTimeout(r, 500));
  }

  return { ok: false, status, body: "" };
}

export async function fetchJson<T>(
  url: string,
  opts?: { timeoutMs?: number; retries?: number }
): Promise<{ data: T | null; status: number }> {
  const res = await fetchText(url, opts);
  if (!res.ok) return { data: null, status: res.status };
  try {
    return { data: JSON.parse(res.body) as T, status: res.status };
  } catch {
    // Safebooru answers an empty tag with an empty body, not with `[]`.
    return { data: null, status: res.status };
  }
}

/** Lowercase alphanumeric words, the shape both boorus and wiki slugs use. */
export function words(name: string): string[] {
  return name.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}
