import { Context, Effect, Layer } from "effect";
import { withRedis } from "@/lib/redis";
import { FEED_KEY, STORY_FEED_KEY, shareKey } from "@/lib/share-keys";
import { userSharesKey } from "@/lib/user-id";
import type { ShareKind } from "@/lib/share-schema";
import { RedisUnavailable } from "@/server/errors";

/**
 * Every Redis touch a share makes, behind one service so routes can be tested
 * against an in-memory fake. Keys are unchanged from before T-0009; the only
 * addition is the `waifu100:feed:story` index (additive, never rewritten).
 */

export { FEED_KEY, STORY_FEED_KEY };
export const feedKeyFor = (kind: ShareKind | "all") => (kind === "story" ? STORY_FEED_KEY : FEED_KEY);
const titlesKey = (userId: string) => `waifu100:user:${userId}:titles`;

export interface CreateShareInput {
    id: string;
    payload: string;
    createdAt: number;
    userId: string | null;
    kind: ShareKind;
}

export interface ShareRepoShape {
    readonly getRaw: (id: string) => Effect.Effect<string | null, RedisUnavailable>;
    readonly getRawMany: (ids: string[]) => Effect.Effect<(string | null)[], RedisUnavailable>;
    readonly create: (input: CreateShareInput) => Effect.Effect<void, RedisUnavailable>;
    readonly remove: (id: string, owner: string | null) => Effect.Effect<void, RedisUnavailable>;
    /** HINCRBY on the owner's title counter; returns the new count. */
    readonly bumpTitle: (userId: string, title: string) => Effect.Effect<number, RedisUnavailable>;
    readonly feedPage: (
        kind: ShareKind | "all",
        start: number,
        stop: number,
        oldestFirst: boolean
    ) => Effect.Effect<{ ids: string[]; total: number }, RedisUnavailable>;
}

export class ShareRepo extends Context.Service<ShareRepo, ShareRepoShape>()("waifu100/ShareRepo") {}

const redis = <T>(f: Parameters<typeof withRedis<T>>[0]) =>
    Effect.tryPromise({ try: () => withRedis(f), catch: (cause) => new RedisUnavailable({ cause }) });

export const ShareRepoLive = Layer.succeed(ShareRepo, {
    getRaw: (id) => redis((r) => r.get(shareKey(id))),
    getRawMany: (ids) =>
        ids.length === 0
            ? Effect.succeed([])
            : redis(async (r) => {
                  const p = r.pipeline();
                  ids.forEach((id) => p.get(shareKey(id)));
                  const res = await p.exec();
                  return ids.map((_, i) => {
                      const [err, data] = res?.[i] ?? [null, null];
                      return err || !data ? null : (data as string);
                  });
              }),
    create: ({ id, payload, createdAt, userId, kind }) =>
        redis(async (r) => {
            const tx = r.multi().set(shareKey(id), payload).zadd(FEED_KEY, createdAt, id);
            if (kind === "story") tx.zadd(STORY_FEED_KEY, createdAt, id);
            if (userId) tx.zadd(userSharesKey(userId), createdAt, id);
            const results = await tx.exec();
            // MULTI reports per-command failures inside the result array.
            const txError = results?.find(([err]) => err)?.[0];
            if (txError) throw txError;
        }),
    remove: (id, owner) =>
        redis(async (r) => {
            const tx = r.multi().del(shareKey(id)).zrem(FEED_KEY, id).zrem(STORY_FEED_KEY, id);
            if (owner) tx.zrem(userSharesKey(owner), id);
            await tx.exec();
        }),
    bumpTitle: (userId, title) => redis((r) => r.hincrby(titlesKey(userId), title, 1)),
    feedPage: (kind, start, stop, oldestFirst) =>
        redis(async (r) => {
            const key = feedKeyFor(kind);
            const res = await r
                .pipeline()
                [oldestFirst ? "zrange" : "zrevrange"](key, start, stop)
                .zcard(key)
                .exec();
            return {
                ids: (res?.[0]?.[1] as string[] | undefined) ?? [],
                total: (res?.[1]?.[1] as number | undefined) ?? 0,
            };
        }),
});

/** In-memory ShareRepo for tests. Exposes its maps for assertions. */
export function makeMemoryShareRepo() {
    const strings = new Map<string, string>();
    const zsets = new Map<string, Map<string, number>>();
    const hashes = new Map<string, Map<string, number>>();
    const z = (k: string) => zsets.get(k) ?? zsets.set(k, new Map()).get(k)!;
    const sorted = (k: string, asc: boolean) =>
        [...z(k).entries()].sort((a, b) => (asc ? a[1] - b[1] : b[1] - a[1])).map(([m]) => m);

    const impl: ShareRepoShape = {
        getRaw: (id) => Effect.sync(() => strings.get(shareKey(id)) ?? null),
        getRawMany: (ids) => Effect.sync(() => ids.map((id) => strings.get(shareKey(id)) ?? null)),
        create: ({ id, payload, createdAt, userId, kind }) =>
            Effect.sync(() => {
                strings.set(shareKey(id), payload);
                z(FEED_KEY).set(id, createdAt);
                if (kind === "story") z(STORY_FEED_KEY).set(id, createdAt);
                if (userId) z(userSharesKey(userId)).set(id, createdAt);
            }),
        remove: (id, owner) =>
            Effect.sync(() => {
                strings.delete(shareKey(id));
                z(FEED_KEY).delete(id);
                z(STORY_FEED_KEY).delete(id);
                if (owner) z(userSharesKey(owner)).delete(id);
            }),
        bumpTitle: (userId, title) =>
            Effect.sync(() => {
                const h = hashes.get(titlesKey(userId)) ?? hashes.set(titlesKey(userId), new Map()).get(titlesKey(userId))!;
                const n = (h.get(title) ?? 0) + 1;
                h.set(title, n);
                return n;
            }),
        feedPage: (kind, start, stop, oldestFirst) =>
            Effect.sync(() => {
                const all = sorted(feedKeyFor(kind), oldestFirst);
                return { ids: all.slice(start, stop + 1), total: all.length };
            }),
    };
    return { layer: Layer.succeed(ShareRepo, impl), strings, zsets, hashes };
}
