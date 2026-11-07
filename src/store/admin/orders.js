// Orders: totals (discounts → shipping → tax), lifecycle (paid / fulfilled / refunded / cancelled / archived),
// printable documents and notification emails. Pure functions over (store, commerce); each mutation returns
// { store, commerce, order } with new objects (inputs are never mutated).
import { applyDiscounts } from './discounts.js';
import { cid, normalizeOrder, normalizeCustomer, customerName, formatAddress, countryName, fillTemplate, variantWeight, normalizeEvent, MAX_EVENTS } from './model.js';
import { decrementForOrder, restockOrder } from './inventory.js';
import { formatMoney, esc } from '../render.js';
import { variantPrice, variantLabel } from '../model.js';

const clone = o => JSON.parse(JSON.stringify(o));
const isoOf = now => new Date(now == null ? Date.now() : now).toISOString();
const C = n => Math.round((+n || 0) * 100), M = c => Math.round(c) / 100;

// ---------- shipping & tax ----------
/** Zone serving a country: an exact country match wins over a '*' (rest of world) zone. */
export function zoneFor(commerce, country) {
  const zones = commerce.settings.shipping.zones;
  return zones.find(z => country && z.countries.includes(country)) || zones.find(z => z.countries.includes('*')) || null;
}

/** Rate price for a cart (null = rate not available, e.g. weight above the last tier). */
export function ratePrice(rate, subtotal, grams) {
  if (rate.type === 'flat') return rate.price;
  if (rate.type === 'free_over') return C(subtotal) >= C(rate.threshold) && rate.threshold >= 0 ? 0 : rate.price;
  const tier = rate.tiers.find(t => grams <= t.upTo);
  return tier ? tier.price : null;
}

/** Available shipping rates for an address country: [{ id, zoneId, zoneName, name, price }]. */
export function shippingRatesFor(commerce, country, subtotal, grams = 0) {
  const z = zoneFor(commerce, country);
  if (!z) return [];
  return z.rates.map(r => ({ id: r.id, zoneId: z.id, zoneName: z.name, name: r.name, type: r.type, price: ratePrice(r, subtotal, grams) })).filter(r => r.price != null);
}

/** Tax rate (percent) for an address: a region-specific rate replaces the country rate. */
export function taxRateFor(commerce, country, region) {
  const rates = commerce.settings.taxes.rates.filter(r => r.country === country);
  const reg = String(region || '').trim().toLowerCase();
  const exact = reg && rates.find(r => r.region && r.region.toLowerCase() === reg);
  const base = rates.find(r => !r.region);
  const r = exact || base;
  return r ? { rate: r.rate, name: r.name } : { rate: 0, name: '' };
}

/** Tax on a taxable amount. Inclusive prices: the tax already inside the amount; exclusive: tax added on top. */
export function computeTax(amount, ratePercent, inclusive) {
  const a = C(amount), r = (+ratePercent || 0) / 100;
  if (r <= 0 || a <= 0) return 0;
  return M(inclusive ? a - Math.round(a / (1 + r)) : Math.round(a * r));
}

export function cartWeight(commerce, lines) { return lines.reduce((g, l) => g + variantWeight(commerce, l.productId, l.variantId) * l.quantity, 0); }

/** collection ids a product belongs to (for collection-scoped discounts). */
export function productCollections(store, productId) {
  const p = store.products.find(x => x.id === productId); if (!p) return [];
  return store.collections.filter(col => col.rule.type === 'all' || (col.rule.type === 'manual' ? col.rule.productIds.includes(p.id)
    : col.rule.type === 'category' ? p.category.toLowerCase() === col.rule.value.trim().toLowerCase()
    : p.tags.some(t => t.toLowerCase() === col.rule.value.trim().toLowerCase()))).map(c => c.id);
}

/**
 * Full totals for an order draft.
 * input: { lines: [{ productId, variantId, price, quantity }], codes, shippingRateId, shippingAddress: { country, province }, customerId }
 * → { ...applyDiscounts(), rates (available shipping), shippingName, shippingRateId, tax, taxRate, taxName, taxInclusive, total }
 */
