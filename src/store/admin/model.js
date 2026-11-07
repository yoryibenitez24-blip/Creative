// Commerce back-office document for the Zertake commerce app (src/store/admin/CommerceApp.jsx).
//
// The store document (src/store/model.js) holds what the storefront shows (products, collections, theme, pages,
// checkout mode, currency). This second JSON document holds everything the merchant manages behind the counter.
// The host persists it as-is next to the store. All money values are in the store currency's major unit (19.99),
// all dates are ISO 8601 strings, all weights are grams.
//
// {
//   kind: 'commerce', version: 1, storeId,
//   settings: {
//     general:  { legalName, email, phone, address, unitSystem: 'metric'|'imperial', weightUnit: 'g'|'kg'|'lb'|'oz',
//                 orderPrefix: '#', orderSuffix: '', nextOrderNumber: 1001, nextDraftNumber: 1, lowStockThreshold: 5,
//                 businessEntity: 'individual'|'sole_proprietorship'|'llc'|'corporation'|'partnership'|'nonprofit', country: 'US',
//                 timezone: IANA zone, currencyDisplay: 'symbol'|'code'|'symbol_code', backupRegion: 'US',
//                 autoFulfill: 'none'|'digital'|'all', autoArchive: bool },
//     payments: { manualMethods: [{ id, name, instructions, enabled }], providerNotes,
//                 stripe: Stripe Connect settings (public values only; schema + normalizeStripe() in src/store/integrations.js) },
//     integrations: { backend: { provider: 'none'|'supabase', url, anonKey, functionsUrl }, ga4, gtm, metaPixel, tiktokPixel,
//                 pinterestTag, clarity, turnstile, recaptcha, sentry, email, discord, telegram, consent }  (src/store/integrations.js)
//     checkout: { contactMethod: 'email'|'phone_or_email', fullName: 'last_only'|'first_and_last', company|address2|shippingPhone:
//                 'hidden'|'optional'|'required', marketing: { email, sms, preChecked }, tipping: { enabled, presets: [%] },
//                 orderNotes, termsCheckbox, addressAutocomplete, abandoned: { enabled, delayHours, audience: 'all'|'subscribers' },
//                 turnstile: bool (bot check when a Turnstile site key is set) }
//     customerAccounts: { mode: 'disabled'|'optional'|'required', loginMethod: 'code'|'password', selfServeReturns, storeCredit }
//     users:    { owner: { name, email }, staff: [{ id, name, email, role: 'admin'|'staff'|'limited', permissions: string[] }] }
//     markets:  [{ id, name, countries: ISO[], currency: '' (store currency) | 'EUR'…, enabled, primary }]
//     salesChannels: { [online|whatsapp|instagram|facebook|google|tiktok|pinterest]: { enabled, handle } }
//     customerEvents: { forward: bool, events: { [EVENT_TYPE]: bool } }   (which storefront events reach the pixels)
//     metafields: [{ id, owner: 'product'|'variant'|'collection'|'customer'|'order', name, key, type, description }]
//     languages: { primary: 'en', published: ['en'], autoRedirect }
//     privacy:  { dataSaleOptOut, cookieTitle, cookieText }   (the banner itself: integrations.consent)
//     security: { confirmDanger: bool }
//     shipping: { zones: [{ id, name, countries: ['US', 'CA'] | ['*'] (rest of world),
//                          rates: [{ id, name, type: 'flat'|'free_over'|'weight', price, threshold (free_over),
//                                    tiers: [{ upTo: grams, price }] (weight; ascending) }] }] },
//     taxes:    { inclusive: bool (prices include tax), shippingTaxed: bool, rates: [{ id, country, region, name, rate (percent) }] },
//     locations: [{ id, name, address, isDefault }],
//     notifications: { senderName, senderEmail, templates: { [key]: { subject, body } } }   // keys: NOTIFICATION_KEYS
//     domains:  { primary, provider: 'netlify'|'github'|'cloudflare'|'vercel'|'other', notes, connected: bool },
//     policies: { [key]: { title, body, values: { returnDays, ... } } }                       // keys: POLICY_KEYS
//     backend:  { orderWebhookUrl, eventsWebhookUrl, notes }                                   // see BACKEND CONTRACT below
//   },
//   orders:    Order[],
//   customers: [{ id, firstName, lastName, email, phone, company, address: Address, tags: string[], note,
//                 acceptsMarketing: bool, marketingUpdatedAt, createdAt }],
//   discounts: Discount[]                     (schema and math: src/store/admin/discounts.js)
//   inventoryLog: [{ id, at, productId, variantId, delta, stockAfter, reason: 'manual'|'set'|'order'|'restock'|'import', orderId|null, note }]
//   productMeta: { [productId]: { vendor, productType, cost, weight (g), barcode, seoTitle, seoDescription,
//                                 variants: { [variantId]: { cost|null, weight|null, barcode, continueSelling: bool } } } }
//                  (back-office fields the storefront document does not carry; stock itself lives in store.products[].variants[].stock,
//                   null = not tracked)
//   collectionRules: { [collectionId]: { type: 'price', min: number|null, max: number|null } }
//                  (price-automated collections: the store collection is 'manual' and its productIds are re-synced from this rule
//                   by syncPriceCollections() whenever products or collections are saved in the admin)
//   marketing: { campaigns: [{ id, name, channel, status: 'draft'|'active'|'ended', startDate, endDate, budget, notes,
//                              utm: { url, source, medium, campaign, content, term } }] },
//   staffNotes: [{ id, at, author, text }],
//   analytics: { events: [{ id, at, type: 'visit'|'page_view'|'view_product'|'add_to_cart'|'checkout_started'|'order_placed',
//                           sessionId, path, productId, variantId, quantity, value, orderId, source: 'preview'|'manual'|'import',
//                           geo?: { country (ISO alpha-2), city?, lat, lon } (approximate, from the visitor's time zone; see geo.js) }] }
//   onboarding: { dismissed: bool, steps: { product, theme, shipping, payments, domain, launch: bool } }   (Home checklist)
// }
//
// Order = { id, number, name ('#1001' | 'D3' for drafts), draft: bool, source: 'manual'|'preview'|'import',
//   createdAt, updatedAt, status: 'open'|'archived'|'cancelled', financialStatus: 'pending'|'paid'|'partially_refunded'|'refunded'|'voided',
//   fulfillmentStatus: 'unfulfilled'|'fulfilled', customerId|null, email, phone, shippingAddress: Address,
//   lines: [{ id, productId, variantId, title, variantTitle, sku, price, quantity, image }],
//   codes: string[], shippingRateId|null, shippingName, paymentMethod, note, tags: string[],
//   totals: { subtotal, discountTotal, shipping, shippingDiscount, tax, taxInclusive, total, applied: [{ id, title, code, type, amount }] },
//   fulfillments: [{ id, at, carrier, trackingNumber, trackingUrl, locationId }], refunds: [{ id, at, amount, restock, reason }],
//   inventoryApplied: bool (stock was decremented for this order), cancelledAt|null, cancelReason,
//   timeline: [{ id, at, type: 'created'|'paid'|'fulfilled'|'refunded'|'cancelled'|'archived'|'reopened'|'comment'|'email', message }] }
// Address = { name, company, address1, address2, city, province, zip, country (ISO 3166 alpha-2), phone }
//
// BACKEND CONTRACT (a static store cannot write back to this document without a server):
//   settings.backend.orderWebhookUrl — when set, a storefront may POST `application/json` to it on checkout:
//     { type: 'order', storeId, createdAt, currency: 'USD', customer: { name, email, phone, address },
//       lines: [{ productId, variantId, title, sku, price, quantity }], subtotal, note }
//   settings.backend.eventsWebhookUrl — optional analytics events, POSTed as { type: 'event', storeId, event: AnalyticsEvent }.
//   The collected order payloads (a JSON array of the objects above) can be imported back in Orders › Import (importOrderPayloads()).

