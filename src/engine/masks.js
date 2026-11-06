// Local adjustment masks for the develop pipeline (Camera Raw Filter and Library · Develop),
// modelled on Lightroom's Masking panel. Pure JS, worker-safe, no DOM, no AI / ML (decision D-001):
// Subject and Sky are found with classical, deterministic computer vision.
//
// Data model (stored in develop settings):
//   settings.masks = [{ id, name, enabled, invert, amount 0..100, components: [Component], adjust: LocalAdjust }]
//   Component = { id, type, op: 'add'|'subtract'|'intersect', invert, params }
//     subject | sky | background  { sensitivity 0..100 }
//     brush      { strokes: [{ mode: 'add'|'erase', size (diameter, fraction of the long side), feather, flow, density 0..100, points: [x, y, …] 0..1 }] }
//     linear     { x0, y0, x1, y1 } 0..1 — full effect on the (x0,y0) side, none beyond (x1,y1)
//     radial     { cx, cy, rx, ry (fractions of width / height), angle (deg), feather 0..100, inside }
//     color      { samples: [[r, g, b] 0..255 …≤5], refine 0..100 }   (distance in CIE Lab)
//     luminance  { lo, hi, loFeather, hiFeather } in L* 0..100
//     all        {}
// Every coordinate is normalised, every radius is relative to the image, and detection runs at a
// fixed working resolution, so a mask evaluated on a 480 px proxy, the 1100 px preview or the full
// resolution image is the same mask.
//
// Subject (saliency + iterative colour models, GrabCut-like):
//   working image ≤ 200 px (area average, CIE Lab) → saliency = colour distance to a k-means model of
//   the border (border pixels are assumed to be background) + frequency-tuned contrast, weighted by
//   a centre prior → Otsu threshold → 4 rounds of k-means foreground / background colour models with
//   an edge-aware (guided filter) smoothness term → connected-component clean-up and hole filling →
//   upsampled and refined with a guided filter at the target resolution for soft, edge-following
//   borders. Background = 1 − Subject.
// Sky: per-pixel sky likelihood (brightness, blue or overcast-neutral colour, low texture) → flood
//   fill from the top rows with a neighbour colour-step limit → sky patches between branches that
//   match the sky colour of their row → guided-filter refinement.
// Both are cached in a small LRU keyed by a cheap checksum + size + sensitivity, so a slider drag
// does not recompute them (in the worker and on the main thread alike).

import { guided, boxBlur1, gauss1, lumOf, wbMul, minFilter, clamp01, smooth } from './develop.js';
import { hslToRgb, rgbToHsl } from './color.js';

export const MASK_TYPES = [
  ['subject', 'Subject'], ['sky', 'Sky'], ['background', 'Background'], ['brush', 'Brush'],
  ['linear', 'Linear Gradient'], ['radial', 'Radial Gradient'], ['color', 'Color Range'], ['luminance', 'Luminance Range'], ['all', 'Entire Image'],
];
export const typeLabel = t => (MASK_TYPES.find(m => m[0] === t) || [t, t])[1];

export const LOCAL_DEFAULTS = Object.freeze({
  exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
  temp: 0, tint: 0, hue: 0, saturation: 0,
  texture: 0, clarity: 0, dehaze: 0, defringe: 0, sharpness: 0, noise: 0,
  color: Object.freeze({ hue: 0, saturation: 0 }),
});
export const BRUSH_DEFAULTS = Object.freeze({ size: 0.08, feather: 50, flow: 100, density: 100 });

/** Default params for a new component of `type`. */
export function defaultParams(type) {
  switch (type) {
    case 'subject': case 'sky': case 'background': return { sensitivity: 50 };
    case 'brush': return { strokes: [] };
    case 'linear': return { x0: 0.5, y0: 0.15, x1: 0.5, y1: 0.55 };
    case 'radial': return { cx: 0.5, cy: 0.5, rx: 0.25, ry: 0.25, angle: 0, feather: 50, inside: true };
    case 'color': return { samples: [], refine: 50 };
    case 'luminance': return { lo: 60, hi: 100, loFeather: 15, hiFeather: 0 };
    default: return {};
  }
}
const uid = p => p + Math.random().toString(36).slice(2, 9);
export const createComponent = (type, op = 'add', params) => ({ id: uid('c'), type, op, invert: false, params: { ...defaultParams(type), ...(params || {}) } });
/** New mask with one component; the name is the first free "Mask N". */
export function createMask(type, params, masks = []) {
  let n = masks.length + 1; const names = new Set(masks.map(m => m.name)); while (names.has('Mask ' + n)) n++;
  return { id: uid('m'), name: 'Mask ' + n, enabled: true, invert: false, amount: 100, components: [createComponent(type, 'add', params)], adjust: { ...LOCAL_DEFAULTS, color: { ...LOCAL_DEFAULTS.color } } };
}
export function normAdjust(a) { return { ...LOCAL_DEFAULTS, ...(a || {}), color: { ...LOCAL_DEFAULTS.color, ...(a?.color || {}) } }; }
export function isLocalIdentity(a) {
  a = normAdjust(a);
  for (const k of Object.keys(LOCAL_DEFAULTS)) if (k !== 'color' && a[k]) return false;
  return !a.color.saturation;
}
/** Masks that change pixels: enabled, with components, non-zero amount and a non-identity adjustment. */
export const activeMasks = masks => (Array.isArray(masks) ? masks : []).filter(m => m && m.enabled !== false && m.components?.length && (m.amount ?? 100) > 0 && !isLocalIdentity(m.adjust));

