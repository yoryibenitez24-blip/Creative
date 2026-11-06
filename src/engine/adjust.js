// Image > Adjustments: per-pixel colour/tone operations on straight-alpha RGBA8 buffers.
// Every function mutates buf.data in place, keeps alpha unchanged, and is the identity
// at its neutral settings (tests/ops.test.js checks this for every op).

import { clamp255, lum, srgbToLinear, linearToSrgb, rgbToHsl, hslToRgb, hexToRgb, curveLut } from './color.js';

function eachRgb(buf, f) {
  const d = buf.data;
  for (let i = 0; i < d.length; i += 4) { if (d[i + 3] === 0) continue; const o = f(d[i], d[i + 1], d[i + 2]); d[i] = o[0]; d[i + 1] = o[1]; d[i + 2] = o[2]; }
  return buf;
}
export function applyLut(buf, lr, lg = lr, lb = lr) {
  const d = buf.data;
  for (let i = 0; i < d.length; i += 4) { d[i] = lr[d[i]]; d[i + 1] = lg[d[i + 1]]; d[i + 2] = lb[d[i + 2]]; }
  return buf;
}
const lutOf = f => { const l = new Uint8ClampedArray(256); for (let i = 0; i < 256; i++) l[i] = Math.round(clamp255(f(i))); return l; };
const ident = lutOf(v => v);

/** Brightness −150..150, contrast −50..100 (modern mode: contrast pivots at mid-grey). */
export function brightnessContrast(buf, { brightness = 0, contrast = 0 }) {
  const f = contrast >= 0 ? 1 / Math.max(0.01, 1 - contrast / 101) : 1 + contrast / 100;
  const b = brightness / 150;
  return applyLut(buf, lutOf(v => {
    let x = v / 255;
    x = b >= 0 ? 1 - (1 - x) ** (1 + b) : x ** (1 - b); // brightness bends the curve; ends stay fixed
    return ((x - 0.5) * f + 0.5) * 255;
  }));
}

/** Levels: input black/white/gamma and output black/white, for RGB or one channel. */
export function levelsLut({ inBlack = 0, inWhite = 255, gamma = 1, outBlack = 0, outWhite = 255 }) {
  const span = Math.max(1, inWhite - inBlack);
  return lutOf(v => { const x = Math.min(1, Math.max(0, (v - inBlack) / span)); return outBlack + (outWhite - outBlack) * x ** (1 / gamma); });
}
export function levels(buf, p) {
  const l = levelsLut(p), c = p.channel || 'rgb';
  return applyLut(buf, c === 'rgb' || c === 'r' ? l : ident, c === 'rgb' || c === 'g' ? l : ident, c === 'rgb' || c === 'b' ? l : ident);
}

/** Curves: {rgb:[[x,y]…], r, g, b}. The composite curve runs after the per-channel curves. */
export function curves(buf, { points = {} }) {
  const c = k => curveLut(points[k] || [[0, 0], [255, 255]]);
  const rgb = c('rgb'), r = c('r'), g = c('g'), b = c('b');
  return applyLut(buf, r.map(v => rgb[v]), g.map(v => rgb[v]), b.map(v => rgb[v]));
}

/** Exposure in stops, offset and gamma correction, computed in linear light. */
export function exposure(buf, { exposure: ev = 0, offset = 0, gamma = 1 }) {
  const k = 2 ** ev;
  return applyLut(buf, lutOf(v => { const l = Math.max(0, srgbToLinear(v) * k + offset); return linearToSrgb(l ** (1 / gamma)); }));
}

/** Vibrance boosts low-saturation colours more; saturation scales all chroma. Both −100..100. */
export function vibrance(buf, { vibrance: vib = 0, saturation = 0 }) {
  return eachRgb(buf, (r, g, b) => {
    const y = lum(r, g, b), mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx ? (mx - mn) / mx : 0;
    const k = 1 + saturation / 100 + (vib / 100) * (1 - sat) * (vib > 0 ? 1 : 0.5);
    return [clamp255(y + (r - y) * k), clamp255(y + (g - y) * k), clamp255(y + (b - y) * k)];
  });
}

/** Hue/Saturation (master): hue −180..180, saturation −100..100, lightness −100..100, colorize. */
export function hueSaturation(buf, { hue = 0, saturation = 0, lightness = 0, colorize = false }) {
  return eachRgb(buf, (r, g, b) => {
    let [h, s, l] = rgbToHsl(r, g, b);
    if (colorize) { h = (hue + 360) % 360; s = Math.max(0, Math.min(1, (saturation + 100) / 200)); }
    else { h += hue; s = saturation >= 0 ? s + (1 - s) * s * (saturation / 100) * 2 : s * (1 + saturation / 100); s = Math.max(0, Math.min(1, s)); }
    l = lightness >= 0 ? l + (1 - l) * lightness / 100 : l * (1 + lightness / 100);
    return hslToRgb(h, s, l);
  });
}

/** Color Balance: cyan–red, magenta–green, yellow–blue shifts (−100..100) for a tonal range. */
export function colorBalance(buf, { range = 'midtones', cr = 0, mg = 0, yb = 0, preserveLuminosity = true }) {
  const w = v => { const x = v / 255; return range === 'shadows' ? (1 - x) ** 2 : range === 'highlights' ? x * x : 1 - (2 * x - 1) ** 2; };
  return eachRgb(buf, (r, g, b) => {
    const y = lum(r, g, b), k = w(y) * 0.6;
    let o = [r + cr * k, g + mg * k, b + yb * k].map(clamp255);
    if (preserveLuminosity) { const d = y - lum(...o); o = o.map(v => clamp255(v + d)); }
    return o;
  });
}

