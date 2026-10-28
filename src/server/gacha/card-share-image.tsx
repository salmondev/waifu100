import { ImageResponse } from "next/og";
import type { ReactNode } from "react";
import type { CardShareTier } from "@/lib/gacha-card-share";
import { loadOgFont } from "@/lib/share-og";
import { getModeratedImage } from "@/server/moderation/moderator";

/** Portrait, the same 63:88 ratio as the in-game card. The embed is the card. */
export const CARD_IMAGE_SIZE = { width: 630, height: 880 };

const STARS: Record<CardShareTier, number> = { common: 0, rare: 1, sr: 2, ssr: 3 };
const TIER_LABEL: Record<CardShareTier, string> = { common: "Common", rare: "Rare", sr: "SR", ssr: "SSR" };

const SILVER = "linear-gradient(145deg, #ffffff 0%, #b3bbcb 16%, #f6f8fc 32%, #848da1 50%, #eef1f6 68%, #9aa3b5 84%, #ffffff 100%)";
const GOLD = "linear-gradient(145deg, #fff6c8 0%, #e8b443 14%, #fff1ae 28%, #b87a1c 46%, #ffe48a 62%, #c88c24 78%, #fff4c4 90%, #a86a12 100%)";
const PRISM = "linear-gradient(135deg, #ff004d 0% 16%, #ffa300 16% 33%, #ffec27 33% 50%, #00e436 50% 66%, #29adff 66% 83%, #ff77a8 83% 100%)";

interface Theme {
    frame: string;
    inner: string;
    plate: string;
    ink: string;
    rim: string;
    star: string;
    line: string;
    artBleed: boolean;
}

const THEME: Record<CardShareTier, Theme> = {
    common: {
        frame: SILVER,
        inner: "linear-gradient(165deg, #f7f1e6 0%, #e7d7c4 100%)",
        plate: "#fffaf2",
        ink: "#1d2b53",
        rim: "#8b93a8",
        star: "#6d768c",
        line: "#3d465c",
        artBleed: false,
    },
    rare: {
        frame: "linear-gradient(145deg, #ffffff 0%, #d5dbe6 18%, #8b93a8 42%, #eef1f6 60%, #6d768c 82%, #f6f8fc 100%)",
        inner: "#1d2b53",
        plate: "#24345f",
        ink: "#fff1e8",
        rim: "#c9cfdb",
        star: "#7ec8ff",
        line: "#e8eef8",
        artBleed: false,
    },
    sr: {
        frame: GOLD,
        inner: "#1d2b53",
        plate: "#141c38",
        ink: "#fff6c8",
        rim: "#ffe48a",
        star: "#ffe48a",
        line: "#f2cf66",
        artBleed: false,
    },
    ssr: {
        frame: PRISM,
        inner: "#0c1430",
        plate: "#0c1430",
        ink: "#fff1e8",
        rim: "#fff1e8",
        star: "#ffd166",
        line: "#fff1e8",
        artBleed: true,
    },
};

export interface CardPicture {
    name: string;
    animeTitle: string;
    tier: CardShareTier;
    dayNumber: number;
    image: string | null;
}

function clip(text: string, max: number): string {
    const chars = [...text.trim()];
    if (chars.length <= max) return chars.join("");
    return `${chars.slice(0, Math.max(1, max - 1)).join("")}…`;
}

/** Five-point star drawn as a shape. Sarabun has no U+2605. */
function Star({ fill }: { fill: string }) {
    return (
        <svg width="36" height="36" viewBox="0 0 24 24">
            <path fill={fill} d="M12 1.4 14.9 8.1 22 8.7 16.6 13.5 18.2 20.5 12 16.8 5.8 20.5 7.4 13.5 2 8.7 9.1 8.1 Z" />
        </svg>
    );
}