import { normalizeGeo } from './geo.js';
import { withServiceData } from './services.js';
import { normalizeStripe, normalizeIntegrations } from '../integrations.js';

export const COMMERCE_VERSION = 1;
export const ONBOARDING_STEPS = ['product', 'theme', 'shipping', 'payments', 'domain', 'launch'];
export const NOTIFICATION_KEYS = ['order_confirmation', 'shipping_confirmation', 'order_cancelled', 'refund_notification', 'payment_reminder'];
export const NOTIFICATION_LABELS = { order_confirmation: 'Order confirmation', shipping_confirmation: 'Shipping confirmation', order_cancelled: 'Order cancelled', refund_notification: 'Refund notification', payment_reminder: 'Payment reminder' };
export const POLICY_KEYS = ['refund', 'privacy', 'terms', 'shipping'];
export const NOTIFICATION_VARIABLES = ['shop_name', 'customer_name', 'order_name', 'order_total', 'order_lines', 'order_date', 'tracking_number', 'tracking_url', 'carrier', 'refund_amount', 'shop_email', 'payment_instructions'];
export const WEIGHT_UNITS = { g: 1, kg: 1000, lb: 453.59237, oz: 28.349523125 };
export const COUNTRIES = [['US', 'United States'], ['CA', 'Canada'], ['GB', 'United Kingdom'], ['IE', 'Ireland'], ['AU', 'Australia'], ['NZ', 'New Zealand'], ['DE', 'Germany'], ['FR', 'France'], ['ES', 'Spain'], ['IT', 'Italy'], ['NL', 'Netherlands'], ['BE', 'Belgium'], ['PT', 'Portugal'], ['AT', 'Austria'], ['CH', 'Switzerland'], ['SE', 'Sweden'], ['NO', 'Norway'], ['DK', 'Denmark'], ['FI', 'Finland'], ['PL', 'Poland'], ['JP', 'Japan'], ['SG', 'Singapore'], ['IN', 'India'], ['AE', 'United Arab Emirates'], ['ZA', 'South Africa'], ['BR', 'Brazil'], ['MX', 'Mexico'], ['AR', 'Argentina'], ['CO', 'Colombia'], ['CL', 'Chile']];
export const countryName = code => code === '*' ? 'Rest of world' : (COUNTRIES.find(c => c[0] === code) || [, code])[1];

