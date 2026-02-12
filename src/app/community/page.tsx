import { Metadata } from 'next';
import CommunityFeed from './CommunityFeed';

export const metadata: Metadata = {
  title: 'Community Showcase | Waifu100',
  description: 'Community grids showcase',
};

export default function CommunityPage() {
  return <CommunityFeed />;
}
