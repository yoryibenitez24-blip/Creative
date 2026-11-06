// Paint Bucket / Magic Wand region finding and gradient rendering.

import { hexToRgb } from './color.js';

/**
 * Pixels similar to the seed colour (max per-channel difference incl. alpha ≤ tolerance).
 * contiguous: 4-connected scanline flood from (sx,sy); otherwise every matching pixel.
 * antiAlias: pixels just outside the tolerance get partial coverage (1-level soft edge).
 * Returns Uint8Array(w*h) coverage 0..255.
 */
export function regionMask(buf, sx, sy, { tolerance = 32, contiguous = true, antiAlias = true } = {}) {
  const { w, h, data: d } = buf, out = new Uint8Array(w * h);
  sx = Math.floor(sx); sy = Math.floor(sy);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return out;
  const s = (sy * w + sx) * 4, seed = [d[s], d[s + 1], d[s + 2], d[s + 3]];
  const diff = i => { const p = i * 4; return Math.max(Math.abs(d[p] - seed[0]), Math.abs(d[p + 1] - seed[1]), Math.abs(d[p + 2] - seed[2]), Math.abs(d[p + 3] - seed[3])); };
  const ok = i => diff(i) <= tolerance;
  if (!contiguous) { for (let i = 0; i < w * h; i++) if (ok(i)) out[i] = 255; }
  else {
    const stack = [sx, sy];
    while (stack.length) {
      const y = stack.pop(), x0 = stack.pop();
      let x = x0; while (x > 0 && !out[y * w + x - 1] && ok(y * w + x - 1)) x--;
      let upOpen = false, downOpen = false;
      for (; x < w && !out[y * w + x] && ok(y * w + x); x++) {
        out[y * w + x] = 255;
        if (y > 0) { const u = (y - 1) * w + x, can = !out[u] && ok(u); if (can && !upOpen) stack.push(x, y - 1); upOpen = can; }
        if (y < h - 1) { const v = (y + 1) * w + x, can = !out[v] && ok(v); if (can && !downOpen) stack.push(x, y + 1); downOpen = can; }
      }
    }
  }
  if (antiAlias) {
    const soft = Math.max(1, tolerance * 0.25);
    const edge = new Uint8Array(out);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; if (out[i]) continue;
      if ((x > 0 && out[i - 1]) || (x < w - 1 && out[i + 1]) || (y > 0 && out[i - w]) || (y < h - 1 && out[i + w])) {
        const over = diff(i) - tolerance; if (over < soft) edge[i] = Math.round(255 * (1 - over / soft) * 0.5);
      }
    }
    return edge;
  }
  return out;
}

const parse = c => typeof c === 'string' ? [...hexToRgb(c), 255] : c;
/**
 * Gradient colour at document point. type: linear | radial | angle | reflected | diamond.
 * stops: [[r,g,b,a], [r,g,b,a]] (or hex). dither adds ±0.5 level of ordered noise to hide banding.
 */
export function gradientSampler({ type = 'linear', x0, y0, x1, y1, from, to, reverse = false, dither = true }) {
  let A = parse(from), B = parse(to); if (reverse) [A, B] = [B, A];
  const dx = x1 - x0, dy = y1 - y0, len2 = dx * dx + dy * dy || 1, len = Math.sqrt(len2), base = Math.atan2(dy, dx);
  const tAt = (x, y) => {
    const px = x - x0, py = y - y0;
    switch (type) {
      case 'radial': return Math.hypot(px, py) / len;
      case 'angle': { let a = (Math.atan2(py, px) - base) / (2 * Math.PI); return a - Math.floor(a); }
      case 'reflected': return Math.abs((px * dx + py * dy) / len2);
      case 'diamond': { const u = Math.abs((px * dx + py * dy) / len2), v = Math.abs((-px * dy + py * dx) / len2); return u + v; }
      default: return (px * dx + py * dy) / len2;
    }
  };
  const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  return (x, y, out) => {
    const t = Math.min(1, Math.max(0, tAt(x + 0.5, y + 0.5))), n = dither ? (bayer[(y & 3) * 4 + (x & 3)] / 16 - 0.5) : 0;
    for (let c = 0; c < 4; c++) out[c] = Math.min(255, Math.max(0, A[c] + (B[c] - A[c]) * t + n));
    return out;
  };
}

/**
 * Quick Selection growth step: pixels around a brush dab whose colour is close to the colours
 * under the brush (tolerance adapts to their spread) are added to `region` (doc-sized Uint8, 255),
 * growing contiguously outward but never across strong edges and never further than `reach` px.
 */
export function quickSelectGrow(buf, region, cx, cy, r, { reach = 3, edge = 60 } = {}) {
  const { w, h, data: d } = buf, R = Math.max(1, r), maxD = R * reach;
  let s = [0, 0, 0], n = 0;
  for (let y = Math.max(0, Math.floor(cy - R)); y < Math.min(h, Math.ceil(cy + R)); y++) for (let x = Math.max(0, Math.floor(cx - R)); x < Math.min(w, Math.ceil(cx + R)); x++) { if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > R) continue; const p = (y * w + x) * 4; s[0] += d[p]; s[1] += d[p + 1]; s[2] += d[p + 2]; n++; }
  if (!n) return 0;
  const m = s.map(v => v / n); let v2 = 0;
  for (let y = Math.max(0, Math.floor(cy - R)); y < Math.min(h, Math.ceil(cy + R)); y++) for (let x = Math.max(0, Math.floor(cx - R)); x < Math.min(w, Math.ceil(cx + R)); x++) { if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > R) continue; const p = (y * w + x) * 4; v2 += (d[p] - m[0]) ** 2 + (d[p + 1] - m[1]) ** 2 + (d[p + 2] - m[2]) ** 2; }
  const tol = Math.max(24, 2.5 * Math.sqrt(v2 / n)), seen = new Uint8Array(w * h), stack = [];
  const close = i => { const p = i * 4; return Math.hypot(d[p] - m[0], d[p + 1] - m[1], d[p + 2] - m[2]) <= tol; };
  for (let y = Math.max(0, Math.floor(cy - R)); y < Math.min(h, Math.ceil(cy + R)); y++) for (let x = Math.max(0, Math.floor(cx - R)); x < Math.min(w, Math.ceil(cx + R)); x++) { const i = y * w + x; if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= R && close(i)) { seen[i] = 1; stack.push(i); } }
  let added = 0;
  while (stack.length) {
    const i = stack.pop(), x = i % w, y = (i / w) | 0;
    if (!region[i]) { region[i] = 255; added++; }
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue; const j = ny * w + nx; if (seen[j]) continue; seen[j] = 1;
      if (Math.hypot(nx + 0.5 - cx, ny + 0.5 - cy) > maxD) continue;
      const p = i * 4, q = j * 4; if (Math.abs(d[p] - d[q]) + Math.abs(d[p + 1] - d[q + 1]) + Math.abs(d[p + 2] - d[q + 2]) > edge) continue; // strong edge
      if (close(j)) stack.push(j);
    }
  }
  return added;
}
