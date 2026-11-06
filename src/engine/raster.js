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
 * opts: {color:[r,g,b], mode:'paint'|'erase', opacity, hardness, aliased (pencil),
 *        source(lx,ly,out)→rgba (clone, gradient), process(before,p,lx,ly,out)→rgba (retouch),
 *        blend: one of BLEND_MODES (paint colour and `source` paths; default 'normal'),
 *        angle: tip angle in degrees (counter-clockwise, Photoshop convention), roundness: 0.01..1
 *        (1 = round tip, identical to the classic dab),
 *        mask: Uint8Array|null (document-sized selection), docW, docH, offsetX, offsetY}
 * Layer-local pixel (lx,ly) maps to document pixel (lx+offsetX, ly+offsetY).
 */
export function beginPaint(buf, opts) {
  const o = { mode: 'paint', opacity: 1, hardness: 0.8, offsetX: 0, offsetY: 0, mask: null, blend: 'normal', angle: 0, roundness: 1, ...opts };
  if (!BLEND_SET.has(o.blend)) o.blend = 'normal';
  return { buf, before: new Uint8ClampedArray(buf.data), cov: new Float32Array(buf.w * buf.h), opts: o, blend: o.blend === 'normal' ? null : o.blend };
}

// ---- Paint blend modes (W3C Compositing & Blending formulas, 0..1 channel values) ----

export const BLEND_MODES = ['normal', 'multiply', 'screen', 'overlay', 'softLight', 'hardLight', 'darken', 'lighten', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity', 'behind', 'clear'];
const BLEND_SET = new Set(BLEND_MODES);

const hardLight1 = (b, s) => s <= 0.5 ? b * 2 * s : b + (2 * s - 1) - b * (2 * s - 1);
const softLight1 = (b, s) => {
  if (s <= 0.5) return b - (1 - 2 * s) * b * (1 - b);
  const D = b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b);
  return b + (2 * s - 1) * (D - b);
};
/** Separable blend of one channel: b = backdrop, s = source (0..1). */
export function blendChannel(mode, b, s) {
  switch (mode) {
    case 'multiply': return b * s;
    case 'screen': return b + s - b * s;
    case 'overlay': return hardLight1(s, b);
    case 'hardLight': return hardLight1(b, s);
    case 'softLight': return softLight1(b, s);
    case 'darken': return Math.min(b, s);
    case 'lighten': return Math.max(b, s);
    case 'difference': return Math.abs(b - s);
    case 'exclusion': return b + s - 2 * b * s;
    default: return s;
  }
}
/** W3C luminosity (0.3/0.59/0.11) of [r,g,b] in 0..1. */
export const blendLum = c => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
export const blendSat = c => Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);
function clipColor(c) {
  const l = blendLum(c), n = Math.min(c[0], c[1], c[2]), x = Math.max(c[0], c[1], c[2]);
  if (n < 0) for (let k = 0; k < 3; k++) c[k] = l + (c[k] - l) * l / (l - n);
  if (x > 1) for (let k = 0; k < 3; k++) c[k] = l + (c[k] - l) * (1 - l) / (x - l);
  return c;
}
/** SetLum(c, l) → new array. */
export function setLum(c, l) { const d = l - blendLum(c); return clipColor([c[0] + d, c[1] + d, c[2] + d]); }
/** SetSat(c, s) → new array. */
export function setSat(c, s) {
  const o = [0, 0, 0], mx = Math.max(c[0], c[1], c[2]), mn = Math.min(c[0], c[1], c[2]);
  if (mx > mn) {
    const iMax = c[0] === mx ? 0 : c[1] === mx ? 1 : 2, iMin = c[0] === mn && iMax !== 0 ? 0 : c[1] === mn && iMax !== 1 ? 1 : 2, iMid = 3 - iMax - iMin;
    o[iMid] = (c[iMid] - mn) * s / (mx - mn); o[iMax] = s;
  }
  return o;
}
/** Non-separable blends (hue, saturation, color, luminosity); b, s = [r,g,b] 0..1 → new array. */
export function blendNonSep(mode, b, s) {
  switch (mode) {
    case 'hue': return setLum(setSat(s, blendSat(b)), blendLum(b));
    case 'saturation': return setLum(setSat(b, blendSat(s)), blendLum(b));
    case 'color': return setLum(s, blendLum(b));
    case 'luminosity': return setLum(b, blendLum(s));
    default: return [s[0], s[1], s[2]];
  }
}
const NONSEP = new Set(['hue', 'saturation', 'color', 'luminosity']);
const bb = [0, 0, 0], ss = [0, 0, 0];
/**
 * Composite source colour sc (0..255) with alpha sa (0..1) onto backdrop b[p..p+3] using `mode`,
 * writing to d[p..p+3]. W3C: Cs' = (1-ab)·Cs + ab·B(Cb,Cs), then source-over.
 */
