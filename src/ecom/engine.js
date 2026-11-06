// E-commerce product-photo engine: AI matte refinement, cut-out, framing, batch scale,
// backgrounds, ground shadows, reflection and light retouch settings.
// Pure JS (no DOM): runs in Node tests, on the main thread and in a Web Worker.
// Buffers are { w, h, data: Uint8ClampedArray } RGBA8, straight (non-premultiplied) alpha.

import { decodeAlpha } from '../engine/aiseg.js';
import { fastGuided } from '../engine/masks.js';
import { gauss1, minFilter, clamp01, smooth, autoWhiteBalance, autoTone } from '../engine/develop.js';
import { decontaminateColors } from '../engine/refine.js';

export const MATTE_DEFAULTS = Object.freeze({ edgeShift: 0, feather: 0, contrast: 50, decontaminate: true, decontaminateAmount: 100 });
export const FRAMING_DEFAULTS = Object.freeze({ margin: 7.5, align: 'center', sizing: 'fit' });
export const BACKGROUND_DEFAULTS = Object.freeze({ type: 'white', color: '#f2efe9', color2: '#d9d4ff', angle: 90, imageId: null });
export const SHADOW_DEFAULTS = Object.freeze({
  contact: false, contactOpacity: 55, contactBlur: 4, contactWidth: 100,
  drop: false, dropOpacity: 30, dropBlur: 6, dropDistance: 3, dropAngle: 90,
  color: '#000000',
});
export const REFLECTION_DEFAULTS = Object.freeze({ enabled: false, opacity: 30, height: 35, gap: 0 });
export const RETOUCH_DEFAULTS = Object.freeze({ autoWB: false, autoTone: false, brightness: 0, contrast: 0, saturation: 0, sharpen: 0 });

export const makeBuf = (w, h) => ({ w, h, data: new Uint8ClampedArray(w * h * 4) });
export const hexToRgb = hex => { const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim()); const n = m ? parseInt(m[1], 16) : 0; return [n >> 16 & 255, n >> 8 & 255, n & 255]; };

// ------------------------------------------------------------------ planes ------------------
/** Bilinear resample of a float plane with pixel-centre alignment. */
export function upsamplePlane(src, sw, sh, w, h) {
  if (sw === w && sh === h) return Float32Array.from(src);
  const out = new Float32Array(w * h), x0 = new Int32Array(w), x1 = new Int32Array(w), fx = new Float32Array(w);
  for (let x = 0; x < w; x++) { const u = Math.min(sw - 1, Math.max(0, (x + 0.5) * sw / w - 0.5)); x0[x] = Math.floor(u); x1[x] = Math.min(sw - 1, x0[x] + 1); fx[x] = u - x0[x]; }
  for (let y = 0; y < h; y++) {
    const v = Math.min(sh - 1, Math.max(0, (y + 0.5) * sh / h - 0.5)), y0 = Math.floor(v), y1 = Math.min(sh - 1, y0 + 1), fy = v - y0, r0 = y0 * sw, r1 = y1 * sw;
    for (let x = 0; x < w; x++) { const a = src[r0 + x0[x]] + (src[r0 + x1[x]] - src[r0 + x0[x]]) * fx[x], b = src[r1 + x0[x]] + (src[r1 + x1[x]] - src[r1 + x0[x]]) * fx[x]; out[y * w + x] = a + (b - a) * fy; }
  }
  return out;
}

