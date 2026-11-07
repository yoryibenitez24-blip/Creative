// Browser acceptance test for the commerce admin (src/store/admin/CommerceApp.jsx).
// Builds a scratch harness (temp dir) that mounts CommerceApp with a real store from createStore('everyday') and an
// in-memory AssetStore, persists both documents to localStorage (like a host would), serves it and drives the UI.
// Run: node tests/e2e/admin.e2e.mjs   (no app build needed). Screenshots: docs/evidence/admin-*.jpg
import { createRequire } from 'node:module';
import http from 'node:http';
import { readFile, mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const repo = join(fileURLToPath(new URL('.', import.meta.url)), '../..'), dist = join(repo, 'dist'), evidence = join(repo, 'docs/evidence');
await mkdir(evidence, { recursive: true });

const work = await mkdtemp(join(tmpdir(), 'admin-e2e-'));
await writeFile(join(work, 'harness.jsx'), `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import CommerceApp from ${JSON.stringify(join(repo, 'src/store/admin/CommerceApp.jsx'))};
import { createStore } from ${JSON.stringify(join(repo, 'src/store/StoreBuilder.jsx'))};
import { AssetStore, memoryBackend } from ${JSON.stringify(join(repo, 'src/engine/assets.js'))};
import { captureAuthRedirect } from ${JSON.stringify(join(repo, 'src/store/admin/backendSync.js'))};
captureAuthRedirect();
const assets = new AssetStore(memoryBackend());
const load = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
window.__labels = []; window.__exit = 0;
function App() {
  const [store, setStore] = useState(() => load('h-store') || createStore('everyday'));
  const [commerce, setCommerce] = useState(() => load('h-commerce'));
  window.__store = store; window.__commerce = commerce;
  return <CommerceApp store={store} commerce={commerce} assetStore={assets} onExit={() => { window.__exit++; }}
    onChange={(s, label) => { window.__labels.push('store:' + label); window.__store = s; localStorage.setItem('h-store', JSON.stringify(s)); setStore(s); }}
    onCommerceChange={(c, label) => { window.__labels.push('commerce:' + label); window.__commerce = c; localStorage.setItem('h-commerce', JSON.stringify(c)); setCommerce(c); }} />;
}
createRoot(document.getElementById('root')).render(<App />);
`);
await build({ entryPoints: [join(work, 'harness.jsx')], bundle: true, minify: true, outfile: join(work, 'harness.js'), loader: { '.jsx': 'jsx' }, nodePaths: [join(repo, 'node_modules')], logLevel: 'error' });
await writeFile(join(work, 'harness.html'), `<!doctype html><html><head><meta charset="utf-8"><title>Commerce harness</title>
<link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/css/modern.css"><link rel="stylesheet" href="/css/store.css"><link rel="stylesheet" href="/css/admin.css"><link rel="stylesheet" href="/css/settings.css"><link rel="stylesheet" href="/css/commerce-intro.css"><link rel="stylesheet" href="/css/globe.css"><link rel="stylesheet" href="/css/stores.css"><link rel="stylesheet" href="/css/services.css"></head>
<body><div id="root"></div><script src="/harness.js"></script></body></html>`);

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = await new Promise(res => { const s = http.createServer(async (req, rsp) => {
  const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^[/\\]+/, '');
  const file = p.startsWith('harness') ? join(work, p) : join(dist, p);
  try { const body = await readFile(file); rsp.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' }); rsp.end(body); } catch { rsp.writeHead(404); rsp.end(); }
}); s.listen(0, '127.0.0.1', () => res(s)); });
const url = `http://127.0.0.1:${server.address().port}/harness.html`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 920 } });
await ctx.route(/images\.unsplash\.com/, r => r.abort('internetdisconnected'));
const page = await ctx.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));
let n = 0;
const until = async (fn, ms = 5000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('timed out'); await new Promise(r => setTimeout(r, 50)); } };
const beMock = { seen: [], syncs: [], reads: [], failSync: 0, orders: [2001, 2002].map((num, i) => ({ id: 'u' + num, number: num, status: 'open', financial_status: 'paid', fulfillment_status: 'unfulfilled', email: 'buyer' + i + '@example.com',
  created_at: '2026-11-0' + (i + 1) + 'T10:00:00Z', updated_at: '2026-11-0' + (i + 1) + 'T10:05:00Z', paid_at: '2026-11-0' + (i + 1) + 'T10:05:00Z', subtotal: 40, discount_total: 0, shipping: 6, shipping_discount: 0, tax: 2, total: 48,
  shipping_address: { name: 'Buyer ' + i, country: 'US' }, order_lines: [{ id: 'l' + num, product_id: 'p', variant_id: 'v', title: 'Mug', unit_price: 20, quantity: 2, position: 0 }], refunds: [] })) };
const step = async (name, fn) => { const t = Date.now(); await fn(); console.log(`ok ${++n} - ${name} (${Date.now() - t} ms)`); };
const shot = async name => { await page.evaluate(() => { const m = document.querySelector('.caMain'); if (m) m.scrollTop = 0; }); await page.waitForTimeout(150); return page.screenshot({ path: join(evidence, `admin-${name}.jpg`), type: 'jpeg', quality: 80 }); };
const nav = name => page.getByRole('navigation', { name: 'Commerce' }).getByRole('button', { name, exact: true }).click();
const main = page.getByRole('main', { name: 'Commerce content' });
const commerce = () => page.evaluate(() => window.__commerce);
const store = () => page.evaluate(() => window.__store);

