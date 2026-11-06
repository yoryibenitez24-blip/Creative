import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createField, applyField, applyStroke, applyDabInPlace, reconstructAll, restoreAll, serializeField, deserializeField, liquifyOp, resampleField, brushWeight, isIdentity, forwardPoint } from '../src/engine/liquify.js';

const img = (w, h, f) => { const d = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set(f(x, y), (y * w + x) * 4); return { w, h, data: d }; };
const at = (b, x, y) => [...b.data.slice((y * b.w + x) * 4, (y * b.w + x) * 4 + 4)];
const maxAbs = f => { let m = 0; for (let i = 0; i < f.dx.length; i++) m = Math.max(m, Math.abs(f.dx[i]), Math.abs(f.dy[i])); return m; };
// centroid of red pixels
const centroid = b => { let sx = 0, sy = 0, n = 0; for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) { const v = b.data[(y * b.w + x) * 4] / 255; sx += x * v; sy += y * v; n += v; } return [sx / n, sy / n, n]; };
const dotImg = (w, h, cx, cy, r) => img(w, h, (x, y) => Math.hypot(x - cx, y - cy) <= r ? [255, 0, 0, 255] : [0, 0, 0, 255]);

test('identity field reproduces the image exactly (bilinear and nearest, transparent pixels kept)', () => {
  const b = img(17, 11, (x, y) => [x * 13, y * 20, (x * y) % 256, (x + y) % 3 ? 255 : 0]);
  const f = createField(17, 11);
  for (const m of ['bilinear', 'nearest']) {
    const o = applyField(b, f, m);
    for (let y = 0; y < 11; y++) for (let x = 0; x < 17; x++) {
      const a = at(b, x, y), r = at(o, x, y);
      if (a[3] === 0) assert.equal(r[3], 0); else assert.deepEqual(r, a);
    }
  }
  assert.ok(isIdentity(f));
});

test('a constant field shifts the image and clamps at the edges', () => {
  const b = img(10, 4, x => [x * 20, 0, 0, 255]), f = createField(10, 4); f.dx.fill(2);
  const o = applyField(b, f);
  assert.deepEqual(at(o, 3, 1), at(b, 5, 1));
  assert.deepEqual(at(o, 9, 1), at(b, 9, 1), 'edge clamp');
});

test('forward warp moves a marked dot in the drag direction, and repeated pushes keep moving it', () => {
  const b = dotImg(80, 60, 30, 30, 3), f = createField(80, 60), brush = { size: 30, density: 30, pressure: 100, rate: 80 };
  const { field } = applyStroke(f, 'forwardWarp', [{ x: 30, y: 30 }, { x: 36, y: 30 }], brush);
  const [cx, cy] = centroid(applyField(b, field));
  assert.ok(cx > 34 && cx < 38, 'moved right by about 6 px, got ' + cx);
  assert.ok(Math.abs(cy - 30) < 0.5);
  // a second push starting where the content now is continues to move it (composition, not addition)
  const { field: f2 } = applyStroke(field, 'forwardWarp', [{ x: 36, y: 30 }, { x: 36, y: 38 }], brush);
  const [cx2, cy2] = centroid(applyField(b, f2));
  assert.ok(Math.abs(cx2 - 36) < 1.5 && cy2 > 36 && cy2 < 40, `expected near (36,38), got (${cx2},${cy2})`);
});

test('reconstruct (brush and reconstructAll) reduces displacement; restoreAll zeroes it', () => {
  const brush = { size: 40, density: 0, pressure: 100, rate: 100 };
  const { field } = applyStroke(createField(60, 60), 'forwardWarp', [{ x: 30, y: 30 }, { x: 40, y: 30 }], brush);
  const before = maxAbs(field);
  assert.ok(before > 5);
  const { field: r } = applyStroke(field, 'reconstruct', [{ x: 30, y: 30 }, { x: 35, y: 30 }, { x: 40, y: 30 }], brush);
  assert.ok(maxAbs(r) < before * 0.9, `${maxAbs(r)} < ${before}`);
  const half = reconstructAll(field, 0.5);
  assert.ok(Math.abs(maxAbs(half) - before / 2) < 1e-4);
  assert.equal(maxAbs(reconstructAll(field, 1)), 0);
  assert.equal(maxAbs(restoreAll(field)), 0);
  assert.ok(maxAbs(field) === before, 'pure: input untouched');
});

