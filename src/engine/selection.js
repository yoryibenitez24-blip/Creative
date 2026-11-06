// Pixel selection engine.
//
// A selection is an immutable descriptor {ops:[...]} applied in order to an
// 8-bit document-sized mask (0 = unselected, 255 = fully selected). Keeping the
// descriptor (not the pixels) in document state makes undo snapshots cheap and
// the result deterministic; the mask is derived and cached per descriptor.
//
// Ops: {op:'replace'|'add'|'subtract'|'intersect', shape, feather}
//      {op:'invert'} {op:'feather', radius}
// Shapes (document pixel coordinates):
//      {type:'rect',x,y,w,h} {type:'ellipse',x,y,w,h} {type:'polygon',points:[x0,y0,x1,y1,...]} {type:'all'}
//
// Combination is fuzzy-set algebra on coverage in [0,1]:
//   add = max(a,s)   subtract = min(a,1-s)   intersect = min(a,s)
// Feather is a Gaussian approximated by three box-blur passes, sigma = radius/2.

export const SUBROWS = 4; // vertical supersampling for curved / polygon edges

export const MODES = ['replace', 'add', 'subtract', 'intersect'];

export function appendOp(selection, op) {
  if (op.op === 'replace') return { ops: [op] };
  if (!selection) {
    if (op.op === 'add') return { ops: [{ ...op, op: 'replace' }] };
    if (op.op === 'invert') return { ops: [{ op: 'replace', shape: { type: 'all' } }, op] };
    return null; // subtract / intersect / feather on nothing → nothing
  }
  return { ops: [...selection.ops, op] };
}

// Exact horizontal coverage of pixel column px by span [a,b].
function addSpan(row, w, a, b, weight) {
  if (b <= a) return;
  a = Math.max(0, a); b = Math.min(w, b);
  if (b <= a) return;
  const ia = Math.floor(a), ib = Math.floor(b);
  if (ia === ib) { row[ia] += (b - a) * weight; return; }
  row[ia] += (ia + 1 - a) * weight;
  for (let x = ia + 1; x < ib; x++) row[x] += weight;
  if (ib < w) row[ib] += (b - ib) * weight;
}

/** Rasterize a shape to Float32 coverage over the full W×H grid. */
export function rasterizeShape(shape, W, H) {
  const out = new Float32Array(W * H);
  if (shape.type === 'all') { out.fill(1); return out; }
  if (shape.type === 'bitmap') {
    const vals = decodeRle(shape.rle, shape.w * shape.h);
    for (let y = 0; y < shape.h; y++) { const ty = y + shape.y; if (ty < 0 || ty >= H) continue; for (let x = 0; x < shape.w; x++) { const tx = x + shape.x; if (tx >= 0 && tx < W) out[ty * W + tx] = vals[y * shape.w + x] / 255; } }
    return out;
  }
  if (shape.type === 'rect') {
    let { x, y, w, h } = shape;
    if (w < 0) { x += w; w = -w; }
    if (h < 0) { y += h; h = -h; }
    const y0 = Math.max(0, Math.floor(y)), y1 = Math.min(H, Math.ceil(y + h));
    const row = new Float32Array(W);
    addSpan(row, W, x, x + w, 1);
    for (let py = y0; py < y1; py++) {
      const vy = Math.min(py + 1, y + h) - Math.max(py, y);
      if (vy <= 0) continue;
      for (let px = 0; px < W; px++) if (row[px]) out[py * W + px] = row[px] * vy;
    }
    return out;
  }
  // Curved / polygon shapes: SUBROWS scanlines per pixel row, exact in x.
  const row = new Float32Array(W);
  const weight = 1 / SUBROWS;
  let spansAt;
  let yMin, yMax;
  if (shape.type === 'ellipse') {
    let { x, y, w, h } = shape;
    if (w < 0) { x += w; w = -w; }
    if (h < 0) { y += h; h = -h; }
    const cx = x + w / 2, cy = y + h / 2, rx = w / 2, ry = h / 2;
    yMin = y; yMax = y + h;
    spansAt = sy => {
      const t = (sy - cy) / ry;
      if (rx <= 0 || ry <= 0 || t * t >= 1) return [];
      const dx = rx * Math.sqrt(1 - t * t);
      return [cx - dx, cx + dx];
    };
  } else if (shape.type === 'polygon') {
    const p = shape.points;
    const n = p.length / 2;
    if (n < 3) return out;
    yMin = Infinity; yMax = -Infinity;
    for (let i = 1; i < p.length; i += 2) { yMin = Math.min(yMin, p[i]); yMax = Math.max(yMax, p[i]); }
    spansAt = sy => {
      // non-zero winding fill
      const xs = [];
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = p[2 * i], yi = p[2 * i + 1], xj = p[2 * j], yj = p[2 * j + 1];
        if ((yi <= sy) !== (yj <= sy)) xs.push([xi + (sy - yi) / (yj - yi) * (xj - xi), yj > yi ? 1 : -1]);
      }
      xs.sort((a, b) => a[0] - b[0]);
      const spans = [];
      let wind = 0;
      for (let k = 0; k < xs.length; k++) {
        const before = wind;
        wind += xs[k][1];
        if (before === 0 && wind !== 0) spans.push(xs[k][0]);
        else if (before !== 0 && wind === 0) spans.push(xs[k][0]);
      }
      return spans;
    };
  } else throw Error('Unknown selection shape ' + shape.type);
  const y0 = Math.max(0, Math.floor(yMin)), y1 = Math.min(H, Math.ceil(yMax));
  for (let py = y0; py < y1; py++) {
    row.fill(0);
    let any = false;
    for (let s = 0; s < SUBROWS; s++) {
      const spans = spansAt(py + (s + 0.5) / SUBROWS);
      for (let k = 0; k + 1 < spans.length; k += 2) { addSpan(row, W, spans[k], spans[k + 1], weight); any = true; }
    }
    if (any) { const o = py * W; for (let x = 0; x < W; x++) if (row[x]) out[o + x] = row[x] < 1 ? row[x] : 1; }
  }
  return out;
}

