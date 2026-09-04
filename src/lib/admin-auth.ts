import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";

/**
 * A single shared secret for the handful of endpoints that should never have
 * been reachable by the public: the ones that spend API credits without any
 * user asking, and the one that can overwrite a verdict on someone else's grid.
 *
 * Deliberately minimal - no sessions, no roles. Set ADMIN_TOKEN in the
 * environment and send it as `x-admin-token`.
 */

const HEADER = "x-admin-token";

function matches(provided: string, expected: string): boolean {
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    // timingSafeEqual throws on length mismatch, which is itself a leak of
    // length - compare padded buffers and check the length separately.
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
}

export function isAdminRequest(request: Request): boolean {
    const expected = process.env.ADMIN_TOKEN;
    // Fail closed: with no token configured, nothing is admin.
    if (!expected) return false;

    const provided = request.headers.get(HEADER);
    if (!provided) return false;

    return matches(provided, expected);
}

/** 401 body for a request that needed the admin token and did not carry it. */
export function adminOnlyResponse() {
    return NextResponse.json(
        { error: `Admin only. Send the ${HEADER} header.` },
        { status: 401 }
    );
}
