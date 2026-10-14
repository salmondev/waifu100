/* eslint-disable @next/next/no-img-element */
import { ImageResponse } from 'next/og';
import { getModeratedImage } from '@/server/moderation/moderator';
import { storyColumns, STORY_BRAND, isAllowedCoverUrl } from '@/lib/story/config';

/**
 * Renders the social-card image for a shared grid.
 *
 * Thumbnails are normally captured in the browser when the grid is shared, but
 * that upload can fail (or predate the feature), leaving the share with no
 * image at all - no preview in the Community Showcase, no picture in a link
 * embed. Every share stores the URL of each cell, so the card can be drawn
 * from that instead of depending on a client-side capture that already went
 * wrong once.
 */

// Square, like the thumbnails captured in the browser. A landscape card sat
// letterboxed in the showcase's square tiles, visibly unlike every other card.
export const OG_WIDTH = 1000;
export const OG_HEIGHT = 1000;

const COLUMNS = 10;
const CELL = 80;
const GRID_SIZE = COLUMNS * CELL;
const TITLE_HEIGHT = 64;

/**
 * CSS ellipsis is unreliable in the renderer, and an over-long title pushes the
 * grid off the bottom of the card, so cut it here instead.
 */
function truncate(text: string, max: number) {
    const clean = text.trim() || 'Waifu100 Grid';
    return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export interface ShareOgInput {
    title: string;
    /** Cell image URLs, index 0-99. Missing entries render as empty cells. */
    images: (string | null | undefined)[];
    count: number;
    /** Absent = waifu (10x10). */
    kind?: 'waifu' | 'story';
    size?: number;
    /** Story custom layout columns (null/absent = preset layout of `size`). */
    cols?: number | null;
}

/** Story covers are portrait (AniList / MAL are ~2:3), so story cells are 2:3 too. */
export const STORY_CELL_RATIO = 1.5;

/**
 * Card geometry for a grid of `size` slots. Exported for tests. Waifu cells are
 * square (cellH === cell); story cells are 2:3 portrait so a cover fits whole
 * instead of losing its top and bottom to a square crop.
 */
export function ogLayout(kind: 'waifu' | 'story' = 'waifu', size = 100, cols?: number | null) {
    if (kind === 'story') {
        const columns = storyColumns(size, cols);
        const rows = Math.ceil(size / columns);
        const cell = Math.floor(Math.min(GRID_SIZE / columns, GRID_SIZE / (rows * STORY_CELL_RATIO)));
        const cellH = Math.floor(cell * STORY_CELL_RATIO);
        return { columns, rows, total: size, cell, cellH, width: columns * cell, height: rows * cellH };
    }
    const columns = COLUMNS;
    const total = COLUMNS * COLUMNS;
    const rows = Math.ceil(total / columns);
    const cell = Math.floor(GRID_SIZE / Math.max(columns, rows));
    return { columns, rows, total, cell, cellH: cell, width: columns * cell, height: rows * cell };
}

// --- Font -------------------------------------------------------------------

// The site runs on Sarabun, and titles are frequently Thai - the default font
// would render them as tofu.
const FONT_CSS =
    'https://fonts.googleapis.com/css2?family=Sarabun:wght@700&subset=thai,latin';

let fontCache: Promise<ArrayBuffer | null> | null = null;

/** Shared with the compare card, which needs the same Thai-capable face. */
export async function loadOgFont(): Promise<ArrayBuffer | null> {
    if (!fontCache) {
        fontCache = (async () => {
            try {
                // The old User-Agent is what makes Google serve TTF; satori
                // cannot read the woff2 a modern browser would be given.
                const css = await fetch(FONT_CSS, {
                    headers: { 'User-Agent': 'Mozilla/4.0' },
                }).then((r) => (r.ok ? r.text() : ''));

                const url = css.match(/src: url\((https:[^)]+\.ttf)\)/)?.[1];
                if (!url) return null;

                const res = await fetch(url);
                return res.ok ? await res.arrayBuffer() : null;
            } catch {
                return null; // fall back to the built-in font
            }
        })();
    }
    return fontCache;
}

// --- Images -----------------------------------------------------------------

const CONCURRENCY = 6;
const SOURCE_PX = CELL * 2; // 2x the cell, so the card stays crisp

/**
 * Fetches one image and shrinks it to cell size.
 *
 * Shrinking here is not an optimisation, it is what keeps the function alive.
 * Handing originals to the card renderer killed it outright: the process died
 * with a bare platform 500 - no catchable error - because a single grid can
 * carry 83MB of source images, and every one of those gets base64'd and then
 * decoded in full for an 80px tile. A few KB per cell instead.
 */
async function fetchCell(
    url: string,
    px: number,
    allow?: (u: string) => boolean,
    whole = false
): Promise<{ data?: string; reason?: string }> {
    // T-0009 A: server-rendered cards use the same moderated, hash-checked
    // pipeline as the browser proxy; a blocked or unverified cell stays empty.
    // `whole` (story only): keep the image's own shape (fit inside, no crop).
    // Square cells are letterboxed, not cropped: a 225x350 character portrait
    // used to lose about a third of its height to a square crop.
    const result = await getModeratedImage(url, px, whole ? { allow } : { square: true, letterbox: true, allow });
    if (!result.ok) return { reason: result.reason };
    // Cards are CDN-cached for a long time: an unchecked cell (Gemini gave no answer) stays empty.
    if (!result.checked) return { reason: 'unchecked' };
    return { data: `data:image/jpeg;base64,${result.jpeg.toString('base64')}` };
}

