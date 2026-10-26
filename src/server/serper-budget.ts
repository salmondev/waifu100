import { withRedis } from "@/lib/redis";

/**
 * Serper usage (shared key: waifu gallery/search/profile + story web).
 * User decision 2026-10-14: NO daily cap by default and Redis is NOT required.
 * Credits are bounded instead by: calls only on explicit "More images" (story)
 * / existing waifu flows, long result caching, and num <= 10.
 *  - optional SERPER_DAILY_CAP (unset/empty/0 = unlimited) still works if set;
 *  - usage is counted in Redis `waifu100:serper:day:<YYYY-MM-DD UTC>` when Redis
 *    is there (for the log only); no Redis => call anyway, usage "unknown".
 */

export const SERPER_MAX_NUM = 10;

/** Infinity = unlimited (default). */
export function dailyCap(): number {
    const n = Number(process.env.SERPER_DAILY_CAP || 0);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : Infinity;
}

export function dayKey(now = new Date()): string {
    return `waifu100:serper:day:${now.toISOString().slice(0, 10)}`;
}

export interface BudgetCounter {
    incr(key: string): Promise<number>;
}

export const redisCounter: BudgetCounter = {
    incr: (key) =>
        withRedis(async (r) => {
            const res = await r.multi().incr(key).expire(key, 3 * 24 * 3600).exec();
            return (res?.[0]?.[1] as number) ?? 0;
        }),
};

/** Counts one call. False only without a key, or over an explicitly set cap. */
export async function takeSerperCredit(counter: BudgetCounter = redisCounter, now = new Date()): Promise<boolean> {
    if (!process.env.SERPER_API_KEY) return false;
    const cap = dailyCap();
    const day = dayKey(now).slice(-10);
    if (counter === redisCounter && !process.env.REDIS_URL) {
        console.info(`[serper] ${day} usage unknown (no Redis) - calling anyway`);
        return true;
    }
    let used: number;
    try {
        used = await counter.incr(dayKey(now));
    } catch (e) {
        console.warn("[serper] usage counter unavailable - calling anyway:", e);
        return true;
    }
    const allowed = used <= cap;
    console.info(`[serper] ${day} usage ${used}${Number.isFinite(cap) ? `/${cap}` : ""}${allowed ? "" : " - cap reached, Serper disabled for today"}`);
    return allowed;
}

/** Clamp `num` in a Serper JSON body. Exported for tests. */
export function clampSerperBody(body: unknown): string | undefined {
    if (typeof body !== "string") return body as undefined;
    try {
        const parsed = JSON.parse(body) as { num?: number };
        parsed.num = Math.min(Number(parsed.num) || SERPER_MAX_NUM, SERPER_MAX_NUM);
        return JSON.stringify(parsed);
    } catch {
        return body;
    }
}

/** Drop-in for fetch() to google.serper.dev. Over budget => synthetic 429 (callers already handle !ok). */
export async function serperFetch(url: string, init: RequestInit, counter?: BudgetCounter): Promise<Response> {
    if (!(await takeSerperCredit(counter))) {
        return new Response(JSON.stringify({ error: "serper budget" }), { status: 429 });
    }
    return fetch(url, { ...init, body: clampSerperBody(init.body) });
}
