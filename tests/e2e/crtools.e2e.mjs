// Browser acceptance tests: the Lightroom-Mobile tools in the Camera Raw Filter and Library ·
// Develop — Point Color, Remove, Geometry (Upright), Presets (with Amount), Versions, Crop &
// Straighten. Real pointer / keyboard input; judged on the preview canvas, the panel values and
// the layer after OK. Run: npm run build && node tests/e2e/crtools.e2e.mjs
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { serve } from './serve.mjs';
import { rgbToHsl } from '../../src/engine/color.js';
import { cropSettingsToRect, applyAspectToCrop, fitCropToAngle, CROP_DEFAULTS } from '../../src/engine/develop2.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const evidence = join(fileURLToPath(new URL('.', import.meta.url)), '../../docs/evidence');
mkdirSync(evidence, { recursive: true });
const server = await serve(0);
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true })).newPage();
const errors = []; page.on('pageerror', e => { if (!errors.length) console.log('PAGE ERROR', (e.stack || e.message).split('\n').slice(0, 4).join('\n')); errors.push(e.message); });
const results = [];
let setupFailed = false;
const step = async (name, fn) => { if (setupFailed && name !== 'no uncaught page errors') { results.push({ name, ok: false, error: 'skipped' }); console.log('SKIP ' + name); return; } try { await fn(); results.push({ name, ok: true }); console.log('ok   ' + name); } catch (e) { results.push({ name, ok: false, error: e.message }); console.log('FAIL ' + name + '\n     ' + e.message.split('\n').slice(0, 3).join(' | ')); if (name.startsWith('setup')) setupFailed = true; } };
const APP = 'div.app[style*="display: flex"]';
const app = () => page.locator(APP);
const settle = () => page.waitForTimeout(150).then(() => page.waitForFunction(sel => { const a = document.querySelector(sel); return a && a.dataset.work === '0' && !document.querySelector('.opDialog') && a.querySelector('.saveStatus')?.textContent.includes('Saved locally'); }, APP, { timeout: 30000 })).then(() => page.waitForTimeout(200));

// ---- synthetic photo (1200 × 800): sky over ground with a horizon tilted by 4°, a black dust dot
// in the sky, a red and a green disc on the ground (round, so they add no straight lines)
const W = 1200, H = 800, TILT = 4 * Math.PI / 180;
const horizonY = x => H * 0.45 + (x - W / 2) * Math.tan(TILT);
const scene = createCanvas(W, H); {
  const x = scene.getContext('2d'), im = x.createImageData(W, H);
  for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++) {
    const i = (yy * W + xx) * 4; let c;
    if (Math.hypot(xx - 0.3 * W, yy - 0.2 * H) < 10) c = [10, 10, 10];
    else if (Math.hypot(xx - 0.62 * W, yy - 0.77 * H) < 60) c = [220, 40, 40];
    else if (Math.hypot(xx - 0.82 * W, yy - 0.77 * H) < 60) c = [40, 180, 60];
    else if (yy < horizonY(xx)) c = [140 + 30 * yy / H, 185, 235];
    else c = [120, 105, 80];
    im.data[i] = c[0]; im.data[i + 1] = c[1]; im.data[i + 2] = c[2]; im.data[i + 3] = 255;
  }
  x.putImageData(im, 0, 0);
}
const png = { name: 'tilted.png', mimeType: 'image/png', buffer: scene.toBuffer('image/png') };

