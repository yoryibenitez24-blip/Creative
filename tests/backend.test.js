// Backend (backend/supabase/functions/_shared/*.ts — pure modules, loaded with Node's TypeScript type stripping) and
// the storefront payment layer of src/store/commerce.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { toMinor, fromMinor, minorUnitFactor } from '../backend/supabase/functions/_shared/money.ts';
import { applicationFeeAmount, feePercent } from '../backend/supabase/functions/_shared/fees.ts';
import { canonicalCart, idempotencyKey, safeCheckoutId } from '../backend/supabase/functions/_shared/idempotency.ts';
import { parseSignatureHeader, verifySignature, signPayload } from '../backend/supabase/functions/_shared/signature.ts';
import { createLimiter, clientIp } from '../backend/supabase/functions/_shared/ratelimit.ts';
import { verifyTurnstile } from '../backend/supabase/functions/_shared/turnstile.ts';
import { pickProvider, providerRequest, sendMail, orderConfirmation, parseAddress } from '../backend/supabase/functions/_shared/email.ts';
import { validateCart, needsShipping, isSubscription } from '../backend/supabase/functions/_shared/cart.ts';
import { buildSessionParams, couponFor, connectMode, descriptorSuffix } from '../backend/supabase/functions/_shared/checkout.ts';
import { connectSummary } from '../backend/supabase/functions/_shared/connect.ts';
import { orderPatchFromSession, financialFromIntent, financialAfterRefunds, refundRow, subscriptionRow, orderRef } from '../backend/supabase/functions/_shared/webhook.ts';
import { eventRows, headerCountry } from '../backend/supabase/functions/_shared/track.ts';
import { serviceRecords } from '../backend/supabase/functions/_shared/fulfil.ts';
import { corsHeaders, safeReturnBase, normalizeOrigin, maskEmail } from '../backend/supabase/functions/_shared/http.ts';
import { CK as ServerCK } from '../backend/supabase/functions/_shared/engine.js';
import { bookingSlots, normalizeService } from '../backend/supabase/functions/_shared/services.js';
import { engineModule, servicesModule, ENGINE_PATH, SERVICES_PATH } from '../backend/scripts/gen-engine.mjs';
import { checkoutConfig, commerceKit, commerceScript, payConfig, catalogSnapshot, serviceCheckout } from '../src/store/commerce.js';
import { applyDiscounts } from '../src/store/admin/discounts.js';
import { normalizeCommerce } from '../src/store/admin/model.js';
import { createStore } from '../src/store/templates.js';

// ---------- fixtures ----------
const catalog = [
  { id: 'tee', title: 'Tee', active: true, price: 25, image: 'https://cdn.example.com/tee.png', kind: 'physical', variants: [{ id: 'm', title: 'M', price: null, sku: 'TEE-M', stock: 5 }, { id: 'l', title: 'L', price: 27.5, sku: 'TEE-L', stock: 0 }] },
  { id: 'old', title: 'Old', active: false, price: 10, variants: [{ id: 'x', price: null, stock: null }] },
  { id: 'call', title: 'Strategy call', active: true, price: 120, kind: 'service', variants: [{ id: 'd', price: null, stock: null }],
    service: { booking: { enabled: true }, intake: [{ id: 'q1', label: 'Your website', type: 'url', required: true }, { id: 'q2', label: 'Plan', type: 'select', required: false, options: ['A', 'B'] }], addOns: [{ id: 'rec', name: 'Recording', price: 30 }] } },
  { id: 'audit', title: 'Audit', active: true, price: 500, kind: 'service', variants: [{ id: 'd', price: null, stock: null }], service: { booking: { enabled: false }, intake: [], addOns: [] } },
  { id: 'ret', title: 'Retainer', active: true, price: 900, kind: 'service', recurring: { interval: 'month' }, variants: [{ id: 'd', price: null, stock: null }], service: { pricing: { model: 'retainer', stripePriceId: 'price_123ABCdef' }, booking: { enabled: false }, addOns: [{ id: 'x', name: 'Extra', price: 50 }] } },
  { id: 'ebook', title: 'E-book', active: true, price: 9, kind: 'digital', variants: [{ id: 'd', price: null, stock: null }] },
];
const T = (o = {}) => ({ subtotal: 50, discountTotal: 5, shipping: 6, shippingDiscount: 0, tax: 2.25, taxRate: 5, taxName: 'Tax', taxInclusive: false, total: 53.25, shippingRateId: 'std', shippingName: 'Standard', appliedCodes: ['SAVE10'], applied: [{ code: 'SAVE10', type: 'percentage', amount: 5 }], rates: [], ...o });
const base = { orderId: 'ord-1', storeId: 's1', currency: 'USD', successUrl: 'https://shop.example.com/checkout.html?zt_checkout=success&session_id={CHECKOUT_SESSION_ID}', cancelUrl: 'https://shop.example.com/cart.html?zt_checkout=cancel', country: 'US', zoneCountries: ['US'] };

// ---------- money, fees, idempotency ----------
test('backend money: minor units incl. zero- and three-decimal currencies', () => {
  assert.equal(toMinor(19.99, 'usd'), 1999); assert.equal(toMinor(1500, 'JPY'), 1500); assert.equal(toMinor(1.234, 'KWD'), 1230);
  assert.equal(fromMinor(1999, 'USD'), 19.99); assert.equal(minorUnitFactor('xx'), 100);
});

