/**
 * Class strings copied verbatim from waifu's compare UI (components/compare/*,
 * app/compare/*) so story100's compare looks the same. Pinned against the waifu
 * source by StoryCompare.test.tsx - change waifu, the test tells you to sync.
 */
export const CMP = {
    page: "min-h-screen bg-zinc-950 py-6 text-white sm:py-10",
    container: "mx-auto w-full max-w-[1000px] px-3 sm:px-4",
    nav: "mb-6 flex flex-wrap items-center gap-2",
    navButton:
        "flex items-center gap-2 rounded-lg bg-zinc-900 px-3 py-2 text-sm text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white",
    copyBase: "ml-auto flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-all",
    copyDone: "border-green-500/20 bg-green-500/20 text-green-400",
    copyIdle: "border-transparent bg-purple-600/20 text-purple-400 hover:bg-purple-600/30",
    badge:
        "group flex min-w-0 flex-1 items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-3 transition-colors hover:border-purple-500/40 hover:bg-zinc-900",
    times: "flex shrink-0 items-center text-lg font-bold text-purple-500 sm:text-2xl",
    number:
        "bg-gradient-to-r from-purple-400 via-pink-500 to-purple-400 bg-clip-text text-[72px] font-black leading-none text-transparent sm:text-[110px]",
    sectionHeading: "mb-3 text-sm font-bold uppercase tracking-widest text-zinc-500",
    sharedGrid: "grid grid-cols-4 gap-2 sm:grid-cols-6 sm:gap-3 lg:grid-cols-8",
    onlyGrid: "grid grid-cols-4 gap-2 sm:grid-cols-6 sm:gap-3 lg:grid-cols-4",
    showMore:
        "mt-3 w-full rounded-lg border border-zinc-800 py-2 text-xs text-zinc-400 transition-colors hover:border-purple-500/40 hover:text-purple-300",
    pickerTitle:
        "bg-gradient-to-r from-purple-400 via-pink-400 to-purple-400 bg-clip-text text-2xl font-bold text-transparent sm:text-3xl",
    slotActive: "border-purple-500/60 bg-purple-500/5",
    slotIdle: "border-zinc-800 bg-zinc-900/50 hover:border-zinc-700",
    tilePicked: "border-purple-500 ring-2 ring-purple-500/40",
    tileIdle: "border-zinc-800/60 hover:-translate-y-0.5 hover:border-purple-500/50",
    goBase: "mt-4 flex w-full items-center justify-center gap-2 rounded-xl py-3 font-medium transition-all",
    goReady: "bg-purple-600 text-white hover:bg-purple-500",
    goIdle: "cursor-not-allowed bg-zinc-900 text-zinc-600",
    search:
        "w-full rounded-xl border border-zinc-800 bg-zinc-900/60 py-2.5 pl-9 pr-3 text-sm text-white placeholder:text-zinc-600 focus:border-purple-500/60 focus:outline-none",
    loadMore:
        "mx-auto mt-6 flex items-center gap-2 rounded-lg border border-zinc-800 px-4 py-2 text-sm text-zinc-400 transition-colors hover:border-purple-500/40 hover:text-purple-300",
    emptyHome:
        "rounded-lg bg-zinc-900 px-4 py-2 text-sm text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white",
} as const;

/** Waifu file each key is copied from (for the pin test). */
export const CMP_SOURCES: Record<keyof typeof CMP, string> = {
    page: "components/compare/CompareView.tsx",
    container: "components/compare/CompareView.tsx",
    nav: "components/compare/CompareView.tsx",
    navButton: "components/compare/CompareView.tsx",
    copyBase: "components/compare/CompareView.tsx",
    copyDone: "components/compare/CompareView.tsx",
    copyIdle: "components/compare/CompareView.tsx",
    badge: "components/compare/CompareView.tsx",
    times: "components/compare/CompareView.tsx",
    number: "components/compare/CompareView.tsx",
    sectionHeading: "components/compare/CompareView.tsx",
    sharedGrid: "components/compare/CompareView.tsx",
    onlyGrid: "components/compare/CompareView.tsx",
    showMore: "components/compare/CompareView.tsx",
    pickerTitle: "components/compare/ComparePicker.tsx",
    slotActive: "components/compare/ComparePicker.tsx",
    slotIdle: "components/compare/ComparePicker.tsx",
    tilePicked: "components/compare/ComparePicker.tsx",
    tileIdle: "components/compare/ComparePicker.tsx",
    goBase: "components/compare/ComparePicker.tsx",
    goReady: "components/compare/ComparePicker.tsx",
    goIdle: "components/compare/ComparePicker.tsx",
    search: "components/compare/ComparePicker.tsx",
    loadMore: "components/compare/ComparePicker.tsx",
    emptyHome: "app/compare/page.tsx",
};