const crs = () => page.getByRole('dialog', { name: 'Camera Raw Filter' });
const canvasSel = '.cameraRaw canvas[aria-label="Camera Raw preview"]';
const ready = async () => { await page.waitForTimeout(350); await page.waitForFunction(() => (document.querySelector('.cameraRaw .crsStatus')?.textContent || '').includes('ready'), null, { timeout: 60000 }); await page.waitForTimeout(200); };
const openCrs = async () => { await app().getByRole('button', { name: 'Filter', exact: true }).click(); await page.getByRole('menuitem', { name: 'Camera Raw Filter…', exact: true }).click(); await crs().waitFor(); await page.waitForFunction(sel => { const c = document.querySelector(sel); return c && c.width > 1 && c.getContext('2d').getImageData(c.width >> 1, c.height >> 1, 1, 1).data[3] === 255; }, canvasSel, { timeout: 30000 }); await ready(); };
const prev = (nx, ny, sel = canvasSel, r = 2) => page.evaluate(([sel, nx, ny, r]) => { const c = document.querySelector(sel), x = c.getContext('2d', { willReadFrequently: true }), px = Math.round(nx * c.width), py = Math.round(ny * c.height), d = x.getImageData(px - r, py - r, 2 * r + 1, 2 * r + 1).data, s = [0, 0, 0]; for (let i = 0; i < d.length; i += 4) { s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2]; } return s.map(v => v / (d.length / 4)); }, [sel, nx, ny, r]);
const canvasSize = (sel = canvasSel) => page.evaluate(sel => { const c = document.querySelector(sel); return [c.width, c.height]; }, sel);
/** y (fraction) of the sky → ground edge in column nx of the preview */
const horizonAt = nx => page.evaluate(([sel, nx]) => { const c = document.querySelector(sel), x = c.getContext('2d', { willReadFrequently: true }), px = Math.round(nx * c.width), d = x.getImageData(px, 0, 1, c.height).data; for (let y = Math.round(c.height * 0.25); y < c.height * 0.75; y++) if (d[y * 4 + 2] < 160 && d[y * 4 + 3] > 200) return y / c.height; return -1; }, [canvasSel, nx]);
const click = async (nx, ny, sel = canvasSel) => { const b = await page.locator(sel).boundingBox(); await page.mouse.click(b.x + nx * b.width, b.y + ny * b.height); };
const setVal = async (scope, label, v) => { const i = scope.getByLabel(label + ' value', { exact: true }); await i.fill(String(v)); await i.press('Enter'); };
const tool = name => crs().getByRole('button', { name: name + ' tool', exact: true }).click();
const hue = c => rgbToHsl(...c)[0];
async function exportPx(name) {
  await app().locator('button.export').click();
  const [dl] = await Promise.all([page.waitForEvent('download'), app().getByRole('button', { name: /Download PNG/ }).click()]); await page.waitForFunction(() => !document.querySelector('.modalBackdrop'));
  const buf = readFileSync(await dl.path()); if (name) writeFileSync(join(evidence, name), buf);
  const img = await loadImage(buf), c = createCanvas(img.width, img.height), ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, img.width, img.height).data;
  return { w: img.width, h: img.height, at: (x, y) => [...d.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)] };
}

await page.goto('http://127.0.0.1:' + server.address().port + '/');
await page.waitForSelector(APP);
const dvw = page.getByRole('dialog', { name: 'Library and Develop' });

await step('setup: open a 1200 × 800 photo with a tilted horizon as a document', async () => {
  await app().getByRole('button', { name: 'Library · Develop' }).click(); await dvw.waitFor();
  await dvw.getByLabel('Import photo files').setInputFiles(png);
  const cell = dvw.locator('.dvwCell').first(); await cell.waitFor(); await cell.click(); await page.keyboard.press('d');
  await page.waitForFunction(() => document.querySelector('.dvw .crsStatus')?.textContent.includes('ready'), null, { timeout: 30000 });
  const tabs = await app().locator('.docTab').count();
  await dvw.getByRole('button', { name: 'Edit in Zertake' }).click();
  await page.waitForFunction(([sel, n]) => document.querySelectorAll(sel + ' .docTab').length === n, [APP, tabs + 1], { timeout: 30000 }); await settle();
  await app().locator('.layerList .layer').first().click({ position: { x: 10, y: 10 } }); await settle();
  const e = await exportPx(); assert.deepEqual([e.w, e.h], [W, H]);
});

await step('Point Color: eyedropper on the red patch, Hue +100 moves red only', async () => {
  await openCrs();
  const r0 = await prev(0.62, 0.77), g0 = await prev(0.82, 0.77), s0 = await prev(0.4, 0.6);
  await crs().getByRole('button', { name: 'Point color eyedropper' }).click(); await ready();
  await click(0.62, 0.77); await ready();
  assert.equal(await crs().getByRole('button', { name: 'Point color swatch 1' }).count(), 1, 'swatch sampled');
  await setVal(crs(), 'Point hue shift', 100); await ready();
  const r1 = await prev(0.62, 0.77), g1 = await prev(0.82, 0.77), s1 = await prev(0.4, 0.6);
  assert.ok(hue(r1) - hue(r0) > 15, `red hue moved ${hue(r0)} → ${hue(r1)}`);
  assert.ok(Math.abs(hue(g1) - hue(g0)) < 2 && Math.abs(s1[2] - s0[2]) < 3, 'green patch and ground unchanged');
});

