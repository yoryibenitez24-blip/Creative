import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentAwareFill } from '../src/engine/inpaint.js';

test('content-aware fill rebuilds a stripe texture inside a hole (not a blur, not a flat average)', () => {
  const W = 64, H = 48, d = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = (x >> 2) % 2 ? 220 : 40; d.set([v, v, v, 255], (y * W + x) * 4); }
  const hole = new Uint8Array(W * H); for (let y = 18; y < 30; y++) for (let x = 26; x < 38; x++) { hole[y * W + x] = 255; d.set([255, 0, 0, 255], (y * W + x) * 4); }
  const out = contentAwareFill({ w: W, h: H, data: d }, hole, { seed: 3 });
  let red = 0, mid = 0, contrast = 0;
  for (let y = 18; y < 30; y++) for (let x = 26; x < 38; x++) { const p = (y * W + x) * 4; if (out.data[p] > 200 && out.data[p + 1] < 80) red++; if (out.data[p] > 90 && out.data[p] < 170) mid++; contrast += Math.abs(out.data[p] - out.data[p + 4]); }
  assert.equal(red, 0, 'hole colour gone');
  assert.ok(mid < 40, 'mostly crisp stripes, not grey blur: ' + mid);
  assert.ok(contrast / 144 > 40, 'texture contrast synthesised: ' + contrast / 144);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!hole[y * W + x]) { const p = (y * W + x) * 4; assert.equal(out.data[p], d[p]); }
});

test('content-aware fill respects the sampling area and is deterministic', () => {
  const W = 48, H = 32, d = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) d.set(x < 24 ? [200, 30, 30, 255] : [30, 30, 200, 255], (y * W + x) * 4);
  const hole = new Uint8Array(W * H); for (let y = 12; y < 20; y++) for (let x = 30; x < 38; x++) hole[y * W + x] = 255;
  const src = new Uint8Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < 20; x++) src[y * W + x] = 255; // only red allowed
  const a = contentAwareFill({ w: W, h: H, data: d }, hole, { source: src, seed: 5 }), b = contentAwareFill({ w: W, h: H, data: d }, hole, { source: src, seed: 5 });
  assert.deepEqual(a.data, b.data);
  const p = (16 * W + 34) * 4; assert.ok(a.data[p] > a.data[p + 2], 'sampled from the red side only');
});
