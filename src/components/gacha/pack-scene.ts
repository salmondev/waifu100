/**
 * Pack opening scene (ported from the v2 prototype pack.js). A 48x72 pixel
 * "data capsule" drawn by code (fillRect rules + a hand-typed "?" bitmap, no
 * character art), turned into three.js Points and opened by a pixel dissolve,
 * stepped beam and CRT flash on a fixed timeline. Without WebGL a 2D canvas
 * fallback steps through the same beats. This module is only ever loaded with
 * a dynamic import() from the /daily pack view, so three stays out of every
 * other bundle.
 */
import * as THREE from "three";
import { PAL } from "./pixel";

type Tier = "common" | "rare" | "sr" | "ssr";
interface Cell { x: number; y: number; c: number[]; rim?: number }
export interface SceneOptions { tier: Tier; colours: { frame: string; shade: string }; setCode: string; cyFrac?: number; hFrac?: number; wFrac?: number }
export interface PackScene { render: (t: number) => void; destroy: () => void; canvas: HTMLCanvasElement; gl: boolean }

const W = 48, H = 72, TEAR = 11;
const PICO = ['#000000', '#1d2b53', '#7e2553', '#008751', '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8',
  '#ff004d', '#ffa300', '#ffec27', '#00e436', '#29adff', '#83769c', '#ff77a8', '#ffccaa'].map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const nearest = (r: number, g: number, b: number) => { let best = 0, bd = 1e9; PICO.forEach((c, i) => { const d = (c[0] - r) ** 2 * 0.3 + (c[1] - g) ** 2 * 0.59 + (c[2] - b) ** 2 * 0.11; if (d < bd) { bd = d; best = i; } }); return PICO[best]; };
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const TIERCOL: Record<Tier, string> = { common: PAL.paper, rare: PAL.grey, sr: PAL.orange, ssr: PAL.yellow }; // round 7: Rare silver, SR gold, as on the cards
export const T = { charge: 0, dis: 0.6, beam: 0.9, flash: 2.4, reveal: 2.7 };
const F = (n: number) => n.toFixed(2); // GLSL float literal

// hand-typed bitmap for the pack face (round 7: replaces the auto-pixelated character art)
const QMARK = [
  '..#####..',
  '.##...##.',
  '##.....##',
  '##.....##',
  '......##.',
  '.....##..',
  '....##...',
  '...##....',
  '...##....',
  '.........',
  '...##....',
  '...##....'];

function drawCapsule(s2: { frame: string; shade: string }, setCode: string): Cell[] {
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d', { willReadFrequently: true });
  // happy-dom has no 2d context; a real browser does. Skip the pack face instead of throwing.
  if (!g) return [];
  const R = (c: string, x: number, y: number, w: number, h: number) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
  // silhouette + outline: stepped corners (2 px), crimped (zigzag) top and bottom edges
  R(PAL.ink, 0, 2, W, H - 4); R(PAL.ink, 2, 0, W - 4, H); R(PAL.ink, 1, 1, W - 2, H - 2);
  for (let x = 2; x < W - 2; x += 2) { g.clearRect(x, 0, 1, 1); g.clearRect(x, H - 1, 1, 1); }
  // body: story colour, flat shade on the right, 1-px highlight column on the left
  R(s2.frame, 2, 2, W - 4, H - 4); R(s2.shade, W - 7, 2, 5, H - 4); R(PAL.paper, 3, 13, 1, 48);
  // cap (ink) with set code + crimp ribs, then the dashed tear line
  R(PAL.ink, 2, 2, W - 4, TEAR - 2);
  for (let x = 4; x < W - 4; x += 3) R(PAL.slate, x, 3, 1, 1);
  g.font = '8px Silkscreen'; g.textBaseline = 'top'; g.fillStyle = PAL.paper; g.fillText(setCode, 5, 3);
  g.fillStyle = PAL.grey; g.fillText('x1', W - 18, 3);
  for (let x = 2; x < W - 2; x++) R(x % 4 < 2 ? PAL.paper : s2.shade, x, TEAR, 1, 1);
  // art window (round 7): no character art on the pack face. Story-colour diagonal stripes (a fillRect rule) and a
  // hand-typed 9x12 "?" bitmap (QMARK above) drawn at 2x with a 1-px ink outline. Nothing is sampled from an image.
  const ax = 6, ay = 15, aw = W - 14, ah = 34;
  R(PAL.ink, ax - 2, ay - 2, aw + 4, ah + 4); R(PAL.paper, ax - 1, ay - 1, aw + 2, ah + 2);
  for (let y = 0; y < ah; y++) for (let x = 0; x < aw; x++) R(((x + y) >> 2) % 2 ? s2.shade : s2.frame, ax + x, ay + y, 1, 1);
  const qw = QMARK[0].length * 2, qh = QMARK.length * 2, qx = ax + Math.round((aw - qw) / 2), qy = ay + Math.round((ah - qh) / 2);
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < qw && y < qh && QMARK[y >> 1][x >> 1] === '#';
  for (let y = -1; y <= qh; y++) for (let x = -1; x <= qw; x++) {
    if (on(x, y)) R(PAL.paper, qx + x, qy + y, 1, 1);
    else if (on(x + 1, y) || on(x - 1, y) || on(x, y + 1) || on(x, y - 1)) R(PAL.ink, qx + x, qy + y, 1, 1);
  }
  // label plate + dithered foot
  R(PAL.ink, 5, 53, W - 12, 9); R(PAL.paper, 6, 54, W - 14, 7);
  g.font = '8px Silkscreen'; g.fillStyle = PAL.ink; g.fillText('GACHA', Math.round(6 + (W - 14 - g.measureText('GACHA').width) / 2), 54);
  for (let y = 64; y < H - 2; y++) for (let x = 2; x < W - 2; x++) if ((x + y) % 2 === 0) R(s2.shade, x, y, 1, 1);
  // threshold everything to 1-bit alpha + snap to the palette (text antialiasing would otherwise leave soft pixels)
  const d = g.getImageData(0, 0, W, H).data, cells: Cell[] = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4; if (d[i + 3] < 128) continue;
    cells.push({ x, y, c: nearest(d[i], d[i + 1], d[i + 2]) });
  }
  // 1-pixel paper outline around the whole sprite so it reads on the ink stage
  const has = new Set(cells.map((c) => c.y * 1000 + c.x));
  for (let y = -1; y <= H; y++) for (let x = -1; x <= W; x++) {
    if (has.has(y * 1000 + x)) continue;
    if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => has.has((y + dy) * 1000 + x + dx))) cells.push({ x, y, c: hex(PAL.paper), rim: 1 });
  }
  return cells;
}

