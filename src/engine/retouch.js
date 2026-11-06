// Retouch tools built on the brush engine (raster.js): each returns a `process` or `source`
// callback for beginPaint(). Effects are computed from the stroke-start pixels, scaled by the
// stroke coverage × exposure/strength, so a stroke is deterministic and never runs away.

import { lum, clamp255 } from './color.js';

const rangeWeight = (range, l) => { const x = l / 255; return range === 'shadows' ? (1 - x) ** 2 : range === 'highlights' ? x * x : 1 - (2 * x - 1) ** 2; };

/** Dodge (lighten) or burn (darken) within a tonal range; protectTones keeps hue by scaling RGB together. */
export function toneProcess(kind, { range = 'midtones', protectTones = true } = {}) {
  return (b, p, lx, ly, out) => {
    const r = b[p], g = b[p + 1], bl = b[p + 2], l = lum(r, g, bl), w = rangeWeight(range, l);
    if (protectTones) {
      const nl = kind === 'dodge' ? l + (255 - l) * w : l * (1 - w), k = l > 0 ? nl / l : 0;
      out[0] = clamp255(kind === 'dodge' && l === 0 ? nl : r * k); out[1] = clamp255(kind === 'dodge' && l === 0 ? nl : g * k); out[2] = clamp255(kind === 'dodge' && l === 0 ? nl : bl * k);
    } else for (let c = 0; c < 3; c++) out[c] = kind === 'dodge' ? b[p + c] + (255 - b[p + c]) * w : b[p + c] * (1 - w);
    out[3] = b[p + 3];
    return out;
  };
}

/** Sponge: saturate pushes chroma away from grey, desaturate pulls it to grey. */
export function spongeProcess({ mode = 'desaturate' } = {}) {
  return (b, p, lx, ly, out) => {
    const l = lum(b[p], b[p + 1], b[p + 2]), k = mode === 'saturate' ? 2 : 0;
    for (let c = 0; c < 3; c++) out[c] = clamp255(l + (b[p + c] - l) * k);
    out[3] = b[p + 3];
    return out;
  };
}

function boxAt(b, w, h, lx, ly, r, out) {
  let R = 0, G = 0, B = 0, A = 0;
  for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
    const x = Math.min(w - 1, Math.max(0, lx + i)), y = Math.min(h - 1, Math.max(0, ly + j)), q = (y * w + x) * 4, a = b[q + 3];
    R += b[q] * a; G += b[q + 1] * a; B += b[q + 2] * a; A += a;
  }
  const n = (2 * r + 1) ** 2; out[3] = A / n;
  if (A) { out[0] = R / A; out[1] = G / A; out[2] = B / A; }
  return out;
}
/** Blur tool: local (2r+1)² average; Sharpen tool: unsharp against that average. */
export function blurProcess(w, h, { radius = 2 } = {}) { return (b, p, lx, ly, out) => boxAt(b, w, h, lx, ly, radius, out); }
export function sharpenProcess(w, h, { radius = 1, amount = 1 } = {}) {
  const tmp = [0, 0, 0, 0];
  return (b, p, lx, ly, out) => { boxAt(b, w, h, lx, ly, radius, tmp); for (let c = 0; c < 3; c++) out[c] = clamp255(b[p + c] + (b[p + c] - tmp[c]) * amount * 2); out[3] = b[p + 3]; return out; };
}

/** Clone source: pixels of `src` (stroke-start snapshot) shifted by (ox,oy) layer px. */
export function cloneSource(src, ox, oy) {
  return (lx, ly, out) => {
    const x = Math.round(lx - ox), y = Math.round(ly - oy);
    if (x < 0 || y < 0 || x >= src.w || y >= src.h) { out[0] = out[1] = out[2] = out[3] = 0; return out; }
    const q = (y * src.w + x) * 4; out[0] = src.data[q]; out[1] = src.data[q + 1]; out[2] = src.data[q + 2]; out[3] = src.data[q + 3];
    return out;
  };
}

/**
 * Smudge one dab: pixels under the dab are pulled from where the brush came from (prev dab),
 * weighted by brush alpha × strength. Operates on the working buffer; returns the dirty rect.
 */
