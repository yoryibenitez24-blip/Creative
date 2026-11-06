// Browser acceptance test for the E-commerce studio (src/ecom/EcomWorkspace.jsx).
// Builds a harness page (into a temp dir) that mounts EcomWorkspace with a real AssetStore, the real
// ops worker (dist/ops-worker.js) and the real on-device AI client (dist/ai-worker.js, dist/ort,
// dist/models). Serves dist/ plus the harness, drives the UI with real input.
// Run: npm run build (or node scripts/copy-models.mjs once) && node tests/e2e/ecom.e2e.mjs
import { createRequire } from 'node:module';
import http from 'node:http';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { readZip } from '../../src/ecom/zip.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const repo = join(fileURLToPath(new URL('.', import.meta.url)), '../..'), dist = join(repo, 'dist');

// ---- harness: IndexedDB-backed asset store (so a reload keeps the photos), real workers
const work = await mkdtemp(join(tmpdir(), 'ecom-e2e-'));
await writeFile(join(work, 'harness.jsx'), `
import React from 'react';
import { createRoot } from 'react-dom/client';
import EcomWorkspace from ${JSON.stringify(join(repo, 'src/ecom/EcomWorkspace.jsx'))};
import { AssetStore } from ${JSON.stringify(join(repo, 'src/engine/assets.js'))};
import { createOpsClient } from ${JSON.stringify(join(repo, 'src/editor/opsClient.js'))};
import { aiSegment } from ${JSON.stringify(join(repo, 'src/editor/aiClient.js'))};
const db = new Promise((res, rej) => { const r = indexedDB.open('ecom-harness-assets', 1); r.onupgradeneeded = () => r.result.createObjectStore('a'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const op = (mode, fn) => db.then(d => new Promise((res, rej) => { const q = fn(d.transaction('a', mode).objectStore('a')); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }));
const backend = { get: id => op('readonly', s => s.get(id)), put: (id, b) => op('readwrite', s => s.put(b, id)), keys: () => op('readonly', s => s.getAllKeys()), delete: id => op('readwrite', s => s.delete(id)) };
const store = new AssetStore(backend), ops = createOpsClient();
window.__designer = []; window.__exited = 0;
createRoot(document.getElementById('root')).render(<EcomWorkspace assetStore={store} runOp={ops.run} aiSegment={aiSegment}
  onEditInDesigner={async (blob, name) => { const bmp = await createImageBitmap(blob); window.__designer.push({ name, type: blob.type, size: blob.size, w: bmp.width, h: bmp.height }); }}
  onExit={() => { window.__exited++; }} />);
`);
await build({ entryPoints: [join(work, 'harness.jsx')], bundle: true, outfile: join(work, 'harness.js'), loader: { '.jsx': 'jsx' }, nodePaths: [join(repo, 'node_modules')], logLevel: 'error' });
await writeFile(join(work, 'harness.html'), `<!doctype html><html><head><meta charset="utf-8"><title>E-commerce harness</title>
<link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/css/modern.css"><link rel="stylesheet" href="/css/ecom.css"></head>
<body><div id="root"></div><script src="/harness.js"></script></body></html>`);

const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.onnx': 'application/octet-stream' };
const server = await new Promise(res => { const s = http.createServer(async (req, rsp) => {
  const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^[/\\]+/, '');
  const file = p === 'harness.html' || p === 'harness.js' ? join(work, p) : join(dist, p);
  try { const body = await readFile(file); rsp.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' }); rsp.end(body); } catch { rsp.writeHead(404); rsp.end(); }
}); s.listen(0, '127.0.0.1', () => res(s)); });
const url = `http://127.0.0.1:${server.address().port}/harness.html`;

