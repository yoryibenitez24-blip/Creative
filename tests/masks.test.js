import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateMask, detectSubject, detectSky, applyLocal, LOCAL_DEFAULTS, createMask, createComponent, activeMasks, componentAlpha, clearMaskCache, rgbToLab,
} from '../src/engine/masks.js';
import { develop } from '../src/engine/develop.js';
import { resample } from '../src/engine/geometry.js';
import { rng } from '../src/engine/color.js';

const mk = (w, h, f) => { const d = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = f(x, y); d.set([v[0], v[1], v[2], v[3] ?? 255], (y * w + x) * 4); } return { w, h, data: d }; };
const copy = b => ({ w: b.w, h: b.h, data: new Uint8ClampedArray(b.data) });
const at = (b, x, y) => [...b.data.slice((y * b.w + x) * 4, (y * b.w + x) * 4 + 3)];
const iou = (alpha, truth) => { let i = 0, u = 0; for (let k = 0; k < alpha.length; k++) { const a = alpha[k] > 0.5, t = truth[k]; if (a && t) i++; if (a || t) u++; } return i / u; };
const mask = (components, adjust = {}, extra = {}) => ({ id: 'm', name: 'M', enabled: true, invert: false, amount: 100, components, adjust: { ...LOCAL_DEFAULTS, ...adjust }, ...extra });
const comp = (type, params = {}, op = 'add', invert = false) => ({ id: type, type, op, invert, params });

// Scene 1: bright blue gradient sky over textured ground with a wavy horizon.
const horizon = (x, w, h) => Math.round(h * (0.45 + 0.06 * Math.sin(x / w * 7)));
function skyScene(w, h) {
  const R = rng(7);
  const noise = Array.from({ length: w * h }, () => R());
  return mk(w, h, (x, y) => {
    if (y < horizon(x, w, h)) { const t = y / h; return [70 + 90 * t, 130 + 70 * t, 235 - 10 * t]; }
    const n = noise[y * w + x], blk = ((x >> 2) + (y >> 2)) % 2;
    return [90 + 70 * n + 20 * blk, 80 + 50 * n, 40 + 30 * n];
  });
}
// Scene 2: a distinct centred object (orange ellipse) on a cluttered blocky background.
function subjectScene(w, h) {
  const R = rng(3), pal = [[40, 70, 50], [70, 80, 110], [110, 95, 80], [30, 30, 40], [150, 160, 170], [60, 110, 60]];
  const blocks = Array.from({ length: 400 }, () => pal[Math.floor(R() * pal.length)]);
  const inside = (x, y) => (((x + 0.5) / w - 0.5) / 0.2) ** 2 + (((y + 0.5) / h - 0.52) / 0.28) ** 2 < 1;
  const buf = mk(w, h, (x, y) => {
    if (inside(x, y)) { const s = 1 - 0.25 * ((y / h - 0.3)); return [235 * s, 120 * s, 30 * s]; }
    const b = blocks[(Math.floor(x / (w / 20)) + Math.floor(y / (h / 20)) * 20) % 400]; const n = (R() - 0.5) * 20; return [b[0] + n, b[1] + n, b[2] + n];
  });
  const truth = new Uint8Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) truth[y * w + x] = inside(x, y) ? 1 : 0;
  return { buf, truth };
}

test('sky: blue gradient sky over textured ground → IoU ≥ 0.85', () => {
  const w = 300, h = 200, b = skyScene(w, h), a = detectSky(b);
  const truth = new Uint8Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) truth[y * w + x] = y < horizon(x, w, h) ? 1 : 0;
  const s = iou(a, truth); assert.ok(s >= 0.85, 'sky IoU ' + s.toFixed(3));
  assert.ok(a[5 * w + 150] > 0.9 && a[190 * w + 150] < 0.1, 'top is sky, bottom is not');
});

test('subject: centred object on clutter → IoU ≥ 0.75; background = 1 − subject', () => {
  const { buf, truth } = subjectScene(300, 200), a = detectSubject(buf);
  const s = iou(a, truth); assert.ok(s >= 0.75, 'subject IoU ' + s.toFixed(3));
  const bg = evaluateMask(mask([comp('background')]), buf);
  let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(bg[i] - (1 - a[i]))); assert.ok(m < 1e-6, 'background is the inverse');
  // cached: the second call returns the same array instantly
  const t0 = performance.now(), a2 = detectSubject(buf); assert.equal(a2, a); assert.ok(performance.now() - t0 < 20);
});

