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

// ---------- setup guide (automatic) ----------
import { setupProgress, realPhone, realEmail, checkoutConfigured, sellableProducts } from '../src/store/admin/setup.js';

test('setup guide: a fresh template store has nothing done; placeholders do not count', () => {
  const s = normalizeStore(createStore('everyday')), c = createCommerce(s);
  const p = setupProgress(s, c);
  assert.deepEqual(p.steps, { product: false, theme: false, shipping: false, payments: false, domain: false, launch: false });
  assert.equal(p.done, 0); assert.equal(p.total, 6); assert.equal(p.complete, false); assert.equal(p.next, 'product');
  assert.ok(sellableProducts(s).length > 0, 'samples are sellable but are not the merchant’s own work');
  assert.equal(realPhone('+1 555 0100'), false); assert.equal(realPhone('15550100'), false); assert.equal(realPhone('+1 415 555 1234'), false);
  assert.equal(realPhone('+44 20 7946 0000'), true); assert.equal(realPhone('123'), false);
  assert.equal(realEmail('hello@everydaygoods.example'), false); assert.equal(realEmail('me@example.com'), false); assert.equal(realEmail('orders@shop.co'), true);
});

test('setup guide: each step completes from real data', () => {
  const s = normalizeStore(createStore('everyday')), c0 = createCommerce(s);
  // product: a saved product (flag written by the editor) or an uploaded image
  const own = structuredClone(s); own.products[0].images = ['asset:abc'];
  assert.equal(setupProgress(own, c0).steps.product, true);
  const flagged = normalizeCommerce({ ...c0, onboarding: { steps: { product: true } } });
  assert.equal(setupProgress(s, flagged).steps.product, true);
  const noImg = structuredClone(s); noImg.products.forEach(p => { p.images = []; });
  assert.equal(setupProgress(noImg, flagged).steps.product, false, 'needs a product with an image');
  const drafts = structuredClone(own); drafts.products.forEach(p => { p.status = 'draft'; });
  assert.equal(setupProgress(drafts, c0).steps.product, false, 'drafts do not count');
  const free = structuredClone(own); free.products.forEach(p => { p.price = 0; p.variants.forEach(v => { v.price = null; }); });
  assert.equal(setupProgress(free, c0).steps.product, false, 'needs a price');
  // shipping: edited zones, or saved defaults; no rates → not done
  const c1 = structuredClone(c0); c1.settings.shipping.zones[0].rates[0].price = 7;
  assert.equal(setupProgress(s, c1).steps.shipping, true);
  const c2 = normalizeCommerce({ ...c0, onboarding: { steps: { shipping: true } } });
  assert.equal(setupProgress(s, c2).steps.shipping, true);
  const c3 = structuredClone(c2); c3.settings.shipping.zones.forEach(z => { z.rates = []; });
  assert.equal(setupProgress(s, c3).steps.shipping, false);
  // payments: real WhatsApp number / email / payment link
  const w = structuredClone(s); w.checkout.phone = '+351 912 345 678';
  assert.equal(checkoutConfigured(w), true);
  const e = structuredClone(s); e.checkout.mode = 'email'; e.checkout.email = 'orders@ironclad.shop';
  assert.equal(setupProgress(e, c0).steps.payments, true);
  const l = structuredClone(s); l.checkout.mode = 'paymentLinks';
  assert.equal(checkoutConfigured(l), false);
  l.checkout.paymentLinks[l.products[0].id] = 'https://buy.stripe.com/abc';
  assert.equal(checkoutConfigured(l), true);
  const n = structuredClone(w); n.checkout.mode = 'none';
  assert.equal(checkoutConfigured(n), false, 'catalog only is not a checkout');
  const oldManual = normalizeCommerce({ ...c0, onboarding: { steps: { payments: true, domain: true } } });
  assert.equal(setupProgress(s, oldManual).steps.payments, false, 'old hand-ticked flags are ignored');
  assert.equal(setupProgress(s, oldManual).steps.domain, false);
  // domain, theme, launch
  const d = structuredClone(c0); d.settings.domains.primary = 'ironclad.shop';
  assert.equal(setupProgress(s, d).steps.domain, true);
  const all = normalizeCommerce({ ...d, onboarding: { steps: { product: true, theme: true, shipping: true, launch: true } } });
  const p = setupProgress(w, all);
  assert.equal(p.done, 6); assert.equal(p.complete, true); assert.equal(p.next, null);
});

