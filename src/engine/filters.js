// Filter menu: original implementations of the classic filter families on straight-alpha
// RGBA8 buffers. Neighbourhood filters work on premultiplied alpha so transparent pixels
// never darken edges. Each returns a buffer (usually the same object, mutated).

import { boxRadii } from './selection.js';
import { clamp255, lum, rng, hash2, hexToRgb } from './color.js';

// ---------- helpers ----------
function toPremul(buf) {
  const d = buf.data, f = new Float32Array(d.length);
  for (let i = 0; i < d.length; i += 4) { const a = d[i + 3] / 255; f[i] = d[i] * a; f[i + 1] = d[i + 1] * a; f[i + 2] = d[i + 2] * a; f[i + 3] = d[i + 3]; }
  return f;
}
function fromPremul(f, buf) {
  const d = buf.data;
  for (let i = 0; i < d.length; i += 4) { const a = f[i + 3]; d[i + 3] = clamp255(Math.round(a)); if (a > 0.5) { const k = 255 / a; d[i] = clamp255(f[i] * k); d[i + 1] = clamp255(f[i + 1] * k); d[i + 2] = clamp255(f[i + 2] * k); } }
  return buf;
}
function boxH(src, dst, w, h, r) {
  const d = 2 * r + 1;
  for (let y = 0; y < h; y++) for (let c = 0; c < 4; c++) {
    const o = y * w * 4 + c; let acc = 0;
    for (let x = -r - 1; x < r; x++) acc += src[o + Math.min(w - 1, Math.max(0, x)) * 4];
    for (let x = 0; x < w; x++) { acc += src[o + Math.min(w - 1, x + r) * 4] - src[o + Math.max(0, x - r - 1) * 4]; dst[o + x * 4] = acc / d; }
  }
}
function boxV(src, dst, w, h, r) {
  const d = 2 * r + 1, s = w * 4;
  for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++) {
    const o = x * 4 + c; let acc = 0;
    for (let y = -r - 1; y < r; y++) acc += src[o + Math.min(h - 1, Math.max(0, y)) * s];
    for (let y = 0; y < h; y++) { acc += src[o + Math.min(h - 1, y + r) * s] - src[o + Math.max(0, y - r - 1) * s]; dst[o + y * s] = acc / d; }
  }
}
/** Gaussian (sigma = radius) on a premultiplied float buffer, in place. */
function gaussPremul(f, w, h, radius) {
  if (!(radius > 0)) return f;
  const tmp = new Float32Array(f.length);
  for (const r of boxRadii(radius * 2)) if (r > 0) { boxH(f, tmp, w, h, r); boxV(tmp, f, w, h, r); }
  return f;
}
const copyBuf = buf => ({ w: buf.w, h: buf.h, data: new Uint8ClampedArray(buf.data) });
/** Bilinear sample with edge clamp (or transparent outside when clampEdge=false). */
function sampler(buf, clampEdge = true) {
  const { w, h, data: d } = buf;
  return (x, y, out) => {
    x -= 0.5; y -= 0.5;
    if (!clampEdge && (x < -1 || y < -1 || x > w || y > h)) { out[0] = out[1] = out[2] = out[3] = 0; return out; }
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    out[0] = out[1] = out[2] = out[3] = 0;
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
      let xx = x0 + i, yy = y0 + j;
      const wgt = (i ? fx : 1 - fx) * (j ? fy : 1 - fy);
      if (wgt === 0) continue;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) { if (!clampEdge) continue; xx = Math.min(w - 1, Math.max(0, xx)); yy = Math.min(h - 1, Math.max(0, yy)); }
      const p = (yy * w + xx) * 4, a = d[p + 3] * wgt;
      out[0] += d[p] * a; out[1] += d[p + 1] * a; out[2] += d[p + 2] * a; out[3] += a;
    }
    if (out[3] > 0) { out[0] /= out[3]; out[1] /= out[3]; out[2] /= out[3]; }
    return out;
  };
}
/** Inverse-mapped distortion: map(x,y) returns source coords for destination pixel centre. */
function remap(buf, map, clampEdge = true) {
  const src = copyBuf(buf), s = sampler(src, clampEdge), d = buf.data, o = [0, 0, 0, 0];
  for (let y = 0; y < buf.h; y++) for (let x = 0; x < buf.w; x++) {
    const [sx, sy] = map(x + 0.5, y + 0.5);
    s(sx, sy, o); const p = (y * buf.w + x) * 4;
    d[p] = o[0]; d[p + 1] = o[1]; d[p + 2] = o[2]; d[p + 3] = o[3];
  }
  return buf;
}
function convolve(buf, k, size, { scale, offset = 0, keepAlpha = true } = {}) {
  const src = new Uint8ClampedArray(buf.data), d = buf.data, { w, h } = buf, half = size >> 1;
  const sum = scale ?? (k.reduce((a, v) => a + v, 0) || 1);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0;
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
      const kv = k[j * size + i]; if (!kv) continue;
      const xx = Math.min(w - 1, Math.max(0, x + i - half)), yy = Math.min(h - 1, Math.max(0, y + j - half)), p = (yy * w + xx) * 4;
      r += src[p] * kv; g += src[p + 1] * kv; b += src[p + 2] * kv;
    }
    const p = (y * w + x) * 4;
    d[p] = r / sum + offset; d[p + 1] = g / sum + offset; d[p + 2] = b / sum + offset;
    if (!keepAlpha) d[p + 3] = 255;
  }
  return buf;
}

