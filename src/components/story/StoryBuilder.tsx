"use client";
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { friendlyError } from "@/lib/public-errors";
import Link from "next/link";
import { ChevronLeft, ChevronRight, ChevronUp, FolderOpen, ImageUp, Loader2, Plus, Save, Search, Share2, Trash2, Users, X } from "lucide-react";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { StorySuggest } from "@/components/story/StorySuggest";
import { StoryShareModal, type StoryShareResult } from "@/components/story/StoryShareModal";
import { WAIFU_BTN } from "@/components/story/waifu-styles";
import { BOARD_GUTTER_CLASS } from "@/components/dnd/EdgeTrashZones";
import { BOARD_FILE_MAX_BYTES, BOARD_TOO_BIG, BoardFileError, boardFileName, boardFromFile, boardToFile } from "@/lib/story/board-file";
import { proxied } from "@/lib/img-proxy";
import { MediaGrid, moveSlot } from "@/components/grid/MediaGrid";
import { cn } from "@/lib/utils";
import {
    STORY_BRAND,
    SHARE_TITLE_MAX,
    STORY_SIZES,
    STORY_SIZE_LABELS,
    TITLE_STYLES,
    TITLE_STYLE_LABELS,
    storyColumns,
    storySizeLabel,
    storyViewPath,
} from "@/lib/story/config";
import { CustomSizeControl } from "@/components/story/CustomSizeControl";
import { emptyDraft, loadDraft, placeItem, resizeDraft, saveDraft, type StoryDraft } from "@/lib/story/draft";
import { SEARCH_DEBOUNCE_MS, storySearch, type SearchItem, type SearchSource } from "@/lib/story/search";
import { toStoredStoryCell, type StoryItem } from "@/lib/share-schema";
import { ensureUserId } from "@/lib/user-id";
import { StoryPngButton, StoryVerdict } from "@/components/story/StoryExtras";
import { canPickImagesFor, ImagePicker, pickerKey } from "@/components/story/ImagePicker";
import { TypeBadge } from "@/components/story/TypeBadge";
import { SearchModeToggle } from "@/components/story/SearchModeToggle";
import type { MediaType } from "@/lib/share-schema";
import { rememberOwnGrid } from "@/lib/my-grids";
import { AISuggestionHint, ChangeImageHint, SearchHint, StoryToast, type NoticeType } from "@/components/story/StoryHints";
import { PanelTabs, StoryCommunity, type PanelTab } from "@/components/story/StoryPanels";
import type { ShareSummary } from "@/lib/share-summary";

const toCell = (i: StoryItem) => ({ key: `${i.src ?? "anilist"}-${i.type}-${i.id}`, image: i.cover, label: i.title });

/** POST a file to the moderated story upload; returns the item or a readable error. */
const TYPE_WORD: Record<MediaType, string> = { ANIME: "anime", MANGA: "manga", NOVEL: "light novel" };

async function uploadCover(file: File, title: string, type: string): Promise<{ item?: StoryItem; error?: string }> {
    if (file.size > 2 * 1024 * 1024) return { error: "That image is larger than 2 MB. Please pick a smaller one." };
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return { error: "Please upload a JPEG, PNG or WebP image." };
    const form = new FormData();
    form.set("file", file);
    form.set("title", title);
    form.set("type", type);
    const res = await fetch("/api/story/upload", { method: "POST", body: form }).catch(() => null);
    if (!res) return { error: "Couldn't reach the server. Check your connection and try again." };
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.item) return { error: friendlyError(data.error, "Upload failed. Please try again.") };
    return { item: data.item as StoryItem };
}

/** min-width media query (1024 = Tailwind `lg:`, 1280 = `xl:`). False on the server and in tests without matchMedia. */
function useMinWidth(px: number) {
    const [v, setV] = useState(false);
    useEffect(() => {
        const mq = window.matchMedia?.(`(min-width: ${px}px)`);
        if (!mq) return;
        const on = () => setV(mq.matches);
        on();
        mq.addEventListener("change", on);
        return () => mq.removeEventListener("change", on);
    }, [px]);
    return v;
}

const COMMUNITY_PAGE = 20;

