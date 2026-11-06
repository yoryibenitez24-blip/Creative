// Browser acceptance tests: Smart Objects and Smart Filters (convert, non-destructive scaling,
// editable/toggleable/deletable smart filters, Place Embedded, Replace Contents, rasterize).
// Real input only; judged on exported PNGs.
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { serve } from './serve.mjs';
import { readPsd, initializeCanvas } from 'ag-psd';
import { ImageData as NImageData } from '@napi-rs/canvas';
initializeCanvas(createCanvas, undefined, (w, h) => new NImageData(w, h));

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const evidence = join(fileURLToPath(new URL('.', import.meta.url)), '../../docs/evidence');
mkdirSync(evidence, { recursive: true });
const server = await serve(0);
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true })).newPage();
const errors = []; page.on('pageerror', e => { if (!errors.length) console.log('PAGE ERROR', (e.stack || e.message).split('\n').slice(0, 4).join('\n')); errors.push(e.message); });
const results = [];
const step = async (name, fn) => { try { await fn(); results.push({ name, ok: true }); console.log('ok   ' + name); } catch (e) { results.push({ name, ok: false, error: e.message }); console.log('FAIL ' + name + '\n     ' + e.message.split('\n')[0]); } };
const APP = 'div.app[style*="display: flex"]';
const app = () => page.locator(APP);
const W = 300, H = 200, BG = [244, 241, 234];
const mapping = () => page.evaluate(sel => { const m = document.querySelector(sel + ' .artboardContainer svg').getScreenCTM(); return { a: m.a, d: m.d, e: m.e, f: m.f }; }, APP);
const scr = async (x, y) => { const m = await mapping(); return { x: m.a * x + m.e, y: m.d * y + m.f }; };
async function drag(points) { const m = await mapping(); const s = points.map(([x, y]) => ({ x: m.a * x + m.e, y: m.d * y + m.f })); await page.mouse.move(s[0].x, s[0].y); await page.mouse.down(); for (const p of s.slice(1)) await page.mouse.move(p.x, p.y, { steps: 6 }); await page.mouse.up(); }
const settle = () => page.waitForTimeout(150).then(() => page.waitForFunction(sel => { const a = document.querySelector(sel); return a && a.dataset.work === '0' && !document.querySelector('.opDialog') && a.querySelector('.saveStatus')?.textContent.includes('Saved locally'); }, APP, { timeout: 20000 })).then(() => page.waitForTimeout(200));
const setNum = async (label, v) => { const i = page.getByLabel(label, { exact: true }); await i.fill(String(v)); await i.blur(); };
async function exportPx(name) {
  await app().locator('button.export').click();
  const [dl] = await Promise.all([page.waitForEvent('download'), app().getByRole('button', { name: /Download PNG/ }).click()]); await page.waitForFunction(() => !document.querySelector('.modalBackdrop'));
  const png = readFileSync(await dl.path()); if (name) writeFileSync(join(evidence, name), png);
  const img = await loadImage(png); const c = createCanvas(img.width, img.height); const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, img.width, img.height).data;
  return { w: img.width, h: img.height, at: (x, y) => [...d.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 3)], d };
}
const near = (a, b, tol, what) => assert.ok(a.every((v, i) => Math.abs(v - b[i]) <= tol), `${what}: ${a} vs ${b}`);
const rowOf = name => app().locator('.layerList .layer').filter({ has: page.locator(`input[value="${name}"]`) });
const menuItem = name => page.getByRole('menuitem', { name, exact: true });


const menu = async (top, ...path) => { await app().getByRole('button', { name: top, exact: true }).click(); for (const p of path.slice(0, -1)) await app().getByRole('menuitem', { name: p, exact: true }).hover(); await app().getByRole('menuitem', { name: path.at(-1), exact: true }).click(); };
const pngFile = (w, h, paint) => { const c = createCanvas(w, h); const x = c.getContext('2d'); paint(x); return { name: 'placed.png', mimeType: 'image/png', buffer: c.toBuffer('image/png') }; };

await page.goto('http://127.0.0.1:' + server.address().port + '/#design');
await page.waitForSelector(APP);

await step('convert a paint layer to a Smart Object from the right-click menu', async () => {
  await app().getByTitle('New design').click(); await app().getByLabel('New width').fill(String(W)); await app().getByLabel('New height').fill(String(H));
  await app().getByRole('button', { name: /Create design/ }).click();
  await page.waitForFunction(sel => document.querySelector(sel + ' .artboardLabel')?.textContent.includes('300 × 200'), APP);
  await app().locator('.leftFooter').getByTitle('Create a new layer').click(); await settle();
  await app().getByTitle('Marquee (M)', { exact: true }).click(); await drag([[100, 60], [150, 100], [200, 140]]);
  await page.keyboard.press('Alt+Backspace'); await settle(); await page.keyboard.press('Control+d'); await settle();
  await rowOf('Paint layer 1').click({ button: 'right', position: { x: 10, y: 10 } });
  await menuItem('Convert to Smart Object').click(); await settle();
  assert.equal(await rowOf('Paint layer 1').getByLabel('Smart Object').count(), 1);
  const e = await exportPx(); near(e.at(150, 100), [0, 0, 0], 0, 'contents'); near(e.at(50, 100), BG, 0, 'outside');
});

