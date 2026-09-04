import { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { readShares } from "@/lib/share-store";
import { compareGrids } from "@/lib/character-match";
import { compareCardPath, shareCardPath } from "@/lib/share-card";
import { CompareView } from "@/components/compare/CompareView";

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
    const [shareA, shareB] = await readShares([idA, idB]);
    if (!shareA || !shareB) return null;
    return { shareA, shareB, result: compareGrids(shareA.grid, shareB.grid) };
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

export default async function ComparePage({ searchParams }: ComparePageProps) {
    const { a = "", b = "" } = await searchParams;

    if (!a || !b) {
        return (
            <Empty
                heading="Pick two grids"
                body="A comparison needs two grids. Open one from the showcase and use “Compare with my grid”."
            />
        );
    }

    if (a === b) {
        return (
            <Empty
                heading="That is the same grid twice"
                body="Comparing a grid with itself is a 100% match, which nobody needed a page for. Pick a different one."
            />
        );
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
        />
    );
}
