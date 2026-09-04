import { Metadata } from 'next';
import MyGridsFeed from './MyGridsFeed';

export const metadata: Metadata = {
  title: 'My Grids | Waifu100',
  description: 'Grids you shared from this browser.',
  // Nothing here is public and it is different for every visitor.
  robots: { index: false, follow: false },
};

export default function MyGridsPage() {
  return <MyGridsFeed />;
}
