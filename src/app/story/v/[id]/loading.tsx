/**
 * Story copy of waifu's view-page silhouette (app/view/[id]/loading.tsx): same header blocks and
 * colours. The grid placeholder is 3x3 posters, because the board size is not known until the
 * share is read (waifu always knows it is 10x10).
 */
export default function Loading() {
    return (
        <div className="relative flex min-h-screen flex-col items-center bg-zinc-950 py-6 text-white sm:py-10">
            <div className="w-full max-w-[1000px] animate-pulse px-3 sm:px-4" aria-hidden>
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
                <div className="mx-auto grid max-w-md grid-cols-3 gap-1 sm:gap-1.5">
                    {Array.from({ length: 9 }).map((_, i) => (
                        <div key={i} className="aspect-[2/3] rounded bg-zinc-900" />
                    ))}
                </div>
            </div>
            <p className="sr-only" role="status">
                Loading this grid
            </p>
        </div>
    );
}