test('backend fees: percent + fixed, capped at the total; PLATFORM_FEE_PERCENT overrides the store setting', () => {
  assert.equal(applicationFeeAmount(10000, 'USD', { applicationFeePercent: 2.5, applicationFeeFixed: 0.3 }), 280);
  assert.equal(applicationFeeAmount(10000, 'USD', { applicationFeePercent: 2.5 }, '1'), 100);
  assert.equal(applicationFeeAmount(100, 'USD', { applicationFeePercent: 50, applicationFeeFixed: 5 }), 100);
  assert.equal(applicationFeeAmount(0, 'USD', { applicationFeePercent: 5 }), 0);
  assert.equal(feePercent({ applicationFeePercent: 150 }), 100); assert.equal(feePercent({}, ''), 0);
});

test('backend idempotency: order-independent canonical cart, stable sha-256 key, safe attempt ids', async () => {
  const a = canonicalCart({ storeId: 's', checkoutId: 'co_1', lines: [{ productId: 'a', variantId: 'x', quantity: 1 }, { productId: 'b', variantId: 'y', quantity: 2 }], codes: ['save10'], country: 'us' });
  const b = canonicalCart({ storeId: 's', checkoutId: 'co_1', lines: [{ productId: 'b', variantId: 'y', quantity: 2 }, { productId: 'a', variantId: 'x', quantity: 1 }], codes: ['SAVE10 '], country: 'US' });
  assert.equal(a, b);
  const k = await idempotencyKey('zt_cs', a);
  assert.match(k, /^zt_cs_[0-9a-f]{64}$/); assert.equal(k, await idempotencyKey('zt_cs', b));
  assert.notEqual(k, await idempotencyKey('zt_cs', a.replace('"co_1"', '"co_2"')));
  assert.equal(safeCheckoutId('co_abc12345'), 'co_abc12345'); assert.match(safeCheckoutId('<script>'), /^[0-9a-f-]{36}$/);
});

// ---------- Stripe signature ----------
test('backend signature: parse, verify, wrong secret, tampered body, tolerance', async () => {
  const body = '{"id":"evt_1","type":"checkout.session.completed"}', now = 1_800_000_000;
  const h = await signPayload(body, 'whsec_test', now);
  const p = parseSignatureHeader(h + ',v0=deadbeef,v1=zz');
  assert.equal(p.timestamp, now); assert.equal(p.v1.length, 1);
  assert.deepEqual(await verifySignature(body, h, 'whsec_test', 300, now + 10), { ok: true, timestamp: now });
  assert.equal((await verifySignature(body, h, 'whsec_other', 300, now)).reason, 'no_match');
  assert.equal((await verifySignature(body + ' ', h, 'whsec_test', 300, now)).reason, 'no_match');
  assert.equal((await verifySignature(body, h, 'whsec_test', 300, now + 301)).reason, 'too_old');
  assert.equal((await verifySignature(body, 'garbage', 'whsec_test')).reason, 'malformed');
  // known vector: HMAC-SHA256("whsec_test", "1800000000.{}")
  const { createHmac } = await import('node:crypto');
  assert.equal((await signPayload('{}', 'whsec_test', now)).split('v1=')[1], createHmac('sha256', 'whsec_test').update(`${now}.{}`).digest('hex'));
});