try {
  await page.goto(url);

  await step('entrance animation plays, then the Commerce Home appears', async () => {
    const intro = page.getByTestId('commerce-intro');
    await intro.waitFor();
    await page.waitForTimeout(950);
    await shot('entrance');
    await intro.waitFor({ state: 'detached', timeout: 4000 });
    await main.getByRole('heading', { level: 1 }).filter({ hasText: /Good (morning|afternoon|evening)/ }).waitFor();
    assert.ok(await main.getByRole('region', { name: /Set up your store/ }).count() >= 0);
    await page.getByRole('progressbar', { name: 'Setup progress' }).waitFor();
    for (const k of ['Total sales', 'Orders', 'Average order value', 'Conversion rate']) await main.getByRole('group', { name: k, exact: true }).waitFor();
    const c = await commerce();
    assert.equal(c.kind, 'commerce', 'a default commerce document was created and reported');
  });

  await step('create a product with variants, inventory and cost → margin', async () => {
    await nav('Products');
    await main.getByRole('button', { name: 'Add product' }).first().click();
    await main.getByLabel('Title', { exact: true }).fill('Test Hoodie');
    await main.getByLabel('Description', { exact: true }).fill('Soft fleece hoodie.\n\nMachine washable.');
    await main.getByLabel('Price', { exact: true }).fill('50');
    await main.getByLabel('Cost per item', { exact: true }).fill('20');
    await main.getByRole('group', { name: 'Margin' }).or(main.getByLabel('Margin')).getByText('60.0%').waitFor();
    await main.getByLabel('Product type', { exact: true }).fill('Hoodies');
    await main.getByLabel('Vendor', { exact: true }).fill('Acme Knits');
    await main.getByRole('button', { name: 'Add options like size or color' }).click();
    const values = main.getByLabel('Option 1 values');
    await values.fill('S'); await values.press('Enter'); await values.fill('M'); await values.press('Enter');
    await main.getByRole('table', { name: 'Variants' }).waitFor();
    await main.getByLabel('Track quantity of S', { exact: true }).check();
    await main.getByLabel('Available quantity of S', { exact: true }).fill('10');
    await main.getByLabel('Track quantity of M', { exact: true }).check();
    await main.getByLabel('Available quantity of M', { exact: true }).fill('5');
    await main.getByLabel('SKU of M', { exact: true }).fill('HOOD-M');
    await main.getByRole('region', { name: 'Unsaved changes' }).getByRole('button', { name: 'Save' }).click();
    await main.getByRole('heading', { name: 'Test Hoodie', level: 1 }).waitFor();
    const s = await store(), p = s.products.find(x => x.title === 'Test Hoodie');
    assert.ok(p, 'product written to store.products');
    assert.deepEqual(p.options, [{ name: 'Size', values: ['S', 'M'] }]);
    assert.deepEqual(p.variants.map(v => v.stock), [10, 5]);
    assert.equal(p.variants[1].sku, 'HOOD-M'); assert.equal(p.variants[0].sku, 'TEST-HOODIE-S'); assert.equal(p.slug, 'test-hoodie');
    assert.equal(p.description, 'Soft fleece hoodie.\n\nMachine washable.');
    const c = await commerce();
    assert.equal(c.productMeta[p.id].cost, 20); assert.equal(c.productMeta[p.id].vendor, 'Acme Knits');
    assert.equal(c.onboarding.steps.product, true);
    await shot('product');
  });

  await step('create discount code SAVE10 (10%)', async () => {
    await nav('Discounts');
    await main.getByRole('button', { name: 'Create discount' }).first().click();
    await main.getByLabel('Discount code', { exact: true }).fill('save10');
    await main.getByLabel('Percentage', { exact: true }).fill('10');
    await main.getByRole('button', { name: 'Save discount' }).click();
    await main.getByRole('heading', { name: 'SAVE10', level: 1 }).waitFor();
    const d = (await commerce()).discounts.find(x => x.code === 'SAVE10');
    assert.ok(d); assert.equal(d.type, 'percentage'); assert.equal(d.value, 10);
  });

  let orderId;
  await step('manual order with the code: totals correct, customer created', async () => {
    await nav('Orders');
    await main.getByRole('button', { name: 'Create order' }).first().click();
    const sel = main.getByLabel('Product to add');
    const opt = await sel.locator('option', { hasText: 'Test Hoodie — S ·' }).getAttribute('value');
    await sel.selectOption(opt);
    await main.getByRole('button', { name: 'Add', exact: true }).click();
    await main.getByLabel('Quantity of Test Hoodie S').fill('2');
    await main.getByLabel('First name', { exact: true }).fill('Ana');
    await main.getByLabel('Last name', { exact: true }).fill('Lima');
    await main.getByLabel('Customer email', { exact: true }).fill('ana@example.com');
    await main.getByLabel('Full name', { exact: true }).fill('Ana Lima');
    await main.getByLabel('Address', { exact: true }).fill('1 Main St');
    await main.getByLabel('City', { exact: true }).fill('Austin');
    await main.getByLabel('Country', { exact: true }).selectOption('US');
    await main.getByLabel('Discount code', { exact: true }).fill('save10');
    await main.getByRole('button', { name: 'Apply code' }).click();
    const rate = main.getByLabel('Shipping rate');
    await rate.selectOption(await rate.locator('option', { hasText: 'Express' }).getAttribute('value'));
    const totals = main.getByLabel('Order totals');
    await totals.getByText('$100.00').waitFor();
    assert.equal(await totals.locator('[data-total="total"]').textContent(), '$104.99');
    assert.equal(await totals.locator('[data-total="shipping"]').textContent(), '$14.99');
    await totals.getByText('−$10.00').waitFor();
    await main.getByRole('button', { name: 'Create order' }).click();
    await main.getByRole('heading', { level: 1 }).filter({ hasText: '#1001' }).waitFor();
    const c = await commerce(), o = c.orders.find(x => x.name === '#1001');
    orderId = o.id;
    assert.equal(o.totals.subtotal, 100); assert.equal(o.totals.discountTotal, 10); assert.equal(o.totals.shipping, 14.99); assert.equal(o.totals.total, 104.99);
    assert.deepEqual(o.codes, ['SAVE10']);
    assert.equal(c.discounts.find(x => x.code === 'SAVE10').usageCount, 1);
    const cu = c.customers.find(x => x.email === 'ana@example.com');
    assert.ok(cu); assert.equal(o.customerId, cu.id); assert.equal(cu.firstName, 'Ana');
    const p = (await store()).products.find(x => x.title === 'Test Hoodie');
    assert.equal(p.variants[0].stock, 10, 'pending order has not taken stock yet');
  });

  await step('mark as paid → inventory decremented; fulfil with tracking', async () => {
    await main.getByRole('button', { name: 'Mark as paid' }).click();
    await page.getByRole('dialog', { name: 'Mark as paid?' }).getByRole('button', { name: 'Mark as paid' }).click();
    await main.getByText('Paid', { exact: true }).first().waitFor();
    let p = (await store()).products.find(x => x.title === 'Test Hoodie');
    assert.equal(p.variants[0].stock, 8, 'stock 10 − 2');
    const c = await commerce();
    assert.ok(c.inventoryLog.some(e => e.orderId === orderId && e.delta === -2));
    await main.getByRole('button', { name: 'Fulfill items' }).click();
    const dlg = page.getByRole('dialog', { name: 'Fulfill #1001' });
    await dlg.getByLabel('Carrier').selectOption('UPS');
    await dlg.getByLabel('Tracking number').fill('1Z999AA10123456784');
    await dlg.getByRole('button', { name: 'Fulfill items' }).click();
    await main.getByText(/tracking 1Z999AA10123456784/).first().waitFor();
    const o = (await commerce()).orders.find(x => x.id === orderId);
    assert.equal(o.financialStatus, 'paid'); assert.equal(o.fulfillmentStatus, 'fulfilled'); assert.equal(o.fulfillments[0].carrier, 'UPS');
    await shot('order');
  });

  await step('draft order → complete → cancel restocks; partial refund on #1001', async () => {
    await nav('Orders');
    await main.getByRole('button', { name: 'Create order' }).first().click();
    const sel = main.getByLabel('Product to add');
    await sel.selectOption(await sel.locator('option', { hasText: 'Test Hoodie — M ·' }).getAttribute('value'));
    await main.getByRole('button', { name: 'Add', exact: true }).click();
    await main.getByLabel('Existing customer').selectOption({ label: 'Ana Lima · ana@example.com' });
    await main.getByRole('button', { name: 'Save as draft' }).click();
    await main.getByRole('button', { name: /^Drafts/ }).click();
    await main.getByRole('button', { name: 'D1' }).click();
    await main.getByRole('heading', { name: 'Draft order D1' }).waitFor();
    await main.getByLabel('Mark as paid').check();
    await main.getByRole('button', { name: 'Complete order' }).click();
    await main.getByRole('heading', { level: 1 }).filter({ hasText: '#1002' }).waitFor();
    assert.equal((await store()).products.find(x => x.title === 'Test Hoodie').variants[1].stock, 4);
    await main.getByRole('button', { name: 'Cancel order' }).click();
    const dlg = page.getByRole('dialog', { name: 'Cancel #1002?' });
    await dlg.getByLabel('Reason').selectOption('Items unavailable');
    await dlg.getByRole('button', { name: 'Cancel order' }).click();
    await main.getByText('Cancelled', { exact: true }).first().waitFor();
    assert.equal((await store()).products.find(x => x.title === 'Test Hoodie').variants[1].stock, 5, 'restocked');
    const o2 = (await commerce()).orders.find(x => x.name === '#1002');
    assert.equal(o2.status, 'cancelled'); assert.equal(o2.financialStatus, 'refunded');
    // partial refund without restock on #1001
    await main.getByRole('textbox', { name: 'Filter orders' }).or(main.getByLabel('Back to orders')).first().click();
    await main.getByRole('button', { name: '#1001' }).click();
    await main.getByRole('button', { name: 'Refund', exact: true }).click();
    const rd = page.getByRole('dialog', { name: 'Refund #1001' });
    await rd.getByLabel('Refund amount').fill('4.99');
    await rd.getByLabel('Restock items').uncheck();
    await rd.getByRole('button', { name: /^Refund/ }).click();
    await main.getByText('Partially refunded').first().waitFor();
    const o1 = (await commerce()).orders.find(x => x.name === '#1001');
    assert.equal(o1.refunds[0].amount, 4.99); assert.equal((await store()).products.find(x => x.title === 'Test Hoodie').variants[0].stock, 8);
  });

  await step('orders list, customer page and search', async () => {
    await nav('Orders');
    await main.getByRole('button', { name: '#1001' }).waitFor();
    await shot('orders');
    await page.keyboard.press('Escape');
    await main.click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('/');
    const search = page.getByRole('combobox', { name: 'Search orders, products and customers' });
    assert.equal(await search.evaluate(el => el === document.activeElement), true, '"/" focuses search');
    await search.evaluate(el => el.blur()); await page.keyboard.press('Control+k');
    assert.equal(await search.evaluate(el => el === document.activeElement), true, 'Ctrl+K focuses search');
    await search.fill('ana@');
    await page.getByRole('listbox', { name: 'Search results' }).getByText('Customer').first().waitFor();
    await search.press('ArrowDown'); await search.press('ArrowUp');
    const opts = page.getByRole('option');
    const custIdx = (await opts.allTextContents()).findIndex(t => t.startsWith('Customer'));
    await opts.nth(custIdx).dispatchEvent('mousedown');
    await main.getByRole('heading', { name: 'Ana Lima', level: 1 }).waitFor();
    await main.locator('.caKpi', { hasText: 'Amount spent' }).getByText('$100.00').waitFor();
  });

  await step('analytics shows the order', async () => {
    await nav('Analytics');
    await main.getByRole('group', { name: 'Orders', exact: true }).getByText('1', { exact: true }).waitFor();
    await main.getByRole('group', { name: 'Total sales', exact: true }).getByText('$100.00').waitFor();
    await main.getByRole('list', { name: 'Top products by sales' }).getByText(/Test Hoodie/).waitFor();
    await main.getByText('Connect a backend to collect live orders').waitFor();
    await main.getByLabel('Order webhook URL').fill('https://example.com/orders');
    await page.waitForFunction(() => window.__commerce.settings.backend.orderWebhookUrl === 'https://example.com/orders');
    await main.getByLabel('Date range').selectOption('7d');
    await main.getByRole('group', { name: 'Orders', exact: true }).getByText('1', { exact: true }).waitFor();
    await shot('analytics');
  });

  await step('View store opens a tracked preview; the visit lands in analytics', async () => {
    const [popup] = await Promise.all([ctx.waitForEvent('page'), page.getByRole('button', { name: 'View store' }).click()]);
    await popup.waitForLoadState();
    await page.waitForFunction(() => (window.__commerce.analytics.events || []).some(e => e.type === 'visit'), null, { timeout: 10000 });
    await popup.close();
  });

  await step('Analytics shows the visitor globe and Top locations after a preview session', async () => {
    const visit = (await commerce()).analytics.events.find(e => e.type === 'visit');
    assert.ok(visit.geo && /^[A-Z]{2}$/.test(visit.geo.country), 'the preview visit carries an approximate location');
    await nav('Analytics');
    const card = main.getByRole('region', { name: 'Visitors around the world' });
    const globe = card.getByRole('img', { name: /Globe of visitor locations: \d+ sessions? from \d+ countr/ });
    await globe.waitFor();
    const list = card.getByRole('list', { name: 'Top locations' });
    await list.getByRole('listitem').first().waitFor();
    assert.ok(await list.getByRole('listitem').count() >= 1);
    await list.getByRole('button').first().focus();
    await card.getByRole('status').waitFor(); // keyboard focus shows the same tooltip as hovering a marker
    const box = await globe.boundingBox();
    assert.ok(box.width > 200 && box.height > 200, 'the globe canvas has a real size');
    const painted = await globe.evaluate(c => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 16) { const r = d[i], g = d[i + 1], b = d[i + 2]; if ((g > r + 25 && g > b + 15) || (r > 200 && g > 90 && g < 190 && b < 120)) n++; } return n; });
    assert.ok(painted > 200, 'land dots in the theme colour (sage in light, amber in dark) are drawn');
    await page.mouse.move(5, 5);
    await card.scrollIntoViewIfNeeded(); await page.waitForTimeout(300);
    await card.screenshot({ path: join(evidence, 'globe-light.jpg'), type: 'jpeg', quality: 85 });
    await page.getByRole('button', { name: 'Switch to dark theme' }).click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(evidence, 'globe-dark.jpg'), type: 'jpeg', quality: 85 });
    await page.getByRole('button', { name: 'Switch to light theme' }).click();
  });

  await step('Online Store › Customize opens the store builder and returns', async () => {
    await nav('Online Store');
    await main.getByRole('heading', { name: 'Themes', level: 1 }).waitFor();
    await main.getByRole('button', { name: 'Customize', exact: true }).click();
    await page.getByRole('button', { name: 'Exit store builder' }).waitFor();
    await page.locator('iframe[title="Store preview"]').waitFor();
    await page.getByRole('button', { name: 'Exit store builder' }).click();
    await main.getByRole('heading', { name: 'Themes', level: 1 }).waitFor();
    assert.equal((await commerce()).onboarding.steps.theme, true);
  });

  await step('settings persist (taxes, general) and survive a reload without replaying the intro', async () => {
    await page.getByRole('navigation', { name: 'Commerce' }).getByRole('button', { name: 'Settings' }).click();
    await main.getByLabel('Legal business name').fill('Everyday Goods LLC');
    await main.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Taxes and duties' }).click();
    await main.getByRole('button', { name: 'Add rate' }).click();
    await main.getByLabel('Tax rate 1 percent').fill('8.25');
    await main.getByLabel('Tax rate 1 region').fill('TX');
    await main.getByRole('region', { name: 'Unsaved changes' }).getByRole('button', { name: 'Save' }).click();
    await page.waitForFunction(() => window.__commerce.settings.taxes.rates.length === 1);
    const c = await commerce();
    assert.equal(c.settings.general.legalName, 'Everyday Goods LLC');
    assert.deepEqual(c.settings.taxes.rates.map(r => [r.country, r.region, r.rate]), [['US', 'TX', 8.25]]);
    await page.reload();
    await main.waitFor();
    assert.equal(await page.getByTestId('commerce-intro').count(), 0, 'intro only on first open per session');
    await page.getByRole('navigation', { name: 'Commerce' }).getByRole('button', { name: 'Settings' }).click();
    await main.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Taxes and duties' }).click();
    assert.equal(await main.getByLabel('Tax rate 1 percent').inputValue(), '8.25');
    await nav('Home');
    await main.getByRole('group', { name: 'Orders', exact: true }).getByText('1', { exact: true }).waitFor();
    // the setup guide ticks itself off: a saved product with a sample photo, and the store builder was opened
    assert.equal(await page.getByRole('progressbar', { name: 'Setup progress' }).getAttribute('aria-valuenow'), '2');
    await shot('home');
  });

  await step('sample data: load → dashboard, Services bookings and the Analytics globe fill up; clear → back to the own data', async () => {
    const before = await commerce();
    const ownOrders = before.orders.length;
    await nav('Services');
    await main.getByRole('heading', { name: 'Services', level: 1 }).waitFor();
    await main.getByRole('button', { name: 'Load sample data' }).click();
    await page.waitForFunction(() => window.__commerce.sampleData && window.__commerce.bookings.length > 20);
    await main.getByRole('group', { name: 'Upcoming bookings', exact: true }).waitFor();
    assert.ok(await main.locator('.svUpcoming li').count() > 0, 'upcoming bookings listed');
    const c = await commerce();
    assert.ok(c.orders.length >= ownOrders + 170 && c.customers.length >= 60);
    await page.getByRole('navigation', { name: 'Commerce' }).getByRole('button', { name: 'Bookings', exact: true }).click();
    await main.getByRole('heading', { name: 'Bookings', level: 1 }).waitFor();
    await main.getByRole('button', { name: 'List', exact: true }).click();
    assert.ok(await main.getByRole('table', { name: 'Bookings' }).locator('tbody tr').count() > 0, 'bookings in the list view');
    await nav('Home');
    const ordersKpi = await main.getByRole('group', { name: 'Orders', exact: true }).locator('.caKpiValue').textContent();
    assert.ok(+ordersKpi.replace(/\D/g, '') > 10, 'dashboard orders: ' + ordersKpi);
    assert.notEqual((await main.getByRole('group', { name: 'Total sales', exact: true }).locator('.caKpiValue').textContent()).trim(), '$0.00');
    await shot('sample-home');
    await nav('Analytics');
    await page.locator('.caGlobeStats').waitFor();
    const countries = +(await page.locator('.caGlobeStats span').nth(1).locator('strong').textContent());
    assert.ok(countries >= 10, 'globe locations: ' + countries);
    await nav('Services');
    await main.getByRole('button', { name: 'Clear sample data' }).click();
    await page.getByRole('dialog', { name: 'Clear sample data?' }).getByRole('button', { name: 'Clear sample data' }).click();
    await page.waitForFunction(() => !window.__commerce.sampleData);
    const after = await commerce();
    assert.equal(after.orders.length, ownOrders, 'only the sample orders were removed');
    assert.equal(after.bookings.length + after.serviceProjects.length, 0);
    assert.ok(!after.customers.some(x => x.sample) && !after.analytics.events.some(e => e.sample));
    assert.ok(!(await store()).products.some(p => p.sample));
    await main.getByRole('heading', { name: 'Services', level: 1 }).waitFor();
    await main.getByRole('button', { name: 'Load sample data' }).waitFor();
    await nav('Home');
  });

  await step('settings: search jumps to a setting; secret keys are refused; Stripe, Supabase and GA4 save', async () => {
    const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
    const anon = b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ iss: 'supabase', ref: 'abcdefghijklmnopqrst', role: 'anon' }) + '.' + 'S'.repeat(43);
    const TOK = b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ iss: 'https://abcdefghijklmnopqrst.supabase.co/auth/v1', email: 'owner@everyday.test', role: 'authenticated' }) + '.sig';
    const SB = 'https://abcdefghijklmnopqrst.supabase.co', cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
    const seen = beMock.seen; beMock.SB = SB; beMock.TOK = TOK; beMock.anon = anon;
    await ctx.route(SB + '/**', r => { const q = r.request(); if (q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors }); seen.push([q.method(), q.url(), q.headers().apikey, q.postData(), q.headers().authorization]);
      const u = q.url(), json = (b, status = 200) => r.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(b) });
      if (u.includes('/auth/v1/token?grant_type=password')) return JSON.parse(q.postData()).password === 'hunter22' ? json({ access_token: TOK, refresh_token: 'refresh-1', expires_in: 3600, user: { email: 'owner@everyday.test' } }) : json({ error_description: 'Invalid login credentials' }, 400);
      if (u.endsWith('/stripe-connect-onboard')) return q.headers().authorization === 'Bearer ' + TOK ? json({ url: 'https://connect.stripe.com/setup/e/acct_1TestAcct12345/x', accountId: 'acct_1TestAcct12345', onboardingStatus: 'pending' }) : json({ error: { code: 'auth_required', message: 'Sign in first' } }, 401);
      if (u.endsWith('/functions/v1/sync-catalog')) { if (beMock.failSync > 0) { beMock.failSync--; return json({ error: { code: 'internal', message: 'Database unavailable' } }, 500); } beMock.syncs.push({ body: JSON.parse(q.postData()), auth: q.headers().authorization }); return json({ ok: true, products: JSON.parse(q.postData()).products.length, deactivated: 0 }); }
      if (u.includes('/functions/v1/stripe-connect-status')) return json({ connected: true, accountId: 'acct_1TestAcct12345', onboardingStatus: 'connected', status: 'complete', chargesEnabled: true, payoutsEnabled: true, requirementsDue: [] });
      if (u.includes('/rest/v1/orders?')) { beMock.reads.push(q.headers().authorization); return json(beMock.orders); }
      if (u.includes('/rest/v1/bookings?') || u.includes('/rest/v1/service_projects?')) return json([]);
      return r.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: '{}' }); });
    await ctx.route(/connect\.stripe\.com/, r => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>Stripe onboarding</title>' }));
    await page.getByRole('navigation', { name: 'Commerce' }).getByRole('button', { name: 'Settings' }).click();
    const pill = main.getByRole('region', { name: 'Unsaved changes' }), sections = main.getByRole('navigation', { name: 'Settings sections' });
    await main.getByRole('searchbox', { name: 'Search settings' }).fill('statement');
    await main.getByRole('group', { name: 'Matching settings' }).getByRole('button', { name: /Statement descriptor/ }).click();
    await main.getByRole('heading', { name: 'Payments', level: 1 }).waitFor();
    await page.waitForFunction(() => document.activeElement && document.activeElement.closest('#cs-descriptor'));
    await main.getByRole('textbox', { name: 'Statement descriptor', exact: true }).fill('EVERYDAY GOODS');
    await main.getByLabel('Test publishable key').fill('sk_test_51AbCdEfGhIjKlMnOp');
    await main.getByText(/Never paste it here: set STRIPE_SECRET_KEY/).waitFor();
    assert.equal(await pill.getByRole('button', { name: 'Save' }).isDisabled(), true, 'a secret key blocks saving');
    await main.getByLabel('Test publishable key').fill('pk_test_51AbCdEfGhIjKlMnOp');
    await main.getByRole('switch', { name: 'Klarna', exact: true }).check();
    await pill.getByRole('button', { name: 'Save' }).click();
    await page.waitForFunction(() => window.__commerce.settings.payments.stripe.publishableKeyTest === 'pk_test_51AbCdEfGhIjKlMnOp');
    let st = (await commerce()).settings.payments.stripe;
    assert.ok(st.paymentMethods.includes('klarna')); assert.equal(st.statementDescriptor, 'EVERYDAY GOODS');
    // Supabase + GA4 in Apps and integrations, with a real "Test connection" request
    await sections.getByRole('button', { name: 'Apps and integrations' }).click();
    await main.getByRole('button', { name: /^Supabase/ }).click();
    await main.getByLabel('Supabase: Project URL').fill(SB);
    await main.getByLabel('Supabase: Anon public key').fill(anon);
    await main.getByRole('button', { name: /^Google Analytics 4/ }).click();
    await main.getByLabel('Google Analytics 4: Measurement ID').fill('G-ABC123XYZ9');
    await main.getByRole('button', { name: 'Test connection' }).click();
    await main.getByText(/Connected — the project answered 200/).waitFor();
    assert.deepEqual(seen[0].slice(0, 3), ['GET', SB + '/rest/v1/', anon]);
    await pill.getByRole('button', { name: 'Save' }).click();
    await page.waitForFunction(() => window.__commerce.settings.integrations.ga4.measurementId === 'G-ABC123XYZ9' && window.__commerce.settings.integrations.backend.provider === 'supabase');
    // Connect with Stripe needs the merchant's session: it asks to sign in first, then calls the onboarding function
    // with Authorization: Bearer <access token> (+ apikey: anon) and opens the returned link
    await sections.getByRole('button', { name: 'Payments' }).click();
    await page.getByRole('button', { name: 'Sign in to backend' }).waitFor();
    await main.getByRole('button', { name: 'Connect with Stripe' }).click();
    const dlg = page.getByRole('dialog', { name: 'Sign in to your backend' });
    await dlg.waitFor();
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(evidence, 'backend-sign-in.jpg'), type: 'jpeg', quality: 82 });
    await dlg.getByRole('button', { name: 'Password', exact: true }).click();
    await dlg.getByLabel('Account email').fill('owner@everyday.test');
    await dlg.getByLabel('Password', { exact: true }).fill('wrong');
    await dlg.getByRole('button', { name: 'Sign in', exact: true }).click();
    await dlg.getByText('Invalid login credentials').waitFor();
    await dlg.getByLabel('Password', { exact: true }).fill('hunter22');
    const [popup] = await Promise.all([ctx.waitForEvent('page'), dlg.getByRole('button', { name: 'Sign in', exact: true }).click()]);
    await popup.close();
    await dlg.waitFor({ state: 'detached' });
    const call = seen.find(x => x[1] === SB + '/functions/v1/stripe-connect-onboard');
    assert.ok(call, 'onboarding function called'); assert.equal(JSON.parse(call[3]).connectType, 'standard');
    assert.equal(call[4], 'Bearer ' + TOK, 'the merchant access token is sent'); assert.equal(call[2], anon, 'apikey is the anon key');
    await main.getByText(/Signed in to your backend as owner@everyday.test/).waitFor();
    await main.getByText('Onboarding pending').first().waitFor();
    await main.getByText(SB + '/functions/v1/stripe-webhook').waitFor();
    await pill.getByRole('button', { name: 'Save' }).click();
    await page.waitForFunction(() => window.__commerce.settings.payments.stripe.accountId === 'acct_1TestAcct12345');
    st = (await commerce()).settings.payments.stripe;
    assert.equal(st.onboardingStatus, 'pending'); assert.equal(st.enabled, true);
    assert.doesNotMatch(JSON.stringify(await commerce()), /sk_test_|sk_live_|whsec_/, 'no secret was stored');
  });

  await step('backend session: refresh Stripe status, publish + auto-sync the catalog, sync orders twice without duplicates, sign out', async () => {
    const { SB, TOK } = beMock, sections = main.getByRole('navigation', { name: 'Settings sections' }), pill = main.getByRole('region', { name: 'Unsaved changes' });
    // the Settings save above changed the payments the checkout trusts → debounced auto-sync with the bearer token
    await page.waitForFunction(() => document.querySelector('.caBeChip')?.textContent.includes('Synced'), null, { timeout: 8000 });
    assert.equal(beMock.syncs.length, 1, 'one auto-sync after saving'); assert.equal(beMock.syncs[0].auth, 'Bearer ' + TOK);
    // Refresh status → stripe-connect-status → charges/payouts/status/account written back into settings
    await main.getByRole('button', { name: 'Refresh status' }).click();
    await main.getByText('Connected', { exact: true }).first().waitFor();
    await pill.getByRole('button', { name: 'Save' }).click();
    await page.waitForFunction(() => window.__commerce.settings.payments.stripe.onboardingStatus === 'connected');
    const st = (await commerce()).settings.payments.stripe;
    assert.equal(st.chargesEnabled, true); assert.equal(st.payoutsEnabled, true); assert.equal(st.accountId, 'acct_1TestAcct12345');
    const sid = (await store()).id;
    assert.ok(beMock.seen.some(x => x[1] === SB + '/functions/v1/stripe-connect-status?store=' + encodeURIComponent(sid)), 'status function called for this store');
    assert.equal(beMock.seen.find(x => x[1].includes('stripe-connect-status'))[4], 'Bearer ' + TOK);
    // Apps and integrations: the signed-in state
    await sections.getByRole('button', { name: 'Apps and integrations' }).click();
    const account = main.getByRole('region', { name: 'Backend account' });
    await account.getByText('Signed in as owner@everyday.test').waitFor();
    await account.scrollIntoViewIfNeeded(); await page.waitForTimeout(300);
    await page.screenshot({ path: join(evidence, 'backend-signed-in.jpg'), type: 'jpeg', quality: 82 });
    // Products: Publish catalog to backend posts catalogSnapshot(store, commerce)
    await nav('Products');
    const before = beMock.syncs.length;
    await main.getByRole('button', { name: 'Publish catalog to backend' }).click();
    await until(() => beMock.syncs.length > before);
    await main.getByText(/Synced just now/).waitFor();
    const snap = beMock.syncs.at(-1).body, s = await store();
    assert.equal(snap.store.id, s.id); assert.equal(snap.products.length, s.products.length);
    assert.deepEqual(snap.products.map(p => p.id), s.products.map(p => p.id));
    assert.equal(snap.products.find(p => p.title === 'Test Hoodie').price, 50);
    assert.doesNotMatch(JSON.stringify(snap), /sk_test_|sk_live_|whsec_|service_role|refresh-1/, 'no secrets or session in the snapshot');
    // a failing sync shows "Sync failed — retry"; retry succeeds
    beMock.failSync = 1;
    await main.getByRole('button', { name: 'Publish catalog to backend' }).click();
    await main.getByText(/Sync failed —/).waitFor();
    await page.waitForTimeout(200);
    await page.screenshot({ path: join(evidence, 'backend-sync-failed.jpg'), type: 'jpeg', quality: 82 });
    await main.getByRole('button', { name: 'retry' }).click();
    await main.getByText(/Synced just now/).waitFor();
    // auto-sync after a product price edit
    const n0 = beMock.syncs.length;
    await main.getByRole('button', { name: 'Test Hoodie' }).first().click();
    await main.getByLabel('Price', { exact: true }).fill('55');
    await main.getByRole('button', { name: 'Save', exact: true }).first().click();
    await until(() => beMock.syncs.length > n0, 8000);
    assert.equal(beMock.syncs.at(-1).body.products.find(p => p.title === 'Test Hoodie').price, 55, 'the edited price was published');
    await nav('Products'); await main.getByText(/Synced just now/).waitFor();
    await page.screenshot({ path: join(evidence, 'backend-synced.jpg'), type: 'jpeg', quality: 82 });
    // Orders: sync imports the 2 backend orders; running it again adds nothing
    const count0 = (await commerce()).orders.length;
    await nav('Orders');
    await main.getByRole('button', { name: 'Sync orders from backend' }).click();
    await page.getByRole('status').filter({ hasText: 'Imported 2 orders, 0 bookings' }).waitFor();
    let c = await commerce();
    assert.equal(c.orders.length, count0 + 2); assert.deepEqual(c.orders.filter(o => o.id.startsWith('sb_')).map(o => o.name).sort(), ['#2001', '#2002']);
    assert.equal(beMock.reads[0], 'Bearer ' + TOK, 'orders are read with the owner token (RLS)');
    await main.getByRole('button', { name: '#2001' }).waitFor();
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(evidence, 'backend-orders-sync.jpg'), type: 'jpeg', quality: 82 });
    await main.getByRole('button', { name: 'Sync orders from backend' }).click();
    await page.getByRole('status').filter({ hasText: 'already up to date' }).waitFor();
    c = await commerce();
    assert.equal(c.orders.length, count0 + 2, 're-sync does not duplicate');
    // the session lives only in this tab's sessionStorage — never in the documents or localStorage
    const leaks = await page.evaluate(t => ({ ls: JSON.stringify({ ...localStorage }).includes(t), docs: JSON.stringify([window.__store, window.__commerce]).includes(t), ss: JSON.stringify({ ...sessionStorage }).includes(t) }), TOK);
    assert.deepEqual(leaks, { ls: false, docs: false, ss: true });
    // sign out from Settings › Apps and integrations
    await page.getByRole('button', { name: /^Backend: signed in as owner@everyday.test/ }).click();
    await main.getByRole('region', { name: 'Backend account' }).getByRole('button', { name: 'Sign out' }).click();
    await page.getByRole('button', { name: 'Sign in to backend' }).waitFor();
    const card = main.getByRole('form', { name: 'Sign in to your backend' });
    await card.getByRole('button', { name: 'One-time code' }).click();
    await card.evaluate(el => el.scrollIntoView({ block: 'center' })); await page.waitForTimeout(300);
    await page.screenshot({ path: join(evidence, 'backend-sign-in-card.jpg'), type: 'jpeg', quality: 82 });
    // magic-link return: tokens in the URL hash sign in and are removed from the URL
    await page.goto('about:blank'); await page.goto(url + '#access_token=' + TOK + '&refresh_token=refresh-2&expires_in=3600&token_type=bearer&type=magiclink');
    await page.getByRole('status').filter({ hasText: 'Signed in to your backend as owner@everyday.test' }).waitFor();
    assert.equal(await page.evaluate(() => location.hash), '');
    await page.getByRole('button', { name: /^Backend: signed in as owner@everyday.test/ }).waitFor();
    await ctx.unroute(SB + '/**'); await ctx.unroute(/connect\.stripe\.com/);
  });

  await step('no page errors; shortcuts do not leak (keys reach the window only when unhandled)', async () => {
    const leaked = await page.evaluate(() => new Promise(res => {
      let got = 0; const h = () => { got++; }; document.addEventListener('keydown', h);
      document.activeElement && document.activeElement.blur();
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }));
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }));
      setTimeout(() => { document.removeEventListener('keydown', h); res(got); }, 50);
    }));
    assert.equal(leaked, 1, '"/" is handled and stopped, "x" passes through');
    assert.deepEqual(errors, []);
  });
  if (process.env.ADMIN_SHOTS) { // optional visual review of every page: ADMIN_SHOTS=<dir>
    const pages = [['Orders'], ['Products'], ['Inventory', 'Products'], ['Collections', 'Products'], ['Customers'], ['Discounts'], ['Marketing'], ['Themes', 'Online Store'], ['Pages', 'Online Store'], ['Navigation', 'Online Store'], ['Preferences', 'Online Store']];
    for (const [name, parent] of pages) { if (parent) await nav(parent); await nav(name); await page.waitForTimeout(300); await page.screenshot({ path: join(process.env.ADMIN_SHOTS, name + '.jpg'), type: 'jpeg', quality: 70, fullPage: false }); }
    await nav('Orders'); await main.getByRole('button', { name: 'Create order' }).first().click(); await page.screenshot({ path: join(process.env.ADMIN_SHOTS, 'new-order.jpg'), type: 'jpeg', quality: 70 });
    await page.getByRole('navigation', { name: 'Commerce' }).getByRole('button', { name: 'Settings' }).click();
    for (const t of ['General', 'Payments', 'Shipping and delivery', 'Notifications', 'Policies', 'Domains']) { await main.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: t }).click(); await page.screenshot({ path: join(process.env.ADMIN_SHOTS, 'set-' + t.split(' ')[0] + '.jpg'), type: 'jpeg', quality: 70 }); }
    await page.setViewportSize({ width: 820, height: 1100 }); await nav('Home').catch(() => {}); await page.screenshot({ path: join(process.env.ADMIN_SHOTS, 'tablet.jpg'), type: 'jpeg', quality: 70 });
  }
  console.log('All admin e2e steps passed');
} finally {
  await browser.close(); server.close(); await rm(work, { recursive: true, force: true });
}
