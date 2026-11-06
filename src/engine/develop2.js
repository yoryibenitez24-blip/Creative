// Develop, part 2: the remaining Lightroom-style edit tools for the Camera Raw / Develop pipeline —
// Point Color, Geometry (Upright + manual transform), Crop & Straighten, and Remove / Heal / Clone
// spots. Original implementation; pure JS (no DOM), runs in Node and in Web Workers.
//
// Resolution independence: every stored parameter is normalised, so the same settings give the
// same picture on a down-scaled proxy and at full resolution:
//   * "fraction" coordinates: x / width, y / height in 0..1 (crop rects, guides, lines, spot paths,
//     spot source offsets);
//   * "centred" coordinates (homographies): ((x − w/2) / L, (y − h/2) / L) with L = max(w, h), so
//     rotations stay rotations on non-square images;
//   * sizes as fractions of the long side (spot brush size, sample radius).
// Pixel buffers are straight-alpha RGBA8 { w, h, data: Uint8ClampedArray }.

import { rgbToHsl, hslToRgb } from './color.js';
import { resample } from './geometry.js';
import { contentAwareFill } from './inpaint.js';

const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
const smoothstep = t => { t = clamp01(t); return t * t * (3 - 2 * t); };
const LIN = new Float32Array(256); for (let i = 0; i < 256; i++) { const c = i / 255; LIN[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
const enc = l => l <= 0 ? 0 : l >= 1 ? 1 : l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055;
const dec = e => e <= 0 ? 0 : e <= 0.04045 ? e / 12.92 : ((e + 0.055) / 1.055) ** 2.4;
const copyBuf = b => ({ w: b.w, h: b.h, data: new Uint8ClampedArray(b.data) });

// =====================================================================================
// 1. Point Color
// =====================================================================================

/** A swatch with neutral adjustments for a sampled target colour (hue 0..360, sat/lum 0..1, HSL). */
export const pointColorSwatch = (hue = 0, sat = 0.5, lum = 0.5) => ({ hue, sat, lum, hueShift: 0, satShift: 0, lumShift: 0, variance: 0, range: { hue: 50, sat: 50, lum: 50 } });
export const POINT_COLOR_DEFAULTS = Object.freeze({ swatches: [] });

const swatchActive = s => s && (s.hueShift || s.satShift || s.lumShift || s.variance);
const falloff = t => t <= 0.35 ? 1 : t >= 1 ? 0 : smoothstep((1 - t) / 0.65);

/**
 * Selection weight (0..1) of an HSL colour (h deg, s, l in 0..1) for a swatch. Smooth separable
 * falloff in hue (circular), saturation and luminance; the Range sliders widen each window
 * (range 0 → tight, 50 → default, 100 → very wide). Hue is ignored for near-grey colours.
 */
export function pointColorWeight(sw, h, s, l) {
  const r = sw.range || {};
  const hw = 6 + (r.hue ?? 50) * 1.0;                     // degrees (50 → 56°)
  const sWid = 0.06 + (r.sat ?? 50) / 100 * 0.9, lWid = 0.06 + (r.lum ?? 50) / 100 * 0.9;
  let dh = Math.abs(h - sw.hue) % 360; if (dh > 180) dh = 360 - dh;
  const hueTrust = clamp01(Math.min(s, sw.sat) / 0.1);    // how meaningful hue is for this pair
  const wh = 1 - hueTrust + hueTrust * falloff(dh / hw);
  return wh * falloff(Math.abs(s - sw.sat) / sWid) * falloff(Math.abs(l - sw.lum) / lWid);
}

/**
 * Point Color on float planes (in place). R, G, B: Float32Array(w*h). By default the planes are
 * linear light (as in develop.js before its encode step); pass { encoded: true } when they are
 * already sRGB-encoded 0..1 (develop.js's colour stage). Returns true if anything changed.
 *   pc = { swatches: [{ hue, sat, lum, hueShift, satShift, lumShift (−100..100), variance 0..100,
 *          range: { hue, sat, lum } (0..100) }] }
 * Hue shift ±100 → ±30°; Saturation/Luminance shift scale towards 0 or 1; Variance pulls the
 * selected colours' hue and saturation towards the swatch (100 = uniform colour).
 */
export function pointColor(R, G, B, w, h, pc, { encoded = false } = {}) {
  const sws = (pc?.swatches || []).filter(swatchActive);
  if (!sws.length) return false;
  const N = w * h, wt = new Float32Array(sws.length);
  for (let i = 0; i < N; i++) {
    let r = R[i], g = G[i], b = B[i];
    if (!encoded) { r = enc(r); g = enc(g); b = enc(b); }
    const [h0, s0, l0] = rgbToHsl(clamp01(r) * 255, clamp01(g) * 255, clamp01(b) * 255);
    let any = false;
    for (let k = 0; k < sws.length; k++) { wt[k] = pointColorWeight(sws[k], h0, s0, l0); if (wt[k] > 1e-4) any = true; }
    if (!any) continue;
    let hh = h0, ss = s0, ll = l0;
    for (let k = 0; k < sws.length; k++) {
      const wk = wt[k]; if (wk <= 1e-4) continue;
      const sw = sws[k];
      if (sw.variance) {
        const v = sw.variance / 100 * wk; let dh = ((sw.hue - hh) % 360 + 540) % 360 - 180;
        hh += dh * v; ss += (sw.sat - ss) * v * 0.6;
      }
      if (sw.hueShift) hh += sw.hueShift / 100 * 30 * wk;
      if (sw.satShift) { const a = sw.satShift / 100 * wk; ss += a > 0 ? (1 - ss) * a * Math.min(1, ss * 4 + 0.15) : ss * a; }
      if (sw.lumShift) { const a = sw.lumShift / 100 * wk * 0.5; ll += a > 0 ? (1 - ll) * a : ll * a; }
    }
    const [nr, ng, nb] = hslToRgb(hh, clamp01(ss), clamp01(ll));
    // keep the sub-quantisation precision of untouched channels: apply the change as a delta
    const [pr, pg, pb] = hslToRgb(h0, s0, l0);
    r = r + (nr - pr) / 255; g = g + (ng - pg) / 255; b = b + (nb - pb) / 255;
    if (!encoded) { r = dec(r); g = dec(g); b = dec(b); }
    R[i] = r; G[i] = g; B[i] = b;
  }
  return true;
}

/** Point Color on an RGBA buffer (returns a new buffer). Op form: (buf, { pointColor }) → buf. */
export function applyPointColor(buf, pc) {
  const { w, h, data } = buf, N = w * h, R = new Float32Array(N), G = new Float32Array(N), B = new Float32Array(N);
  for (let i = 0; i < N; i++) { R[i] = data[i * 4] / 255; G[i] = data[i * 4 + 1] / 255; B[i] = data[i * 4 + 2] / 255; }
  const out = copyBuf(buf);
  if (!pointColor(R, G, B, w, h, pc, { encoded: true })) return out;
  for (let i = 0; i < N; i++) { out.data[i * 4] = Math.round(clamp01(R[i]) * 255); out.data[i * 4 + 1] = Math.round(clamp01(G[i]) * 255); out.data[i * 4 + 2] = Math.round(clamp01(B[i]) * 255); }
  return out;
}
export const pointColorOp = (buf, p = {}) => applyPointColor(buf, p.pointColor || p);

/**
 * Sample a swatch from the image: average colour in a disc at (x, y) (fractions 0..1) with
 * `radius` as a fraction of the long side. Returns pointColorSwatch(hue, sat, lum).
 */
export function samplePointColor(buf, x, y, radius = 0.01) {
  const { w, h, data } = buf, L = Math.max(w, h), r = Math.max(0.5, radius * L), cx = x * w, cy = y * h;
  let R = 0, G = 0, B = 0, n = 0;
  for (let yy = Math.max(0, Math.floor(cy - r)); yy <= Math.min(h - 1, Math.ceil(cy + r)); yy++)
    for (let xx = Math.max(0, Math.floor(cx - r)); xx <= Math.min(w - 1, Math.ceil(cx + r)); xx++) {
      if (Math.hypot(xx + 0.5 - cx, yy + 0.5 - cy) > r + 0.5) continue;
      const q = (yy * w + xx) * 4; if (!data[q + 3]) continue;
      R += LIN[data[q]]; G += LIN[data[q + 1]]; B += LIN[data[q + 2]]; n++;
    }
  if (!n) { const q = (clamp(Math.floor(cy), 0, h - 1) * w + clamp(Math.floor(cx), 0, w - 1)) * 4; R = LIN[data[q]]; G = LIN[data[q + 1]]; B = LIN[data[q + 2]]; n = 1; }
  const [hh, ss, ll] = rgbToHsl(enc(R / n) * 255, enc(G / n) * 255, enc(B / n) * 255);
  return pointColorSwatch(Math.round(hh * 10) / 10, Math.round(ss * 1000) / 1000, Math.round(ll * 1000) / 1000);
}

// =====================================================================================
// 2. Geometry: homographies, Upright, line detection, warping
// =====================================================================================

export const GEOMETRY_DEFAULTS = Object.freeze({ upright: 'off', uprightCorrection: null, vertical: 0, horizontal: 0, rotate: 0, aspect: 0, scale: 100, offsetX: 0, offsetY: 0, guides: [], constrainCrop: false });
export const UPRIGHT_MODES = ['off', 'auto', 'guided', 'level', 'vertical', 'full'];
const FOCAL = 1;               // focal length in long-side units (≈ 35 mm equivalent)
const MAX_TILT = 30;           // degrees of virtual camera tilt at Vertical/Horizontal = ±100

// ---- 3×3 matrices (row-major flat arrays) ----
export const mat3Mul = (a, b) => { const o = new Array(9); for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]; return o; };
export function mat3Inv(m) {
  const [a, b, c, d, e, f, g, h, i] = m, A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
  if (!det) throw Error('Singular matrix');
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}
export const mat3Apply = (m, x, y) => { const z = m[6] * x + m[7] * y + m[8]; return [(m[0] * x + m[1] * y + m[2]) / z, (m[3] * x + m[4] * y + m[5]) / z, z]; };
const IDENT = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const tr = (x, y) => [1, 0, x, 0, 1, y, 0, 0, 1];
const sc2 = (x, y = x) => [x, 0, 0, 0, y, 0, 0, 0, 1];

/** Pixel ↔ centred normalised coordinates for a w×h image (pixel centres at +0.5). */
export const toCentred = (px, py, w, h) => { const L = Math.max(w, h); return [(px - w / 2) / L, (py - h / 2) / L]; };
export const fromCentred = (nx, ny, w, h) => { const L = Math.max(w, h); return [nx * L + w / 2, ny * L + h / 2]; };
const fracToCentred = (fx, fy, aspect) => { const W = aspect >= 1 ? 1 : aspect, H = aspect >= 1 ? 1 / aspect : 1; return [(fx - 0.5) * W, (fy - 0.5) * H]; };

/**
 * Homography of a virtual camera rotation: roll (in-plane, + = clockwise on screen), pitch (about
 * the horizontal axis) and yaw (about the vertical axis), radians. H = K·Rz·Rx·Ry·K⁻¹, then
 * re-centred (the image centre stays put) and normalised to unit area scale at the centre.
 */
export function poseMatrix(roll, pitch, yaw) {
  const cz = Math.cos(roll), sz = Math.sin(roll), cx = Math.cos(pitch), sx = Math.sin(pitch), cy = Math.cos(yaw), sy = Math.sin(yaw);
  const Rz = [cz, -sz, 0, sz, cz, 0, 0, 0, 1], Rx = [1, 0, 0, 0, cx, -sx, 0, sx, cx], Ry = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
  let H = mat3Mul(mat3Mul(sc2(FOCAL), mat3Mul(Rz, mat3Mul(Rx, Ry))), sc2(1 / FOCAL));
  const [ox, oy] = mat3Apply(H, 0, 0); H = mat3Mul(tr(-ox, -oy), H);
  // local area scale at the centre (finite differences) → keep the subject size
  const e = 1e-4, [ax, ay] = mat3Apply(H, e, 0), [bx, by] = mat3Apply(H, 0, e), det = Math.abs(ax * by - ay * bx) / (e * e);
  return mat3Mul(sc2(1 / Math.sqrt(det || 1)), H);
}
const pitchOf = v => -v / 100 * MAX_TILT * D2R;      // Vertical < 0 widens the top (fixes converging verticals of an upward shot)
const yawOf = v => v / 100 * MAX_TILT * D2R;         // Horizontal > 0 widens the right side
const vertOfPitch = p => -p * R2D / MAX_TILT * 100, horOfYaw = y => y * R2D / MAX_TILT * 100;

/** Zoom factor ≥ 1 that makes `M` (source centred → output centred) leave no empty output corner. */
export function constrainZoom(M, w, h) {
  const L = Math.max(w, h), hx = w / 2 / L, hy = h / 2 / L, Mi = mat3Inv(M), eps = 1e-9;
  const ok = z => [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]].every(([x, y]) => { const [sx, sy, sz] = mat3Apply(Mi, x / z, y / z); return sz > 0 && Math.abs(sx) <= hx + eps && Math.abs(sy) <= hy + eps; });
  if (ok(1)) return 1;
  let lo = 1, hi = 2; while (!ok(hi) && hi < 1024) { lo = hi; hi *= 2; }
  for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (ok(m)) hi = m; else lo = m; }
  return hi;
}

