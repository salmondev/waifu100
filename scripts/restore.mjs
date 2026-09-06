/**
 * Puts a backup back into Redis.
 *
 *   node scripts/restore.mjs backups/<timestamp>            # dry run
 *   node scripts/restore.mjs backups/<timestamp> --write    # actually write
 *   node scripts/restore.mjs backups/<timestamp> --write --only=share,feed,user
 *
 * Writes to whatever REDIS_URL points at, which on a real restore is usually a
 * brand new empty database - so it prints what is already there and refuses to
 * overwrite a key that exists unless told to, because the worst outcome here is
 * a half-remembered backup landing on top of live data.
 *
 * `--only` restores just the prefixes named, which is what you want after a
 * total loss: the grids and their indexes are the irreplaceable part, and the
 * caches are better rebuilt fresh than restored stale.
 */
import Redis from 'ioredis';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--'));
const write = args.includes('--write');
const force = args.includes('--force');
const only = args
    .find((a) => a.startsWith('--only='))
    ?.slice('--only='.length)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

if (!dir) {
    console.error('Usage: node scripts/restore.mjs backups/<timestamp> [--write] [--only=share,feed,user] [--force]');
    process.exit(1);
}

// Either a backup directory or a snapshot file straight off the download: the
// daily job writes the same shape to Blob, and needing to wrap it in a folder
// first is friction at exactly the wrong moment.
const file = dir.endsWith('.json') ? dir : path.join(dir, 'redis.json');
if (!fs.existsSync(file)) {
    console.error(`No backup at ${file}`);
    process.exit(1);
}

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

const { takenAt, entries } = JSON.parse(fs.readFileSync(file, 'utf8'));

/** `waifu100:share:abc` matches --only=share. */
const wanted = only
    ? entries.filter((e) => only.some((p) => e.key.split(':')[1] === p))
    : entries;

console.log(`backup taken ${takenAt}`);
console.log(`${entries.length} keys in file, ${wanted.length} selected`);

const redis = new Redis(url.trim().replace(/^["']|["']$/g, ''));

// What is already in the target, so a restore onto a live database is a
// deliberate act rather than a surprise.
const existing = new Set();
{
    const check = redis.pipeline();
    wanted.forEach((e) => check.exists(e.key));
    const results = await check.exec();
    wanted.forEach((e, i) => {
        if (results?.[i]?.[1] === 1) existing.add(e.key);
    });
}

console.log(`${existing.size} of them already exist in the target database`);

if (!write) {
    console.log('\nDry run. Nothing written. Add --write to restore.');
    if (existing.size > 0) {
        console.log('Existing keys would be skipped; add --force to overwrite them.');
    }
    await redis.quit();
    process.exit(0);
}

let written = 0;
let skipped = 0;

for (const entry of wanted) {
    if (existing.has(entry.key) && !force) {
        skipped++;
        continue;
    }

    const tx = redis.multi();
    // Replacing rather than merging: a zset or hash restored on top of a
    // different one would silently become the union of both.
    tx.del(entry.key);

    switch (entry.type) {
        case 'string':
            tx.set(entry.key, entry.value);
            break;
        case 'hash':
            if (Object.keys(entry.value).length > 0) tx.hset(entry.key, entry.value);
            break;
        case 'zset':
            // Stored flat as [member, score, ...]; ZADD wants score first.
            for (let i = 0; i < entry.value.length; i += 2) {
                tx.zadd(entry.key, entry.value[i + 1], entry.value[i]);
            }
            break;
        case 'set':
            if (entry.value.length > 0) tx.sadd(entry.key, ...entry.value);
            break;
        case 'list':
            if (entry.value.length > 0) tx.rpush(entry.key, ...entry.value);
            break;
        default:
            skipped++;
            continue;
    }

    if (entry.pttl) tx.pexpire(entry.key, entry.pttl);

    const results = await tx.exec();
    const error = results?.find(([err]) => err)?.[0];
    if (error) {
        console.warn(`  failed ${entry.key}: ${error.message}`);
        skipped++;
    } else {
        written++;
    }
}

console.log(`\nrestored ${written} keys, skipped ${skipped}`);
console.log('Uploaded images are not restored: blob URLs point at Vercel, and');
console.log('a full backup keeps copies in its assets/ folder if they need re-uploading.');

await redis.quit();
