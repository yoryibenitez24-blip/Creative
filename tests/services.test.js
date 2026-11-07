// Unit tests for selling services (src/store/serviceProduct.js, src/store/admin/services.js) and sample data
// (src/store/admin/sampleData.js). Run: node --test tests/services.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProduct, normalizeStore } from '../src/store/model.js';
import { createStore } from '../src/store/templates.js';
import { normalizeCommerce, createCommerce } from '../src/store/admin/model.js';
import { normalizeService, normalizeDigital, normalizeProductKind, servicePriceLabel } from '../src/store/serviceProduct.js';
import { bookingSlots, utilisation, zonedTime, zonedDay, zoneOffset, normalizeBooking, normalizeProject, serviceKpis, newBooking, upcomingBookings } from '../src/store/admin/services.js';
import { generateSampleData, clearSampleData, hasSampleData, prng } from '../src/store/admin/sampleData.js';
import { aggregateAnalytics, visitorsByLocation } from '../src/store/admin/analytics.js';
import { createOrder, lineFor } from '../src/store/admin/orders.js';
import { parseLocation, formatRoute, routeTitle } from '../src/routes.js';

const NOW = Date.parse('2026-06-15T12:00:00Z'); // a Monday
const svc = (service, over = {}) => normalizeProduct({ id: 'svc', title: 'Consultation', price: 100, kind: 'service', service, ...over });

// ---------- product kinds ----------
test('physical products normalise exactly as before; service and digital fields get defaults and are idempotent', () => {
  const plain = normalizeProduct({ id: 'p1', title: 'Tee', price: 20, variants: [{ id: 'v1', options: [] }] });
  for (const k of ['kind', 'service', 'digital', 'sample']) assert.equal(k in plain, false, k + ' absent on physical products');
  assert.deepEqual(normalizeProductKind({ kind: 'physical' }), {});
  const s = svc({ pricing: { model: 'hourly' }, booking: { timezone: 'Mars/Base', bufferMinutes: 999, availability: [{ day: 9, start: '18:00', end: '09:00' }, { day: 2, start: '9:5', end: '12:00' }] } });
  assert.equal(s.kind, 'service');
  assert.equal(s.service.pricing.model, 'hourly'); assert.equal(s.service.durationMinutes, 60);
  assert.equal(s.service.booking.timezone, 'UTC', 'unknown zones fall back to UTC');
  assert.equal(s.service.booking.bufferMinutes, 240);
  assert.deepEqual(s.service.booking.availability, [{ day: 2, start: '09:00', end: '12:00' }], 'empty windows dropped, bad times repaired');
  assert.deepEqual(normalizeProduct(JSON.parse(JSON.stringify(s))), s, 'idempotent');
  const def = normalizeService(null);
  assert.equal(def.booking.enabled, true); assert.equal(def.booking.availability.length, 5);
  assert.equal(def.pricing.stripePriceId, '');
  const r = normalizeService({ pricing: { model: 'retainer', stripePriceId: ' price_123 ' }, intake: [{ label: 'Goal', type: 'nope' }, { label: '' }], addOns: [{ name: 'Rush', price: '-5' }] });
  assert.equal(r.pricing.stripePriceId, 'price_123');
  assert.deepEqual(r.intake.map(q => [q.label, q.type]), [['Goal', 'text']]);
  assert.equal(r.addOns[0].price, 0);
  assert.deepEqual(normalizeDigital({ file: 'asset:abc', downloadLimit: '' }), { file: 'asset:abc', fileName: '', downloadLimit: null });
  const d = normalizeProduct({ title: 'Guide', kind: 'digital', digital: { downloadLimit: 5 } });
  assert.equal(d.digital.downloadLimit, 5); assert.equal('service' in d, false);
  assert.equal(normalizeProduct({ title: 'x', sample: true }).sample, true);
  const fmt = v => '$' + v;
  assert.equal(servicePriceLabel(svc({ pricing: { model: 'package', sessions: 3 } }), fmt), '$100 · 3 sessions');
  assert.equal(servicePriceLabel(svc({ pricing: { model: 'retainer' } }), fmt), '$100 / month');
});