export function smudgeDab(buf, dab, prev, strength, alphaAt, mask = null) {
  const r = Math.max(0.5, dab.size / 2), dx = dab.x - prev.x, dy = dab.y - prev.y;
  const x0 = Math.max(0, Math.floor(dab.x - r)), y0 = Math.max(0, Math.floor(dab.y - r)), x1 = Math.min(buf.w, Math.ceil(dab.x + r)), y1 = Math.min(buf.h, Math.ceil(dab.y + r));
  if (x1 <= x0 || y1 <= y0) return null;
  const d = buf.data, copy = new Uint8ClampedArray(d); // read from a stable copy to avoid feedback within the dab
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const a = alphaAt(Math.hypot(x + 0.5 - dab.x, y + 0.5 - dab.y), r) * strength * (mask ? mask(x, y) : 1);
    if (a <= 0) continue;
    const sx = Math.min(buf.w - 1, Math.max(0, Math.round(x - dx))), sy = Math.min(buf.h - 1, Math.max(0, Math.round(y - dy)));
    const p = (y * buf.w + x) * 4, q = (sy * buf.w + sx) * 4;
    for (let c = 0; c < 4; c++) d[p + c] = copy[p + c] + (copy[q + c] - copy[p + c]) * a;
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Healing (Poisson blending): inside `region` (Uint8 0/255, layer-sized) replace pixels with the
 * source texture offset by (ox,oy) while matching the destination at the region boundary.
 * Solves Δf = Δsource with Dirichlet boundary = destination, by Gauss-Seidel/SOR on the region's
 * bounding box. Alpha is copied from the destination.
 */
export function heal(buf, region, ox, oy, iterations = 400) {
  const { w, h, data: d } = buf; let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (region[y * w + x]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  if (x1 < 0) return null;
  x0 = Math.max(1, x0); y0 = Math.max(1, y0); x1 = Math.min(w - 2, x1); y1 = Math.min(h - 2, y1);
  const src = (x, y, c) => { const sx = Math.min(w - 1, Math.max(0, x - ox)), sy = Math.min(h - 1, Math.max(0, y - oy)); return d[(sy * w + sx) * 4 + c]; };
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1, f = new Float32Array(bw * bh * 3), lap = new Float32Array(bw * bh * 3);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) for (let c = 0; c < 3; c++) {
    const k = ((y - y0) * bw + x - x0) * 3 + c;
    f[k] = region[y * w + x] ? src(x, y, c) : d[(y * w + x) * 4 + c];
    lap[k] = 4 * src(x, y, c) - src(x - 1, y, c) - src(x + 1, y, c) - src(x, y - 1, c) - src(x, y + 1, c);
  }
  const val = (x, y, c) => (x < x0 || x > x1 || y < y0 || y > y1) ? d[(y * w + x) * 4 + c] : f[((y - y0) * bw + x - x0) * 3 + c];
  const omega = 1.9;
  for (let it = 0; it < iterations; it++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (!region[y * w + x]) continue;
    for (let c = 0; c < 3; c++) {
      const k = ((y - y0) * bw + x - x0) * 3 + c;
      const gs = (val(x - 1, y, c) + val(x + 1, y, c) + val(x, y - 1, c) + val(x, y + 1, c) + lap[k]) / 4;
      f[k] += omega * (gs - f[k]);
    }
  }
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (region[y * w + x]) for (let c = 0; c < 3; c++) d[(y * w + x) * 4 + c] = clamp255(f[((y - y0) * bw + x - x0) * 3 + c]);
  return { x: x0, y: y0, w: bw, h: bh };
}

/**
 * Spot healing source search: try offsets on rings around the region and keep the one whose
 * shifted boundary band best matches the destination band (sum of squared differences), so the
 * borrowed texture already fits its surroundings before Poisson blending.
 */
export function findHealSource(buf, region) {
  const { w, h, data: d } = buf; let x0 = w, y0 = h, x1 = -1, y1 = -1, band = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (region[y * w + x]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  if (x1 < 0) return null;
  // boundary band: pixels outside the region within 3 px of it
  for (let y = Math.max(0, y0 - 3); y <= Math.min(h - 1, y1 + 3); y++) for (let x = Math.max(0, x0 - 3); x <= Math.min(w - 1, x1 + 3); x++) {
    if (region[y * w + x]) continue;
    let near = false; for (let j = -3; j <= 3 && !near; j++) for (let i = -3; i <= 3; i++) { const xx = x + i, yy = y + j; if (xx >= 0 && yy >= 0 && xx < w && yy < h && region[yy * w + xx]) { near = true; break; } }
    if (near) band.push(x, y);
  }
  const size = Math.max(x1 - x0, y1 - y0) + 1;
  let best = null, bestCost = Infinity;
  for (const dist of [1.2, 1.6, 2.2, 3]) for (let k = 0; k < 16; k++) {
    const a = k / 16 * 2 * Math.PI, ox = Math.round(Math.cos(a) * size * dist), oy = Math.round(Math.sin(a) * size * dist);
    if (x0 - ox < 0 || y0 - oy < 0 || x1 - ox >= w || y1 - oy >= h) continue;
    let cost = 0;
    for (let i = 0; i < band.length; i += 2) { const x = band[i], y = band[i + 1], sx = x - ox, sy = y - oy; if (sx < 0 || sy < 0 || sx >= w || sy >= h) { cost += 3 * 255 * 255; continue; } const p = (y * w + x) * 4, q = (sy * w + sx) * 4; for (let c = 0; c < 3; c++) cost += (d[p + c] - d[q + c]) ** 2; }
    // the source area itself should not overlap the region
    if (cost < bestCost) { bestCost = cost; best = [ox, oy]; }
  }
  return best;
}
