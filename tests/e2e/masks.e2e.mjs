// Browser acceptance tests for raster layer masks. Real pointer/keyboard input only;
// results are judged on the exported PNG (what the user ships), not on internal state.
// Run: npm run build && node tests/e2e/masks.e2e.mjs
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
const errors = []; page.on('pageerror', e => errors.push(e.message));
const results = [];
const step = async (name, fn) => { try { await fn(); results.push({ name, ok: true }); console.log('ok   ' + name); } catch (e) { results.push({ name, ok: false, error: e.message }); console.log('FAIL ' + name + '\n     ' + e.message); } };
const metric = (name, values) => { results.push({ name, ok: true, ...values }); };

const APP = 'div.app[style*="display: flex"]';
const app = () => page.locator(APP);
const W = 400, H = 300, BG = 244; // document background #f4f1ea, red channel
const mapping = () => page.evaluate(sel => { const m = document.querySelector(sel + ' .artboardContainer svg').getScreenCTM(); return { a: m.a, d: m.d, e: m.e, f: m.f }; }, APP);
async function drag(points) {
  const m = await mapping(); const s = points.map(([x, y]) => ({ x: m.a * x + m.e, y: m.d * y + m.f }));
  await page.mouse.move(s[0].x, s[0].y); await page.mouse.down();
  for (const p of s.slice(1)) await page.mouse.move(p.x, p.y, { steps: 6 });
  await page.mouse.up();
}
const settle = () => page.waitForTimeout(120).then(() => page.waitForFunction(sel => { const a = document.querySelector(sel); return a && a.dataset.work === '0' && !document.querySelector('.opDialog') && a.querySelector('.saveStatus')?.textContent.includes('Saved locally'); }, APP, { timeout: 20000 })).then(() => page.waitForTimeout(150));
async function setNumber(label, value) { const i = app().getByLabel(label, { exact: true }); await i.fill(String(value)); await i.blur(); await settle(); }
async function exportRed(name) {
  await app().locator('button.export').click();
  const [dl] = await Promise.all([page.waitForEvent('download'), app().getByRole('button', { name: /Download PNG/ }).click()]); await page.waitForFunction(() => !document.querySelector('.modalBackdrop'));
  const png = readFileSync(await dl.path());
  if (name) writeFileSync(join(evidence, name), png);
  const img = await loadImage(png); const c = createCanvas(W, H); const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, W, H).data; const r = new Uint8Array(W * H); for (let i = 0; i < r.length; i++) r[i] = d[i * 4]; return r;
}
const at = (r, x, y) => r[y * W + x];
const near = (v, want, tol, what) => assert.ok(Math.abs(v - want) <= tol, `${what}: ${v} (want ${want}±${tol})`);
const maskLoaded = () => page.waitForFunction(sel => [...document.querySelectorAll(sel + ' image[data-mask-surface]')].every(i => (i.getAttribute('href') || '').startsWith('blob:')), APP, { timeout: 10000 });

await page.goto('http://127.0.0.1:' + server.address().port + '/#design');
await page.waitForSelector(APP);

await step('setup: black paint layer filling a 400×300 document', async () => {
  await app().getByTitle('New design').click();
  await app().getByLabel('New width').fill(String(W)); await app().getByLabel('New height').fill(String(H));
  await app().getByRole('button', { name: /Create design/ }).click();
  await page.waitForFunction(sel => document.querySelector(sel + ' .artboardLabel')?.textContent.includes('400 × 300'), APP);
  await page.keyboard.press('Control+Shift+n');
  await page.keyboard.press('Control+a'); await page.keyboard.press('Alt+Backspace'); await settle(); await page.keyboard.press('Control+d');
  const r = await exportRed();
  assert.equal(at(r, 300, 150), 0);
});

await step('reveal selection: mask from a marquee hides the rest, selection is consumed', async () => {
  await app().getByTitle('Marquee (M)', { exact: true }).click();
  await drag([[-5, -5], [100, 150], [200, 305]]);
  await settle();
  await app().getByRole('button', { name: 'Reveal selection' }).click();
  await settle(); await maskLoaded();
  assert.equal(await app().locator('path.antsDash').count(), 0, 'selection cleared');
  assert.equal(await app().getByRole('button', { name: 'Layer mask of Paint layer 1' }).count(), 1, 'mask chip shown');
  const r = await exportRed('m1-mask-reveal.png');
  assert.equal(at(r, 100, 150), 0); assert.equal(at(r, 300, 150), BG);
});

await step('paint on the mask: black hides, undo restores exactly', async () => {
  await page.keyboard.press('b');
  assert.equal(await app().locator('.maskTag').count(), 1, 'options bar shows the mask target');
  await setNumber('Size value', 40); await setNumber('Hardness value', 100);
  await drag([[100, 100], [100, 200]]);
  await settle(); await maskLoaded();
  let r = await exportRed();
  assert.equal(at(r, 100, 150), BG, 'hidden under the mask stroke'); assert.equal(at(r, 50, 150), 0, 'outside stroke still visible');
  await page.keyboard.press('Control+z'); await settle(); await page.waitForTimeout(300);
  r = await exportRed();
  assert.equal(at(r, 100, 150), 0, 'undo removed the mask stroke');
});