function boxBlurH(src, dst, W, H, r) {
  const d = 2 * r + 1;
  for (let y = 0; y < H; y++) {
    const o = y * W;
    let acc = 0;
    for (let x = -r - 1; x < r; x++) acc += src[o + Math.min(W - 1, Math.max(0, x))];
    for (let x = 0; x < W; x++) {
      acc += src[o + Math.min(W - 1, x + r)] - src[o + Math.max(0, x - r - 1)];
      dst[o + x] = acc / d;
    }
  }
}
function boxBlurV(src, dst, W, H, r) {
  const d = 2 * r + 1;
  for (let x = 0; x < W; x++) {
    let acc = 0;
    for (let y = -r - 1; y < r; y++) acc += src[Math.min(H - 1, Math.max(0, y)) * W + x];
    for (let y = 0; y < H; y++) {
      acc += src[Math.min(H - 1, y + r) * W + x] - src[Math.max(0, y - r - 1) * W + x];
      dst[y * W + x] = acc / d;
    }
  }
}

// Three box passes whose combined variance matches sigma² (mixing two odd box widths,
// after W. Jarosz / P. Kovesi). sigma = radius / 2. Returns the three box radii.
export function boxRadii(radius) {
  const sigma = radius / 2, n = 3;
  let wl = Math.floor(Math.sqrt(12 * sigma * sigma / n + 1));
  if (wl % 2 === 0) wl--;
  wl = Math.max(1, wl);
  const wu = wl + 2;
  const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
  return [0, 1, 2].map(i => ((i < m ? wl : wu) - 1) / 2);
}

