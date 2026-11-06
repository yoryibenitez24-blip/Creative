// Browser acceptance tests: Pen tool, Paths panel, path → selection, fill/stroke path,
// shape layers from paths and vector masks.
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



const click = async (x, y, mods) => { const p = await scr(x, y); if (mods) await page.keyboard.down(mods); await page.mouse.click(p.x, p.y); if (mods) await page.keyboard.up(mods); };
await page.goto('http://127.0.0.1:' + server.address().port + '/#design');
await page.waitForSelector(APP);

await step('Pen tool: clicking four corners and the first point closes a work path', async () => {
  await app().getByTitle('New design').click(); await app().getByLabel('New width').fill(String(W)); await app().getByLabel('New height').fill(String(H));
  await app().getByRole('button', { name: /Create design/ }).click();
  await page.waitForFunction(sel => document.querySelector(sel + ' .artboardLabel')?.textContent.includes('300 × 200'), APP);
  await page.keyboard.press('p');
  for (const [x, y] of [[100, 50], [200, 50], [200, 150], [100, 150], [100, 50]]) { await click(x, y); await page.waitForTimeout(60); }
  await settle();
  await app().getByRole('button', { name: 'Paths', exact: true }).click();
  assert.equal(await app().getByRole('listbox', { name: 'Paths' }).getByRole('option').count(), 1, 'Work Path listed');
});

await step('Make: Selection loads the path as a selection; filling it paints exactly the square', async () => {
  await app().getByRole('toolbar', { name: 'Pen options' }).getByRole('button', { name: 'Selection', exact: true }).click(); await settle();
  await app().getByRole('button', { name: 'Layers', exact: true }).click();
  await app().locator('.leftFooter').getByTitle('Create a new layer').click(); await settle();
  await page.keyboard.press('Alt+Backspace'); await settle(); await page.keyboard.press('Control+d'); await settle();
  const e = await exportPx('paths-selection-fill.png');
  near(e.at(150, 100), [0, 0, 0], 0, 'inside'); near(e.at(90, 100), BG, 0, 'left of the path'); near(e.at(150, 160), BG, 0, 'below the path');
});

await step('Save the work path, then make a shape layer from it (vector, coloured with the foreground)', async () => {
  await app().getByRole('button', { name: 'Paths', exact: true }).click();
  await app().getByRole('button', { name: 'Save work path' }).click(); await settle();
  await app().locator('input.fgSwatch').fill('#ff0000');
  await app().getByRole('button', { name: 'Make shape layer from path' }).click(); await settle();
  near((await exportPx('paths-shape-layer.png')).at(150, 100), [255, 0, 0], 0, 'red shape on top');
  await page.keyboard.press('Control+z'); await settle();
});

await step('Stroke path paints along the outline with the brush', async () => {
  await app().getByRole('button', { name: 'Stroke path with brush' }).click(); await settle();
  const e = await exportPx(); near(e.at(150, 50), [255, 0, 0], 40, 'top edge stroked red'); near(e.at(150, 100), [0, 0, 0], 0, 'inside still black');
});

await step('Vector mask from the path hides everything outside it', async () => {
  await app().getByRole('button', { name: 'Layers', exact: true }).click();
  await app().locator('.leftFooter').getByTitle('Create a new layer').click(); await settle();
  await page.keyboard.press('Control+a'); await page.keyboard.press('Alt+Backspace'); await settle(); await page.keyboard.press('Control+d'); await settle();
  await app().getByRole('button', { name: 'Paths', exact: true }).click();
  await app().getByRole('button', { name: 'Add vector mask' }).click(); await settle();
  const e = await exportPx('paths-vector-mask.png');
  near(e.at(150, 100), [255, 0, 0], 0, 'inside shows the red layer'); near(e.at(40, 100), BG, 0, 'outside is masked');
  await app().getByRole('button', { name: 'Layers', exact: true }).click();
  await rowOf('Paint layer 3').click({ button: 'right', position: { x: 10, y: 10 } });
  await menuItem('Disable Vector Mask').click(); await settle();
  near((await exportPx()).at(40, 100), [255, 0, 0], 0, 'disabled vector mask shows everything');
});

await step('Direct Selection drags an anchor and the path follows', async () => {
  await app().getByRole('button', { name: 'Paths', exact: true }).click();
  await page.keyboard.press('a'); await page.keyboard.press('Shift+a');
  const p0 = await scr(200, 150), p1 = await scr(250, 180);
  await page.mouse.move(p0.x, p0.y); await page.mouse.down(); await page.mouse.move(p1.x, p1.y, { steps: 6 }); await page.mouse.up(); await settle();
  const d = await app().locator('.artboardContainer svg path[d]').evaluateAll(ps => ps.map(p => p.getAttribute('d')).join(' '));
  assert.match(d, /250[ ,]180/, 'moved anchor appears in the path data');
});

await step('no uncaught page errors', async () => assert.deepEqual(errors, []));
await browser.close(); server.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
