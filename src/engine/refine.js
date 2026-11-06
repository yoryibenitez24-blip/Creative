// Select › Select and Mask… engine (pure JS, no DOM; runs in Node and in workers).
//
// refineMask() follows Photoshop's processing order:
//   1. Edge Detection – an "unknown" band of width `radius` around the 50 % contour of the input
//      mask (with Smart Radius the band narrows along hard image edges and stays wide along soft
//      ones), plus any area painted with the Refine Edge brush.
//   2. Matting – inside the band alpha is re-estimated from the image: a local colour model
//      (mean known-foreground / known-background colour around each pixel, alpha = projection of
//      the pixel colour on the F–B line) cleaned by guided filters (develop.js `guided`) whose guides
//      are the image luminance and the dominant chroma channel.
//   3. Global refinements – Smooth, Feather (selection.js `feather`), Contrast, Shift Edge.
// All lengths in `opts` are document pixels; `opts.scale` (default 1) converts them when the buffers
// are a down-scaled proxy (proxy px = doc px × scale).
//
// Buffers are { w, h, data: Uint8ClampedArray RGBA }; masks are Uint8Array(w*h) 0..255.

import { distanceTransform, feather as featherMask, rasterizeShape } from './selection.js';
import { guided, gauss1, boxBlur1 } from './develop.js';
import { quickSelectGrow } from './fill.js';

export const REFINE_DEFAULTS = Object.freeze({
  radius: 0, smartRadius: false, smooth: 0, feather: 0, contrast: 0, shiftEdge: 0,
  decontaminate: false, decontaminateAmount: 100,
});

export const OUTPUTS = [
  ['selection', 'Selection'], ['layerMask', 'Layer Mask'], ['newLayer', 'New Layer'],
  ['newLayerMask', 'New Layer with Layer Mask'], ['newDocument', 'New Document'],
];

const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
const toUnit = m => { const a = new Float32Array(m.length); for (let i = 0; i < m.length; i++) a[i] = m[i] / 255; return a; };

// ---------------------------------------------------------------- matting ----------
function cropChannels(image, x0, y0, cw, ch) {
  const { w, data: d } = image, n = cw * ch;
  const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const p = ((y + y0) * w + x + x0) * 4, i = y * cw + x;
    R[i] = d[p] / 255; G[i] = d[p + 1] / 255; B[i] = d[p + 2] / 255;
  }
  return [R, G, B];
}

/** Local mean of `ch` over pixels where weight `wt` > 0, box window radius r (clamped borders). */
function weightedMeans(chans, wt, cw, ch, r) {
  const n = wt.length, ws = boxBlur1(wt, cw, ch, r);
  const means = chans.map(c => { const t = new Float32Array(n); for (let i = 0; i < n; i++) t[i] = c[i] * wt[i]; return boxBlur1(t, cw, ch, r); });
  for (let i = 0; i < n; i++) if (ws[i] > 1e-6) for (const m of means) m[i] /= ws[i];
  return { ws, means };
}

/**
 * The band of pixels whose alpha is recomputed. Returns { unknown: Uint8Array(w*h) 0/1, any }.
 * Exported so the workspace can draw it for "Show Edge".
 */
