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
export const CARD_VERSION = 2;

export function shareCardPath(id: string) {
    return `/api/share/image/${id}?v=${CARD_VERSION}`;
}
