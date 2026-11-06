import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readPsd, initializeCanvas } from 'ag-psd';
import { createCanvas, ImageData } from '@napi-rs/canvas';
initializeCanvas(createCanvas, undefined, (w, h) => new ImageData(w, h));
import { buildPsd, cropToContent, effectsFor } from '../src/psd-export.js';

const img = (w, h, rgba) => { const d = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < d.length; i += 4) d.set(rgba, i); return { width: w, height: h, data: d }; };

test('psd export: layers bottom-first with names, visibility, opacity, blend, clipping, mask, effects; read back by ag-psd', () => {
  const doc = { w: 40, h: 30, globalLight: { angle: 90, altitude: 30 }, layers: [] };
  const base = { id: 'a', name: 'Base', type: 'raster', visible: true, opacity: 1, blend: 'normal' };
  const top = { id: 'b', name: 'Top', type: 'rect', visible: false, opacity: 0.5, blend: 'soft-light', clipped: true, mask: { enabled: true, density: 0.8, feather: 3 }, style: { blending: { fillOpacity: 40 }, effects: [{ type: 'dropShadow', enabled: true, distance: 7, size: 4, useGlobal: true }, { type: 'stroke', enabled: true, size: 2, color: '#ff0000' }, { type: 'patternOverlay', enabled: true }] } };
  const { buffer, report } = buildPsd(doc, [
    { layer: base, imageData: img(40, 30, [10, 20, 30, 255]), left: 0, top: 0 },
    { layer: top, imageData: img(10, 8, [200, 100, 50, 255]), left: 5, top: 6, mask: { imageData: img(10, 8, [255, 255, 255, 255]), left: 5, top: 6, defaultColor: 0 } },
  ], img(40, 30, [10, 20, 30, 255]));
  const psd = readPsd(new Uint8Array(buffer), { useImageData: true });
  assert.deepEqual([psd.width, psd.height], [40, 30]);
  assert.deepEqual(psd.children.map(c => c.name), ['Base', 'Top']);
  const t = psd.children[1];
  assert.equal(t.hidden, true); assert.ok(Math.abs(t.opacity - 0.5) < 0.01); assert.equal(t.blendMode, 'soft light'); assert.equal(t.clipping, true);
  assert.deepEqual([t.left, t.top, t.right, t.bottom], [5, 6, 15, 14]);
  assert.equal(t.imageData.data[0], 200);
  assert.ok(t.mask && t.mask.userMaskDensity > 0.79, 'mask with density');
  assert.ok(Math.abs(t.fillOpacity - 0.4) < 0.01);
  assert.equal(t.effects.dropShadow[0].distance.value, 7); assert.equal(t.effects.dropShadow[0].angle, 90);
  assert.deepEqual(t.effects.stroke[0].color, { r: 255, g: 0, b: 0 });
  assert.ok(report.some(r => r.includes('rect layer exported as rendered pixels')));
  assert.ok(report.some(r => r.includes('patternOverlay')), 'unsupported effect reported');
});

test('psd export: crop to content and effect mapping defaults', () => {
  const d = img(10, 10, [0, 0, 0, 0]); d.data.set([1, 2, 3, 255], (4 * 10 + 6) * 4);
  const c = cropToContent(d); assert.deepEqual([c.left, c.top, c.imageData.width, c.imageData.height], [6, 4, 1, 1]);
  assert.equal(cropToContent(img(3, 3, [0, 0, 0, 0])).imageData.width, 1);
  assert.equal(effectsFor({ effects: [] }), undefined);
});
