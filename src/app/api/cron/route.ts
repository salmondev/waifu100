import { NextRequest, NextResponse } from "next/server";
import { createCipheriv, randomBytes, scryptSync } from "crypto";
import { del, list, put } from "@vercel/blob";
import { withRedis } from "@/lib/redis";
import { isAdminRequest } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The daily job that keeps the grids from disappearing.
 *
 * They have disappeared once already. The database is a free Redis Cloud plan,
 * and free plans are deleted after a long enough stretch of no activity - so a
 * quiet month is not a saving, it is a countdown. This does two things about
 * that, and they guard against different disasters:
 *
 *   1. A write, every day. Not a read: the point is to be unmistakably active.
 *      This is what stops the database being reclaimed in the first place.
 *
 *   2. A snapshot into Blob storage. If the database goes anyway - reclaimed,
 *      wiped, a bad migration - the grids are still somewhere, and somewhere
 *      that is not the machine of whoever happened to run a script last.
 *
 * Only the keys that cannot be recreated are snapshotted. Profile, series and
 * summary caches are all rebuildable from their sources and would multiply the
 * size of a daily file for nothing; restoring a six-month-old cache would be
 * worse than starting empty anyway.
 *
 * Snapshots are the same shape scripts/backup.mjs writes, so scripts/restore.mjs
 * reads one straight off the download without conversion.
 */

/** Prefixes the app cannot rebuild: the grids and the indexes that find them. */
const IRREPLACEABLE = ["waifu100:share:", "waifu100:feed", "waifu100:user:", "waifu100:summaries"];

/** How many daily snapshots to keep. Enough to notice a bad one and go back. */
const KEEP = 14;

const SNAPSHOT_PREFIX = "backups/redis-";

interface DumpEntry {
    key: string;
    type: string;
    pttl: number | null;
    value: unknown;
}

function isIrreplaceable(key: string): boolean {
    return IRREPLACEABLE.some((prefix) => key.startsWith(prefix));
}

/**
 * AES-256-GCM, key stretched from the secret with a per-file salt.
 *
 * Layout: magic(8) salt(16) iv(12) tag(16) ciphertext. scripts/decrypt-snapshot.mjs
 * reads exactly this and nothing else needs to - keep the two in step.
 */
const MAGIC = "W100BAK1";

function encrypt(plaintext: string, secret: string): Buffer {
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const key = scryptSync(secret, salt, 32);

    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);

    return Buffer.concat([Buffer.from(MAGIC, "ascii"), salt, iv, cipher.getAuthTag(), body]);
}

/**
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Without the secret
 * set, the route would be an open invitation to make someone else's Blob bill,
 * so it refuses rather than running unauthenticated.
 */
