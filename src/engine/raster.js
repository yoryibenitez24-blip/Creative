// Raster paint compositing on straight-alpha RGBA8 buffers.
//
// Working space: 8-bit sRGB-encoded values, straight (non-premultiplied) alpha,
// "over" compositing in encoded space. This matches how the browser composites
// the SVG document today, so preview and export agree. Linear-light painting is a
// later ledger item (COLOR-LINEAR).
//
// Stroke model (Photoshop-like opacity vs flow):
//   cov  = per-pixel stroke coverage, built up by each dab: cov += (1-cov)*dab*flow
//   eff  = min(cov,1) * opacity * selection
//   out  = before OVER (color, eff)        (paint)
//   outA = beforeA * (1 - eff)             (erase)
// Every pixel is recomputed from the untouched `before` copy, so overlapping dabs
// never exceed the stroke opacity and the result is independent of event timing.

export function createBuffer(w, h) { return { w, h, data: new Uint8ClampedArray(w * h * 4) }; }

export function dabAlpha(d, r, hardness) {
  // smooth falloff from inner radius to r; at least 1px of anti-aliasing
  const edge = Math.max(r * (1 - hardness), Math.min(1, r));
  const inner = r - edge;
  if (d <= inner) return 1;
  if (d >= r) return 0;
  const t = (d - inner) / edge;
  return 1 - t * t * (3 - 2 * t);
}

/**
 * opts: {color:[r,g,b], mode:'paint'|'erase', opacity, hardness,
 *        mask: Uint8Array|null (document-sized selection), docW, docH, offsetX, offsetY}
 * Layer-local pixel (lx,ly) maps to document pixel (lx+offsetX, ly+offsetY).
 */
export function beginPaint(buf, opts) {
  return { buf, before: new Uint8ClampedArray(buf.data), cov: new Float32Array(buf.w * buf.h), opts: { mode: 'paint', opacity: 1, hardness: 0.8, offsetX: 0, offsetY: 0, mask: null, ...opts } };
}

function selAt(o, lx, ly) {
  if (!o.mask) return 1;
  const dx = lx + o.offsetX, dy = ly + o.offsetY;
  if (dx < 0 || dy < 0 || dx >= o.docW || dy >= o.docH) return 0;
  return o.mask[dy * o.docW + dx] / 255;
}

function compositePixel(ctx, i, lx, ly) {
  const o = ctx.opts, d = ctx.buf.data, b = ctx.before, p = i * 4;
  const eff = Math.min(1, ctx.cov[i]) * o.opacity * selAt(o, lx, ly);
  const ba = b[p + 3] / 255;
  if (o.mode === 'erase') {
    d[p] = b[p]; d[p + 1] = b[p + 1]; d[p + 2] = b[p + 2];
    d[p + 3] = Math.round(ba * (1 - eff) * 255);
    return;
  }
  const oa = eff + ba * (1 - eff);
  if (oa <= 0) { d[p] = d[p + 1] = d[p + 2] = d[p + 3] = 0; return; }
  for (let c = 0; c < 3; c++) d[p + c] = Math.round((o.color[c] * eff + b[p + c] * ba * (1 - eff)) / oa);
  d[p + 3] = Math.round(oa * 255);
}

/** Apply one dab in DOCUMENT coordinates. Returns the layer-local dirty rect or null. */
export function applyDab(ctx, dab) {
  const { buf, opts } = ctx;
  const cx = dab.x - opts.offsetX, cy = dab.y - opts.offsetY, r = Math.max(0.5, dab.size / 2);
  const x0 = Math.max(0, Math.floor(cx - r)), y0 = Math.max(0, Math.floor(cy - r));
  const x1 = Math.min(buf.w, Math.ceil(cx + r)), y1 = Math.min(buf.h, Math.ceil(cy + r));
  if (x1 <= x0 || y1 <= y0) return null;
  const flow = dab.flow ?? 1;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const a = dabAlpha(Math.hypot(x + 0.5 - cx, y + 0.5 - cy), r, opts.hardness) * flow;
    if (a <= 0) continue;
    const i = y * buf.w + x;
    ctx.cov[i] += (1 - ctx.cov[i]) * a;
    compositePixel(ctx, i, x, y);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function unionRect(a, b) {
  if (!a) return b; if (!b) return a;
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

/** Fill (paint) or clear (erase) the selected area of a layer in one operation. */
export function fillArea(buf, opts) {
  const ctx = beginPaint(buf, opts);
  ctx.cov.fill(1);
  for (let y = 0; y < buf.h; y++) for (let x = 0; x < buf.w; x++) compositePixel(ctx, y * buf.w + x, x, y);
  return { x: 0, y: 0, w: buf.w, h: buf.h };
}

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
