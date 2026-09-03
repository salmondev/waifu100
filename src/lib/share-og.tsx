/* eslint-disable @next/next/no-img-element */
import { ImageResponse } from 'next/og';

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

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

const COLUMNS = 10;
const CELL = 48;
const GRID_SIZE = COLUMNS * CELL;
const TITLE_HEIGHT = 56;

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
    /** Origin of this deployment, used to reach its own image optimizer. */
    origin: string;
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

const IMAGE_TIMEOUT_MS = 5000;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const UA = 'waifu100-og/1.0 (+https://waifu100.vercel.app)';

async function fetchImage(url: string, accept: string): Promise<string | null> {
    const res = await fetch(url, {
        signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
        headers: { 'User-Agent': UA, Accept: accept },
    });
    if (!res.ok) return null;

    const type = res.headers.get('content-type') || 'image/jpeg';
    if (!type.startsWith('image/')) return null;

    const buffer = await res.arrayBuffer();
    if (buffer.byteLength > MAX_IMAGE_BYTES) return null;

    return `data:${type};base64,${Buffer.from(buffer).toString('base64')}`;
}

/**
 * Inlines one cell image, at cell size.
 *
 * Two reasons not to hand the original URL to the renderer:
 *  - one dead link would otherwise cost the whole card instead of one cell;
 *  - originals are big. One real grid measured 83MB across its 100 cells, with
 *    single images up to 10MB - far too much to hold in memory, and pointless
 *    for a 48px cell.
 *
 * So each cell goes through this app's own image optimizer, which returns a
 * few KB apiece. `q` must be 75: Next only allows the qualities configured for
 * it, and anything else comes back 400. Asking for JPEG keeps the bytes in a
 * format the card renderer can decode. Anything the optimizer refuses
 * (animated GIFs pass through, some hosts block it) falls back to the source.
 */
async function toDataUrl(
    url: string | null | undefined,
    origin: string
): Promise<string | null> {
    if (!url) return null;
    if (url.startsWith('data:')) return url;
    if (!/^https?:\/\//.test(url)) return null;

    try {
        const optimized = `${origin}/_next/image?url=${encodeURIComponent(url)}&w=96&q=75`;
        const small = await fetchImage(optimized, 'image/jpeg');
        if (small) return small;
    } catch {
        // fall through to the source
    }

    try {
        return await fetchImage(url, 'image/*');
    } catch {
        return null;
    }
}

// --- Card -------------------------------------------------------------------

export async function renderShareOg({ title, images, count, origin }: ShareOgInput) {
    const [font, cells] = await Promise.all([
        loadFont(),
        Promise.all(
            Array.from({ length: COLUMNS * COLUMNS }, (_, i) => toDataUrl(images[i], origin))
        ),
    ]);

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
                        fontSize: 34,
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
                        marginTop: 12,
                        fontSize: 22,
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