export function computeOrderTotals(store, commerce, input, now) {
  const lines = (input.lines || []).map(l => ({ ...l, collectionIds: productCollections(store, l.productId) }));
  const country = input.shippingAddress?.country || '', subtotal = M(lines.reduce((s, l) => s + C(l.price) * l.quantity, 0));
  const rates = shippingRatesFor(commerce, country, subtotal, cartWeight(commerce, lines));
  const rate = input.shippingRateId === 'none' ? null : rates.find(r => r.id === input.shippingRateId) || null;
  const customerUsage = {};
  if (input.customerId) for (const o of commerce.orders) if (o.customerId === input.customerId && !o.draft && o.status !== 'cancelled' && o.id !== input.id) for (const a of o.totals.applied) customerUsage[a.id] = (customerUsage[a.id] || 0) + 1;
  const d = applyDiscounts({ lines, codes: input.codes || [], shipping: rate ? rate.price : 0, customerId: input.customerId, customerUsage }, commerce.discounts, now);
  const tx = commerce.settings.taxes, tr = taxRateFor(commerce, country, input.shippingAddress?.province);
  const taxable = M(C(d.subtotal) - C(d.discountTotal) + (tx.shippingTaxed ? C(d.shipping) : 0));
  const tax = computeTax(taxable, tr.rate, tx.inclusive);
  return { ...d, rates, shippingRateId: rate ? rate.id : null, shippingName: rate ? rate.name : '', tax, taxRate: tr.rate, taxName: tr.name, taxInclusive: tx.inclusive, total: M(C(d.total) + (tx.inclusive ? 0 : C(tax))) };
}

// ---------- lifecycle ----------
function withOrder(commerce, id, fn) {
  const c = clone(commerce), o = c.orders.find(x => x.id === id);
  if (!o) throw Error('Order not found');
  fn(o, c);
  return c;
}
const event = (type, message, now) => ({ id: cid('t'), at: isoOf(now), type, message });
export const refundedAmount = o => M(o.refunds.reduce((s, r) => s + C(r.amount), 0));
export const netTotal = o => M(C(o.totals.total) - C(refundedAmount(o)));

/** Line snapshot for a product variant (title, variant title, SKU, price, first image). */
export function lineFor(store, productId, variantId, quantity = 1) {
  const p = store.products.find(x => x.id === productId), v = p?.variants.find(x => x.id === variantId);
  if (!p || !v) return null;
  return { id: cid('l'), productId, variantId, title: p.title, variantTitle: variantLabel(p, v), sku: v.sku, price: variantPrice(p, v), quantity: Math.max(1, Math.round(+quantity || 1)), image: p.images[0] || p.art || '' };
}

/**
 * Create an order (or a draft). input: { lines, customerId, email, phone, shippingAddress, codes, shippingRateId, note, tags,
 * paymentMethod, paid: bool, draft: bool, source }. Paid orders take stock immediately; discount usage counts are increased
 * for real (non-draft) orders and an 'order_placed' analytics event is logged.
 */
export function createOrder(store, commerce, input, now) {
  const t = computeOrderTotals(store, commerce, input, now);
  let c = clone(commerce);
  const g = c.settings.general, draft = !!input.draft;
  const number = draft ? g.nextDraftNumber++ : g.nextOrderNumber++;
  const order = normalizeOrder({
    id: cid('o'), number, name: draft ? 'D' + number : g.orderPrefix + number, draft, source: input.source || 'manual', createdAt: isoOf(now), updatedAt: isoOf(now),
    customerId: input.customerId || null, email: input.email, phone: input.phone, shippingAddress: input.shippingAddress,
    lines: input.lines, codes: t.appliedCodes, shippingRateId: t.shippingRateId, shippingName: t.shippingName, paymentMethod: input.paymentMethod, note: input.note, tags: input.tags,
    totals: { subtotal: t.subtotal, discountTotal: t.discountTotal, shipping: t.shipping, shippingDiscount: t.shippingDiscount, tax: t.tax, taxInclusive: t.taxInclusive, total: t.total, applied: t.applied },
    timeline: [event('created', draft ? 'Draft order created' : (input.source === 'preview' ? 'Order placed from the store preview' : input.source === 'import' ? 'Order imported' : 'Order created manually'), now)],
  });
  c.orders.push(order);
  if (!draft) {
    for (const a of t.applied) { const d = c.discounts.find(x => x.id === a.id); if (d) d.usageCount++; }
    c.analytics.events.push(normalizeEvent({ type: 'order_placed', at: isoOf(now), orderId: order.id, value: order.totals.total, quantity: order.lines.reduce((n, l) => n + l.quantity, 0), source: input.source === 'preview' ? 'preview' : input.source === 'import' ? 'import' : 'manual', sessionId: input.sessionId || '' }));
    if (c.analytics.events.length > MAX_EVENTS) c.analytics.events = c.analytics.events.slice(-MAX_EVENTS);
  }
  let s = store;
  if (!draft && input.paid) { const r = markPaid(s, c, order.id, now); s = r.store; c = r.commerce; }
  return { store: s, commerce: c, order: c.orders.find(o => o.id === order.id) };
}

