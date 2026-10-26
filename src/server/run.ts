import { Effect, Layer } from "effect";
import { NextResponse } from "next/server";
import { ShareRepo, ShareRepoLive } from "@/server/share-repo";
import { statusOf } from "@/server/errors";

/** The production layer for route handlers. */
export const AppLive: Layer.Layer<ShareRepo> = ShareRepoLive;

/** Runs a program against the live layer; typed failures reject with the error. */
export function runApp<A, E>(program: Effect.Effect<A, E, ShareRepo>): Promise<A> {
    return Effect.runPromise(program.pipe(Effect.provide(AppLive)));
}

/** Runs a program and turns typed failures into JSON error responses. */
export async function respond<A, E extends { readonly _tag: string }>(
    program: Effect.Effect<A, E, ShareRepo>,
    ok: (a: A) => Response,
    message: (e: E) => string
): Promise<Response> {
    const result = await Effect.runPromise(
        program.pipe(
            Effect.provide(AppLive),
            Effect.match({ onFailure: (e) => ({ ok: false as const, e }), onSuccess: (a) => ({ ok: true as const, a }) })
        )
    );
    if (result.ok) return ok(result.a);
    if (statusOf(result.e) >= 500) console.error("[app]", result.e);
    return NextResponse.json({ error: message(result.e) }, { status: statusOf(result.e) });
}