test('subject: dark object on a bright, contrasting background', () => {
  const w = 240, h = 160, inside = (x, y) => Math.hypot(x - 120, y - 85) < 40;
  const buf = mk(w, h, (x, y) => inside(x, y) ? [30, 35, 50] : [230 - y * 0.2, 225, 210]);
  const truth = new Uint8Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) truth[y * w + x] = inside(x, y) ? 1 : 0;
  assert.ok(iou(detectSubject(buf), truth) >= 0.85);
});

test('brush: add stroke covers its path with the given size; erase removes; flow/density limit', () => {
  const b = mk(200, 100, () => [128, 128, 128]);
  const stroke = { mode: 'add', size: 0.1, feather: 0, flow: 100, density: 100, points: [0.2, 0.5, 0.8, 0.5] }; // diameter 20 px
  const a = evaluateMask(mask([comp('brush', { strokes: [stroke] })]), b);
  assert.equal(a[50 * 200 + 100], 1); assert.equal(a[50 * 200 + 40], 1); assert.equal(a[50 * 200 + 160], 1);
  assert.equal(a[59 * 200 + 100], 1); assert.equal(a[62 * 200 + 100], 0, 'outside the radius');
  assert.equal(a[50 * 200 + 15], 0, 'beyond the stroke end + radius');
  const er = evaluateMask(mask([comp('brush', { strokes: [stroke, { ...stroke, mode: 'erase', points: [0.5, 0.5] }] })]), b);
  assert.equal(er[50 * 200 + 100], 0, 'erased'); assert.equal(er[50 * 200 + 40], 1, 'rest kept');
  const half = evaluateMask(mask([comp('brush', { strokes: [{ ...stroke, density: 50 }] })]), b); assert.ok(Math.abs(half[50 * 200 + 100] - 0.5) < 1e-6, 'density caps');
  const fl = evaluateMask(mask([comp('brush', { strokes: [{ ...stroke, flow: 50 }, { ...stroke, flow: 50 }] })]), b); assert.ok(Math.abs(fl[50 * 200 + 100] - 0.75) < 1e-6, 'flow builds up');
  const soft = evaluateMask(mask([comp('brush', { strokes: [{ ...stroke, feather: 100 }] })]), b); assert.ok(soft[55 * 200 + 100] > 0.2 && soft[55 * 200 + 100] < 0.8, 'feathered edge');
});

test('linear and radial gradients: geometry', () => {
  const b = mk(200, 100, () => [128, 128, 128]);
  const lin = evaluateMask(mask([comp('linear', { x0: 0.5, y0: 0.2, x1: 0.5, y1: 0.8 })]), b);
  assert.equal(lin[5 * 200 + 50], 1); assert.equal(lin[95 * 200 + 50], 0); assert.ok(Math.abs(lin[50 * 200 + 10] - 0.5) < 0.04);
  const rad = evaluateMask(mask([comp('radial', { cx: 0.5, cy: 0.5, rx: 0.2, ry: 0.4, angle: 0, feather: 0, inside: true })]), b); // 40 × 40 px semi-axes
  assert.equal(rad[50 * 200 + 100], 1); assert.equal(rad[50 * 200 + 138], 1); assert.equal(rad[50 * 200 + 142], 0); assert.equal(rad[50 * 200 + 20], 0);
  const out = evaluateMask(mask([comp('radial', { cx: 0.5, cy: 0.5, rx: 0.2, ry: 0.4, angle: 0, feather: 0, inside: false })]), b);
  assert.equal(out[50 * 200 + 100], 0); assert.equal(out[50 * 200 + 20], 1);
  // rotation by 90° swaps the axes (rx·w = 60 px, ry·h = 20 px)
  const rot = evaluateMask(mask([comp('radial', { cx: 0.5, cy: 0.5, rx: 0.3, ry: 0.2, angle: 90, feather: 0 })]), b);
  assert.equal(rot[50 * 200 + 125], 0, 'horizontal reach is now 20 px'); assert.equal(rot[(50 + 40) * 200 + 100], 1, 'vertical reach is now 60 px');
  assert.equal(rot[50 * 200 + 118], 1);
});