test('existing store templates are unchanged by the product kind block', () => {
  const s = normalizeStore(createStore('everyday'));
  assert.ok(s.products.length > 0);
  assert.ok(s.products.every(p => !('kind' in p) && !('service' in p)));
  assert.deepEqual(normalizeStore(JSON.parse(JSON.stringify(s))), s);
});

// ---------- commerce collections ----------
test('bookings, projects and sample flags are normalised by normalizeCommerce (idempotent)', () => {
  const c = normalizeCommerce({
    orders: [{ id: 'o1', number: 1001, sample: true }, { id: 'o2', number: 1002 }],
    customers: [{ id: 'c1', sample: true }], analytics: { events: [{ id: 'e1', type: 'visit', sessionId: 's', sample: true }] },
    bookings: [{ id: 'b2', start: '2026-06-16T10:00:00Z', status: 'weird' }, { id: 'b1', start: '2026-06-15T10:00:00Z', end: '2026-06-15T09:00:00Z', status: 'confirmed', sample: true }],
    serviceProjects: [{ id: 'p1', stage: 'nope', dueDate: '16/06/2026', deliverables: [{ label: 'A', done: 1 }, { label: '' }], messages: [{ from: 'x', text: 'hi' }, { text: ' ' }] }],
    sampleData: { seed: 4, prevNextOrderNumber: 1001 },
  });
  assert.equal(c.orders[0].sample, true); assert.equal('sample' in c.orders[1], false);
  assert.equal(c.customers[0].sample, true); assert.equal(c.analytics.events[0].sample, true);
  assert.deepEqual(c.bookings.map(b => b.id), ['b1', 'b2'], 'sorted by start');
  assert.equal(c.bookings[0].end, '2026-06-15T11:00:00.000Z', 'an end before the start becomes start + 60 min');
  assert.equal(c.bookings[1].status, 'requested');
  assert.equal(c.serviceProjects[0].stage, 'new'); assert.equal(c.serviceProjects[0].dueDate, '');
  assert.deepEqual(c.serviceProjects[0].deliverables.map(d => [d.label, d.done]), [['A', true]]);
  assert.deepEqual(c.serviceProjects[0].messages.map(m => m.from), ['merchant']);
  assert.equal(c.sampleData.seed, 4);
  assert.deepEqual(normalizeCommerce(JSON.parse(JSON.stringify(c))), c, 'idempotent');
  const empty = normalizeCommerce(null);
  assert.deepEqual([empty.bookings, empty.serviceProjects, empty.abandonedCheckouts, empty.sampleData], [[], [], [], null]);
  assert.equal(normalizeBooking({ location: { mode: 'moon' } }).location.mode, 'online');
  assert.equal(normalizeProject({ revisionsUsed: 500 }).revisionsUsed, 99);
});

// ---------- time zones & slots ----------
test('zoned wall-clock times convert to UTC across offsets and DST', () => {
  assert.equal(new Date(zonedTime('2026-06-15', '09:00', 'UTC')).toISOString(), '2026-06-15T09:00:00.000Z');
  assert.equal(new Date(zonedTime('2026-06-15', '09:00', 'America/New_York')).toISOString(), '2026-06-15T13:00:00.000Z', 'EDT = UTC-4');
  assert.equal(new Date(zonedTime('2026-01-15', '09:00', 'America/New_York')).toISOString(), '2026-01-15T14:00:00.000Z', 'EST = UTC-5');
  assert.equal(new Date(zonedTime('2026-06-15', '09:00', 'Asia/Tokyo')).toISOString(), '2026-06-15T00:00:00.000Z');
  assert.equal(zoneOffset(Date.parse('2026-07-01T00:00:00Z'), 'Europe/Berlin'), 120);
  assert.equal(zonedDay(Date.parse('2026-06-15T23:30:00Z'), 'Asia/Tokyo'), '2026-06-16');
});

