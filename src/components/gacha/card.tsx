"use client";
/**
 * Gacha Guess cards (ported from the v2 prototype card.js, round 9). Card
 * units: 63u x 88u, 1u = 1em. Every ornament / crest / symbol path is a
 * hand-typed constant from the prototype (no clip-art, nothing downloaded),
 * rendered as static markup; all player-visible text is escaped.
 */
import { useEffect, useRef } from "react";
import { proxied } from "@/lib/img-proxy";
import { dayNumber } from "@/server/gacha/rules";
import type { CardDto } from "./api";
import { mountFoil, type FoilState } from "./foil";
import { storyColours, storyVars } from "./palette";
import { TIER_LABEL, TIER_NAME, type TierName } from "./pixel";

const esc = (s: unknown) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

// ---- shared SVG defs (metal + gem gradients), rendered once by <CardDefs/>. userSpaceOnUse = card units.
const DEFS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
<linearGradient id="c2g-gold" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="63" y2="88">
 <stop offset="0" stop-color="#fff6c8"/><stop offset=".1" stop-color="#e8b443"/><stop offset=".2" stop-color="#fff1ae"/>
 <stop offset=".32" stop-color="#b87a1c"/><stop offset=".45" stop-color="#ffe48a"/><stop offset=".58" stop-color="#c88c24"/>
 <stop offset=".72" stop-color="#fff4c4"/><stop offset=".85" stop-color="#a86a12"/><stop offset="1" stop-color="#f2cf66"/></linearGradient>
<linearGradient id="c2g-silver" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="63" y2="88">
 <stop offset="0" stop-color="#ffffff"/><stop offset=".12" stop-color="#b3bbcb"/><stop offset=".25" stop-color="#f6f8fc"/>
 <stop offset=".4" stop-color="#848da1"/><stop offset=".55" stop-color="#eef1f6"/><stop offset=".7" stop-color="#9aa3b5"/>
 <stop offset=".85" stop-color="#ffffff"/><stop offset="1" stop-color="#bcc3d0"/></linearGradient>
<linearGradient id="c2g-gem-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff6c8"/><stop offset=".35" stop-color="#f0c04f"/><stop offset=".7" stop-color="#b87a1c"/><stop offset="1" stop-color="#ffe48a"/></linearGradient>
<linearGradient id="c2g-gem-silver" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".4" stop-color="#c9cfdb"/><stop offset=".75" stop-color="#7d869a"/><stop offset="1" stop-color="#eef1f6"/></linearGradient>
<linearGradient id="c2g-sky" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d9f2ff"/><stop offset=".45" stop-color="#29adff"/><stop offset="1" stop-color="#1d2b53"/></linearGradient>
<linearGradient id="c2g-ruby" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffd0dc"/><stop offset=".45" stop-color="#ff004d"/><stop offset="1" stop-color="#7e2553"/></linearGradient>
<linearGradient id="c2g-prism" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="26" y2="20" spreadMethod="reflect">
 <stop offset="0" stop-color="#fff4fa"/><stop offset=".1" stop-color="#ff8fbf"/><stop offset=".22" stop-color="#ffd166"/><stop offset=".32" stop-color="#fffbe0"/>
 <stop offset=".44" stop-color="#7fe0a0"/><stop offset=".56" stop-color="#6cc8ff"/><stop offset=".66" stop-color="#eef8ff"/><stop offset=".8" stop-color="#a98bff"/>
 <stop offset=".92" stop-color="#ff9ad0"/><stop offset="1" stop-color="#fff4fa"/></linearGradient>
<linearGradient id="c2g-prism-gem" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".25" stop-color="#ff8fbf"/><stop offset=".5" stop-color="#6cc8ff"/><stop offset=".75" stop-color="#7fe0a0"/><stop offset="1" stop-color="#ffd166"/></linearGradient>
<linearGradient id="c2g-rainbow" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff004d"/><stop offset=".2" stop-color="#ffa300"/>
 <stop offset=".4" stop-color="#ffec27"/><stop offset=".6" stop-color="#00e436"/><stop offset=".8" stop-color="#29adff"/><stop offset="1" stop-color="#ff77a8"/></linearGradient>
