/**
 * What is actually in Redis, and how much of the 30 MB it is using.
 *
 *   REDIS_URL=redis://... node scripts/redis-usage.mjs
 *
 * (It also reads REDIS_URL out of .env.local / .env, so on a machine that has
 * the production URL there, plain `node scripts/redis-usage.mjs` works.)
 *
 * Read-only: INFO MEMORY, a SCAN, and MEMORY USAGE per key. Grouped by the
 * first two segments of the key, biggest first - which is the number worth
 * knowing before adding anything to Redis, and the one to check after.
 */
import Redis from 'ioredis';
import fs from 'node:fs';

let env = '';
for (const f of ['.env.local', '.env']) {
    try {
        env += fs.readFileSync(f, 'utf8') + '\n';
    } catch {
        // not every checkout has both
    }
}

const url = process.env.REDIS_URL || env.match(/^REDIS_URL=(.*)$/m)?.[1];
if (!url) {
    console.error('No REDIS_URL - pass it in the environment or put it in .env.local');
    process.exit(1);
}

const redis = new Redis(url.trim().replace(/^["']|["']$/g, ''));

const info = await redis.info('memory');
console.log(
    info
        .split('\n')
        .filter((l) => /used_memory_human|used_memory:|maxmemory/.test(l))
        .join('')
        .trim() || info
);

const stats = new Map();
let cursor = '0';
let total = 0;

do {
    const [next, keys] = await redis.scan(cursor, 'COUNT', 500);
    cursor = next;
    if (keys.length === 0) continue;

    const pipeline = redis.pipeline();
    keys.forEach((k) => pipeline.memory('USAGE', k));
    const results = await pipeline.exec();

    keys.forEach((k, i) => {
        const bytes = Number(results?.[i]?.[1] ?? 0);
        const group = k.split(':').slice(0, 2).join(':');
        const entry = stats.get(group) ?? { n: 0, bytes: 0 };
        entry.n += 1;
        entry.bytes += bytes;
        stats.set(group, entry);
        total += bytes;
    });
} while (cursor !== '0');

console.log('\nby key prefix:');
[...stats.entries()]
    .sort((a, b) => b[1].bytes - a[1].bytes)
    .forEach(([group, s]) =>
        console.log(
            `${group.padEnd(28)} n=${String(s.n).padStart(6)}  ` +
                `${(s.bytes / 1024 / 1024).toFixed(2)} MB  avg ${Math.round(s.bytes / s.n)}B`
        )
    );
console.log(`\nTOTAL ${(total / 1024 / 1024).toFixed(2)} MB across ${
    [...stats.values()].reduce((n, s) => n + s.n, 0)
} keys`);

await redis.quit();
