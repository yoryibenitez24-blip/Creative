// Additional Photoshop-style tools built on the brush engine (raster.js) and the fill/inpaint
// engines. Everything here is pure JS (Node ≥ 20 / Web Worker, no DOM).
//
// Buffers are { w, h, data: Uint8ClampedArray } straight-alpha RGBA8. `process` callbacks follow
// raster.js: process(before, p, lx, ly, out) → out[r,g,b,a] is the per-pixel TARGET computed from
// the stroke-start pixels; the brush engine moves each pixel towards it by coverage × opacity.
// `source` callbacks follow raster.js: source(lx, ly, out) → out[r,g,b,a] painted "over".

import { regionMask } from './fill.js';
import { contentAwareFill } from './inpaint.js';
import { homography, apply3 } from './warp.js';
import { setLum, setSat, blendLum, blendSat } from './raster.js';
import { rng } from './color.js';

/** @typedef {{ w: number, h: number, data: Uint8ClampedArray }} RGBABuffer */
/** @typedef {(before: Uint8ClampedArray, p: number, lx: number, ly: number, out: number[]) => number[]} PaintProcess */
/** @typedef {(lx: number, ly: number, out: number[]) => number[]} PaintSource */

const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
const smooth = (e0, e1, x) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
const maxDiff = (b, p, c) => Math.max(Math.abs(b[p] - c[0]), Math.abs(b[p + 1] - c[1]), Math.abs(b[p + 2] - c[2]));
/** Soft tolerance weight: 1 for distance ≤ 0.5·tol, smooth fall to 0 at tol (tol 0 → exact match only). */
const tolWeight = (dist, tol) => tol <= 0 ? (dist === 0 ? 1 : 0) : dist <= tol * 0.5 ? 1 : dist >= tol ? 0 : 1 - smooth(tol * 0.5, tol, dist);
const copyBuf = buf => ({ w: buf.w, h: buf.h, data: new Uint8ClampedArray(buf.data) });

// ---------------------------------------------------------------- Color Replacement ----

/**
 * Color Replacement tool. Pixels whose colour is within `tolerance` (max channel difference) of
 * `sample` are recoloured towards `color`, keeping the pixel's own luminosity (W3C Lum):
 *   'color'      hue + saturation of `color`, luminosity of the pixel (Photoshop default)
 *   'hue'        hue of `color`, saturation + luminosity of the pixel
 *   'saturation' saturation of `color`, hue + luminosity of the pixel
 *   'luminosity' luminosity of `color`, hue + saturation of the pixel
 * The weight falls off smoothly between 0.5·tolerance and tolerance. Alpha is preserved.
 * For "Sampling: Continuous" call process.setSample(rgb) before each dab; "Once" never changes it.
 * @param {{ color: number[], mode?: 'color'|'hue'|'saturation'|'luminosity', tolerance?: number, sample: number[] }} o
 * @returns {PaintProcess & { setSample(rgb: number[]): void }}
 */
export function colorReplaceProcess({ color, mode = 'color', tolerance = 32, sample }) {
  let smp = [...(sample || color)];
  const s = [color[0] / 255, color[1] / 255, color[2] / 255], bb = [0, 0, 0];
  const proc = (b, p, lx, ly, out) => {
    const w = tolWeight(maxDiff(b, p, smp), tolerance);
    out[3] = b[p + 3];
    if (w <= 0) { out[0] = b[p]; out[1] = b[p + 1]; out[2] = b[p + 2]; return out; }
    bb[0] = b[p] / 255; bb[1] = b[p + 1] / 255; bb[2] = b[p + 2] / 255;
    const t = mode === 'hue' ? setLum(setSat(s, blendSat(bb)), blendLum(bb))
      : mode === 'saturation' ? setLum(setSat(bb, blendSat(s)), blendLum(bb))
        : mode === 'luminosity' ? setLum(bb, blendLum(s))
          : setLum(s, blendLum(bb));
    for (let c = 0; c < 3; c++) out[c] = b[p + c] + (t[c] * 255 - b[p + c]) * w;
    return out;
  };
  proc.setSample = rgb => { smp = [rgb[0], rgb[1], rgb[2]]; };
  return proc;
}

// ---------------------------------------------------------------- Background Eraser ----

