import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OPS, OP_BY_ID, runOp, defaults } from '../src/engine/ops.js';
import { curveLut, rgbToHsl, hslToRgb } from '../src/engine/color.js';
import { histogram } from '../src/engine/adjust.js';
import { resample, rotate90, flipH, placeInto, anchorOffset } from '../src/engine/geometry.js';
import { computeMask } from '../src/engine/selection.js';

// Deterministic test image: gradients + a hard edge + partial alpha corner.
function img(w = 48, h = 32, alphaCorner = true) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    data[i] = x * 255 / (w - 1); data[i + 1] = y * 255 / (h - 1); data[i + 2] = x < w / 2 ? 40 : 210;
    data[i + 3] = alphaCorner && x < 6 && y < 6 ? 128 : 255;
  }
  return { w, h, data };
}
const flat = (w, h, rgba) => { const d = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < d.length; i += 4) d.set(rgba, i); return { w, h, data: d }; };
const maxDiff = (a, b) => { let m = 0; for (let i = 0; i < a.data.length; i++) m = Math.max(m, Math.abs(a.data[i] - b.data[i])); return m; };
const mean = (b, c) => { let s = 0; for (let i = c; i < b.data.length; i += 4) s += b.data[i]; return s / (b.w * b.h); };
const px = (b, x, y) => [...b.data.slice((y * b.w + x) * 4, (y * b.w + x) * 4 + 4)];

// Ops whose defaults are documented as a no-op.
const IDENTITY = { brightnessContrast: {}, levels: {}, curves: {}, exposure: {}, vibrance: {}, hueSaturation: {}, colorBalance: {}, photoFilter: { density: 0 }, channelMixer: {}, offset: {}, customKernel: {}, gaussianBlur: { radius: 0 }, twirl: { angle: 0 }, pinch: { amount: 0 }, spherize: { amount: 0 }, ripple: { amount: 0 }, wave: { amplitude: 0 }, unsharpMask: { amount: 0 } };

test('ops: every registry op runs, keeps size (non-geometry) and never touches the input', () => {
  for (const op of OPS) {
    if (op.geometry) continue;
    const src = img(), before = new Uint8ClampedArray(src.data);
    const mask = op.needsSelection ? Uint8Array.from({ length: 48 * 32 }, (_, i) => (i % 48 > 20 && i % 48 < 28 && i / 48 > 10 && i / 48 < 18) ? 255 : 0) : null;
    const out = runOp(op.id, src, {}, { fg: '#102030', bg: '#f0e0d0', mask, docW: 48, docH: 32 });
    assert.equal(out.w, src.w, op.id); assert.equal(out.h, src.h, op.id);
    assert.deepEqual(src.data, before, op.id + ' mutated its input');
    assert.ok(op.ledger, op.id + ' has no ledger row');
  }
});

test('ops: neutral settings are the identity (±1 for HSL round trips)', () => {
  for (const [id, p] of Object.entries(IDENTITY)) {
    const src = img(), out = runOp(id, src, p);
    assert.ok(maxDiff(src, out) <= (id === 'hueSaturation' ? 1 : 0), `${id} changed pixels by ${maxDiff(src, out)}`);
  }
});

test('ops: selection mask limits every op exactly (outside untouched, inside changed)', () => {
  const src = img(), docW = 48, docH = 32;
  const mask = computeMask({ ops: [{ op: 'replace', shape: { type: 'rect', x: 24, y: 0, w: 24, h: 32 } }] }, docW, docH);
  for (const id of ['invert', 'gaussianBlur', 'twirl', 'posterize', 'mosaic']) {
    const out = runOp(id, src, {}, { mask, docW, docH });
    for (let y = 0; y < 32; y++) for (let x = 0; x < 24; x++) assert.deepEqual(px(out, x, y), px(src, x, y), `${id} leaked outside at ${x},${y}`);
  }
  assert.notDeepEqual(px(runOp('invert', src, {}, { mask, docW, docH }), 40, 10), px(src, 40, 10));
});

test('adjust: levels, curves, invert, threshold, posterize, desaturate behave as defined', () => {
  const g = flat(4, 1, [100, 150, 200, 255]);
  assert.deepEqual(px(runOp('levels', g, { inBlack: 100, inWhite: 200 }), 0, 0), [0, 128, 255, 255]);
  assert.deepEqual(px(runOp('levels', g, { channel: 'r', outWhite: 128 }), 0, 0), [50, 150, 200, 255]);
  assert.deepEqual(px(runOp('invert', g), 0, 0), [155, 105, 55, 255]);
  assert.deepEqual(px(runOp('threshold', g, { level: 140 }), 0, 0), [255, 255, 255, 255]);
  assert.deepEqual(px(runOp('posterize', g, { levels: 2 }), 0, 0), [0, 255, 255, 255]);
  assert.deepEqual(px(runOp('desaturate', g), 0, 0), [150, 150, 150, 255]);
  const inv = runOp('curves', g, { points: { rgb: [[0, 255], [255, 0]] } });
  assert.deepEqual(px(inv, 0, 0), [155, 105, 55, 255], 'inverted curve equals invert');
});