const VS = `uniform float uT, uPx, uCell; uniform vec3 uTier;
attribute vec2 aCell; attribute vec3 aCol; attribute float aRand, aEdge, aPer;
varying vec3 vCol; varying float vHide;
float bayer(vec2 c){ vec2 a=mod(c,4.); float i=a.y*4.+a.x;
  ${BAYER.map((v, i) => `if(i<${i}.5) return ${(v / 16).toFixed(4)};`).join(' ')} return 0.; }
void main(){
  vec2 p=vec2(aCell.x-${W / 2}.+.5, ${H / 2}.-aCell.y-.5)*uCell;
  vec3 col=aCol; float size=1.; vHide=0.;
  // charge: marching light around the outline + a 2-step shake
  if(uT>0. && uT<${F(T.dis)}){
    if(aEdge>.5 && fract(aPer-uT*2.2)<.18) col=uTier;
    if(uT>.3) p.x+=floor(sin(uT*60.)*1.5+.5)*uCell*.5;
  }
  // dissolve: starts at the tear line, ordered by distance + Bayer + noise, flies out, steps to tier colour, shrinks in steps
  float k=clamp(abs(aCell.y-${TEAR}.)/60.,0.,1.)*.6+bayer(aCell)*.25+aRand*.15;
  float rel=${F(T.dis)}+k*1.3;
  if(uT>rel){
    float a=uT-rel;
    // pulled up into the beam: drift toward the centre line, rise, shrink in 4 steps, gone after ~0.5 s
    vec2 v=vec2(-p.x*1.6+(aRand-.5)*90., 90.+aRand*170.+(aCell.y<${TEAR}.?120.:0.));
    p+=v*a;
    p=floor(p/(uCell*.5))*(uCell*.5);
    col= a<.07 ? vec3(1.,.945,.91) : uTier;
    size=max(0.,1.-floor(a*8.)*.25);
    if(size<=0.) vHide=1.;
  }
  vCol=col;
  gl_Position=projectionMatrix*modelViewMatrix*vec4(p,0.,1.);
  gl_PointSize=uPx*size;
}`;
const FSP = 'varying vec3 vCol; varying float vHide; void main(){ if(vHide>.5) discard; gl_FragColor=vec4(vCol,1.); }';

