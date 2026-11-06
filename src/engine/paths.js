// Vector paths: Pen tool geometry, Paths panel data, shape layers and vector masks.
//
// Pure JS (no DOM): runs in Node tests, in workers and in the browser.
//
// Data model (document pixel coordinates, JSON-serialisable):
//   Path     = { subpaths: Subpath[] }
//   Subpath  = { closed: boolean, op: 'combine'|'subtract'|'intersect'|'exclude', points: Anchor[] }
//   Anchor   = { x, y, in: {x,y}|null, out: {x,y}|null, smooth: boolean }
// `in` / `out` are ABSOLUTE handle positions. A null handle means the handle sits on the
// anchor, so a segment between two anchors with null facing handles is a straight line.
// Segment i of a subpath runs from points[i] to points[i+1]; a closed subpath has an extra
// closing segment from the last point back to points[0] (segment index n-1).
//
// Subpath operations follow Photoshop's path operations: consecutive subpaths with the same
// op form one group (filled together with the fill rule); groups combine in order:
//   combine = union (max), subtract = a·(1-s), intersect = min, exclude = |a-s| (xor).
//
// Matrices are SVG-style [a, b, c, d, e, f]:  x' = a·x + c·y + e,  y' = b·x + d·y + f.

import { bitmapShape } from './selection.js';

export const PATH_OPS = ['combine', 'subtract', 'intersect', 'exclude'];
export const KAPPA = 0.5522847498307936; // cubic approximation of a quarter circle

// ---------------------------------------------------------------- basics

export const emptyPath = () => ({ subpaths: [] });
const cp = p => (p ? { x: p.x, y: p.y } : null);
export const cloneAnchor = a => ({ x: a.x, y: a.y, in: cp(a.in), out: cp(a.out), smooth: !!a.smooth });
export const cloneSubpath = s => ({ closed: !!s.closed, op: s.op || 'combine', points: s.points.map(cloneAnchor) });
export const clonePath = p => ({ subpaths: (p?.subpaths || []).map(cloneSubpath) });
export const isEmptyPath = p => !p || !p.subpaths?.some(s => s.points.length > 0);
export const anchor = (x, y, inH = null, outH = null, smooth = false) => ({ x, y, in: cp(inH), out: cp(outH), smooth });

/** Build a path from a flat polygon [{x,y}, ...] (corner points). */
export function polygonToPath(points, closed = true, op = 'combine') {
  return { subpaths: [{ closed, op, points: points.map(p => anchor(p.x, p.y)) }] };
}

/** Number of segments in a subpath. */
export const segmentCount = s => (s.points.length < 2 ? 0 : s.closed ? s.points.length : s.points.length - 1);

/** Control points [p0, c1, c2, p3] of segment i (each {x,y}). */
export function segmentControls(sub, i) {
  const n = sub.points.length, a = sub.points[i], b = sub.points[(i + 1) % n];
  return [{ x: a.x, y: a.y }, a.out ? { x: a.out.x, y: a.out.y } : { x: a.x, y: a.y }, b.in ? { x: b.in.x, y: b.in.y } : { x: b.x, y: b.y }, { x: b.x, y: b.y }];
}
const isLineSeg = (sub, i) => { const n = sub.points.length, a = sub.points[i], b = sub.points[(i + 1) % n]; return !a.out && !b.in; };

export function cubicPoint(c, t) {
  const u = 1 - t, a = u * u * u, b = 3 * u * u * t, d = 3 * u * t * t, e = t * t * t;
  return { x: a * c[0].x + b * c[1].x + d * c[2].x + e * c[3].x, y: a * c[0].y + b * c[1].y + d * c[2].y + e * c[3].y };
}
const lerp = (p, q, t) => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
/** de Casteljau split of a cubic at t → [left controls, right controls]. */
export function splitCubic(c, t) {
  const p01 = lerp(c[0], c[1], t), p12 = lerp(c[1], c[2], t), p23 = lerp(c[2], c[3], t);
  const p012 = lerp(p01, p12, t), p123 = lerp(p12, p23, t), m = lerp(p012, p123, t);
  return [[c[0], p01, p012, m], [m, p123, p23, c[3]]];
}

// ---------------------------------------------------------------- SVG d string

const fmt = v => { const r = Math.round(v * 1000) / 1000; return Object.is(r, -0) ? '0' : String(r); };
const pt = p => fmt(p.x) + ' ' + fmt(p.y);

export function subpathToD(sub) {
  const P = sub.points;
  if (!P.length) return '';
  let d = 'M' + pt(P[0]);
  const n = segmentCount(sub);
  for (let i = 0; i < n; i++) {
    const b = P[(i + 1) % P.length];
    if (isLineSeg(sub, i)) { if (!(sub.closed && i === P.length - 1)) d += 'L' + pt(b); } // a straight closing segment is drawn by Z
    else { const c = segmentControls(sub, i); d += 'C' + pt(c[1]) + ' ' + pt(c[2]) + ' ' + pt(c[3]); }
  }
  if (sub.closed) d += 'Z';
  return d;
}
/** SVG path data for the whole path (all subpaths, ignoring ops). */
export const pathToD = path => (path?.subpaths || []).map(subpathToD).join('');

// ---------------------------------------------------------------- flattening, length, bounds

function flattenCubic(c, tol, out, depth = 0) {
  const [p0, p1, p2, p3] = c;
  const dx = p3.x - p0.x, dy = p3.y - p0.y, L = Math.hypot(dx, dy);
  let d1, d2;
  if (L < 1e-9) { d1 = Math.hypot(p1.x - p0.x, p1.y - p0.y); d2 = Math.hypot(p2.x - p0.x, p2.y - p0.y); }
  else { d1 = Math.abs((p1.x - p0.x) * dy - (p1.y - p0.y) * dx) / L; d2 = Math.abs((p2.x - p0.x) * dy - (p2.y - p0.y) * dx) / L; }
  // 0.75·max(d1,d2) bounds the curve's deviation from the chord
  if (depth >= 18 || 0.75 * Math.max(d1, d2) <= tol) { out.push(p3.x, p3.y); return; }
  const [l, r] = splitCubic(c, 0.5);
  flattenCubic(l, tol, out, depth + 1);
  flattenCubic(r, tol, out, depth + 1);
}

/** Flatten one subpath to a flat [x0,y0,x1,y1,...] polyline (closing point not repeated). */
export function flattenSubpath(sub, tol = 0.25) {
  const P = sub.points, out = [];
  if (!P.length) return out;
  out.push(P[0].x, P[0].y);
  const n = segmentCount(sub);
  for (let i = 0; i < n; i++) {
    if (isLineSeg(sub, i)) { const b = P[(i + 1) % P.length]; out.push(b.x, b.y); }
    else flattenCubic(segmentControls(sub, i), Math.max(1e-4, tol), out);
  }
  if (sub.closed && out.length >= 4 && out[out.length - 2] === out[0] && out[out.length - 1] === out[1]) out.length -= 2;
  return out;
}
/** Flatten every subpath: [{ points: [x,y,...], closed, op }]. Adaptive subdivision, max deviation ≈ tol px. */
export const flattenPath = (path, tol = 0.25) => (path?.subpaths || []).map(s => ({ points: flattenSubpath(s, tol), closed: !!s.closed, op: s.op || 'combine' }));

