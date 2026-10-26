/**
 * Gacha Guess profile persistence.
 *
 * One JSON document per anonymous player at `waifu100:gg:p:<id>`, plus
 * `waifu100:gg:rc:<sha256(recovery code)>` -> id for restoring on another
 * browser. The plain code is never stored; ids and codes are never logged.
 *
 * Writes are read-modify-write of the whole profile, so every mutation runs
 * under a short per-profile lock (SET NX PX): a double-tapped "guess" or two
 * tabs submitting at once queue up instead of both applying.
 *
 * Without REDIS_URL (local dev, tests) everything lives in process memory, in
 * the same spirit as the rate limiter's fallback. Unlike the rate limiter, a
 * Redis *error* is not papered over with memory: that would silently fork a
 * player's coins and collection, so it surfaces as "unavailable" instead.
 */
import { randomUUID } from "node:crypto";
import { withRedis } from "@/lib/redis";
import type { PullResult, Tier } from "./rules";

export const PROFILE_PREFIX = "waifu100:gg:p:";
export const RECOVERY_PREFIX = "waifu100:gg:rc:";
export const LOCK_PREFIX = "waifu100:gg:lock:";

/** Abandoned anonymous profiles fade out; any write pushes this forward again. */
export const PROFILE_TTL_SEC = 400 * 24 * 60 * 60;
/** Rounds older than this many days are dropped from the profile on write. */
export const KEEP_ROUND_DAYS = 60;

const LOCK_TTL_MS = 5000;
const LOCK_RETRY_MS = 60;
const LOCK_ATTEMPTS = 25;

export interface GachaRound {
    day: string;
    animeId: number;
    answerId: number;
    /** Character ids in the order guessed. */
    guesses: number[];
    /** Ladder slots bought with coins (real hints and refunded empty slots alike). */
    bought: number;
    /**
     * Coins charged and handed straight back for bought slots that turned out to
     * be empty ("no data"). Bookkeeping only: the refund happens in the same
     * write as the charge, so it never adds coins. Absent on older rounds (= 0).
     */
    refunded?: number;
    /**
     * 2 = created under the T-0016 r2 rules: hints open only when bought, and the
     * fast bonus counts guesses + bought hints. Since T-0023 the tier counts
     * guesses only on every round; a finished round keeps the tier stored at its
     * win. Absent on older rounds (a free hint per wrong guess).
     */
    rules?: 2;
    /**
     * true = started from the archive (a past day this profile never played):
     * no daily coins on creation; the normal daily coins are paid once when it
     * finishes (dailyCoins goes 0 -> DAILY_COINS). Absent on rounds started on their own day.
     * Whether a finish counts for the streak / fast bonus is decided by the
     * finishing day (it must be the round's own day), not by this flag.
     */
    archive?: true;
    done: "won" | "lost" | null;
    /** Daily coins this round granted: +10 on creation, or on finish for archive rounds (0 until then). */
    dailyCoins: number;
    /** Fast-guess bonus paid at win time. */
    bonus: number;
    /** Committed at win time, read back on every reload. */
    pull: { result: PullResult; prevTier: Tier | null; tier: Tier } | null;
    storyUnlockedNow: boolean;
}

export interface CollectionEntry {
    tier: Tier;
    day: string;
    animeId: number;
}

export interface GachaProfile {
    v: 1;
    createdAt: string;
    coins: number;
    rounds: Record<string, GachaRound>;
    finishedDays: string[];
    collection: Record<string, CollectionEntry>;
    storySeen: number[];
    recoveryHash: string | null;
}

export interface GachaStore {
    load(id: string): Promise<GachaProfile | null>;
    save(id: string, profile: GachaProfile): Promise<void>;
    tryLock(id: string, token: string, ttlMs: number): Promise<boolean>;
    unlock(id: string, token: string): Promise<void>;
    getRecovery(hash: string): Promise<string | null>;
    setRecovery(hash: string, id: string): Promise<void>;
    deleteRecovery(hash: string): Promise<void>;
}

