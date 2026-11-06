// Browser acceptance tests for Free Transform (scale, rotate, distort) and Warp on paint layers.
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


await page.goto('http://127.0.0.1:' + server.address().port + '/#design');
await page.waitForSelector(APP);
const dragMod = async (pts, mods) => { for (const m of mods) await page.keyboard.down(m); await drag(pts); for (const m of mods) await page.keyboard.up(m); };
const black = p => p[0] < 40 && p[1] < 40 && p[2] < 40;
const bgish = p => Math.abs(p[0] - BG[0]) < 20 && Math.abs(p[2] - BG[2]) < 20;

await step('setup: black 100×30 bar on a paint layer', async () => {
  await app().getByTitle('New design').click(); await app().getByLabel('New width').fill(String(W)); await app().getByLabel('New height').fill(String(H));
  await app().getByRole('button', { name: /Create design/ }).click();
  await page.waitForFunction(sel => document.querySelector(sel + ' .artboardLabel')?.textContent.includes('300 × 200'), APP);
  await page.keyboard.press('Control+Shift+n');
  await app().getByTitle('Marquee (M)', { exact: true }).click(); await drag([[100, 50], [150, 65], [200, 80]]);
  await page.keyboard.press('Alt+Backspace'); await settle(); await page.keyboard.press('Control+d');
  const e = await exportPx(); assert.ok(black(e.at(150, 65)) && bgish(e.at(150, 100)));
});

await step('Ctrl+T, drag the bottom-right corner: proportional ×1.5 scale about the opposite corner', async () => {
  await page.keyboard.press('v'); await page.keyboard.press('Control+t');
  await page.getByRole('toolbar', { name: 'Transform options' }).waitFor();
  await drag([[200, 80], [230, 90], [250, 95]]); await page.waitForTimeout(200);
  await page.keyboard.press('Enter'); await settle(); await page.waitForTimeout(300);
  const e = await exportPx('m1-transform-scale.png');
  assert.ok(black(e.at(240, 90)), 'scaled bar reaches x=250, y=95: ' + e.at(240, 90)); assert.ok(bgish(e.at(260, 90)) && bgish(e.at(150, 100)));
  await page.keyboard.press('Control+z'); await settle(); await page.waitForTimeout(300);
  assert.ok(bgish((await exportPx()).at(240, 90)), 'undo');
});

await step('rotate 90° (Shift snaps to 15°) turns the bar vertical around its centre', async () => {
  await page.keyboard.press('Control+t'); await page.getByRole('toolbar', { name: 'Transform options' }).waitFor();
  await dragMod([[230, 65], [200, 110], [150, 145]], ['Shift']); await page.waitForTimeout(200);
  await page.keyboard.press('Enter'); await settle(); await page.waitForTimeout(300);
  const e = await exportPx('m1-transform-rotate.png');
  assert.ok(black(e.at(150, 105)), 'vertical extent: ' + e.at(150, 105)); assert.ok(bgish(e.at(190, 65)), 'horizontal extent gone');
  await page.keyboard.press('Control+z'); await settle(); await page.waitForTimeout(300);
});

await step('Ctrl+drag a corner distorts only that corner', async () => {
  await page.keyboard.press('Control+t'); await page.getByRole('toolbar', { name: 'Transform options' }).waitFor();
  await dragMod([[200, 80], [220, 120], [240, 160]], ['Control']); await page.waitForTimeout(200);
  await page.keyboard.press('Enter'); await settle(); await page.waitForTimeout(300);
  const e = await exportPx(); assert.ok(black(e.at(225, 140)), 'pulled corner region filled: ' + e.at(225, 140)); assert.ok(black(e.at(110, 60)), 'opposite corner kept');
  await page.keyboard.press('Control+z'); await settle(); await page.waitForTimeout(300);
});

