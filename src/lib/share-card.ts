/**
 * Where to find the server-rendered card for a share.
 *
 * Kept apart from the renderer itself so client components can link to a card
 * without dragging the image pipeline into the browser bundle.
 */

/**
 * Bump whenever the card design changes. Cards are cached for a year, so
 * without this a redesign would never reach anything already rendered.
 */
export const CARD_VERSION = 3;

export function shareCardPath(id: string) {
    return `/api/share/image/${id}?v=${CARD_VERSION}`;
}

/**
 * The compare card is a different drawing with a different lifetime, so it
 * carries its own version rather than riding on the share card's - bumping one
 * design should not invalidate a year of the other's cache.
 */
export const COMPARE_CARD_VERSION = 1;

export function compareCardPath(a: string, b: string) {
    return `/api/compare/image?a=${encodeURIComponent(a)}&b=${encodeURIComponent(
        b
    )}&v=${COMPARE_CARD_VERSION}`;
}