// ---- synthetic product photos: grey studio sweep + product
function photo(w, h, kind) {
  const c = createCanvas(w, h), x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#d8d8dc'); g.addColorStop(1, '#b9b9be'); x.fillStyle = g; x.fillRect(0, 0, w, h);
  if (kind === 'bottle') {
    x.fillStyle = '#e8781e'; x.beginPath(); x.roundRect(w * 0.4, h * 0.3, w * 0.2, h * 0.55, 40); x.fill();
    x.fillStyle = '#2b2b30'; x.fillRect(w * 0.46, h * 0.2, w * 0.08, h * 0.12);
  } else {
    x.fillStyle = '#2f62d8'; x.fillRect(w * 0.22, h * 0.2, w * 0.56, h * 0.62);
    x.fillStyle = '#ffd23f'; x.fillRect(w * 0.22, h * 0.45, w * 0.56, h * 0.06);
  }
  return c;
}
const files = [
  { name: 'orange-bottle.jpg', mimeType: 'image/jpeg', buffer: photo(2400, 2000, 'bottle').toBuffer('image/jpeg', 92) },
  { name: 'blue-box.png', mimeType: 'image/png', buffer: photo(1800, 2200, 'box').toBuffer('image/png') },
];

// ---- runner
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true })).newPage();
const errors = []; page.on('pageerror', e => { console.log('PAGE ERROR', e.message); errors.push(e.message); });
const results = []; let setupFailed = false;
const step = async (name, fn) => { if (setupFailed) { results.push({ name, ok: false }); console.log('SKIP ' + name); return; } const t0 = Date.now(); try { await fn(); results.push({ name, ok: true }); console.log(`ok   ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)`); } catch (e) { results.push({ name, ok: false }); console.log('FAIL ' + name + '\n     ' + e.message.split('\n').slice(0, 4).join(' | ')); if (name.startsWith('setup')) setupFailed = true; } };
const studio = () => page.getByRole('region', { name: 'E-commerce studio' });
const idle = () => page.waitForTimeout(220).then(() => page.waitForFunction(() => { const r = document.querySelector('.ecom'); return r && r.dataset.busy === '0' && r.dataset.rendering === '0'; }, null, { timeout: 120000 })).then(() => page.waitForTimeout(150));
const previewPx = (nx, ny, sel = 'canvas[aria-label="Product preview"]') => page.evaluate(([sel, nx, ny]) => { const c = document.querySelector(sel), d = c.getContext('2d').getImageData(Math.round(nx * (c.width - 1)), Math.round(ny * (c.height - 1)), 1, 1).data; return [...d]; }, [sel, nx, ny]);
const renders = sel => page.evaluate(s => +document.querySelector(s).dataset.renders, sel);
const shot = async n => { if (process.env.ECOM_SHOTS) await page.screenshot({ path: join(process.env.ECOM_SHOTS, n + '.png') }); };
const tab = name => page.getByRole('tab', { name, exact: true }).click();
const statuses = () => page.locator('.ecTile .ecBadge').evaluateAll(els => els.map(e => e.dataset.status));

await step('setup: harness mounts with an empty project', async () => {
  await page.goto(url); await studio().waitFor();
  await page.getByRole('combobox', { name: 'Project' }).waitFor();
});

await step('import two product photos (file input, multiple)', async () => {
  await page.getByLabel('Import product photos').setInputFiles(files);
  await page.getByRole('option', { name: 'blue-box.png' }).waitFor();
  assert.equal(await page.getByRole('listbox', { name: 'Product photos' }).getByRole('option').count(), 2);
  assert.deepEqual(await statuses(), ['imported', 'imported']);
});

await step('remove background of both (on-device U²-Netp) with progress', async () => {
  await page.getByRole('button', { name: 'Select all' }).click();
  await page.getByRole('button', { name: /Remove background \(2\)/ }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('.ecTile .ecBadge')].every(b => b.dataset.status === 'cut'), null, { timeout: 180000 });
  await idle();
  // result view on white: corner white, centre is the product (orange bottle or blue box)
  await page.getByRole('option', { name: 'orange-bottle.jpg' }).click(); await idle();
  assert.deepEqual(await previewPx(0, 0), [255, 255, 255, 255]);
  const mid = await previewPx(0.5, 0.55); assert.ok(mid[0] > 180 && mid[2] < 90, 'orange product in the middle: ' + mid);
});

