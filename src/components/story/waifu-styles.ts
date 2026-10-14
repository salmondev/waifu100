/**
 * Button styles copied verbatim from waifu's sidebar (src/app/page.tsx, prod bundle) so
 * story's actions look the same. Copies, not imports: waifu's page stays untouched.
 */
export const WAIFU_BTN = {
    /** Paste URL / Upload / Save-Load Progress */
    neutral: "py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg font-medium flex justify-center items-center gap-2 text-sm transition-colors text-zinc-300 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed",
    /** Ask AI About My Taste */
    ai: "w-full py-2 bg-gradient-to-r from-yellow-600/20 to-orange-600/20 text-yellow-500 border border-yellow-600/30 hover:bg-yellow-600/30 rounded-lg font-medium flex justify-center items-center gap-2 text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer group",
    /** Share */
    share: "flex items-center justify-center gap-2 px-3 py-1.5 bg-sky-500/20 text-sky-400 hover:bg-sky-500/30 rounded-lg transition-colors border border-sky-500/30 text-sm font-medium flex-1 whitespace-nowrap cursor-pointer",
    /** Save as .png */
    png: "flex items-center justify-center gap-2 px-3 py-1.5 bg-purple-600/20 text-purple-400 hover:bg-purple-600/30 rounded-lg transition-colors border border-purple-600/30 text-sm font-medium flex-1 whitespace-nowrap cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed",
    /** Clear Grid */
    clear: "w-full py-2 bg-red-900/20 hover:bg-red-900/40 border border-red-900/50 text-red-400 hover:text-red-300 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer group",
    /** AI Suggestions "Generate Ideas" */
    ideas: "w-full py-2 bg-gradient-to-r from-purple-600 to-pink-600 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2 transition-opacity cursor-pointer disabled:cursor-not-allowed",
} as const;