// ---------- blur ----------
export function gaussianBlur(buf, { radius = 4 }) { return fromPremul(gaussPremul(toPremul(buf), buf.w, buf.h, radius), buf); }
export function boxBlur(buf, { radius = 4 }) {
  const f = toPremul(buf), tmp = new Float32Array(f.length), r = Math.max(0, Math.round(radius));
  if (r) { boxH(f, tmp, buf.w, buf.h, r); boxV(tmp, f, buf.w, buf.h, r); }
  return fromPremul(f, buf);
}
/** Average along a line of `distance` px at `angle` degrees (premultiplied). */
export function motionBlur(buf, { angle = 0, distance = 20 }) {
  const n = Math.max(1, Math.round(distance)), a = angle * Math.PI / 180, dx = Math.cos(a), dy = -Math.sin(a);
  const src = copyBuf(buf), s = sampler(src), d = buf.data, o = [0, 0, 0, 0];
  for (let y = 0; y < buf.h; y++) for (let x = 0; x < buf.w; x++) {
    let r = 0, g = 0, b = 0, al = 0;
    for (let k = 0; k <= n; k++) { const t = k - n / 2; s(x + 0.5 + dx * t, y + 0.5 + dy * t, o); r += o[0] * o[3]; g += o[1] * o[3]; b += o[2] * o[3]; al += o[3]; }
    const p = (y * buf.w + x) * 4; d[p + 3] = al / (n + 1); if (al > 0) { d[p] = r / al; d[p + 1] = g / al; d[p + 2] = b / al; }
  }
  return buf;
}
/** Radial blur: spin (arc around centre) or zoom (towards centre). Centre in 0..1 of the layer. */
export function radialBlur(buf, { amount = 10, mode = 'spin', cx = 0.5, cy = 0.5 }) {
  const src = copyBuf(buf), s = sampler(src), d = buf.data, o = [0, 0, 0, 0], X = cx * buf.w, Y = cy * buf.h, n = 24;
  for (let y = 0; y < buf.h; y++) for (let x = 0; x < buf.w; x++) {
    const vx = x + 0.5 - X, vy = y + 0.5 - Y; let r = 0, g = 0, b = 0, al = 0;
    for (let k = 0; k < n; k++) {
      const t = (k / (n - 1) - 0.5);
      let sx, sy;
      if (mode === 'spin') { const ang = t * amount * Math.PI / 180, c = Math.cos(ang), si = Math.sin(ang); sx = X + vx * c - vy * si; sy = Y + vx * si + vy * c; }
      else { const z = 1 + t * amount / 100; sx = X + vx * z; sy = Y + vy * z; }
      s(sx, sy, o); r += o[0] * o[3]; g += o[1] * o[3]; b += o[2] * o[3]; al += o[3];
    }
    const p = (y * buf.w + x) * 4; d[p + 3] = al / n; if (al > 0) { d[p] = r / al; d[p + 1] = g / al; d[p + 2] = b / al; }
  }
  return buf;
}