function blendOver(mode, d, b, p, sc, sa, ba) {
  if (mode === 'clear') { d[p] = b[p]; d[p + 1] = b[p + 1]; d[p + 2] = b[p + 2]; d[p + 3] = Math.round(ba * (1 - sa) * 255); return; }
  if (mode === 'behind') {
    const oa = ba + sa * (1 - ba);
    if (oa <= 0) { d[p] = d[p + 1] = d[p + 2] = d[p + 3] = 0; return; }
    for (let c = 0; c < 3; c++) d[p + c] = Math.round((b[p + c] * ba + sc[c] * sa * (1 - ba)) / oa);
    d[p + 3] = Math.round(oa * 255);
    return;
  }
  const oa = sa + ba * (1 - sa);
  if (oa <= 0) { d[p] = d[p + 1] = d[p + 2] = d[p + 3] = 0; return; }
  for (let c = 0; c < 3; c++) { bb[c] = b[p + c] / 255; ss[c] = sc[c] / 255; }
  const B = NONSEP.has(mode) ? blendNonSep(mode, bb, ss) : null;
  for (let c = 0; c < 3; c++) {
    const mixed = (1 - ba) * ss[c] + ba * (B ? B[c] : blendChannel(mode, bb[c], ss[c]));
    d[p + c] = Math.round((mixed * 255 * sa + b[p + c] * ba * (1 - sa)) / oa);
  }
  d[p + 3] = Math.round(oa * 255);
}

function selAt(o, lx, ly) {
  if (!o.mask) return 1;
  const dx = lx + o.offsetX, dy = ly + o.offsetY;
  if (dx < 0 || dy < 0 || dx >= o.docW || dy >= o.docH) return 0;
  return o.mask[dy * o.docW + dx] / 255;
}

const px = [0, 0, 0, 0];
function compositePixel(ctx, i, lx, ly) {
  const o = ctx.opts, d = ctx.buf.data, b = ctx.before, p = i * 4;
  const eff = Math.min(1, ctx.cov[i]) * o.opacity * selAt(o, lx, ly);
  const ba = b[p + 3] / 255;
  if (o.process) {
    // retouch tools: move towards a per-pixel target computed from the stroke-start pixels
    const t = o.process(b, p, lx, ly, px);
    for (let c = 0; c < 4; c++) d[p + c] = Math.round(b[p + c] + (t[c] - b[p + c]) * eff);
    return;
  }
  if (o.source) {
    // per-pixel colour and alpha (clone stamp, gradients, fills from an image)
    const s = o.source(lx, ly, px), sa = s[3] / 255 * eff;
    if (ctx.blend) return blendOver(ctx.blend, d, b, p, s, sa, ba);
    const oa = sa + ba * (1 - sa);
    if (oa <= 0) { d[p] = d[p + 1] = d[p + 2] = d[p + 3] = 0; return; }
    for (let c = 0; c < 3; c++) d[p + c] = Math.round((s[c] * sa + b[p + c] * ba * (1 - sa)) / oa);
    d[p + 3] = Math.round(oa * 255);
    return;
  }
  if (o.mode === 'erase') {
    d[p] = b[p]; d[p + 1] = b[p + 1]; d[p + 2] = b[p + 2];
    d[p + 3] = Math.round(ba * (1 - eff) * 255);
    return;
  }
  if (ctx.blend) return blendOver(ctx.blend, d, b, p, o.color, eff, ba);
  const oa = eff + ba * (1 - eff);
  if (oa <= 0) { d[p] = d[p + 1] = d[p + 2] = d[p + 3] = 0; return; }
  for (let c = 0; c < 3; c++) d[p + c] = Math.round((o.color[c] * eff + b[p + c] * ba * (1 - eff)) / oa);
  d[p + 3] = Math.round(oa * 255);
}