export function edgeBand(image, mask, opts = {}, strokes = {}) {
  const { w, h } = image, N = w * h, k = opts.scale ?? 1, R = Math.max(0, (opts.radius || 0) * k);
  const a = mask instanceof Float32Array ? mask : toUnit(mask);
  const unknown = new Uint8Array(N), refine = strokes?.refineBrush;
  let any = false;
  if (refine) for (let i = 0; i < N; i++) if (refine[i]) { unknown[i] = 1; any = true; }
  if (R < 0.5) return { unknown, any };
  const dIn = distanceTransform(w, h, i => a[i] >= 0.5), dOut = distanceTransform(w, h, i => a[i] < 0.5);
  const edist = new Float32Array(N);
  for (let i = 0; i < N; i++) edist[i] = Math.max(0, Math.sqrt(a[i] >= 0.5 ? dOut[i] : dIn[i]) - 0.5);
  let rloc = null;
  if (opts.smartRadius) {
    // Hard edges concentrate the image gradient on the contour; soft / fuzzy edges spread it over
    // the band. Compare the mean gradient on the contour (G1) with the mean in the ring (G2).
    const L = new Float32Array(N), d = image.data;
    for (let i = 0; i < N; i++) L[i] = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255;
    const grad = new Float32Array(N);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const gx = L[y * w + Math.min(w - 1, x + 1)] - L[y * w + Math.max(0, x - 1)];
      const gy = L[Math.min(h - 1, y + 1) * w + x] - L[Math.max(0, y - 1) * w + x];
      grad[i] = Math.hypot(gx, gy) / 2;
    }
    const on = new Float32Array(N), ring = new Float32Array(N), gOn = new Float32Array(N), gRing = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      if (edist[i] <= 1) { on[i] = 1; gOn[i] = grad[i]; }
      else if (edist[i] <= R) { ring[i] = 1; gRing[i] = grad[i]; }
    }
    const s = Math.max(2, R / 2), ON = gauss1(on, w, h, s), RG = gauss1(ring, w, h, s), GO = gauss1(gOn, w, h, s), GR = gauss1(gRing, w, h, s);
    rloc = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const g1 = ON[i] > 1e-4 ? GO[i] / ON[i] : 0, g2 = RG[i] > 1e-4 ? GR[i] / RG[i] : 0;
      rloc[i] = R * Math.min(1, Math.max(0.25, 0.25 + 1.5 * g2 / (g1 + 0.02)));
    }
  }
  for (let i = 0; i < N; i++) if (edist[i] <= (rloc ? rloc[i] : R)) { unknown[i] = 1; any = true; }
  return { unknown, any };
}

function matte(image, a, opts, strokes) {
  const { w, h } = image, k = opts.scale ?? 1, R = Math.max(0, (opts.radius || 0) * k);
  const { unknown, any } = edgeBand(image, a, opts, strokes);
  if (!any) return a;
  // crop to the band plus the colour-model window
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (unknown[y * w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; }
  const rw = Math.max(3, Math.ceil(R) + 2), pad = rw * 4 + 2;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w, x1 + 1 + pad); y1 = Math.min(h, y1 + 1 + pad);
  const cw = x1 - x0, ch = y1 - y0, n = cw * ch;
  const rgb = cropChannels(image, x0, y0, cw, ch);
  const ca = new Float32Array(n), unk = new Uint8Array(n), fw = new Float32Array(n), bw = new Float32Array(n);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const i = y * cw + x, j = (y + y0) * w + x + x0;
    ca[i] = a[j]; unk[i] = unknown[j];
    if (!unk[i]) { if (a[j] >= 0.5) fw[i] = 1; else bw[i] = 1; }
  }
  // colour model: local mean foreground F and background B; a coarser window fills gaps
  const F = weightedMeans(rgb, fw, cw, ch, rw), B = weightedMeans(rgb, bw, cw, ch, rw);
  let gapF = false, gapB = false;
  for (let i = 0; i < n; i++) if (unk[i]) { if (!(F.ws[i] > 1e-6)) gapF = true; if (!(B.ws[i] > 1e-6)) gapB = true; }
  const none = { ws: new Float32Array(n), means: null };
  const F2 = gapF ? weightedMeans(rgb, fw, cw, ch, rw * 4) : none, B2 = gapB ? weightedMeans(rgb, bw, cw, ch, rw * 4) : none;
  const p = Float32Array.from(ca);
  for (let i = 0; i < n; i++) {
    if (!unk[i]) continue;
    const Fm = F.ws[i] > 1e-6 ? F.means : F2.ws[i] > 1e-6 ? F2.means : null;
    const Bm = B.ws[i] > 1e-6 ? B.means : B2.ws[i] > 1e-6 ? B2.means : null;
    if (!Fm && !Bm) continue;
    if (!Fm) { p[i] = 0; continue; }
    if (!Bm) { p[i] = 1; continue; }
    let uu = 0, uv = 0;
    for (let c = 0; c < 3; c++) { const u = Fm[c][i] - Bm[c][i], v = rgb[c][i] - Bm[c][i]; uu += u * u; uv += u * v; }
    if (uu < 0.0036) continue; // F ≈ B: colours say nothing, keep the input alpha
    p[i] = clamp01(uv / uu);
  }
  // guided-filter clean-up. Guides: luminance and the chroma channel (Cb or Cr) that varies most
  // inside the band; the two results are weighted by each guide's local variance.
  const L = new Float32Array(n), Cb = new Float32Array(n), Cr = new Float32Array(n);
  let sb = 0, sb2 = 0, sr = 0, sr2 = 0, nu = 0;
  for (let i = 0; i < n; i++) {
    const r = rgb[0][i], g = rgb[1][i], b = rgb[2][i];
    L[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b; Cb[i] = 0.5 + (b - L[i]) * 0.5; Cr[i] = 0.5 + (r - L[i]) * 0.5;
    if (unk[i]) { sb += Cb[i]; sb2 += Cb[i] * Cb[i]; sr += Cr[i]; sr2 += Cr[i] * Cr[i]; nu++; }
  }
  const C = sb2 - sb * sb / nu > sr2 - sr * sr / nu ? Cb : Cr;
  const rg = Math.max(1, Math.min(4, Math.round(R / 4) || 1)), eps = 1e-4;
  const outs = [], wts = [];
  for (const I of [L, C]) {
    outs.push(guided(I, p, cw, ch, rg, eps));
    const sq = new Float32Array(n); for (let i = 0; i < n; i++) sq[i] = I[i] * I[i];
    const m = boxBlur1(I, cw, ch, rg), m2 = boxBlur1(sq, cw, ch, rg), v = new Float32Array(n);
    for (let i = 0; i < n; i++) v[i] = Math.max(0, m2[i] - m[i] * m[i]) + 1e-6;
    wts.push(v);
  }
  const out = Float32Array.from(a);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const i = y * cw + x; if (!unk[i]) continue;
    const q = (outs[0][i] * wts[0][i] + outs[1][i] * wts[1][i]) / (wts[0][i] + wts[1][i]);
    // keep the colour-model estimate where it is decisive, use the filtered value elsewhere
    out[(y + y0) * w + x + x0] = clamp01(0.5 * q + 0.5 * p[i]);
  }
  return out;
}

