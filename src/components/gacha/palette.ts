/**
 * Story (anime) colours for the cards. The prototype hand-picked two stories
 * from the PICO-8 palette; the real catalog has ~150, so each anime's AniList
 * cover colour is snapped to the nearest bright PICO-8 colour and the shade /
 * highlight / deep tones come from that table (hand-set per colour, not
 * computed gradients). Same input -> same colours on every device.
 */
export interface StoryColours { frame: string; shade: string; hi: string; deep: string }

const TABLE: { rgb: [number, number, number]; c: StoryColours }[] = [
    { rgb: [255, 119, 168], c: { frame: "#ff77a8", shade: "#7e2553", hi: "#ffc2d8", deep: "#4a1530" } }, // pink (prototype oshinoko)
    { rgb: [0, 228, 54], c: { frame: "#1fc46e", shade: "#008751", hi: "#a8f5c8", deep: "#063a28" } }, // green (prototype frieren)
    { rgb: [41, 173, 255], c: { frame: "#29adff", shade: "#1d2b53", hi: "#bfe6ff", deep: "#0f1a36" } }, // sky
    { rgb: [255, 0, 77], c: { frame: "#ff004d", shade: "#7e2553", hi: "#ffb3c8", deep: "#3f0a24" } }, // red
    { rgb: [255, 163, 0], c: { frame: "#ffa300", shade: "#ab5236", hi: "#ffdb99", deep: "#4a2410" } }, // orange
    { rgb: [255, 236, 39], c: { frame: "#e8c81e", shade: "#ab5236", hi: "#fff6a8", deep: "#4a2e08" } }, // yellow
    { rgb: [131, 118, 156], c: { frame: "#83769c", shade: "#1d2b53", hi: "#d6cfe4", deep: "#1a1530" } }, // lavender
    { rgb: [126, 37, 83], c: { frame: "#b0347a", shade: "#7e2553", hi: "#f0b3d6", deep: "#3a0c26" } }, // wine
    { rgb: [29, 43, 83], c: { frame: "#3a5aa8", shade: "#1d2b53", hi: "#b8c8f0", deep: "#0c1430" } }, // navy
    { rgb: [171, 82, 54], c: { frame: "#c46a3c", shade: "#ab5236", hi: "#f5c8a8", deep: "#3e1a0c" } }, // brown
    { rgb: [0, 135, 81], c: { frame: "#1fa36a", shade: "#008751", hi: "#a8ecc8", deep: "#06301f" } }, // forest
];

const FALLBACK = TABLE[2].c;

export function storyColours(coverColor: string | null | undefined): StoryColours {
    const m = /^#?([0-9a-f]{6})$/i.exec(coverColor ?? "");
    if (!m) return FALLBACK;
    const n = parseInt(m[1], 16);
    const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    let best = TABLE[0];
    let bestD = Infinity;
    for (const t of TABLE) {
        // weighted RGB distance (cheap perceptual approximation)
        const d = 2 * (rgb[0] - t.rgb[0]) ** 2 + 4 * (rgb[1] - t.rgb[1]) ** 2 + 3 * (rgb[2] - t.rgb[2]) ** 2;
        if (d < bestD) { bestD = d; best = t; }
    }
    return best.c;
}

export const storyVars = (c: StoryColours): string => `--story:${c.frame};--shade:${c.shade};--hi:${c.hi};--deep:${c.deep}`;
