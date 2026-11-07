// Backend rows → admin documents (pure). Used by a "Sync orders from backend" action in the admin:
//
//   const rows = await be.fetchOrders(store.id, { since: lastSync });
//   const { bookings, projects } = await be.fetchServiceRecords(store.id, { since: lastSync });
//   commerce = mergeBackend(commerce, backendToCommerce(rows, bookings, projects, store));
//
// Orders keep the backend id prefixed 'sb_' (stable → re-syncing updates instead of duplicating). Shapes follow
// src/store/admin/model.js (Order) and src/store/admin/services.js (bookings, serviceProjects); the admin's normalizers
// fill every other field.

const n = v => Math.round((+v || 0) * 100) / 100;
const addr = a => (a && typeof a === 'object' ? { name: a.name || '', company: a.company || '', address1: a.address1 || '', address2: a.address2 || '', city: a.city || '', province: a.province || '', zip: a.zip || '', country: a.country || '', phone: a.phone || '' } : null);

export function orderFromRow(o) {
  const lines = (o.order_lines || []).slice().sort((a, b) => (a.position || 0) - (b.position || 0));
  const refunds = (o.refunds || []).filter(r => r.status === 'succeeded');
  return {
    id: 'sb_' + o.id, number: o.number, name: '#' + o.number, draft: false, source: 'import', createdAt: o.created_at, updatedAt: o.updated_at,
    status: o.status === 'cancelled' ? 'cancelled' : o.status === 'archived' ? 'archived' : 'open',
    financialStatus: ['paid', 'partially_refunded', 'refunded', 'voided'].includes(o.financial_status) ? o.financial_status : 'pending',
    fulfillmentStatus: o.fulfillment_status === 'fulfilled' ? 'fulfilled' : 'unfulfilled',
    customerId: null, email: o.email || '', phone: o.phone || '', shippingAddress: addr(o.shipping_address) || { name: o.name || '', country: o.country || '' },
    lines: lines.map(l => ({ id: 'sbl_' + l.id, productId: l.product_id, variantId: l.variant_id, title: l.title, variantTitle: l.variant_title || '', sku: l.sku || '', price: n(l.unit_price), quantity: l.quantity, image: '' })),
    codes: o.codes || [], shippingRateId: o.shipping_rate_id || null, shippingName: o.shipping_name || '',
    paymentMethod: 'Stripe' + (o.stripe_payment_intent_id ? ' · ' + o.stripe_payment_intent_id : ''), note: o.note || '', tags: ['online'],
    totals: { subtotal: n(o.subtotal), discountTotal: n(o.discount_total), shipping: n(o.shipping), shippingDiscount: n(o.shipping_discount), tax: n(o.tax), taxInclusive: !!o.tax_inclusive, total: n(o.total), applied: o.applied || [] },
    fulfillments: [], refunds: refunds.map(r => ({ id: 'sbr_' + r.id, at: r.created_at, amount: n((+r.amount_minor || 0) / 100), restock: false, reason: r.reason || '' })),
    inventoryApplied: false, cancelledAt: o.cancelled_at || null, cancelReason: '',
    timeline: [{ id: 'sbt_' + o.id, at: o.created_at, type: 'created', message: 'Order placed on the online store' }].concat(o.paid_at ? [{ id: 'sbp_' + o.id, at: o.paid_at, type: 'paid', message: 'Paid with Stripe' }] : []),
  };
}

export function bookingFromRow(b) {
  return { id: 'sb_' + b.id, productId: b.product_id, title: b.title || 'Service', name: b.attendee?.name || '', email: b.attendee?.email || '', start: b.starts_at, end: b.ends_at,
    timezone: b.timezone || 'UTC', status: b.status, intake: b.intake || [], notes: b.notes || '', orderId: b.order_id ? 'sb_' + b.order_id : null, price: n(b.price), createdAt: b.created_at };
}

export function projectFromRow(p) {
  return { id: 'sb_' + p.id, productId: p.product_id, title: p.title || 'Project', name: p.client?.name || '', email: p.client?.email || '', orderId: p.order_id ? 'sb_' + p.order_id : null,
    stage: p.stage, dueDate: p.due_date || '', createdAt: p.created_at, updatedAt: p.updated_at, deliverables: (p.deliverables || []).map(d => ({ label: String(d), done: false })), notes: p.notes || '' };
}

export function backendToCommerce(orderRows = [], bookingRows = [], projectRows = [], store = null) {
  const titles = new Map((store?.products || []).map(p => [p.id, p.title]));
  return {
    orders: orderRows.map(orderFromRow),
    bookings: bookingRows.map(b => ({ ...bookingFromRow(b), title: titles.get(b.product_id) || 'Service' })),
    serviceProjects: projectRows.map(projectFromRow),
  };
}

/** Upsert by id into the commerce document (backend wins for records it owns). Returns a new document. */
export function mergeBackend(commerce, { orders = [], bookings = [], serviceProjects = [] }) {
  const up = (list, add) => { const m = new Map((list || []).map(x => [x.id, x])); for (const x of add) m.set(x.id, { ...(m.get(x.id) || {}), ...x }); return [...m.values()]; };
  return { ...commerce, orders: up(commerce.orders, orders), bookings: up(commerce.bookings, bookings), serviceProjects: up(commerce.serviceProjects, serviceProjects) };
}