// ---------- visitor locations (geo.js, analytics visitorsByLocation, globe land mask) ----------
import { visitorsByLocation, unlocatedSessions, storeLocation } from '../src/store/admin/analytics.js';
import { geoFromBrowser, normalizeGeo, countryGeo, flagEmoji, countryFromAddress, TZ_GEO, COUNTRY_GEO } from '../src/store/admin/geo.js';
import { isLand, landDots, landMask } from '../src/store/admin/globe.js';

test('geo: time zone and language map to an approximate, validated location', () => {
  assert.deepEqual(geoFromBrowser('Europe/Lisbon', 'pt-PT'), { country: 'PT', city: 'Lisbon', lat: 38.7, lon: -9.1 });
  assert.equal(geoFromBrowser('America/Los_Angeles', 'en-GB').country, 'US', 'the time zone wins over the language');
  assert.equal(geoFromBrowser('Etc/UTC', 'de-AT').country, 'AT', 'language region as fallback');
  assert.equal(geoFromBrowser('', 'ja').country, 'JP', 'bare language → main country');
  assert.equal(geoFromBrowser('Mars/Olympus', 'xx'), null);
  assert.equal(geoFromBrowser({ toString: () => 'Europe/Lisbon' }, 42), null, 'non-strings are ignored');
  assert.ok(Object.keys(TZ_GEO).length >= 150);
  for (const [tz, [c, , lat, lon]] of Object.entries(TZ_GEO)) { assert.ok(COUNTRY_GEO[c], tz + ' → known country'); assert.ok(Math.abs(lat) <= 90 && Math.abs(lon) <= 180, tz); }
  assert.equal(normalizeGeo({ country: 'ZZ', lat: 1, lon: 1 }), null, 'unknown country rejected');
  assert.deepEqual(normalizeGeo({ country: 'fr', lat: 999, lon: -999, city: '<b>Paris</b>\u0000' }), { country: 'FR', lat: 90, lon: -180, city: 'bParis/b' });
  assert.deepEqual(normalizeGeo({ country: 'DE', lat: 'x' }), { country: 'DE', lat: 51.2, lon: 10.5 }, 'bad coordinates → country centre');
  assert.equal(normalizeGeo('PT'), null);
  assert.equal(flagEmoji('pt'), '\u{1F1F5}\u{1F1F9}'); assert.equal(flagEmoji('P'), '');
  assert.equal(countryFromAddress('Rua Augusta 1\n1100-048 Lisbon\nPortugal'), 'PT');
  assert.equal(countryFromAddress('1 Main St, Austin, TX, USA'), 'US');
  assert.equal(countryFromAddress('somewhere'), '');
  assert.equal(countryGeo('br').country, 'BR');
});

test('tracker visit carries the browser time zone; parseTrackerMessage stores a validated geo', () => {
  const html = trackedPreviewHtml('<html><body><iframe id="f"></iframe></body></html>', 'store_1');
  assert.match(html, /resolvedOptions\(\)\.timeZone/); assert.match(html, /navigator\.language/);
  const f = fixture();
  const v = parseTrackerMessage({ zcEvent: { type: 'visit', sessionId: 's', tz: 'Asia/Tokyo', lang: 'ja-JP', geo: { country: 'US', lat: 0, lon: 0 } } }, f.store);
  assert.deepEqual(v.events[0].geo, { country: 'JP', city: 'Tokyo', lat: 35.7, lon: 139.7 }, 'derived from tz, a posted geo is ignored');
  assert.equal('geo' in parseTrackerMessage({ zcEvent: { type: 'visit', sessionId: 's', tz: 123 } }, f.store).events[0], false);
  const c = addEvents(f.commerce, v.events);
  assert.equal(c.analytics.events.at(-1).geo.country, 'JP', 'geo survives normalizeEvent');
  assert.equal(normalizeCommerce(c).analytics.events.at(-1).geo.city, 'Tokyo', 'and normalizeCommerce');
  assert.equal(addEvents(f.commerce, [{ type: 'visit', sessionId: 'x', geo: { country: 'QQ' } }]).analytics.events.at(-1).geo, undefined);
});

