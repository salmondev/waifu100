/**
 * The grid page's silhouette while its 100 cells are read and rendered.
 *
 * Most visits here come from a link someone was sent, so this is often the
 * first thing the app shows them - a blank screen for the length of a Redis
 * read is a bad first impression, and worse on a phone where it looks like the
 * link was dead.
 */
export default function Loading() {
    return (
        <div className="relative flex min-h-screen flex-col items-center bg-zinc-950 py-6 text-white sm:py-10">
            <div className="w-full max-w-[1000px] animate-pulse px-3 sm:px-4" aria-hidden>
                {/* Header: nav on the left, title centred, actions right. */}
                <div className="mb-6 flex flex-col items-stretch gap-4 sm:mb-8 lg:grid lg:grid-cols-3 lg:items-center">
                    <div className="order-2 flex flex-row gap-2 lg:order-none lg:flex-col lg:items-start">
                        <div className="h-10 flex-1 rounded-lg bg-zinc-900 lg:w-[190px] lg:flex-none" />
                        <div className="h-10 flex-1 rounded-lg bg-zinc-900 lg:w-[190px] lg:flex-none" />
                    </div>
                    <div className="order-1 flex justify-center lg:order-none">
                        <div className="h-8 w-64 rounded-lg bg-zinc-900 sm:h-9" />
                    </div>
                    <div className="order-3 flex flex-row gap-2 lg:order-none lg:flex-col lg:items-end">
                        <div className="h-10 flex-1 rounded-lg bg-zinc-900 lg:w-[190px] lg:flex-none" />
                        <div className="h-10 flex-1 rounded-lg bg-zinc-900 lg:w-[190px] lg:flex-none" />
                    </div>
                </div>

                {/* The grid itself: ten by ten, the shape everyone came for. */}
                <div className="grid grid-cols-10 gap-1 sm:gap-1.5">
                    {Array.from({ length: 100 }).map((_, i) => (
                        <div key={i} className="aspect-square rounded bg-zinc-900" />
                    ))}
                </div>
            </div>

            <p className="sr-only" role="status">
                Loading this grid
            </p>
        </div>
    );
}
