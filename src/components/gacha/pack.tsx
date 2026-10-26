"use client";
/**
 * /daily pack view (ported from the v2 prototype game/pack.js). Only after a
 * won round. The pull is already committed on the server when the winning
 * guess lands, so leaving mid-animation never loses the card; the animation
 * plays once per day per device ("opened" is a local flag) and a revisit goes
 * straight to the card. three.js is loaded here with a dynamic import only.
 */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { RoundDto } from "./api";
import { cardHtml, CardHtml, FOCAL } from "./card";
import { animeTitle } from "./chrome";
import { storyColours } from "./palette";
import { Chip, Coin, Icon, TIER_GUESSES, TIER_NAME, type TierName } from "./pixel";
import { proxied } from "@/lib/img-proxy";

const LADDER: TierName[] = ["ssr", "sr", "rare", "common"];
const UNLOCK = 3;
const REVEAL_AT = 2.7;

const openedKey = (day: string) => `gacha-guess-opened:${day}`;
export function wasOpened(day: string): boolean {
    try {
        return localStorage.getItem(openedKey(day)) === "1";
    } catch {
        return false;
    }
}
function markOpened(day: string) {
    try {
        localStorage.setItem(openedKey(day), "1");
    } catch {
        /* ignore */
    }
}

export function PackView({ round, coins }: { round: RoundDto; coins: number }) {
    const res = round.result;
    const stage = useRef<HTMLDivElement>(null);
    const scene = useRef<{ render: (t: number) => void; destroy: () => void; canvas: HTMLCanvasElement; gl: boolean } | null>(null);
    const [phase, setPhase] = useState<"loading" | "ready" | "playing" | "revealed">(() => (wasOpened(round.day.key) ? "revealed" : "loading"));
    const [gl, setGl] = useState<boolean | null>(null);
    const colours = storyColours(round.anime.coverColor);
    const tier = (res?.pull?.tier ?? "common") as TierName;
    const n = round.guesses.length;

    useEffect(() => {
        const el = stage.current;
        if (!el || !res?.pull) return;
        let alive = true;
        void import("./pack-scene").then(async ({ createPackScene, T }) => {
            const s = await createPackScene(el, { tier, colours, setCode: round.anime.setCode, cyFrac: 0.34, hFrac: 0.38, wFrac: 0.56 });
            if (!alive) return s.destroy();
            scene.current = s;
            setGl(s.gl);
            if (wasOpened(round.day.key)) s.render(T.reveal);
            else {
                s.render(-1);
                setPhase((p) => (p === "loading" ? "ready" : p));
            }
        });
        return () => {
            alive = false;
            scene.current?.destroy();
            scene.current = null;
        };
        // the scene depends on the day's pack only
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [round.day.key]);

    const open = () => {
        const s = scene.current;
        if (!s || phase !== "ready") return;
        setPhase("playing");
        markOpened(round.day.key);
        if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
            s.render(REVEAL_AT - 0.01);
            setPhase("revealed");
            return;
        }
        const t0 = performance.now();
        const step = () => {
            const cur = scene.current;
            if (!cur) return;
            const t = (performance.now() - t0) / 1000;
            cur.render(t);
            if (t < REVEAL_AT) requestAnimationFrame(step);
            else setPhase("revealed");
        };
        requestAnimationFrame(step);
    };

    useEffect(() => {
        const s = scene.current;
        if (!s) return;
        s.canvas.addEventListener("click", open);
        return () => s.canvas.removeEventListener("click", open);
    });

    if (!res || !res.pull || round.done !== "won") {
        return (
            <main className="g-pack g-empty">
                <div className="win g-emptywin">
                    <p>ยังไม่มีซองให้เปิด เดาตัวละครของวันนี้ให้ถูกก่อน</p>
                    <Link className="g-btn red" href={round.archive ? `/daily?day=${round.day.key}` : "/daily"} scroll={false}><Icon name="back" />กลับไปเล่น</Link>
                </div>
            </main>
        );
    }
    const pull = res.pull;
    const prev = pull.prevTier as TierName | null;
    const shown: TierName = pull.result === "same" && prev ? prev : tier;
    const title = animeTitle(round.anime);

    return (
        <main
            className={`g-pack${gl === false && phase === "playing" ? " nogl-open" : ""}`}
            style={{ ["--story" as string]: colours.frame }}
            data-gl={gl == null ? undefined : gl ? "1" : "0"}
            data-ready={phase !== "loading" ? "1" : undefined}
            data-revealed={phase === "revealed" ? "1" : undefined}
        >
            <header className="g-ptop win">
                <div><b>ซองประจำวัน <i>#{round.day.number}</i></b><span>{title}</span></div>
                <span className="g-coinbox"><Coin /><b>{coins}</b></span>
            </header>
            <div className="g-stage" ref={stage} />
            {phase !== "revealed" && phase !== "playing" && (
                <section className="g-pfoot">
                    <div className="g-recap win">
                        <div className="g-recap-h"><b>เดาถูกครั้งที่ <em>{n}</em></b><span>จาก {round.maxGuesses}</span></div>
                        <ol className="g-track sm">
                            {Array.from({ length: round.maxGuesses }, (_, i) => {
                                const g = round.guesses[i];
                                if (!g) return <li key={i}><em>{i + 1}</em></li>;
                                return (
                                    <li key={i} className={g.correct ? "hit" : "miss"}>
                                        {g.image ? (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img src={proxied(g.image, 96)} alt="" draggable={false} style={{ objectPosition: FOCAL }} />
                                        ) : (
                                            <b className="g-noface" aria-hidden="true">{g.name.trim().charAt(0).toUpperCase()}</b>
                                        )}
                                        <span><Icon name={g.correct ? "check" : "cross"} /></span>
                                    </li>
                                );
                            })}
                        </ol>
                        <ul className="g-ladder row">
                            {LADDER.map((t) => (
                                <li key={t} className={t === tier ? "on" : ""}><Chip tier={t} /><small>{TIER_GUESSES[t]}</small></li>
                            ))}
                        </ul>
                        <div className="g-earn">
                            <span><Icon name="card" />ในซอง</span><b>การ์ด 1 ใบ</b>
                            {res?.bonus ? (
                                <>
                                    <span className="g-sep" />
                                    <span><Coin />โบนัสเดาไว</span><b className="g-plus">+{res.bonus}</b><small>รับแล้ว</small>
                                </>
                            ) : null}
                        </div>
                    </div>
                    <button className="g-btn red big" type="button" onClick={open} disabled={phase !== "ready"}>เปิดซอง</button>
                    <p className="g-tap">แตะซองหรือกดปุ่มเพื่อเปิด</p>
                </section>
            )}
            {phase === "revealed" && (
                <section className="g-reveal">
                    <CardHtml html={cardHtml(res.answer, shown, { day: round.day.key, guesses: n, total: round.anime.characterCount })} />
                    <div className="g-got win" data-res={pull.result} data-shown={shown}>
                        <p className="g-got-a">
                            {pull.result === "new" ? (
                                <><b className="g-tag new">ใบใหม่</b><span>เข้าอัลบั้มแล้ว</span></>
                            ) : pull.result === "upgrade" ? (
                                <><b className="g-tag up">อัปเกรด</b><span>จาก {prev ? TIER_NAME[prev] : "-"} เป็น {TIER_NAME[tier]}</span></>
                            ) : (
                                <><b className="g-tag same">มีแล้ว</b><span>ได้ {TIER_NAME[tier]} แต่ในอัลบั้มมี {prev ? TIER_NAME[prev] : TIER_NAME[tier]} อยู่แล้ว เก็บใบเดิมไว้</span></>
                            )}
                        </p>
                        <p className="g-got-b"><Chip tier={shown} /><span>อัลบั้ม {title}</span><b>{res.ownedInAnime}/{round.anime.characterCount}</b></p>
                        {res.storyUnlockedNow && (
                            <p className="g-unlock"><Icon name="card" /><span>ครบ {UNLOCK} ตัว ปลดล็อกสตอรี่การ์ด {title}</span></p>
                        )}
                    </div>
                    <div className="g-row">
                        <Link className="g-btn" href={round.archive ? `/daily?day=${round.day.key}` : "/daily"} scroll={false}><Icon name="back" />กลับ</Link>
                        <Link className="g-btn red" href={`/daily?view=album&anime=${round.anime.id}`} scroll={false}>
                            <Icon name="album" />{res.storyUnlockedNow ? "ดูสตอรี่การ์ด" : "ดูในอัลบั้ม"}
                        </Link>
                    </div>
                </section>
            )}
            <div className="g-scan" aria-hidden="true" />
        </main>
    );
}
