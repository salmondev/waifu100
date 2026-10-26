"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Check, GitCompareArrows, Grid3x3, Link2, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { proxied } from "@/lib/img-proxy";
import type { StoryItem } from "@/lib/share-schema";
import { MediaGrid } from "@/components/grid/MediaGrid";
import { FittedImage } from "@/components/media/FittedImage";
import { SHOWCASE_LINK_CLASS } from "@/components/community/showcase-link";
import { storyColumns, storyViewPath } from "@/lib/story/config";
import { storyComparePath, storyItemKey, type StoryCompareResult } from "@/lib/story/compare";
import { CMP } from "@/components/story/compare-styles";

export interface StoryCompareSide {
    id: string;
    title: string;
    imageUrl: string | null;
    size: number;
    /** Custom layout columns; null = preset layout of `size`. */
    cols: number | null;
    items: (StoryItem | null)[];
}

export interface StoryCompareViewProps {
    a: StoryCompareSide;
    b: StoryCompareSide;
    result: StoryCompareResult;
}

const COLLAPSED = 12;

/** Waifu's verdictLine, reworded for titles. */
export function storyVerdictLine(similarity: number, shared: number) {
    if (shared === 0) return "Nothing in common. Completely different shelves.";
    if (similarity >= 60) return "Suspiciously similar taste.";
    if (similarity >= 35) return "Clearly the same corner of the internet.";
    if (similarity >= 15) return "Enough overlap to argue about the rest.";
    return "Barely overlapping - plenty to recommend each other.";
}

function GridBadge({ side, count, align }: { side: StoryCompareSide; count: number; align: "left" | "right" }) {
    return (
        <Link href={storyViewPath(side.id)} className={cn(CMP.badge, align === "right" && "flex-row-reverse text-right")}>
            <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-zinc-800">
                {side.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={proxied(side.imageUrl, 128)} alt="" className="h-full w-full object-cover" />
                )}
            </div>
            <div className="min-w-0">
                <p className="truncate text-sm font-bold text-white group-hover:text-purple-300 sm:text-base">{side.title}</p>
                <p className="text-xs text-zinc-500">
                    {count}/{side.size} titles
                </p>
            </div>
        </Link>
    );
}

function Poster({ item, label }: { item: StoryItem; label: string }) {
    return (
        <div title={item.title} className="group flex flex-col gap-1.5 text-left">
            <div className="relative aspect-[2/3] overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
                {/* crop-story: the whole cover (contain + blurred backdrop), never cropped. */}
                <FittedImage src={item.cover} alt={item.title} width={256} loading="lazy" className="transition-transform duration-300 group-hover:scale-110" />
                <span className="absolute right-1 top-1 z-20 rounded bg-black/60 px-1 font-mono text-[9px] text-zinc-400">{label}</span>
            </div>
            <p className="w-full truncate text-center text-[11px] leading-tight text-zinc-400 transition-colors group-hover:text-purple-300">{item.title}</p>
        </div>
    );
}

function OnlyColumn({ heading, note, items, ranks }: { heading: string; note: string; items: StoryItem[]; ranks: Map<string, number> }) {
    const [expanded, setExpanded] = useState(false);
    const visible = expanded ? items : items.slice(0, COLLAPSED);
    const hidden = items.length - visible.length;
    return (
        <section>
            <h2 className="mb-1 truncate text-sm font-bold uppercase tracking-widest text-zinc-500">{heading}</h2>
            <p className="mb-3 text-xs text-zinc-600">{note}</p>
            {items.length === 0 ? (
                <p className="text-sm text-zinc-600">Nothing - every pick is shared.</p>
            ) : (
                <>
                    <div className={CMP.onlyGrid}>
                        {visible.map((it) => (
                            <Poster key={storyItemKey(it)} item={it} label={`#${ranks.get(storyItemKey(it)) ?? "?"}`} />
                        ))}
                    </div>
                    {hidden > 0 && (
                        <button type="button" onClick={() => setExpanded(true)} className={CMP.showMore}>
                            Show {hidden} more
                        </button>
                    )}
                </>
            )}
        </section>
    );
}

const rankMap = (items: (StoryItem | null)[]) => {
    const m = new Map<string, number>();
    items.forEach((it, i) => it && !m.has(storyItemKey(it)) && m.set(storyItemKey(it), i + 1));
    return m;
};
const toCell = (i: StoryItem) => ({ key: storyItemKey(i), image: i.cover, label: i.title });
const plural = (n: number) => `${n} title${n === 1 ? "" : "s"}`;