// three-pass box approximation of a Gaussian with separate horizontal / vertical sigma
const boxR = sigma => sigma < 0.3 ? 0 : Math.max(1, Math.round((Math.sqrt(4 * sigma * sigma + 1) - 1) / 2));
function boxLine(src, dst, n, stride, off, r) {
  const d = 2 * r + 1; let acc = 0;
  for (let k = -r; k <= r; k++) acc += src[off + Math.min(n - 1, Math.max(0, k)) * stride];
  for (let i = 0; i < n; i++) {
    dst[off + i * stride] = acc / d;
    acc += src[off + Math.min(n - 1, i + r + 1) * stride] - src[off + Math.max(0, i - r) * stride];
  }
}
/** Anisotropic Gaussian blur of a float plane (3 box passes per axis, edge-clamped). */
export function blurPlane(src, w, h, sx, sy = sx) {
  let a = Float32Array.from(src), b = new Float32Array(src.length);
  const rx = boxR(sx), ry = boxR(sy);
  for (let pass = 0; pass < 3; pass++) {
    if (rx) { for (let y = 0; y < h; y++) boxLine(a, b, w, 1, y * w, rx); [a, b] = [b, a]; }
    if (ry) { for (let x = 0; x < w; x++) boxLine(a, b, h, w, x, ry); [a, b] = [b, a]; }
  }
  return a;
}

// ------------------------------------------------------------------ matte -------------------
const guideOf = ({ w, h, data }) => { const g = new Float32Array(w * h); for (let i = 0; i < g.length; i++) g[i] = (0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2]) / 255; return g; };

/**
 * Paint touch-up strokes into a float alpha plane (in place).
 * stroke: { mode: 'restore'|'erase', size: diameter as a fraction of the long side, hardness 0..1,
 *           pts: [x0, y0, x1, y1, …] normalised 0..1 }
 */
export function applyStrokes(a, w, h, strokes = []) {
  const long = Math.max(w, h);
  for (const st of strokes || []) {
    const pts = st.pts || [], n = pts.length >> 1; if (!n) continue;
    const r = Math.max(0.75, (st.size ?? 0.05) * long / 2), inner = r * clamp01(st.hardness ?? 0.6), erase = st.mode === 'erase';
    const cov = new Map();
    for (let k = 0; k < n; k++) {
      const ax = pts[2 * k] * w, ay = pts[2 * k + 1] * h, j = Math.min(n - 1, k + 1), bx = pts[2 * j] * w, by = pts[2 * j + 1] * h, dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - r)), x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx) + r)), y0 = Math.max(0, Math.floor(Math.min(ay, by) - r)), y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by) + r));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const px = x + 0.5 - ax, py = y + 0.5 - ay, t = l2 ? Math.max(0, Math.min(1, (px * dx + py * dy) / l2)) : 0, d = Math.hypot(px - t * dx, py - t * dy);
        if (d >= r) continue;
        const v = d <= inner ? 1 : 1 - smooth(inner, r, d), i = y * w + x;
        if (!(cov.get(i) >= v)) cov.set(i, v);
      }
      if (n === 1) break;
    }
    for (const [i, v] of cov) a[i] = erase ? Math.min(a[i], 1 - v) : Math.max(a[i], v);
  }
  return a;
}

/**
 * AI matte → refined 8-bit alpha at the image size.
 * image: RGBA buffer (the guide); ai: { w, h, b64 } from aiSegment; opts: MATTE_DEFAULTS fields;
 * strokes: touch-up strokes. Steps: bilinear upsample → fast guided filter (snaps the matte to the
 * image's edges) → edge contrast → edge shift (dilate / erode, px) → feather (Gaussian, px) →
 * touch-up strokes → noise floor (values within 1 % of 0 or 1 become exactly 0 or 1).
 */
export function refineMatte(image, ai, opts = {}, strokes = []) {
  const o = { ...MATTE_DEFAULTS, ...opts }, { w, h } = image;
  let a = ai ? upsamplePlane(decodeAlpha(ai), ai.w, ai.h, w, h) : new Float32Array(w * h).fill(1);
  if (ai) {
    const r = Math.max(1, Math.round(Math.max(w, h) / 140));
    a = fastGuided(guideOf(image), a, w, h, r, 2e-3);
    const boost = 1 + clamp01(o.contrast / 100) * 1.5;
    for (let i = 0; i < a.length; i++) a[i] = clamp01((a[i] - 0.5) * boost + 0.5);
  }
  const s = Math.round(o.edgeShift || 0);
  if (s < 0) a = minFilter(a, w, h, -s);
  else if (s > 0) { for (let i = 0; i < a.length; i++) a[i] = 1 - a[i]; a = minFilter(a, w, h, s); for (let i = 0; i < a.length; i++) a[i] = 1 - a[i]; }
  if (o.feather > 0) a = gauss1(a, w, h, o.feather / 2);
  applyStrokes(a, w, h, strokes);
  const out = new Uint8Array(w * h);
  for (let i = 0; i < a.length; i++) { const v = a[i]; out[i] = v < 0.01 ? 0 : v > 0.99 ? 255 : Math.round(v * 255); }
  return out;
}