await step('density 50% reveals hidden areas at half strength', async () => {
  await setNumber('Mask density value', 50);
  const r = await exportRed();
  near(at(r, 300, 150), Math.round(BG / 2), 3, 'hidden area at 50% density');
  assert.equal(at(r, 100, 150), 0);
  await setNumber('Mask density value', 100);
});

await step('feather 10 px softens the mask edge symmetrically', async () => {
  await setNumber('Mask feather value', 10);
  const r = await exportRed('m1-mask-feather.png');
  near(at(r, 200, 150), BG / 2, 14, 'edge midpoint');
  assert.ok(at(r, 185, 150) < 40 && at(r, 215, 150) > BG - 40, `ramp ${at(r, 185, 150)} → ${at(r, 215, 150)}`);
  near(at(r, 190, 150) + at(r, 209, 150), BG, 6, 'symmetric around the edge');
  await setNumber('Mask feather value', 0);
});

await step('disable / enable the mask', async () => {
  await app().getByLabel('Mask enabled', { exact: true }).uncheck(); await settle();
  assert.equal(at(await exportRed(), 300, 150), 0, 'disabled mask shows everything');
  await app().getByLabel('Mask enabled', { exact: true }).check(); await settle();
  assert.equal(at(await exportRed(), 300, 150), BG);
});

await step('linked mask moves with the layer; undo restores both', async () => {
  await page.keyboard.press('v');
  await drag([[300, 150], [325, 150], [350, 150]]);
  await settle();
  let r = await exportRed();
  assert.equal(at(r, 225, 150), 0, 'inside moved mask'); assert.equal(at(r, 275, 150), BG, 'right of moved mask edge'); assert.equal(at(r, 25, 150), BG, 'layer moved right');
  await page.keyboard.press('Control+z'); await settle();
  r = await exportRed();
  assert.equal(at(r, 25, 150), 0); assert.equal(at(r, 225, 150), BG);
});

await step('invert mask swaps revealed and hidden areas', async () => {
  await app().getByRole('button', { name: 'Invert' }).click(); await settle(); await maskLoaded(); await page.waitForTimeout(300);
  let r = await exportRed();
  assert.equal(at(r, 100, 150), BG); assert.equal(at(r, 300, 150), 0);
  await page.keyboard.press('Control+z'); await settle(); await page.waitForTimeout(300);
  r = await exportRed();
  assert.equal(at(r, 100, 150), 0);
});

let beforeReload;
await step('mask and its properties persist across reload and in the .zertake file', async () => {
  await setNumber('Mask feather value', 6); await setNumber('Mask density value', 80);
  beforeReload = await exportRed();
  await page.reload(); await page.waitForSelector(APP); await maskLoaded(); await page.waitForTimeout(400);
  const after = await exportRed();
  let worst = 0; for (let i = 0; i < after.length; i++) worst = Math.max(worst, Math.abs(after[i] - beforeReload[i]));
  assert.ok(worst <= 1, 'max delta after reload ' + worst);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+s')]);
  const json = JSON.parse(readFileSync(await dl.path(), 'utf8'));
  const l = json.document.layers.find(x => x.mask);
  assert.equal(json.schemaVersion, 4); assert.ok(json.assets[l.mask.assetId], 'mask asset embedded once');
  assert.equal(l.mask.density, 0.8); assert.equal(l.mask.feather, 6);
});

await step('apply mask bakes into pixels with the same result as the live mask', async () => {
  await app().locator('.layerList .layer').first().click(); // select the layer again after reload
  const before = await exportRed();
  await app().getByRole('button', { name: 'Apply', exact: true }).click(); await settle(); await page.waitForTimeout(300);
  assert.equal(await app().getByRole('button', { name: 'Layer mask of Paint layer 1' }).count(), 0, 'mask removed');
  const after = await exportRed('m1-mask-applied.png');
  let worst = 0, over2 = 0; for (let i = 0; i < after.length; i++) { const dd = Math.abs(after[i] - before[i]); worst = Math.max(worst, dd); if (dd > 2) over2++; }
  metric('apply vs live mask (feather 6, density 80%)', { maxRedDelta: worst, pixelsOver2: over2, samples: [100, 190, 195, 200, 205, 210, 300].map(x => [x, before[150 * W + x], after[150 * W + x]]), topEdge: [0, 2, 5, 10].map(y => [y, before[y * W + 100], after[y * W + 100]]) });
  assert.ok(worst <= 6, 'live SVG mask vs baked mask differ by ' + worst);
  await page.keyboard.press('Control+z'); await settle();
  assert.equal(await app().getByRole('button', { name: 'Layer mask of Paint layer 1' }).count(), 1, 'undo restores the mask');
});

await step('no uncaught page errors', async () => assert.deepEqual(errors, []));
await page.screenshot({ path: join(evidence, 'm1-mask-ui.png') });
await browser.close(); server.close();
writeFileSync(join(evidence, 'm1-masks-e2e-results.json'), JSON.stringify({ date: new Date().toISOString(), browser: 'chromium (Playwright)', results }, null, 2));
const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.filter(r => r.ok).length} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