export class GachaBusy extends Error {
    constructor() {
        super("profile is busy");
    }
}

function parseProfile(raw: string | null): GachaProfile | null {
    if (!raw) return null;
    try {
        const p = JSON.parse(raw) as GachaProfile;
        return p && typeof p === "object" && typeof p.coins === "number" ? p : null;
    } catch {
        return null;
    }
}

// Compare-and-delete, so a lock that expired and was re-taken by another
// request is not released by the slow one that originally held it.
const UNLOCK_LUA = 'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';

export const redisGachaStore: GachaStore = {
    async load(id) {
        return parseProfile(await withRedis((r) => r.get(PROFILE_PREFIX + id)));
    },
    async save(id, profile) {
        await withRedis(async (r) => {
            const p = r.pipeline().set(PROFILE_PREFIX + id, JSON.stringify(profile), "EX", PROFILE_TTL_SEC);
            if (profile.recoveryHash) p.expire(RECOVERY_PREFIX + profile.recoveryHash, PROFILE_TTL_SEC);
            await p.exec();
        });
    },
    async tryLock(id, token, ttlMs) {
        return (await withRedis((r) => r.set(LOCK_PREFIX + id, token, "PX", ttlMs, "NX"))) === "OK";
    },
    async unlock(id, token) {
        await withRedis((r) => r.eval(UNLOCK_LUA, 1, LOCK_PREFIX + id, token));
    },
    async getRecovery(hash) {
        return withRedis((r) => r.get(RECOVERY_PREFIX + hash));
    },
    async setRecovery(hash, id) {
        await withRedis((r) => r.set(RECOVERY_PREFIX + hash, id, "EX", PROFILE_TTL_SEC));
    },
    async deleteRecovery(hash) {
        await withRedis((r) => r.del(RECOVERY_PREFIX + hash));
    },
};

/** Process-memory store: local dev without REDIS_URL, and tests. */
export function memoryGachaStore(): GachaStore & { profiles: Map<string, string> } {
    const profiles = new Map<string, string>();
    const recovery = new Map<string, string>();
    const locks = new Map<string, { token: string; until: number }>();
    return {
        profiles,
        async load(id) {
            return parseProfile(profiles.get(id) ?? null);
        },
        async save(id, profile) {
            // Stored serialised so callers can never mutate it in place.
            profiles.set(id, JSON.stringify(profile));
        },
        async tryLock(id, token, ttlMs) {
            const held = locks.get(id);
            if (held && held.until > Date.now()) return false;
            locks.set(id, { token, until: Date.now() + ttlMs });
            return true;
        },
        async unlock(id, token) {
            if (locks.get(id)?.token === token) locks.delete(id);
        },
        async getRecovery(hash) {
            return recovery.get(hash) ?? null;
        },
        async setRecovery(hash, id) {
            recovery.set(hash, id);
        },
        async deleteRecovery(hash) {
            recovery.delete(hash);
        },
    };
}

const sharedMemoryStore = memoryGachaStore();

/** Redis when REDIS_URL is set, otherwise the per-process memory store. */
export function defaultGachaStore(): GachaStore {
    return process.env.REDIS_URL ? redisGachaStore : sharedMemoryStore;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs `fn` holding the profile's write lock. Retries briefly (a double-submit
 * waits for the first to finish, then sees its result), then gives up with
 * GachaBusy rather than hanging the request.
 */
export async function withProfileLock<T>(store: GachaStore, id: string, fn: () => Promise<T>): Promise<T> {
    const token = randomUUID();
    for (let attempt = 0; ; attempt++) {
        if (await store.tryLock(id, token, LOCK_TTL_MS)) break;
        if (attempt + 1 >= LOCK_ATTEMPTS) throw new GachaBusy();
        await sleep(LOCK_RETRY_MS);
    }
    try {
        return await fn();
    } finally {
        await store.unlock(id, token).catch(() => undefined);
    }
}
