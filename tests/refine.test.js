import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refineMask, decontaminateColors, applyEdits, makeProxy, outputMask, nearestIndex, edgeBand, refineAlphaOp, addBrush, subtractBrush } from '../src/engine/refine.js';
import { distanceTransform } from '../src/engine/selection.js';

// Fixture: red disc (centre 40,30, radius 16) with a soft 6-px edge over a blue background.
// Pixels are an exact alpha blend, so the ground-truth alpha is known.
const W = 80, H = 60, FG = [210, 60, 40], BG = [40, 90, 210];
const truth = new Float32Array(W * H);
const img = { w: W, h: H, data: new Uint8ClampedArray(W * H * 4) };
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = y * W + x, a = Math.min(1, Math.max(0, (16 - Math.hypot(x + 0.5 - 40, y + 0.5 - 30)) / 6 + 0.5));
  truth[i] = a;
  for (let c = 0; c < 3; c++) img.data[i * 4 + c] = Math.round(FG[c] * a + BG[c] * (1 - a));
  img.data[i * 4 + 3] = 255;
}
// Hard rectangle-ish input: a square that roughly covers the disc (corners and sides off by several px)
const rectMask = new Uint8Array(W * H);
for (let y = 17; y < 44; y++) for (let x = 27; x < 54; x++) rectMask[y * W + x] = 255;
// Hard disc mask 2 px too small
const hardDisc = new Uint8Array(W * H);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) hardDisc[y * W + x] = Math.hypot(x + 0.5 - 40, y + 0.5 - 30) < 14 ? 255 : 0;

const err = m => { let s = 0; for (let i = 0; i < m.length; i++) s += Math.abs(m[i] / 255 - truth[i]); return s / m.length; };
const sum = m => m.reduce((s, v) => s + v, 0);
const softCount = m => m.reduce((s, v) => s + (v > 5 && v < 250 ? 1 : 0), 0);

test('refineMask: defaults return the input mask unchanged', () => {
  assert.deepEqual(refineMask(img, hardDisc, {}), hardDisc);
});

test('refineMask: edge-detection radius makes the alpha follow the soft image edge', () => {
  const e0 = err(rectMask), e1 = err(refineMask(img, rectMask, { radius: 12 }));
  assert.ok(e1 < e0 * 0.35, `error ${e1.toFixed(4)} should be far below ${e0.toFixed(4)}`);
  const d0 = err(hardDisc), d1 = err(refineMask(img, hardDisc, { radius: 6 }));
  assert.ok(d1 < d0 * 0.3, `disc error ${d1.toFixed(4)} vs ${d0.toFixed(4)}`);
  // a pixel exactly on the soft ramp gets a fractional alpha close to the truth
  const r = refineMask(img, hardDisc, { radius: 6 }), i = 30 * W + 40 + 16; // on the 50 % contour
  assert.ok(Math.abs(r[i] / 255 - truth[i]) < 0.12, `alpha ${r[i]} vs ${truth[i] * 255}`);
});

test('refineMask: smart radius also improves the matte; edgeBand narrows on a hard image edge', () => {
  const e = err(refineMask(img, rectMask, { radius: 12, smartRadius: true }));
  assert.ok(e < err(rectMask) * 0.5);
  // hard-edged object: a black square on white, mask = that square → the smart band is narrower
  const hard = { w: W, h: H, data: new Uint8ClampedArray(W * H * 4) }, m = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const inS = x >= 20 && x < 60 && y >= 15 && y < 45, v = inS ? 0 : 255; hard.data.set([v, v, v, 255], (y * W + x) * 4); m[y * W + x] = inS ? 255 : 0; }
  const plain = edgeBand(hard, m, { radius: 10 }).unknown, smart = edgeBand(hard, m, { radius: 10, smartRadius: true }).unknown;
  assert.ok(sum(smart) < sum(plain) * 0.5, `${sum(smart)} vs ${sum(plain)}`);
});