await step('touch-up brush erases part of the matte, undo restores it', async () => {
  await page.getByRole('group', { name: 'Preview' }).getByRole('button', { name: 'Cutout & touch-up' }).click(); await idle();
  await page.getByRole('group', { name: 'Brush mode' }).getByRole('button', { name: /Erase/ }).click();
  await page.getByLabel('Brush size value').fill('6');
  const before = await renders('canvas[aria-label="Product preview"]');
  const box = await page.locator('canvas[aria-label="Product preview"]').boundingBox();
  const at = (nx, ny) => [box.x + nx * box.width, box.y + ny * box.height];
  const p0 = await previewPx(0.5, 0.6); assert.ok(p0[0] > 180, 'product visible before: ' + p0);
  await page.mouse.move(...at(0.45, 0.6)); await page.mouse.down(); for (let k = 1; k <= 8; k++) await page.mouse.move(...at(0.45 + k * 0.0125, 0.6)); await page.mouse.up();
  await page.waitForFunction(([s, n]) => +document.querySelector(s).dataset.renders > n, ['canvas[aria-label="Product preview"]', before], { timeout: 60000 }); await idle();
  await shot('touchup');
  const p1 = await previewPx(0.5, 0.6); assert.ok(p1[0] < 245 && Math.abs(p1[0] - p1[2]) < 60, 'erased area shows the checkerboard / faint original: ' + p1);
  await page.getByRole('button', { name: 'Undo stroke' }).click(); await idle();
  const p2 = await previewPx(0.5, 0.6); assert.ok(p2[0] > 180 && p2[2] < 90, 'undo restores the product: ' + p2);
  await page.getByRole('group', { name: 'Preview' }).getByRole('button', { name: 'Result' }).click(); await idle();
});

await step('white background + Amazon preset: full-size checklist passes', async () => {
  await tab('Background');
  assert.equal(await page.getByRole('group', { name: 'Background type' }).getByRole('button', { name: 'White' }).getAttribute('aria-pressed'), 'true');
  await tab('Marketplace');
  await page.getByRole('radio', { name: 'Amazon main image' }).check();
  const list = page.getByRole('list', { name: 'Marketplace checklist' });
  await page.waitForFunction(() => document.querySelector('.ecChecklist')?.dataset.full === '1', null, { timeout: 120000 });
  const rows = await list.locator('li').evaluateAll(els => els.map(e => e.dataset.status + ' ' + e.textContent));
  assert.ok(rows.length >= 5 && rows.every(r => r.startsWith('pass')), rows.join(' | '));
  assert.ok(rows.some(r => /File size/.test(r) && /KB|MB/.test(r)), 'file size measured');
  assert.ok(rows.some(r => /Pure white background/.test(r) && /100 %/.test(r)));
  await shot('marketplace');
});

await step('contact shadow: checklist warns about the non-white floor, edges stay white', async () => {
  await tab('Background');
  await page.getByLabel('Contact shadow', { exact: true }).check(); await idle(); await shot('shadow');
  await tab('Marketplace');
  await page.waitForFunction(() => document.querySelector('.ecChecklist')?.dataset.full === '1', null, { timeout: 120000 });
  const white = await page.locator('.ecChecklist li', { hasText: 'Pure white background' }).getAttribute('data-status');
  assert.equal(white, 'warn');
  await tab('Background'); await page.getByLabel('Contact shadow', { exact: true }).uncheck(); await idle();
});