function polyLength(p, closed) {
  let L = 0;
  for (let i = 2; i < p.length; i += 2) L += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
  if (closed && p.length >= 4) L += Math.hypot(p[0] - p[p.length - 2], p[1] - p[p.length - 1]);
  return L;
}
/** Total arc length (sum over subpaths, closing segments included). */
export const pathLength = (path, tol = 0.02) => flattenPath(path, tol).reduce((s, f) => s + polyLength(f.points, f.closed), 0);

function cubicExtremaTs(a, b, c, d) {
  // derivative coefficients of the 1D cubic: A t² + B t + C
  const A = 3 * (-a + 3 * b - 3 * c + d), B = 6 * (a - 2 * b + c), C = 3 * (b - a), ts = [];
  if (Math.abs(A) < 1e-12) { if (Math.abs(B) > 1e-12) ts.push(-C / B); }
  else { const D = B * B - 4 * A * C; if (D >= 0) { const s = Math.sqrt(D); ts.push((-B + s) / (2 * A), (-B - s) / (2 * A)); } }
  return ts.filter(t => t > 0 && t < 1);
}
/** Exact bounding box of the curves {x, y, w, h}, or null for an empty path. Pass `subs` to limit to some subpaths. */
export function pathBounds(path, subs) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = p => { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; };
  (path?.subpaths || []).forEach((s, si) => {
    if (subs && !subs.includes(si)) return;
    s.points.forEach(add);
    for (let i = 0; i < segmentCount(s); i++) {
      if (isLineSeg(s, i)) continue;
      const c = segmentControls(s, i);
      for (const t of [...cubicExtremaTs(c[0].x, c[1].x, c[2].x, c[3].x), ...cubicExtremaTs(c[0].y, c[1].y, c[2].y, c[3].y)]) add(cubicPoint(c, t));
    }
  });
  return x1 < x0 ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// ---------------------------------------------------------------- hit testing

/** Closest point on segment i of a subpath: { t, x, y, dist }. */
export function nearestOnSegment(sub, i, p) {
  const c = segmentControls(sub, i);
  if (isLineSeg(sub, i)) {
    const dx = c[3].x - c[0].x, dy = c[3].y - c[0].y, L2 = dx * dx + dy * dy;
    const t = L2 ? Math.max(0, Math.min(1, ((p.x - c[0].x) * dx + (p.y - c[0].y) * dy) / L2)) : 0;
    const q = { x: c[0].x + dx * t, y: c[0].y + dy * t };
    return { t, x: q.x, y: q.y, dist: Math.hypot(q.x - p.x, q.y - p.y) };
  }
  const N = 32;
  let bt = 0, bd = Infinity;
  for (let k = 0; k <= N; k++) { const q = cubicPoint(c, k / N), d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2; if (d < bd) { bd = d; bt = k / N; } }
  let step = 1 / N;
  for (let it = 0; it < 30; it++) {
    step /= 2;
    for (const t of [bt - step, bt + step]) {
      if (t < 0 || t > 1) continue;
      const q = cubicPoint(c, t), d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
      if (d < bd) { bd = d; bt = t; }
    }
  }
  const q = cubicPoint(c, bt);
  return { t: bt, x: q.x, y: q.y, dist: Math.sqrt(bd) };
}

/**
 * Hit-test a point against the path. `radius` is the pick tolerance in document px
 * (use screenPx / zoom). Priority: handles (only of anchors listed in opts.handles, a Set of
 * "sub:index" keys, or every anchor when opts.handles === 'all'), then anchors, then segments.
 * Returns { type:'handle', sub, index, which:'in'|'out' } | { type:'anchor', sub, index }
 *       | { type:'segment', sub, index, t, x, y, dist } | null.
 */
export function hitTest(path, p, radius = 4, opts = {}) {
  const subs = path?.subpaths || [];
  const hs = opts.handles;
  let best = null, bd = radius;
  if (hs) subs.forEach((s, si) => s.points.forEach((a, i) => {
    if (hs !== 'all' && !hs.has(si + ':' + i)) return;
    for (const which of ['in', 'out']) {
      const h = a[which];
      if (!h) continue;
      const d = Math.hypot(h.x - p.x, h.y - p.y);
      if (d <= bd) { bd = d; best = { type: 'handle', sub: si, index: i, which }; }
    }
  }));
  if (best) return best;
  bd = radius;
  subs.forEach((s, si) => s.points.forEach((a, i) => { const d = Math.hypot(a.x - p.x, a.y - p.y); if (d <= bd) { bd = d; best = { type: 'anchor', sub: si, index: i }; } }));
  if (best) return best;
  bd = radius;
  subs.forEach((s, si) => { for (let i = 0; i < segmentCount(s); i++) { const r = nearestOnSegment(s, i, p); if (r.dist <= bd) { bd = r.dist; best = { type: 'segment', sub: si, index: i, ...r }; } } });
  return best;
}

function windingAt(poly, x, y) {
  let w = 0;
  const n = poly.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[2 * i], yi = poly[2 * i + 1], xj = poly[2 * j], yj = poly[2 * j + 1];
    if ((yj <= y) !== (yi <= y)) {
      const xc = xj + (y - yj) / (yi - yj) * (xi - xj);
      if (xc > x) w += yi > yj ? 1 : -1;
    }
  }
  return w;
}
/** Is (x,y) inside the filled area of one subpath (treated as closed, non-zero rule)? */
export function pointInSubpath(sub, x, y) { const f = flattenSubpath(sub, 0.5); return f.length >= 6 && windingAt(f, x, y) !== 0; }

/** Index of the topmost subpath under p (outline within radius, or inside its fill), or -1. Used by Path Selection. */
export function subpathAt(path, p, radius = 4) {
  const h = hitTest(path, p, radius);
  if (h) return h.sub;
  const subs = path?.subpaths || [];
  for (let si = subs.length - 1; si >= 0; si--) if (pointInSubpath(subs[si], p.x, p.y)) return si;
  return -1;
}

// ---------------------------------------------------------------- editing (all return new paths)

const mapSub = (path, si, f) => ({ subpaths: path.subpaths.map((s, k) => (k === si ? f(cloneSubpath(s)) : cloneSubpath(s))) });

/** Insert an anchor on segment `seg` of subpath `si` at parameter t (de Casteljau split; the curve is unchanged). */
export function insertAnchor(path, si, seg, t) {
  return mapSub(path, si, s => {
    const n = s.points.length, a = s.points[seg], bi = (seg + 1) % n, b = s.points[bi];
    let na;
    if (!a.out && !b.in) { const q = lerp(a, b, t); na = anchor(q.x, q.y); }
    else {
      const [l, r] = splitCubic(segmentControls(s, seg), t);
      if (a.out) a.out = cp(l[1]);
      if (b.in) b.in = cp(r[2]);
      na = anchor(l[3].x, l[3].y, l[2], r[1], true);
    }
    s.points.splice(seg + 1, 0, na);
    return s;
  });
}

/** Delete one anchor keeping the subpath connected (Delete Anchor Point tool). Subpaths left with no points are removed. */
export function deleteAnchor(path, si, idx) {
  const next = mapSub(path, si, s => { s.points.splice(idx, 1); if (s.points.length < 2) s.closed = false; return s; });
  next.subpaths = next.subpaths.filter(s => s.points.length > 0);
  return next;
}

