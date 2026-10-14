"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState } from "react";
import { friendlyError } from "@/lib/public-errors";
import { Check, Loader2, X } from "lucide-react";
import { proxied } from "@/lib/img-proxy";
import type { SearchItem } from "@/lib/story/search";
import type { StoryItem } from "@/lib/share-schema";
import { TypeBadge } from "@/components/story/TypeBadge";

type ChoiceSource = "anilist" | "banner" | "relation" | "mal" | "web";
interface Choice { url: string; source: ChoiceSource; label: string; hash?: string }

type SourceName = "anilist" | "jikan" | "web";
/** Requested in parallel, one request each (T-0010 perf); order = dedupe priority. */
const SOURCES: SourceName[] = ["anilist", "jikan", "web"];

const SECTIONS: { key: string; title: string; sources: ChoiceSource[]; from: SourceName }[] = [
    { key: "covers", title: "Official covers", sources: ["anilist", "banner"], from: "anilist" },
    { key: "mal", title: "MyAnimeList pictures", sources: ["mal"], from: "jikan" },
    { key: "related", title: "Related titles", sources: ["relation"], from: "anilist" },
    { key: "web", title: "From the web", sources: ["web"], from: "web" },
];

/**
 * Client-side cache of finished source results per title (T-0013): reopening
 * the picker for a title - e.g. clicking a filled cell - reuses them instead of
 * requesting again. Only successful answers are kept; failures retry next time.
 * The server keeps its own 7-day cache behind this.
 */
const choiceCache = new Map<string, Partial<Record<SourceName, Choice[]>>>();
const CHOICE_CACHE_MAX = 100;
/** Title identity used by the cache - also by StoryBuilder to match the slot being replaced. */
export const pickerKey = (i: { id: number; type: string; src?: string }) => `${i.src === "mal" ? "mal" : "anilist"}:${i.type}:${i.id}`;
function remember(key: string, source: SourceName, choices: Choice[]) {
    if (!choiceCache.has(key) && choiceCache.size >= CHOICE_CACHE_MAX) choiceCache.delete(choiceCache.keys().next().value as string);
    choiceCache.set(key, { ...choiceCache.get(key), [source]: choices });
}
/**
 * One request per (title, source) at a time, shared by every open picker -
 * so a remount (React strict mode, quick close/reopen) joins the request in
 * flight instead of firing a duplicate.
 */
const inflight = new Map<string, Promise<Choice[]>>();
function loadSource(key: string, source: SourceName, url: string): Promise<Choice[]> {
    const k = `${key}|${source}`;
    let p = inflight.get(k);
    if (!p) {
        p = fetch(url)
            .then(async (r) => {
                const d = await r.json().catch(() => ({}));
                if (!r.ok) throw new Error(friendlyError(d.error, "Couldn't load more images. You can still use the main cover."));
                const choices: Choice[] = d.choices ?? [];
                // Partial = a source failed (server caches that only 1 h): show it, but don't keep it here.
                if (d.partial !== true) remember(key, source, choices);
                return choices;
            })
            .finally(() => inflight.delete(k));
        inflight.set(k, p);
    }
    return p;
}
/** Test hook. */
export function clearImagePickerCache() {
    choiceCache.clear();
    inflight.clear();
}

/** Titles whose images can be looked up by id (uploads / web picks have no real media id). */
export function canPickImagesFor(item: { src?: string }): boolean {
    return !item.src || item.src === "anilist" || item.src === "mal";
}

/**
 * T-0010 "pick an image" sheet: every image choice for one title (AniList
 * covers, banner, relations; MAL pictures; Serper web images), deduped by
 * byte hash on the server. Every thumbnail goes through proxied() (/api/img).
 * Sections with nothing in them - e.g. web when Serper has no key - are
 * simply not rendered.
 */