/** Apply one dab in DOCUMENT coordinates. Returns the layer-local dirty rect or null. */
export function applyDab(ctx, dab) {
  const { buf, opts } = ctx;
  const ro = Math.min(1, Math.max(0.01, dab.roundness ?? opts.roundness ?? 1));
  if (ro < 1) return applyEllipticDab(ctx, dab, ro);
  const cx = dab.x - opts.offsetX, cy = dab.y - opts.offsetY, r = Math.max(0.5, dab.size / 2);
  const x0 = Math.max(0, Math.floor(cx - r)), y0 = Math.max(0, Math.floor(cy - r));
  const x1 = Math.min(buf.w, Math.ceil(cx + r)), y1 = Math.min(buf.h, Math.ceil(cy + r));
  if (x1 <= x0 || y1 <= y0) return null;
  const flow = dab.flow ?? 1;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const dist = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
    const a = (opts.aliased ? (dist <= r ? 1 : 0) : dabAlpha(dist, r, opts.hardness)) * flow;
    if (a <= 0) continue;
    const i = y * buf.w + x;
    ctx.cov[i] += (1 - ctx.cov[i]) * a;
    compositePixel(ctx, i, x, y);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Elliptical dab: major radius r along the tip angle, minor radius r·roundness. Along every ray
 * from the centre the classic radial falloff is applied with that ray's ellipse radius, so hardness
 * keeps its meaning and the edge gets ≥1 px of anti-aliasing all round.
 */
function applyEllipticDab(ctx, dab, ro) {
  const { buf, opts } = ctx;
  const cx = dab.x - opts.offsetX, cy = dab.y - opts.offsetY, r = Math.max(0.5, dab.size / 2), rm = Math.max(0.5, r * ro);
  // screen y points down, so a counter-clockwise angle is a negative screen rotation
  const a = -(dab.angle ?? opts.angle ?? 0) * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
  const ex = Math.sqrt((r * ca) ** 2 + (rm * sa) ** 2), ey = Math.sqrt((r * sa) ** 2 + (rm * ca) ** 2);
  const x0 = Math.max(0, Math.floor(cx - ex)), y0 = Math.max(0, Math.floor(cy - ey));
  const x1 = Math.min(buf.w, Math.ceil(cx + ex)), y1 = Math.min(buf.h, Math.ceil(cy + ey));
  if (x1 <= x0 || y1 <= y0) return null;
  const flow = dab.flow ?? 1, ir = 1 / r, irm = 1 / rm;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy, u = dx * ca + dy * sa, v = -dx * sa + dy * ca;
    // dn: normalised elliptical radius; rho / dn = the ellipse radius along this ray
    const dn = Math.hypot(u * ir, v * irm), rho = Math.hypot(u, v);
    const al = (opts.aliased ? (dn <= 1 ? 1 : 0) : dn === 0 ? 1 : dabAlpha(rho, rho / dn, opts.hardness)) * flow;
    if (al <= 0) continue;
    const i = y * buf.w + x;
    ctx.cov[i] += (1 - ctx.cov[i]) * al;
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
