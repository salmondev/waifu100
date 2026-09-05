import { GridCell } from "@/types";
import { matchKey } from "@/lib/character-match";

/**
 * Counting which series a grid is made of.
 *
 * Two sources of truth, in this order:
 *
 *  1. the `source` stored on the cell, when it is actually a series title. It
 *     only is when the character came from a search - image picks store
 *     "Google (www.pinterest.com)", uploads store "Uploaded", and across three
 *     real grids the split of titles to markers was 50/50, 70/26 and 35/62;
 *  2. the character's name, looked up on AniList and cached (see
 *     src/lib/series-resolve.ts), which is what closes that gap.
 *
 * Anything still unknown is counted as unknown and said out loud, rather than
 * quietly dropped: a chart that hid how much it could not read would overstate
 * what it knows.
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

/** The minimum a character needs for counting: who it is, and what it says it is. */
export interface SeriesInput {
    name: string;
    source?: string | null;
    /** Carried so the chart can show the faces behind a row when it is opened. */
    image?: string | null;
}

/** Resolved series by normalised character name; "" means "asked, unknown". */
export type SeriesResolution = Record<string, string>;

/** The series for one character, or null when nothing knows. */
export function seriesOf(
    character: SeriesInput,
    resolved: SeriesResolution = {}
): string | null {
    if (isSeriesName(character.source)) return character.source.trim();
    const looked = resolved[matchKey(character.name)];
    return looked ? looked : null;
}

/** Characters whose series nothing knows yet - the list worth looking up. */
export function unresolvedNames(
    characters: SeriesInput[],
    resolved: SeriesResolution = {}
): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const character of characters) {
        if (isSeriesName(character.source)) continue;
        const key = matchKey(character.name);
        // A key already in `resolved` has been asked about, even if the answer
        // was "no idea" - asking again would just repeat the miss.
        if (!key || seen.has(key) || key in resolved) continue;
        seen.add(key);
        out.push(character.name);
    }
    return out;
}

export interface SeriesRow {
    /** Display title, as spelled by whichever side used it first. */
    name: string;
    a: number;
    b: number;
    /** The characters behind the numbers, for the row detail. */
    charactersA: SeriesInput[];
    charactersB: SeriesInput[];
}

export interface SeriesStats {
    /** Series present in both grids, biggest shared overlap first. */
    shared: SeriesRow[];
    /** Series in A, biggest first (b is included for context). */
    aOnly: SeriesRow[];
    bOnly: SeriesRow[];
    /** How many characters on each side have a series at all. */
    knownA: number;
    knownB: number;
    countA: number;
    countB: number;
}

/**
 * Groups one side's characters by series.
 *
 * The characters ride along with the count because the chart's rows open: a
 * number nobody can unpack is a dead end, and the faces are already in hand.
 */
function tally(
    characters: SeriesInput[],
    resolved: SeriesResolution
): Map<string, { name: string; members: SeriesInput[] }> {
    const counts = new Map<string, { name: string; members: SeriesInput[] }>();
    characters.forEach((character) => {
        const series = seriesOf(character, resolved);
        if (!series) return;
        const key = seriesKey(series);
        const existing = counts.get(key);
        if (existing) existing.members.push(character);
        else counts.set(key, { name: series, members: [character] });
    });
    return counts;
}

/** Every filled cell of a grid, as counting input. */
export function charactersOf(grid: GridCell[]): SeriesInput[] {
    return grid
        .filter((cell) => cell?.character)
        .map((cell) => ({
            name: cell.character!.name,
            source: cell.character!.source,
            image:
                cell.character!.customImageUrl ||
                cell.character!.images?.jpg?.image_url ||
                null,
        }));
}

/**
 * The series makeup of two sides.
 *
 * Deliberately not a percentage of 100: the denominator is "characters whose
 * series we know", which differs per grid, and quietly dividing by 100 would
 * show a grid of uploads as having almost no taste at all.
 */
export function compareSeries(
    aChars: SeriesInput[],
    bChars: SeriesInput[],
    resolved: SeriesResolution = {}
): SeriesStats {
    const a = tally(aChars, resolved);
    const b = tally(bChars, resolved);

    const rows = new Map<string, SeriesRow>();
    for (const [key, { name, members }] of a) {
        rows.set(key, {
            name,
            a: members.length,
            b: 0,
            charactersA: members,
            charactersB: [],
        });
    }
    for (const [key, { name, members }] of b) {
        const existing = rows.get(key);
        if (existing) {
            existing.b = members.length;
            existing.charactersB = members;
        } else {
            rows.set(key, { name, a: 0, b: members.length, charactersA: [], charactersB: members });
        }
    }

    const all = [...rows.values()];

    // A series both people picked from is the interesting row: it is a shared
    // taste even when they picked different characters out of it. Ordered by
    // the smaller side, so "4 and 4" beats "9 and 1".
    const shared = all
        .filter((row) => row.a > 0 && row.b > 0)
        .sort((x, y) => Math.min(y.a, y.b) - Math.min(x.a, x.b) || y.a + y.b - (x.a + x.b));

    const aOnly = all.filter((row) => row.a > 0).sort((x, y) => y.a - x.a);
    const bOnly = all.filter((row) => row.b > 0).sort((x, y) => y.b - x.b);

    const sum = (m: Map<string, { members: SeriesInput[] }>) =>
        [...m.values()].reduce((total, entry) => total + entry.members.length, 0);

    return {
        shared,
        aOnly,
        bOnly,
        knownA: sum(a),
        knownB: sum(b),
        countA: aChars.length,
        countB: bChars.length,
    };
}
