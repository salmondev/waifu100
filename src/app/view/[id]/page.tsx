import { Metadata } from "next";
import { ViewGrid } from "@/components/view/ViewGrid";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { readShare } from '@/lib/share-store';
import { shareCardPath } from '@/lib/share-card';

interface ServerPageProps {
  params: Promise<{ id: string }>;
}

/**
 * Reading a share is the same job on this page, the compare page and the card
 * routes, so the parsing (two historical payload shapes, cells carrying their
 * own index) lives in one place - see src/lib/share-store.ts.
 */
async function getShareData(id: string) {
    try {
        return await readShare(id);
    } catch (e) {
        console.error("Read Share Error:", e);
        return null;
    }
}

export async function generateMetadata({ params }: ServerPageProps): Promise<Metadata> {
  const { id } = await params;
  const data = await getShareData(id);

  if (!data) {
      return {
          title: "Waifu100 - Not Found",
          description: "This grid doesn't exist."
      };
  }

  const { grid, title, imageUrl } = data;
  const count = grid.filter(c => c.character).length;

  // Prefer the captured thumbnail, but never ship an embed with no image at
  // all: shares whose upload failed (or that predate it) fall back to a card
  // rendered server-side from the grid data itself.
  const h = await headers();
  const host = h.get("host") || "waifu100.vercel.app";
  const origin = `${host.startsWith("localhost") ? "http" : "https"}://${host}`;
  const images = [imageUrl || `${origin}${shareCardPath(id)}`];

  return {
      title: `${title} | Waifu100`,
      description: `Check out "${title}" featuring ${count} characters! Create your own at waifu100.`,
      openGraph: {
          title: `${title}`,
          description: `My 100 favorite characters!`,
          images: images
      },
      twitter: {
          card: "summary_large_image",
          title: `${title}`,
          description: `My 100 favorite characters!`,
          // Note: Twitter inherits image from OpenGraph, don't specify here to avoid duplication
      }
  };
}

export default async function ViewSharePage({ params }: ServerPageProps) {
  const { id } = await params;
  const data = await getShareData(id);

  if (!data) {
     redirect("/");
  }

  return <ViewGrid 
    grid={data.grid} 
    title={data.title} 
    verdict={data.verdict || null}
    verdictFeedback={data.verdictFeedback || null}
    shareId={id}
  />;
}