export function ImagePicker({
    item,
    onPick,
    onClose,
    onUpload,
    current = false,
}: {
    item: SearchItem;
    /** Opened from a filled cell: item.cover is the image currently on the board. */
    current?: boolean;
    onPick: (picked: StoryItem) => void;
    onClose: () => void;
    onUpload: (file: File, base: StoryItem) => Promise<string | null>;
}) {
    /** Per source: undefined = loading, array = done (possibly empty). Sources load independently. */
    const [bySource, setBySource] = useState<Partial<Record<SourceName, Choice[]>>>(() => ({ ...choiceCache.get(pickerKey(item)) }));
    const [error, setError] = useState<string | null>(null);
    const [uploading, setUploading] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);
    const base: StoryItem = { id: item.id, type: item.type, title: item.title, cover: item.cover, src: item.src };

    useEffect(() => {
        let alive = true;
        // Only ids and a source NAME go to the server - never an image URL.
        const q = `id=${item.id}&type=${item.type}&src=${item.src === "mal" ? "mal" : "anilist"}`;
        const key = pickerKey(item);
        const cached = choiceCache.get(key) ?? {};
        for (const source of SOURCES) {
            if (cached[source]) continue; // already have it: no request
            loadSource(key, source, `/api/story/images?${q}&source=${source}`)
                .then((choices) => alive && setBySource((prev) => ({ ...prev, [source]: choices })))
                .catch((e) => {
                    if (!alive) return;
                    // A slow or failing extra source stays quiet; only the main source reports.
                    if (source === "anilist") setError(friendlyError(e instanceof Error ? e.message : null, "Couldn't load more images. You can still use the main cover."));
                    setBySource((prev) => ({ ...prev, [source]: [] }));
                });
        }
        return () => {
            alive = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the title identity only
    }, [item.id, item.type, item.src]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onClose]);

    // The search result's own cover is shown (and selectable) immediately; other
    // sources stream in. Cross-source dedupe by the server-computed byte hash.
    const merged: Choice[] = [];
    const seenHash = new Set<string>();
    const seenUrl = new Set<string>([item.cover]);
    for (const source of SOURCES) {
        for (const c of bySource[source] ?? []) {
            if (seenUrl.has(c.url) || (c.hash && seenHash.has(c.hash))) continue;
            seenUrl.add(c.url);
            if (c.hash) seenHash.add(c.hash);
            merged.push(c);
        }
    }
    const all: Choice[] = [{ url: item.cover, source: "anilist", label: current ? "Current image" : "Cover" }, ...merged];
    const loading = SOURCES.filter((src) => bySource[src] === undefined);

    const tile = (c: Choice) => (
        <li key={c.url}>
            <button
                type="button"
                onClick={() => onPick({ ...base, cover: c.url })}
                title={c.label}
                className="group relative block w-full aspect-[2/3] overflow-hidden rounded-lg bg-zinc-900 border border-zinc-800 hover:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
            >
                <img src={proxied(c.url, 256)} alt={c.label} loading="lazy" referrerPolicy="no-referrer" className="absolute inset-0 w-full h-full object-cover transition-transform group-hover:scale-105" />
                <span className="absolute inset-x-0 bottom-0 p-1 text-[10px] leading-tight text-zinc-200 bg-gradient-to-t from-black/90 to-transparent line-clamp-2 text-left">{c.label}</span>
                <span className="absolute top-1 right-1 hidden group-hover:flex w-6 h-6 rounded-full bg-purple-600 items-center justify-center"><Check className="w-3.5 h-3.5" /></span>
            </button>
        </li>
    );

    return (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={`Choose an image for ${item.title}`} onClick={onClose}>
            <div className="w-full sm:max-w-3xl max-h-[92vh] sm:max-h-[85vh] flex flex-col bg-zinc-950 border border-zinc-800 rounded-t-2xl sm:rounded-2xl shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-start gap-3 p-4 border-b border-zinc-800">
                    <img src={proxied(item.cover, 128)} alt="" className="w-12 h-[72px] rounded-md object-cover bg-zinc-800 shrink-0" />
                    <div className="min-w-0 flex-1">
                        <p className="text-xs uppercase tracking-wider text-purple-300">{current ? "Change image" : "Choose an image"}</p>
                        <h2 className="font-bold leading-tight line-clamp-2">{item.title}</h2>
                        <div className="mt-1 flex items-center gap-2 text-xs text-zinc-500"><TypeBadge type={item.type} />{item.format && item.format !== "Manga" && <span>{item.format}</span>}{item.year && <span>{item.year}</span>}</div>
                    </div>
                    <button type="button" onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800"><X className="w-5 h-5" /></button>
                </div>

                <div className="overflow-y-auto p-4 space-y-5">
                    <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" aria-label="Upload an image for this title" data-testid="picker-upload-input" onChange={async (e) => {
                        const f = e.target.files?.[0];
                        e.target.value = "";
                        if (!f) return;
                        setUploading(true);
                        const err = await onUpload(f, base);
                        setUploading(false);
                        if (err) setError(err);
                    }} />
                    {error && <p role="alert" className="text-sm text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">{error}</p>}

                    {SECTIONS.map((sec) => {
                        const items = all.filter((c) => sec.sources.includes(c.source));
                        const loadingHere = loading.includes(sec.from);
                        if (!items.length && !loadingHere) return null;
                        return (
                            <section key={sec.key} aria-label={sec.title}>
                                <h3 className="text-sm font-semibold text-zinc-300 mb-2">{sec.title}{items.length > 0 && <span className="ml-1 text-zinc-500 font-normal">({items.length})</span>}</h3>
                                <ul className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                                    {items.map(tile)}
                                    {loadingHere && Array.from({ length: 5 }, (_, i) => <li key={`sk-${i}`} data-testid="choice-skeleton" className="aspect-[2/3] rounded-lg bg-zinc-800/70 animate-pulse" />)}
                                </ul>
                            </section>
                        );
                    })}
                    {loading.length > 0 && <p data-testid="source-loading" className="text-xs text-zinc-500 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Finding more images…</p>}
                    <p className="text-center">
                        <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} className="text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-300 disabled:opacity-60 inline-flex items-center gap-1">
                            {uploading && <Loader2 className="w-3 h-3 animate-spin" />} {uploading ? "Checking & uploading…" : "Can't find it? Upload your own image"}
                        </button>
                    </p>
                    <p className="text-[11px] text-zinc-500">Images from AniList, MyAnimeList (via Jikan) and the web. Every image is safety-checked before it is shown.</p>
                </div>
            </div>
        </div>
    );
}