/** Bounding box of alpha > thr → {x, y, w, h} or null when empty. */
export function productBounds(alpha, w, h, thr = 8) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) { const o = y * w; for (let x = 0; x < w; x++) if (alpha[o + x] > thr) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; } }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Image + alpha → RGBA cut-out (optionally with decontaminated edge colours). */
export function cutout(image, alpha, opts = {}) {
  const o = { ...MATTE_DEFAULTS, ...opts };
  const src = o.decontaminate && o.decontaminateAmount > 0 ? decontaminateColors(image, alpha, o.decontaminateAmount) : image;
  const out = new Uint8ClampedArray(src.data);
  for (let i = 0; i < alpha.length; i++) { out[i * 4 + 3] = Math.round(image.data[i * 4 + 3] * alpha[i] / 255); if (!alpha[i]) out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = 0; }
  return { w: image.w, h: image.h, data: out };
}

export function cropBuffer(buf, r) {
  const o = makeBuf(r.w, r.h);
  for (let y = 0; y < r.h; y++) o.data.set(buf.data.subarray(((r.y + y) * buf.w + r.x) * 4, ((r.y + y) * buf.w + r.x + r.w) * 4), y * r.w * 4);
  return o;
}

/**
 * Worker-ready op: refine the AI matte and cut the product out.
 * buf = the (retouched) image; params = { ai, matte (MATTE_DEFAULTS), strokes, guide? (RGBA buffer
 * the matte is snapped to; defaults to buf) }. Returns the full-size RGBA cut-out.
 */
export function ecomCutoutOp(buf, p = {}) {
  const guide = p.guide ? { w: p.guide.w, h: p.guide.h, data: new Uint8ClampedArray(p.guide.data) } : buf;
  const alpha = refineMatte(guide, p.ai, p.matte, p.strokes);
  return cutout(buf, alpha, p.matte);
}

// ------------------------------------------------------------------ framing -----------------
/**
 * Place a product of size {w, h} (source px) on a canvas {W, H}.
 * opts.margin: % of the canvas' shorter side kept free on every edge. opts.align: 'center' | 'bottom'
 * (bottom: the product stands on a floor line one margin above the bottom edge).
 * opts.scale: output px per source px (from batchScales); never larger than the fit scale.
 * Returns integer {x, y, w, h, scale, fit}.
 */
export function placeProduct(size, canvas, opts = {}) {
  const o = { ...FRAMING_DEFAULTS, ...opts }, m = Math.max(0, Math.min(45, o.margin)) / 100 * Math.min(canvas.W, canvas.H);
  const fit = Math.min((canvas.W - 2 * m) / size.w, (canvas.H - 2 * m) / size.h);
  const scale = o.scale > 0 ? Math.min(fit, o.scale) : fit;
  const w = Math.max(1, Math.round(size.w * scale)), h = Math.max(1, Math.round(size.h * scale));
  const x = Math.round((canvas.W - w) / 2), y = o.align === 'bottom' ? Math.round(canvas.H - m - h) : Math.round((canvas.H - h) / 2);
  return { x, y, w, h, scale, fit };
}

/**
 * Output scale per item for a batch. items: [{ w, h, L }] = product bounds in source px and the
 * source photo's long side. sizing 'fit': each product fills the frame. 'uniform': one common scale
 * relative to each photo's frame, chosen so the largest product just fits; products photographed
 * with the same set-up therefore keep their true relative sizes and the same visual size.
 * Returns scales (output px per source px) in item order.
 */
