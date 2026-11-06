// Browser acceptance tests for the Milestone 1 vertical slice.
// Every action uses real pointer/keyboard input through Playwright. page.evaluate
// is used only to READ geometry (screen mapping) and pixels for verification.
// Run: npm run build && node tests/e2e/slice.e2e.mjs
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
const url = 'http://127.0.0.1:' + server.address().port + '/#design';
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const results = [];
const step = async (name, fn) => { const t = Date.now(); try { await fn(); results.push({ name, ok: true, ms: Date.now() - t }); console.log('ok   ' + name); } catch (e) { results.push({ name, ok: false, error: e.message }); console.log('FAIL ' + name + '\n     ' + e.message); } };

const APP = 'div.app[style*="display: flex"]';
const app = () => page.locator(APP);
const W = 400, H = 300;

async function mapping() {
  return page.evaluate(sel => { const m = document.querySelector(sel + ' .artboardContainer svg').getScreenCTM(); return { a: m.a, d: m.d, e: m.e, f: m.f }; }, APP);
}
const toScreen = (m, x, y) => ({ x: m.a * x + m.e, y: m.d * y + m.f });
async function drag(points, opts = {}) {
  const m = await mapping();
  const s = points.map(([x, y]) => toScreen(m, x, y));
  if (opts.modifier) await page.keyboard.down(opts.modifier);
  await page.mouse.move(s[0].x, s[0].y);
  await page.mouse.down();
  for (const p of s.slice(1)) await page.mouse.move(p.x, p.y, { steps: 4 });
  await page.mouse.up();
  if (opts.modifier) await page.keyboard.up(opts.modifier);
}
const linePts = (x0, y0, x1, y1, n = 24) => Array.from({ length: n + 1 }, (_, i) => [x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n]);
async function alpha() {
  return page.evaluate(sel => { const c = document.querySelector(sel + ' canvas.rasterSurface'); if (!c) return null; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; const a = new Array(c.width * c.height); for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3]; return a; }, APP);
}
const settle = () => page.waitForTimeout(120).then(() => page.waitForFunction(sel => { const a = document.querySelector(sel); return a && a.dataset.work === '0' && !document.querySelector('.opDialog') && a.querySelector('.saveStatus')?.textContent.includes('Saved locally'); }, APP, { timeout: 20000 })).then(() => page.waitForTimeout(150));
async function setOption(label, value) { const i = app().getByLabel(label + ' value', { exact: true }); await i.fill(String(value)); await i.blur(); }
async function setZoom(target) {
  await app().locator('.zoomControls button', { hasText: '%' }).click(); // 100%
  const plus = app().getByRole('button', { name: 'Zoom in' });
  for (let z = 1; z < target - 1e-9; z += 0.1) await plus.click();
}
const layerCount = async () => app().locator('.layerList .layer').count();

await page.goto(url);
await page.waitForSelector(APP);

await step('create a new 400×300 document in its own tab', async () => {
  const tabsBefore = await app().locator('.docTab').count();
  await app().getByTitle('New design').click();
  await app().getByLabel('New width').fill(String(W));
  await app().getByLabel('New height').fill(String(H));
  await app().getByRole('button', { name: /Create design/ }).click();
  await page.waitForFunction(([sel, n]) => document.querySelectorAll(sel + ' .docTab').length === n, [APP, tabsBefore + 1]);
  assert.match(await app().locator('.artboardLabel').innerText(), /400 × 300/);
});

let strokeAt1;
await step('A1: brush stroke at 100% zoom paints a new paint layer in document space', async () => {
  await app().getByTitle('Brush (B)', { exact: true }).click();
  await setOption('Size', 20); await setOption('Hardness', 100); await setOption('Spacing', 10);
  await setZoom(1);
  await drag(linePts(40, 60, 360, 240));
  await settle();
  assert.equal(await layerCount(), 1);
  strokeAt1 = await alpha();
  const painted = strokeAt1.filter(v => v > 0).length;
  assert.ok(painted > 5000 && painted < 12000, 'painted pixel count ' + painted);
  assert.equal(strokeAt1[150 * W + 200], 255, 'centre of the line is opaque');
  assert.equal(strokeAt1[10 * W + 390], 0, 'far corner untouched');
});

await step('A1: undo removes exactly the stroke and keeps the layer', async () => {
  await page.keyboard.press('Control+z');
  await settle();
  const a = await alpha();
  assert.equal(a.filter(v => v > 0).length, 0);
  assert.equal(await layerCount(), 1);
  await page.keyboard.press('Control+Shift+z');
  await settle();
  assert.deepEqual(await alpha(), strokeAt1, 'redo restores identical pixels');
  await page.keyboard.press('Control+z');
  await settle();
});

await step('A1: the same document-space stroke at 200% zoom matches the 100% result', async () => {
  await setZoom(2);
  const m = await mapping();
  assert.ok(Math.abs(m.a - 2) < 0.01, 'zoom is 200%: ' + m.a);
  await drag(linePts(40, 60, 360, 240));
  await settle();
  const at2 = await alpha();
  let diff = 0, maxd = 0;
  for (let i = 0; i < at2.length; i++) { const d = Math.abs(at2[i] - strokeAt1[i]); if (d > 2) diff++; maxd = Math.max(maxd, d); }
  results.push({ name: 'zoom comparison metrics', ok: true, differingPixels: diff, maxAlphaDelta: maxd });
  assert.ok(diff <= 0.01 * strokeAt1.filter(v => v > 0).length, `${diff} pixels differ (max delta ${maxd})`);
  await page.keyboard.press('Control+z');
  await settle();
  await setZoom(1);
});

