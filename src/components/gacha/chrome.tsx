"use client";
/** Shared /daily chrome: top bar (wordmark, streak, coins) and footer. */
import Link from "next/link";
import { SlidingNumber } from "@animate-ui/react/primitives/texts/sliding-number";
import { Coin, Icon } from "./pixel";

export function TopBar({ coins, streak, shields = 0, shieldPrice = 30, onShield }: { coins: number | null; streak: number; shields?: number; shieldPrice?: number; onShield?: () => void }) {
    return (
        <header className="g-top">
            <Link className="g-logo" href="/daily" aria-label="GACHA GUESS หน้าเล่น">
                <span className="g-logo-a">GACHA</span> <span className="g-logo-b">GUESS</span>
            </Link>
            <div className="g-stats">
                {streak > 0 && (
                    <span className="g-stat win g-streak" aria-label={`เล่นติดกัน ${streak} วัน`}>
                        <Icon name="flame" />
                        <b><SlidingNumber number={streak} /></b>
                        <small>วัน</small>
                    </span>
                )}
                {coins != null && (
                    <span className="g-stat win" id="coins" aria-label={`เหรียญ ${coins}`}>
                        <Coin />
                        <b><SlidingNumber number={coins} /></b>
                    </span>
                )}
            </div>
            {onShield && coins != null && (
                <>
                    <button className="g-btn sm" type="button" onClick={onShield} disabled={coins < shieldPrice} aria-label={`ซื้อกันสตรีคขาด ${shieldPrice} เหรียญ คงเหลือ ${shields}`}>
                        กันสตรีคขาด{shields > 0 ? ` · มี ${shields}` : ""}
                    </button>
                    {shields === 0 && <small>{shieldPrice} เหรียญ</small>}
                </>
            )}
        </header>
    );
}

export function Footer() {
    return (
        <footer className="g-foot">
            <span>
                ภาพและข้อมูลตัวละครจาก AniList ความคืบหน้าบันทึกบนเซิร์ฟเวอร์ด้วยรหัสผู้เล่นแบบไม่ระบุตัวตน{" "}
                <Link href="/">กลับหน้า WAIFU100</Link>
            </span>
        </footer>
    );
}

/** Thai date for a Bangkok day key, e.g. "จ. 26 ต.ค. 2569". */
export function thaiDate(dayKey: string): string {
    const d = new Date(`${dayKey}T12:00:00+07:00`);
    return new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(d);
}

export const animeTitle = (a: { titleEnglish: string | null; titleRomaji: string }) => a.titleEnglish ?? a.titleRomaji;
export const animeSubtitle = (a: { titleEnglish: string | null; titleRomaji: string; titleNative: string | null }) =>
    a.titleEnglish && a.titleEnglish !== a.titleRomaji ? a.titleRomaji : a.titleNative;