const extent = () => page.evaluate(() => { const c = document.querySelector('canvas[aria-label="Product preview"]'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let y0 = c.height, y1 = -1; for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x += 3) { const i = (y * c.width + x) * 4; if (d[i] < 240 || d[i + 2] < 240) { if (y < y0) y0 = y; y1 = y; break; } } return { top: y0 / c.height, bottom: (y1 + 1) / c.height, h: (y1 - y0 + 1) / c.height }; });
await step('layout: bottom alignment and uniform batch scale', async () => {
  await page.getByRole('option', { name: 'orange-bottle.jpg' }).click(); await idle();
  const fit = await extent(); assert.ok(Math.abs(fit.h - 0.85) < 0.02, 'fit fills 85 %: ' + JSON.stringify(fit));
  await tab('Layout');
  await page.getByRole('group', { name: 'Batch sizing' }).getByRole('button', { name: 'Uniform scale' }).click(); await idle();
  const uni = await extent(); // the blue box is relatively larger in its photo, so the bottle shrinks to keep proportions
  assert.ok(uni.h < fit.h - 0.05 && uni.h > 0.6, 'uniform: ' + JSON.stringify(uni));
  await page.getByRole('option', { name: 'blue-box.png' }).click(); await idle();
  const box = await extent(); assert.ok(Math.abs(box.h - 0.85) < 0.02, 'largest product fills the frame: ' + JSON.stringify(box));
  await page.getByRole('group', { name: 'Alignment' }).getByRole('button', { name: /Bottom/ }).click(); await page.getByLabel('Margin value').fill('5'); await idle();
  const bot = await extent(); assert.ok(Math.abs(bot.bottom - 0.95) < 0.01, 'stands on the floor line: ' + JSON.stringify(bot));
  await page.getByRole('group', { name: 'Alignment' }).getByRole('button', { name: 'Centre' }).click();
  await page.getByRole('group', { name: 'Batch sizing' }).getByRole('button', { name: 'Fill frame' }).click();
  await page.getByRole('button', { name: /Use Amazon main image fill/ }).click(); await idle();
  assert.equal(await page.getByLabel('Margin value').inputValue(), '7.5');
});

await step('gradient background and light retouch (Camera Raw op in the worker)', async () => {
  await page.getByRole('option', { name: 'orange-bottle.jpg' }).click();
  await tab('Background'); await page.getByRole('group', { name: 'Background type' }).getByRole('button', { name: 'Gradient' }).click();
  await page.getByLabel('Gradient start colour').fill('#000000'); await page.getByLabel('Gradient end colour').fill('#ffffff'); await idle();
  const top = await previewPx(0.5, 0.01), bottom = await previewPx(0.5, 0.99); assert.ok(top[0] < 20 && bottom[0] > 235, `gradient ${top} → ${bottom}`);
  await page.getByRole('group', { name: 'Background type' }).getByRole('button', { name: 'White' }).click(); await idle();
  const before = await previewPx(0.5, 0.6);
  await tab('Retouch'); await page.getByLabel('Brightness value').fill('60'); await idle();
  const after = await previewPx(0.5, 0.6); assert.ok(after[1] > before[1] + 15, `brighter ${before} → ${after}`);
  assert.deepEqual(await previewPx(0, 0), [255, 255, 255, 255]);
  await page.getByRole('button', { name: 'Reset retouch' }).click(); await idle();
  const back = await previewPx(0.5, 0.6); assert.ok(Math.abs(back[1] - before[1]) <= 2, 'reset restores ' + back);
});