/**
 * Delete anchors together with their adjoining segments (Direct Selection + Delete, as in
 * Photoshop): a closed subpath opens at the gap, an open one splits in two.
 * `keys` is an iterable of "sub:index" strings. Single-point leftovers are dropped.
 */
export function deleteAnchors(path, keys) {
  const del = new Set(keys);
  const out = [];
  path.subpaths.forEach((s, si) => {
    const n = s.points.length, gone = s.points.map((_, i) => del.has(si + ':' + i));
    if (!gone.some(Boolean)) { out.push(cloneSubpath(s)); return; }
    // walk runs of surviving points; for closed paths start right after a deleted point
    let start = 0;
    if (s.closed) start = (gone.indexOf(true) + 1) % n;
    let run = [];
    const flush = () => { if (run.length >= 2) { run[0].in = null; run[run.length - 1].out = null; out.push({ closed: false, op: s.op || 'combine', points: run }); } run = []; };
    for (let k = 0; k < n; k++) {
      const i = s.closed ? (start + k) % n : k;
      if (gone[i]) flush(); else run.push(cloneAnchor(s.points[i]));
    }
    flush();
  });
  return { subpaths: out };
}

/** Remove whole subpaths (indices). */
export const deleteSubpaths = (path, idxs) => ({ subpaths: path.subpaths.filter((_, i) => !idxs.includes(i)).map(cloneSubpath) });

/** Duplicate subpaths (appended at the end); returns { path, indices } of the copies. */
export function duplicateSubpaths(path, idxs) {
  const next = clonePath(path), indices = [];
  for (const i of idxs) { indices.push(next.subpaths.length); next.subpaths.push(cloneSubpath(path.subpaths[i])); }
  return { path: next, indices };
}

/** Reverse the direction of a subpath (shape unchanged). */
export function reverseSubpath(sub) {
  return { closed: sub.closed, op: sub.op || 'combine', points: sub.points.slice().reverse().map(a => ({ x: a.x, y: a.y, in: cp(a.out), out: cp(a.in), smooth: !!a.smooth })) };
}

/**
 * Convert Point: toSmooth=false removes both handles (corner); toSmooth=true pulls out
 * symmetric handles along the neighbours' direction (length = 1/3 of the neighbour distances).
 */
export function convertPoint(path, si, idx, toSmooth) {
  return mapSub(path, si, s => {
    const a = s.points[idx];
    if (!toSmooth) { a.in = null; a.out = null; a.smooth = false; return s; }
    const n = s.points.length;
    const prev = idx > 0 ? s.points[idx - 1] : s.closed ? s.points[n - 1] : null;
    const next = idx < n - 1 ? s.points[idx + 1] : s.closed ? s.points[0] : null;
    let dx = (next ? next.x : a.x) - (prev ? prev.x : a.x), dy = (next ? next.y : a.y) - (prev ? prev.y : a.y);
    const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
    const lp = prev ? Math.hypot(a.x - prev.x, a.y - prev.y) / 3 : 0, ln = next ? Math.hypot(next.x - a.x, next.y - a.y) / 3 : 0;
    a.in = prev ? { x: a.x - dx * lp, y: a.y - dy * lp } : null;
    a.out = next ? { x: a.x + dx * ln, y: a.y + dy * ln } : null;
    a.smooth = true;
    return s;
  });
}

/** Move anchors (with their handles) by (dx, dy). `keys` is an iterable of "sub:index". */
export function moveAnchors(path, keys, dx, dy) {
  const ks = new Set(keys);
  return {
    subpaths: path.subpaths.map((s, si) => ({
      ...cloneSubpath(s),
      points: s.points.map((a, i) => (ks.has(si + ':' + i) ? { x: a.x + dx, y: a.y + dy, in: a.in && { x: a.in.x + dx, y: a.in.y + dy }, out: a.out && { x: a.out.x + dx, y: a.out.y + dy }, smooth: !!a.smooth } : cloneAnchor(a))),
    })),
  };
}
/** Move one anchor with its handles to (x, y). */
export function moveAnchor(path, si, idx, x, y) { const a = path.subpaths[si].points[idx]; return moveAnchors(path, [si + ':' + idx], x - a.x, y - a.y); }

/**
 * Move a direction handle to (x, y). On a smooth point the opposite handle stays collinear
 * (keeping its own length) unless `independent` (Alt), which also turns the point into a corner.
 * With `symmetric` the opposite handle mirrors exactly (Pen click-drag).
 */
export function moveHandle(path, si, idx, which, x, y, { independent = false, symmetric = false } = {}) {
  return mapSub(path, si, s => {
    const a = s.points[idx], other = which === 'in' ? 'out' : 'in';
    a[which] = { x, y };
    if (independent) { a.smooth = false; return s; }
    if (symmetric) { a[other] = { x: 2 * a.x - x, y: 2 * a.y - y }; a.smooth = true; return s; }
    if (a.smooth && a[other]) {
      const L = Math.hypot(a[other].x - a.x, a[other].y - a.y), dx = a.x - x, dy = a.y - y, D = Math.hypot(dx, dy);
      if (D > 1e-9) a[other] = { x: a.x + dx / D * L, y: a.y + dy / D * L };
    }
    return s;
  });
}

/**
 * Reshape a segment so that its point at parameter t follows a drag by (dx, dy)
 * (Direct Selection dragging a curve). Straight segments move both end anchors.
 * Smooth end points keep their opposite handles collinear.
 */
export function dragSegment(path, si, seg, t, dx, dy) {
  const s0 = path.subpaths[si], n = s0.points.length, bi = (seg + 1) % n;
  if (isLineSeg(s0, seg)) return moveAnchors(path, [si + ':' + seg, si + ':' + bi], dx, dy);
  t = Math.min(0.95, Math.max(0.05, t));
  const k = 1 / (3 * t * (1 - t) * ((1 - t) ** 2 + t * t));
  const c = segmentControls(s0, seg);
  let next = mapSub(path, si, s => {
    s.points[seg].out = { x: c[1].x + dx * (1 - t) * k, y: c[1].y + dy * (1 - t) * k };
    s.points[bi].in = { x: c[2].x + dx * t * k, y: c[2].y + dy * t * k };
    return s;
  });
  for (const [i, w] of [[seg, 'out'], [bi, 'in']]) { const a = next.subpaths[si].points[i]; if (a.smooth) next = moveHandle(next, si, i, w, a[w].x, a[w].y); }
  return next;
}

// ---------------------------------------------------------------- transforms

export const IDENTITY = [1, 0, 0, 1, 0, 0];
export const multiplyMatrix = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]]; // m ∘ n (n first)
export const translateMatrix = (tx, ty) => [1, 0, 0, 1, tx, ty];
export const scaleMatrix = (sx, sy = sx, cx = 0, cy = 0) => [sx, 0, 0, sy, cx - sx * cx, cy - sy * cy];
export function rotateMatrix(deg, cx = 0, cy = 0) { const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r); return [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy]; }
export const applyMatrix = (m, p) => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] });