// background + beam + CRT flash in one full-screen pass, all quantised to the capsule's pixel size
const FSB = `precision highp float;
uniform float uT, uPx, uSSR, uSR; uniform vec2 uRes, uC; uniform vec3 uTier;
float b2(vec2 a){a=floor(a);return fract(dot(a,vec2(.5,a.y*.75)));}
float bayer4(vec2 a){return b2(.5*a)*.25+b2(a);}
vec3 rb(float i){ i=mod(i,6.);
  if(i<1.) return vec3(1.,0.,.302); if(i<2.) return vec3(1.,.639,0.); if(i<3.) return vec3(1.,.925,.153);
  if(i<4.) return vec3(0.,.894,.212); if(i<5.) return vec3(.161,.678,1.); return vec3(1.,.467,.659); }
void main(){
  vec2 cell=floor(gl_FragCoord.xy/uPx); vec2 cc=floor(uC/uPx);
  vec3 ink=vec3(.114,.169,.325), sky=vec3(.161,.678,1.), paper=vec3(1.,.945,.91);
  // ground: ink stage, sky floor fading up through a 4x4 Bayer ramp (no gradient blur)
  float fy=cc.y-${H / 2 + 3}.;                                 // floor line, just under the capsule
  float f=clamp((fy-cell.y)/10.+.5,0.,1.);
  vec3 col = bayer4(cell)<f ? sky : ink;
  vec2 sd=(cell-vec2(cc.x,fy+1.))/vec2(${W / 2 + 4}.,2.5);
  if(dot(sd,sd)<1.) col=ink;                                     // stepped drop shadow on the floor
  if(uT>${F(T.beam)}){
    float a=uT-${F(T.beam)};
    float w=floor(min(a/.25,1.)*4.)*3.+ (a>.6? 3.:0.);           // half width in cells, grows in steps
    if(uT>2.15) w=floor(w*max(0.,1.-(uT-2.15)/.25)*4.)/4.;
    float dx=abs(cell.x-cc.x);
    float top=cc.y+floor(a/.04)*6.;                                // beam climbs in 6-cell steps
    if(cell.y<cc.y-${H / 2 - 12}. || cell.y>top) dx=1e3;
    vec3 tc=uTier;
    if(uT<1.75 && (uSSR>.5||uSR>.5)) tc=sky;                     // promotion tease: starts blue
    if(uSSR>.5 && uT>=1.75 && uT<1.95) tc=vec3(.761,.765,.78);  // SSR passes through silver, then gold
    float band=floor((cell.y+floor(uT*24.))/3.);
    if(dx<w*.34) col=paper;
    else if(dx<w*.67) col= uSSR>.5 && uT>1.95 ? rb(band) : tc;
    else if(dx<w) { if(bayer4(cell)<.5) col= (uSR>.5 && uT>1.75) ? rb(band+dx) : tc; }
  }
  if(uT>${F(T.flash)} && uT<${F(T.reveal)}){
    float a=(uT-${F(T.flash)})/${F(T.reveal - T.flash)};
    float hh= a<.5 ? floor(a*2.*6.)/6. : 1.-floor((a-.5)*2.*6.)/6.;  // open to full white, collapse to a line
    float hb=uRes.y*.5*hh/uPx;
    if(abs(cell.y-floor(uRes.y*.5/uPx))<=hb) col=paper;
  }
  gl_FragColor=vec4(col,1.);
}`;