await step('export: ZIP with 2 JPEGs of 2000 × 2000 with exact white corners', async () => {
  await tab('Export');
  assert.equal(await page.getByLabel('Export Amazon main image').isChecked(), true);
  await page.getByRole('group', { name: 'Export format' }).getByRole('button', { name: 'JPEG' }).click();
  await page.getByRole('group', { name: 'Photos to export' }).getByRole('button', { name: /All/ }).click();
  await page.getByLabel('File name template').fill('{n}-{name}-{preset}');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 180000 }), page.getByRole('button', { name: 'Export', exact: true }).click()]);
  assert.match(dl.suggestedFilename(), /\.zip$/);
  const zip = readZip(readFileSync(await dl.path()));
  assert.deepEqual(zip.map(f => f.name).sort(), ['01-orange-bottle-amazon.jpg', '02-blue-box-amazon.jpg']);
  for (const f of zip) {
    const img = await loadImage(Buffer.from(f.data)); assert.equal(img.width, 2000); assert.equal(img.height, 2000);
    const c = createCanvas(2000, 2000), x = c.getContext('2d'); x.drawImage(img, 0, 0);
    for (const [px, py] of [[0, 0], [1999, 0], [0, 1999], [1999, 1999]]) assert.deepEqual([...x.getImageData(px, py, 1, 1).data], [255, 255, 255, 255], f.name + ' corner');
    const mid = [...x.getImageData(1000, 1100, 1, 1).data]; assert.ok(mid[0] < 250 || mid[2] < 250, f.name + ' has the product: ' + mid);
    // product fills ~85 % of the frame (Amazon): measure the non-white extent along the long side
    const d = x.getImageData(0, 0, 2000, 2000).data; let y0 = 2000, y1 = -1, x0 = 2000, x1 = -1;
    for (let y = 0; y < 2000; y += 2) for (let xx = 0; xx < 2000; xx += 2) { const i = (y * 2000 + xx) * 4; if (d[i] < 235 || d[i + 1] < 235 || d[i + 2] < 235) { if (y < y0) y0 = y; if (y > y1) y1 = y; if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; } }
    const fill = Math.max(y1 - y0, x1 - x0) / 2000; assert.ok(fill > 0.8 && fill < 0.9, f.name + ' fill ' + fill.toFixed(3));
  }
});

await step('banner template renders the cut-out product; PNG download and Open in Designer', async () => {
  await page.getByRole('option', { name: 'orange-bottle.jpg' }).click();
  await tab('Templates');
  await page.getByRole('radio', { name: /Sale banner/ }).click();
  await page.waitForFunction(() => +document.querySelector('canvas[aria-label="Template preview"]').dataset.renders > 0, null, { timeout: 60000 });
  await page.getByLabel('Headline', { exact: true }).fill('Mega Bottle Sale');
  await page.waitForTimeout(400);
  const size = await page.evaluate(() => { const c = document.querySelector('canvas[aria-label="Template preview"]'); return [c.width, c.height]; });
  assert.deepEqual(size, [1200, 628]);
  const prod = await previewPx(0.74, 0.62, 'canvas[aria-label="Template preview"]'); assert.ok(prod[0] > 180 && prod[2] < 90, 'product in the slot: ' + prod);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download PNG' }).click()]);
  const img = await loadImage(readFileSync(await dl.path())); assert.deepEqual([img.width, img.height], [1200, 628]); assert.match(dl.suggestedFilename(), /\.png$/);
  await shot('template');
  await page.getByRole('button', { name: 'Open in Designer' }).click();
  await page.waitForFunction(() => window.__designer.length === 1);
  const d = await page.evaluate(() => window.__designer[0]); assert.equal(d.type, 'image/png'); assert.deepEqual([d.w, d.h], [1200, 628]);
  for (const t of ['Instagram post', 'Story', 'Product card', 'Discount badge', 'New arrival']) {
    const n = await renders('canvas[aria-label="Template preview"]');
    await page.getByRole('radio', { name: new RegExp(t) }).click();
    await page.waitForFunction(([s, n]) => +document.querySelector(s).dataset.renders > n, ['canvas[aria-label="Template preview"]', n]);
  }
});

await step('project persists in IndexedDB across a reload (mattes cached)', async () => {
  await page.waitForTimeout(600); await page.reload(); await studio().waitFor();
  await page.getByRole('option', { name: 'blue-box.png' }).waitFor();
  assert.deepEqual(await statuses(), ['cut', 'cut']);
  await page.waitForFunction(() => +document.querySelector('canvas[aria-label="Product preview"]').dataset.renders > 0, null, { timeout: 60000 });
  assert.deepEqual(await previewPx(0, 0), [255, 255, 255, 255]);
  await page.getByRole('button', { name: 'Exit' }).click(); await page.waitForFunction(() => window.__exited === 1);
});

await step('no uncaught page errors', async () => { assert.deepEqual(errors, []); });

await browser.close(); server.close(); await rm(work, { recursive: true, force: true });
const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
