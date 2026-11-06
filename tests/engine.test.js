import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sampleStroke, createStroke, addPoint, finishStroke, clampBrush, DEFAULT_BRUSH } from '../src/engine/brush.js';
import { beginPaint, applyDab, createBuffer, fillArea, dabAlpha } from '../src/engine/raster.js';
import { appendOp, computeMask, rasterizeShape, maskOutline, maskBounds, feather } from '../src/engine/selection.js';
import { migrateDocument, detectVersion, SCHEMA_VERSION, readProjectFile, makeEnvelope, referencedAssets } from '../src/engine/schema.js';
import { AssetStore, memoryBackend, exportAssets, importAssets, hashBytes } from '../src/engine/assets.js';
import { normalizeDocument, validateDocument } from '../src/model.js';

const line = (x0, y0, x1, y1, n = 40, p = 1) => Array.from({ length: n + 1 }, (_, i) => ({ x: x0 + (x1 - x0) * i / n, y: y0 + (y1 - y0) * i / n, pressure: p }));

// ---------- brush sampling ----------
test('brush: same document-space input yields identical dabs regardless of sample density (zoom-independent)', () => {
  const b = { ...DEFAULT_BRUSH, size: 20, spacing: 0.25, pressureSize: false };
  // A screen at zoom 4 produces ~4x more pointer samples along the same document path.
  const coarse = sampleStroke(b, line(10, 10, 210, 60, 25));
  const fine = sampleStroke(b, line(10, 10, 210, 60, 100));
  assert.equal(coarse.length, fine.length);
  coarse.forEach((d, i) => { assert.ok(Math.abs(d.x - fine[i].x) < 1e-9); assert.ok(Math.abs(d.y - fine[i].y) < 1e-9); });
});

test('brush: dab spacing follows spacing × diameter', () => {
  const dabs = sampleStroke({ ...DEFAULT_BRUSH, size: 40, spacing: 0.5, pressureSize: false }, line(0, 0, 200, 0, 7));
  for (let i = 1; i < dabs.length; i++) assert.ok(Math.abs(dabs[i].x - dabs[i - 1].x - 20) < 1e-9);
  assert.equal(dabs.length, 11);
});

test('brush: pressure maps to size and flow independently', () => {
  const b = { ...DEFAULT_BRUSH, size: 100, pressureSize: true, pressureFlow: true, minSize: 0 };
  const [d] = addPoint(createStroke(b), { x: 0, y: 0, pressure: 0.5 });
  assert.equal(d.size, 50); assert.equal(d.flow, 0.5);
  const [d2] = addPoint(createStroke({ ...b, pressureSize: false, pressureFlow: false }), { x: 0, y: 0, pressure: 0.25 });
  assert.equal(d2.size, 100); assert.equal(d2.flow, 1);
});

test('brush: smoothing lags then catches up to the final sample', () => {
  const s = createStroke({ ...DEFAULT_BRUSH, size: 10, smoothing: 0.8, pressureSize: false });
  const dabs = [];
  for (const p of line(0, 0, 100, 0, 10)) dabs.push(...addPoint(s, p));
  assert.ok(dabs.at(-1).x < 95);
  dabs.push(...finishStroke(s));
  assert.ok(dabs.at(-1).x > 98.4);
});

test('brush: settings are clamped', () => {
  const b = clampBrush({ size: -5, opacity: 4, hardness: NaN });
  assert.equal(b.size, 1); assert.equal(b.opacity, 1); assert.equal(b.hardness, DEFAULT_BRUSH.hardness);
});

// ---------- raster compositing ----------
const alphaAt = (buf, x, y) => buf.data[(y * buf.w + x) * 4 + 3];

test('raster: stroke opacity caps build-up from overlapping dabs (opacity vs flow)', () => {
  const buf = createBuffer(50, 50);
  const ctx = beginPaint(buf, { color: [255, 0, 0], opacity: 0.5, hardness: 1 });
  for (let i = 0; i < 20; i++) applyDab(ctx, { x: 25, y: 25, size: 20, flow: 1 });
  assert.equal(alphaAt(buf, 25, 25), 128);
  const buf2 = createBuffer(50, 50);
  const ctx2 = beginPaint(buf2, { color: [255, 0, 0], opacity: 1, hardness: 1 });
  applyDab(ctx2, { x: 25, y: 25, size: 20, flow: 0.25 });
  const once = alphaAt(buf2, 25, 25);
  applyDab(ctx2, { x: 25, y: 25, size: 20, flow: 0.25 });
  assert.ok(alphaAt(buf2, 25, 25) > once, 'flow builds up within a stroke');
});

