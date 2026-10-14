import { withRedis } from "@/lib/redis";

/** Verdict per sha256 of image bytes. "a" = allowed, "b" = blocked. */
export type Verdict = "a" | "b";
export const MOD_HASH = "waifu100:mod:v1";

export interface VerdictStore {
    get(hashes: string[]): Promise<(Verdict | null)[]>;
    set(entries: [string, Verdict][]): Promise<void>;
}

const memory = new Map<string, Verdict>();
const MEMORY_MAX = 20_000;
function remember(hash: string, v: Verdict) {
    if (memory.size >= MEMORY_MAX) memory.delete(memory.keys().next().value as string);
    memory.set(hash, v);
}

/** Memory LRU in front of the Redis hash. A Redis failure reads as a miss. */
export const redisVerdictStore: VerdictStore = {
    async get(hashes) {
        const out: (Verdict | null)[] = hashes.map((h) => memory.get(h) ?? null);
        const missing = hashes.filter((_, i) => out[i] === null);
        if (missing.length === 0 || !process.env.REDIS_URL) return out;
        try {
            const vals = await withRedis((r) => r.hmget(MOD_HASH, ...missing));
            let j = 0;
            hashes.forEach((h, i) => {
                if (out[i] !== null) return;
                const v = vals[j++];
                if (v === "a" || v === "b") {
                    out[i] = v;
                    remember(h, v);
                }
            });
        } catch (e) {
            console.error("[moderation] verdict read failed:", e);
        }
        return out;
    },
    async set(entries) {
        if (entries.length === 0) return;
        entries.forEach(([h, v]) => remember(h, v));
        if (!process.env.REDIS_URL) return;
        try {
            await withRedis((r) => r.hset(MOD_HASH, Object.fromEntries(entries)));
        } catch (e) {
            console.error("[moderation] verdict write failed:", e);
        }
    },
};

export function memoryVerdictStore(): VerdictStore & { map: Map<string, Verdict> } {
    const map = new Map<string, Verdict>();
    return {
        map,
        async get(hashes) {
            return hashes.map((h) => map.get(h) ?? null);
        },
        async set(entries) {
            entries.forEach(([h, v]) => map.set(h, v));
        },
    };
}