/**
 * Geometry settings → 3×3 homography (row-major, 9 numbers) mapping SOURCE centred-normalised
 * coordinates to OUTPUT centred-normalised coordinates (see toCentred). w, h only give the aspect.
 * g = { upright, uprightCorrection: {rotate, vertical, horizontal} | null (from uprightSolve),
 *       vertical, horizontal (−100..100), rotate (−10..10°), aspect (−100..100), scale (50..150 %),
 *       offsetX, offsetY (−100..100, % of half the image size), constrainCrop }
 * The Upright correction (when upright !== 'off') is added to the manual sliders, like Lightroom.
 */
export function geometryMatrix(g = {}, w = 1, h = 1) {
  g = { ...GEOMETRY_DEFAULTS, ...g };
  const u = g.upright !== 'off' && g.uprightCorrection ? g.uprightCorrection : { rotate: 0, vertical: 0, horizontal: 0 };
  const L = Math.max(w, h);
  let M = poseMatrix((g.rotate + (u.rotate || 0)) * D2R, pitchOf(g.vertical + (u.vertical || 0)), yawOf(g.horizontal + (u.horizontal || 0)));
  const a = 2 ** (g.aspect / 200), s = g.scale / 100;
  M = mat3Mul(tr(g.offsetX / 100 * 0.5 * w / L, g.offsetY / 100 * 0.5 * h / L), mat3Mul(sc2(s * a, s / a), M));
  if (g.constrainCrop) M = mat3Mul(sc2(constrainZoom(M, w, h)), M);
  return M;
}
export const isGeometryIdentity = g => { const m = geometryMatrix(g, 3, 2); return m.every((v, i) => Math.abs(v - IDENT[i]) < 1e-9); };