// ---------- sharpen ----------
export function unsharpMask(buf, { amount = 100, radius = 1.5, threshold = 0 }) {
  const blurred = gaussianBlur(copyBuf(buf), { radius }).data, d = buf.data, k = amount / 100;
  for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) {
    const diff = d[i + c] - blurred[i + c];
    if (Math.abs(diff) >= threshold) d[i + c] = clamp255(d[i + c] + diff * k);
  }
  return buf;
}
export const sharpen = buf => convolve(buf, [0, -1, 0, -1, 8, -1, 0, -1, 0], 3, { scale: 4 });
export const sharpenMore = buf => convolve(buf, [-1, -1, -1, -1, 12, -1, -1, -1, -1], 3, { scale: 4 });
export function highPass(buf, { radius = 10 }) {
  const blurred = gaussianBlur(copyBuf(buf), { radius }).data, d = buf.data;
  for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) d[i + c] = clamp255(128 + d[i + c] - blurred[i + c]);
  return buf;
}

// ---------- noise ----------
/** Add Noise: amount %, uniform or gaussian, monochromatic option, deterministic per pixel & seed. */
export function addNoise(buf, { amount = 10, distribution = 'gaussian', monochromatic = false, seed = 1 }, ctx = {}) {
  const d = buf.data, k = amount / 100 * 255, ox = ctx.offsetX || 0, oy = ctx.offsetY || 0;
  const sample = (x, y, c) => { const u = hash2(x, y, seed * 7 + c); if (distribution === 'uniform') return (u - 0.5) * 2; const v = hash2(x, y, seed * 7 + c + 3) || 1e-9; return Math.sqrt(-2 * Math.log(v)) * Math.cos(2 * Math.PI * u) * 0.5; };
  for (let y = 0; y < buf.h; y++) for (let x = 0; x < buf.w; x++) {
    const p = (y * buf.w + x) * 4; if (!d[p + 3]) continue;
    const m = monochromatic ? sample(x + ox, y + oy, 0) : 0;
    for (let c = 0; c < 3; c++) d[p + c] = clamp255(d[p + c] + k * (monochromatic ? m : sample(x + ox, y + oy, c)));
  }
  return buf;
}
/** Median per channel over a square window (sliding histogram, Huang). */
export function median(buf, { radius = 1 }) {
  const r = Math.max(1, Math.round(radius)), { w, h } = buf, src = new Uint8ClampedArray(buf.data), d = buf.data, n = (2 * r + 1) ** 2, half = n >> 1;
  for (let c = 0; c < 4; c++) for (let y = 0; y < h; y++) {
    const hist = new Uint32Array(256);
    const add = (x, s) => { for (let j = -r; j <= r; j++) { const yy = Math.min(h - 1, Math.max(0, y + j)), xx = Math.min(w - 1, Math.max(0, x)); hist[src[(yy * w + xx) * 4 + c]] += s; } };
    for (let i = -r; i <= r; i++) add(i, 1);
    for (let x = 0; x < w; x++) {
      let acc = 0, v = 0; while (v < 255 && acc + hist[v] <= half) acc += hist[v++];
      d[(y * w + x) * 4 + c] = v;
      add(x - r, -1); add(x + r + 1, 1);
    }
  }
  return buf;
}
/** Dust & Scratches: median only where it differs from the pixel by more than threshold. */
export function dustScratches(buf, { radius = 2, threshold = 10 }) {
  const med = median(copyBuf(buf), { radius }).data, d = buf.data;
  for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 4; c++) if (Math.abs(med[i + c] - d[i + c]) > threshold) d[i + c] = med[i + c];
  return buf;
}
/** Despeckle: 3×3 median applied away from strong edges (Sobel < threshold). */
export function despeckle(buf) {
  const med = median(copyBuf(buf), { radius: 1 }).data, src = new Uint8ClampedArray(buf.data), d = buf.data, { w, h } = buf;
  const L = (x, y) => { x = Math.min(w - 1, Math.max(0, x)); y = Math.min(h - 1, Math.max(0, y)); const p = (y * w + x) * 4; return lum(src[p], src[p + 1], src[p + 2]); };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const gx = L(x + 1, y - 1) + 2 * L(x + 1, y) + L(x + 1, y + 1) - L(x - 1, y - 1) - 2 * L(x - 1, y) - L(x - 1, y + 1);
    const gy = L(x - 1, y + 1) + 2 * L(x, y + 1) + L(x + 1, y + 1) - L(x - 1, y - 1) - 2 * L(x, y - 1) - L(x + 1, y - 1);
    if (Math.hypot(gx, gy) < 120) { const p = (y * w + x) * 4; for (let c = 0; c < 3; c++) d[p + c] = med[p + c]; }
  }
  return buf;
}

