// E-commerce studio engine: framing math, batch scale, compositing (pure white), ground shadows,
// reflection, presets checklist, naming, ZIP writer round trip, AI matte refinement (real U²-Netp
// through onnxruntime-web), retouch, templates (drawn with @napi-rs/canvas) and the project store.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import zlib from 'node:zlib';
import { createCanvas } from '@napi-rs/canvas';
import * as ort from '../node_modules/onnxruntime-web/dist/ort.wasm.min.mjs';
import { segment, encodeAlpha } from '../src/engine/aiseg.js';
import { develop } from '../src/engine/develop.js';
import { resample } from '../src/engine/geometry.js';
import { placeProduct, batchScales, compose, shadowPlane, refineMatte, productBounds, cutout, cropBuffer, retouchSettings, applyStrokes, blurPlane, ecomCutoutOp, ecomComposeOp, makeBuf, isRetouchIdentity } from '../src/ecom/engine.js';
import { PRESETS, PRESET_BY_ID, resolvePreset, backgroundStats, checkPreset, formatName, uniqueNames, marginForFill } from '../src/ecom/presets.js';
import { createZip, readZip, crc32 } from '../src/ecom/zip.js';
import { TEMPLATES, layoutTemplate, drawTemplate, fitInSlot } from '../src/ecom/templates.js';
import { memoryProjectStore, newProject, newItem, normalizeProject } from '../src/ecom/projectStore.js';
ort.env.wasm.numThreads = 1;
const U2 = new URL('../node_modules/@rmbg/model-u2netp/u2netp.onnx', import.meta.url);

// a solid product (opaque rectangle, red) of size w × h
const solid = (w, h, c = [200, 30, 30]) => { const b = makeBuf(w, h); for (let i = 0; i < w * h; i++) b.data.set([...c, 255], i * 4); return b; };
const px = (b, x, y) => [...b.data.slice((y * b.w + x) * 4, (y * b.w + x) * 4 + 4)];

test('framing: centre and bottom alignment with a margin of the shorter side', () => {
  const c = { W: 2000, H: 2000 };
  const p = placeProduct({ w: 500, h: 1000 }, c, { margin: 7.5, align: 'center' });
  assert.equal(p.h, 1700); assert.equal(p.w, 850); assert.equal(p.x, 575); assert.equal(p.y, 150);
  const b = placeProduct({ w: 500, h: 1000 }, c, { margin: 10, align: 'bottom' });
  assert.equal(b.h, 1600); assert.equal(b.y + b.h, 1800, 'stands on the floor line one margin above the bottom');
  const wide = placeProduct({ w: 1200, h: 300 }, { W: 2000, H: 1600 }, { margin: 5 });
  assert.equal(wide.w, 1840); assert.equal(wide.x, 80); assert.equal(Math.round(wide.y + wide.h / 2), 800);
  const capped = placeProduct({ w: 100, h: 100 }, c, { margin: 0, scale: 50 });
  assert.equal(capped.w, 2000, 'an explicit scale never overflows the frame');
  assert.equal(marginForFill(0.85), 7.5);
});

test('batch: uniform scale keeps relative sizes, the largest product fills the frame', () => {
  const canvas = { W: 2000, H: 2000 }, items = [{ w: 400, h: 800, L: 1000 }, { w: 200, h: 300, L: 1000 }, { w: 800, h: 1200, L: 2000 }];
  const fit = batchScales(items, canvas, { margin: 7.5, sizing: 'fit' });
  assert.ok(Math.abs(fit[0] * 800 - 1700) < 1e-9 && Math.abs(fit[1] * 300 - 1700) < 1e-9, 'fit: each fills the frame');
  const u = batchScales(items, canvas, { margin: 7.5, sizing: 'uniform' });
  const hOut = items.map((it, i) => it.h * u[i]);
  assert.ok(Math.abs(hOut[0] - 1700) < 1e-9, 'the largest (relative to its photo) fills the frame');
  assert.ok(Math.abs(hOut[1] / hOut[0] - 0.375) < 1e-9, 'relative sizes kept');
  assert.ok(Math.abs(hOut[2] / hOut[0] - 0.75) < 1e-9, 'photos of a different resolution are normalised by their frame');
  for (let i = 0; i < 3; i++) { const p = placeProduct(items[i], canvas, { margin: 7.5, scale: u[i] }); assert.ok(p.w <= 1700 && p.h <= 1700); }
});