test('raster: eraser removes alpha and keeps color channels', () => {
  const buf = createBuffer(20, 20);
  fillArea(buf, { color: [10, 20, 30], mode: 'paint', opacity: 1 });
  const ctx = beginPaint(buf, { mode: 'erase', opacity: 1, hardness: 1 });
  applyDab(ctx, { x: 10, y: 10, size: 6, flow: 1 });
  assert.equal(alphaAt(buf, 10, 10), 0);
  assert.equal(alphaAt(buf, 0, 0), 255);
  assert.deepEqual([...buf.data.slice(0, 3)], [10, 20, 30]);
});

test('raster: hardness profile is monotonic with an anti-aliased edge', () => {
  assert.equal(dabAlpha(0, 10, 1), 1);
  assert.equal(dabAlpha(10, 10, 1), 0);
  assert.ok(dabAlpha(9.5, 10, 1) > 0 && dabAlpha(9.5, 10, 1) < 1);
  let prev = 1; for (let d = 0; d <= 10; d += 0.5) { const a = dabAlpha(d, 10, 0.3); assert.ok(a <= prev + 1e-12); prev = a; }
});

test('raster: selection mask restricts paint, including feathered partial coverage', () => {
  const W = 100, H = 40;
  const sel = appendOp(null, { op: 'replace', shape: { type: 'rect', x: 0, y: 0, w: 50, h: 40 }, feather: 6 });
  const mask = computeMask(sel, W, H);
  const buf = createBuffer(W, H);
  const ctx = beginPaint(buf, { color: [0, 0, 0], opacity: 1, hardness: 1, mask, docW: W, docH: H });
  for (const d of sampleStroke({ ...DEFAULT_BRUSH, size: 30, pressureSize: false, hardness: 1 }, line(5, 20, 95, 20))) applyDab(ctx, d);
  assert.equal(alphaAt(buf, 10, 20), 255);
  assert.equal(alphaAt(buf, 90, 20), 0);
  const edge = alphaAt(buf, 50, 20);
  assert.ok(edge > 60 && edge < 200, 'feathered boundary is partial: ' + edge);
  // alpha equals the mask exactly where the stroke fully covers
  for (let x = 30; x < 70; x++) assert.ok(Math.abs(alphaAt(buf, x, 20) - mask[20 * W + x]) <= 1);
});

test('raster: layer offset maps layer pixels into document selection space', () => {
  const W = 40, H = 40;
  const mask = computeMask({ ops: [{ op: 'replace', shape: { type: 'rect', x: 20, y: 0, w: 20, h: 40 } }] }, W, H);
  const buf = createBuffer(40, 40);
  fillArea(buf, { color: [1, 2, 3], mode: 'paint', opacity: 1, mask, docW: W, docH: H, offsetX: 10, offsetY: 0 });
  assert.equal(alphaAt(buf, 9, 5), 0);   // doc x=19 → outside
  assert.equal(alphaAt(buf, 10, 5), 255); // doc x=20 → inside
  assert.equal(alphaAt(buf, 35, 5), 0);  // doc x=45 → outside document
});

// ---------- selection geometry ----------
test('selection: rect coverage is exact for fractional edges', () => {
  const c = rasterizeShape({ type: 'rect', x: 1.5, y: 0, w: 2, h: 1 }, 5, 1);
  assert.deepEqual([...c].map(v => Math.round(v * 100) / 100), [0, 0.5, 1, 0.5, 0]);
});

test('selection: ellipse area approximates πab', () => {
  const W = 200, H = 200;
  const c = rasterizeShape({ type: 'ellipse', x: 20, y: 40, w: 160, h: 100 }, W, H);
  const area = c.reduce((a, v) => a + v, 0);
  assert.ok(Math.abs(area - Math.PI * 80 * 50) / (Math.PI * 80 * 50) < 0.003, 'area ' + area);
});

