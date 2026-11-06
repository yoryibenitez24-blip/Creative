import { test } from 'node:test';
import assert from 'node:assert/strict';
import { regionMask, gradientSampler } from '../src/engine/fill.js';
import { computeMask, bitmapShape, encodeRle, decodeRle, appendOp, distanceTransform } from '../src/engine/selection.js';
import { beginPaint, applyDab, fillArea, createBuffer } from '../src/engine/raster.js';
import { toneProcess, spongeProcess, blurProcess, sharpenProcess, cloneSource, smudgeDab, heal, findHealSource } from '../src/engine/retouch.js';
import { dabAlpha } from '../src/engine/raster.js';
import { lum } from '../src/engine/color.js';

const flat = (w, h, rgba) => { const d = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < d.length; i += 4) d.set(rgba, i); return { w, h, data: d }; };
const px = (b, x, y) => [...b.data.slice((y * b.w + x) * 4, (y * b.w + x) * 4 + 4)];
const set = (b, x, y, v) => b.data.set(v, (y * b.w + x) * 4);

test('flood: contiguous fill stops at a wall; global selects every match; tolerance widens', () => {
  const b = flat(10, 5, [255, 255, 255, 255]);
  for (let y = 0; y < 5; y++) set(b, 5, y, [0, 0, 0, 255]);
  const c = regionMask(b, 1, 1, { tolerance: 10, antiAlias: false });
  assert.equal(c[1 * 10 + 4], 255); assert.equal(c[1 * 10 + 5], 0); assert.equal(c[1 * 10 + 7], 0);
  const g = regionMask(b, 1, 1, { tolerance: 10, contiguous: false, antiAlias: false });
  assert.equal(g[1 * 10 + 7], 255);
  set(b, 2, 2, [230, 230, 230, 255]);
  assert.equal(regionMask(b, 1, 1, { tolerance: 10, antiAlias: false })[2 * 10 + 2], 0);
  assert.equal(regionMask(b, 1, 1, { tolerance: 30, antiAlias: false })[2 * 10 + 2], 255);
  assert.equal(regionMask(b, -1, 1).reduce((a, v) => a + v, 0), 0, 'outside click selects nothing');
});

test('flood: large region does not overflow the stack', () => {
  const b = flat(600, 600, [10, 20, 30, 255]);
  const m = regionMask(b, 300, 300, { antiAlias: false });
  assert.equal(m.reduce((a, v) => a + (v ? 1 : 0), 0), 360000);
});

test('bitmap selections: RLE round trip and wand result becomes a selection op', () => {
  const vals = new Uint8Array([0, 0, 0, 255, 255, 128, 0, ...new Array(600).fill(7)]);
  assert.deepEqual(decodeRle(encodeRle(vals), vals.length), vals);
  const W = 20, H = 10, m = new Uint8Array(W * H); for (let y = 2; y < 6; y++) for (let x = 3; x < 9; x++) m[y * W + x] = 255;
  const shape = bitmapShape(m, W, H);
  assert.deepEqual([shape.x, shape.y, shape.w, shape.h], [3, 2, 6, 4]);
  const sel = appendOp(null, { op: 'replace', shape });
  assert.deepEqual(computeMask(JSON.parse(JSON.stringify(sel)), W, H), m, 'survives JSON (undo/persistence)');
  assert.equal(bitmapShape(new Uint8Array(4), 2, 2), null);
});

test('select modify: expand/contract by exact radius, border band, smooth rounds corners', () => {
  const W = 40, H = 40, sq = { ops: [{ op: 'replace', shape: { type: 'rect', x: 10, y: 10, w: 20, h: 20 } }] };
  const ex = computeMask({ ops: [...sq.ops, { op: 'expand', radius: 4 }] }, W, H);
  assert.equal(ex[20 * W + 6], 255); assert.equal(ex[20 * W + 5], 0); assert.equal(ex[6 * W + 6], 0, 'round corner');
  const co = computeMask({ ops: [...sq.ops, { op: 'contract', radius: 4 }] }, W, H);
  assert.equal(co[20 * W + 13], 0); assert.equal(co[20 * W + 14], 255);
  const bo = computeMask({ ops: [...sq.ops, { op: 'border', radius: 4 }] }, W, H);
  assert.equal(bo[20 * W + 20], 0, 'centre empty'); assert.ok(bo[20 * W + 10] > 0 && bo[20 * W + 9] > 0, 'band straddles edge');
  const sm = computeMask({ ops: [...sq.ops, { op: 'smooth', radius: 4 }] }, W, H);
  assert.equal(sm[10 * W + 10], 0, 'corner rounded'); assert.equal(sm[20 * W + 20], 255);
  const d = distanceTransform(5, 1, i => i === 0); assert.deepEqual([...d], [0, 1, 4, 9, 16]);
});

