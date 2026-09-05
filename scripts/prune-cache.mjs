/**
 * Deletes the character/series cache entries written by the old name-only
 * matcher.
 *
 *   node scripts/prune-cache.mjs            # count them, delete nothing
 *   node scripts/prune-cache.mjs --delete   # actually delete
 *
 * Those entries are keyed by character name alone, so a single wrong lookup
 * ("which Rin?") became the answer served to every grid containing that name -
 * for 180 days for a profile, a year for a series or a Thai translation. The
 * new code writes under different keys, which means the old ones are now both
 * wrong and unreachable: pure waste on a 30 MB instance.
 *
 * Safe to re-run. It only ever touches the prefixes listed below, and never the
 * shares themselves.
 */
import Redis from 'ioredis';
import fs from 'node:fs';

/** Old key shapes. Anything matching these is from a superseded cache version. */
const STALE = [
    // Profiles keyed by name: waifu100:profile:<name>
    (key) => key.startsWith('waifu100:profile:') && !key.startsWith('waifu100:profile:v'),
    // Thai translations keyed by name, every prompt version.
    (key) => key.startsWith('waifu100:profile-th:'),
    // Series keyed by name, before the v2 prefix.
    (key) => key.startsWith('waifu100:series:') && !key.startsWith('waifu100:series:v2:'),
    // The short-lived two-key scheme: a pointer plus a separate profile. Folded
    // into one entry per question so a warm card is a single read.
    (key) => key.startsWith('waifu100:cmatch:v2:'),
    (key) => key.startsWith('waifu100:char:v2:'),
    // Translations written while the Thai key still carried the question-cache
    // version. They are keyed by AniList id now, so these copies are orphans.
    (key) => /^waifu100:char-th:v\d+:/.test(key),
];

const doDelete = process.argv.includes('--delete');

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

let scanned = 0;
let matched = 0;
let bytes = 0;
let deleted = 0;
let cursor = '0';

do {
    const [next, keys] = await redis.scan(cursor, 'COUNT', 500);
    cursor = next;
    scanned += keys.length;

    const stale = keys.filter((key) => STALE.some((test) => test(key)));
    if (stale.length === 0) continue;

    // Size first, so the dry run can report what deleting would actually free.
    const sizes = redis.pipeline();
    stale.forEach((key) => sizes.memory('USAGE', key));
    const results = await sizes.exec();
    results?.forEach(([, size]) => {
        bytes += Number(size ?? 0);
    });

    matched += stale.length;

    if (doDelete) {
        deleted += await redis.del(...stale);
    }
} while (cursor !== '0');

console.log(`scanned ${scanned} keys`);
console.log(`stale   ${matched} keys, ${(bytes / 1024 / 1024).toFixed(2)} MB`);
console.log(
    doDelete
        ? `deleted ${deleted} keys`
        : 'deleted 0 keys (dry run - re-run with --delete to remove them)'
);

await redis.quit();