/** Recalculate a draft with new input (lines, codes, customer, shipping…). */
export function updateDraft(store, commerce, id, input, now) {
  const t = computeOrderTotals(store, commerce, { ...input, id }, now);
  const c = withOrder(commerce, id, o => {
    if (!o.draft) throw Error('Only draft orders can be edited');
    Object.assign(o, normalizeOrder({ ...o, ...input, codes: t.appliedCodes, shippingRateId: t.shippingRateId, shippingName: t.shippingName,
      totals: { subtotal: t.subtotal, discountTotal: t.discountTotal, shipping: t.shipping, shippingDiscount: t.shippingDiscount, tax: t.tax, taxInclusive: t.taxInclusive, total: t.total, applied: t.applied }, updatedAt: isoOf(now) }));
  });
  return { store, commerce: c, order: c.orders.find(o => o.id === id) };
}

/** Turn a draft into a real order (new order number, discount usage counted, optional payment). */
export function completeDraft(store, commerce, id, { paid = false } = {}, now) {
  const d = commerce.orders.find(o => o.id === id);
  if (!d || !d.draft) throw Error('Not a draft order');
  const without = clone(commerce); without.orders = without.orders.filter(o => o.id !== id);
  const r = createOrder(store, without, { ...d, codes: d.codes, paid, draft: false, source: d.source }, now);
  const c = clone(r.commerce), o = c.orders.find(x => x.id === r.order.id);
  o.timeline.unshift(event('created', 'Created from draft ' + d.name, now));
  o.note = d.note;
  return { store: r.store, commerce: c, order: o };
}

export function deleteDraft(commerce, id) {
  const c = clone(commerce); c.orders = c.orders.filter(o => !(o.id === id && o.draft)); return c;
}

export function markPaid(store, commerce, id, now) {
  let c = withOrder(commerce, id, o => {
    if (o.draft) throw Error('Complete the draft first');
    if (o.status === 'cancelled') throw Error('The order is cancelled');
    o.financialStatus = 'paid'; o.updatedAt = isoOf(now); o.timeline.push(event('paid', 'Payment of ' + o.totals.total.toFixed(2) + ' marked as received' + (o.paymentMethod ? ' (' + o.paymentMethod + ')' : ''), now));
  });
  const r = decrementForOrder(store, c, id, now);
  return { store: r.store, commerce: r.commerce, order: r.commerce.orders.find(o => o.id === id) };
}

export function fulfillOrder(store, commerce, id, { carrier = '', trackingNumber = '', trackingUrl = '', locationId = '' } = {}, now) {
  const c = withOrder(commerce, id, o => {
    if (o.status === 'cancelled') throw Error('The order is cancelled');
    o.fulfillmentStatus = 'fulfilled'; o.updatedAt = isoOf(now);
    o.fulfillments.push({ id: cid('f'), at: isoOf(now), carrier, trackingNumber, trackingUrl, locationId });
    o.timeline.push(event('fulfilled', 'Items fulfilled' + (trackingNumber ? ' · ' + (carrier ? carrier + ' ' : '') + 'tracking ' + trackingNumber : ''), now));
  });
  return { store, commerce: c, order: c.orders.find(o => o.id === id) };
}