test('compose: pure #FFFFFF background, product pixels exact, Amazon checklist passes', () => {
  const canvas = { W: 400, H: 400 }, prod = solid(170, 340), place = placeProduct(prod, canvas, { margin: 7.5 });
  const out = compose(prod, canvas, place, { background: { type: 'white' } });
  for (const [x, y] of [[0, 0], [399, 0], [0, 399], [399, 399], [10, 200]]) assert.deepEqual(px(out, x, y), [255, 255, 255, 255]);
  assert.deepEqual(px(out, 200, 200), [200, 30, 30, 255]);
  const st = backgroundStats(out, place, prod);
  assert.equal(st.whiteFraction, 1); assert.equal(st.borderFraction, 1);
  const amazon = { ...PRESET_BY_ID.amazon, w: 400, h: 400, minSide: 100 };
  const rows = checkPreset(amazon, { w: 400, h: 400, place, stats: st, bytes: 50000, format: 'jpeg', upscale: 1 });
  assert.ok(rows.every(r => r.status === 'pass'), JSON.stringify(rows));
  // an off-white background fails the white check
  const grey = compose(prod, canvas, place, { background: { type: 'color', color: '#fefefe' } });
  const r2 = checkPreset(amazon, { w: 400, h: 400, place, stats: backgroundStats(grey, place, prod) });
  assert.equal(r2.find(r => r.id === 'white').status, 'fail');
  // transparent background stays transparent; gradient runs between its colours
  const tr = compose(prod, canvas, place, { background: { type: 'transparent' } });
  assert.equal(px(tr, 0, 0)[3], 0);
  const g = compose(prod, canvas, place, { background: { type: 'gradient', color: '#000000', color2: '#ffffff', angle: 90 } });
  assert.ok(px(g, 5, 0)[0] < 5 && px(g, 5, 399)[0] > 250);
  // a background image is cover-fitted
  const bgImg = solid(50, 100, [10, 120, 230]);
  const im = compose(prod, canvas, place, { background: { type: 'image' }, bgImage: bgImg });
  assert.deepEqual(px(im, 0, 0), [10, 120, 230, 255]);
  // worker-op wrapper gives the same pixels
  assert.deepEqual(ecomComposeOp(prod, { canvas, place, background: { type: 'white' } }).data, out.data);
});

test('shadows: contact shadow sits on the floor under the product, drop shadow follows the angle', () => {
  const canvas = { W: 600, H: 600 }, place = placeProduct({ w: 200, h: 300 }, canvas, { margin: 10, align: 'bottom' }), prod = solid(place.w, place.h);
  const bottom = place.y + place.h;
  const c = compose(prod, canvas, place, { background: { type: 'white' }, shadow: { contact: true, contactOpacity: 60, contactBlur: 5 } });
  const under = px(c, 300, bottom + 2)[0], above = px(c, 300, place.y - 5)[0], side = px(c, place.x - 4, bottom)[0], farSide = px(c, 20, bottom)[0];
  assert.ok(under < 200, 'dark directly under the product: ' + under);
  assert.equal(above, 255, 'nothing above the product');
  assert.ok(side < 255 && side > under, 'fades towards the sides');
  assert.equal(farSide, 255, 'background stays pure white away from the shadow');
  assert.deepEqual(px(c, 2, 2), [255, 255, 255, 255]);
  // drop shadow at 0° falls to the right
  const d = compose(prod, canvas, place, { background: { type: 'white' }, shadow: { drop: true, dropOpacity: 50, dropBlur: 2, dropDistance: 10, dropAngle: 0 } });
  const right = px(d, place.x + place.w + 10, place.y + 150)[0], left = px(d, place.x - 10, place.y + 150)[0];
  assert.ok(right < 200 && left === 255, `right ${right} left ${left}`);
  const sp = shadowPlane(prod, place, canvas, { drop: true, dropOpacity: 50, dropBlur: 2, dropDistance: 10, dropAngle: 0 });
  let mx = 0; for (const v of sp.data) mx = Math.max(mx, v); assert.ok(mx <= 0.5 + 1e-6 && mx > 0.45, 'peak = opacity');
  assert.equal(shadowPlane(prod, place, canvas, {}), null, 'no shadow when both are off');
  // with shadows the checklist warns but the edges stay pure white
  const st = backgroundStats(c, place, prod);
  assert.equal(st.borderFraction, 1); assert.ok(st.whiteFraction < 1);
});