test('booking slots follow availability, duration + buffer, existing bookings, max per day and now', () => {
  const p = svc({ durationMinutes: 60, booking: { timezone: 'UTC', bufferMinutes: 15, maxPerDay: 0, availability: [{ day: 1, start: '09:00', end: '12:00' }] } });
  const day = bookingSlots(p, { from: '2026-06-15', days: 1 });
  assert.deepEqual(day.map(s => s.start.slice(11, 16)), ['09:00', '10:15'], '09:00, 10:15 (11:30 would end after 12:00)');
  assert.deepEqual(bookingSlots(p, { from: '2026-06-16', days: 6 }), [], 'only Mondays');
  assert.equal(bookingSlots(p, { from: '2026-06-15', days: 8 }).length, 4, 'two Mondays');
  // an existing booking at 10:00–10:30 (another service) blocks both slots once widened by the 15-minute buffer
  const busy = [{ productId: 'other', status: 'confirmed', start: '2026-06-15T10:00:00Z', end: '2026-06-15T10:30:00Z' }];
  assert.deepEqual(bookingSlots(p, { from: '2026-06-15', days: 1, bookings: busy }).map(s => s.start.slice(11, 16)), []);
  const late = [{ productId: 'other', status: 'confirmed', start: '2026-06-15T11:20:00Z', end: '2026-06-15T11:50:00Z' }];
  assert.deepEqual(bookingSlots(p, { from: '2026-06-15', days: 1, bookings: late }).map(s => s.start.slice(11, 16)), ['09:00']);
  const cancelled = [{ ...busy[0], status: 'cancelled' }];
  assert.equal(bookingSlots(p, { from: '2026-06-15', days: 1, bookings: cancelled }).length, 2, 'cancelled bookings free their time');
  assert.deepEqual(bookingSlots(p, { from: '2026-06-15', days: 1, now: Date.parse('2026-06-15T09:30:00Z') }).map(s => s.start.slice(11, 16)), ['10:15'], 'past slots dropped');
  const capped = svc({ ...p.service, booking: { ...p.service.booking, maxPerDay: 1 } });
  const one = [{ productId: 'svc', status: 'confirmed', start: '2026-06-15T15:00:00Z', end: '2026-06-15T16:00:00Z' }];
  assert.deepEqual(bookingSlots(capped, { from: '2026-06-15', days: 1, bookings: one }), [], 'max per day reached');
  const ny = svc({ booking: { timezone: 'America/New_York', availability: [{ day: 1, start: '09:00', end: '10:00' }] } });
  assert.deepEqual(bookingSlots(ny, { from: '2026-06-15', days: 1 }).map(s => s.start), ['2026-06-15T13:00:00.000Z'], 'in the service time zone');
  assert.deepEqual(bookingSlots(svc({ booking: { enabled: false } }), { from: '2026-06-15', days: 7 }), []);
});

test('utilisation = booked / available minutes over the union of availability windows', () => {
  const a = svc({ booking: { timezone: 'UTC', availability: [{ day: 1, start: '09:00', end: '13:00' }] } });
  const b = svc({ booking: { timezone: 'UTC', availability: [{ day: 1, start: '12:00', end: '14:00' }, { day: 2, start: '09:00', end: '10:00' }] } }, { id: 'svc2' });
  const bookings = [
    { status: 'completed', timezone: 'UTC', start: '2026-06-15T09:00:00Z', end: '2026-06-15T10:00:00Z' },
    { status: 'no_show', timezone: 'UTC', start: '2026-06-15T10:00:00Z', end: '2026-06-15T10:30:00Z' },
    { status: 'cancelled', timezone: 'UTC', start: '2026-06-15T11:00:00Z', end: '2026-06-15T12:00:00Z' },
    { status: 'confirmed', timezone: 'UTC', start: '2026-06-22T09:00:00Z', end: '2026-06-22T10:00:00Z' }, // outside the range
  ];
  const u = utilisation({ services: [a, b], bookings, from: '2026-06-15', to: '2026-06-21' });
  assert.equal(u.availableMinutes, 5 * 60 + 60, 'Mon 09–14 (overlap counted once) + Tue 09–10');
  assert.equal(u.bookedMinutes, 90);
  assert.equal(u.rate, 90 / 360);
  assert.equal(utilisation({ services: [], bookings, from: '2026-06-15', to: '2026-06-21' }).rate, 0);
});

