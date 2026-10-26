/**
 * The look of every "back to the Community Showcase" link.
 *
 * These links sit next to a "Home" button that looks exactly like them, on
 * pages where the showcase is the place most visitors actually came from and
 * want to get back to. As plain zinc-on-zinc they read as chrome and get
 * missed, so the showcase link - and only that one - carries the indigo/purple
 * gradient the home page already uses for it.
 *
 * Layout is left to each caller (`cn(SHOWCASE_LINK_CLASS, "flex-1 …")`), since
 * the same link is a full-width button on the view page and an icon-only circle
 * on the compare picker. Only colour, border and hover live here.
 */
export const SHOWCASE_LINK_CLASS =
    "bg-gradient-to-r from-indigo-600/90 to-purple-600/90 text-white font-semibold " +
    "border border-indigo-400/40 shadow-lg shadow-indigo-950/50 " +
    "hover:from-indigo-500 hover:to-purple-500 hover:text-white hover:shadow-indigo-900/60 " +
    "transition-all";
