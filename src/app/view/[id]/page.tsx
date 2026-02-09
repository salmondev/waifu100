import { Metadata } from "next";
import { ViewGrid } from "@/components/view/ViewGrid";
import { redirect } from "next/navigation";
import { redis } from '@/lib/redis';
import { GridCell } from "@/types";

import { AnalysisResult, VerdictFeedback } from "@/types";

interface ServerPageProps {
  params: Promise<{ id: string }>;
}

interface ShareData {
    grid: GridCell[];
    title: string;
    hasImage?: boolean;
    imageUrl?: string;
    verdict?: AnalysisResult | null; 
    verdictFeedback?: VerdictFeedback;
}

async function getShareData(id: string): Promise<ShareData | null> {
    try {
        // Read from Redis (ioredis)
        const rawString = await redis.get(`waifu100:share:${id}`);
        
        if (!rawString) return null;

        // Redis returns string, parse it
        const raw = JSON.parse(rawString);
        
        // Handle Migration/Structure
        let dataArray = [];
        let title = "Waifu100 Grid";
        let imageUrl = undefined;
        let hasImage = false;
        let verdict = null;
        let verdictFeedback: VerdictFeedback = null;

        if (Array.isArray(raw)) {
            dataArray = raw;
        } else if (raw.grid && Array.isArray(raw.grid)) {
            dataArray = raw.grid;
            if (raw.meta?.title) title = raw.meta.title;
            // Get Image URL directly from metadata
            if (raw.meta?.imageUrl) {
                imageUrl = raw.meta.imageUrl;
                hasImage = true;
            } else if (raw.meta?.hasImage) {
                 hasImage = true; 
            }
            
            // Extract verdict if available
            if (raw.verdict) verdict = raw.verdict;
            if (raw.verdictFeedback) verdictFeedback = raw.verdictFeedback;
        }

        // Reconstruct Grid
        const newGrid: GridCell[] = Array(100).fill(null).map(() => ({ character: null }));
        
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        dataArray.forEach((item: any) => {
            const index = item.i !== undefined ? item.i : -1;
            if (index >= 0 && index < 100 && item.character) {
                    newGrid[index] = { character: item.character };
            }
        });

        return { grid: newGrid, title, hasImage, imageUrl, verdict, verdictFeedback };
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
  
  // Use the Blob URL directly if available
  const images = imageUrl ? [imageUrl] : []; 

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
  />;
}