// ---------------------------------------------------------------- colour helpers
const LIN = new Float32Array(256); for (let i = 0; i < 256; i++) { const c = i / 255; LIN[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
const fLab = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
/** Linear RGB → CIE Lab (D65) written to out[0..2]. */
function labLin(r, g, b, out) {
  const X = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047, Y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b, Z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const fx = fLab(X), fy = fLab(Y), fz = fLab(Z);
  out[0] = 116 * fy - 16; out[1] = 500 * (fx - fy); out[2] = 200 * (fy - fz); return out;
}
export function rgbToLab(r, g, b) { return labLin(LIN[Math.round(r) & 255], LIN[Math.round(g) & 255], LIN[Math.round(b) & 255], [0, 0, 0]); }
/** L* (0..100) of an 8-bit sRGB pixel. */
export const lstar = (r, g, b) => 116 * fLab(0.2126729 * LIN[r] + 0.7151522 * LIN[g] + 0.072175 * LIN[b]) - 16;

// Fast encode/decode (sRGB transfer) through interpolated LUTs; only used by the mask path.
const DN = 4096, DEC = new Float32Array(DN + 2), ENC = new Float32Array(DN + 2);
// (local copies of develop.js's transfer functions: masks.js and develop.js import each other, so
// nothing from develop.js may be used at module-evaluation time)
const encX = l => l <= 0 ? 0 : l >= 1 ? 1 : l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055;
const decX = e => e <= 0 ? 0 : e <= 0.04045 ? e / 12.92 : ((e + 0.055) / 1.055) ** 2.4;
for (let i = 0; i <= DN + 1; i++) { const v = Math.min(1, i / DN); DEC[i] = decX(v); ENC[i] = encX(v * v); }
const fdec = e => { if (e <= 0) return 0; if (e >= 1) return 1; const f = e * DN, i = f | 0; return DEC[i] + (DEC[i + 1] - DEC[i]) * (f - i); };
const fenc = l => { if (l <= 0) return 0; if (l >= 1) return 1; const f = Math.sqrt(l) * DN, i = f | 0; return ENC[i] + (ENC[i + 1] - ENC[i]) * (f - i); };

// ---------------------------------------------------------------- image helpers
/** Area-average down-sample of an RGBA8 buffer to ≤ maxSide (linear light), as Lab planes. */
function workImage(buf, maxSide) {
  const { w, h, data } = buf, k = Math.min(1, maxSide / Math.max(w, h)), ow = Math.max(1, Math.round(w * k)), oh = Math.max(1, Math.round(h * k)), M = ow * oh;
  const sr = new Float32Array(M), sg = new Float32Array(M), sb = new Float32Array(M), n = new Float32Array(M);
  const xm = new Int32Array(w); for (let x = 0; x < w; x++) xm[x] = Math.min(ow - 1, Math.floor(x * ow / w));
  for (let y = 0; y < h; y++) {
    const o = Math.min(oh - 1, Math.floor(y * oh / h)) * ow;
    for (let x = 0, p = y * w * 4; x < w; x++, p += 4) { const j = o + xm[x]; sr[j] += LIN[data[p]]; sg[j] += LIN[data[p + 1]]; sb[j] += LIN[data[p + 2]]; n[j]++; }
  }
  const L = new Float32Array(M), A = new Float32Array(M), B = new Float32Array(M), t = [0, 0, 0];
  for (let j = 0; j < M; j++) { const c = n[j] || 1; labLin(sr[j] / c, sg[j] / c, sb[j] / c, t); L[j] = t[0]; A[j] = t[1]; B[j] = t[2]; }
  return { w: ow, h: oh, L, A, B };
}
/** Bilinear up-sampling of a plane with pixel-centre alignment. */
function upsample(src, sw, sh, w, h) {
  if (sw === w && sh === h) return Float32Array.from(src);
  const out = new Float32Array(w * h), fx = new Float32Array(w), x0 = new Int32Array(w), x1 = new Int32Array(w);
  for (let x = 0; x < w; x++) { let u = (x + 0.5) * sw / w - 0.5; u = Math.min(sw - 1, Math.max(0, u)); x0[x] = Math.floor(u); x1[x] = Math.min(sw - 1, x0[x] + 1); fx[x] = u - x0[x]; }
  for (let y = 0; y < h; y++) {
    let v = (y + 0.5) * sh / h - 0.5; v = Math.min(sh - 1, Math.max(0, v)); const y0 = Math.floor(v), y1 = Math.min(sh - 1, y0 + 1), fy = v - y0, r0 = y0 * sw, r1 = y1 * sw, o = y * w;
    for (let x = 0; x < w; x++) { const a = src[r0 + x0[x]] + (src[r0 + x1[x]] - src[r0 + x0[x]]) * fx[x], b = src[r1 + x0[x]] + (src[r1 + x1[x]] - src[r1 + x0[x]]) * fx[x]; out[o + x] = a + (b - a) * fy; }
  }
  return out;
}
function downAvg(src, w, h, sw, sh) {
  const out = new Float32Array(sw * sh), n = new Float32Array(sw * sh), xm = new Int32Array(w);
  for (let x = 0; x < w; x++) xm[x] = Math.min(sw - 1, Math.floor(x * sw / w));
  for (let y = 0; y < h; y++) { const o = Math.min(sh - 1, Math.floor(y * sh / h)) * sw; for (let x = 0; x < w; x++) { out[o + xm[x]] += src[y * w + x]; n[o + xm[x]]++; } }
  for (let i = 0; i < out.length; i++) out[i] /= n[i] || 1;
  return out;
}
/** Fast guided filter (He & Sun 2015): coefficients on a 1/s grid, applied at full resolution. */
export function fastGuided(I, p, w, h, r, eps) {
  const s = Math.max(1, Math.floor(r / 3));
  if (s <= 1 || w < 16 || h < 16) return guided(I, p, w, h, r, eps);
  const sw = Math.max(2, Math.ceil(w / s)), sh = Math.max(2, Math.ceil(h / s)), rs = Math.max(1, Math.round(r / s));
  const Is = downAvg(I, w, h, sw, sh), ps = downAvg(p, w, h, sw, sh), n = Is.length;
  const Ip = new Float32Array(n), II = new Float32Array(n); for (let i = 0; i < n; i++) { Ip[i] = Is[i] * ps[i]; II[i] = Is[i] * Is[i]; }
  const mI = boxBlur1(Is, sw, sh, rs), mp = boxBlur1(ps, sw, sh, rs), mIp = boxBlur1(Ip, sw, sh, rs), mII = boxBlur1(II, sw, sh, rs);
  const a = new Float32Array(n), b = new Float32Array(n);
  for (let i = 0; i < n; i++) { const v = mII[i] - mI[i] * mI[i], cov = mIp[i] - mI[i] * mp[i]; a[i] = cov / (v + eps); b[i] = mp[i] - a[i] * mI[i]; }
  const A = upsample(boxBlur1(a, sw, sh, rs), sw, sh, w, h), B = upsample(boxBlur1(b, sw, sh, rs), sw, sh, w, h);
  for (let i = 0; i < A.length; i++) A[i] = A[i] * I[i] + B[i];
  return A;
}
/** Encoded luminance (0..1) of an RGBA8 buffer, the guide image for refinement. */
function guideOf(buf) { const { data } = buf, N = buf.w * buf.h, g = new Float32Array(N); for (let i = 0; i < N; i++) g[i] = (0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2]) / 255; return g; }
/** Up-sample a working-resolution matte to the buffer size and snap it to image edges. */
function refineMatte(a0, sw, sh, buf, boost = 1.25) {
  const { w, h } = buf, up = upsample(a0, sw, sh, w, h);
  const r = Math.max(1, Math.round(Math.max(w, h) / 140)), q = fastGuided(guideOf(buf), up, w, h, r, 2e-3);
  for (let i = 0; i < q.length; i++) q[i] = clamp01((q[i] - 0.5) * boost + 0.5);
  return q;
}

// ---------------------------------------------------------------- detection cache
const CACHE = new Map(), CACHE_MAX = 10;
function checksum(buf) {
  const d = buf.data, n = d.length, step = Math.max(1, Math.floor(n / 8192)) | 0;
  let h = 0x811c9dc5 ^ buf.w ^ (buf.h << 16);
  for (let i = 0; i < n; i += step) { h ^= d[i]; h = Math.imul(h, 0x01000193); }
  for (let i = Math.max(0, n - 4096); i < n; i++) { h ^= d[i]; h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}
function cached(kind, buf, sens, compute) {
  const key = kind + '|' + buf.w + 'x' + buf.h + '|' + sens + '|' + checksum(buf);
  if (CACHE.has(key)) { const v = CACHE.get(key); CACHE.delete(key); CACHE.set(key, v); return v; }
  const v = compute(); CACHE.set(key, v);
  while (CACHE.size > CACHE_MAX) CACHE.delete(CACHE.keys().next().value);
  return v;
}
/** Drop cached detections (tests / memory pressure). */
export const clearMaskCache = () => CACHE.clear();

// ---------------------------------------------------------------- k-means (deterministic)
function kmeans(L, A, B, idx, K, iters = 8) {
  const n = idx.length; if (!n) return [];
  const stride = Math.max(1, Math.floor(n / 4000)), sub = []; for (let i = 0; i < n; i += stride) sub.push(idx[i]);
  // farthest-point initialisation from the mean
  let m = [0, 0, 0]; for (const j of sub) { m[0] += L[j]; m[1] += A[j]; m[2] += B[j]; } m = m.map(v => v / sub.length);
  const C = [];
  let best = sub[0], bd = -1; for (const j of sub) { const d = (L[j] - m[0]) ** 2 + (A[j] - m[1]) ** 2 + (B[j] - m[2]) ** 2; if (d > bd) { bd = d; best = j; } }
  C.push([L[best], A[best], B[best]]);
  const dmin = new Float32Array(sub.length).fill(Infinity);
  while (C.length < K) {
    const c = C[C.length - 1]; let fi = -1, fd = 1; // stop when all points are within 1 ΔE
    for (let s = 0; s < sub.length; s++) { const j = sub[s], d = (L[j] - c[0]) ** 2 + (A[j] - c[1]) ** 2 + (B[j] - c[2]) ** 2; if (d < dmin[s]) dmin[s] = d; if (dmin[s] > fd) { fd = dmin[s]; fi = j; } }
    if (fi < 0) break; C.push([L[fi], A[fi], B[fi]]);
  }
  const k = C.length, acc = new Float64Array(k * 4);
  for (let it = 0; it < iters; it++) {
    acc.fill(0);
    for (const j of sub) { let bi = 0, bd2 = Infinity; for (let c = 0; c < k; c++) { const d = (L[j] - C[c][0]) ** 2 + (A[j] - C[c][1]) ** 2 + (B[j] - C[c][2]) ** 2; if (d < bd2) { bd2 = d; bi = c; } } acc[bi * 4] += L[j]; acc[bi * 4 + 1] += A[j]; acc[bi * 4 + 2] += B[j]; acc[bi * 4 + 3]++; }
    for (let c = 0; c < k; c++) if (acc[c * 4 + 3]) C[c] = [acc[c * 4] / acc[c * 4 + 3], acc[c * 4 + 1] / acc[c * 4 + 3], acc[c * 4 + 2] / acc[c * 4 + 3]];
  }
  return C.filter((_, c) => acc[c * 4 + 3] >= Math.max(1, sub.length * 0.01));
}
const nearest = (C, l, a, b) => { let d = Infinity; for (const c of C) { const e = (l - c[0]) ** 2 + (a - c[1]) ** 2 + (b - c[2]) ** 2; if (e < d) d = e; } return Math.sqrt(d); };
function otsu(v, bins = 64) {
  const hist = new Float64Array(bins); for (const x of v) hist[Math.min(bins - 1, Math.max(0, Math.floor(x * bins)))]++;
  let total = v.length, sum = 0; for (let i = 0; i < bins; i++) sum += i * hist[i];
  let wB = 0, sB = 0, best = 0, thr = bins / 2;
  for (let i = 0; i < bins; i++) { wB += hist[i]; if (!wB) continue; const wF = total - wB; if (!wF) break; sB += i * hist[i]; const mB = sB / wB, mF = (sum - sB) / wF, between = wB * wF * (mB - mF) ** 2; if (between > best) { best = between; thr = i; } }
  return (thr + 1) / bins;
}
function percentile(v, q) { const s = Float32Array.from(v).sort(); return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))]; }
/** Connected components (4-neighbour) of a binary map → { labels Int32Array, sizes [] } (label 0 = off). */
function components(bin, w, h) {
  const lab = new Int32Array(w * h), sizes = [0], q = new Int32Array(w * h);
  for (let s = 0; s < w * h; s++) {
    if (!bin[s] || lab[s]) continue;
    const id = sizes.length; let qh = 0, qt = 0, n = 0; q[qt++] = s; lab[s] = id;
    while (qh < qt) { const p = q[qh++], x = p % w, y = (p - x) / w; n++; const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]; for (const r of nb) if (r >= 0 && bin[r] && !lab[r]) { lab[r] = id; q[qt++] = r; } }
    sizes.push(n);
  }
  return { lab, sizes };
}