// ---------------------------------------------------------------- global refinements ----------
function bilinear(a, w, h, x, y) {
  x = Math.min(w - 1, Math.max(0, x)); y = Math.min(h - 1, Math.max(0, y));
  const xi = Math.floor(x), yi = Math.floor(y), x1 = Math.min(w - 1, xi + 1), y1 = Math.min(h - 1, yi + 1), fx = x - xi, fy = y - yi;
  return (a[yi * w + xi] * (1 - fx) + a[yi * w + x1] * fx) * (1 - fy) + (a[y1 * w + xi] * (1 - fx) + a[y1 * w + x1] * fx) * fy;
}

/** Move the whole edge profile along its normal by d px (d > 0 grows the selection). */
function shiftAlpha(a, w, h, d) {
  const N = w * h, dIn = distanceTransform(w, h, i => a[i] >= 0.5), dOut = distanceTransform(w, h, i => a[i] < 0.5);
  const sd = new Float32Array(N);
  for (let i = 0; i < N; i++) sd[i] = a[i] >= 0.5 ? Math.min(1e6, Math.sqrt(dOut[i])) : -Math.min(1e6, Math.sqrt(dIn[i]));
  const out = new Float32Array(N);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    const gx = (sd[y * w + Math.min(w - 1, x + 1)] - sd[y * w + Math.max(0, x - 1)]) / 2;
    const gy = (sd[Math.min(h - 1, y + 1) * w + x] - sd[Math.max(0, y - 1) * w + x]) / 2;
    const len = Math.hypot(gx, gy);
    if (!(len > 1e-6) || Math.abs(sd[i]) > 1e5) { out[i] = a[i]; continue; }
    out[i] = bilinear(a, w, h, x + d * gx / len, y + d * gy / len);
  }
  return out;
}

/**
 * Refine a selection mask. image: {w,h,data} at the mask's size; mask: Uint8Array(w*h) 0..255.
 * opts: { radius, smartRadius, smooth, feather, contrast, shiftEdge, scale? } (see REFINE_DEFAULTS).
 * strokes: { refineBrush?: Uint8Array(w*h) } – painted Refine Edge brush area (non-zero = recompute).
 * Returns a new Uint8Array(w*h).
 */