test('selection: polygon (lasso) area matches shoelace area', () => {
  const pts = [10, 10, 90, 20, 70, 80, 20, 60];
  let shoelace = 0; for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; shoelace += pts[2 * i] * pts[2 * j + 1] - pts[2 * j] * pts[2 * i + 1]; }
  const c = rasterizeShape({ type: 'polygon', points: pts }, 100, 100);
  const area = c.reduce((a, v) => a + v, 0);
  assert.ok(Math.abs(area - Math.abs(shoelace) / 2) < 15, `area ${area} vs ${Math.abs(shoelace) / 2}`);
});

test('selection: add / subtract / intersect / invert algebra', () => {
  const W = 30, H = 10, r = (x, w) => ({ type: 'rect', x, y: 0, w, h: 10 });
  let s = appendOp(null, { op: 'replace', shape: r(0, 10) });
  s = appendOp(s, { op: 'add', shape: r(20, 10) });
  let m = computeMask(s, W, H);
  assert.equal(m[5], 255); assert.equal(m[15], 0); assert.equal(m[25], 255);
  const sub = computeMask(appendOp(s, { op: 'subtract', shape: r(0, 5) }), W, H);
  assert.equal(sub[2], 0); assert.equal(sub[7], 255);
  const inter = computeMask(appendOp(s, { op: 'intersect', shape: r(5, 20) }), W, H);
  assert.equal(inter[2], 0); assert.equal(inter[7], 255); assert.equal(inter[15], 0); assert.equal(inter[22], 255); assert.equal(inter[27], 0);
  const inv = computeMask(appendOp(s, { op: 'invert' }), W, H);
  assert.equal(inv[5], 0); assert.equal(inv[15], 255);
  assert.equal(appendOp(null, { op: 'subtract', shape: r(0, 5) }), null);
  assert.equal(computeMask(null, W, H), null);
});

test('selection: feather preserves total coverage away from borders and is symmetric', () => {
  const W = 120, H = 120;
  const hard = rasterizeShape({ type: 'rect', x: 40, y: 40, w: 40, h: 40 }, W, H);
  const soft = feather(Float32Array.from(hard), W, H, 10);
  const sum = a => a.reduce((x, v) => x + v, 0);
  assert.ok(Math.abs(sum(soft) - sum(hard)) < 1);
  assert.ok(Math.abs(soft[60 * W + 45] - soft[60 * W + 74]) < 1e-5);
  assert.ok(soft[60 * W + 40] > 0.3 && soft[60 * W + 40] < 0.7);
});

test('selection: outline and bounds of a rectangle', () => {
  const m = computeMask({ ops: [{ op: 'replace', shape: { type: 'rect', x: 2, y: 3, w: 4, h: 5 } }] }, 10, 10);
  assert.deepEqual(maskBounds(m, 10, 10), { x: 2, y: 3, w: 4, h: 5 });
  assert.equal(maskOutline(m, 10, 10), 'M2 3h4M2 8h4M2 3v5M6 3v5');
});

// ---------- schema & migration ----------
const v1 = { name: 'Old', w: 300, h: 200, bg: '#fff', layers: [{ id: 'a', type: 'rect', x: 0, y: 0, w: 10, h: 10, rotation: 0, opacity: 1, fill: '#000', group: 'g1', futureField: { keep: true } }], psdGroups: [{ id: 'g2', name: 'From PSD', parent: null }], customTopLevel: 42 };

test('schema: v1 documents migrate to v2 without losing unknown data', () => {
  assert.equal(detectVersion(v1), 1);
  const d = migrateDocument(structuredClone(v1));
  assert.equal(d.schemaVersion, SCHEMA_VERSION);
  assert.equal(d.customTopLevel, 42);
  assert.deepEqual(d.layers[0].futureField, { keep: true });
  assert.deepEqual(d.psdGroups, v1.psdGroups);
  assert.deepEqual(d.groups.map(g => g.id).sort(), ['g1', 'g2']);
  assert.deepEqual(d.migrations, [{ from: 1, to: 2 }, { from: 2, to: 3 }, { from: 3, to: 4 }]);
  assert.equal(d.color.profile, 'sRGB IEC61966-2.1');
  assert.equal(migrateDocument(d), d, 'migrating current version is a no-op');
});

