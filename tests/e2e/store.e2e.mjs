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
import { normalizeCommerce } from ${JSON.stringify(join(repo, 'src/store/admin/model.js'))};
const commerce = normalizeCommerce({ discounts: [{ id: 'd10', code: 'SAVE10', type: 'percentage', value: 10 }, { id: 'old', code: 'OLD10', type: 'percentage', value: 10, endsAt: '2020-01-01T00:00:00Z' }],
  settings: { shipping: { zones: [{ name: 'US', countries: ['US'], rates: [{ id: 'std', name: 'Standard', type: 'flat', price: 6 }] }] }, taxes: { inclusive: false, shippingTaxed: false, rates: [{ country: 'US', rate: 5 }] },
    backend: { orderWebhookUrl: 'https://hooks.example.test/orders' } } });
const assets = new AssetStore(memoryBackend());
window.__changes = []; window.__studio = 0; window.__exit = 0;
function App() {
  const [store, setStore] = useState(null);
  window.__store = store;
  return <StoreBuilder store={store} commerce={commerce} assetStore={assets} onChange={(s, label) => { window.__changes.push(label); setStore(s); }}
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
await ctx.route(/images\.unsplash\.com/, r => r.abort('internetdisconnected')); // simulate offline: photos must fall back to procedural art
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
  // curated photos are hot-linked with a 1x/2x srcset; offline (this test has no network) they fall back to procedural art
  assert.match(await page.locator('iframe[title="Store preview"]').getAttribute('srcdoc'), /srcset="https:\/\/images\.unsplash\.com\/photo-[^"]+ 1x, [^"]+ 2x"/);
  await page.waitForFunction(() => { const f = document.querySelector('iframe[title="Store preview"]').contentDocument; const i = f && f.querySelector('section[data-type="hero"] img'); return i && i.complete && i.naturalWidth > 0 && /^(blob:|data:)/.test(i.currentSrc || i.src); }, null, { timeout: 20000 });
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
  const src = await frame().locator('.pmain-img [data-slide="0"] img').getAttribute('src');
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

await step('the preview is one persistent document: inspector typing and inline edits patch it in place', async () => {
  await page.getByRole('button', { name: 'Tablet preview' }).click();   // scale 1: canvas coordinates match the page
  await page.waitForFunction(() => document.querySelector('iframe[title="Store preview"]').style.transform === 'scale(1)');
  const fr = await (await page.locator('iframe[title="Store preview"]').elementHandle()).contentFrame();
  await fr.evaluate(() => { window.__mark = 'same-document'; window.__doc = document; });
  const same = () => fr.evaluate(() => window.__mark === 'same-document' && window.__doc === document);
  // inspector typing (one patch per keystroke, never a reload)
  await page.getByRole('tab', { name: 'Design' }).click(); await page.getByRole('tab', { name: 'Sections' }).click();
  await page.locator('.stSecList li').filter({ hasText: /^Hero/ }).getByRole('button').first().click();
  await page.getByLabel('Headline', { exact: true }).focus(); await page.keyboard.press('End');
  await page.keyboard.type(' today', { delay: 30 });
  await fr.locator('h1.hero-title', { hasText: 'Summer essentials are here today' }).waitFor();
  assert.ok(await same(), 'typing must not reload the preview');
  // inline editing on the canvas: double-click, type, Enter commits to the setting
  await fr.locator('h1.hero-title').dblclick();
  await fr.waitForSelector('h1.hero-title[contenteditable]');
  await page.keyboard.press('Control+A'); await page.keyboard.type('Inline headline');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__store.pages.home.find(s => s.type === 'hero').settings.heading === 'Inline headline');
  await fr.locator('h1.hero-title:not([contenteditable])', { hasText: 'Inline headline' }).waitFor();
  // Escape cancels
  await fr.locator('h1.hero-title').dblclick(); await page.keyboard.type('nope'); await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => window.__store.pages.home.find(s => s.type === 'hero').settings.heading), 'Inline headline');
  assert.equal(await fr.locator('h1.hero-title').textContent(), 'Inline headline');
  // put the headline used by the later steps back (undo twice: inline edit, then the typing)
  await page.locator('.stStage').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  assert.equal(await page.evaluate(() => window.__store.pages.home.find(s => s.type === 'hero').settings.heading), 'Summer essentials are here today');
  await page.keyboard.press('Control+z');
  await fr.locator('h1.hero-title', { hasText: /^Summer essentials are here$/ }).waitFor();
  assert.ok(await same(), 'inline editing and undo must not reload the preview');
});

