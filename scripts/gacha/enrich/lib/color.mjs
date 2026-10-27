// Cover accent colour (T-0027).
/** Most prominent colourful bucket (ignores near-white/black/grey unless the cover has nothing else). */
export function accentColor(data, channels = 3) {
  const buckets = new Map();
  for (let i = 0; i + 2 < data.length; i += channels) {
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 510;
    const sat = max === min ? 0 : (max - min) / (255 - Math.abs(max + min - 255));
    const weight = l < 0.12 || l > 0.92 ? 0.02 : 0.05 + sat;
    const key = (r >> 5) * 64 + (g >> 5) * 8 + (b >> 5);
    const e = buckets.get(key) ?? { w: 0, r: 0, g: 0, b: 0, n: 0 };
    e.w += weight; e.r += r; e.g += g; e.b += b; e.n++;
    buckets.set(key, e);
  }
  let best = null;
  for (const e of buckets.values()) if (!best || e.w > best.w) best = e;
  const hex = (n) => Math.round(n).toString(16).padStart(2, "0");
  return `#${hex(best.r / best.n)}${hex(best.g / best.n)}${hex(best.b / best.n)}`;
}