function nonZeroBounds(buf, W, H) {
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) {
    const o = y * W;
    for (let x = 0; x < W; x++) if (buf[o + x] !== 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; }
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

/**
 * Gaussian-like feather (3 box passes, sigma ≈ radius/2), edge-clamped at the document border.
 * Work is limited to the non-zero region padded by the kernel reach, so cost scales with the
 * selection size rather than the document size. Values outside that padded region stay 0.
 */
export function feather(buf, W, H, radius, bounds) {
  if (!(radius > 0)) return buf;
  const radii = boxRadii(radius);
  const r = Math.max(...radii);
  const b = bounds || nonZeroBounds(buf, W, H);
  if (!b) return buf;
  const pad = 3 * r + 1;
  const x0 = Math.max(0, b.x0 - pad), y0 = Math.max(0, b.y0 - pad), x1 = Math.min(W, b.x1 + pad), y1 = Math.min(H, b.y1 + pad);
  const w = x1 - x0, h = y1 - y0;
  // Clamping at the sub-region border equals zero-padding (the border is 0) except where the
  // region touches the document edge, where it matches full-canvas edge clamping.
  const sub = new Float32Array(w * h), tmp = new Float32Array(w * h);
  for (let y = 0; y < h; y++) sub.set(buf.subarray((y + y0) * W + x0, (y + y0) * W + x1), y * w);
  for (const ri of radii) if (ri > 0) { boxBlurH(sub, tmp, w, h, ri); boxBlurV(tmp, sub, w, h, ri); }
  for (let y = 0; y < h; y++) buf.set(sub.subarray(y * w, (y + 1) * w), (y + y0) * W + x0);
  return buf;
}

function shapeBounds(shape, W, H) {
  let xs, ys;
  if (shape.type === 'polygon') { xs = shape.points.filter((_, i) => i % 2 === 0); ys = shape.points.filter((_, i) => i % 2 === 1); }
  else if (shape.type === 'all') return { x0: 0, y0: 0, x1: W, y1: H };
  else if (shape.type === 'bitmap') { xs = [shape.x, shape.x + shape.w]; ys = [shape.y, shape.y + shape.h]; }
  else { xs = [shape.x, shape.x + shape.w]; ys = [shape.y, shape.y + shape.h]; }
  const b = { x0: Math.max(0, Math.floor(Math.min(...xs))), y0: Math.max(0, Math.floor(Math.min(...ys))), x1: Math.min(W, Math.ceil(Math.max(...xs))), y1: Math.min(H, Math.ceil(Math.max(...ys))) };
  return b.x1 > b.x0 && b.y1 > b.y0 ? b : null;
}

// ---------- pixel selections (magic wand, colour range, mask → selection) ----------
/** Run-length encode 0..255 values as base64 of [value, runLength≤255] byte pairs. */
export function encodeRle(vals) {
  const bytes = [];
  for (let i = 0; i < vals.length;) { const v = vals[i]; let n = 1; while (n < 255 && i + n < vals.length && vals[i + n] === v) n++; bytes.push(v, n); i += n; }
  let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.slice(i, i + 0x8000));
  return btoa(s);
}
export function decodeRle(b64, n) {
  const s = atob(b64), out = new Uint8Array(n); let o = 0;
  for (let i = 0; i + 1 < s.length && o < n; i += 2) { const v = s.charCodeAt(i), c = s.charCodeAt(i + 1); out.fill(v, o, Math.min(n, o + c)); o += c; }
  return out;
}
/** Crop a document-sized 0..255 mask to its bounds and store it as a serialisable bitmap shape. */
export function bitmapShape(mask, W, H) {
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (mask[y * W + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; }
  if (x1 < 0) return null;
  const w = x1 - x0 + 1, h = y1 - y0 + 1, vals = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) vals.set(mask.subarray((y + y0) * W + x0, (y + y0) * W + x0 + w), y * w);
  return { type: 'bitmap', x: x0, y: y0, w, h, rle: encodeRle(vals) };
}

// ---------- Select > Modify ----------
// Exact Euclidean distance transform (Felzenszwalb & Huttenlocher) of a binary image.
function edt1d(f, n, out, v, z) {
  let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s; do { const p = v[k]; s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * q - 2 * p); } while (s <= z[k] && --k >= 0);
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0; for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; out[q] = (q - v[k]) ** 2 + f[v[k]]; }
}
/** Squared distance from each pixel to the nearest pixel where `on(i)` is true. */
export function distanceTransform(W, H, on) {
  const INF = 1e20, d = new Float64Array(W * H), n = Math.max(W, H), f = new Float64Array(n), o = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let i = 0; i < W * H; i++) d[i] = on(i) ? 0 : INF;
  for (let x = 0; x < W; x++) { for (let y = 0; y < H; y++) f[y] = d[y * W + x]; edt1d(f, H, o, v, z); for (let y = 0; y < H; y++) d[y * W + x] = o[y]; }
  for (let y = 0; y < H; y++) { for (let x = 0; x < W; x++) f[x] = d[y * W + x]; edt1d(f, W, o, v, z); for (let x = 0; x < W; x++) d[y * W + x] = o[x]; }
  return d;
}
/** expand/contract by radius px (round), border = band of width radius around the edge, smooth = rounds corners. */
function modify(acc, W, H, kind, radius) {
  const r = Math.max(0, radius), out = new Float32Array(W * H);
  if (kind === 'smooth') { const t = Float32Array.from(acc); feather(t, W, H, r * 2); for (let i = 0; i < t.length; i++) out[i] = t[i] >= 0.5 ? 1 : 0; return out; }
  const inside = distanceTransform(W, H, i => acc[i] >= 0.5), outside = distanceTransform(W, H, i => acc[i] < 0.5);
  for (let i = 0; i < out.length; i++) {
    // centre-to-centre distances; the selection edge lies half a pixel from the nearest centre
    const dIn = Math.sqrt(inside[i]), dOut = Math.sqrt(outside[i]); // to nearest selected / unselected pixel
    if (kind === 'expand') out[i] = acc[i] >= 0.5 ? acc[i] : Math.max(0, Math.min(1, r + 1 - dIn));
    else if (kind === 'contract') out[i] = acc[i] < 0.5 ? 0 : Math.max(0, Math.min(1, dOut - r)) * acc[i];
    else { const dist = acc[i] >= 0.5 ? dOut : dIn; out[i] = Math.max(0, Math.min(1, r / 2 + 1 - dist)); }
  }
  return out;
}

