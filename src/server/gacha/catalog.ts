/**
 * Server-side access to the Gacha Guess catalog. The JSON is only ever loaded
 * here, so it never ends up in a client bundle (the answer pool would be
 * readable from the page otherwise). Tests inject a fixture with setCatalog().
 */
import type { Catalog, CatalogAnime, CatalogCharacter } from "./catalog-types";

export type { Catalog, CatalogAnime, CatalogCharacter, HairKey } from "./catalog-types";

export interface CatalogIndex {
    catalog: Catalog;
    anime: Map<number, CatalogAnime>;
    /** character id -> its character + anime */
    characters: Map<number, { character: CatalogCharacter; anime: CatalogAnime }>;
}

let injected: CatalogIndex | null = null;
let loaded: Promise<CatalogIndex> | null = null;

export function indexCatalog(catalog: Catalog): CatalogIndex {
    const anime = new Map<number, CatalogAnime>();
    const characters = new Map<number, { character: CatalogCharacter; anime: CatalogAnime }>();
    for (const a of catalog.anime) {
        anime.set(a.id, a);
        // A character appearing in two anime belongs to the first one listed.
        for (const c of a.characters) if (!characters.has(c.id)) characters.set(c.id, { character: c, anime: a });
    }
    return { catalog, anime, characters };
}

/** Test seam: use this catalog instead of catalog.json; null goes back to the file. */
export function setCatalog(catalog: Catalog | null): void {
    injected = catalog ? indexCatalog(catalog) : null;
}

export async function getCatalog(): Promise<CatalogIndex> {
    if (injected) return injected;
    if (!loaded) {
        loaded = import("./catalog.json")
            .then((m) => indexCatalog((m.default ?? m) as unknown as Catalog))
            .catch((e) => {
                loaded = null;
                throw e;
            });
    }
    return loaded;
}