let counter = 0;
export const cid = (p = 'x') => p + '_' + Date.now().toString(36).slice(-5) + (counter++).toString(36) + Math.random().toString(36).slice(2, 6);
const clone = o => JSON.parse(JSON.stringify(o));
const str = (v, d = '') => v == null ? d : String(v);
const num = (v, d, lo = -Infinity, hi = Infinity) => { const n = typeof v === 'string' && v.trim() === '' ? NaN : +v; return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const money = (v, d = 0) => Math.round(num(v, d, 0) * 100) / 100;
const pick = (v, list, d) => list.includes(v) ? v : d;
const bool = (v, d = false) => v == null ? d : !!v;
const arr = v => Array.isArray(v) ? v : [];
const iso = (v, d = null) => { if (v == null || v === '') return d; const t = new Date(v).getTime(); return Number.isFinite(t) ? new Date(t).toISOString() : d; };
const tags = v => [...new Set((Array.isArray(v) ? v : str(v).split(/[;,]/)).map(t => str(t).trim()).filter(Boolean))];

export const normalizeAddress = a => {
  a = a && typeof a === 'object' ? a : {};
  const o = {}; for (const k of ['name', 'company', 'address1', 'address2', 'city', 'province', 'zip', 'phone']) o[k] = str(a[k]).trim();
  o.country = /^[A-Z]{2}$/.test(str(a.country).trim().toUpperCase()) ? str(a.country).trim().toUpperCase() : '';
  return o;
};
export const formatAddress = a => !a ? '' : [a.name, a.company, a.address1, a.address2, [a.zip, a.city].filter(Boolean).join(' '), a.province, a.country ? countryName(a.country) : ''].filter(Boolean).join('\n');

// ---------- templates ----------
export const DEFAULT_NOTIFICATIONS = {
  order_confirmation: { subject: 'Order {{order_name}} confirmed', body: 'Hi {{customer_name}},\n\nThank you for your order! We are getting it ready.\n\n{{order_lines}}\n\nTotal: {{order_total}}\n\n{{payment_instructions}}\n\nQuestions? Reply to this email or write to {{shop_email}}.\n\n{{shop_name}}' },
  shipping_confirmation: { subject: 'Your order {{order_name}} is on its way', body: 'Hi {{customer_name}},\n\nGood news: your order {{order_name}} has shipped with {{carrier}}.\n\nTracking number: {{tracking_number}}\n{{tracking_url}}\n\n{{shop_name}}' },
  order_cancelled: { subject: 'Order {{order_name}} has been cancelled', body: 'Hi {{customer_name}},\n\nYour order {{order_name}} placed on {{order_date}} has been cancelled. If you already paid, a refund is on its way.\n\n{{shop_name}}' },
  refund_notification: { subject: 'Refund for order {{order_name}}', body: 'Hi {{customer_name}},\n\nWe have refunded {{refund_amount}} for your order {{order_name}}. Depending on your bank it can take a few days to appear.\n\n{{shop_name}}' },
  payment_reminder: { subject: 'Payment reminder for order {{order_name}}', body: 'Hi {{customer_name}},\n\nA friendly reminder that order {{order_name}} ({{order_total}}) is still waiting for payment.\n\n{{payment_instructions}}\n\n{{shop_name}}' },
};

/** Policy templates: {{placeholders}} are filled from the policy `values`, the store and the general settings. */
export const POLICY_TEMPLATES = {
  refund: { title: 'Refund policy', fields: [['returnDays', 'Return window (days)', '30'], ['condition', 'Item condition', 'unused, unworn and in the original packaging'], ['refundMethod', 'Refund method', 'the original payment method'], ['returnShipping', 'Who pays return shipping', 'the customer']],
    body: 'REFUND POLICY\n\nWe have a {{returnDays}}-day return policy: you can ask for a return up to {{returnDays}} days after receiving your item.\n\nTo be eligible, items must be {{condition}}, together with the receipt or proof of purchase.\n\nTo start a return, contact us at {{email}}. Items sent back without first requesting a return will not be accepted.\n\nDamaged or wrong items: please inspect your order on arrival and contact us immediately if the item is defective, damaged or not what you ordered.\n\nExceptions: perishable goods, custom products, personal-care goods and sale items cannot be returned.\n\nRefunds: once we receive and inspect your return we will notify you. If approved, the refund goes to {{refundMethod}} within 10 business days. Return shipping costs are paid by {{returnShipping}}.\n\n{{legalName}}\n{{address}}' },
  privacy: { title: 'Privacy policy', fields: [['dataUses', 'What you use customer data for', 'processing orders, delivering products and answering questions'], ['retention', 'How long you keep data', 'as long as needed for orders, accounting and legal obligations'], ['thirdParties', 'Third parties you share data with', 'payment providers and delivery carriers']],
    body: 'PRIVACY POLICY\n\nThis policy describes how {{storeName}} ("we") collects, uses and shares your personal information when you visit or buy from our store.\n\nInformation we collect: the details you give us at checkout (name, email, phone, delivery address) and the contents of your order.\n\nHow we use it: {{dataUses}}.\n\nSharing: we share the minimum necessary with {{thirdParties}}. We never sell your personal information.\n\nRetention: we keep your information {{retention}}.\n\nYour rights: you can ask us to access, correct or delete your personal information at any time by writing to {{email}}.\n\nContact: {{legalName}}, {{address}}, {{email}}.' },
  terms: { title: 'Terms of service', fields: [['governingLaw', 'Governing law (country / state)', 'the country where we are registered'], ['minAge', 'Minimum customer age', '18']],
    body: 'TERMS OF SERVICE\n\nThis website is operated by {{legalName}}. By visiting our store or buying from us you agree to these terms.\n\nYou must be at least {{minAge}} years old, or have the permission of a guardian, to place an order.\n\nPrices and availability can change without notice. We may refuse or cancel any order, for example when a product is out of stock or a price is shown in error; if you already paid we refund you in full.\n\nProduct images are as accurate as possible, but colours can vary between screens.\n\nThese terms are governed by the laws of {{governingLaw}}.\n\nQuestions about these terms: {{email}}.' },
  shipping: { title: 'Shipping policy', fields: [['processingDays', 'Processing time (business days)', '1–3'], ['deliveryTime', 'Typical delivery time', '3–7 business days'], ['regions', 'Where you ship', 'domestic and selected international destinations']],
    body: 'SHIPPING POLICY\n\nOrders are processed within {{processingDays}} business days. You receive a confirmation with a tracking number once your order ships.\n\nWe ship to {{regions}}. Typical delivery time is {{deliveryTime}}.\n\nShipping rates are calculated at checkout from your address and the weight of your order.\n\nInternational orders may be subject to import duties and taxes, which are the responsibility of the customer.\n\nQuestions about your delivery? Write to {{email}}.' },
};

/** Replace {{key}} placeholders. Unknown keys become ''. */
export function fillTemplate(text, vars) { return str(text).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] == null ? '' : String(vars[k])); }

