"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ExternalLink, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { proxied } from "@/lib/img-proxy";
import type { StoryItem } from "@/lib/share-schema";
import type { StoryInfo } from "@/server/story-info";
import { TypeBadge } from "@/components/story/TypeBadge";
import { MediaGrid, type MediaGridProps } from "@/components/grid/MediaGrid";

/**
 * The card that opens when a story cell is tapped (2026-10-15). Styled after waifu's
 * CharacterProfile card (same fixed-size sheet, blurred backdrop picture, Thai status copy),
 * but its own component: waifu's card is about characters and must not change.
 *
 * The picture is always the cell's own cover (via the moderated /api/img proxy). Words come
 * from /api/story/info by id (AniList, including a stored MAL id). Upload / web cells have no id
 * to look up, so they show the picture, title and a "Custom" badge only.
 */

type InfoState = { status: "loading" } | { status: "ok"; info: StoryInfo | null } | { status: "failed" };

/** Per-tab cache: re-opening a card costs no request. Failures are not kept. */
const infoCache = new Map<string, StoryInfo | null>();
export const storyInfoKey = (i: StoryItem) => `${i.src === "mal" ? "mal" : "anilist"}:${i.type}:${i.id}`;
export const hasLookup = (i: StoryItem) => i.src !== "upload" && i.src !== "web";

export async function loadStoryInfo(item: StoryItem, signal?: AbortSignal): Promise<StoryInfo | null> {
    const key = storyInfoKey(item);
    if (infoCache.has(key)) return infoCache.get(key) ?? null;
    const qs = new URLSearchParams({ id: String(item.id), type: item.type, src: item.src === "mal" ? "mal" : "anilist" });
    const res = await fetch(`/api/story/info?${qs}`, { signal });
    if (!res.ok) throw new Error(String(res.status));
    const info = ((await res.json()) as { info?: StoryInfo | null }).info ?? null;
    infoCache.set(key, info);
    return info;
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
    return (
        <div className="rounded-lg bg-zinc-800/60 px-3 py-2">
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{label}</dt>
            <dd className="mt-0.5 text-sm text-zinc-200">{value}</dd>
        </div>
    );
}

