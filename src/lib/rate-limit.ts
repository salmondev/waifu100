import { NextResponse } from "next/server";
import { withRedis } from "@/lib/redis";

/**
 * Per-IP rate limiting for the endpoints that cost money per call.
 *
 * /api/analyze, /api/suggest and /api/gallery all have to stay open to the
 * public - they are what the app does - so they cannot sit behind ADMIN_TOKEN
 * like the routes in admin-auth.ts. Until now anyone hammering them could burn
 * Gemini and Serper credit without limit.
 *
 * Counting happens in Redis when REDIS_URL is set, because it is already a
 * dependency of this app and because a per-instance counter is close to
 * useless on Vercel: every concurrent lambda keeps its own tally, so a limit
 * of 10/min is really 10/min *per instance* and the true ceiling scales with
 * however many instances the platform decided to spin up. Since the whole
 * point is protecting a metered API, the number should mean something.
 *
 * The in-memory counter is the fallback for local development (no REDIS_URL)
 * and for the case where Redis itself is unreachable. It is per-instance and
 * therefore loose in exactly the way described above - deliberately so: a
 * rate limiter must never be the reason a user cannot use the site, so a
 * Redis outage degrades to a weaker limit rather than to a 500.
 */

export interface RateLimit {
  /** Requests allowed per window. */
  limit: number;
  /** Window length in seconds. */
  windowSec: number;
  /** Namespace, so two routes do not share a bucket. */
  name: string;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the current window expires. */
  retryAfter: number;
  remaining: number;
}

/**
 * Vercel puts the real client first in x-forwarded-for and appends its own
 * proxy hops after it. The header is trivially spoofable in general, but on
 * Vercel it is rewritten at the edge, and the fallback below means a missing
 * header does not silently disable the limit for everyone at once.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  if (first) return first;
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

/** Fixed-window counters for the no-Redis path. */
const memoryBuckets = new Map<string, { count: number; resetAt: number }>();

function memoryConsume(key: string, limit: number, windowSec: number): RateLimitResult {
  const now = Date.now();
  const existing = memoryBuckets.get(key);

  if (!existing || existing.resetAt <= now) {
    // Opportunistic sweep: without it a long-lived instance accumulates one
    // entry per IP that ever called, forever.
    if (memoryBuckets.size > 5000) {
      for (const [k, v] of memoryBuckets) if (v.resetAt <= now) memoryBuckets.delete(k);
    }
    memoryBuckets.set(key, { count: 1, resetAt: now + windowSec * 1000 });
    return { allowed: true, retryAfter: windowSec, remaining: limit - 1 };
  }

  existing.count += 1;
  const retryAfter = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
  return {
    allowed: existing.count <= limit,
    retryAfter,
    remaining: Math.max(0, limit - existing.count),
  };
}

async function redisConsume(
  key: string,
  limit: number,
  windowSec: number
): Promise<RateLimitResult> {
  // INCR then EXPIRE on first hit: a fixed window, which lets a burst straddle
  // a window boundary and briefly reach 2x the limit. That is fine here - the
  // goal is stopping runaway loops, not precise fairness - and it costs one
  // round trip instead of the sorted-set bookkeeping a sliding window needs.
  const [count, ttl] = await withRedis(async (redis) => {
    const c = await redis.incr(key);
    if (c === 1) await redis.expire(key, windowSec);
    const t = await redis.ttl(key);
    return [c, t] as const;
  });

  const retryAfter = ttl > 0 ? ttl : windowSec;
  return { allowed: count <= limit, retryAfter, remaining: Math.max(0, limit - count) };
}

export async function consume(request: Request, rule: RateLimit): Promise<RateLimitResult> {
  const key = `waifu100:rl:${rule.name}:${clientIp(request)}`;

  if (process.env.REDIS_URL) {
    try {
      return await redisConsume(key, rule.limit, rule.windowSec);
    } catch (e) {
      console.error("[rate-limit] Redis unavailable, falling back to memory:", e);
    }
  }

  return memoryConsume(key, rule.limit, rule.windowSec);
}

/** 429 body for a caller that has used up its window. */
export function tooManyRequestsResponse(result: RateLimitResult, rule: RateLimit) {
  return NextResponse.json(
    {
      error: `Too many requests. Limit is ${rule.limit} per ${rule.windowSec}s - try again in ${result.retryAfter}s.`,
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(result.retryAfter),
        "X-RateLimit-Limit": String(rule.limit),
        "X-RateLimit-Remaining": "0",
      },
    }
  );
}

/**
 * The one call a route needs: returns a 429 response to return immediately, or
 * null when the request may proceed. Mirrors how admin-auth.ts is used.
 */
export async function enforceRateLimit(
  request: Request,
  rule: RateLimit
): Promise<NextResponse | null> {
  const result = await consume(request, rule);
  return result.allowed ? null : tooManyRequestsResponse(result, rule);
}

/**
 * The limits themselves, in one place so they can be compared at a glance.
 * Gemini calls are slow and expensive, so they get the tightest budget; the
 * gallery is called once per character while someone fills a 100-cell grid,
 * so it has to allow a genuinely fast worker through.
 */
export const LIMITS = {
  analyze: { name: "analyze", limit: 10, windowSec: 60 } satisfies RateLimit,
  suggest: { name: "suggest", limit: 10, windowSec: 60 } satisfies RateLimit,
  gallery: { name: "gallery", limit: 30, windowSec: 60 } satisfies RateLimit,
  // Tighter than /api/analyze: a compare link can be opened by a crowd at once,
  // and the button sits on a page nobody in that crowd created. The Redis cache
  // in front of it means a repeat view of the same pair never gets here at all,
  // so this budget only ever counts genuinely new pairs.
  compareVerdict: { name: "compare-verdict", limit: 6, windowSec: 60 } satisfies RateLimit,
  // AniList costs nothing but is a shared community API with a per-minute
  // ceiling; one visitor must not be able to spend everyone else's share of it.
  series: { name: "series", limit: 12, windowSec: 60 } satisfies RateLimit,
};