/** Refund an amount (capped at what is left). restock: put all quantities back in stock. */
export function refundOrder(store, commerce, id, { amount, restock = false, reason = '' } = {}, now) {
  let c = withOrder(commerce, id, o => {
    if (o.financialStatus !== 'paid' && o.financialStatus !== 'partially_refunded') throw Error('Only paid orders can be refunded');
    const left = C(o.totals.total) - C(refundedAmount(o)), a = Math.min(left, Math.max(0, C(amount == null ? M(left) : amount)));
    if (a <= 0) throw Error('Nothing left to refund');
    o.refunds.push({ id: cid('r'), at: isoOf(now), amount: M(a), restock: !!restock, reason });
    o.financialStatus = a >= left ? 'refunded' : 'partially_refunded'; o.updatedAt = isoOf(now);
    o.timeline.push(event('refunded', 'Refunded ' + M(a).toFixed(2) + (reason ? ' · ' + reason : '') + (restock ? ' · items restocked' : ''), now));
  });
  let s = store;
  if (restock) { const r = restockOrder(s, c, id, now); s = r.store; c = r.commerce; }
  return { store: s, commerce: c, order: c.orders.find(o => o.id === id) };
}

/** Cancel: restocks (default) and refunds whatever was paid. */
export function cancelOrder(store, commerce, id, { restock = true, reason = '' } = {}, now) {
  let c = withOrder(commerce, id, o => {
    if (o.status === 'cancelled') throw Error('Already cancelled');
    if (o.draft) throw Error('Delete the draft instead');
    const left = C(o.totals.total) - C(refundedAmount(o));
    if ((o.financialStatus === 'paid' || o.financialStatus === 'partially_refunded') && left > 0) { o.refunds.push({ id: cid('r'), at: isoOf(now), amount: M(left), restock, reason: 'Order cancelled' }); o.financialStatus = 'refunded'; }
    else if (o.financialStatus === 'pending') o.financialStatus = 'voided';
    o.status = 'cancelled'; o.cancelledAt = isoOf(now); o.cancelReason = reason; o.updatedAt = isoOf(now);
    o.timeline.push(event('cancelled', 'Order cancelled' + (reason ? ' · ' + reason : '') + (restock ? ' · items restocked' : ''), now));
  });
  let s = store;
  if (restock) { const r = restockOrder(s, c, id, now); s = r.store; c = r.commerce; }
  return { store: s, commerce: c, order: c.orders.find(o => o.id === id) };
}

export function setArchived(commerce, id, archived, now) {
  return withOrder(commerce, id, o => {
    if (o.status === 'cancelled') return;
    o.status = archived ? 'archived' : 'open'; o.updatedAt = isoOf(now);
    o.timeline.push(event(archived ? 'archived' : 'reopened', archived ? 'Order archived' : 'Order re-opened', now));
  });
}

export function addTimelineComment(commerce, id, text, now, type = 'comment') {
  return withOrder(commerce, id, o => { o.timeline.push(event(type, String(text), now)); o.updatedAt = isoOf(now); });
}

// ---------- queries ----------
export function orderMatches(o, q, customers) {
  q = String(q || '').trim().toLowerCase(); if (!q) return true;
  const cu = customers?.find(c => c.id === o.customerId);
  return [o.name, o.email, o.phone, o.shippingAddress.name, customerName(cu), ...o.lines.map(l => l.title + ' ' + l.sku), ...o.tags].join(' ').toLowerCase().includes(q);
}
export const ORDER_FILTERS = [['all', 'All'], ['unfulfilled', 'Unfulfilled'], ['unpaid', 'Unpaid'], ['open', 'Open'], ['archived', 'Archived'], ['drafts', 'Drafts']];
export function filterOrders(orders, filter) {
  switch (filter) {
    case 'unfulfilled': return orders.filter(o => !o.draft && o.status === 'open' && o.fulfillmentStatus === 'unfulfilled');
    case 'unpaid': return orders.filter(o => !o.draft && o.status !== 'cancelled' && o.financialStatus === 'pending');
    case 'open': return orders.filter(o => !o.draft && o.status === 'open');
    case 'archived': return orders.filter(o => !o.draft && o.status === 'archived');
    case 'drafts': return orders.filter(o => o.draft);
    default: return orders.filter(o => !o.draft);
  }
}

// ---------- customers linkage ----------
/** Find a customer by email (case-insensitive) or create one; returns { commerce, customer }. */
export function ensureCustomer(commerce, { email, firstName = '', lastName = '', phone = '', address = null, acceptsMarketing = false }, now) {
  const e = String(email || '').trim().toLowerCase();
  const found = e && commerce.customers.find(c => c.email === e);
  if (found) return { commerce, customer: found };
  if (!e && !firstName && !lastName && !phone) return { commerce, customer: null };
  const c = clone(commerce), cu = normalizeCustomer({ email: e, firstName, lastName, phone, address, acceptsMarketing, createdAt: isoOf(now) });
  c.customers.push(cu);
  return { commerce: c, customer: cu };
}