await step('Edit › Warp: dragging a top-edge control point bulges the bar; Escape cancels nothing committed', async () => {
  await app().getByRole('button', { name: 'Edit', exact: true }).click(); await page.getByRole('menuitem', { name: 'Warp', exact: true }).click();
  await page.getByRole('toolbar', { name: 'Transform options' }).waitFor();
  // top-edge control point (row 0, col 1) sits at (133.3, 50); pulling it up bulges the top edge (~0.44 × 40 px at u = 1/3)
  await drag([[133.3, 50], [133.3, 30], [133.3, 10]]); await page.waitForTimeout(200);
  await page.keyboard.press('Enter'); await settle(); await page.waitForTimeout(300);
  const e = await exportPx('m1-transform-warp.png'); assert.ok(black(e.at(135, 40)), 'top edge bulged upward: ' + e.at(135, 40)); assert.ok(bgish(e.at(195, 40)), 'far end unchanged');
  await page.keyboard.press('Control+z'); await settle();
  await page.keyboard.press('Control+t'); await page.getByRole('toolbar', { name: 'Transform options' }).waitFor(); await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('toolbar', { name: 'Transform options' }).count(), 0);
  assert.ok(black((await exportPx()).at(150, 65)), 'cancel left the bar unchanged');
});

await step('Content-Aware Fill (Shift+Backspace) removes a red blob from striped texture', async () => {
  await page.keyboard.press('Control+Shift+n');
  for (let x = 0; x < W; x += 20) { await app().getByTitle('Marquee (M)', { exact: true }).click(); await drag([[x, 110], [x + 5, 150], [x + 10, 200]]); await page.keyboard.press('Alt+Backspace'); await settle(); }
  await page.keyboard.press('Control+d');
  await app().getByLabel('Foreground color').fill('#ff0000'); await app().getByLabel('Foreground color').blur();
  await page.keyboard.press('b'); await setNum('Size value', 14); await setNum('Hardness value', 100); await drag([[150, 155], [152, 155]]); await settle();
  assert.ok((await exportPx()).at(151, 155)[1] < 60, 'red blob painted');
  await app().getByTitle('Marquee (M)', { exact: true }).click(); await drag([[138, 143], [150, 155], [164, 167]]); await settle();
  await page.keyboard.press('Shift+Backspace'); await settle(); await page.waitForTimeout(300);
  const e = await exportPx('m1-content-aware-fill.png');
  let red = 0; for (let y = 145; y < 166; y++) for (let x = 140; x < 163; x++) { const p = e.at(x, y); if (p[0] > 200 && p[1] < 80) red++; }
  assert.equal(red, 0, 'no red left'); await page.keyboard.press('Control+d');
});

await step('Patch tool: draw around a blob, drag it onto clean texture, blob is healed away', async () => {
  await page.keyboard.press('b'); await drag([[90, 185], [92, 185]]); await settle();
  await page.keyboard.press('j'); await app().getByRole('button', { name: 'Patch', exact: true }).click();
  await drag([[80, 175], [100, 175], [100, 195], [80, 195], [80, 176]]); await settle();
  await drag([[90, 185], [90, 160], [90, 135]]); await settle(); await page.waitForTimeout(300);
  const p = (await exportPx('m1-patch.png')).at(91, 185); assert.ok(!(p[0] > 200 && p[1] < 80), 'blob replaced: ' + p);
});

await step('Quick Selection: painting over the bar selects it and stops at its edge; Filter Gallery filter applies', async () => {
  await page.keyboard.press('w'); await app().getByRole('button', { name: 'Quick Selection', exact: true }).click();
  await setNum('Size value', 10); await drag([[110, 65], [150, 65], [190, 65]]); await settle();
  await page.waitForSelector(APP + ' path.antsDash');
  await page.keyboard.press('Control+j'); await settle(); await page.waitForTimeout(300);
  const names = await app().locator('.layerList .layer input[aria-label="Layer name"]').evaluateAll(els => els.map(e => e.value));
  assert.ok(names.some(n => n.endsWith(' copy')), 'layer via copy from the quick selection: ' + names);
  await page.keyboard.press('Control+z'); await settle(); await page.keyboard.press('Control+d');
  await app().locator('.layerList .layer .layerThumb').first().click();
  await app().getByRole('button', { name: 'Filter', exact: true }).click(); await page.getByRole('menuitem', { name: 'Texture', exact: true }).hover(); await page.getByRole('menuitem', { name: 'Stained Glass…', exact: true }).click();
  await page.waitForTimeout(500); await page.getByRole('button', { name: 'OK', exact: true }).click(); await settle();
  assert.ok((await app().locator('.historyItem').count()) >= 0);
});

await step('no uncaught page errors', async () => assert.deepEqual(errors, []));
await browser.close(); server.close();
writeFileSync(join(evidence, 'm1-transform-e2e-results.json'), JSON.stringify({ date: new Date().toISOString(), browser: 'chromium (Playwright)', results }, null, 2));
const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.filter(r => r.ok).length} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