export function batchScales(items, canvas, opts = {}) {
  const o = { ...FRAMING_DEFAULTS, ...opts }, m = Math.max(0, Math.min(45, o.margin)) / 100 * Math.min(canvas.W, canvas.H);
  const fitN = it => Math.min((canvas.W - 2 * m) / (it.w / it.L), (canvas.H - 2 * m) / (it.h / it.L));
  if (o.sizing !== 'uniform' || !items.length) return items.map(it => Math.min((canvas.W - 2 * m) / it.w, (canvas.H - 2 * m) / it.h));
  const k = Math.min(...items.map(fitN));
  return items.map(it => k / it.L);
}

// ------------------------------------------------------------------ compositing -------------
function fillBackground(out, bg, bgImage) {
  const { w, h, data } = out, type = bg?.type || 'white';
  if (type === 'transparent') return;
  if (type === 'white' || type === 'color') {
    const [r, g, b] = type === 'white' ? [255, 255, 255] : hexToRgb(bg.color);
    for (let i = 0; i < data.length; i += 4) { data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255; }
    return;
  }
  if (type === 'gradient') {
    const c1 = hexToRgb(bg.color), c2 = hexToRgb(bg.color2), t = (bg.angle ?? 90) * Math.PI / 180, dx = Math.cos(t), dy = Math.sin(t);
    const ext = Math.abs(dx) * w / 2 + Math.abs(dy) * h / 2 || 1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = clamp01((((x + 0.5 - w / 2) * dx + (y + 0.5 - h / 2) * dy) / ext + 1) / 2), i = (y * w + x) * 4;
      data[i] = c1[0] + (c2[0] - c1[0]) * u; data[i + 1] = c1[1] + (c2[1] - c1[1]) * u; data[i + 2] = c1[2] + (c2[2] - c1[2]) * u; data[i + 3] = 255;
    }
    return;
  }
  if (type === 'image' && bgImage) { // cover-fit, bilinear
    const s = Math.max(w / bgImage.w, h / bgImage.h), ox = (bgImage.w - w / s) / 2, oy = (bgImage.h - h / s) / 2, src = bgImage.data, bw = bgImage.w, bh = bgImage.h;
    for (let y = 0; y < h; y++) {
      const v = Math.min(bh - 1, Math.max(0, oy + (y + 0.5) / s - 0.5)), y0 = Math.floor(v), y1 = Math.min(bh - 1, y0 + 1), fy = v - y0;
      for (let x = 0; x < w; x++) {
        const u = Math.min(bw - 1, Math.max(0, ox + (x + 0.5) / s - 0.5)), x0 = Math.floor(u), x1 = Math.min(bw - 1, x0 + 1), fx = u - x0, i = (y * w + x) * 4;
        for (let c = 0; c < 3; c++) { const a = src[(y0 * bw + x0) * 4 + c] * (1 - fx) + src[(y0 * bw + x1) * 4 + c] * fx, b = src[(y1 * bw + x0) * 4 + c] * (1 - fx) + src[(y1 * bw + x1) * 4 + c] * fx; data[i + c] = a + (b - a) * fy; }
        data[i + 3] = 255;
      }
    }
    return;
  }
  // image background without pixels: fall back to white so nothing is left undefined
  data.fill(255);
}

/** Straight-alpha "over" of colour (r,g,b) with coverage a (0..1) onto out at byte index i. */
function over(d, i, r, g, b, a) {
  if (a <= 0) return;
  const da = d[i + 3] / 255, oa = a + da * (1 - a), k = da * (1 - a);
  d[i] = (r * a + d[i] * k) / oa; d[i + 1] = (g * a + d[i + 1] * k) / oa; d[i + 2] = (b * a + d[i + 2] * k) / oa; d[i + 3] = oa * 255;
}

/**
 * Ground shadow coverage (0..1) generated from the placed product's matte.
 * Returns { x0, y0, w, h, data: Float32Array } (a region of the canvas) or null.
 * Contact shadow: the product's footprint (columns whose lowest opaque pixel lies on the bottom
 * 4 % of the product) becomes a thin band on the floor line, blurred wide and flat.
 * Drop shadow: the silhouette, offset by distance (% of product height) along angle (90° = down),
 * blurred by blur (% of product height).
 */
