/* eslint-disable @next/next/no-img-element */
import { ImageResponse } from 'next/og';
import sharp from 'sharp';

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
}

// --- Font -------------------------------------------------------------------

// The site runs on Sarabun, and titles are frequently Thai - the default font
// would render them as tofu.
const FONT_CSS =
    'https://fonts.googleapis.com/css2?family=Sarabun:wght@700&subset=thai,latin';

let fontCache: Promise<ArrayBuffer | null> | null = null;

async function loadFont(): Promise<ArrayBuffer | null> {
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

const IMAGE_TIMEOUT_MS = 8000;
const CONCURRENCY = 6;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const SOURCE_PX = CELL * 2; // 2x the cell, so the card stays crisp
const UA = 'waifu100-og/1.0 (+https://waifu100.vercel.app)';

/**
 * Fetches one image and shrinks it to cell size.
 *
 * Shrinking here is not an optimisation, it is what keeps the function alive.
 * Handing originals to the card renderer killed it outright: the process died
 * with a bare platform 500 - no catchable error - because a single grid can
 * carry 83MB of source images, animated GIFs among them at up to 10MB each,
 * and every one of those gets base64'd and then decoded in full for a 48px
 * tile. A few KB per cell instead.
 */
async function fetchCell(url: string): Promise<string | null> {
    const res = await fetch(url, {
        signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
        headers: { 'User-Agent': UA, Accept: 'image/*' },
    });
    if (!res.ok) return null;

    const type = res.headers.get('content-type') || '';
    if (!type.startsWith('image/')) return null;

    const buffer = await res.arrayBuffer();
    if (buffer.byteLength > MAX_IMAGE_BYTES) return null;

    // sharp arrives with Next (it powers the image optimizer), so this needs no
    // extra dependency. `animated` stays off on purpose: one frame is all a
    // static card can show, and decoding every frame of a long GIF is exactly
    // the memory the crash was made of.
    const jpeg = await sharp(Buffer.from(buffer), { limitInputPixels: 50_000_000 })
        .resize(SOURCE_PX, SOURCE_PX, { fit: 'cover' })
        .jpeg({ quality: 72 })
        .toBuffer();

    return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
}

/** Resolves one cell. A dead link costs that cell, never the whole card. */
async function toDataUrl(
    url: string | null | undefined,
    stats: CellStats
): Promise<string | null> {
    if (!url) return null;
    if (!/^https?:\/\//.test(url)) return null;

    try {
        const cell = await fetchCell(url);
        if (cell) {
            stats.loaded++;
            return cell;
        }
    } catch {
        // fall through to a blank cell
    }

    stats.failed++;
    return null;
}

export interface CellStats {
    loaded: number;
    failed: number;
    ms: number;
}

/**
 * Resolves every cell to an inline image.
 *
 * Concurrency is capped: firing all 100 at once timed most of them out and left
 * a production card two thirds empty.
 */
export async function resolveCells(
    images: (string | null | undefined)[]
): Promise<{ cells: (string | null)[]; stats: CellStats }> {
    const started = Date.now();
    const stats: CellStats = { loaded: 0, failed: 0, ms: 0 };

    const total = COLUMNS * COLUMNS;
    const cells: (string | null)[] = Array(total).fill(null);
    let next = 0;

    const worker = async () => {
        while (next < total) {
            const i = next++;
            cells[i] = await toDataUrl(images[i], stats);
        }
    };

    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    stats.ms = Date.now() - started;
    return { cells, stats };
}

// --- Card -------------------------------------------------------------------

export async function renderShareOg({ title, images, count }: ShareOgInput) {
    const [font, resolved] = await Promise.all([loadFont(), resolveCells(images)]);
    const cells = resolved.cells;

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
                        width: GRID_SIZE,
                        height: GRID_SIZE,
                        background: '#000000',
                    }}
                >
                    {cells.map((src, i) => (
                        <div
                            key={i}
                            style={{
                                display: 'flex',
                                flexShrink: 0,
                                width: CELL,
                                height: CELL,
                                background: '#09090b',
                            }}
                        >
                            {src ? (
                                <img
                                    src={src}
                                    width={CELL}
                                    height={CELL}
                                    alt=""
                                    style={{ width: CELL, height: CELL, objectFit: 'cover' }}
                                />
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
                    {count}/100 characters · waifu100
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