export function StoryCellCard({ item, onClose, onChangeImage }: { item: StoryItem; onClose: () => void; onChangeImage?: () => void }) {
    const lookup = hasLookup(item);
    const [state, setState] = useState<InfoState>(() => {
        const key = storyInfoKey(item);
        return lookup && infoCache.has(key) ? { status: "ok", info: infoCache.get(key) ?? null } : lookup ? { status: "loading" } : { status: "ok", info: null };
    });

    useEffect(() => {
        if (!lookup || infoCache.has(storyInfoKey(item))) return;
        const ctrl = new AbortController();
        loadStoryInfo(item, ctrl.signal)
            .then((info) => setState({ status: "ok", info }))
            .catch(() => { if (!ctrl.signal.aborted) setState({ status: "failed" }); });
        return () => ctrl.abort();
    }, [item, lookup]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onClose]);

    const info = state.status === "ok" ? state.info : null;
    const title = info?.title || item.title || "Untitled";
    const facts: [string, ReactNode][] = [];
    if (info) {
        if (info.format) facts.push(["Format", info.format]);
        if (info.year) facts.push(["Year", info.year]);
        if (info.status) facts.push(["Status", info.status]);
        if (info.episodes) facts.push(["Episodes", info.episodes]);
        if (info.chapters) facts.push(["Chapters", info.chapters]);
        if (info.volumes) facts.push(["Volumes", info.volumes]);
        if (info.score) facts.push(["Score", `${info.score}%`]);
    }

    return (
        <div
            className="fixed inset-0 z-[100] flex items-end justify-center bg-black/75 backdrop-blur-sm sm:items-center sm:p-6"
            onClick={onClose}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            data-testid="story-cell-card"
        >
            <div
                onClick={(e) => e.stopPropagation()}
                className={cn(
                    "animate-in slide-in-from-bottom-4 duration-200 flex w-full flex-col overflow-hidden",
                    "rounded-t-3xl border border-zinc-800 bg-zinc-900 shadow-2xl shadow-purple-950/40 sm:rounded-3xl",
                    "h-[86vh] max-h-[680px] sm:h-[620px] sm:max-w-lg"
                )}
            >
                <div className="relative h-64 shrink-0 overflow-hidden bg-zinc-950 sm:h-72">
                    {item.cover ? (
                        <>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={proxied(item.cover, 640)} alt="" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-40 blur-2xl" />
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={proxied(item.cover, 640)} alt={title} className="relative h-full w-full object-contain" />
                        </>
                    ) : (
                        <div className="flex h-full items-center justify-center text-sm text-zinc-700">no image</div>
                    )}
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-zinc-900 to-transparent" />
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close"
                        className="absolute right-3 top-3 rounded-full bg-black/60 p-2 text-zinc-300 backdrop-blur-sm transition-colors hover:bg-black/80 hover:text-white"
                    >
                        <X size={16} />
                    </button>
                </div>

                <div className="relative z-10 -mt-8 flex min-h-0 flex-1 flex-col px-6 pb-6">
                    <div className="min-w-0">
                        <h3 className="text-2xl font-bold leading-tight text-white">{title}</h3>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                            <TypeBadge type={lookup ? info?.type ?? item.type : "CUSTOM"} />
                            {info?.altTitles?.[0] && <span className="truncate text-sm text-purple-300">{info.altTitles[0]}</span>}
                        </div>
                    </div>

                    <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
                        {state.status === "loading" ? (
                            <div className="flex flex-col gap-2" data-testid="story-card-loading">
                                <div className="h-3.5 w-full animate-pulse rounded bg-zinc-800/70" />
                                <div className="h-3.5 w-11/12 animate-pulse rounded bg-zinc-800/70" />
                                <div className="h-3.5 w-4/5 animate-pulse rounded bg-zinc-800/70" />
                            </div>
                        ) : state.status === "failed" ? (
                            <p className="text-sm text-zinc-500">โหลดไม่สำเร็จ ลองใหม่อีกครั้ง</p>
                        ) : !lookup ? (
                            <p className="text-sm text-zinc-500">
                                รูปนี้เป็นภาพที่อัปโหลดเองหรือมาจากเว็บ จึงไม่มีข้อมูลเรื่องย่อให้แสดง
                            </p>
                        ) : (
                            <>
                                {facts.length > 0 && (
                                    <dl className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                                        {facts.map(([k, v]) => <Fact key={k} label={k} value={v} />)}
                                    </dl>
                                )}
                                {info?.genres?.length ? (
                                    <div className="mb-4 flex flex-wrap gap-1.5">
                                        {info.genres.map((g) => <span key={g} className="rounded-full border border-zinc-700 px-2 py-0.5 text-xs text-zinc-400">{g}</span>)}
                                    </div>
                                ) : null}
                                {info?.synopsis ? (
                                    <p className="whitespace-pre-line text-[15px] leading-relaxed text-zinc-300">{info.synopsis}</p>
                                ) : (
                                    <p className="text-sm text-zinc-500">ไม่พบเรื่องย่อของเรื่องนี้</p>
                                )}
                            </>
                        )}
                    </div>

                    {onChangeImage && (
                        <button type="button" onClick={onChangeImage} className="mt-3 self-start rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200 hover:border-purple-500">Change image</button>
                    )}
                    {info?.url && (
                        <a href={info.url} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1 self-start text-xs text-zinc-500 hover:text-zinc-300">
                            {info.source === "mal" ? "MyAnimeList" : "AniList"} <ExternalLink size={12} />
                        </a>
                    )}
                </div>
            </div>
        </div>
    );
}

type OpenFn = (item: StoryItem | null | undefined) => void;
const Ctx = createContext<OpenFn>(() => {});

/** Opens the story cell card from anywhere under the provider. */
export function useOpenStoryCell(): OpenFn {
    return useContext(Ctx);
}

export function StoryCellCardProvider({ children }: { children: ReactNode }) {
    const [item, setItem] = useState<StoryItem | null>(null);
    const open = useCallback<OpenFn>((i) => setItem(i ?? null), []);
    const close = useCallback(() => setItem(null), []);
    const value = useMemo(() => open, [open]);
    return (
        <Ctx.Provider value={value}>
            {children}
            {item && <StoryCellCard key={storyInfoKey(item) + item.cover} item={item} onClose={close} />}
        </Ctx.Provider>
    );
}

/** Convenience for a grid: index -> open that slot's item (empty slots do nothing). */
export function useOpenStoryCellAt(items: (StoryItem | null)[]): (index: number) => void {
    const open = useOpenStoryCell();
    return useCallback((index: number) => { const it = items[index]; if (it) open(it); }, [items, open]);
}

function OpenableGrid({ items, ...rest }: Omit<MediaGridProps<StoryItem>, "onSelect" | "clickable" | "editable">) {
    const open = useOpenStoryCellAt(items);
    return <MediaGrid items={items} {...rest} onSelect={open} clickable />;
}

/**
 * Drop-in for a read-only <MediaGrid> of story items (the view page): same props, but tapping a
 * filled cell opens the StoryCellCard. Carries its own provider, so the page needs no wrapper.
 */
export function StoryCellGrid(props: Omit<MediaGridProps<StoryItem>, "onSelect" | "clickable" | "editable">) {
    return (
        <StoryCellCardProvider>
            <OpenableGrid {...props} />
        </StoryCellCardProvider>
    );
}