</defs></svg>`;

let glitterDone = false;
/** Glitter texture: procedural round dots on a transparent canvas, made once and shared by the CSS foil layers. */
function ensureGlitter(): void {
    if (glitterDone || typeof document === "undefined") return;
    glitterDone = true;
    const c = document.createElement("canvas");
    c.width = c.height = 192;
    const g = c.getContext("2d");
    if (!g) return;
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 260; i++) {
        const x = rnd() * 192, y = rnd() * 192, r = 0.6 + rnd() * rnd() * 3.2, a = 0.35 + rnd() * 0.65;
        g.fillStyle = `rgba(255,255,255,${a})`;
        g.beginPath();
        g.arc(x, y, r * 0.45, 0, 7);
        g.fill();
    }
    document.documentElement.style.setProperty("--c2-glitter", `url(${c.toDataURL()})`);
}

export function CardDefs() {
    useEffect(ensureGlitter, []);
    return <div style={{ display: "contents" }} dangerouslySetInnerHTML={{ __html: DEFS }} />;
}

// ---- ornament: one top-left corner, hand-typed; the other three are mirror transforms
const CORNER = `
<path class="o-s" d="M1.5 26 V5.5 Q1.5 1.5 5.5 1.5 H26"/>
<path class="o-s o-t" d="M3 15 V7 Q3 3 7 3 H15"/>
<path class="o-s" d="M26 1.5 c1.6 0 2.6 1 2.6 2.2 c0 1 -.8 1.6 -1.6 1.6 c-.8 0 -1.3 -.5 -1.3 -1.2 c0 -.5 .4 -.9 .9 -.9"/>
<path class="o-s" d="M1.5 26 c0 1.6 1 2.6 2.2 2.6 c1 0 1.6 -.8 1.6 -1.6 c0 -.8 -.5 -1.3 -1.2 -1.3 c-.5 0 -.9 .4 -.9 .9"/>
<path class="o-f" d="M3 3 H7.6 A4.6 4.6 0 0 1 3 7.6 Z"/>
<path class="o-d" d="M3 3 L7.2 4.7 M3 3 L6.3 6.3 M3 3 L4.7 7.2 M5.6 3 A2.6 2.6 0 0 1 3 5.6"/>
<path class="o-f" d="M15 3 q2.6 -1.3 5.2 0 q-2.6 1.3 -5.2 0 Z"/>
<path class="o-f" d="M3 15 q-1.3 2.6 0 5.2 q1.3 -2.6 0 -5.2 Z"/>
<circle class="o-gem" cx="3.4" cy="3.4" r=".95"/>`;
const SIDE = `
<path class="o-s o-t" d="M2.25 22 V32.6 M2.25 40.4 V51"/>
<path class="o-f" d="M2.25 33 L3.5 36.5 L2.25 40 L1 36.5 Z"/>
<circle class="o-gem" cx="2.25" cy="36.5" r=".6"/>`;
const TOP = `
<path class="o-s o-t" d="M19 2.2 H27.2 M35.8 2.2 H44"/>
<path class="o-f" d="M27.4 4 A4.1 4.1 0 0 1 35.6 4 Z"/>
<path class="o-d" d="M31.5 4 V0.9 M31.5 4 L28.9 1.9 M31.5 4 L34.1 1.9 M29.6 4 A1.9 1.9 0 0 1 33.4 4"/>`;
// SSR corner (round 3): hand-typed. HALF is the top run; the side run is the same paths mirrored across the corner diagonal.
const SSR_HALF = `
<path class="o-s" d="M8 2 H31"/>
<path class="o-s o-t" d="M9.5 4.6 H19"/>
<path class="o-s" d="M19 4.6 C22 4.6 23.2 2.9 25.6 2.9 C27.6 2.9 28.5 4.4 27.6 5.4 C26.8 6.2 25.6 5.7 25.8 4.8"/>
<path class="o-s o-t" d="M12 4.6 C13.4 7.2 16.6 7.6 18.4 6.6"/>
<path class="o-f" d="M13.4 4.6 q2.2 -2.6 5 -1.9 q-1.5 2.3 -5 1.9 Z"/>
<path class="o-f" d="M20.4 6.9 q1.9 .2 2.9 1.8 q-2 .3 -2.9 -1.8 Z"/>
<circle class="o-f" cx="31.2" cy="2" r=".75"/><circle class="o-f" cx="29.6" cy="5.2" r=".45"/>`;
const SSR_CORNER = `
<path class="o-s" d="M2 8 Q2 2 8 2"/>
<path class="o-s o-t" d="M4.6 9.5 Q4.6 4.6 9.5 4.6"/>
<path class="o-s o-t" d="M4.6 12.4 C8.4 12.4 12.4 8.4 12.4 4.6"/>
${SSR_HALF}<g transform="matrix(0 1 1 0 0 0)">${SSR_HALF}</g>
<path class="o-f" d="M6.6 3.4 L9.8 6.6 L6.6 9.8 L3.4 6.6 Z"/>
<circle class="o-gem" cx="6.6" cy="6.6" r=".9"/>`;
const mirrors = (s: string): string => [
  `<g>${s}</g>`, `<g transform="matrix(-1 0 0 1 63 0)">${s}</g>`,
  `<g transform="matrix(1 0 0 -1 0 88)">${s}</g>`, `<g transform="matrix(-1 0 0 -1 63 88)">${s}</g>`].join('');
function ornament(tier: string): string {
  let o = '';
  if (tier === 'common') o = mirrors(CORNER);
  if (tier === 'rare') o = mirrors(CORNER) + SIDE + `<g transform="matrix(-1 0 0 1 63 0)">${SIDE}</g>`;
  if (tier === 'sr') o = mirrors(CORNER) + SIDE + `<g transform="matrix(-1 0 0 1 63 0)">${SIDE}</g>` + TOP;
  if (tier === 'ssr') o = `<rect class="o-s" x="1.6" y="1.6" width="59.8" height="84.8" rx="4.2"/><rect class="o-s o-t" x="3" y="3" width="57" height="82" rx="3.2"/>` + mirrors(SSR_CORNER) + TOP;
  return `<svg class="c2-orn" viewBox="0 0 63 88" preserveAspectRatio="none" aria-hidden="true">${o}</svg>`;
}

// ---- rarity crests (hand-typed). viewBox 0 0 32 18, centred on x=16
const CREST: Record<string, string> = {
  common: `<circle class="m" cx="16" cy="9" r="6.4"/><circle cx="16" cy="9" r="4.9" fill="var(--story)" stroke="rgba(0,0,0,.35)" stroke-width=".35"/>
    <ellipse cx="14.4" cy="7.2" rx="2" ry="1.2" fill="#fff" opacity=".6"/>`,
  rare: `<path class="m" d="M10.6 9 L7 7.2 V10.8 Z M21.4 9 L25 7.2 V10.8 Z"/><path class="m" d="M16 1.2 L23.4 9 L16 16.8 L8.6 9 Z"/>
    <path fill="url(#c2g-sky)" d="M16 3.4 L21.3 9 L16 14.6 L10.7 9 Z"/>
    <path fill="none" stroke="#fff" stroke-opacity=".7" stroke-width=".3" d="M10.7 9 H21.3 M16 3.4 L13.6 9 L16 14.6 L18.4 9 Z"/>`,
  sr: `<path class="m" d="M23.6 9 L20.25 10.76 L21.4 14.4 L17.76 13.25 L16 16.6 L14.24 13.25 L10.6 14.4 L11.75 10.76 L8.4 9 L11.75 7.24 L10.6 3.6 L14.24 4.75 L16 1.4 L17.76 4.75 L21.4 3.6 L20.25 7.24 Z"/>
    <circle cx="16" cy="9" r="3.5" fill="url(#c2g-ruby)" stroke="rgba(60,20,0,.5)" stroke-width=".3"/><ellipse cx="15" cy="7.9" rx="1.2" ry=".7" fill="#fff" opacity=".75"/>
    <path class="m" d="M8.4 9 L3.5 7.9 L1 9 L3.5 10.1 Z M23.6 9 L28.5 7.9 L31 9 L28.5 10.1 Z"/>`,
  // round 9: a flat lozenge (cream rim, ink ring, three hard PICO bands). Plain vector, no gradient, no wings or crown.
  ssr: `<path fill="#fff1e8" d="M16 .6 L26 9 L16 17.4 L6 9 Z"/><path fill="#1d2b53" d="M16 2 L24.3 9 L16 16 L7.7 9 Z"/>
    <path fill="#ff004d" d="M16 3.6 L20.27 7.2 H11.73 Z"/><path fill="#ffec27" d="M11.73 7.2 H20.27 L22.4 9 L20.27 10.8 H11.73 L9.6 9 Z"/>
    <path fill="#29adff" d="M11.73 10.8 H20.27 L16 14.4 Z"/>`,
};
const crest = (tier: string) => `<svg class="c2-crest" viewBox="0 0 32 18" aria-hidden="true">${CREST[tier]}</svg>`;

// set symbols (hand-typed vector, 16x12). eye + leaf from the prototype; moon + drop drawn for the real catalog.
const SYM = [
    '<path d="M1 6 Q8 -.5 15 6 Q8 12.5 1 6 Z" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="6" r="2.3" fill="currentColor"/>',
    '<path d="M2 11 C1.4 5 6 1 15 1 C15 8 10.6 11.4 4 11 Z" fill="currentColor"/><path d="M2.6 11 L10 4.6" stroke="#fff" stroke-opacity=".7" stroke-width="1"/>',
    '<path d="M10.5 1 A5.2 5.2 0 1 0 10.5 11 A4 4 0 1 1 10.5 1 Z" fill="currentColor"/><path d="M13 2.5 V5.5 M11.5 4 H14.5" stroke="currentColor" stroke-width="1"/>',
    '<path d="M8 .8 C11.6 5 12.6 6.8 12.6 8.2 A4.6 3.6 0 0 1 3.4 8.2 C3.4 6.8 4.4 5 8 .8 Z" fill="currentColor"/><path d="M6 8.6 Q6.4 10 8 10.2" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width=".9"/>',
];
const sym = (animeId: number) => `<svg class="c2-sym" viewBox="0 0 16 12" aria-hidden="true">${SYM[Math.abs(animeId) % SYM.length]}</svg>`;

// ---- SR holo face-clear box (round 9). Source-image fractions (x0, y0, x1, y1) of a 230x345 AniList portrait.
// AniList gives no face positions, so every card uses one box taken from the prototype's 16 hand-measured faces
// (their union, eyes to chin plus cheeks, with margin): the holo then never crosses the face on a typical portrait.
const FACE: readonly [number, number, number, number] = [0, 0.17, 1, 0.8];
export const FOCAL = "50% 30%";

export function faceBox(mini = false) {
    const [W, H, S] = mini ? [54.8, 79.8, 1] : [52.9, 40.9, 1.07];
    const [fx, fy] = [0.5, 0.3];
    const s = Math.max(W / 230, H / 345), dw = 230 * s, dh = 345 * s, ox = (W - dw) * fx, oy = (H - dh) * fy;
    const map = (u: number, v: number) => [((W / 2 + (ox + u * dw - W / 2) * S) / W) * 100, ((H / 2 + (oy + v * dh - H / 2) * S) / H) * 100];
    const cl = (n: number) => Math.min(100, Math.max(0, n));
    const [a, b] = map(FACE[0], FACE[1]), [c, d] = map(FACE[2], FACE[3]);
    return { x0: cl(a), y0: cl(b), x1: cl(c), y1: cl(d) };
}
function faceMask(mini: boolean): string {
    const b = faceBox(mini);
    const w = b.x1 - b.x0, h = b.y1 - b.y0, p = (o: number, n: number) => (n >= 99.9 ? 0 : (o / (100 - n)) * 100);
    return ` style="--fw:${w.toFixed(2)}%;--fh:${h.toFixed(2)}%;--fx:${p(b.x0, w).toFixed(2)}%;--fy:${p(b.y0, h).toFixed(2)}%"`;
}

const SAMPLE_GUESS: Record<TierName, number> = { common: 5, rare: 3, sr: 2, ssr: 1 };
const GENDER_TH: Record<string, string> = { Female: "หญิง", Male: "ชาย" };

/** Info box role line from real AniList fields only. */
export function roleLine(c: Pick<CardDto, "occupation" | "role" | "gender">): string {
    const base = c.occupation?.trim() || (c.role === "MAIN" ? "ตัวละครหลัก" : "ตัวละครรอง");
    const g = c.gender ? GENDER_TH[c.gender] ?? c.gender : null;
    return g ? `${base} · ${g}` : base;
}

const img = (src: string, w: number, alt = "") =>
    `<img src="${esc(proxied(src, w))}" alt="${esc(alt)}" draggable="false" style="object-position:${FOCAL}">`;

export function cardHtml(c: CardDto, tier: TierName, opts: { day?: string | null; guesses?: number | null; total?: number | null } = {}): string {
    const s2 = storyColours(c.coverColor);
    const n = opts.guesses ?? SAMPLE_GUESS[tier];
    const no = opts.total ? `${c.number}/${String(opts.total).padStart(3, "0")}` : c.number;
    const day = opts.day ? `#${dayNumber(opts.day)}` : "";
    return `<article class="c2" data-tier="${tier}" style="${storyVars(s2)}" aria-label="${esc(c.name)} ${TIER_NAME[tier]}">
  <div class="c2-tilt"><div class="c2-body">
    <i class="c2-fx" aria-hidden="true"></i>
    <div class="c2-art">${img(c.image, 460)}${tier === "ssr" ? '<canvas class="c2-foil"></canvas>' : `<i class="c2-holo"${faceMask(false)}></i>`}</div>
    ${ornament(tier)}
    <header class="c2-name">
      <div class="c2-nm"><b>${esc(c.name)}</b><small>${esc(c.animeTitle)}</small></div>
      <div class="c2-stat"><span>GUESS</span><b>${n}</b></div>
    </header>
    ${crest(tier)}
    <section class="c2-info"><p class="c2-role">${esc(roleLine(c))}</p><p class="c2-quote">ถูกใจบน AniList ${esc(c.favourites.toLocaleString("en-US"))} คน</p></section>
    <footer class="c2-strip">
      <span class="c2-set">${sym(c.animeId)}${esc(c.setCode)} ${esc(no)}</span>
      <span class="c2-mark">${TIER_LABEL[tier]}</span>
      <span class="c2-day">${esc(day)}</span>
    </footer>
    <i class="c2-glare" aria-hidden="true"></i>
  </div></div>
</article>`;
}