await step('Remove: a stroke over the dust dot removes it (auto source)', async () => {
  await tool('Remove'); await ready();
  const d0 = await prev(0.3, 0.2, canvasSel, 1), ref = await prev(0.3, 0.26);
  assert.ok(d0[0] < 60, 'dot visible in the Remove view ' + d0);
  await crs().getByRole('button', { name: 'Heal mode', exact: true }).click();
  await setVal(crs(), 'Brush size', 4);
  await click(0.3, 0.2); await ready();
  assert.equal(await crs().getByRole('button', { name: 'Delete spot 1' }).count(), 1, 'spot listed');
  const d1 = await prev(0.3, 0.2, canvasSel, 1);
  assert.ok(Math.abs(d1[0] - ref[0]) < 18 && Math.abs(d1[2] - ref[2]) < 18, `dot healed: ${d0} → ${d1} (sky ${ref})`);
});

await step('Geometry: Upright Level straightens the tilted horizon', async () => {
  await tool('Geometry'); await ready();
  const a0 = await horizonAt(0.2), b0 = await horizonAt(0.8);
  assert.ok(b0 - a0 > 0.05, `tilted before: ${a0} … ${b0}`);
  await crs().getByRole('button', { name: 'Upright Level', exact: true }).click(); await ready();
  const a1 = await horizonAt(0.2), b1 = await horizonAt(0.8);
  assert.ok(a1 > 0 && Math.abs(b1 - a1) < 0.012, `level after Upright: ${a1} … ${b1}`);
  await crs().getByRole('button', { name: 'Upright Off', exact: true }).click(); await ready();
});

await step('Presets: Clean Pop applies; Amount scales it; Save Preset adds a user preset', async () => {
  await tool('Presets');
  await crs().getByRole('button', { name: 'Apply preset Clean Pop' }).click(); await ready();
  await setVal(crs(), 'Preset amount', 200); await page.waitForTimeout(100);
  await tool('Edit');
  assert.equal(await crs().getByLabel('Contrast value', { exact: true }).inputValue(), '28', 'contrast 14 × 200 %');
  await tool('Presets');
  await crs().getByRole('button', { name: 'Apply preset Clean Pop' }).click(); await setVal(crs(), 'Preset amount', 50);
  await tool('Edit');
  assert.equal(await crs().getByLabel('Contrast value', { exact: true }).inputValue(), '21', 'presets set absolute values: from 28 halfway to 14');
  await tool('Presets');
  await crs().getByRole('button', { name: 'Save Preset…' }).click();
  await crs().getByLabel('Preset name', { exact: true }).fill('My Look');
  await crs().getByRole('button', { name: 'Save', exact: true }).click();
  assert.equal(await crs().getByRole('button', { name: 'Apply preset My Look' }).count(), 1);
  assert.match(await page.evaluate(() => localStorage.getItem('zertake.crPresets')), /My Look/);
});

await step('Versions: create, change, restore, rename; stored with the layer', async () => {
  await tool('Versions');
  await crs().getByLabel('Version name', { exact: true }).fill('V1'); await crs().getByRole('button', { name: 'Create Version' }).click();
  await tool('Edit'); await setVal(crs(), 'Exposure', 2); await ready();
  await tool('Versions'); await crs().getByRole('button', { name: 'Apply version V1' }).click(); await ready();
  await tool('Edit'); assert.equal(await crs().getByLabel('Exposure value', { exact: true }).inputValue(), '0.00', 'exposure restored');
  await tool('Versions'); await crs().getByRole('button', { name: 'Rename version V1' }).click();
  const r = crs().getByLabel('Rename version', { exact: true }); await r.fill('Base'); await r.press('Enter');
  assert.equal(await crs().getByRole('button', { name: 'Apply version Base' }).count(), 1);
  await crs().getByRole('button', { name: 'OK', exact: true }).click(); await settle(); await page.waitForTimeout(300);
  await openCrs(); await tool('Versions');
  assert.equal(await crs().getByRole('button', { name: 'Apply version Base' }).count(), 1, 'versions reopen with the layer');
  await tool('Remove'); assert.equal(await crs().getByRole('button', { name: 'Delete spot 1' }).count(), 1, 'spot kept');
});