/** Story-vs-story compare, laid out like waifu's CompareView (no AI verdict, no series chart). */
export function StoryCompareView({ a, b, result }: StoryCompareViewProps) {
    const [copied, setCopied] = useState(false);
    const { similarity, shared, onlyA, onlyB } = result;
    const copy = () => {
        navigator.clipboard.writeText(`${window.location.origin}${storyComparePath(a.id, b.id)}`);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };
    return (
        <div className={CMP.page} data-testid="story-compare">
            <div className={CMP.container}>
                <div className={CMP.nav}>
                    <Link href="/community?kind=story" className={cn("flex items-center gap-2 rounded-lg px-3 py-2 text-sm", SHOWCASE_LINK_CLASS)}>
                        <ArrowLeft size={18} className="shrink-0" />
                        <span>Community Showcase</span>
                    </Link>
                    <Link href="/story" className={CMP.navButton}>
                        <Grid3x3 size={18} className="shrink-0" />
                        <span>Create Your Own</span>
                    </Link>
                    <Link href={`/story/compare?a=${encodeURIComponent(a.id)}`} className={CMP.navButton}>
                        <GitCompareArrows size={18} className="shrink-0" />
                        <span>Compare others</span>
                    </Link>
                    <button type="button" onClick={copy} className={cn(CMP.copyBase, copied ? CMP.copyDone : CMP.copyIdle)}>
                        {copied ? <Check size={18} /> : <Link2 size={18} />}
                        <span>{copied ? "Link Copied!" : "Copy Link"}</span>
                    </button>
                </div>

                <div className="flex items-stretch gap-2 sm:gap-3">
                    <GridBadge side={a} count={result.countA} align="left" />
                    <div className={CMP.times}>×</div>
                    <GridBadge side={b} count={result.countB} align="right" />
                </div>

                <div className="mt-8 flex flex-col items-center text-center">
                    <div className={CMP.number} style={{ textShadow: "0 0 60px rgba(168, 85, 247, 0.25)" }} data-testid="story-similarity">
                        {similarity}%
                    </div>
                    <p className="mt-2 flex items-center gap-2 text-sm text-zinc-300 sm:text-base">
                        <Users size={16} className="text-purple-400" />
                        {plural(shared.length)} in common
                    </p>
                    <p className="mt-1 text-xs text-zinc-500 sm:text-sm">{storyVerdictLine(similarity, shared.length)}</p>
                </div>

                {shared.length > 0 && (
                    <section className="mt-10">
                        <h2 className={CMP.sectionHeading}>Both of you</h2>
                        <div className={CMP.sharedGrid}>
                            {shared.map((s) => (
                                <Poster key={storyItemKey(s.item)} item={s.item} label={`#${s.rankA} · #${s.rankB}`} />
                            ))}
                        </div>
                    </section>
                )}

                <div className="mt-12 grid gap-8 lg:grid-cols-2">
                    <OnlyColumn heading={`Only in ${b.title}`} note={`${plural(onlyB.length)} missing from ${a.title}`} items={onlyB} ranks={rankMap(b.items)} />
                    <OnlyColumn heading={`Only in ${a.title}`} note={`${plural(onlyA.length)} missing from ${b.title}`} items={onlyA} ranks={rankMap(a.items)} />
                </div>

                <section className="mt-12">
                    <h2 className={CMP.sectionHeading}>Side by side</h2>
                    <div className="grid gap-6 md:grid-cols-2">
                        {[a, b].map((s) => (
                            <div key={s.id} className="space-y-2" data-testid={`story-compare-grid-${s.id}`} data-cols={storyColumns(s.size, s.cols)}>
                                <Link href={storyViewPath(s.id)} className="truncate text-sm font-semibold text-white hover:text-purple-300">
                                    {s.title}
                                </Link>
                                <div className="rounded-xl border-2 border-zinc-800 bg-black p-1.5">
                                    <MediaGrid items={s.items} columns={storyColumns(s.size, s.cols)} toCell={toCell} />
                                </div>
                            </div>
                        ))}
                    </div>
                </section>

                <div className="mb-16 mt-12 text-center text-sm text-zinc-500">
                    Want to compare against your own?{" "}
                    <Link href="/story" className="text-purple-400 hover:underline">
                        Build a grid
                    </Link>
                </div>
            </div>
        </div>
    );
}