/**
 * Background Eraser: lowers alpha of pixels near `sample` (soft by tolerance); other pixels keep
 * their alpha. protectForeground: pixels within tolerance of that colour are never erased.
 * Colour channels are kept. process.setSample(rgb) supports continuous sampling.
 * @param {{ sample: number[], tolerance?: number, protectForeground?: number[]|null }} o
 * @returns {PaintProcess & { setSample(rgb: number[]): void }}
 */
export function backgroundEraserProcess({ sample, tolerance = 50, protectForeground = null }) {
  let smp = [...sample];
  const proc = (b, p, lx, ly, out) => {
    let w = tolWeight(maxDiff(b, p, smp), tolerance);
    if (w > 0 && protectForeground) w *= 1 - tolWeight(maxDiff(b, p, protectForeground), Math.max(tolerance, 1));
    out[0] = b[p]; out[1] = b[p + 1]; out[2] = b[p + 2]; out[3] = b[p + 3] * (1 - w);
    return out;
  };
  proc.setSample = rgb => { smp = [rgb[0], rgb[1], rgb[2]]; };
  return proc;
}

// ---------------------------------------------------------------- Magic Eraser ----

/**
 * Magic Eraser: erase (alpha → 0, scaled by opacity) the region regionMask() finds from (sx,sy).
 * `sampleBuf` (same size) may be a composite for "Sample All Layers". `selection` optional
 * Uint8Array(w*h) limits the effect. Returns a new buffer.
 * @param {RGBABuffer} buf
 * @param {number} sx @param {number} sy layer-local seed
 * @param {{ tolerance?: number, contiguous?: boolean, antiAlias?: boolean, opacity?: number, sampleBuf?: RGBABuffer, selection?: Uint8Array }} [o]
 * @returns {RGBABuffer}
 */
export function magicErase(buf, sx, sy, { tolerance = 32, contiguous = true, antiAlias = true, opacity = 1, sampleBuf = null, selection = null } = {}) {
  const m = regionMask(sampleBuf || buf, sx, sy, { tolerance, contiguous, antiAlias }), out = copyBuf(buf), d = out.data;
  for (let i = 0; i < m.length; i++) if (m[i]) {
    const k = m[i] / 255 * opacity * (selection ? selection[i] / 255 : 1);
    d[i * 4 + 3] = Math.round(d[i * 4 + 3] * (1 - k));
  }
  return out;
}

// ---------------------------------------------------------------- Red Eye ----

/**
 * Red Eye tool: inside the ellipse inscribed in `rect` (layer-local; scaled by pupilSize), pixels
 * whose red clearly dominates green/blue are neutralised (red := mean(g,b)) and darkened.
 * pupilSize 1..100 (50 = the ellipse fills the rect), darken 1..100. Smooth ellipse edge and
 * smooth redness threshold. Returns a new buffer.
 * @param {RGBABuffer} buf
 * @param {{ x: number, y: number, w: number, h: number }} rect
 * @param {{ pupilSize?: number, darken?: number }} [o]
 * @returns {RGBABuffer}
 */
export function redEye(buf, rect, { pupilSize = 50, darken = 50 } = {}) {
  const out = copyBuf(buf), d = out.data, { w, h } = buf;
  const sc = 0.5 + Math.min(100, Math.max(1, pupilSize)) / 100, k = 1 - Math.min(100, Math.max(1, darken)) / 100 * 0.8;
  const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2, rx = Math.max(1, rect.w / 2 * sc), ry = Math.max(1, rect.h / 2 * sc);
  const x0 = Math.max(0, Math.floor(cx - rx)), x1 = Math.min(w, Math.ceil(cx + rx)), y0 = Math.max(0, Math.floor(cy - ry)), y1 = Math.min(h, Math.ceil(cy + ry));
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const e = Math.hypot((x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry), edge = 1 - smooth(0.8, 1, e);
    if (edge <= 0) continue;
    const p = (y * w + x) * 4, r = d[p], g = d[p + 1], b = d[p + 2], gb = (g + b) / 2;
    const red = smooth(1.5, 2.0, r / Math.max(1, gb)) * smooth(40, 80, r);
    const a = red * edge;
    if (a <= 0) continue;
    d[p] = r + (gb * k - r) * a; d[p + 1] = g + (g * k - g) * a; d[p + 2] = b + (b * k - b) * a;
  }
  return out;
}

// ---------------------------------------------------------------- Pattern Stamp ----

