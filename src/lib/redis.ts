import Redis, { type RedisOptions } from 'ioredis';

/**
 * Serverless-safe ioredis wrapper.
 *
 * On Vercel a lambda gets frozen between invocations, so a cached TCP socket is
 * often already dead when the next request reuses it. ioredis then burns through
 * `maxRetriesPerRequest` and rejects with
 * "Reached the max retries per request limit (which is 3)".
 *
 * So: keep the singleton (connections are expensive), but health-check it before
 * every use and transparently rebuild + retry once when the socket turns out to
 * be stale. Always go through `withRedis()`.
 */

const globalWithRedis = global as typeof globalThis & {
    _redis?: Redis;
};

const CONNECTION_ERROR_RE =
    /max retries per request|Connection is closed|Stream isn't writeable|Command timed out|connection timeout|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_AGAIN|socket closed/i;

function isConnectionError(e: unknown): boolean {
    const msg = e instanceof Error ? e.message : String(e);
    return CONNECTION_ERROR_RE.test(msg);
}

function createClient(): Redis {
    const url = process.env.REDIS_URL;
    if (!url) {
        throw new Error('REDIS_URL is not defined');
    }

    const options: RedisOptions = {
        connectTimeout: 10_000,
        // Bound how long a single command can hang so we fail fast enough to
        // retry inside the request instead of hitting the function timeout.
        commandTimeout: 8_000,
        maxRetriesPerRequest: 2,
        // Don't start the handshake at module load (cold start / build time).
        lazyConnect: true,
        keepAlive: 10_000,
        enableReadyCheck: true,
        retryStrategy: (times) => (times > 5 ? null : Math.min(times * 200, 1_000)),
        // Retry the in-flight command after a reconnect (e.g. failover).
        reconnectOnError: () => true,
    };

    const client = new Redis(url, options);
    // Without an error listener ioredis emits an unhandled 'error' event.
    client.on('error', (err: Error) => {
        console.error('[redis] client error:', err.message);
    });
    return client;
}

function resetClient() {
    const stale = globalWithRedis._redis;
    globalWithRedis._redis = undefined;
    if (stale) {
        try {
            stale.disconnect();
        } catch {
            // already gone
        }
    }
}

/**
 * Returns a live client. Prefer `withRedis()` in request handlers - this is for
 * long-running scripts that want to hold the connection themselves.
 */
export async function getRedis(): Promise<Redis> {
    let client = globalWithRedis._redis;

    // 'end' / 'close' means the cached socket is unusable.
    if (client && (client.status === 'end' || client.status === 'close')) {
        resetClient();
        client = undefined;
    }

    if (!client) {
        client = createClient();
        globalWithRedis._redis = client;
    }

    // 'wait' = lazyConnect client that has never dialled out yet.
    if (client.status === 'wait') {
        try {
            await client.connect();
        } catch (e) {
            // A concurrent caller may already have started the handshake.
            const msg = e instanceof Error ? e.message : String(e);
            if (!/already connecting|already connected/i.test(msg)) {
                resetClient();
                throw e;
            }
        }
    }

    return client;
}

/**
 * Runs `fn` with a live Redis client. If the command fails because the cached
 * connection was stale, the client is rebuilt and the command retried once.
 */
export async function withRedis<T>(fn: (client: Redis) => Promise<T>): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt < 2; attempt++) {
        let client: Redis;
        try {
            client = await getRedis();
        } catch (e) {
            lastError = e;
            if (!isConnectionError(e)) throw e;
            continue;
        }

        try {
            return await fn(client);
        } catch (e) {
            lastError = e;
            if (!isConnectionError(e)) throw e;
            console.warn(
                `[redis] connection error on attempt ${attempt + 1}, rebuilding client:`,
                e instanceof Error ? e.message : String(e)
            );
            resetClient();
        }
    }

    throw lastError;
}
