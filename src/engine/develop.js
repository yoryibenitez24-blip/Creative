// Camera Raw–style development of a rendered (non-RAW) image: an original implementation of the
// Light / Color / Effects / Curve / Color Mixer / Color Grading / Detail / Optics / Lens Blur /
// Calibration panels. Input/output: straight-alpha RGBA8. Alpha is preserved.
//
// Pipeline (in order): optics geometry (distortion, chromatic aberration) → lens vignetting →
// white balance → calibration → exposure (linear light) → tone (local highlights/shadows via a
// guided-filter base, whites, blacks, contrast) → dehaze (dark-channel prior) → clarity
// (large-scale local contrast) → texture (mid-frequency band) → curves → colour (vibrance,
// saturation, mixer, grading, profile/B&W) → detail (noise reduction, sharpening) → defringe →
// lens blur (depth from a user-defined focus map) → post-crop vignette → grain → local adjustment
// masks (masks.js; evaluated on the input pixels, see settings.masks).
//
// ctx.scale = (preview pixels) / (document pixels) so radii and grain stay in document space;
// ctx.offsetX/offsetY place the buffer in the document for stable grain/noise seeds.
// Every control at its default value is the identity (tests/develop.test.js).

import { curveLut, rgbToHsl, hslToRgb, hash2 } from './color.js';
import { boxRadii } from './selection.js';
import { prepareMasks, applyMaskJobs } from './masks.js';

export const BANDS = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'];
const BAND_HUES = [0, 30, 60, 120, 180, 225, 270, 315];
const zeros = () => Object.fromEntries(BANDS.map(b => [b, 0]));
const tone = () => ({ hue: 0, sat: 0, lum: 0 });
const ident = () => [[0, 0], [255, 255]];

export const PROFILES = {
  color: { name: 'Color', delta: {} },
  vivid: { name: 'Vivid', delta: { saturation: 18, vibrance: 10, contrast: 12 } },
  portrait: { name: 'Portrait', delta: { contrast: -6, vibrance: -4, 'sat.orange': -8, 'lum.orange': 6 } },
  landscape: { name: 'Landscape', delta: { contrast: 10, 'sat.green': 15, 'sat.blue': 15, 'sat.aqua': 10 } },
  neutral: { name: 'Neutral', delta: { contrast: -18, saturation: -10 } },
  monochrome: { name: 'Monochrome', delta: {}, mono: true },
};

export const DEVELOP_DEFAULTS = Object.freeze({
  profile: 'color', profileAmount: 100,
  wb: 'asShot', temp: 0, tint: 0,
  exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
  texture: 0, clarity: 0, dehaze: 0,
  vignetteAmount: 0, vignetteMidpoint: 50, vignetteRoundness: 0, vignetteFeather: 50, vignetteHighlights: 0,
  grainAmount: 0, grainSize: 25, grainRoughness: 50, grainSeed: 1,
  vibrance: 0, saturation: 0,
  curve: { highlights: 0, lights: 0, darks: 0, shadows: 0, split1: 25, split2: 50, split3: 75, rgb: ident(), r: ident(), g: ident(), b: ident() },
  mixer: { hue: zeros(), sat: zeros(), lum: zeros(), gray: { red: -8, orange: 2, yellow: 30, green: -6, aqua: -12, blue: -20, purple: 4, magenta: 10 } },
  grading: { shadows: tone(), midtones: tone(), highlights: tone(), global: tone(), blending: 50, balance: 0 },
  sharpenAmount: 0, sharpenRadius: 1, sharpenDetail: 25, sharpenMasking: 0,
  nrLuminance: 0, nrDetail: 50, nrContrast: 0, nrColor: 0, nrColorDetail: 50, nrColorSmoothness: 50,
  removeCA: false, distortion: 0, lensVignette: 0, lensVignetteMidpoint: 50,
  defringePurple: 0, purpleHueLo: 30, purpleHueHi: 70, defringeGreen: 0, greenHueLo: 40, greenHueHi: 60,
  lensBlur: { enabled: false, amount: 50, bokeh: 'circle', depth: 'radial', focusX: 0.5, focusY: 0.5, angle: 90, focalNear: 0, focalFar: 20, boost: 0 },
  calibration: { shadowTint: 0, redHue: 0, redSat: 0, greenHue: 0, greenSat: 0, blueHue: 0, blueSat: 0 },
  bypass: {},
});
export const developDefaults = () => structuredClone(DEVELOP_DEFAULTS);

// ---------------- float helpers ----------------
const lin = new Float32Array(256); for (let i = 0; i < 256; i++) { const c = i / 255; lin[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
export const enc = l => l <= 0 ? 0 : l >= 1 ? 1 : l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055;
export const dec = e => e <= 0 ? 0 : e <= 0.04045 ? e / 12.92 : ((e + 0.055) / 1.055) ** 2.4;
export const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
export const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a || 1e-6)); return t * t * (3 - 2 * t); };

