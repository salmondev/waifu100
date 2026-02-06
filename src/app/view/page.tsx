import { Metadata } from "next";
import { decodeGrid } from "@/lib/share";
import { ViewGrid } from "@/components/view/ViewGrid";
import { redirect } from "next/navigation";

interface PageProps {
  searchParams: Promise<{ g?: string }>;
}

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const params = await searchParams;
  const hash = params.g;
  
  if (!hash) {
      return {
          title: "Waifu100 - View Grid",
          description: "Check out this 100 Favorite Characters Grid!"
      };
  }

  const grid = decodeGrid(hash);
  // Get first 3 names for dynamic title
  const names = grid
     .filter(c => c.character)
     .slice(0, 3)
     .map(c => c.character?.name)
     .join(", ");

  const count = grid.filter(c => c.character).length;

  return {
      title: names ? `${names} and more! (${count}/100) | Waifu100` : "Waifu100 - View Grid",
      description: `Check out this 100 Favorite Characters Grid featuring ${names}... Create your own at waifu100!`,
      openGraph: {
          title: names ? `My 100 Favorites: ${names}...` : "My 100 Favorite Characters",
          description: `Check out my full 10x10 grid with ${count} characters!`,
          // types: 'website', // Removed: types property doesn't exist in OpenGraph type
      },
      twitter: {
          card: "summary_large_image",
          title: names ? `My 100 Favorites: ${names}...` : "My 100 Grid",
          description: `Check out my full 10x10 grid with ${count} characters!`,
      }
  };
}

export default async function ViewPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const hash = params.g;

  if (!hash) {
     redirect("/");
  }

  const grid = decodeGrid(hash);

  return <ViewGrid grid={grid} />;
}