test('schema: future versions are refused instead of silently opened', () => {
  assert.throws(() => migrateDocument({ ...v1, schemaVersion: 99 }), /newer Zertake/);
});

test('schema: raster layer validation and native envelope round trip', () => {
  const id = 'sha256-' + 'a'.repeat(64);
  const doc = normalizeDocument({ ...v1, layers: [...v1.layers, { id: 'r', type: 'raster', x: 0, y: 0, w: 300, h: 200, rotation: 0, opacity: 1, assetId: id }], selection: { ops: [{ op: 'replace', shape: { type: 'all' } }] } });
  assert.deepEqual(referencedAssets(doc), [id]);
  const env = JSON.parse(JSON.stringify(makeEnvelope(doc, { [id]: { type: 'image/png', data: '' } })));
  const back = readProjectFile(env);
  assert.deepEqual(back.doc, doc);
  assert.ok(back.assets[id]);
  assert.deepEqual(readProjectFile(v1).doc, v1, 'bare v1 file still readable');
  assert.throws(() => validateDocument({ ...doc, layers: [{ ...doc.layers[1], assetId: 'https://x/y.png' }] }), /paint layer/);
  assert.throws(() => validateDocument({ ...doc, layers: [{ ...doc.layers[1], w: 10.5 }] }), /paint layer/);
});

// ---------- asset store ----------
test('assets: content addressing deduplicates and round-trips through the envelope', async () => {
  const backend = memoryBackend();
  const store = new AssetStore(backend);
  const a = await store.put(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }));
  const b = await store.put(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }));
  assert.equal(a, b);
  assert.equal(backend.map.size, 1);
  assert.equal(a, await hashBytes(new Uint8Array([1, 2, 3])));
  const exported = await exportAssets(store, [a]);
  const store2 = new AssetStore(memoryBackend());
  await importAssets(store2, exported);
  assert.deepEqual(new Uint8Array(await (await store2.get(a)).arrayBuffer()), new Uint8Array([1, 2, 3]));
  await assert.rejects(importAssets(store2, { ['sha256-' + '0'.repeat(64)]: exported[a] }), /hash mismatch/);
  await assert.rejects(new AssetStore(memoryBackend()).get(a), /Missing pixel data/);
});

test('assets: a failing backend write rejects, so callers never commit unsaved pixels', async () => {
  const store = new AssetStore({ ...memoryBackend(), put: async () => { throw Error('QuotaExceededError'); } });
  await assert.rejects(store.put(new Blob([new Uint8Array([9])])), /Quota/);
});

// ---------- layer masks ----------
import { newMask, validateMask, effective, maskBufferFromSelection, invertMaskBuffer, rawMaskAt, sampleMask, applyMask, moveLayer, luminance } from '../src/engine/mask.js';

test('mask: validation and defaults', () => {
  const m = newMask(100, 50, 255);
  assert.ok(validateMask(m)); assert.ok(validateMask(undefined));
  assert.equal(m.fill, 255); assert.equal(m.density, 1); assert.ok(m.enabled && m.linked);
  for (const bad of [{ ...m, fill: 128 }, { ...m, density: 2 }, { ...m, w: 1.5 }, { ...m, assetId: 'x' }, { ...m, feather: -1 }]) assert.ok(!validateMask(bad));
  assert.throws(() => validateDocument({ name: 'd', w: 10, h: 10, bg: '#fff', layers: [{ id: 'a', type: 'rect', x: 0, y: 0, w: 5, h: 5, rotation: 0, opacity: 1, mask: { ...m, fill: 3 } }] }), /mask/);
});

test('mask: density formula: 0 disables, 1 is the raw mask', () => {
  assert.equal(effective(0, 1), 0); assert.equal(effective(0, 0), 255); assert.equal(effective(0, 0.5), 127.5); assert.equal(effective(200, 0.5), 227.5);
});