export function refineMask(image, mask, opts = {}, strokes = {}) {
  const o = { ...REFINE_DEFAULTS, ...opts }, { w, h } = image, N = w * h, k = o.scale ?? 1;
  let a = toUnit(mask);
  a = matte(image, a, o, strokes);
  if (o.smooth > 0) {
    const s = o.smooth / 100 * 3 * k;
    if (s > 0.3) { const b = gauss1(a, w, h, s), g = 1 + s; for (let i = 0; i < N; i++) a[i] = clamp01(0.5 + (b[i] - 0.5) * g); }
  }
  if (o.feather * k > 0) featherMask(a, w, h, o.feather * k);
  if (o.contrast > 0) { const g = 1 / Math.max(0.004, 1 - o.contrast / 100); for (let i = 0; i < N; i++) a[i] = clamp01(0.5 + (a[i] - 0.5) * g); }
  if (o.shiftEdge) a = shiftAlpha(a, w, h, o.shiftEdge / 100 * Math.max(4, o.feather) * k);
  const out = new Uint8Array(N);
  for (let i = 0; i < N; i++) out[i] = Math.round(clamp01(a[i]) * 255);
  return out;
}

// ---------------------------------------------------------------- decontaminate ----------
/** Index of the nearest pixel where on(i) (exact Euclidean feature transform), -1 when none. */
export function nearestIndex(W, H, on) {
  const colY = new Int32Array(W * H).fill(-1), out = new Int32Array(W * H).fill(-1);
  for (let x = 0; x < W; x++) {
    let last = -1;
    for (let y = 0; y < H; y++) { if (on(y * W + x)) last = y; colY[y * W + x] = last; }
    last = -1;
    for (let y = H - 1; y >= 0; y--) { const i = y * W + x; if (on(i)) last = y; if (last >= 0 && (colY[i] < 0 || last - y < y - colY[i])) colY[i] = last; }
  }
  const v = new Int32Array(W), fv = new Float64Array(W), z = new Float64Array(W + 1);
  for (let y = 0; y < H; y++) {
    let k = -1;
    for (let q = 0; q < W; q++) {
      const cy = colY[y * W + q]; if (cy < 0) continue;
      const fq = (y - cy) ** 2; let s = 0;
      while (k >= 0) { s = ((fq + q * q) - (fv[k] + v[k] * v[k])) / (2 * q - 2 * v[k]); if (s <= z[k]) k--; else break; }
      if (k < 0) { k = 0; v[0] = q; fv[0] = fq; z[0] = -Infinity; z[1] = Infinity; }
      else { k++; v[k] = q; fv[k] = fq; z[k] = s; z[k + 1] = Infinity; }
    }
    if (k < 0) continue;
    let j = 0;
    for (let x = 0; x < W; x++) { while (z[j + 1] < x) j++; out[y * W + x] = colY[y * W + v[j]] * W + v[j]; }
  }
  return out;
}

/**
 * Decontaminate Colors: colours of semi-transparent edge pixels are replaced by the colours of the
 * nearest fully selected pixels (alpha ≥ 250), strength = amount% × min(1, 2·(1 − alpha)).
 * Returns a new buffer; the alpha channel of `image` is left as it is.
 */
export function decontaminateColors(image, alpha, amount = 100) {
  const { w, h, data: d } = image, N = w * h, out = new Uint8ClampedArray(d);
  const near = nearestIndex(w, h, i => alpha[i] >= 250);
  if (near[0] < 0 || !(amount > 0)) return { w, h, data: out };
  const ch = [0, 1, 2].map(c => { const t = new Float32Array(N); for (let i = 0; i < N; i++) t[i] = d[near[i] * 4 + c]; return gauss1(t, w, h, 1.5); });
  const amt = Math.min(1, amount / 100);
  for (let i = 0; i < N; i++) {
    if (alpha[i] >= 250) continue;
    const s = amt * Math.min(1, 2 * (1 - alpha[i] / 255));
    for (let c = 0; c < 3; c++) out[i * 4 + c] = d[i * 4 + c] + (ch[c][i] - d[i * 4 + c]) * s;
  }
  return { w, h, data: out };
}