test('reflection: a fading mirror image below the product', () => {
  const canvas = { W: 300, H: 300 }, prod = solid(100, 100, [0, 0, 200]), place = { x: 100, y: 50, w: 100, h: 100 };
  const o = compose(prod, canvas, place, { background: { type: 'white' }, reflection: { enabled: true, opacity: 40, height: 50 } });
  const near = px(o, 150, 151), far = px(o, 150, 195), after = px(o, 150, 205);
  assert.ok(near[0] < 170 && near[2] > 230, 'tinted by the product near the floor ' + near);
  assert.ok(far[0] > near[0], 'fades with distance'); assert.deepEqual(after, [255, 255, 255, 255]);
});

test('blurPlane: preserves mass and approximates a Gaussian', () => {
  const w = 101, h = 101, p = new Float32Array(w * h); p[50 * w + 50] = 1;
  const b = blurPlane(p, w, h, 6, 2); let s = 0; for (const v of b) s += v;
  assert.ok(Math.abs(s - 1) < 1e-4); assert.ok(b[50 * w + 62] > b[62 * w + 50] * 5, 'anisotropic: wider horizontally');
});

test('presets: definitions and checklist rules', () => {
  for (const id of ['amazon', 'shopify', 'etsy', 'etsy-xl', 'ebay', 'instagram', 'instagram-portrait', 'mercadolibre', 'google', 'custom']) assert.ok(PRESET_BY_ID[id], id);
  assert.deepEqual([PRESET_BY_ID.amazon.w, PRESET_BY_ID.amazon.h], [2000, 2000]); assert.equal(PRESET_BY_ID.amazon.white, 'required');
  assert.deepEqual([PRESET_BY_ID.shopify.w, PRESET_BY_ID['etsy'].h, PRESET_BY_ID['etsy-xl'].w, PRESET_BY_ID.ebay.w, PRESET_BY_ID['instagram-portrait'].h, PRESET_BY_ID.mercadolibre.w], [2048, 1600, 3000, 1600, 1350, 1200]);
  const custom = resolvePreset('custom', { w: 640, h: 480 }); assert.equal(custom.w, 640); assert.equal(custom.name, 'Custom 640 × 480');
  const a = PRESET_BY_ID.amazon, stats = { whiteFraction: 1, borderFraction: 1 };
  const row = (info, id) => checkPreset(a, { w: 2000, h: 2000, stats, ...info }).find(r => r.id === id);
  assert.equal(row({ w: 900, h: 900 }, 'size').status, 'fail');
  assert.equal(row({ w: 1500, h: 1500 }, 'size').status, 'warn');
  assert.equal(row({ place: { x: 0, y: 0, w: 1000, h: 1000 } }, 'fill').status, 'warn');
  assert.equal(row({ place: { x: 0, y: 0, w: 1000, h: 1700 } }, 'fill').status, 'pass');
  assert.equal(row({ bytes: 11 * 1024 * 1024 }, 'bytes').status, 'fail');
  assert.equal(row({}, 'bytes').status, 'warn', 'unmeasured file size is not a pass');
  assert.equal(row({ upscale: 2.2 }, 'resolution').status, 'warn');
  assert.equal(checkPreset(a, { w: 2000, h: 2000, stats: { whiteFraction: 0.9, borderFraction: 1 } }).find(r => r.id === 'white').status, 'warn');
  assert.equal(checkPreset(PRESET_BY_ID.etsy, { w: 2000, h: 1600, bytes: 2 * 1024 * 1024 }).find(r => r.id === 'bytes').status, 'warn');
  assert.ok(PRESETS.length >= 10);
});

test('naming template and unique names', () => {
  assert.equal(formatName('{name}_{preset}_{n}', { name: 'Red Mug.final.JPG', preset: 'amazon', n: 3 }, 'jpg'), 'Red Mug.final_amazon_03.jpg');
  assert.equal(formatName('{name}-{w}x{h}', { name: 'a/b:c.png', preset: 'x', n: 1, w: 10, h: 20 }, 'png'), 'a-b-c-10x20.png');
  assert.deepEqual(uniqueNames(['a.jpg', 'A.jpg', 'a.jpg', 'b.jpg']), ['a.jpg', 'A (2).jpg', 'a (3).jpg', 'b.jpg']);
});