function Crest({ tier }: { tier: CardShareTier }) {
    if (tier === "rare") {
        return (
            <svg width="84" height="48" viewBox="0 0 32 18">
                <path fill="#9aa3b5" d="M16 1.2 23.4 9 16 16.8 8.6 9 Z" />
                <path fill="#29adff" d="M16 3.4 21.3 9 16 14.6 10.7 9 Z" />
                <path fill="none" stroke="#ffffff" strokeWidth="0.45" d="M10.7 9 H21.3 M16 3.4 13.6 9 16 14.6 18.4 9 Z" />
            </svg>
        );
    }
    if (tier === "sr") {
        return (
            <svg width="92" height="52" viewBox="0 0 32 18">
                <path fill="#ffe48a" stroke="#5a2d00" strokeWidth="0.35" d="M16 1 18.4 6.2 23.8 6.6 19.7 10.1 21.1 15.4 16 12.5 10.9 15.4 12.3 10.1 8.2 6.6 13.6 6.2 Z" />
                <circle cx="16" cy="8.8" r="2.3" fill="#ff004d" />
                <ellipse cx="15.3" cy="8" rx="0.8" ry="0.45" fill="#ffffff" />
            </svg>
        );
    }
    if (tier === "ssr") {
        return (
            <svg width="78" height="44" viewBox="0 0 32 18">
                <path fill="#fff1e8" d="M16 .6 26 9 16 17.4 6 9 Z" />
                <path fill="#1d2b53" d="M16 2 24.3 9 16 16 7.7 9 Z" />
                <path fill="#ff004d" d="M16 3.6 20.27 7.2 H11.73 Z" />
                <path fill="#ffec27" d="M11.73 7.2 H20.27 L22.4 9 20.27 10.8 H11.73 L9.6 9 Z" />
                <path fill="#29adff" d="M11.73 10.8 H20.27 L16 14.4 Z" />
            </svg>
        );
    }
    return (
        <svg width="72" height="42" viewBox="0 0 32 18">
            <circle cx="16" cy="9" r="7" fill="#d5dbe6" stroke="#3d465c" strokeWidth="0.6" />
            <circle cx="16" cy="9" r="5" fill="#fffaf2" stroke="#1d2b53" strokeWidth="0.4" />
            <ellipse cx="14.2" cy="7.2" rx="1.8" ry="1" fill="#ffffff" />
        </svg>
    );
}

function corner(stroke: string, fill: string, transform: string) {
    return (
        <g transform={transform}>
            <path d="M1.6 22 V6.2 Q1.6 1.6 6.2 1.6 H22" fill="none" stroke={stroke} strokeWidth="0.55" />
            <path d="M3.2 13.5 V7.2 Q3.2 3.2 7.2 3.2 H13.5" fill="none" stroke={stroke} strokeWidth="0.28" />
            <path d="M3.1 3.1 H7.4 A4.3 4.3 0 0 1 3.1 7.4 Z" fill={fill} />
            <circle cx="3.5" cy="3.5" r="0.9" fill={stroke} />
        </g>
    );
}

function Ornament({ tier, stroke, fill }: { tier: CardShareTier; stroke: string; fill: string }) {
    const nodes: ReactNode[] = [
        corner(stroke, fill, ""),
        corner(stroke, fill, "matrix(-1 0 0 1 63 0)"),
        corner(stroke, fill, "matrix(1 0 0 -1 0 88)"),
        corner(stroke, fill, "matrix(-1 0 0 -1 63 88)"),
    ];
    if (tier === "rare" || tier === "sr" || tier === "ssr") {
        nodes.push(
            <path key="gem-l" d="M2.3 40.2 3.7 44 2.3 47.8 0.9 44 Z" fill={fill} />,
            <path key="gem-r" d="M60.7 40.2 62.1 44 60.7 47.8 59.3 44 Z" fill={fill} />,
        );
    }
    if (tier === "ssr") {
        nodes.push(
            <rect key="r1" x="1.5" y="1.5" width="60" height="85" rx="3.6" fill="none" stroke={stroke} strokeWidth="0.45" />,
            <rect key="r2" x="3.1" y="3.1" width="56.8" height="81.8" rx="2.6" fill="none" stroke={stroke} strokeWidth="0.22" />,
        );
    }
    return (
        <svg width="630" height="880" viewBox="0 0 63 88" style={{ position: "absolute", left: 0, top: 0 }}>
            {nodes}
        </svg>
    );
}

