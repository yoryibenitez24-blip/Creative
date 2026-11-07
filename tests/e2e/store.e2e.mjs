// Browser acceptance test for the online store builder (src/store/StoreBuilder.jsx).
// Builds a harness page (temp dir) that mounts StoreBuilder with an in-memory AssetStore, serves it, drives the UI,
// exports the store ZIP, unzips it and shops the exported static site from file:// (cart + WhatsApp checkout).
// Run: node tests/e2e/store.e2e.mjs   (no app build needed)
import { createRequire } from 'node:module';
import http from 'node:http';
import { readFile, mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, normalize, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createCanvas } from '@napi-rs/canvas';
import { readZip } from '../../src/ecom/zip.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const repo = join(fileURLToPath(new URL('.', import.meta.url)), '../..'), dist = join(repo, 'dist');

const work = await mkdtemp(join(tmpdir(), 'store-e2e-'));
await writeFile(join(work, 'harness.jsx'), `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import StoreBuilder from ${JSON.stringify(join(repo, 'src/store/StoreBuilder.jsx'))};
import { AssetStore, memoryBackend } from ${JSON.stringify(join(repo, 'src/engine/assets.js'))};
const assets = new AssetStore(memoryBackend());
window.__changes = []; window.__studio = 0; window.__exit = 0;
function App() {
  const [store, setStore] = useState(null);
  window.__store = store;
  return <StoreBuilder store={store} assetStore={assets} onChange={(s, label) => { window.__changes.push(label); setStore(s); }}
    onOpenPhotoStudio={() => { window.__studio++; }} onExit={() => { window.__exit++; }} />;
}
createRoot(document.getElementById('root')).render(<App />);
`);
await build({ entryPoints: [join(work, 'harness.jsx')], bundle: true, outfile: join(work, 'harness.js'), loader: { '.jsx': 'jsx' }, minify: true, nodePaths: [join(repo, 'node_modules')], logLevel: 'error' });
await writeFile(join(work, 'harness.html'), `<!doctype html><html><head><meta charset="utf-8"><title>Store builder harness</title>
<link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/css/modern.css"><link rel="stylesheet" href="/css/store.css"></head>
<body><div id="root"></div><script src="/harness.js"></script></body></html>`);

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = await new Promise(res => { const s = http.createServer(async (req, rsp) => {
  const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^[/\\]+/, '');
  const file = p.startsWith('harness') ? join(work, p) : join(dist, p);
  try { const body = await readFile(file); rsp.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' }); rsp.end(body); } catch { rsp.writeHead(404); rsp.end(); }
}); s.listen(0, '127.0.0.1', () => res(s)); });
const url = `http://127.0.0.1:${server.address().port}/harness.html`;

// product photo (PNG) made with canvas
const c = createCanvas(600, 600), x = c.getContext('2d');
x.fillStyle = '#f1f1f1'; x.fillRect(0, 0, 600, 600); x.fillStyle = '#c0392b'; x.fillRect(150, 150, 300, 300);
const photo = join(work, 'tee.png'); await writeFile(photo, c.toBuffer('image/png'));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
await ctx.route(/wa\.me/, r => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>whatsapp stub</p>' }));
const page = await ctx.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));
let n = 0;
const step = async (name, fn) => { const t = Date.now(); await fn(); console.log(`ok ${++n} - ${name} (${Date.now() - t} ms)`); };
const frame = () => page.frameLocator('iframe[title="Store preview"]');
const previewEval = (fn, arg) => page.locator('iframe[title="Store preview"]').elementHandle().then(h => h.contentFrame()).then(f => f.evaluate(fn, arg));

await page.goto(url);

await step('template gallery lists 24+ templates with category filter; pick "Everyday Goods"', async () => {
  const count = await page.locator('.stCount').textContent();
  assert.ok(+count.match(/\d+/)[0] >= 24, count);
  await page.getByRole('button', { name: 'Fashion', exact: true }).click();
  const fashion = +((await page.locator('.stCount').textContent()).match(/\d+/)[0]);
  assert.ok(fashion >= 4 && fashion < +count.match(/\d+/)[0]);
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await page.locator('.stTplThumb iframe').first().waitFor();
  await page.getByRole('button', { name: 'Use template Everyday Goods' }).click();
  await frame().locator('h1.hero-title').waitFor();
  assert.equal(await frame().locator('h1.hero-title').textContent(), 'Good things for every day');
});

