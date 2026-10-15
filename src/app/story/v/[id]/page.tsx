import type { Metadata } from "next";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Effect } from "effect";
import { StoryView } from "@/components/story/StoryView";
import { readDecoded } from "@/server/share-service";
import { AppLive } from "@/server/run";
import { shareCardPath } from "@/lib/share-card";
import { STORY_BRAND, storySizeLabel } from "@/lib/story/config";
import { readStoryVerdict } from "@/lib/story/verdict-store";

interface Props {
    params: Promise<{ id: string }>;
}

/** Memoised per request: metadata and page both need it. Null on any failure. */
const load = cache(async (id: string) =>
    Effect.runPromise(
        readDecoded(id).pipe(
            Effect.provide(AppLive),
            Effect.match({
                onFailure: (e) => {
                    if (e._tag !== "ShareNotFound") console.error("Story read error:", e);
                    return null;
                },
                onSuccess: (d) => d,
            })
        )
    )
);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
    const { id } = await params;
    const d = await load(id);
    if (!d || d.kind !== "story") return { title: `${STORY_BRAND} - Not Found`, description: "This grid doesn't exist." };

    const h = await headers();
    const host = h.get("host") || "waifu100.vercel.app";
    const origin = `${host.startsWith("localhost") ? "http" : "https"}://${host}`;
    const label = storySizeLabel(d.size, d.cols);
    const description = `${label} anime & manga picks: "${d.title}" (${d.count} titles). Make your own on ${STORY_BRAND}.`;
    const image = `${origin}${shareCardPath(id)}`;

    return {
        title: `${d.title} | ${STORY_BRAND}`,
        description,
        openGraph: { title: d.title, description, images: [image], siteName: STORY_BRAND },
        twitter: { card: "summary_large_image", title: d.title, description },
    };
}

export default async function StorySharePage({ params }: Props) {
    const { id } = await params;
    const d = await load(id);
    // Like waifu's /view/<id>: a missing share goes back to the builder rather than a 404 page.
    if (!d) redirect("/story");
    // A waifu id typed into the story path goes to its own page.
    if (d.kind !== "story") redirect(`/view/${id}`);
    // A stored verdict renders with the page (no request, no spinner), like waifu's verdict on the share.
    const stored = await readStoryVerdict(id);
    return <StoryView id={id} title={d.title} size={d.size} cols={d.cols} items={d.items} titleStyle={d.titleStyle} verdict={stored?.verdict ?? null} verdictFeedback={stored?.feedback ?? null} />;
}