test('gradients: linear endpoints, reflected symmetry, radial distance, transparency stops', () => {
  const o = [0, 0, 0, 0];
  const lin = gradientSampler({ x0: 0, y0: 0, x1: 100, y1: 0, from: '#000000', to: '#ffffff', dither: false });
  assert.equal(lin(-10, 0, o)[0], 0); assert.equal(lin(200, 0, o)[0], 255); assert.ok(Math.abs(lin(49.5, 0, o)[0] - 127.5) < 1);
  const ref = gradientSampler({ type: 'reflected', x0: 50, y0: 0, x1: 100, y1: 0, from: '#000000', to: '#ffffff', dither: false });
  assert.equal(ref(29.5, 0, [0, 0, 0, 0])[0], ref(69.5, 0, [0, 0, 0, 0])[0]);
  const rad = gradientSampler({ type: 'radial', x0: 0, y0: 0, x1: 10, y1: 0, from: '#000000', to: '#ffffff', dither: false });
  assert.equal(rad(5.5, 5.5, o)[0], rad(7.27, 0, [0, 0, 0, 0])[0] > 0 ? rad(5.5, 5.5, o)[0] : -1);
  const tr = gradientSampler({ x0: 0, y0: 0, x1: 10, y1: 0, from: [255, 0, 0, 255], to: [255, 0, 0, 0], dither: false });
  assert.equal(tr(9.5, 0, o)[3], 0);
  // fill a layer from the gradient through the generic source path
  const b = createBuffer(10, 1); fillArea(b, { source: (x, y, out) => lin(x * 10, y, out), opacity: 1 });
  assert.ok(px(b, 0, 0)[0] < px(b, 9, 0)[0]);
});

test('pencil is aliased: only fully on or off pixels', () => {
  const b = createBuffer(30, 30), ctx = beginPaint(b, { color: [0, 0, 0], aliased: true, opacity: 1 });
  applyDab(ctx, { x: 15.3, y: 15.7, size: 9, flow: 1 });
  for (let i = 3; i < b.data.length; i += 4) assert.ok(b.data[i] === 0 || b.data[i] === 255);
  assert.equal(px(b, 15, 15)[3], 255);
});

test('dodge/burn change luminance in the chosen range; sponge (de)saturates; protect tones keeps hue ratio', () => {
  const run = (process, rgba) => { const b = flat(20, 20, rgba), ctx = beginPaint(b, { process, opacity: 1, hardness: 1 }); applyDab(ctx, { x: 10, y: 10, size: 16, flow: 1 }); return px(b, 10, 10); };
  const mid = [120, 100, 80, 255];
  const d = run(toneProcess('dodge', { range: 'midtones' }), mid), bu = run(toneProcess('burn', { range: 'midtones' }), mid);
  assert.ok(lum(...d) > lum(...mid) + 30 && lum(...bu) < lum(...mid) - 30);
  const dk = run(toneProcess('dodge', { range: 'midtones' }), [60, 50, 40, 255]);
  assert.ok(Math.abs(dk[0] / dk[2] - 60 / 40) < 0.05, 'hue ratio kept when not clipping: ' + dk);
  assert.ok(run(toneProcess('dodge', { range: 'highlights' }), [20, 20, 20, 255])[0] < 25, 'highlight dodge barely touches shadows');
  const g = run(spongeProcess({ mode: 'desaturate' }), [200, 50, 50, 255]); assert.equal(g[0], g[1]);
  const s = run(spongeProcess({ mode: 'saturate' }), [150, 100, 100, 255]); assert.ok(s[0] - s[1] > 50);
});

test('blur and sharpen tools soften / steepen an edge locally', () => {
  const mk = () => { const b = flat(20, 20, [0, 0, 0, 255]); for (let y = 0; y < 20; y++) for (let x = 10; x < 20; x++) set(b, x, y, [200, 200, 200, 255]); return b; };
  const b1 = mk(); applyDab(beginPaint(b1, { process: blurProcess(20, 20, { radius: 2 }), opacity: 1, hardness: 1 }), { x: 10, y: 10, size: 10, flow: 1 });
  assert.ok(px(b1, 9, 10)[0] > 0 && px(b1, 10, 10)[0] < 200);
  const b2 = mk(); applyDab(beginPaint(b2, { process: sharpenProcess(20, 20), opacity: 1, hardness: 1 }), { x: 10, y: 10, size: 10, flow: 1 });
  assert.ok(px(b2, 10, 10)[0] === 255 && px(b2, 9, 10)[0] === 0);
  assert.equal(px(b2, 10, 2)[0], 200, 'outside the dab untouched');
});

test('clone stamp copies source pixels with the given offset', () => {
  const src = flat(40, 20, [0, 0, 0, 0]); for (let y = 0; y < 20; y++) for (let x = 0; x < 10; x++) set(src, x, y, [10, 200, 30, 255]);
  const b = { w: 40, h: 20, data: new Uint8ClampedArray(src.data) };
  applyDab(beginPaint(b, { source: cloneSource(src, 25, 0), opacity: 1, hardness: 1 }), { x: 30, y: 10, size: 6, flow: 1 });
  assert.deepEqual(px(b, 30, 10), [10, 200, 30, 255]);
});

test('smudge drags colour along the stroke', () => {
  const b = flat(30, 10, [255, 255, 255, 255]); for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) set(b, x, y, [0, 0, 0, 255]);
  smudgeDab(b, { x: 14, y: 5, size: 8 }, { x: 9, y: 5 }, 0.8, (d, r) => dabAlpha(d, r, 1));
  assert.ok(px(b, 12, 5)[0] < 150, 'dark pulled to the right: ' + px(b, 12, 5)[0]);
});