test('refineMask: the refine edge brush recomputes painted areas only', () => {
  const rb = new Uint8Array(W * H);
  addBrush(rb, W, H, [20, 30, 60, 30], 6); // horizontal band through the disc edges left and right
  const r = refineMask(img, rectMask, { radius: 0 }, { refineBrush: rb });
  assert.equal(r[5 * W + 40], rectMask[5 * W + 40]); // untouched outside the brush
  const row = y => { let s = 0; for (let x = 0; x < W; x++) s += Math.abs(r[y * W + x] / 255 - truth[y * W + x]) - Math.abs(rectMask[y * W + x] / 255 - truth[y * W + x]); return s; };
  assert.ok(row(30) < -3, 'error along the brushed row decreases');
});

test('refineMask: shift edge grows and shrinks; feather softens; contrast hardens', () => {
  const base = sum(hardDisc);
  const grown = refineMask(img, hardDisc, { shiftEdge: 50 }), shrunk = refineMask(img, hardDisc, { shiftEdge: -50 });
  assert.ok(sum(grown) > base * 1.2 && sum(shrunk) < base * 0.8, `${sum(grown)} ${base} ${sum(shrunk)}`);
  // +50 % of 4 px = 2 px: radius 14 → 16
  assert.equal(grown[30 * W + 40 + 15], 255); assert.equal(grown[30 * W + 40 + 17], 0);
  assert.equal(shrunk[30 * W + 40 + 11], 255); assert.equal(shrunk[30 * W + 40 + 13], 0);
  const f = refineMask(img, hardDisc, { feather: 4 });
  assert.ok(softCount(f) > softCount(hardDisc) + 200);
  assert.ok(Math.abs(sum(f) - base) / base < 0.05, 'feather keeps the area roughly');
  const soft = refineMask(img, hardDisc, { feather: 6 }), hardened = refineMask(img, hardDisc, { feather: 6, contrast: 80 });
  assert.ok(softCount(hardened) < softCount(soft) * 0.4);
  // a soft profile is shifted too
  const sg = refineMask(img, hardDisc, { feather: 6, shiftEdge: 100 });
  assert.ok(sum(sg) > sum(soft) * 1.25);
});

test('refineMask: smooth removes jaggies while keeping the shape', () => {
  const jag = Uint8Array.from(hardDisc); for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x++) if (hardDisc[y * W + x] && !hardDisc[y * W + x + 2]) jag[y * W + x + 1] = jag[y * W + x + 2] = 255;
  const s = refineMask(img, jag, { smooth: 100 });
  // total variation (sum of neighbour differences) measures the jagged outline length
  const tv = m => { let d = 0; for (let y = 0; y < H - 1; y++) for (let x = 0; x < W - 1; x++) { const i = y * W + x; d += Math.abs(m[i] - m[i + 1]) + Math.abs(m[i] - m[i + W]); } return d; };
  assert.ok(tv(s) - tv(hardDisc) < (tv(jag) - tv(hardDisc)) * 0.4, `${tv(s)} vs ${tv(jag)} (clean ${tv(hardDisc)})`); // most of the excess outline is gone
  assert.ok(Math.abs(sum(s) - sum(jag)) / sum(jag) < 0.05, 'area is kept');
});

test('decontaminateColors removes the background tint at the edge', () => {
  const a = refineMask(img, hardDisc, { radius: 6 }), i = 30 * W + 40 + 17; // ~ 33 % alpha pixel
  assert.ok(a[i] > 20 && a[i] < 200);
  const before = img.data.slice(i * 4, i * 4 + 3), out = decontaminateColors(img, a, 100), after = out.data.slice(i * 4, i * 4 + 3);
  assert.ok(before[2] > 120, 'edge pixel starts blue-tinted');
  assert.ok(after[2] < 80 && after[0] > 170, `decontaminated ${[...after]}`);
  const half = decontaminateColors(img, a, 50).data[i * 4 + 2];
  assert.ok(half < before[2] && half > after[2]);
  const core = 30 * W + 40; assert.deepEqual([...out.data.slice(core * 4, core * 4 + 4)], [...img.data.slice(core * 4, core * 4 + 4)]);
  assert.equal(out.data[i * 4 + 3], 255, 'alpha channel untouched');
});

