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
// full screen CTM (the view can be rotated)
const scrR = (x, y) => page.evaluate(([sel, x, y]) => { const m = document.querySelector(sel + ' .artboardContainer svg').getScreenCTM(); const p = new DOMPoint(x, y).matrixTransform(m); return { x: p.x, y: p.y }; }, [APP, x, y]);
async function dragR(points) { const s = []; for (const [x, y] of points) s.push(await scrR(x, y)); await page.mouse.move(s[0].x, s[0].y); await page.mouse.down(); for (const p of s.slice(1)) await page.mouse.move(p.x, p.y, { steps: 6 }); await page.mouse.up(); }
const variant = async (tool, name) => { await app().getByRole('toolbar').getByRole('group', { name: 'Tool variant' }).getByRole('button', { name, exact: true }).click(); };

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
  await variant('shape', 'Custom Shape'); await drag([[20, 90], [50, 110], [80, 130]]); await settle();
  assert.ok(await app().locator('.layerList .layer input[value^="Arrow"]').count() === 1, 'custom shape layer');
});

await step('Single Row and Single Column marquee select 1-pixel lines across the document', async () => {
  await app().getByTitle('Marquee (M)', { exact: true }).click(); await variant('marquee', 'Single Row');
  await click(100, 100); await settle();
  await app().locator('.leftFooter').getByTitle('Create a new layer').click(); await settle();
  await app().locator('input.fgSwatch').fill('#0000ff'); await app().locator('input.fgSwatch').blur(); await page.keyboard.press('Alt+Backspace'); await settle(); await page.keyboard.press('Control+d'); await settle();
  const e = await exportPx(); near(e.at(10, 100), [0, 0, 255], 0, 'row painted'); near(e.at(10, 101), BG, 0, 'next row untouched');
  await page.keyboard.press('Control+z'); await settle();
});

await step('Rotate View rotates the canvas without changing the document; clicks still land in document space', async () => {
  await page.keyboard.press('r'); await app().getByLabel('Rotation angle value', { exact: true }).fill('30'); await app().getByLabel('Rotation angle value', { exact: true }).blur(); await settle();
  const t = await app().locator('.artboardContainer').evaluate(n => n.style.transform); assert.match(t, /rotate\(30deg\)/);
  const before = await exportPx();
  await app().getByTitle('Marquee (M)', { exact: true }).click(); await variant('marquee', 'Rectangular'); await dragR([[100, 60], [150, 100], [200, 140]]);
  await page.keyboard.press('Alt+Backspace'); await settle(); await page.keyboard.press('Control+d'); await settle();
  const e = await exportPx(); near(e.at(150, 100), [0, 0, 255], 0, 'fill landed at the document position under a rotated view'); near(e.at(95, 100), before.at(95, 100), 0, 'outside untouched');
  await page.keyboard.press('r'); await app().getByRole('button', { name: 'Reset View' }).click(); await settle();
});

// a fresh 300×200 document with one paint layer: left half red, right half white
async function freshRedWhite() {
  await app().getByTitle('New design').click(); await app().getByLabel('New width').fill(String(W)); await app().getByLabel('New height').fill(String(H));
  await app().getByRole('button', { name: /Create design/ }).click(); await settle();
  await app().locator('.leftFooter').getByTitle('Create a new layer').click(); await settle();
  await app().locator('input.fgSwatch').fill('#ffffff'); await app().locator('input.fgSwatch').blur();
  await page.keyboard.press('Control+a'); await page.keyboard.press('Alt+Backspace'); await settle();
  await app().getByTitle('Marquee (M)', { exact: true }).click(); await variant('marquee', 'Rectangular'); await drag([[0, 0], [75, 100], [150, 200]]);
  await app().locator('input.fgSwatch').fill('#ff0000'); await app().locator('input.fgSwatch').blur();
  await page.keyboard.press('Alt+Backspace'); await settle(); await page.keyboard.press('Control+d'); await settle();
}
const pickTool = async (title, v) => { await app().locator('nav.rail').getByRole('button', { name: title }).click(); if (v) await variant(null, v); };

await step('Magic Eraser erases the clicked colour region to transparency', async () => {
  await freshRedWhite();
  await pickTool(/^Eraser/, 'Magic Eraser'); await click(220, 100); await settle();
  const e = await exportPx(); near(e.at(220, 100), BG, 0, 'white half erased'); near(e.at(60, 100), [255, 0, 0], 0, 'red kept');
  await page.keyboard.press('Control+z'); await settle();
});

await step('Background Eraser removes the sampled colour under the brush only', async () => {
  await pickTool(/^Eraser/, 'Background Eraser'); await drag([[130, 100], [150, 100], [170, 100]]); await settle();
  const e = await exportPx(); near(e.at(170, 100), BG, 2, 'white under the brush erased'); near(e.at(140, 100), [255, 0, 0], 0, 'red (not the sampled colour) kept');
  await page.keyboard.press('Control+z'); await settle();
});

await step('Brush Mode Multiply darkens instead of covering', async () => {
  await pickTool(/^Brush/, 'Brush'); await app().getByRole('toolbar').getByLabel('Mode', { exact: true }).selectOption('multiply');
  await app().locator('input.fgSwatch').fill('#808080'); await app().locator('input.fgSwatch').blur();
  await drag([[40, 150], [75, 150], [110, 150]]); await settle();
  near((await exportPx()).at(75, 150), [128, 0, 0], 3, 'grey × red = dark red');
  await app().getByRole('toolbar').getByLabel('Mode', { exact: true }).selectOption('normal');
});