/** Transform the path (or only the listed subpath indices) by a 2×3 matrix. Handles transform too. */
export function transformPath(path, m, subs) {
  const tp = p => (p ? applyMatrix(m, p) : null);
  return {
    subpaths: path.subpaths.map((s, si) => (subs && !subs.includes(si) ? cloneSubpath(s) : { closed: !!s.closed, op: s.op || 'combine', points: s.points.map(a => ({ ...applyMatrix(m, a), in: tp(a.in), out: tp(a.out), smooth: !!a.smooth })) })),
  };
}
export const translatePath = (path, dx, dy, subs) => transformPath(path, translateMatrix(dx, dy), subs);

// ---------------------------------------------------------------- rasterization

// Exact horizontal coverage of span [a,b]: partial end pixels go to `row`, whole pixels to the
// difference array `run` (prefix-summed once per pixel row), so long spans cost O(1).
function addSpan(row, run, w, a, b, weight) {
  if (b <= a) return;
  a = Math.max(0, a); b = Math.min(w, b);
  if (b <= a) return;
  const ia = Math.floor(a), ib = Math.floor(b);
  if (ia === ib) { row[ia] += (b - a) * weight; return; }
  row[ia] += (ia + 1 - a) * weight;
  run[ia + 1] += weight; run[ib] -= weight;
  if (ib < w) row[ib] += (b - ib) * weight;
}

/** Fill polygons (flat point arrays, implicitly closed) into Float32 coverage 0..1. */
function fillPolygons(polys, W, H, fillRule, antialias, samples) {
  const out = new Float32Array(W * H);
  const edges = []; // [yTop, yBot, xAtTop, dxdy, dir]
  let yMin = Infinity, yMax = -Infinity;
  for (const p of polys) {
    const n = p.length / 2;
    if (n < 3) continue;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const x0 = p[2 * j], y0 = p[2 * j + 1], x1 = p[2 * i], y1 = p[2 * i + 1];
      if (y0 === y1 || !Number.isFinite(x0 + y0 + x1 + y1)) continue;
      const down = y1 > y0, ya = down ? y0 : y1, yb = down ? y1 : y0, xa = down ? x0 : x1, xb = down ? x1 : x0;
      edges.push([ya, yb, xa, (xb - xa) / (yb - ya), down ? 1 : -1]);
      if (ya < yMin) yMin = ya; if (yb > yMax) yMax = yb;
    }
  }
  if (!edges.length) return out;
  edges.sort((a, b) => a[0] - b[0]);
  const S = antialias ? Math.max(1, samples | 0) : 1, weight = 1 / S;
  const y0 = Math.max(0, Math.floor(yMin)), y1 = Math.min(H, Math.ceil(yMax));
  const row = new Float32Array(W), run = new Float32Array(W + 1), xs = [];
  let ei = 0, active = [];
  const evenOdd = fillRule === 'evenodd';
  for (let py = y0; py < y1; py++) {
    while (ei < edges.length && edges[ei][0] < py + 1) active.push(edges[ei++]);
    active = active.filter(e => e[1] > py);
    if (!active.length) continue;
    row.fill(0); run.fill(0);
    let any = false;
    for (let s = 0; s < S; s++) {
      const sy = antialias ? py + (s + 0.5) / S : py + 0.5;
      xs.length = 0;
      for (const e of active) if (e[0] <= sy && e[1] > sy) xs.push([e[2] + (sy - e[0]) * e[3], e[4]]);
      if (xs.length < 2) continue;
      xs.sort((a, b) => a[0] - b[0]);
      let w = 0;
      for (let k = 0; k < xs.length - 1; k++) {
        w = evenOdd ? w ^ 1 : w + xs[k][1];
        if (w === 0) continue;
        const a = xs[k][0], b = xs[k + 1][0];
        if (antialias) addSpan(row, run, W, a, b, weight);
        else { const xa = Math.max(0, Math.ceil(a - 0.5)), xb = Math.min(W, Math.ceil(b - 0.5)); for (let x = xa; x < xb; x++) row[x] = 1; }
        any = true;
      }
    }
    if (any) { const o = py * W; let acc = 0; for (let x = 0; x < W; x++) { acc += run[x]; const v = row[x] + acc; if (v > 1e-7) out[o + x] = v < 1 ? v : 1; } }
  }
  return out;
}

/** Consecutive subpaths with the same op form one group. Returns [{ op, subs: [indices] }]. */
export function opGroups(path) {
  const groups = [];
  (path?.subpaths || []).forEach((s, i) => {
    if (!s.points.length) return;
    const op = s.op || 'combine';
    const g = groups[groups.length - 1];
    if (g && g.op === op) g.subs.push(i); else groups.push({ op, subs: [i] });
  });
  return groups;
}

/**
 * Rasterize the path's fill area to a W×H Uint8Array (0..255).
 * opts: { fillRule: 'nonzero'|'evenodd' (default nonzero), antialias = true, samples = 16 (sub-scanlines per pixel,
 * exact horizontal coverage), tolerance = 0.05 (flattening px) }. Open subpaths are filled as if closed.
 * Subpath ops combine group by group (see top of file).
 */
export function rasterizePath(path, W, H, opts = {}) {
  if (typeof opts === 'boolean') opts = { antialias: opts };
  const { fillRule = 'nonzero', antialias = true, samples = 16, tolerance = 0.05 } = opts;
  const out = new Uint8Array(W * H);
  const groups = opGroups(path);
  if (!groups.length) return out;
  let acc = null;
  for (const g of groups) {
    const polys = g.subs.map(i => flattenSubpath(path.subpaths[i], tolerance));
    const s = fillPolygons(polys, W, H, fillRule, antialias, samples);
    if (!acc) { acc = g.op === 'combine' || g.op === 'exclude' ? s : new Float32Array(W * H); continue; }
    if (g.op === 'combine') for (let i = 0; i < acc.length; i++) acc[i] = Math.max(acc[i], s[i]);
    else if (g.op === 'subtract') for (let i = 0; i < acc.length; i++) acc[i] = acc[i] * (1 - s[i]);
    else if (g.op === 'intersect') for (let i = 0; i < acc.length; i++) acc[i] = Math.min(acc[i], s[i]);
    else if (g.op === 'exclude') for (let i = 0; i < acc.length; i++) acc[i] = Math.abs(acc[i] - s[i]);
  }
  for (let i = 0; i < out.length; i++) out[i] = Math.round(acc[i] * 255);
  return out;
}

/**
 * Selection shape for "Load Path as Selection" / Ctrl-click: a `bitmap` shape usable directly in
 * a selection op, e.g. appendOp(doc.selection, { op:'replace', shape, feather }). Returns null if the
 * path covers no pixels. opts as for rasterizePath.
 */
export function pathToSelectionShape(path, W, H, opts = {}) {
  return bitmapShape(rasterizePath(path, W, H, opts), W, H);
}

// ---------------------------------------------------------------- stroke path → brush dabs

/**
 * Evenly spaced points along the path for the brush engine (Stroke Path).
 * opts: { taper: false|'both'|'start'|'end' (Simulate Pressure), minPressure = 0, tolerance = 0.1 }.
 * Returns [{ x, y, pressure, angle (radians, direction of travel), sub, start (true for the first point of each subpath) }].
 */