/**
 * Pattern Stamp source. aligned = true: the tile is anchored to the DOCUMENT origin and
 * (offsetX, offsetY) must be the layer's document offset (layer-local + offset = document).
 * aligned = false: the tile is anchored at (offsetX, offsetY) in layer-local coordinates — pass
 * the first dab position of the stroke so each stroke starts a fresh tile.
 * @param {RGBABuffer} tile @param {number} offsetX @param {number} offsetY @param {boolean} [aligned]
 * @returns {PaintSource}
 */
export function patternSource(tile, offsetX = 0, offsetY = 0, aligned = true) {
  const { w, h, data } = tile, ox = aligned ? offsetX : -offsetX, oy = aligned ? offsetY : -offsetY;
  return (lx, ly, out) => {
    let u = (Math.floor(lx + ox)) % w, v = (Math.floor(ly + oy)) % h; if (u < 0) u += w; if (v < 0) v += h;
    const q = (v * w + u) * 4; out[0] = data[q]; out[1] = data[q + 1]; out[2] = data[q + 2]; out[3] = data[q + 3];
    return out;
  };
}

export const PATTERN_NAMES = ['checker', 'dots', 'stripes', 'noise', 'bricks'];
/**
 * Procedural pattern tiles (original). name ∈ PATTERN_NAMES; size = tile edge in px (default 16,
 * bricks 32×16). Optional colours fg/bg [r,g,b]. Returns an RGBA tile buffer that tiles seamlessly.
 * @param {string} name @param {{ size?: number, fg?: number[], bg?: number[], seed?: number }} [o]
 * @returns {RGBABuffer}
 */
export function makePattern(name, { size = 16, fg = [40, 40, 40], bg = [220, 220, 220], seed = 7 } = {}) {
  const S = Math.max(2, Math.round(size)), tw = name === 'bricks' ? S * 2 : S, th = S;
  const data = new Uint8ClampedArray(tw * th * 4), rand = rng(seed);
  const put = (i, c, t = 1) => { for (let k = 0; k < 3; k++) data[i * 4 + k] = bg[k] + (c[k] - bg[k]) * t; data[i * 4 + 3] = 255; };
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
    const i = y * tw + x;
    switch (name) {
      case 'checker': put(i, fg, ((x < S / 2) !== (y < S / 2)) ? 1 : 0); break;
      case 'dots': { const r = S * 0.28, dd = Math.hypot(x + 0.5 - S / 2, y + 0.5 - S / 2); put(i, fg, clamp01(r + 0.5 - dd)); break; }
      case 'stripes': put(i, fg, ((x + y) % S) < S / 2 ? 1 : 0); break; // 45° stripes, seamless
      case 'noise': put(i, fg, rand()); break;
      case 'bricks': {
        const row = y < th / 2 ? 0 : 1, yy = y % (th / 2), xx = (x + row * S) % tw;
        const mortar = yy === 0 || xx === 0 || xx === S;
        put(i, mortar ? bg : fg, 1); if (!mortar) for (let k = 0; k < 3; k++) data[i * 4 + k] = Math.round(fg[k] * 0.6 + [170, 70, 50][k] * 0.4);
        break;
      }
      default: throw Error('Unknown pattern: ' + name);
    }
  }
  return { w: tw, h: th, data };
}

// ---------------------------------------------------------------- History Brush ----

/**
 * History Brush source: paints pixels of `buf` (a history snapshot of THIS layer, same layer-local
 * grid) — sample (lx + offsetX, ly + offsetY). Outside → transparent. Painting "over" cannot
 * restore transparency that was painted away; use historyProcess for an exact restore.
 * @param {RGBABuffer} buf @param {number} [offsetX] @param {number} [offsetY]
 * @returns {PaintSource}
 */
export function historySource(buf, offsetX = 0, offsetY = 0) {
  return (lx, ly, out) => {
    const x = lx + offsetX, y = ly + offsetY;
    if (x < 0 || y < 0 || x >= buf.w || y >= buf.h) { out[0] = out[1] = out[2] = out[3] = 0; return out; }
    const q = (y * buf.w + x) * 4; out[0] = buf.data[q]; out[1] = buf.data[q + 1]; out[2] = buf.data[q + 2]; out[3] = buf.data[q + 3];
    return out;
  };
}
/**
 * History Brush as a process (recommended): moves every channel, alpha included, towards the
 * snapshot pixel, so a full-opacity stroke restores the snapshot exactly (also transparency).
 * @param {RGBABuffer} buf @param {number} [offsetX] @param {number} [offsetY]
 * @returns {PaintProcess}
 */
