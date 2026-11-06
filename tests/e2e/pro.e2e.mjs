// Browser acceptance tests: Filter › Liquify, Select › Select and Mask, and advanced type
// (Character/Paragraph panels, Warp Text, on-canvas editing).
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


await page.goto('http://127.0.0.1:' + server.address().port + '/');
await page.waitForSelector(APP);

await step('Liquify: a Forward Warp stroke pushes pixels and applies as one undo step', async () => {
  await app().getByTitle('New design').click(); await app().getByLabel('New width').fill(String(W)); await app().getByLabel('New height').fill(String(H));
  await app().getByRole('button', { name: /Create design/ }).click();
  await page.waitForFunction(sel => document.querySelector(sel + ' .artboardLabel')?.textContent.includes('300 × 200'), APP);
  await app().locator('.leftFooter').getByTitle('Create a new layer').click(); await settle();
  await app().getByTitle('Marquee (M)', { exact: true }).click(); await drag([[100, 60], [150, 100], [200, 140]]);
  await page.keyboard.press('Alt+Backspace'); await settle(); await page.keyboard.press('Control+d'); await settle();
  near((await exportPx()).at(112, 100), [0, 0, 0], 0, 'before');
  await menu('Filter', 'Liquify…');
  const view = page.getByLabel('Liquify canvas'); await view.waitFor();
  await page.getByRole('button', { name: 'Forward Warp Tool' }).click();
  const box = await page.locator('.liquify canvas').first().boundingBox();
  const at = (x, y) => ({ x: box.x + x * box.width / W, y: box.y + y * box.height / H });
  let p = at(80, 100); await page.mouse.move(p.x, p.y); await page.mouse.down();
  for (let x = 84; x <= 130; x += 4) { p = at(x, 100); await page.mouse.move(p.x, p.y, { steps: 2 }); }
  await page.mouse.up(); await page.waitForTimeout(200);
  await page.locator('.liquify').getByRole('button', { name: 'OK', exact: true }).click(); await settle();
  const e = await exportPx('liquify-forward-warp.png');
  assert.ok(e.at(112, 100)[0] > 100, 'transparent pixels were pushed into the square: ' + e.at(112, 100));
  near(e.at(180, 100), [0, 0, 0], 0, 'far side untouched');
  await app().getByRole('button', { name: 'History', exact: true }).click();
  assert.match(await app().locator('.historyItem').last().innerText(), /Liquify/);
  await app().getByRole('button', { name: 'Layers', exact: true }).click();
  await page.keyboard.press('Control+z'); await settle();
  near((await exportPx()).at(112, 100), [0, 0, 0], 0, 'undo restores');
});

await step('Select and Mask: refine a selection and output it to a new layer', async () => {
  await app().getByTitle('Marquee (M)', { exact: true }).click(); await drag([[90, 50], [150, 100], [210, 150]]);
  await menu('Select', 'Select and Mask…');
  await page.getByLabel('Output To').waitFor();
  const fv = page.locator('.cameraRaw').getByLabel('Feather value', { exact: true }); await fv.fill('3'); await fv.blur();
  await page.getByLabel('Output To').selectOption('newLayer'); await page.waitForTimeout(400);
  await page.locator('.cameraRaw').getByRole('button', { name: 'OK', exact: true }).click(); await settle();
  assert.equal(await rowOf('Refined selection').count(), 1);
  await rowOf('Paint layer 1').getByTitle('Toggle visibility').click(); await settle();
  const e = await exportPx('select-and-mask-new-layer.png');
  near(e.at(150, 100), [0, 0, 0], 0, 'inside copied'); near(e.at(40, 100), BG, 0, 'outside the selection is transparent');
  await rowOf('Paint layer 1').getByTitle('Toggle visibility').click(); await settle();
});

await step('Type: Character panel tracking widens text; Warp Text applies; on-canvas editing changes the text', async () => {
  await page.locator('body').click({ position: { x: 5, y: 500 } }); await page.keyboard.press('t'); await settle();
  const width = () => app().locator('.artboardContainer svg [data-layer-id] text').first().evaluate(t => t.closest('g').getBBox().width);
  const w0 = await width();
  const tr = app().getByLabel('Tracking', { exact: true }); await tr.fill('400'); await tr.press('Enter'); await settle();
  const w1 = await width(); assert.ok(w1 > w0 * 1.2, `tracking widened the text ${w0} → ${w1}`);
  await app().getByRole('button', { name: /More type options/ }).click();
  await app().getByRole('button', { name: 'Warp Text…' }).click();
  await page.getByLabel('Warp style').selectOption('arc');
  await page.getByRole('dialog', { name: 'Warp Text' }).getByRole('button', { name: 'OK', exact: true }).click().catch(async () => page.getByRole('button', { name: 'OK', exact: true }).click());
  await settle(); await page.waitForTimeout(300);
  assert.ok(await app().locator('.artboardContainer svg [data-layer-id] image').count() >= 1, 'warped text renders as an image');
  await app().getByRole('button', { name: 'Warp Text…' }).click(); await page.getByLabel('Warp style').selectOption('none');
  await page.getByRole('button', { name: 'OK', exact: true }).click(); await settle();
  const t = app().locator('.artboardContainer svg [data-layer-id] text').first(); const b = await t.boundingBox();
  await page.mouse.dblclick(b.x + 10, b.y + b.height / 2);
  const ta = app().locator('.artboardContainer foreignObject textarea'); await ta.waitFor();
  await ta.press('Control+a'); await ta.pressSequentially('Hello type'); await ta.press('Escape'); await settle();
  assert.equal(await app().getByLabel('Text content').inputValue(), 'Hello type');
});

await step('no uncaught page errors', async () => assert.deepEqual(errors, []));
await browser.close(); server.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
