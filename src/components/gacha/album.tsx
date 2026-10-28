"use client";
/**
 * /daily album (ported from the v2 prototype album.js): one binder page per
 * anime. Owned characters are mini cards in their kept tier; missing pockets
 * show the card back with the printed number. The story slot unlocks at 3.
 * Below the binder: the recovery code panel (inline, no dialogs).
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@animate-ui/react/primitives/tabs";
import { errorText, gachaApi, setGachaId, type AlbumDto, type RoundDto } from "./api";
import { cardBackHtml, cardHtml, cardMiniHtml, CardHtml, storyCardHtml } from "./card";
import { animeSubtitle, animeTitle } from "./chrome";
import { storyColours } from "./palette";
import { placeCharacterOnWaifuGrid, WAIFU_GRID_KEY } from "@/lib/waifu-board";
import { Icon, Px, SETSYM, TIER_NAME, type TierName } from "./pixel";

const UNLOCK = 3;

function placeOnGrid(name: string, id: number, image: string): string {
    try {
        const next = placeCharacterOnWaifuGrid(localStorage.getItem(WAIFU_GRID_KEY), {
            mal_id: id,
            name,
            images: { jpg: { image_url: image } },
            source: "Gacha Guess",
        });
        if (next.placed) localStorage.setItem(WAIFU_GRID_KEY, next.stored);
        if (next.full) return "กริดเต็มแล้ว";
        return next.placed ? `ใส่ ${name} ในกริดแล้ว` : `${name} อยู่ในกริดแล้ว`;
    } catch {
        return "ใส่กริดไม่ได้";
    }
}
type Group = AlbumDto["anime"][number];

/** Same text as the win-screen share: tier, name, the day they got it, and the card link. */
function CardDayShare({ day }: { day: string }) {
    const [state, setState] = useState<"idle" | "busy" | "ok" | "fail">("idle");
    const [fallback, setFallback] = useState<string | null>(null);
    const share = async () => {
        if (state === "busy") return;
        setState("busy");
        setFallback(null);
        try {
            const { text } = await gachaApi.cardShare(day);
            try {
                await navigator.clipboard.writeText(text);
                setState("ok");
            } catch {
                setFallback(text);
                setState("fail");
            }
        } catch {
            setState("fail");
        }
    };
    return (
        <>
            <button className="g-btn red" type="button" onClick={share} disabled={state === "busy"}>
                {state === "ok" ? "คัดลอกแล้ว" : "แชร์"}
            </button>
            {state === "fail" && !fallback && <p className="g-note">แชร์ไม่ได้</p>}
            {fallback && (
                <label className="g-sharebox">
                    <span>คัดลอกเองจากช่องนี้</span>
                    <textarea readOnly rows={fallback.split("\n").length} value={fallback} onFocus={(e) => e.currentTarget.select()} />
                </label>
            )}
        </>
    );
}