test('visitorsByLocation: sessions by session geo, orders by shipping country, sales net of refunds, range', () => {
  const f = fixture();
  let { store, commerce } = f;
  const at = d => Date.parse(d);
  const g = tz => geoFromBrowser(tz, '');
  commerce = addEvents(commerce, [
    { type: 'visit', sessionId: 'a', at: '2026-06-10T09:00:00Z', geo: g('Europe/Lisbon') }, { type: 'page_view', sessionId: 'a', at: '2026-06-10T09:01:00Z' },
    { type: 'visit', sessionId: 'b', at: '2026-06-11T09:00:00Z', geo: g('Europe/Lisbon') },
    { type: 'visit', sessionId: 'c', at: '2026-06-12T09:00:00Z', geo: g('America/New_York') },
    { type: 'visit', sessionId: 'd', at: '2026-06-12T10:00:00Z' }, // no location
    { type: 'visit', sessionId: 'e', at: '2026-05-01T10:00:00Z', geo: g('Asia/Tokyo') }, // out of range
  ]);
  let r = createOrder(store, commerce, { lines: [lineFor(store, 'tee', f.S.id, 1)], sessionId: 'c', source: 'preview' }, at('2026-06-12T09:30:00Z')); ({ store, commerce } = r);
  r = createOrder(store, commerce, { lines: [lineFor(store, 'mug', f.mug.variants[0].id, 2)], paid: true, shippingAddress: { name: 'B', country: 'DE' } }, at('2026-06-13T09:30:00Z')); ({ store, commerce } = r);
  r = refundOrder(store, commerce, r.order.id, { amount: 5 }, at('2026-06-13T10:00:00Z')); ({ store, commerce } = r);
  r = createOrder(store, commerce, { lines: [lineFor(store, 'mug', f.mug.variants[0].id, 1)] }, at('2026-06-13T11:00:00Z')); ({ store, commerce } = r); // no location at all
  const range = { from: '2026-06-09', to: '2026-06-15' };
  const locs = visitorsByLocation(commerce, range);
  assert.deepEqual(locs.map(l => [l.country, l.sessions, l.orders]), [['PT', 2, 0], ['US', 1, 1], ['DE', 0, 1]]);
  assert.equal(locs[0].name, 'Portugal'); assert.equal(locs[0].city, 'Lisbon'); assert.equal(locs[0].lat, 38.7);
  const us = locs[1]; assert.equal(us.city, 'New York', 'order placed in a located session uses its city point');
  assert.equal(us.sales, commerce.orders.find(o => o.source === 'preview').totals.total);
  const de = locs[2]; assert.equal(de.lat, COUNTRY_GEO.DE[1], 'shipping country → country centre');
  assert.equal(de.sales, Math.round((commerce.orders.find(o => o.shippingAddress.country === 'DE').totals.total - 5) * 100) / 100);
  assert.equal(unlocatedSessions(commerce, range), 1);
  assert.deepEqual(visitorsByLocation(commerce, { from: '2026-04-01', to: '2026-05-30' }).map(l => l.country), ['JP']);
  assert.deepEqual(visitorsByLocation({ orders: [], analytics: { events: [] } }, range), []);
  // the store's own location: settings address country, else the busiest visitor location
  assert.equal(storeLocation(commerce, store, locs).country, 'PT');
  assert.equal(storeLocation(commerce, store, locs).fromVisitors, true);
  const c2 = structuredClone(commerce); c2.settings.general.address = '1 Main St\nAustin, TX\nUnited States';
  assert.deepEqual(storeLocation(c2, store, locs), { country: 'US', name: 'United States', lat: 39.8, lon: -98.6 });
  assert.equal(storeLocation(f.commerce, store, []), null);
});

test('globe land mask: continents and oceans where they belong', () => {
  assert.equal(landMask().length, 720 * 360);
  for (const [lat, lon] of [[48.9, 2.35], [40, -100], [-15, -55], [0, 25], [60, 100], [-25, 135], [-80, 0], [72, -40]]) assert.equal(isLand(lat, lon), true, `${lat},${lon} is land`);
  for (const [lat, lon] of [[30, -40], [0, -140], [-30, 80], [35, 160], [-60, -60]]) assert.equal(isLand(lat, lon), false, `${lat},${lon} is sea`);
  const share = landMask().reduce((s, v) => s + v, 0) / landMask().length;
  assert.ok(share > 0.25 && share < 0.35, 'about 30% land in equirectangular cells');
  const dots = landDots(1.25); assert.equal(dots.length % 3, 0); assert.ok(dots.length / 3 > 4000 && dots.length / 3 < 20000);
});

