import { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { readShare, readShares } from "@/lib/share-store";
import { compareGrids } from "@/lib/character-match";
import { charactersOf } from "@/lib/series-stats";
import { readCachedSeries } from "@/lib/series-resolve";
import { readCachedVerdict } from "@/lib/compare-verdict-store";
import { compareCardPath, shareCardPath } from "@/lib/share-card";
import { CompareView } from "@/components/compare/CompareView";
import { ComparePicker } from "@/components/compare/ComparePicker";
import type { ShareSummary } from "@/lib/share-summary";

interface ComparePageProps {
    searchParams: Promise<{ a?: string; b?: string }>;
}

/**
 * `/compare?a=<shareId>&b=<shareId>`.
 *
 * Both grids are read and diffed on the server: the two payloads are ~100
 * characters each, and shipping them to the browser to compare there would send
 * an order of magnitude more bytes than the result does - the same reason the
 * showcase summarises its cards server-side.
 */
async function load(idA: string, idB: string) {
    try {
        const [shareA, shareB] = await readShares([idA, idB]);
        if (!shareA || !shareB) return null;
        return { shareA, shareB, result: compareGrids(shareA.grid, shareB.grid) };
    } catch (e) {
        // A Redis outage must not surface as a bare framework 500 - the page
        // has a "this grid is gone" state and that is the honest thing to show.
        console.error("Compare read error:", e);
        return null;
    }
}

export async function generateMetadata({ searchParams }: ComparePageProps): Promise<Metadata> {
    const { a = "", b = "" } = await searchParams;
    const data = await load(a, b);

    if (!data) {
        return { title: "Compare grids | Waifu100" };
    }

    const { shareA, shareB, result } = data;
    const title = `${shareA.title} × ${shareB.title}`;
    const description = `${result.similarity}% match - ${result.shared.length} characters in common. Compare your own grid at waifu100.`;

    const h = await headers();
    const host = h.get("host") || "waifu100.vercel.app";
    const origin = `${host.startsWith("localhost") ? "http" : "https"}://${host}`;

    return {
        title: `${title} | Waifu100`,
        description,
        openGraph: {
            title,
            description,
            images: [`${origin}${compareCardPath(shareA.id, shareB.id)}`],
        },
        twitter: { card: "summary_large_image", title, description },
    };
}

function Empty({ heading, body }: { heading: string; body: string }) {
    return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-zinc-950 px-6 text-center text-white">
            <h1 className="text-2xl font-bold">{heading}</h1>
            <p className="max-w-md text-sm text-zinc-400">{body}</p>
            <div className="mt-4 flex gap-2">
                <Link
                    href="/community"
                    className="rounded-lg bg-purple-600/20 px-4 py-2 text-sm font-medium text-purple-300 transition-colors hover:bg-purple-600/30"
                >
                    Browse the showcase
                </Link>
                <Link
                    href="/"
                    className="rounded-lg bg-zinc-900 px-4 py-2 text-sm text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white"
                >
                    Build a grid
                </Link>
            </div>
        </div>
    );
}

/**
 * A side that was named in the URL, as the picker wants it.
 *
 * Never throws: the picker's job is to let someone choose two grids, and it can
 * do that whether or not this lookup worked. A failed one costs a filled-in
 * slot, not the page.
 */
async function preset(id: string): Promise<ShareSummary | null> {
    if (!id) return null;
    const share = await readShare(id).catch((e) => {
        console.error("Compare preset read error:", e);
        return null;
    });
    if (!share) return null;
    return {
        id: share.id,
        title: share.title,
        imageUrl: share.imageUrl,
        createdAt: share.createdAt ?? "",
        hasGif: false,
        count: share.grid.filter((cell) => cell.character).length,
    };
}

export default async function ComparePage({ searchParams }: ComparePageProps) {
    const { a = "", b = "" } = await searchParams;

    // Anything short of two different, existing grids lands in the picker with
    // whatever was named already filled in - a half-formed link ("compare this
    // one with...") is the normal way in, not an error.
    if (!a || !b || a === b) {
        const [presetA, presetB] = await Promise.all([preset(a), preset(a === b ? "" : b)]);
        return <ComparePicker initialA={presetA} initialB={presetB} />;
    }

    const data = await load(a, b);

    if (!data) {
        return (
            <Empty
                heading="One of these grids is gone"
                body="A grid can be deleted by whoever made it, and a comparison link outlives it."
            />
        );
    }

    const { shareA, shareB, result } = data;

    const charactersA = charactersOf(shareA.grid);
    const charactersB = charactersOf(shareB.grid);

    // Read alongside the page: a pair someone has already compared shows its
    // verdict with everything else - no request, no spinner, no button. The
    // series lookups already in the cache come along for the same reason; the
    // browser asks about whatever is left, so a cold cache costs a slower chart
    // rather than a slower page.
    const [verdict, cachedSeries] = await Promise.all([
        readCachedVerdict(shareA.id, shareB.id),
        readCachedSeries([...charactersA, ...charactersB].map((c) => c.name)),
    ]);

    const resolvedSeries: Record<string, string> = {};
    for (const [key, value] of Object.entries(cachedSeries)) {
        if (value !== null) resolvedSeries[key] = value;
    }

    return (
        <CompareView
            a={{
                id: shareA.id,
                title: shareA.title,
                imageUrl: shareA.imageUrl || shareCardPath(shareA.id),
                count: result.countA,
            }}
            b={{
                id: shareB.id,
                title: shareB.title,
                imageUrl: shareB.imageUrl || shareCardPath(shareB.id),
                count: result.countB,
            }}
            similarity={result.similarity}
            shared={result.shared}
            onlyA={result.onlyA}
            onlyB={result.onlyB}
            charactersA={charactersA}
            charactersB={charactersB}
            resolvedSeries={resolvedSeries}
            verdict={verdict}
        />
    );
}
