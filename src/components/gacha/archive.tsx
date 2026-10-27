"use client";
/**
 * Archive view (/daily?view=archive): today plus the past ARCHIVE_DAYS days.
 * A day this player never played opens as a fresh round; a finished day opens
 * its result read-only. The server decides which days exist (never future,
 * never before the game's first day); this only lists what it returns.
 */
import Link from "next/link";
import type { ArchiveDayState, ArchiveDto } from "./api";
import { thaiDate } from "./chrome";
import { Chip, Icon, type TierName } from "./pixel";

const STATE_TEXT: Record<ArchiveDayState, string> = {
    new: "ยังไม่เล่น",
    playing: "เล่นค้างไว้",
    won: "เดาถูก",
    lost: "ไม่ได้การ์ด",
};

function StateTag({ state, tier }: { state: ArchiveDayState; tier: string | null }) {
    if (state === "won" && tier) return <span className="g-arch-st won"><Icon name="check" />{STATE_TEXT.won}<Chip tier={tier as TierName} /></span>;
    const icon = state === "won" ? "check" : state === "lost" ? "cross" : state === "playing" ? "next" : "unknown";
    return <span className={`g-arch-st ${state}`}><Icon name={icon} />{STATE_TEXT[state]}</span>;
}

export function ArchiveView({ archive }: { archive: ArchiveDto }) {
    const open = archive.days.filter((d) => d.state === "new").length;
    return (
        <main className="g-play g-arch">
            <section className="win g-arch-head">
                <div className="g-dayline">
                    <h1>ย้อนหลัง</h1>
                    <p><span>เล่นได้อีก {open} วัน</span><span>จาก {archive.days.length} วันที่ผ่านมา</span></p>
                </div>
                <p className="g-archnote">
                    วันที่ยังไม่เคยเล่นเล่นได้ 1 รอบ วันที่เล่นจบแล้วดูผลได้อย่างเดียว ได้การ์ดตามระดับและเหรียญรายวัน
                    (ได้ตอนจบรอบ วันละครั้ง) เหมือนปกติ แต่ไม่มีโบนัสเดาไว และไม่นับวันติดกัน
                </p>
                <Link className="g-btn red g-arch-today" href="/daily" scroll={false}>
                    <Icon name="back" />
                    <span>วันนี้ #{archive.today.number}{archive.today.anime ? ` · ${archive.today.anime}` : ""}</span>
                    <StateTag state={archive.today.state} tier={archive.today.tier} />
                </Link>
            </section>
            {archive.days.length === 0 ? (
                <p className="win g-arch-empty">ยังไม่มีวันย้อนหลัง</p>
            ) : (
                <ol className="g-arch-list" aria-label="วันย้อนหลัง">
                    {archive.days.map((d) => (
                        <li key={d.key}>
                            <Link className={`win g-arch-day ${d.state}`} href={`/daily?day=${d.key}`} scroll={false} aria-label={`#${d.number} ${d.anime} ${thaiDate(d.key)} ${STATE_TEXT[d.state]}`}>
                                <b>#{d.number}</b>
                                <span className="g-arch-date">
                                    <span className="g-arch-anime">{d.anime}</span>
                                    {thaiDate(d.key)}
                                </span>
                                <StateTag state={d.state} tier={d.tier} />
                            </Link>
                        </li>
                    ))}
                </ol>
            )}
        </main>
    );
}
