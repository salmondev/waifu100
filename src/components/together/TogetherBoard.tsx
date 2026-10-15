"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, Link2, Loader2, Search } from "lucide-react";
import { MediaGrid } from "@/components/grid/MediaGrid";
import { SearchModeToggle } from "@/components/story/SearchModeToggle";
import { TypeBadge } from "@/components/story/TypeBadge";
import { ImagePicker } from "@/components/story/ImagePicker";
import { CustomSizeControl } from "@/components/story/CustomSizeControl";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { SHOWCASE_LINK_CLASS } from "@/components/community/showcase-link";
import { proxied } from "@/lib/img-proxy";
import {
    STORY_SIZES,
    STORY_SIZE_LABELS,
    SHARE_TITLE_MAX,
    STORY_TITLE_MAX,
    TITLE_STYLES,
    TITLE_STYLE_LABELS,
    storyColumns,
    storySizeLabel,
    storyViewPath,
    type TitleStyle,
} from "@/lib/story/config";
import { SEARCH_DEBOUNCE_MS, storySearch, type SearchItem } from "@/lib/story/search";
import { applyTogetherOp, isWaifuCell, type TogetherItem, type TogetherKind, type TogetherOp, type TogetherState, type WaifuCell } from "@/lib/together/ops";
import { toStoredStoryCell, type MediaType } from "@/lib/share-schema";
import { ensureUserId, USER_ID_HEADER } from "@/lib/user-id";
import { friendlyError } from "@/lib/public-errors";
import { cn } from "@/lib/utils";

const HTTP = process.env.NEXT_PUBLIC_TOGETHER_HTTP || "http://127.0.0.1:3310";
const WS = process.env.NEXT_PUBLIC_TOGETHER_WS || "ws://127.0.0.1:3310";

interface Peer { id: string; name: string; color: string; owner: boolean }
interface Cursor { id: string; name: string; color: string; x: number; y: number }
interface Hold { id: string; color: string; name: string; index: number }

const storyCell = (i: TogetherItem) => ({ key: `${i.src ?? "anilist"}-${i.type}-${i.id}`, image: i.cover, label: i.title });
const waifuCell = (i: WaifuCell) => ({ key: `w-${i.mal_id}-${i.name}`, image: i.img, label: i.name });

/** A new session is an empty board on the room server. Nothing is copied from this browser's saved grid. */
export async function openTogetherRoom(kind: TogetherKind = "story"): Promise<string> {
    const res = await fetch(`${HTTP}/rooms`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind }) });
    if (!res.ok) throw new Error("room");
    const data = (await res.json()) as { code: string; ownerToken: string };
    sessionStorage.setItem(`together-owner:${data.code}`, data.ownerToken);
    return data.code;
}

export function TogetherBoard({ code }: { code: string }) {
    return <Room code={code} />;
}

