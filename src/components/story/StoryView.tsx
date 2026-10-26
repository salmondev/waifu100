"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Check, Grid3x3, Link2 } from "lucide-react";
import { StoryCellGrid } from "@/components/story/StoryCellCard";
import { DEFAULT_TITLE_STYLE, STORY_BRAND, storyColumns, storyViewPath, type TitleStyle } from "@/lib/story/config";
import type { StoryItem } from "@/lib/share-schema";
import { cn } from "@/lib/utils";
import { SHOWCASE_LINK_CLASS } from "@/components/community/showcase-link";
import { StoryPngButton, StoryViewVerdict } from "@/components/story/StoryExtras";
import { StoryCompareWithMine } from "@/components/story/StoryCompareWithMine";
import { EditOwnLink } from "@/components/own/EditOwnLink";
import { TogetherViewInvite } from "@/components/together/TogetherViewInvite";
import { TogetherBadge } from "@/components/community/TogetherBadge";
import type { AnalysisResult, VerdictFeedback } from "@/types";

const toCell = (i: StoryItem) => ({ key: `${i.src ?? "anilist"}-${i.type}-${i.id}`, image: i.cover, label: i.title || "Untitled" });

/** Class strings copied from waifu's view page (components/view/ViewGrid.tsx), so both view pages look alike. */
const W = {
    page: "min-h-screen bg-zinc-950 text-white flex flex-col items-center py-6 sm:py-10 relative",
    header: "w-full max-w-[1000px] flex flex-col items-stretch gap-4 lg:grid lg:grid-cols-3 lg:items-center lg:gap-0 px-3 sm:px-4 mb-6 sm:mb-8",
    leftCol: "order-2 lg:order-none flex flex-row flex-wrap lg:flex-col items-center lg:items-start justify-center gap-2",
    showcase: "flex flex-1 lg:flex-none items-center justify-center lg:justify-start gap-2 px-3 sm:px-4 py-2 rounded-lg text-sm sm:text-base lg:min-w-[190px]",
    create: "flex flex-1 lg:flex-none items-center justify-center lg:justify-start gap-2 px-3 sm:px-4 py-2 bg-zinc-900 rounded-lg text-sm sm:text-base text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors lg:min-w-[190px]",
    centerCol: "order-1 lg:order-none flex flex-col items-center justify-center gap-3 min-w-0",
    h1: "text-xl sm:text-2xl lg:text-3xl font-bold bg-gradient-to-r from-purple-400 via-pink-500 to-purple-400 bg-clip-text text-transparent px-2 sm:px-4 text-center pb-1 break-words max-w-full",
    rightCol: "order-3 lg:order-none flex flex-row flex-wrap lg:flex-col items-center lg:items-end justify-center gap-2",
    headerBtn: "flex flex-1 lg:flex-none items-center gap-2 px-3 sm:px-4 py-2 rounded-lg transition-all duration-200 font-medium text-sm sm:text-base lg:min-w-[140px] justify-center",
    gridFrame: "border-2 border-zinc-800 bg-black shadow-2xl shadow-purple-900/20",
};
const TITLE_GLOW = { textShadow: "0 0 20px rgba(168, 85, 247, 0.4), 0 0 40px rgba(168, 85, 247, 0.2)" };
const COLUMNS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];

