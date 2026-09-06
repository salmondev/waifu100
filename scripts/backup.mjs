/**
 * A complete local copy of everything the app cannot recreate.
 *
 *   node scripts/backup.mjs              # Redis -> backups/<timestamp>/
 *   node scripts/backup.mjs --assets     # ...and download every uploaded image
 *
 * The grids live in Redis and nowhere else. Free Redis plans drop databases
 * that go quiet for long enough - which has already happened here once - so
 * this exists to make that survivable rather than final. scripts/restore.mjs
 * puts a backup back.
 *
 * Everything is dumped, caches included, because a dump is cheap and deciding
 * what mattered is much easier with the whole thing in front of you than
 * afterwards. TTLs are recorded so a restore does not turn a two-week cache
 * entry into a permanent one.
 *
 * `--assets` additionally downloads the images that are stored in Vercel Blob:
 * grid thumbnails and anything a user uploaded themselves. Those are the only
 * other files that are ours - every other cell picture is a link to somebody
 * else's server, which no backup here could preserve anyway.
 */
import Redis from 'ioredis';
import fs from 'node:fs';
import path from 'node:path';

const withAssets = process.argv.includes('--assets');

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

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const dir = path.join('backups', stamp);
fs.mkdirSync(dir, { recursive: true });

const redis = new Redis(url.trim().replace(/^["']|["']$/g, ''));

/* -------------------------------------------------------------------------- */
/* Dump                                                                        */
/* -------------------------------------------------------------------------- */

/** Every key, with enough type information to put it back exactly as it was. */
const entries = [];
const byType = {};
const byPrefix = {};
let cursor = '0';

do {
    const [next, keys] = await redis.scan(cursor, 'COUNT', 500);
    cursor = next;
    if (keys.length === 0) continue;

    // Types and TTLs for the whole page in two pipelines rather than 2N calls.
    const meta = redis.pipeline();
    keys.forEach((k) => meta.type(k).pttl(k));
    const metaResults = await meta.exec();

    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const type = metaResults[i * 2][1];
        const pttl = metaResults[i * 2 + 1][1];

        let value;
        switch (type) {
            case 'string':
                value = await redis.get(key);
                break;
            case 'hash':
                value = await redis.hgetall(key);
                break;
            case 'zset':
                // Flat [member, score, member, score, ...], which is what ZADD wants.
                value = await redis.zrange(key, 0, -1, 'WITHSCORES');
                break;
            case 'set':
                value = await redis.smembers(key);
                break;
            case 'list':
                value = await redis.lrange(key, 0, -1);
                break;
            default:
                console.warn(`skipping ${key}: unsupported type ${type}`);
                continue;
        }

        entries.push({ key, type, pttl: pttl > 0 ? pttl : null, value });
        byType[type] = (byType[type] ?? 0) + 1;
        const prefix = key.split(':').slice(0, 2).join(':');
        byPrefix[prefix] = (byPrefix[prefix] ?? 0) + 1;
    }
} while (cursor !== '0');

const redisFile = path.join(dir, 'redis.json');
fs.writeFileSync(redisFile, JSON.stringify({ takenAt: new Date().toISOString(), entries }, null, 1));

/* -------------------------------------------------------------------------- */
/* What is in it                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The grids, read back out of the dump. Counting them here rather than trusting
 * the key count is the point of a backup report: it says how many grids you
 * would actually get back.
 */
const shares = entries.filter((e) => e.key.startsWith('waifu100:share:'));
const blobUrls = new Set();
let cells = 0;
let uploaded = 0;

for (const share of shares) {
    let parsed;
    try {
        parsed = JSON.parse(share.value);
    } catch {
        continue;
    }
    const grid = Array.isArray(parsed) ? parsed : parsed.grid || [];
    if (parsed?.meta?.imageUrl?.includes('vercel-storage.com')) {
        blobUrls.add(parsed.meta.imageUrl);
    }
    for (const cell of grid) {
        if (!cell?.character) continue;
        cells++;
        const custom = cell.character.customImageUrl;
        if (custom?.includes('vercel-storage.com')) {
            blobUrls.add(custom);
            uploaded++;
        }
    }
}

console.log(`\nRedis  -> ${redisFile}`);
console.log(`         ${entries.length} keys, ${(fs.statSync(redisFile).size / 1024 / 1024).toFixed(2)} MB`);
console.log(`         types: ${Object.entries(byType).map(([t, n]) => `${t}=${n}`).join(' ')}`);
console.log('\nkeys by prefix:');
Object.entries(byPrefix)
    .sort((a, b) => b[1] - a[1])
    .forEach(([p, n]) => console.log(`  ${String(n).padStart(5)}  ${p}`));

console.log(`\ngrids: ${shares.length}, ${cells} filled cells`);
console.log(`blob-hosted images referenced: ${blobUrls.size} (${uploaded} of them user uploads)`);

/* -------------------------------------------------------------------------- */
/* Assets                                                                      */
/* -------------------------------------------------------------------------- */

if (!withAssets) {
    if (blobUrls.size > 0) {
        console.log('\nRe-run with --assets to download those too.');
    }
} else if (blobUrls.size === 0) {
    console.log('\nNothing in blob storage to download.');
} else {
    const assetDir = path.join(dir, 'assets');
    fs.mkdirSync(assetDir, { recursive: true });

    const index = [];
    let saved = 0;
    let failed = 0;

    for (const assetUrl of blobUrls) {
        // The blob pathname is unique already; flatten it into a filename so the
        // index can map a URL back to a file without nested directories.
        const name = new URL(assetUrl).pathname.replace(/^\/+/, '').replace(/[\\/]/g, '_');
        const file = path.join(assetDir, name);
        try {
            const res = await fetch(assetUrl, { signal: AbortSignal.timeout(30_000) });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
            index.push({ url: assetUrl, file: path.relative(dir, file) });
            saved++;
        } catch (e) {
            console.warn(`  failed ${assetUrl}: ${e.message}`);
            index.push({ url: assetUrl, file: null, error: String(e.message) });
            failed++;
        }
    }

    fs.writeFileSync(path.join(dir, 'assets.json'), JSON.stringify(index, null, 1));
    console.log(`\nAssets -> ${assetDir}`);
    console.log(`         ${saved} saved, ${failed} failed`);
}

console.log(`\nRestore with:  node scripts/restore.mjs ${dir}`);

await redis.quit();