export function historyProcess(buf, offsetX = 0, offsetY = 0) {
  const src = historySource(buf, offsetX, offsetY);
  return (b, p, lx, ly, out) => {
    src(lx, ly, out);
    if (out[3] === 0) { out[0] = b[p]; out[1] = b[p + 1]; out[2] = b[p + 2]; } // keep colour, fade alpha
    return out;
  };
}

// ---------------------------------------------------------------- Content-Aware Move ----

function boxBlurMask(m, w, h, r) {
  if (r < 1) return Float32Array.from(m, v => v / 255);
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h), n = 2 * r + 1;
  for (let y = 0; y < h; y++) { let s = 0; for (let x = -r; x <= r; x++) s += m[y * w + Math.min(w - 1, Math.max(0, x))]; for (let x = 0; x < w; x++) { tmp[y * w + x] = s / n; s += m[y * w + Math.min(w - 1, x + r + 1)] - m[y * w + Math.max(0, x - r)]; } }
  for (let x = 0; x < w; x++) { let s = 0; for (let y = -r; y <= r; y++) s += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]; for (let y = 0; y < h; y++) { out[y * w + x] = s / n / 255; s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]; } }
  return out;
}

/**
 * Content-Aware Move / Extend. mask: Uint8Array(w*h) (layer-local, >127 = the object). The masked
 * pixels are copied by (dx, dy) and blended into the destination: a membrane (Laplace) correction
 * carries the colour difference along the destination boundary into the patch (strength grows
 * with adaptation 1 = very strict … 5 = very loose) and the edge is feathered by `adaptation` px.
 * mode 'move' first rebuilds the vacated area with contentAwareFill (inpaint.js); 'extend' keeps it.
 * Returns a new buffer. Throws if there is not enough surrounding image to sample from.
 * @param {RGBABuffer} buf @param {Uint8Array} mask @param {number} dx @param {number} dy
 * @param {{ mode?: 'move'|'extend', adaptation?: number, seed?: number }} [o]
 * @returns {RGBABuffer}
 */