export function strokePathPoints(path, spacingPx, opts = {}) {
  const { taper = false, minPressure = 0, tolerance = 0.1 } = opts;
  const step = Math.max(0.01, spacingPx), out = [];
  flattenPath(path, tolerance).forEach((f, si) => {
    const p = f.points.slice();
    if (p.length < 2) return;
    if (f.closed) p.push(p[0], p[1]);
    const L = polyLength(p, false);
    const press = s => {
      const u = L > 0 ? s / L : 0;
      const v = taper === 'both' ? Math.sin(Math.PI * u) : taper === 'start' ? u : taper === 'end' ? 1 - u : 1;
      return minPressure + (1 - minPressure) * Math.max(0, Math.min(1, v));
    };
    let walked = 0, nextAt = 0, first = true;
    for (let i = 2; i < p.length; i += 2) {
      const ax = p[i - 2], ay = p[i - 1], bx = p[i], by = p[i + 1], seg = Math.hypot(bx - ax, by - ay);
      if (seg === 0) continue;
      const ang = Math.atan2(by - ay, bx - ax);
      while (nextAt <= walked + seg + 1e-9) {
        const u = (nextAt - walked) / seg;
        out.push({ x: ax + (bx - ax) * u, y: ay + (by - ay) * u, pressure: press(nextAt), angle: ang, sub: si, start: first });
        first = false;
        nextAt += step;
      }
      walked += seg;
    }
    if (first && p.length >= 2) out.push({ x: p[0], y: p[1], pressure: press(0), angle: 0, sub: si, start: true });
  });
  return out;
}

// ---------------------------------------------------------------- curve fitting

const sub2 = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const add2 = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const mul2 = (a, k) => ({ x: a.x * k, y: a.y * k });
const dot2 = (a, b) => a.x * b.x + a.y * b.y;
const len2 = a => Math.hypot(a.x, a.y);
const norm2 = a => { const l = len2(a); return l > 1e-12 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 }; };

function bezierQ(c, t) { return cubicPoint(c, t); }
function bezierQ1(c, t) { const u = 1 - t; return add2(add2(mul2(sub2(c[1], c[0]), 3 * u * u), mul2(sub2(c[2], c[1]), 6 * u * t)), mul2(sub2(c[3], c[2]), 3 * t * t)); }
function bezierQ2(c, t) { return add2(mul2(add2(sub2(c[2], mul2(c[1], 2)), c[0]), 6 * (1 - t)), mul2(add2(sub2(c[3], mul2(c[2], 2)), c[1]), 6 * t)); }

function generateBezier(pts, first, last, u, t1, t2) {
  const p0 = pts[first], p3 = pts[last];
  let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
  for (let i = 0; i < u.length; i++) {
    const t = u[i], m = 1 - t, b1 = 3 * t * m * m, b2 = 3 * t * t * m, b0 = m * m * m, b3 = t * t * t;
    const a1 = mul2(t1, b1), a2 = mul2(t2, b2);
    c00 += dot2(a1, a1); c01 += dot2(a1, a2); c11 += dot2(a2, a2);
    const tmp = sub2(pts[first + i], add2(mul2(p0, b0 + b1), mul2(p3, b2 + b3)));
    x0 += dot2(a1, tmp); x1 += dot2(a2, tmp);
  }
  const det = c00 * c11 - c01 * c01;
  let al = 0, ar = 0;
  if (Math.abs(det) > 1e-12) { al = (x0 * c11 - x1 * c01) / det; ar = (c00 * x1 - c01 * x0) / det; }
  const segLen = len2(sub2(p3, p0)), eps = 1e-6 * segLen;
  if (al < eps || ar < eps) { al = ar = segLen / 3; }
  return [p0, add2(p0, mul2(t1, al)), add2(p3, mul2(t2, ar)), p3];
}

function fitCubic(pts, first, last, t1, t2, err2, out, depth) {
  if (last - first === 1) {
    const d = len2(sub2(pts[last], pts[first])) / 3;
    out.push([pts[first], add2(pts[first], mul2(t1, d)), add2(pts[last], mul2(t2, d)), pts[last]]);
    return;
  }
  let u = [0];
  for (let i = first + 1; i <= last; i++) u.push(u[u.length - 1] + len2(sub2(pts[i], pts[i - 1])));
  const total = u[u.length - 1] || 1;
  u = u.map(v => v / total);
  let bez, maxE = 0, split = Math.floor((first + last) / 2);
  const measure = () => {
    maxE = 0; split = Math.floor((first + last) / 2);
    for (let i = first + 1; i < last; i++) { const q = bezierQ(bez, u[i - first]), d = (q.x - pts[i].x) ** 2 + (q.y - pts[i].y) ** 2; if (d >= maxE) { maxE = d; split = i; } }
  };
  bez = generateBezier(pts, first, last, u, t1, t2);
  measure();
  if (maxE < err2) { out.push(bez); return; }
  if (maxE < err2 * 16) {
    for (let it = 0; it < 12; it++) {
      u = u.map((t, k) => { const P = pts[first + k], d = sub2(bezierQ(bez, t), P), q1 = bezierQ1(bez, t), q2 = bezierQ2(bez, t), den = dot2(q1, q1) + dot2(d, q2); return den ? Math.min(1, Math.max(0, t - dot2(d, q1) / den)) : t; });
      bez = generateBezier(pts, first, last, u, t1, t2);
      measure();
      if (maxE < err2) { out.push(bez); return; }
    }
  }
  if (depth > 40) { out.push(bez); return; }
  const ct = norm2(sub2(pts[split - 1], pts[split + 1]));
  fitCubic(pts, first, split, t1, ct, err2, out, depth + 1);
  fitCubic(pts, split, last, mul2(ct, -1), t2, err2, out, depth + 1);
}

/**
 * Fit cubic Béziers to a polyline (Philip Schneider's algorithm, Graphics Gems 1990):
 * least-squares control points, Newton reparameterisation, split at the worst point.
 * points: [{x,y}], tolerance: max deviation in px. Returns a Subpath (open unless `closed`).
 */
export function fitBezier(points, tolerance = 2, closed = false) {
  const pts = [];
  for (const p of points) { const q = pts[pts.length - 1]; if (!q || Math.hypot(p.x - q.x, p.y - q.y) > 0.5) pts.push({ x: p.x, y: p.y }); }
  if (closed && pts.length > 2 && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) > 0.5) pts.push({ ...pts[0] });
  if (pts.length < 2) return { closed: false, op: 'combine', points: pts.map(p => anchor(p.x, p.y)) };
  const n = pts.length;
  let t1 = norm2(sub2(pts[1], pts[0])), t2 = norm2(sub2(pts[n - 2], pts[n - 1]));
  if (closed) { const t = norm2(sub2(pts[1], pts[n - 2])); t1 = t; t2 = mul2(t, -1); }
  const bez = [];
  fitCubic(pts, 0, n - 1, t1, t2, tolerance * tolerance, bez, 0);
  const anchors = [anchor(bez[0][0].x, bez[0][0].y, null, bez[0][1])];
  for (let i = 0; i < bez.length; i++) {
    const b = bez[i], nb = bez[i + 1];
    anchors.push(anchor(b[3].x, b[3].y, b[2], nb ? nb[1] : null, !!nb));
  }
  if (closed && anchors.length > 2) {
    const last = anchors.pop();
    anchors[0].in = last.in; anchors[0].smooth = true;
  }
  return { closed: !!closed && anchors.length > 2, op: 'combine', points: anchors };
}