// ---- sampling ----
function cubicW(t) { t = Math.abs(t); return t < 1 ? 1.5 * t * t * t - 2.5 * t * t + 1 : t < 2 ? -0.5 * t * t * t + 2.5 * t * t - 4 * t + 2 : 0; }
/**
 * Generic inverse-mapping resampler. map(xOut+0.5, yOut+0.5) → [xSrc, ySrc] in source pixel units
 * (continuous; the source covers [0, w] × [0, h]). Bicubic (Catmull-Rom) or bilinear on
 * premultiplied alpha with edge-clamped taps. Outside the source the result fades to transparent
 * over one source pixel (antialiased border), or stays edge-extended with edge='extend'.
 */
export function remap(buf, ow, oh, map, { interp = 'bicubic', edge = 'transparent' } = {}) {
  const { w, h, data } = buf, out = new Uint8ClampedArray(ow * oh * 4), ext = edge === 'extend';
  const rad = interp === 'bilinear' ? 1 : 2, kern = interp === 'bilinear' ? t => Math.max(0, 1 - Math.abs(t)) : cubicW;
  const wx = new Float64Array(2 * rad), wy = new Float64Array(2 * rad), xs = new Int32Array(2 * rad), ys = new Int32Array(2 * rad);
  for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
    const p = map(x + 0.5, y + 0.5); if (!p) continue;
    let cov = 1;
    if (!ext) { cov = clamp01(1 + Math.min(p[0], w - p[0], p[1], h - p[1])); if (!(cov > 0)) continue; }
    const sx = p[0] - 0.5, sy = p[1] - 0.5, x0 = Math.floor(sx), y0 = Math.floor(sy);
    for (let k = 0; k < 2 * rad; k++) { const xi = x0 - rad + 1 + k, yi = y0 - rad + 1 + k; wx[k] = kern(sx - xi); wy[k] = kern(sy - yi); xs[k] = clamp(xi, 0, w - 1); ys[k] = clamp(yi, 0, h - 1); }
    let r = 0, g = 0, b = 0, a = 0;
    for (let j = 0; j < 2 * rad; j++) {
      const wyj = wy[j]; if (!wyj) continue; const row = ys[j] * w;
      for (let i = 0; i < 2 * rad; i++) {
        const wgt = wx[i] * wyj; if (!wgt) continue;
        const q = (row + xs[i]) * 4, al = data[q + 3];
        r += data[q] * al * wgt; g += data[q + 1] * al * wgt; b += data[q + 2] * al * wgt; a += al * wgt;
      }
    }
    const o = (y * ow + x) * 4;
    if (a > 0.5) { out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a; out[o + 3] = Math.round(Math.min(255, a) * cov); }
  }
  return { w: ow, h: oh, data: out };
}

/**
 * Warp `buf` by `matrix` (from geometryMatrix: source centred → output centred) into a buffer of
 * the same size. constrainCrop: additionally zoom so no empty (transparent) corner remains.
 * Outside the source: transparent (default) or edge-extended (edge: 'extend').
 */
export function applyGeometry(buf, matrix, { constrainCrop = false, interp = 'bicubic', edge = 'transparent' } = {}) {
  const { w, h } = buf;
  let M = matrix || IDENT;
  if (M.every((v, i) => Math.abs(v - IDENT[i]) < 1e-12)) return copyBuf(buf);
  if (constrainCrop) M = mat3Mul(sc2(constrainZoom(M, w, h)), M);
  const Mi = mat3Inv(M), L = Math.max(w, h);
  return remap(buf, w, h, (x, y) => { const [sx, sy, sz] = mat3Apply(Mi, (x - w / 2) / L, (y - h / 2) / L); return sz > 0 ? [sx * L + w / 2, sy * L + h / 2] : null; }, { interp, edge });
}
/** Op form: (buf, { geometry }) → buf. */
export const geometryOp = (buf, p = {}) => { const g = p.geometry || p; return applyGeometry(buf, geometryMatrix(g, buf.w, buf.h), { constrainCrop: !!g.constrainCrop }); };

// ---- line detection (LSD-like region growing on gradient orientation) ----
/**
 * Detect straight line segments. Classical: luminance on a ≤ maxSize proxy, Sobel gradients,
 * region growing of pixels with consistent gradient orientation (seeded from the strongest
 * gradients), then a weighted principal-axis fit per region. Returns
 * [{ x0, y0, x1, y1 (fractions 0..1), length (fraction of the long side), angle (deg, −90..90,
 *    0 = horizontal, + = clockwise on screen) }], longest first.
 */
export function detectLines(buf, { maxSize = 640, minLength = 0.04, threshold = 0.09 } = {}) {
  const k = Math.min(1, maxSize / Math.max(buf.w, buf.h));
  const src = k < 1 ? resample(buf, Math.max(8, Math.round(buf.w * k)), Math.max(8, Math.round(buf.h * k)), 'bilinear') : buf;
  const { w, h, data } = src, N = w * h, Y = new Float32Array(N);
  for (let i = 0; i < N; i++) Y[i] = (0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2]) / 255 * (data[i * 4 + 3] / 255);
  // light binomial blur
  const T = new Float32Array(N), S = new Float32Array(N);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; T[i] = (Y[y * w + Math.max(0, x - 1)] + 2 * Y[i] + Y[y * w + Math.min(w - 1, x + 1)]) / 4; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; S[i] = (T[Math.max(0, y - 1) * w + x] + 2 * T[i] + T[Math.min(h - 1, y + 1) * w + x]) / 4; }
  const mag = new Float32Array(N), ang = new Float32Array(N);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x, a = S[i - w - 1], b = S[i - w], c = S[i - w + 1], d = S[i - 1], f = S[i + 1], g = S[i + w - 1], hh = S[i + w], ii = S[i + w + 1];
    const gx = (c + 2 * f + ii - a - 2 * d - g) / 8, gy = (g + 2 * hh + ii - a - 2 * b - c) / 8;
    mag[i] = Math.hypot(gx, gy) * 4; ang[i] = Math.atan2(gy, gx);
  }
  const seeds = []; for (let i = 0; i < N; i++) if (mag[i] > threshold) seeds.push(i);
  seeds.sort((p, q) => mag[q] - mag[p]);
  const used = new Uint8Array(N), tol = 22.5 * D2R, minPx = Math.max(10, minLength * Math.max(w, h)), out = [];
  const reg = [];
  for (const sd of seeds) {
    if (used[sd]) continue;
    reg.length = 0; reg.push(sd); used[sd] = 1;
    let c2 = Math.cos(2 * ang[sd]) * mag[sd], s2 = Math.sin(2 * ang[sd]) * mag[sd], ra = ang[sd];
    for (let qi = 0; qi < reg.length; qi++) {
      const p = reg[qi], px = p % w, py = (p / w) | 0;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const xx = px + i, yy = py + j; if (xx < 1 || yy < 1 || xx >= w - 1 || yy >= h - 1) continue;
        const n = yy * w + xx; if (used[n] || mag[n] <= threshold * 0.6) continue;
        let d = Math.abs(ang[n] - ra) % Math.PI; if (d > Math.PI / 2) d = Math.PI - d;
        if (d > tol) continue;
        used[n] = 2; reg.push(n); c2 += Math.cos(2 * ang[n]) * mag[n]; s2 += Math.sin(2 * ang[n]) * mag[n]; ra = Math.atan2(s2, c2) / 2;
      }
    }
    if (reg.length < minPx * 0.8) { for (const p of reg) if (used[p] === 2) used[p] = 0; continue; }
    // weighted principal axis
    let sw = 0, mx = 0, my = 0;
    for (const p of reg) { const wgt = mag[p]; sw += wgt; mx += (p % w + 0.5) * wgt; my += (((p / w) | 0) + 0.5) * wgt; }
    mx /= sw; my /= sw;
    let cxx = 0, cyy = 0, cxy = 0;
    for (const p of reg) { const wgt = mag[p], dx = p % w + 0.5 - mx, dy = ((p / w) | 0) + 0.5 - my; cxx += dx * dx * wgt; cyy += dy * dy * wgt; cxy += dx * dy * wgt; }
    const th = 0.5 * Math.atan2(2 * cxy, cxx - cyy), ux = Math.cos(th), uy = Math.sin(th);
    let lo = Infinity, hi = -Infinity, wlo = Infinity, whi = -Infinity;
    for (const p of reg) { const dx = p % w + 0.5 - mx, dy = ((p / w) | 0) + 0.5 - my, t = dx * ux + dy * uy, n = -dx * uy + dy * ux; if (t < lo) lo = t; if (t > hi) hi = t; if (n < wlo) wlo = n; if (n > whi) whi = n; }
    const len = hi - lo, wid = whi - wlo;
    // the fitted direction must be the level-line direction (perpendicular to the gradient)
    const perp = Math.abs(Math.cos(th - (ra + Math.PI / 2)));
    if (len < minPx || wid > Math.max(4, len * 0.12) || perp < 0.97) { for (const p of reg) if (used[p] === 2) used[p] = 0; continue; }
    for (const p of reg) used[p] = 1;
    const x0 = mx + ux * lo, y0 = my + uy * lo, x1 = mx + ux * hi, y1 = my + uy * hi;
    let a = Math.atan2(y1 - y0, x1 - x0) * R2D; if (a > 90) a -= 180; if (a <= -90) a += 180;
    out.push({ x0: x0 / w, y0: y0 / h, x1: x1 / w, y1: y1 / h, length: len / Math.max(w, h), angle: a });
  }
  return out.sort((a, b) => b.length - a.length);
}