/** Resolves one cell. A dead link costs that cell, never the whole card. */
async function toDataUrl(
    index: number,
    url: string | null | undefined,
    stats: CellStats,
    px: number,
    allow?: (u: string) => boolean,
    whole = false
): Promise<string | null> {
    if (!url) return null;
    if (!/^https?:\/\//.test(url)) {
        stats.failures.push({ index, url: String(url).slice(0, 120), reason: 'not-http' });
        stats.failed++;
        return null;
    }

    let reason = 'unknown';
    try {
        const result = await fetchCell(url, px, allow, whole);
        if (result.data) {
            stats.loaded++;
            return result.data;
        }
        reason = result.reason || 'empty';
    } catch (e) {
        reason = e instanceof Error ? e.name : 'error';
    }

    stats.failed++;
    stats.failures.push({ index, url: url.slice(0, 120), reason });
    return null;
}

export interface CellStats {
    loaded: number;
    failed: number;
    ms: number;
    /** Which cells came back empty and why - a blank tile explains nothing on its own. */
    failures: { index: number; url: string; reason: string }[];
}

/**
 * Resolves a list of image URLs to inline data URLs, each `px` square.
 *
 * Concurrency is capped: firing all 100 at once timed most of them out and left
 * a production card two thirds empty.
 */
export async function resolveImages(
    images: (string | null | undefined)[],
    px: number,
    allow?: (u: string) => boolean,
    whole = false
): Promise<{ cells: (string | null)[]; stats: CellStats }> {
    const started = Date.now();
    const stats: CellStats = { loaded: 0, failed: 0, ms: 0, failures: [] };

    const total = images.length;
    const cells: (string | null)[] = Array(total).fill(null);
    let next = 0;

    const worker = async () => {
        while (next < total) {
            const i = next++;
            cells[i] = await toDataUrl(i, images[i], stats, px, allow, whole);
        }
    };

    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    stats.ms = Date.now() - started;
    return { cells, stats };
}

/** The 100 cells of a share grid, at the size this card draws them. */
export async function resolveCells(
    images: (string | null | undefined)[],
    total: number = COLUMNS * COLUMNS,
    px: number = SOURCE_PX,
    allow?: (url: string) => boolean,
    whole = false
): Promise<{ cells: (string | null)[]; stats: CellStats }> {
    return resolveImages(
        Array.from({ length: total }, (_, i) => images[i]),
        px,
        allow,
        whole
    );
}

// --- Card -------------------------------------------------------------------

export async function renderShareOg({ title, images, count, kind = 'waifu', size = 100, cols = null }: ShareOgInput) {
    const layout = ogLayout(kind, size, cols);
    const story = kind === 'story';
    const [font, resolved] = await Promise.all([
        loadOgFont(),
        story
            ? resolveCells(images, layout.total, Math.min(layout.cell * 2, 400), isAllowedCoverUrl, true)
            : resolveCells(images),
    ]);
    const cells = resolved.cells;
    const cellW = layout.cell;
    // Story: 2:3 slots, and the whole cover is shown (contain), never cropped.
    const cellH = layout.cellH;

    return new ImageResponse(
        (
            <div
                style={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    background: '#09090b',
                    backgroundImage:
                        'radial-gradient(circle at 50% 0%, #2e1065 0%, #09090b 65%)',
                    padding: 24,
                }}
            >
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: '100%',
                        height: TITLE_HEIGHT,
                        fontSize: 40,
                        fontWeight: 700,
                        color: '#ffffff',
                        overflow: 'hidden',
                    }}
                >
                    {truncate(title, 44)}
                </div>

                {/* No border on this box: the renderer measures it content-box, so
                    even 1px on each side narrows the row below 10 cells and the
                    grid wraps into a staircase. */}
                <div
                    style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        width: layout.width,
                        height: layout.height,
                        background: '#000000',
                        marginTop: story ? Math.max(0, Math.floor((GRID_SIZE - layout.height) / 2) - 20) : 0,
                    }}
                >
                    {cells.map((src, i) => (
                        <div
                            key={i}
                            style={{
                                display: 'flex',
                                flexShrink: 0,
                                width: cellW,
                                height: story ? cellH : cellW,
                                background: '#09090b',
                            }}
                        >
                            {src ? (
                                story ? (
                                    <img
                                        src={src}
                                        width={cellW}
                                        height={cellH}
                                        alt=""
                                        style={{ width: cellW, height: cellH, objectFit: 'contain' }}
                                    />
                                ) : (
                                    <img
                                        src={src}
                                        width={cellW}
                                        height={cellW}
                                        alt=""
                                        style={{ width: cellW, height: cellW, objectFit: 'cover' }}
                                    />
                                )
                            ) : null}
                        </div>
                    ))}
                </div>

                <div
                    style={{
                        display: 'flex',
                        marginTop: 16,
                        fontSize: 26,
                        color: '#a1a1aa',
                    }}
                >
                    {story
                        ? `${count}/${layout.total} titles · ${STORY_BRAND} · Data from AniList`
                        : `${count}/100 characters · waifu100`}
                </div>
            </div>
        ),
        {
            width: OG_WIDTH,
            height: OG_HEIGHT,
            fonts: font
                ? [{ name: 'Sarabun', data: font, style: 'normal', weight: 700 as const }]
                : undefined,
            headers: {
                // A share never changes after it is created, and drawing one costs
                // 100 image fetches - so let the CDN answer everything after the
                // first crawler or card view.
                'Cache-Control':
                    'public, max-age=3600, s-maxage=31536000, stale-while-revalidate=604800',
            },
        }
    );
}
