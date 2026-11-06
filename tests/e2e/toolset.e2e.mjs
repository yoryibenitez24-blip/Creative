// Browser acceptance tests for the Photoshop-style toolset (slice 3): adjustments, filters,
// History panel, magic wand, paint bucket, eyedropper, gradient, image/canvas size, rotation,
// crop, rasterize/merge, clone stamp, dodge, spot healing and navigation. Real input only;
// results are judged on exported PNG pixels.
// Run: npm run build && node tests/e2e/toolset.e2e.mjs
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { serve } from './serve.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const evidence = join(fileURLToPath(new URL('.', import.meta.url)), '../../docs/evidence');
mkdirSync(evidence, { recursive: true });
const server = await serve(0);
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
const page = await context.newPage();
const errors = []; page.on('pageerror', e => { if (!errors.length) console.log('PAGE ERROR', (e.stack || e.message).split('\n').slice(0, 6).join('\n')); errors.push(e.message); });
const results = [];
const step = async (name, fn) => { try { await fn(); results.push({ name, ok: true }); console.log('ok   ' + name); } catch (e) { results.push({ name, ok: false, error: e.message }); console.log('FAIL ' + name + '\n     ' + e.message.split('\n')[0]); } };

const APP = 'div.app[style*="display: flex"]';
const app = () => page.locator(APP);
const W = 300, H = 200;
const mapping = () => page.evaluate(sel => { const m = document.querySelector(sel + ' .artboardContainer svg').getScreenCTM(); return { a: m.a, d: m.d, e: m.e, f: m.f }; }, APP);
const scr = async (x, y) => { const m = await mapping(); return { x: m.a * x + m.e, y: m.d * y + m.f }; };
async function drag(points, mod) {
  const m = await mapping(); const s = points.map(([x, y]) => ({ x: m.a * x + m.e, y: m.d * y + m.f }));
  if (mod) await page.keyboard.down(mod);
  await page.mouse.move(s[0].x, s[0].y); await page.mouse.down();
  for (const p of s.slice(1)) await page.mouse.move(p.x, p.y, { steps: 6 });
  await page.mouse.up(); if (mod) await page.keyboard.up(mod);
}
const click = async (x, y, mod) => { const p = await scr(x, y); if (mod) await page.keyboard.down(mod); await page.mouse.click(p.x, p.y); if (mod) await page.keyboard.up(mod); };
const settle = () => page.waitForTimeout(120).then(() => page.waitForFunction(sel => { const a = document.querySelector(sel); return a && a.dataset.work === '0' && !document.querySelector('.opDialog') && a.querySelector('.saveStatus')?.textContent.includes('Saved locally'); }, APP, { timeout: 20000 })).then(() => page.waitForTimeout(150));
const setNum = async (label, v) => { const i = page.getByLabel(label, { exact: true }); await i.fill(String(v)); await i.blur(); };
async function exportPx(name) {
  await app().locator('button.export').click();
  const [dl] = await Promise.all([page.waitForEvent('download'), app().getByRole('button', { name: /Download PNG/ }).click()]); await page.waitForFunction(() => !document.querySelector('.modalBackdrop'));
  const png = readFileSync(await dl.path()); if (name) writeFileSync(join(evidence, name), png);
  const img = await loadImage(png); const c = createCanvas(img.width, img.height); const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, img.width, img.height).data;
  return { w: img.width, h: img.height, at: (x, y) => [...d.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 3)], d };
}
const menu = async (top, ...path) => { await app().getByRole('button', { name: top, exact: true }).click(); for (const p of path.slice(0, -1)) await app().getByRole('menuitem', { name: p, exact: true }).hover(); await app().getByRole('menuitem', { name: path.at(-1), exact: true }).click(); };
const undo = async () => { await page.keyboard.press('Control+z'); await settle(); };
const tool = async t => { await app().getByTitle(t, { exact: true }).click(); };
const near = (v, want, tol, what) => assert.ok(Math.abs(v - want) <= tol, `${what}: ${v} (want ${want}±${tol})`);

await page.goto('http://127.0.0.1:' + server.address().port + '/#design');
await page.waitForSelector(APP);

await step('setup: white paint layer with a black left half', async () => {
  await app().getByTitle('New design').click();
  await app().getByLabel('New width').fill(String(W)); await app().getByLabel('New height').fill(String(H));
  await app().getByRole('button', { name: /Create design/ }).click();
  await page.waitForFunction(sel => document.querySelector(sel + ' .artboardLabel')?.textContent.includes('300 × 200'), APP);
  await page.keyboard.press('Control+Shift+n');
  await page.keyboard.press('Control+a'); await page.keyboard.press('Control+Backspace'); await settle();
  await tool('Marquee (M)'); await drag([[-5, -5], [80, 100], [150, 205]]); await page.keyboard.press('Alt+Backspace'); await settle(); await page.keyboard.press('Control+d');
  const e = await exportPx(); assert.deepEqual(e.at(100, 100), [0, 0, 0]); assert.deepEqual(e.at(200, 100), [255, 255, 255]);
});