// ---------- rate limit, turnstile, http ----------
test('backend rate limiter + client ip', () => {
  const l = createLimiter(2, 1000);
  assert.equal(l.hit('a', 0).allowed, true); assert.equal(l.hit('a', 1).allowed, true); assert.equal(l.hit('a', 2).allowed, false);
  assert.equal(l.hit('b', 2).allowed, true); assert.equal(l.hit('a', 1001).allowed, true);
  assert.equal(clientIp(new Headers({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1' })), '1.2.3.4');
});

test('backend turnstile: posts secret + token, checks success and action', async () => {
  let sent;
  const fake = ok => async (url, init) => { sent = { url, body: String(init.body) }; return { ok: true, json: async () => ok }; };
  assert.equal((await verifyTurnstile('tok', 'sec', '1.2.3.4', fake({ success: true, action: 'checkout' }), 'checkout')).success, true);
  assert.match(sent.body, /secret=sec/); assert.match(sent.body, /response=tok/); assert.match(sent.body, /remoteip=1\.2\.3\.4/);
  assert.equal((await verifyTurnstile('tok', 'sec', '', fake({ success: true, action: 'login' }), 'checkout')).success, false);
  assert.equal((await verifyTurnstile('', 'sec', '', fake({ success: true }))).success, false);
});

test('backend http: CORS allow-list, return URL safety, masking', () => {
  assert.equal(corsHeaders('https://evil.test', [])['Access-Control-Allow-Origin'], '*');
  assert.equal(corsHeaders('https://Shop.example.com', ['https://shop.example.com/'])['Access-Control-Allow-Origin'], 'https://shop.example.com');
  assert.equal(corsHeaders('https://evil.test', ['https://shop.example.com'])['Access-Control-Allow-Origin'], 'https://shop.example.com');
  assert.equal(safeReturnBase('https://shop.example.com/store/checkout.html?x=1', [], ''), 'https://shop.example.com/store/');
  assert.equal(safeReturnBase('https://evil.test/', ['https://shop.example.com'], 'https://shop.example.com'), 'https://shop.example.com/');
  assert.equal(safeReturnBase('file:///C:/site/checkout.html', [], ''), '');
  assert.equal(safeReturnBase('http://localhost:8080/checkout.html', [], ''), 'http://localhost:8080/');
  assert.equal(safeReturnBase('http://shop.example.com/', [], ''), '');
  assert.equal(normalizeOrigin('javascript:alert(1)'), ''); assert.equal(maskEmail('ada@example.com'), 'a••@example.com');
});

// ---------- email ----------
test('backend email: provider choice, request shapes and the order confirmation', async () => {
  assert.equal(pickProvider({ SENDGRID_API_KEY: 's', POSTMARK_TOKEN: 'p' }).provider, 'sendgrid');
  assert.equal(pickProvider({ EMAIL_PROVIDER: 'postmark', RESEND_API_KEY: 'r', POSTMARK_TOKEN: 'p' }).provider, 'postmark');
  assert.equal(pickProvider({}), null);
  const m = { to: 'ada@example.com', from: 'Shop <hi@shop.com>', replyTo: 'help@shop.com', subject: 'S', html: '<p>h</p>', text: 't' };
  assert.deepEqual(JSON.parse(providerRequest('resend', 'k', m).body).to, ['ada@example.com']);
  assert.deepEqual(JSON.parse(providerRequest('sendgrid', 'k', m).body).from, { email: 'hi@shop.com', name: 'Shop' });
  assert.equal(providerRequest('postmark', 'k', m).headers['X-Postmark-Server-Token'], 'k');
  assert.deepEqual(parseAddress('x@y.z'), { email: 'x@y.z' });
  let called = 0; const r = await sendMail({ RESEND_API_KEY: 'k' }, m, async () => { called++; return { ok: true, status: 200, text: async () => '' }; });
  assert.equal(r.ok, true); assert.equal(called, 1);
  assert.equal((await sendMail({}, m, async () => ({ ok: true, status: 200, text: async () => '' }))).ok, false);
  const mail = orderConfirmation({ number: 1001, currency: 'USD', email: 'ada@example.com', name: '<b>Ada Lovelace', lines: [{ title: 'Tee', variant_title: 'M', quantity: 2, unit_price: 25, total: 50 }],
    subtotal: 50, discount_total: 5, shipping: 6, tax: 2.25, total: 53.25, codes: ['SAVE10'], shipping_name: 'Standard',
    downloads: [{ title: 'E-book', url: 'https://x.supabase.co/functions/v1/download?token=abc' }], bookings: [{ title: 'Call', start: '2026-11-09T14:00:00Z', timezone: 'Europe/Berlin' }] }, { name: 'Shop', siteUrl: 'https://shop.example.com' });
  assert.equal(mail.subject, 'Order #1001 confirmed — Shop');
  assert.match(mail.text, /2 × Tee \(M\) — \$50\.00/); assert.match(mail.text, /Discount \(SAVE10\): −\$5\.00/); assert.match(mail.text, /Total: \$53\.25/);
  assert.match(mail.text, /download\?token=abc/); assert.match(mail.text, /15:00 \(Europe\/Berlin\)/);
  assert.match(mail.html, /Hi &lt;b&gt;Ada,/); assert.doesNotMatch(mail.html, /<b>Ada/);
});

// ---------- cart validation ----------
test('backend cart: server prices, merged lines, inactive / unknown / stock errors, client price ignored', () => {
  const r = validateCart([{ productId: 'tee', variantId: 'm', quantity: 2, price: 0.01 }, { productId: 'tee', variantId: 'm', quantity: 1 }], catalog);
  assert.equal(r.ok, true); assert.equal(r.lines.length, 1); assert.equal(r.lines[0].quantity, 3); assert.equal(r.lines[0].price, 25);
  assert.deepEqual(r.priceChanges, [{ productId: 'tee', variantId: 'm', client: 0.01, server: 25 }]);
  assert.equal(validateCart([{ productId: 'tee', variantId: 'm', quantity: 6 }], catalog).errors[0].code, 'out_of_stock');
  assert.equal(validateCart([{ productId: 'tee', variantId: 'l', quantity: 1 }], catalog).errors[0].message, '“Tee (L)” is sold out.');
  assert.equal(validateCart([{ productId: 'old', variantId: 'x', quantity: 1 }], catalog).errors[0].code, 'inactive');
  assert.equal(validateCart([{ productId: 'nope', variantId: 'x', quantity: 1 }], catalog).errors[0].code, 'unknown_product');
  assert.equal(validateCart([{ productId: 'tee', variantId: 'm', quantity: 1.5 }], catalog).errors[0].code, 'bad_quantity');
  assert.equal(validateCart([], catalog).errors[0].code, 'empty');
  assert.equal(validateCart(Array(101).fill({ productId: 'tee', variantId: 'm', quantity: 1 }), catalog).errors[0].code, 'too_many_lines');
});

test('backend cart: services need a slot and required intake, add-ons are priced from the snapshot', () => {
  const ok = validateCart([{ productId: 'call', variantId: 'd', quantity: 1, start: '2026-11-09T14:00:00Z', intake: [{ question: 'Your website', answer: 'https://ada.dev' }, { question: 'Plan', answer: 'B' }], addOns: ['rec'] }], catalog);
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));
  assert.equal(ok.lines[0].price, 150); assert.equal(ok.lines[0].basePrice, 120); assert.equal(ok.lines[0].start, '2026-11-09T14:00:00.000Z');
  assert.deepEqual(ok.lines[0].intake, [{ question: 'Your website', answer: 'https://ada.dev' }, { question: 'Plan', answer: 'B' }]);
  const err = (lines) => validateCart(lines, catalog).errors[0]?.code;
  assert.equal(err([{ productId: 'call', variantId: 'd', quantity: 1, intake: [{ question: 'Your website', answer: 'https://a.b' }] }]), 'booking_required');
  assert.equal(err([{ productId: 'call', variantId: 'd', quantity: 1, start: '2026-11-09T14:00:00Z' }]), 'intake_required');
  assert.equal(err([{ productId: 'call', variantId: 'd', quantity: 1, start: '2026-11-09T14:00:00Z', intake: [{ question: 'Your website', answer: 'nope' }] }]), 'intake_invalid');
  assert.equal(err([{ productId: 'call', variantId: 'd', quantity: 1, start: '2026-11-09T14:00:00Z', intake: [{ question: 'Your website', answer: 'https://a.b' }], addOns: ['free-stuff'] }]), 'unknown_addon');
  assert.equal(err([{ productId: 'call', variantId: 'd', quantity: 2, start: '2026-11-09T14:00:00Z', intake: [{ question: 'Your website', answer: 'https://a.b' }] }]), 'bad_quantity');
  const mix = validateCart([{ productId: 'audit', variantId: 'd', quantity: 1 }, { productId: 'ebook', variantId: 'd', quantity: 1 }], catalog);
  assert.equal(needsShipping(mix.lines), false); assert.equal(isSubscription(mix.lines), false);
  const ret = validateCart([{ productId: 'ret', variantId: 'd', quantity: 1 }], catalog);
  assert.equal(ret.lines[0].stripePriceId, 'price_123ABCdef'); assert.equal(isSubscription(ret.lines), true);
});

// ---------- Checkout Session parameters ----------
test('backend checkout: destination charge with fee, shipping, own tax line, coupon, payment methods', () => {
  const lines = validateCart([{ productId: 'tee', variantId: 'm', quantity: 2 }], catalog).lines;
  const cfg = { connectType: 'express', applicationFeePercent: 2, applicationFeeFixed: 0.3, paymentMethods: ['card', 'apple_pay', 'klarna', 'bogus'], captureMethod: 'manual', statementDescriptorSuffix: 'TEE*SHOP', threeDSecure: 'any', billing: { invoices: true } };
  const o = buildSessionParams({ ...base, lines, totals: T(), cfg, accountId: 'acct_123', couponId: 'co_1' });
  const p = o.params;
  assert.equal(p.mode, 'payment'); assert.equal(o.stripeAccount, undefined);
  assert.deepEqual(p.line_items.map(l => [l.price_data.unit_amount, l.quantity]), [[2500, 2], [225, 1]]);
  assert.match(p.line_items[1].price_data.product_data.name, /Tax 5%/);
  assert.equal(p.shipping_options[0].shipping_rate_data.fixed_amount.amount, 600);
  assert.deepEqual(p.shipping_address_collection.allowed_countries, ['US']);
  assert.deepEqual(p.discounts, [{ coupon: 'co_1' }]); assert.equal(p.allow_promotion_codes, undefined);
  assert.equal(o.expectedTotalMinor, 5325);
  assert.equal(p.payment_intent_data.application_fee_amount, Math.round(5325 * 0.02) + 30);
  assert.deepEqual(p.payment_intent_data.transfer_data, { destination: 'acct_123' }); assert.equal(p.payment_intent_data.on_behalf_of, 'acct_123');
  assert.equal(p.payment_intent_data.capture_method, 'manual'); assert.equal(p.payment_intent_data.statement_descriptor_suffix, 'TEESHOP');
  assert.deepEqual(p.allowed_payment_method_types, ['card', 'klarna']); assert.equal(p.payment_method_options.card.request_three_d_secure, 'any');
  assert.equal(p.invoice_creation.enabled, true); assert.equal(p.metadata.order_id, 'ord-1'); assert.equal(p.client_reference_id, 'ord-1');
  assert.deepEqual(couponFor(T(), 'USD', 'ord-1'), { amount_off: 500, currency: 'usd', duration: 'once', max_redemptions: 1, name: 'Discount (SAVE10)', metadata: { order_id: 'ord-1' } });
  assert.equal(couponFor(T({ discountTotal: 0 }), 'USD', 'x'), null);
});

test('backend checkout: direct (Standard) and platform charges, Stripe Tax, rest-of-world shipping, promotion codes', () => {
  const lines = validateCart([{ productId: 'tee', variantId: 'm', quantity: 1 }], catalog).lines;
  const d = buildSessionParams({ ...base, lines, totals: T({ discountTotal: 0, appliedCodes: [] }), cfg: { connectType: 'standard', applicationFeePercent: 10, automaticTax: true, allowPromotionCodes: true }, accountId: 'acct_9', country: '*', zoneCountries: ['US', 'CA'] });
  assert.equal(d.stripeAccount, 'acct_9'); assert.equal(d.params.payment_intent_data.transfer_data, undefined); assert.ok(d.params.payment_intent_data.application_fee_amount > 0);
  assert.deepEqual(d.params.automatic_tax, { enabled: true }); assert.equal(d.params.line_items.length, 1, 'no own tax line with Stripe Tax');
  assert.equal(d.params.line_items[0].price_data.tax_behavior, 'exclusive'); assert.equal(d.params.allow_promotion_codes, true);
  const allowed = d.params.shipping_address_collection.allowed_countries;
  assert.ok(allowed.includes('DE') && !allowed.includes('US') && !allowed.includes('CA'));
  const pf = buildSessionParams({ ...base, lines, totals: T(), cfg: { connectType: 'standard', applicationFeePercent: 10 }, accountId: null });
  assert.equal(connectMode({ connectType: 'express' }, null), 'platform'); assert.equal(pf.stripeAccount, undefined); assert.equal(pf.params.payment_intent_data.application_fee_amount, undefined);
  assert.equal(descriptorSuffix('***'), '');
});

test('backend checkout: services and subscriptions (retainer Stripe price, trial, fee percent), no shipping for services', () => {
  const svc = validateCart([{ productId: 'call', variantId: 'd', quantity: 1, start: '2026-11-09T14:00:00Z', intake: [{ question: 'Your website', answer: 'https://a.b' }], addOns: ['rec'] }], catalog).lines;
  const s1 = buildSessionParams({ ...base, lines: svc, totals: T({ shippingRateId: null, tax: 0, discountTotal: 0, appliedCodes: [] }), cfg: {}, accountId: null });
  assert.equal(s1.params.shipping_address_collection, undefined); assert.equal(s1.params.line_items[0].price_data.unit_amount, 15000);
  assert.match(s1.params.line_items[0].price_data.product_data.description, /Booked for 2026-11-09 14:00 UTC · Extras: Recording/);
  const ret = validateCart([{ productId: 'ret', variantId: 'd', quantity: 1, addOns: ['x'] }], catalog).lines;
  const s2 = buildSessionParams({ ...base, lines: ret, totals: T({ shippingRateId: null, tax: 0, discountTotal: 0, appliedCodes: [] }), cfg: { connectType: 'express', applicationFeePercent: 3, billing: { trialDays: 14 } }, accountId: 'acct_1' });
  assert.equal(s2.mode, 'subscription'); assert.deepEqual(s2.params.line_items[0], { price: 'price_123ABCdef', quantity: 1 });
  assert.equal(s2.params.line_items[1].price_data.unit_amount, 5000);
  assert.equal(s2.params.subscription_data.application_fee_percent, 3); assert.deepEqual(s2.params.subscription_data.transfer_data, { destination: 'acct_1' });
  assert.equal(s2.params.subscription_data.trial_period_days, 14); assert.equal(s2.params.payment_intent_data, undefined); assert.equal(s2.params.customer_creation, undefined);
});

// ---------- Connect + webhook mapping ----------
test('backend connect: onboarding status from the account object', () => {
  const acc = (o) => ({ id: 'acct_1', charges_enabled: false, payouts_enabled: false, details_submitted: false, requirements: { currently_due: [], past_due: [], disabled_reason: null, current_deadline: null }, ...o });
  assert.equal(connectSummary(acc({})).onboardingStatus, 'not_started');
  assert.equal(connectSummary(acc({ business_type: 'individual' })).onboardingStatus, 'pending');
  assert.equal(connectSummary(acc({ details_submitted: true, requirements: { currently_due: ['external_account'], past_due: [] } })).onboardingStatus, 'restricted');
  assert.equal(connectSummary(acc({ details_submitted: true, charges_enabled: true, payouts_enabled: true, capabilities: { card_payments: 'active' } })).onboardingStatus, 'complete');
  assert.equal(connectSummary(acc({ requirements: { disabled_reason: 'rejected.fraud' } })).onboardingStatus, 'rejected');
});

test('backend webhook: session → order patch, intent / refund / subscription mapping', () => {
  const s = { id: 'cs_1', payment_intent: 'pi_1', subscription: null, customer: { id: 'cus_1' }, livemode: false, payment_status: 'paid', amount_total: 5325, currency: 'usd', total_details: { amount_tax: 0, amount_discount: 500 }, automatic_tax: { enabled: false },
    customer_details: { email: 'Ada@Example.com', name: 'Ada', phone: '+1', address: { line1: '1 St', city: 'X', country: 'US', postal_code: '1', state: 'CA', line2: null } },
    collected_information: { shipping_details: { name: 'Ada L', address: { line1: '2 St', city: 'Y', country: 'US', postal_code: '2', state: 'NY', line2: null } } }, metadata: { order_id: 'o1', store_id: 's1' } };
  const p = orderPatchFromSession(s, 'checkout.session.completed');
  assert.equal(p.financial_status, 'paid'); assert.equal(p.status, 'open'); assert.equal(p.email, 'ada@example.com'); assert.equal(p.stripe_customer_id, 'cus_1');
  assert.equal(p.shipping_address.address1, '2 St'); assert.equal(p.shipping_address.province, 'NY'); assert.equal(p.total, 53.25);
  assert.equal(orderPatchFromSession({ ...s, payment_status: 'unpaid' }, 'checkout.session.completed').financial_status, undefined);
  assert.equal(orderPatchFromSession(s, 'checkout.session.expired').status, 'cancelled');
  assert.equal(financialFromIntent({ status: 'requires_capture' }), 'authorized'); assert.equal(financialFromIntent({ status: 'requires_payment_method', last_payment_error: {} }), 'failed');
  assert.equal(financialAfterRefunds(5000, 1000), 'partially_refunded'); assert.equal(financialAfterRefunds(5000, 5000), 'refunded');
  assert.equal(refundRow({ id: 're_1', charge: 'ch_1', payment_intent: { id: 'pi_1' }, amount: 100, currency: 'usd', status: 'succeeded', reason: null }, 's1', 'o1').stripe_payment_intent_id, 'pi_1');
  const sub = subscriptionRow({ id: 'sub_1', customer: 'cus_1', status: 'active', cancel_at_period_end: false, trial_end: null, canceled_at: null, livemode: false,
    items: { data: [{ price: { id: 'price_1', product: 'prod_1', unit_amount: 9000, recurring: { interval: 'month', interval_count: 1 } }, quantity: 1, current_period_end: 1_800_000_000 }] } }, 's1', 'o1');
  assert.equal(sub.current_period_end, new Date(1_800_000_000_000).toISOString()); assert.equal(sub.items[0].interval, 'month');
  assert.deepEqual(orderRef({ order_id: 'o1' }), { orderId: 'o1', storeId: null });
});

test('backend fulfilment: bookings (requested), service projects (due date, deliverables), download grants', () => {
  const svc = normalizeService({ durationMinutes: 45, booking: { enabled: true, timezone: 'Europe/Berlin' }, deliverables: ['Report'], delivery: { turnaroundDays: 10 } });
  const asyncSvc = { ...svc, booking: { ...svc.booking, enabled: false } };
  const products = new Map([['call', { id: 'call', title: 'Call', service: svc, digital: null }], ['audit', { id: 'audit', title: 'Audit', service: asyncSvc, digital: null }],
    ['ebook', { id: 'ebook', title: 'E-book', service: null, digital: { file: 'storage:s1/book.pdf', fileName: 'book.pdf', downloadLimit: 3 } }], ['local', { id: 'local', title: 'L', service: null, digital: { file: 'asset:abc', fileName: '', downloadLimit: null } }]]);
  const order = { id: 'o1', store_id: 's1', customer_id: null, name: 'Ada', email: 'ada@x.io', phone: '', paid_at: '2026-11-07T10:00:00Z' };
  const r = serviceRecords(order, [
    { product_id: 'call', title: 'Call', quantity: 1, kind: 'service', details: { start: '2026-11-09T14:00:00Z', intake: [{ question: 'Q', answer: 'A' }], addOns: [], basePrice: 120 } },
    { product_id: 'audit', title: 'Audit', quantity: 1, kind: 'service', details: {} },
    { product_id: 'ebook', title: 'E-book', quantity: 2, kind: 'digital', details: {} }, { product_id: 'local', title: 'L', quantity: 1, kind: 'digital', details: {} }], products, 0);
  assert.equal(r.bookings.length, 1); assert.equal(r.bookings[0].status, 'requested'); assert.equal(r.bookings[0].ends_at, '2026-11-09T14:45:00.000Z');
  assert.equal(r.projects[0].stage, 'new'); assert.equal(r.projects[0].due_date, '2026-11-17'); assert.deepEqual(r.projects[0].deliverables, ['Report']);
  assert.equal(r.downloads.length, 1); assert.equal(r.downloads[0].download_limit, 6);
});

test('backend track: event validation, no order_placed from browsers, geo from headers or time zone', () => {
  const now = Date.parse('2026-11-07T12:00:00Z');
  const rows = eventRows({ sessionId: 's_abc123', events: [{ type: 'visit', tz: 'Europe/Berlin', lang: 'de-DE', referrer: 'https://google.com/search?q=x', utm: { source: 'ig', evil: 'x' }, at: '2026-11-07T11:59:00Z' },
    { type: 'order_placed', value: 1e9 }, { type: 'add_to_cart', quantity: 3, path: 'products/<x>.html' }, { type: 'page_view', at: '1999-01-01T00:00:00Z' }] }, { storeId: 's1', ipHash: 'h', country: '', userAgent: 'UA', now });
  assert.deepEqual(rows.map(r => r.type), ['visit', 'add_to_cart', 'page_view']);
  assert.equal(rows[0].referrer, 'https://google.com'); assert.deepEqual(rows[0].utm, { source: 'ig' }); assert.equal(rows[0].geo_source, 'timezone'); assert.equal(rows[0].timezone, 'Europe/Berlin');
  assert.equal(rows[1].path, 'products/x.html'); assert.equal(rows[2].occurred_at, new Date(now).toISOString(), 'clock skew clamped');
  assert.deepEqual(eventRows({ sessionId: 'x', events: [] }, { storeId: 's', ipHash: '', country: '', userAgent: '', now }), []);
  assert.equal(headerCountry(new Headers({ 'cf-ipcountry': 'de' })), 'DE'); assert.equal(headerCountry(new Headers({ 'cf-ipcountry': 'XX' })), '');
});

// ---------- generated shared code ----------
test('backend generated code is up to date (node backend/scripts/gen-engine.mjs)', async () => {
  assert.equal(await readFile(ENGINE_PATH, 'utf8'), engineModule(), 'engine.js is stale');
  assert.equal(await readFile(SERVICES_PATH, 'utf8'), await servicesModule(), 'services.js is stale');
  const slots = bookingSlots({ id: 'p', service: normalizeService({ booking: { enabled: true, timezone: 'UTC' }, durationMinutes: 60 }) }, { from: '2026-11-09', days: 1, now: 0 });
  assert.equal(slots[0].start, '2026-11-09T09:00:00.000Z');
});

// ---------- storefront payment layer (src/store/commerce.js) ----------
const ANON = 'sb_publishable_abcdefghijklmnop';
function payFixture(over = {}) {
  const store = createStore('general');
  const commerce = normalizeCommerce({ storeId: store.id, settings: {
    shipping: { zones: [{ name: 'US', countries: ['US'], rates: [{ id: 'std', name: 'Standard', type: 'flat', price: 6 }] }] }, taxes: { inclusive: false, shippingTaxed: false, rates: [{ country: 'US', rate: 5 }] },
    payments: { stripe: { enabled: true, mode: 'test', publishableKeyTest: 'pk_test_abcdefghij1234', connectType: 'express', ...(over.stripe || {}) } },
    integrations: { backend: { provider: 'supabase', url: 'https://abcdefghijklmnop.supabase.co', anonKey: ANON }, turnstile: { siteKey: over.turnstile || '' } },
  }, discounts: [{ id: 'd10', code: 'SAVE10', type: 'percentage', value: 10 }] });
  return { store, commerce };
}

test('storefront pay: payConfig needs stripe + key + backend; tracking needs only the backend', () => {
  const { store, commerce } = payFixture({ turnstile: '0x4AAAAAAAB1234567890abc' });
  const pc = payConfig(commerce);
  assert.equal(pc.stripe.endpoint, 'https://abcdefghijklmnop.supabase.co/functions/v1/create-checkout-session');
  assert.equal(pc.stripe.publishableKey, 'pk_test_abcdefghij1234'); assert.equal(pc.trackUrl, 'https://abcdefghijklmnop.supabase.co/functions/v1/track');
  assert.equal(pc.anonKey, ANON); assert.equal(pc.turnstileSiteKey, '0x4AAAAAAAB1234567890abc');
  assert.equal(checkoutConfig(store, commerce).pay.stripe.statusUrl.endsWith('/order-status'), true);
  const off = payFixture({ stripe: { enabled: false } });
  assert.equal(payConfig(off.commerce).stripe, null); assert.ok(payConfig(off.commerce).trackUrl);
  const noKey = payFixture({ stripe: { publishableKeyTest: '' } });
  assert.equal(payConfig(noKey.commerce).stripe, null);
  const noBackend = normalizeCommerce({ settings: { payments: { stripe: { enabled: true, publishableKeyTest: 'pk_test_abcdefghij1234' } } } });
  assert.equal(payConfig(noBackend), null);
  assert.equal(checkoutConfig(store, { discounts: [] }).pay, null, 'discount-only commerce source has no payments');
  // nothing secret ever reaches the storefront
  const js = JSON.stringify(checkoutConfig(store, commerce));
  assert.doesNotMatch(js, /sk_(test|live)_|whsec_|service_role/);
});

test('storefront pay: payReady fallback logic, payload builder, return parsing', () => {
  const { store, commerce } = payFixture();
  const cfg = checkoutConfig(store, commerce), K = commerceKit(applyDiscounts);
  assert.equal(K.payReady(cfg, 'whatsapp'), true); assert.equal(K.payReady(cfg, 'paymentLinks'), true);
  assert.equal(K.payReady(cfg, 'none'), false, 'catalog-only stores take no orders');
  assert.equal(K.payReady(checkoutConfig(store, payFixture({ stripe: { enabled: false } }).commerce), 'whatsapp'), false, 'falls back to WhatsApp / email / payment links');
  assert.equal(K.payReady(null, 'email'), false);
  const body = K.payPayload(cfg, store.id, [{ productId: 'p', variantId: 'v', quantity: 2, price: 25 }, { productId: 's', variantId: 'd', quantity: 1, price: 120, start: '2026-11-09T14:00:00Z', intake: [{ question: 'Q', answer: 'A' }], addOns: ['rec'] }],
    { checkoutId: 'co_1', currency: 'usd', codes: ['save10', ''], country: 'us', region: ' CA ', rateId: 'std', customer: { name: ' Ada ', email: 'ada@x.io' }, returnUrl: 'https://shop.example.com/', turnstileToken: 't', expectedTotal: '53.25' });
  assert.deepEqual(body.lines[0], { productId: 'p', variantId: 'v', quantity: 2, price: 25 });
  assert.deepEqual(body.lines[1], { productId: 's', variantId: 'd', quantity: 1, price: 120, start: '2026-11-09T14:00:00Z', intake: [{ question: 'Q', answer: 'A' }], addOns: ['rec'] });
  assert.deepEqual(body.codes, ['SAVE10']); assert.equal(body.country, 'US'); assert.equal(body.region, 'CA'); assert.equal(body.currency, 'USD');
  assert.equal(body.customer.name, 'Ada'); assert.equal(body.expectedTotal, 53.25); assert.equal(body.storeId, store.id);
  assert.deepEqual(K.payReturn('?zt_checkout=success&session_id=cs_test_a1B2c3D4e5'), { status: 'success', sessionId: 'cs_test_a1B2c3D4e5', orderId: '' });
  assert.deepEqual(K.payReturn('?zt_checkout=cancel'), { status: 'cancel', sessionId: '', orderId: '' });
  assert.deepEqual(K.payReturn('?zt_checkout=pwned&session_id=<x>'), { status: null, sessionId: '', orderId: '' });
  assert.deepEqual(K.trackEvent({ type: 'add_to_cart', quantity: 2.7, path: 'p', at: 'a' }), { type: 'add_to_cart', path: 'p', at: 'a', quantity: 3 });
  // the serialised storefront script still parses and exposes the pay layer
  const CKs = new Function(commerceScript() + '\nreturn CK;')();
  assert.equal(typeof CKs.payRuntime, 'function'); assert.equal(CKs.payReady(cfg, 'email'), true);
});

test('storefront ↔ server: the backend engine prices a cart exactly like the storefront', () => {
  const { store, commerce } = payFixture();
  const cfg = checkoutConfig(store, commerce), K = commerceKit(applyDiscounts), p = store.products[0];
  const lines = [{ productId: p.id, variantId: p.variants[0].id, price: 29, quantity: 2 }];
  const input = { codes: ['SAVE10'], country: 'US', rateId: 'std' }, now = '2026-11-07T12:00:00Z';
  const snap = catalogSnapshot(store, commerce);
  assert.deepEqual(ServerCK.totals(snap.config, lines, input, now), K.totals(cfg, lines, input, now));
  assert.equal(ServerCK.totals(snap.config, lines, input, now).total, Math.round((58 - 5.8 + 6 + (58 - 5.8) * 0.05) * 100) / 100);
});

test('storefront: catalog snapshot for sync-catalog (prices, stock, services, digital; no secrets)', () => {
  const { store, commerce } = payFixture();
  store.products.push({ ...store.products[0], id: 'svc1', title: 'Call', kind: 'service', status: 'active', service: normalizeService({ pricing: { model: 'retainer', stripePriceId: 'price_x' }, intake: [{ label: 'Site', type: 'url', required: true }], addOns: [{ name: 'Rec', price: 30 }] }) });
  store.products.push({ ...store.products[0], id: 'dig1', title: 'Book', kind: 'digital', status: 'active', digital: { file: 'asset:abc', fileName: 'b.pdf', downloadLimit: 3 } });
  commerce.settings.domains = { primary: 'shop.example.com' };
  const s = catalogSnapshot(store, commerce);
  assert.equal(s.store.siteUrl, 'https://shop.example.com'); assert.deepEqual(s.store.allowedOrigins, ['https://shop.example.com']);
  const p0 = s.products[0];
  assert.equal(p0.price, store.products[0].price); assert.equal(p0.variants.length, store.products[0].variants.length);
  const svc = s.products.find(p => p.id === 'svc1'), dig = s.products.find(p => p.id === 'dig1');
  assert.equal(svc.kind, 'service'); assert.deepEqual(svc.recurring, { interval: 'month', intervalCount: 1 }); assert.equal(svc.service.intake[0].label, 'Site');
  assert.equal(dig.digital.file, '', 'app-local asset refs are not servable'); assert.equal(dig.digital.downloadLimit, 3);
  assert.equal(s.payments.connectType, 'express'); assert.equal(s.config.zones.length, 1);
  assert.deepEqual(serviceCheckout(store).svc1.addOns.map(a => a.name), ['Rec']);
  assert.doesNotMatch(JSON.stringify(s), /sk_(test|live)_|whsec_/);
});

// ---------- admin bridge (backend/client) ----------
test('backend client: rows → admin orders / bookings / projects survive the admin normalizers; merge is idempotent', async () => {
  const { backendToCommerce, mergeBackend } = await import('../backend/client/orders.js');
  const { normalizeOrder } = await import('../src/store/admin/model.js');
  const { normalizeBooking, normalizeProject } = await import('../src/store/admin/services.js');
  const row = { id: 'u1', number: 1001, status: 'open', financial_status: 'paid', fulfillment_status: 'unfulfilled', created_at: '2026-11-07T10:00:00Z', updated_at: '2026-11-07T10:05:00Z', paid_at: '2026-11-07T10:05:00Z',
    email: 'ada@x.io', phone: '', name: 'Ada', country: 'US', shipping_address: { name: 'Ada', address1: '1 St', city: 'X', country: 'US' }, codes: ['SAVE10'], shipping_rate_id: 'std', shipping_name: 'Standard',
    subtotal: '50.00', discount_total: '5.00', shipping: '6.00', shipping_discount: '0', tax: '2.25', tax_inclusive: false, total: '53.25', applied: [], stripe_payment_intent_id: 'pi_1',
    order_lines: [{ id: 'l1', position: 0, product_id: 'p', variant_id: 'v', title: 'Tee', variant_title: 'M', sku: 'T', unit_price: '25.00', quantity: 2 }], refunds: [{ id: 'r1', status: 'succeeded', amount_minor: 500, created_at: '2026-11-08T00:00:00Z', reason: '' }] };
  const doc = backendToCommerce([row], [{ id: 'b1', product_id: 'svc', starts_at: '2026-11-09T14:00:00Z', ends_at: '2026-11-09T15:00:00Z', timezone: 'UTC', status: 'requested', attendee: { name: 'Ada', email: 'ada@x.io' }, intake: [{ question: 'Q', answer: 'A' }], order_id: 'u1', price: '120', created_at: '2026-11-07T10:05:00Z' }],
    [{ id: 'j1', product_id: 'audit', title: 'Audit', stage: 'new', due_date: '2026-11-17', deliverables: ['Report'], client: { name: 'Ada', email: 'ada@x.io' }, order_id: 'u1', created_at: '2026-11-07T10:05:00Z', updated_at: '2026-11-07T10:05:00Z' }],
    { products: [{ id: 'svc', title: 'Strategy call' }] });
  const o = normalizeOrder(doc.orders[0]);
  assert.equal(o.id, 'sb_u1'); assert.equal(o.name, '#1001'); assert.equal(o.financialStatus, 'paid'); assert.equal(o.totals.total, 53.25); assert.equal(o.lines[0].price, 25); assert.equal(o.refunds[0].amount, 5);
  const b = normalizeBooking(doc.bookings[0]); assert.equal(b.status, 'requested'); assert.equal(b.title, 'Strategy call'); assert.equal(b.orderId, 'sb_u1'); assert.equal(b.intake[0].answer, 'A');
  const p = normalizeProject(doc.serviceProjects[0]); assert.equal(p.stage, 'new'); assert.equal(p.dueDate, '2026-11-17'); assert.equal(p.deliverables[0].label, 'Report');
  const once = mergeBackend({ orders: [], bookings: [], serviceProjects: [] }, doc), twice = mergeBackend(once, doc);
  assert.equal(twice.orders.length, 1); assert.equal(twice.bookings.length, 1); assert.equal(twice.serviceProjects.length, 1);
});

test('backend client: auth headers, token refresh, function calls', async () => {
  const { createBackend } = await import('../backend/client/api.js');
  const seen = [], mem = new Map(), storage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: k => mem.delete(k) };
  const fetchImpl = async (u, init) => {
    seen.push({ u, h: init.headers, body: init.body });
    const body = /grant_type=password/.test(u) ? { access_token: 'a1', refresh_token: 'r1', expires_in: 0 } : /grant_type=refresh_token/.test(u) ? { access_token: 'a2', refresh_token: 'r2', expires_in: 3600 } : { ok: true };
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  };
  const be = createBackend({ url: 'https://abcdefghijklmnop.supabase.co', anonKey: 'anon' }, { storage, fetchImpl });
  await be.signInWithPassword('ada@x.io', 'pw');
  assert.equal(be.signedIn(), true);
  await be.syncCatalog({ store: { id: 's1' } });
  const sync = seen.at(-1);
  assert.equal(sync.u, 'https://abcdefghijklmnop.supabase.co/functions/v1/sync-catalog'); assert.equal(sync.h.Authorization, 'Bearer a2', 'expired token refreshed first'); assert.equal(sync.h.apikey, 'anon');
  await be.fetchOrders('s1', { since: '2026-01-01T00:00:00Z' });
  assert.match(seen.at(-1).u, /\/rest\/v1\/orders\?store_id=eq\.s1&status=neq\.pending&updated_at=gt\.2026-01-01T00%3A00%3A00Z&select=\*,order_lines\(\*\),refunds\(\*\)/);
  const be2 = createBackend({ url: 'https://abcdefghijklmnop.supabase.co', anonKey: 'anon' }, { storage, fetchImpl });
  assert.equal(be2.signedIn(), true, 'session persisted');
});
