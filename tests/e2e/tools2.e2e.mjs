// Browser acceptance tests: the remaining Photoshop tools (shape tool variants, single row/column
// marquee, rotate view, magic/background eraser, history brush, pattern stamp, colour replacement,
// red eye, ruler, colour sampler, count, magnetic lasso, perspective crop, content-aware move).
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

await page.goto('http://127.0.0.1:' + server.address().port + '/');
await page.waitForSelector(APP);
const variant = async (tool, name) => { await app().getByRole('toolbar').getByRole('button', { name, exact: true }).click(); };

await step('Shape tool: rectangle, polygon, star, line and custom shapes are drawn by dragging', async () => {
  await app().getByTitle('New design').click(); await app().getByLabel('New width').fill(String(W)); await app().getByLabel('New height').fill(String(H));
  await app().getByRole('button', { name: /Create design/ }).click();
  await page.waitForFunction(sel => document.querySelector(sel + ' .artboardLabel')?.textContent.includes('300 × 200'), APP);
  await app().locator('input.fgSwatch').fill('#ff0000'); await app().locator('input.fgSwatch').blur();
  await page.keyboard.press('u'); await drag([[20, 20], [50, 40], [80, 60]]); await settle();
  near((await exportPx()).at(50, 40), [255, 0, 0], 0, 'rectangle');
  await variant('shape', 'Polygon'); await drag([[120, 20], [150, 50], [180, 80]]); await settle();
  near((await exportPx()).at(150, 52), [255, 0, 0], 0, 'polygon centre');
  await app().getByLabel('Star', { exact: true }).check(); await drag([[200, 20], [230, 50], [260, 80]]); await settle();
  const st = await exportPx(); near(st.at(230, 52), [255, 0, 0], 0, 'star centre'); near(st.at(202, 78), BG, 0, 'star corner empty');
  await variant('shape', 'Line'); await app().getByLabel('Line weight value', { exact: true }).fill('6'); await drag([[20, 150], [150, 150], [280, 150]]); await settle();
  near((await exportPx()).at(150, 150), [255, 0, 0], 0, 'line');
  await variant('shape', 'Custom Shape'); await drag([[20, 90], [50, 110], [80, 130]]); await settle(); await page.screenshot({ path: '/tmp/claude-0/-home-user-Creative/ac3ff1ca-646e-5589-bc47-4c2c8453dd1e/scratchpad/t2.png' }); console.log('LAY', await app().locator('.layerList .layer input').evaluateAll(e=>e.map(x=>x.value)), await app().locator('.toast').allInnerTexts());
  assert.ok(await app().locator('.layerList .layer input[value^="Arrow"]').count() === 1, 'custom shape layer');
});

await step('Single Row and Single Column marquee select 1-pixel lines across the document', async () => {
  await app().getByTitle('Marquee (M)', { exact: true }).click(); await variant('marquee', 'Single Row');
  await click(100, 100); await settle();
  console.log('SEL', await app().locator('.artboardContainer svg .antsDash').count(), await app().locator('.toast').allInnerTexts());
  await app().locator('.leftFooter').getByTitle('Create a new layer').click(); await settle();
  await app().locator('input.fgSwatch').fill('#0000ff'); await app().locator('input.fgSwatch').blur(); page.on('console', m => console.log('PG', m.text())); await page.evaluate(() => window.addEventListener('keydown', e => setTimeout(() => console.log('KD', e.key, e.altKey, e.defaultPrevented), 0))); await page.keyboard.press('Alt+Backspace'); await page.waitForTimeout(300); console.log('T', await app().locator('.toast').allInnerTexts(), await app().locator('canvas.rasterSurface').evaluateAll(cs=>cs.map(c=>[c.width,c.height,[...c.getContext('2d').getImageData(10,100,1,1).data].join(',')]))); await settle(); await page.keyboard.press('Control+d'); await settle();
  console.log('AFTER', await app().locator('.toast').allInnerTexts(), await app().locator('.layerList .layer.selected input').evaluateAll(e=>e.map(x=>x.value)), await page.evaluate(()=>document.activeElement?.outerHTML?.slice(0,80)));
  const e = await exportPx(); near(e.at(10, 100), [0, 0, 255], 0, 'row painted'); near(e.at(10, 101), BG, 0, 'next row untouched');
  await page.keyboard.press('Control+z'); await settle();
});

await step('Rotate View rotates the canvas without changing the document; clicks still land in document space', async () => {
  await page.keyboard.press('r'); await app().getByLabel('Rotation angle value', { exact: true }).fill('30'); await app().getByLabel('Rotation angle value', { exact: true }).blur(); await settle();
  const t = await app().locator('.artboardContainer').evaluate(n => n.style.transform); assert.match(t, /rotate\(30deg\)/);
  const before = await exportPx();
  await app().getByTitle('Marquee (M)', { exact: true }).click(); await variant('marquee', 'Rectangular'); await drag([[100, 60], [150, 100], [200, 140]]);
  await page.keyboard.press('Alt+Backspace'); await settle(); await page.keyboard.press('Control+d'); await settle();
  const e = await exportPx(); near(e.at(150, 100), [0, 0, 255], 0, 'fill landed at the document position under a rotated view'); near(e.at(95, 100), before.at(95, 100), 0, 'outside untouched');
  await page.keyboard.press('r'); await app().getByRole('button', { name: 'Reset View' }).click(); await settle();
});

// @@MORE@@

await step('no uncaught page errors', async () => assert.deepEqual(errors, []));
await browser.close(); server.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
