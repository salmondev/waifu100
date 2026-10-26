"use client";
/**
 * /daily play view (ported from the v2 prototype play.js). The server owns the
 * round: this only renders the RoundDto and sends guesses / hint purchases.
 * Typed autocomplete only, 6 guesses, hints open on wrong guesses, the next
 * hint can be bought early with coins.
 */
import Link from "next/link";
import { m } from "motion/react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { HintKey, HintValue } from "@/server/gacha/rules";
import { proxied } from "@/lib/img-proxy";
import { errorText, gachaApi, type RoundDto } from "./api";
import { cardBackHtml, CardHtml, FOCAL } from "./card";
import { animeSubtitle, animeTitle, thaiDate } from "./chrome";
import { storyColours } from "./palette";
import { Chip, Coin, Icon, TIER_GUESSES, type IconName, type TierName } from "./pixel";

const LADDER: TierName[] = ["ssr", "sr", "rare", "common"];
const FAST_BONUS: Record<number, number> = { 1: 30, 2: 20, 3: 10 };
const tierFor = (n: number): TierName => (n <= 1 ? "ssr" : n === 2 ? "sr" : n <= 4 ? "rare" : "common");
const HINT_META: Record<HintKey, { label: string; icon: IconName }> = {
    role: { label: "บทบาทและเพศ", icon: "role" },
    hair: { label: "สีผม", icon: "hair" },
    quote: { label: "คำพูด", icon: "quote" },
    silhouette: { label: "เงา", icon: "silhouette" },
    blur: { label: "ภาพเบลอ", icon: "blur" },
};
const GENDER_TH: Record<string, string> = { Female: "หญิง", Male: "ชาย" };
/** PICO-8 stepped ease: motion in 4 hard steps, no smooth tween. */
export const steps4 = (t: number) => Math.min(1, Math.floor(t * 4 + 0.0001) / 4);

