// Free Transform geometry for raster pixels: projective (scale, rotate, skew, distort,
// perspective) via an exact homography, and Warp via a 4×4 bicubic Bézier mesh rasterised as
// fine triangles. Sampling is bilinear on premultiplied alpha. Output buffers cover the integer
// bounding box of the destination shape; the caller places them at (x, y).

/** Homography mapping 4 source points to 4 destination points ([[x,y]×4]). Returns 3×3 (row-major). */
export function homography(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  // Gaussian elimination with partial pivoting
  const n = 8;
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    if (Math.abs(A[c][c]) < 1e-12) throw Error('Degenerate transform (points are collinear)');
    for (let r = c + 1; r < n; r++) { const f = A[r][c] / A[c][c]; for (let k = c; k < n; k++) A[r][k] -= f * A[c][k]; b[r] -= f * b[c]; }
  }
  const h = new Array(n);
  for (let r = n - 1; r >= 0; r--) { let s = b[r]; for (let k = r + 1; k < n; k++) s -= A[r][k] * h[k]; h[r] = s / A[r][r]; }
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}
export function invert3(m) {
  const [a, b, c, d, e, f, g, h, i] = m, A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) throw Error('Transform cannot be inverted');
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}
export const apply3 = (m, x, y) => { const w = m[6] * x + m[7] * y + m[8]; return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w]; };

function premul(buf) { const d = buf.data, f = new Float32Array(d.length); for (let i = 0; i < d.length; i += 4) { const a = d[i + 3] / 255; f[i] = d[i] * a; f[i + 1] = d[i + 1] * a; f[i + 2] = d[i + 2] * a; f[i + 3] = d[i + 3]; } return f; }
function sampleInto(src, sw, sh, x, y, out, o, method) {
  // x,y in source pixel coordinates (pixel centres at +0.5); outside → transparent
  if (method === 'nearest') { const ix = Math.floor(x), iy = Math.floor(y); if (ix < 0 || iy < 0 || ix >= sw || iy >= sh) return; const p = (iy * sw + ix) * 4; for (let c = 0; c < 4; c++) out[o + c] = src[p + c]; return; }
  x -= 0.5; y -= 0.5; const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
    const xx = x0 + i, yy = y0 + j; if (xx < 0 || yy < 0 || xx >= sw || yy >= sh) continue;
    const w = (i ? fx : 1 - fx) * (j ? fy : 1 - fy), p = (yy * sw + xx) * 4;
    out[o] += src[p] * w; out[o + 1] += src[p + 1] * w; out[o + 2] += src[p + 2] * w; out[o + 3] += src[p + 3] * w;
  }
}
function finish(acc, w, h) { const d = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < d.length; i += 4) { const a = acc[i + 3]; d[i + 3] = Math.round(a); if (a > 0.5) { const k = 255 / a; d[i] = acc[i] * k; d[i + 1] = acc[i + 1] * k; d[i + 2] = acc[i + 2] * k; } } return d; }
const bbox = pts => { const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]); const x = Math.floor(Math.min(...xs)), y = Math.floor(Math.min(...ys)); return { x, y, w: Math.max(1, Math.ceil(Math.max(...xs)) - x), h: Math.max(1, Math.ceil(Math.max(...ys)) - y) }; };

/**
 * Projective transform of a buffer: its corners (0,0),(w,0),(w,h),(0,h) go to `quad`
 * (document coordinates relative to the layer's own origin is fine — returned x/y use the same space).
 */
export function projectiveTransform(buf, quad, method = 'bilinear') {
  const src = premul(buf), box = bbox(quad);
  if (box.w * box.h > 8000 * 8000) throw Error('The transformed layer would be larger than 8000 × 8000 px');
  const H = homography([[0, 0], [buf.w, 0], [buf.w, buf.h], [0, buf.h]], quad), inv = invert3(H), acc = new Float32Array(box.w * box.h * 4);
  for (let y = 0; y < box.h; y++) for (let x = 0; x < box.w; x++) {
    const [sx, sy] = apply3(inv, box.x + x + 0.5, box.y + y + 0.5);
    if (sx < -1 || sy < -1 || sx > buf.w + 1 || sy > buf.h + 1) continue;
    sampleInto(src, buf.w, buf.h, sx, sy, acc, (y * box.w + x) * 4, method);
  }
  return { x: box.x, y: box.y, w: box.w, h: box.h, data: finish(acc, box.w, box.h) };
}

/** Default 4×4 Bézier control grid for a rectangle (row-major, 16 [x,y]). */
export const warpGrid = (x, y, w, h) => Array.from({ length: 16 }, (_, k) => [x + (k % 4) / 3 * w, y + Math.floor(k / 4) / 3 * h]);
const bern = t => [(1 - t) ** 3, 3 * t * (1 - t) ** 2, 3 * t * t * (1 - t), t ** 3];
export function bezierPoint(grid, u, v) {
  const bu = bern(u), bv = bern(v); let x = 0, y = 0;
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) { const w = bu[i] * bv[j]; x += grid[j * 4 + i][0] * w; y += grid[j * 4 + i][1] * w; }
  return [x, y];
}

/** Mesh warp: source rectangle → Bézier surface given by `grid`. N×N triangle pairs, barycentric uv. */
export function meshWarp(buf, grid, method = 'bilinear', N = 48) {
  const src = premul(buf), P = [];
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) P.push(bezierPoint(grid, i / N, j / N));
  const box = bbox(P), acc = new Float32Array(box.w * box.h * 4), hit = new Uint8Array(box.w * box.h);
  if (box.w * box.h > 8000 * 8000) throw Error('The warped layer would be larger than 8000 × 8000 px');
  const tri = (a, b, c, ua, ub, uc) => {
    const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]) - box.x)), maxX = Math.min(box.w - 1, Math.ceil(Math.max(a[0], b[0], c[0]) - box.x));
    const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]) - box.y)), maxY = Math.min(box.h - 1, Math.ceil(Math.max(a[1], b[1], c[1]) - box.y));
    const den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]); if (Math.abs(den) < 1e-9) return;
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const k = y * box.w + x; if (hit[k]) continue;
      const px = box.x + x + 0.5, py = box.y + y + 0.5;
      const l1 = ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (py - c[1])) / den, l2 = ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (py - c[1])) / den, l3 = 1 - l1 - l2;
      if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
      hit[k] = 1;
      sampleInto(src, buf.w, buf.h, (l1 * ua[0] + l2 * ub[0] + l3 * uc[0]) * buf.w, (l1 * ua[1] + l2 * ub[1] + l3 * uc[1]) * buf.h, acc, k * 4, method);
    }
  };
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const p00 = P[j * (N + 1) + i], p10 = P[j * (N + 1) + i + 1], p01 = P[(j + 1) * (N + 1) + i], p11 = P[(j + 1) * (N + 1) + i + 1];
    const u0 = [i / N, j / N], u1 = [(i + 1) / N, j / N], u2 = [i / N, (j + 1) / N], u3 = [(i + 1) / N, (j + 1) / N];
    tri(p00, p10, p11, u0, u1, u3); tri(p00, p11, p01, u0, u3, u2);
  }
  return { x: box.x, y: box.y, w: box.w, h: box.h, data: finish(acc, box.w, box.h) };
}
