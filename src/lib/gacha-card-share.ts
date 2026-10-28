/**
 * Share text for one won card. The link is the card: opening it shows that
 * pull, and chats unfurl the card image. The square result text stays separate.
 *
 *   SSR ★★★ Frieren
 *   waifu100 Daily #30
 *   https://waifu100.vercel.app/c/<code>
 *
 * Common has no stars. Client-safe.
 */
export const CARD_SHARE_ORIGIN = "https://waifu100.vercel.app";
export const CARD_SHARE_INVITE = "ทายตัวละครอนิเมะ สะสมการ์ด";

const STARS = { common: 0, rare: 1, sr: 2, ssr: 3 } as const;
const TIER_NAME = { common: "Common", rare: "Rare", sr: "SR", ssr: "SSR" } as const;

export type CardShareTier = keyof typeof STARS;

export function cardShareUrl(code: string): string {
    return `${CARD_SHARE_ORIGIN}/c/${code}`;
}

/** `SSR ★★★ Frieren`, or `Common Frieren` when the tier has no stars. */
export function cardShareHeading(tier: CardShareTier, name: string): string {
    const stars = "★".repeat(STARS[tier]);
    return stars ? `${TIER_NAME[tier]} ${stars} ${name}` : `${TIER_NAME[tier]} ${name}`;
}

export function cardShareDescription(dayNumber: number): string {
    return `waifu100 Daily #${dayNumber} · ${CARD_SHARE_INVITE}`;
}

export function cardShareText(tier: CardShareTier, name: string, dayNumber: number, url: string): string {
    return [cardShareHeading(tier, name), `waifu100 Daily #${dayNumber}`, url].join("\n");
}