// ---- Upright solver ----
const lineAngle = (l, aspect) => { const W = aspect >= 1 ? 1 : aspect, H = aspect >= 1 ? 1 / aspect : 1; let a = Math.atan2((l.y1 - l.y0) * H, (l.x1 - l.x0) * W) * R2D; if (a > 90) a -= 180; if (a <= -90) a += 180; return a; };
const asLine = g => Array.isArray(g) ? { x0: g[0], y0: g[1], x1: g[2], y1: g[3] } : g;

/** Small Levenberg–Marquardt solver (numeric Jacobian). res(p) → residual array. */
function levmar(res, p0, iters = 40) {
  let p = p0.slice(), r = res(p), cost = r.reduce((s, v) => s + v * v, 0), lam = 1e-3;
  const n = p.length;
  for (let it = 0; it < iters; it++) {
    const J = []; for (let k = 0; k < n; k++) { const q = p.slice(); q[k] += 1e-6; const rq = res(q); J.push(rq.map((v, i) => (v - r[i]) / 1e-6)); }
    const A = Array.from({ length: n }, (_, a) => Array.from({ length: n }, (_, b) => J[a].reduce((s, v, i) => s + v * J[b][i], 0))), gv = J.map(col => col.reduce((s, v, i) => s + v * r[i], 0));
    let improved = false;
    for (let tries = 0; tries < 8; tries++) {
      const M = A.map((row, a) => row.map((v, b) => v + (a === b ? lam * (v + 1e-9) : 0)));
      const step = solveLin(M, gv.map(v => -v)); if (!step) { lam *= 10; continue; }
      const q = p.map((v, k) => v + step[k]), rq = res(q), cq = rq.reduce((s, v) => s + v * v, 0);
      if (cq < cost) { p = q; r = rq; const done = cost - cq < 1e-14; cost = cq; lam = Math.max(1e-9, lam / 5); improved = true; if (done) it = iters; break; }
      lam *= 10;
    }
    if (!improved) break;
  }
  return p;
}
function solveLin(A, b) {
  const n = b.length, M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-15) return null; [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/**
 * Upright: solve the perspective correction from line segments (fractions, e.g. detectLines or
 * user guides) for `mode`:
 *   'level'    roll only, from near-horizontal lines (near-vertical ones if there are none);
 *   'vertical' roll + vertical keystone (pitch) — verticals parallel, horizon level;
 *   'full'     roll + vertical + horizontal keystone;
 *   'auto'     like full but regularised towards small corrections (balanced, natural look);
 *   'guided'   from 1–4 user-drawn guides (each becomes exactly vertical or horizontal,
 *              whichever it is closer to); the parameters solved depend on how many there are.
 * aspect = image width / height. Returns { rotate (deg), vertical, horizontal (slider units) } to
 * store as geometry.uprightCorrection; all zero for 'off' or when nothing usable was found.
 */
export function uprightSolve(lines, mode, aspect = 1) {
  const zero = { rotate: 0, vertical: 0, horizontal: 0 };
  if (!lines || mode === 'off') return zero;
  const L = lines.map(asLine).filter(l => l && Number.isFinite(l.x0) && (l.x0 !== l.x1 || l.y0 !== l.y1));
  const items = L.map(l => {
    const a = lineAngle(l, aspect), [x0, y0] = fracToCentred(l.x0, l.y0, aspect), [x1, y1] = fracToCentred(l.x1, l.y1, aspect);
    return { a, x0, y0, x1, y1, len: Math.hypot(x1 - x0, y1 - y0) };
  });
  let V, Hz, params;
  if (mode === 'guided') {
    V = items.filter(l => Math.abs(l.a) >= 45).map(l => ({ ...l, wt: 1 })); Hz = items.filter(l => Math.abs(l.a) < 45).map(l => ({ ...l, wt: 1 }));
    const n = V.length + Hz.length; if (!n) return zero;
    params = ['roll']; if (V.length >= 2 || (V.length && n >= 3)) params.push('pitch'); if (Hz.length >= 2 || (Hz.length && n >= 3)) params.push('yaw');
  } else {
    V = items.filter(l => Math.abs(l.a) > 60).map(l => ({ ...l, wt: l.len })); Hz = items.filter(l => Math.abs(l.a) < 30).map(l => ({ ...l, wt: l.len }));
    if (mode === 'level') { if (Hz.length) V = []; params = ['roll']; }
    else if (mode === 'vertical') { params = V.length >= 2 ? ['roll', 'pitch'] : ['roll']; Hz.forEach(l => { l.wt *= 0.5; }); }
    else { params = ['roll']; if (V.length >= 2) params.push('pitch'); if (Hz.length >= 2) params.push('yaw'); }
  }
  if (!V.length && !Hz.length) return zero;
  const totW = [...V, ...Hz].reduce((s, l) => s + l.wt, 0) || 1;
  const reg = mode === 'auto' ? 0.1 : mode === 'guided' ? 1e-4 : 0.02;
  const pose = p => { const o = { roll: 0, pitch: 0, yaw: 0 }; params.forEach((k, i) => { o[k] = p[i]; }); return poseMatrix(o.roll, o.pitch, o.yaw); };
  const dev = (H, l, vert) => { const [ax, ay] = mat3Apply(H, l.x0, l.y0), [bx, by] = mat3Apply(H, l.x1, l.y1); const dx = bx - ax, dy = by - ay; return vert ? Math.atan(dx / (dy || 1e-12)) : Math.atan(dy / (dx || 1e-12)); };
  let useV = V, useH = Hz;
  const residuals = p => { const H = pose(p), r = []; for (const l of useV) r.push(Math.sqrt(l.wt / totW) * dev(H, l, true)); for (const l of useH) r.push(Math.sqrt(l.wt / totW) * dev(H, l, false)); params.forEach((k, i) => { if (k !== 'roll') r.push(reg * p[i]); }); return r; };
  // initial roll from the weighted median line tilt
  const tilts = [...Hz.map(l => [-l.a, l.wt]), ...V.map(l => [-(l.a > 0 ? l.a - 90 : l.a + 90), l.wt])].sort((a, b) => a[0] - b[0]);
  let acc = 0, med = 0; const half = tilts.reduce((s, t) => s + t[1], 0) / 2; for (const [t, wt] of tilts) { acc += wt; if (acc >= half) { med = t; break; } }
  let p = levmar(residuals, params.map(k => k === 'roll' ? med * D2R : 0));
  if (mode !== 'guided') {
    // robust second pass: drop lines that disagree with the first solution
    const H = pose(p), keep = (arr, vert) => arr.filter(l => Math.abs(dev(H, l, vert)) < 3 * D2R);
    const v2 = keep(V, true), h2 = keep(Hz, false);
    if (v2.length + h2.length >= 1 && (v2.length !== V.length || h2.length !== Hz.length)) { useV = v2; useH = h2; p = levmar(residuals, p); }
  }
  const o = { roll: 0, pitch: 0, yaw: 0 }; params.forEach((k, i) => { o[k] = p[i]; });
  const lim = mode === 'auto' ? 60 : 200;
  return { rotate: clamp(o.roll * R2D, -45, 45), vertical: clamp(vertOfPitch(o.pitch), -lim, lim), horizontal: clamp(horOfYaw(o.yaw), -lim, lim) };
}

/** Convenience: detectLines + uprightSolve for an image (guides used in 'guided' mode). */
export function uprightFor(buf, mode, guides = []) {
  if (mode === 'off') return { rotate: 0, vertical: 0, horizontal: 0 };
  return uprightSolve(mode === 'guided' ? guides : detectLines(buf), mode, buf.w / buf.h);
}

/** Map line segments (fractions) through a geometry matrix (source → output); for overlays/tests. */
export function transformLines(lines, M, w, h) {
  return lines.map(asLine).map(l => {
    const p = [[l.x0, l.y0], [l.x1, l.y1]].map(([fx, fy]) => { const [nx, ny] = toCentred(fx * w, fy * h, w, h), [ox, oy] = mat3Apply(M, nx, ny), [px, py] = fromCentred(ox, oy, w, h); return [px / w, py / h]; });
    const o = { x0: p[0][0], y0: p[0][1], x1: p[1][0], y1: p[1][1] }; o.angle = lineAngle(o, w / h); return o;
  });
}

// =====================================================================================
// 3. Crop & Straighten
// =====================================================================================

export const CROP_DEFAULTS = Object.freeze({ x: 0, y: 0, w: 1, h: 1, angle: 0, flipH: false, flipV: false, rotate90: 0, aspect: 'original', lockAspect: true, aspectSwap: false });
/** Aspect presets. ratio: number (w/h), 'image' (the photo's own ratio) or null (free). */
export const ASPECT_PRESETS = [
  { id: 'original', label: 'Original', ratio: 'image' }, { id: 'asShot', label: 'As Shot', ratio: 'image' },
  { id: '1:1', label: '1 : 1', ratio: 1 }, { id: '4:5', label: '4 : 5', ratio: 4 / 5 }, { id: '5:7', label: '5 : 7', ratio: 5 / 7 },
  { id: '2:3', label: '2 : 3', ratio: 2 / 3 }, { id: '3:4', label: '3 : 4', ratio: 3 / 4 }, { id: '16:9', label: '16 : 9', ratio: 16 / 9 },
  { id: '9:16', label: '9 : 16', ratio: 9 / 16 }, { id: 'custom', label: 'Custom', ratio: null },
];
/** Pixel aspect ratio (w/h) the crop box is locked to, or null when free. */
export function cropAspectRatio(crop, W, H, presets = ASPECT_PRESETS) {
  const c = { ...CROP_DEFAULTS, ...crop }; if (!c.lockAspect) return null;
  const p = presets.find(q => q.id === c.aspect); if (!p || p.ratio == null) return null;
  const r = p.ratio === 'image' ? W / H : p.ratio; return c.aspectSwap ? 1 / r : r;
}
export const isCropIdentity = crop => { const c = { ...CROP_DEFAULTS, ...crop }; return !c.x && !c.y && c.w === 1 && c.h === 1 && !c.angle && !c.flipH && !c.flipV && !(c.rotate90 & 3); };

const rotAbout = (deg, cx, cy) => { const a = deg * D2R, c = Math.cos(a), s = Math.sin(a); return mat3Mul(tr(cx, cy), mat3Mul([c, -s, 0, s, c, 0, 0, 0, 1], tr(-cx, -cy))); };

/**
 * Crop settings → pixel geometry for a W×H source. The source is first straightened (rotated by
 * `angle` degrees, + = clockwise, about the image centre); x, y, w, h are fractions of W, H in that
 * straightened frame. The cropped picture is then flipped (flipH/flipV) and finally turned by
 * rotate90 quarter turns clockwise. Returns { x, y, w, h (px, straightened frame), outW, outH,
 * corners (the crop box's 4 corners in source pixels, TL TR BR BL), matrix (3×3: output pixel →
 * source pixel) }.
 */
export function cropSettingsToRect(crop, W, H) {
  const c = { ...CROP_DEFAULTS, ...crop }, k = ((c.rotate90 | 0) % 4 + 4) % 4;
  const X = c.x * W, Y = c.y * H, CW = c.w * W, CH = c.h * H, cw = Math.max(1, Math.round(CW)), ch = Math.max(1, Math.round(CH));
  const outW = k & 1 ? ch : cw, outH = k & 1 ? cw : ch;
  // final → pre-rotation (u, v)
  const R90 = [IDENT, [0, 1, 0, -1, 0, ch, 0, 0, 1], [-1, 0, cw, 0, -1, ch, 0, 0, 1], [0, -1, cw, 1, 0, 0, 0, 0, 1]][k];
  const F = [c.flipH ? -1 : 1, 0, c.flipH ? cw : 0, 0, c.flipV ? -1 : 1, c.flipV ? ch : 0, 0, 0, 1];
  const toQ = [CW / cw, 0, X, 0, CH / ch, Y, 0, 0, 1];         // pre-flip pixel → straightened frame
  const toSrc = rotAbout(-c.angle, W / 2, H / 2);              // straightened frame → source
  const matrix = mat3Mul(toSrc, mat3Mul(toQ, mat3Mul(F, R90)));
  const corners = [[X, Y], [X + CW, Y], [X + CW, Y + CH], [X, Y + CH]].map(([x, y]) => mat3Apply(toSrc, x, y).slice(0, 2));
  return { x: X, y: Y, w: CW, h: CH, outW, outH, corners, matrix };
}

/** Crop (with straighten, flips and quarter turns) → a new buffer of the cropped size. */
export function applyCrop(buf, crop, { interp = 'bicubic' } = {}) {
  if (isCropIdentity(crop)) return copyBuf(buf);
  const r = cropSettingsToRect(crop, buf.w, buf.h), m = r.matrix;
  return remap(buf, r.outW, r.outH, (x, y) => mat3Apply(m, x, y), { interp, edge: 'transparent' });
}
export const cropOp = (buf, p = {}) => applyCrop(buf, p.crop || p);

/** True when the crop box lies inside the (straightened) source image. */
export function cropInside(crop, W, H, eps = 1e-6) { return cropSettingsToRect(crop, W, H).corners.every(([x, y]) => x >= -eps * W && y >= -eps * H && x <= W * (1 + eps) && y <= H * (1 + eps)); }

/** Shrink the crop about its centre (keeping its aspect) until it lies inside the straightened image. */
export function fitCropToAngle(crop, W, H) {
  const c = { ...CROP_DEFAULTS, ...crop };
  // first pull the centre inside the image's straightened footprint
  if (cropInside(c, W, H)) return c;
  const cx = c.x + c.w / 2, cy = c.y + c.h / 2;
  const at = s => ({ ...c, x: cx - c.w * s / 2, y: cy - c.h * s / 2, w: c.w * s, h: c.h * s });
  let lo = 0, hi = 1;
  if (!cropInside(at(1e-4), W, H)) { // centre outside: move it towards the image centre first
    let t0 = 0, t1 = 1; const mv = t => ({ ...c, x: c.x + (0.5 - cx) * t, y: c.y + (0.5 - cy) * t });
    for (let i = 0; i < 30; i++) { const m = (t0 + t1) / 2; const cc = mv(m), q = { ...cc, x: cc.x + cc.w / 2 - 5e-5, y: cc.y + cc.h / 2 - 5e-5, w: 1e-4, h: 1e-4 }; if (cropInside(q, W, H)) t1 = m; else t0 = m; }
    return fitCropToAngle(mv(t1), W, H);
  }
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (cropInside(at(m), W, H)) lo = m; else hi = m; }
  return at(lo);
}

