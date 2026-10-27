"use client";
/**
 * /daily play view (ported from the v2 prototype play.js). The server owns the
 * round: this only renders the RoundDto and sends guesses / hint purchases.
 * Typed autocomplete only. The first guess is free (T-0024: feedback, but no
 * count for the tier, the cap or the fast bonus), then 6 counted guesses; rounds
 * that had a guess before T-0024 keep 6 in all. A wrong guess shows a feedback row
 * (gender / role / age / birth month / popularity rank / JP voice actor);
 * hints are bought with coins and never lower the card tier (r2; T-0023). Rounds
 * stored before r2 keep their old rule: a free hint per wrong guess.
 */
import Link from "next/link";
import { m } from "motion/react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { DAILY_COINS, type CellState, type FeedbackCell, type HintKey, type HintValue } from "@/server/gacha/rules";
import { hintImageSrc } from "@/lib/gacha-hint-image";
import { shareText } from "@/lib/gacha-share";
import { proxied } from "@/lib/img-proxy";
import { errorText, freeGuessOf, gachaApi, GachaClientError, type RoundDto } from "./api";
import { cardBackHtml, CardHtml, FOCAL } from "./card";
import { animeSubtitle, animeTitle, thaiDate } from "./chrome";
import { storyColours } from "./palette";
import { Chip, Coin, Icon, TIER_GUESSES, type IconName, type TierName } from "./pixel";

const LADDER: TierName[] = ["ssr", "sr", "rare", "common"];
const tierFor = (n: number): TierName => (n <= 1 ? "ssr" : n === 2 ? "sr" : n <= 4 ? "rare" : "common");
const HINT_META: Record<HintKey, { label: string; icon: IconName }> = {
    eyes: { label: "ดวงตา", icon: "eye" },
    va: { label: "นักพากย์ญี่ปุ่น", icon: "mic" },
    silhouette: { label: "เงา", icon: "silhouette" },
    blur: { label: "ภาพเบลอ", icon: "blur" },
    initial: { label: "ตัวอักษรแรก", icon: "letter" },
};
/** Why a hint slot is empty. Copy states the gap; nothing is guessed in its place. */
const MISSING_TEXT: Record<HintKey, string> = {
    eyes: "ไม่มีภาพตัวละครให้ครอปดวงตา",
    va: "AniList ไม่มีข้อมูลนักพากย์ญี่ปุ่น",
    silhouette: "ไม่มีภาพตัวละครให้ทำเงา",
    blur: "ไม่มีภาพตัวละครให้เบลอ",
    initial: "ไม่มีชื่อให้บอกตัวอักษรแรก",
};

// ---- feedback grid ------------------------------------------------------------

const COL_LABEL: Record<FeedbackCell["col"], string> = { gender: "เพศ", role: "บทบาท", age: "อายุ", month: "เดือนเกิด", rank: "อันดับนิยม", va: "นักพากย์" };
const GENDER_TH: Record<string, string> = { Female: "หญิง", Male: "ชาย", "Non-binary": "นอนไบนารี" };
const ROLE_TH: Record<string, string> = { MAIN: "หลัก", SUPPORTING: "รอง", BACKGROUND: "ประกอบ" };
const MONTH_TH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
/** Every state has its own symbol, so colour is never the only signal. */
const STATE_ICON: Record<CellState, IconName> = { hit: "check", near: "near", miss: "cross", up: "up", down: "down", unknown: "unknown" };
const STATE_TH: Record<CellState, string> = {
    hit: "ตรง", near: "ใกล้", miss: "ไม่ตรง", up: "คำตอบมากกว่า", down: "คำตอบน้อยกว่า", unknown: "ไม่มีข้อมูล",
};

function cellText(c: FeedbackCell): string {
    if (c.value == null) return "?";
    if (c.col === "gender") return GENDER_TH[c.value] ?? c.value;
    if (c.col === "role") return ROLE_TH[c.value] ?? c.value;
    if (c.col === "month") return MONTH_TH[Number(c.value) - 1] ?? "?";
    if (c.col === "rank") return `#${c.value}`;
    return c.value;
}

