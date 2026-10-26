import type { Metadata } from "next";
import { StoryBuilder } from "@/components/story/StoryBuilder";

export const metadata: Metadata = {
    title: "Your Favourite Anime & Manga | Story100",
    description: "Build a 3×3, Top 10, Top 50 or Top 100 grid of your favourite anime and manga, and share it with the community.",
};

export default function StoryPage() {
    return <StoryBuilder />;
}