await step('Image › Adjustments › Invert on a Smart Object becomes a toggleable smart filter', async () => {
  await menu('Image', 'Adjustments', 'Invert'); await settle();
  await app().getByRole('group', { name: 'Smart filters of Paint layer 1' }).waitFor();
  let e = await exportPx(); near(e.at(150, 100), [255, 255, 255], 0, 'inverted');
  await app().getByRole('button', { name: 'Disable Invert' }).click(); await settle();
  e = await exportPx(); near(e.at(150, 100), [0, 0, 0], 0, 'filter off shows the original');
  await app().getByRole('button', { name: 'Enable Invert' }).click(); await settle();
  e = await exportPx(); near(e.at(150, 100), [255, 255, 255], 0, 'filter back on');
  await app().getByRole('button', { name: 'Delete Invert' }).click(); await settle();
  near((await exportPx()).at(150, 100), [0, 0, 0], 0, 'deleting the filter restores the original');
});

await step('Gaussian Blur smart filter is editable after the fact (double-click) and deletable', async () => {
  await menu('Filter', 'Blur', 'Gaussian Blur…');
  await setNum('Radius value', 2); await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'OK', exact: true }).click(); await settle();
  const edge = async () => (await exportPx()).at(92, 100)[0];
  const soft2 = await edge();
  await app().getByRole('button', { name: 'Edit Gaussian Blur' }).click();
  await page.locator('.opDialog').waitFor(); assert.equal(await page.getByLabel('Radius value', { exact: true }).inputValue(), '2', 'dialog reopens with the saved radius');
  await setNum('Radius value', 12); await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'OK', exact: true }).click(); await settle(); await page.waitForTimeout(300); await settle();
  const e12 = await exportPx('smart-filter-edit.png');
  assert.ok(soft2 > BG[0] - 6, '2 px blur barely reaches 8 px outside: ' + soft2);
  assert.ok(e12.at(92, 100)[0] < BG[0] - 30, `a 12 px blur spreads past the original bounds: ${e12.at(92, 100)}`);
  await app().getByRole('button', { name: 'Delete Gaussian Blur' }).click(); await settle();
  const e = await exportPx(); near(e.at(92, 100), BG, 0, 'blur removed'); near(e.at(150, 100), [0, 0, 0], 0, 'original pixels untouched');
  assert.equal(await app().getByRole('group', { name: 'Smart filters of Paint layer 1' }).count(), 0);
});

await step('scaling a Smart Object down and back up is lossless', async () => {
  await rowOf('Paint layer 1').click({ position: { x: 10, y: 10 } });
  const before = await exportPx();
  const wField = app().getByLabel('Width', { exact: true });
  const hField = app().getByLabel('Height', { exact: true });
  await wField.fill('10'); await hField.fill('8'); await settle();
  const small = await exportPx(); near(small.at(150, 100), BG, 0, 'shrunk');
  await wField.fill('100'); await hField.fill('80'); await settle();
  const after = await exportPx('smart-rescaled.png');
  let diff = 0; for (let i = 0; i < after.d.length; i++) diff = Math.max(diff, Math.abs(after.d[i] - before.d[i]));
  assert.ok(diff <= 8, 'max channel difference after round trip ' + diff);
});

await step('File › Place Embedded adds a Smart Object; Replace Contents swaps it', async () => {
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), menu('File', 'Place Embedded…')]);
  await fc.setFiles(pngFile(60, 40, x => { x.fillStyle = '#ff0000'; x.fillRect(0, 0, 60, 40); })); await settle();
  assert.equal(await rowOf('placed').getByLabel('Smart Object').count(), 1);
  near((await exportPx()).at(150, 100), [255, 0, 0], 0, 'placed image centred');
  const [fc2] = await Promise.all([page.waitForEvent('filechooser'), menu('Layer', 'Smart Objects', 'Replace Contents…')]);
  await fc2.setFiles(pngFile(60, 40, x => { x.fillStyle = '#0000ff'; x.fillRect(0, 0, 60, 40); })); await settle();
  near((await exportPx()).at(150, 100), [0, 0, 255], 0, 'replaced contents');
});

await step('Rasterize turns the Smart Object into a paint layer with the same pixels; undo restores it', async () => {
  const before = await exportPx();
  await menu('Layer', 'Smart Objects', 'Rasterize'); await settle();
  assert.equal(await rowOf('placed').getByLabel('Smart Object').count(), 0);
  near((await exportPx()).at(150, 100), before.at(150, 100), 0, 'same pixels');
  await page.keyboard.press('Control+z'); await settle();
  assert.equal(await rowOf('placed').getByLabel('Smart Object').count(), 1);
});

await browser.close(); server.close();
const failed = results.filter(r => !r.ok);
if (errors.length) console.log('page errors:', errors);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length || errors.length ? 1 : 0);