/** Largest crop of pixel ratio `ratio` (w/h; null keeps the box) centred on the current box, inside the image. */
export function applyAspectToCrop(crop, ratio, W, H) {
  const c = { ...CROP_DEFAULTS, ...crop };
  if (!ratio) return fitCropToAngle(c, W, H);
  const cx = (c.x + c.w / 2) * W, cy = (c.y + c.h / 2) * H;
  let pw = W, ph = W / ratio; if (ph > H) { ph = H; pw = H * ratio; }
  let n = { ...c, w: pw / W, h: ph / H, x: cx / W - pw / W / 2, y: cy / H - ph / H / 2 };
  n.x = clamp(n.x, 0, 1 - n.w); n.y = clamp(n.y, 0, 1 - n.h);
  return fitCropToAngle(n, W, H);
}

/** Straighten angle (deg, for crop.angle) that levels the image, from detected lines. */
export function autoStraightenAngle(buf) {
  const r = uprightSolve(detectLines(buf), 'level', buf.w / buf.h).rotate;
  return Math.round(clamp(r, -45, 45) * 100) / 100;
}

// =====================================================================================
// 4. Remove / Heal / Clone spots
// =====================================================================================

export const SPOT_DEFAULTS = Object.freeze({ mode: 'heal', points: [], size: 0.03, feather: 50, opacity: 100, source: null });

