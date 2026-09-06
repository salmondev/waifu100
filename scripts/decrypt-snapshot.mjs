/**
 * Turns a daily cloud snapshot back into a readable backup.
 *
 *   node scripts/decrypt-snapshot.mjs <url-or-file> [out.json]
 *
 * The daily job (src/app/api/cron/route.ts) encrypts before uploading, because
 * the Blob store has to be public to serve grid images and a snapshot carries
 * the per-browser owner ids - the only thing standing between a stranger and
 * someone else's delete button.
 *
 * The output is the same shape scripts/backup.mjs writes, so:
 *
 *   node scripts/decrypt-snapshot.mjs https://...blob.../backups/redis-2026-09-06.json.enc
 *   node scripts/restore.mjs redis-2026-09-06.json --write --only=share,feed,user
 *
 * The key comes from BACKUP_SECRET, falling back to ADMIN_TOKEN - whichever the
 * cron used. Keep a copy of it somewhere that is not this repository: a backup
 * you cannot decrypt is not a backup.
 */
import { createDecipheriv, scryptSync } from 'node:crypto';
import fs from 'node:fs';

/** Must match the writer in src/app/api/cron/route.ts. */
const MAGIC = 'W100BAK1';

const [source, outArg] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!source) {
    console.error('Usage: node scripts/decrypt-snapshot.mjs <url-or-file> [out.json]');
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

function fromEnv(name) {
    return (
        process.env[name] ||
        env.match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1]?.trim().replace(/^["']|["']$/g, '')
    );
}

/**
 * Every key this snapshot might have been written with, newest first.
 *
 * The cron falls back to ADMIN_TOKEN when BACKUP_SECRET is unset, so a store
 * can hold files encrypted under either - and the day BACKUP_SECRET is
 * introduced or rotated is exactly the day someone needs an older file back.
 * Trying each in turn costs nothing: GCM either authenticates or it does not.
 */
const candidates = [
    ['BACKUP_SECRET', fromEnv('BACKUP_SECRET')],
    ['ADMIN_TOKEN', fromEnv('ADMIN_TOKEN')],
    ['BACKUP_SECRET_PREVIOUS', fromEnv('BACKUP_SECRET_PREVIOUS')],
].filter(([, value]) => !!value);

if (candidates.length === 0) {
    console.error('No BACKUP_SECRET or ADMIN_TOKEN to decrypt with.');
    process.exit(1);
}

const raw = /^https?:\/\//.test(source)
    ? Buffer.from(await (await fetch(source)).arrayBuffer())
    : fs.readFileSync(source);

if (raw.subarray(0, 8).toString('ascii') !== MAGIC) {
    console.error('Not a Waifu100 snapshot (bad header).');
    process.exit(1);
}

const salt = raw.subarray(8, 24);
const iv = raw.subarray(24, 36);
const tag = raw.subarray(36, 52);
const body = raw.subarray(52);

let json;
let usedKey;

for (const [name, secret] of candidates) {
    try {
        const decipher = createDecipheriv('aes-256-gcm', scryptSync(secret, salt, 32), iv);
        decipher.setAuthTag(tag);
        json = Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
        usedKey = name;
        break;
    } catch {
        // GCM fails closed: a wrong key and a tampered file look the same here,
        // and both mean the same thing - do not trust what came out. Try the
        // next key rather than guessing which it was.
    }
}

if (json === undefined) {
    console.error(
        `Could not decrypt with ${candidates.map(([n]) => n).join(' or ')}. ` +
            'Wrong key, or the file has been altered.'
    );
    process.exit(1);
}

const parsed = JSON.parse(json);
const grids = parsed.entries.filter((e) => e.key.startsWith('waifu100:share:')).length;

const out = outArg ?? `redis-${(parsed.takenAt ?? '').slice(0, 10) || 'snapshot'}.json`;
fs.writeFileSync(out, json);

console.log(`key     ${usedKey}`);
console.log(`taken   ${parsed.takenAt}`);
console.log(`keys    ${parsed.entries.length} (${grids} grids)`);
console.log(`written ${out}`);
console.log(`\nRestore with:  node scripts/restore.mjs ${out} --write --only=share,feed,user`);