export interface StoryInput {
    id: number;
    title: string;
    subtitle: string | null;
    cover: string;
    coverColor: string | null;
    setCode: string;
    total: number;
    owned: CardDto[];
}

/** Story card: unlocked at 3 owned characters. One cast slot per character of the anime, owned faces first. */
export function storyCardHtml(st: StoryInput): string {
    const s2 = storyColours(st.coverColor);
    const sorted = [...st.owned].sort((a, b) => a.number.localeCompare(b.number));
    const slots = Math.max(st.total, sorted.length);
    const cast = Array.from({ length: slots }, (_, i) =>
        sorted[i] ? img(sorted[i].image, 96, sorted[i].name) : '<i aria-hidden="true"></i>',
    ).join("");
    return `<article class="c2 c2-story" data-tier="story" style="${storyVars(s2)}" aria-label="${esc(st.title)} story card">
  <div class="c2-tilt"><div class="c2-body">
    <i class="c2-fx" aria-hidden="true"></i>
    <div class="c2-art">${img(st.cover, 460)}</div>
    ${ornament("sr")}
    <header class="c2-name">
      <div class="c2-nm"><b>${esc(st.title)}</b>${st.subtitle ? `<small>${esc(st.subtitle)}</small>` : ""}</div>
      <div class="c2-stat"><span>CAST</span><b>${st.owned.length}</b></div>
    </header>
    ${crest("sr")}
    <section class="c2-info"><div class="c2-cast" style="--n:${slots}">${cast}</div><p class="c2-quote">เก็บแล้ว ${st.owned.length}/${st.total} ตัว</p></section>
    <footer class="c2-strip">
      <span class="c2-set">${sym(st.id)}${esc(st.setCode)}</span>
      <span class="c2-mark">STORY</span>
      <span class="c2-day">${st.total}</span>
    </footer>
    <i class="c2-glare" aria-hidden="true"></i>
  </div></div>
</article>`;
}

