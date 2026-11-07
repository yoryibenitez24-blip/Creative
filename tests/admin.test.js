// Unit tests for the commerce back office (src/store/admin/*): model, discounts, orders, inventory, customers CSV, analytics.
// Run: node --test tests/admin.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCommerce, createCommerce, normalizeDiscountDoc, policyText, fillTemplate, utmUrl, POLICY_KEYS, NOTIFICATION_KEYS } from '../src/store/admin/model.js';
import { applyDiscounts, discountStatus, describeDiscount } from '../src/store/admin/discounts.js';
import { computeOrderTotals, createOrder, markPaid, fulfillOrder, refundOrder, cancelOrder, completeDraft, shippingRatesFor, computeTax, taxRateFor, lineFor, orderEmail, orderDocumentHtml, importOrderPayloads, customerStats, filterOrders, setArchived } from '../src/store/admin/orders.js';
import { adjustStock, stockRows, sellable } from '../src/store/admin/inventory.js';
import { customersToCsv, importCustomersCsv } from '../src/store/admin/customers.js';
import { aggregateAnalytics, dayRange, presetRange, trackedPreviewHtml, parseTrackerMessage, addEvents } from '../src/store/admin/analytics.js';
import { normalizeStore } from '../src/store/model.js';
import { createStore } from '../src/store/templates.js';

const NOW = Date.parse('2026-06-15T12:00:00Z');
const D = (o) => normalizeDiscountDoc(o);
const L = (productId, price, quantity, extra = {}) => ({ id: productId + '-l', productId, variantId: productId + '-v', price, quantity, ...extra });

// ---------- model ----------
test('normalizeCommerce fills defaults and repairs bad values', () => {
  const c = normalizeCommerce(null);
  assert.equal(c.kind, 'commerce'); assert.equal(c.version, 1);
  assert.deepEqual(c.orders, []); assert.equal(c.settings.general.nextOrderNumber, 1001);
  for (const k of POLICY_KEYS) assert.ok(c.settings.policies[k].title);
  for (const k of NOTIFICATION_KEYS) assert.match(c.settings.notifications.templates[k].subject, /\{\{order_name\}\}/);
  const bad = normalizeCommerce({
    settings: { general: { weightUnit: 'stone', nextOrderNumber: 5 }, taxes: { rates: [{ country: 'de', rate: 250 }, { country: '' }] },
      shipping: { zones: [{ countries: ['us', 'XYZ', '*'], rates: [{ type: 'weight', tiers: [{ upTo: 5000, price: 9 }, { upTo: 1000, price: 4 }] }] }] },
      locations: [{ name: 'A', isDefault: true }, { name: 'B', isDefault: true }] },
    orders: [{ number: 1200, lines: [{ price: '-3', quantity: 0 }], financialStatus: 'weird' }, { number: 7, draft: true }],
    discounts: [{ code: ' save 10 ', type: 'percentage', value: 150 }],
  });
  assert.equal(bad.settings.general.weightUnit, 'kg');
  assert.equal(bad.settings.general.nextOrderNumber, 1201, 'next number is past existing orders');
  assert.equal(bad.settings.general.nextDraftNumber, 8);
  assert.deepEqual(bad.settings.taxes.rates.map(r => [r.country, r.rate]), [['DE', 100]]);
  assert.deepEqual(bad.settings.shipping.zones[0].countries, ['US', '*']);
  assert.deepEqual(bad.settings.shipping.zones[0].rates[0].tiers.map(t => t.upTo), [1000, 5000]);
  assert.deepEqual(bad.settings.locations.map(l => l.isDefault), [true, false]);
  assert.equal(bad.orders[0].financialStatus, 'pending'); assert.equal(bad.orders[0].lines[0].price, 0); assert.equal(bad.orders[0].lines[0].quantity, 1);
  assert.equal(bad.discounts[0].code, 'SAVE10'); assert.equal(bad.discounts[0].value, 100);
  assert.deepEqual(normalizeCommerce(JSON.parse(JSON.stringify(bad))), bad, 'idempotent');
});