// ---------- other ----------
function minMax(buf, radius, pick) {
  const r = Math.max(1, Math.round(radius)), { w, h } = buf, d = buf.data, tmp = new Uint8ClampedArray(d.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) { let v = d[(y * w + x) * 4 + c]; for (let i = -r; i <= r; i++) v = pick(v, d[(y * w + Math.min(w - 1, Math.max(0, x + i))) * 4 + c]); tmp[(y * w + x) * 4 + c] = v; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) { let v = tmp[(y * w + x) * 4 + c]; for (let j = -r; j <= r; j++) v = pick(v, tmp[(Math.min(h - 1, Math.max(0, y + j)) * w + x) * 4 + c]); d[(y * w + x) * 4 + c] = v; }
  return buf;
}
export const minimum = (buf, { radius = 1 }) => minMax(buf, radius, Math.min);
export const maximum = (buf, { radius = 1 }) => minMax(buf, radius, Math.max);
/** Offset with wrap-around, edge repeat or transparent fill. */
export function offset(buf, { dx = 0, dy = 0, edge = 'wrap' }) {
  const { w, h } = buf, src = new Uint8ClampedArray(buf.data), d = buf.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let sx = x - Math.round(dx), sy = y - Math.round(dy); const p = (y * w + x) * 4;
    if (edge === 'wrap') { sx = ((sx % w) + w) % w; sy = ((sy % h) + h) % h; }
    else if (edge === 'repeat') { sx = Math.min(w - 1, Math.max(0, sx)); sy = Math.min(h - 1, Math.max(0, sy)); }
    else if (sx < 0 || sy < 0 || sx >= w || sy >= h) { d[p] = d[p + 1] = d[p + 2] = d[p + 3] = 0; continue; }
    const q = (sy * w + sx) * 4; d[p] = src[q]; d[p + 1] = src[q + 1]; d[p + 2] = src[q + 2]; d[p + 3] = src[q + 3];
  }
  return buf;
}
/** Custom 3×3 or 5×5 convolution kernel with scale and offset. */
export function customKernel(buf, { kernel = [0, 0, 0, 0, 1, 0, 0, 0, 0], scale = 1, offset: off = 0 }) {
  const size = kernel.length === 25 ? 5 : 3;
  return convolve(buf, kernel.map(Number), size, { scale: scale || 1, offset: off });
}