/** Pixel geometry of a spot's brush path: { pts (px), r (px), x0, y0, x1, y1 (bbox incl.) }. */
function spotGeom(spot, W, H) {
  const L = Math.max(W, H), r = Math.max(1, (spot.size ?? SPOT_DEFAULTS.size) * L / 2), pts = [];
  const P = spot.points || []; for (let i = 0; i + 1 < P.length; i += 2) pts.push(P[i] * W, P[i + 1] * H);
  if (!pts.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < pts.length; i += 2) { x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]); y0 = Math.min(y0, pts[i + 1]); y1 = Math.max(y1, pts[i + 1]); }
  return { pts, r, x0: Math.floor(x0 - r - 1), y0: Math.floor(y0 - r - 1), x1: Math.ceil(x1 + r + 1), y1: Math.ceil(y1 + r + 1) };
}
function distToPath(px, py, pts) {
  let best = Infinity;
  if (pts.length === 2) return Math.hypot(px - pts[0], py - pts[1]);
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const ax = pts[i], ay = pts[i + 1], bx = pts[i + 2], by = pts[i + 3], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 0, d = Math.hypot(px - ax - t * dx, py - ay - t * dy);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Full-size masks of a spot: { hard: Uint8Array(W*H) (255 inside the brush), soft: Float32Array
 * (feathered coverage 0..1), bbox }. Exported for overlays / the lead's visualisation.
 */
export function spotMask(spot, W, H) {
  const m = localSpotMask(spot, W, H), hard = new Uint8Array(W * H), soft = new Float32Array(W * H);
  if (!m) return { hard, soft, bbox: null };
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) { const i = (m.y + y) * W + m.x + x, k = y * m.w + x; hard[i] = m.hard[k]; soft[i] = m.soft[k]; }
  return { hard, soft, bbox: { x: m.x, y: m.y, w: m.w, h: m.h } };
}
/** Spot masks restricted to the brush's bounding box: { x, y, w, h, hard, soft, at(X, Y) → hard }. */
function localSpotMask(spot, W, H) {
  const g = spotGeom(spot, W, H); if (!g) return null;
  const x = Math.max(0, g.x0), y = Math.max(0, g.y0), w = Math.min(W, g.x1) - x, h = Math.min(H, g.y1) - y;
  if (w <= 0 || h <= 0) return null;
  const hard = new Uint8Array(w * h), soft = new Float32Array(w * h), rin = g.r * (1 - clamp(spot.feather ?? SPOT_DEFAULTS.feather, 0, 100) / 100);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const d = distToPath(x + i + 0.5, y + j + 0.5, g.pts), k = j * w + i;
    if (d < g.r + 0.5) hard[k] = 255;
    soft[k] = d <= rin ? 1 : d >= g.r ? 0 : smoothstep((g.r - d) / (g.r - rin));
  }
  return { x, y, w, h, hard, soft, g, at: (X, Y) => X >= x && Y >= y && X < x + w && Y < y + h ? hard[(Y - y) * w + X - x] : 0 };
}

/**
 * Auto source for a spot: search offsets on rings around the masked area (mask: Uint8Array(w*h),
 * > 127 = spot) for the one whose surrounding band best matches the spot's own surroundings, and
 * whose area does not overlap the spot. Returns { dx, dy } as fractions of w, h (source = spot +
 * offset), or null if no candidate fits inside the image.
 */
