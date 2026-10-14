import { NextRequest, NextResponse } from "next/server";
import { Effect } from "effect";
import { cacheSummary } from '@/lib/share-summary-cache';
import { createShare } from '@/server/share-service';
import { respond } from '@/server/run';

/**
 * Creates a share. Waifu bodies are unchanged from before T-0009; a body with
 * `kind: "story"` and `size` creates a story share (see share-schema.ts).
 * The payload, feed entry(s) and owner index are written in one MULTI
 * (share-repo.ts); the listing summary is cached right after.
 */
export async function POST(req: NextRequest) {
    let body: unknown;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid grid data" }, { status: 400 });
    }
    if (!body || typeof body !== "object") {
        return NextResponse.json({ error: "Invalid grid data" }, { status: 400 });
    }

    return respond(
        createShare(body as Record<string, unknown>).pipe(
            Effect.tap(({ id, payload }) => Effect.promise(() => cacheSummary(id, payload)))
        ),
        ({ id, url }) => NextResponse.json({ id, url }),
        (e) => (e._tag === "InvalidShare" ? e.reason : "Failed to save share")
    );
}