export function AlbumView({ album, round, animeParam, onRestored }: { album: AlbumDto; round: RoundDto | null; animeParam: number | null; onRestored: () => void }) {
    const router = useRouter();
    const groups: Group[] = [...album.anime];
    // today's anime always has a page, even before the first card from it
    if (round && !groups.some((g) => g.id === round.anime.id)) {
        groups.unshift({
            id: round.anime.id,
            titleRomaji: round.anime.titleRomaji,
            titleEnglish: round.anime.titleEnglish,
            titleNative: round.anime.titleNative,
            cover: round.anime.cover,
            coverColor: round.anime.coverColor,
            setCode: round.anime.setCode,
            owned: 0,
            total: round.anime.characterCount,
            story: { unlocked: false, fresh: false },
            cards: [],
        });
    }
    const current = groups.find((g) => g.id === animeParam) ?? groups[0] ?? null;
    const binder = useRef<HTMLElement>(null);
    // Story cards the player tapped this session. The server only forgets
    // "new" on that explicit tap (POST /api/gacha/story-seen), never on load.
    const [seen, setSeen] = useState<ReadonlySet<number>>(() => new Set());
    const markSeen = (animeId: number) => {
        if (seen.has(animeId)) return;
        setSeen((s) => new Set(s).add(animeId));
        gachaApi.storySeen(animeId).catch(() => {
            // not saved: show it as new again so the next tap retries
            setSeen((s) => {
                const next = new Set(s);
                next.delete(animeId);
                return next;
            });
        });
    };

    // cards take their size from --w in px: size each to its pocket (prototype fit())
    useEffect(() => {
        const el = binder.current;
        if (!el) return;
        const fit = () => {
            el.querySelectorAll<HTMLElement>(".g-pocket").forEach((p) => {
                const c = p.querySelector<HTMLElement>(".c2");
                if (c && p.clientWidth) c.style.setProperty("--w", `${p.clientWidth}px`);
            });
            const slot = el.querySelector<HTMLElement>(".g-slot");
            const sc = slot?.querySelector<HTMLElement>(".c2");
            if (slot && sc) {
                const wide = innerWidth >= 900;
                sc.style.setProperty("--w", `${Math.min(wide ? 340 : 260, slot.clientWidth - (wide ? 8 : 40))}px`);
            }
        };
        fit();
        const ro = new ResizeObserver(fit);
        ro.observe(el);
        return () => ro.disconnect();
    }, [current?.id, album]);

    return (
        <main className="g-album">
            <header className="g-ahead win">
                <div>
                    <h1>อัลบั้ม</h1>
                    <p>การ์ด <b>{album.owned}</b> ใบ · ครบชุด <b>{album.badges ?? 0}</b> เรื่อง</p>
                </div>
                <Link className="g-btn sm" href="/daily" scroll={false}><Icon name="back" />กลับไปเล่น</Link>
            </header>
            {groups.length > 0 && current ? (
                <>
                    {/* Only the selected story's binder is rendered, so only its tab points at a panel. */}
                    <Tabs value={String(current.id)} onValueChange={(v) => router.replace(`/daily?view=album&anime=${v}`, { scroll: false })}>
                        <TabsList className="g-tabs" aria-label="เรื่อง">
                            {groups.map((g) => {
                                const on = g.id === current.id;
                                return (
                                    <TabsTrigger
                                        key={g.id}
                                        value={String(g.id)}
                                        id={`${TAB_ID}-${g.id}`}
                                        aria-controls={on ? PANEL_ID : undefined}
                                        className={`g-tab${on ? " on" : ""}`}
                                    >
                                        <Px rows={SETSYM[g.id % SETSYM.length]} className="sym" />
                                        <span>{animeTitle(g)}</span>
                                        <b>{g.owned}/{g.total}</b>
                                    </TabsTrigger>
                                );
                            })}
                        </TabsList>
                    </Tabs>
                    <div role="tabpanel" id={PANEL_ID} aria-labelledby={`${TAB_ID}-${current.id}`} tabIndex={0} className="g-tabpanel">
                        <Binder g={current} binderRef={binder} fresh={current.story.fresh && !seen.has(current.id)} onSeen={markSeen} />
                    </div>
                </>
            ) : (
                <section className="g-binder win"><p className="g-note">ยังไม่มีการ์ด</p></section>
            )}
            <Recovery onRestored={onRestored} />
        </main>
    );
}

const TAB_ID = "g-album-tab";
const PANEL_ID = "g-album-panel";

