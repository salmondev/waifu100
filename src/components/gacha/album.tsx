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
import { Tabs, TabsHighlight, TabsHighlightItem, TabsList, TabsTrigger } from "@animate-ui/react/primitives/tabs";
import { errorText, gachaApi, setGachaId, type AlbumDto, type RoundDto } from "./api";
import { cardBackHtml, cardMiniHtml, CardHtml, storyCardHtml } from "./card";
import { animeSubtitle, animeTitle } from "./chrome";
import { storyColours } from "./palette";
import { Icon, Px, SETSYM, type TierName } from "./pixel";
import { steps4 } from "./play";

const UNLOCK = 3;
type Group = AlbumDto["anime"][number];

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
                    <p>มีการ์ด <b>{album.owned}</b> ใบ ไม่มีใบซ้ำ</p>
                </div>
                <Link className="g-btn sm" href="/daily" scroll={false}><Icon name="back" />กลับไปเล่น</Link>
            </header>
            {groups.length > 0 && current ? (
                <>
                    <Tabs value={String(current.id)} onValueChange={(v) => router.replace(`/daily?view=album&anime=${v}`, { scroll: false })}>
                        <TabsHighlight className="g-tabhl" transition={{ type: "tween", duration: 0.2, ease: steps4 }}>
                            <TabsList className="g-tabs" aria-label="เรื่อง">
                                {groups.map((g) => (
                                    <TabsHighlightItem key={g.id} value={String(g.id)} className="g-tabcell">
                                        <TabsTrigger value={String(g.id)} className={`g-tab${g.id === current.id ? " on" : ""}`}>
                                            <Px rows={SETSYM[g.id % SETSYM.length]} className="sym" />
                                            <span>{animeTitle(g)}</span>
                                            <b>{g.owned}/{g.total}</b>
                                        </TabsTrigger>
                                    </TabsHighlightItem>
                                ))}
                            </TabsList>
                        </TabsHighlight>
                    </Tabs>
                    <Binder g={current} binderRef={binder} />
                </>
            ) : (
                <section className="g-binder win"><p className="g-note">ยังไม่มีการ์ด เดาตัวละครของวันนี้ให้ถูกเพื่อรับใบแรก</p></section>
            )}
            <Recovery onRestored={onRestored} />
        </main>
    );
}

function Binder({ g, binderRef }: { g: Group; binderRef: React.RefObject<HTMLElement | null> }) {
    const colours = storyColours(g.coverColor);
    const byNo = new Map(g.cards.map((c) => [c.number, c]));
    const title = animeTitle(g);
    return (
        <section className="g-binder win" ref={binderRef} style={{ ["--story" as string]: colours.frame }} aria-label={`อัลบั้ม ${title}`}>
            <div className="g-blabel"><b>{title}</b><span>{g.setCode}</span><em>{g.owned}/{g.total}</em></div>
            <div className="g-slot">
                {g.story.unlocked ? (
                    <>
                        {g.story.fresh && <b className="g-tag new g-fresh">ใหม่</b>}
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
                    </>
                ) : (
                    <div className="g-locked">
                        <Icon name="lock" />
                        <div>
                            <b>สตอรี่การ์ด {title}</b>
                            <span>มีแล้ว {g.owned} จาก {UNLOCK} ตัว เก็บอีก {UNLOCK - g.owned} ตัวเพื่อปลดล็อก</span>
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
                            <CardHtml html={c ? cardMiniHtml(c, (c.tier ?? "common") as TierName) : cardBackHtml({ no, mini: true })} />
                        </div>
                    );
                })}
            </div>
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
            setMsg("กู้คืนแล้ว เครื่องนี้ใช้ความคืบหน้าจากรหัสนั้น");
            onRestored();
        } catch (e) {
            setMsg(errorText(e));
        } finally {
            setBusy(false);
        }
    };
    return (
        <section className="g-recover win" aria-label="รหัสกู้คืน">
            <h3 className="g-h3">ย้ายไปเครื่องอื่น <small>ไม่ต้องสมัครสมาชิก</small></h3>
            <div className="g-recrow">
                <p>สร้างรหัสกู้คืน แล้วนำไปใส่ในเครื่องใหม่ อัลบั้ม เหรียญ และสตรีคจะตามไป สร้างใหม่เมื่อไรรหัสเก่าจะใช้ไม่ได้</p>
                <button className="g-btn sm" type="button" onClick={mint} disabled={busy}><Icon name="key" />สร้างรหัส</button>
            </div>
            {code && (
                <p className="g-code">
                    <output aria-live="polite">{code}</output>
                    <small>เก็บรหัสนี้ไว้เป็นความลับ ใครมีรหัสก็เล่นต่อจากคุณได้</small>
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