test('zip: store-only writer round trip, CRC-32 matches zlib, the system unzip accepts it', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const big = new Uint8Array(300000); for (let i = 0; i < big.length; i++) big[i] = (i * 7919) & 255;
  const files = [{ name: 'a.txt', data: new TextEncoder().encode('hello zip') }, { name: 'dir/über.bin', data: big }, { name: 'empty.dat', data: new Uint8Array(0) }];
  const zip = createZip(files);
  if (zlib.crc32) for (const f of files) assert.equal(crc32(f.data), zlib.crc32(f.data));
  const back = readZip(zip);
  assert.deepEqual(back.map(f => f.name), files.map(f => f.name));
  back.forEach((f, i) => assert.deepEqual(f.data, files[i].data));
  // independent check: parse local headers by hand
  const v = new DataView(zip.buffer); assert.equal(v.getUint32(0, true), 0x04034b50); assert.equal(v.getUint16(8, true), 0, 'stored');
  const dir = mkdtempSync(join(tmpdir(), 'eczip-')), p = join(dir, 't.zip'); writeFileSync(p, zip);
  let unzip = true; try { execFileSync('unzip', ['-v'], { stdio: 'ignore' }); } catch { unzip = false; }
  if (unzip) {
    const out = execFileSync('unzip', ['-t', p]).toString(); assert.match(out, /No errors detected/);
    assert.equal(execFileSync('unzip', ['-p', p, 'a.txt']).toString(), 'hello zip');
    assert.deepEqual(new Uint8Array(execFileSync('unzip', ['-p', p, 'dir/über.bin'], { maxBuffer: 1 << 24 })), big);
  }
  // corruption is detected
  const bad = zip.slice(); bad[40] ^= 0xff; assert.throws(() => readZip(bad), /CRC/);
});

// a synthetic product photo: a soft grey studio sweep with a rounded orange bottle-like product
function productPhoto(w = 480, h = 400) {
  const d = new Uint8ClampedArray(w * h * 4), gt = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, body = Math.abs(x - 240) < 70 && y > 120 && y < 340, cap = Math.abs(x - 240) < 30 && y > 70 && y <= 120, round = ((x - 240) / 70) ** 2 + ((y - 120) / 40) ** 2 < 1 && y > 100;
    const inP = body || cap || round, n = ((x * 13 + y * 7) % 7) - 3;
    const c = inP ? (cap ? [40 + n, 40 + n, 45] : [230 + n, 120 + n, 30]) : [205 - y / 12 + n, 205 - y / 12 + n, 212 - y / 12];
    d.set([...c, 255], i * 4); gt[i] = inP ? 1 : 0;
  }
  return { buf: { w, h, data: d }, gt };
}
const iou = (a, gt) => { let I = 0, U = 0; for (let i = 0; i < gt.length; i++) { const p = a[i] > 127 ? 1 : 0; I += p & gt[i]; U += p | gt[i]; } return I / U; };
const area = a => { let n = 0; for (const v of a) if (v > 127) n++; return n; };

test('matte: real U²-Netp alpha, guided refinement, edge shift, feather, touch-up, decontaminate', { skip: !existsSync(U2) && 'model not installed' }, async () => {
  const s = await ort.InferenceSession.create(readFileSync(U2)), { buf, gt } = productPhoto();
  const ai = encodeAlpha(await segment(ort, s, buf, 'subject'));
  const a = refineMatte(buf, ai, {});
  const score = iou(a, gt); assert.ok(score > 0.9, 'IoU ' + score.toFixed(3));
  assert.equal(a[0], 0, 'background corners are exactly 0'); assert.equal(a[200 * 480 + 240], 255);
  const grown = refineMatte(buf, ai, { edgeShift: 4 }), shrunk = refineMatte(buf, ai, { edgeShift: -4 });
  assert.ok(area(grown) > area(a) && area(shrunk) < area(a), 'edge shift grows / shrinks');
  const soft = refineMatte(buf, ai, { feather: 8 }); let semi = 0, semi0 = 0; for (let i = 0; i < a.length; i++) { if (soft[i] > 10 && soft[i] < 245) semi++; if (a[i] > 10 && a[i] < 245) semi0++; }
  assert.ok(semi > semi0 * 1.5, 'feather widens the soft edge');
  const erased = refineMatte(buf, ai, {}, [{ mode: 'erase', size: 0.1, hardness: 1, pts: [0.5, 0.6] }]);
  assert.equal(erased[240 + 240 * 480], 0, 'erase stroke removes the product under it');
  const restored = refineMatte(buf, ai, {}, [{ mode: 'restore', size: 0.05, hardness: 1, pts: [0.05, 0.05, 0.1, 0.05] }]);
  assert.equal(restored[20 * 480 + 30], 255, 'restore stroke brings pixels back');
  const b = productBounds(a, 480, 400); assert.ok(Math.abs(b.x - 170) <= 4 && Math.abs(b.x + b.w - 310) <= 4 && Math.abs(b.y - 70) <= 6 && Math.abs(b.y + b.h - 340) <= 4, JSON.stringify(b));
  // decontaminate: edge pixels take the product's colour instead of the grey backdrop
  const plain = cutout(buf, a, { decontaminate: false }), clean = cutout(buf, a, { decontaminate: true, decontaminateAmount: 100 });
  let dPlain = 0, dClean = 0, n = 0;
  for (let y = 160; y < 320; y++) for (const x of [160, 161, 162, 163, 164, 165, 166, 167, 168, 169, 170, 171, 172, 173, 174, 175, 305, 306, 307, 308, 309, 310, 311, 312, 313, 314, 315, 316, 317, 318, 319, 320]) {
    const i = y * 480 + x; if (a[i] < 15 || a[i] > 240) continue; n++;
    const dist = d => Math.hypot(d[i * 4] - 230, d[i * 4 + 1] - 120, d[i * 4 + 2] - 30); dPlain += dist(plain.data); dClean += dist(clean.data);
  }
  assert.ok(n > 0 && dClean < dPlain * 0.7, `edge colours decontaminated (${n} px, ${(dPlain / n).toFixed(1)} → ${(dClean / n).toFixed(1)})`);
  // worker-op wrapper
  const op = ecomCutoutOp(buf, { ai, matte: {}, strokes: [] }); assert.equal(op.data[(200 * 480 + 240) * 4 + 3], 255); assert.equal(op.data[3], 0);
});