test('mask: from selection (reveal and hide), invert, outside uses fill', () => {
  const sel = computeMask({ ops: [{ op: 'replace', shape: { type: 'rect', x: 0, y: 0, w: 5, h: 4 } }] }, 10, 4);
  const reveal = maskBufferFromSelection(sel, 10, 4), hide = maskBufferFromSelection(sel, 10, 4, true);
  const m = { ...newMask(10, 4, 0) };
  assert.equal(rawMaskAt(m, reveal, 2, 1), 255); assert.equal(rawMaskAt(m, reveal, 7, 1), 0); assert.equal(rawMaskAt(m, reveal, 50, 1), 0);
  assert.equal(rawMaskAt(m, hide, 2, 1), 0);
  invertMaskBuffer(reveal);
  assert.equal(rawMaskAt(m, reveal, 2, 1), 0); assert.equal(reveal.data[3], 255);
});

test('mask: apply multiplies layer alpha, honours layer offset, density and fill outside', () => {
  const buf = createBuffer(10, 1);
  fillArea(buf, { color: [9, 9, 9], mode: 'paint', opacity: 1 });
  const sel = computeMask({ ops: [{ op: 'replace', shape: { type: 'rect', x: 0, y: 0, w: 8, h: 1 } }] }, 10, 1);
  const mask = { ...newMask(10, 1, 0), density: 0.5 };
  applyMask(buf, 2, 0, mask, maskBufferFromSelection(sel, 10, 1)); // layer px x → doc x+2
  const a = x => buf.data[x * 4 + 3];
  assert.equal(a(0), 255); assert.equal(a(5), 255); // doc 2..7 inside
  assert.equal(a(6), 128); assert.equal(a(9), 128); // doc 8..11 hidden at 50% density (doc 10, 11 outside mask → fill 0)
  const off = createBuffer(2, 1); fillArea(off, { color: [1, 1, 1], mode: 'paint', opacity: 1 });
  applyMask(off, 0, 0, { ...newMask(2, 1, 0), enabled: false }, null);
  assert.equal(off.data[3], 255, 'disabled mask has no effect');
});

test('mask: feather is symmetric around the edge and respects fill outside the mask rectangle', () => {
  const W = 60, H = 60;
  const sel = computeMask({ ops: [{ op: 'replace', shape: { type: 'rect', x: -100, y: -100, w: 130, h: 300 } }] }, W, H);
  const m = { ...newMask(W, H, 0), feather: 8 };
  const full = sampleMask(m, maskBufferFromSelection(sel, W, H), 0, 30, W, 1);
  assert.ok(Math.abs(full[29] + full[30] - 255) < 2, `${full[29]} + ${full[30]}`);
  assert.ok(full[15] > 254 && full[55] < 1);
  // reveal-all mask with no pixels stays fully revealed after feather (no darkened border)
  const all = sampleMask({ ...newMask(20, 20, 255), feather: 10 }, null, 0, 0, 20, 20);
  assert.ok(all.every(v => Math.abs(v - 255) < 1e-3));
});

test('mask: linked masks move with the layer, unlinked ones stay', () => {
  const l = { id: 'a', x: 10, y: 10, mask: { ...newMask(5, 5), x: 3, y: 4 } };
  assert.deepEqual([moveLayer(l, 15, 7).mask.x, moveLayer(l, 15, 7).mask.y], [8, 1]);
  assert.equal(moveLayer({ ...l, mask: { ...l.mask, linked: false } }, 15, 7).mask.x, 3);
  assert.equal(moveLayer({ id: 'b', x: 0, y: 0 }, 1, 1).mask, undefined);
  assert.equal(luminance([255, 255, 255]), 255); assert.equal(luminance([0, 0, 0]), 0);
});

test('schema: v2 documents migrate to v3; mask assets are referenced', () => {
  const v2 = migrateDocument(structuredClone(v1));
  const id = 'sha256-' + 'b'.repeat(64);
  const d = { ...v2, layers: [{ ...v2.layers[0], mask: { ...newMask(10, 10), assetId: id } }] };
  assert.deepEqual(referencedAssets(d), [id]);
  assert.equal(migrateDocument({ ...v1, schemaVersion: 2 }).schemaVersion, SCHEMA_VERSION);
});