let expect = null;
await step('Crop: 1 : 1 + straighten 3° — the preview is square; OK makes the layer that square', async () => {
  await tool('Crop'); await ready();
  await crs().getByLabel('Aspect ratio', { exact: true }).selectOption('1:1');
  await setVal(crs(), 'Straighten', 3); await ready();
  assert.equal(await crs().getByRole('group', { name: 'Crop overlay' }).count(), 1, 'crop overlay over the preview');
  if (process.env.CR_SHOT) await page.screenshot({ path: process.env.CR_SHOT });
  const note = await crs().locator('.d2CropPanel .d2Note').innerText(), m = /(\d+) × (\d+)/.exec(note);
  assert.ok(m && m[1] === m[2], 'square crop ' + note);
  // the expected full-resolution size from the engine maths (the panel shows full-resolution pixels)
  const c = fitCropToAngle(applyAspectToCrop({ ...CROP_DEFAULTS, aspect: '1:1', angle: 3 }, 1, W, H), W, H), r = cropSettingsToRect(c, W, H);
  expect = r.outW; assert.ok(Math.abs(+m[1] - expect) <= 2, `engine ${r.outW} vs panel ${m[1]}`);
  await tool('Edit'); await ready();
  const [cw, ch] = await canvasSize(); assert.ok(Math.abs(cw - ch) <= 1, `cropped preview is square: ${cw} × ${ch}`);
  await crs().getByRole('button', { name: 'OK', exact: true }).click(); await settle(); await page.waitForTimeout(400);
  await app().locator('.layerList .layer').first().click({ position: { x: 10, y: 10 } }); await settle();
  // the layer's footprint in the exported document: everything that differs from the empty corner
  const e = await exportPx('crtools-crop.png'), bg = e.at(W - 1, H - 1); let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) { const p = e.at(x, y); if (Math.abs(p[0] - bg[0]) + Math.abs(p[1] - bg[1]) + Math.abs(p[2] - bg[2]) + Math.abs(p[3] - bg[3]) > 12) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
  const lw = x1 - x0 + 1, lh = y1 - y0 + 1;
  assert.ok(Math.abs(lw - expect) <= 2 && Math.abs(lh - expect) <= 2, `layer is ${lw} × ${lh}, expected ${expect} × ${expect} (needs the main.jsx layer-resize change)`);
});

await step('Library · Develop: tool rail; Crop 1 : 1 makes the preview square; Versions = snapshots', async () => {
  await app().getByRole('button', { name: 'Library · Develop' }).click(); await dvw.waitFor();
  const cell = dvw.locator('.dvwCell').first(); await cell.waitFor(); await cell.click(); await page.keyboard.press('d');
  const cv = '.dvw canvas[aria-label="Develop preview"]';
  const ok = () => page.waitForTimeout(400).then(() => page.waitForFunction(() => document.querySelector('.dvw .crsStatus')?.textContent.includes('ready'), null, { timeout: 30000 })).then(() => page.waitForTimeout(300));
  await ok();
  await dvw.getByRole('button', { name: 'Crop tool', exact: true }).click(); await ok();
  await dvw.getByLabel('Aspect ratio', { exact: true }).selectOption('1:1'); await ok();
  await dvw.getByRole('button', { name: 'Edit tool', exact: true }).click(); await ok();
  const [cw, ch] = await canvasSize(cv); assert.ok(Math.abs(cw - ch) <= 1, `square develop preview ${cw} × ${ch}`);
  await dvw.getByRole('button', { name: 'Versions tool', exact: true }).click();
  await dvw.getByLabel('Version name', { exact: true }).fill('Square'); await dvw.getByRole('button', { name: 'Create Version' }).click(); await page.waitForTimeout(300);
  assert.equal(await dvw.getByRole('button', { name: 'Apply version Square' }).count(), 1);
  assert.match(await dvw.locator('.dvwLeft').innerText(), /Square/, 'the version is a catalog snapshot');
  await dvw.getByRole('button', { name: 'Close Library and Develop' }).click();
});

await step('no uncaught page errors', async () => assert.deepEqual(errors, []));
await browser.close(); server.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
