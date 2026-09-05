import { Metadata } from 'next';
import CommunityFeed from './CommunityFeed';
import { readFeedPage } from '@/lib/community-feed';
import { EMPTY_FEED_PAGE, FEED_PAGE_SIZE } from '@/lib/feed-page';

export const metadata: Metadata = {
  title: 'Community Showcase | Waifu100',
  description: 'Community grids showcase',
};

/**
 * Regenerated in the background once a minute, so a visitor gets the first page
 * of cards in the HTML instead of a spinner and a round trip. Newer grids show
 * up on the next regeneration - or immediately, for anyone who sorts, filters
 * or loads more, since those go to /api/community.
 */
export const revalidate = 60;

export default async function CommunityPage() {
  // A build or a regeneration that cannot reach Redis must still produce a
  // page; the feed falls back to fetching it in the browser.
  let initialPage = EMPTY_FEED_PAGE;
  let initialFailed = false;

  try {
    initialPage = await readFeedPage(0, FEED_PAGE_SIZE, 'new');
  } catch (e) {
    console.error('Community page prerender failed:', e);
    initialFailed = true;
  }

  return <CommunityFeed initialPage={initialPage} initialFailed={initialFailed} />;
}