// ---------------------------------------------------------------- brushes / edits ----------
function walk(pts, step, fn) {
  if (pts.length < 2) return;
  fn(pts[0], pts[1]);
  for (let i = 2; i + 1 < pts.length; i += 2) {
    const ax = pts[i - 2], ay = pts[i - 1], bx = pts[i], by = pts[i + 1], len = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(len / step));
    for (let s = 1; s <= n; s++) fn(ax + (bx - ax) * s / n, ay + (by - ay) * s / n);
  }
}

/** Paint a round anti-aliased stroke (points [x0,y0,x1,y1,…], radius r px). add: max, else min(1−cov). */
export function paintStroke(target, w, h, pts, r, add = true) {
  r = Math.max(0.5, r);
  walk(pts, Math.max(0.5, r / 4), (cx, cy) => {
    for (let y = Math.max(0, Math.floor(cy - r - 1)); y < Math.min(h, Math.ceil(cy + r + 1)); y++)
      for (let x = Math.max(0, Math.floor(cx - r - 1)); x < Math.min(w, Math.ceil(cx + r + 1)); x++) {
        const cov = clamp01(r - Math.hypot(x + 0.5 - cx, y + 0.5 - cy) + 0.5), i = y * w + x;
        if (!cov) continue;
        if (add) target[i] = Math.max(target[i], Math.round(cov * 255)); else target[i] = Math.min(target[i], Math.round((1 - cov) * 255));
      }
  });
  return target;
}
export const addBrush = (mask, w, h, pts, r) => paintStroke(mask, w, h, pts, r, true);
export const subtractBrush = (mask, w, h, pts, r) => paintStroke(mask, w, h, pts, r, false);

/** Quick Selection stroke: grows a region along the stroke (fill.js quickSelectGrow) and adds/subtracts it. */
export function quickSelectStroke(image, mask, pts, r, add = true) {
  const region = new Uint8Array(image.w * image.h);
  walk(pts, Math.max(1, r / 2), (x, y) => quickSelectGrow(image, region, x, y, r));
  for (let i = 0; i < region.length; i++) if (region[i]) mask[i] = add ? 255 : 0;
  return mask;
}

/** Freehand lasso polygon add / subtract (anti-aliased coverage). */
export function lassoStroke(mask, w, h, pts, add = true) {
  if (pts.length < 6) return mask;
  const cov = rasterizeShape({ type: 'polygon', points: pts }, w, h);
  for (let i = 0; i < mask.length; i++) { const c = cov[i]; if (!c) continue; mask[i] = add ? Math.max(mask[i], Math.round(c * 255)) : Math.min(mask[i], Math.round((1 - c) * 255)); }
  return mask;
}

/**
 * Replays workspace edits (document coordinates) on a mask at `scale` (proxy px / doc px).
 * edits: [{tool:'quick'|'brush'|'refine'|'lasso', mode:'add'|'subtract', pts:[x,y,…], r?}, {tool:'clear'}, {tool:'invert'}]
 * Returns { mask: Uint8Array, refineBrush: Uint8Array } (new arrays; inputs untouched).
 */
export function applyEdits(image, mask, edits, scale = 1, from = null) {
  const { w, h } = image;
  const m = from ? from.mask : Uint8Array.from(mask), rb = from ? from.refineBrush : new Uint8Array(w * h);
  for (const e of edits) {
    const pts = e.pts ? e.pts.map(v => v * scale) : [], r = (e.r || 1) * scale, add = e.mode !== 'subtract';
    if (e.tool === 'clear') { m.fill(0); rb.fill(0); }
    else if (e.tool === 'invert') { for (let i = 0; i < m.length; i++) m[i] = 255 - m[i]; }
    else if (e.tool === 'brush') paintStroke(m, w, h, pts, r, add);
    else if (e.tool === 'refine') paintStroke(rb, w, h, pts, r, add);
    else if (e.tool === 'lasso') lassoStroke(m, w, h, pts, add);
    else if (e.tool === 'quick') quickSelectStroke(image, m, pts, r, add);
  }
  return { mask: m, refineBrush: rb };
}