test('colour range and luminance range', () => {
  const b = mk(90, 10, x => x < 30 ? [200, 30, 30] : x < 60 ? [30, 160, 40] : [210, 40, 60]);
  const c = evaluateMask(mask([comp('color', { samples: [[200, 30, 30]], refine: 40 })]), b);
  assert.equal(c[5 * 90 + 10], 1); assert.equal(c[5 * 90 + 40], 0); assert.ok(c[5 * 90 + 75] > 0.3, 'similar red partly in');
  const c2 = evaluateMask(mask([comp('color', { samples: [[200, 30, 30], [30, 160, 40]], refine: 20 })]), b); assert.equal(c2[5 * 90 + 40], 1, 'second sample');
  const g = mk(101, 1, x => { const v = Math.round(x * 2.55); return [v, v, v]; });
  const l = evaluateMask(mask([comp('luminance', { lo: 40, hi: 70, loFeather: 0, hiFeather: 0 })]), g);
  const Ls = x => rgbToLab(Math.round(x * 2.55), Math.round(x * 2.55), Math.round(x * 2.55))[0];
  for (let x = 0; x <= 100; x++) assert.equal(l[x], Ls(x) >= 40 && Ls(x) <= 70 ? 1 : 0, 'L* at ' + x);
  const lf = evaluateMask(mask([comp('luminance', { lo: 40, hi: 70, loFeather: 20, hiFeather: 0 })]), g);
  const mid = [...lf].findIndex(v => v > 0.4 && v < 0.6); assert.ok(mid > 0 && Ls(mid) > 20 && Ls(mid) < 40, 'feathered low end');
});

test('component combination: add, subtract, intersect, component and mask invert, amount', () => {
  const b = mk(100, 100, () => [128, 128, 128]);
  const left = comp('linear', { x0: 0.4, y0: 0.5, x1: 0.41, y1: 0.5 }), top = comp('linear', { x0: 0.5, y0: 0.4, x1: 0.5, y1: 0.41 });
  const px = (a, x, y) => Math.round(a[y * 100 + x] * 1000) / 1000;
  const add = evaluateMask(mask([left, { ...top, id: 't' }]), b); assert.deepEqual([px(add, 10, 10), px(add, 90, 10), px(add, 10, 90), px(add, 90, 90)], [1, 1, 1, 0]);
  const sub = evaluateMask(mask([left, { ...top, op: 'subtract' }]), b); assert.deepEqual([px(sub, 10, 10), px(sub, 10, 90), px(sub, 90, 10)], [0, 1, 0]);
  const int = evaluateMask(mask([left, { ...top, op: 'intersect' }]), b); assert.deepEqual([px(int, 10, 10), px(int, 10, 90), px(int, 90, 10)], [1, 0, 0]);
  const ci = evaluateMask(mask([{ ...left, invert: true }]), b); assert.deepEqual([px(ci, 10, 10), px(ci, 90, 10)], [0, 1]);
  const mi = evaluateMask(mask([left], {}, { invert: true, amount: 50 }), b); assert.deepEqual([px(mi, 10, 10), px(mi, 90, 10)], [0, 0.5]);
  const everythingBut = evaluateMask(mask([comp('all'), { ...left, op: 'subtract' }]), b); assert.deepEqual([px(everythingBut, 10, 10), px(everythingBut, 90, 10)], [0, 1]);
});