test('newBooking prices a session from the pricing model', () => {
  const hourly = svc({ pricing: { model: 'hourly' }, durationMinutes: 90 });
  const b = newBooking(hourly, { start: '2026-06-15T09:00:00Z', name: 'Ana', now: NOW });
  assert.equal(b.price, 150); assert.equal(b.end, '2026-06-15T10:30:00.000Z'); assert.equal(b.status, 'confirmed');
  assert.equal(newBooking(svc({ pricing: { model: 'package', sessions: 4 } }), { start: '2026-06-15T09:00:00Z' }).price, 25);
});

// ---------- sample data ----------
const base = () => { const s = normalizeStore(createStore('everyday')); return { s, c: createCommerce(s) }; };

test('generateSampleData is deterministic and fills every area', () => {
  const { s, c } = base();
  const a = generateSampleData(s, c, { seed: 42, now: NOW }), b = generateSampleData(s, c, { seed: 42, now: NOW });
  assert.deepEqual(a, b, 'same seed and now → same documents');
  assert.notDeepEqual(generateSampleData(s, c, { seed: 43, now: NOW }).commerce.orders.map(o => o.createdAt), a.commerce.orders.map(o => o.createdAt));
  const k = a.commerce;
  assert.equal(k.customers.length, 60);
  assert.ok(k.customers.every(x => x.email.endsWith('@example.com') && x.sample));
  assert.ok(new Set(k.customers.map(x => x.address.country)).size >= 15, '≥ 15 countries');
  assert.ok(k.orders.length >= 170 && k.orders.length <= 190, 'about 180 orders: ' + k.orders.length);
  const fin = new Set(k.orders.map(o => o.financialStatus));
  for (const f of ['paid', 'pending', 'refunded']) assert.ok(fin.has(f), f);
  assert.ok(k.orders.some(o => o.fulfillmentStatus === 'fulfilled') && k.orders.some(o => o.codes.length));
  assert.ok(new Set(k.orders.map(o => o.shippingAddress.country)).size >= 15);
  const from = new Date(NOW - 89 * 86400000).toISOString().slice(0, 10), to = new Date(NOW).toISOString().slice(0, 10);
  assert.ok(k.orders.every(o => o.createdAt >= from && Date.parse(o.createdAt) <= NOW), 'orders inside the 90 days');
  assert.equal(new Set(k.orders.map(o => o.number)).size, k.orders.length, 'unique order numbers');
  assert.ok(k.analytics.events.length > 1000 && k.analytics.events.every(e => e.sample));
  assert.ok(visitorsByLocation(k, { from, to }).length >= 10, '≥ 10 globe locations');
  const agg = aggregateAnalytics(k, { from: new Date(NOW - 29 * 86400000).toISOString().slice(0, 10), to });
  assert.ok(agg.totals.sales > 0 && agg.totals.orders > 0 && agg.totals.sessions > 0, 'dashboard has numbers');
  assert.ok(k.bookings.length >= 30 && k.bookings.every(x => x.sample));
  assert.ok(upcomingBookings(k, NOW).length > 0, 'upcoming bookings');
  assert.ok(new Set(k.bookings.map(x => x.status)).size >= 4);
  assert.ok(k.serviceProjects.length >= 10 && new Set(k.serviceProjects.map(p => p.stage)).size >= 4);
  assert.ok(k.abandonedCheckouts.length > 0 && k.staffNotes.filter(n => n.sample).length === 4);
  assert.ok(a.store.products.filter(p => p.sample && p.kind === 'service').length === 3);
  assert.ok(a.store.products.some(p => p.reviewsList.some(r => r.sample)));
  const kpi = serviceKpis(a.store, k, NOW);
  assert.ok(kpi.revenue > 0 && kpi.upcoming > 0 && kpi.utilisation.rate > 0 && kpi.utilisation.rate <= 1);
  assert.ok(hasSampleData(a.store, k)); assert.equal(hasSampleData(s, c), false);
  // the booking ids/times never overlap for one calendar
  const active = k.bookings.filter(x => x.status !== 'cancelled').map(x => [Date.parse(x.start), Date.parse(x.end)]).sort((p, q) => p[0] - q[0]);
  for (let i = 1; i < active.length; i++) assert.ok(active[i][0] >= active[i - 1][1], 'no double booking');
  assert.equal(normalizeCommerce(JSON.parse(JSON.stringify(k))).orders.filter(o => o.sample).length, k.orders.length, 'flags survive a round trip');
});

