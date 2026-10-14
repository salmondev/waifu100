import { NextRequest, NextResponse } from "next/server";
import { withRedis } from "@/lib/redis";
import { consume, LIMITS } from "@/lib/rate-limit";
import { storyWebSearch, WEB_CACHE_TTL_SEC } from "@/server/story-web-search";

export const dynamic = "force-dynamic";

/** GET /api/story/web-search?q=&type=ANIME|MANGA - Serper, cached 30 days. Images still go through /api/img. */
export async function GET(req: NextRequest) {
    const q = req.nextUrl.searchParams.get("q") ?? "";
    const type = req.nextUrl.searchParams.get("type") === "MANGA" ? "MANGA" : "ANIME";
    const result = await storyWebSearch(q, type, {
        apiKey: process.env.SERPER_API_KEY,
        cacheGet: (k) => (process.env.REDIS_URL ? withRedis((r) => r.get(k)) : Promise.resolve(null)),
        cacheSet: async (k, v) => {
            if (process.env.REDIS_URL) await withRedis((r) => r.set(k, v, "EX", WEB_CACHE_TTL_SEC));
        },
        allowMiss: async () => (await consume(req, LIMITS.storyWeb)).allowed,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(
        { items: result.items, cached: result.cached },
        { headers: { "Cache-Control": "public, max-age=0, s-maxage=86400" } }
    );
}