// ---------------------------------------------------------------- Subject
function subjectWork(wk, sens) {
  const { w, h } = wk, N = w * h;
  const L = gauss1(wk.L, w, h, 0.8), A = gauss1(wk.A, w, h, 0.8), B = gauss1(wk.B, w, h, 0.8);
  const bw = Math.max(2, Math.round(0.04 * Math.max(w, h)));
  const border = new Uint8Array(N), bIdx = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, side = x < bw || x >= w - bw || y < bw, bottom = y >= h - bw;
    if (side) { border[i] = 2; bIdx.push(i); } else if (bottom) { border[i] = 1; if ((x & 1) === 0) bIdx.push(i); } // the bottom edge counts half: subjects are often cut by it
  }
  const bC = kmeans(L, A, B, bIdx, 8);
  let mL = 0, mA = 0, mB = 0; for (let i = 0; i < N; i++) { mL += L[i]; mA += A[i]; mB += B[i]; } mL /= N; mA /= N; mB /= N;
  const Dc = new Float32Array(N), Df = new Float32Array(N);
  for (let i = 0; i < N; i++) { Dc[i] = nearest(bC, L[i], A[i], B[i]); Df[i] = Math.hypot(L[i] - mL, A[i] - mA, B[i] - mB); }
  const nc = Math.max(4, percentile(Dc, 0.99)), nf = Math.max(4, percentile(Df, 0.99));
  const S = new Float32Array(N);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, dx = (x + 0.5) / w - 0.5, dy = (y + 0.5) / h - 0.5, g = Math.exp(-(dx * dx + dy * dy) / (2 * 0.28 * 0.28));
    S[i] = clamp01((0.7 * Math.min(1, Dc[i] / nc) + 0.3 * Math.min(1, Df[i] / nf)) * (0.35 + 0.65 * g));
  }
  const thr = otsu(S), bias = (sens - 50) / 50 * 1.5, Lg = new Float32Array(N);
  for (let i = 0; i < N; i++) Lg[i] = L[i] / 100;
  let fg = new Uint8Array(N); for (let i = 0; i < N; i++) fg[i] = S[i] > thr && border[i] !== 2 ? 1 : 0;
  for (let it = 0; it < 4; it++) {
    const fI = [], bI = []; for (let i = 0; i < N; i++) (fg[i] ? fI : bI).push(i);
    if (!fI.length || !bI.length) break;
    const fC = kmeans(L, A, B, fI, 5, 6), gC = kmeans(L, A, B, bI, 8, 6);
    const pf = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const dF = nearest(fC, L[i], A[i], B[i]), dB = nearest(gC, L[i], A[i], B[i]);
      let lg = (dB - dF) / 7 + 3 * (S[i] - thr) + bias;
      if (border[i] === 2) lg -= 4;
      pf[i] = 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, lg))));
    }
    const sm = guided(Lg, guided(Lg, pf, w, h, 2, 0.01), w, h, 2, 0.01);
    fg = new Uint8Array(N); for (let i = 0; i < N; i++) fg[i] = sm[i] > 0.5 ? 1 : 0;
  }
  // keep the significant components (the largest and any at least 15 % of it with real saliency)
  const { lab, sizes } = components(fg, w, h);
  const keep = new Uint8Array(sizes.length); let big = 0; for (let k = 1; k < sizes.length; k++) if (sizes[k] > sizes[big]) big = k;
  if (big) { const salSum = new Float64Array(sizes.length); for (let i = 0; i < N; i++) if (lab[i]) salSum[lab[i]] += S[i]; for (let k = 1; k < sizes.length; k++) keep[k] = k === big || (sizes[k] >= sizes[big] * 0.15 && salSum[k] / sizes[k] > thr) ? 1 : 0; }
  const out = new Float32Array(N); for (let i = 0; i < N; i++) out[i] = lab[i] && keep[lab[i]] ? 1 : 0;
  // fill holes: background components that do not touch the border
  const bg = new Uint8Array(N); for (let i = 0; i < N; i++) bg[i] = out[i] ? 0 : 1;
  const hc = components(bg, w, h), touches = new Uint8Array(hc.sizes.length);
  for (let x = 0; x < w; x++) { touches[hc.lab[x]] = 1; touches[hc.lab[(h - 1) * w + x]] = 1; }
  for (let y = 0; y < h; y++) { touches[hc.lab[y * w]] = 1; touches[hc.lab[y * w + w - 1]] = 1; }
  for (let i = 0; i < N; i++) if (hc.lab[i] && !touches[hc.lab[i]]) out[i] = 1;
  return out;
}
/** Salient foreground object(s) → Float32Array alpha (0..1) at buf size. opts { sensitivity 0..100 }. */
export function detectSubject(buf, opts = {}) {
  const sens = Math.max(0, Math.min(100, opts.sensitivity ?? 50));
  return cached('subject', buf, sens, () => { const wk = workImage(buf, 200); return refineMatte(subjectWork(wk, sens), wk.w, wk.h, buf); });
}