test('applyLocal: exposure only inside the mask; identity adjust changes nothing', () => {
  const w = 40, h = 20, N = w * h, R = new Float32Array(N).fill(0.2), G = Float32Array.from(R), B = Float32Array.from(R);
  const alpha = new Float32Array(N); for (let y = 0; y < h; y++) for (let x = 0; x < 20; x++) alpha[y * w + x] = 1;
  assert.equal(applyLocal(R, G, B, w, h, alpha, LOCAL_DEFAULTS), false);
  applyLocal(R, G, B, w, h, alpha, { ...LOCAL_DEFAULTS, exposure: 1 });
  assert.ok(Math.abs(R[5 * w + 5] - 0.4) < 1e-6 && Math.abs(B[5 * w + 5] - 0.4) < 1e-6, 'doubled inside');
  assert.equal(R[5 * w + 30], Math.fround(0.2), 'outside untouched');
  // every slider does something inside and nothing outside
  for (const [k, v] of [['contrast', 50], ['highlights', -60], ['shadows', 60], ['whites', 40], ['blacks', -40], ['temp', 50], ['tint', -40], ['hue', 60], ['saturation', 60], ['texture', 80], ['clarity', 80], ['dehaze', 60], ['sharpness', 80], ['noise', 60]]) {
    const img = mk(w, h, (x, y) => [120 + ((x * 7 + y * 13) % 5) * 12, 90 + ((x + y) % 3) * 20, 60 + x]);
    const r = new Float32Array(N), g = new Float32Array(N), b = new Float32Array(N);
    const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    for (let i = 0; i < N; i++) { r[i] = lin(img.data[i * 4]); g[i] = lin(img.data[i * 4 + 1]); b[i] = lin(img.data[i * 4 + 2]); }
    const r0 = Float32Array.from(r), g0 = Float32Array.from(g), b0 = Float32Array.from(b);
    applyLocal(r, g, b, w, h, alpha, { ...LOCAL_DEFAULTS, [k]: v });
    let inside = 0, outside = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x, d = Math.abs(r[i] - r0[i]) + Math.abs(g[i] - g0[i]) + Math.abs(b[i] - b0[i]); if (x < 20) inside = Math.max(inside, d); else outside = Math.max(outside, d); }
    assert.ok(inside > 0.003, k + ' changes pixels inside (' + inside + ')'); assert.equal(outside, 0, k + ' leaves the outside alone');
  }
  // colour overlay tints
  // defringe: a purple fringe along a hard edge loses saturation inside the mask only
  { const r = new Float32Array(N), g = new Float32Array(N), b = new Float32Array(N);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x, f = y === 9 || y === 10; r[i] = f ? 0.35 : y < 9 ? 0.02 : 0.9; g[i] = f ? 0.05 : y < 9 ? 0.02 : 0.9; b[i] = f ? 0.6 : y < 9 ? 0.02 : 0.9; }
    applyLocal(r, g, b, w, h, alpha, { ...LOCAL_DEFAULTS, defringe: 100 });
    assert.ok(b[9 * w + 5] - g[9 * w + 5] < 0.3, 'fringe desaturated inside'); assert.equal(b[9 * w + 30], Math.fround(0.6), 'outside untouched'); }
  const r = new Float32Array(N).fill(0.3), g = new Float32Array(N).fill(0.3), b = new Float32Array(N).fill(0.3);
  applyLocal(r, g, b, w, h, alpha, { ...LOCAL_DEFAULTS, color: { hue: 0, saturation: 80 } }); assert.ok(r[0] > g[0] + 0.05, 'red overlay');
});

test('develop(): unchanged without masks; disabled masks skipped; Subject mask + exposure brightens only the subject', () => {
  const { buf, truth } = subjectScene(240, 160);
  const plain = develop(copy(buf), { exposure: 0 });
  assert.deepEqual(plain.data, buf.data);
  const m = { ...createMask('subject'), adjust: { ...LOCAL_DEFAULTS, exposure: 1 } };
  assert.deepEqual(develop(copy(buf), { masks: [{ ...m, enabled: false }] }).data, buf.data, 'disabled mask');
  assert.deepEqual(develop(copy(buf), { masks: [{ ...m, adjust: LOCAL_DEFAULTS }] }).data, buf.data, 'identity adjust');
  assert.deepEqual(develop(copy(buf), { masks: [] }).data, buf.data, 'empty list');
  const out = develop(copy(buf), { masks: [m] });
  const objIn = at(buf, 120, 83), objOut = at(out, 120, 83), bgIn = at(buf, 10, 10), bgOut = at(out, 10, 10);
  assert.ok(objOut[1] > objIn[1] + 25, 'subject brightened ' + objIn + ' → ' + objOut);
  assert.deepEqual(bgOut.map(v => Math.abs(v - bgIn[bgOut.indexOf(v)]) <= 1), [true, true, true], 'background unchanged ' + bgIn + ' → ' + bgOut);
  assert.equal(activeMasks([m]).length, 1);
  assert.ok(truth[83 * 240 + 120]);
});

