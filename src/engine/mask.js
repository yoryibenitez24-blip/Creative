// Raster layer masks.
//
// A mask is document-space 8-bit coverage attached to a layer:
//   {assetId|null, x, y, w, h, fill, enabled, linked, density, feather}
// Pixels inside the w×h rectangle at (x,y) come from the asset (grey PNG, value in R=G=B,
// alpha 255); everything outside, or the whole mask when assetId is null, uses `fill`
// (0 = hide, 255 = reveal), so a mask is conceptually infinite like Photoshop's.
// White reveals, black hides.
//
// Non-destructive properties, applied in this order:
//   feather  Gaussian blur, sigma = feather/2 (same convention as selection feather)
//   density  m' = 255 - density·(255 - m)   (density 0 → mask has no effect)
// The editor previews feathered/density masks by rendering sampleMask() itself (see
// editor/LayerMask.jsx), so the canvas, the PNG export and applyMask() share one implementation.

import { feather as featherBuf } from './selection.js';

export const MASK_DEFAULTS = Object.freeze({ enabled: true, linked: true, density: 1, feather: 0 });
export const MAX_FEATHER = 250;

export function newMask(W, H, fill = 255) {
  return { assetId: null, x: 0, y: 0, w: W, h: H, fill: fill ? 255 : 0, ...MASK_DEFAULTS };
}

export function validateMask(m) {
  if (m == null) return true;
  return typeof m === 'object'
    && (m.assetId === null || (typeof m.assetId === 'string' && /^sha256-[0-9a-f]{64}$/.test(m.assetId)))
    && Number.isInteger(m.x) && Number.isInteger(m.y)
    && Number.isInteger(m.w) && Number.isInteger(m.h) && m.w > 0 && m.h > 0 && m.w <= 8000 && m.h <= 8000
    && (m.fill === 0 || m.fill === 255)
    && typeof m.enabled === 'boolean' && typeof m.linked === 'boolean'
    && Number.isFinite(m.density) && m.density >= 0 && m.density <= 1
    && Number.isFinite(m.feather) && m.feather >= 0 && m.feather <= MAX_FEATHER;
}

export const effective = (v, density) => 255 - density * (255 - v);

/** Grey RGBA buffer from a document-sized selection mask (Uint8Array, 0..255). */
export function maskBufferFromSelection(sel, W, H, invert = false) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const v = invert ? 255 - sel[i] : sel[i];
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  return { w: W, h: H, data };
}

export function invertMaskBuffer(buf) {
  const d = buf.data;
  for (let i = 0; i < d.length; i += 4) { d[i] = d[i + 1] = d[i + 2] = 255 - d[i]; d[i + 3] = 255; }
  return buf;
}

/** Raw mask value (before feather/density) at document pixel (dx,dy). */
export function rawMaskAt(mask, buf, dx, dy) {
  const x = dx - mask.x, y = dy - mask.y;
  if (!buf || x < 0 || y < 0 || x >= mask.w || y >= mask.h) return mask.fill;
  return buf.data[(y * mask.w + x) * 4];
}

/**
 * Effective mask (0..255, float) sampled over a document rectangle, with feather and density.
 * Feather extends the sampled region by the kernel reach so edges match an infinite mask.
 */
export function sampleMask(mask, buf, rx, ry, rw, rh) {
  const pad = mask.feather > 0 ? Math.ceil(mask.feather * 1.5) + 2 : 0;
  const W = rw + 2 * pad, H = rh + 2 * pad;
  let grid = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) grid[y * W + x] = rawMaskAt(mask, buf, rx - pad + x, ry - pad + y);
  if (pad) {
    // feather() treats 0 as "outside"; blur coverage of the hidden part (255 - v) instead when fill is 255
    const inv = mask.fill === 255;
    if (inv) for (let i = 0; i < grid.length; i++) grid[i] = 255 - grid[i];
    featherBuf(grid, W, H, mask.feather);
    if (inv) for (let i = 0; i < grid.length; i++) grid[i] = 255 - grid[i];
  }
  const out = new Float32Array(rw * rh);
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) out[y * rw + x] = effective(grid[(y + pad) * W + x + pad], mask.density);
  return out;
}

/** Bake a mask into a raster layer's alpha (Layer > Apply mask). Layer pixel (lx,ly) = doc (lx+offsetX, ly+offsetY). */
export function applyMask(layerBuf, offsetX, offsetY, mask, maskBuf) {
  if (!mask.enabled) return layerBuf;
  const m = sampleMask(mask, maskBuf, offsetX, offsetY, layerBuf.w, layerBuf.h);
  const d = layerBuf.data;
  for (let i = 0; i < m.length; i++) d[i * 4 + 3] = Math.round(d[i * 4 + 3] * m[i] / 255);
  return layerBuf;
}

/** Move a layer; a linked mask moves with it. */
export function moveLayer(l, x, y) {
  const out = { ...l, x, y };
  if (l.mask && l.mask.linked) out.mask = { ...l.mask, x: l.mask.x + Math.round(x - l.x), y: l.mask.y + Math.round(y - l.y) };
  return out;
}

export const luminance = ([r, g, b]) => Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