// ---------------------------------------------------------------- proxy & outputs ----------
/** Area-average downscale so the long side is ≤ maxSide. Returns { buf, mask?, scale }. */
export function makeProxy(image, mask, maxSide = 1000) {
  const { w, h } = image, k = Math.min(1, maxSide / Math.max(w, h));
  if (k >= 1) return { buf: { w, h, data: new Uint8ClampedArray(image.data) }, mask: mask && Uint8Array.from(mask), scale: 1 };
  const nw = Math.max(1, Math.round(w * k)), nh = Math.max(1, Math.round(h * k)), sx = w / nw, sy = h / nh;
  const data = new Uint8ClampedArray(nw * nh * 4), m = mask ? new Uint8Array(nw * nh) : null;
  const acc = new Float64Array(5);
  for (let y = 0; y < nh; y++) {
    const ya = y * sy, yb = ya + sy;
    for (let x = 0; x < nw; x++) {
      const xa = x * sx, xb = xa + sx; acc.fill(0); let wsum = 0;
      for (let yy = Math.floor(ya); yy < Math.min(h, Math.ceil(yb)); yy++) {
        const wy = Math.min(yb, yy + 1) - Math.max(ya, yy);
        for (let xx = Math.floor(xa); xx < Math.min(w, Math.ceil(xb)); xx++) {
          const wt = wy * (Math.min(xb, xx + 1) - Math.max(xa, xx)), p = (yy * w + xx) * 4;
          for (let c = 0; c < 4; c++) acc[c] += image.data[p + c] * wt;
          if (m) acc[4] += mask[yy * w + xx] * wt;
          wsum += wt;
        }
      }
      const o = (y * nw + x) * 4;
      for (let c = 0; c < 4; c++) data[o + c] = Math.round(acc[c] / wsum);
      if (m) m[y * nw + x] = Math.round(acc[4] / wsum);
    }
  }
  return { buf: { w: nw, h: nh, data }, mask: m, scale: nw / w };
}

/**
 * Buffers for each Output To choice (the caller performs the document operation):
 *  selection, layerMask → { mask }
 *  newLayer, newDocument → { pixels } (alpha × mask baked in; colours decontaminated if asked)
 *  newLayerMask → { pixels, mask } (pixels unmasked, decontaminated if asked)
 */
export function outputMask(image, alpha, output, { decontaminate = false, decontaminateAmount = 100 } = {}) {
  if (output === 'selection' || output === 'layerMask') return { mask: alpha };
  const src = decontaminate ? decontaminateColors(image, alpha, decontaminateAmount) : { w: image.w, h: image.h, data: new Uint8ClampedArray(image.data) };
  if (output === 'newLayerMask') return { pixels: src, mask: alpha };
  for (let i = 0; i < alpha.length; i++) src.data[i * 4 + 3] = Math.round(src.data[i * 4 + 3] * alpha[i] / 255);
  return { pixels: src };
}

/**
 * Registry op "Refine Layer Edge": refines a layer's own alpha channel as if it were the mask.
 * params = refineMask opts (+ decontaminate, decontaminateAmount, refineBrush?: Uint8Array(w*h)).
 * ctx.scale (or params.scale) = proxy scale. Signature (buf, params, ctx) → buf (RGB decontaminated if
 * asked, alpha = refined mask). The workspace uses it through the `run` prop to work off the main thread.
 */
export function refineAlphaOp(buf, params = {}, ctx = {}) {
  const N = buf.w * buf.h, m = new Uint8Array(N);
  for (let i = 0; i < N; i++) m[i] = buf.data[i * 4 + 3];
  const a = refineMask(buf, m, { ...params, scale: ctx.scale ?? params.scale ?? 1 }, { refineBrush: params.refineBrush || null });
  const out = params.decontaminate ? decontaminateColors(buf, a, params.decontaminateAmount ?? 100) : { w: buf.w, h: buf.h, data: new Uint8ClampedArray(buf.data) };
  for (let i = 0; i < N; i++) out.data[i * 4 + 3] = a[i];
  return out;
}