await step('History Brush paints the layer back to an earlier state', async () => {
  await pickTool(/^History Brush/); await app().getByRole('toolbar').getByLabel('Source state').selectOption({ index: (await app().getByRole('toolbar').getByLabel('Source state').locator('option').count()) - 2 });
  await page.waitForTimeout(400); await drag([[60, 150], [75, 150], [90, 150]]); await settle();
  near((await exportPx()).at(75, 150), [255, 0, 0], 3, 'restored the pure red');
});

await step('Pattern Stamp paints a pattern; Color Replacement recolours red to blue', async () => {
  await pickTool(/Stamp/, 'Pattern Stamp'); await app().locator('input.fgSwatch').fill('#000000'); await app().locator('input.fgSwatch').blur();
  await drag([[200, 40], [240, 40], [280, 40]]); await settle();
  const e = await exportPx(); const vals = new Set(); for (let x = 200; x < 280; x++) vals.add(e.at(x, 40)[0]); assert.ok(vals.size >= 2, 'pattern has varying pixels');
  await pickTool(/^Brush/, 'Color Replacement'); await app().locator('input.fgSwatch').fill('#0000ff'); await app().locator('input.fgSwatch').blur();
  await drag([[40, 60], [60, 60], [80, 60]]); await settle();
  const c = (await exportPx()).at(60, 60); assert.ok(c[2] > c[0], 'red became blue-ish: ' + c);
});

await step('Red Eye removes red inside the box only', async () => {
  await pickTool(/^Healing/, 'Red Eye'); await drag([[20, 90], [40, 110], [60, 130]]); await settle();
  const e = await exportPx(); const p = e.at(40, 110); assert.ok(p[0] < 200, 'pupil no longer bright red: ' + p); near(e.at(100, 180), [255, 0, 0], 0, 'outside unchanged');
});

await step('Content-Aware Move moves a selected object and fills the hole', async () => {
  await freshRedWhite();
  await app().locator('input.fgSwatch').fill('#0000ff'); await app().locator('input.fgSwatch').blur();
  await app().getByTitle('Marquee (M)', { exact: true }).click(); await drag([[200, 80], [210, 90], [220, 100]]); await page.keyboard.press('Alt+Backspace'); await settle();
  await drag([[196, 76], [210, 90], [224, 104]]);
  await pickTool(/^Healing/, 'Content-Aware Move'); await drag([[210, 90], [230, 120], [250, 150]]); await settle();
  const e = await exportPx('ca-move.png'); const moved = e.at(250, 150), hole = e.at(210, 90);
  assert.ok(moved[2] > 150 && moved[0] < 100, 'blue at the new place: ' + moved); assert.ok(hole[0] > 150, 'hole filled from the (white) surroundings, no longer blue: ' + hole);
});

await step('Ruler measures; Count adds numbered markers; Color Sampler reads values in Info', async () => {
  await pickTool(/^Eyedropper/, 'Ruler'); await drag([[50, 50], [100, 50], [150, 50]]);
  assert.match(await app().getByLabel('Ruler measurement').innerText(), /L 100\.0 px/);
  await variant(null, 'Count'); await click(30, 30); await click(60, 30); assert.match(await app().getByLabel('Count total').innerText(), /2/);
  await variant(null, 'Color Sampler'); await click(60, 100); await settle();
  await app().getByRole('button', { name: 'Info', exact: true }).click(); await page.waitForTimeout(300);
  assert.match(await app().getByRole('region', { name: 'Info' }).innerText(), /#1[\s\S]*255/);
  await app().getByRole('button', { name: 'Layers', exact: true }).click();
});

await step('Magnetic Lasso snaps to the red/white edge and closes into a selection', async () => {
  await pickTool(/^Lasso/, 'Magnetic'); await click(150, 30); for (const y of [60, 100, 140, 170]) { const p = await scr(147, y); await page.mouse.move(p.x, p.y, { steps: 4 }); }
  await click(150, 170); await click(10, 170); await click(10, 30); await page.keyboard.press('Enter'); await settle();
  await app().locator('.leftFooter').getByTitle('Create a new layer').click(); await settle();
  await app().locator('input.fgSwatch').fill('#00ff00'); await app().locator('input.fgSwatch').blur(); await page.keyboard.press('Alt+Backspace'); await settle(); await page.keyboard.press('Control+d'); await settle();
  const e = await exportPx(); near(e.at(80, 100), [0, 255, 0], 0, 'inside filled'); near(e.at(200, 100), [255, 255, 255], 0, 'right of the edge untouched');
  await page.keyboard.press('Control+z'); await settle();
});

await step('Custom gradient from the Gradient Editor uses its stops', async () => {
  await page.keyboard.press('Control+d'); await settle();
  await pickTool(/^Gradient/); await app().getByRole('button', { name: 'Edit gradient' }).click();
  await page.getByRole('button', { name: 'Preset Black to White' }).click(); await page.getByRole('button', { name: 'OK', exact: true }).click();
  await drag([[0, 20], [150, 20], [300, 20]]); await settle();
  const e = await exportPx(); assert.ok(e.at(5, 100)[0] < 30 && e.at(295, 100)[0] > 225, 'black → white across the layer');
});

await step('Perspective Crop straightens a quad into a new canvas', async () => {
  await pickTool(/^Crop/, 'Perspective Crop'); await drag([[40, 40], [100, 80], [160, 120]]);
  const c = await scr(160, 120), t = await scr(180, 130); await page.mouse.move(c.x, c.y); await page.mouse.down(); await page.mouse.move(t.x, t.y, { steps: 5 }); await page.mouse.up();
  await page.keyboard.press('Enter'); await settle();
  assert.match(await app().locator('.artboardLabel').innerText(), /\d+ × \d+/); assert.doesNotMatch(await app().locator('.artboardLabel').innerText(), /300 × 200/);
});


await step('no uncaught page errors', async () => assert.deepEqual(errors, []));
await browser.close(); server.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
