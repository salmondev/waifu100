/**
 * Not calling an API that is currently answering 403 to everyone.
 *
 * AniList takes itself offline for hours at a time ("temporarily disabled due
 * to severe stability issues"), and every request during one of those was
 * still being made and still being waited on: a profile card paid a failed
 * round trip before it could fall back to the web, and one compare page could
 * fire eighteen of them. That is latency and someone else's rate limit spent on
 * a certainty.
 *
 * The breaker is per lambda instance and kept in memory on purpose. Putting it
 * in Redis would make it shared, at the price of a read on every request that
 * currently does not need one - and the cheap version already removes almost
 * all of the waste: one failed call per instance per window instead of one per
 * request. It heals by itself when the window passes.
 */

/** How long to stay away after an outage response. */
const OPEN_MS = 5 * 60 * 1000;

/** Only for answers that mean "the service itself is unavailable". */
const OUTAGE_STATUS = new Set([403, 429, 500, 502, 503, 504]);

const openUntil = new Map<string, number>();

/** True while `service` is being skipped. */
export function isUpstreamDown(service: string): boolean {
    const until = openUntil.get(service);
    if (!until) return false;
    if (Date.now() < until) return true;
    openUntil.delete(service);
    return false;
}

/**
 * Records an outage. Takes the HTTP status so that ordinary errors - a bad
 * query, a single timeout - do not trip it; only the ones that say the service
 * is not answering anybody.
 */
export function reportUpstreamStatus(service: string, status: number): void {
    if (!OUTAGE_STATUS.has(status)) return;
    openUntil.set(service, Date.now() + OPEN_MS);
    console.warn(`[upstream] ${service} returned ${status}; skipping it for 5 minutes`);
}

/** Thrown instead of making a call we already know will fail. */
export class UpstreamDownError extends Error {
    constructor(service: string) {
        super(`${service} is unavailable`);
        this.name = "UpstreamDownError";
    }
}

export function assertUpstreamUp(service: string): void {
    if (isUpstreamDown(service)) throw new UpstreamDownError(service);
}