export function shadowPlane(product, place, canvas, sh = {}) {
  const s = { ...SHADOW_DEFAULTS, ...sh };
  if (!s.contact && !s.drop) return null;
  const { w: pw, h: ph } = product, pa = product.data;
  const dropSig = s.dropBlur / 100 * ph / 2, dist = s.dropDistance / 100 * ph, ang = s.dropAngle * Math.PI / 180, ddx = Math.round(Math.cos(ang) * dist), ddy = Math.round(Math.sin(ang) * dist);
  const cSigX = Math.max(0.5, s.contactBlur / 100 * pw), cSigY = Math.max(0.5, cSigX * 0.25);
  const pad = Math.ceil(Math.max(s.drop ? 3 * dropSig + Math.max(Math.abs(ddx), Math.abs(ddy)) : 0, s.contact ? 3 * cSigX + pw * Math.max(0, s.contactWidth - 100) / 200 : 0)) + 2;
  const x0 = Math.max(0, place.x - pad), y0 = Math.max(0, place.y - pad), x1 = Math.min(canvas.W, place.x + pw + pad), y1 = Math.min(canvas.H, place.y + ph + pad);
  const W = x1 - x0, H = y1 - y0; if (W <= 0 || H <= 0) return null;
  const total = new Float32Array(W * H);
  if (s.drop && s.dropOpacity > 0) {
    const p = new Float32Array(W * H);
    for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
      const a = pa[(y * pw + x) * 4 + 3]; if (!a) continue;
      const cx = place.x + x + ddx - x0, cy = place.y + y + ddy - y0;
      if (cx >= 0 && cy >= 0 && cx < W && cy < H) p[cy * W + cx] = a / 255;
    }
    const b = blurPlane(p, W, H, dropSig, dropSig), op = s.dropOpacity / 100;
    for (let i = 0; i < total.length; i++) total[i] = b[i] * op;
  }
  if (s.contact && s.contactOpacity > 0) {
    const low = new Int32Array(pw).fill(-1);
    for (let x = 0; x < pw; x++) for (let y = ph - 1; y >= 0; y--) if (pa[(y * pw + x) * 4 + 3] > 127) { low[x] = y; break; }
    let cols = []; for (let x = 0; x < pw; x++) if (low[x] >= ph * 0.96 - 1) cols.push(x);
    if (!cols.length) for (let x = 0; x < pw; x++) if (low[x] >= 0) cols.push(x);
    const p = new Float32Array(W * H), floorY = place.y + ph - y0, t = Math.max(1, Math.round(ph * 0.008));
    const cxm = place.x + pw / 2 - x0, stretch = Math.max(0.2, s.contactWidth / 100);
    for (const x of cols) {
      const cx = Math.round(cxm + (place.x + x + 0.5 - x0 - cxm) * stretch);
      for (let y = floorY - t; y <= floorY + t; y++) if (cx >= 0 && cx < W && y >= 0 && y < H) p[y * W + cx] = 1;
    }
    const b = blurPlane(p, W, H, cSigX, cSigY);
    let mx = 0; for (let i = 0; i < b.length; i++) if (b[i] > mx) mx = b[i];
    const op = s.contactOpacity / 100 / (mx || 1);
    for (let i = 0; i < total.length; i++) total[i] = 1 - (1 - total[i]) * (1 - Math.min(1, b[i] * op));
  }
  for (let i = 0; i < total.length; i++) if (total[i] < 0.5 / 255) total[i] = 0;
  return { x0, y0, w: W, h: H, data: total };
}

/**
 * Compose the final product image.
 * product: RGBA cut-out already resized to place.w × place.h. canvas: {W, H}. place: {x, y, w, h}.
 * opts: { background (BACKGROUND_DEFAULTS), bgImage (RGBA buffer for type 'image'), shadow
 * (SHADOW_DEFAULTS), reflection (REFLECTION_DEFAULTS) }.
 * Order: background → shadow → reflection → product. A white background stays exactly #FFFFFF
 * wherever no shadow, reflection or product pixel lands.
 */
