import { NextRequest, NextResponse } from "next/server";
import { withRedis } from "@/lib/redis";
import { consume, LIMITS } from "@/lib/rate-limit";
import { isMediaType } from "@/lib/share-schema";
import { serperFetch } from "@/server/serper-budget";
import { getFlashModel } from "@/lib/gemini";
import { resolveStoryTitles } from "@/server/story-resolve";

export const dynamic = "force-dynamic";

/**
 * GET /api/story/resolve?q=&type=ANIME|MANGA|NOVEL -> { titles: string[] }.
 * Called by the builder only after AniList found nothing. Redis-cached (hit 180d / miss 14d);
 * misses are rate-limited and spend one Serper credit (+ at most one Gemini call).
 */
export async function GET(req: NextRequest) {
    const q = (req.nextUrl.searchParams.get("q") ?? "").slice(0, 200);
    const t = req.nextUrl.searchParams.get("type");
    const type = isMediaType(t) ? t : null;
    const hasRedis = !!process.env.REDIS_URL;
    const result = await resolveStoryTitles(q, type, {
        apiKey: process.env.SERPER_API_KEY,
        cacheGet: (k) => (hasRedis ? withRedis((r) => r.get(k)) : Promise.resolve(null)),
        cacheSet: async (k, v, ttl) => {
            if (hasRedis) await withRedis((r) => r.set(k, v, "EX", ttl));
        },
        allowMiss: async () => (await consume(req, LIMITS.storyResolve)).allowed,
        serper: (url, init) => serperFetch(url, init),
        ...(process.env.GEMINI_API_KEY
            ? { extract: async (prompt: string) => (await getFlashModel().generateContent(prompt)).response.text() }
            : {}),
    });
    if (!result.ok) return NextResponse.json({ error: result.error, titles: [] }, { status: result.status });
    return NextResponse.json(
        { titles: result.titles, cached: result.cached },
        { headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" } }
    );
}