/** Orders, total spent (net of refunds, excluding cancelled/drafts) and last order of a customer. */
export function customerStats(commerce, customerId) {
  const orders = customerId ? commerce.orders.filter(o => o.customerId === customerId && !o.draft) : [];
  const live = orders.filter(o => o.status !== 'cancelled');
  const spent = live.filter(o => o.financialStatus !== 'pending' && o.financialStatus !== 'voided').reduce((s, o) => s + C(netTotal(o)), 0);
  const last = orders.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] || null;
  return { orders, count: live.length, totalSpent: M(spent), lastOrder: last };
}

// ---------- imports from a backend / the preview tracker ----------
/**
 * Import order payloads collected by a backend (see BACKEND CONTRACT in model.js). Unknown products are kept as custom
 * lines (title/price as sent). Returns { store, commerce, imported, errors }.
 */
export function importOrderPayloads(store, commerce, payloads, now) {
  let s = store, c = commerce, imported = 0; const errors = [];
  (Array.isArray(payloads) ? payloads : [payloads]).forEach((p, i) => {
    if (!p || typeof p !== 'object' || !Array.isArray(p.lines) || !p.lines.length) { errors.push(`Entry ${i + 1}: no lines`); return; }
    const cust = p.customer || {}, [firstName, ...rest] = String(cust.name || '').trim().split(/\s+/);
    const ec = ensureCustomer(c, { email: cust.email, firstName: firstName || '', lastName: rest.join(' '), phone: cust.phone }, now); c = ec.commerce;
    const lines = p.lines.map(l => {
      const snap = lineFor(s, l.productId, l.variantId, l.quantity);
      return snap ? { ...snap, price: l.price != null && isFinite(+l.price) ? +l.price : snap.price } : { id: cid('l'), productId: String(l.productId || ''), variantId: String(l.variantId || ''), title: String(l.title || 'Item'), variantTitle: '', sku: String(l.sku || ''), price: +l.price || 0, quantity: Math.max(1, Math.round(+l.quantity || 1)), image: '' };
    });
    const addr = typeof cust.address === 'object' && cust.address ? cust.address : { address1: String(cust.address || ''), name: cust.name || '' };
    const r = createOrder(s, c, { lines, customerId: ec.customer?.id || null, email: cust.email, phone: cust.phone, shippingAddress: addr, note: p.note || '', source: 'import', codes: p.codes || [] }, p.createdAt || now);
    s = r.store; c = r.commerce; imported++;
  });
  return { store: s, commerce: c, imported, errors };
}

// ---------- documents ----------
export function orderVars(store, commerce, o, extra = {}) {
  const cu = commerce.customers.find(c => c.id === o.customerId), cur = store.currency, f = n => formatMoney(n, cur);
  const ful = o.fulfillments[o.fulfillments.length - 1] || {}, pm = commerce.settings.payments.manualMethods.find(m => m.name === o.paymentMethod);
  return {
    shop_name: store.name, shop_email: commerce.settings.general.email || store.contact.email, customer_name: customerName(cu) || o.shippingAddress.name || 'there',
    order_name: o.name, order_total: f(o.totals.total), order_date: new Date(o.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    order_lines: o.lines.map(l => `${l.quantity} × ${l.title}${l.variantTitle ? ' (' + l.variantTitle + ')' : ''} — ${f(l.price * l.quantity)}`).join('\n'),
    tracking_number: ful.trackingNumber || '', tracking_url: ful.trackingUrl || '', carrier: ful.carrier || 'our carrier',
    refund_amount: f(o.refunds.length ? o.refunds[o.refunds.length - 1].amount : 0), payment_instructions: pm ? pm.instructions : '', ...extra,
  };
}

/** { to, subject, body, mailto } for a notification template key and an order. */
export function orderEmail(store, commerce, o, key) {
  const t = commerce.settings.notifications.templates[key], vars = orderVars(store, commerce, o);
  const subject = fillTemplate(t.subject, vars), body = fillTemplate(t.body, vars), cu = commerce.customers.find(c => c.id === o.customerId), to = o.email || cu?.email || '';
  return { to, subject, body, mailto: 'mailto:' + encodeURIComponent(to) + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body) };
}

