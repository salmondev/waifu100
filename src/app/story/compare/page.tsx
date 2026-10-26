import type { Metadata } from "next";
import { cache } from "react";
import Link from "next/link";
import { readShare, readShares, type StoredShare } from "@/lib/share-store";
import { compareStoryGrids } from "@/lib/story/compare";
import { STORY_BRAND } from "@/lib/story/config";
import type { ShareSummary } from "@/lib/share-summary";
import { StoryCompareView, type StoryCompareSide } from "@/components/story/StoryCompareView";
import { StoryComparePicker } from "@/components/story/StoryComparePicker";
import { SHOWCASE_LINK_CLASS } from "@/components/community/showcase-link";
import { CMP } from "@/components/story/compare-styles";
import { cn } from "@/lib/utils";

interface Props {
    searchParams: Promise<{ a?: string; b?: string }>;
}

type Loaded = { kind: "ok"; A: StoredShare; B: StoredShare } | { kind: "missing" } | { kind: "wrong-kind" } | { kind: "error" };

/**
 * Story-vs-story compare (item 5), shaped like waifu's /compare: picker when a side is
 * missing or both are the same, "gone" / "not a story grid" / "unavailable" states,
 * then the comparison. Same kind only. Memoised so metadata + page read Redis once.
 */
const load = cache(async function load(a: string, b: string): Promise<Loaded> {
    try {
        const [A, B] = await readShares([a, b]);
        if (!A || !B) return { kind: "missing" };
        if (A.kind !== "story" || B.kind !== "story") return { kind: "wrong-kind" };
        return { kind: "ok", A, B };
    } catch (e) {
        console.error("Story compare read error:", e);
        return { kind: "error" };
    }
});

const firstCover = (s: StoredShare) => s.imageUrl || s.items.find(Boolean)?.cover || null;

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
    const { a = "", b = "" } = await searchParams;
    if (!a || !b || a === b) return { title: `Compare story grids | ${STORY_BRAND}` };
    const d = await load(a, b);
    if (d.kind !== "ok") return { title: `Compare story grids | ${STORY_BRAND}` };
    const r = compareStoryGrids(d.A.items, d.B.items);
    const title = `${d.A.title} × ${d.B.title}`;
    const description = `${r.similarity}% match - ${r.shared.length} titles in common. Compare your own grid at ${STORY_BRAND}.`;
    return { title: `${title} | ${STORY_BRAND}`, description, openGraph: { title, description }, twitter: { card: "summary", title, description } };
}

function StoryCompareEmpty({ heading, body }: { heading: string; body: string }) {
    return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-zinc-950 px-6 text-center text-white" data-testid="story-compare-empty">
            <h1 className="text-2xl font-bold">{heading}</h1>
            <p className="max-w-md text-sm text-zinc-400">{body}</p>
            <div className="mt-4 flex gap-2">
                <Link href="/community?kind=story" className={cn("rounded-lg px-4 py-2 text-sm", SHOWCASE_LINK_CLASS)}>
                    Browse the showcase
                </Link>
                <Link href="/story" className={CMP.emptyHome}>
                    Build a grid
                </Link>
            </div>
        </div>
    );
}

/** A side named in the URL, for the picker. Never throws; non-story grids are not offered. */
async function preset(id: string): Promise<ShareSummary | null> {
    if (!id) return null;
    const s = await readShare(id).catch((e) => {
        console.error("Story compare preset read error:", e);
        return null;
    });
    if (!s || s.kind !== "story") return null;
    return { id: s.id, title: s.title, imageUrl: firstCover(s), createdAt: s.createdAt ?? "", hasGif: false, count: s.items.filter(Boolean).length, kind: "story", size: s.size, ...(s.cols != null ? { cols: s.cols } : {}) };
}

const side = (id: string, s: StoredShare): StoryCompareSide => ({ id, title: s.title, imageUrl: firstCover(s), size: s.size, cols: s.cols, items: s.items });

export default async function StoryComparePage({ searchParams }: Props) {
    const { a = "", b = "" } = await searchParams;
    if (!a || !b || a === b) {
        const [pa, pb] = await Promise.all([preset(a), preset(a === b ? "" : b)]);
        return <StoryComparePicker initialA={pa} initialB={pb} notice={a && a === b ? "That's the same grid twice - pick a second one." : null} />;
    }
    const d = await load(a, b);
    if (d.kind === "missing") return <StoryCompareEmpty heading="One of these grids is gone" body="A grid can be deleted by whoever made it, and a comparison link outlives it." />;
    if (d.kind === "wrong-kind") return <StoryCompareEmpty heading="These grids can't be compared" body="Story grids can only be compared with other story grids." />;
    if (d.kind === "error") return <StoryCompareEmpty heading="Compare is unavailable right now" body="We couldn't load these grids. Try again in a moment." />;
    // Each side keeps its own layout: StoryCompareView lays it out with storyColumns(s.size, s.cols).
    return <StoryCompareView a={side(a, d.A)} b={side(b, d.B)} result={compareStoryGrids(d.A.items, d.B.items)} />;
}