// ---------- stylize ----------
/** Emboss: directional relief in grey; height in px, amount %. */
export function emboss(buf, { angle = 135, height = 3, amount = 100 }) {
  const a = angle * Math.PI / 180, dx = Math.cos(a) * height, dy = -Math.sin(a) * height, src = copyBuf(buf), s = sampler(src), o = [0, 0, 0, 0], d = buf.data;
  for (let y = 0; y < buf.h; y++) for (let x = 0; x < buf.w; x++) {
    s(x + 0.5 - dx / 2, y + 0.5 - dy / 2, o); const l1 = lum(o[0], o[1], o[2]);
    s(x + 0.5 + dx / 2, y + 0.5 + dy / 2, o); const l2 = lum(o[0], o[1], o[2]);
    const v = clamp255(128 + (l1 - l2) * amount / 100), p = (y * buf.w + x) * 4; d[p] = d[p + 1] = d[p + 2] = v;
  }
  return buf;
}
/** Find Edges: inverted per-channel Sobel magnitude (dark lines on white). */
export function findEdges(buf) {
  const { w, h } = buf, src = new Uint8ClampedArray(buf.data), d = buf.data;
  const at = (x, y, c) => src[(Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))) * 4 + c];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) {
    const gx = at(x + 1, y - 1, c) + 2 * at(x + 1, y, c) + at(x + 1, y + 1, c) - at(x - 1, y - 1, c) - 2 * at(x - 1, y, c) - at(x - 1, y + 1, c);
    const gy = at(x - 1, y + 1, c) + 2 * at(x, y + 1, c) + at(x + 1, y + 1, c) - at(x - 1, y - 1, c) - 2 * at(x, y - 1, c) - at(x + 1, y - 1, c);
    d[(y * w + x) * 4 + c] = 255 - clamp255(Math.hypot(gx, gy) / 4);
  }
  return buf;
}
export const solarize = buf => { const d = buf.data; for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) if (d[i + c] > 127) d[i + c] = 255 - d[i + c]; return buf; };
/** Diffuse: each pixel takes a random neighbour within radius (seeded). */
export function diffuse(buf, { radius = 2, seed = 1 }, ctx = {}) {
  const { w, h } = buf, src = new Uint8ClampedArray(buf.data), d = buf.data, r = Math.max(1, Math.round(radius)), ox = ctx.offsetX || 0, oy = ctx.offsetY || 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = Math.min(w - 1, Math.max(0, x + Math.round((hash2(x + ox, y + oy, seed) * 2 - 1) * r))), sy = Math.min(h - 1, Math.max(0, y + Math.round((hash2(x + ox, y + oy, seed + 1) * 2 - 1) * r)));
    const p = (y * w + x) * 4, q = (sy * w + sx) * 4; for (let c = 0; c < 4; c++) d[p + c] = src[q + c];
  }
  return buf;
}
/** Wind: streaks from the right or left whose length depends on brightness edges. */
export function wind(buf, { strength = 20, direction = 'right' }) {
  const { w, h } = buf, d = buf.data, dir = direction === 'right' ? 1 : -1;
  for (let y = 0; y < h; y++) {
    let carry = [0, 0, 0], left = 0;
    for (let k = 0; k < w; k++) {
      const x = dir > 0 ? k : w - 1 - k, p = (y * w + x) * 4, v = lum(d[p], d[p + 1], d[p + 2]);
      if (left > 0) { const t = left / strength; for (let c = 0; c < 3; c++) if (carry[c] * t > d[p + c] * 0.5) d[p + c] = clamp255(d[p + c] * (1 - t) + carry[c] * t); left--; }
      if (v > 200 && hash2(x, y, 9) > 0.6) { carry = [d[p], d[p + 1], d[p + 2]]; left = Math.round(strength * (0.5 + hash2(y, x, 3) / 2)); }
    }
  }
  return buf;
}
/** Oil Paint: generalized Kuwahara (4 quadrants), radius px. */
export function oilPaint(buf, { radius = 3 }) {
  const r = Math.max(1, Math.round(radius)), { w, h } = buf, src = new Uint8ClampedArray(buf.data), d = buf.data;
  const at = (x, y) => (Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))) * 4;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let best = Infinity, out = null;
    for (const [qx, qy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      let n = 0, m = [0, 0, 0], v = 0;
      for (let j = 0; j <= r; j++) for (let i = 0; i <= r; i++) { const p = at(x + qx * i, y + qy * j); for (let c = 0; c < 3; c++) m[c] += src[p + c]; const L = lum(src[p], src[p + 1], src[p + 2]); v += L * L; n++; }
      m = m.map(c => c / n); const L = lum(...m); const variance = v / n - L * L;
      if (variance < best) { best = variance; out = m; }
    }
    const p = (y * w + x) * 4; d[p] = out[0]; d[p + 1] = out[1]; d[p + 2] = out[2];
  }
  return buf;
}