test('full product pipeline: matte → crop → resize → white 2000² keeps exact white corners', { skip: !existsSync(U2) && 'model not installed' }, async () => {
  const s = await ort.InferenceSession.create(readFileSync(U2)), { buf } = productPhoto();
  const ai = encodeAlpha(await segment(ort, s, buf, 'subject')), cut = ecomCutoutOp(buf, { ai, matte: {} });
  const al = new Uint8Array(buf.w * buf.h); for (let i = 0; i < al.length; i++) al[i] = cut.data[i * 4 + 3];
  const b = productBounds(al, buf.w, buf.h), crop = cropBuffer(cut, b), canvas = { W: 2000, H: 2000 };
  const place = placeProduct(b, canvas, { margin: 7.5 }), prod = resample(crop, place.w, place.h);
  const out = compose(prod, canvas, place, { background: { type: 'white' } });
  for (const [x, y] of [[0, 0], [1999, 0], [0, 1999], [1999, 1999]]) assert.deepEqual(px(out, x, y), [255, 255, 255, 255]);
  const rows = checkPreset(PRESET_BY_ID.amazon, { w: 2000, h: 2000, place, stats: backgroundStats(out, place, prod), bytes: 400000, format: 'jpeg' });
  assert.ok(rows.every(r => r.status === 'pass'), JSON.stringify(rows.filter(r => r.status !== 'pass')));
});

test('retouch: auto white balance neutralises a cast through develop()', () => {
  const b = makeBuf(64, 64); for (let i = 0; i < 64 * 64; i++) { const v = 90 + (i % 64) * 2; b.data.set([v * 0.8, v * 0.9, Math.min(255, v * 1.15), 255], i * 4); }
  assert.equal(retouchSettings(b, {}), null); assert.ok(isRetouchIdentity({}));
  const st = retouchSettings(b, { autoWB: true }); assert.ok(st.temp > 0, 'blue cast → warmer');
  const orig = new Uint8ClampedArray(b.data), out = develop({ ...b, data: new Uint8ClampedArray(b.data) }, st), m = d => { let r = 0, bl = 0; for (let i = 0; i < d.length; i += 4) { r += d[i]; bl += d[i + 2]; } return bl / r; };
  assert.ok(Math.abs(m(out.data) - 1) < Math.abs(m(orig) - 1) / 2, 'blue/red ratio moves towards 1');
  const st2 = retouchSettings(b, { brightness: 50, contrast: 20, saturation: -30, sharpen: 40 });
  assert.deepEqual([st2.exposure, st2.contrast, st2.saturation, st2.sharpenAmount], [0.5, 20, -30, 60]);
  const bright = develop({ ...b, data: new Uint8ClampedArray(orig) }, retouchSettings(b, { brightness: 50 })); assert.ok(bright.data[4 * 100] > orig[4 * 100]);
});

