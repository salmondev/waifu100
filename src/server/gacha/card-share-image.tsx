import { ImageResponse } from "next/og";
import { cardShareHeading, type CardShareTier } from "@/lib/gacha-card-share";
import { loadOgFont } from "@/lib/share-og";
import { getModeratedImage } from "@/server/moderation/moderator";

/** Portrait, the same 63:88 ratio as the in-game card. The embed is the card. */
export const CARD_IMAGE_SIZE = { width: 630, height: 880 };

const FRAME: Record<CardShareTier, string> = {
    common: "#8b9099",
    rare: "#6d768c",
    sr: "#b87a1c",
    ssr: "#1d2b53",
};

export interface CardPicture {
    name: string;
    animeTitle: string;
    tier: CardShareTier;
    dayNumber: number;
    image: string | null;
}

/** A still of the pull: the character fills the card, with the name and tier on it. */
export function renderCardShareImage(card: CardPicture, font: ArrayBuffer | null): ImageResponse {
    const src = card.image;
    const ink = card.tier === "ssr" ? "#fff1e8" : "#1d2b53";
    const band = card.tier === "ssr" ? "rgba(29,43,83,.88)" : "#fff1e8";
    const heading = cardShareHeading(card.tier, card.name);
    return new ImageResponse(
        (
            <div
                style={{
                    width: "100%",
                    height: "100%",
                    display: "flex",
                    background: FRAME[card.tier],
                    padding: 18,
                }}
            >
                <div
                    style={{
                        flex: 1,
                        display: "flex",
                        flexDirection: "column",
                        background: "#1d2b53",
                        borderRadius: 28,
                        overflow: "hidden",
                    }}
                >
                    {src ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={src} alt="" width={594} height={620} style={{ objectFit: "cover", objectPosition: "50% 30%" }} />
                    ) : (
                        <div
                            style={{
                                display: "flex",
                                width: 594,
                                height: 620,
                                alignItems: "center",
                                justifyContent: "center",
                                background: "#1d2b53",
                                color: "#fff1e8",
                                fontSize: 160,
                            }}
                        >
                            {card.name.trim().charAt(0).toUpperCase() || "?"}
                        </div>
                    )}
                    <div
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            padding: "18px 28px 20px",
                            background: band,
                            color: ink,
                        }}
                    >
                        <div style={{ display: "flex", fontSize: 36, fontWeight: 700, lineHeight: 1.15 }}>{heading}</div>
                        <div style={{ display: "flex", fontSize: 24, marginTop: 6, lineHeight: 1.2 }}>{card.animeTitle}</div>
                        <div style={{ display: "flex", fontSize: 22, marginTop: 8 }}>waifu100 Daily #{card.dayNumber}</div>
                    </div>
                </div>
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
        const art = await getModeratedImage(url, 594, { animated: false, height: 620 });
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
