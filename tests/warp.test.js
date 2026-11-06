import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homography, apply3, invert3, projectiveTransform, meshWarp, warpGrid, bezierPoint } from '../src/engine/warp.js';

const img = (w, h, f) => { const d = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set(f(x, y), (y * w + x) * 4); return { w, h, data: d }; };
const at = (b, x, y) => [...b.data.slice((y * b.w + x) * 4, (y * b.w + x) * 4 + 4)];

test('homography maps corners exactly and inverts', () => {
  const src = [[0, 0], [10, 0], [10, 10], [0, 10]], dst = [[5, 5], [30, 8], [26, 40], [2, 33]], H = homography(src, dst);
  src.forEach((p, i) => { const [x, y] = apply3(H, ...p); assert.ok(Math.abs(x - dst[i][0]) < 1e-9 && Math.abs(y - dst[i][1]) < 1e-9); });
  const [x, y] = apply3(invert3(H), ...apply3(H, 3, 7)); assert.ok(Math.abs(x - 3) < 1e-9 && Math.abs(y - 7) < 1e-9);
  assert.throws(() => homography(src, [[0, 0], [1, 1], [2, 2], [3, 3]]), /Degenerate/);
});

test('projective: identity keeps pixels; 2× scale and 90° rotation place content correctly; perspective narrows', () => {
  const b = img(8, 6, (x, y) => [x * 30, y * 40, 0, 255]);
  const id = projectiveTransform(b, [[0, 0], [8, 0], [8, 6], [0, 6]]);
  assert.deepEqual([id.x, id.y, id.w, id.h], [0, 0, 8, 6]); assert.deepEqual(at(id, 3, 2), at(b, 3, 2));
  const s = projectiveTransform(b, [[0, 0], [16, 0], [16, 12], [0, 12]], 'nearest'); assert.deepEqual([s.w, s.h], [16, 12]); assert.deepEqual(at(s, 7, 5), at(b, 3, 2));
  const r = projectiveTransform(b, [[6, 0], [6, 8], [0, 8], [0, 0]], 'nearest'); assert.deepEqual([r.w, r.h], [6, 8]); assert.deepEqual(at(r, 5, 0), at(b, 0, 0));
  const p = projectiveTransform(img(40, 40, () => [255, 0, 0, 255]), [[10, 0], [30, 0], [40, 40], [0, 40]]);
  assert.equal(at(p, 2, 1)[3], 0, 'outside the trapezoid is transparent'); assert.equal(at(p, 20, 20)[3], 255);
});

test('mesh warp: an undeformed grid reproduces the image; moving the centre bends it', () => {
  const b = img(30, 20, (x, y) => [x * 8, y * 12, 100, 255]);
  const w = meshWarp(b, warpGrid(0, 0, 30, 20), 'nearest', 32);
  assert.deepEqual([w.w, w.h], [30, 20]); assert.deepEqual(at(w, 15, 10), at(b, 15, 10));
  const g = warpGrid(0, 0, 30, 20); g[5] = [g[5][0], g[5][1] - 8]; g[6] = [g[6][0], g[6][1] - 8];
  const bent = meshWarp(b, g, 'nearest', 32), mid = bezierPoint(g, 0.5, 0.5);
  assert.ok(mid[1] < 10, 'surface moved up'); assert.notDeepEqual(at(bent, 15, 8), at(b, 15, 8));
});
