/* eslint-disable @next/next/no-img-element */
import { ImageResponse } from 'next/og';
import { loadOgFont, resolveImages, OG_WIDTH, OG_HEIGHT } from '@/lib/share-og';

/**
 * The social card for a comparison.
 *
 * A compare link is made to be pasted at someone - into a Discord channel, at
 * the person on the other side of it - so the embed has to carry the result,
 * not just a title. The number and the faces are the whole message: how much
 * two people overlap, and who they both picked.
 *
 * It borrows the share card's image pipeline wholesale (`resolveImages` shrinks
 * every source with sharp before it reaches the renderer, which is what keeps
 * the function from running out of memory) but not its layout: a 10x10 grid at
 * this size says nothing about a pair.
 */

const FACE = 140;
const FACE_COLUMNS = 6;
const FACE_ROWS = 3;
const MAX_FACES = FACE_COLUMNS * FACE_ROWS;

function truncate(text: string, max: number) {
    const clean = text.trim() || 'Waifu100 Grid';
    return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export interface CompareOgInput {
    titleA: string;
    titleB: string;
    similarity: number;
    sharedCount: number;
    /** Image URLs of the shared characters, best first. */
    faces: (string | null | undefined)[];
}

export async function renderCompareOg({
    titleA,
    titleB,
    similarity,
    sharedCount,
    faces,
}: CompareOgInput) {
    const wanted = faces.slice(0, MAX_FACES);
    const [font, resolved] = await Promise.all([
        loadOgFont(),
        // 2x the drawn size, so the card stays crisp when a platform scales it.
        resolveImages(wanted, FACE * 2),
    ]);

    const cells = resolved.cells.filter((src): src is string => !!src);
    // Fill the last row rather than leaving a ragged edge under the number.
    const rows = Math.min(FACE_ROWS, Math.ceil(cells.length / FACE_COLUMNS) || 1);
    const drawn = cells.slice(0, rows * FACE_COLUMNS);

    return new ImageResponse(
        (
            <div
                style={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: '#09090b',
                    backgroundImage:
                        'radial-gradient(circle at 50% 0%, #2e1065 0%, #09090b 65%)',
                    padding: 40,
                }}
            >
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 18,
                        maxWidth: 920,
                        fontSize: 34,
                        fontWeight: 700,
                        color: '#e4e4e7',
                    }}
                >
                    <span>{truncate(titleA, 22)}</span>
                    <span style={{ color: '#a855f7' }}>×</span>
                    <span>{truncate(titleB, 22)}</span>
                </div>

                <div
                    style={{
                        display: 'flex',
                        alignItems: 'baseline',
                        marginTop: 8,
                        fontSize: 190,
                        fontWeight: 700,
                        color: '#f0abfc',
                        lineHeight: 1.1,
                    }}
                >
                    {similarity}
                    <span style={{ fontSize: 90, color: '#c084fc' }}>%</span>
                </div>

                <div style={{ display: 'flex', fontSize: 32, color: '#a1a1aa' }}>
                    {sharedCount === 0
                        ? 'nothing in common (yet)'
                        : `${sharedCount} character${sharedCount === 1 ? '' : 's'} in common`}
                </div>

                {drawn.length > 0 && (
                    <div
                        style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            justifyContent: 'center',
                            width: FACE_COLUMNS * FACE,
                            marginTop: 34,
                        }}
                    >
                        {drawn.map((src, i) => (
                            <img
                                key={i}
                                src={src}
                                width={FACE}
                                height={FACE}
                                alt=""
                                style={{ width: FACE, height: FACE, objectFit: 'cover' }}
                            />
                        ))}
                    </div>
                )}

                <div
                    style={{
                        display: 'flex',
                        marginTop: 'auto',
                        fontSize: 26,
                        color: '#71717a',
                    }}
                >
                    compare your grid · waifu100
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
                // Neither grid changes after it is shared, so a given pair always
                // renders the same card - and drawing one costs up to 18 image
                // fetches. Let the CDN answer everything after the first crawler.
                'Cache-Control':
                    'public, max-age=3600, s-maxage=31536000, stale-while-revalidate=604800',
            },
        }
    );
}