await step('magic wand selects the contiguous white half', async () => {
  await page.keyboard.press('w'); await click(200, 100); await settle(); await page.waitForSelector(APP + ' path.antsDash');
  assert.ok((await app().locator('path.antsDash').getAttribute('d')).length > 10);
  await page.keyboard.press('Control+d');
});

await step('paint bucket fills the white region with the foreground colour', async () => {
  await app().getByLabel('Foreground color').fill('#ff0000'); await app().getByLabel('Foreground color').blur();
  await page.keyboard.press('g'); await app().getByRole('button', { name: 'Paint Bucket', exact: true }).click();
  await click(200, 100); await settle();
  const e = await exportPx(); assert.deepEqual(e.at(200, 100), [255, 0, 0]); assert.deepEqual(e.at(100, 100), [0, 0, 0]);
});

await step('eyedropper sets the foreground (click) and background (Alt-click)', async () => {
  const colourIs = (label, v) => page.waitForFunction(([sel, l, want]) => document.querySelector(`${sel} input[aria-label="${l}"]`)?.value === want, [APP, label, v], { timeout: 5000 });
  await page.keyboard.press('i'); await click(100, 100); await settle(); await colourIs('Foreground color', '#000000');
  await click(250, 100, 'Alt'); await colourIs('Background color', '#ff0000');
});

let blurred;
await step('Filter › Blur › Gaussian Blur softens the edge with live preview and one undo step', async () => {
  await menu('Filter', 'Blur', 'Gaussian Blur…');
  await setNum('Radius value', 6); await page.waitForTimeout(600);
  await page.getByRole('button', { name: 'OK', exact: true }).click(); await settle();
  blurred = await exportPx('m1-toolset-blur.png');
  const r = blurred.at(150, 100)[0]; assert.ok(r > 60 && r < 200, 'edge midpoint ' + r);
  assert.deepEqual(blurred.at(60, 100), [0, 0, 0]); assert.deepEqual(blurred.at(250, 100), [255, 0, 0]);
});

await step('History panel jumps to an earlier state and back', async () => {
  await app().getByRole('button', { name: 'History', exact: true }).click();
  const items = app().locator('.historyItem');
  assert.match(await items.last().innerText(), /Gaussian Blur/);
  await items.filter({ hasText: 'Paint Bucket' }).last().click(); await settle();
  assert.deepEqual((await exportPx()).at(148, 100), [0, 0, 0], 'before the blur');
  await items.last().click(); await settle();
  assert.ok((await exportPx()).at(148, 100)[0] > 30, 'blur restored');
  await app().getByRole('button', { name: 'Layers', exact: true }).click();
});

await step('Image › Adjustments: Invert (⌘I), Levels (⌘L) and Curves cancel', async () => {
  await page.keyboard.press('Control+i'); await settle();
  assert.deepEqual((await exportPx()).at(60, 100), [255, 255, 255]); await undo();
  await page.keyboard.press('Control+l'); await setNum('Input white value', 128); await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'OK', exact: true }).click(); await settle();
  const lv = await exportPx(); assert.ok(lv.at(150, 100)[0] > blurred.at(150, 100)[0] + 40, 'levels brightened midtones');
  await undo();
  await page.keyboard.press('Control+m'); await page.waitForTimeout(300);
  const box = await page.getByLabel('Curve', { exact: true }).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.1, { steps: 5 }); await page.mouse.up();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click(); await page.waitForTimeout(200);
  const cv = await exportPx(); assert.deepEqual(cv.at(150, 100), blurred.at(150, 100), 'cancel restores pixels');
});

await step('Image Size resamples to 150×100 (constrained), undo restores', async () => {
  await menu('Image', 'Image Size…'); await setNum('Width (px)', 150);
  assert.equal(await page.getByLabel('Height (px)', { exact: true }).inputValue(), '100');
  await page.getByRole('button', { name: 'OK', exact: true }).click(); await settle(); await page.waitForTimeout(300);
  const e = await exportPx(); assert.deepEqual([e.w, e.h], [150, 100]); assert.deepEqual(e.at(20, 50), [0, 0, 0]); assert.deepEqual(e.at(130, 50), [255, 0, 0]);
  await undo(); assert.deepEqual([(await exportPx()).w], [300]);
});

await step('Image Rotation 90° clockwise moves the black half to the top', async () => {
  await menu('Image', 'Image Rotation', '90° Clockwise'); await settle(); await page.waitForTimeout(300);
  const e = await exportPx('m1-toolset-rotate.png'); assert.deepEqual([e.w, e.h], [200, 300]);
  assert.deepEqual(e.at(100, 40), [0, 0, 0]); assert.deepEqual(e.at(100, 260), [255, 0, 0]);
  await undo();
});

await step('Canvas Size with a centre anchor adds space without deleting pixels', async () => {
  await menu('Image', 'Canvas Size…'); await setNum('Width (px)', 400);
  await page.getByRole('button', { name: 'OK', exact: true }).click(); await settle();
  const e = await exportPx(); assert.equal(e.w, 400); assert.deepEqual(e.at(20, 100), [244, 241, 234], 'new area shows the background'); assert.deepEqual(e.at(110, 100), [0, 0, 0]);
  await undo();
});

