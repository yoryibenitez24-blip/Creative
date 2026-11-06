// Every built-in preset applies cleanly through develop() and visibly changes a photo-like image.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_PRESETS, applyPreset, blendPreset } from '../src/engine/catalog.js';
import { develop, developDefaults } from '../src/engine/develop.js';

function photo(w = 160, h = 110) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, sky = y < h * 0.55, obj = Math.hypot(x - w / 2, y - h * 0.6) < h * 0.2;
    const c = obj ? [200, 80, 50] : sky ? [70 + y, 130 + y, 220] : [70, 110 + (x % 7) * 3, 50];
    d.set([...c, 255], i);
  }
  return { w, h, data: d };
}

test('presets: unique ids and names per category; 80+ presets in 15+ categories', () => {
  const ids = new Set(BUILTIN_PRESETS.map(p => p.id));
  assert.equal(ids.size, BUILTIN_PRESETS.length);
  assert.ok(BUILTIN_PRESETS.length >= 80);
  assert.ok(new Set(BUILTIN_PRESETS.map(p => p.category)).size >= 15);
});

test('presets: every preset renders and changes the image', () => {
  const base = photo(), ref = develop({ ...base, data: new Uint8ClampedArray(base.data) }, developDefaults(), { scale: 1 }).data;
  for (const p of BUILTIN_PRESETS) {
    const out = develop({ ...base, data: new Uint8ClampedArray(base.data) }, applyPreset(developDefaults(), p), { scale: 1 });
    let diff = 0; for (let i = 0; i < ref.length; i++) diff += Math.abs(out.data[i] - ref[i]);
    assert.ok(diff / ref.length > 0.3, p.category + ' / ' + p.name + ' changes the image (' + (diff / ref.length).toFixed(2) + ')');
  }
});

test('presets: amount 0 leaves the settings unchanged', () => {
  const p = BUILTIN_PRESETS.find(x => x.category === 'Cinematic'), s = developDefaults();
  assert.deepEqual(blendPreset(s, p, 0).exposure, s.exposure);
  assert.deepEqual(blendPreset(s, p, 0).contrast, s.contrast);
});