export function policyText(key, policy, store, commerce) {
  const t = POLICY_TEMPLATES[key]; if (!t) return '';
  const g = commerce?.settings?.general || {};
  const vars = { storeName: store?.name || 'Our store', email: g.email || store?.contact?.email || '[your email]', legalName: g.legalName || store?.name || '[legal name]', address: g.address || store?.contact?.address || '[business address]' };
  for (const [k, , d] of t.fields) vars[k] = (policy?.values?.[k] ?? '') !== '' ? policy.values[k] : d;
  return fillTemplate(t.body, vars);
}

// ---------- normalisation ----------
export function normalizeDiscountDoc(d) {
  const t = pick(d.type, ['percentage', 'fixed', 'free_shipping', 'bxgy'], 'percentage');
  return {
    id: str(d.id) || cid('d'), title: str(d.title).trim(), method: pick(d.method, ['code', 'automatic'], 'code'),
    code: str(d.code).trim().toUpperCase().replace(/\s+/g, ''), type: t,
    value: t === 'percentage' ? num(d.value, 10, 0, 100) : money(d.value, 0),
    appliesTo: { kind: pick(d.appliesTo?.kind, ['all', 'products', 'collections'], 'all'), productIds: arr(d.appliesTo?.productIds).map(String), collectionIds: arr(d.appliesTo?.collectionIds).map(String) },
    minimum: { kind: pick(d.minimum?.kind, ['none', 'amount', 'quantity'], 'none'), value: num(d.minimum?.value, 0, 0) },
    bxgy: { buyQuantity: Math.max(1, Math.round(num(d.bxgy?.buyQuantity, 1, 1))), getQuantity: Math.max(1, Math.round(num(d.bxgy?.getQuantity, 1, 1))),
      getProductIds: arr(d.bxgy?.getProductIds).map(String), getPercent: num(d.bxgy?.getPercent, 100, 0, 100), maxUses: d.bxgy?.maxUses == null || d.bxgy.maxUses === '' ? null : Math.max(1, Math.round(num(d.bxgy.maxUses, 1, 1))) },
    usageLimit: d.usageLimit == null || d.usageLimit === '' ? null : Math.max(0, Math.round(num(d.usageLimit, 0, 0))), usageCount: Math.max(0, Math.round(num(d.usageCount, 0, 0))),
    oncePerCustomer: bool(d.oncePerCustomer), combinable: bool(d.combinable), enabled: bool(d.enabled, true),
    startsAt: iso(d.startsAt, null), endsAt: iso(d.endsAt, null), createdAt: iso(d.createdAt, new Date().toISOString()),
  };
}

const normLine = l => ({ id: str(l.id) || cid('l'), productId: str(l.productId), variantId: str(l.variantId), title: str(l.title, 'Item'), variantTitle: str(l.variantTitle), sku: str(l.sku), price: money(l.price), quantity: Math.max(1, Math.round(num(l.quantity, 1, 1))), image: typeof l.image === 'string' ? l.image : '' });

export function normalizeOrder(o) {
  const t = o.totals || {};
  return {
    id: str(o.id) || cid('o'), number: Math.round(num(o.number, 0, 0)), name: str(o.name) || '#' + Math.round(num(o.number, 0, 0)), draft: bool(o.draft), source: pick(o.source, ['manual', 'preview', 'import'], 'manual'),
    createdAt: iso(o.createdAt, new Date().toISOString()), updatedAt: iso(o.updatedAt, iso(o.createdAt, new Date().toISOString())),
    status: pick(o.status, ['open', 'archived', 'cancelled'], 'open'), financialStatus: pick(o.financialStatus, ['pending', 'paid', 'partially_refunded', 'refunded', 'voided'], 'pending'),
    fulfillmentStatus: pick(o.fulfillmentStatus, ['unfulfilled', 'fulfilled'], 'unfulfilled'), customerId: o.customerId ? str(o.customerId) : null,
    email: str(o.email).trim(), phone: str(o.phone).trim(), shippingAddress: normalizeAddress(o.shippingAddress),
    lines: arr(o.lines).map(normLine), codes: arr(o.codes).map(c => str(c).toUpperCase()), shippingRateId: o.shippingRateId ? str(o.shippingRateId) : null, shippingName: str(o.shippingName),
    paymentMethod: str(o.paymentMethod), note: str(o.note), tags: tags(o.tags),
    totals: { subtotal: money(t.subtotal), discountTotal: money(t.discountTotal), shipping: money(t.shipping), shippingDiscount: money(t.shippingDiscount), tax: money(t.tax), taxInclusive: bool(t.taxInclusive), total: money(t.total),
      applied: arr(t.applied).map(a => ({ id: str(a.id), title: str(a.title), code: str(a.code), type: str(a.type), amount: money(a.amount) })) },
    fulfillments: arr(o.fulfillments).map(f => ({ id: str(f.id) || cid('f'), at: iso(f.at, new Date().toISOString()), carrier: str(f.carrier), trackingNumber: str(f.trackingNumber), trackingUrl: str(f.trackingUrl), locationId: str(f.locationId) })),
    refunds: arr(o.refunds).map(r => ({ id: str(r.id) || cid('r'), at: iso(r.at, new Date().toISOString()), amount: money(r.amount), restock: bool(r.restock), reason: str(r.reason) })),
    inventoryApplied: bool(o.inventoryApplied), cancelledAt: iso(o.cancelledAt, null), cancelReason: str(o.cancelReason),
    timeline: arr(o.timeline).map(e => ({ id: str(e.id) || cid('t'), at: iso(e.at, new Date().toISOString()), type: str(e.type, 'comment'), message: str(e.message) })),
  };
}