test('resolution independence: masks at 1100 px and 480 px agree after resampling', () => {
  const big = skyScene(1100, 733), small = resample(big, 480, 320, 'bilinear');
  const { buf: sb } = subjectScene(1100, 733), ss = resample(sb, 480, 320, 'bilinear');
  // pixel-level range masks are compared on a smooth scene (on per-pixel noise, down-sampling itself changes the colours)
  const smoothBig = mk(1100, 733, (x, y) => [255 * x / 1100, 80 + 120 * y / 733, 230 - 200 * x / 1100]), smoothSmall = resample(smoothBig, 480, 320, 'bilinear');
  const cases = [
    [big, small, mask([comp('sky')])],
    [sb, ss, mask([comp('subject')])],
    [big, small, mask([comp('brush', { strokes: [{ mode: 'add', size: 0.05, feather: 60, flow: 100, density: 100, points: [0.1, 0.2, 0.5, 0.7, 0.9, 0.3] }] })])],
    [big, small, mask([comp('radial', { cx: 0.4, cy: 0.6, rx: 0.2, ry: 0.15, angle: 30, feather: 40 }), comp('linear', { x0: 0.1, y0: 0, x1: 0.6, y1: 1 }, 'subtract')])],
    [smoothBig, smoothSmall, mask([comp('color', { samples: [[120, 160, 230]], refine: 40 })])],
    [smoothBig, smoothSmall, mask([comp('luminance', { lo: 50, hi: 100, loFeather: 20, hiFeather: 0 })])],
  ];
  for (const [B, S, m] of cases) {
    const a = evaluateMask(m, B), b = evaluateMask(m, S);
    const aB = { w: B.w, h: B.h, data: new Uint8ClampedArray(B.w * B.h * 4) }; for (let i = 0; i < a.length; i++) { aB.data[i * 4] = Math.round(a[i] * 255); aB.data[i * 4 + 3] = 255; }
    const down = resample(aB, S.w, S.h, 'bilinear');
    let sum = 0, bad = 0; for (let i = 0; i < b.length; i++) { const d = Math.abs(down.data[i * 4] / 255 - b[i]); sum += d; if (d > 0.25) bad++; }
    const mean = sum / b.length; assert.ok(mean < 0.03 && bad / b.length < 0.02, m.components[0].type + ': mean diff ' + mean.toFixed(4) + ', >0.25 on ' + (bad / b.length * 100).toFixed(2) + ' %');
  }
});

test('performance: 1100 × 733 detection ≤ 400 ms, 3 masks evaluate + apply ≤ 120 ms (cached detection)', () => {
  clearMaskCache();
  const b = skyScene(1100, 733), { buf: sb } = subjectScene(1100, 733);
  let t = performance.now(); detectSky(b); const tSky = performance.now() - t;
  t = performance.now(); detectSubject(sb); const tSub = performance.now() - t;
  const masks = [
    { ...createMask('subject'), adjust: { ...LOCAL_DEFAULTS, exposure: 0.7, contrast: 20 } },
    { ...createMask('linear'), adjust: { ...LOCAL_DEFAULTS, exposure: -0.5, saturation: 20 } },
    { ...createMask('radial'), adjust: { ...LOCAL_DEFAULTS, shadows: 30, temp: 20 } },
  ];
  develop(copy(sb), { masks }); // warm-up (JIT)
  const base = (() => { const t0 = performance.now(); develop(copy(sb), {}); return performance.now() - t0; })();
  t = performance.now(); develop(copy(sb), { masks }); const tMasks = performance.now() - t - base;
  console.log(`sky ${tSky.toFixed(0)} ms, subject ${tSub.toFixed(0)} ms, 3 masks ${tMasks.toFixed(0)} ms`);
  assert.ok(tSky <= 400 && tSub <= 400, 'detection'); assert.ok(tMasks <= 120, '3 masks ' + tMasks.toFixed(0) + ' ms');
});

test('createMask / createComponent defaults', () => {
  const a = createMask('radial'), b = createMask('brush', null, [a]);
  assert.equal(a.name, 'Mask 1'); assert.equal(b.name, 'Mask 2'); assert.equal(a.components[0].params.feather, 50);
  assert.deepEqual(createComponent('sky', 'subtract').params, { sensitivity: 50 });
  assert.equal(componentAlpha(createComponent('all'), mk(3, 3, () => [0, 0, 0]))[4], 1);
});
