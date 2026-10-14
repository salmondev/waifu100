import { NextRequest, NextResponse } from "next/server";
import { Effect } from "effect";
import { isAdminRequest } from "@/lib/admin-auth";
import { userIdFromRequest } from "@/lib/user-id";
import { dropSummary } from "@/lib/share-summary-cache";
import { deleteShare } from "@/server/share-service";
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