function Room({ code }: { code: string }) {
    const stageRef = useRef<HTMLDivElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const cursorTargets = useRef(new Map<string, Cursor & { at: number }>());
    const cursorShown = useRef(new Map<string, { x: number; y: number }>());
    const cursorNodes = useRef(new Map<string, HTMLDivElement>());
    const cursorSend = useRef({ last: 0, timer: 0, x: 0, y: 0, queued: false });
    const [state, setState] = useState<TogetherState | null>(null);
    const [self, setSelf] = useState<Peer | null>(null);
    const [peers, setPeers] = useState<Peer[]>([]);
    const [remoteCursors, setRemoteCursors] = useState<Cursor[]>([]);
    const [holds, setHolds] = useState<Hold[]>([]);
    const [status, setStatus] = useState("Connecting…");
    const [drawer, setDrawer] = useState(false);
    const [query, setQuery] = useState("");
    const [searchType, setSearchType] = useState<MediaType>("ANIME");
    const [storyHits, setStoryHits] = useState<SearchItem[]>([]);
    const [waifuHits, setWaifuHits] = useState<{ mal_id: number; name: string; img: string; source?: string }[]>([]);
    const [searching, setSearching] = useState(false);
    const [picked, setPicked] = useState<number | null>(null);
    const [copied, setCopied] = useState(false);
    const [picking, setPicking] = useState<{ mode: "place"; item: SearchItem } | { mode: "cover"; index: number; item: TogetherItem } | null>(null);
    const [gallery, setGallery] = useState<{ mode: "place"; mal_id: number; name: string; source?: string } | { mode: "cover"; index: number; name: string; source?: string } | null>(null);
    const [images, setImages] = useState<{ url: string }[]>([]);
    const [imagesLoading, setImagesLoading] = useState(false);
    const [modeConfirm, setModeConfirm] = useState<TogetherKind | null>(null);
    const [shrink, setShrink] = useState<{ size: number; cols: number | null; lost: number } | null>(null);
    const [sharePath, setSharePath] = useState<string | null>(null);
    const [shareId, setShareId] = useState<string | null>(null);
    const [publishOpen, setPublishOpen] = useState(false);
    const [publishing, setPublishing] = useState(false);
    const [publishError, setPublishError] = useState<string | null>(null);
    const [endsAt, setEndsAt] = useState<number | null>(null);
    const [now, setNow] = useState(() => Date.now());

    const send = useCallback((msg: unknown) => {
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    }, []);

    const commit = useCallback((op: TogetherOp) => {
        setState((cur) => (cur && self ? applyTogetherOp(cur, op, self.owner) ?? cur : cur));
        send({ t: "op", op });
    }, [self, send]);

    useEffect(() => {
        const token = sessionStorage.getItem(`together-owner:${code}`) ?? "";
        const name = sessionStorage.getItem("together-name") ?? "";
        let socket: WebSocket;
        let closed = false;
        const connect = () => {
            socket = new WebSocket(WS);
            wsRef.current = socket;
            socket.onopen = () => {
                setStatus("");
                socket.send(JSON.stringify({ t: "join", code, token, name }));
            };
            socket.onmessage = (ev) => {
                const msg = JSON.parse(String(ev.data)) as Record<string, unknown>;
                const rememberShare = (kind: TogetherKind, id: unknown) => {
                    if (typeof id !== "string" || !id) return;
                    setShareId(id);
                    setSharePath(kind === "waifu" ? `/view/${id}` : storyViewPath(id));
                };
                if (msg.t === "welcome") {
                    const me = msg.self as Peer;
                    setSelf(me);
                    sessionStorage.setItem("together-name", me.name);
                    const incoming = msg.state as TogetherState & { expiresAt?: number; shareId?: unknown };
                    const kind = incoming.kind ?? "story";
                    setState({ ...incoming, kind, titleStyle: incoming.titleStyle ?? "overlay", cols: incoming.cols ?? null });
                    if (typeof incoming.expiresAt === "number") setEndsAt(incoming.expiresAt);
                    rememberShare(kind, incoming.shareId);
                    setPeers((msg.peers as Peer[]) ?? []);
                } else if (msg.t === "state") {
                    const next = msg as unknown as TogetherState & { expiresAt?: number; shareId?: unknown };
                    if (typeof next.expiresAt === "number") setEndsAt(next.expiresAt);
                    const kind = next.kind ?? "story";
                    rememberShare(kind, next.shareId);
                    setState((cur) => {
                        const merged = cur ? { ...cur, ...next, items: next.items } : next;
                        return { ...merged, kind: merged.kind ?? "story", titleStyle: merged.titleStyle ?? "overlay", cols: merged.cols ?? null };
                    });
                } else if (msg.t === "peers") {
                    setPeers(msg.peers as Peer[]);
                } else if (msg.t === "cursor") {
                    const c = msg as unknown as Cursor;
                    if (!c.id || !Number.isFinite(c.x) || !Number.isFinite(c.y)) return;
                    const known = cursorTargets.current.has(c.id);
                    cursorTargets.current.set(c.id, { ...c, at: performance.now() });
                    if (!known) setRemoteCursors((list) => list.some((x) => x.id === c.id) ? list : [...list, c]);
                } else if (msg.t === "hold") {
                    const h = msg as unknown as Hold & { index: number | null };
                    setHolds((list) => {
                        const rest = list.filter((x) => x.id !== h.id);
                        return h.index === null || h.index === undefined ? rest : [...rest, h];
                    });
                } else if (msg.t === "bye") {
                    const id = String(msg.id);
                    cursorTargets.current.delete(id);
                    cursorShown.current.delete(id);
                    setRemoteCursors((list) => list.filter((c) => c.id !== id));
                    setPeers((list) => list.filter((p) => p.id !== id));
                    setHolds((list) => list.filter((h) => h.id !== id));
                } else if (msg.t === "ended") {
                    setEndsAt(Date.now());
                    setStatus("This session has ended.");
                } else if (msg.t === "error") {
                    setStatus(String(msg.error ?? "Couldn't join this room."));
                }
            };
            socket.onclose = () => { if (!closed) { setStatus("Reconnecting…"); window.setTimeout(connect, 800); } };
        };
        connect();
        const clock = window.setInterval(() => setNow(Date.now()), 1000);
        return () => {
            closed = true;
            window.clearInterval(clock);
            window.clearTimeout(cursorSend.current.timer);
            wsRef.current?.close();
        };
    }, [code]);

    useEffect(() => {
        let frame = 0;
        const tick = () => {
            const stage = stageRef.current;
            const w = stage?.clientWidth ?? 0;
            const h = stage?.clientHeight ?? 0;
            const now = performance.now();
            if (w > 0 && h > 0) {
                for (const [id, target] of cursorTargets.current) {
                    const el = cursorNodes.current.get(id);
                    if (!el) continue;
                    const prev = cursorShown.current.get(id);
                    const dx = prev ? target.x - prev.x : 0;
                    const dy = prev ? target.y - prev.y : 0;
                    const shown = !prev || dx * dx + dy * dy > 0.08
                        ? { x: target.x, y: target.y }
                        : { x: prev.x + dx * 0.55, y: prev.y + dy * 0.55 };
                    cursorShown.current.set(id, shown);
                    el.style.transform = `translate3d(${shown.x * w}px, ${shown.y * h}px, 0)`;
                    const name = el.querySelector("[data-cursor-name]") as HTMLElement | null;
                    if (name) name.style.opacity = now - target.at < 1200 ? "1" : "0";
                }
            }
            frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, []);

    useEffect(() => {
        const q = query.trim();
        if (!state || q.length < 2) {
            setStoryHits([]);
            setWaifuHits([]);
            return;
        }
        const ctrl = new AbortController();
        const t = window.setTimeout(() => {
            setSearching(true);
            if (state.kind === "story") {
                storySearch.search(q, ctrl.signal, searchType).then((r) => setStoryHits(r.items)).catch(() => setStoryHits([])).finally(() => setSearching(false));
            } else {
                fetch("/api/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ characterName: q }), signal: ctrl.signal })
                    .then((r) => r.ok ? r.json() : { characters: [] })
                    .then((data) => setWaifuHits((data.characters ?? []).map((c: { id: number; name: string; images?: { jpg?: { image_url?: string } }; source?: string }) => ({ mal_id: c.id, name: c.name, img: c.images?.jpg?.image_url ?? "", source: c.source }))))
                    .catch(() => setWaifuHits([]))
                    .finally(() => setSearching(false));
            }
        }, SEARCH_DEBOUNCE_MS);
        return () => { ctrl.abort(); window.clearTimeout(t); };
    }, [query, searchType, state?.kind]);

    useEffect(() => {
        if (!gallery) return;
        const ctrl = new AbortController();
        setImagesLoading(true);
        fetch("/api/gallery", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ characterName: gallery.name, animeSource: gallery.source }), signal: ctrl.signal })
            .then((r) => r.ok ? r.json() : { images: [] })
            .then((data) => setImages((data.images ?? []).map((img: { url?: string }) => ({ url: img.url ?? "" })).filter((img: { url: string }) => img.url)))
            .catch(() => setImages([]))
            .finally(() => setImagesLoading(false));
        return () => ctrl.abort();
    }, [gallery]);

    const placeStory = (index: number, item: SearchItem) => {
        const cell: TogetherItem = { id: item.id, type: item.type, title: item.title, cover: item.cover, src: item.src ?? "anilist" };
        commit({ t: "place", i: index, item: cell });
        setPicked(null);
    };
    const requestLayout = (size: number, cols: number | null) => {
        if (!state) return;
        const lost = state.items.slice(size).filter(Boolean).length;
        if (lost > 0) setShrink({ size, cols, lost });
        else commit({ t: "layout", size, cols });
    };
    const publish = async () => {
        if (!state || publishing || state.items.every((cell) => !cell)) return;
        const userId = ensureUserId();
        const kind = state.kind ?? "story";
        const grid = kind === "story"
            ? state.items.flatMap((cell, i) => (!cell || isWaifuCell(cell) ? [] : [toStoredStoryCell(i, cell)]))
            : state.items.flatMap((cell, i) => (!cell || !isWaifuCell(cell) ? [] : [{ i, m: cell.mal_id, n: cell.name, img: cell.img, s: cell.source }]));
        const body = { kind, size: state.size, ...(state.cols ? { cols: state.cols } : {}), grid, customTitle: state.title || undefined, titleStyle: state.titleStyle, userId, together: true };
        setPublishing(true);
        setPublishError(null);
        const res = await fetch(shareId ? `/api/share/${shareId}` : "/api/share", {
            method: shareId ? "PUT" : "POST",
            headers: { "Content-Type": "application/json", ...(userId ? { [USER_ID_HEADER]: userId } : {}) },
            body: JSON.stringify(body),
        }).catch(() => null);
        const data = await res?.json().catch(() => ({}));
        setPublishing(false);
        if (!res || !res.ok || !data?.id) {
            setPublishError(friendlyError(data?.error, "Couldn't publish this grid."));
            return;
        }
        setShareId(data.id);
        setSharePath(data.url || (kind === "story" ? storyViewPath(data.id) : `/view/${data.id}`));
        send({ t: "published", id: data.id });
    };
    const placeWaifu = (index: number, item: { mal_id: number; name: string; img: string; source?: string }) => {
        if (!item.img) return;
        commit({ t: "place", i: index, item });
        setPicked(null);
    };
    const firstEmpty = () => (picked !== null && state && state.items[picked] === null ? picked : state?.items.findIndex((x) => x === null) ?? -1);

    const onSelect = (index: number) => {
        if (!state) return;
        const cell = state.items[index];
        if (!cell) {
            setPicked(index);
            setDrawer(true);
            window.setTimeout(() => searchRef.current?.focus(), 50);
            return;
        }
        if (isWaifuCell(cell)) setGallery({ mode: "cover", index, name: cell.name, source: cell.source });
        else setPicking({ mode: "cover", index, item: cell });
    };

    if (!state || !self) {
        return <div className="min-h-screen bg-black text-zinc-300 grid place-items-center"><p>{status || "Joining…"}</p></div>;
    }

    const columns = storyColumns(state.size, state.cols);
    const remain = endsAt == null ? null : Math.max(0, endsAt - now);
    const clock = remain == null ? "6:00:00" : `${Math.floor(remain / 3600000)}:${String(Math.floor((remain % 3600000) / 60000)).padStart(2, "0")}:${String(Math.floor((remain % 60000) / 1000)).padStart(2, "0")}`;
    const filled = state.items.filter(Boolean).length;
    const holdAt = new Map(holds.map((h) => [h.index, h]));
    const cells = state.items.map((cell) => {
        if (!cell) return null;
        return isWaifuCell(cell) ? waifuCell(cell) : storyCell(cell);
    });

    return (
        <div ref={stageRef} onPointerMove={(e) => {
            const box = stageRef.current?.getBoundingClientRect();
            if (!box || box.width === 0 || box.height === 0) return;
            const x = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
            const y = Math.min(1, Math.max(0, (e.clientY - box.top) / box.height));
            const slot = cursorSend.current;
            slot.x = x;
            slot.y = y;
            const now = performance.now();
            const wait = 50 - (now - slot.last);
            const flush = () => {
                slot.queued = false;
                slot.last = performance.now();
                send({ t: "cursor", x: slot.x, y: slot.y });
            };
            if (wait <= 0) flush();
            else if (!slot.queued) {
                slot.queued = true;
                slot.timer = window.setTimeout(flush, wait);
            }
        }} onPointerDown={(e) => {
            const slot = (e.target as HTMLElement).closest?.("[data-slot]");
            const index = slot ? Number(slot.getAttribute("data-slot")) : null;
            send({ t: "hold", index: index !== null && state.items[index] ? index : null });
        }} onPointerUp={() => send({ t: "hold", index: null })} className="relative min-h-screen w-full overflow-hidden bg-[#101014] text-white" style={{ backgroundImage: "radial-gradient(rgba(255,255,255,0.07) 1px, transparent 1px)", backgroundSize: "22px 22px" }}>
            <header className="relative z-20 flex items-center justify-between gap-3 border-b border-white/10 bg-black/30 px-4 py-3 sm:px-6">
                <div className="flex min-w-0 items-center gap-3">
                    <button type="button" onClick={() => setDrawer((v) => !v)} className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 hover:border-zinc-600"><Search className="h-4 w-4" /> Search</button>
                    <div className="flex min-w-0 items-center gap-4 text-sm text-zinc-300">
                        <span className="inline-flex items-center gap-2">
                            <span className="rounded-md border border-purple-400/25 bg-gradient-to-r from-purple-500/20 to-pink-500/15 px-2.5 py-1 text-xs font-semibold tracking-wide text-purple-100">Online session</span>
                            <span className={cn("text-sm font-medium tabular-nums tracking-wide", remain === 0 ? "text-zinc-500" : "text-amber-300")}>{remain === 0 ? "ended" : clock}</span>
                        </span>
                        {peers.map((p) => (
                            <span key={p.id} className="inline-flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: p.color, boxShadow: `0 0 8px ${p.color}` }} />{p.name}{p.id === self.id ? " (you)" : ""}{p.owner ? " · host" : ""}</span>
                        ))}
                    </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    {self.owner && (
                        <button type="button" disabled={filled === 0 || publishing} onClick={() => setPublishOpen(true)} className="inline-flex items-center gap-2 rounded-lg border border-sky-500/30 bg-sky-500/20 px-3 py-2 text-sm font-medium text-sky-300 hover:bg-sky-500/30 disabled:opacity-50">
                            {publishing ? "Publishing…" : sharePath ? "Update share" : "Publish"}
                        </button>
                    )}
                    <Link href={state.kind === "waifu" ? "/community" : "/community?kind=story"} target="_blank" rel="noreferrer" className={cn("inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm", SHOWCASE_LINK_CLASS)}>Community Showcase</Link>
                    <button type="button" onClick={() => { navigator.clipboard.writeText(window.location.href).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); }).catch(() => undefined); }} className={cn("inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors", copied ? "border border-green-500/20 bg-green-500/20 text-green-400" : "border border-transparent bg-purple-600/20 text-purple-400 hover:bg-purple-600/30")}>
                        {copied ? <Check size={18} /> : <Link2 size={18} />}
                        {copied ? "Link copied" : "Copy shared link"}
                    </button>
                    <Link href={state.kind === "waifu" ? "/" : "/story"} className="px-2 text-sm text-zinc-500 hover:text-zinc-300">Leave</Link>
                </div>
            </header>
            <aside className={cn("absolute bottom-0 left-0 top-0 z-30 flex w-full max-w-sm flex-col border-r border-zinc-800 bg-zinc-950/95 backdrop-blur transition-transform", drawer ? "translate-x-0" : "-translate-x-full")}>
                <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
                    <p className="text-sm font-semibold">Search</p>
                    <button type="button" aria-label="Close search" onClick={() => setDrawer(false)} className="text-xs text-zinc-400 hover:text-white">Close</button>
                </div>
                <div className="px-4 pt-4 pb-2">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                        <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={state.kind === "waifu" ? "Search characters" : "Search titles"} placeholder={state.kind === "waifu" ? "Search Character..." : "Search anime, manga, light novel"} className="w-full bg-zinc-900 border border-zinc-700 rounded-lg py-2 pl-10 pr-4 outline-none focus:ring-2 focus:ring-purple-500" />
                    </div>
                    {state.kind === "story" && <SearchModeToggle value={searchType} onChange={setSearchType} />}
                    <p className="mt-2 text-[11px] text-zinc-500">{picked !== null ? `Next pick goes in slot ${picked + 1}.` : state.kind === "waifu" ? "Click a character to choose a picture, then it lands on the grid." : "Click a title to choose its cover, then it lands on the grid."}</p>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-6">
                    {searching && <div className="flex justify-center py-10"><Loader2 className="animate-spin text-purple-500" /></div>}
                    {state.kind === "story" ? (
                        <ul className="space-y-2">
                            {storyHits.map((r) => (
                                <li key={`${r.src}-${r.type}-${r.id}`}>
                                    <button type="button" onClick={() => { setDrawer(false); setPicking({ mode: "place", item: r }); }} className="group flex w-full items-center gap-3 rounded-lg border border-transparent bg-zinc-900/50 p-2 text-left hover:bg-zinc-800">
                                        <img src={proxied(r.cover, 128)} alt="" className="h-[72px] w-12 rounded-md bg-zinc-800 object-contain" />
                                        <span className="min-w-0 flex-1"><span className="block text-sm font-medium line-clamp-2">{r.title}</span><span className="mt-1 inline-flex"><TypeBadge type={r.type} /></span></span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <ul className="space-y-2">
                            {waifuHits.map((r) => (
                                <li key={`${r.mal_id}-${r.name}`}>
                                    <button type="button" onClick={() => { setDrawer(false); setGallery({ mode: "place", mal_id: r.mal_id, name: r.name, source: r.source }); }} className="flex w-full items-center gap-3 rounded-lg bg-zinc-900/50 p-2 text-left hover:bg-zinc-800">
                                        <img src={proxied(r.img, 128)} alt="" className="h-20 w-16 rounded-lg bg-zinc-800 object-contain" />
                                        <span className="min-w-0"><span className="block truncate text-sm font-medium">{r.name}</span><span className="block truncate text-xs text-zinc-500">{r.source}</span></span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </aside>

            <div className={cn("relative z-10 mx-auto w-full px-4 pb-16 pt-6 sm:px-6", columns <= 3 ? "max-w-3xl" : columns <= 5 ? "max-w-5xl" : "max-w-6xl")}>
                <h1 className="bg-gradient-to-r from-purple-400 via-pink-500 to-purple-400 bg-clip-text text-sm font-bold uppercase tracking-[0.18em] text-transparent">build grid together</h1>
                    {self.owner ? (
                        <div className="mt-4 flex flex-wrap items-center gap-2">
                            <div className="flex overflow-hidden rounded-lg border border-zinc-800" role="group" aria-label="Mode">
                                {(["story", "waifu"] as const).map((k) => (
                                    <button key={k} type="button" aria-pressed={(state.kind ?? "story") === k} onClick={() => { if (k === (state.kind ?? "story")) return; if (filled === 0) commit({ t: "kind", kind: k }); else setModeConfirm(k); }} className={cn("px-3 py-1.5 text-sm", (state.kind ?? "story") === k ? "bg-purple-600 font-semibold text-white" : "bg-zinc-900 text-zinc-400 hover:text-white")}>{k === "story" ? "Story" : "Waifu"}</button>
                                ))}
                            </div>
                            <div className="flex overflow-hidden rounded-lg border border-zinc-800" role="group" aria-label="Grid size">
                                {STORY_SIZES.map((s) => (
                                    <button key={s} type="button" aria-pressed={state.size === s && !state.cols} onClick={() => requestLayout(s, null)} className={cn("px-3 py-1.5 text-sm", state.size === s && !state.cols ? "bg-purple-600 font-semibold text-white" : "bg-zinc-900 text-zinc-400 hover:text-white")}>{STORY_SIZE_LABELS[s]}</button>
                                ))}
                            </div>
                            <CustomSizeControl rows={Math.ceil(state.size / columns)} cols={columns} active={!!state.cols} onApply={(r, c) => requestLayout(r * c, c)} />
                            <div className="flex overflow-hidden rounded-lg border border-zinc-800 text-xs" role="group" aria-label="Title position">
                                <span className="bg-zinc-950 px-2 py-1.5 text-zinc-500">Titles</span>
                                {TITLE_STYLES.map((t) => (
                                    <button key={t} type="button" aria-pressed={(state.titleStyle ?? "overlay") === t} onClick={() => commit({ t: "style", titleStyle: t })} className={cn("px-2.5 py-1.5", (state.titleStyle ?? "overlay") === t ? "bg-purple-600 font-semibold text-white" : "bg-zinc-900 text-zinc-400 hover:text-white")}>{TITLE_STYLE_LABELS[t]}</button>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="mt-4 flex flex-wrap items-center gap-2">
                            <span className={cn("text-sm font-bold bg-clip-text text-transparent", (state.kind ?? "story") === "waifu" ? "bg-gradient-to-r from-purple-400 to-pink-500" : "bg-gradient-to-r from-sky-400 to-purple-500")}>{(state.kind ?? "story") === "waifu" ? "Waifu100" : "Story100"}</span>
                            <span className="rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-300">{storySizeLabel(state.size, state.cols)}</span>
                            {(state.kind ?? "story") === "waifu" ? (
                                <span className="inline-flex items-center gap-2 rounded-lg border border-pink-500/30 bg-pink-500/10 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-pink-300">Characters <span className="text-sm tabular-nums text-white">{state.items.filter((c) => c && isWaifuCell(c)).length}</span></span>
                            ) : (
                                ([["ANIME", "Anime", "border-sky-500/30 bg-sky-500/10 text-sky-300"], ["MANGA", "Manga", "border-pink-500/30 bg-pink-500/10 text-pink-300"], ["NOVEL", "Light novel", "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"]] as const).map(([type, label, tone]) => (
                                    <span key={type} className={cn("inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-bold uppercase tracking-wide", tone)}>
                                        {label}
                                        <span className="text-sm tabular-nums text-white">{state.items.filter((c) => c && !isWaifuCell(c) && c.type === type).length}</span>
                                    </span>
                                ))
                            )}
                        </div>
                    )}
                    <div className="mt-4">
                        <label htmlFor="together-grid-title" className="mb-1.5 flex items-center justify-between gap-2 text-sm">
                            <span className="font-semibold text-zinc-200">Grid title <span className="font-normal text-purple-300/90">· recommended</span></span>
                            <span className="tabular-nums text-xs text-zinc-500">{state.title.length}/{SHARE_TITLE_MAX}</span>
                        </label>
                        {self.owner ? (
                            <input
                                id="together-grid-title"
                                aria-label="Grid title"
                                value={state.title}
                                maxLength={STORY_TITLE_MAX}
                                placeholder="Name your grid, e.g. อนิเมะที่ชอบที่สุด 2026"
                                onChange={(e) => { const title = e.target.value.slice(0, STORY_TITLE_MAX); setState((cur) => cur ? { ...cur, title } : cur); send({ t: "op", op: { t: "title", title } }); }}
                                className={cn("w-full rounded-xl bg-zinc-900 px-4 py-3 text-center text-lg font-bold outline-none transition-colors placeholder:font-medium placeholder:text-zinc-500", state.title.trim() ? "border border-zinc-700 focus:border-purple-500" : "border-2 border-dashed border-purple-500/60 bg-purple-500/5 focus:border-solid focus:border-purple-400")}
                            />
                        ) : (
                            <p className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-center text-lg font-bold">{state.title || "Untitled grid"}</p>
                        )}
                    </div>
                    <div className="relative mt-4 w-full [&_[data-slot]]:shadow-[0_0_0_1px_rgba(255,255,255,0.04),0_0_22px_rgba(168,85,247,0.16)]">
                        <MediaGrid
                            items={cells}
                            columns={columns}
                            toCell={(c) => c!}
                            aspect={state.kind === "waifu" ? "square" : "portrait"}
                            editable
                            selected={picked}
                            titleStyle={state.titleStyle}
                            showRank
                            onSelect={onSelect}
                            onMove={(from, to) => commit({ t: "swap", from, to })}
                            onRemove={(i) => commit({ t: "lift", i })}
                        />
                        <div className="pointer-events-none absolute inset-0 grid gap-1.5" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
                            {state.items.map((_, i) => {
                                const h = holdAt.get(i);
                                return <div key={i} className={state.kind === "waifu" ? "aspect-square" : "aspect-[2/3]"} style={h ? { boxShadow: `inset 0 0 0 2px ${h.color}` } : undefined} />;
                            })}
                        </div>
                    </div>
                    <p className="mt-6 text-center text-xs text-zinc-500">{filled}/{state.size} · drag a cover to another slot · click one to change its picture</p>
            </div>

            <div className="pointer-events-none absolute inset-0 z-40 overflow-hidden">
                {remoteCursors.filter((c) => c.id !== self.id).map((c) => (
                    <div
                        key={c.id}
                        ref={(node) => { if (node) cursorNodes.current.set(c.id, node); else cursorNodes.current.delete(c.id); }}
                        className="absolute left-0 top-0 will-change-transform"
                    >
                        <span aria-hidden className="absolute left-0 top-1 h-3.5 w-3.5 rounded-full" style={{ background: `radial-gradient(circle, ${c.color}88 0%, transparent 70%)` }} />
                        <svg width="16" height="16" viewBox="0 0 24 24" className="relative" style={{ color: c.color }}>
                            <path fill="currentColor" d="M5 2.5 19.5 12 12 13.2 9.2 21.5 5 2.5Z" />
                        </svg>
                        <span data-cursor-name className="ml-3 inline-block rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-zinc-950 opacity-0 transition-opacity duration-500" style={{ background: c.color }}>{c.name}</span>
                    </div>
                ))}
            </div>

            {publishError ? (
                <p className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 text-xs text-amber-300">{publishError}</p>
            ) : sharePath ? (
                <p className="pointer-events-auto absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-300"><a className="text-sky-300 hover:underline" href={sharePath}>{sharePath}</a></p>
            ) : null}
            <ConfirmModal
                isOpen={publishOpen}
                accessible
                variant="info"
                title={sharePath ? "Update the share?" : "Publish this grid?"}
                message={sharePath ? "The existing share link will show this board, including in the Community Showcase." : "This saves the board as a share link and adds it to the Community Showcase."}
                confirmText={sharePath ? "Update share" : "Publish"}
                cancelText="Cancel"
                onClose={() => setPublishOpen(false)}
                onConfirm={() => { void publish(); }}
            />
            <ConfirmModal
                isOpen={shrink !== null}
                accessible
                variant="warning"
                title="Shrink the grid?"
                message={shrink ? `This removes ${shrink.lost} ${shrink.lost === 1 ? "cell" : "cells"} from the end for everyone in the session.` : ""}
                confirmText="Shrink"
                cancelText="Keep size"
                onClose={() => setShrink(null)}
                onConfirm={() => { if (shrink) commit({ t: "layout", size: shrink.size, cols: shrink.cols }); }}
            />
            <ConfirmModal
                isOpen={modeConfirm !== null}
                accessible
                variant="warning"
                title="Switch mode?"
                message="Story and waifu can't share one board, so the grid will be cleared."
                confirmText={modeConfirm === "waifu" ? "Switch to Waifu" : "Switch to Story"}
                cancelText="Stay"
                onClose={() => setModeConfirm(null)}
                onConfirm={() => { if (modeConfirm) commit({ t: "kind", kind: modeConfirm }); }}
            />
            {picking && (
                <ImagePicker
                    item={picking.item}
                    current={picking.mode === "cover"}
                    onClose={() => setPicking(null)}
                    onPick={(it) => {
                        if (picking.mode === "cover") commit({ t: "cover", i: picking.index, cover: it.cover });
                        else {
                            const slot = firstEmpty();
                            if (slot >= 0) placeStory(slot, { ...picking.item, cover: it.cover, src: it.src ?? picking.item.src });
                        }
                        setPicking(null);
                    }}
                    onUpload={async (file, base) => {
                        const form = new FormData();
                        form.set("file", file);
                        form.set("title", base.title);
                        form.set("type", base.type);
                        const res = await fetch("/api/story/upload", { method: "POST", body: form }).catch(() => null);
                        const data = await res?.json().catch(() => ({}));
                        if (!res || !res.ok || !data?.item?.cover) return data?.error || "Upload failed.";
                        if (picking.mode === "cover") commit({ t: "cover", i: picking.index, cover: data.item.cover });
                        else {
                            const slot = firstEmpty();
                            if (slot >= 0) commit({ t: "place", i: slot, item: { ...base, cover: data.item.cover, src: "upload" } });
                        }
                        setPicking(null);
                        return null;
                    }}
                />
            )}
            {gallery && (
                <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 sm:items-center" onClick={() => setGallery(null)}>
                    <div className="max-h-[70vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-zinc-800 bg-zinc-950 p-4 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
                        <p className="mb-3 text-sm font-semibold">{gallery.mode === "place" ? `Choose a picture for ${gallery.name}` : "Change image"}</p>
                        {imagesLoading && <Loader2 className="mx-auto my-6 h-5 w-5 animate-spin text-purple-400" />}
                        <ul className="grid grid-cols-3 gap-2">
                            {images.map((img) => (
                                <li key={img.url}>
                                    <button type="button" onClick={() => {
                                        if (gallery.mode === "cover") commit({ t: "cover", i: gallery.index, cover: img.url });
                                        else { const slot = firstEmpty(); if (slot >= 0) placeWaifu(slot, { mal_id: gallery.mal_id, name: gallery.name, img: img.url, source: gallery.source }); }
                                        setGallery(null);
                                    }} className="block w-full">
                                        <img src={proxied(img.url, 256)} alt="" className="aspect-square w-full rounded-md bg-zinc-900 object-contain" />
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
            )}
        </div>
    );
}