test('clearSampleData removes exactly the sample records; loading twice does not duplicate', () => {
  const { s, c } = base();
  // the merchant's own order, before sample data
  const p = s.products[0], own = createOrder(s, c, { lines: [lineFor(s, p.id, p.variants[0].id, 1)], email: 'me@shop.test' }, NOW - 86400000);
  const loaded = generateSampleData(own.store, own.commerce, { seed: 9, now: NOW });
  const again = generateSampleData(loaded.store, loaded.commerce, { seed: 9, now: NOW });
  assert.equal(again.commerce.orders.length, loaded.commerce.orders.length, 'reloading replaces');
  // a real order placed after loading, and a real booking
  let k = structuredClone(loaded.commerce);
  const after = createOrder(loaded.store, k, { lines: [lineFor(loaded.store, p.id, p.variants[0].id, 2)], email: 'late@shop.test' }, NOW);
  k = after.commerce;
  const realSvc = loaded.store.products.find(x => x.kind === 'service');
  k.bookings.push(newBooking(realSvc, { start: '2026-06-20T10:00:00Z', name: 'Real', now: NOW }));
  k = normalizeCommerce(k);
  const cleared = clearSampleData(after.store, k);
  assert.deepEqual(cleared.commerce.orders.map(o => o.email).sort(), ['late@shop.test', 'me@shop.test']);
  assert.equal(cleared.commerce.customers.length, 0); assert.equal(cleared.commerce.discounts.length, 0);
  assert.equal(cleared.commerce.bookings.length, 1, 'the real booking stays');
  assert.equal(cleared.commerce.serviceProjects.length + cleared.commerce.abandonedCheckouts.length, 0);
  assert.equal(cleared.commerce.analytics.events.filter(e => e.sample).length, 0);
  assert.equal(cleared.commerce.analytics.events.length, 2, 'the two real order_placed events stay');
  assert.equal(cleared.commerce.staffNotes.length, 0); assert.equal(cleared.commerce.sampleData, null);
  assert.deepEqual(cleared.store.products.map(x => x.id), s.products.map(x => x.id));
  assert.ok(cleared.store.products.every(x => x.reviewsList.every(r => !r.sample)));
  assert.ok(cleared.commerce.settings.general.nextOrderNumber > after.order.number, 'numbering continues after real orders');
  // with no real orders after loading, numbering returns to where it was
  const back = clearSampleData(loaded.store, loaded.commerce);
  assert.equal(back.commerce.settings.general.nextOrderNumber, own.commerce.settings.general.nextOrderNumber);
  assert.deepEqual(back.commerce, own.commerce, 'clear after load restores the original document');
  assert.deepEqual(back.store, own.store);
});

test('prng is seeded and uniform-ish', () => {
  const r = prng(1), xs = Array.from({ length: 1000 }, r);
  assert.deepEqual(Array.from({ length: 3 }, prng(5)), Array.from({ length: 3 }, prng(5)));
  assert.ok(xs.every(x => x >= 0 && x < 1));
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length; assert.ok(mean > 0.45 && mean < 0.55);
});

test('service routes', () => {
  const r = p => parseLocation('/commerce/shop' + p).commerce;
  assert.deepEqual(r('/services'), { view: 'store', handle: 'shop', page: 'services' });
  assert.deepEqual(r('/services/bookings'), { view: 'store', handle: 'shop', page: 'bookings' });
  assert.deepEqual(r('/services/bookings/b1'), { view: 'store', handle: 'shop', page: 'booking', id: 'b1' });
  assert.deepEqual(r('/services/projects/p 1'), { view: 'store', handle: 'shop', page: 'project', id: 'p 1' });
  for (const p of ['/services', '/services/bookings', '/services/bookings/b1', '/services/projects', '/services/projects/p%201'])
    assert.equal(formatRoute(parseLocation('/commerce/shop' + p)), '/commerce/shop' + p);
  assert.equal(routeTitle(parseLocation('/commerce/shop/services/projects'), 'Shop'), 'Projects · Shop · Zertake');
});