// ---------------------------------------------------------------- Sky
function skyWork(wk, sens) {
  const { w, h, L, A, B } = wk, N = w * h, s = sens / 50;
  const gm = new Float32Array(N);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x, gx = L[y * w + Math.min(w - 1, x + 1)] - L[y * w + Math.max(0, x - 1)], gy = L[Math.min(h - 1, y + 1) * w + x] - L[Math.max(0, y - 1) * w + x]; gm[i] = Math.hypot(gx, gy) / 2; }
  const T = boxBlur1(gm, w, h, 1);
  const P = new Float32Array(N), Pc = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const C = Math.hypot(A[i], B[i]), bright = smooth(28 - 8 * s, 52 - 8 * s, L[i]);
    const blue = smooth(2, 14, -B[i]) * (1 - smooth(25, 45, Math.abs(A[i])));
    const neutral = (1 - smooth(10, 24, C)) * smooth(48, 68, L[i]);
    Pc[i] = bright * Math.max(blue, neutral);
    P[i] = Pc[i] * (1 - smooth(1.2 + 0.8 * s, 4 + 3 * s, T[i]));
  }
  const inS = new Uint8Array(N), q = new Int32Array(N); let qt = 0, qh = 0;
  const top = Math.max(1, Math.round(h * 0.2));
  for (let i = 0; i < top * w; i++) if (P[i] > 0.5) { inS[i] = 1; q[qt++] = i; }
  if (!qt) return new Float32Array(N);
  const thr = Math.max(0.08, 0.32 - 0.12 * s), step = 3.5 + 2.5 * s;
  while (qh < qt) {
    const p = q[qh++], x = p % w, y = (p - x) / w;
    for (const r of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
      if (r < 0 || inS[r] || P[r] < thr) continue;
      if (Math.hypot(L[r] - L[p], A[r] - A[p], B[r] - B[p]) > step) continue;
      inS[r] = 1; q[qt++] = r;
    }
  }
  // sky colour per row (for sky seen through branches / between buildings)
  const rowL = new Float32Array(h), rowA = new Float32Array(h), rowB = new Float32Array(h), rowN = new Float32Array(h);
  let lowest = 0;
  for (let i = 0; i < N; i++) if (inS[i]) { const y = (i / w) | 0; rowL[y] += L[i]; rowA[y] += A[i]; rowB[y] += B[i]; rowN[y]++; if (y > lowest) lowest = y; }
  let last = -1; for (let y = 0; y < h; y++) { if (rowN[y] >= 2) { rowL[y] /= rowN[y]; rowA[y] /= rowN[y]; rowB[y] /= rowN[y]; last = y; } else if (last >= 0) { rowL[y] = rowL[last]; rowA[y] = rowA[last]; rowB[y] = rowB[last]; rowN[y] = -1; } else rowN[y] = -2; }
  const out = new Float32Array(N), tol = 5 + 3 * s;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (inS[i]) { out[i] = 1; continue; }
    if (y > lowest || rowN[y] === -2 || Pc[i] < 0.3) continue;
    const d = Math.hypot(L[i] - rowL[y], A[i] - rowA[y], B[i] - rowB[y]);
    out[i] = (1 - smooth(tol * 0.5, tol, d)) * smooth(0.3, 0.6, Pc[i]);
  }
  return out;
}
/** Sky region → Float32Array alpha (0..1) at buf size. opts { sensitivity 0..100 }. */
export function detectSky(buf, opts = {}) {
  const sens = Math.max(0, Math.min(100, opts.sensitivity ?? 50));
  return cached('sky', buf, sens, () => { const wk = workImage(buf, 200); return refineMatte(skyWork(wk, sens), wk.w, wk.h, buf, 1.15); });
}

