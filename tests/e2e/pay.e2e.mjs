// Browser test of online payments in the exported storefront (src/store/commerce.js payRuntime) against a mocked backend:
// pay button → create-checkout-session payload → redirect to Stripe, errors + WhatsApp fallback, success page (cart
// cleared, order status), cancel page, analytics beacons, service booking (slots, intake, add-ons), and the unchanged
// WhatsApp flow when Stripe is not configured.
// Run: node tests/e2e/pay.e2e.mjs   (no app build needed; needs Playwright + Chromium)
import { createRequire } from 'node:module';
import http from 'node:http';
import { mkdtemp, writeFile, mkdir, readFile } from 'node:fs/promises';
import { join, dirname, extname, normalize } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { createStore } from '../../src/store/templates.js';
import { normalizeCommerce } from '../../src/store/admin/model.js';
import { buildSiteFiles } from '../../src/store/exporter.js';
import { normalizeService } from '../../src/store/serviceProduct.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const FN = 'https://abcdefghijklmnop.supabase.co/functions/v1';

async function site(stripeEnabled) {
  const store = createStore('general');
  store.checkout.mode = 'whatsapp'; store.checkout.phone = '15551234567';
  const svc = { ...store.products[0], id: 'svc1', slug: 'strategy-call', title: 'Strategy call', kind: 'service', status: 'active', price: 120,
    variants: [{ ...store.products[0].variants[0], id: 'svd', options: store.products[0].variants[0].options.map(() => ''), price: null, stock: null, sku: '' }],
    service: normalizeService({ booking: { enabled: true, timezone: 'UTC' }, intake: [{ id: 'q1', label: 'Your website', type: 'url', required: true }], addOns: [{ id: 'rec', name: 'Recording', price: 30 }] }) };
  store.products.push(svc);
  const commerce = normalizeCommerce({ storeId: store.id, settings: {
    shipping: { zones: [{ name: 'US', countries: ['US'], rates: [{ id: 'std', name: 'Standard', type: 'flat', price: 6 }] }] }, taxes: { inclusive: false, shippingTaxed: false, rates: [{ country: 'US', rate: 5 }] },
    payments: { stripe: { enabled: stripeEnabled, mode: 'test', publishableKeyTest: 'pk_test_abcdefghij1234', connectType: 'express' } },
    integrations: { backend: { provider: 'supabase', url: 'https://abcdefghijklmnop.supabase.co', anonKey: 'sb_publishable_abcdefghijklmnop' } },
  }, discounts: [{ id: 'd10', code: 'SAVE10', type: 'percentage', value: 10 }] });
  const dir = await mkdtemp(join(tmpdir(), 'pay-e2e-'));
  for (const f of await buildSiteFiles(store, { commerce })) { const p = join(dir, f.name); await mkdir(dirname(p), { recursive: true }); await writeFile(p, f.data); }
  return { store, dir };
}