function authorized(req: NextRequest): boolean {
    if (isAdminRequest(req)) return true;

    const secret = process.env.CRON_SECRET;
    if (!secret) return false;
    return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
    if (!authorized(req)) {
        return NextResponse.json({ error: "Not authorized." }, { status: 401 });
    }

    const startedAt = new Date().toISOString();

    try {
        // 1. Activity. A write, and one that also records when this last ran -
        //    so a database that did get reclaimed can at least be dated.
        await withRedis((redis) => redis.set("waifu100:heartbeat", startedAt));

        // 2. Snapshot.
        const entries: DumpEntry[] = [];
        let scanned = 0;
        let cursor = "0";

        do {
            const [next, keys] = await withRedis((redis) => redis.scan(cursor, "COUNT", 500));
            cursor = next;
            scanned += keys.length;

            const wanted = keys.filter(isIrreplaceable);
            if (wanted.length === 0) continue;

            for (const key of wanted) {
                const [type, pttl] = await withRedis(async (redis) => {
                    const results = await redis.pipeline().type(key).pttl(key).exec();
                    return [
                        results?.[0]?.[1] as string,
                        results?.[1]?.[1] as number,
                    ] as const;
                });

                let value: unknown;
                switch (type) {
                    case "string":
                        value = await withRedis((redis) => redis.get(key));
                        break;
                    case "hash":
                        value = await withRedis((redis) => redis.hgetall(key));
                        break;
                    case "zset":
                        // Flat [member, score, ...], which is what a restore wants.
                        value = await withRedis((redis) => redis.zrange(key, 0, -1, "WITHSCORES"));
                        break;
                    case "set":
                        value = await withRedis((redis) => redis.smembers(key));
                        break;
                    case "list":
                        value = await withRedis((redis) => redis.lrange(key, 0, -1));
                        break;
                    default:
                        continue;
                }

                entries.push({ key, type, pttl: pttl > 0 ? pttl : null, value });
            }
        } while (cursor !== "0");

        const grids = entries.filter((e) => e.key.startsWith("waifu100:share:")).length;

        // A snapshot with no grids in it is not a snapshot, it is the disaster
        // being written over the evidence. Refuse rather than store it.
        if (grids === 0) {
            console.error("[cron] refusing to store a snapshot containing no grids");
            return NextResponse.json(
                { ok: false, error: "No grids found - snapshot not stored.", scanned },
                { status: 500 }
            );
        }

        const secret = process.env.BACKUP_SECRET || process.env.ADMIN_TOKEN;
        if (!secret) {
            // The heartbeat above is the part that stops the database being
            // reclaimed, and it has already run. Refusing here costs today's
            // snapshot; uploading in the clear would cost every grid on the
            // site, so this is not a close call.
            console.error("[cron] no BACKUP_SECRET or ADMIN_TOKEN; snapshot skipped");
            return NextResponse.json(
                {
                    ok: true,
                    heartbeat: startedAt,
                    grids,
                    snapshot: null,
                    warning: "Set BACKUP_SECRET to enable encrypted snapshots.",
                },
                { status: 200 }
            );
        }

        const body = JSON.stringify({ takenAt: startedAt, entries });
        const name = `${SNAPSHOT_PREFIX}${startedAt.slice(0, 10)}.json.enc`;

        const blob = await put(name, encrypt(body, secret), {
            /**
             * The store has to be public - it serves the grid images - so the
             * snapshot is encrypted rather than merely unlisted. It has to be:
             * the grids are public already, but a dump also carries the
             * per-browser owner ids, and that id is the entire authorisation
             * for deleting a grid. In the clear, a guessed URL would be a
             * delete button for every grid on the site.
             *
             * Read it back with scripts/decrypt-snapshot.mjs.
             */
            access: "public",
            contentType: "application/octet-stream",
            // One file per day: a second run on the same day replaces it rather
            // than piling up a random suffix nobody can find later.
            addRandomSuffix: false,
            allowOverwrite: true,
        });

        // 3. Retention.
        let removed = 0;
        try {
            const { blobs } = await list({ prefix: SNAPSHOT_PREFIX });
            const stale = blobs
                .sort((a, b) => b.pathname.localeCompare(a.pathname))
                .slice(KEEP);
            if (stale.length > 0) {
                await del(stale.map((b) => b.url));
                removed = stale.length;
            }
        } catch (e) {
            // A snapshot that was stored but not tidied is a good outcome, so
            // this must never turn the run into a failure.
            console.error("[cron] snapshot cleanup failed:", e);
        }

        console.log(`[cron] heartbeat + snapshot: ${grids} grids, ${entries.length} keys`);

        return NextResponse.json({
            ok: true,
            takenAt: startedAt,
            grids,
            keys: entries.length,
            scanned,
            bytes: body.length,
            snapshot: blob.url,
            removedOldSnapshots: removed,
        });
    } catch (e) {
        console.error("[cron] failed:", e);
        return NextResponse.json(
            { ok: false, error: e instanceof Error ? e.message : String(e) },
            { status: 500 }
        );
    }
}