const cache = new WeakMap();

/** Returns Uint8Array(W*H) mask, or null when nothing is selected (= everything editable). */
export function computeMask(selection, W, H) {
  if (!selection || !selection.ops?.length) return null;
  const hit = cache.get(selection);
  if (hit && hit.W === W && hit.H === H) return hit.mask;
  let acc = new Float32Array(W * H);
  for (const op of selection.ops) {
    if (op.op === 'invert') { for (let i = 0; i < acc.length; i++) acc[i] = 1 - acc[i]; continue; }
    if (op.op === 'feather') { feather(acc, W, H, op.radius); continue; }
    if (op.op === 'expand' || op.op === 'contract' || op.op === 'border' || op.op === 'smooth') { acc = modify(acc, W, H, op.op, op.radius); continue; }
    const s = rasterizeShape(op.shape, W, H);
    if (op.feather > 0) feather(s, W, H, op.feather, shapeBounds(op.shape, W, H));
    if (op.op === 'replace') acc = s;
    else if (op.op === 'add') for (let i = 0; i < acc.length; i++) acc[i] = Math.max(acc[i], s[i]);
    else if (op.op === 'subtract') for (let i = 0; i < acc.length; i++) acc[i] = Math.min(acc[i], 1 - s[i]);
    else if (op.op === 'intersect') for (let i = 0; i < acc.length; i++) acc[i] = Math.min(acc[i], s[i]);
  }
  const mask = new Uint8Array(W * H);
  for (let i = 0; i < mask.length; i++) mask[i] = Math.round(Math.max(0, Math.min(1, acc[i])) * 255);
  cache.set(selection, { W, H, mask });
  return mask;
}

export function maskBounds(mask, W, H) {
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (mask[y * W + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export function isEmptyMask(mask) { if (!mask) return false; for (let i = 0; i < mask.length; i++) if (mask[i]) return false; return true; }

/** SVG path of the 50% boundary ("marching ants"), merged into straight runs. Scans only the mask bounds. */
export function maskOutline(mask, W, H, threshold = 128) {
  if (!mask) return '';
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) { const o = y * W; for (let x = 0; x < W; x++) if (mask[o + x] >= threshold) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; } }
  if (x1 < 0) return '';
  x1++; y1++;
  const inside = (x, y) => x >= x0 && y >= y0 && x < x1 && y < y1 && mask[y * W + x] >= threshold;
  const parts = [];
  for (let y = y0; y <= y1; y++) {
    let start = -1;
    for (let x = x0; x <= x1; x++) {
      const edge = x < x1 && inside(x, y) !== inside(x, y - 1);
      if (edge && start < 0) start = x;
      else if (!edge && start >= 0) { parts.push(`M${start} ${y}h${x - start}`); start = -1; }
    }
  }
  for (let x = x0; x <= x1; x++) {
    let start = -1;
    for (let y = y0; y <= y1; y++) {
      const edge = y < y1 && inside(x, y) !== inside(x - 1, y);
      if (edge && start < 0) start = y;
      else if (!edge && start >= 0) { parts.push(`M${x} ${start}v${y - start}`); start = -1; }
    }
  }
  return parts.join('');
}