await step('drag sections and blocks on the canvas; toolbar actions; undo', async () => {
  const fr = await (await page.locator('iframe[title="Store preview"]').elementHandle()).contentFrame();
  const order = () => page.evaluate(() => window.__store.pages.home.map(s => s.id));
  const before = await order();
  const secs = fr.locator('main > [data-sid]');
  // section drag: grab the toolbar handle of section 3 and drop it above section 2
  await secs.nth(2).hover({ position: { x: 300, y: 40 } });
  const handle = fr.locator('.zed-tag button[data-zact="drag"]');
  await handle.waitFor({ state: 'visible' });
  const hb = await handle.boundingBox(), t = await secs.nth(1).boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2); await page.mouse.down();
  await page.mouse.move(t.x + 200, t.y + 8, { steps: 8 }); await page.mouse.up();
  await page.waitForFunction(b => window.__store.pages.home[1].id === b, before[2]);
  const after = await order();
  assert.deepEqual(after, [before[0], before[2], before[1], ...before.slice(3)]);
  const dom = await fr.evaluate(() => [...document.querySelectorAll('main > [data-sid]')].map(e => e.dataset.sid));
  assert.deepEqual(dom, after.filter(id => dom.includes(id)), 'canvas DOM reordered in place');
  // block drag inside the features strip: move the first feature after the third
  const feats = fr.locator('section[data-type="features"] [data-block^="items."]');
  const titles = () => page.evaluate(() => window.__store.pages.home.find(s => s.type === 'features').settings.items.map(i => i.title));
  const t0 = await titles();
  await feats.nth(0).hover();
  const bh = fr.locator('.zed-bh'); await bh.waitFor({ state: 'visible' });
  const bb = await bh.boundingBox(), dst = await feats.nth(2).boundingBox();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await page.mouse.down();
  await page.mouse.move(dst.x + dst.width * 0.8, dst.y + dst.height / 2, { steps: 8 }); await page.mouse.up();
  await page.waitForFunction(t => window.__store.pages.home.find(s => s.type === 'features').settings.items[2].title === t, t0[0]);
  assert.deepEqual(await titles(), [t0[1], t0[2], t0[0], ...t0.slice(3)]);
  // toolbar: hide a section, then undo everything done in this step
  await secs.nth(1).hover({ position: { x: 300, y: 30 } });
  await fr.locator('.zed-tag button[data-zact="hide"]').click();
  await page.waitForFunction(id => window.__store.pages.home.find(s => s.id === id).hidden, after[1]);
  await page.locator('.stStage').click({ position: { x: 5, y: 5 } });
  for (let i = 0; i < 3; i++) await page.keyboard.press('Control+z');
  assert.deepEqual(await order(), before); assert.deepEqual(await titles(), t0);
  assert.ok(!(await page.evaluate(() => window.__store.pages.home.some(s => s.hidden))));
  await page.getByRole('button', { name: 'Desktop preview' }).click();
});