export function normalizeCustomer(c) {
  return {
    id: str(c.id) || cid('cu'), firstName: str(c.firstName).trim(), lastName: str(c.lastName).trim(), email: str(c.email).trim().toLowerCase(), phone: str(c.phone).trim(),
    company: str(c.company).trim(), address: normalizeAddress(c.address), tags: tags(c.tags), note: str(c.note), acceptsMarketing: bool(c.acceptsMarketing),
    marketingUpdatedAt: iso(c.marketingUpdatedAt, null), createdAt: iso(c.createdAt, new Date().toISOString()),
  };
}
export const customerName = c => !c ? '' : [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || c.phone || 'Unnamed customer';

const normRate = r => {
  const type = pick(r.type, ['flat', 'free_over', 'weight'], 'flat');
  return { id: str(r.id) || cid('sr'), name: str(r.name, 'Standard').trim() || 'Standard', type, price: money(r.price), threshold: money(r.threshold),
    tiers: arr(r.tiers).map(t => ({ upTo: Math.max(0, Math.round(num(t.upTo, 0, 0))), price: money(t.price) })).sort((a, b) => a.upTo - b.upTo) };
};

export const EVENT_TYPES = ['visit', 'page_view', 'view_product', 'add_to_cart', 'checkout_started', 'order_placed'];
export const MAX_EVENTS = 5000;
export function normalizeEvent(e) {
  return { id: str(e.id) || cid('e'), at: iso(e.at, new Date().toISOString()), type: pick(e.type, EVENT_TYPES, 'page_view'), sessionId: str(e.sessionId), path: str(e.path),
    productId: str(e.productId), variantId: str(e.variantId), quantity: Math.max(0, Math.round(num(e.quantity, 0, 0))), value: money(e.value), orderId: str(e.orderId), source: pick(e.source, ['preview', 'manual', 'import'], 'preview'),
    ...(e.geo && normalizeGeo(e.geo) ? { geo: normalizeGeo(e.geo) } : {}) };
}

/** Default back-office document for a store (one shipping zone, empty lists, policy and email templates). */
export function createCommerce(store) {
  return normalizeCommerce({
    storeId: store?.id || '',
    settings: {
      general: { email: store?.contact?.email || '', phone: store?.contact?.phone || '', address: store?.contact?.address || '', legalName: store?.name || '', timezone: localZone() },
      payments: { stripe: { currency: String(store?.currency?.code || 'usd').toLowerCase() } },
      shipping: { zones: [
        { name: 'Domestic', countries: ['US'], rates: [{ name: 'Standard', type: 'free_over', price: 5.99, threshold: 75 }, { name: 'Express', type: 'flat', price: 14.99 }] },
        { name: 'Rest of world', countries: ['*'], rates: [{ name: 'International', type: 'weight', tiers: [{ upTo: 1000, price: 14 }, { upTo: 5000, price: 29 }, { upTo: 20000, price: 59 }] }] },
      ] },
      locations: [{ name: 'Main warehouse', address: store?.contact?.address || '', isDefault: true }],
    },
  });
}

// ---------- settings (Settings › General, Checkout, Customer accounts, Users, Markets, …) ----------
export const BUSINESS_ENTITIES = [['individual', 'Individual'], ['sole_proprietorship', 'Sole proprietorship'], ['llc', 'Limited liability company (LLC)'], ['corporation', 'Corporation'], ['partnership', 'Partnership'], ['nonprofit', 'Non-profit']];
export const FIELD_MODES = [['required', 'Required'], ['optional', 'Optional'], ['hidden', 'Don’t include']];
export const STAFF_ROLES = [['admin', 'Administrator'], ['staff', 'Staff'], ['limited', 'Limited (orders only)']];
export const STAFF_PERMISSIONS = [['orders', 'Orders'], ['products', 'Products'], ['customers', 'Customers'], ['discounts', 'Discounts'], ['analytics', 'Analytics'], ['marketing', 'Marketing'], ['online_store', 'Online Store'], ['settings', 'Settings']];
export const SALES_CHANNELS = [['online', 'Online Store', 'Your exported static site'], ['whatsapp', 'WhatsApp', 'Share products and take orders in chats'], ['instagram', 'Instagram', 'Link products from posts and your bio'], ['facebook', 'Facebook', 'Shop tab on your Facebook page'], ['google', 'Google', 'Free listings through Merchant Center'], ['tiktok', 'TikTok', 'Product links in videos and your profile'], ['pinterest', 'Pinterest', 'Rich pins for your product pages']];
export const METAFIELD_OWNERS = [['product', 'Products'], ['variant', 'Variants'], ['collection', 'Collections'], ['customer', 'Customers'], ['order', 'Orders']];
export const METAFIELD_TYPES = [['single_line_text', 'Single line text'], ['multi_line_text', 'Multi-line text'], ['number_integer', 'Integer'], ['number_decimal', 'Decimal'], ['boolean', 'True or false'], ['date', 'Date'], ['url', 'URL'], ['color', 'Color'], ['json', 'JSON']];
export const LANGUAGES = [['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'], ['pt', 'Portuguese'], ['nl', 'Dutch'], ['sv', 'Swedish'], ['da', 'Danish'], ['pl', 'Polish'], ['ja', 'Japanese'], ['zh', 'Chinese'], ['ko', 'Korean'], ['ar', 'Arabic'], ['hi', 'Hindi']];
const localZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };
const iso2 = (v, d) => /^[A-Z]{2}$/.test(str(v).trim().toUpperCase()) ? str(v).trim().toUpperCase() : d;
const generalExtra = g => ({
  orderSuffix: str(g.orderSuffix).slice(0, 6), businessEntity: pick(g.businessEntity, BUSINESS_ENTITIES.map(b => b[0]), 'individual'), country: iso2(g.country, 'US'),
  timezone: /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(str(g.timezone)) ? str(g.timezone) : 'UTC', currencyDisplay: pick(g.currencyDisplay, ['symbol', 'code', 'symbol_code'], 'symbol'),
  backupRegion: iso2(g.backupRegion, iso2(g.country, 'US')), autoFulfill: pick(g.autoFulfill, ['none', 'digital', 'all'], 'none'), autoArchive: bool(g.autoArchive),
});
function settingsExtra(st) {
  const ck = st.checkout || {}, mode = v => pick(v, ['required', 'optional', 'hidden'], 'optional'), ca = st.customerAccounts || {}, u = st.users || {}, lang = st.languages || {}, pv = st.privacy || {}, ce = st.customerEvents || {};
  const markets = arr(st.markets).map(m => ({ id: str(m.id) || cid('mkt'), name: str(m.name, 'Market').trim() || 'Market', countries: [...new Set(arr(m.countries).map(c => str(c).trim().toUpperCase()).filter(c => c === '*' || /^[A-Z]{2}$/.test(c)))],
    currency: /^[A-Z]{3}$/.test(str(m.currency)) ? str(m.currency) : '', enabled: bool(m.enabled, true), primary: bool(m.primary) }));
  if (markets.length && !markets.some(m => m.primary)) markets[0].primary = true;
  let prim = false; for (const m of markets) { if (m.primary && prim) m.primary = false; if (m.primary) { prim = true; m.enabled = true; } }
  const codes = LANGUAGES.map(l => l[0]), primary = pick(lang.primary, codes, 'en');
  return {
    checkout: {
      contactMethod: pick(ck.contactMethod, ['email', 'phone_or_email'], 'email'), fullName: pick(ck.fullName, ['last_only', 'first_and_last'], 'first_and_last'),
      company: pick(ck.company, ['required', 'optional', 'hidden'], 'hidden'), address2: mode(ck.address2), shippingPhone: mode(ck.shippingPhone),
      marketing: { email: bool(ck.marketing?.email, true), sms: bool(ck.marketing?.sms), preChecked: bool(ck.marketing?.preChecked) },
      tipping: { enabled: bool(ck.tipping?.enabled), presets: (arr(ck.tipping?.presets).length ? arr(ck.tipping.presets) : [10, 15, 20]).slice(0, 3).map(p => Math.round(num(p, 10, 0, 100))) },
      orderNotes: bool(ck.orderNotes, true), termsCheckbox: bool(ck.termsCheckbox), addressAutocomplete: bool(ck.addressAutocomplete, true),
      abandoned: { enabled: bool(ck.abandoned?.enabled), delayHours: pick(+ck.abandoned?.delayHours, [1, 6, 10, 24], 10), audience: pick(ck.abandoned?.audience, ['all', 'subscribers'], 'all') },
      turnstile: bool(ck.turnstile, true),
    },
    customerAccounts: { mode: pick(ca.mode, ['disabled', 'optional', 'required'], 'disabled'), loginMethod: pick(ca.loginMethod, ['code', 'password'], 'code'), selfServeReturns: bool(ca.selfServeReturns), storeCredit: bool(ca.storeCredit) },
    users: { owner: { name: str(u.owner?.name), email: str(u.owner?.email).trim() },
      staff: arr(u.staff).map(m => ({ id: str(m.id) || cid('st'), name: str(m.name).trim(), email: str(m.email).trim().toLowerCase(), role: pick(m.role, STAFF_ROLES.map(r => r[0]), 'staff'),
        permissions: [...new Set(arr(m.permissions).map(String).filter(p => STAFF_PERMISSIONS.some(x => x[0] === p)))] })).filter(m => m.email || m.name) },
    markets,
    salesChannels: Object.fromEntries(SALES_CHANNELS.map(([k]) => [k, { enabled: bool(st.salesChannels?.[k]?.enabled, k === 'online'), handle: str(st.salesChannels?.[k]?.handle).trim() }])),
    customerEvents: { forward: bool(ce.forward, true), events: Object.fromEntries(EVENT_TYPES.map(k => [k, bool(ce.events?.[k], true)])) },
    metafields: arr(st.metafields).map(m => ({ id: str(m.id) || cid('mf'), owner: pick(m.owner, METAFIELD_OWNERS.map(o => o[0]), 'product'), name: str(m.name).trim(),
      key: str(m.key).trim().toLowerCase().replace(/[^a-z0-9_.]+/g, '_').slice(0, 64), type: pick(m.type, METAFIELD_TYPES.map(t => t[0]), 'single_line_text'), description: str(m.description) })).filter(m => m.name || m.key),
    languages: { primary, published: [...new Set([primary, ...arr(lang.published).filter(l => codes.includes(l))])], autoRedirect: bool(lang.autoRedirect) },
    privacy: { dataSaleOptOut: bool(pv.dataSaleOptOut), cookieTitle: str(pv.cookieTitle), cookieText: str(pv.cookieText) },
    security: { confirmDanger: bool(st.security?.confirmDanger, true) },
  };
}