export function StoryView({ id, title, size, cols = null, items, titleStyle = DEFAULT_TITLE_STYLE, verdict = null, verdictFeedback = null, together = false }: { id: string; title: string; size: number; cols?: number | null; items: (StoryItem | null)[]; titleStyle?: TitleStyle; verdict?: AnalysisResult | null; verdictFeedback?: VerdictFeedback; together?: boolean }) {
    const columns = storyColumns(size, cols);
    const count = items.filter(Boolean).length;
    const viaMal = items.some((i) => i?.src === "mal");
    const [copied, setCopied] = useState(false);
    const copyLink = () => {
        navigator.clipboard?.writeText(window.location.href).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };
    // 10x10 gets waifu's A-J / 1-10 labels (lg only); smaller boards have no such coordinates.
    const labels = size === 100;
    return (
        <div className={W.page}>
            <div className={W.header}>
                <div className={W.leftCol}>
                    <Link href="/community?kind=story" className={cn(W.showcase, SHOWCASE_LINK_CLASS)}>
                        <ArrowLeft size={18} className="shrink-0" />
                        <span className="truncate">Community Showcase</span>
                    </Link>
                    <Link href="/story" className={W.create}>
                        <Grid3x3 size={18} className="shrink-0" />
                        <span className="truncate">Create Your Own</span>
                    </Link>
                    {together && <TogetherViewInvite kind="story" className={cn(W.create, "basis-full border border-purple-500/30 text-purple-300 hover:text-white lg:basis-auto")} />}
                </div>

                <div className={W.centerCol}>
                    <h1 className={W.h1} style={TITLE_GLOW}>{title}</h1>
                    <div className="flex flex-col items-center gap-2">
                        {together && <TogetherBadge size="md" />}
                        <p className="text-xs text-zinc-500" data-testid="story-count">{count}/{size} titles</p>
                    </div>
                </div>

                <div className={W.rightCol}>
                    <button type="button" onClick={copyLink} className={cn(W.headerBtn, copied ? "bg-green-500/20 text-green-400 border border-green-500/20" : "bg-purple-600/20 text-purple-400 hover:bg-purple-600/30 border border-transparent")}>
                        {copied ? <Check size={18} className="shrink-0" /> : <Link2 size={18} className="shrink-0" />}
                        <span className="truncate">{copied ? "Link Copied!" : "Copy Link"}</span>
                    </button>
                    <StoryViewVerdict shareId={id} items={items} sharePath={storyViewPath(id)} gridTitle={title} initialVerdict={verdict} initialFeedback={verdictFeedback} />
                    <StoryPngButton title={title} items={items} titleStyle={titleStyle} cols={cols} label="Save as PNG" className={cn(W.headerBtn, "basis-full lg:basis-auto bg-zinc-900 text-zinc-300 hover:bg-zinc-800 hover:text-white border border-zinc-800 disabled:opacity-50")} />
                    <div className="basis-full lg:basis-auto lg:w-full lg:max-w-[232px] flex flex-col items-center lg:items-end gap-2">
                        <StoryCompareWithMine shareId={id} />
                        <EditOwnLink id={id} kind="story" className={cn(W.headerBtn, "bg-zinc-900 text-zinc-200 hover:bg-zinc-800 border border-zinc-800")} />
                    </div>
                </div>
            </div>

            <div className="w-full max-w-[1000px] px-3 sm:px-4 lg:px-6">
                <div className={cn("relative w-full mx-auto", columns <= 3 ? "max-w-md" : columns <= 5 ? "max-w-3xl" : columns <= 7 ? "max-w-4xl" : "max-w-[950px]")}>
                    {labels && (
                        <>
                            <div className="hidden lg:grid absolute -top-6 inset-x-0 grid-cols-10">
                                {COLUMNS.map((c) => <div key={c} className="text-center text-xs font-medium text-zinc-600/40 select-none">{c}</div>)}
                            </div>
                            <div className="hidden lg:flex absolute -left-6 top-0 bottom-0 flex-col">
                                {Array.from({ length: 10 }, (_, i) => <div key={i} className="flex-1 flex items-center justify-center text-xs font-medium text-zinc-600/40 select-none">{i + 1}</div>)}
                            </div>
                        </>
                    )}
                    <div className={W.gridFrame} data-testid="story-view-grid">
                        <StoryCellGrid items={items} columns={columns} toCell={toCell} titleStyle={titleStyle} />
                    </div>
                </div>
            </div>

            <div className="mt-8 mb-16 text-zinc-500 text-sm flex flex-col items-center gap-2">
                <span>Made with <Link href="/story" className="text-purple-400 hover:underline">{STORY_BRAND}</Link></span>
                <span className="text-[11px] text-zinc-600">Data from AniList{viaMal ? " and MyAnimeList" : ""}</span>
            </div>
        </div>
    );
}