function boxH(s, d, w, h, r) { const n = 2 * r + 1; for (let y = 0; y < h; y++) { const o = y * w; let a = 0; for (let x = -r - 1; x < r; x++) a += s[o + Math.min(w - 1, Math.max(0, x))]; for (let x = 0; x < w; x++) { a += s[o + Math.min(w - 1, x + r)] - s[o + Math.max(0, x - r - 1)]; d[o + x] = a / n; } } }
function boxV(s, d, w, h, r) { const n = 2 * r + 1; for (let x = 0; x < w; x++) { let a = 0; for (let y = -r - 1; y < r; y++) a += s[Math.min(h - 1, Math.max(0, y)) * w + x]; for (let y = 0; y < h; y++) { a += s[Math.min(h - 1, y + r) * w + x] - s[Math.max(0, y - r - 1) * w + x]; d[y * w + x] = a / n; } } }
export function boxBlur1(src, w, h, r) { const t = new Float32Array(src.length), o = new Float32Array(src.length); r = Math.max(0, Math.round(r)); if (!r) { o.set(src); return o; } boxH(src, t, w, h, r); boxV(t, o, w, h, r); return o; }
export function gauss1(src, w, h, sigma) {
  const o = Float32Array.from(src); if (!(sigma > 0.3)) return o;
  const t = new Float32Array(src.length);
  for (const r of boxRadii(sigma * 2)) if (r > 0) { boxH(o, t, w, h, r); boxV(t, o, w, h, r); }
  return o;
}
/** Guided filter (He et al.): edge-preserving smoothing of p guided by I. O(N). */
export function guided(I, p, w, h, r, eps) {
  r = Math.max(1, Math.round(r));
  const n = I.length, Ip = new Float32Array(n), II = new Float32Array(n);
  for (let i = 0; i < n; i++) { Ip[i] = I[i] * p[i]; II[i] = I[i] * I[i]; }
  const mI = boxBlur1(I, w, h, r), mp = boxBlur1(p, w, h, r), mIp = boxBlur1(Ip, w, h, r), mII = boxBlur1(II, w, h, r);
  const a = new Float32Array(n), b = new Float32Array(n);
  for (let i = 0; i < n; i++) { const v = mII[i] - mI[i] * mI[i], cov = mIp[i] - mI[i] * mp[i]; a[i] = cov / (v + eps); b[i] = mp[i] - a[i] * mI[i]; }
  const ma = boxBlur1(a, w, h, r), mb = boxBlur1(b, w, h, r), q = new Float32Array(n);
  for (let i = 0; i < n; i++) q[i] = ma[i] * I[i] + mb[i];
  return q;
}
export function minFilter(src, w, h, r) {
  const t = new Float32Array(src.length), o = new Float32Array(src.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let m = Infinity; for (let i = -r; i <= r; i++) { const v = src[y * w + Math.min(w - 1, Math.max(0, x + i))]; if (v < m) m = v; } t[y * w + x] = m; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let m = Infinity; for (let j = -r; j <= r; j++) { const v = t[Math.min(h - 1, Math.max(0, y + j)) * w + x]; if (v < m) m = v; } o[y * w + x] = m; }
  return o;
}
function bilinear(ch, w, h, x, y) {
  x -= 0.5; y -= 0.5; x = Math.min(w - 1, Math.max(0, x)); y = Math.min(h - 1, Math.max(0, y));
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1), fx = x - x0, fy = y - y0;
  return (ch[y0 * w + x0] * (1 - fx) + ch[y0 * w + x1] * fx) * (1 - fy) + (ch[y1 * w + x0] * (1 - fx) + ch[y1 * w + x1] * fx) * fy;
}
export const lumOf = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

// ---------------- analysis helpers (Auto, eyedropper, CA) ----------------
/** Gray-world white balance (ignoring clipped and very dark pixels) → {temp, tint} that neutralise the cast. */
export function autoWhiteBalance(buf) {
  let r = 0, g = 0, b = 0, n = 0; const d = buf.data;
  for (let i = 0; i < d.length; i += 16) { if (!d[i + 3]) continue; const R = lin[d[i]], G = lin[d[i + 1]], B = lin[d[i + 2]], m = Math.max(R, G, B); if (m > 0.95 || m < 0.02) continue; r += R; g += G; b += B; n++; }
  if (!n) return { temp: 0, tint: 0 };
  return wbFromRgb(r / n, g / n, b / n);
}
/** temp/tint that make the given linear colour neutral (inverse of the multipliers below). */
export function wbFromRgb(R, G, B) {
  const t = Math.log2(Math.max(1e-6, B) / Math.max(1e-6, R)) / 1.2, temp = Math.max(-100, Math.min(100, t * 100));
  const rb = Math.sqrt(R * B) * 2 ** 0, tn = Math.log2(Math.max(1e-6, G) / Math.max(1e-6, rb)) / 0.6;
  return { temp: Math.round(temp), tint: Math.round(Math.max(-100, Math.min(100, tn * 100))) };
}
export const wbMul = (temp, tint) => { const t = temp / 100, n = tint / 100; return [2 ** (t * 0.6 + n * 0.3), 2 ** (-n * 0.3), 2 ** (-t * 0.6 + n * 0.3)]; };