export function StoryBuilder() {
    const [draft, setDraft] = useState<StoryDraft>(() => emptyDraft());
    const [loaded, setLoaded] = useState(false);
    const [selected, setSelected] = useState<number | null>(null);
    const [query, setQuery] = useState("");
    /** Anime / manga mode under the search box (default anime). */
    const [searchType, setSearchType] = useState<MediaType>("ANIME");
    const [results, setResults] = useState<SearchItem[]>([]);
    const [source, setSource] = useState<SearchSource>("anilist");
    const [searching, setSearching] = useState(false);
    const [searchError, setSearchError] = useState<string | null>(null);
    const [searchNote, setSearchNote] = useState<string | null>(null);
    const [searched, setSearched] = useState("");
    // Waifu's toast: typed (success / error / info), 3 s.
    const [notice, setNoticeState] = useState<{ message: string; type: NoticeType } | null>(null);
    const setNotice = useCallback((message: string | null, type: NoticeType = "success") => setNoticeState(message === null ? null : { message, type }), []);
    // Waifu's once-per-session builder hints.
    const [hint, setHint] = useState<"search" | "ai" | "image" | null>(null);
    const hintsShown = useRef({ search: false, ai: false, image: false });
    /** Waifu (handleDragEnd): the first board change of the session shows the AI hint after 500 ms; a later add from the search panel shows "Did you know?" for 10 s. */
    const afterBoardChange = useCallback((fromSearch: boolean) => {
        if (!hintsShown.current.ai) {
            hintsShown.current.ai = true;
            setTimeout(() => setHint("ai"), 500);
        } else if (fromSearch && !hintsShown.current.image) {
            hintsShown.current.image = true;
            setHint("image");
            setTimeout(() => setHint((h) => (h === "image" ? null : h)), 10000);
        }
    }, []);
    const [shareOpen, setShareOpen] = useState(false);
    const isDesktop = useMinWidth(1024);
    const isWide = useMinWidth(1280);
    // Waifu starts collapsed (mobile); story opens it on wide screens where the canvas has room.
    const [showRightPanel, setShowRightPanel] = useState(false);
    useEffect(() => {
        if (typeof window !== "undefined" && window.matchMedia?.("(min-width: 1280px)").matches) setShowRightPanel(true);
    }, []);
    const docked = isWide && showRightPanel;
    const overlay = !isWide && showRightPanel;
    useEffect(() => {
        if (!overlay) return;
        const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") setShowRightPanel(false); };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [overlay]);
    const [picking, setPicking] = useState<SearchItem | null>(null);
    // Right panel tabs (waifu: Suggestions / Community; story has no Gallery tab). Nothing loads on mount or tab switch,
    // except Community's one fetch the first time its tab opens.
    const [tab, setTab] = useState<PanelTab>("suggestions");
    const [community, setCommunity] = useState<{ grids: ShareSummary[]; next: number | null; loading: boolean; error: boolean; started: boolean }>({ grids: [], next: 0, loading: false, error: false, started: false });
    const communityBusy = useRef(false);
    const loadCommunity = useCallback(async (offset: number) => {
        if (communityBusy.current) return;
        communityBusy.current = true;
        setCommunity((c) => ({ ...c, loading: true, error: false, started: true }));
        try {
            const res = await fetch(`/api/community?kind=story&offset=${offset}&limit=${COMMUNITY_PAGE}`);
            if (!res.ok) throw new Error(String(res.status));
            const data = (await res.json()) as { grids?: ShareSummary[]; nextOffset?: number | null; hasMore?: boolean };
            const page = (data.grids ?? []).filter((g) => g && g.kind === "story");
            setCommunity((c) => {
                const base = offset === 0 ? [] : c.grids;
                const seen = new Set(base.map((g) => g.id));
                return { grids: [...base, ...page.filter((g) => !seen.has(g.id))], next: data.hasMore && typeof data.nextOffset === "number" ? data.nextOffset : null, loading: false, error: false, started: true };
            });
        } catch {
            setCommunity((c) => ({ ...c, loading: false, error: true }));
        } finally {
            communityBusy.current = false;
        }
    }, []);
    const openTab = (t: PanelTab) => {
        setTab(t);
        if (t === "community" && !community.started) void loadCommunity(0);
    };
    /** T-0013: slot being changed (clicked a filled cell); the next pick replaces it. */
    const [replacing, setReplacing] = useState<number | null>(null);
    const canvasRef = useRef<HTMLElement | null>(null);
    const searchRef = useRef<HTMLInputElement>(null);
    /** Parity item 3: in-app confirm (same ConfirmModal as waifu) instead of window.confirm. */
    const [confirm, setConfirm] = useState<{ title: string; message: string; confirmText: string; variant?: "danger" | "warning" | "info"; onConfirm: () => void } | null>(null);
    const loadRef = useRef<HTMLInputElement>(null);
    const [uploadTitle, setUploadTitle] = useState("");
    const [uploading, setUploading] = useState(false);
    const abortRef = useRef<AbortController | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        setDraft(loadDraft());
        setLoaded(true);
    }, []);
    useEffect(() => {
        if (loaded) saveDraft(draft);
    }, [draft, loaded]);
    useEffect(() => {
        if (!notice) return;
        const t = setTimeout(() => setNotice(null), 3000);
        return () => clearTimeout(t);
    }, [notice, setNotice]);

    // Debounced search in the chosen mode (anime or manga); a newer query or mode aborts the older request.
    useEffect(() => {
        const q = query.trim();
        if (q.length < 2) {
            abortRef.current?.abort();
            setResults([]);
            setSearching(false);
            setSearchError(null);
            setSearched("");
            return;
        }
        setSearching(true);
        const timer = setTimeout(async () => {
            abortRef.current?.abort();
            const ctrl = new AbortController();
            abortRef.current = ctrl;
            try {
                const r = await storySearch.search(q, ctrl.signal, searchType);
                if (ctrl.signal.aborted) return;
                setResults(r.items);
                if (r.items.length > 0 && !hintsShown.current.search) {
                    hintsShown.current.search = true;
                    setHint("search");
                }
                setSource(r.source);
                setSearchError(null);
                setSearchNote(
                    r.anilistCooldownUntil
                        ? "AniList is busy for a moment, so these results come from MyAnimeList."
                        : r.resolvedTitles?.length && r.items.length
                          ? `Showing results for “${r.resolvedTitles[0]}”.`
                          : null
                );
                setSearched(q);
            } catch (e) {
                if (ctrl.signal.aborted) return;
                setResults([]);
                setSearchError(friendlyError(e instanceof Error ? e.message : null, "Search failed. Please try again."));
            } finally {
                if (!ctrl.signal.aborted) setSearching(false);
            }
        }, SEARCH_DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [query, searchType]);

    const filled = useMemo(() => draft.items.filter(Boolean).length, [draft.items]);

    const place = useCallback(
        (item: StoryItem) => {
            if (replacing !== null && draft.items[replacing]) {
                const same = (x: StoryItem | null) => !!x && x.id === item.id && x.type === item.type && (x.src ?? "anilist") === (item.src ?? "anilist");
                if (draft.items.some((x, j) => j !== replacing && same(x))) {
                    setNotice(`“${item.title}” is already on your board.`, "error");
                    return false;
                }
                setDraft({ ...draft, items: draft.items.map((x, j) => (j === replacing ? item : x)) });
                setReplacing(null);
                setSelected(null);
                setNotice(`Updated slot ${replacing + 1}.`);
                return true;
            }
            const next = placeItem(draft, item, selected !== null && !draft.items[selected] ? selected : null);
            if (!next) {
                setNotice(draft.items.some((x) => x && x.id === item.id && x.type === item.type && (x.src ?? "anilist") === (item.src ?? "anilist")) ? `“${item.title}” is already on your board.` : "Your board is full. Remove a title or pick a bigger size.", "error");
                return false;
            }
            setDraft(next);
            setSelected(null);
            setNotice(`Added “${item.title}”.`);
            afterBoardChange(true);
            return true;
        },
        [draft, selected, replacing, setNotice, afterBoardChange]
    );

    const replacingItem = replacing !== null ? draft.items[replacing] : null;
    const replacingKey = replacingItem ? pickerKey(replacingItem) : null;

    /** T-0013: a filled cell opens the picker for its title (no retyping); empty cells keep select-a-slot. */
    const selectCell = (i: number) => {
        const it = draft.items[i];
        if (!it) {
            setReplacing(null);
            setSelected(selected === i ? null : i);
            return;
        }
        if (canPickImagesFor(it)) {
            setSelected(i);
            setReplacing(i);
            setPicking({ ...it });
        } else {
            // Upload / web pick: no media id to look images up by - confirm, then search its title.
            setConfirm({
                title: `Replace slot ${i + 1}?`,
                message: `“${it.title}” is ${it.src === "upload" ? "your own uploaded image" : "an image from the web"}, so there are no other images to pick from. We'll search for its title so you can choose a replacement.`,
                confirmText: "Find a replacement",
                variant: "info",
                onConfirm: () => {
                    setSelected(i);
                    setReplacing(i);
                    setQuery(it.title);
                    searchRef.current?.focus();
                },
            });
        }
    };

    const saveBoard = () => {
        const blob = new Blob([boardToFile(draft)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = boardFileName(draft);
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setNotice("Board saved as a file.");
    };
    const loadBoard = async (file: File | undefined) => {
        if (!file) return;
        // Reject oversized files before reading them into memory.
        if (file.size > BOARD_FILE_MAX_BYTES) return setNotice(BOARD_TOO_BIG, "error");
        try {
            const { draft: next, dropped } = boardFromFile(await file.text());
            const apply = () => {
                setDraft(next);
                setSelected(null);
                setReplacing(null);
                setNotice(dropped ? `Board loaded. ${dropped} item(s) in the file were invalid and skipped.` : "Board loaded.", dropped ? "info" : "success");
            };
            if (filled > 0) {
                setConfirm({ title: "Replace your current board?", message: `Loading this file replaces the ${filled} title(s) on your board.`, confirmText: "Load board", variant: "warning", onConfirm: apply });
            } else apply();
        } catch (e) {
            setNotice(e instanceof BoardFileError ? e.message : "Couldn't read that file. Please try another one.", "error");
        }
    };

    const uploadOwn = async (file: File | undefined) => {
        if (!file) return;
        setUploading(true);
        const r = await uploadCover(file, uploadTitle.trim() || file.name.replace(/\.[^.]+$/, ""), searchType);
        setUploading(false);
        if (r.error || !r.item) return setNotice(r.error ?? "Upload failed.", "error");
        if (place(r.item)) setUploadTitle("");
    };

    /** Preset (cols null) or custom rows x cols; resizeDraft ignores anything outside the limits. */
    const changeSize = (size: number, cols: number | null = null) => {
        const lost = draft.items.slice(size).filter(Boolean).length;
        const apply = () => {
            setDraft((d) => resizeDraft(d, size, cols));
            setSelected(null);
        };
        if (lost > 0) {
            setConfirm({ title: `Shrink to ${storySizeLabel(size, cols)}?`, message: `This removes ${lost} title(s) from the end of your board.`, confirmText: "Shrink", variant: "warning", onConfirm: apply });
            return;
        }
        apply();
    };

    /** Called by StoryShareModal after the user confirms the (editable) title. Title validation is server-side. */
    const share = async (title: string): Promise<StoryShareResult> => {
        if (filled === 0) return { error: "Go add some titles first!" };
        const cells = draft.items.flatMap((item, i) => (item ? [toStoredStoryCell(i, item)] : []));
        let res: Response;
        try {
            res = await fetch("/api/share", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ kind: "story", size: draft.size, ...(draft.cols ? { cols: draft.cols } : {}), grid: cells, customTitle: title || undefined, userId: ensureUserId(), titleStyle: draft.titleStyle }),
            });
        } catch {
            return { error: "Failed to create share link. Try again." };
        }
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.id) {
            return { error: friendlyError(data.error, "") || (res.status === 503 ? "Sharing is unavailable right now (storage offline). Your board is saved on this device." : "Failed to create share link. Try again.") };
        }
        rememberOwnGrid({ id: data.id, title: title || `${STORY_BRAND} Grid`, imageUrl: null, createdAt: new Date().toISOString(), hasGif: false, count: filled, kind: "story", size: draft.size, ...(draft.cols ? { cols: draft.cols } : {}) });
        return { id: data.id, viewPath: storyViewPath(data.id) };
    };

    // Actions follow waifu's sidebar: Save/Load, Ask AI, Share | Save as .png, Clear Grid - same colours and copy.
    const actions = (
                    <div data-testid="story-actions" className={cn("w-full space-y-2", !isDesktop && "max-w-md mx-auto")}>
                        {/* Waifu's "Community Showcase" button (same markup), opening the story showcase. */}
                        <Link
                            href="/community?kind=story"
                            target="_blank"
                            rel="noopener noreferrer"
                            data-testid="showcase-link"
                            className="w-full py-2 mb-2 bg-gradient-to-r from-indigo-900/40 to-purple-900/40 hover:from-indigo-900/60 hover:to-purple-900/60 border border-indigo-500/30 rounded-lg font-bold flex justify-center items-center gap-2 text-sm transition-all group"
                        >
                            <Users className="w-4 h-4 text-indigo-400 group-hover:scale-110 transition-transform" />
                            <span className="bg-clip-text text-transparent bg-gradient-to-r from-indigo-300 to-purple-300">Community Showcase</span>
                        </Link>
                        <div className="flex gap-2">
                            <button type="button" onClick={saveBoard} disabled={filled === 0} className={cn(WAIFU_BTN.neutral, "flex-1")}>
                                <Save className="w-4 h-4 text-green-400" /> Save board
                            </button>
                            <button type="button" onClick={() => loadRef.current?.click()} className={cn(WAIFU_BTN.neutral, "flex-1")}>
                                <FolderOpen className="w-4 h-4 text-green-400" /> Load board
                            </button>
                        </div>
                        <input ref={loadRef} type="file" accept="application/json,.json" className="hidden" aria-label="Load a board file" data-testid="board-load-input" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; loadBoard(f); }} />
                        <StoryVerdict items={draft.items} className={WAIFU_BTN.ai} label="Ask AI About My Taste" gridTitle={draft.title.trim() || undefined} />
                        <div className="flex gap-2">
                            <button type="button" onClick={() => setShareOpen(true)} className={WAIFU_BTN.share}>
                                <Share2 size={16} /> <span>Share</span>
                            </button>
                            <StoryPngButton title={draft.title} items={draft.items} titleStyle={draft.titleStyle} cols={draft.cols} className={WAIFU_BTN.png} label="Save as .png" />
                        </div>
                        <button type="button" disabled={filled === 0} onClick={() => setConfirm({ title: "Clear Entire Grid?", message: "Are you sure you want to delete all titles? This action cannot be undone unless you have a save file.", confirmText: "Clear Everything", onConfirm: () => { setDraft((d) => ({ ...emptyDraft(d.size, d.cols ?? null), titleStyle: d.titleStyle })); setNotice("Grid cleared successfully!"); } })} className={WAIFU_BTN.clear}>
                            <Trash2 className="w-4 h-4 group-hover:scale-110 transition-transform" /> Clear Grid
                        </button>
                    </div>
    );
    const q = query.trim();
    const columns = storyColumns(draft.size, draft.cols);
    return (
        <div className="min-h-screen lg:h-screen w-full bg-black text-white flex flex-col lg:flex-row lg:overflow-hidden">
            {/* LEFT: search + upload (stacks on top on mobile) */}
            <aside className="w-full lg:w-80 bg-zinc-950 border-b lg:border-b-0 lg:border-r border-zinc-800 flex flex-col shrink-0 lg:h-full">
                <div className="p-4 border-b border-zinc-800 flex justify-between items-center gap-2">
                    <h1 className="text-xl font-bold bg-gradient-to-r from-sky-400 to-purple-500 bg-clip-text text-transparent">{STORY_BRAND}</h1>
                    <nav className="flex items-center gap-1.5 text-xs">
                        <Link href="/" className="px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-purple-500/60">Waifu100</Link>
                        <Link href="/community?kind=story" className="px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-purple-500/60 inline-flex items-center gap-1"><Users className="w-3.5 h-3.5" /> Community</Link>
                    </nav>
                </div>

                <div className="px-4 pt-4 pb-2">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                        <input
                            ref={searchRef}
                            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg py-2 pl-10 pr-9 focus:ring-2 focus:ring-purple-500 outline-none"
                            placeholder={`Search ${TYPE_WORD[searchType]}… (ไทย / English / 日本語)`}
                            aria-label="Search anime or manga"
                            lang="th"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            autoComplete="off"
                            enterKeyHint="search"
                        />
                        {searching ? (
                            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-zinc-500" />
                        ) : query ? (
                            <button type="button" aria-label="Clear search" onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-zinc-500 hover:text-white"><X className="w-4 h-4" /></button>
                        ) : null}
                    </div>
                    <SearchModeToggle value={searchType} onChange={setSearchType} />
                    {/* 2026-10-15: always visible but quiet - a custom cover works for any story, not just these 3 types. */}
                    <button type="button" data-testid="upload-any" disabled={uploading} onClick={() => { setUploadTitle(q); fileRef.current?.click(); }} className="mt-2 w-full inline-flex items-center justify-center gap-1.5 text-[11px] text-zinc-500 hover:text-zinc-300 disabled:opacity-60">
                        <ImageUp className="w-3.5 h-3.5 shrink-0" />
                        <span className="underline underline-offset-2">{uploading ? "Checking & uploading…" : "Upload your own cover — any story (movie, series, game, book…)"}</span>
                    </button>
                </div>

                {/* Hidden file input, opened by the upload link above or the no-results link below. */}
                <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" aria-label="Upload your own image" data-testid="upload-input" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; uploadOwn(f); }} />

                {replacing !== null && draft.items[replacing] && !picking && (
                    <div data-testid="replacing-note" className="mx-4 mb-2 flex items-center gap-2 rounded-lg border border-purple-500/40 bg-purple-500/10 px-3 py-1.5 text-xs text-purple-200">
                        <span className="flex-1 min-w-0 truncate">Replacing slot {replacing + 1}: “{draft.items[replacing]!.title}”</span>
                        <button type="button" className="underline shrink-0" onClick={() => { setReplacing(null); setSelected(null); }}>Cancel</button>
                    </div>
                )}
                {/* Mobile: keep the board in view - results capped at 30vh, help text collapsed. */}
                <div data-testid="search-panel" className="flex-1 min-h-0 overflow-y-auto px-2 pb-3 max-h-[30vh] lg:max-h-none" aria-live="polite">
                    {searchError && <p role="alert" className="mx-2 mb-2 text-sm text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">{searchError}</p>}
                    {searchNote && !searchError && <p className="mx-2 mb-2 text-xs text-sky-300/90">{searchNote}</p>}
                    {searching && results.length === 0 ? (
                        <div aria-label="Loading results" data-testid="search-loading" className="flex justify-center py-10"><Loader2 className="animate-spin text-purple-500" /></div>
                    ) : results.length > 0 ? (
                        <ul aria-label="Search results" className="space-y-2">
                            {results.map((r) => (
                                <li key={`${r.src}-${r.type}-${r.id}`}>
                                    <button type="button" onClick={() => setPicking(r)} className="group flex items-center gap-3 p-2 rounded-lg cursor-pointer border transition-all w-full text-left bg-zinc-900/50 border-transparent hover:bg-zinc-800 focus-visible:border-purple-500 outline-none">
                                        <img src={proxied(r.cover, 128)} alt="" referrerPolicy="no-referrer" loading="lazy" className="w-12 h-[72px] rounded-md object-contain bg-zinc-800 shrink-0" />
                                        <span className="min-w-0 flex-1 py-0.5">
                                            <span className="block text-sm font-medium leading-tight line-clamp-2 group-hover:text-purple-300">{r.title}</span>
                                            <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-500"><TypeBadge type={r.type} />{r.format && r.format !== "Manga" && <span>{r.format}</span>}{r.year && <span>{r.year}</span>}</span>
                                        </span>
                                        <Plus className="w-4 h-4 text-zinc-600 group-hover:text-purple-400 self-center shrink-0" />
                                    </button>
                                </li>
                            ))}
                        </ul>
                    ) : q.length >= 2 && searched && !searching && !searchError ? (
                        <div className="text-center py-10 px-4">
                            <div className="border border-dashed border-zinc-800 rounded-lg p-4 bg-zinc-900/20">
                                <p className="text-zinc-500 text-sm mb-3">No {TYPE_WORD[searchType]} matches “{searched}”. Try the English or Japanese title, or switch to another type.</p>
                                <button type="button" disabled={uploading} onClick={() => { setUploadTitle(searched); fileRef.current?.click(); }} className="text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-300 disabled:opacity-60">
                                    {/* Kept muted (T-0012 decision: upload is a last-resort fallback), inside waifu's dashed no-results box. */}
                                    {uploading ? "Checking & uploading…" : "Can't find it? Upload your own image"}
                                </button>
                            </div>
                        </div>
                    ) : !searchError ? (
                        <div className="text-center py-2 lg:py-10 px-4">
                            <p className="hidden lg:block text-zinc-500 text-sm mb-4">Search for your favorite anime, manga or light novel to start.</p>
                            <p className="text-xs text-zinc-600">Tip: select an empty slot first to put a title exactly there.</p>
                        </div>
                    ) : null}
                </div>
                {/* Waifu: Progress + actions in the left sidebar footer (desktop). */}
                {isDesktop && (
                    <div data-testid="left-footer" className="p-4 border-t border-zinc-800 bg-zinc-950/50 backdrop-blur shrink-0 max-h-[55vh] overflow-y-auto">
                        <div className="flex justify-between text-sm mb-2">
                            <span className="text-zinc-400">Progress</span>
                            <span className="font-bold text-purple-400">{filled}/{draft.size}</span>
                        </div>
                        <div className="h-1 bg-zinc-900 rounded-full overflow-hidden mb-4">
                            <div className="h-full bg-purple-500 transition-all duration-500" style={{ width: `${(filled / draft.size) * 100}%` }} />
                        </div>
                        {actions}
                    </div>
                )}
                <p className="hidden lg:block px-4 py-2 border-t border-zinc-800 text-[10px] text-zinc-600">Data from {source === "jikan" ? "MyAnimeList via Jikan" : "AniList"}. Images are safety-checked.</p>
            </aside>

            {/* MAIN: the board */}
            <main ref={canvasRef} data-testid="story-canvas" className="flex-1 min-w-0 lg:overflow-y-auto">
                <div className={cn("mx-auto p-3 sm:p-6 space-y-4", columns <= 3 ? "max-w-xl" : columns <= 5 ? "max-w-3xl" : columns <= 7 ? "max-w-4xl" : "max-w-5xl")}>
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="flex rounded-lg overflow-hidden border border-zinc-800" role="group" aria-label="Grid size">
                            {STORY_SIZES.map((s) => (
                                <button key={s} type="button" onClick={() => changeSize(s)} aria-pressed={draft.size === s && !draft.cols} className={cn("px-3 py-1.5 text-sm", draft.size === s && !draft.cols ? "bg-purple-600 text-white font-semibold" : "bg-zinc-900 text-zinc-400 hover:text-white")}>
                                    {STORY_SIZE_LABELS[s]}
                                </button>
                            ))}
                        </div>
                        <CustomSizeControl rows={Math.ceil(draft.size / columns)} cols={columns} active={!!draft.cols} onApply={(r, c) => changeSize(r * c, c)} />
                        <div className="flex rounded-lg overflow-hidden border border-zinc-800 text-xs" role="group" aria-label="Title position">
                            <span className="px-2 py-1.5 bg-zinc-950 text-zinc-500">Titles</span>
                            {TITLE_STYLES.map((t) => (
                                <button key={t} type="button" onClick={() => setDraft({ ...draft, titleStyle: t })} aria-pressed={draft.titleStyle === t} className={cn("px-2.5 py-1.5", draft.titleStyle === t ? "bg-zinc-700 text-white font-semibold" : "bg-zinc-900 text-zinc-400 hover:text-white")}>
                                    {TITLE_STYLE_LABELS[t]}
                                </button>
                            ))}
                        </div>
                        <span className="text-sm text-zinc-500 ml-auto tabular-nums">{filled}/{draft.size}</span>
                    </div>

                    {/* Title: prominent, labelled, and gently highlighted while empty (never required). */}
                    <div data-testid="title-field">
                        <label htmlFor="story-grid-title" className="flex items-center justify-between gap-2 mb-1.5 text-sm">
                            <span className="font-semibold text-zinc-200">Grid title <span className="font-normal text-purple-300/90">· recommended</span></span>
                            <span className="text-xs text-zinc-500 tabular-nums">{draft.title.length}/{SHARE_TITLE_MAX}</span>
                        </label>
                        <input
                            id="story-grid-title"
                            value={draft.title}
                            onChange={(e) => setDraft({ ...draft, title: e.target.value.slice(0, SHARE_TITLE_MAX) })}
                            placeholder="Name your grid, e.g. อนิเมะที่ชอบที่สุด 2026"
                            aria-label="Grid title"
                            aria-describedby="story-grid-title-hint"
                            data-empty={draft.title.trim() ? undefined : "true"}
                            className={cn(
                                "w-full px-4 py-3 rounded-xl bg-zinc-900 outline-none text-center text-lg font-bold transition-colors placeholder:font-medium placeholder:text-zinc-500",
                                draft.title.trim()
                                    ? "border border-zinc-700 focus:border-purple-500"
                                    : "border-2 border-dashed border-purple-500/60 bg-purple-500/5 focus:border-solid focus:border-purple-400 shadow-[0_0_0_3px_rgba(168,85,247,0.08)]"
                            )}
                        />
                        <p id="story-grid-title-hint" className={cn("mt-1.5 text-xs text-center", draft.title.trim() ? "text-zinc-600" : "text-purple-300/80")}>
                            {draft.title.trim() ? "Shown on your shared card and in the Community Showcase." : "Add a title so people know what your grid is about. It shows on your shared card."}
                        </p>
                    </div>

                    {/* Side gutter wider than the edge trash strips (32/56/80 px), so the outer columns never sit under a strip. */}
                    <div data-testid="board-frame" className={cn("p-1.5 sm:p-2 rounded-lg bg-zinc-900/50 border border-zinc-800", BOARD_GUTTER_CLASS)}>
                        <MediaGrid
                            items={draft.items}
                            columns={columns}
                            toCell={toCell}
                            editable
                            titleStyle={draft.titleStyle}
                            selected={selected}
                            onSelect={selectCell}
                            trashZone
                            trashCanvas={canvasRef}
                            onMove={(a, b) => {
                                setDraft({ ...draft, items: moveSlot(draft.items, a, b) });
                                afterBoardChange(false);
                            }}
                            onRemove={(i) => setDraft({ ...draft, items: draft.items.map((x, j) => (j === i ? null : x)) })}
                            renderEmpty={(i) => (
                                <span className={cn("absolute inset-0 flex items-center justify-center", selected === i ? "text-purple-300" : "text-zinc-700")}>
                                    <Plus className="w-5 h-5" />
                                </span>
                            )}
                        />
                    </div>
                    {filled === 0 && loaded && (
                        <p className="text-center text-sm text-zinc-500">Your board is empty. Search on the {""}<span className="lg:hidden">top</span><span className="hidden lg:inline">left</span> to add your first title.</p>
                    )}
                    {selected !== null && !draft.items[selected] && <p className="text-center text-xs text-purple-300">Slot {selected + 1} selected: your next pick goes here.</p>}

                    {!isDesktop && actions}
                </div>
            </main>

            {/* RIGHT: AI suggestions, like waifu's right sidebar. Docked at >=1280px; below that it opens as an
                overlay so the canvas and board keep their width (Esc / outside click closes). */}
            <aside data-testid="right-panel" data-mode={docked ? "docked" : overlay ? "overlay" : "collapsed"} className={cn("bg-zinc-950 border-t lg:border-t-0 border-l border-zinc-800 flex flex-col lg:h-screen z-20 shadow-xl shrink-0 transition-all duration-300", docked ? "w-full lg:w-80" : "h-14 w-full lg:w-12 lg:h-screen")}>
                {!docked && (
                    <div className="h-14 border-b border-zinc-800 flex items-center justify-between px-2 bg-zinc-900/50 shrink-0">
                        <button type="button" aria-label="Expand suggestions" aria-expanded={overlay} onClick={() => setShowRightPanel(true)} className="flex lg:flex-col items-center justify-center lg:justify-start w-full gap-2 h-full lg:pt-4 text-zinc-500 text-xs">
                            <ChevronLeft className="hidden lg:block" />
                            <ChevronUp className="lg:hidden" />
                            <span className="lg:hidden">AI Suggestions</span>
                        </button>
                    </div>
                )}
                {overlay && <div data-testid="right-panel-backdrop" aria-hidden="true" onClick={() => setShowRightPanel(false)} className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-[1px]" />}
                {/* One panel body, kept mounted (results survive); docked inside the aside or floating as an overlay. It never fetches by itself. */}
                <div
                    data-testid="right-panel-body"
                    role={overlay ? "dialog" : undefined}
                    aria-modal={overlay ? true : undefined}
                    aria-label={overlay ? "AI Suggestions" : undefined}
                    className={cn("flex-col", docked ? "flex flex-1 min-h-0" : overlay ? "flex fixed inset-y-0 right-0 z-[61] w-80 max-w-[85vw] bg-zinc-950 border-l border-zinc-800 shadow-2xl" : "hidden")}
                >
                    <div className="h-14 border-b border-zinc-800 flex items-center justify-between px-2 bg-zinc-900/50 shrink-0">
                        <PanelTabs tab={tab} onTab={openTab} />
                        <button type="button" aria-label="Collapse suggestions" onClick={() => setShowRightPanel(false)} className="p-2 hover:bg-zinc-800 rounded text-zinc-500">
                            {overlay ? <X className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </button>
                    </div>
                    <div className="flex-1 overflow-y-auto">
                        {/* Suggest stays mounted (its results survive a tab switch); hidden when another tab is up. */}
                        <div hidden={tab !== "suggestions"}>
                            <StorySuggest items={draft.items} onPick={(t) => { setQuery(t); searchRef.current?.focus(); if (overlay) setShowRightPanel(false); }} />
                        </div>
                        {tab === "community" && <StoryCommunity grids={community.grids} loading={community.loading} error={community.error} hasMore={community.next !== null} onLoadMore={() => community.next !== null && void loadCommunity(community.next)} onRefresh={() => void loadCommunity(0)} />}
                    </div>
                </div>
            </aside>

            <ConfirmModal
                accessible
                isOpen={!!confirm}
                onClose={() => setConfirm(null)}
                onConfirm={() => confirm?.onConfirm()}
                title={confirm?.title ?? ""}
                message={confirm?.message ?? ""}
                confirmText={confirm?.confirmText}
                variant={confirm?.variant ?? "danger"}
            />
            <StoryShareModal
                isOpen={shareOpen}
                onClose={() => setShareOpen(false)}
                hasItems={filled > 0}
                initialTitle={draft.title.trim()}
                onTitleUpdate={(t) => setDraft((d) => ({ ...d, title: t.slice(0, SHARE_TITLE_MAX) }))}
                onShare={share}
            />
            {notice && <StoryToast message={notice.message} type={notice.type} />}
            {hint === "search" && !picking && <SearchHint onClose={() => setHint(null)} anchor={() => document.querySelector('ul[aria-label="Search results"] > li')} />}
            {hint === "ai" && <AISuggestionHint onClose={() => setHint(null)} onTry={() => { setHint(null); setShowRightPanel(true); openTab("suggestions"); }} />}
            {hint === "image" && (
                <ChangeImageHint
                    onClose={() => {
                        setHint(null);
                        try { window.localStorage.setItem("story100-gallery-hint-dismissed", "true"); } catch { /* private mode */ }
                    }}
                />
            )}
            {picking && (
                <ImagePicker
                    key={`${picking.src}-${picking.type}-${picking.id}`}
                    item={picking}
                    current={replacingKey !== null && replacingKey === pickerKey(picking)}
                    onClose={() => {
                        setPicking(null);
                        // Same identity as the picker cache (src + type + id), not the id alone.
                        if (replacingKey !== null && replacingKey === pickerKey(picking)) {
                            setReplacing(null);
                            setSelected(null);
                        }
                    }}
                    onPick={(it) => {
                        if (place(it)) setPicking(null);
                    }}
                    onUpload={async (file, base) => {
                        const r = await uploadCover(file, base.title, base.type);
                        if (r.error || !r.item) return r.error ?? "Upload failed.";
                        if (place({ ...base, cover: r.item.cover })) setPicking(null);
                        return null;
                    }}
                />
            )}
        </div>
    );
}