test('frozen pixels are not distorted by any tool', () => {
  const w = 60, h = 40, freeze = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < 30; x++) freeze[y * w + x] = 255; // freeze left half
  const brush = { size: 40, density: 50, pressure: 100, rate: 100 };
  let f = createField(w, h);
  for (const tool of ['forwardWarp', 'pushLeft', 'twirlClockwise', 'pucker', 'bloat', 'smooth']) {
    f = applyStroke(f, tool, [{ x: 30, y: 20 }, { x: 34, y: 24 }, { x: 30, y: 28 }], brush, freeze).field;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < 30; x++) { assert.equal(f.dx[y * w + x], 0); assert.equal(f.dy[y * w + x], 0); }
  assert.ok(maxAbs(f) > 1, 'thawed half was distorted');
  const b = img(w, h, (x, y) => [x * 4, y * 6, 128, 255]), o = applyField(b, f);
  for (let y = 0; y < h; y++) for (let x = 0; x < 30; x++) assert.deepEqual(at(o, x, y), at(b, x, y));
  // reconstructAll spares frozen pixels too, freeze/thaw mask tools paint the mask
  const m = applyStroke(createField(w, h), 'freezeMask', [{ x: 10, y: 10 }], { size: 6, density: 0, pressure: 100 }, new Uint8Array(w * h)).freeze;
  assert.equal(m[10 * w + 10], 255); assert.equal(m[30 * w + 50], 0);
  const t = applyStroke(createField(w, h), 'thawMask', [{ x: 10, y: 10 }], { size: 6, density: 0, pressure: 100 }, m).freeze;
  assert.equal(t[10 * w + 10], 0);
});

test('bloat enlarges a centred dot, pucker shrinks it', () => {
  const b = dotImg(61, 61, 30, 30, 6), f = createField(61, 61), brush = { size: 40, density: 50, pressure: 100, rate: 100 };
  const dabs = Array.from({ length: 6 }, () => ({ x: 30, y: 30 }));
  const area0 = centroid(b)[2];
  const big = centroid(applyField(b, applyStroke(f, 'bloat', dabs, brush).field));
  const small = centroid(applyField(b, applyStroke(f, 'pucker', dabs, brush).field));
  assert.ok(big[2] > area0 * 1.3, `bloat area ${big[2]} vs ${area0}`);
  assert.ok(small[2] < area0 * 0.8, `pucker area ${small[2]} vs ${area0}`);
  assert.ok(Math.abs(big[0] - 30) < 0.5 && Math.abs(big[1] - 30) < 0.5, 'stays centred');
});

test('twirl clockwise rotates an off-centre dot clockwise (screen y-down); counter-clockwise the other way', () => {
  const b = dotImg(61, 61, 40, 30, 2), brush = { size: 50, density: 20, pressure: 100, rate: 100 };
  const dabs = Array.from({ length: 4 }, () => ({ x: 30, y: 30 }));
  const [, cyCW] = centroid(applyField(b, applyStroke(createField(61, 61), 'twirlClockwise', dabs, brush).field));
  const [, cyCCW] = centroid(applyField(b, applyStroke(createField(61, 61), 'twirlCounterClockwise', dabs, brush).field));
  assert.ok(cyCW > 31, 'clockwise: the dot right of centre moves down, got ' + cyCW);
  assert.ok(cyCCW < 29, 'counter-clockwise: moves up, got ' + cyCCW);
});