function serve(dir) {
  return new Promise(res => { const s = http.createServer(async (req, rsp) => {
    const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^[/\\]+/, '') || 'index.html';
    try { const b = await readFile(join(dir, p)); rsp.writeHead(200, { 'content-type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(p)] || 'application/octet-stream' }); rsp.end(b); }
    catch { rsp.writeHead(404); rsp.end(); }
  }); s.listen(0, '127.0.0.1', () => res(s)); });
}

const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, apikey, authorization', 'access-control-allow-methods': 'POST, GET, OPTIONS' };
let failures = 0;
async function step(name, fn) { try { await fn(); console.log('ok   ' + name); } catch (e) { failures++; console.log('FAIL ' + name + '\n     ' + (e.stack || e).toString().split('\n').slice(0, 6).join('\n     ')); } }

const browser = await chromium.launch();
const on = await site(true), off = await site(false);
const srvOn = await serve(on.dir), srvOff = await serve(off.dir);
const urlOn = `http://127.0.0.1:${srvOn.address().port}/`, urlOff = `http://127.0.0.1:${srvOff.address().port}/`;
const p0 = on.store.products[0], cartOf = lines => JSON.stringify(lines);

async function page(baseUrl, store, cart, handlers = {}) {
  const ctx = await browser.newContext();
  const calls = { checkout: [], track: [], status: 0, slots: 0 };
  await ctx.addInitScript(([k, v]) => { if (!sessionStorage.getItem('__seeded')) { localStorage.setItem(k, v); sessionStorage.setItem('__seeded', '1'); } }, ['zstore-cart:' + store.id, cartOf(cart)]);
  await ctx.route(FN + '/**', async r => {
    const q = r.request(), u = new URL(q.url());
    if (q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    if (u.pathname.endsWith('/track')) { calls.track.push(JSON.parse(q.postData() || '{}')); return r.fulfill({ status: 204, headers: cors }); }
    if (u.pathname.endsWith('/create-checkout-session')) { calls.checkout.push({ body: JSON.parse(q.postData()), headers: q.headers() }); return handlers.checkout ? handlers.checkout(r) : r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ url: 'https://checkout.stripe.com/c/pay/cs_test_abc123' }) }); }
    if (u.pathname.endsWith('/order-status')) { calls.status++; return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ order: { number: 1001, financialStatus: 'paid', total: 53.25, currency: 'USD', email: 'a••@x.io', downloads: [] } }) }); }
    if (u.pathname.endsWith('/booking-slots')) { calls.slots++; return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ timezone: 'UTC', durationMinutes: 60, slots: [{ date: '2030-01-07', start: '2030-01-07T09:00:00.000Z', end: '2030-01-07T10:00:00.000Z' }, { date: '2030-01-07', start: '2030-01-07T10:15:00.000Z', end: '2030-01-07T11:15:00.000Z' }] }) }); }
    return r.fulfill({ status: 404, headers: cors });
  });
  await ctx.route('https://wa.me/**', r => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>WhatsApp (mock)</title>' }));
  await ctx.route('https://checkout.stripe.com/**', r => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>Stripe Checkout (mock)</title><h1>Pay</h1>' }));
  const pg = await ctx.newPage(), errors = [];
  pg.on('pageerror', e => errors.push(e.message));
  return { ctx, pg, calls, errors };
}

await step('Stripe configured: checkout POSTs the cart (server-priced fields only) and redirects to Stripe Checkout', async () => {
  const { ctx, pg, calls, errors } = await page(urlOn, on.store, [{ pid: p0.id, vid: p0.variants[0].id, qty: 2 }]);
  await pg.goto(urlOn + 'checkout.html');
  const btn = pg.getByRole('button', { name: /Continue to secure payment/ });
  await btn.waitFor();
  assert.match(await pg.locator('.co-form .sec-sub').textContent(), /Stripe/);
  await pg.getByLabel('Country').selectOption('US');
  await pg.locator('[data-ship-rate]').first().waitFor();
  await pg.getByLabel('Full name').fill('Ada Shopper');
  await Promise.all([pg.waitForURL(/checkout\.stripe\.com/), btn.click()]);
  assert.equal(calls.checkout.length, 1);
  const { body, headers } = calls.checkout[0];
  assert.equal(body.storeId, on.store.id); assert.deepEqual(body.lines, [{ productId: p0.id, variantId: p0.variants[0].id, quantity: 2, price: p0.variants[0].price ?? p0.price }]);
  assert.equal(body.country, 'US'); assert.equal(body.rateId, 'std'); assert.equal(body.customer.name, 'Ada Shopper'); assert.equal(body.returnUrl, urlOn);
  assert.match(body.checkoutId, /^co_/); assert.equal(typeof body.expectedTotal, 'number');
  assert.equal(headers.apikey, 'sb_publishable_abcdefghijklmnop'); assert.equal(headers.authorization, undefined, 'non-JWT keys are not sent as Bearer');
  assert.deepEqual(errors, []);
  await ctx.close();
});

await step('server errors are shown; an unreachable backend offers the WhatsApp fallback', async () => {
  let mode = 'error';
  const { ctx, pg } = await page(urlOn, on.store, [{ pid: p0.id, vid: p0.variants[0].id, qty: 1 }], {
    checkout: r => mode === 'error' ? r.fulfill({ status: 409, headers: cors, contentType: 'application/json', body: JSON.stringify({ error: { code: 'cart_invalid', message: 'Only 1 of “Tee” left.' } }) }) : r.abort('failed'),
  });
  await pg.goto(urlOn + 'checkout.html');
  await pg.getByLabel('Country').selectOption('US');
  await pg.getByLabel('Full name').fill('Ada');
  await pg.getByRole('button', { name: /Continue to secure payment/ }).click();
  await pg.locator('[data-zt-pay-msg]', { hasText: 'Only 1 of “Tee” left.' }).waitFor();
  assert.equal(await pg.locator('[data-zt-pay-fallback]').count(), 0);
  mode = 'down';
  await pg.getByRole('button', { name: /Continue to secure payment/ }).click();
  await pg.locator('[data-zt-pay-msg]', { hasText: 'could not reach the payment service' }).waitFor();
  const [popup] = await Promise.all([pg.waitForEvent('popup'), pg.getByRole('button', { name: 'Send the order on WhatsApp instead' }).click()]);
  assert.equal(new URL(popup.url()).host, 'wa.me');
  await ctx.close();
});

await step('success page: confirmation with order number, cart emptied; cancel page keeps the cart', async () => {
  const { ctx, pg, calls } = await page(urlOn, on.store, [{ pid: p0.id, vid: p0.variants[0].id, qty: 1 }]);
  await pg.goto(urlOn + 'checkout.html?zt_checkout=success&session_id=cs_test_abcdefgh12345');
  await pg.locator('[data-zt-paid]').waitFor();
  await pg.locator('[data-zt-order-status]', { hasText: 'Order #1001' }).waitFor();
  assert.equal(await pg.evaluate(k => localStorage.getItem(k), 'zstore-cart:' + on.store.id), '[]');
  assert.ok(await pg.locator('[data-checkout-form]').isHidden());
  assert.ok(calls.status >= 1);
  await ctx.close();
  const b = await page(urlOn, on.store, [{ pid: p0.id, vid: p0.variants[0].id, qty: 1 }]);
  await b.pg.goto(urlOn + 'cart.html?zt_checkout=cancel');
  await b.pg.locator('[data-zt-pay-cancel]', { hasText: 'Payment cancelled' }).waitFor();
  assert.equal(await b.pg.locator('[data-cart-page] [data-line]').count(), 1);
  await b.ctx.close();
});

await step('analytics: visit, page_view, view_product and add_to_cart beacons reach `track`', async () => {
  const { ctx, pg, calls } = await page(urlOn, on.store, []);
  await pg.goto(urlOn + 'products/' + p0.slug + '.html?utm_source=ig');
  await pg.getByRole('button', { name: /Add to cart/ }).first().click();
  await pg.waitForTimeout(3500);
  await pg.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  const types = calls.track.flatMap(b => b.events.map(e => e.type));
  for (const t of ['visit', 'page_view', 'view_product', 'add_to_cart']) assert.ok(types.includes(t), 'missing ' + t + ' in ' + types);
  const visit = calls.track.flatMap(b => b.events).find(e => e.type === 'visit');
  assert.deepEqual(visit.utm, { source: 'ig' }); assert.equal(calls.track[0].storeId, on.store.id); assert.match(calls.track[0].sessionId, /^s_/);
  assert.equal(calls.track.flatMap(b => b.events).find(e => e.type === 'view_product').productId, p0.id);
  await ctx.close();
});

await step('service in the cart: time slot from booking-slots, intake answer and add-on are sent', async () => {
  const { ctx, pg, calls } = await page(urlOn, on.store, [{ pid: 'svc1', vid: 'svd', qty: 1 }]);
  await pg.goto(urlOn + 'checkout.html');
  const fs = pg.locator('[data-zt-svc]');
  await fs.waitFor();
  await pg.locator('[data-zt-day] option[value="2030-01-07"]').waitFor({ state: 'attached' });
  await pg.getByLabel('Full name').fill('Ada');
  await pg.getByRole('button', { name: /Continue to secure payment/ }).click(); // blocked: time + required intake missing
  await pg.waitForTimeout(300);
  assert.equal(calls.checkout.length, 0); assert.equal(await fs.locator('[data-zt-slot]').evaluate(el => el.validity.valueMissing), true);
  await fs.locator('[data-zt-day]').selectOption('2030-01-07');
  await fs.locator('[data-zt-slot]').selectOption('2030-01-07T10:15:00.000Z');
  await fs.locator('[data-zt-q]').fill('https://ada.dev');
  await fs.locator('[data-zt-addon="rec"]').check();
  await Promise.all([pg.waitForURL(/checkout\.stripe\.com/), pg.getByRole('button', { name: /Continue to secure payment/ }).click()]);
  const line = calls.checkout[0].body.lines[0];
  assert.equal(line.start, '2030-01-07T10:15:00.000Z'); assert.deepEqual(line.intake, [{ question: 'Your website', answer: 'https://ada.dev' }]); assert.deepEqual(line.addOns, ['rec']);
  assert.ok(calls.slots >= 1);
  await ctx.close();
});

await step('Stripe not configured: the WhatsApp checkout is unchanged (fallback)', async () => {
  const q0 = off.store.products[0];
  const { ctx, pg, calls } = await page(urlOff, off.store, [{ pid: q0.id, vid: q0.variants[0].id, qty: 1 }]);
  await pg.goto(urlOff + 'checkout.html');
  await pg.getByRole('button', { name: 'Send order on WhatsApp' }).waitFor();
  assert.equal(await pg.locator('[data-zt-pay]').count(), 0);
  await pg.getByLabel('Full name').fill('Ada');
  const [popup] = await Promise.all([pg.waitForEvent('popup'), pg.getByRole('button', { name: 'Send order on WhatsApp' }).click()]);
  assert.equal(new URL(popup.url()).host, 'wa.me'); assert.equal(calls.checkout.length, 0);
  await ctx.close();
});

await browser.close(); srvOn.close(); srvOff.close();
if (failures) { console.log(`\n${failures} step(s) failed`); process.exit(1); }
console.log('\npay e2e: all steps passed');
