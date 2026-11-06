import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEffectFilter, newEffect, FX_TYPES, normalizeStyle, styleActive, needsBackdrop, contourTable, blendIfTable, lightVector, layerBounds, patternTile, PATTERNS, BLENDING_DEFAULTS } from '../src/engine/styles.js';

const nodesOf = (list, tag) => { const out = []; const walk = ns => ns.forEach(([t, a, c]) => { if (t === tag) out.push(a); walk(c); }); walk(list); return out; };

test('styles: every effect type builds a filter that ends in result "out" (or bevel parts)', () => {
  for (const t of FX_TYPES) {
    const parts = t === 'bevel' ? ['hi', 'sh'] : [undefined];
    for (const part of parts) {
      const nodes = buildEffectFilter(newEffect(t), { bounds: { x: 0, y: 0, w: 100, h: 50 }, images: { gradient: 'data:x', pattern: 'data:y', texture: 'data:z' }, part });
      assert.ok(nodes.length > 1, t);
      assert.ok(nodes.some(([, a]) => a.result === 'out'), t + ' has no out result');
    }
  }
});

test('styles: drop shadow uses Photoshop angle convention (120° light → shadow down-right), spread dilates, knockout cuts', () => {
  const [dx, dy] = lightVector(120, 10); assert.ok(dx > 0 && dy > 0);
  const n = buildEffectFilter({ ...newEffect('dropShadow'), distance: 10, spread: 50, size: 10 }, {});
  assert.equal(nodesOf(n, 'feMorphology')[0].radius, 5);
  assert.ok(Math.abs(nodesOf(n, 'feOffset').find(a => a.in === 'a2').dx - 5) < 1e-9);
  assert.equal(nodesOf(n, 'feComposite').at(-1).operator, 'out');
  const g = buildEffectFilter({ ...newEffect('dropShadow'), useGlobal: true }, { light: { angle: 90, altitude: 30 } });
  const off = nodesOf(g, 'feOffset').find(a => a.in === 'a2'); assert.ok(Math.abs(off.dx) < 1e-9 && off.dy > 0, 'global light angle applies');
});

test('styles: stroke positions use dilate/erode correctly', () => {
  const ops = pos => nodesOf(buildEffectFilter({ ...newEffect('stroke'), position: pos, size: 4 }, {}), 'feMorphology').map(a => a.operator + a.radius);
  assert.deepEqual(ops('outside'), ['dilate4']); assert.deepEqual(ops('inside'), ['erode4']); assert.deepEqual(ops('center'), ['dilate2', 'erode2']);
});

test('styles: contours, blend-if ramps, normalisation and activity checks', () => {
  assert.deepEqual([contourTable('linear')[0], contourTable('linear')[32]], [0, 1]);
  assert.equal(contourTable('cone')[16], 1);
  const t = blendIfTable([10, 30, 200, 255]); assert.equal(t[0], 0); assert.equal(t[32], 1); assert.ok(t[52] > 0.6 && t[52] < 1, 'fades across the white split'); assert.equal(t[63], 0);
  assert.equal(styleActive(undefined), false); assert.equal(styleActive(normalizeStyle({})), false);
  assert.equal(styleActive({ blending: { ...BLENDING_DEFAULTS, fillOpacity: 50 }, effects: [] }), true);
  assert.equal(needsBackdrop({ blending: { ...BLENDING_DEFAULTS, blendIf: { channel: 'gray', current: [0, 0, 255, 255], underlying: [20, 40, 255, 255] } } }), true);
  const ns = normalizeStyle({ effects: [{ type: 'stroke', size: 9 }, { type: 'bogus' }] });
  assert.equal(ns.effects.length, 1); assert.equal(ns.effects[0].position, 'outside'); assert.equal(ns.effects[0].size, 9);
  const b = layerBounds({ x: 0, y: 0, w: 100, h: 20, rotation: 90 }); assert.ok(Math.abs(b.w - 20) < 1e-9 && Math.abs(b.h - 100) < 1e-9);
  for (const p of Object.keys(PATTERNS)) assert.equal(patternTile(p, 8).data.length, 8 * 8 * 4);
});