test('push left moves content to the left of an upward drag', () => {
  const b = dotImg(60, 60, 30, 30, 3), f = createField(60, 60);
  const { field } = applyStroke(f, 'pushLeft', [{ x: 30, y: 36 }, { x: 30, y: 24 }], { size: 30, density: 30, pressure: 50 });
  const [cx, cy] = centroid(applyField(b, field));
  assert.ok(cx < 27, 'moved left, got ' + cx); assert.ok(Math.abs(cy - 30) < 1.5);
});

test('smooth reduces sharp differences in the field', () => {
  const f = createField(40, 40); for (let y = 0; y < 40; y++) for (let x = 20; x < 40; x++) f.dx[y * 40 + x] = 10;
  const jump = f.dx[20 * 40 + 20] - f.dx[20 * 40 + 19];
  const { field } = applyStroke(f, 'smooth', Array.from({ length: 5 }, () => ({ x: 20, y: 20 })), { size: 20, density: 0, pressure: 100, rate: 100 });
  assert.ok(field.dx[20 * 40 + 20] - field.dx[20 * 40 + 19] < jump * 0.5);
});

test('field serialization round-trips (exact at full size, close at reduced size)', () => {
  const f = createField(50, 30);
  for (let y = 0; y < 30; y++) for (let x = 0; x < 50; x++) { f.dx[y * 50 + x] = Math.sin(x / 8) * 5 + 0.123; f.dy[y * 50 + x] = Math.cos(y / 6) * -3; }
  const s = serializeField(f);
  const json = JSON.parse(JSON.stringify(s));
  const g = deserializeField(json);
  assert.deepEqual([g.w, g.h], [50, 30]); assert.deepEqual(g.dx, f.dx); assert.deepEqual(g.dy, f.dy);
  const small = serializeField(f, 25); assert.deepEqual([small.sw, small.sh], [25, 15]);
  const g2 = deserializeField(small);
  let err = 0; for (let i = 0; i < f.dx.length; i++) err = Math.max(err, Math.abs(g2.dx[i] - f.dx[i]), Math.abs(g2.dy[i] - f.dy[i]));
  assert.ok(err < 1.0, 'reduced-resolution error ' + err);
  assert.throws(() => deserializeField({ format: 'other' }), /Not a Liquify mesh/);
});

test('liquifyOp upsamples a proxy field and scales the vectors', () => {
  const b = img(40, 20, x => [x * 6, 0, 0, 255]);
  const proxy = { w: 20, h: 10, dx: Array(200).fill(1.5), dy: Array(200).fill(0) }; // 1.5 proxy px = 3 full px
  const o = liquifyOp(b, { field: proxy });
  assert.deepEqual(at(o, 10, 5), at(b, 13, 5));
  const viaMesh = liquifyOp(b, { field: serializeField({ w: 20, h: 10, dx: Float32Array.from(proxy.dx), dy: new Float32Array(200) }) });
  assert.deepEqual(at(viaMesh, 10, 5), at(b, 13, 5));
  assert.deepEqual(at(liquifyOp(b, {}), 7, 3), at(b, 7, 3));
  const r = resampleField({ w: 20, h: 10, dx: Float32Array.from(proxy.dx), dy: new Float32Array(200) }, 40, 20);
  assert.ok(Math.abs(r.dx[100] - 3) < 1e-6);
});

test('brush weight and helpers', () => {
  assert.equal(brushWeight(0, 50), 1); assert.equal(brushWeight(1, 50), 0); assert.equal(brushWeight(0.9, 0), 1);
  assert.ok(brushWeight(0.75, 50) > 0 && brushWeight(0.75, 50) < 1);
  const f = createField(30, 30); applyDabInPlace(f, 'forwardWarp', { x: 15, y: 15, px: 10, py: 15 }, { size: 20 });
  const [fx] = forwardPoint(f, 10, 15); assert.ok(fx > 13, 'forward point of pushed content follows the push');
});
