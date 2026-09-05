import { GridCell } from "@/types";

/**
 * Counting which series a grid is made of.
 *
 * Every cell carries a `source`, but only some of them carry a *series*. The
 * field is written by whichever path added the character, and only the search
 * paths know a title: picking from AniList/MAL stores "Sousou no Frieren",
 * while an image search stores "Google (www.pinterest.com)", an upload stores
 * "Uploaded", and a re-imported grid stores "Imported". In three real grids the
 * split between real titles and these markers was 50/50, 70/26 and 35/62.
 *
 * So the markers are filtered out rather than charted, and what is left is
 * reported alongside how many cells it actually covers. A breakdown that
 * silently treated "Google (pinterest.com)" as someone's favourite series would
 * be worse than no breakdown at all.
 */

/**
 * Sources that describe where a picture came from, not what the character is
 * from. Matched case-insensitively; the parenthesised ones ("Google (…)",
 * "Official (MAL)") are matched by prefix.
 */
const NON_SERIES_EXACT = new Set(
    [
        "uploaded",
        "uploaded (gif)",
        "url",
        "imported",
        "shared",
        "web search",
        "myanimelist",
        "anilist",
        "unknown",
        "konachan",
        "safebooru",
        "danbooru",
        "anime",
        "game",
    ].map((s) => s.toLowerCase())
);

const NON_SERIES_PREFIX = ["google (", "official (", "gallery (", "custom"];

export function isSeriesName(source: string | null | undefined): source is string {
    if (!source) return false;
    const value = source.trim().toLowerCase();
    if (!value || NON_SERIES_EXACT.has(value)) return false;
    return !NON_SERIES_PREFIX.some((prefix) => value.startsWith(prefix));
}

/** Same title typed two ways ("Free!" / "free") must land on one row. */
function seriesKey(name: string): string {
    return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export interface SeriesRow {
    /** Display title, as spelled in whichever grid used it first. */
    name: string;
    a: number;
    b: number;
}

export interface SeriesStats {
    /** Series present in both grids, biggest shared overlap first. */
    shared: SeriesRow[];
    /** Everything with a known series, ordered by total across both grids. */
    all: SeriesRow[];
    /** How many cells in each grid had a usable series at all. */
    knownA: number;
    knownB: number;
    countA: number;
    countB: number;
}

function tally(grid: GridCell[]): Map<string, { name: string; n: number }> {
    const counts = new Map<string, { name: string; n: number }>();
    grid.forEach((cell) => {
        const source = cell?.character?.source;
        if (!isSeriesName(source)) return;
        const key = seriesKey(source);
        const existing = counts.get(key);
        if (existing) existing.n += 1;
        else counts.set(key, { name: source.trim(), n: 1 });
    });
    return counts;
}

/**
 * The series makeup of two grids, side by side.
 *
 * Deliberately not a percentage of 100: the denominator is "cells whose series
 * we know", which differs per grid, and quietly dividing by 100 would show a
 * grid of uploads as having almost no taste at all.
 */
export function compareSeries(gridA: GridCell[], gridB: GridCell[]): SeriesStats {
    const a = tally(gridA);
    const b = tally(gridB);

    const rows = new Map<string, SeriesRow>();
    for (const [key, { name, n }] of a) {
        rows.set(key, { name, a: n, b: 0 });
    }
    for (const [key, { name, n }] of b) {
        const existing = rows.get(key);
        if (existing) existing.b = n;
        else rows.set(key, { name, a: 0, b: n });
    }

    const all = [...rows.values()].sort(
        (x, y) => y.a + y.b - (x.a + x.b) || x.name.localeCompare(y.name)
    );

    // A series both people picked from is the interesting row: it is a shared
    // taste even when they picked different characters out of it.
    const shared = all
        .filter((row) => row.a > 0 && row.b > 0)
        .sort((x, y) => Math.min(y.a, y.b) - Math.min(x.a, x.b) || y.a + y.b - (x.a + x.b));

    const sum = (m: Map<string, { n: number }>) =>
        [...m.values()].reduce((total, entry) => total + entry.n, 0);

    return {
        shared,
        all,
        knownA: sum(a),
        knownB: sum(b),
        countA: gridA.filter((cell) => cell.character).length,
        countB: gridB.filter((cell) => cell.character).length,
    };
}
