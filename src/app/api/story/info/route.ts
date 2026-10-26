import { NextRequest, NextResponse } from "next/server";
import { withRedis } from "@/lib/redis";
import { consume, LIMITS } from "@/lib/rate-limit";
import { toMediaType } from "@/lib/share-schema";
import { fetchStoryInfo, infoCacheKey, storyRecordSuspect, INFO_HIT_TTL_SEC, INFO_MISS_TTL_SEC } from "@/server/story-info";

export const dynamic = "force-dynamic";

const CACHE_HEADERS = { "Cache-Control": "public, max-age=3600, s-maxage=86400" };

/** GET /api/story/info?id=&type=&src=anilist|mal -> { info: StoryInfo | null }. Redis-cached; misses rate-limited. */
export async function GET(req: NextRequest) {
    const p = req.nextUrl.searchParams;
    const id = Number(p.get("id"));
    const type = toMediaType(p.get("type"));
    const src = p.get("src") === "mal" ? "mal" : "anilist";
    const title = (p.get("title") || "").slice(0, 120);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Invalid title id." }, { status: 400 });

    const hasRedis = !!process.env.REDIS_URL;
    const key = infoCacheKey(src, id, type, title);
    const hit = hasRedis ? await withRedis((r) => r.get(key)).catch(() => null) : null;
    if (hit) {
        try {
            return NextResponse.json({ info: JSON.parse(hit), cached: true }, { headers: CACHE_HEADERS });
        } catch {
            /* fall through */
        }
    }
    if (!(await consume(req, LIMITS.storyInfo)).allowed) {
        return NextResponse.json({ error: "Too many requests - try again in a minute." }, { status: 429 });
    }
    let info;
    try {
        info = await fetchStoryInfo(src, id, type, fetch, title);
    } catch {
        return NextResponse.json({ error: "Details are unavailable right now." }, { status: 502 });
    }
    if (hasRedis) {
        const settled = info && !storyRecordSuspect(info, type, title);
        await withRedis((r) => r.set(key, JSON.stringify(info), "EX", settled ? INFO_HIT_TTL_SEC : INFO_MISS_TTL_SEC)).catch(() => {});
    }
    return NextResponse.json({ info, cached: false }, { headers: CACHE_HEADERS });
}