/** Black & White mixer. Weights in % for reds, yellows, greens, cyans, blues, magentas; optional tint. */
export const BW_DEFAULTS = { reds: 40, yellows: 60, greens: 40, cyans: 60, blues: 20, magentas: 80 };
export function blackWhite(buf, p) {
  const w = { ...BW_DEFAULTS, ...p };
  const tint = p.tint ? hexToRgb(p.tintColor || '#e1d3b4') : null;
  return eachRgb(buf, (r, g, b) => {
    const c = [r, g, b], idx = [0, 1, 2].sort((a, z) => c[z] - c[a]); // max, mid, min
    const [mx, md, mn] = idx.map(i => c[i]);
    const primary = ['reds', 'greens', 'blues'][idx[0]];
    const pair = idx[0] + idx[1]; // r+g=1 yellow, g+b=3 cyan, r+b=2 magenta
    const secondary = pair === 1 ? 'yellows' : pair === 3 ? 'cyans' : 'magentas';
    const y = clamp255(mn + (md - mn) * w[secondary] / 100 + (mx - md) * w[primary] / 100);
    if (!tint) return [y, y, y];
    const t = y / 255; return tint.map(v => clamp255(t <= 0.5 ? 2 * t * v : 255 - 2 * (1 - t) * (255 - v)));
  });
}

/** Photo Filter: colour at density %, optionally preserving luminosity. */
export function photoFilter(buf, { color = '#ec8a00', density = 25, preserveLuminosity = true }) {
  const c = hexToRgb(color), k = density / 100;
  return eachRgb(buf, (r, g, b) => {
    const y = lum(r, g, b);
    let o = [r * (1 - k) + (r * c[0] / 255) * k * 2, g * (1 - k) + (g * c[1] / 255) * k * 2, b * (1 - k) + (b * c[2] / 255) * k * 2].map(clamp255);
    if (preserveLuminosity) { const d = y - lum(...o); o = o.map(v => clamp255(v + d)); }
    return o;
  });
}

/** Channel Mixer: each output = Σ source·% + constant %. Monochrome uses the red row for all. */
export function channelMixer(buf, { rr = 100, rg = 0, rb = 0, rc = 0, gr = 0, gg = 100, gb = 0, gc = 0, br = 0, bg = 0, bb = 100, bc = 0, monochrome = false }) {
  const row = (a, b2, c, k) => (r, g, b) => clamp255((r * a + g * b2 + b * c) / 100 + 255 * k / 100);
  const R = row(rr, rg, rb, rc), G = monochrome ? R : row(gr, gg, gb, gc), B = monochrome ? R : row(br, bg, bb, bc);
  return eachRgb(buf, (r, g, b) => [R(r, g, b), G(r, g, b), B(r, g, b)]);
}

export const invert = buf => applyLut(buf, lutOf(v => 255 - v));
export const posterize = (buf, { levels: n = 4 }) => { const k = Math.max(2, n | 0) - 1; return applyLut(buf, lutOf(v => Math.round(Math.round(v / 255 * k) / k * 255))); };
export const threshold = (buf, { level = 128 }) => eachRgb(buf, (r, g, b) => { const v = lum(r, g, b) >= level ? 255 : 0; return [v, v, v]; });
export const desaturate = buf => eachRgb(buf, (r, g, b) => { const v = (Math.max(r, g, b) + Math.min(r, g, b)) / 2; return [v, v, v]; });

/** Gradient Map: luminance mapped from colour A (shadows) to colour B (highlights). */
export function gradientMap(buf, { from = '#000000', to = '#ffffff', reverse = false }) {
  let a = hexToRgb(from), b = hexToRgb(to); if (reverse) [a, b] = [b, a];
  return eachRgb(buf, (r, g, bl) => { const t = lum(r, g, bl) / 255; return [0, 1, 2].map(i => a[i] + (b[i] - a[i]) * t); });
}

/** Equalize: redistribute luminance histogram of visible pixels (applied per channel via shared map). */
export function equalize(buf) {
  const d = buf.data, hist = new Float64Array(256); let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3]) { hist[Math.round(lum(d[i], d[i + 1], d[i + 2]))]++; n++; }
  if (!n) return buf;
  const cdf = new Float64Array(256); let acc = 0, first = -1;
  for (let i = 0; i < 256; i++) { acc += hist[i]; cdf[i] = acc; if (first < 0 && hist[i]) first = i; }
  const c0 = cdf[first];
  return applyLut(buf, lutOf(v => n === c0 ? v : (cdf[v] - c0) / (n - c0) * 255));
}

/** Histogram of a buffer (luminance and per channel) over visible pixels; used by Levels. */
export function histogram(buf) {
  const d = buf.data, h = { l: new Uint32Array(256), r: new Uint32Array(256), g: new Uint32Array(256), b: new Uint32Array(256) };
  for (let i = 0; i < d.length; i += 4) if (d[i + 3]) { h.r[d[i]]++; h.g[d[i + 1]]++; h.b[d[i + 2]]++; h.l[Math.round(lum(d[i], d[i + 1], d[i + 2]))]++; }
  return h;
}
