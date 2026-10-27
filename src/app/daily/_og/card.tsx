/**
 * Link-preview image for /daily (T-0025): 1200 x 630, static (built once, no Redis or AniList, nothing written).
 * Gacha Guess v2 look: sky ground, paper panel with an ink outline and a hard offset shadow, red/yellow confetti
 * squares, and four face-down cards showing the rarity frames (Common story colour, Rare silver, SR gold chrome,
 * SSR hard-stop rainbow foil). No character art or names, so it never spoils the day's answer.
 * Fonts: Mitr (Thai + Latin) and Silkscreen, converted from the repo's own OFL woff2 files (public/fonts/gacha;
 * licences next to the .ttf files), read from disk at build time. No runtime font fetch.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_ALT = "Gacha Guess รายวัน โดย WAIFU100: ทายตัวละครอนิเมะวันละตัว เปิดซอง สะสมการ์ด 4 ระดับ";

const C = { ink: "#1d2b53", paper: "#fff1e8", sky: "#29adff", red: "#ff004d", orange: "#ffa300", yellow: "#ffec27", green: "#00e436", pink: "#ff77a8", wine: "#7e2553" };
const RAINBOW = `linear-gradient(135deg, ${C.red} 0%, ${C.red} 16%, ${C.orange} 16%, ${C.orange} 33%, ${C.yellow} 33%, ${C.yellow} 50%, ${C.green} 50%, ${C.green} 66%, ${C.sky} 66%, ${C.sky} 83%, ${C.pink} 83%, ${C.pink} 100%)`;

type Tier = { label: string; name: string; frame: string; chip: string; chipInk: string };
const TIERS: Tier[] = [
    { label: "C", name: "Common", frame: `linear-gradient(165deg, #ffb3cf 0%, ${C.pink} 40%, ${C.wine} 100%)`, chip: C.paper, chipInk: C.ink },
    { label: "R", name: "Rare", frame: "linear-gradient(165deg, #ffffff 0%, #d9dde8 35%, #8b93a8 100%)", chip: C.paper, chipInk: C.ink },
    { label: "SR", name: "SR", frame: "linear-gradient(165deg, #fff6c2 0%, #f2cf66 40%, #b8862a 100%)", chip: C.ink, chipInk: "#ffe48a" },
    { label: "SSR", name: "SSR", frame: RAINBOW, chip: C.ink, chipInk: C.yellow },
];

const font = (f: string) => readFile(join(process.cwd(), "src/app/daily/_og", f));

function Card({ t, x, y, rot }: { t: Tier; x: number; y: number; rot: number }) {
    // the tier chip sits top-left so the next card in the fan (laid over the right side) never hides it
    return (
        <div style={{ position: "absolute", left: x, top: y, width: 150, height: 210, display: "flex", transform: `rotate(${rot}deg)`,
            borderRadius: 14, background: t.frame, border: `4px solid ${C.ink}`, boxShadow: `7px 8px 0 ${C.ink}`, padding: 11 }}>
            <div style={{ flex: 1, display: "flex", position: "relative", alignItems: "center", justifyContent: "center", borderRadius: 7,
                background: C.ink, border: `3px solid ${C.paper}` }}>
                <div style={{ position: "absolute", left: 8, top: 8, display: "flex", padding: "2px 9px", borderRadius: 999, background: t.chip,
                    fontFamily: "Silkscreen", fontSize: 20, color: t.chipInk }}>{t.label}</div>
                <div style={{ display: "flex", marginTop: 18, fontFamily: "Silkscreen", fontSize: 76, color: C.paper, lineHeight: 1 }}>?</div>
            </div>
        </div>
    );
}

const Confetti = ({ x, y, s, a, b }: { x: number; y: number; s: number; a: string; b: string }) => (
    <div style={{ position: "absolute", left: x, top: y, width: s, height: s, background: a, boxShadow: `${s / 2}px ${s / 2}px 0 ${b}` }} />
);

export async function renderDailyOg(): Promise<ImageResponse> {
    const [thai600, thai400, latin600, latin400, bit] = await Promise.all([font("mitr-thai-600.ttf"), font("mitr-thai-400.ttf"), font("mitr-latin-600.ttf"), font("mitr-latin-400.ttf"), font("silkscreen-latin-700.ttf")]);
    return new ImageResponse(
        (
            <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", background: C.sky, fontFamily: "Mitr, Mitr Thai", color: C.ink }}>
                {/* faint grid ground, like graph paper */}
                <div style={{ position: "absolute", inset: 0, display: "flex", backgroundImage: "linear-gradient(rgba(255,255,255,.14) 2px, transparent 2px), linear-gradient(90deg, rgba(255,255,255,.14) 2px, transparent 2px)", backgroundSize: "40px 40px" }} />
                <Confetti x={46} y={40} s={18} a={C.red} b={C.yellow} />
                <Confetti x={600} y={36} s={14} a={C.yellow} b={C.red} />
                <Confetti x={1128} y={560} s={18} a={C.red} b={C.yellow} />
                <Confetti x={70} y={574} s={12} a={C.green} b={C.paper} />
                <Confetti x={1140} y={44} s={12} a={C.paper} b={C.pink} />

                {/* text panel */}
                <div style={{ position: "absolute", left: 52, top: 92, width: 640, height: 446, display: "flex", flexDirection: "column", justifyContent: "center",
                    padding: "0 44px", background: C.paper, border: `5px solid ${C.ink}`, borderRadius: 22, boxShadow: `12px 12px 0 ${C.ink}` }}>
                    <div style={{ display: "flex" }}>
                        <div style={{ display: "flex", padding: "6px 14px", background: C.ink, color: C.yellow, fontFamily: "Silkscreen", fontSize: 24, borderRadius: 8 }}>WAIFU100 DAILY</div>
                    </div>
                    <div style={{ display: "flex", marginTop: 18, fontSize: 80, fontWeight: 600, lineHeight: 1, letterSpacing: -1, whiteSpace: "nowrap" }}>Gacha Guess</div>
                    <div style={{ display: "flex", marginTop: 22, fontSize: 44, fontWeight: 600, lineHeight: 1.25 }}>ทายตัวละครอนิเมะวันละตัว</div>
                    <div style={{ display: "flex", marginTop: 10, fontSize: 30, fontWeight: 400, lineHeight: 1.3, color: C.wine }}>ดูคำใบ้ เปิดซอง สะสมการ์ด 4 ระดับ</div>
                    <div style={{ display: "flex", alignItems: "center", marginTop: 30 }}>
                        <div style={{ display: "flex", padding: "8px 26px 12px", background: C.red, color: C.paper, fontSize: 30, fontWeight: 600, borderRadius: 12, border: `4px solid ${C.ink}`, boxShadow: `5px 5px 0 ${C.ink}` }}>เล่นเลย</div>
                        <div style={{ display: "flex", marginLeft: 24, fontFamily: "Silkscreen", fontSize: 20, whiteSpace: "nowrap", color: C.ink }}>waifu100.vercel.app/daily</div>
                    </div>
                </div>

                {/* four face-down cards, fanned left to right: Common, Rare, SR, SSR (SSR on top) */}
                <Card t={TIERS[0]} x={724} y={232} rot={-10} />
                <Card t={TIERS[1]} x={826} y={196} rot={-3} />
                <Card t={TIERS[2]} x={928} y={196} rot={4} />
                <Card t={TIERS[3]} x={1024} y={232} rot={11} />
            </div>
        ),
        {
            ...OG_SIZE,
            fonts: [
                { name: "Mitr", data: latin600, weight: 600, style: "normal" },
                { name: "Mitr Thai", data: thai600, weight: 600, style: "normal" },
                { name: "Mitr", data: latin400, weight: 400, style: "normal" },
                { name: "Mitr Thai", data: thai400, weight: 400, style: "normal" },
                { name: "Silkscreen", data: bit, weight: 700, style: "normal" },
            ],
        },
    );
}