await step('add a product with an uploaded image and Size × Color variants', async () => {
  await page.getByRole('tab', { name: 'Products' }).click();
  await page.getByRole('button', { name: 'Add product' }).click();
  await page.getByLabel('Title', { exact: true }).fill('Test Tee');
  await page.getByLabel('Price', { exact: true }).fill('25');
  await page.getByLabel('Product image files').setInputFiles(photo);
  await page.locator('.stImgGrid img').first().waitFor();
  await page.getByRole('button', { name: /Add option/ }).click();
  await page.getByLabel('Option 1 values').fill('S, M'); await page.getByLabel('Option 1 values').press('Enter');
  await page.getByRole('button', { name: /Add option/ }).click();
  assert.equal(await page.getByLabel('Option 2 name').inputValue(), 'Color');
  await page.getByLabel('Option 2 values').fill('Red, Blue'); await page.getByLabel('Option 2 values').press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('.stVariants tbody tr').length === 4);
  const names = await page.locator('.stVariants tbody td:first-child').allTextContents();
  assert.deepEqual(names, ['S / Red', 'S / Blue', 'M / Red', 'M / Blue']);
  await page.getByLabel('Stock of M / Blue').fill('5');
  // preview shows this product's page with the uploaded image (blob URL from the asset store)
  await frame().locator('h1.ptitle-h', { hasText: 'Test Tee' }).waitFor();
  const src = await frame().locator('[data-main-image]').getAttribute('src');
  assert.match(src, /^blob:/);
  const st = await page.evaluate(() => window.__store.products.find(p => p.title === 'Test Tee'));
  assert.equal(st.slug, 'test-tee'); assert.ok(st.images[0].startsWith('asset:sha256-'));
});

await step('set the WhatsApp checkout number', async () => {
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByLabel('Checkout mode').selectOption('whatsapp');
  await page.getByLabel('WhatsApp number (with country code)').fill('+1 555 123 4567');
});

await step('edit the hero headline and the primary colour; the preview updates', async () => {
  await page.getByRole('tab', { name: 'Design' }).click();
  await page.getByLabel('Page').selectOption('home');
  await frame().locator('h1.hero-title').waitFor();
  await frame().locator('section[data-type="hero"]').click();   // click-to-select in the preview
  await page.getByRole('group', { name: 'Hero settings' }).waitFor();
  await page.getByLabel('Headline', { exact: true }).fill('Summer essentials are here');
  await frame().locator('h1.hero-title', { hasText: 'Summer essentials are here' }).waitFor();
  await page.getByRole('tab', { name: 'Theme' }).click();
  await page.getByLabel('Primary colour hex', { exact: true }).fill('00aa55'); await page.getByLabel('Primary colour hex', { exact: true }).press('Enter');
  await page.waitForFunction(() => window.__store.theme.colors.primary === '#00aa55');
  await page.waitForTimeout(400);
  const bg = await previewEval(() => getComputedStyle(document.querySelector('.nl-form .btn')).backgroundColor);
  assert.equal(bg, 'rgb(0, 170, 85)');
});

await step('reorder a section by drag and drop, then undo/redo with the keyboard', async () => {
  await page.getByRole('tab', { name: 'Sections' }).click();
  const order = () => page.evaluate(() => window.__store.pages.home.map(s => s.type));
  const before = await order();
  const rows = page.locator('.stSecList li:not(.fixed)');
  await rows.nth(0).dragTo(rows.nth(2));
  await page.waitForFunction(b => window.__store.pages.home[0].type !== b, before[0]);
  const after = await order();
  assert.equal(after[2], before[0]); assert.equal(after.length, before.length);
  await page.waitForTimeout(300);
  const types = await previewEval(() => [...document.querySelectorAll('main > [data-type]')].map(e => e.dataset.type));
  assert.deepEqual(types, after);
  await page.locator('.stStage').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  assert.deepEqual(await order(), before);
  await page.keyboard.press('Control+Shift+z');
  assert.deepEqual(await order(), after);
  // a focused text input keeps its own undo (shortcut is not taken by the builder)
  const prevented = await page.evaluate(() => { const i = document.querySelector('[aria-label="Store name"]'); const e = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }); i.dispatchEvent(e); return e.defaultPrevented; });
  assert.equal(prevented, false);
  assert.deepEqual(await order(), after);
});

await step('switch to the mobile preview', async () => {
  await page.getByRole('button', { name: 'Mobile preview' }).click();
  await page.waitForFunction(() => document.querySelector('iframe[title="Store preview"]').style.width === '390px');
  const toggle = await previewEval(() => getComputedStyle(document.querySelector('.menu-toggle')).display);
  assert.notEqual(toggle, 'none');
  await page.getByRole('button', { name: 'Desktop preview' }).click();
});

