import Redis from 'ioredis';

const getRedisClient = () => {
    if (!process.env.REDIS_URL) {
        throw new Error("REDIS_URL is not defined");
    }

    // In Next.js dev mode, prevent multiple connections
    const globalWithRedis = global as typeof globalThis & {
        _redis?: Redis;
    };

    if (!globalWithRedis._redis) {
        globalWithRedis._redis = new Redis(process.env.REDIS_URL, {
            // Options for robustness
            connectTimeout: 10000,
            maxRetriesPerRequest: 3,
        });
    }

    return globalWithRedis._redis;
};

// Export singleton
export const redis = getRedisClient();
