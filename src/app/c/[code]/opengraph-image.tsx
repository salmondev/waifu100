import { cardShareImageResponse, CARD_IMAGE_SIZE } from "@/server/gacha/card-share-image";
import { loadCardShare } from "@/server/gacha/service";

export const runtime = "nodejs";
export const alt = "การ์ด Gacha Guess";
export const size = CARD_IMAGE_SIZE;
export const contentType = "image/png";

/** The link preview is the card this code was minted for. */
export default async function Image({ params }: { params: Promise<{ code: string }> }) {
    const { code } = await params;
    const view = await loadCardShare(code);
    return cardShareImageResponse(
        view
            ? { name: view.name, animeTitle: view.animeTitle, tier: view.tier, dayNumber: view.dayNumber, image: view.image }
            : { name: "?", animeTitle: "WAIFU100", tier: "common", dayNumber: 0, image: null },
    );
}
