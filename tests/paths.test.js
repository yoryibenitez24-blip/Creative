import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pathToD, subpathToD, flattenPath, pathLength, pathBounds, hitTest, nearestOnSegment, insertAnchor, deleteAnchor, deleteAnchors,
  convertPoint, moveAnchors, moveHandle, dragSegment, transformPath, rotateMatrix, scaleMatrix, multiplyMatrix, translateMatrix, applyMatrix,
  rasterizePath, pathToSelectionShape, strokePathPoints, maskToPath, fitBezier, curvatureHandles, rectPath, roundedRectPath, ellipsePath,
  polygonPath, linePath, customShape, CUSTOM_SHAPES, vectorMaskSvg, shapeLayerDefaults, segmentControls, cubicPoint, subpathAt,
  reverseSubpath, duplicateSubpaths, nextPathName, savedPathEntry, opGroups,
} from '../src/engine/paths.js';
import { computeMask, appendOp } from '../src/engine/selection.js';

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} expected ${b} ± ${eps}, got ${a}`);
const sum = m => m.reduce((s, v) => s + v, 0) / 255;
const curve = { subpaths: [{ closed: false, op: 'combine', points: [
  { x: 10, y: 10, in: null, out: { x: 40, y: -20 }, smooth: false },
  { x: 90, y: 60, in: { x: 70, y: 90 }, out: null, smooth: false },
] }] };

test('d-string: lines, curves, closing', () => {
  assert.equal(pathToD(rectPath(1, 2, 10, 20)), 'M1 2L11 2L11 22L1 22Z');
  assert.equal(pathToD(curve), 'M10 10C40 -20 70 90 90 60');
  // a curved closing segment is written explicitly before Z
  const e = ellipsePath(0, 0, 20, 10);
  assert.match(pathToD(e), /^M10 0C.*C.*C.*C[^C]*10 0Z$/);
  assert.equal(subpathToD({ closed: false, points: [] }), '');
  assert.equal(pathToD(rectPath(10, 10, -5, -5)), 'M5 5L10 5L10 10L5 10Z');
});

test('flatten: circle path length ≈ 2πr within 1%, polyline stays within tolerance', () => {
  const r = 100, e = ellipsePath(0, 0, 2 * r, 2 * r);
  const L = pathLength(e);
  near(L, 2 * Math.PI * r, 2 * Math.PI * r * 0.01, 'length');
  const f = flattenPath(e, 0.25)[0].points;
  for (let i = 0; i < f.length; i += 2) near(Math.hypot(f[i] - r, f[i + 1] - r), r, 0.4, 'radius');
  assert.ok(f.length / 2 > 20 && f.length / 2 < 400);
  near(pathLength(rectPath(0, 0, 30, 10)), 80, 1e-9);
});

test('bounds are exact on curve extrema', () => {
  const b = pathBounds(ellipsePath(10, 20, 100, 50));
  near(b.x, 10, 1e-9); near(b.y, 20, 1e-9); near(b.w, 100, 1e-9); near(b.h, 50, 1e-9);
  const c = pathBounds(curve);
  // y minimum of the curve lies strictly above the anchors but not as high as the control point
  assert.ok(c.y < 10 && c.y > -20);
  assert.equal(pathBounds({ subpaths: [] }), null);
});

test('rasterize: rect exact, ellipse ≈ πab, fill rules, ops, non-AA', () => {
  const W = 64, H = 64;
  near(sum(rasterizePath(rectPath(10.5, 10.25, 20, 13.5), W, H)), 20 * 13.5, 0.5, 'rect area');
  near(sum(rasterizePath(ellipsePath(8, 12, 40, 30), W, H)), Math.PI * 20 * 15, Math.PI * 300 * 0.01, 'ellipse area');
  // two concentric squares in the same direction: nonzero fills the hole, evenodd keeps it
  const two = { subpaths: [rectPath(10, 10, 40, 40).subpaths[0], rectPath(20, 20, 20, 20).subpaths[0]] };
  near(sum(rasterizePath(two, W, H)), 1600, 0.5);
  near(sum(rasterizePath(two, W, H, { fillRule: 'evenodd' })), 1200, 0.5);
  // ops: subtract / intersect / exclude
  const opPath = op => ({ subpaths: [rectPath(10, 10, 20, 20).subpaths[0], { ...rectPath(20, 10, 20, 20).subpaths[0], op }] });
  near(sum(rasterizePath(opPath('subtract'), W, H)), 200, 0.5);
  near(sum(rasterizePath(opPath('intersect'), W, H)), 200, 0.5);
  near(sum(rasterizePath(opPath('exclude'), W, H)), 400, 0.5);
  near(sum(rasterizePath(opPath('combine'), W, H)), 600, 0.5);
  assert.deepEqual(opGroups(opPath('subtract')).map(g => g.op), ['combine', 'subtract']);
  // non-antialiased output is binary and matches pixel-centre sampling
  const m = rasterizePath(ellipsePath(8, 12, 40, 30), W, H, { antialias: false });
  assert.ok(m.every(v => v === 0 || v === 255));
  assert.equal(m[27 * W + 28], 255); assert.equal(m[0], 0);
  near(sum(m), Math.PI * 300, 20);
  // half-covered edge pixel
  const half = rasterizePath(rectPath(2.5, 2, 4, 4), 10, 10);
  assert.equal(half[3 * 10 + 2], 128); assert.equal(half[3 * 10 + 3], 255);
});

test('path → selection shape plugs into the selection engine', () => {
  const W = 50, H = 40, shape = pathToSelectionShape(ellipsePath(5, 5, 30, 20), W, H);
  assert.equal(shape.type, 'bitmap');
  const mask = computeMask(appendOp(null, { op: 'replace', shape }), W, H);
  assert.deepEqual(mask, rasterizePath(ellipsePath(5, 5, 30, 20), W, H));
  assert.equal(pathToSelectionShape(rectPath(100, 100, 5, 5), W, H), null);
});

test('insert anchor at t=0.5 preserves the curve exactly', () => {
  const p = insertAnchor(curve, 0, 0, 0.5);
  assert.equal(p.subpaths[0].points.length, 3);
  const orig = segmentControls(curve.subpaths[0], 0);
  const mid = p.subpaths[0].points[1];
  const q = cubicPoint(orig, 0.5);
  near(mid.x, q.x, 1e-9); near(mid.y, q.y, 1e-9);
  assert.equal(mid.smooth, true);
  for (let k = 0; k <= 10; k++) {
    const a = cubicPoint(orig, k / 20), b = cubicPoint(segmentControls(p.subpaths[0], 0), k / 10);
    near(a.x, b.x, 1e-9); near(a.y, b.y, 1e-9);
    const c = cubicPoint(orig, 0.5 + k / 20), d = cubicPoint(segmentControls(p.subpaths[0], 1), k / 10);
    near(c.x, d.x, 1e-9); near(c.y, d.y, 1e-9);
  }
  // straight segment: a corner point on the line
  const r = insertAnchor(rectPath(0, 0, 10, 10), 0, 3, 0.25); // closing segment (0,10)→(0,0)
  assert.deepEqual([r.subpaths[0].points[4].x, r.subpaths[0].points[4].y], [0, 7.5]);
  assert.equal(r.subpaths[0].points[4].in, null);
  // the original is untouched (pure)
  assert.equal(curve.subpaths[0].points.length, 2);
});

test('hit-test: handles before anchors before segments; parameter t', () => {
  const p = curve;
  assert.deepEqual(hitTest(p, { x: 11, y: 11 }, 3), { type: 'anchor', sub: 0, index: 0 });
  assert.equal(hitTest(p, { x: 40, y: -19 }, 3), null); // no handles requested → not a handle
  assert.deepEqual(hitTest(p, { x: 40, y: -19 }, 3, { handles: 'all' }), { type: 'handle', sub: 0, index: 0, which: 'out' });
  assert.deepEqual(hitTest(p, { x: 70, y: 89 }, 3, { handles: new Set(['0:1']) }), { type: 'handle', sub: 0, index: 1, which: 'in' });
  assert.equal(hitTest(p, { x: 70, y: 89 }, 3, { handles: new Set(['0:0']) }), null);
  const q = cubicPoint(segmentControls(p.subpaths[0], 0), 0.3);
  const h = hitTest(p, { x: q.x + 1, y: q.y }, 3);
  assert.equal(h.type, 'segment'); near(h.t, 0.3, 0.02); assert.ok(h.dist <= 1.0001);
  assert.equal(hitTest(p, { x: 200, y: 200 }, 3), null);
  const r = nearestOnSegment(rectPath(0, 0, 10, 10).subpaths[0], 0, { x: 4, y: -3 });
  near(r.t, 0.4, 1e-12); near(r.dist, 3, 1e-12);
  // path selection: inside fill counts
  const two = { subpaths: [rectPath(0, 0, 10, 10).subpaths[0], rectPath(20, 0, 10, 10).subpaths[0]] };
  assert.equal(subpathAt(two, { x: 25, y: 5 }, 1), 1);
  assert.equal(subpathAt(two, { x: 15, y: 5 }, 1), -1);
});

test('delete, convert, move anchors and handles', () => {
  const r = rectPath(0, 0, 10, 10);
  assert.equal(deleteAnchor(r, 0, 1).subpaths[0].points.length, 3);
  // Direct Selection delete: closed opens, open splits
  const opened = deleteAnchors(r, ['0:1']);
  assert.equal(opened.subpaths.length, 1); assert.equal(opened.subpaths[0].closed, false);
  assert.deepEqual(opened.subpaths[0].points.map(a => [a.x, a.y]), [[10, 10], [0, 10], [0, 0]]);
  const line = { subpaths: [{ closed: false, op: 'combine', points: [0, 1, 2, 3, 4].map(x => ({ x: x * 10, y: 0, in: null, out: null, smooth: false })) }] };
  const split = deleteAnchors(line, ['0:2']);
  assert.equal(split.subpaths.length, 2);
  assert.deepEqual(split.subpaths.map(s => s.points.length), [2, 2]);
  // convert corner → smooth gives collinear handles; back to corner removes them
  const sm = convertPoint(r, 0, 1, true).subpaths[0].points[1];
  assert.ok(sm.smooth && sm.in && sm.out);
  const cr = (sm.in.x - sm.x) * (sm.out.y - sm.y) - (sm.in.y - sm.y) * (sm.out.x - sm.x);
  near(cr, 0, 1e-9);
  const back = convertPoint(convertPoint(r, 0, 1, true), 0, 1, false).subpaths[0].points[1];
  assert.equal(back.in, null); assert.equal(back.out, null); assert.equal(back.smooth, false);
  // move anchors carries handles
  const mv = moveAnchors(curve, ['0:0'], 5, -5).subpaths[0].points[0];
  assert.deepEqual([mv.x, mv.y, mv.out.x, mv.out.y], [15, 5, 45, -25]);
  // smooth handle drag keeps the opposite handle collinear with its own length; Alt breaks it
  const e = ellipsePath(0, 0, 100, 100);
  const top = e.subpaths[0].points[0];
  const lenIn = Math.hypot(top.in.x - top.x, top.in.y - top.y);
  const m1 = moveHandle(e, 0, 0, 'out', 50 + 30, 30).subpaths[0].points[0];
  near(Math.hypot(m1.in.x - 50, m1.in.y), lenIn, 1e-9);
  near((m1.in.x - 50) * 30 - m1.in.y * 30, 0, 1e-9); // in is opposite of (30,30)
  const m2 = moveHandle(e, 0, 0, 'out', 80, 30, { independent: true }).subpaths[0].points[0];
  assert.deepEqual(m2.in, top.in); assert.equal(m2.smooth, false);
  const m3 = moveHandle(e, 0, 0, 'out', 70, 10, { symmetric: true }).subpaths[0].points[0];
  assert.deepEqual(m3.in, { x: 30, y: -10 });
  // dragging a curve segment moves its point at t by exactly the drag
  const c0 = segmentControls(curve.subpaths[0], 0), before = cubicPoint(c0, 0.4);
  const dragged = dragSegment(curve, 0, 0, 0.4, 7, -3);
  const after = cubicPoint(segmentControls(dragged.subpaths[0], 0), 0.4);
  near(after.x - before.x, 7, 1e-9); near(after.y - before.y, -3, 1e-9);
  // dragging a straight segment moves both anchors
  const ds = dragSegment(r, 0, 0, 0.5, 0, 4).subpaths[0].points;
  assert.deepEqual([ds[0].y, ds[1].y, ds[2].y], [4, 4, 10]);
  // reverse & duplicate
  const rev = reverseSubpath(curve.subpaths[0]);
  assert.deepEqual(rev.points[0].out, { x: 70, y: 90 });
  const dup = duplicateSubpaths(r, [0]);
  assert.equal(dup.path.subpaths.length, 2); assert.deepEqual(dup.indices, [1]);
});

test('transforms: translate, scale about a point, rotate 90°, composition', () => {
  const r = rectPath(0, 0, 10, 20);
  assert.equal(pathToD(transformPath(r, translateMatrix(5, 6))), 'M5 6L15 6L15 26L5 26Z');
  assert.equal(pathToD(transformPath(r, scaleMatrix(2, 2, 5, 10))), 'M-5 -10L15 -10L15 30L-5 30Z');
  assert.equal(pathToD(transformPath(r, rotateMatrix(90, 0, 0))), 'M0 0L0 10L-20 10L-20 0Z');
  const m = multiplyMatrix(translateMatrix(3, 4), scaleMatrix(2)); // scale first, then translate
  assert.deepEqual(applyMatrix(m, { x: 1, y: 1 }), { x: 5, y: 6 });
  // handles transform as well; only listed subpaths change
  const t = transformPath(curve, translateMatrix(1, 1));
  assert.deepEqual(t.subpaths[0].points[0].out, { x: 41, y: -19 });
  const two = { subpaths: [r.subpaths[0], r.subpaths[0]] };
  const only = transformPath(two, translateMatrix(100, 0), [1]);
  assert.equal(only.subpaths[0].points[0].x, 0); assert.equal(only.subpaths[1].points[0].x, 100);
  // rotation keeps the area
  near(sum(rasterizePath(transformPath(rectPath(20, 20, 20, 10), rotateMatrix(30, 30, 25)), 64, 64)), 200, 1);
});

test('polygon, star, line and custom shape geometry', () => {
  const hex = polygonPath(50, 50, 20, 6, { rotation: 0 });
  const pts = hex.subpaths[0].points;
  assert.equal(pts.length, 6);
  pts.forEach(p => near(Math.hypot(p.x - 50, p.y - 50), 20, 1e-9));
  near(sum(rasterizePath(hex, 100, 100)), 1.5 * Math.sqrt(3) * 400, 1, 'hexagon area');
  const star = polygonPath(50, 50, 20, 5, { star: true, indent: 50 });
  const sp = star.subpaths[0].points;
  assert.equal(sp.length, 10);
  near(Math.hypot(sp[0].x - 50, sp[0].y - 50), 20, 1e-9); near(Math.hypot(sp[1].x - 50, sp[1].y - 50), 10, 1e-9);
  near(sp[0].x, 50, 1e-9); near(sp[0].y, 30, 1e-9); // first vertex points up
  // star area = n · r · rIn · sin(π/n)
  near(sum(rasterizePath(star, 100, 100)), 5 * 20 * 10 * Math.sin(Math.PI / 5), 1.5, 'star area');
  near(sum(rasterizePath(linePath(10, 10, 50, 40, 4), 64, 64)), 50 * 4, 1, 'line area');
  assert.equal(linePath(0, 0, 5, 5, 0).subpaths[0].closed, false);
  const rr = roundedRectPath(0, 0, 40, 20, 5);
  near(sum(rasterizePath(rr, 64, 64)), 800 - (4 - Math.PI) * 25, 1, 'rounded rect area');
  assert.equal(roundedRectPath(0, 0, 40, 20, 0).subpaths[0].points.length, 4);
  for (const k of Object.keys(CUSTOM_SHAPES)) {
    const s = customShape(k, 10, 10, 40, 40), b = pathBounds(s);
    assert.ok(b.x >= 9.99 && b.y >= 9.99 && b.x + b.w <= 50.01 && b.y + b.h <= 50.01, k + ' in box');
    const a = sum(rasterizePath(s, 64, 64));
    assert.ok(a > 300 && a < 1600, k + ' area ' + a);
  }
});

test('maskToPath round trip keeps the area; holes survive; tolerance simplifies', () => {
  const W = 80, H = 80;
  const disc = rasterizePath(ellipsePath(10, 10, 50, 40), W, H);
  const p = maskToPath(disc, W, H, 1);
  assert.equal(p.subpaths.length, 1);
  const back = rasterizePath(p, W, H);
  near(sum(back), sum(disc), sum(disc) * 0.02, 'disc area');
  assert.ok(p.subpaths[0].points.length < 60);
  // ring: outer + hole; nonzero fill must keep the hole
  const ring = rasterizePath({ subpaths: [rectPath(10, 10, 50, 50).subpaths[0], { ...rectPath(25, 25, 20, 20).subpaths[0], op: 'subtract' }] }, W, H);
  const rp = maskToPath(ring, W, H, 0.5);
  assert.equal(rp.subpaths.length, 2);
  near(sum(rasterizePath(rp, W, H)), 2500 - 400, 30, 'ring area');
  assert.equal(rasterizePath(rp, W, H)[35 * W + 35], 0);
  // square corners stay corners (4 anchors)
  const sq = maskToPath(rasterizePath(rectPath(10, 10, 30, 30), W, H), W, H, 1);
  assert.equal(sq.subpaths[0].points.length, 4);
  near(sum(rasterizePath(sq, W, H)), 900, 10);
  assert.equal(maskToPath(new Uint8Array(W * H), W, H).subpaths.length, 0);
});

test('stroke path points: even spacing, taper pressure', () => {
  const pts = strokePathPoints(rectPath(0, 0, 10, 10), 2);
  assert.equal(pts.length, 21); // 40 px perimeter, closed, both ends included
  for (let i = 1; i < pts.length; i++) near(Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y), 2, 1e-9);
  assert.ok(pts.every(p => p.pressure === 1)); assert.equal(pts[0].start, true); assert.equal(pts[1].start, false);
  const t = strokePathPoints(linePath(0, 0, 100, 0, 0), 10, { taper: 'both' });
  near(t[0].pressure, 0, 1e-9); near(t[5].pressure, 1, 1e-9); near(t[10].pressure, 0, 1e-9);
  const tm = strokePathPoints(linePath(0, 0, 100, 0, 0), 10, { taper: 'end', minPressure: 0.2 });
  near(tm[10].pressure, 0.2, 1e-9);
});

test('fitBezier approximates a sampled arc within tolerance; curvature handles make circles', () => {
  const r = 50, raw = [];
  for (let a = 0; a <= Math.PI; a += 0.02) raw.push({ x: 60 + r * Math.cos(a), y: 60 + r * Math.sin(a) });
  const s = fitBezier(raw, 1);
  assert.ok(s.points.length >= 2 && s.points.length <= 6);
  for (const f of flattenPath({ subpaths: [s] }, 0.1)) for (let i = 0; i < f.points.length; i += 2) near(Math.hypot(f.points[i] - 60, f.points[i + 1] - 60), r, 1.5);
  const sub = { closed: true, op: 'combine', points: [[50, 0], [100, 50], [50, 100], [0, 50]].map(([x, y]) => ({ x, y, in: null, out: null, smooth: true })) };
  let c = sub; for (let i = 0; i < 4; i++) c = curvatureHandles(c, i);
  near(sum(rasterizePath({ subpaths: [c] }, 110, 110)), Math.PI * 2500, Math.PI * 2500 * 0.01, 'curvature circle');
});

test('vector mask svg, shape layer defaults, saved path names', () => {
  const simple = vectorMaskSvg(rectPath(0, 0, 10, 10));
  assert.equal(simple.simple, true); assert.equal(simple.d, 'M0 0L10 0L10 10L0 10Z');
  assert.match(simple.markup, /^<path d="M0 0L10 0L10 10L0 10Z" fill="white" fill-rule="nonzero"\/>$/);
  const ops = { subpaths: [rectPath(0, 0, 10, 10).subpaths[0], { ...rectPath(5, 0, 10, 10).subpaths[0], op: 'subtract' }, { ...rectPath(0, 5, 20, 2).subpaths[0], op: 'intersect' }, { ...rectPath(0, 0, 2, 2).subpaths[0], op: 'exclude' }] };
  const v = vectorMaskSvg(ops, { idPrefix: 'L1' });
  assert.equal(v.simple, false);
  assert.match(v.markup, /fill="black"/); assert.match(v.markup, /<mask id="L1-0" maskUnits="userSpaceOnUse"/);
  const ids = [...v.markup.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const m of v.markup.matchAll(/url\(#([^)]+)\)/g)) assert.ok(ids.includes(m[1]));
  const inv = vectorMaskSvg(rectPath(0, 0, 10, 10), { invert: true, bounds: { x: 0, y: 0, w: 100, h: 100 } });
  assert.equal(inv.simple, false); assert.match(inv.markup, /width="100"/);
  const L = shapeLayerDefaults(rectPath(0, 0, 5, 5), { fill: '#ff0000' });
  assert.equal(L.type, 'shape'); assert.equal(L.fill, '#ff0000'); assert.equal(L.x, 0);
  assert.equal(JSON.parse(JSON.stringify(L)).path.subpaths[0].points.length, 4);
  assert.equal(nextPathName([{ name: 'Path 1' }, { name: 'Path 3' }]), 'Path 2');
  const e = savedPathEntry([], rectPath(0, 0, 1, 1));
  assert.equal(e.name, 'Path 1'); assert.ok(e.id);
});