/** Album mini card: same materials, fewer parts, text in fixed px so it stays legible 3-up. */
export function cardMiniHtml(c: CardDto, tier: TierName): string {
    const s2 = storyColours(c.coverColor);
    return `<article class="c2 c2-mini" data-tier="${tier}" style="${storyVars(s2)}" aria-label="${esc(c.name)} ${TIER_NAME[tier]}">
  <div class="c2-tilt"><div class="c2-body">
    <i class="c2-fx" aria-hidden="true"></i>
    <div class="c2-art">${img(c.image, 230)}<i class="c2-holo"${faceMask(true)}></i></div>
    ${ornament(tier === "ssr" ? "ssr" : "common")}
    <div class="c2-mname"><b>${esc(c.name)}</b><span><em>${esc(c.number)}</em>${TIER_LABEL[tier]}</span></div>
    <i class="c2-glare" aria-hidden="true"></i>
  </div></div>
</article>`;
}

/** Card back. mini = album slot not collected yet (round 9: no "?" on mini backs). */
export function cardBackHtml({ no = null, mini = false }: { no?: string | null; mini?: boolean } = {}): string {
    return `<article class="c2 c2-back${mini ? " c2-mini" : ""}" data-tier="back" aria-label="${mini ? `ช่องว่าง ${esc(no ?? "")}` : "หลังการ์ด"}">
  <div class="c2-tilt"><div class="c2-body">
    <i class="c2-fx" aria-hidden="true"></i>
    <svg class="c2-orn" viewBox="0 0 63 88" preserveAspectRatio="none" aria-hidden="true">
      <rect class="o-s" x="1.6" y="1.6" width="59.8" height="84.8" rx="4.2"/><rect class="o-s o-t" x="3" y="3" width="57" height="82" rx="3.2"/>
      ${mirrors(CORNER)}
      <circle class="o-s" cx="31.5" cy="40" r="15"/><circle class="o-s o-t" cx="31.5" cy="40" r="13.4"/>
      <path class="o-f" d="M45.5 40 L37.5 42.5 L41.4 49.9 L34 46 L31.5 54 L29 46 L21.6 49.9 L25.5 42.5 L17.5 40 L25.5 37.5 L21.6 30.1 L29 34 L31.5 26 L34 34 L41.4 30.1 L37.5 37.5 Z" opacity=".95"/>
      <circle cx="31.5" cy="40" r="7.6" fill="#1d2b53" stroke="url(#c2g-gold)" stroke-width=".5"/>
      <path class="o-s o-t" d="M31.5 12 V22 M31.5 58 V68 M20 69 H43"/>
      <path class="o-f" d="M31.5 9.4 L33 12 L31.5 14.6 L30 12 Z M31.5 65.4 L33 68 L31.5 70.6 L30 68 Z"/>
    </svg>
    ${mini ? "" : '<b class="c2-bq">?</b><div class="c2-btitle"><b>GACHA GUESS</b></div>'}
    ${no != null ? `<em class="c2-bno">${esc(no)}</em>` : ""}
    <i class="c2-glare" aria-hidden="true"></i>
  </div></div>
</article>`;
}

const prefersReducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Real pointer / touch only (no idle motion): tilt, light position and
 * parallax as CSS vars; the SSR shader reads the same state. Reduced motion
 * keeps the cards still. Also shrinks long names to fit (Thai never below 12px).
 */
function wireCards(root: HTMLElement): () => void {
    const cleanups: (() => void)[] = [];
    root.querySelectorAll<HTMLElement>(".c2").forEach((el) => {
        const state: FoilState = { x: 0, y: 0, lit: false };
        const set = (x: number, y: number, lit: boolean) => {
            Object.assign(state, { x, y, lit });
            el.style.setProperty("--mx", x.toFixed(3));
            el.style.setProperty("--my", y.toFixed(3));
            if (lit) {
                el.style.setProperty("--lx", `${((x + 0.5) * 100).toFixed(1)}%`);
                el.style.setProperty("--ly", `${((y + 0.5) * 100).toFixed(1)}%`);
            } else {
                el.style.removeProperty("--lx");
                el.style.removeProperty("--ly");
            }
        };
        if (!prefersReducedMotion() && !el.classList.contains("c2-back")) {
            const move = (e: PointerEvent) => {
                const b = el.getBoundingClientRect();
                set((e.clientX - b.left) / b.width - 0.5, (e.clientY - b.top) / b.height - 0.5, true);
                el.classList.add("lit");
            };
            const leave = () => {
                set(0, 0, false);
                el.classList.remove("lit");
            };
            el.addEventListener("pointermove", move);
            el.addEventListener("pointerleave", leave);
            cleanups.push(() => {
                el.removeEventListener("pointermove", move);
                el.removeEventListener("pointerleave", leave);
            });
        }
        el.querySelectorAll<HTMLElement>(".c2-nm b, .c2-nm small").forEach((n) => {
            const floor = /[\u0E00-\u0E7F]/.test(n.textContent ?? "") ? 12 : 0;
            const fit = () => {
                n.style.fontSize = "";
                if (n.scrollWidth > n.clientWidth + 1) {
                    n.style.fontSize = `${Math.max(floor, (parseFloat(getComputedStyle(n).fontSize) * n.clientWidth) / n.scrollWidth).toFixed(2)}px`;
                }
            };
            void document.fonts.ready.then(fit);
        });
        const cv = el.querySelector<HTMLCanvasElement>(".c2-foil");
        if (cv) cleanups.push(mountFoil(cv, state));
    });
    return () => cleanups.forEach((f) => f());
}

/** Renders one card's static markup and wires it. display: contents keeps the prototype's layout selectors. */
export function CardHtml({ html, className }: { html: string; className?: string }) {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!ref.current) return;
        return wireCards(ref.current);
    }, [html]);
    return <div ref={ref} className={className} style={className ? undefined : { display: "contents" }} dangerouslySetInnerHTML={{ __html: html }} />;
}
