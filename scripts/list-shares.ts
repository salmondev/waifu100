/**
 * List Existing Shares Script
 * 
 * Usage: 
 *   bun run scripts/list-shares.ts
 * 
 * Lists all existing shared grids in Redis with their IDs and titles.
 */

import { redis } from '../src/lib/redis';

async function listShares() {
    console.log(`\n🔍 Scanning for existing shares...\n`);
    
    // Get all share keys
    const keys = await redis.keys('waifu100:share:*');
    
    if (keys.length === 0) {
        console.log('No shares found in Redis.');
        process.exit(0);
    }

    console.log(`Found ${keys.length} share(s):\n`);
    console.log('─'.repeat(80));
    console.log(`${'ID'.padEnd(15)} | ${'Title'.padEnd(35)} | ${'In Feed?'.padEnd(10)} | Created`);
    console.log('─'.repeat(80));

    for (const key of keys) {
        try {
            const id = key.replace('waifu100:share:', '');
            const data = await redis.get(key);
            
            if (!data) continue;

            const parsed = JSON.parse(data);
            const title = parsed.meta?.title || 'Untitled';
            const createdAt = parsed.meta?.createdAt 
                ? new Date(parsed.meta.createdAt).toLocaleDateString()
                : 'Unknown';
            
            // Check if in feed
            const score = await redis.zscore('waifu100:feed', id);
            const inFeed = score !== null ? '✅ Yes' : '❌ No';

            console.log(`${id.padEnd(15)} | ${title.substring(0, 35).padEnd(35)} | ${inFeed.padEnd(10)} | ${createdAt}`);
            
        } catch (e) {
            console.error(`Error reading ${key}:`, e);
        }
    }

    console.log('─'.repeat(80));
    console.log(`\nTo add shares to the feed, run:`);
    console.log(`  bun run scripts/add-to-feed.ts <id1> <id2> ...\n`);
    
    process.exit(0);
}

listShares();