/** Return a complete, valid commerce document (defaults filled, unknown values repaired). Does not mutate the input. */
export function normalizeCommerce(input) {
  const s = input && typeof input === 'object' ? clone(input) : {};
  const st = s.settings || {}, g = st.general || {};
  const policies = {};
  for (const k of POLICY_KEYS) { const p = st.policies?.[k] || {}; policies[k] = { title: str(p.title, POLICY_TEMPLATES[k].title) || POLICY_TEMPLATES[k].title, body: str(p.body), values: Object.fromEntries(Object.entries(p.values || {}).map(([a, b]) => [a, str(b)])) }; }
  const templates = {};
  for (const k of NOTIFICATION_KEYS) { const t = st.notifications?.templates?.[k] || {}; templates[k] = { subject: str(t.subject, DEFAULT_NOTIFICATIONS[k].subject), body: str(t.body, DEFAULT_NOTIFICATIONS[k].body) }; }
  const locations = arr(st.locations).map(l => ({ id: str(l.id) || cid('loc'), name: str(l.name, 'Location').trim() || 'Location', address: str(l.address), isDefault: bool(l.isDefault) }));
  if (locations.length && !locations.some(l => l.isDefault)) locations[0].isDefault = true;
  let def = false; for (const l of locations) { if (l.isDefault && def) l.isDefault = false; if (l.isDefault) def = true; }
  const orders = arr(s.orders).map(normalizeOrder);
  const maxNumber = orders.filter(o => !o.draft).reduce((m, o) => Math.max(m, o.number), 0);
  const maxDraft = orders.filter(o => o.draft).reduce((m, o) => Math.max(m, o.number), 0);
  const productMeta = {};
  for (const [pid, m] of Object.entries(s.productMeta || {})) {
    if (!m || typeof m !== 'object') continue;
    productMeta[pid] = { vendor: str(m.vendor).trim(), productType: str(m.productType).trim(), cost: m.cost == null || m.cost === '' ? null : money(m.cost), weight: Math.round(num(m.weight, 0, 0)),
      barcode: str(m.barcode), seoTitle: str(m.seoTitle), seoDescription: str(m.seoDescription),
      variants: Object.fromEntries(Object.entries(m.variants || {}).map(([vid, v]) => [vid, { cost: v?.cost == null || v.cost === '' ? null : money(v.cost), weight: v?.weight == null || v.weight === '' ? null : Math.round(num(v.weight, 0, 0)), barcode: str(v?.barcode), continueSelling: bool(v?.continueSelling) }])) };
  }
  return withServiceData(s, { // + bookings, serviceProjects, abandonedCheckouts, sampleData (src/store/admin/services.js)
    kind: 'commerce', version: COMMERCE_VERSION, storeId: str(s.storeId),
    settings: {
      general: { legalName: str(g.legalName), email: str(g.email), phone: str(g.phone), address: str(g.address), unitSystem: pick(g.unitSystem, ['metric', 'imperial'], 'metric'),
        weightUnit: pick(g.weightUnit, Object.keys(WEIGHT_UNITS), 'kg'), orderPrefix: str(g.orderPrefix, '#').slice(0, 6),
        nextOrderNumber: Math.max(Math.round(num(g.nextOrderNumber, 1001, 1)), maxNumber + 1), nextDraftNumber: Math.max(Math.round(num(g.nextDraftNumber, 1, 1)), maxDraft + 1),
        lowStockThreshold: Math.round(num(g.lowStockThreshold, 5, 0, 100000)), ...generalExtra(g) },
      payments: {
        manualMethods: (Array.isArray(st.payments?.manualMethods) ? st.payments.manualMethods : [{ name: 'Bank transfer', instructions: 'Transfer the order total to our bank account and use the order number as the reference.', enabled: false }, { name: 'Cash on delivery', instructions: 'Pay in cash when your order arrives.', enabled: false }])
          .map(m => ({ id: str(m.id) || cid('pm'), name: str(m.name, 'Manual payment').trim() || 'Manual payment', instructions: str(m.instructions), enabled: bool(m.enabled) })),
        providerNotes: str(st.payments?.providerNotes),
        stripe: normalizeStripe(st.payments?.stripe),
      },
      shipping: { zones: arr(st.shipping?.zones).map(z => ({ id: str(z.id) || cid('z'), name: str(z.name, 'Zone').trim() || 'Zone', countries: [...new Set(arr(z.countries).map(c => str(c).trim().toUpperCase()).filter(c => c === '*' || /^[A-Z]{2}$/.test(c)))], rates: arr(z.rates).map(normRate) })) },
      taxes: { inclusive: bool(st.taxes?.inclusive), shippingTaxed: bool(st.taxes?.shippingTaxed), rates: arr(st.taxes?.rates).map(r => ({ id: str(r.id) || cid('tx'), country: str(r.country).trim().toUpperCase().slice(0, 2), region: str(r.region).trim(), name: str(r.name, 'Tax').trim() || 'Tax', rate: num(r.rate, 0, 0, 100) })).filter(r => r.country) },
      locations,
      notifications: { senderName: str(st.notifications?.senderName), senderEmail: str(st.notifications?.senderEmail), templates },
      domains: { primary: str(st.domains?.primary).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''), provider: pick(st.domains?.provider, ['netlify', 'github', 'cloudflare', 'vercel', 'other'], 'netlify'), notes: str(st.domains?.notes), connected: bool(st.domains?.connected) },
      policies,
      backend: { orderWebhookUrl: str(st.backend?.orderWebhookUrl).trim(), eventsWebhookUrl: str(st.backend?.eventsWebhookUrl).trim(), notes: str(st.backend?.notes) },
      integrations: normalizeIntegrations(st.integrations),
      ...settingsExtra(st),
    },
    orders,
    customers: arr(s.customers).map(normalizeCustomer),
    discounts: arr(s.discounts).map(normalizeDiscountDoc),
    inventoryLog: arr(s.inventoryLog).map(e => ({ id: str(e.id) || cid('inv'), at: iso(e.at, new Date().toISOString()), productId: str(e.productId), variantId: str(e.variantId), delta: Math.round(num(e.delta, 0)), stockAfter: e.stockAfter == null ? null : Math.round(num(e.stockAfter, 0)), reason: pick(e.reason, ['manual', 'set', 'order', 'restock', 'import'], 'manual'), orderId: e.orderId ? str(e.orderId) : null, note: str(e.note) })).slice(-3000),
    productMeta,
    collectionRules: Object.fromEntries(Object.entries(s.collectionRules || {}).filter(([, r]) => r && r.type === 'price').map(([k, r]) => [k, { type: 'price', min: r.min == null || r.min === '' ? null : money(r.min), max: r.max == null || r.max === '' ? null : money(r.max) }])),
    marketing: { campaigns: arr(s.marketing?.campaigns).map(c => ({ id: str(c.id) || cid('mk'), name: str(c.name, 'Campaign').trim() || 'Campaign', channel: str(c.channel, 'Email'), status: pick(c.status, ['draft', 'active', 'ended'], 'draft'),
      startDate: str(c.startDate), endDate: str(c.endDate), budget: money(c.budget), notes: str(c.notes),
      utm: { url: str(c.utm?.url), source: str(c.utm?.source), medium: str(c.utm?.medium), campaign: str(c.utm?.campaign), content: str(c.utm?.content), term: str(c.utm?.term) } })) },
    staffNotes: arr(s.staffNotes).map(n => ({ id: str(n.id) || cid('sn'), at: iso(n.at, new Date().toISOString()), author: str(n.author), text: str(n.text) })).filter(n => n.text.trim()),
    analytics: { events: arr(s.analytics?.events).map(normalizeEvent).slice(-MAX_EVENTS) },
    onboarding: { dismissed: bool(s.onboarding?.dismissed), steps: Object.fromEntries(ONBOARDING_STEPS.map(k => [k, bool(s.onboarding?.steps?.[k])])) },
  });
}