test('adjust: monotone curve LUT passes through points and never overshoots', () => {
  const lut = curveLut([[0, 0], [64, 30], [128, 200], [255, 255]]);
  assert.equal(lut[64], 30); assert.equal(lut[128], 200);
  for (let i = 1; i < 256; i++) assert.ok(lut[i] >= lut[i - 1], 'monotone at ' + i);
});

test('adjust: exposure +1 EV doubles linear light; hue/sat colorize and black & white produce greys/tints', () => {
  const g = flat(1, 1, [128, 128, 128, 255]);
  assert.equal(runOp('exposure', g, { exposure: 1 }).data[0], 176); // linear 0.2159 → 0.4317 → sRGB 175.6
  const gray = runOp('blackWhite', flat(1, 1, [255, 0, 0, 255]));
  assert.deepEqual(px(gray, 0, 0).slice(0, 3), [102, 102, 102], 'pure red uses the 40% red weight');
  const blue = runOp('blackWhite', flat(1, 1, [0, 0, 255, 255]), { blues: 100 });
  assert.equal(blue.data[0], 255);
  const col = runOp('hueSaturation', flat(1, 1, [128, 128, 128, 255]), { colorize: true, hue: 0, saturation: 100 });
  assert.ok(col.data[0] > col.data[1] && col.data[1] === col.data[2], 'colorize red');
  const [h, s, l] = rgbToHsl(200, 50, 50); assert.deepEqual(hslToRgb(h, s, l).map(Math.round), [200, 50, 50]);
});

test('adjust: histogram counts visible pixels only', () => {
  const b = img(); const h = histogram(b);
  assert.equal(h.r.reduce((a, v) => a + v, 0), 48 * 32);
  const t = flat(2, 1, [10, 10, 10, 0]); assert.equal(histogram(t).l.reduce((a, v) => a + v, 0), 0);
});

test('filters: blurs preserve mean colour and do not darken transparent edges', () => {
  const src = img(48, 32, false);
  for (const id of ['gaussianBlur', 'boxBlur', 'motionBlur']) {
    const out = runOp(id, src, { radius: 3, distance: 6 });
    for (const c of [0, 1, 2]) assert.ok(Math.abs(mean(out, c) - mean(src, c)) < 2.5, `${id} mean shift ${mean(out, c) - mean(src, c)}`);
  }
  // white square on transparency: blurred colour must stay white (premultiplied alpha)
  const w = flat(20, 20, [0, 0, 0, 0]); for (let y = 5; y < 15; y++) for (let x = 5; x < 15; x++) w.data.set([255, 255, 255, 255], (y * 20 + x) * 4);
  const b = runOp('gaussianBlur', w, { radius: 2 });
  const e = px(b, 4, 10); assert.ok(e[3] > 0 && e[3] < 255 && e[0] === 255, 'edge pixel ' + e);
});

test('filters: unsharp mask increases edge contrast; threshold protects small differences; high pass on flat = 128', () => {
  const edge = flat(20, 1, [100, 100, 100, 255]); for (let x = 10; x < 20; x++) edge.data.set([150, 150, 150, 255], x * 4);
  const s = runOp('unsharpMask', edge, { amount: 200, radius: 1 });
  assert.ok(s.data[9 * 4] < 100 && s.data[10 * 4] > 150, 'overshoot on both sides');
  assert.equal(maxDiff(runOp('unsharpMask', edge, { amount: 200, radius: 1, threshold: 60 }), edge), 0);
  assert.equal(runOp('highPass', flat(8, 8, [90, 20, 200, 255]), { radius: 2 }).data[0], 128);
});

test('filters: noise is deterministic per seed, zero-mean, and amount 0 is identity', () => {
  const g = flat(64, 64, [128, 128, 128, 255]);
  const a = runOp('addNoise', g, { amount: 20, seed: 3 }), b = runOp('addNoise', g, { amount: 20, seed: 3 }), c = runOp('addNoise', g, { amount: 20, seed: 4 });
  assert.equal(maxDiff(a, b), 0); assert.ok(maxDiff(a, c) > 0);
  assert.ok(Math.abs(mean(a, 0) - 128) < 2, 'zero mean');
  assert.equal(maxDiff(runOp('addNoise', g, { amount: 0.0001 }), g), 0);
  const m = runOp('addNoise', g, { amount: 30, monochromatic: true });
  for (let i = 0; i < m.data.length; i += 4) assert.ok(m.data[i] === m.data[i + 1] && m.data[i] === m.data[i + 2]);
});

test('filters: median removes an isolated speck; dust & scratches only where above threshold', () => {
  const g = flat(9, 9, [50, 50, 50, 255]); g.data.set([250, 250, 250, 255], (4 * 9 + 4) * 4);
  assert.deepEqual(px(runOp('median', g, { radius: 1 }), 4, 4), [50, 50, 50, 255]);
  assert.deepEqual(px(runOp('dustScratches', g, { radius: 1, threshold: 250 }), 4, 4), [250, 250, 250, 255]);
});