/**
 * Curvature-style smooth handles for anchor idx of a subpath, from its neighbours: tangent
 * parallel to (next - prev), handle lengths scaled so a regular polygon's points produce a
 * near-circular curve. Returns a new subpath. Corner (smooth:false) points get null handles.
 */
export function curvatureHandles(sub, idx) {
  const s = cloneSubpath(sub), n = s.points.length, a = s.points[idx];
  if (!a.smooth) { a.in = null; a.out = null; return s; }
  const prev = idx > 0 ? s.points[idx - 1] : s.closed ? s.points[n - 1] : null;
  const next = idx < n - 1 ? s.points[idx + 1] : s.closed ? s.points[0] : null;
  if (!prev || !next) { a.in = null; a.out = null; return s; }
  const v1 = sub2(a, prev), v2 = sub2(next, a), l1 = len2(v1), l2 = len2(v2);
  if (l1 < 1e-9 || l2 < 1e-9) { a.in = null; a.out = null; return s; }
  const dir = norm2(sub2(next, prev));
  const phi = Math.min(Math.PI * 0.9, Math.acos(Math.max(-1, Math.min(1, dot2(v1, v2) / (l1 * l2)))));
  const f = phi < 1e-3 ? 1 / 3 : (4 / 3) * Math.tan(phi / 4) / (2 * Math.sin(phi / 2));
  a.in = sub2(a, mul2(dir, l1 * f));
  a.out = add2(a, mul2(dir, l2 * f));
  return s;
}

// ---------------------------------------------------------------- mask → path (Make Work Path)

function rdp(pts, tol) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const A = pts[a], B = pts[b], dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy);
    let md = -1, mi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = L < 1e-12 ? Math.hypot(pts[i].x - A.x, pts[i].y - A.y) : Math.abs((pts[i].x - A.x) * dy - (pts[i].y - A.y) * dx) / L;
      if (d > md) { md = d; mi = i; }
    }
    if (md > tol) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  const idx = [];
  keep.forEach((k, i) => { if (k) idx.push(i); });
  return idx;
}

// Total-least-squares line through points → { cx, cy, dx, dy } (unit direction).
function fitLine(pts) {
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p.x; cy += p.y; }
  cx /= pts.length; cy /= pts.length;
  let sxx = 0, sxy = 0, syy = 0;
  for (const p of pts) { const dx = p.x - cx, dy = p.y - cy; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
  const a = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { cx, cy, dx: Math.cos(a), dy: Math.sin(a) };
}
function intersectLines(l1, l2) {
  const det = l1.dx * l2.dy - l1.dy * l2.dx;
  if (Math.abs(det) < 0.2) return null; // nearly parallel
  const t = ((l2.cx - l1.cx) * l2.dy - (l2.cy - l1.cy) * l2.dx) / det;
  return { x: l1.cx + l1.dx * t, y: l1.cy + l1.dy * t };
}

/**
 * Trace the threshold iso-contour of a 0..255 mask with marching squares (samples at pixel
 * centres, linear interpolation), simplify with Ramer–Douglas–Peucker (`tolerance` px) and make
 * gently turning vertices smooth Bézier points (opts.smooth, default true). Outer contours and holes
 * get opposite orientation, so the result fills correctly with the non-zero rule.
 * Returns a Path of closed subpaths (op 'combine').
 */
export function maskToPath(mask, W, H, tolerance = 2, opts = {}) {
  const { threshold = 128, smooth = true, cornerAngle = 50 } = opts;
  const GW = W + 2, GH = H + 2; // sample grid with a zero border: sample (i,j) ↔ pixel (i-1, j-1)
  const v = (i, j) => (i < 1 || j < 1 || i > W || j > H ? 0 : mask[(j - 1) * W + (i - 1)]);
  const inside = (i, j) => v(i, j) >= threshold;
  // crossing point on the edge between two samples
  const cross = (i0, j0, i1, j1) => {
    const a = v(i0, j0), b = v(i1, j1), t = a === b ? 0.5 : (threshold - 0.5 - a) / (b - a);
    const tt = Math.max(0, Math.min(1, t));
    return { x: i0 + (i1 - i0) * tt - 0.5, y: j0 + (j1 - j0) * tt - 0.5 };
  };
  // edge keys: horizontal edge (i,j)-(i+1,j) → 2*(j*GW+i), vertical (i,j)-(i,j+1) → 2*(j*GW+i)+1
  const next = new Map(), pos = new Map();
  for (let j = 0; j < GH - 1; j++) for (let i = 0; i < GW - 1; i++) {
    const tl = inside(i, j), tr = inside(i + 1, j), br = inside(i + 1, j + 1), bl = inside(i, j + 1);
    const cnt = tl + tr + br + bl;
    if (cnt === 0 || cnt === 4) continue;
    // clockwise cell edges: top TL→TR, right TR→BR, bottom BR→BL, left BL→TL
    const E = [
      { key: 2 * (j * GW + i), a: tl, b: tr, p: () => cross(i, j, i + 1, j) },
      { key: 2 * (j * GW + i + 1) + 1, a: tr, b: br, p: () => cross(i + 1, j, i + 1, j + 1) },
      { key: 2 * ((j + 1) * GW + i), a: br, b: bl, p: () => cross(i + 1, j + 1, i, j + 1) },
      { key: 2 * (j * GW + i) + 1, a: bl, b: tl, p: () => cross(i, j + 1, i, j) },
    ];
    let pairNext = true; // segment wraps an inside corner → exit is the clockwise-next crossing
    if (cnt === 3) pairNext = false;
    if (cnt === 2 && tl === br) { // saddle: decide with the cell centre average
      const centre = (v(i, j) + v(i + 1, j) + v(i + 1, j + 1) + v(i, j + 1)) / 4 >= threshold;
      pairNext = !centre;
    }
    const crossings = E.map((e, k) => ({ ...e, k })).filter(e => e.a !== e.b);
    for (const en of crossings) {
      if (en.a) continue; // entries go outside → inside along the clockwise walk
      // find matching exit
      const m = crossings.length, idx = crossings.indexOf(en);
      const ex = pairNext ? crossings[(idx + 1) % m] : crossings[(idx - 1 + m) % m];
      next.set(en.key, ex.key);
      if (!pos.has(en.key)) pos.set(en.key, en.p());
      if (!pos.has(ex.key)) pos.set(ex.key, ex.p());
    }
  }
  const subpaths = [], seen = new Set();
  for (const startKey of next.keys()) {
    if (seen.has(startKey)) continue;
    const loop = [];
    let k = startKey;
    while (k !== undefined && !seen.has(k)) { seen.add(k); loop.push(pos.get(k)); k = next.get(k); }
    if (loop.length < 3) continue;
    // closed RDP: split at the point farthest from loop[0]
    let far = 0, fd = -1;
    loop.forEach((p, i) => { const d = (p.x - loop[0].x) ** 2 + (p.y - loop[0].y) ** 2; if (d > fd) { fd = d; far = i; } });
    const L = loop.length;
    const ia = rdp(loop.slice(0, far + 1), tolerance), ib = rdp([...loop.slice(far), loop[0]], tolerance).map(i => i + far);
    let idx = [...ia, ...ib.slice(1, -1)];
    if (idx.length < 3) idx = L <= 4 ? loop.map((_, i) => i) : [0, Math.floor(L / 3), Math.floor(2 * L / 3)];
    const simp = idx.map(i => ({ ...loop[i] })), n = simp.length, lim = cornerAngle * Math.PI / 180;
    const corner = simp.map((pnt, i) => {
      const pr = simp[(i - 1 + n) % n], nx = simp[(i + 1) % n], v1 = sub2(pnt, pr), v2 = sub2(nx, pnt);
      const c = dot2(v1, v2) / ((len2(v1) * len2(v2)) || 1);
      return n < 4 || Math.acos(Math.max(-1, Math.min(1, c))) >= lim;
    });
    // Corner refinement: marching squares chamfers sharp corners, so move each corner to the
    // intersection of least-squares lines fitted to the raw contour on both sides.
    const spanLine = k => {
      const a = idx[k], b = k + 1 < n ? idx[k + 1] : idx[0] + L, raw = [];
      for (let i = a; i <= b; i++) raw.push(loop[i % L]);
      const inner = raw.filter(p => Math.hypot(p.x - raw[0].x, p.y - raw[0].y) > 1.5 && Math.hypot(p.x - raw[raw.length - 1].x, p.y - raw[raw.length - 1].y) > 1.5);
      return fitLine(inner.length >= 2 ? inner : raw);
    };
    const lines = simp.map((_, k) => spanLine(k));
    simp.forEach((pnt, i) => {
      if (!corner[i]) return;
      const q = intersectLines(lines[(i - 1 + n) % n], lines[i]);
      if (q && Math.hypot(q.x - pnt.x, q.y - pnt.y) <= Math.max(1.5, tolerance)) { pnt.x = q.x; pnt.y = q.y; }
    });
    let s = { closed: true, op: 'combine', points: simp.map((p, i) => anchor(p.x, p.y, null, null, smooth && !corner[i])) };
    if (smooth && n >= 4) for (let i = 0; i < n; i++) s = curvatureHandles(s, i);
    subpaths.push(s);
  }
  return { subpaths };
}