// ---------- dashboard numbers ----------
import { dashRange, previousRange, weekdayActivity, customerSegments, repeatRate, grossProfit, dashboardCsv, change } from '../src/store/admin/dashboard.js';

test('dashboard: ranges, weekday activity, customer segments, repeat rate, profit and CSV', () => {
  assert.deepEqual(dashRange('7d', NOW), { from: '2026-06-09', to: '2026-06-15' });
  assert.deepEqual(dashRange('ytd', NOW), { from: '2026-01-01', to: '2026-06-15' });
  assert.deepEqual(previousRange({ from: '2026-06-09', to: '2026-06-15' }), { from: '2026-06-02', to: '2026-06-08' });
  assert.equal(change(15, 10), 0.5); assert.equal(change(3, 0), null);
  const days = [{ date: '2026-06-14', orders: 2, sessions: 5 }, { date: '2026-06-15', orders: 5, sessions: 9 }, { date: '2026-06-21', orders: 1, sessions: 1 }];
  const w = weekdayActivity(days); // 06-14 is a Sunday, 06-15 a Monday
  assert.equal(w.metric, 'orders'); assert.deepEqual(w.values, [3, 5, 0, 0, 0, 0, 0]); assert.equal(w.max, 1);
  assert.equal(weekdayActivity([{ date: '2026-06-16', orders: 0, sessions: 4 }]).metric, 'sessions');
  assert.equal(weekdayActivity([]).max, -1);
  const o = (id, at, customerId, extra = {}) => ({ id, number: +id.slice(1), createdAt: at, customerId, email: '', lines: [{ productId: 'p1', variantId: 'v1', title: 'Mug', price: 20, quantity: 2 }], totals: { subtotal: 40, total: 40 }, financialStatus: 'paid', ...extra });
  const c = normalizeCommerce({ orders: [
    o('o1', '2026-05-01T10:00:00Z', 'a'), o('o2', '2026-06-10T10:00:00Z', 'a'),                       // returning
    o('o3', '2026-06-11T10:00:00Z', 'b'),                                                                // new
    o('o4', '2026-04-01T10:00:00Z', 'v'), o('o5', '2026-05-01T10:00:00Z', 'v'), o('o6', '2026-06-12T10:00:00Z', 'v'), // VIP
    o('o7', '2026-06-13T10:00:00Z', null),                                                               // guest → new
    o('o8', '2026-06-13T10:00:00Z', 'x', { status: 'cancelled' }), o('o9', '2026-06-14T10:00:00Z', 'y', { draft: true }),
  ], productMeta: { p1: { cost: 5, variants: { v1: { cost: 8 } } } } });
  assert.deepEqual(customerSegments(c, { from: '2026-06-09', to: '2026-06-15' }), { new: 2, returning: 1, vip: 1, total: 4 });
  assert.deepEqual(repeatRate(c), { rate: 2 / 3, repeat: 2, customers: 3 });
  assert.deepEqual(grossProfit(c, { from: '2026-06-09', to: '2026-06-15' }), { profit: 4 * (20 - 8) * 2, costed: true }, 'variant cost wins over product cost');
  assert.equal(grossProfit(normalizeCommerce({ orders: c.orders }), { from: '2026-06-09', to: '2026-06-15' }).costed, false);
  const csv = dashboardCsv({ range: { from: '2026-06-09', to: '2026-06-15' }, prev: { from: '2026-06-02', to: '2026-06-08' }, metrics: [['Total sales', 150, 100], ['Orders, net', 3, 0]], days: [{ date: '2026-06-09', sales: 10, orders: 1, sessions: 2, addToCart: 1, checkouts: 1 }] });
  assert.match(csv, /^Period,2026-06-09 to 2026-06-15,Previous 2026-06-02 to 2026-06-08,/);
  assert.match(csv, /\nTotal sales,150,100,50\.0\n/); assert.match(csv, /\n"Orders, net",3,0,\n/);
  assert.match(csv, /\n2026-06-09,10,1,2,1,1\n$/);
});