// ---------- product meta helpers ----------
export const EMPTY_META = { vendor: '', productType: '', cost: null, weight: 0, barcode: '', seoTitle: '', seoDescription: '', variants: {} };
export const productMeta = (commerce, pid) => ({ ...EMPTY_META, ...(commerce?.productMeta?.[pid] || {}) });
export const variantMeta = (commerce, pid, vid) => ({ cost: null, weight: null, barcode: '', continueSelling: false, ...(commerce?.productMeta?.[pid]?.variants?.[vid] || {}) });
export const variantCost = (commerce, pid, vid) => { const v = variantMeta(commerce, pid, vid); return v.cost != null ? v.cost : productMeta(commerce, pid).cost; };
export const variantWeight = (commerce, pid, vid) => { const v = variantMeta(commerce, pid, vid); return v.weight != null ? v.weight : productMeta(commerce, pid).weight || 0; };

/** UTM link builder. */
export function utmUrl(utm) {
  const base = str(utm?.url).trim(); if (!base) return '';
  const params = [['utm_source', utm.source], ['utm_medium', utm.medium], ['utm_campaign', utm.campaign], ['utm_content', utm.content], ['utm_term', utm.term]].filter(([, v]) => str(v).trim());
  if (!params.length) return base;
  const [main, hash] = base.split('#');
  const q = params.map(([k, v]) => k + '=' + encodeURIComponent(str(v).trim())).join('&');
  return main + (main.includes('?') ? '&' : '?') + q + (hash != null ? '#' + hash : '');
}

/** Re-sync the productIds of price-automated collections (see collectionRules). Returns the same store when nothing changed. */
export function syncPriceCollections(store, commerce) {
  const rules = commerce?.collectionRules || {};
  let changed = false;
  const cols = store.collections.map(col => {
    const r = rules[col.id]; if (!r) return col;
    const ids = store.products.filter(p => (r.min == null || p.price >= r.min) && (r.max == null || p.price <= r.max)).map(p => p.id);
    if (col.rule.type === 'manual' && ids.join() === col.rule.productIds.join()) return col;
    changed = true;
    return { ...col, rule: { type: 'manual', value: '', productIds: ids } };
  });
  return changed ? { ...store, collections: cols } : store;
}
