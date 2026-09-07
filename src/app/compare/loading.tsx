/**
 * What the compare page looks like before its data arrives.
 *
 * Pressing Compare used to do nothing visible: the route reads two grids out of
 * Redis and diffs them, and until that finished the browser stayed on the
 * showcase with the button looking untouched. People pressed it again, or
 * decided it was broken.
 *
 * This is deliberately the page's own silhouette rather than a spinner in the
 * middle of an empty screen - the two grid badges, the big number, the shared
 * row - so the transition reads as the page arriving rather than as the app
 * stopping to think. Nothing pulses faster than the eye can ignore, and there
 * is no text claiming progress it cannot measure.
 */
export default function Loading() {
    return (
        <div className="min-h-screen bg-zinc-950 py-6 text-white sm:py-10">
            <div
                className="mx-auto w-full max-w-[1000px] animate-pulse px-3 sm:px-4"
                aria-hidden
            >
                {/* Nav */}
                <div className="mb-6 flex flex-wrap items-center gap-2">
                    <div className="h-9 w-44 rounded-lg bg-zinc-900" />
                    <div className="h-9 w-36 rounded-lg bg-zinc-900" />
                    <div className="h-9 w-36 rounded-lg bg-zinc-900" />
                    <div className="ml-auto h-9 w-28 rounded-lg bg-zinc-900" />
                </div>

                {/* The two grids */}
                <div className="flex items-stretch gap-2 sm:gap-3">
                    <div className="h-[86px] flex-1 rounded-2xl border border-zinc-800 bg-zinc-900/60" />
                    <div className="flex shrink-0 items-center text-lg font-bold text-zinc-700 sm:text-2xl">
                        ×
                    </div>
                    <div className="h-[86px] flex-1 rounded-2xl border border-zinc-800 bg-zinc-900/60" />
                </div>

                {/* The number */}
                <div className="mt-8 flex flex-col items-center">
                    <div className="h-[72px] w-48 rounded-2xl bg-zinc-900 sm:h-[110px] sm:w-64" />
                    <div className="mt-3 h-4 w-40 rounded bg-zinc-900" />
                    <div className="mt-2 h-3 w-56 rounded bg-zinc-900/70" />
                </div>

                {/* Verdict card */}
                <div className="mt-8 h-40 rounded-2xl border border-zinc-800/60 bg-zinc-900/30" />

                {/* Shared faces */}
                <div className="mt-8">
                    <div className="mb-3 h-3 w-28 rounded bg-zinc-900" />
                    <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 sm:gap-3 lg:grid-cols-8">
                        {Array.from({ length: 8 }).map((_, i) => (
                            <div key={i}>
                                <div className="aspect-square rounded-xl border border-zinc-800 bg-zinc-900" />
                                <div className="mx-auto mt-1.5 h-2.5 w-4/5 rounded bg-zinc-900/70" />
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* The one line of text, for anyone who cannot see the shapes move. */}
            <p className="sr-only" role="status">
                Loading the comparison
            </p>
        </div>
    );
}