// ---------------------------------------------------------------- geometric / range components
function brushAlpha(p, w, h) {
  const out = new Float32Array(w * h), long = Math.max(w, h); let cov = null;
  for (const st of p.strokes || []) {
    const pts = st.points || []; if (pts.length < 2) continue;
    cov = cov || new Float32Array(w * h);
    const r = Math.max(0.5, (st.size ?? BRUSH_DEFAULTS.size) * long / 2), inner = r * (1 - clamp01((st.feather ?? 50) / 100));
    const flow = clamp01((st.flow ?? 100) / 100), dens = clamp01((st.density ?? 100) / 100), erase = st.mode === 'erase';
    let bx0 = w, by0 = h, bx1 = -1, by1 = -1;
    const n = pts.length >> 1;
    for (let k = 0; k < n; k++) {
      const ax = pts[2 * k] * w, ay = pts[2 * k + 1] * h, j = Math.min(n - 1, k + 1), bx = pts[2 * j] * w, by = pts[2 * j + 1] * h;
      if (k > 0 && j === k) break;
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - r)), x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx) + r)), y0 = Math.max(0, Math.floor(Math.min(ay, by) - r)), y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by) + r));
      if (x0 > x1 || y0 > y1) continue;
      if (x0 < bx0) bx0 = x0; if (y0 < by0) by0 = y0; if (x1 > bx1) bx1 = x1; if (y1 > by1) by1 = y1;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const px = x + 0.5 - ax, py = y + 0.5 - ay, t = l2 ? Math.max(0, Math.min(1, (px * dx + py * dy) / l2)) : 0, d = Math.hypot(px - t * dx, py - t * dy);
        if (d >= r) continue;
        const v = d <= inner ? 1 : 1 - smooth(inner, r, d), i = y * w + x; if (v > cov[i]) cov[i] = v;
      }
    }
    for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) {
      const i = y * w + x, v = cov[i] * flow; if (!v) continue; cov[i] = 0;
      if (erase) out[i] *= 1 - v * dens; else if (out[i] < dens) out[i] += (dens - out[i]) * v;
    }
  }
  return out;
}
function linearAlpha(p, w, h) {
  const out = new Float32Array(w * h), ax = p.x0 * w, ay = p.y0 * h, dx = p.x1 * w - ax, dy = p.y1 * h - ay, l2 = dx * dx + dy * dy || 1e-9;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const t = clamp01(((x + 0.5 - ax) * dx + (y + 0.5 - ay) * dy) / l2); out[y * w + x] = 1 - t * t * (3 - 2 * t); }
  return out;
}
function radialAlpha(p, w, h) {
  const out = new Float32Array(w * h), cx = p.cx * w, cy = p.cy * h, a = Math.max(0.5, Math.abs(p.rx) * w), b = Math.max(0.5, Math.abs(p.ry) * h), ang = (p.angle || 0) * Math.PI / 180, co = Math.cos(ang), si = Math.sin(ang);
  const inner = 1 - clamp01((p.feather ?? 50) / 100), inside = p.inside !== false;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy, u = (dx * co + dy * si) / a, v = (-dx * si + dy * co) / b, d = Math.sqrt(u * u + v * v);
    const al = d <= inner ? 1 : d >= 1 ? 0 : 1 - smooth(inner, 1, d);
    out[y * w + x] = inside ? al : 1 - al;
  }
  return out;
}
function colorAlpha(p, buf, w, h) {
  const out = new Float32Array(w * h), S = (p.samples || []).slice(0, 5).map(c => rgbToLab(c[0], c[1], c[2])); if (!S.length) return out;
  const tol = 4 + clamp01((p.refine ?? 50) / 100) * 50, lo = tol * 0.35, d = buf.data, t = [0, 0, 0];
  for (let i = 0; i < w * h; i++) {
    labLin(LIN[d[i * 4]], LIN[d[i * 4 + 1]], LIN[d[i * 4 + 2]], t);
    let m = Infinity; for (const s of S) { const e = (t[0] - s[0]) ** 2 + (t[1] - s[1]) ** 2 + (t[2] - s[2]) ** 2; if (e < m) m = e; }
    out[i] = 1 - smooth(lo, tol, Math.sqrt(m));
  }
  return out;
}
function luminanceAlpha(p, buf, w, h) {
  const out = new Float32Array(w * h), d = buf.data, lo = p.lo ?? 0, hi = p.hi ?? 100, lf = Math.max(0, p.loFeather ?? 0), hf = Math.max(0, p.hiFeather ?? 0);
  const lut = new Float32Array(1001); for (let k = 0; k <= 1000; k++) { const L = k / 10; lut[k] = (lf ? smooth(lo - lf, lo, L) : L >= lo ? 1 : 0) * (hf ? 1 - smooth(hi, hi + hf, L) : L <= hi ? 1 : 0); }
  for (let i = 0; i < w * h; i++) { const L = lstar(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]); out[i] = lut[Math.max(0, Math.min(1000, Math.round(L * 10)))]; }
  return out;
}