export function contentAwareMove(buf, mask, dx, dy, { mode = 'move', adaptation = 3, seed = 1 } = {}) {
  const { w, h } = buf, N = w * h, orig = buf.data;
  dx = Math.round(dx); dy = Math.round(dy);
  const ad = Math.min(5, Math.max(1, Math.round(adaptation)));
  // vacated area (dilated 1 px so the anti-aliased rim of the object goes too)
  let base;
  if (mode === 'move') {
    const hole = new Uint8Array(N);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let on = false; for (let j = -1; j <= 1 && !on; j++) for (let i = -1; i <= 1; i++) { const xx = x + i, yy = y + j; if (xx >= 0 && yy >= 0 && xx < w && yy < h && mask[yy * w + xx] > 127) { on = true; break; } }
      if (on) hole[y * w + x] = 255;
    }
    base = contentAwareFill(buf, hole, { seed });
    // keep original alpha outside the hole; contentAwareFill already leaves those pixels alone
  } else base = copyBuf(buf);
  // destination region R (binary) and its bounding box
  const R = new Uint8Array(N); let bx0 = w, by0 = h, bx1 = -1, by1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = x - dx, sy = y - dy; if (sx < 0 || sy < 0 || sx >= w || sy >= h || mask[sy * w + sx] <= 127) continue;
    R[y * w + x] = 255; if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y;
  }
  if (bx1 < 0) return base;
  const fr = ad; // feather radius
  const W8 = boxBlurMask(R, w, h, Math.max(0, Math.round(fr / 2)));
  // weight: inside stays ≥ 0.5 → rescale so the interior is fully opaque and the rim fades
  const x0 = Math.max(0, bx0 - fr - 1), y0 = Math.max(0, by0 - fr - 1), x1 = Math.min(w - 1, bx1 + fr + 1), y1 = Math.min(h - 1, by1 + fr + 1);
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1, B = base.data;
  const srcPx = (x, y, c) => { const sx = Math.min(w - 1, Math.max(0, x - dx)), sy = Math.min(h - 1, Math.max(0, y - dy)); return orig[(sy * w + sx) * 4 + c]; };
  // membrane: f = 0-Laplacian inside R, f = base - shifted source outside R
  const f = new Float32Array(bw * bh * 3);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (!R[y * w + x]) for (let c = 0; c < 3; c++) f[((y - y0) * bw + x - x0) * 3 + c] = B[(y * w + x) * 4 + c] - srcPx(x, y, c);
  // initialise interior with the mean boundary difference, then SOR
  const mean = [0, 0, 0]; let nb = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (R[y * w + x]) continue;
    if ((x > 0 && R[y * w + x - 1]) || (x < w - 1 && R[y * w + x + 1]) || (y > 0 && R[(y - 1) * w + x]) || (y < h - 1 && R[(y + 1) * w + x])) { for (let c = 0; c < 3; c++) mean[c] += f[((y - y0) * bw + x - x0) * 3 + c]; nb++; }
  }
  for (let c = 0; c < 3; c++) mean[c] /= Math.max(1, nb);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (R[y * w + x]) for (let c = 0; c < 3; c++) f[((y - y0) * bw + x - x0) * 3 + c] = mean[c];
  const its = Math.min(600, 60 + 2 * Math.max(bx1 - bx0, by1 - by0));
  for (let it = 0; it < its; it++) for (let y = Math.max(y0 + 1, by0); y <= Math.min(y1 - 1, by1); y++) for (let x = Math.max(x0 + 1, bx0); x <= Math.min(x1 - 1, bx1); x++) {
    if (!R[y * w + x]) continue;
    const k = ((y - y0) * bw + x - x0) * 3;
    for (let c = 0; c < 3; c++) f[k + c] += 1.85 * ((f[k - 3 + c] + f[k + 3 + c] + f[k - bw * 3 + c] + f[k + bw * 3 + c]) / 4 - f[k + c]);
  }
  const strength = 0.2 + 0.2 * (ad - 1);
  const out = copyBuf(base), d = out.data;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = y * w + x, wt = R[i] ? Math.min(1, 0.5 + W8[i]) : W8[i] * (fr > 1 ? 1 : 0);
    if (wt <= 0) continue;
    const k = ((y - y0) * bw + x - x0) * 3, p = i * 4;
    for (let c = 0; c < 3; c++) d[p + c] = B[p + c] + (srcPx(x, y, c) + f[k + c] * strength - B[p + c]) * wt;
    d[p + 3] = B[p + 3] + (srcPx(x, y, 3) - B[p + 3]) * wt;
  }
  return out;
}

// ---------------------------------------------------------------- Perspective Crop ----

const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
/**
 * Perspective Crop geometry. quad = [TL, TR, BR, BL] ([x,y] in buffer pixels). outW/outH default
 * to the average lengths of opposite edges. matrix = 3×3 row-major homography mapping a quad point
 * to output-rectangle coordinates (apply3 from warp.js); inverse maps output → quad.
 * @param {number[][]} quad @param {number} [outW] @param {number} [outH]
 * @returns {{ w: number, h: number, matrix: number[], inverse: number[] }}
 */
export function perspectiveCropQuadToRect(quad, outW, outH) {
  const w = Math.max(1, Math.round(outW || (dist2(quad[0], quad[1]) + dist2(quad[3], quad[2])) / 2));
  const h = Math.max(1, Math.round(outH || (dist2(quad[0], quad[3]) + dist2(quad[1], quad[2])) / 2));
  const rect = [[0, 0], [w, 0], [w, h], [0, h]];
  return { w, h, matrix: homography(quad, rect), inverse: homography(rect, quad) };
}
/**
 * Perspective Crop pixels: rectifies the quad of `buf` into a w×h buffer (bilinear on premultiplied
 * alpha; outside the source → transparent). This is what the host calls; it does not use
 * projectiveTransform (that maps a whole buffer onto a quad, the opposite direction).
 * @param {RGBABuffer} buf @param {number[][]} quad TL,TR,BR,BL @param {number} [outW] @param {number} [outH]
 * @returns {RGBABuffer}
 */