// ---------- pixelate ----------
export function mosaic(buf, { cell = 10 }) {
  const n = Math.max(1, Math.round(cell)), { w, h } = buf, d = buf.data;
  for (let cy = 0; cy < h; cy += n) for (let cx = 0; cx < w; cx += n) {
    const acc = [0, 0, 0, 0]; let cnt = 0, A = 0;
    for (let y = cy; y < Math.min(h, cy + n); y++) for (let x = cx; x < Math.min(w, cx + n); x++) { const p = (y * w + x) * 4, a = d[p + 3]; acc[0] += d[p] * a; acc[1] += d[p + 1] * a; acc[2] += d[p + 2] * a; A += a; cnt++; }
    for (let y = cy; y < Math.min(h, cy + n); y++) for (let x = cx; x < Math.min(w, cx + n); x++) { const p = (y * w + x) * 4; if (A) { d[p] = acc[0] / A; d[p + 1] = acc[1] / A; d[p + 2] = acc[2] / A; } d[p + 3] = A / cnt; }
  }
  return buf;
}
/** Crystallize: Voronoi cells around jittered grid points (seeded), each filled with its mean colour. */
export function crystallize(buf, { cell = 12, seed = 1 }, ctx = {}) {
  const n = Math.max(3, Math.round(cell)), { w, h } = buf, d = buf.data, ox = ctx.offsetX || 0, oy = ctx.offsetY || 0;
  const pt = (gx, gy) => [(gx + hash2(gx + ox, gy + oy, seed)) * n, (gy + hash2(gx + ox, gy + oy, seed + 5)) * n];
  const owner = new Int32Array(w * h), gw = Math.ceil(w / n) + 1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const gx = Math.floor(x / n), gy = Math.floor(y / n); let best = Infinity, id = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const [px, py] = pt(gx + i, gy + j), dd = (px - x - 0.5) ** 2 + (py - y - 0.5) ** 2; if (dd < best) { best = dd; id = (gy + j + 1) * (gw + 2) + gx + i + 1; } }
    owner[y * w + x] = id;
  }
  const sums = new Map();
  for (let i = 0; i < w * h; i++) { let s = sums.get(owner[i]); if (!s) sums.set(owner[i], s = [0, 0, 0, 0, 0]); const p = i * 4, a = d[p + 3]; s[0] += d[p] * a; s[1] += d[p + 1] * a; s[2] += d[p + 2] * a; s[3] += a; s[4]++; }
  for (let i = 0; i < w * h; i++) { const s = sums.get(owner[i]), p = i * 4; if (s[3]) { d[p] = s[0] / s[3]; d[p + 1] = s[1] / s[3]; d[p + 2] = s[2] / s[3]; } d[p + 3] = s[3] / s[4]; }
  return buf;
}
/** Color Halftone: per-channel dot screens at classic angles; max radius in px. */
export function colorHalftone(buf, { radius = 4 }) {
  const R = Math.max(2, radius), cell = R * 2, src = new Uint8ClampedArray(buf.data), d = buf.data, { w, h } = buf;
  const angles = [108, 162, 90].map(a => a * Math.PI / 180);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = (y * w + x) * 4;
    for (let c = 0; c < 3; c++) {
      const a = angles[c], cs = Math.cos(a), sn = Math.sin(a), u = (x + 0.5) * cs + (y + 0.5) * sn, v = -(x + 0.5) * sn + (y + 0.5) * cs;
      const cu = (Math.floor(u / cell) + 0.5) * cell, cv = (Math.floor(v / cell) + 0.5) * cell;
      const sx = Math.min(w - 1, Math.max(0, Math.floor(cu * cs - cv * sn))), sy = Math.min(h - 1, Math.max(0, Math.floor(cu * sn + cv * cs)));
      const ink = 1 - src[(sy * w + sx) * 4 + c] / 255, dotR = R * Math.SQRT2 * Math.sqrt(ink);
      d[p + c] = Math.hypot(u - cu, v - cv) <= dotR ? 0 : 255;
    }
  }
  return buf;
}

