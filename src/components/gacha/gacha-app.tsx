"use client";
/**
 * Gacha Guess client root for /daily. Views: play (default), pack
 * (?view=pack) and album (?view=album&anime=ID). All state lives on the
 * server; this keeps the latest RoundDto / AlbumDto and swaps views.
 */
import { useRouter, useSearchParams } from "next/navigation";
import { domAnimation, LazyMotion, m, MotionConfig } from "motion/react";
import { useEffect, useState } from "react";
import { AlbumView } from "./album";
import { errorText, gachaApi, type AlbumDto, type RoundDto } from "./api";
import { CardDefs } from "./card";
import { Footer, TopBar } from "./chrome";
import { PackView, wasOpened } from "./pack";
import { PlayView, steps4 } from "./play";

export function GachaApp() {
    const params = useSearchParams();
    const router = useRouter();
    const view = params.get("view") === "album" ? "album" : params.get("view") === "pack" ? "pack" : "play";
    const animeParam = Number(params.get("anime")) || null;
    const [round, setRound] = useState<RoundDto | null>(null);
    const [album, setAlbum] = useState<AlbumDto | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [nonce, setNonce] = useState(0);

    useEffect(() => {
        let alive = true;
        gachaApi
            .today()
            .then((r) => {
                if (!alive) return;
                setRound(r);
                setError(null);
            })
            .catch((e) => alive && setError(errorText(e)));
        return () => {
            alive = false;
        };
    }, [nonce]);
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
    }, [view, nonce, round?.done]);

    const coins = round?.coins ?? album?.coins ?? null;
    const streak = round?.streak ?? album?.streak ?? 0;
    let body: React.ReactNode;
    if (error && !round) {
        body = (
            <main className="g-empty">
                <div className="win g-emptywin">
                    <p>{error}</p>
                    <button className="g-btn red" type="button" onClick={() => setNonce((n) => n + 1)}>ลองใหม่</button>
                </div>
            </main>
        );
    } else if (view === "album") {
        body = album ? (
            <AlbumView album={album} round={round} animeParam={animeParam} onRestored={() => setNonce((n) => n + 1)} />
        ) : (
            <main className="g-empty" aria-busy="true"><div className="win g-emptywin"><p>กำลังเปิดอัลบั้ม</p></div></main>
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
                onOpenPack={() => router.push("/daily?view=pack", { scroll: false })}
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
