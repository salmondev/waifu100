import { isGifUrl } from "@/lib/utils";
import { decodeShareObject, type ShareKind } from "@/lib/share-schema";

/**
 * The card-sized view of a share.
 *
 * Everything here is derived from the one `GET waifu100:share:<id>` the list
 * endpoints already do - no extra round trips, and crucially the full grid
 * never leaves the server. A feed page of 50 grids is 50 payloads of ~100
 * characters each; sending that to the browser to count cells would be orders
 * of magnitude more bytes than the numbers below.
 */
export interface ShareSummary {
    id: string;
    title: string;
    imageUrl: string | null;
    createdAt: string;
    /** Any animated cell - drives the GIF chip. */
    hasGif: boolean;
    /** How many of the 100 slots are filled. */
    count: number;
    /** Absent on summaries cached before story100: read as "waifu". */
    kind?: ShareKind;
    /** Absent means 100. */
    size?: number;
    /** Story custom layout columns; absent = preset layout of `size`. */
    cols?: number;
    /**
     * Story feed responses only: up to 4 cell image URLs for a card without an imageUrl.
     * Filled in per request from the payload (read-only) and never written to the summary cache.
     */
    previews?: string[];
}

interface RawCell {
    character?: {
        customImageUrl?: string;
        images?: { jpg?: { image_url?: string } };
    };
}

/**
 * Turns the stored JSON for one share into a summary, or null when it should
 * not be listed at all.
 *
 * Titles like "Loading..." come from shares saved mid-generation; they are
 * broken rather than merely ugly, so they are dropped from every listing.
 */
export function summarizeShare(id: string, rawJson: string): ShareSummary | null {
    try {
        const parsed = JSON.parse(rawJson);
        const title: string = parsed.meta?.title || "Untitled Grid";

        if (/loading|generating|captioning/i.test(title)) return null;

        // Very old shares stored the bare array; newer ones nest it under .grid.
        const cells: RawCell[] = Array.isArray(parsed) ? parsed : parsed.grid || [];

        const hasGif = cells.some(
            (cell) =>
                isGifUrl(cell?.character?.customImageUrl) ||
                isGifUrl(cell?.character?.images?.jpg?.image_url)
        );

        const decoded = decodeShareObject(parsed);
        if (decoded?.kind === "story") {
            return {
                id,
                title,
                imageUrl: decoded.imageUrl,
                createdAt: parsed.meta?.createdAt,
                hasGif: false,
                count: decoded.count,
                kind: "story",
                size: decoded.size,
                ...(decoded.cols ? { cols: decoded.cols } : {}),
            };
        }

        return {
            id,
            title,
            imageUrl: parsed.meta?.imageUrl || null,
            createdAt: parsed.meta?.createdAt,
            hasGif,
            count: cells.filter((cell) => cell?.character).length,
        };
    } catch {
        return null;
    }
}

/** The owner recorded on a share, or null for the pre-owner-id era. */
export function shareOwnerId(rawJson: string): string | null {
    try {
        const parsed = JSON.parse(rawJson);
        const owner = parsed?.meta?.userId;
        return typeof owner === "string" && owner ? owner : null;
    } catch {
        return null;
    }
}
