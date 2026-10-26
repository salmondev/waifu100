import { Data } from "effect";

/** Typed failures for the server/data layer (T-0009). */
export class RedisUnavailable extends Data.TaggedError("RedisUnavailable")<{ readonly cause: unknown }> {}
export class ShareNotFound extends Data.TaggedError("ShareNotFound")<{ readonly id: string }> {}
export class InvalidShare extends Data.TaggedError("InvalidShare")<{ readonly reason: string }> {}
export class Forbidden extends Data.TaggedError("Forbidden")<{ readonly reason: string }> {}
export class UpstreamRateLimited extends Data.TaggedError("UpstreamRateLimited")<{
    readonly service: string;
    readonly retryAfterSec: number;
}> {}
export class UpstreamDown extends Data.TaggedError("UpstreamDown")<{
    readonly service: string;
    readonly status?: number;
}> {}

export type ShareError = RedisUnavailable | ShareNotFound | InvalidShare | Forbidden;

/** HTTP status for a typed failure. */
export function statusOf(error: { readonly _tag: string }): number {
    switch (error._tag) {
        case "ShareNotFound":
            return 404;
        case "InvalidShare":
            return 400;
        case "Forbidden":
            return 403;
        case "UpstreamRateLimited":
            return 429;
        case "UpstreamDown":
            return 502;
        default:
            return 500;
    }
}