/** A portrait card: metal frame, ornaments, crest, name, series, tier. Stars are shapes. */
export function renderCardShareImage(card: CardPicture, font: ArrayBuffer | null): ImageResponse {
    const theme = THEME[card.tier];
    const stars = STARS[card.tier];
    const src = card.image;
    const name = clip(card.name, 18);
    const series = clip(card.animeTitle, 28);
    const bleed = theme.artBleed;
    const artW = bleed ? 566 : 534;
    const artH = bleed ? 520 : 560;
    const plate = (
        <div style={{ display: "flex", flex: 1, padding: 4, background: theme.rim, borderRadius: 16 }}>
            <div
                style={{
                    display: "flex",
                    flex: 1,
                    alignItems: "center",
                    justifyContent: "space-between",
                    background: bleed ? "rgba(12,20,48,0.88)" : theme.plate,
                    borderRadius: 13,
                    padding: "12px 16px 12px 18px",
                }}
            >
                <div style={{ display: "flex", flexDirection: "column" }}>
                                    <div style={{ display: "flex", fontSize: 34, fontWeight: 700, color: theme.ink, lineHeight: 1.1, whiteSpace: "nowrap" }}>{name}</div>
                                    <div style={{ display: "flex", marginTop: 4, fontSize: 20, fontWeight: 700, color: theme.ink, lineHeight: 1.15, whiteSpace: "nowrap" }}>{series}</div>
                </div>
                {stars > 0 ? (
                    <div style={{ display: "flex", marginLeft: 12 }}>
                        {Array.from({ length: stars }, (_, i) => (
                            <Star key={i} fill={theme.star} />
                        ))}
                    </div>
                ) : (
                    <div style={{ display: "flex" }} />
                )}
            </div>
        </div>
    );
    const portrait = src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" width={artW} height={artH} style={{ objectFit: "cover", objectPosition: "50% 30%" }} />
    ) : (
        <div
            style={{
                display: "flex",
                width: artW,
                height: artH,
                alignItems: "center",
                justifyContent: "center",
                background: "#1d2b53",
                color: "#fff1e8",
                fontSize: 160,
                fontWeight: 700,
            }}
        >
            {card.name.trim().charAt(0).toUpperCase() || "?"}
        </div>
    );
    const footer = (
        <div
            style={{
                display: "flex",
                flex: 1,
                alignItems: "center",
                justifyContent: "space-between",
                padding: "12px 18px",
                background: bleed ? "rgba(12,20,48,0.9)" : theme.plate,
                borderRadius: 999,
                border: `3px solid ${theme.rim}`,
            }}
        >
            <div style={{ display: "flex", fontSize: 26, fontWeight: 700, color: theme.star, letterSpacing: 1 }}>{TIER_LABEL[card.tier]}</div>
            <div style={{ display: "flex", fontSize: 22, fontWeight: 700, color: theme.ink }}>waifu100 Daily #{card.dayNumber}</div>
        </div>
    );
    return new ImageResponse(
        (
            <div
                style={{
                    width: "100%",
                    height: "100%",
                    display: "flex",
                    background: theme.frame,
                    padding: bleed ? 18 : 16,
                    position: "relative",
                    fontFamily: "Sarabun",
                }}
            >
                <div
                    style={{
                        flex: 1,
                        display: "flex",
                        flexDirection: "column",
                        background: theme.inner,
                        borderRadius: bleed ? 16 : 22,
                        overflow: "hidden",
                        border: `2px solid ${theme.line}`,
                    }}
                >
                    <div style={{ display: "flex", margin: bleed ? "18px 18px 0" : "20px 20px 0" }}>{plate}</div>
                    <div
                        style={{
                            display: "flex",
                            margin: bleed ? "12px 0 0" : "14px 20px 0",
                            height: artH,
                            borderRadius: bleed ? 0 : 14,
                            overflow: "hidden",
                            background: "#1d2b53",
                            border: bleed ? "0 solid transparent" : `5px solid ${theme.rim}`,
                        }}
                    >
                        {portrait}
                    </div>
                    <div style={{ display: "flex", justifyContent: "center", marginTop: -22 }}>
                        <Crest tier={card.tier} />
                    </div>
                    <div style={{ display: "flex", margin: bleed ? "0 18px 18px" : "0 20px 18px" }}>{footer}</div>
                </div>
                <Ornament tier={card.tier} stroke={theme.line} fill={theme.rim} />
            </div>
        ),
        {
            ...CARD_IMAGE_SIZE,
            ...(font ? { fonts: [{ name: "Sarabun", data: font, weight: 700 as const, style: "normal" as const }] } : {}),
        },
    );
}

/** Checked bytes only. A blocked or unchecked face becomes the initial, never the remote URL. */
async function moderatedFace(url: string | null): Promise<string | null> {
    if (!url || !url.startsWith("https://")) return null;
    try {
        const art = await getModeratedImage(url, 574, { animated: false, height: 640 });
        if (!art.ok || !art.checked) return null;
        return `data:image/jpeg;base64,${art.jpeg.toString("base64")}`;
    } catch {
        return null;
    }
}

/** Drops the photo when it cannot be drawn, so the card still renders. */
export async function cardShareImageResponse(card: CardPicture): Promise<ImageResponse> {
    const font = await loadOgFont();
    const image = await moderatedFace(card.image);
    try {
        return renderCardShareImage({ ...card, image }, font);
    } catch {
        return renderCardShareImage({ ...card, image: null }, font);
    }
}
