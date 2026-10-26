/**
 * Hand-typed pixel icons for Gacha Guess (ported from the v2 prototype's
 * pixel.js / game/icons.js). One character = one pixel; letters pick a PICO-8
 * colour, "c" is currentColor. No icon set, nothing downloaded.
 */
import type { ReactElement } from "react";

export const PAL = {
    ink: "#1d2b53", paper: "#fff1e8", sky: "#29adff", red: "#ff004d", orange: "#ffa300", yellow: "#ffec27",
    green: "#00e436", pink: "#ff77a8", wine: "#7e2553", forest: "#008751", grey: "#c2c3c7", slate: "#5f574f", black: "#000000",
} as const;

const KEY: Record<string, string> = {
    k: PAL.ink, w: PAL.paper, r: PAL.red, o: PAL.orange, y: PAL.yellow, g: PAL.green, s: PAL.sky, p: PAL.pink,
    v: PAL.wine, f: PAL.forest, l: PAL.grey, d: PAL.slate, b: PAL.black, c: "currentColor",
};

/** Bitmap rows -> SVG markup string (used inside the static card markup). */
export function pxSvg(rows: readonly string[], cls = ""): string {
    const w = rows[0].length;
    const h = rows.length;
    let r = "";
    rows.forEach((row, y) => [...row].forEach((ch, x) => {
        if (KEY[ch]) r += `<rect x="${x}" y="${y}" width="1" height="1" fill="${KEY[ch]}"/>`;
    }));
    return `<svg class="pxi ${cls}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" shape-rendering="crispEdges" aria-hidden="true">${r}</svg>`;
}

export function Px({ rows, className = "" }: { rows: readonly string[]; className?: string }): ReactElement {
    const w = rows[0].length;
    const h = rows.length;
    const rects: ReactElement[] = [];
    rows.forEach((row, y) => [...row].forEach((ch, x) => {
        if (KEY[ch]) rects.push(<rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={KEY[ch]} />);
    }));
    return (
        <svg className={`pxi ${className}`} viewBox={`0 0 ${w} ${h}`} width={w} height={h} shapeRendering="crispEdges" aria-hidden="true">
            {rects}
        </svg>
    );
}

export const MARK = {
    circle: ["..ccc..", ".ccccc.", "ccccccc", "ccccccc", "ccccccc", ".ccccc.", "..ccc.."],
    diamond: ["...c...", "..ccc..", ".ccccc.", "ccccccc", ".ccccc.", "..ccc..", "...c..."],
    star: ["...c...", "...c...", "ccccccc", ".ccccc.", "..ccc..", ".cc.cc.", "cc...cc"],
} as const;

/** Set symbols, 7x7. eye + leaf come from the prototype; key/wave/gem were drawn for the real catalog. */
export const SETSYM: readonly (readonly string[])[] = [
    [".......", "..ccc..", ".c...c.", "c..c..c", ".c...c.", "..ccc..", "......."],
    ["....ccc", "..ccccc", ".cccc.c", ".ccc.cc", "cc.cccc", "c.ccc..", "c......"],
    ["..ccc..", ".c...c.", "..ccc..", "...c...", "...cc..", "...c...", "...cc.."],
    [".......", "cc...cc", "..c.c..", "...c...", "cc...cc", "..c.c..", "...c..."],
    [".ccccc.", "c.c.c.c", "ccccccc", ".c.c.c.", "..ccc..", "...c...", "......."],
];

export const COIN_ROWS = ["..kkk..", ".koook.", "koyooko", "koyooko", "koyooko", ".koook.", "..kkk.."] as const;

export const ICONS = {
    role: ["...ccc...", "..ccccc..", "..ccccc..", "...ccc...", ".........", ".ccccccc.", "ccccccccc", "ccccccccc", "ccccccccc"],
    hair: ["..ccccc..", ".ccccccc.", "ccc...ccc", "cc.....cc", "cc.....cc", "cc.....cc", "cc.....cc", "c.......c", "c.......c"],
    quote: ["ccccccccc", "c.......c", "c.cc.cc.c", "c.cc.cc.c", "c..c..c.c", "c.......c", "ccccccccc", ".cc......", ".c......."],
    silhouette: ["...ccc...", "..ccccc..", "..ccccc..", "..ccccc..", "...ccc...", "..ccccc..", ".ccccccc.", "ccccccccc", "ccccccccc"],
    blur: [".........", "ccc.cc.cc", ".........", "cc.ccc.cc", ".........", "c.ccc.ccc", ".........", "cc.cc.ccc", "........."],
    lock: ["..ccc..", ".c...c.", ".c...c.", "ccccccc", "ccc.ccc", "ccc.ccc", "ccccccc"],
    check: [".......", "......c", ".....cc", "c...cc.", "cc.cc..", ".ccc...", "..c...."],
    cross: ["c.....c", "cc...cc", ".cc.cc.", "..ccc..", ".cc.cc.", "cc...cc", "c.....c"],
    flame: ["...c...", "...cc..", "..ccc..", ".ccccc.", "cccc.cc", "ccc..cc", ".ccccc."],
    album: ["ccccccc", "c.c...c", "c.c.c.c", "c.c...c", "c.c.c.c", "c.c...c", "ccccccc"],
    back: ["...c...", "..cc...", ".cccccc", "ccccccc", ".cccccc", "..cc...", "...c..."],
    next: ["...c...", "...cc..", "cccccc.", "ccccccc", "cccccc.", "...cc..", "...c..."],
    card: ["ccccc..", "c...c..", "c.c.ccc", "c...c.c", "c.c.c.c", "ccccc.c", "..ccccc"],
    shop: [".......", "ccccccc", "c.c.c.c", "ccccccc", ".c...c.", ".ccccc.", ".c...c."],
    key: [".......", ".ccc...", "c...c..", "c...ccc", "c...c.c", ".ccc..c", "......."],
} as const;

export type IconName = keyof typeof ICONS;

export const Icon = ({ name }: { name: IconName }) => <Px rows={ICONS[name]} className={`i-${name}`} />;
export const Coin = () => <Px rows={COIN_ROWS} className="coin" />;

export type TierName = "common" | "rare" | "sr" | "ssr";
export const TIER_NAME: Record<TierName, string> = { common: "Common", rare: "Rare", sr: "SR", ssr: "SSR" };
export const TIER_LABEL: Record<TierName, string> = { common: "C", rare: "R", sr: "SR", ssr: "SSR" };
export const TIER_GUESSES: Record<TierName, string> = { ssr: "1", sr: "2", rare: "3-4", common: "5-6" };

export function TierMark({ tier }: { tier: TierName }) {
    if (tier === "ssr") return (<><Px rows={MARK.star} className="tm" /><Px rows={MARK.star} className="tm" /></>);
    return <Px rows={tier === "common" ? MARK.circle : tier === "rare" ? MARK.diamond : MARK.star} className="tm" />;
}

export const markSvg = (tier: TierName): string =>
    tier === "ssr" ? pxSvg(MARK.star) + pxSvg(MARK.star) : pxSvg(tier === "common" ? MARK.circle : tier === "rare" ? MARK.diamond : MARK.star);

export function Chip({ tier, extra = "" }: { tier: TierName; extra?: string }) {
    return (
        <b className={`g-chip t-${tier}${extra}`}>
            <TierMark tier={tier} />
            <span>{TIER_NAME[tier]}</span>
        </b>
    );
}
