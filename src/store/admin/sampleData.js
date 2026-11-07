// Sample data so a new store can be explored with a lived-in back office: customers, orders, storefront sessions with
// visitor locations, product reviews, service products with bookings and projects, abandoned checkouts and staff notes.
//
// Pure and deterministic: the same (store, commerce, { seed, days, now, timezone }) always gives the same documents
// (a seeded PRNG drives every choice, every id is derived from the seed). Every record it creates carries
// `sample: true`; clearSampleData() removes exactly those records and leaves everything else untouched.
//
//   generateSampleData(store, commerce, opts) → { store, commerce }   (replaces sample data that is already loaded)
//   clearSampleData(store, commerce)          → { store, commerce }
//   hasSampleData(store, commerce)            → bool
import { normalizeCommerce, createCommerce } from './model.js';
import { normalizeProduct } from '../model.js';
import { bookingSlots, addDays, zonedDay, newBooking } from './services.js';

const DAY = 86400000, MIN = 60000;

/** mulberry32: small, fast, seedable PRNG → floats in [0, 1). */
export function prng(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** A stable 31-bit seed from a string (e.g. the store id). */
export function seedFrom(text) { let h = 2166136261; for (const ch of String(text || 'zertake')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) % 2147483647 || 1; }

// country, weight, cities [name, lat, lon, zip, province]
const PLACES = [
  ['US', 26, [['New York', 40.71, -74.01, '10001', 'NY'], ['Los Angeles', 34.05, -118.24, '90012', 'CA'], ['Chicago', 41.88, -87.63, '60601', 'IL'], ['Austin', 30.27, -97.74, '78701', 'TX'], ['Seattle', 47.61, -122.33, '98101', 'WA']]],
  ['GB', 10, [['London', 51.51, -0.13, 'EC1A 1BB', ''], ['Manchester', 53.48, -2.24, 'M1 1AE', '']]],
  ['CA', 7, [['Toronto', 43.65, -79.38, 'M5H 2N2', 'ON'], ['Vancouver', 49.28, -123.12, 'V6B 1A1', 'BC']]],
  ['DE', 7, [['Berlin', 52.52, 13.40, '10115', ''], ['Munich', 48.14, 11.58, '80331', '']]],
  ['AU', 6, [['Sydney', -33.87, 151.21, '2000', 'NSW'], ['Melbourne', -37.81, 144.96, '3000', 'VIC']]],
  ['FR', 5, [['Paris', 48.86, 2.35, '75001', ''], ['Lyon', 45.76, 4.84, '69001', '']]],
  ['NL', 4, [['Amsterdam', 52.37, 4.90, '1012', '']]],
  ['ES', 4, [['Madrid', 40.42, -3.70, '28013', ''], ['Barcelona', 41.39, 2.17, '08002', '']]],
  ['IT', 3, [['Milan', 45.46, 9.19, '20121', '']]],
  ['SE', 3, [['Stockholm', 59.33, 18.07, '111 21', '']]],
  ['IE', 3, [['Dublin', 53.35, -6.26, 'D02', '']]],
  ['JP', 4, [['Tokyo', 35.68, 139.69, '100-0001', '']]],
  ['SG', 3, [['Singapore', 1.29, 103.85, '018989', '']]],
  ['BR', 3, [['São Paulo', -23.55, -46.63, '01000-000', 'SP']]],
  ['MX', 3, [['Mexico City', 19.43, -99.13, '06000', 'CDMX']]],
  ['IN', 3, [['Mumbai', 19.08, 72.88, '400001', 'MH'], ['Bengaluru', 12.97, 77.59, '560001', 'KA']]],
  ['ZA', 2, [['Cape Town', -33.92, 18.42, '8001', '']]],
  ['CH', 2, [['Zürich', 47.38, 8.54, '8001', '']]],
  ['NZ', 2, [['Auckland', -36.85, 174.76, '1010', '']]],
  ['AE', 2, [['Dubai', 25.20, 55.27, '00000', '']]],
  ['KR', 2, [['Seoul', 37.57, 126.98, '04524', '']]],
];
const FIRST = ['Maya', 'Liam', 'Sofia', 'Noah', 'Ava', 'Lucas', 'Emma', 'Mateo', 'Olivia', 'Leo', 'Isla', 'Hugo', 'Amara', 'Kai', 'Zoe', 'Ethan', 'Nora', 'Ravi', 'Chloe', 'Yuki', 'Elena', 'Omar', 'Freya', 'Diego', 'Hana', 'Felix', 'Priya', 'Jonas', 'Lea', 'Sam', 'Aria', 'Theo', 'Mila', 'Arjun', 'Clara', 'Ben', 'Ines', 'Malik', 'Lina', 'Oscar'];
const LAST = ['Rossi', 'Nguyen', 'Garcia', 'Müller', 'Smith', 'Tanaka', 'Silva', 'Kim', 'Dubois', 'Patel', 'Johansson', 'Murphy', 'Kowalski', 'Haddad', 'Okafor', 'Lopez', 'Schmidt', 'Brown', 'Ito', 'Moreau', 'Novak', 'Costa', 'Jensen', 'Khan', 'Walsh', 'Fischer', 'Santos', 'Lee', 'Martin', 'Reyes'];
const STREETS = ['Market St', 'High St', 'Oak Ave', 'King St', 'Harbour Rd', 'Elm St', 'Station Rd', 'Park Lane', 'Mill Rd', 'Bay St'];
const REVIEW_TEXT = [
  ['Exactly as described', 'Arrived quickly and the quality is even better than in the photos. Would buy again.'],
  ['Love it', 'Beautifully made and great value. It has become an everyday favourite.'],
  ['Great quality', 'Solid, well finished and nicely packed. Shipping updates were clear the whole way.'],
  ['Very happy', 'Fits perfectly and the colour is spot on. Customer service answered within the hour.'],
  ['Good, small niggle', 'Really nice overall — took a few extra days to arrive, but worth the wait.'],
  ['Thoughtful details', 'You can tell care went into this. The little touches make the difference.'],
];
const NOTES = [
  'Sample data: restock the two best sellers before the weekend promotion.',
  'Sample data: VIP customers get a handwritten thank-you card with their next order.',
  'Sample data: confirm Thursday’s consultation slots — two requests are waiting.',
  'Sample data: switch the Express rate to the new carrier from next month.',
];
const CLIENT_MSG = ['Hi! Just sent over the brief and a few reference images.', 'Thanks — could we make the second option a little warmer?', 'Looks great, approving this round.', 'Quick question: can we move the review call to Friday?', 'Received the files, thank you so much!'];
const MERCHANT_MSG = ['Thanks for the brief — kickoff is scheduled and I will share a first draft by the due date.', 'First draft is uploaded. Let me know what you think.', 'Revision is in progress, expect it within two days.', 'Final files are delivered. Thanks for working with us!', 'Friday works — I have updated the booking.'];

/** Sample service products added when the store has no bookable service yet (ids derived from the seed). */
function sampleServices(tag, timezone) {
  const base = { status: 'active', featured: false, tags: ['sample'], images: [], category: 'Services', sample: true, kind: 'service', compareAt: null, options: [] };
  return [
    normalizeProduct({ ...base, id: tag + 'svc1', title: '1:1 Consultation', slug: 'sample-consultation', price: 90, art: 'gen:target:eef2ec:5b7d64:f0533a:3',
      description: 'A focused one-hour video call to plan your next step. You leave with a written action plan.',
      variants: [{ id: tag + 'svc1v', options: [], sku: 'SVC-CONSULT', stock: null }],
      service: { pricing: { model: 'fixed' }, durationMinutes: 60, delivery: { mode: 'online', meetingUrl: 'https://meet.example.com/consultation' },
        booking: { enabled: true, timezone, bufferMinutes: 15, maxPerDay: 5, availability: [1, 2, 3, 4, 5].map(day => ({ day, start: '09:00', end: '17:00' })) },
        intake: [{ id: tag + 'q1', label: 'What would you like to focus on?', type: 'textarea', required: true }, { id: tag + 'q2', label: 'How did you hear about us?', type: 'select', options: ['Instagram', 'A friend', 'Search', 'Newsletter'] }, { id: tag + 'q3', label: 'Website or portfolio', type: 'url' }],
        deliverables: ['Session recording', 'Written action plan'], revisions: 0,
        addOns: [{ id: tag + 'a1', name: 'Extra 30 minutes', price: 45 }, { id: tag + 'a2', name: 'Follow-up review by email', price: 30 }],
        faq: [{ id: tag + 'f1', q: 'Can I reschedule?', a: 'Yes — up to 24 hours before the session, from the link in your confirmation email.' }, { id: tag + 'f2', q: 'Is the call recorded?', a: 'Only if you ask; the recording is shared with you afterwards.' }] } }),
    normalizeProduct({ ...base, id: tag + 'svc2', title: 'Custom design project', slug: 'sample-design-project', price: 450, art: 'gen:grid:f4efe6:1f2937:f59e0b:5',
      description: 'A complete custom project: discovery call, first concepts, two revision rounds and final files.',
      variants: [{ id: tag + 'svc2v', options: [], sku: 'SVC-PROJECT', stock: null }],
      service: { pricing: { model: 'package', sessions: 3 }, durationMinutes: 45, delivery: { mode: 'async', turnaroundDays: 10 },
        booking: { enabled: false, timezone, bufferMinutes: 15, maxPerDay: 0 },
        intake: [{ id: tag + 'q4', label: 'Describe your project', type: 'textarea', required: true }, { id: tag + 'q5', label: 'Deadline', type: 'text' }],
        deliverables: ['Discovery call', 'First concepts', 'Final files', 'Usage guide'], revisions: 2, addOns: [{ id: tag + 'a3', name: 'Rush delivery (5 days)', price: 150 }], faq: [] } }),
    normalizeProduct({ ...base, id: tag + 'svc3', title: 'Monthly retainer', slug: 'sample-retainer', price: 1200, art: 'gen:chart:e2e9f8:2d5197:f0533a:2',
      description: 'Ongoing support every month: two check-in calls a week and priority requests.',
      variants: [{ id: tag + 'svc3v', options: [], sku: 'SVC-RETAINER', stock: null }],
      service: { pricing: { model: 'retainer', stripePriceId: 'price_sample_retainer_monthly' }, durationMinutes: 30, delivery: { mode: 'online', meetingUrl: 'https://meet.example.com/check-in' },
        booking: { enabled: true, timezone, bufferMinutes: 0, maxPerDay: 2, availability: [2, 4].map(day => ({ day, start: '10:00', end: '12:00' })) },
        intake: [], deliverables: ['Weekly check-in', 'Monthly report'], revisions: 0, addOns: [], faq: [] } }),
  ];
}

/** Remove every record marked `sample: true` from both documents. */
export function clearSampleData(store, commerce) {
  const s = structuredClone(store);
  const gone = new Set(s.products.filter(p => p.sample).map(p => p.id));
  s.products = s.products.filter(p => !p.sample).map(p => p.reviewsList && p.reviewsList.some(r => r.sample) ? { ...p, reviewsList: p.reviewsList.filter(r => !r.sample) } : p);
  for (const col of s.collections || []) if (col.rule && Array.isArray(col.rule.productIds) && col.rule.productIds.some(id => gone.has(id))) col.rule.productIds = col.rule.productIds.filter(id => !gone.has(id));
  if (s.checkout && s.checkout.paymentLinks) for (const id of gone) delete s.checkout.paymentLinks[id];
  if (!commerce) return { store: s, commerce };
  const c = structuredClone(commerce), keep = x => !(x && x.sample);
  for (const k of ['orders', 'customers', 'discounts', 'staffNotes', 'bookings', 'serviceProjects', 'abandonedCheckouts']) if (Array.isArray(c[k])) c[k] = c[k].filter(keep);
  if (c.analytics) c.analytics = { ...c.analytics, events: (c.analytics.events || []).filter(keep) };
  if (c.marketing) c.marketing = { ...c.marketing, campaigns: (c.marketing.campaigns || []).filter(keep) };
  for (const id of gone) if (c.productMeta) delete c.productMeta[id];
  if (c.sampleData) {
    const realMax = c.orders.filter(o => !o.draft).reduce((m, o) => Math.max(m, o.number || 0), 0);
    c.settings = { ...c.settings, general: { ...c.settings.general, nextOrderNumber: Math.max(c.sampleData.prevNextOrderNumber || 1001, realMax + 1) } };
  }
  c.sampleData = null;
  return { store: s, commerce: normalizeCommerce(c) };
}

/** True when either document holds sample records. */
export function hasSampleData(store, commerce) {
  if (commerce && commerce.sampleData) return true;
  if (store && (store.products || []).some(p => p.sample || (p.reviewsList || []).some(r => r.sample))) return true;
  return !!(commerce && ((commerce.orders || []).some(o => o.sample) || (commerce.customers || []).some(o => o.sample) || (commerce.bookings || []).some(o => o.sample)));
}

/**
 * Fill a store with sample data. opts: { seed (default: from the store id), days: 90, now: Date.now(), timezone: 'UTC'
 * (the time zone the sample services take bookings in) }. Sample data that is already loaded is replaced.
 * Volumes: 60 customers in 21 countries, ~180 orders over `days` days (paid / pending / fulfilled / refunded / cancelled,
 * some with discount codes), ~1,100 storefront sessions with visitor locations, reviews on up to 8 products, 3 service
 * products (when the store has no bookable service) with ~80 bookings and ~16 projects, abandoned checkouts and 4 staff notes.
 */
export function generateSampleData(store, commerce, opts = {}) {
  const seed = opts.seed == null ? seedFrom(store && store.id) : Math.round(+opts.seed) || 1;
  const days = Math.max(14, Math.min(365, Math.round(+opts.days || 90)));
  const now = opts.now == null ? Date.now() : +opts.now;
  const timezone = opts.timezone || 'UTC';
  const cleared = clearSampleData(store, commerce || createCommerce(store));
  const S = cleared.store, K = structuredClone(cleared.commerce);
  const r = prng(seed), tag = 'smp' + seed.toString(36) + '_';
  let k = 0; const id = p => tag + p + (k++).toString(36);
  const int = (a, b) => a + Math.floor(r() * (b - a + 1));
  const one = list => list[Math.floor(r() * list.length)];
  const chance = p => r() < p;
  const totalW = PLACES.reduce((s, p) => s + p[1], 0);
  const place = () => { let x = r() * totalW; for (const p of PLACES) { x -= p[1]; if (x < 0) return p; } return PLACES[0]; };
  const cityOf = p => one(p[2]);
  const isoAt = t => new Date(Math.round(t / 1000) * 1000).toISOString();
  const C = v => Math.round(v * 100), M = c => Math.round(c) / 100;
  const prevNext = K.settings.general.nextOrderNumber;

  // ---------- products ----------
  let services = S.products.filter(p => p.kind === 'service' && p.status !== 'draft' && p.service && p.service.booking.enabled);
  if (!services.length) { const add = sampleServices(tag, timezone); S.products.push(...add); services = add.filter(p => p.service.booking.enabled); }
  const allServices = S.products.filter(p => p.kind === 'service' && p.status !== 'draft');
  const goods = S.products.filter(p => p.kind !== 'service' && p.status !== 'draft' && p.variants.length);
  const priceOf = (p, v) => v && v.price != null ? v.price : p.price;
  // reviews
  for (const p of goods.slice(0, 8)) {
    const n = int(2, 4);
    p.reviewsList = [...(p.reviewsList || []), ...Array.from({ length: n }, () => {
      const [title, text] = one(REVIEW_TEXT), at = now - int(2, days) * DAY;
      return { id: id('rv'), name: one(FIRST) + ' ' + one(LAST).charAt(0) + '.', rating: chance(0.75) ? 5 : chance(0.7) ? 4 : 3, title, text, date: new Date(at).toISOString().slice(0, 10), photo: null, sample: true };
    })];
  }

  // ---------- customers ----------
  const customers = Array.from({ length: 60 }, (_, i) => {
    const pl = i < PLACES.length ? PLACES[i] : place(), c = cityOf(pl), [city, lat, lon, zip, province] = c;
    const firstName = FIRST[(i * 7 + int(0, 3)) % FIRST.length], lastName = LAST[(i * 11 + int(0, 5)) % LAST.length];
    const ascii = s => s.normalize('NFKD').replace(/[^\w]/g, '').toLowerCase();
    return { id: id('cu'), firstName, lastName, email: `${ascii(firstName)}.${ascii(lastName)}${i + 1}@example.com`, phone: '', company: chance(0.15) ? lastName + ' Studio' : '',
      address: { name: firstName + ' ' + lastName, company: '', address1: int(2, 240) + ' ' + one(STREETS), address2: '', city, province, zip, country: pl[0], phone: '' },
      tags: [], note: '', acceptsMarketing: chance(0.55), marketingUpdatedAt: null, createdAt: isoAt(now - int(days, days + 120) * DAY), sample: true, _geo: { country: pl[0], city, lat, lon } };
  });
  const pickCustomer = () => customers[Math.min(customers.length - 1, Math.floor(customers.length * Math.pow(r(), 1.7)))];

  // ---------- discounts ----------
  const discounts = [
    { id: id('dc'), title: 'Welcome 10%', method: 'code', code: 'WELCOME10', type: 'percentage', value: 10, appliesTo: { kind: 'all' }, minimum: { kind: 'none', value: 0 }, enabled: true, combinable: false, oncePerCustomer: true, usageLimit: null, usageCount: 0, startsAt: null, endsAt: null, createdAt: isoAt(now - (days + 5) * DAY), sample: true },
    { id: id('dc'), title: 'Spring sale 20%', method: 'code', code: 'SPRING20', type: 'percentage', value: 20, appliesTo: { kind: 'all' }, minimum: { kind: 'amount', value: 50 }, enabled: true, combinable: false, oncePerCustomer: false, usageLimit: 200, usageCount: 0, startsAt: isoAt(now - days * DAY), endsAt: null, createdAt: isoAt(now - days * DAY), sample: true },
  ];

  // ---------- orders ----------
  const zones = K.settings.shipping.zones, rateBy = (country, name) => { const z = zones.find(x => x.countries.includes(country)) || zones.find(x => x.countries.includes('*')); return z ? z.rates.find(x => x.name === name) || z.rates[0] || null : null; };
  const defLoc = (K.settings.locations.find(l => l.isDefault) || K.settings.locations[0] || {}).id || '';
  const orders = [], events = [], bookings = [], projects = [], abandoned = [];
  const lineOf = (p, qty = 1) => { const v = one(p.variants); return { id: id('l'), productId: p.id, variantId: v.id, title: p.title, variantTitle: (v.options || []).join(' / '), sku: v.sku, price: priceOf(p, v), quantity: qty, image: p.images[0] || p.art || '' }; };
  /** Build an order at time t for customer cu (null = guest) with lines; status from its age. */
  const makeOrder = (t, cu, lines, { forceStatus } = {}) => {
    const age = (now - t) / DAY, physical = lines.some(l => { const p = S.products.find(x => x.id === l.productId); return !p || p.kind !== 'service'; });
    const subtotalC = lines.reduce((s, l) => s + C(l.price) * l.quantity, 0);
    const disc = chance(0.18) ? (subtotalC >= 5000 && chance(0.5) ? discounts[1] : discounts[0]) : null;
    const discC = disc ? Math.round(subtotalC * disc.value / 100) : 0;
    if (disc) disc.usageCount++;
    const country = cu ? cu.address.country : place()[0];
    let shipC = 0, rate = null;
    if (physical) { rate = country === 'US' ? rateBy('US', subtotalC - discC >= 7500 ? 'Standard' : chance(0.2) ? 'Express' : 'Standard') : rateBy(country, 'International'); shipC = country === 'US' ? (rate && rate.name === 'Express' ? 1499 : subtotalC - discC >= 7500 ? 0 : 599) : 1400; }
    const totalC = subtotalC - discC + shipC;
    const roll = r();
    let fin = 'paid', ful = 'unfulfilled', status = 'open', refunds = [], cancelledAt = null;
    const tl = [{ id: id('t'), at: isoAt(t), type: 'created', message: 'Order placed in the online store' }];
    if (forceStatus === 'paid') fin = 'paid';
    else if (roll < 0.03 && age > 2) { status = 'cancelled'; fin = 'voided'; cancelledAt = isoAt(t + int(2, 30) * 3600000); tl.push({ id: id('t'), at: cancelledAt, type: 'cancelled', message: 'Order cancelled: customer changed their mind' }); }
    else if (roll < 0.08 && age > 6) { fin = 'refunded'; refunds = [{ id: id('rf'), at: isoAt(t + int(3, 6) * DAY), amount: M(totalC), restock: false, reason: 'Returned' }]; }
    else if (roll < 0.11 && age > 6) { fin = 'partially_refunded'; refunds = [{ id: id('rf'), at: isoAt(t + int(3, 6) * DAY), amount: M(Math.round(totalC * 0.3)), restock: false, reason: 'Damaged item' }]; }
    else if (roll < (age < 4 ? 0.35 : 0.17)) fin = 'pending';
    if (fin === 'paid') tl.push({ id: id('t'), at: isoAt(t + 60000), type: 'paid', message: 'Payment of ' + (totalC / 100).toFixed(2) + ' captured' });
    if (fin === 'refunded' || fin === 'partially_refunded') tl.push({ id: id('t'), at: isoAt(t + 60000), type: 'paid', message: 'Payment captured' }, { id: id('t'), at: refunds[0].at, type: 'refunded', message: 'Refunded ' + refunds[0].amount.toFixed(2) });
    const fulfillments = [];
    if (status === 'open' && fin !== 'pending' && (age > 3 ? chance(0.93) : chance(0.25))) {
      ful = 'fulfilled'; const at = isoAt(t + int(1, 3) * DAY);
      if (physical) { const carrier = one(['UPS', 'DHL', 'USPS', 'FedEx']); fulfillments.push({ id: id('f'), at, carrier, trackingNumber: '1Z' + String(int(100000, 999999)) + String(int(1000, 9999)), trackingUrl: '', locationId: defLoc }); }
      else fulfillments.push({ id: id('f'), at, carrier: '', trackingNumber: '', trackingUrl: '', locationId: defLoc });
      tl.push({ id: id('t'), at, type: 'fulfilled', message: physical ? 'Order shipped' : 'Service delivered' });
    }
    const o = { id: id('o'), number: 0, name: '', draft: false, source: chance(0.85) ? 'preview' : 'manual', createdAt: isoAt(t), updatedAt: isoAt(t), status, financialStatus: fin, fulfillmentStatus: ful,
      customerId: cu ? cu.id : null, email: cu ? cu.email : `guest${int(100, 999)}@example.com`, phone: '', shippingAddress: cu ? { ...cu.address } : { name: 'Guest', country },
      lines, codes: disc ? [disc.code] : [], shippingRateId: rate ? rate.id : null, shippingName: rate ? rate.name : '', paymentMethod: fin === 'pending' ? 'Bank transfer' : one(['Credit card', 'Credit card', 'PayPal', 'Apple Pay']), note: '', tags: [],
      totals: { subtotal: M(subtotalC), discountTotal: M(discC), shipping: M(shipC), shippingDiscount: 0, tax: 0, taxInclusive: false, total: M(totalC), applied: disc ? [{ id: disc.id, title: disc.title, code: disc.code, type: 'percentage', amount: M(discC) }] : [] },
      fulfillments, refunds, inventoryApplied: false, cancelledAt, cancelReason: cancelledAt ? 'customer' : '', timeline: tl, sample: true };
    orders.push(o);
    return o;
  };
  const session = (t, geo, steps, extra = {}) => {
    const sidv = id('ss'); let at = t;
    const push = (type, more = {}) => { events.push({ id: id('e'), at: isoAt(at), type, sessionId: sidv, path: more.path || '', productId: more.productId || '', variantId: '', quantity: more.quantity || 0, value: more.value || 0, orderId: more.orderId || '', source: 'preview', ...(more.geo ? { geo: more.geo } : {}), sample: true }); at += int(20, 140) * 1000; };
    push('visit', { path: 'index.html', geo });
    if (steps.product) push('view_product', { path: 'products/' + steps.product.slug + '.html', productId: steps.product.id });
    else push('page_view', { path: 'index.html' });
    if (steps.cart) push('add_to_cart', { path: 'cart.html', quantity: steps.cart });
    if (steps.checkout) push('checkout_started', { path: 'checkout.html' });
    if (extra.order) push('order_placed', { path: 'checkout.html', orderId: extra.order.id, value: extra.order.totals.total, quantity: extra.order.lines.reduce((n, l) => n + l.quantity, 0) });
    return sidv;
  };
  const geoOf = cu => cu ? { ...cu._geo } : (() => { const pl = place(), c = cityOf(pl); return { country: pl[0], city: c[0], lat: c[1], lon: c[2] }; })();
  const dayTime = dayAgo => { const base = Date.parse(new Date(now - dayAgo * DAY).toISOString().slice(0, 10) + 'T00:00:00Z'); return Math.min(now - 5 * MIN, base + (int(8, 22) * 60 + int(0, 59)) * MIN); };

  // bookings (and the orders that paid for them)
  const today = zonedDay(now, timezone);
  for (const svc of services) {
    const s = svc.service;
    for (let d = -60; d <= 21; d++) {
      const key = addDays(today, d), slots = bookingSlots(svc, { from: key, days: 1, bookings, now: d < 0 ? 0 : now });
      const p = d < 0 ? 0.28 : d < 8 ? 0.42 : 0.2;
      for (const slot of slots) {
        if (!chance(p / Math.max(1, slots.length / 3))) continue;
        const cu = pickCustomer(), start = Date.parse(slot.start), past = start < now;
        const status = past ? (chance(0.8) ? 'completed' : chance(0.45) ? 'no_show' : 'cancelled') : (chance(0.72) ? 'confirmed' : chance(0.75) ? 'requested' : 'cancelled');
        const created = Math.min(now - 30 * MIN, start - int(1, 12) * DAY);
        const intake = s.intake.map(q => ({ question: q.label, answer: q.type === 'select' ? one(q.options) : q.type === 'url' ? (chance(0.5) ? 'https://' + cu.lastName.toLowerCase().replace(/[^a-z]/g, '') + '.example.com' : '') : one(['Planning the next product launch and pricing.', 'Getting more repeat customers.', 'A clearer brand direction for the new season.', 'Setting up my first wholesale accounts.']) })).filter(q => q.answer);
        const b = newBooking(svc, { start: slot.start, customer: cu, status, intake, now: created });
        b.id = id('bk'); b.sample = true; b.createdAt = isoAt(created);
        b.history = [{ id: id('bh'), at: isoAt(created), message: 'Booked online' }];
        if (status === 'confirmed' || status === 'completed' || status === 'no_show') b.history.push({ id: id('bh'), at: isoAt(created + 2 * 3600000), message: 'Confirmed' });
        if (status === 'completed') b.history.push({ id: id('bh'), at: isoAt(Date.parse(b.end)), message: 'Marked as completed' });
        if (status === 'cancelled') b.history.push({ id: id('bh'), at: isoAt(Math.min(now, created + DAY)), message: 'Cancelled by the customer' });
        if (status === 'no_show') b.history.push({ id: id('bh'), at: isoAt(Date.parse(b.end)), message: 'Marked as no-show' });
        if (chance(0.25)) b.notes = one(['Prefers video off for the first few minutes.', 'Returning client — follow up on last month’s plan.', 'Send the slides afterwards.']);
        if (status !== 'cancelled' && s.pricing.model !== 'retainer' && chance(0.75)) {
          const o = makeOrder(created, cu, [lineOf(svc)], { forceStatus: 'paid' });
          if (Date.parse(b.end) < now) { o.fulfillmentStatus = 'fulfilled'; o.fulfillments = [{ id: id('f'), at: b.end, carrier: '', trackingNumber: '', trackingUrl: '', locationId: defLoc }]; }
          else { o.fulfillmentStatus = 'unfulfilled'; o.fulfillments = []; o.timeline = o.timeline.filter(e => e.type !== 'fulfilled'); }
          b.orderId = o.id; session(created - int(4, 20) * MIN, geoOf(cu), { product: svc, cart: 1, checkout: true }, { order: o });
        }
        bookings.push(b);
      }
    }
  }
  // projects (package and retainer services)
  const projectSvcs = allServices.filter(p => p.service && (p.service.pricing.model === 'package' || p.service.pricing.model === 'retainer' || p.service.delivery.mode === 'async'));
  const projSvc = projectSvcs.length ? projectSvcs : allServices;
  for (let i = 0; i < 16 && projSvc.length; i++) {
    const retainer = projSvc.find(p => p.service.pricing.model === 'retainer'), others = projSvc.filter(p => p !== retainer);
    const svc = retainer && (i % 4 === 3 || !others.length) ? retainer : others[i % others.length], s = svc.service, cu = pickCustomer();
    const turnaround = s.delivery.turnaroundDays || 14, ageDays = i < 2 ? int(0, 2) : i < 6 ? int(1, turnaround) : int(2, days - 5), created = now - ageDays * DAY - int(0, 600) * MIN;
    const stage = i < 2 ? 'new' : ageDays > turnaround + 8 ? (chance(0.9) ? 'completed' : 'delivered') : ageDays > turnaround ? one(['delivered', 'revision', 'completed']) : ageDays > turnaround / 2 ? one(['in_progress', 'in_progress', 'delivered']) : one(['new', 'in_progress']);
    // a revision round moves the due date a week past the delivery
    const due = new Date(created + (turnaround + (stage === 'revision' ? Math.max(7, ageDays - turnaround + int(2, 6)) : 0)) * DAY).toISOString().slice(0, 10);
    const doneShare = { new: 0, in_progress: 0.4, delivered: 1, revision: 0.75, completed: 1 }[stage];
    const dl = (s.deliverables.length ? s.deliverables : ['Kickoff call', 'Draft', 'Final delivery']).map((label, j, all) => ({ id: id('dv'), label, done: j < Math.round(all.length * doneShare) }));
    const nMsg = { new: 1, in_progress: 2, delivered: 4, revision: 4, completed: 5 }[stage], messages = [];
    for (let j = 0; j < nMsg; j++) messages.push({ id: id('msg'), at: isoAt(Math.min(now - MIN, created + (j + 1) * (ageDays * DAY) / (nMsg + 1))), from: j % 2 === 0 ? 'client' : 'merchant', text: j % 2 === 0 ? CLIENT_MSG[(i + j) % CLIENT_MSG.length] : MERCHANT_MSG[(i + j) % MERCHANT_MSG.length] });
    const o = makeOrder(created, cu, [lineOf(svc)], { forceStatus: 'paid' });
    if (stage === 'completed' || stage === 'delivered') { o.fulfillmentStatus = 'fulfilled'; if (!o.fulfillments.length) o.fulfillments = [{ id: id('f'), at: isoAt(Math.min(now, created + turnaround * DAY)), carrier: '', trackingNumber: '', trackingUrl: '', locationId: defLoc }]; }
    else { o.fulfillmentStatus = 'unfulfilled'; o.fulfillments = []; o.timeline = o.timeline.filter(e => e.type !== 'fulfilled'); }
    session(created - int(4, 20) * MIN, geoOf(cu), { product: svc, cart: 1, checkout: true }, { order: o });
    projects.push({ id: id('pj'), productId: svc.id, title: svc.title + ' · ' + cu.firstName + ' ' + cu.lastName, customerId: cu.id, name: cu.firstName + ' ' + cu.lastName, email: cu.email, orderId: o.id,
      stage, dueDate: due, createdAt: isoAt(created), updatedAt: messages.length ? messages[messages.length - 1].at : isoAt(created), value: svc.price, revisionsIncluded: s.revisions,
      revisionsUsed: stage === 'revision' ? 1 : stage === 'completed' ? int(0, s.revisions) : 0, deliverables: dl, messages, notes: '', sample: true });
  }
  // product orders up to ~180 in total
  const target = 180;
  while (orders.length < target) {
    const dayAgo = Math.floor(days * Math.pow(r(), 1.35)), t = dayTime(dayAgo), cu = chance(0.92) ? pickCustomer() : null;
    let lines;
    if (goods.length) { const n = Math.min(goods.length, chance(0.6) ? 1 : chance(0.7) ? 2 : 3), picked = new Set(); while (picked.size < n) picked.add(one(goods)); lines = [...picked].map(p => lineOf(p, chance(0.8) ? 1 : 2)); }
    else lines = [lineOf(one(allServices))];
    const o = makeOrder(t, cu, lines);
    if (o.source === 'preview') session(t - int(3, 25) * MIN, geoOf(cu), { product: S.products.find(p => p.id === lines[0].productId), cart: lines.reduce((s, l) => s + l.quantity, 0), checkout: true }, { order: o });
    else events.push({ id: id('e'), at: o.createdAt, type: 'order_placed', sessionId: '', path: '', productId: '', variantId: '', quantity: lines.reduce((s, l) => s + l.quantity, 0), value: o.totals.total, orderId: o.id, source: 'manual', sample: true });
  }
  // browsing sessions without an order (some reach the cart or checkout: abandoned checkouts)
  const browse = goods.length ? goods : allServices;
  for (let d = days - 1; d >= 0; d--) {
    const t0 = Date.parse(new Date(now - d * DAY).toISOString().slice(0, 10) + 'T00:00:00Z');
    const wd = new Date(t0).getUTCDay(), trend = 0.7 + 0.6 * (1 - d / days), n = Math.round((7 + (wd === 0 || wd === 6 ? 2 : 0)) * trend + r() * 3);
    for (let j = 0; j < n; j++) {
      const t = t0 + int(6 * 60, 23 * 60 + 30) * MIN; if (t >= now - MIN) continue;
      const cu = chance(0.12) ? pickCustomer() : null, geo = geoOf(cu);
      const product = chance(0.62) ? one(browse) : null, cart = product && chance(0.3) ? int(1, 2) : 0, checkout = cart && chance(0.42);
      const sidv = session(t, geo, { product, cart, checkout });
      if (checkout) { const v = product.variants[0]; abandoned.push({ id: id('ac'), at: isoAt(t + 5 * MIN), sessionId: sidv, customerId: cu ? cu.id : null, email: cu ? cu.email : chance(0.4) ? `visitor${int(100, 999)}@example.com` : '', country: geo.country, lines: [{ productId: product.id, variantId: v.id, title: product.title, price: priceOf(product, v), quantity: cart }], recovered: false, sample: true }); }
    }
  }

  // numbering in time order, customers created before their first order
  orders.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const realMax = K.orders.filter(o => !o.draft).reduce((m, o) => Math.max(m, o.number), 0);
  let num = Math.max(prevNext, realMax + 1);
  for (const o of orders) { o.number = num++; o.name = K.settings.general.orderPrefix + o.number; }
  const first = new Map(); for (const o of orders) if (o.customerId && !first.has(o.customerId)) first.set(o.customerId, Date.parse(o.createdAt));
  for (const cu of customers) { const f = first.get(cu.id); if (f) cu.createdAt = isoAt(f - int(1, 72) * 3600000); delete cu._geo; }
  const counts = new Map(); for (const o of orders) if (o.customerId && o.status !== 'cancelled') counts.set(o.customerId, (counts.get(o.customerId) || 0) + 1);
  for (const cu of customers) if ((counts.get(cu.id) || 0) >= 4) cu.tags = ['VIP'];

  K.customers.push(...customers);
  K.discounts.push(...discounts);
  K.orders.push(...orders);
  K.analytics = { events: [...K.analytics.events, ...events].sort((a, b) => a.at.localeCompare(b.at)) };
  K.bookings = [...(K.bookings || []), ...bookings];
  K.serviceProjects = [...(K.serviceProjects || []), ...projects];
  K.abandonedCheckouts = [...(K.abandonedCheckouts || []), ...abandoned];
  K.staffNotes = [...NOTES.map((text, i) => ({ id: id('sn'), at: isoAt(now - (i * 2 + 1) * DAY), author: 'Sample data', text, sample: true })), ...K.staffNotes];
  K.sampleData = { loadedAt: isoAt(now), seed, prevNextOrderNumber: prevNext };
  K.settings.general.nextOrderNumber = num;
  return { store: S, commerce: normalizeCommerce(K) };
}