// ---------- distort ----------
const centre = buf => [buf.w / 2, buf.h / 2, Math.min(buf.w, buf.h) / 2];
export function twirl(buf, { angle = 50 }) {
  const [cx, cy, R] = centre(buf), k = angle * Math.PI / 180;
  return remap(buf, (x, y) => { const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy); if (r >= R) return [x, y]; const t = k * (1 - r / R), c = Math.cos(t), s = Math.sin(t); return [cx + dx * c - dy * s, cy + dx * s + dy * c]; });
}
/** Pinch: amount −100..100; positive pulls content toward the centre (source radius r^(1/(1+a))). */
export function pinch(buf, { amount = 50 }) {
  const [cx, cy, R] = centre(buf), a = Math.max(-0.9, Math.min(1, amount / 100)), e = 1 / (1 + a);
  return remap(buf, (x, y) => { const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy) / R; if (r >= 1 || r === 0) return [x, y]; const k = r ** e / r; return [cx + dx * k, cy + dy * k]; });
}
export function spherize(buf, { amount = 100 }) {
  const [cx, cy, R] = centre(buf), a = amount / 100;
  return remap(buf, (x, y) => { const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy) / R; if (r >= 1 || r === 0) return [x, y]; const sphere = Math.asin(r) / (Math.PI / 2), nr = r + (sphere - r) * a; return [cx + dx / r * nr, cy + dy / r * nr]; });
}
export function ripple(buf, { amount = 100, size = 'medium' }) {
  const wl = size === 'small' ? 8 : size === 'large' ? 32 : 16, amp = amount / 100 * 4;
  return remap(buf, (x, y) => [x + amp * Math.sin(2 * Math.PI * y / wl), y + amp * Math.sin(2 * Math.PI * x / wl)]);
}
export function wave(buf, { wavelength = 60, amplitude = 10, type = 'sine' }) {
  const f = type === 'triangle' ? t => 2 * Math.abs(2 * (t - Math.floor(t + 0.5))) - 1 : type === 'square' ? t => (Math.sin(2 * Math.PI * t) >= 0 ? 1 : -1) : t => Math.sin(2 * Math.PI * t);
  return remap(buf, (x, y) => [x + amplitude * f(y / wavelength), y + amplitude * f(x / wavelength)]);
}
export function polarCoordinates(buf, { mode = 'rectToPolar' }) {
  const { w, h } = buf, cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2;
  if (mode === 'rectToPolar') return remap(buf, (x, y) => { const dx = x - cx, dy = y - cy, ang = (Math.atan2(dx, -dy) + 2 * Math.PI) % (2 * Math.PI); return [ang / (2 * Math.PI) * w, Math.hypot(dx, dy) / R * h]; }, false);
  return remap(buf, (x, y) => { const ang = x / w * 2 * Math.PI, r = y / h * R; return [cx + r * Math.sin(ang), cy - r * Math.cos(ang)]; });
}

// ---------- render ----------
function valueNoise(x, y, seed) {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, s = t => t * t * (3 - 2 * t);
  const a = hash2(x0, y0, seed), b = hash2(x0 + 1, y0, seed), c = hash2(x0, y0 + 1, seed), d = hash2(x0 + 1, y0 + 1, seed);
  return a + (b - a) * s(fx) + (c - a) * s(fy) + (a - b - c + d) * s(fx) * s(fy);
}
export function fbm(x, y, seed, octaves = 6) { let v = 0, amp = 0.5, f = 1, tot = 0; for (let o = 0; o < octaves; o++) { v += amp * valueNoise(x * f, y * f, seed + o * 31); tot += amp; amp /= 2; f *= 2; } return v / tot; }
/** Clouds between foreground and background colours (document-space, seeded). Difference mode blends by |a−b|. */
export function clouds(buf, { scale = 128, seed = 1, difference = false }, ctx = {}) {
  const fg = hexToRgb(ctx.fg || '#000000'), bg = hexToRgb(ctx.bg || '#ffffff'), d = buf.data, ox = ctx.offsetX || 0, oy = ctx.offsetY || 0;
  for (let y = 0; y < buf.h; y++) for (let x = 0; x < buf.w; x++) {
    const t = Math.min(1, Math.max(0, (fbm((x + ox) / scale, (y + oy) / scale, seed) - 0.5) * 1.8 + 0.5)), p = (y * buf.w + x) * 4;
    for (let c = 0; c < 3; c++) { const v = fg[c] + (bg[c] - fg[c]) * t; d[p + c] = difference ? Math.abs(d[p + c] - v) : v; }
    if (!difference) d[p + 3] = 255;
  }
  return buf;
}