test('filters: minimum/maximum grow dark/light regions; offset wraps losslessly', () => {
  const g = flat(9, 9, [200, 200, 200, 255]); g.data.set([0, 0, 0, 255], (4 * 9 + 4) * 4);
  assert.equal(runOp('minimum', g, { radius: 1 }).data[(3 * 9 + 3) * 4], 0);
  assert.equal(runOp('maximum', g, { radius: 1 }).data[(4 * 9 + 4) * 4], 200);
  const src = img(), o = runOp('offset', runOp('offset', src, { dx: 13, dy: -7 }), { dx: -13, dy: 7 });
  assert.equal(maxDiff(o, src), 0);
});

test('filters: emboss on flat = mid grey; find edges flat = white; solarize; mosaic cells are uniform', () => {
  assert.deepEqual(px(runOp('emboss', flat(8, 8, [30, 90, 200, 255])), 4, 4), [128, 128, 128, 255]);
  assert.deepEqual(px(runOp('findEdges', flat(8, 8, [30, 90, 200, 255])), 4, 4), [255, 255, 255, 255]);
  assert.deepEqual(px(runOp('solarize', flat(1, 1, [200, 100, 128, 255])), 0, 0), [55, 100, 127, 255]);
  const m = runOp('mosaic', img(), { cell: 8 });
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) assert.deepEqual(px(m, 8 + x, 8 + y), px(m, 8, 8));
});

test('filters: crystallize and halftone are deterministic and change the image', () => {
  const src = img();
  assert.equal(maxDiff(runOp('crystallize', src, { seed: 2 }), runOp('crystallize', src, { seed: 2 })), 0);
  assert.ok(maxDiff(runOp('crystallize', src), src) > 0);
  const h = runOp('colorHalftone', src, { radius: 3 });
  for (let i = 0; i < h.data.length; i += 4) for (let c = 0; c < 3; c++) assert.ok(h.data[i + c] === 0 || h.data[i + c] === 255);
});

test('filters: distortions keep the centre and corners; polar round trip stays close', () => {
  const src = img(64, 64, false);
  for (const id of ['twirl', 'pinch', 'spherize']) {
    const o = runOp(id, src, { angle: 90, amount: 60 });
    assert.equal(maxDiff({ data: o.data.slice(0, 4) }, { data: src.data.slice(0, 4) }), 0, id + ' corner moved');
    assert.ok(maxDiff(o, src) > 10, id + ' had no effect');
  }
  const w = runOp('wave', src, { amplitude: 5, wavelength: 20 }); assert.ok(maxDiff(w, src) > 0);
});

test('filters: clouds use foreground/background, are seeded and opaque', () => {
  const g = flat(32, 32, [0, 0, 0, 0]);
  const a = runOp('clouds', g, { seed: 5, scale: 16 }, { fg: '#000000', bg: '#ffffff' }), b = runOp('clouds', g, { seed: 5, scale: 16 }, { fg: '#000000', bg: '#ffffff' });
  assert.equal(maxDiff(a, b), 0);
  let lo = 255, hi = 0; for (let i = 0; i < a.data.length; i += 4) { lo = Math.min(lo, a.data[i]); hi = Math.max(hi, a.data[i]); assert.equal(a.data[i + 3], 255); }
  assert.ok(hi - lo > 60, 'cloud contrast ' + (hi - lo));
  const d = runOp('differenceClouds', flat(32, 32, [255, 255, 255, 255]), { seed: 5, scale: 16 }, { fg: '#000000', bg: '#ffffff' });
  assert.equal(d.data[0], 255 - a.data[0], 'difference with white inverts the clouds');
});

test('geometry: rotate/flip are lossless, resample keeps flat colour and alpha, placeInto anchors', () => {
  const src = img();
  const r4 = rotate90(rotate90(rotate90(rotate90(src))));
  assert.equal(maxDiff(r4, src), 0);
  assert.equal(maxDiff(flipH(flipH(src)), src), 0);
  assert.deepEqual([rotate90(src).w, rotate90(src).h], [32, 48]);
  for (const m of ['nearest', 'bilinear', 'bicubic']) {
    const f = resample(flat(40, 30, [10, 200, 90, 255]), 17, 61, m);
    assert.deepEqual([f.w, f.h], [17, 61]); assert.deepEqual(px(f, 8, 30), [10, 200, 90, 255], m);
  }
  const up = resample(src, 96, 64, 'bicubic'), down = resample(up, 48, 32, 'bicubic');
  assert.ok(maxDiff(down, src) <= 40, 'up/down round trip ' + maxDiff(down, src));
  const p = placeInto(flat(2, 2, [9, 9, 9, 255]), 4, 4, ...anchorOffset(2, 2, 4, 4, 2, 2));
  assert.deepEqual(px(p, 3, 3), [9, 9, 9, 255]); assert.deepEqual(px(p, 0, 0), [0, 0, 0, 0]);
});