export function findSpotSource(buf, mask) {
  const { w, h } = buf; let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x] > 127) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  return findSourceIn(buf, (x, y) => mask[y * w + x], x0, y0, x1, y1);
}
function findSourceIn(buf, at, x0, y0, x1, y1) {
  const { w, h, data } = buf;
  const size = Math.max(x1 - x0, y1 - y0) + 1, bw = Math.max(2, Math.round(size * 0.12)), band = [], inside = [];
  for (let y = Math.max(0, y0 - bw); y <= Math.min(h - 1, y1 + bw); y++) for (let x = Math.max(0, x0 - bw); x <= Math.min(w - 1, x1 + bw); x++) {
    if (at(x, y) > 127) { inside.push(x, y); continue; }
    let near = false; for (let j = -bw; j <= bw && !near; j += Math.max(1, bw >> 1)) for (let i = -bw; i <= bw; i += Math.max(1, bw >> 1)) { const xx = x + i, yy = y + j; if (xx >= 0 && yy >= 0 && xx < w && yy < h && at(xx, yy) > 127) { near = true; break; } }
    if (near) band.push(x, y);
  }
  const stride = Math.max(1, Math.ceil(band.length / 2 / 3000)) * 2, istride = Math.max(1, Math.ceil(inside.length / 2 / 600)) * 2;
  let best = null, bestCost = Infinity;
  for (const f of [1.15, 1.5, 2, 2.7, 3.6]) for (let k = 0; k < 24; k++) {
    const a = k / 24 * 2 * Math.PI, ox = Math.round(Math.cos(a) * size * f), oy = Math.round(Math.sin(a) * size * f);
    if (x0 - bw + ox < 0 || y0 - bw + oy < 0 || x1 + bw + ox >= w || y1 + bw + oy >= h) continue;
    let overlap = false; for (let i = 0; i < inside.length; i += istride) { if (at(inside[i] + ox, inside[i + 1] + oy) > 127) { overlap = true; break; } }
    if (overlap) continue;
    let cost = 0, n = 0;
    for (let i = 0; i < band.length; i += stride) { const p = (band[i + 1] * w + band[i]) * 4, q = ((band[i + 1] + oy) * w + band[i] + ox) * 4; cost += (data[p] - data[q]) ** 2 + (data[p + 1] - data[q + 1]) ** 2 + (data[p + 2] - data[q + 2]) ** 2; n++; }
    cost = cost / Math.max(1, n) * (1 + 0.02 * f);
    if (cost < bestCost) { bestCost = cost; best = { dx: ox / w, dy: oy / h }; }
  }
  return best;
}

/** Bilinear RGB sample (edge-clamped) of an RGBA8 buffer into out[0..2]. */
function sampleRGB(data, w, h, x, y, out) {
  x -= 0.5; y -= 0.5; x = clamp(x, 0, w - 1); y = clamp(y, 0, h - 1);
  const xa = Math.floor(x), ya = Math.floor(y), xb = Math.min(w - 1, xa + 1), yb = Math.min(h - 1, ya + 1), fx = x - xa, fy = y - ya;
  for (let c = 0; c < 3; c++) out[c] = (data[(ya * w + xa) * 4 + c] * (1 - fx) + data[(ya * w + xb) * 4 + c] * fx) * (1 - fy) + (data[(yb * w + xa) * 4 + c] * (1 - fx) + data[(yb * w + xb) * 4 + c] * fx) * fy;
  return out;
}

/**
 * Membrane (Laplace) interpolation inside `region` (Uint8Array bw*bh, 1 = unknown) of the values
 * given on the other pixels of D (Float32Array bw*bh*3). Coarse-to-fine SOR, so large regions
 * converge quickly. Mutates D.
 */
function membrane(D, region, bw, bh) {
  if (bw > 24 && bh > 24) {
    const cw = Math.ceil(bw / 2), ch = Math.ceil(bh / 2), cD = new Float32Array(cw * ch * 3), cR = new Uint8Array(cw * ch);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      let n = 0, unk = 0; const s = [0, 0, 0];
      for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) { const xx = Math.min(bw - 1, 2 * x + i), yy = Math.min(bh - 1, 2 * y + j), q = yy * bw + xx; if (region[q]) { unk++; continue; } s[0] += D[q * 3]; s[1] += D[q * 3 + 1]; s[2] += D[q * 3 + 2]; n++; }
      const k = y * cw + x; if (unk === 4 || !n) cR[k] = 1; else { cD[k * 3] = s[0] / n; cD[k * 3 + 1] = s[1] / n; cD[k * 3 + 2] = s[2] / n; }
    }
    membrane(cD, cR, cw, ch);
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) { const q = y * bw + x; if (!region[q]) continue; const k = Math.min(ch - 1, y >> 1) * cw + Math.min(cw - 1, x >> 1); D[q * 3] = cD[k * 3]; D[q * 3 + 1] = cD[k * 3 + 1]; D[q * 3 + 2] = cD[k * 3 + 2]; }
  }
  const idx = []; for (let q = 0; q < bw * bh; q++) if (region[q]) idx.push(q);
  const its = bw > 24 && bh > 24 ? 40 : 200;
  for (let it = 0; it < its; it++) for (const q of idx) {
    const x = q % bw, y = (q / bw) | 0, nb = [];
    if (x > 0) nb.push(q - 1); if (x < bw - 1) nb.push(q + 1); if (y > 0) nb.push(q - bw); if (y < bh - 1) nb.push(q + bw);
    for (let c = 0; c < 3; c++) { let s = 0; for (const n of nb) s += D[n * 3 + c]; D[q * 3 + c] += 1.85 * (s / nb.length - D[q * 3 + c]); }
  }
}

/**
 * Smooth base of an RGBA buffer ignoring `hole` pixels (normalised box blur, 3 passes), then
 * membrane-interpolated across the hole. Returns Float32Array(w*h*3).
 */
function smoothBase(buf, hole, r) {
  const { w, h, data } = buf, N = w * h, acc = new Float32Array(N * 4);
  for (let q = 0; q < N; q++) if (!hole[q]) { acc[q * 4] = data[q * 4]; acc[q * 4 + 1] = data[q * 4 + 1]; acc[q * 4 + 2] = data[q * 4 + 2]; acc[q * 4 + 3] = 1; }
  const pass = (src, horiz) => {
    const out = new Float32Array(N * 4), n = horiz ? w : h, lines = horiz ? h : w;
    for (let l = 0; l < lines; l++) {
      const at = k => (horiz ? l * w + k : k * w + l) * 4, s = [0, 0, 0, 0];
      for (let k = -r; k <= r; k++) if (k >= 0 && k < n) for (let c = 0; c < 4; c++) s[c] += src[at(k) + c];
      for (let k = 0; k < n; k++) {
        const o = at(k); for (let c = 0; c < 4; c++) out[o + c] = s[c];
        const add = k + r + 1, sub = k - r; if (add < n) for (let c = 0; c < 4; c++) s[c] += src[at(add) + c]; if (sub >= 0) for (let c = 0; c < 4; c++) s[c] -= src[at(sub) + c];
      }
    }
    return out;
  };
  let a = acc; for (let i = 0; i < 3; i++) a = pass(pass(a, true), false);
  const out = new Float32Array(N * 3), unknown = new Uint8Array(N);
  for (let q = 0; q < N; q++) { if (hole[q] || a[q * 4 + 3] < 1e-6) { unknown[q] = 1; continue; } for (let c = 0; c < 3; c++) out[q * 3 + c] = a[q * 4 + c] / a[q * 4 + 3]; }
  membrane(out, unknown, w, h);
  return out;
}

/**
 * Apply Remove / Heal / Clone spots in order (each sees the result of the previous ones).
 *   spots: [{ mode: 'remove'|'heal'|'clone', points: [x, y, …] (fractions; one point = round spot),
 *             size (brush diameter, fraction of the long side), feather 0..100, opacity 0..100,
 *             source: { dx, dy } (fractions; source = spot + offset) | null (auto, findSpotSource),
 *             seed? }]
 *   'remove': content-aware fill (inpaint.js PatchMatch) of the brushed area; a given source
 *             restricts sampling to the area around it. 'heal': texture from the source, colour and
 *             lighting matched to the destination boundary (Poisson / membrane blending). 'clone':
 *             straight copy. Feather and opacity blend the result with the original.
 * Returns a new buffer; deterministic.
 */