export function perspectiveCrop(buf, quad, outW, outH) {
  const { w, h, inverse } = perspectiveCropQuadToRect(quad, outW, outH), out = new Uint8ClampedArray(w * h * 4), s = buf.data, acc = [0, 0, 0, 0];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let [sx, sy] = apply3(inverse, x + 0.5, y + 0.5); sx -= 0.5; sy -= 0.5;
    const ix = Math.floor(sx), iy = Math.floor(sy), fx = sx - ix, fy = sy - iy; acc[0] = acc[1] = acc[2] = acc[3] = 0;
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
      const xx = Math.min(buf.w - 1, Math.max(0, ix + i)), yy = Math.min(buf.h - 1, Math.max(0, iy + j));
      if (ix + i < -1 || iy + j < -1 || ix + i > buf.w || iy + j > buf.h) continue;
      const wt = (i ? fx : 1 - fx) * (j ? fy : 1 - fy), q = (yy * buf.w + xx) * 4, a = s[q + 3] * wt;
      acc[0] += s[q] * a; acc[1] += s[q + 1] * a; acc[2] += s[q + 2] * a; acc[3] += a;
    }
    const p = (y * w + x) * 4;
    if (acc[3] > 0) { out[p] = acc[0] / acc[3]; out[p + 1] = acc[1] / acc[3]; out[p + 2] = acc[2] / acc[3]; out[p + 3] = acc[3]; }
  }
  return { w, h, data: out };
}

// ---------------------------------------------------------------- Ruler / Straighten ----

/**
 * Ruler measurement in Photoshop's convention: angle in degrees counter-clockwise from +x (screen
 * y points down, so a line going up-right is positive), range −180..180; length in px.
 * @returns {{ length: number, angle: number, dx: number, dy: number }}
 */
export function measure(x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0;
  const a = dx === 0 && dy === 0 ? 0 : Math.atan2(-dy, dx) * 180 / Math.PI;
  return { length: Math.hypot(dx, dy), angle: a === -180 ? 180 : a + 0, dx, dy };
}
/**
 * Straighten: degrees to rotate the image so the ruler line becomes horizontal (or vertical when
 * it is closer to vertical). Positive = counter-clockwise on screen (Photoshop's Rotate Arbitrary
 * "CCW" sense); result in (−45, 45]. Example: a line rising 10° to the right → −10 (rotate 10° CW).
 */
export function straightenAngle(x0, y0, x1, y1) {
  const a = measure(x0, y0, x1, y1).angle, target = Math.round(a / 90) * 90;
  let r = target - a; if (r <= -45) r += 90; if (r > 45) r -= 90;
  return Object.is(r, -0) ? 0 : r;
}

// ---------------------------------------------------------------- Mixer Brush ----

/**
 * Mixer Brush state machine (simplified but real):
 *  - reservoir colour starts as `color`, amount = 1 (full);
 *  - update(canvasRGB) before each dab with the canvas colour under the dab centre: the brush
 *    picks up canvas paint (wet), the reservoir is contaminated by it (wet × mix), and the
 *    reservoir depletes (low load empties fast; load 100 lasts ~50 dabs);
 *  - the dab colour = mix of reservoir and picked-up canvas colour (mix), and each pixel is further
 *    wet-blended with the canvas pixel under it; deposit (alpha of the paint) follows the amount
 *    remaining, but wet paint keeps smearing even when the reservoir is empty.
 * wet, load, mix 0..100. reset() refills/cleans the brush ("Load brush after each stroke").
 * @param {{ wet?: number, load?: number, mix?: number, color: number[] }} o
 * @returns {{ process: PaintProcess, update(rgb: number[]): void, reset(): void, readonly state: { color: number[], amount: number, paint: number[] } }}
 */
export function mixerProcess({ wet = 50, load = 50, mix = 50, color }) {
  const W = clamp01(wet / 100), L = clamp01(load / 100), M = clamp01(mix / 100);
  let res, amount, paint;
  const reset = () => { res = [color[0], color[1], color[2]]; amount = 1; paint = [...res]; };
  reset();
  const update = cv => {
    const k = W * M;
    paint = res.map((v, c) => v + (cv[c] - v) * k);
    res = res.map((v, c) => v + (cv[c] - v) * k * 0.5); // reservoir picks up canvas paint
    amount = Math.max(0, amount - 1 / (1 + L * 50));
  };
  const process = (b, p, lx, ly, out) => {
    const full = Math.min(1, amount * 2), local = W * 0.5, dep = Math.max(full, W * 0.6); // wet paint still smears when empty
    for (let c = 0; c < 3; c++) { const t = paint[c] + (b[p + c] - paint[c]) * local; out[c] = b[p + c] + (t - b[p + c]) * dep; }
    out[3] = b[p + 3] + (255 - b[p + 3]) * full;
    return out;
  };
  return { process, update, reset, get state() { return { color: [...res], amount, paint: [...paint] }; } };
}