export function compose(product, canvas, place, opts = {}) {
  const out = makeBuf(canvas.W, canvas.H), d = out.data, W = canvas.W;
  fillBackground(out, { ...BACKGROUND_DEFAULTS, ...(opts.background || {}) }, opts.bgImage);
  const sp = shadowPlane(product, place, canvas, opts.shadow);
  if (sp) {
    const [r, g, b] = hexToRgb(opts.shadow?.color || '#000000');
    for (let y = 0; y < sp.h; y++) for (let x = 0; x < sp.w; x++) { const a = sp.data[y * sp.w + x]; if (a > 0) over(d, ((sp.y0 + y) * W + sp.x0 + x) * 4, r, g, b, a); }
  }
  const rf = { ...REFLECTION_DEFAULTS, ...(opts.reflection || {}) }, pd = product.data, pw = product.w, ph = product.h;
  if (rf.enabled && rf.opacity > 0 && rf.height > 0) {
    const rh = Math.max(1, Math.round(ph * rf.height / 100)), gap = Math.round(rf.gap / 100 * ph), op = rf.opacity / 100;
    for (let r = 0; r < rh; r++) {
      const dy = place.y + ph + gap + r, sy = ph - 1 - r; if (dy < 0 || dy >= canvas.H || sy < 0) continue;
      const fade = op * (1 - r / rh) ** 1.5;
      for (let x = 0; x < pw; x++) { const dx = place.x + x; if (dx < 0 || dx >= W) continue; const s = (sy * pw + x) * 4; over(d, (dy * W + dx) * 4, pd[s], pd[s + 1], pd[s + 2], pd[s + 3] / 255 * fade); }
    }
  }
  for (let y = 0; y < ph; y++) {
    const dy = place.y + y; if (dy < 0 || dy >= canvas.H) continue;
    for (let x = 0; x < pw; x++) { const dx = place.x + x; if (dx < 0 || dx >= W) continue; const s = (y * pw + x) * 4; over(d, (dy * W + dx) * 4, pd[s], pd[s + 1], pd[s + 2], pd[s + 3] / 255); }
  }
  return out;
}

/** Worker-ready op: buf = the resized product; params = { canvas, place, background, bgImage, shadow, reflection }. */
export function ecomComposeOp(buf, p = {}) {
  const bgImage = p.bgImage ? { w: p.bgImage.w, h: p.bgImage.h, data: new Uint8ClampedArray(p.bgImage.data) } : null;
  return compose(buf, p.canvas, p.place, { ...p, bgImage });
}

// ------------------------------------------------------------------ retouch -----------------
export const isRetouchIdentity = r => { const o = { ...RETOUCH_DEFAULTS, ...(r || {}) }; return !o.autoWB && !o.autoTone && !o.brightness && !o.contrast && !o.saturation && !o.sharpen; };

/**
 * Light retouch → Camera Raw (develop.js) settings measured on `buf`, or null for the identity.
 * autoWB: grey-world white balance; autoTone: exposure/contrast/highlights/shadows/whites/blacks;
 * brightness ±100 → ±1 EV exposure; contrast and saturation ±100; sharpen 0..100 → amount 0..150.
 */
export function retouchSettings(buf, r) {
  const o = { ...RETOUCH_DEFAULTS, ...(r || {}) };
  if (isRetouchIdentity(o)) return null;
  const s = {};
  if (o.autoWB) Object.assign(s, autoWhiteBalance(buf));
  if (o.autoTone) Object.assign(s, autoTone(buf));
  s.exposure = Math.round(((s.exposure || 0) + o.brightness / 100) * 100) / 100;
  s.contrast = Math.max(-100, Math.min(100, (s.contrast || 0) + o.contrast));
  if (o.saturation) s.saturation = o.saturation;
  if (o.sharpen) { s.sharpenAmount = Math.round(o.sharpen * 1.5); s.sharpenRadius = 1; s.sharpenDetail = 25; }
  return s;
}
