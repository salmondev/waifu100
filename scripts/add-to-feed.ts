/**
 * Manual Feed Migration Script
 * 
 * Usage: 
 *   bun run scripts/add-to-feed.ts <shareId1> <shareId2> ...
 * 
 * Example:
 *   bun run scripts/add-to-feed.ts abc123 def456 ghi789
 * 
 * This will add the specified share IDs to the community feed
 * (story shares also to waifu100:feed:story).
 */

import { getRedis } from '../src/lib/redis';
import { feedKeysForShare } from '../src/lib/share-schema';

async function addToFeed(shareIds: string[]) {
    const redis = await getRedis();
    console.log(`\n🔄 Adding ${shareIds.length} share(s) to community feed...\n`);
    
    let added = 0;
    let skipped = 0;
    let notFound = 0;

    for (const id of shareIds) {
        try {
            // Check if share exists
            const data = await redis.get(`waifu100:share:${id}`);
            
            if (!data) {
                console.log(`❌ Not found: ${id}`);
                notFound++;
                continue;
            }

            const parsed = JSON.parse(data);
            const createdAt = parsed.meta?.createdAt 
                ? new Date(parsed.meta.createdAt).getTime() 
                : Date.now();
            
            // Every share goes in the main feed; story shares also in feed:story.
            const keys = feedKeysForShare(data);
            const missing: string[] = [];
            for (const key of keys) {
                if ((await redis.zscore(key, id)) === null) missing.push(key);
            }
            if (missing.length === 0) {
                console.log(`⏭️  Already in feed: ${id} (${parsed.meta?.title || 'Untitled'})`);
                skipped++;
                continue;
            }

            for (const key of missing) await redis.zadd(key, createdAt, id);
            console.log(`✅ Added: ${id} - "${parsed.meta?.title || 'Untitled'}" -> ${missing.join(', ')}`);
            added++;
            
        } catch (e) {
            console.error(`❌ Error processing ${id}:`, e);
        }
    }

    console.log(`\n📊 Summary:`);
    console.log(`   Added: ${added}`);
    console.log(`   Skipped (already in feed): ${skipped}`);
    console.log(`   Not found: ${notFound}`);
    console.log(`\n✨ Done!\n`);
    
    process.exit(0);
}

// Get share IDs from command line arguments
const args = process.argv.slice(2);

if (args.length === 0) {
    console.log(`
Usage: bun run scripts/add-to-feed.ts <shareId1> <shareId2> ...

Example:
  bun run scripts/add-to-feed.ts abc123 def456
  
To find existing share IDs, check your Redis or look at share URLs like:
  /view/abc123 → ID is "abc123"
`);
    process.exit(1);
}

addToFeed(args);