/** Alpha (0..1) of one component, before its op / invert. Detection results are shared (read-only). */
export function componentAlpha(c, buf, w = buf.w, h = buf.h) {
  const p = { ...defaultParams(c.type), ...(c.params || {}) };
  switch (c.type) {
    case 'subject': return detectSubject(buf, p);
    case 'background': { const s = detectSubject(buf, p), o = new Float32Array(s.length); for (let i = 0; i < s.length; i++) o[i] = 1 - s[i]; return o; }
    case 'sky': return detectSky(buf, p);
    case 'brush': return brushAlpha(p, w, h);
    case 'linear': return linearAlpha(p, w, h);
    case 'radial': return radialAlpha(p, w, h);
    case 'color': return colorAlpha(p, buf, w, h);
    case 'luminance': return luminanceAlpha(p, buf, w, h);
    case 'all': return new Float32Array(w * h).fill(1);
    default: return new Float32Array(w * h);
  }
}

/**
 * Evaluate a mask on the ORIGINAL pixels `buf` (RGBA8, w × h) → Float32Array alpha 0..1.
 * Components combine in order: add = max, subtract = a·(1−c), intersect = min (component invert first);
 * then mask invert and amount.
 */
export function evaluateMask(mask, buf, w = buf.w, h = buf.h) {
  const N = w * h, a = new Float32Array(N);
  for (const c of mask?.components || []) {
    if (c.enabled === false) continue;
    const v = componentAlpha(c, buf, w, h), inv = !!c.invert;
    if (c.op === 'subtract') for (let i = 0; i < N; i++) { const x = inv ? 1 - v[i] : v[i]; a[i] *= 1 - x; }
    else if (c.op === 'intersect') for (let i = 0; i < N; i++) { const x = inv ? 1 - v[i] : v[i]; if (x < a[i]) a[i] = x; }
    else for (let i = 0; i < N; i++) { const x = inv ? 1 - v[i] : v[i]; if (x > a[i]) a[i] = x; }
  }
  const k = clamp01((mask?.amount ?? 100) / 100);
  if (mask?.invert) for (let i = 0; i < N; i++) a[i] = (1 - a[i]) * k;
  else if (k !== 1) for (let i = 0; i < N; i++) a[i] *= k;
  return a;
}

// ---------------------------------------------------------------- local adjustments
function dehazeCrop(R, G, B, w, h, amt, r) {
  const N = w * h, a = amt / 100, dark0 = new Float32Array(N);
  for (let i = 0; i < N; i++) dark0[i] = Math.min(R[i], G[i], B[i]);
  const dark = minFilter(dark0, w, h, r);
  // atmospheric light: mean colour of the brightest 0.1 % of the dark channel (histogram, no sort)
  const hist = new Uint32Array(1024); for (let i = 0; i < N; i++) hist[Math.min(1023, Math.max(0, Math.floor(dark[i] * 1023)))]++;
  let need = Math.max(1, Math.floor(N * 0.001)), cut = 1023; for (; cut > 0 && need > 0; cut--) need -= hist[cut];
  const A = [0, 0, 0]; let n = 0; for (let i = 0; i < N; i++) if (Math.floor(dark[i] * 1023) > cut) { A[0] += R[i]; A[1] += G[i]; A[2] += B[i]; n++; }
  for (let k = 0; k < 3; k++) A[k] = Math.max(0.05, n ? A[k] / n : 0.5);
  const tr = new Float32Array(N); for (let i = 0; i < N; i++) tr[i] = 0.95 * Math.min(R[i] / A[0], G[i] / A[1], B[i] / A[2]);
  const mt = minFilter(tr, w, h, r), Lg = new Float32Array(N); for (let i = 0; i < N; i++) { mt[i] = 1 - mt[i]; Lg[i] = fenc(lumOf(R[i], G[i], B[i])); }
  const t = fastGuided(Lg, mt, w, h, Math.max(4, r * 4), 1e-3);
  for (let i = 0; i < N; i++) {
    const ti = Math.max(0.12, Math.min(1, t[i]));
    if (a >= 0) { const ta = 1 - a * (1 - ti); R[i] = Math.max(0, (R[i] - A[0]) / ta + A[0]); G[i] = Math.max(0, (G[i] - A[1]) / ta + A[1]); B[i] = Math.max(0, (B[i] - A[2]) / ta + A[2]); }
    else { const k2 = -a * (1 - ti * 0.5); R[i] += (A[0] - R[i]) * k2 * 0.6; G[i] += (A[1] - G[i]) * k2 * 0.6; B[i] += (A[2] - B[i]) * k2 * 0.6; }
  }
}

/**
 * Apply one mask's local adjustments in place. R, G, B: LINEAR-light Float32 planes (w × h);
 * alpha: Float32Array 0..1 from evaluateMask; adjust: LocalAdjust; ctx.scale as in develop().
 * The maths mirrors develop()'s global sliders. Only the bounding box of the mask (plus filter
 * padding) is processed. Returns true when something changed.
 */