test('createCommerce, policies, templates and UTM builder', () => {
  const store = createStore('general');
  const c = createCommerce(store);
  assert.equal(c.storeId, store.id);
  assert.ok(c.settings.shipping.zones.length >= 2);
  const txt = policyText('refund', { values: { returnDays: '14' } }, store, c);
  assert.match(txt, /14-day return policy/); assert.doesNotMatch(txt, /\{\{/);
  assert.equal(fillTemplate('Hi {{ name }}, {{x}}!', { name: 'Ana' }), 'Hi Ana, !');
  assert.equal(utmUrl({ url: 'https://shop.example/a?x=1#top', source: 'ig', medium: 'social', campaign: 'summer sale' }), 'https://shop.example/a?x=1&utm_source=ig&utm_medium=social&utm_campaign=summer%20sale#top');
  assert.equal(utmUrl({ url: '' }), '');
});

// ---------- discounts ----------
test('percentage code: rounding, allocation sums exactly, case-insensitive', () => {
  const r = applyDiscounts({ lines: [L('a', 10.01, 1), L('b', 3.33, 3)], codes: ['save15'], shipping: 5 }, [D({ id: 'd1', code: 'SAVE15', value: 15 })], NOW);
  assert.equal(r.subtotal, 20.00);
  assert.equal(r.discountTotal, 3.00);
  assert.equal(Math.round(r.lines.reduce((s, l) => s + l.discount * 100, 0)), 300, 'allocations sum to the discount');
  assert.equal(r.total, 22.00);
  assert.deepEqual(r.appliedCodes, ['SAVE15']);
  assert.equal(r.messages.length, 0);
});

test('fixed amount is capped at the eligible subtotal and spread over scoped lines', () => {
  const ds = [D({ id: 'f', code: 'TEN', type: 'fixed', value: 10, appliesTo: { kind: 'products', productIds: ['a'] } })];
  const r = applyDiscounts({ lines: [L('a', 4, 1), L('b', 50, 1)], codes: ['TEN'] }, ds, NOW);
  assert.equal(r.discountTotal, 4); assert.equal(r.lines[0].total, 0); assert.equal(r.lines[1].discount, 0); assert.equal(r.total, 50);
  const r2 = applyDiscounts({ lines: [L('a', 30, 2)], codes: ['TEN'] }, ds, NOW);
  assert.equal(r2.discountTotal, 10); assert.equal(r2.total, 50);
});

test('invalid, expired, scheduled, disabled, limited and once-per-customer codes give messages', () => {
  const ds = [
    D({ id: 'e', code: 'OLD', value: 10, endsAt: '2026-01-01' }), D({ id: 's', code: 'SOON', value: 10, startsAt: '2027-01-01' }),
    D({ id: 'x', code: 'OFF', value: 10, enabled: false }), D({ id: 'l', code: 'LIM', value: 10, usageLimit: 2, usageCount: 2 }),
    D({ id: 'o', code: 'ONCE', value: 10, oncePerCustomer: true }),
  ];
  const r = applyDiscounts({ lines: [L('a', 100, 1)], codes: ['NOPE', 'OLD', 'SOON', 'OFF', 'LIM', 'ONCE'], customerUsage: { o: 1 } }, ds, NOW);
  assert.equal(r.discountTotal, 0);
  assert.deepEqual(r.messages.map(m => m.code), ['NOPE', 'OLD', 'SOON', 'OFF', 'LIM', 'ONCE']);
  assert.match(r.messages[0].text, /not a valid/); assert.match(r.messages[1].text, /expired/); assert.match(r.messages[2].text, /not active yet/);
  assert.equal(discountStatus(ds[0], NOW), 'expired'); assert.equal(discountStatus(ds[3], NOW), 'limit_reached'); assert.equal(discountStatus(ds[4], NOW), 'active');
  assert.equal(discountStatus(D({ endsAt: '2026-06-15T12:00:00Z' }), NOW), 'expired', 'end is exclusive');
});

test('minimum amount / quantity requirements', () => {
  const ds = [D({ id: 'm', code: 'MIN50', value: 10, minimum: { kind: 'amount', value: 50 } }), D({ id: 'q', code: 'Q3', value: 10, minimum: { kind: 'quantity', value: 3 } })];
  let r = applyDiscounts({ lines: [L('a', 49.99, 1)], codes: ['MIN50'] }, ds, NOW);
  assert.equal(r.discountTotal, 0); assert.match(r.messages[0].text, /Add 0\.01 more/);
  r = applyDiscounts({ lines: [L('a', 50, 1)], codes: ['MIN50'] }, ds, NOW);
  assert.equal(r.discountTotal, 5);
  r = applyDiscounts({ lines: [L('a', 10, 2)], codes: ['Q3'] }, ds, NOW);
  assert.equal(r.discountTotal, 0); assert.match(r.messages[0].text, /1 more eligible/);
});

test('best non-combinable discount wins; combinable ones stack on the remainder', () => {
  const auto = D({ id: 'auto', method: 'automatic', title: 'Summer', value: 10 });
  const code = D({ id: 'c', code: 'BIG', value: 20 });
  let r = applyDiscounts({ lines: [L('a', 100, 1)], codes: ['BIG'] }, [auto, code], NOW);
  assert.equal(r.discountTotal, 20); assert.deepEqual(r.appliedCodes, ['BIG']); assert.equal(r.applied.length, 1);
  r = applyDiscounts({ lines: [L('a', 100, 1)], codes: [] }, [auto, code], NOW);
  assert.equal(r.discountTotal, 10, 'automatic applies alone');
  const ca = { ...auto, combinable: true }, cc = { ...code, combinable: true };
  r = applyDiscounts({ lines: [L('a', 100, 1)], codes: ['BIG'] }, [ca, cc], NOW);
  assert.equal(r.discountTotal, 28, '20% then 10% of the remaining 80');
  r = applyDiscounts({ lines: [L('a', 100, 1)], codes: ['BIG', 'FIVE'] }, [cc, D({ id: 'f', code: 'FIVE', type: 'fixed', value: 5 })], NOW);
  assert.equal(r.discountTotal, 20); assert.match(r.messages.find(m => m.code === 'FIVE').text, /cannot be combined/);
});

test('free shipping removes shipping and stacks with an item discount', () => {
  const ds = [D({ id: 'fs', code: 'SHIPFREE', type: 'free_shipping', minimum: { kind: 'amount', value: 30 } }), D({ id: 'p', code: 'P10', value: 10 })];
  let r = applyDiscounts({ lines: [L('a', 40, 1)], codes: ['SHIPFREE', 'P10'], shipping: 7.5 }, ds, NOW);
  assert.equal(r.shipping, 0); assert.equal(r.shippingDiscount, 7.5); assert.equal(r.discountTotal, 4); assert.equal(r.total, 36);
  assert.deepEqual(r.appliedCodes.sort(), ['P10', 'SHIPFREE']);
  r = applyDiscounts({ lines: [L('a', 20, 1)], codes: ['SHIPFREE'], shipping: 7.5 }, ds, NOW);
  assert.equal(r.shipping, 7.5); assert.equal(r.messages.length, 1);
});

test('buy X get Y: cheapest eligible units are discounted, repeats and max uses', () => {
  const b = D({ id: 'b', method: 'automatic', type: 'bxgy', title: 'B2G1', bxgy: { buyQuantity: 2, getQuantity: 1, getPercent: 100 } });
  let r = applyDiscounts({ lines: [L('a', 30, 2), L('b', 10, 1)] }, [b], NOW);
  assert.equal(r.discountTotal, 10, 'the 10.00 item is free');
  assert.equal(r.lines[1].total, 0);
  r = applyDiscounts({ lines: [L('a', 30, 6)] }, [b], NOW);
  assert.equal(r.discountTotal, 60, 'two applications in 6 units');
  r = applyDiscounts({ lines: [L('a', 30, 6)] }, [{ ...b, bxgy: { ...b.bxgy, maxUses: 1 } }], NOW);
  assert.equal(r.discountTotal, 30);
  r = applyDiscounts({ lines: [L('a', 30, 2)] }, [b], NOW);
  assert.equal(r.discountTotal, 0, 'needs 3 units');
  // buy from product a, get product g at 50%
  const b2 = D({ id: 'b2', code: 'GIFT', type: 'bxgy', appliesTo: { kind: 'products', productIds: ['a'] }, bxgy: { buyQuantity: 1, getQuantity: 1, getProductIds: ['g'], getPercent: 50 } });
  r = applyDiscounts({ lines: [L('a', 30, 1), L('g', 9.99, 2)], codes: ['GIFT'] }, [b2], NOW);
  assert.equal(r.discountTotal, 5, 'round(999 * 0.5) cents'); assert.equal(r.lines[1].discount, 5);
  r = applyDiscounts({ lines: [L('g', 9.99, 2)], codes: ['GIFT'] }, [b2], NOW);
  assert.equal(r.discountTotal, 0); assert.match(r.messages[0].text, /does not apply/);
});

test('collection-scoped discounts and edge cases (empty cart, zero/negative values)', () => {
  const d = D({ id: 'c', code: 'COL', value: 50, appliesTo: { kind: 'collections', collectionIds: ['summer'] } });
  let r = applyDiscounts({ lines: [L('a', 10, 1, { collectionIds: ['summer'] }), L('b', 10, 1, { collectionIds: [] })], codes: ['COL'] }, [d], NOW);
  assert.equal(r.discountTotal, 5); assert.equal(r.lines[1].discount, 0);
  r = applyDiscounts({ lines: [], codes: ['COL'] }, [d], NOW);
  assert.equal(r.total, 0); assert.equal(r.discountTotal, 0);
  r = applyDiscounts({ lines: [L('a', -5, -2)], shipping: -3 }, [], NOW);
  assert.equal(r.subtotal, 0); assert.equal(r.shipping, 0);
  r = applyDiscounts({ lines: [L('a', 10, 1)], codes: ['X'] }, undefined);
  assert.equal(r.total, 10);
  r = applyDiscounts({ lines: [L('a', 10, 1)] }, [D({ id: 'h', method: 'automatic', value: 100 })], NOW);
  assert.equal(r.total, 0, '100% never goes negative');
  assert.deepEqual(JSON.parse(JSON.stringify(r)), r, 'result is serialisable');
  assert.equal(describeDiscount(D({ type: 'bxgy', bxgy: { buyQuantity: 2, getQuantity: 1 } })), 'Buy 2, get 1 free');
});

// ---------- orders, shipping, tax, inventory ----------
function fixture() {
  const store = normalizeStore({ name: 'Test shop', products: [
    { id: 'tee', title: 'Tee', price: 20, options: [{ name: 'Size', values: ['S', 'M'] }], variants: [{ options: ['S'], stock: 5, sku: 'TEE-S' }, { options: ['M'], stock: 1, sku: 'TEE-M', price: 22 }] },
    { id: 'mug', title: 'Mug', price: 12.5, variants: [{ options: [], stock: null }] },
  ], collections: [{ id: 'col', title: 'Apparel', rule: { type: 'manual', productIds: ['tee'] } }] });
  let commerce = normalizeCommerce({
    settings: {
      shipping: { zones: [{ name: 'US', countries: ['US'], rates: [{ id: 'std', name: 'Standard', type: 'free_over', price: 6, threshold: 100 }, { id: 'exp', name: 'Express', type: 'flat', price: 15 }] },
        { name: 'World', countries: ['*'], rates: [{ id: 'w', name: 'Intl', type: 'weight', tiers: [{ upTo: 500, price: 10 }, { upTo: 2000, price: 25 }] }] }] },
      taxes: { inclusive: false, shippingTaxed: false, rates: [{ country: 'US', rate: 5 }, { country: 'US', region: 'CA', rate: 8.25 }, { country: 'DE', rate: 19 }] },
    },
    discounts: [{ id: 'd10', code: 'TEN', type: 'percentage', value: 10 }],
    productMeta: { tee: { weight: 300 }, mug: { weight: 450 } },
  });
  const tee = store.products[0], S = tee.variants[0], Mv = tee.variants[1], mug = store.products[1];
  return { store, commerce, tee, S, Mv, mug };
}

test('shipping rates by zone, free-over threshold and weight tiers; tax lookup and maths', () => {
  const { commerce } = fixture();
  assert.deepEqual(shippingRatesFor(commerce, 'US', 50).map(r => [r.id, r.price]), [['std', 6], ['exp', 15]]);
  assert.equal(shippingRatesFor(commerce, 'US', 100)[0].price, 0);
  assert.deepEqual(shippingRatesFor(commerce, 'FR', 10, 400).map(r => r.price), [10]);
  assert.deepEqual(shippingRatesFor(commerce, 'FR', 10, 1500).map(r => r.price), [25]);
  assert.deepEqual(shippingRatesFor(commerce, 'FR', 10, 2500), [], 'too heavy');
  assert.equal(taxRateFor(commerce, 'US', 'ca').rate, 8.25); assert.equal(taxRateFor(commerce, 'US', 'NY').rate, 5); assert.equal(taxRateFor(commerce, 'JP').rate, 0);
  assert.equal(computeTax(100, 19, true), 15.97); assert.equal(computeTax(100, 19, false), 19); assert.equal(computeTax(0, 19, false), 0);
});

test('order totals: discount → shipping → tax (exclusive and inclusive)', () => {
  const { store, commerce, tee, S, Mv } = fixture();
  const lines = [lineFor(store, tee.id, S.id, 2), lineFor(store, tee.id, Mv.id, 1)];
  assert.equal(lines[1].price, 22); assert.equal(lines[1].variantTitle, 'M');
  const t = computeOrderTotals(store, commerce, { lines, codes: ['ten'], shippingRateId: 'std', shippingAddress: { country: 'US', province: 'CA' } }, NOW);
  assert.equal(t.subtotal, 62); assert.equal(t.discountTotal, 6.2); assert.equal(t.shipping, 6);
  assert.equal(t.tax, 4.6, '8.25% of 55.80 = 4.6035');
  assert.equal(t.total, 66.4);
  const inc = normalizeCommerce({ ...commerce, settings: { ...commerce.settings, taxes: { ...commerce.settings.taxes, inclusive: true, shippingTaxed: true } } });
  const t2 = computeOrderTotals(store, inc, { lines, codes: ['TEN'], shippingRateId: 'std', shippingAddress: { country: 'DE' } }, NOW);
  assert.equal(t2.shipping, 0, 'DE falls in the world zone: std id not available there');
  assert.equal(t2.total, 55.8); assert.equal(t2.tax, 8.91, 'tax inside 55.80 at 19%');
});

test('order lifecycle: paid decrements stock once, cancel restocks, refund with restock', () => {
  const f = fixture();
  let { store, commerce } = f;
  const lines = [lineFor(store, f.tee.id, f.S.id, 2), lineFor(store, f.mug.id, f.mug.variants[0].id, 1)];
  let r = createOrder(store, commerce, { lines, email: 'ana@example.com', shippingAddress: { country: 'US' }, shippingRateId: 'exp', codes: ['TEN'] }, NOW);
  ({ store, commerce } = r);
  assert.equal(r.order.name, '#1001'); assert.equal(r.order.financialStatus, 'pending');
  assert.equal(store.products[0].variants[0].stock, 5, 'pending orders do not take stock');
  assert.equal(commerce.discounts[0].usageCount, 1);
  assert.equal(commerce.analytics.events.at(-1).type, 'order_placed');
  r = markPaid(store, commerce, r.order.id, NOW); ({ store, commerce } = r);
  assert.equal(store.products[0].variants[0].stock, 3); assert.equal(store.products[1].variants[0].stock, null, 'untracked stays untracked');
  assert.equal(commerce.inventoryLog.at(-1).reason, 'order'); assert.equal(commerce.inventoryLog.at(-1).delta, -2);
  r = markPaid(store, commerce, r.order.id, NOW); ({ store, commerce } = r);
  assert.equal(store.products[0].variants[0].stock, 3, 'not decremented twice');
  r = fulfillOrder(store, commerce, r.order.id, { carrier: 'UPS', trackingNumber: '1Z999' }, NOW); ({ store, commerce } = r);
  assert.equal(r.order.fulfillmentStatus, 'fulfilled'); assert.equal(r.order.fulfillments[0].trackingNumber, '1Z999');
  r = refundOrder(store, commerce, r.order.id, { amount: 5, reason: 'Late' }, NOW); ({ store, commerce } = r);
  assert.equal(r.order.financialStatus, 'partially_refunded'); assert.equal(store.products[0].variants[0].stock, 3);
  r = refundOrder(store, commerce, r.order.id, { restock: true }, NOW); ({ store, commerce } = r);
  assert.equal(r.order.financialStatus, 'refunded'); assert.equal(store.products[0].variants[0].stock, 5, 'restocked');
  assert.equal(customerStats(commerce, null).count, 0);

  // cancel a paid order → refund + restock
  r = createOrder(store, commerce, { lines: [lineFor(store, f.tee.id, f.Mv.id, 1)], paid: true, shippingAddress: { country: 'US' } }, NOW); ({ store, commerce } = r);
  assert.equal(r.order.name, '#1002'); assert.equal(store.products[0].variants[1].stock, 0);
  r = cancelOrder(store, commerce, r.order.id, { restock: true, reason: 'Customer changed mind' }, NOW); ({ store, commerce } = r);
  assert.equal(r.order.status, 'cancelled'); assert.equal(r.order.financialStatus, 'refunded'); assert.equal(store.products[0].variants[1].stock, 1);
  assert.throws(() => markPaid(store, commerce, r.order.id, NOW), /cancelled/);
  assert.equal(filterOrders(commerce.orders, 'open').length, 1);
  commerce = setArchived(commerce, commerce.orders[0].id, true, NOW);
  assert.equal(filterOrders(commerce.orders, 'archived').length, 1);
});

test('drafts get D-numbers, no usage/stock until completed', () => {
  const f = fixture();
  let r = createOrder(f.store, f.commerce, { lines: [lineFor(f.store, f.tee.id, f.S.id, 1)], codes: ['TEN'], draft: true }, NOW);
  assert.equal(r.order.name, 'D1'); assert.equal(r.commerce.discounts[0].usageCount, 0);
  r = completeDraft(r.store, r.commerce, r.order.id, { paid: true }, NOW);
  assert.equal(r.order.name, '#1001'); assert.equal(r.order.draft, false); assert.equal(r.commerce.orders.length, 1);
  assert.equal(r.store.products[0].variants[0].stock, 4); assert.equal(r.commerce.discounts[0].usageCount, 1);
  assert.equal(r.order.totals.discountTotal, 2);
});

test('adjustStock: delta, set, untracked, floor at zero, sellable', () => {
  const f = fixture();
  let r = adjustStock(f.store, f.commerce, [{ productId: 'tee', variantId: f.S.id, delta: -10 }, { productId: 'mug', variantId: f.mug.variants[0].id, delta: 3 }], { now: NOW });
  assert.equal(r.store.products[0].variants[0].stock, 0); assert.equal(r.changed.length, 1, 'untracked skipped for delta');
  r = adjustStock(r.store, r.commerce, [{ productId: 'mug', variantId: f.mug.variants[0].id, set: 7 }], { now: NOW });
  assert.equal(r.store.products[1].variants[0].stock, 7); assert.equal(r.commerce.inventoryLog.at(-1).reason, 'set');
  assert.equal(stockRows(r.store, r.commerce).filter(x => x.out).length, 1);
  assert.equal(sellable(r.store, r.commerce, 'tee', f.S.id), 0);
  const c2 = normalizeCommerce({ ...r.commerce, productMeta: { tee: { variants: { [f.S.id]: { continueSelling: true } } } } });
  assert.equal(sellable(r.store, c2, 'tee', f.S.id), Infinity);
  assert.equal(f.store.products[0].variants[0].stock, 5, 'input not mutated');
});

test('emails, invoices and backend order import', () => {
  const f = fixture();
  let r = createOrder(f.store, f.commerce, { lines: [lineFor(f.store, f.tee.id, f.S.id, 1)], email: 'bo@example.com', shippingAddress: { name: 'Bo <b>', country: 'US' } }, NOW);
  const m = orderEmail(r.store, r.commerce, r.order, 'order_confirmation');
  assert.equal(m.subject, 'Order #1001 confirmed'); assert.match(m.body, /1 × Tee \(S\)/); assert.match(m.mailto, /^mailto:bo%40example\.com\?subject=/);
  const html = orderDocumentHtml(r.store, r.commerce, r.order, 'invoice');
  assert.match(html, /Invoice/); assert.match(html, /Bo &lt;b&gt;/); assert.doesNotMatch(orderDocumentHtml(r.store, r.commerce, r.order, 'packing'), /\$20\.00/);
  const imp = importOrderPayloads(r.store, r.commerce, [{ customer: { name: 'Cy Dee', email: 'cy@example.com' }, lines: [{ productId: 'tee', variantId: f.S.id, quantity: 2 }, { title: 'Gift wrap', price: 3, quantity: 1 }] }, { lines: [] }], NOW);
  assert.equal(imp.imported, 1); assert.equal(imp.errors.length, 1);
  const o = imp.commerce.orders.at(-1);
  assert.equal(o.source, 'import'); assert.equal(o.totals.subtotal, 43); assert.equal(imp.commerce.customers.find(c => c.email === 'cy@example.com').firstName, 'Cy');
});

// ---------- customers ----------
test('customers CSV round trip and merge by email', () => {
  const list = normalizeCommerce({ customers: [
    { firstName: 'Ana', lastName: 'Lima', email: 'ANA@example.com', phone: '+1 555', tags: ['vip', 'wholesale'], note: 'Likes "blue", ships, fast', acceptsMarketing: true, address: { address1: '1 Main St', city: 'Austin', country: 'US', zip: '78701' } },
    { firstName: 'Bo', email: 'bo@example.com' },
  ] }).customers;
  const csv = customersToCsv(list);
  assert.match(csv, /"Likes ""blue"", ships, fast"/);
  const back = importCustomersCsv([], csv, NOW);
  assert.equal(back.added, 2); assert.deepEqual(back.errors, []);
  for (const k of ['firstName', 'lastName', 'email', 'phone', 'tags', 'note', 'acceptsMarketing']) assert.deepEqual(back.customers[0][k], list[0][k], k);
  assert.equal(back.customers[0].address.city, 'Austin'); assert.equal(back.customers[0].address.country, 'US');
  const merged = importCustomersCsv(list, 'email,first_name,accepts_marketing\nbo@example.com,Bob,yes\nnew@example.com,Neo,\nbad-email,,\n', NOW);
  assert.equal(merged.updated, 1); assert.equal(merged.added, 2); assert.equal(merged.errors.length, 1);
  assert.equal(merged.customers.find(c => c.email === 'bo@example.com').firstName, 'Bob');
  assert.equal(merged.customers.find(c => c.email === 'ana@example.com').firstName, 'Ana', 'untouched');
  assert.equal(importCustomersCsv([], 'foo,bar\n1,2').errors.length, 1);
});

// ---------- analytics ----------
test('analytics aggregation: days, sales net of refunds, sessions, funnel, top products, previous period', () => {
  const f = fixture();
  let { store, commerce } = f;
  const at = d => Date.parse(d);
  let r = createOrder(store, commerce, { lines: [lineFor(store, 'tee', f.S.id, 2)], paid: true, sessionId: 's1' }, at('2026-06-10T10:00:00Z')); ({ store, commerce } = r);
  r = createOrder(store, commerce, { lines: [lineFor(store, 'mug', f.mug.variants[0].id, 1)], paid: true }, at('2026-06-12T10:00:00Z')); ({ store, commerce } = r);
  r = refundOrder(store, commerce, r.order.id, { amount: 2.5 }, at('2026-06-12T11:00:00Z')); ({ store, commerce } = r);
  r = createOrder(store, commerce, { lines: [lineFor(store, 'mug', f.mug.variants[0].id, 1)] }, at('2026-06-05T10:00:00Z')); ({ store, commerce } = r); // previous period
  r = createOrder(store, commerce, { lines: [lineFor(store, 'tee', f.S.id, 1)] }, at('2026-06-11T10:00:00Z')); ({ store, commerce } = r);
  r = cancelOrder(store, commerce, r.order.id, {}, at('2026-06-11T11:00:00Z')); ({ store, commerce } = r);
  commerce = addEvents(commerce, [
    { type: 'visit', sessionId: 's1', at: '2026-06-10T09:00:00Z' }, { type: 'add_to_cart', sessionId: 's1', at: '2026-06-10T09:05:00Z' }, { type: 'checkout_started', sessionId: 's1', at: '2026-06-10T09:06:00Z' },
    { type: 'visit', sessionId: 's2', at: '2026-06-10T13:00:00Z' }, { type: 'add_to_cart', sessionId: 's2', at: '2026-06-10T13:01:00Z' },
    { type: 'visit', sessionId: 's3', at: '2026-06-13T13:00:00Z' }, { type: 'visit', sessionId: 's4', at: '2026-05-01T13:00:00Z' },
  ]);
  const a = aggregateAnalytics(commerce, { from: '2026-06-09', to: '2026-06-15' });
  assert.equal(a.days.length, 7);
  assert.equal(a.totals.orders, 2, 'cancelled and out-of-range excluded');
  assert.equal(a.totals.sales, 40 + 12.5 - 2.5);
  assert.equal(a.totals.aov, 25);
  assert.equal(a.totals.sessions, 3); assert.equal(a.totals.visits, 3);
  assert.deepEqual(a.funnel.map(x => x.count), [3, 2, 1, 1]);
  assert.equal(Math.round(a.totals.conversion * 1000), 333);
  assert.equal(a.days.find(d => d.date === '2026-06-10').sales, 40);
  assert.equal(a.days.find(d => d.date === '2026-06-10').sessions, 2);
  assert.equal(a.topProducts[0].productId, 'tee'); assert.equal(a.topProducts[0].quantity, 2);
  assert.equal(a.previous.orders, 1); assert.equal(a.previous.sales, 12.5);
  assert.equal(a.sources.manual, 2);
  // timezone shifts the day bucket
  const tz = aggregateAnalytics(commerce, { from: '2026-06-09', to: '2026-06-15', tz: 840 });
  assert.equal(tz.days.find(d => d.date === '2026-06-11').sessions, 2); assert.equal(tz.days.find(d => d.date === '2026-06-11').addToCart, 1, '13:01Z + 14h is the next day');
  assert.deepEqual(dayRange('2026-02-27', '2026-03-01'), ['2026-02-27', '2026-02-28', '2026-03-01']);
  assert.deepEqual(presetRange('7d', NOW), { from: '2026-06-09', to: '2026-06-15' });
});

test('preview tracker is injected and its messages are validated', () => {
  const html = trackedPreviewHtml('<html><body><iframe id="f"></iframe></body></html>', 'store_1');
  assert.match(html, /zstore-cart:"\s*\+\s*"store_1"|zstore-cart:'\+"store_1"/);
  assert.ok(html.indexOf('<script>') < html.indexOf('</body>'));
  const f = fixture();
  assert.equal(parseTrackerMessage({ foo: 1 }, f.store), null);
  assert.equal(parseTrackerMessage({ zcEvent: { type: 'visit' } }, f.store), null, 'needs a session id');
  assert.equal(parseTrackerMessage({ zcEvent: { type: 'view_product', sessionId: 's', productSlug: 'tee' } }, f.store).events[0].productId, 'tee');
  const o = parseTrackerMessage({ zcEvent: { type: 'order_placed', sessionId: 's', lines: [{ pid: 'tee', vid: f.S.id, qty: 2 }, { bad: true }], customer: { name: 'Ana', email: 'a@x.co' } } }, f.store);
  assert.equal(o.order.lines.length, 1); assert.equal(o.order.lines[0].quantity, 2); assert.equal(o.order.customer.email, 'a@x.co');
});

test('preview tracker forwards discount codes and the chosen shipping address to the order', () => {
  const html = trackedPreviewHtml('<html><body><iframe id="f"></iframe></body></html>', 'store_1');
  assert.match(html, /zstore-codes:/); assert.match(html, /zstore-ship:/);
  const f = fixture();
  const o = parseTrackerMessage({ zcEvent: { type: 'order_placed', sessionId: 's', lines: [{ pid: 'tee', vid: f.S.id, qty: 1 }], codes: [' ten ', 7, ''], country: 'us', region: 'CA', rateId: 'std', customer: { name: 'Ana' } } }, f.store);
  assert.deepEqual(o.order.codes, ['TEN']); assert.equal(o.order.country, 'US'); assert.equal(o.order.region, 'CA'); assert.equal(o.order.rateId, 'std');
});