let siteDir;
await step('export the store as a ZIP and unzip it', async () => {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export store' }).click()]);
  const files = readZip(await readFile(await dl.path()));
  const names = files.map(f => f.name);
  const root = names[0].split('/')[0] + '/';
  for (const f of ['index.html', 'collections/all.html', 'products/test-tee.html', 'pages/about.html', 'pages/contact.html', 'cart.html', 'checkout.html', 'assets/styles.css', 'assets/store.js', 'README.txt'])
    assert.ok(names.includes(root + f), 'missing ' + f);
  assert.ok(names.some(n => /images\/.+\.png$/.test(n)), 'uploaded PNG exported');
  siteDir = join(work, 'site');
  for (const f of files) { const p = join(siteDir, f.name); await mkdir(dirname(p), { recursive: true }); await writeFile(p, f.data); }
  siteDir = join(siteDir, root);
  const html = (await readFile(join(siteDir, 'index.html'), 'utf8'));
  assert.match(html, /Summer essentials are here/);
  // every relative link/src in every page resolves to an exported file
  for (const name of names.filter(n => n.endsWith('.html'))) {
    const body = files.find(f => f.name === name).data.toString();
    for (const [, ref] of body.matchAll(/(?:href|src)="([^"#:]+?)"/g)) assert.ok(existsSync(join(siteDir, dirname(name.slice(root.length)), ref)), `${name}: broken ${ref}`);
  }
});

await step('shop the exported site from file://: variants, quantity, cart total, WhatsApp checkout', async () => {
  const shop = await ctx.newPage();
  const errs = []; shop.on('pageerror', e => errs.push(e.message));
  await shop.goto(pathToFileURL(join(siteDir, 'products/test-tee.html')).href);
  await shop.locator('label.pill', { hasText: 'M' }).click();
  await shop.locator('label.pill', { hasText: 'Blue' }).click();
  assert.equal(await shop.locator('[data-sku]').textContent(), 'TEST-TEE-M-BLUE');
  await shop.getByRole('button', { name: 'Increase quantity' }).click();
  await shop.getByRole('button', { name: /Add to cart/ }).click();
  await shop.locator('[data-drawer]').waitFor();
  assert.equal(await shop.locator('[data-drawer] [data-cart-subtotal]').textContent(), '$50.00');
  assert.equal(await shop.locator('[data-cart-count]').first().textContent(), '2');
  await shop.getByRole('link', { name: 'Checkout' }).click();
  await shop.waitForURL(/checkout\.html$/);
  assert.equal(await shop.locator('[data-checkout-total]').textContent(), '$50.00');
  await shop.getByLabel('Full name').fill('Ada Shopper');
  await shop.getByLabel('Delivery address').fill('1 Test Street');
  const [popup] = await Promise.all([shop.waitForEvent('popup'), shop.getByRole('button', { name: 'Send order on WhatsApp' }).click()]);
  const wa = new URL(popup.url());
  assert.equal(wa.host, 'wa.me'); assert.equal(wa.pathname, '/15551234567');
  const text = wa.searchParams.get('text');
  assert.match(text, /2 × Test Tee \(M \/ Blue\) \[TEST-TEE-M-BLUE\] — \$50\.00/);
  assert.match(text, /Subtotal: \$50\.00 \(2 items\)/);
  assert.match(text, /Name: Ada Shopper/);
  const link = await shop.locator('[data-order-link]').getAttribute('href');
  assert.equal(link, popup.url());
  assert.deepEqual(errs, []);
  await shop.close();
});

await step('interact mode follows links inside the preview; preview in new tab; copy deploy instructions', async () => {
  await page.getByRole('button', { name: 'Interact with the store' }).click();
  await frame().locator('.nav a', { hasText: 'Shop' }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Page"]').value === 'collection');
  await frame().locator('[data-collection-grid] .pcard').first().waitFor();
  await page.getByRole('button', { name: 'Select sections' }).click();
  const [tab] = await Promise.all([page.waitForEvent('popup'), page.getByRole('button', { name: 'Preview in new tab' }).click()]);
  await tab.waitForURL(/^blob:/);
  const f = tab.frameLocator('iframe');
  await f.locator('h1.hero-title', { hasText: 'Summer essentials are here' }).waitFor();
  await f.locator('.nav a', { hasText: 'About' }).click();
  await f.locator('h1.sec-title', { hasText: 'About Everyday Goods' }).waitFor();
  await tab.close();
  await page.getByRole('button', { name: 'Copy deploy instructions' }).click();
  await page.getByRole('status').filter({ hasText: 'Deploy instructions copied' }).waitFor();
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /Netlify/);
});

await step('product photo studio button calls onOpenPhotoStudio; no page errors', async () => {
  await page.getByRole('button', { name: 'Product photo studio' }).first().click();
  assert.equal(await page.evaluate(() => window.__studio), 1);
  assert.deepEqual(errors, []);
});

await browser.close(); server.close(); await rm(work, { recursive: true, force: true });
console.log(`# ${n} steps passed`);
