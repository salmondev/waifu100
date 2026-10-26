"use client";
/**
 * Gacha Guess client root for /daily. Views: play (default), pack
 * (?view=pack), album (?view=album&anime=ID) and archive (?view=archive).
 * `?day=YYYY-MM-DD` plays (or views) that past day instead of today, in the
 * play and pack views. All state lives on the
 * server; this keeps the latest RoundDto / AlbumDto and swaps views.
 */
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { domAnimation, LazyMotion, m, MotionConfig } from "motion/react";
import { useEffect, useState } from "react";
import { AlbumView } from "./album";
import { errorText, gachaApi, type AlbumDto, type ArchiveDto, type RoundDto } from "./api";
import { ArchiveView } from "./archive";
import { CardDefs } from "./card";
import { Footer, TopBar } from "./chrome";
import { PackView, wasOpened } from "./pack";
import { PlayView, steps4 } from "./play";

export function GachaApp() {
    const params = useSearchParams();
    const router = useRouter();
    const viewParam = params.get("view");
    const view = viewParam === "album" || viewParam === "pack" || viewParam === "archive" ? viewParam : "play";
    const animeParam = Number(params.get("anime")) || null;
    const dayRaw = params.get("day");
    const dayParam = dayRaw && /^\d{4}-\d{2}-\d{2}$/.test(dayRaw) ? dayRaw : null;
    const [today, setToday] = useState<RoundDto | null>(null);
    const [past, setPast] = useState<RoundDto | null>(null);
    const [album, setAlbum] = useState<AlbumDto | null>(null);
    const [archive, setArchive] = useState<ArchiveDto | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [nonce, setNonce] = useState(0);

    useEffect(() => {
        let alive = true;
        // Today's round first: it creates the profile (and today's coins) for a new player.
        gachaApi
            .today()
            .then(async (r) => {
                if (!alive) return;
                setToday(r);
                setError(null);
                if (dayParam && dayParam !== r.day.key) {
                    setPast(null);
                    const p = await gachaApi.day(dayParam);
                    if (alive) setPast(p);
                }
            })
            .catch((e) => alive && setError(errorText(e)));
        return () => {
            alive = false;
        };
    }, [nonce, dayParam]);
    useEffect(() => {
        if (view !== "archive" || !today) return;
        let alive = true;
        gachaApi
            .archive()
            .then((a) => alive && setArchive(a))
            .catch((e) => alive && setError(errorText(e)));
        return () => {
            alive = false;
        };
    }, [view, nonce, today]);
    useEffect(() => {
        if (view !== "album") return;
        let alive = true;
        gachaApi
            .album()
            .then((a) => alive && setAlbum(a))
            .catch((e) => alive && setError(errorText(e)));
        return () => {
            alive = false;
        };
    }, [view, nonce, today?.done, past?.done]);

    const isPast = !!dayParam && !!today && dayParam !== today.day.key;
    const round = isPast ? (past?.day.key === dayParam ? past : null) : today;
    const setRound = (r: RoundDto) => (r.archive ? setPast(r) : setToday(r));
    // Every DTO carries the profile's coins / streak; the round on screen is the freshest.
    const coins = (round ?? today)?.coins ?? album?.coins ?? null;
    const streak = (round ?? today)?.streak ?? album?.streak ?? 0;
    let body: React.ReactNode;
    if (error && (view === "archive" ? !archive : !round)) {
        body = (
            <main className="g-empty">
                <div className="win g-emptywin">
                    <p>{error}</p>
                    <button className="g-btn red" type="button" onClick={() => setNonce((n) => n + 1)}>ลองใหม่</button>
                    {dayParam && <Link className="g-btn" href="/daily?view=archive" scroll={false}>เลือกวันอื่น</Link>}
                </div>
            </main>
        );
    } else if (view === "album") {
        body = album ? (
            <AlbumView album={album} round={today} animeParam={animeParam} onRestored={() => setNonce((n) => n + 1)} />
        ) : (
            <main className="g-empty" aria-busy="true"><div className="win g-emptywin"><p>กำลังเปิดอัลบั้ม</p></div></main>
        );
    } else if (view === "archive") {
        body = archive ? (
            <ArchiveView archive={archive} />
        ) : (
            <main className="g-empty" aria-busy="true"><div className="win g-emptywin"><p>กำลังโหลดวันย้อนหลัง</p></div></main>
        );
    } else if (!round) {
        body = <main className="g-empty" aria-busy="true"><div className="win g-emptywin"><p>กำลังโหลดรอบของวันนี้</p></div></main>;
    } else if (view === "pack") {
        body = <PackView round={round} coins={round.coins} />;
    } else {
        body = (
            <PlayView
                round={round}
                onRound={setRound}
                opened={wasOpened(round.day.key)}
                onOpenPack={() => router.push(round.archive ? `/daily?view=pack&day=${round.day.key}` : "/daily?view=pack", { scroll: false })}
            />
        );
    }

    return (
        <LazyMotion features={domAnimation} strict>
            <MotionConfig reducedMotion="user">
                <div className="gg" data-view={view}>
                    <CardDefs />
                    {view !== "pack" && <TopBar coins={coins} streak={streak} />}
                    <m.div key={view} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2, ease: steps4 }}>
                        {body}
                    </m.div>
                    {view !== "pack" && <Footer />}
                </div>
            </MotionConfig>
        </LazyMotion>
    );
}
