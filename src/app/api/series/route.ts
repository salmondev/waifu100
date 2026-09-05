import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { readCachedSeries, resolveSeries, MAX_LOOKUPS } from "@/lib/series-resolve";
import { matchKey } from "@/lib/character-match";

export const dynamic = "force-dynamic";
// Up to six sequential AniList batches; measured well under this, but a slow
// upstream must not take the whole function down with it.
export const maxDuration = 30;

/**
 * "Which series are these characters from?"
 *
 * Split out of the compare page on purpose: the page renders instantly from
 * whatever is already cached, and the browser asks for the rest afterwards, so
 * a cold cache costs a slower chart rather than a slower page.
 *
 * Answers are cached in Redis by normalised name and shared by everyone, so the
 * lookup bill shrinks with every grid compared - and it is free anyway, which
 * is exactly why this uses AniList rather than the Gemini budget.
 *
 * Every name that was asked about comes back, misses included as empty strings,
 * so the caller can stop asking about them too.
 */
export async function POST(req: NextRequest) {
    try {
        // AniList's rate limit is per minute and shared by every app using it,
        // so this endpoint gets a budget of its own.
        const limited = await enforceRateLimit(req, LIMITS.series);
        if (limited) return limited;

        const body = await req.json();
        const raw: unknown = body?.names;

        if (!Array.isArray(raw) || raw.length === 0) {
            return NextResponse.json({ series: {} });
        }

        const wanted = raw
            .filter((n): n is string => typeof n === "string" && n.trim().length > 0)
            .map((n) => n.slice(0, 120))
            .slice(0, MAX_LOOKUPS * 2);

        const cached = await readCachedSeries(wanted);
        const unknown = wanted.filter((name) => cached[matchKey(name)] == null);
        const fresh = unknown.length > 0 ? await resolveSeries(unknown) : {};

        const series: Record<string, string> = {};
        for (const [key, value] of Object.entries(cached)) {
            if (value !== null) series[key] = value;
        }
        Object.assign(series, fresh);

        return NextResponse.json({ series });
    } catch (e) {
        console.error("Series resolve error:", e);
        return NextResponse.json({ series: {} });
    }
}