await step('image position: inspector 3×3 grid, focal-point drag, zoom and the canvas alignment grid patch the hero image in place', async () => {
  await page.getByRole('button', { name: 'Tablet preview' }).click();   // scale 1: canvas coordinates match the page
  await page.waitForFunction(() => document.querySelector('iframe[title="Store preview"]').style.transform === 'scale(1)');
  const fr = await (await page.locator('iframe[title="Store preview"]').elementHandle()).contentFrame();
  const heroImg = 'section[data-type="hero"] .hero-media img';
  await fr.evaluate(sel => { window.__frameMark = 'same-document'; window.__heroImg = document.querySelector(sel); }, heroImg);
  const same = () => fr.evaluate(sel => window.__frameMark === 'same-document' && document.querySelector(sel) === window.__heroImg, heroImg);
  const pos = () => fr.evaluate(sel => getComputedStyle(document.querySelector(sel)).objectPosition, heroImg);
  const stored = () => page.evaluate(() => { const s = window.__store.pages.home.find(x => x.type === 'hero').settings; return { ...s.imagePos, zoom: s.imageZoom, fit: s.imageFit }; });
  assert.equal(await pos(), '50% 50%');
  await page.getByRole('tab', { name: 'Design' }).click(); await page.getByRole('tab', { name: 'Sections' }).click();
  await page.locator('.stSecList li').filter({ hasText: /^Hero/ }).getByRole('button').first().click();
  // 3×3 grid: "top"
  await page.getByRole('button', { name: 'Align image top', exact: true }).click();
  await page.waitForFunction(() => window.__store.pages.home.find(x => x.type === 'hero').settings.imagePos.y === 0);
  await fr.waitForFunction(sel => getComputedStyle(document.querySelector(sel)).objectPosition === '50% 0%', heroImg);
  assert.equal(await page.getByRole('button', { name: 'Align image top', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.ok(await same(), 'alignment must patch the existing <img>, not reload the preview or replace the section');
  // fine focal point: drag the crosshair on the inspector thumbnail
  const focus = page.getByRole('slider', { name: 'Image focal point' }), fb = await focus.boundingBox();
  await page.mouse.move(fb.x + fb.width * 0.5, fb.y + fb.height * 0.1); await page.mouse.down();
  await page.mouse.move(fb.x + fb.width * 0.25, fb.y + fb.height * 0.75, { steps: 6 }); await page.mouse.up();
  await page.waitForFunction(() => { const p = window.__store.pages.home.find(x => x.type === 'hero').settings.imagePos; return Math.abs(p.x - 25) <= 3 && Math.abs(p.y - 75) <= 3; });
  const s1 = await stored();
  await fr.waitForFunction(([sel, x, y]) => getComputedStyle(document.querySelector(sel)).objectPosition === `${x}% ${y}%`, [heroImg, s1.x, s1.y]);
  // keyboard nudge on the focal point
  await focus.press('ArrowRight');
  await page.waitForFunction(x => window.__store.pages.home.find(s => s.type === 'hero').settings.imagePos.x === x + 2, s1.x);
  // zoom slider (keyboard): scale around the focal point
  const zoom = page.getByRole('slider', { name: 'Image zoom' });
  await zoom.focus(); for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => window.__store.pages.home.find(s => s.type === 'hero').settings.imageZoom === 120);
  await fr.waitForFunction(sel => getComputedStyle(document.querySelector(sel)).scale === '1.2', heroImg);
  await page.keyboard.press('Home');
  await page.waitForFunction(() => window.__store.pages.home.find(s => s.type === 'hero').settings.imageZoom === 100);
  // fit: contain, then back to cover
  await page.getByRole('button', { name: 'Fit (contain)' }).click();
  await fr.waitForFunction(sel => getComputedStyle(document.querySelector(sel)).objectFit === 'contain', heroImg);
  await page.getByRole('button', { name: 'Fill (cover)' }).click();
  await fr.waitForFunction(sel => getComputedStyle(document.querySelector(sel)).objectFit === 'cover', heroImg);
  // the canvas: hovering the selected section's image shows a floating 3×3 grid; pick "bottom right", then "top"
  await fr.locator('section[data-type="hero"]').hover({ position: { x: 120, y: 260 } });
  const bar = fr.locator('.zed-fr'); await bar.waitFor({ state: 'visible' });   // inside the agent's aria-hidden overlay: located by CSS
  await bar.locator('button[aria-label="Align image bottom right"]').click();
  await page.waitForFunction(() => { const p = window.__store.pages.home.find(x => x.type === 'hero').settings.imagePos; return p.x === 100 && p.y === 100; });
  await fr.waitForFunction(sel => getComputedStyle(document.querySelector(sel)).objectPosition === '100% 100%', heroImg);
  assert.equal(await bar.locator('button[aria-label="Align image bottom right"]').getAttribute('aria-pressed'), 'true');
  await bar.locator('button[aria-label="Align image top"]').click();
  await fr.waitForFunction(sel => getComputedStyle(document.querySelector(sel)).objectPosition === '50% 0%', heroImg);
  assert.deepEqual(await stored(), { x: 50, y: 0, zoom: 100, fit: 'cover' });
  assert.ok(await same(), 'every image-position edit patched the same <img> in the same document');
  // undo goes back through the edits; redo restores "top" (kept for the export check)
  await page.locator('.stStage').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  await fr.waitForFunction(sel => getComputedStyle(document.querySelector(sel)).objectPosition === '100% 100%', heroImg);
  await page.keyboard.press('Control+Shift+z');
  await fr.waitForFunction(sel => getComputedStyle(document.querySelector(sel)).objectPosition === '50% 0%', heroImg);
  assert.ok(await same());
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
  assert.match(html.match(/<section[^>]*data-type="hero"[\s\S]*?(<img[^>]*>)/)[1], /style="object-position:50% 0%"/, 'exported hero keeps the image position');
  // every relative link/src in every page resolves to an exported file
  for (const name of names.filter(n => n.endsWith('.html'))) {
    const body = files.find(f => f.name === name).data.toString();
    for (const [, ref] of body.matchAll(/(?:href|src)="([^"#:]+?)"/g)) assert.ok(existsSync(join(siteDir, dirname(name.slice(root.length)), ref)), `${name}: broken ${ref}`);
  }
});

await step('shop the exported site from file://: wishlist, search, mobile menu, variants, discount codes, shipping & tax, WhatsApp checkout + order webhook, size guide, sticky add-to-cart, bundle, buy now', async () => {
  const shop = await ctx.newPage();
  const errs = []; shop.on('pageerror', e => errs.push(e.message));
  await shop.goto(pathToFileURL(join(siteDir, 'products/test-tee.html')).href);
  // wishlist + search work in the exported site
  await shop.getByRole('button', { name: 'Save Test Tee to wishlist' }).click();
  assert.equal(await shop.locator('[data-wish-count]').textContent(), '1');
  await shop.getByRole('button', { name: 'Wishlist', exact: true }).click();
  await shop.locator('[data-wish-lines] a', { hasText: 'Test Tee' }).first().waitFor();
  await shop.keyboard.press('Escape');
  await shop.getByRole('button', { name: 'Search', exact: true }).click();
  await shop.getByRole('searchbox', { name: 'Search products' }).fill('test');
  await shop.locator('[data-search-results] a', { hasText: 'Test Tee' }).waitFor();
  await shop.keyboard.press('Escape');
  await shop.setViewportSize({ width: 390, height: 844 });
  await shop.getByRole('button', { name: 'Open menu' }).click();
  await shop.locator('[data-navdrawer] a', { hasText: 'About' }).waitFor();
  await shop.getByRole('button', { name: 'Close menu' }).click();
  assert.ok(await shop.locator('[data-navdrawer]').isHidden());
  await shop.setViewportSize({ width: 1600, height: 1000 });
  await shop.locator('label.pill', { hasText: 'M' }).click();
  await shop.locator('label.pill', { hasText: 'Blue' }).click();
  assert.equal(await shop.locator('[data-sku]').textContent(), 'TEST-TEE-M-BLUE');
  await shop.getByRole('button', { name: 'Increase quantity' }).click();
  await shop.getByRole('button', { name: /Add to cart/ }).click();
  await shop.locator('[data-drawer]').waitFor();
  assert.equal(await shop.locator('[data-drawer] [data-cart-subtotal]').textContent(), '$50.00');
  assert.equal(await shop.locator('[data-cart-count]').first().textContent(), '2');
  // discount codes from the commerce document: invalid, expired, then a valid 10% code
  const code = shop.locator('[data-drawer] [data-discount-box] input[name=code]');
  await code.fill('nope'); await code.press('Enter');
  await shop.locator('[data-drawer] [data-discount-msg]', { hasText: '"NOPE" is not a valid discount code.' }).waitFor();
  await shop.locator('[data-drawer] [data-discount-box] input[name=code]').fill('old10'); await shop.locator('[data-drawer] [data-discount-box] input[name=code]').press('Enter');
  await shop.locator('[data-drawer] [data-discount-msg]', { hasText: '"OLD10" has expired.' }).waitFor();
  await shop.locator('[data-drawer] [data-discount-box] input[name=code]').fill('save10');
  await shop.locator('[data-drawer] [data-discount-box]').getByRole('button', { name: 'Apply' }).click();
  await shop.locator('[data-drawer] [data-discount-line]', { hasText: 'SAVE10' }).waitFor();
  assert.match(await shop.locator('[data-drawer] [data-discount-line]').textContent(), /−\$5\.00/);
  assert.equal(await shop.locator('[data-drawer] [data-order-total]').textContent(), '$45.00');
  await shop.getByRole('link', { name: 'Checkout' }).click();
  await shop.waitForURL(/checkout\.html$/);
  assert.equal(await shop.locator('[data-checkout-total]').textContent(), '$45.00', 'applied code persists across pages');
  // shipping & tax from the commerce settings
  await shop.getByLabel('Country').selectOption('US');
  await shop.locator('[data-ship-rate]').first().waitFor();
  assert.equal(await shop.locator('[data-checkout-total]').textContent(), '$53.25'); // 50 − 5 + 6 shipping + 5% tax on 45
  const hooks = [];
  await ctx.route(/hooks\.example\.test/, r => { const q = r.request(); if (q.method() === 'POST') hooks.push(q.postData()); r.fulfill({ status: q.method() === 'OPTIONS' ? 204 : 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST' }, body: '' }); });
  await shop.getByLabel('Full name').fill('Ada Shopper');
  await shop.getByLabel('Delivery address').fill('1 Test Street');
  const [popup] = await Promise.all([shop.waitForEvent('popup'), shop.getByRole('button', { name: 'Send order on WhatsApp' }).click()]);
  const wa = new URL(popup.url());
  assert.equal(wa.host, 'wa.me'); assert.equal(wa.pathname, '/15551234567');
  const text = wa.searchParams.get('text');
  assert.match(text, /2 × Test Tee \(M \/ Blue\) \[TEST-TEE-M-BLUE\] — \$50\.00/);
  assert.match(text, /Subtotal: \$50\.00 \(2 items\)/);
  assert.match(text, /Discount \(SAVE10\): −\$5\.00/); assert.match(text, /Shipping \(Standard\): \$6\.00/); assert.match(text, /Tax 5%: \$2\.25/); assert.match(text, /Total: \$53\.25/);
  await shop.waitForFunction(() => true); for (let i = 0; i < 50 && !hooks.length; i++) await shop.waitForTimeout(100);
  assert.ok(hooks.length >= 1, 'order webhook POSTed');
  const hook = JSON.parse(hooks[0]);
  assert.equal(hook.type, 'order'); assert.deepEqual(hook.codes, ['SAVE10']); assert.equal(hook.total, 53.25); assert.equal(hook.lines[0].quantity, 2); assert.equal(hook.customer.name, 'Ada Shopper');
  assert.match(text, /Name: Ada Shopper/);
  const link = await shop.locator('[data-order-link]').getAttribute('href');
  assert.equal(link, popup.url());
  // sales features of the exported product page: size guide, sticky add-to-cart, bundle
  await shop.goto(pathToFileURL(join(siteDir, 'products/test-tee.html')).href);
  await shop.getByRole('button', { name: 'Size guide' }).first().click();
  await shop.getByRole('dialog', { name: 'Size guide' }).waitFor();
  assert.ok(await shop.locator('.sgtable tr').count() >= 3);
  await shop.keyboard.press('Escape');
  assert.ok(await shop.locator('[data-modal]').isHidden());
  const count = async () => +(await shop.locator('[data-cart-count]').first().textContent() || 0);
  const c0 = await count();
  assert.ok(await shop.locator('[data-sticky-atc]').isHidden());
  await shop.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
  await shop.locator('[data-sticky-atc]').waitFor({ state: 'visible' });
  await shop.locator('[data-sticky-add]').click();
  await shop.waitForFunction(n => +document.querySelector('[data-cart-count]').textContent === n + 1, c0);
  await shop.keyboard.press('Escape');
  const bundleN = await shop.locator('[data-bundle-item]').count();
  assert.ok(bundleN >= 2);
  await shop.getByRole('button', { name: 'Add all to cart' }).click();
  await shop.waitForFunction(n => +document.querySelector('[data-cart-count]').textContent === n, c0 + 1 + bundleN);
  assert.ok(await shop.locator('[data-drawer] [data-ship-bar]').isVisible(), 'free-shipping progress in the cart drawer');
  await shop.keyboard.press('Escape');
  await shop.getByRole('button', { name: 'Buy it now' }).click();
  await shop.waitForURL(/checkout\.html$/);
  assert.equal(await shop.locator('[data-cart-count]').first().textContent(), String(c0 + 2 + bundleN));
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

await step('motion: a premium template animates after scrolling; reduced motion and Edit mode show final states', async () => {
  const { createStore } = await import(pathToFileURL(join(repo, 'src/store/templates.js')).href);
  const { renderPage } = await import(pathToFileURL(join(repo, 'src/store/render.js')).href);
  const s = createStore('noctis');
  await writeFile(join(work, 'harness-premium.html'), renderPage(s, { page: 'home' }, { mode: 'preview', imageUrl: r => r }));
  const shop = await ctx.newPage(); const errs = []; shop.on('pageerror', e => errs.push(e.message));
  await shop.setViewportSize({ width: 1440, height: 900 });
  await shop.goto(url.replace('harness.html', 'harness-premium.html'));
  assert.ok(await shop.evaluate(() => document.documentElement.classList.contains('js-motion') && document.body.classList.contains('motion-expressive')));
  // the hero headline is split into masked words that rise into place
  await shop.waitForFunction(() => { const w = document.querySelectorAll('.mh-title .zm-wi'); return w.length >= 3 && [...w].every(x => !x.classList.contains('zm-pre') && !x.getAnimations().some(a => a.playState === 'running')); }, null, { timeout: 8000 });
  assert.equal(await shop.locator('.mh-title').textContent(), 'Light, held still');
  // product cards below the fold wait in their initial state, then reveal after scrolling
  const card = shop.locator('[data-type="featured-products"] .pcard').first();
  assert.ok(await card.evaluate(el => el.classList.contains('zm-pre') && getComputedStyle(el).opacity === '0'), 'card starts hidden by the engine');
  await card.scrollIntoViewIfNeeded();
  await shop.waitForFunction(() => { const el = document.querySelector('[data-type="featured-products"] .pcard'); return !el.classList.contains('zm-pre') && el.getAnimations().length > 0; }, null, { timeout: 5000 });
  await shop.waitForFunction(() => { const el = document.querySelector('[data-type="featured-products"] .pcard'); return el.getAnimations().every(a => a.playState === 'finished') && getComputedStyle(el).opacity === '1'; }, null, { timeout: 5000 });
  // count-up runs to the real number
  const stat = shop.locator('[data-type="stats"] [data-count]').first();
  await stat.scrollIntoViewIfNeeded();
  await shop.waitForFunction(() => document.querySelector('[data-type="stats"] [data-count]').textContent === '140', null, { timeout: 6000 });
  // Edit mode (the builder agent sets html.editing): every element shows its final state, headings get their original markup back
  await shop.evaluate(() => window.scrollTo(0, 0));
  await shop.evaluate(() => document.documentElement.classList.add('editing'));
  await shop.waitForFunction(() => !document.querySelector('.zm-pre') && !document.querySelector('.zm-w'));
  assert.equal(await shop.locator('[data-type="testimonials"] .quote').first().evaluate(el => getComputedStyle(el).opacity), '1');
  // leaving Edit mode replays the choreography
  await shop.evaluate(() => document.documentElement.classList.remove('editing'));
  await shop.waitForFunction(() => document.querySelectorAll('.mh-title .zm-w').length >= 3);
  // reduced motion: nothing is hidden, nothing is split
  const calm = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const rp = await calm.newPage(); await rp.goto(url.replace('harness.html', 'harness-premium.html'));
  await rp.waitForTimeout(400);
  assert.deepEqual(await rp.evaluate(() => [document.querySelectorAll('.zm-pre').length, document.querySelectorAll('.zm-w').length, document.documentElement.classList.contains('js-motion')]), [0, 0, false]);
  await calm.close(); await shop.close();
  assert.deepEqual(errs, []);
  // in the builder: Theme → Motion → Expressive; Edit mode shows the final state, Interact mode plays the reveal
  await page.getByRole('tab', { name: 'Design' }).click();
  await page.getByRole('tab', { name: 'Theme' }).click();
  await page.getByRole('group', { name: 'Motion' }).getByRole('button', { name: 'Expressive' }).click();
  await page.waitForFunction(() => window.__store.theme.motion === 'expressive');
  await page.locator('[aria-label="Page"]').selectOption('home');
  await frame().locator('body.page-home.motion-expressive h1.hero-title').waitFor();
  assert.ok(await previewEval(() => document.documentElement.classList.contains('editing') && !document.querySelector('.zm-pre') && !document.querySelector('.hero-title .zm-w')), 'Edit mode: final state, headline not split');
  await page.getByRole('button', { name: 'Interact with the store' }).click();
  await page.waitForFunction(() => { const d = document.querySelector('iframe[title="Store preview"]').contentDocument; return d && d.querySelectorAll('.hero-title .zm-w').length >= 2; }, null, { timeout: 5000 });
  await page.getByRole('button', { name: 'Select sections' }).click();
  await page.waitForFunction(() => { const d = document.querySelector('iframe[title="Store preview"]').contentDocument; return d && !d.querySelector('.zm-w') && !d.querySelector('.zm-pre'); });
});

await step('product photo studio button calls onOpenPhotoStudio; no page errors', async () => {
  await page.getByRole('button', { name: 'Product photo studio' }).first().click();
  assert.equal(await page.evaluate(() => window.__studio), 1);
  assert.deepEqual(errors, []);
});

await browser.close(); server.close(); await rm(work, { recursive: true, force: true });
console.log(`# ${n} steps passed`);