const Face = ({ src, w = 128, className }: { src: string; w?: number; className?: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img className={className} src={proxied(src, w)} alt="" draggable={false} style={{ objectPosition: FOCAL }} />
);

function HintBody({ h }: { h: HintValue }) {
    if (h.key === "role") {
        const base = h.occupation?.trim() || (h.role === "MAIN" ? "ตัวละครหลัก" : h.role === "SUPPORTING" ? "ตัวละครรอง" : "ไม่มีข้อมูลบทบาท");
        return (
            <>
                <b>{base}</b>
                <span className="g-dim">{h.gender ? `เพศ${GENDER_TH[h.gender] ?? ` ${h.gender}`}` : "AniList ไม่ระบุเพศ"}</span>
            </>
        );
    }
    if (h.key === "hair") {
        const bg = h.stripes ? `linear-gradient(90deg, ${h.stripes.map((c, i, a) => `${c} ${(i / a.length) * 100}% ${((i + 1) / a.length) * 100}%`).join(", ")})` : h.hex;
        return (
            <span className="g-hair">
                <i style={{ background: bg }} />
                <b>{h.label}</b>
            </span>
        );
    }
    if (h.key === "quote") return <q>{h.quote}</q>;
    if (h.key === "silhouette")
        return (
            <>
                <span className="g-pic sil"><Face src={h.image} w={96} /></span>
                <span className="g-dim">เงาตัวละคร</span>
            </>
        );
    return (
        <>
            <span className="g-pic blur"><Face src={h.image} w={96} /></span>
            <span className="g-dim">ภาพเบลอ</span>
        </>
    );
}

export function PlayView({ round, onRound, onOpenPack, opened }: { round: RoundDto; onRound: (r: RoundDto) => void; onOpenPack: () => void; opened: boolean }) {
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [shakeKey, setShakeKey] = useState(0);
    const colours = storyColours(round.anime.coverColor);
    const used = round.guesses.length;
    const wrongs = round.guesses.filter((g) => !g.correct).length;
    const done = round.done;
    const answer = round.result?.answer ?? null;
    const blur = round.hints.open.find((h) => h.key === "blur");
    const sil = round.hints.open.find((h) => h.key === "silhouette");
    const now = done === "won" ? tierFor(used) : done ? null : tierFor(used + 1);

    const send = async (fn: () => Promise<RoundDto>, wrongShake = false) => {
        if (busy) return;
        setBusy(true);
        setErr(null);
        try {
            const r = await fn();
            onRound(r);
            if (wrongShake && !r.done) setShakeKey((k) => k + 1);
        } catch (e) {
            setErr(errorText(e));
        } finally {
            setBusy(false);
        }
    };

    let mystery: ReactNode;
    if (done && answer)
        mystery = (
            <>
                <div className="g-frame"><Face src={answer.image} /></div>
                <figcaption className="win">{answer.name}</figcaption>
            </>
        );
    else if (blur && blur.key === "blur")
        mystery = (
            <>
                <div className="g-frame blur"><Face src={blur.image} /></div>
                <figcaption className="win">ภาพเบลอ</figcaption>
            </>
        );
    else if (sil && sil.key === "silhouette")
        mystery = (
            <>
                <div className="g-frame sil"><Face src={sil.image} /></div>
                <figcaption className="win">เงา</figcaption>
            </>
        );
    else
        mystery = (
            <>
                <CardHtml html={cardBackHtml()} />
                <figcaption className="win">ตัวละครลับ</figcaption>
            </>
        );

    return (
        <main className="g-play" style={{ ["--story" as string]: colours.frame }}>
            <section className="g-today win">
                <div className="g-dayline">
                    <h1><span>#</span>{round.day.number}</h1>
                    <p><span>{thaiDate(round.day.key)}</span><span>เดาได้วันละ 1 ตัว</span></p>
                </div>
                <div className="g-story">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={proxied(round.anime.cover, 160)} alt="" />
                    <div>
                        <small>เรื่องของวันนี้</small>
                        <h2>{animeTitle(round.anime)}</h2>
                        {animeSubtitle(round.anime) && <p>{animeSubtitle(round.anime)}</p>}
                        <p className="g-n">ตัวละครให้เลือก <b>{round.candidates.length}</b> ตัว</p>
                    </div>
                </div>
            </section>
            <section className="g-board">
                <figure className="g-myst">{mystery}</figure>
                <div className="g-side win">
                    <div>
                        <div className="g-track-h">
                            <b>GUESS</b>
                            <span>{done ? "จบรอบนี้" : <>เหลือ <em>{round.maxGuesses - used}</em> ครั้ง</>}</span>
                        </div>
                        <ol className="g-track">
                            {Array.from({ length: round.maxGuesses }, (_, i) => {
                                const g = round.guesses[i];
                                if (g)
                                    return (
                                        <li key={i} className={g.correct ? "hit" : "miss"} aria-label={`${g.name} ${g.correct ? "ถูก" : "ผิด"}`}>
                                            <Face src={g.image} w={96} />
                                            <span><Icon name={g.correct ? "check" : "cross"} /></span>
                                        </li>
                                    );
                                return <li key={i} className={i === used && !done ? "now" : ""}><em>{i + 1}</em></li>;
                            })}
                        </ol>
                    </div>
                    <div>
                        <p className="g-stake-h">{done === "won" ? "ได้การ์ดระดับ" : done ? "ระดับตามครั้งที่เดาถูก" : "ถ้าเดาถูกตอนนี้"}</p>
                        <ul className="g-ladder">
                            {LADDER.map((t) => (
                                <li key={t} className={t === now ? "on" : ""}><Chip tier={t} /><small>{TIER_GUESSES[t]}</small></li>
                            ))}
                        </ul>
                    </div>
                </div>
            </section>
            <section className="g-act">
                {done === "won" && answer ? (
                    <div className="g-result win">
                        <p className="g-stamp">เดาถูก</p>
                        <p className="g-lead">{answer.name}</p>
                        <p className="g-sub">เดาครั้งที่ <b>{used}</b> ได้การ์ด <Chip tier={tierFor(used)} /></p>
                        <ul className="g-rew">
                            <li><span><Icon name="card" />การ์ด</span><Chip tier={tierFor(used)} /></li>
                            {FAST_BONUS[used] ? <li><span><Coin />โบนัสเดาไว</span><b className="g-plus">+{FAST_BONUS[used]}</b></li> : null}
                        </ul>
                        <button className="g-btn red" type="button" onClick={onOpenPack}>{opened ? "ดูการ์ดที่ได้" : "เปิดซอง"}</button>
                        <p className="g-note">ไม่มีการ์ดซ้ำ ได้ตัวที่มีแล้วในระดับสูงกว่าจะอัปเกรดใบเดิม ระดับเท่าเดิมหรือต่ำกว่าอัลบั้มไม่เปลี่ยน</p>
                    </div>
                ) : done === "lost" ? (
                    <div className="g-result lost win">
                        <p className="g-stamp ink">ครบ 6 ครั้ง</p>
                        <p className="g-sub">คำตอบคือ</p>
                        <p className="g-lead">{answer?.name ?? ""}</p>
                        <p className="g-note">รอบนี้ไม่ได้การ์ด สตรีคยังนับต่อ เพราะเล่นจบรอบแล้ว พรุ่งนี้มีตัวละครใหม่</p>
                        <div className="g-row">
                            <Link className="g-btn" href={`/daily?view=album&anime=${round.anime.id}`} scroll={false}><Icon name="album" />ดูอัลบั้ม</Link>
                        </div>
                    </div>
                ) : (
                    <GuessBox round={round} busy={busy} shakeKey={shakeKey} onGuess={(id) => send(() => gachaApi.guess(id), true)} />
                )}
                {err && <p className="g-err" role="alert">{err}</p>}
            </section>
            <section className="g-hints win" aria-label="คำใบ้">
                <h3 className="g-h3">คำใบ้ <small>เปิดทีละข้อเมื่อเดาผิด</small></h3>
                {round.hints.keys.map((key, i) => {
                    const h = round.hints.open[i];
                    const meta = HINT_META[key];
                    const bought = !!h && i >= wrongs && !done;
                    return (
                        <m.div
                            key={`${key}-${h ? "open" : "locked"}`}
                            className={`g-hint${h ? " open" : ""}`}
                            data-hint={key}
                            initial={h ? { opacity: 0 } : false}
                            animate={{ opacity: 1 }}
                            transition={{ duration: 0.24, ease: steps4 }}
                        >
                            <span className="g-hi"><Icon name={meta.icon} /></span>
                            <div className="g-hb">
                                <small><b>{i + 1}</b>{meta.label}{bought ? <em>ซื้อแล้ว</em> : null}</small>
                                {h ? <HintBody h={h} /> : <span className="g-lock"><Icon name="lock" />เปิดเมื่อเดาผิดครั้งที่ {i + 1}</span>}
                            </div>
                        </m.div>
                    );
                })}
                {round.hints.keys.length < 5 && (
                    <p className="g-note">ตัวละครนี้ AniList ไม่มีข้อมูลบางส่วน คำใบ้จึงมี {round.hints.keys.length} ข้อ</p>
                )}
            </section>
            {!done && (
                <section className="g-shop win">
                    <h3 className="g-h3">
                        ซื้อคำใบ้ก่อน {round.dailyCoins ? <span className="g-free"><Coin />รับฟรีวันนี้ +{round.dailyCoins}</span> : null}
                    </h3>
                    {round.hints.next ? (
                        <div className="g-shoprow">
                            <span className="g-hi"><Icon name={HINT_META[round.hints.keys[round.hints.open.length]].icon} /></span>
                            <span className="g-nm">
                                {HINT_META[round.hints.keys[round.hints.open.length]].label}
                                <small>ข้อถัดไป ปกติเปิดเมื่อผิดครั้งที่ {round.hints.open.length + 1}</small>
                            </span>
                            <button
                                className="g-btn sm coin"
                                type="button"
                                disabled={busy || !round.hints.next.affordable}
                                onClick={() => send(() => gachaApi.hint())}
                                aria-label={`ซื้อคำใบ้ ${round.hints.next.price} เหรียญ`}
                            >
                                <Coin /><b>{round.hints.next.price}</b>
                            </button>
                        </div>
                    ) : (
                        <div className="g-shoprow"><span className="g-nm">เปิดคำใบ้ครบทุกข้อแล้ว</span></div>
                    )}
                </section>
            )}
        </main>
    );
}

function GuessBox({ round, busy, shakeKey, onGuess }: { round: RoundDto; busy: boolean; shakeKey: number; onGuess: (id: number) => void }) {
    const [text, setText] = useState("");
    const [sel, setSel] = useState(0);
    const [open, setOpen] = useState(false);
    const [bad, setBad] = useState(false);
    const [localShake, setLocalShake] = useState(0);
    const input = useRef<HTMLInputElement>(null);
    const guessed = useMemo(() => new Set(round.guesses.map((g) => g.id)), [round.guesses]);
    const t = text.trim().toLowerCase();
    const list = useMemo(
        () =>
            t
                ? round.candidates.filter(
                      (c) =>
                          !guessed.has(c.id) &&
                          (c.name.toLowerCase().includes(t) || (c.nameNative ?? "").toLowerCase().includes(t) || c.alternative.some((a) => a.toLowerCase().includes(t))),
                  )
                : [],
        [round.candidates, guessed, t],
    );
    const cur = Math.min(sel, Math.max(0, list.length - 1));
    const shown = open && list.length > 0;

    const hl = (s: string): ReactNode => {
        const i = s.toLowerCase().indexOf(t);
        if (!t || i < 0) return s;
        return <>{s.slice(0, i)}<mark>{s.slice(i, i + t.length)}</mark>{s.slice(i + t.length)}</>;
    };
    const pick = (id: number) => {
        setText("");
        setOpen(false);
        setSel(0);
        onGuess(id);
        input.current?.focus();
    };
    const submit = () => {
        if (busy) return;
        if (shown && list[cur]) return pick(list[cur].id);
        const exact = round.candidates.find((c) => c.name.toLowerCase() === t || (c.nameNative ?? "").toLowerCase() === t);
        if (exact && !guessed.has(exact.id)) return pick(exact.id);
        setBad(true);
        setLocalShake((k) => k + 1);
        input.current?.focus();
    };
    const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "ArrowDown") { setSel(Math.min(cur + 1, list.length - 1)); setOpen(true); e.preventDefault(); }
        if (e.key === "ArrowUp") { setSel(Math.max(cur - 1, 0)); e.preventDefault(); }
        if (e.key === "Enter") { submit(); e.preventDefault(); }
        if (e.key === "Escape") setOpen(false);
    };
    const shakeId = shakeKey + localShake;
    const row = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const el = row.current;
        if (!el || !shakeId) return;
        el.classList.remove("shake");
        void el.offsetWidth;
        el.classList.add("shake");
    }, [shakeId]);

    return (
        <div className="g-guess">
            <div className="g-guessrow" ref={row}>
                <input
                    id="g"
                    ref={input}
                    className="win"
                    autoComplete="off"
                    placeholder="พิมพ์ชื่อตัวละคร"
                    aria-label="ชื่อตัวละคร"
                    role="combobox"
                    aria-expanded={shown}
                    aria-controls="g-ac"
                    aria-autocomplete="list"
                    aria-activedescendant={shown ? `g-ac-${list[cur]?.id}` : undefined}
                    aria-invalid={bad || undefined}
                    value={text}
                    readOnly={busy}
                    onChange={(e) => { setText(e.target.value); setSel(0); setOpen(true); setBad(false); }}
                    onKeyDown={onKey}
                    onBlur={() => setOpen(false)}
                    onFocus={() => setOpen(true)}
                />
                <button className="g-btn red" id="go" type="button" onClick={submit} disabled={busy}>เดา</button>
            </div>
            <ul className="g-ac win" id="g-ac" role="listbox" hidden={!shown}>
                {list.map((c, i) => (
                    <li
                        key={c.id}
                        id={`g-ac-${c.id}`}
                        role="option"
                        aria-selected={i === cur}
                        className={i === cur ? "on" : ""}
                        onPointerDown={(e) => { e.preventDefault(); pick(c.id); }}
                    >
                        <b>{hl(c.name)}</b>
                        <span>{c.nameNative ? hl(c.nameNative) : c.alternative[0] ?? ""}</span>
                    </li>
                ))}
            </ul>
            {bad && <p className="g-err" id="gerr">ไม่มีชื่อนี้ในเรื่องนี้ เลือกจากรายการ</p>}
            {round.guesses.length === 0 && <p className="g-rules">เดาผิดแต่ละครั้งเปิดคำใบ้ 1 ข้อ ยิ่งเดาถูกเร็ว การ์ดยิ่งหายาก</p>}
        </div>
    );
}