// ---------------------------------------------------------------- shape presets

/** Rectangle (clockwise, starting top-left). */
export function rectPath(x, y, w, h) {
  if (w < 0) { x += w; w = -w; } if (h < 0) { y += h; h = -h; }
  return polygonToPath([{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]);
}

/** Rounded rectangle; r is a number or [tl, tr, br, bl], each clamped to half the shorter side. */
export function roundedRectPath(x, y, w, h, r = 0) {
  if (w < 0) { x += w; w = -w; } if (h < 0) { y += h; h = -h; }
  const lim = Math.min(w, h) / 2, R = (Array.isArray(r) ? r : [r, r, r, r]).map(v => Math.max(0, Math.min(lim, +v || 0)));
  const k = KAPPA, P = [];
  // corners in clockwise order: each corner has the incoming edge direction and outgoing direction
  const corners = [
    { cx: x, cy: y, r: R[0], from: [0, -1], to: [1, 0] },         // top-left: comes up the left edge, leaves along the top
    { cx: x + w, cy: y, r: R[1], from: [1, 0], to: [0, 1] },      // top-right
    { cx: x + w, cy: y + h, r: R[2], from: [0, 1], to: [-1, 0] }, // bottom-right
    { cx: x, cy: y + h, r: R[3], from: [-1, 0], to: [0, -1] },    // bottom-left
  ];
  for (const c of corners) {
    if (c.r <= 0) { P.push(anchor(c.cx, c.cy)); continue; }
    const a = { x: c.cx - c.from[0] * c.r, y: c.cy - c.from[1] * c.r }, b = { x: c.cx + c.to[0] * c.r, y: c.cy + c.to[1] * c.r };
    P.push(anchor(a.x, a.y, null, { x: a.x + c.from[0] * c.r * k, y: a.y + c.from[1] * c.r * k }));
    P.push(anchor(b.x, b.y, { x: b.x - c.to[0] * c.r * k, y: b.y - c.to[1] * c.r * k }, null));
  }
  // start at the top edge (after the top-left corner) like Photoshop
  if (R[0] > 0) P.push(P.shift());
  return { subpaths: [{ closed: true, op: 'combine', points: P }] };
}

/** Ellipse inscribed in the box, 4 smooth anchors (top, right, bottom, left). */
export function ellipsePath(x, y, w, h) {
  if (w < 0) { x += w; w = -w; } if (h < 0) { y += h; h = -h; }
  const rx = w / 2, ry = h / 2, cx = x + rx, cy = y + ry, kx = rx * KAPPA, ky = ry * KAPPA;
  return {
    subpaths: [{
      closed: true, op: 'combine', points: [
        anchor(cx, y, { x: cx - kx, y }, { x: cx + kx, y }, true),
        anchor(x + w, cy, { x: x + w, y: cy - ky }, { x: x + w, y: cy + ky }, true),
        anchor(cx, y + h, { x: cx + kx, y: y + h }, { x: cx - kx, y: y + h }, true),
        anchor(x, cy, { x, y: cy + ky }, { x, y: cy - ky }, true),
      ],
    }],
  };
}

/**
 * Regular polygon or star centred on (cx, cy) with outer radius r. opts: { star = false,
 * indent = 50 (percent: inner radius = r·(1 − indent/100)), rotation = -90 (degrees of the first vertex; −90 = pointing up) }.
 */
export function polygonPath(cx, cy, r, sides = 5, opts = {}) {
  const { star = false, indent = 50, rotation = -90 } = opts;
  const n = Math.max(3, Math.round(sides)), pts = [], rIn = r * (1 - Math.max(0, Math.min(99, indent)) / 100);
  const count = star ? 2 * n : n, a0 = rotation * Math.PI / 180;
  for (let i = 0; i < count; i++) {
    const rr = star && i % 2 ? rIn : r, a = a0 + i * 2 * Math.PI / count;
    pts.push({ x: cx + rr * Math.cos(a), y: cy + rr * Math.sin(a) });
  }
  return polygonToPath(pts);
}

/** Line tool: a filled bar of the given weight between two points (an open 2-point path when width ≤ 0). */
export function linePath(x1, y1, x2, y2, width = 1) {
  if (!(width > 0)) return { subpaths: [{ closed: false, op: 'combine', points: [anchor(x1, y1), anchor(x2, y2)] }] };
  const L = Math.hypot(x2 - x1, y2 - y1) || 1, nx = -(y2 - y1) / L * width / 2, ny = (x2 - x1) / L * width / 2;
  return polygonToPath([{ x: x1 + nx, y: y1 + ny }, { x: x2 + nx, y: y2 + ny }, { x: x2 - nx, y: y2 - ny }, { x: x1 - nx, y: y1 - ny }]);
}

// Built-in custom shapes, defined in a unit box (0..1). Original geometry.
function unitHeart() {
  return { subpaths: [{ closed: true, op: 'combine', points: [
    anchor(0.5, 0.22, { x: 0.45, y: 0.08 }, { x: 0.55, y: 0.08 }),
    anchor(0.75, 0.02, { x: 0.63, y: 0.02 }, { x: 0.89, y: 0.02 }, true),
    anchor(1, 0.3, { x: 1, y: 0.14 }, { x: 1, y: 0.52 }, true),
    anchor(0.5, 1, { x: 0.62, y: 0.82 }, { x: 0.38, y: 0.82 }),
    anchor(0, 0.3, { x: 0, y: 0.52 }, { x: 0, y: 0.14 }, true),
    anchor(0.25, 0.02, { x: 0.11, y: 0.02 }, { x: 0.37, y: 0.02 }, true),
  ] }] };
}
function unitSpeechBubble() {
  const p = roundedRectPath(0, 0, 1, 0.74, 0.16);
  const pts = p.subpaths[0].points;
  // pts (clockwise from the top edge): ..., the bottom-right corner ends at index 4 → insert the tail after it
  const i = pts.findIndex(a => Math.abs(a.y - 0.74) < 1e-9 && a.x > 0.5);
  pts.splice(i + 1, 0, anchor(0.44, 0.74), anchor(0.2, 1), anchor(0.27, 0.74));
  return p;
}
export const CUSTOM_SHAPES = {
  arrow: { name: 'Arrow', make: () => polygonToPath([{ x: 0, y: 0.35 }, { x: 0.6, y: 0.35 }, { x: 0.6, y: 0.08 }, { x: 1, y: 0.5 }, { x: 0.6, y: 0.92 }, { x: 0.6, y: 0.65 }, { x: 0, y: 0.65 }]) },
  heart: { name: 'Heart', make: unitHeart },
  star: { name: 'Star', make: () => polygonPath(0.5, 0.5, 0.5, 5, { star: true, indent: 52 }) },
  speechBubble: { name: 'Speech Bubble', make: unitSpeechBubble },
  check: { name: 'Check Mark', make: () => polygonToPath([{ x: 0, y: 0.56 }, { x: 0.14, y: 0.42 }, { x: 0.37, y: 0.65 }, { x: 0.86, y: 0.1 }, { x: 1, y: 0.24 }, { x: 0.37, y: 0.92 }]) },
};
/** Custom shape `name` (a CUSTOM_SHAPES key) scaled into the box (x, y, w, h). */
export function customShape(name, x, y, w, h) {
  const s = CUSTOM_SHAPES[name];
  if (!s) throw Error('Unknown custom shape ' + name);
  return transformPath(s.make(), [w, 0, 0, h, x, y]);
}

// ---------------------------------------------------------------- vector masks and shape layers

/**
 * SVG for a vector mask / shape fill. Returns { d, fillRule, simple, markup }:
 * - d: all subpaths in one path data string; when `simple` (every op is 'combine') the mask is
 *   just <path d={d} fill="white" fill-rule={fillRule}/>.
 * - markup: SVG body for a <mask maskUnits="userSpaceOnUse" ...> element that is exact for all ops
 *   (subtract paints black, intersect/exclude use nested masks whose ids start with opts.idPrefix).
 * opts: { fillRule = 'nonzero', idPrefix = 'vm', invert = false, bounds = {x,y,w,h} of the area to cover (needed for exclude/invert) }.
 */
export function vectorMaskSvg(path, opts = {}) {
  const { fillRule = 'nonzero', idPrefix = 'vm', invert = false } = opts;
  const d = pathToD(path);
  const groups = opGroups(path);
  const simple = groups.every(g => g.op === 'combine');
  const b = opts.bounds || (() => { const pb = pathBounds(path) || { x: 0, y: 0, w: 1, h: 1 }; return { x: pb.x - 10, y: pb.y - 10, w: pb.w + 20, h: pb.h + 20 }; })();
  const rect = fill => `<rect x="${fmt(b.x)}" y="${fmt(b.y)}" width="${fmt(b.w)}" height="${fmt(b.h)}" fill="${fill}"/>`;
  const mu = `maskUnits="userSpaceOnUse" x="${fmt(b.x)}" y="${fmt(b.y)}" width="${fmt(b.w)}" height="${fmt(b.h)}"`;
  const gd = g => g.subs.map(i => subpathToD(path.subpaths[i])).join('');
  const shape = (g, fill) => `<path d="${gd(g)}" fill="${fill}" fill-rule="${fillRule}"/>`;
  let defs = '', body = '', n = 0;
  const id = () => `${idPrefix}-${n++}`;
  groups.forEach((g, k) => {
    if (k === 0) { body = g.op === 'combine' || g.op === 'exclude' ? shape(g, 'white') : ''; return; }
    if (g.op === 'combine') body += shape(g, 'white');
    else if (g.op === 'subtract') body += shape(g, 'black');
    else if (g.op === 'intersect') { const m = id(); defs += `<mask id="${m}" ${mu}>${shape(g, 'white')}</mask>`; body = `<g mask="url(#${m})">${body}</g>`; }
    else { // exclude: acc·(1−s) + s·(1−acc)
      const notS = id(), acc = id(), notAcc = id();
      defs += `<mask id="${notS}" ${mu}>${rect('white')}${shape(g, 'black')}</mask><mask id="${acc}" ${mu}>${body}</mask>`;
      defs += `<mask id="${notAcc}" ${mu}>${rect('white')}<g mask="url(#${acc})">${rect('black')}</g></mask>`;
      body = `<g mask="url(#${notS})">${body}</g><g mask="url(#${notAcc})">${shape(g, 'white')}</g>`;
    }
  });
  if (invert) { const m = id(); defs += `<mask id="${m}" ${mu}>${body}</mask>`; body = `${rect('white')}<g mask="url(#${m})">${rect('black')}</g>`; }
  return { d, fillRule, simple: simple && !invert, markup: (defs ? `<defs>${defs}</defs>` : '') + body, bounds: b };
}

/**
 * Defaults for a 'shape' layer (path in document coordinates; x/y are an extra translation used when moving the layer).
 * fill: CSS colour or null; stroke: CSS colour or null; strokeAlign: 'inside'|'center'|'outside';
 * strokeDash: [] (solid) or dash/gap lengths in multiples of strokeWidth (Photoshop convention);
 * strokeCap: 'butt'|'round'|'square'; strokeJoin: 'miter'|'round'|'bevel'.
 */
export function shapeLayerDefaults(path = emptyPath(), over = {}) {
  return { type: 'shape', name: 'Shape 1', path: clonePath(path), fill: '#7f7f7f', stroke: null, strokeWidth: 3, strokeAlign: 'center', strokeDash: [], strokeCap: 'butt', strokeJoin: 'miter', fillRule: 'nonzero', x: 0, y: 0, ...over };
}

// ---------------------------------------------------------------- saved paths (doc.paths)

/** Id the Paths panel uses for the transient Work Path. */
export const WORK_PATH_ID = 'work';

let idCounter = 0;
export const newPathId = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : 'path-' + Date.now().toString(36) + '-' + (idCounter++).toString(36));
/** Next free default name "Path N" for doc.paths. */
export function nextPathName(paths = []) {
  let n = 1;
  const names = new Set(paths.map(p => p.name));
  while (names.has('Path ' + n)) n++;
  return 'Path ' + n;
}
/** A doc.paths entry { id, name, path }. */
export const savedPathEntry = (paths, path, name) => ({ id: newPathId(), name: name || nextPathName(paths), path: clonePath(path) });