test('nearestIndex matches the distance transform', () => {
  const on = i => hardDisc[i] === 255, near = nearestIndex(W, H, on), d = distanceTransform(W, H, on);
  for (let i = 0; i < W * H; i += 7) { const j = near[i], dx = (i % W) - (j % W), dy = ((i / W) | 0) - ((j / W) | 0); assert.ok(on(j)); assert.equal(dx * dx + dy * dy, d[i]); }
});

test('applyEdits: brush, lasso, quick selection, refine, clear, invert; proxy scale', () => {
  const empty = new Uint8Array(W * H);
  const r1 = applyEdits(img, empty, [{ tool: 'quick', mode: 'add', pts: [40, 30], r: 4 }]);
  assert.equal(r1.mask[30 * W + 40], 255); assert.equal(r1.mask[5 * W + 5], 0);
  assert.ok(sum(r1.mask) / 255 > 300, 'quick selection grows beyond the brush');
  const r2 = applyEdits(img, empty, [{ tool: 'lasso', mode: 'add', pts: [10, 10, 30, 10, 30, 30, 10, 30] }, { tool: 'brush', mode: 'subtract', pts: [20, 20], r: 3 }]);
  assert.equal(r2.mask[12 * W + 12], 255); assert.equal(r2.mask[20 * W + 20], 0); assert.equal(r2.mask[40 * W + 40], 0);
  const r3 = applyEdits(img, hardDisc, [{ tool: 'invert' }, { tool: 'refine', mode: 'add', pts: [5, 5], r: 2 }]);
  assert.equal(r3.mask[30 * W + 40], 0); assert.equal(r3.refineBrush[5 * W + 5], 255);
  assert.equal(sum(applyEdits(img, hardDisc, [{ tool: 'clear' }]).mask), 0);
  subtractBrush(r3.refineBrush, W, H, [5, 5], 3); assert.equal(r3.refineBrush[5 * W + 5], 0);
  // proxy at half size: doc coords scale down
  const p = makeProxy(img, hardDisc, 40);
  assert.equal(p.buf.w, 40); assert.equal(p.scale, 0.5); assert.equal(p.mask[15 * 40 + 20], 255);
  const r4 = applyEdits(p.buf, p.mask, [{ tool: 'brush', mode: 'add', pts: [70, 10], r: 4 }], p.scale);
  assert.equal(r4.mask[5 * 40 + 35], 255);
  // the same settings on the proxy give the same matte as full resolution (downscaled)
  const full = makeProxy(img, refineMask(img, hardDisc, { radius: 6, feather: 2 }), 40).mask, prev = refineMask(p.buf, p.mask, { radius: 6, feather: 2, scale: p.scale });
  let e = 0; for (let i = 0; i < prev.length; i++) e += Math.abs(prev[i] - full[i]); assert.ok(e / prev.length < 8, `mean proxy diff ${e / prev.length}`);
});

test('outputMask buffers and refineAlphaOp', () => {
  const a = refineMask(img, hardDisc, { radius: 6 });
  assert.equal(outputMask(img, a, 'selection').mask, a);
  const nl = outputMask(img, a, 'newLayer');
  assert.equal(nl.pixels.data[(30 * W + 40) * 4 + 3], 255); assert.equal(nl.pixels.data[3], 0);
  const nm = outputMask(img, a, 'newLayerMask', { decontaminate: true });
  assert.equal(nm.mask, a); assert.equal(nm.pixels.data[3], 255);
  const layer = { w: W, h: H, data: new Uint8ClampedArray(img.data) };
  for (let i = 0; i < W * H; i++) layer.data[i * 4 + 3] = hardDisc[i];
  const o = refineAlphaOp(layer, { radius: 6 });
  const i = 30 * W + 40 + 16; assert.ok(Math.abs(o.data[i * 4 + 3] / 255 - truth[i]) < 0.15);
});