function FeedbackGrid({ guesses }: { guesses: RoundDto["guesses"] }) {
    if (!guesses.length) return null;
    const cols = guesses[0].feedback.map((c) => c.col);
    return (
        <section className="g-fb win" aria-label="ผลการเดา">
            <h3 className="g-h3">ผลการเดา <small>เทียบกับคำตอบ</small></h3>
            <div className="g-fbt" role="table" aria-label="เทียบตัวที่เดากับคำตอบ">
                <div className="g-fbr g-fbhead" role="row">
                    {cols.map((col) => <span key={col} role="columnheader">{COL_LABEL[col]}</span>)}
                </div>
                {guesses.map((g) => (
                    <div key={g.id} className={`g-fbrow${g.correct ? " hit" : ""}`}>
                        <p className="g-fbname"><b>{g.name}</b>{g.correct ? <em>ถูก</em> : null}</p>
                        <div className="g-fbr" role="row" aria-label={g.name}>
                            {g.feedback.map((c) => {
                                const text = cellText(c);
                                return (
                                    <span key={c.col} role="cell" className={`g-cell s-${c.state}`} aria-label={`${COL_LABEL[c.col]} ${text}: ${STATE_TH[c.state]}`}>
                                        <Icon name={STATE_ICON[c.state]} />
                                        <small>{text}</small>
                                    </span>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>
            <ul className="g-legend" aria-label="ความหมายสัญลักษณ์">
                <li><span className="g-cell s-hit"><Icon name="check" /></span>ตรง</li>
                <li><span className="g-cell s-near"><Icon name="near" /></span>ใกล้ (อันดับห่างไม่เกิน 2 / ช่วงอายุทับกัน)</li>
                <li><span className="g-cell s-up"><Icon name="up" /></span>คำตอบมากกว่า</li>
                <li><span className="g-cell s-down"><Icon name="down" /></span>คำตอบน้อยกว่า</li>
                <li><span className="g-cell s-miss"><Icon name="cross" /></span>ไม่ตรง</li>
                <li><span className="g-cell s-unknown"><Icon name="unknown" /></span>ไม่มีข้อมูล</li>
            </ul>
        </section>
    );
}

/** Copies the spoiler-free result. The button itself says whether it worked: no toast, no popup. */
function ShareButton({ round }: { round: RoundDto }) {
    const [state, setState] = useState<"idle" | "ok" | "fail">("idle");
    const text = shareText(round.day.number, round.maxGuesses, round.guesses, round.done === "won", freeGuessOf(round).used, round.archive);
    const copy = async () => {
        try {
            await navigator.clipboard.writeText(text);
            setState("ok");
        } catch {
            setState("fail");
        }
    };
    return (
        <>
            <button className="g-btn" type="button" onClick={copy} data-share={state}>
                <Icon name={state === "ok" ? "check" : "card"} />
                <span aria-live="polite">{state === "ok" ? "คัดลอกแล้ว" : "คัดลอกผลลัพธ์"}</span>
            </button>
            {state === "fail" && (
                <label className="g-sharebox">
                    <span>คัดลอกอัตโนมัติไม่ได้ เลือกข้อความนี้แล้วคัดลอกเอง</span>
                    <textarea readOnly rows={text.split("\n").length} value={text} onFocus={(e) => e.currentTarget.select()} />
                </label>
            )}
        </>
    );
}

/** PICO-8 stepped ease: motion in 4 hard steps, no smooth tween. */
export const steps4 = (t: number) => Math.min(1, Math.floor(t * 4 + 0.0001) / 4);

const Face = ({ src, w = 128, className, name }: { src: string | null; w?: number; className?: string; name?: string }) =>
    src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className={className} src={proxied(src, w)} alt="" draggable={false} style={{ objectPosition: FOCAL }} />
    ) : (
        // Guess-only characters (no card) have no art here: show their initial instead.
        <b className="g-noface" aria-hidden="true">{(name ?? "?").trim().charAt(0).toUpperCase()}</b>
    );

/** A server-rendered hint image (already blurred / stencilled), never the art itself. */
const HintPic = ({ src }: { src: string }) => {
    const safe = hintImageSrc(src);
    // eslint-disable-next-line @next/next/no-img-element
    return safe ? <img src={safe} alt="" draggable={false} /> : null;
};

function HintBody({ h }: { h: HintValue }) {
    if (h.key === "va")
        return (
            <>
                <b>{h.name}</b>
                {h.nameNative ? <span className="g-dim">{h.nameNative}</span> : null}
            </>
        );
    if (h.key === "initial")
        return (
            <>
                <span className="g-initial" aria-label={`ขึ้นต้นด้วย ${h.first} ยาว ${h.words.join(" + ")} ตัวอักษร`}>
                    {h.words.map((n, w) => (
                        <span key={w}>
                            {Array.from({ length: n }, (_, k) => <i key={k}>{w === 0 && k === 0 ? h.first : ""}</i>)}
                        </span>
                    ))}
                </span>
                <span className="g-dim">ขึ้นต้นด้วย {h.first} · {h.words.join(" + ")} ตัวอักษร</span>
            </>
        );
    if (h.key === "eyes")
        return (
            <>
                <span className="g-pic eyes"><HintPic src={h.src} /></span>
                <span className="g-dim">ครอปช่วงดวงตาจากภาพตัวละคร</span>
            </>
        );
    if (h.key === "silhouette")
        return (
            <>
                <span className="g-pic sil"><HintPic src={h.src} /></span>
                <span className="g-dim">เงาสองสีจากภาพตัวละคร</span>
            </>
        );
    return (
        <>
            <span className="g-pic blur"><HintPic src={h.src} /></span>
            <span className="g-dim">ภาพเบลอ</span>
        </>
    );
}

export function PlayView({ round, onRound, onOpenPack, opened }: { round: RoundDto; onRound: (r: RoundDto) => void; onOpenPack: () => void; opened: boolean }) {
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [shakeKey, setShakeKey] = useState(0);
    const colours = storyColours(round.anime.coverColor);
    // Track slots: the free guess (when the round has one) takes slot 0, counted guesses follow.
    const free = freeGuessOf(round);
    const slotCount = round.maxGuesses + (free.on ? 1 : 0);
    const used = round.guesses.length;
    const wrongs = round.guesses.filter((g) => !g.correct).length;
    // r2: hints are bought (they never lower the tier). Legacy rounds: wrong guesses open hints free.
    const r2 = round.steps.hintsCostTier;
    const freeOpen = r2 ? 0 : wrongs;
    // Counted guesses (the server leaves the free guess out): tier, remaining and the result line.
    const steps = round.steps.used;
    const left = round.maxGuesses - steps;
    const done = round.done;
    const answer = round.result?.answer ?? null;
    const blur = round.hints.open.find((h) => h.key === "blur");
    const sil = round.hints.open.find((h) => h.key === "silhouette");
    const eyes = round.hints.open.find((h) => h.key === "eyes");
    const won = (round.result?.pull?.tier as TierName | undefined) ?? tierFor(steps);
    const now = done === "won" ? won : done ? null : tierFor(steps + 1);
    // Stored tiers are never recomputed. A round scored under the T-0016 rule
    // (bought hints counted) can hold a tier the table no longer gives; say so.
    const oldRule = done === "won" && !!round.result?.pull && won !== tierFor(Math.max(1, steps));
    const archDay = round.archive ? round.day.key : undefined;
    // Every write names this round's day, so a page left open past Bangkok
    // midnight still lands on the round on screen, never on the new day's.
    const roundDay = round.day.key;

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

    /** Buys exactly this slot; if the round moved on (another tab, a retry), just resync. */
    const buy = (slot: number) =>
        send(async () => {
            try {
                return await gachaApi.hint(slot, roundDay);
            } catch (e) {
                if (e instanceof GachaClientError && e.code === "hint_out_of_order") return gachaApi.day(roundDay);
                throw e;
            }
        });

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
                <div className="g-frame blur"><HintPic src={blur.src} /></div>
                <figcaption className="win">ภาพเบลอ</figcaption>
            </>
        );
    else if (sil && sil.key === "silhouette")
        mystery = (
            <>
                <div className="g-frame sil"><HintPic src={sil.src} /></div>
                <figcaption className="win">เงา</figcaption>
            </>
        );
    else if (eyes && eyes.key === "eyes")
        mystery = (
            <>
                <div className="g-frame eyes"><HintPic src={eyes.src} /></div>
                <figcaption className="win">ดวงตา</figcaption>
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
                    <p><span>{thaiDate(round.day.key)}</span><span>{archDay ? "รอบย้อนหลัง" : "เดาได้วันละ 1 ตัว"}</span></p>
                </div>
                <nav className="g-archline" aria-label="เลือกวัน">
                    {archDay ? (
                        <>
                            <Link className="g-btn sm" href="/daily" scroll={false}><Icon name="back" />กลับไปวันนี้</Link>
                            <Link className="g-btn sm" href="/daily?view=archive" scroll={false}>วันอื่น</Link>
                        </>
                    ) : (
                        <Link className="g-btn sm" href="/daily?view=archive" scroll={false}>เล่นย้อนหลัง 30 วัน</Link>
                    )}
                </nav>
                {archDay ? <p className="g-archnote">รอบย้อนหลัง: ได้การ์ดตามระดับและเหรียญรายวันตอนจบรอบเหมือนปกติ แต่ไม่มีโบนัสเดาไว และไม่นับวันติดกัน</p> : null}
                <div className="g-story">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={proxied(round.anime.cover, 160)} alt="" />
                    <div>
                        <small>{archDay ? "เรื่องของวันนั้น" : "เรื่องของวันนี้"}</small>
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
                            <span>{done ? "จบรอบนี้" : <>{free.on && !free.used ? "เดาครั้งแรกฟรี · " : ""}เหลือ <em>{left}</em> ครั้ง</>}</span>
                        </div>
                        <ol className={free.on ? "g-track free" : "g-track"}>
                            {Array.from({ length: slotCount }, (_, i) => {
                                const g = round.guesses[i];
                                if (g)
                                    return (
                                        <li key={i} className={g.correct ? "hit" : "miss"} aria-label={`${g.name} ${g.correct ? "ถูก" : "ผิด"}`}>
                                            <Face src={g.image} w={96} name={g.name} />
                                            <span><Icon name={g.correct ? "check" : "cross"} /></span>
                                        </li>
                                    );
                                return <li key={i} className={[i === used && !done ? "now" : "", free.on && i === 0 ? "free-slot" : ""].filter(Boolean).join(" ") || undefined}><em>{free.on ? (i === 0 ? "ฟรี" : i) : i + 1}</em></li>;
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
                        <p className="g-sub">
                            {free.used && steps === 0 ? <>เดาถูกตั้งแต่ครั้งฟรี ได้การ์ด <Chip tier={won} /></> : <>เดาครั้งที่ <b>{steps}</b> ได้การ์ด <Chip tier={won} /></>}
                        </p>
                        {oldRule && <p className="g-note">รอบนี้คิดระดับการ์ดตามกฎเดิม (ตอนนั้นคำใบ้ที่ซื้อนับเป็นครั้งเดา)</p>}
                        <ul className="g-rew">
                            <li><span><Icon name="card" />การ์ด</span><Chip tier={won} /></li>
                            {round.result?.bonus ? <li><span><Coin />โบนัสเดาไว</span><b className="g-plus">+{round.result.bonus}</b></li> : null}
                        </ul>
                        <div className="g-row">
                            <button className="g-btn red" type="button" onClick={onOpenPack}>{opened ? "ดูการ์ดที่ได้" : "เปิดซอง"}</button>
                            <ShareButton round={round} />
                        </div>
                        <p className="g-note">ไม่มีการ์ดซ้ำ ได้ตัวที่มีแล้วในระดับสูงกว่าจะอัปเกรดใบเดิม ระดับเท่าเดิมหรือต่ำกว่าอัลบั้มไม่เปลี่ยน</p>
                    </div>
                ) : done === "lost" ? (
                    <div className="g-result lost win">
                        <p className="g-stamp ink">{free.used ? "ครบ 6 ครั้ง + เดาฟรี" : "ครบ 6 ครั้ง"}</p>
                        <p className="g-sub">คำตอบคือ</p>
                        <p className="g-lead">{answer?.name ?? ""}</p>
                        <p className="g-note">{archDay ? "รอบนี้ไม่ได้การ์ด รอบย้อนหลังไม่นับวันติดกัน" : "รอบนี้ไม่ได้การ์ด สตรีคยังนับต่อ เพราะเล่นจบรอบแล้ว พรุ่งนี้มีตัวละครใหม่"}</p>
                        <div className="g-row">
                            <Link className="g-btn" href={`/daily?view=album&anime=${round.anime.id}`} scroll={false}><Icon name="album" />ดูอัลบั้ม</Link>
                            <ShareButton round={round} />
                        </div>
                    </div>
                ) : (
                    <GuessBox round={round} busy={busy} shakeKey={shakeKey} onGuess={(id) => send(() => gachaApi.guess(id, roundDay), true)} />
                )}
                {err && <p className="g-err" role="alert">{err}</p>}
            </section>
            <FeedbackGrid guesses={round.guesses} />
            <section className="g-hints win" aria-label="คำใบ้">
                <h3 className="g-h3">คำใบ้ <small>{r2 ? "ซื้อทีละข้อ ไม่นับเป็นครั้งที่เดา" : "เปิดทีละข้อเมื่อเดาผิด"}</small></h3>
                {Array.from({ length: round.hints.slots }, (_, i) => {
                    // Fixed five-slot ladder. Locked slots are numbered only: the server does not say
                    // which kind sits behind them, nor how many real hints there are.
                    const h = round.hints.open[i];
                    const meta = h ? HINT_META[h.key] : null;
                    const emptyAt = i - round.hints.open.length;
                    if (!h && emptyAt >= 0 && emptyAt < round.hints.empty) {
                        // An opened slot with no data. Its kind is named only once the server sends `missing`.
                        const kind: HintKey | undefined = round.hints.missing[emptyAt];
                        const refunded = i >= freeOpen && !done;
                        return (
                            <div key={`slot-${i}-empty`} className="g-hint missing" data-hint={kind ?? "empty"}>
                                <span className="g-hi"><Icon name={kind ? HINT_META[kind].icon : "lock"} /></span>
                                <div className="g-hb">
                                    <small><b>{i + 1}</b>{kind ? HINT_META[kind].label : `คำใบ้ข้อที่ ${i + 1}`}<em>ไม่มีข้อมูล</em></small>
                                    <span className="g-lock">{kind ? MISSING_TEXT[kind] : "ตัวละครนี้ไม่มีคำใบ้ข้อนี้"}{refunded ? " · คืนเหรียญแล้ว" : ""}</span>
                                </div>
                            </div>
                        );
                    }
                    const bought = !!h && i >= freeOpen && !done;
                    return (
                        <m.div
                            key={h ? `${h.key}-open` : `slot-${i}`}
                            className={`g-hint${h ? " open" : ""}`}
                            data-hint={h ? h.key : "locked"}
                            initial={h ? { opacity: 0 } : false}
                            animate={{ opacity: 1 }}
                            transition={{ duration: 0.24, ease: steps4 }}
                        >
                            <span className="g-hi"><Icon name={meta ? meta.icon : "lock"} /></span>
                            <div className="g-hb">
                                <small><b>{i + 1}</b>{meta ? meta.label : "คำใบ้ลับ"}{bought ? <em>ซื้อแล้ว</em> : null}</small>
                                {h ? <HintBody h={h} /> : <span className="g-lock"><Icon name="lock" />{r2 ? "ยังไม่ได้ซื้อ" : `เปิดเมื่อเดาผิดครั้งที่ ${i + 1}`}</span>}
                            </div>
                        </m.div>
                    );
                })}
                {round.hints.empty > 0 && (
                    <p className="g-note">ช่องที่ไม่มีข้อมูลไม่นับเป็นคำใบ้และไม่เสียเหรียญ คำใบ้รอบนี้มี {round.hints.open.length} ข้อ</p>
                )}
            </section>
            {!done && (
                <section className="g-shop win">
                    <h3 className="g-h3">
                        {r2 ? "ซื้อคำใบ้" : "ซื้อคำใบ้ก่อน"} {round.dailyCoins ? (
                            <span className="g-free"><Coin />รับฟรีวันนี้ +{round.dailyCoins}</span>
                        ) : round.archive ? (
                            <span className="g-free"><Coin />จบรอบรับ +{DAILY_COINS}</span>
                        ) : null}
                    </h3>
                    {round.hints.next ? (
                        <div className="g-shoprow">
                            <span className="g-hi"><Icon name="lock" /></span>
                            <span className="g-nm">
                                คำใบ้ข้อที่ {round.hints.next.slot}
                                <small>
                                    {r2 ? "ไม่นับเป็นครั้งที่เดา" : `ข้อถัดไป ปกติเปิดเมื่อผิดครั้งที่ ${round.hints.next.slot}`} · ถ้าไม่มีข้อมูล คืนเหรียญเต็มจำนวน
                                </small>
                                {!round.hints.next.affordable && (
                                    <small className="g-short" id="g-short">เหรียญไม่พอ (มี {round.coins} ต้องใช้ {round.hints.next.price})</small>
                                )}
                            </span>
                            <button
                                className="g-btn sm coin"
                                type="button"
                                aria-describedby={round.hints.next.affordable ? undefined : "g-short"}
                                disabled={busy || !round.hints.next.affordable}
                                onClick={() => buy(round.hints.next!.slot)}
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

/**
 * How-to-play callout under the guess box (T-0025). Open with no toggle before the first guess; after it, a one-line
 * summary button that expands the same list. The free-guess point only shows when this round has a free guess.
 */
function RulesGuide({ round }: { round: RoundDto }) {
    const [open, setOpen] = useState(false);
    const listId = useId();
    const fresh = round.guesses.length === 0 && !round.done;
    const pt = (key: string, icon: IconName, text: string) => ({ key, icon, text });
    const points = [
        ...(freeGuessOf(round).on ? [pt("free", "check", "เดาครั้งแรกฟรี ไม่นับเป็นครั้งที่เดา")] : []),
        ...(round.steps.hintsCostTier
            ? [
                pt("near", "near", "เดาผิดจะเห็นว่าใกล้คำตอบแค่ไหน"),
                pt("fast", "card", "ยิ่งเดาถูกเร็ว การ์ดยิ่งหายาก"),
                pt("hint", "key", "ซื้อคำใบ้ได้โดยไม่ลดระดับการ์ด"),
            ]
            : [
                pt("hint", "key", "เดาผิดแต่ละครั้งเปิดคำใบ้ 1 ข้อ"),
                pt("fast", "card", "ยิ่งเดาถูกเร็ว การ์ดยิ่งหายาก"),
            ]),
    ];
    const shown = fresh || open;
    return (
        <aside className={`g-rules${shown ? " open" : ""}`} aria-label="วิธีเล่น">
            {fresh ? (
                <p className="g-rules-h">วิธีเล่น</p>
            ) : (
                <button className="g-rules-t" type="button" aria-expanded={open} aria-controls={listId} onClick={() => setOpen((o) => !o)}>
                    <span>วิธีเล่น · ยิ่งเดาถูกเร็ว การ์ดยิ่งหายาก</span>
                    <Icon name="down" />
                </button>
            )}
            <ul id={listId} hidden={!shown}>
                {points.map(({ key, icon, text }) => (
                    <li key={key} className={`g-rule-${key}`}><i aria-hidden="true"><Icon name={icon} /></i><span>{text}</span></li>
                ))}
            </ul>
        </aside>
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
            <RulesGuide round={round} />
        </div>
    );
}