export function applySpots(buf, spots = [], ctx = {}) {
  let out = copyBuf(buf);
  const { w: W, h: H } = buf;
  (spots || []).forEach((spot, index) => {
    const g = spotGeom(spot, W, H); if (!g) return;
    const mode = spot.mode || 'heal', op = clamp(spot.opacity ?? 100, 0, 100) / 100; if (!op) return;
    const lm = localSpotMask(spot, W, H); if (!lm) return;
    const hardAt = lm.at, softAt = (X, Y) => X >= lm.x && Y >= lm.y && X < lm.x + lm.w && Y < lm.y + lm.h ? lm.soft[(Y - lm.y) * lm.w + X - lm.x] : 0;
    let src = spot.source;
    if (!src && mode !== 'remove') src = findSourceIn(out, hardAt, lm.x, lm.y, lm.x + lm.w - 1, lm.y + lm.h - 1);
    if (!src && mode !== 'remove') return;
    const ox = src ? src.dx * W : 0, oy = src ? src.dy * H : 0;
    const d = out.data, orig = d; // each pixel is read before it is written (results are buffered in res)
    const bx0 = Math.max(0, g.x0 - 2), by0 = Math.max(0, g.y0 - 2), bx1 = Math.min(W, g.x1 + 2), by1 = Math.min(H, g.y1 + 2), bw = bx1 - bx0, bh = by1 - by0;
    if (bw <= 0 || bh <= 0) return;
    const res = new Float32Array(bw * bh * 3), tmp = [0, 0, 0];
    if (mode === 'clone' || mode === 'heal') {
      for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) { sampleRGB(orig, W, H, bx0 + x + 0.5 + ox, by0 + y + 0.5 + oy, tmp); res.set(tmp, (y * bw + x) * 3); }
      if (mode === 'heal') {
        // D = destination − source on the boundary, harmonic inside → result = source + D
        const region = new Uint8Array(bw * bh), Dm = new Float32Array(bw * bh * 3);
        for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) { const q = y * bw + x, i = (by0 + y) * W + bx0 + x; region[q] = hardAt(bx0 + x, by0 + y) ? 1 : 0; for (let c = 0; c < 3; c++) Dm[q * 3 + c] = region[q] ? 0 : orig[i * 4 + c] - res[q * 3 + c]; }
        membrane(Dm, region, bw, bh);
        for (let q = 0; q < bw * bh; q++) for (let c = 0; c < 3; c++) res[q * 3 + c] += Dm[q * 3 + c];
      }
    } else {
      // remove: PatchMatch fill on a window around the spot (and its source, if one was given)
      const m = Math.max(16, Math.round(g.r * 2.5));
      let wx0 = g.x0 - m, wy0 = g.y0 - m, wx1 = g.x1 + m, wy1 = g.y1 + m;
      if (src) { wx0 = Math.min(wx0, g.x0 + ox - m / 2); wy0 = Math.min(wy0, g.y0 + oy - m / 2); wx1 = Math.max(wx1, g.x1 + ox + m / 2); wy1 = Math.max(wy1, g.y1 + oy + m / 2); }
      wx0 = Math.max(0, Math.floor(wx0)); wy0 = Math.max(0, Math.floor(wy0)); wx1 = Math.min(W, Math.ceil(wx1)); wy1 = Math.min(H, Math.ceil(wy1));
      const ww = wx1 - wx0, wh = wy1 - wy0, sub = { w: ww, h: wh, data: new Uint8ClampedArray(ww * wh * 4) }, hole = new Uint8Array(ww * wh);
      for (let y = 0; y < wh; y++) sub.data.set(orig.subarray(((wy0 + y) * W + wx0) * 4, ((wy0 + y) * W + wx1) * 4), y * ww * 4);
      // fill a slightly dilated hole; the ring between the brush edge and the dilated edge then tells
      // how far the synthesised texture's colour is off, and a membrane removes that offset (seamless)
      const dil = Math.max(2, Math.round(g.r * 0.3)), inner = new Uint8Array(ww * wh);
      for (let y = 0; y < wh; y++) for (let x = 0; x < ww; x++) inner[y * ww + x] = hardAt(wx0 + x, wy0 + y) ? 1 : 0;
      for (let y = 0; y < wh; y++) for (let x = 0; x < ww; x++) {
        if (inner[y * ww + x]) { hole[y * ww + x] = 255; continue; }
        let near = false; for (let j = -dil; j <= dil && !near; j++) for (let i = -dil; i <= dil; i++) { const xx = x + i, yy = y + j; if (i * i + j * j <= dil * dil && xx >= 0 && yy >= 0 && xx < ww && yy < wh && inner[yy * ww + xx]) { near = true; break; } }
        if (near) hole[y * ww + x] = 255;
      }
      let sampling = null;
      if (src) { sampling = new Uint8Array(ww * wh); const scx = (g.x0 + g.x1) / 2 + ox - wx0, scy = (g.y0 + g.y1) / 2 + oy - wy0, rr = Math.max(g.x1 - g.x0, g.y1 - g.y0) * 0.9 + 4; for (let y = 0; y < wh; y++) for (let x = 0; x < ww; x++) if (Math.hypot(x + 0.5 - scx, y + 0.5 - scy) <= rr) sampling[y * ww + x] = 255; }
      // split into a smooth base (lighting, colour gradients) and a residual (texture, detail): the
      // base is interpolated across the hole as a membrane, the residual is synthesised by PatchMatch
      const base = smoothBase(sub, hole, Math.max(2, Math.round(g.r * 0.75))), resid = { w: ww, h: wh, data: new Uint8ClampedArray(sub.data) };
      for (let q = 0; q < ww * wh; q++) for (let c = 0; c < 3; c++) resid.data[q * 4 + c] = hole[q] ? 128 : sub.data[q * 4 + c] - base[q * 3 + c] + 128;
      let filled;
      try { filled = contentAwareFill(resid, hole, { source: sampling, seed: (spot.seed ?? index + 1) | 0 }); }
      catch { try { filled = contentAwareFill(resid, hole, { seed: (spot.seed ?? index + 1) | 0 }); } catch { filled = null; } }
      if (!filled) return;
      for (let q = 0; q < ww * wh; q++) for (let c = 0; c < 3; c++) filled.data[q * 4 + c] = hole[q] ? filled.data[q * 4 + c] - 128 + base[q * 3 + c] : sub.data[q * 4 + c];
      const Dm = new Float32Array(ww * wh * 3);
      for (let q = 0; q < ww * wh; q++) if (!inner[q]) for (let c = 0; c < 3; c++) Dm[q * 3 + c] = sub.data[q * 4 + c] - filled.data[q * 4 + c];
      membrane(Dm, inner, ww, wh);
      for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) { const sx = bx0 + x - wx0, sy = by0 + y - wy0, q = (y * bw + x) * 3, k = sy * ww + sx, p = k * 4; for (let c = 0; c < 3; c++) res[q + c] = inner[k] ? filled.data[p + c] + Dm[k * 3 + c] : sub.data[p + c]; }
    }
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      const i = (by0 + y) * W + bx0 + x, a = softAt(bx0 + x, by0 + y) * op; if (a <= 0) continue;
      const q = (y * bw + x) * 3; for (let c = 0; c < 3; c++) d[i * 4 + c] = Math.round(orig[i * 4 + c] + (res[q + c] - orig[i * 4 + c]) * a);
    }
  });
  return out;
}
export const spotsOp = (buf, p = {}, ctx = {}) => applySpots(buf, p.spots || [], ctx);