await step('Crop tool: drag a box, Enter crops; undo restores', async () => {
  await page.keyboard.press('c'); await drag([[20, 20], [70, 70], [120, 120]]); await page.keyboard.press('Enter'); await settle();
  const e = await exportPx(); assert.deepEqual([e.w, e.h], [100, 100]); assert.deepEqual(e.at(50, 50), [0, 0, 0]);
  await undo(); await page.keyboard.press('v');
});

await step('Rasterize a shape layer and Merge Down keep the composite identical', async () => {
  const before = await exportPx();
  await page.keyboard.press('u'); await drag([[60, 40], [120, 90], [180, 140]]); await settle();
  const withShape = await exportPx();
  await menu('Layer', 'Rasterize layer'); await settle(); await page.waitForTimeout(300);
  const raster = await exportPx();
  let worst = 0; for (let i = 0; i < raster.d.length; i++) worst = Math.max(worst, Math.abs(raster.d[i] - withShape.d[i]));
  assert.ok(worst <= 2, 'rasterize changed pixels by ' + worst);
  const n = await app().locator('.layerList .layer').count();
  await page.keyboard.press('Control+e'); await settle(); await page.waitForTimeout(300);
  assert.equal(await app().locator('.layerList .layer').count(), n - 1);
  const merged = await exportPx(); worst = 0; for (let i = 0; i < merged.d.length; i++) worst = Math.max(worst, Math.abs(merged.d[i] - withShape.d[i]));
  assert.ok(worst <= 2, 'merge changed pixels by ' + worst);
  await undo(); await undo(); await undo();
  const back = await exportPx(); assert.deepEqual(back.at(150, 100), before.at(150, 100));
  await app().locator('.layerList .layer .layerThumb').first().click();
});

await step('Clone Stamp: Alt-click a source, paint copies it', async () => {
  await page.keyboard.press('s'); await setNum('Size value', 20); await setNum('Hardness value', 100);
  await click(60, 60, 'Alt'); await drag([[250, 60], [252, 60]]); await settle();
  assert.deepEqual((await exportPx()).at(251, 60), [0, 0, 0]);
  await undo();
});

await step('Dodge (shadows) lightens black; spot healing removes a blemish', async () => {
  await page.keyboard.press('o'); await page.getByLabel('Range', { exact: true }).selectOption('shadows'); await setNum('Exposure value', 100);
  await drag([[60, 150], [62, 150]]); await settle();
  assert.ok((await exportPx()).at(61, 150)[0] > 80, 'dodged'); await undo();
  // blemish: a black dot in the red area, then spot-heal over it
  await page.keyboard.press('b'); await setNum('Size value', 8); await drag([[230, 100], [231, 100]]); await settle();
  assert.ok((await exportPx()).at(230, 100)[0] < 60, 'blemish painted');
  await page.keyboard.press('j'); await setNum('Size value', 24); await drag([[226, 100], [234, 100]]); await settle(); await page.waitForTimeout(300);
  const h = (await exportPx('m1-toolset-heal.png')).at(230, 100); assert.ok(h[0] > 200 && h[1] < 60, 'healed to red: ' + h);
});

await step('Smudge drags black into the red half; undo restores', async () => {
  await tool('Blur / Sharpen / Smudge'); await app().getByRole('button', { name: 'Smudge', exact: true }).click();
  await setNum('Size value', 20); await setNum('Strength value', 90);
  const before = (await exportPx()).at(158, 40);
  await drag([[135, 40], [150, 40], [165, 40]]); await settle();
  const after = (await exportPx()).at(158, 40);
  assert.ok(before[0] > 200, 'starts red: ' + before); assert.ok(after[0] < before[0] - 40, 'smudged: ' + after + ' from ' + before);
  await undo(); assert.deepEqual((await exportPx()).at(158, 40), before);
});

await step('navigation: zoom tool click doubles the zoom, Alt-click halves it; Space-drag pans', async () => {
  const z0 = (await mapping()).a;
  await page.keyboard.press('z'); await click(150, 100); await page.waitForTimeout(150);
  near((await mapping()).a, z0 * 2, 0.01, 'zoom in');
  await click(150, 100, 'Alt'); await page.waitForTimeout(150);
  near((await mapping()).a, z0, 0.01, 'zoom out');
  const e0 = (await mapping()).e;
  await page.keyboard.down('Space'); const p = await scr(150, 100); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + 80, p.y, { steps: 4 }); await page.mouse.up(); await page.keyboard.up('Space');
  near((await mapping()).e - e0, 80, 2, 'pan');
});

await step('no uncaught page errors', async () => assert.deepEqual(errors, []));
await page.screenshot({ path: join(evidence, 'm1-toolset-ui.png') });
await browser.close(); server.close();
writeFileSync(join(evidence, 'm1-toolset-e2e-results.json'), JSON.stringify({ date: new Date().toISOString(), browser: 'chromium (Playwright)', results }, null, 2));
const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.filter(r => r.ok).length} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