export function applyLocal(R, G, B, w, h, alpha, adjust, ctx = {}) {
  const a = normAdjust(adjust); if (isLocalIdentity(a)) return false;
  let bx0 = w, by0 = h, bx1 = -1, by1 = -1;
  for (let y = 0; y < h; y++) { const o = y * w; let any = false; for (let x = 0; x < w; x++) if (alpha[o + x] > 1e-3) { any = true; if (x < bx0) bx0 = x; break; } if (!any) continue; for (let x = w - 1; x >= 0; x--) if (alpha[o + x] > 1e-3) { if (x > bx1) bx1 = x; break; } if (y < by0) by0 = y; by1 = y; }
  if (bx1 < 0) return false;
  const sc = ctx.scale || 1, minDim = Math.min(w, h) / sc;
  const toneOn = a.contrast || a.highlights || a.shadows || a.whites || a.blacks, fxOn = a.clarity || a.texture;
  const baseR = Math.max(4, minDim * 0.03 * sc), clarR = Math.max(6, minDim * 0.025 * sc), dhR = Math.max(2, Math.round(7 * sc * Math.max(1, minDim / 600)));
  let pad = 0;
  if (a.highlights || a.shadows) pad = Math.max(pad, baseR * 2.2);
  if (a.clarity) pad = Math.max(pad, clarR * 2.2);
  if (a.texture) pad = Math.max(pad, 12 * Math.max(0.6, sc) * 3);
  if (a.dehaze) pad = Math.max(pad, dhR * 10);
  if (a.sharpness || a.noise || a.defringe) pad = Math.max(pad, 12 * Math.max(0.6, sc));
  pad = Math.ceil(pad) + 2;
  const x0 = Math.max(0, bx0 - pad), y0 = Math.max(0, by0 - pad), x1 = Math.min(w - 1, bx1 + pad), y1 = Math.min(h - 1, by1 + pad), cw = x1 - x0 + 1, ch = y1 - y0 + 1, N = cw * ch;
  const r = new Float32Array(N), g = new Float32Array(N), b = new Float32Array(N);
  for (let y = 0; y < ch; y++) { const s = (y + y0) * w + x0; r.set(R.subarray(s, s + cw), y * cw); g.set(G.subarray(s, s + cw), y * cw); b.set(B.subarray(s, s + cw), y * cw); }

  // --- white balance, exposure (linear) ---
  if (a.temp || a.tint) { const [mr, mg, mb] = wbMul(a.temp, a.tint); for (let i = 0; i < N; i++) { r[i] *= mr; g[i] *= mg; b[i] *= mb; } }
  if (a.exposure) { const k = 2 ** a.exposure; for (let i = 0; i < N; i++) { r[i] *= k; g[i] *= k; b[i] *= k; } }
  if (a.dehaze) dehazeCrop(r, g, b, cw, ch, a.dehaze, dhR);
  // --- tone, clarity, texture on perceptual luminance (as develop()) ---
  if (toneOn || fxOn) {
    const Y = new Float32Array(N), L = new Float32Array(N);
    for (let i = 0; i < N; i++) { Y[i] = lumOf(r[i], g[i], b[i]); L[i] = fenc(Y[i]); }
    const L0 = Float32Array.from(L);
    if (toneOn) {
      const base = (a.highlights || a.shadows) ? fastGuided(L, L, cw, ch, baseR, 0.02) : null;
      const hl = a.highlights / 100, sh = a.shadows / 100, wh = a.whites / 100, bl = a.blacks / 100, c = a.contrast / 100;
      for (let i = 0; i < N; i++) {
        let v = L[i];
        if (base) { const bb = clamp01(base[i]); const ws = (1 - bb) ** 2, wsh = bb * bb; v += sh * 0.55 * ws * (sh > 0 ? 1 - v : v); v += hl * 0.6 * wsh * (hl > 0 ? 1 - v : v); }
        if (wh) v += wh * 0.3 * v ** 3 * (wh > 0 ? 1 - v * 0.5 : 1);
        if (bl) v += bl * 0.25 * (1 - v) ** 3;
        if (c) v = v + c * 0.9 * (v - 0.5) * (1 - Math.abs(2 * v - 1) * 0.6);
        L[i] = v;
      }
    }
    if (a.clarity) {
      const k = a.clarity / 100, base = fastGuided(L, L, cw, ch, clarR, 0.01);
      for (let i = 0; i < N; i++) { const bb = clamp01(base[i]), mid = 1 - (2 * bb - 1) ** 2; L[i] += k * 0.9 * (L[i] - base[i]) * mid; }
    }
    if (a.texture) {
      const k = a.texture / 100, s0 = Math.max(0.6, sc), f = gauss1(L, cw, ch, 0.8 * s0), m = gauss1(L, cw, ch, 4 * s0), big = gauss1(L, cw, ch, 12 * s0);
      for (let i = 0; i < N; i++) { const band = f[i] - m[i], edge = Math.abs(m[i] - big[i]), att = 1 / (1 + (edge / 0.12) ** 2); L[i] += k * (k > 0 ? 1.4 : 0.9) * band * att; }
    }
    for (let i = 0; i < N; i++) {
      if (L[i] === L0[i]) continue;
      const ny = fdec(clamp01(L[i])) + Math.min(0, L[i]), oy = Y[i];
      if (oy > 1e-6) { const k = Math.max(0, ny) / oy; r[i] *= k; g[i] *= k; b[i] *= k; } else { r[i] = g[i] = b[i] = Math.max(0, ny); }
    }
  }
  // --- colour and detail on encoded values ---
  const col = a.color, colorOn = a.saturation || a.hue || col.saturation, detailOn = a.sharpness || a.noise || a.defringe;
  if (colorOn || detailOn) {
    for (let i = 0; i < N; i++) { r[i] = fenc(r[i]); g[i] = fenc(g[i]); b[i] = fenc(b[i]); }
    if (colorOn) {
      const k = 1 + a.saturation / 100, th = a.hue * Math.PI / 180, co = Math.cos(th), si = Math.sin(th);
      let t = [0, 0, 0], tk = 0; if (col.saturation) { const c = hslToRgb(col.hue, 1, 0.5); t = [c[0] / 255 - 0.5, c[1] / 255 - 0.5, c[2] / 255 - 0.5]; const ty = lumOf(t[0], t[1], t[2]); t = t.map(v => v - ty); tk = col.saturation / 100 * 0.45; }
      for (let i = 0; i < N; i++) {
        let rr = r[i], gg = g[i], bb = b[i]; const y = lumOf(rr, gg, bb);
        if (a.hue) { // rotate chroma in YIQ
          const I = 0.596 * rr - 0.274 * gg - 0.322 * bb, Q = 0.211 * rr - 0.523 * gg + 0.312 * bb, Yq = 0.299 * rr + 0.587 * gg + 0.114 * bb;
          const I2 = I * co - Q * si, Q2 = I * si + Q * co;
          rr = Yq + 0.956 * I2 + 0.621 * Q2; gg = Yq - 0.272 * I2 - 0.647 * Q2; bb = Yq - 1.106 * I2 + 1.703 * Q2;
        }
        if (a.saturation) { const yy = lumOf(rr, gg, bb); rr = yy + (rr - yy) * k; gg = yy + (gg - yy) * k; bb = yy + (bb - yy) * k; }
        if (tk) { rr += t[0] * tk; gg += t[1] * tk; bb += t[2] * tk; }
        const d = y - lumOf(rr, gg, bb); r[i] = rr + d; g[i] = gg + d; b[i] = bb + d;
      }
    }
    if (detailOn) {
      const Yc = new Float32Array(N), Cb = new Float32Array(N), Cr = new Float32Array(N);
      for (let i = 0; i < N; i++) { Yc[i] = lumOf(r[i], g[i], b[i]); Cb[i] = b[i] - Yc[i]; Cr[i] = r[i] - Yc[i]; }
      let Yn = Yc;
      if (a.noise > 0) {
        const k = a.noise / 100, eps = (0.0004 + k * k * 0.01) * 0.7, sm = guided(Yc, Yc, cw, ch, Math.max(1, (1 + k * 3) * sc), eps);
        Yn = new Float32Array(N); for (let i = 0; i < N; i++) Yn[i] = Yc[i] + (sm[i] - Yc[i]) * Math.min(1, k * 1.5);
        const rad = Math.max(1, (2 + k * 6) * sc), cb = guided(Yc, Cb, cw, ch, rad, 0.002 + k * 0.01), cr = guided(Yc, Cr, cw, ch, rad, 0.002 + k * 0.01);
        for (let i = 0; i < N; i++) { Cb[i] += (cb[i] - Cb[i]) * k; Cr[i] += (cr[i] - Cr[i]) * k; }
      }
      if (a.sharpness > 0) {
        const amt = a.sharpness / 100 * 1.6, bl = gauss1(Yn, cw, ch, Math.max(0.5, sc)), lim = 0.02 + 0.25 * 0.3, out = new Float32Array(N);
        for (let i = 0; i < N; i++) out[i] = Yn[i] + Math.max(-lim, Math.min(lim, (Yn[i] - bl[i]) * amt));
        Yn = out;
      } else if (a.sharpness < 0) {
        const k = -a.sharpness / 100, bl = gauss1(Yn, cw, ch, Math.max(0.6, 2.5 * sc)), out = new Float32Array(N);
        for (let i = 0; i < N; i++) out[i] = Yn[i] + (bl[i] - Yn[i]) * k;
        Yn = out;
      }
      for (let i = 0; i < N; i++) { const y = Yn[i]; b[i] = y + Cb[i]; r[i] = y + Cr[i]; g[i] = (y - 0.2126 * r[i] - 0.0722 * b[i]) / 0.7152; }
      if (a.defringe > 0) {
        // desaturate purple (hue 260..330) and green (hue 75..160) fringes next to strong edges
        const k = a.defringe / 100, edge = new Float32Array(N);
        for (let y = 1; y < ch - 1; y++) for (let x = 1; x < cw - 1; x++) { const i = y * cw + x; edge[i] = Math.hypot(Yc[i + 1] - Yc[i - 1], Yc[i + cw] - Yc[i - cw]); }
        const near = boxBlur1(edge, cw, ch, Math.max(1, Math.round(3 * sc)));
        for (let i = 0; i < N; i++) {
          const e = smooth(0.015, 0.06, near[i]); if (!e) continue;
          const [hh, ss] = rgbToHsl(clamp01(r[i]) * 255, clamp01(g[i]) * 255, clamp01(b[i]) * 255); if (ss < 0.1) continue;
          const band = Math.max(smooth(250, 270, hh) * (1 - smooth(320, 340, hh)), smooth(65, 85, hh) * (1 - smooth(150, 170, hh))); if (!band) continue;
          const f = Math.min(1, k * e * band * 1.2), y = lumOf(r[i], g[i], b[i]);
          r[i] += (y - r[i]) * f; g[i] += (y - g[i]) * f; b[i] += (y - b[i]) * f;
        }
      }
    }
    for (let i = 0; i < N; i++) { r[i] = fdec(r[i]); g[i] = fdec(g[i]); b[i] = fdec(b[i]); }
  }
  // --- blend through the mask ---
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const j = (y + y0) * w + x + x0, al = alpha[j]; if (!(al > 0)) continue; const i = y * cw + x;
    R[j] += (r[i] - R[j]) * al; G[j] += (g[i] - G[j]) * al; B[j] += (b[i] - B[j]) * al;
  }
  return true;
}

/** develop() hook, step 1: evaluate the active masks on the input pixels. → jobs or null. */
export function prepareMasks(masks, buf) {
  const act = activeMasks(masks); if (!act.length) return null;
  return act.map(m => ({ alpha: evaluateMask(m, buf, buf.w, buf.h), adjust: m.adjust }));
}
/** develop() hook, step 2: planes are ENCODED (0..1) here; decode, apply each mask, re-encode. */
export function applyMaskJobs(R, G, B, w, h, jobs, ctx = {}) {
  const N = w * h;
  for (let i = 0; i < N; i++) { R[i] = fdec(R[i]); G[i] = fdec(G[i]); B[i] = fdec(B[i]); }
  for (const j of jobs) applyLocal(R, G, B, w, h, j.alpha, j.adjust, ctx);
  for (let i = 0; i < N; i++) { R[i] = fenc(R[i]); G[i] = fenc(G[i]); B[i] = fenc(B[i]); }
}