/** Printable HTML: kind 'invoice' (prices and totals) or 'packing' (quantities, no prices). */
export function orderDocumentHtml(store, commerce, o, kind = 'invoice') {
  const f = n => esc(formatMoney(n, store.currency)), g = commerce.settings.general, loc = commerce.settings.locations.find(l => l.isDefault);
  const invoice = kind === 'invoice', title = invoice ? 'Invoice' : 'Packing slip';
  const rows = o.lines.map(l => `<tr><td>${esc(l.title)}${l.variantTitle ? `<small>${esc(l.variantTitle)}</small>` : ''}${l.sku ? `<small>SKU ${esc(l.sku)}</small>` : ''}</td><td class="n">${l.quantity}</td>${invoice ? `<td class="n">${f(l.price)}</td><td class="n">${f(l.price * l.quantity)}</td>` : ''}</tr>`).join('');
  const t = o.totals;
  const totals = invoice ? `<table class="tot"><tr><td>Subtotal</td><td>${f(t.subtotal)}</td></tr>${t.discountTotal ? `<tr><td>Discount${o.codes.length ? ' (' + esc(o.codes.join(', ')) + ')' : ''}</td><td>−${f(t.discountTotal)}</td></tr>` : ''}
<tr><td>Shipping${o.shippingName ? ' (' + esc(o.shippingName) + ')' : ''}</td><td>${f(t.shipping)}</td></tr><tr><td>${t.taxInclusive ? 'Including tax' : 'Tax'}</td><td>${f(t.tax)}</td></tr>
<tr class="grand"><td>Total</td><td>${f(t.total)}</td></tr>${o.refunds.length ? `<tr><td>Refunded</td><td>−${f(refundedAmount(o))}</td></tr>` : ''}</table>` : '';
  const from = [g.legalName || store.name, g.address || loc?.address || store.contact.address, g.email || store.contact.email].filter(Boolean).map(esc).join('<br>');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title} ${esc(o.name)} – ${esc(store.name)}</title><style>
body{font:14px/1.5 -apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#111;margin:40px auto;max-width:760px;padding:0 24px}
h1{font-size:26px;margin:0}header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #111;padding-bottom:16px;margin-bottom:20px}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:24px}.cols h2{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#666;margin:0 0 4px}
table{width:100%;border-collapse:collapse}th{text-align:left;font-size:12px;color:#666;border-bottom:1px solid #ccc;padding:6px 0}td{padding:8px 0;border-bottom:1px solid #eee;vertical-align:top}
td small{display:block;color:#666}.n{text-align:right}.tot{width:300px;margin:16px 0 0 auto}.tot td{border:0;padding:3px 0}.tot td:last-child{text-align:right}.grand td{font-weight:700;border-top:2px solid #111;padding-top:8px}
footer{margin-top:40px;color:#666;font-size:12px}@media print{body{margin:0}button{display:none}}</style></head><body>
<header><div><h1>${title}</h1><div>${esc(o.name)} · ${esc(new Date(o.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }))}</div></div><div style="text-align:right"><strong>${esc(store.name)}</strong><br>${from}</div></header>
<div class="cols"><div><h2>Ship to</h2>${esc(formatAddress(o.shippingAddress) || '—').replace(/\n/g, '<br>')}</div><div><h2>Contact</h2>${esc(o.email || '—')}${o.phone ? '<br>' + esc(o.phone) : ''}${invoice ? `<h2 style="margin-top:12px">Payment</h2>${esc({ pending: 'Pending', paid: 'Paid', partially_refunded: 'Partially refunded', refunded: 'Refunded', voided: 'Voided' }[o.financialStatus])}${o.paymentMethod ? ' · ' + esc(o.paymentMethod) : ''}` : ''}</div></div>
<table><thead><tr><th>Item</th><th class="n">Qty</th>${invoice ? '<th class="n">Price</th><th class="n">Total</th>' : ''}</tr></thead><tbody>${rows}</tbody></table>${totals}
${o.note ? `<p><strong>Note:</strong> ${esc(o.note)}</p>` : ''}<footer>${invoice ? 'Thank you for your business.' : 'Thank you for shopping with ' + esc(store.name) + '.'}</footer>
<script>window.addEventListener('load',function(){setTimeout(function(){window.print()},250)})</script></body></html>`;
}

export { countryName };