function Binder({ g, binderRef, fresh, onSeen }: { g: Group; binderRef: React.RefObject<HTMLElement | null>; fresh: boolean; onSeen: (animeId: number) => void }) {
    const colours = storyColours(g.coverColor);
    const [gridNote, setGridNote] = useState<string | null>(null);
    const [open, setOpen] = useState<Group["cards"][number] | null>(null);
    const byNo = new Map(g.cards.map((c) => [c.number, c]));
    const title = animeTitle(g);
    const openTier = (open?.tier ?? "common") as TierName;
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") setOpen(null);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open]);
    return (
        <section className="g-binder win" ref={binderRef} style={{ ["--story" as string]: colours.frame }} aria-label={`อัลบั้ม ${title}`}>
            <div className="g-blabel"><b>{title}</b><span>{g.setCode}</span>{g.story.unlocked && <b className="g-tag">ครบชุด</b>}<em>{g.owned}/{g.total}</em></div>
            <div className="g-slot">
                {g.story.unlocked ? (
                    <div
                        className={fresh ? "g-storytap" : undefined}
                        role={fresh ? "button" : undefined}
                        tabIndex={fresh ? 0 : undefined}
                        aria-label={fresh ? `สตอรี่การ์ดใหม่ ${title} แตะเพื่อเก็บ` : undefined}
                        onClick={fresh ? () => onSeen(g.id) : undefined}
                        onKeyDown={fresh ? (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSeen(g.id)) : undefined}
                    >
                        {fresh && <b className="g-tag new g-fresh">ใหม่ · แตะเพื่อเก็บ</b>}
                        <CardHtml
                            html={storyCardHtml({
                                id: g.id,
                                title,
                                subtitle: animeSubtitle(g),
                                cover: g.cover,
                                coverColor: g.coverColor,
                                setCode: g.setCode,
                                total: g.total,
                                owned: g.cards,
                            })}
                        />
                    </div>
                ) : (
                    <div className="g-locked">
                        <Icon name="lock" />
                        <div>
                            <b>สตอรี่การ์ด {title}</b>
                            <span>อีก {UNLOCK - g.owned} ตัว</span>
                            <div className="g-meter">
                                {Array.from({ length: UNLOCK }, (_, i) => <i key={i} className={i < g.owned ? "on" : ""} />)}
                            </div>
                        </div>
                    </div>
                )}
            </div>
            <div className="g-pockets">
                {Array.from({ length: g.total }, (_, i) => {
                    const no = String(i + 1).padStart(3, "0");
                    const c = byNo.get(no);
                    return (
                        <div className="g-pocket" key={no}>
                            {c ? (
                                <button
                                    className="g-pocket-open"
                                    type="button"
                                    aria-label={`${c.name} ${TIER_NAME[(c.tier ?? "common") as TierName]}`}
                                    onClick={() => setOpen(c)}
                                >
                                    <CardHtml html={cardMiniHtml(c, (c.tier ?? "common") as TierName)} />
                                </button>
                            ) : (
                                <CardHtml html={cardBackHtml({ no, mini: true })} />
                            )}
                            {c?.image && (
                                <button className="g-btn sm" type="button" onClick={() => setGridNote(placeOnGrid(c.name, c.id, c.image!))}>ใส่กริด</button>
                            )}
                        </div>
                    );
                })}
            </div>
            {gridNote && <p className="g-note" role="status">{gridNote}</p>}
            {open && (
                <div
                    className="g-admire"
                    role="dialog"
                    aria-modal="true"
                    aria-label={`${open.name} ${TIER_NAME[openTier]}`}
                    onClick={(e) => {
                        if (e.target === e.currentTarget) setOpen(null);
                    }}
                >
                    <CardHtml html={cardHtml(open, openTier, { day: open.day, total: g.total })} />
                    <div className="g-admire-row">
                        <CardDayShare day={open.day} />
                        <button className="g-btn" type="button" onClick={() => setOpen(null)}>ปิด</button>
                    </div>
                </div>
            )}
        </section>
    );
}

function Recovery({ onRestored }: { onRestored: () => void }) {
    const [code, setCode] = useState<string | null>(null);
    const [input, setInput] = useState("");
    const [msg, setMsg] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const mint = async () => {
        setBusy(true);
        setMsg(null);
        try {
            setCode((await gachaApi.recovery()).code);
        } catch (e) {
            setMsg(errorText(e));
        } finally {
            setBusy(false);
        }
    };
    const restore = async () => {
        if (!input.trim()) return;
        setBusy(true);
        setMsg(null);
        try {
            const { id } = await gachaApi.restore(input.trim());
            setGachaId(id);
            setInput("");
            setMsg("ย้ายมาแล้ว");
            onRestored();
        } catch (e) {
            setMsg(errorText(e));
        } finally {
            setBusy(false);
        }
    };
    return (
        <section className="g-recover win" aria-label="รหัสกู้คืน">
            <h3 className="g-h3">ย้ายเครื่อง</h3>
            <div className="g-recrow">
                <p>สร้างรหัสไปใส่เครื่องใหม่ สร้างใหม่แล้วรหัสเก่าใช้ไม่ได้</p>
                <button className="g-btn sm" type="button" onClick={mint} disabled={busy}><Icon name="key" />สร้างรหัส</button>
            </div>
            {code && (
                <p className="g-code">
                    <output aria-live="polite">{code}</output>
                    <small>อย่าให้คนอื่นเห็น</small>
                </p>
            )}
            <form
                className="g-recrow"
                onSubmit={(e) => {
                    e.preventDefault();
                    void restore();
                }}
            >
                <input className="win" value={input} onChange={(e) => setInput(e.target.value)} placeholder="ใส่รหัสจากเครื่องเดิม" aria-label="รหัสกู้คืน" autoComplete="off" spellCheck={false} />
                <button className="g-btn sm" type="submit" disabled={busy || !input.trim()}>กู้คืน</button>
            </form>
            {msg && <p className="g-recmsg" role="status">{msg}</p>}
        </section>
    );
}
