/**
 * Rewrites the AI verdict stored on every share under the current Thai voice.
 *
 *   node scripts/migrate-verdicts.mjs                 # dry run: what would change
 *   node scripts/migrate-verdicts.mjs --apply         # regenerate + write back
 *   node scripts/migrate-verdicts.mjs --apply --force # including already-current ones
 *   node scripts/migrate-verdicts.mjs --apply --id ab12,cd34
 *   node scripts/migrate-verdicts.mjs --apply --compare   # also drop the compare cache
 *
 * A verdict is written once, into the share itself, and never looked at again -
 * so the tone fixes in src/lib/verdict-tone.ts only ever reached grids shared
 * after them. The grids from before still speak the old theatrical Thai, and
 * nothing in the app will ever replace them: the view page only generates when
 * a verdict is missing, and PATCH /api/share/verdict refuses to overwrite one
 * without the admin token.
 *
 * This is the deliberate way to do it. It reuses buildGridVerdictPrompt() from
 * the app so the text cannot drift from what the route sends, stamps each
 * result with GRID_VERDICT_STYLE_VERSION so a re-run skips what it already did,
 * and writes the old verdicts to a JSON file first - a regenerated verdict is
 * not reproducible, so the previous one has to survive somewhere.
 *
 * Costs one Gemini call per share. Safe to re-run; safe to interrupt.
 */
import Redis from 'ioredis';
import fs from 'node:fs';
import path from 'node:path';
import { GoogleGenerativeAI } from '@google/generative-ai';
import {
    buildGridVerdictPrompt,
    parseVerdictJson,
    GRID_VERDICT_STYLE_VERSION,
} from '../src/lib/verdict-tone.ts';

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const value = (flag) => {
    const i = args.indexOf(flag);
    return i === -1 ? null : args[i + 1];
};