let edgeRow;
await step('A2: feathered marquee restricts the brush; fill and export keep the same alpha boundary', async () => {
  await app().getByTitle('Marquee (M)', { exact: true }).click();
  await setOption('Feather', 8);
  await drag([[50, 50], [120, 150], [200, 250]]);
  await settle();
  assert.ok((await app().locator('path.antsDash').getAttribute('d')).length > 10, 'marching ants rendered');
  await app().getByTitle('Brush (B)', { exact: true }).click();
  await setOption('Size', 60);
  await drag(linePts(20, 150, 380, 150));
  await settle();
  const a = await alpha();
  assert.equal(a[150 * W + 120], 255, 'inside selection painted');
  assert.equal(a[150 * W + 300], 0, 'outside selection untouched');
  const edge = a[150 * W + 200];
  assert.ok(edge > 40 && edge < 220, 'feathered edge is partial: ' + edge);
  // Fill with foreground inside the selection (Alt+Backspace)
  await page.keyboard.press('Alt+Backspace');
  await settle();
  const f = await alpha();
  assert.equal(f[100 * W + 120], 255); assert.equal(f[100 * W + 300], 0); assert.equal(f[20 * W + 120], 0);
  edgeRow = f.slice(100 * W, 101 * W);
  await page.screenshot({ path: join(evidence, 'm1-feathered-selection.png') });
  // Export PNG and compare the composite against the layer alpha over the background
  await app().locator('button.export').click();
  const [dl] = await Promise.all([page.waitForEvent('download'), app().getByRole('button', { name: /Download PNG/ }).click()]); await page.waitForFunction(() => !document.querySelector('.modalBackdrop'));
  const png = readFileSync(await dl.path());
  writeFileSync(join(evidence, 'm1-export.png'), png);
  const img = await loadImage(png);
  assert.equal(img.width, W); assert.equal(img.height, H);
  const c = createCanvas(W, H); const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
  const px = ctx.getImageData(0, 100, W, 1).data;
  const bg = [0xf4, 0xf1, 0xea];
  let worst = 0;
  for (let x = 0; x < W; x++) { const t = edgeRow[x] / 255; for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(px[x * 4 + k] - Math.round(bg[k] * (1 - t)))); }
  results.push({ name: 'export boundary metrics', ok: true, maxChannelDelta: worst });
  assert.ok(worst <= 3, 'export differs from on-canvas alpha by ' + worst);
});

await step('selection commands: deselect, reselect, inverse, clear, lasso', async () => {
  await page.keyboard.press('Control+d');
  assert.equal(await app().locator('path.antsDash').count(), 0);
  await page.keyboard.press('Control+Shift+d');
  assert.equal(await app().locator('path.antsDash').count(), 1);
  await page.keyboard.press('Control+Shift+i');
  await page.keyboard.press('Delete'); // clears pixels outside the old selection: nothing there to clear
  await settle();
  const a = await alpha();
  assert.equal(a[100 * W + 120], 255, 'inverse+clear leaves the selected interior');
  await page.keyboard.press('Control+z'); await settle(); // undo clear
  await page.keyboard.press('Control+z'); await settle(); // undo inverse
  await page.keyboard.press('Delete'); // clear inside the original selection
  await settle();
  const b = await alpha();
  assert.equal(b[100 * W + 120], 0, 'clear removed selected pixels');
  await page.keyboard.press('Control+z'); await settle();
  await app().getByTitle('Lasso (L)', { exact: true }).click();
  await drag([[250, 40], [380, 60], [360, 200], [260, 180]]);
  await settle();
  assert.ok((await app().locator('path.antsDash').getAttribute('d')).length > 10, 'lasso selection rendered');
  await page.keyboard.press('Control+d');
});

let beforeReload;
await step('persistence: paint layer pixels survive reload from local storage', async () => {
  await settle();
  beforeReload = await alpha();
  await page.reload();
  await page.waitForSelector(APP);
  await page.waitForFunction(sel => { const c = document.querySelector(sel + ' canvas.rasterSurface'); if (!c) return false; const d = c.getContext('2d').getImageData(120, 100, 1, 1).data; return d[3] === 255; }, APP, { timeout: 10000 });
  assert.deepEqual(await alpha(), beforeReload);
});

await step('native project: .zertake envelope stores pixels once and reopens identically', async () => {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+s')]);
  const json = JSON.parse(readFileSync(await dl.path(), 'utf8'));
  assert.equal(json.format, 'zertake-project');
  assert.equal(json.schemaVersion, 4);
  const raster = json.document.layers.filter(l => l.type === 'raster');
  assert.equal(raster.length, 1);
  assert.deepEqual(Object.keys(json.assets), [raster[0].assetId]);
  const path = join(evidence, 'm1-roundtrip.zertake');
  writeFileSync(path, JSON.stringify(json));
  const tabs = await app().locator('.docTab').count();
  await app().locator('input[type=file][accept*="zertake"]').first().setInputFiles(path);
  await page.waitForFunction(([sel, n]) => document.querySelectorAll(sel + ' .docTab').length === n, [APP, tabs + 1]);
  await page.waitForFunction(sel => { const c = document.querySelector(sel + ' canvas.rasterSurface'); return c && c.getContext('2d').getImageData(120, 100, 1, 1).data[3] === 255; }, APP, { timeout: 10000 });
  assert.deepEqual(await alpha(), beforeReload);
});

await step('no uncaught page errors', async () => { assert.deepEqual(errors, []); });

await browser.close();
server.close();
writeFileSync(join(evidence, 'm1-e2e-results.json'), JSON.stringify({ date: new Date().toISOString(), browser: 'chromium (Playwright)', results }, null, 2));
const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.filter(r => r.ok).length} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