/** Auto tone: exposure to put mean luminance near 18 % grey, stretch 0.5/99.5 percentiles, recover clipping. */
export function autoTone(buf) {
  const d = buf.data, hist = new Uint32Array(256); let n = 0, sum = 0;
  for (let i = 0; i < d.length; i += 4) { if (!d[i + 3]) continue; const Y = lumOf(lin[d[i]], lin[d[i + 1]], lin[d[i + 2]]); sum += Y; hist[Math.round(enc(Y) * 255)]++; n++; }
  if (!n) return {};
  const pct = q => { let a = 0; for (let v = 0; v < 256; v++) { a += hist[v]; if (a >= q * n) return v; } return 255; };
  const mean = sum / n, lo = pct(0.005), hi = pct(0.995), clipped = hist[255] / n;
  const exposure = Math.round(Math.max(-2, Math.min(2, Math.log2(0.18 / Math.max(0.01, mean)) * 0.6)) * 100) / 100;
  return { exposure, contrast: Math.round(Math.max(-30, Math.min(30, (180 - (hi - lo)) / 4))), highlights: Math.round(-Math.min(70, clipped * 4000 + (hi > 240 ? 20 : 0))), shadows: Math.round(Math.min(50, Math.max(0, (60 - lo) / 1.5))), whites: Math.round(Math.max(-40, Math.min(40, (245 - hi) / 2))), blacks: Math.round(Math.max(-40, Math.min(40, (10 - lo) / 2))) };
}

/** Estimate lateral chromatic aberration as radial scale of R and B relative to G (search). */
export function estimateCA(R, G, B, w, h) {
  const cx = w / 2, cy = h / 2, step = Math.max(1, Math.floor(Math.sqrt(w * h / 40000)));
  const pts = [];
  for (let y = 2; y < h - 2; y += step) for (let x = 2; x < w - 2; x += step) { const i = y * w + x, gx = G[i + 1] - G[i - 1], gy = G[i + w] - G[i - w]; if (gx * gx + gy * gy > 0.004) pts.push(x, y); }
  if (pts.length < 40) return [1, 1];
  const fit = ch => { let best = 1, bc = Infinity; for (let k = -30; k <= 30; k++) { const s = 1 + k * 0.0005; let c = 0; for (let p = 0; p < pts.length; p += 2) { const x = pts[p] + 0.5, y = pts[p + 1] + 0.5; const v = bilinear(ch, w, h, cx + (x - cx) * s, cy + (y - cy) * s) - G[pts[p + 1] * w + pts[p]]; c += v * v; } if (c < bc) { bc = c; best = s; } } return best; };
  return [fit(R), fit(B)];
}

// ---------------- main ----------------
const isDefault = (v, d) => JSON.stringify(v) === JSON.stringify(d);

