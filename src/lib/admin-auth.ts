import { matchesSecret } from "@/lib/secret-auth";
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

/**
 * Fail closed: with ADMIN_TOKEN unset / empty / whitespace-only, nothing is admin.
 * Constant-time, length-safe compare lives in secret-auth (T-0012).
 */
export function isAdminRequest(request: Request): boolean {
    return matchesSecret(request.headers.get(HEADER), "ADMIN_TOKEN");
}

/** 401 body for a request that needed the admin token and did not carry it. */
export function adminOnlyResponse() {
    return NextResponse.json(
        { error: `Admin only. Send the ${HEADER} header.` },
        { status: 401 }
    );
}