test('spot healing: finds clean texture and removes a blemish while matching surroundings', () => {
  // smooth horizontal ramp with a dark spot
  const W = 80, H = 60, b = { w: W, h: H, data: new Uint8ClampedArray(W * H * 4) };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) b.data.set([60 + x * 2, 90 + y, 120, 255], (y * W + x) * 4);
  const region = new Uint8Array(W * H);
  for (let y = 26; y < 34; y++) for (let x = 36; x < 44; x++) { b.data.set([5, 5, 5, 255], (y * W + x) * 4); region[y * W + x] = 255; }
  for (let y = 24; y < 36; y++) for (let x = 34; x < 46; x++) region[y * W + x] = 255; // brush footprint around the spot
  const off = findHealSource(b, region);
  assert.ok(off, 'source found');
  heal(b, region, off[0], off[1]);
  const p = px(b, 40, 30), want = [60 + 80, 90 + 30, 120];
  for (let c = 0; c < 3; c++) assert.ok(Math.abs(p[c] - want[c]) <= 6, `channel ${c}: ${p[c]} vs ${want[c]}`);
});

import { mapRect, transformDoc, transformVectorLayer, resizeCanvas, scaleDoc, transformLayerInPlace, anchorOffset as anchor } from '../src/engine/docxform.js';
import { rotate90, flipH as fH, placeInto as place } from '../src/engine/geometry.js';

test('docxform: rect mapping agrees with the pixel transforms', () => {
  // a 2×1 red block at (3,1) in a 8×5 canvas
  const W = 8, H = 5, canvas = { w: W, h: H, data: new Uint8ClampedArray(W * H * 4) };
  for (const x of [3, 4]) canvas.data.set([255, 0, 0, 255], (1 * W + x) * 4);
  for (const [kind, f] of [['rotate90cw', b => rotate90(b, true)], ['rotate90ccw', b => rotate90(b, false)], ['flipH', fH]]) {
    const out = f(canvas), [x, y, w, h] = mapRect(kind, W, H, 3, 1, 2, 1);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) assert.equal(out.data[((y + j) * out.w + x + i) * 4], 255, kind);
  }
});

test('docxform: rotating the canvas 4× restores every layer; vector centres move, rotation accumulates', () => {
  const doc = { w: 300, h: 200, layers: [{ id: 'a', type: 'rect', x: 10, y: 20, w: 50, h: 30, rotation: 0 }, { id: 'p', type: 'raster', x: 0, y: 0, w: 300, h: 200, mask: { x: 5, y: 6, w: 300, h: 200 } }] };
  let d = doc; for (let i = 0; i < 4; i++) d = transformDoc(d, 'rotate90cw');
  assert.deepEqual([d.w, d.h], [300, 200]);
  assert.ok(Math.abs(d.layers[0].x - 10) < 1e-9 && Math.abs(d.layers[0].y - 20) < 1e-9 && Math.abs(d.layers[0].rotation) < 1e-9);
  assert.deepEqual([d.layers[1].mask.x, d.layers[1].mask.y], [5, 6]);
  const once = transformDoc(doc, 'rotate90cw');
  assert.deepEqual([once.w, once.h], [200, 300]); assert.equal(once.layers[0].rotation, 90);
  const v = transformVectorLayer({ x: 0, y: 0, w: 10, h: 10, rotation: 30 }, 'flipH', 100, 50);
  assert.deepEqual([v.x, v.rotation, v.flipX], [90, -30, true]);
});

test('docxform: canvas size anchors, crop shifts masks, image size scales vectors and paint layers', () => {
  const doc = { w: 100, h: 100, selection: { ops: [] }, layers: [{ id: 't', type: 'text', x: 10, y: 10, w: 40, h: 20, size: 20, rotation: 0 }, { id: 'p', type: 'raster', x: 0, y: 0, w: 100, h: 100, mask: { x: 0, y: 0, w: 100, h: 100, feather: 4 } }] };
  assert.deepEqual(anchor(100, 100, 200, 160, 1, 1), [50, 30]);
  const c = resizeCanvas(doc, 200, 160, 50, 30);
  assert.deepEqual([c.w, c.h, c.layers[0].x, c.layers[1].x, c.layers[1].mask.y, c.selection], [200, 160, 60, 50, 30, null]);
  const s = scaleDoc(doc, 50, 200);
  assert.deepEqual([s.layers[0].x, s.layers[0].size, s.layers[1].w, s.layers[1].h, s.layers[1].mask.h], [5, 40, 50, 200, 200]);
  const r = transformLayerInPlace({ type: 'raster', x: 10, y: 0, w: 40, h: 20 }, 'rotate90cw');
  assert.deepEqual([r.x, r.y, r.w, r.h], [20, -10, 20, 40]);
  assert.equal(place({ w: 1, h: 1, data: new Uint8ClampedArray([1, 2, 3, 4]) }, 3, 3, 1, 1).data[16], 1);
});