test('touch-up strokes paint a soft round brush', () => {
  const a = new Float32Array(100 * 100);
  applyStrokes(a, 100, 100, [{ mode: 'restore', size: 0.2, hardness: 0.5, pts: [0.5, 0.5] }]);
  assert.equal(a[50 * 100 + 50], 1); assert.equal(a[50 * 100 + 70], 0); assert.ok(a[50 * 100 + 58] > 0 && a[50 * 100 + 58] < 1);
  applyStrokes(a, 100, 100, [{ mode: 'erase', size: 0.04, hardness: 1, pts: [0.5, 0.5] }]); assert.equal(a[50 * 100 + 50], 0);
});

test('templates: 6+ layouts inside their canvas; drawn with the product in its slot', () => {
  assert.ok(TEMPLATES.length >= 6);
  const sizes = Object.fromEntries(TEMPLATES.map(t => [t.id, [t.w, t.h]]));
  assert.deepEqual(sizes['sale-banner'], [1200, 628]); assert.deepEqual(sizes['instagram-post'], [1080, 1080]); assert.deepEqual(sizes.story, [1080, 1920]);
  const prod = createCanvas(100, 200), pc = prod.getContext('2d'); pc.fillStyle = '#00c040'; pc.fillRect(0, 0, 100, 200);
  for (const t of TEMPLATES) {
    const els = layoutTemplate(t, {});
    const slot = els.find(e => e.kind === 'product'); assert.ok(slot, t.id + ' has a product slot');
    for (const e of els) if (e.w) assert.ok(e.x >= 0 && e.y >= 0 && e.x + e.w <= t.w + 0.5 && e.y + e.h <= t.h + 0.5, t.id + ' ' + e.kind);
    const c = createCanvas(t.w, t.h), ctx = c.getContext('2d');
    drawTemplate(ctx, t, { headline: 'Big Spring Sale Event Today', price: '$19.99' }, prod);
    const r = fitInSlot(100, 200, slot), d = ctx.getImageData(Math.round(r.x + r.w / 2), Math.round(r.y + r.h / 2), 1, 1).data;
    assert.ok(d[1] > 150 && d[0] < 60, t.id + ' product drawn ' + [...d]);
    // the headline region contains drawn text (pixels differing from the background)
    const head = els.find(e => e.kind === 'text'); const hd = ctx.getImageData(Math.max(0, Math.round(head.align === 'center' ? head.x - head.maxW / 2 : head.align === 'right' ? head.x - head.maxW : head.x)), Math.round(head.y), Math.round(head.maxW), Math.round(head.size)).data;
    const colors = new Set(); for (let i = 0; i < hd.length; i += 4) colors.add(hd[i] << 16 | hd[i + 1] << 8 | hd[i + 2]);
    assert.ok(colors.size > 4, t.id + ' headline rendered');
  }
  const empty = layoutTemplate(TEMPLATES[0], { cta: '  ' }); assert.ok(!empty.some(e => e.kind === 'pill'), 'empty text elements are dropped');
});

test('project store: memory fallback round trip and normalisation', async () => {
  const st = memoryProjectStore(), p = newProject('Shoes'); p.items.push(newItem('a.jpg', 'sha256-x', 10, 20));
  await st.put(p); const list = await st.list(); assert.equal(list[0].name, 'Shoes'); assert.equal(list[0].count, 1);
  const back = await st.get(p.id); assert.equal(back.items[0].assetId, 'sha256-x'); assert.equal(back.settings.presetId, 'amazon');
  const legacy = normalizeProject({ id: 'p', name: 'x', items: [{ id: 'i', name: 'n', assetId: 'a', status: 'working' }], settings: { shadow: { contact: true } } });
  assert.equal(legacy.items[0].status, 'imported'); assert.equal(legacy.settings.shadow.contact, true); assert.equal(legacy.settings.shadow.dropAngle, 90); assert.equal(legacy.items[0].matte.contrast, 50);
  await st.delete(p.id); assert.equal((await st.list()).length, 0);
});

test('project store: asset ids referenced by all projects (for AssetStore.collect)', async () => {
  const { ecomAssetIds } = await import('../src/ecom/projectStore.js');
  const st = memoryProjectStore(), a = newProject('A'), b = newProject('B');
  a.items.push(newItem('x.jpg', 'sha256-1', 1, 1)); b.items.push(newItem('y.jpg', 'sha256-2', 1, 1)); b.settings.background.imageId = 'sha256-3';
  await st.put(a); await st.put(b);
  assert.deepEqual((await ecomAssetIds(st)).sort(), ['sha256-1', 'sha256-2', 'sha256-3']);
});