// Scene builder shared by the stage-1 page (mountPack below) and the game prototype (src/v2/game/pack.js).
// cyFrac = capsule centre as a fraction of the stage height; hFrac/wFrac = max capsule size as a fraction of the stage.
// Returns { render(t), canvas, T, gl: true } or, when WebGL is unavailable, a 2D fallback: the same capsule pixels
// drawn once with fillRect, and render(t) only steps the capsule away (no beam) so the reveal still happens.
export async function createPackScene(stage: HTMLElement, { tier, colours, setCode, cyFrac = 0.47, hFrac = 0.5, wFrac = 0.62 }: SceneOptions): Promise<PackScene> {
  try { await document.fonts.load('8px Silkscreen'); } catch { /* the capsule text falls back to the default face */ }
  const cells = drawCapsule(colours, setCode);
  const vw = stage.clientWidth, vh = stage.clientHeight, dpr = Math.min(devicePixelRatio || 1, 2);
  const cell = Math.max(3, Math.floor(Math.min(vw * wFrac / W, vh * hFrac / H)));
  const cy = vh * cyFrac;
  let renderer: THREE.WebGLRenderer | null = null;
  const probe = document.createElement('canvas');
  const hasGL = !!(probe.getContext('webgl2') || probe.getContext('webgl'));
  if (hasGL) {
    try { renderer = new THREE.WebGLRenderer({ antialias: false, failIfMajorPerformanceCaveat: false }); } catch { renderer = null; }
  }
  if (!renderer || !renderer.getContext()) return fallback2D(stage, cells, { vw, vh, cell, cy, tier });
  renderer.setPixelRatio(dpr); renderer.setSize(vw, vh); stage.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-vw / 2, vw / 2, vh / 2, -vh / 2, -10, 10);
  const tierCol = new THREE.Color(TIERCOL[tier]);
  const bgU = { uT: { value: -1 }, uPx: { value: cell * dpr }, uRes: { value: new THREE.Vector2(vw * dpr, vh * dpr) }, uC: { value: new THREE.Vector2(vw / 2 * dpr, (vh - cy) * dpr) },
    uTier: { value: tierCol }, uSSR: { value: tier === 'ssr' ? 1 : 0 }, uSR: { value: tier === 'sr' ? 1 : 0 } };
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ uniforms: bgU, vertexShader: 'void main(){gl_Position=vec4(position.xy,0.,1.);}', fragmentShader: FSB, depthTest: false, depthWrite: false }));
  bg.frustumCulled = false; bg.renderOrder = 0; scene.add(bg);
  const n = cells.length, aCell = new Float32Array(n * 2), aCol = new Float32Array(n * 3), aRand = new Float32Array(n), aEdge = new Float32Array(n), aPer = new Float32Array(n), pos = new Float32Array(n * 3);
  cells.forEach((c, i) => {
    aCell.set([c.x, c.y], i * 2); aCol.set(c.c.map((v) => v / 255), i * 3);
    aRand[i] = ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1;
    aEdge[i] = c.rim ? 1 : 0; aPer[i] = (Math.atan2(c.y - H / 2, c.x - W / 2) / (Math.PI * 2) + 1) % 1;
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  ([['aCell', aCell, 2], ['aCol', aCol, 3], ['aRand', aRand, 1], ['aEdge', aEdge, 1], ['aPer', aPer, 1]] as const).forEach(([k, v, sz]) => geo.setAttribute(k, new THREE.BufferAttribute(v, sz)));
  const pU = { uT: { value: -1 }, uPx: { value: cell * dpr }, uCell: { value: cell }, uTier: { value: tierCol } };
  const pts = new THREE.Points(geo, new THREE.ShaderMaterial({ uniforms: pU, vertexShader: VS, fragmentShader: FSP, depthTest: false }));
  pts.frustumCulled = false; pts.renderOrder = 1; scene.add(pts);
  cam.position.y = 0; pts.position.y = vh / 2 - cy;
  const r = renderer;
  const render = (t: number) => { bgU.uT.value = t; pU.uT.value = t; r.render(scene, cam); };
  const destroy = () => { geo.dispose(); bg.geometry.dispose(); (bg.material as THREE.Material).dispose(); (pts.material as THREE.Material).dispose(); r.dispose(); r.forceContextLoss(); r.domElement.remove(); };
  return { render, destroy, canvas: r.domElement, gl: true };
}

// No-WebGL fallback: a 2D canvas with the same pixels and a flat ink/sky ground. Opening steps the capsule out in
// 4 frames, then a flat tier-coloured column widens in steps (a stand-in for the beam), a paper flash, and the
// ground again when the caller shows the card. No particles, no shader.
function fallback2D(stage: HTMLElement, cells: Cell[], { vw, vh, cell, cy, tier }: { vw: number; vh: number; cell: number; cy: number; tier: Tier }): PackScene {
  const cv = document.createElement('canvas'); cv.width = vw; cv.height = vh; stage.appendChild(cv);
  const g = cv.getContext('2d')!;
  const ox = Math.round(vw / 2 - (W / 2) * cell), oy = Math.round(cy - (H / 2) * cell);
  const draw = (t: number) => {
    g.fillStyle = PAL.ink; g.fillRect(0, 0, vw, vh);
    g.fillStyle = PAL.sky; g.fillRect(0, oy + (H + 3) * cell, vw, vh);
    const k = t <= 0 ? 0 : Math.min(4, Math.floor(t / 0.15) + 1); // 0..4 steps: capsule pixels removed by a fixed pattern
    if (t >= T.reveal) return;
    if (t >= T.flash) { g.fillStyle = PAL.paper; g.fillRect(0, 0, vw, vh); return; }
    if (t >= T.dis) { const n = 1 + Math.floor((t - T.dis) / 0.25); const bw = Math.min(W, 4 * n) * cell; g.fillStyle = TIERCOL[tier]; g.fillRect(Math.round(vw / 2 - bw / 2), 0, bw, oy + (H + 3) * cell); }
    cells.forEach((c) => {
      if (k && ((c.x * 7 + c.y * 13) % 4) < k) return;
      g.fillStyle = k ? TIERCOL[tier] : `rgb(${c.c.join(',')})`;
      g.fillRect(ox + c.x * cell, oy + c.y * cell, cell, cell);
    });
  };
  return { render: draw, destroy: () => cv.remove(), canvas: cv, gl: false };
}

