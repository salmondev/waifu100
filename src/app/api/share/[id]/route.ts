import { NextRequest, NextResponse } from "next/server";
import { Effect } from "effect";
import { isAdminRequest } from "@/lib/admin-auth";
import { userIdFromRequest } from "@/lib/user-id";
import { cacheSummary, dropSummary } from "@/lib/share-summary-cache";
import { deleteShare, editorShare, readDecoded, updateShare } from "@/server/share-service";
import { respond } from "@/server/run";

export const dynamic = "force-dynamic";

interface RouteContext {
    params: Promise<{ id: string }>;
}

/**
 * Takes a grid down: the creating browser (anonymous owner id) or an admin.
 * Shares from before owner ids are admin-only, by design. Removes the payload
 * and every index (feed, story feed, owner list) in one MULTI, then the cached
 * summary. Logic lives in src/server/share-service.ts.
 */
const shareError = (e: { _tag: string; reason?: string }) =>
    e._tag === "Forbidden" ? e.reason ?? "Forbidden" : e._tag === "ShareNotFound" ? "Not found" : e._tag === "InvalidShare" ? e.reason ?? "Invalid" : "Failed";

/** The board, so its owner can reopen it. `owned` is true only for the creating browser. */
export async function GET(req: NextRequest, { params }: RouteContext) {
    const { id } = await params;
    const caller = userIdFromRequest(req);
    return respond(
        readDecoded(id).pipe(Effect.map((share) => editorShare(share, !!caller && caller === share.userId))),
        (r) => NextResponse.json(r),
        (e) => shareError(e)
    );
}

/** The owner rewrites this same link. Anyone else is refused. */
export async function PUT(req: NextRequest, { params }: RouteContext) {
    const { id } = await params;
    let body: unknown;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid grid data" }, { status: 400 });
    }
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid grid data" }, { status: 400 });
    return respond(
        updateShare(id, userIdFromRequest(req), body as Record<string, unknown>).pipe(
            Effect.tap(({ id: shareId, payload }) => Effect.promise(() => cacheSummary(shareId, payload)))
        ),
        ({ id: shareId, url }) => NextResponse.json({ id: shareId, url }),
        (e) => shareError(e)
    );
}

export async function DELETE(req: NextRequest, { params }: RouteContext) {
    const { id } = await params;
    return respond(
        deleteShare(id, userIdFromRequest(req), isAdminRequest(req)).pipe(
            Effect.tap(() => Effect.promise(() => dropSummary(id)))
        ),
        (r) => NextResponse.json(r),
        (e) =>
            e._tag === "Forbidden"
                ? e.reason
                : e._tag === "ShareNotFound"
                  ? "Not found"
                  : e._tag === "InvalidShare"
                    ? e.reason
                    : "Failed to delete share"
    );
}