const apply = has('--apply');
const force = has('--force');
const clearCompare = has('--compare');
const limit = Number(value('--limit') || 0) || Infinity;
const only = (value('--id') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
// Gemini counts requests per minute; one call a second is well under any tier
// and this only ever runs over a couple of dozen grids.
const delayMs = Number(value('--delay') || 1000);

let env = '';
for (const f of ['.env.local', '.env']) {
    try {
        env += fs.readFileSync(f, 'utf8') + '\n';
    } catch {
        // not every checkout has both
    }
}
const fromEnvFile = (name) =>
    env
        .match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1]
        ?.trim()
        .replace(/^["']|["']$/g, '');

const redisUrl = process.env.REDIS_URL || fromEnvFile('REDIS_URL');
const geminiKey = process.env.GEMINI_API_KEY || fromEnvFile('GEMINI_API_KEY');

if (!redisUrl) {
    console.error('No REDIS_URL - put it in .env.local or pass it in the environment');
    process.exit(1);
}
if (!geminiKey && apply) {
    console.error('No GEMINI_API_KEY - needed to write new verdicts');
    process.exit(1);
}

const redis = new Redis(redisUrl);
const model = geminiKey
    ? new GoogleGenerativeAI(geminiKey).getGenerativeModel({
          model: 'gemini-2.5-flash',
          // Same config the app uses: no "thinking" phase for a generation task.
          generationConfig: { thinkingConfig: { thinkingBudget: 0 } },
      })
    : null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Share keys, via SCAN so a big keyspace is never pulled in one command. */
async function shareKeys() {
    const keys = [];
    let cursor = '0';
    do {
        const [next, batch] = await redis.scan(cursor, 'MATCH', 'waifu100:share:*', 'COUNT', 500);
        cursor = next;
        keys.push(...batch);
    } while (cursor !== '0');
    return keys.sort();
}

/**
 * The names the verdict is about.
 *
 * Cells carry their own index and the payload has two historical shapes (a bare
 * array from the earliest shares, `{meta, grid}` since), so this mirrors
 * parseShare() in src/lib/share-store.ts rather than reading positionally.
 */
function characterNames(parsed) {
    const cells = Array.isArray(parsed) ? parsed : parsed.grid || [];
    return cells
        .map((cell) => cell?.character?.name)
        .filter((name) => typeof name === 'string' && name.trim().length > 0);
}

function isCurrent(verdict) {
    return verdict?.styleVersion === GRID_VERDICT_STYLE_VERSION;
}

/** One line of Thai, enough to see which voice a verdict is written in. */
function preview(verdict) {
    const title = verdict?.th?.title || '(no th title)';
    const content = (verdict?.th?.content || '').replace(/\s+/g, ' ').slice(0, 90);
    return `${title} :: ${content}`;
}

const keys = await shareKeys();
const targets = [];

for (const key of keys) {
    const id = key.replace('waifu100:share:', '');
    if (only.length && !only.includes(id)) continue;

    const raw = await redis.get(key);
    if (!raw) continue;

    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        console.warn(`! ${id}: unreadable JSON, skipped`);
        continue;
    }

    // The earliest shares are a bare array with nowhere to put a verdict, and a
    // grid with no verdict is left to the view page - this script only replaces.
    if (Array.isArray(parsed) || !parsed.verdict) continue;

    const names = characterNames(parsed);
    if (names.length === 0) {
        console.warn(`! ${id}: no characters, skipped`);
        continue;
    }

    if (isCurrent(parsed.verdict) && !force) continue;

    targets.push({ id, key, parsed, names });
    if (targets.length >= limit) break;
}

console.log(
    `\n${keys.length} share(s) scanned, ${targets.length} verdict(s) to rewrite ` +
        `(style v${GRID_VERDICT_STYLE_VERSION})\n`
);

if (targets.length === 0) {
    await redis.quit();
    process.exit(0);
}

if (!apply) {
    for (const { id, parsed, names } of targets) {
        console.log(`- ${id} (${names.length} chars) ${parsed.meta?.title || ''}`);
        console.log(`    now: ${preview(parsed.verdict)}`);
    }
    console.log('\nDry run. Re-run with --apply to regenerate these.\n');
    await redis.quit();
    process.exit(0);
}

// Written before the first overwrite: a verdict cannot be regenerated
// identically, so this file is the only way back.
const backupPath = path.join(
    'backups',
    `verdicts-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
);
fs.mkdirSync('backups', { recursive: true });
fs.writeFileSync(
    backupPath,
    JSON.stringify(
        targets.map(({ id, parsed }) => ({ id, verdict: parsed.verdict })),
        null,
        2
    )
);
console.log(`Old verdicts saved to ${backupPath}\n`);

let done = 0;
let failed = 0;

for (const { id, key, names } of targets) {
    try {
        const result = await model.generateContent(buildGridVerdictPrompt(names));
        const text = (await result.response).text();
        const verdict = parseVerdictJson(text);

        if (!verdict?.en?.title || !verdict?.th?.title) {
            console.error(`x ${id}: model returned an unusable verdict, left alone`);
            failed++;
            continue;
        }

        // Re-read rather than reusing the copy from the scan: it may be minutes
        // old by now, and the share carries fields this script must not clobber
        // (title, image, feed state).
        const fresh = await redis.get(key);
        if (!fresh) {
            console.error(`x ${id}: share disappeared, skipped`);
            failed++;
            continue;
        }
        const data = JSON.parse(fresh);
        data.verdict = { ...verdict, styleVersion: GRID_VERDICT_STYLE_VERSION };
        // A rewritten verdict is a new opinion, so an old thumbs-up no longer
        // refers to anything that exists.
        if (data.verdictFeedback) data.verdictFeedback = null;
        await redis.set(key, JSON.stringify(data));

        done++;
        console.log(`+ ${id}: ${preview(data.verdict)}`);
    } catch (e) {
        failed++;
        console.error(`x ${id}: ${e instanceof Error ? e.message : String(e)}`);
    }

    await sleep(delayMs);
}

if (clearCompare) {
    // Pair verdicts are derived from the same two grids and were written under
    // the same old rules. Deleting them costs nothing: the compare page
    // regenerates on sight.
    const pairKeys = [];
    let cursor = '0';
    do {
        const [next, batch] = await redis.scan(cursor, 'MATCH', 'waifu100:compare:*', 'COUNT', 500);
        cursor = next;
        pairKeys.push(...batch);
    } while (cursor !== '0');

    if (pairKeys.length) await redis.del(...pairKeys);
    console.log(`\nCleared ${pairKeys.length} cached compare verdict(s).`);
}

console.log(`\nDone: ${done} rewritten, ${failed} failed. Backup: ${backupPath}\n`);
await redis.quit();