export function develop(buf, settings = {}, ctx = {}) {
  const s = mergeProfile({ ...developDefaults(), ...settings });
  const by = s.bypass || {};
  const { w, h, data } = buf, N = w * h, sc = ctx.scale || 1, minDim = Math.min(w, h) / sc;
  let R = new Float32Array(N), G = new Float32Array(N), B = new Float32Array(N);
  for (let i = 0; i < N; i++) { R[i] = lin[data[i * 4]]; G[i] = lin[data[i * 4 + 1]]; B[i] = lin[data[i * 4 + 2]]; }
  let touched = false;
  const cx = w / 2, cy = h / 2, rmax = Math.hypot(cx, cy);
  // Local adjustment masks (masks.js): evaluated on the input pixels, applied after the global pipeline.
  const maskJobs = settings.masks?.length ? prepareMasks(settings.masks, buf) : null;
  if (maskJobs) touched = true;

  // ---- Optics: distortion and chromatic aberration (geometric) ----
  if (!by.optics && (s.distortion || s.removeCA)) {
    touched = true;
    const k = -s.distortion / 100 * 0.25;
    const [sR, sB] = s.removeCA ? estimateCA(R, G, B, w, h) : [1, 1];
    const remap = (ch, extra) => { const o = new Float32Array(N); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const dx = x + 0.5 - cx, dy = y + 0.5 - cy, rr = (dx * dx + dy * dy) / (rmax * rmax), f = (1 + k * rr) * extra; o[y * w + x] = bilinear(ch, w, h, cx + dx * f, cy + dy * f); } return o; };
    R = remap(R, sR); G = remap(G, 1); B = remap(B, sB);
  }
  if (!by.optics && s.lensVignette) {
    touched = true; const a = s.lensVignette / 100, mid = 0.2 + s.lensVignetteMidpoint / 100 * 0.6;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const r = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / rmax, g = 1 + a * smooth(mid * 0.5, 1, r) * 1.2, i = y * w + x; R[i] *= g; G[i] *= g; B[i] *= g; }
  }

  // ---- White balance & calibration (linear) ----
  if (!by.color && (s.temp || s.tint)) { touched = true; const [mr, mg, mb] = wbMul(s.temp, s.tint); for (let i = 0; i < N; i++) { R[i] *= mr; G[i] *= mg; B[i] *= mb; } }
  const cal = s.calibration;
  if (!by.calibration && !isDefault(cal, DEVELOP_DEFAULTS.calibration)) {
    touched = true;
    const col = (unit, hue, sat) => { const [hh, ss, ll] = rgbToHsl(unit[0] * 255, unit[1] * 255, unit[2] * 255); const [r, g, b] = hslToRgb(hh + hue * 0.6, Math.max(0, Math.min(1, ss * (1 + sat / 100))), ll); return [r / 255, g / 255, b / 255]; };
    const cR = col([1, 0, 0], cal.redHue, cal.redSat), cG = col([0, 1, 0], cal.greenHue, cal.greenSat), cB = col([0, 0, 1], cal.blueHue, cal.blueSat);
    const M = [[cR[0], cG[0], cB[0]], [cR[1], cG[1], cB[1]], [cR[2], cG[2], cB[2]]].map(row => { const s2 = row[0] + row[1] + row[2] || 1; return row.map(v => v / s2); });
    const st = cal.shadowTint / 100;
    for (let i = 0; i < N; i++) {
      const r = R[i], g = G[i], b = B[i];
      R[i] = M[0][0] * r + M[0][1] * g + M[0][2] * b; G[i] = M[1][0] * r + M[1][1] * g + M[1][2] * b; B[i] = M[2][0] * r + M[2][1] * g + M[2][2] * b;
      if (st) { const ws = (1 - Math.min(1, enc(lumOf(R[i], G[i], B[i])) * 2)) ** 2; G[i] *= 1 - st * 0.25 * ws; R[i] *= 1 + st * 0.12 * ws; B[i] *= 1 + st * 0.12 * ws; }
    }
  }

  // ---- Exposure ----
  if (!by.light && s.exposure) { touched = true; const k = 2 ** s.exposure; for (let i = 0; i < N; i++) { R[i] *= k; G[i] *= k; B[i] *= k; } }

  // ---- Tone: highlights/shadows (local), whites, blacks, contrast — on perceptual luminance ----
  const toneOn = !by.light && (s.highlights || s.shadows || s.whites || s.blacks || s.contrast);
  const fxOn = !by.effects && (s.texture || s.clarity);
  if (toneOn || fxOn || (!by.effects && s.dehaze)) touched = true;
  if (!by.effects && s.dehaze) {
    // dark channel prior on the current linear image
    const a = s.dehaze / 100, r = Math.max(2, Math.round(7 * sc * Math.max(1, minDim / 600)));
    const dark0 = new Float32Array(N); for (let i = 0; i < N; i++) dark0[i] = Math.min(R[i], G[i], B[i]);
    const dark = minFilter(dark0, w, h, r);
    const order = Array.from(dark.keys()).sort((p, q) => dark[q] - dark[p]).slice(0, Math.max(1, Math.floor(N * 0.001)));
    let A = [0, 0, 0]; for (const i of order) { A[0] += R[i]; A[1] += G[i]; A[2] += B[i]; } A = A.map(v => Math.max(0.05, v / order.length));
    const tr = new Float32Array(N); for (let i = 0; i < N; i++) tr[i] = 1 - 0.95 * Math.min(R[i] / A[0], G[i] / A[1], B[i] / A[2]);
    const minT = minFilter(tr.map(v => 1 - v), w, h, r).map(v => 1 - v);
    const Lg = new Float32Array(N); for (let i = 0; i < N; i++) Lg[i] = enc(lumOf(R[i], G[i], B[i]));
    const t = guided(Lg, minT, w, h, Math.max(4, r * 4), 1e-3);
    for (let i = 0; i < N; i++) {
      const ti = Math.max(0.12, Math.min(1, t[i]));
      if (a >= 0) { const ta = 1 - a * (1 - ti); for (const [ch, k] of [[R, 0], [G, 1], [B, 2]]) ch[i] = Math.max(0, (ch[i] - A[k]) / ta + A[k]); }
      else { const k2 = -a * (1 - ti * 0.5); R[i] += (A[0] - R[i]) * k2 * 0.6; G[i] += (A[1] - G[i]) * k2 * 0.6; B[i] += (A[2] - B[i]) * k2 * 0.6; }
    }
  }
  if (toneOn || fxOn) {
    const Y = new Float32Array(N), L = new Float32Array(N);
    for (let i = 0; i < N; i++) { Y[i] = lumOf(R[i], G[i], B[i]); L[i] = enc(Y[i]); }
    const L0 = Float32Array.from(L);
    if (toneOn) {
      const base = (s.highlights || s.shadows) ? guided(L, L, w, h, Math.max(4, minDim * 0.03 * sc), 0.02) : null;
      const hl = s.highlights / 100, sh = s.shadows / 100, wh = s.whites / 100, bl = s.blacks / 100, c = s.contrast / 100;
      for (let i = 0; i < N; i++) {
        let v = L[i];
        if (base) { const b = clamp01(base[i]); const ws = (1 - b) ** 2, wsh = b * b; v += sh * 0.55 * ws * (sh > 0 ? 1 - v : v); v += hl * 0.6 * wsh * (hl > 0 ? 1 - v : v); }
        if (wh) v += wh * 0.3 * v ** 3 * (wh > 0 ? 1 - v * 0.5 : 1);
        if (bl) v += bl * 0.25 * (1 - v) ** 3 * (bl > 0 ? 1 : 1);
        if (c) v = v + c * 0.9 * (v - 0.5) * (1 - Math.abs(2 * v - 1) * 0.6);
        L[i] = v;
      }
    }
    if (!by.effects && s.clarity) {
      const k = s.clarity / 100, base = guided(L, L, w, h, Math.max(6, minDim * 0.025 * sc), 0.01);
      for (let i = 0; i < N; i++) { const b = clamp01(base[i]), mid = 1 - (2 * b - 1) ** 2; L[i] += k * 0.9 * (L[i] - base[i]) * mid; }
    }
    if (!by.effects && s.texture) {
      const k = s.texture / 100, f = gauss1(L, w, h, 0.8 * Math.max(0.6, sc)), m = gauss1(L, w, h, 4 * Math.max(0.6, sc));
      const big = gauss1(L, w, h, 12 * Math.max(0.6, sc));
      for (let i = 0; i < N; i++) { const band = f[i] - m[i], edge = Math.abs(m[i] - big[i]), att = 1 / (1 + (edge / 0.12) ** 2); L[i] += k * (k > 0 ? 1.4 : 0.9) * band * att; }
    }
    for (let i = 0; i < N; i++) {
      const ny = dec(clamp01(L[i]) + Math.min(0, L[i])), oy = Y[i];
      if (L[i] === L0[i]) continue;
      if (oy > 1e-6) { const k = ny / oy; R[i] *= k; G[i] *= k; B[i] *= k; } else { R[i] = G[i] = B[i] = ny; }
    }
  }

  // ---- to encoded (perceptual) RGB for curves/colour/detail ----
  for (let i = 0; i < N; i++) { R[i] = enc(R[i]); G[i] = enc(G[i]); B[i] = enc(B[i]); }

  // ---- Curves ----
  const cv = s.curve, d0 = DEVELOP_DEFAULTS.curve;
  if (!by.curve && !isDefault(cv, d0)) {
    touched = true;
    const reg = [cv.shadows, cv.darks, cv.lights, cv.highlights].map(v => v / 100), sp = [cv.split1, cv.split2, cv.split3].map(v => v / 100);
    const param = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = i / 255, centres = [sp[0] / 2, (sp[0] + sp[1]) / 2, (sp[1] + sp[2]) / 2, (sp[2] + 1) / 2], widths = [sp[0], sp[1] - sp[0], sp[2] - sp[1], 1 - sp[2]];
      let y = x; for (let k = 0; k < 4; k++) { const wdt = Math.max(0.05, widths[k]) * 1.2, t = (x - centres[k]) / wdt; y += reg[k] * 0.25 * Math.exp(-t * t * 2) * x * (1 - x) * 4; }
      param[i] = clamp01(y);
    }
    const lr = curveLut(cv.rgb), l1 = curveLut(cv.r), l2 = curveLut(cv.g), l3 = curveLut(cv.b);
    const ap = (v, lc) => { const p = param[Math.round(clamp01(v) * 255)]; return lc[lr[Math.round(p * 255)]] / 255; };
    for (let i = 0; i < N; i++) { R[i] = ap(R[i], l1); G[i] = ap(G[i], l2); B[i] = ap(B[i], l3); }
  }

  // ---- Colour: vibrance/saturation, mixer, grading, monochrome ----
  const mix = s.mixer, mixOn = !isDefault(mix.hue, zeros()) || !isDefault(mix.sat, zeros()) || !isDefault(mix.lum, zeros());
  const gradeOn = !isDefault(s.grading, DEVELOP_DEFAULTS.grading);
  const colorOn = !by.color && (s.vibrance || s.saturation);
  const mono = s._mono;
  if (colorOn || (!by.mixer && mixOn) || (!by.grading && gradeOn) || mono) {
    touched = true;
    // piecewise-linear between adjacent band centres: a hue exactly on a centre gets 100 % of that band
    const bw = (hh, k) => { hh = ((hh % 360) + 360) % 360; for (let b = 0; b < 8; b++) { const h0 = BAND_HUES[b], h1 = b < 7 ? BAND_HUES[b + 1] : 360; if (hh >= h0 && hh < h1) { const t = (hh - h0) / (h1 - h0); return k[BANDS[b]] * (1 - t) + k[BANDS[(b + 1) % 8]] * t; } } return k.red; };
    const gr = s.grading, bal = gr.balance / 100, blend = gr.blending / 100;
    const tint = t => { const [r, g, b] = hslToRgb(t.hue, 1, 0.5); return [r / 255 - 0.5, g / 255 - 0.5, b / 255 - 0.5]; };
    const tints = { shadows: tint(gr.shadows), midtones: tint(gr.midtones), highlights: tint(gr.highlights), global: tint(gr.global) };
    for (let i = 0; i < N; i++) {
      let r = clamp01(R[i]), g = clamp01(G[i]), b = clamp01(B[i]);
      if (mono) {
        const [hh, ss] = rgbToHsl(r * 255, g * 255, b * 255), y = lumOf(r, g, b);
        const v = clamp01(y + bw(hh, mix.gray) / 100 * ss * 0.6);
        r = g = b = v;
      } else {
        if (colorOn) {
          const y = lumOf(r, g, b), mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx ? (mx - mn) / mx : 0;
          const k = 1 + s.saturation / 100 + (s.vibrance / 100) * (1 - sat) * (s.vibrance > 0 ? 1 : 0.6);
          r = clamp01(y + (r - y) * k); g = clamp01(y + (g - y) * k); b = clamp01(y + (b - y) * k);
        }
        if (!by.mixer && mixOn) {
          let [hh, ss, ll] = rgbToHsl(r * 255, g * 255, b * 255);
          if (ss > 0.01) { const dh = bw(hh, mix.hue) * 0.3, ds = bw(hh, mix.sat) / 100, dl = bw(hh, mix.lum) / 100; hh += dh; ss = clamp01(ss * (1 + ds)); ll = clamp01(ll + dl * 0.3 * ss); [r, g, b] = hslToRgb(hh, ss, ll).map(v => v / 255); }
        }
      }
      if (!by.grading && gradeOn) {
        const y = lumOf(r, g, b), p = clamp01(y - bal * 0.25), sw = 1 - smooth(0.1, 0.1 + 0.5 * (0.5 + blend), p), hw = smooth(0.9 - 0.5 * (0.5 + blend), 0.9, p), mw = Math.max(0, 1 - sw - hw);
        const add = (t, wgt, conf) => { if (!conf.sat && !conf.lum) return; const k = conf.sat / 100 * 0.35 * wgt; r += t[0] * k + conf.lum / 100 * 0.25 * wgt; g += t[1] * k + conf.lum / 100 * 0.25 * wgt; b += t[2] * k + conf.lum / 100 * 0.25 * wgt; };
        add(tints.shadows, sw, gr.shadows); add(tints.midtones, mw, gr.midtones); add(tints.highlights, hw, gr.highlights); add(tints.global, 1, gr.global);
      }
      R[i] = r; G[i] = g; B[i] = b;
    }
  }

  // ---- Detail: noise reduction (edge-preserving guided filter) and sharpening ----
  if (!by.detail && (s.nrLuminance || s.nrColor || s.sharpenAmount)) {
    touched = true;
    const Yc = new Float32Array(N), Cb = new Float32Array(N), Cr = new Float32Array(N);
    for (let i = 0; i < N; i++) { Yc[i] = lumOf(R[i], G[i], B[i]); Cb[i] = B[i] - Yc[i]; Cr[i] = R[i] - Yc[i]; }
    let Ynew = Yc;
    if (s.nrLuminance) {
      const k = s.nrLuminance / 100, eps = (0.0004 + k * k * 0.01) * (1.2 - s.nrDetail / 100);
      const sm = guided(Yc, Yc, w, h, Math.max(1, (1 + k * 3) * sc), eps);
      Ynew = new Float32Array(N); for (let i = 0; i < N; i++) { const v = Yc[i] + (sm[i] - Yc[i]) * Math.min(1, k * 1.5); Ynew[i] = v + (Yc[i] - v) * (s.nrContrast / 100) * 0.5; }
    }
    if (s.nrColor) {
      const k = s.nrColor / 100, rad = Math.max(1, (2 + k * 8) * sc * (0.5 + s.nrColorSmoothness / 100));
      const eps = (0.001 + k * 0.02) * (1.2 - s.nrColorDetail / 100);
      const cb = guided(Yc, Cb, w, h, rad, eps), cr = guided(Yc, Cr, w, h, rad, eps);
      for (let i = 0; i < N; i++) { Cb[i] += (cb[i] - Cb[i]) * Math.min(1, k * 1.6); Cr[i] += (cr[i] - Cr[i]) * Math.min(1, k * 1.6); }
    }
    if (s.sharpenAmount) {
      const amt = s.sharpenAmount / 100 * 1.6, bl = gauss1(Ynew, w, h, Math.max(0.5, s.sharpenRadius * sc));
      const limit = 0.02 + s.sharpenDetail / 100 * 0.3, m0 = s.sharpenMasking / 100 * 0.12;
      const gs = s.sharpenMasking ? gauss1(Ynew, w, h, 1) : null;
      const out = new Float32Array(N);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x; let dlt = (Ynew[i] - bl[i]) * amt; dlt = Math.max(-limit, Math.min(limit, dlt));
        let m = 1; if (gs) { const gx = gs[Math.min(N - 1, i + 1)] - gs[Math.max(0, i - 1)], gy = gs[Math.min(N - 1, i + w)] - gs[Math.max(0, i - w)]; m = smooth(m0, m0 + 0.04, Math.hypot(gx, gy)); }
        out[i] = Ynew[i] + dlt * m;
      }
      Ynew = out;
    }
    for (let i = 0; i < N; i++) { const y = Ynew[i]; B[i] = y + Cb[i]; R[i] = y + Cr[i]; G[i] = (y - 0.2126 * R[i] - 0.0722 * B[i]) / 0.7152; }
  }

  // ---- Defringe: desaturate purple / green fringes next to strong edges ----
  if (!by.optics && (s.defringePurple || s.defringeGreen)) {
    touched = true;
    const Yd = new Float32Array(N); for (let i = 0; i < N; i++) Yd[i] = lumOf(R[i], G[i], B[i]);
    const edgeMap = new Float32Array(N); for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; edgeMap[i] = Math.hypot(Yd[i + 1] - Yd[i - 1], Yd[i + w] - Yd[i - w]); }
    const near = boxBlur1(edgeMap, w, h, Math.max(1, Math.round(3 * sc)));
    const pr = [240 + s.purpleHueLo * 1.2, 240 + s.purpleHueHi * 1.2], gn = [40 + s.greenHueLo * 1.6, 40 + s.greenHueHi * 1.6];
    for (let i = 0; i < N; i++) {
      if (near[i] < 0.02) continue;
      const [hh, ss, ll] = rgbToHsl(clamp01(R[i]) * 255, clamp01(G[i]) * 255, clamp01(B[i]) * 255); if (ss < 0.12) continue;
      let k = 0;
      if (s.defringePurple && hh >= pr[0] && hh <= pr[1]) k = s.defringePurple / 20;
      if (s.defringeGreen && hh >= gn[0] && hh <= gn[1]) k = s.defringeGreen / 20;
      if (!k) continue; k = Math.min(1, k * smooth(0.02, 0.08, near[i]));
      const [r, g, b] = hslToRgb(hh, ss * (1 - k), ll); R[i] = r / 255; G[i] = g / 255; B[i] = b / 255;
    }
  }

  // ---- Lens Blur: depth from a user-defined focus map (radial or linear), disc/hexagon bokeh ----
  const lb = s.lensBlur;
  if (!by.lensBlur && lb.enabled && lb.amount > 0) {
    touched = true;
    const fx = lb.focusX * w, fy = lb.focusY * h, ang = lb.angle * Math.PI / 180, maxR = Math.max(1, lb.amount / 100 * 30 * sc * Math.max(1, minDim / 800));
    const depth = (x, y) => lb.depth === 'linear' ? Math.abs((x - fx) * Math.cos(ang) + (y - fy) * Math.sin(ang)) / Math.hypot(w, h) * 200 : Math.hypot(x - fx, y - fy) / Math.hypot(w, h) * 200;
    const coc = new Float32Array(N); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const dd = depth(x + 0.5, y + 0.5); coc[y * w + x] = dd < lb.focalNear ? 0 : Math.min(1, (dd - lb.focalFar) / 40) * maxR; }
    const S = 48, samples = [];
    for (let k = 0; k < S; k++) { const t = (k + 0.5) / S, a = k * 2.39996, rr = Math.sqrt(t); let px = Math.cos(a) * rr, py = Math.sin(a) * rr; if (lb.bokeh === 'hexagon') { const ha = Math.atan2(py, px), sector = Math.PI / 3, local = ((ha % sector) + sector) % sector - sector / 2, lim = Math.cos(sector / 2) / Math.cos(local); px *= lim; py *= lim; } samples.push(px, py); }
    const lR = R.map(dec), lG = G.map(dec), lB = B.map(dec), oR = new Float32Array(N), oG = new Float32Array(N), oB = new Float32Array(N);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, r0 = coc[i];
      if (r0 < 0.5) { oR[i] = lR[i]; oG[i] = lG[i]; oB[i] = lB[i]; continue; }
      let ar = 0, ag = 0, ab = 0, tw = 0;
      for (let k = 0; k < samples.length; k += 2) {
        const sx = Math.min(w - 1, Math.max(0, Math.round(x + samples[k] * r0))), sy = Math.min(h - 1, Math.max(0, Math.round(y + samples[k + 1] * r0))), j = sy * w + sx;
        const wj = Math.min(1, coc[j] / r0 + 0.25) * (1 + lb.boost / 100 * 4 * Math.max(0, lumOf(lR[j], lG[j], lB[j]) - 0.6));
        ar += lR[j] * wj; ag += lG[j] * wj; ab += lB[j] * wj; tw += wj;
      }
      oR[i] = ar / tw; oG[i] = ag / tw; oB[i] = ab / tw;
    }
    for (let i = 0; i < N; i++) { R[i] = enc(oR[i]); G[i] = enc(oG[i]); B[i] = enc(oB[i]); }
  }

  // ---- Effects: post-crop vignette and grain (document space) ----
  if (!by.effects && s.vignetteAmount) {
    touched = true;
    const a = s.vignetteAmount / 100, mid = s.vignetteMidpoint / 100, round = s.vignetteRoundness / 100, feather = Math.max(0.02, s.vignetteFeather / 100), hp = s.vignetteHighlights / 100;
    const ax = w / 2, ay = h / 2, circ = Math.min(ax, ay);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const nx = (x + 0.5 - ax) / (ax * (1 - (round + 1) / 2) + circ * ((round + 1) / 2)), ny = (y + 0.5 - ay) / (ay * (1 - (round + 1) / 2) + circ * ((round + 1) / 2));
      const r = Math.hypot(nx, ny) / Math.SQRT2, inner = 0.2 + mid * 0.8 - feather * 0.5, f = smooth(inner, inner + feather, r), i = y * w + x;
      for (const ch of [R, G, B]) { const v = ch[i]; ch[i] = a < 0 ? v * (1 + a * f * (1 - hp * smooth(0.6, 1, v))) : v + (1 - v) * a * f; }
    }
  }
  if (!by.effects && s.grainAmount) {
    touched = true;
    const amt = s.grainAmount / 100 * 0.18, size = 0.5 + s.grainSize / 100 * 3.5, rough = s.grainRoughness / 100, seed = s.grainSeed | 0;
    const ox = ctx.offsetX || 0, oy = ctx.offsetY || 0;
    const noise = (u, v, sd) => { const x0 = Math.floor(u), y0 = Math.floor(v), fx = u - x0, fy = v - y0; const a = hash2(x0, y0, sd), b = hash2(x0 + 1, y0, sd), c = hash2(x0, y0 + 1, sd), d = hash2(x0 + 1, y0 + 1, sd); const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy); return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy - 0.5; };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / sc + ox, v = (y + 0.5) / sc + oy, i = y * w + x;
      const n = (noise(u / size, v / size, seed) * (1 - rough * 0.5) + noise(u / size * 2.3 + 17.1, v / size * 2.3 + 3.7, seed + 7) * rough * 0.9) * 2;
      const L = lumOf(R[i], G[i], B[i]), resp = 0.35 + 2.6 * L * (1 - L);
      const dlt = amt * n * resp; R[i] += dlt; G[i] += dlt; B[i] += dlt;
    }
  }

  if (maskJobs) applyMaskJobs(R, G, B, w, h, maskJobs, ctx);
  if (!touched) return buf;
  for (let i = 0; i < N; i++) { data[i * 4] = Math.round(clamp01(R[i]) * 255); data[i * 4 + 1] = Math.round(clamp01(G[i]) * 255); data[i * 4 + 2] = Math.round(clamp01(B[i]) * 255); }
  return buf;
}

/** Apply the profile's parameter deltas (scaled by Amount) and flag monochrome. */
function mergeProfile(s) {
  const p = PROFILES[s.profile] || PROFILES.color, k = (s.profileAmount ?? 100) / 100;
  const out = { ...s, mixer: { ...s.mixer, sat: { ...s.mixer.sat }, lum: { ...s.mixer.lum } }, _mono: !!p.mono };
  for (const [key, v] of Object.entries(p.delta)) {
    if (key.includes('.')) { const [grp, band] = key.split('.'); out.mixer[grp][band] = (out.mixer[grp][band] || 0) + v * k; }
    else out[key] = (out[key] || 0) + v * k;
  }
  return out;
}
