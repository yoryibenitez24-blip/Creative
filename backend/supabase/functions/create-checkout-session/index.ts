// POST /functions/v1/create-checkout-session — called by the storefront's pay button (src/store/commerce.js payRuntime).
// Body: { storeId, checkoutId, currency, lines: [{ productId, variantId, quantity, price? }], codes, country, region, rateId,
//         customer: { name, email, phone }, note, returnUrl, turnstileToken, sessionRef, expectedTotal }
// → 200 { url (Stripe Checkout), orderId, sessionId, total, currency, adjusted } | 4xx { error: { code, message } }
//
// Never trusts the browser's prices: products come from the `products` snapshot (sync-catalog), discounts / shipping /
// tax are recomputed with the same engine as the storefront (engine.js), and the result is what Stripe charges.
import type Stripe from 'npm:stripe@23.1.0';
import { serve, admin, stripe, env, loadStore, json, errorJson } from '../_shared/runtime.ts';
import { readJson, corsHeaders, safeReturnBase, normalizeOrigin } from '../_shared/http.ts';
import { validateCart, needsShipping, type CatalogProduct } from '../_shared/cart.ts';
import { CK, type EngineConfig } from '../_shared/engine.js';
import { buildSessionParams, couponFor, connectMode, type StripePublicConfig } from '../_shared/checkout.ts';
import { canonicalCart, idempotencyKey, safeCheckoutId } from '../_shared/idempotency.ts';
import { verifyTurnstile } from '../_shared/turnstile.ts';
import { createLimiter, clientIp } from '../_shared/ratelimit.ts';
import { toMinor, roundMoney } from '../_shared/money.ts';

interface Body {
  storeId?: string; checkoutId?: string; lines?: unknown; codes?: unknown; country?: string; region?: string; rateId?: string | null;
  customer?: { name?: string; email?: string; phone?: string; address?: string }; note?: string; returnUrl?: string; turnstileToken?: string;
  sessionRef?: string; expectedTotal?: number | null;
}

const burst = createLimiter(20, 60_000);
const str = (v: unknown, n: number): string => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[A-Za-z]{2,}$/;

serve(['POST'], async (req, baseCors) => {
  const ip = clientIp(req.headers);
  if (!burst.hit('co:' + ip).allowed) return errorJson(429, 'rate_limited', 'Too many attempts. Please wait a minute and try again.', baseCors);
  const body = await readJson<Body>(req, 48 * 1024);
  if (!body || typeof body !== 'object') return errorJson(400, 'bad_request', 'Invalid request.', baseCors);
  const store = await loadStore(body.storeId);
  if (!store) return errorJson(404, 'unknown_store', 'This store is not connected to the payment backend yet.', baseCors);
  const cors = corsHeaders(req.headers.get('origin'), store.allowed_origins || []);
  const origin = req.headers.get('origin');
  const allowed = (store.allowed_origins || []).map(normalizeOrigin).filter(Boolean);
  if (allowed.length && origin && origin !== 'null' && !allowed.includes(normalizeOrigin(origin))) return errorJson(403, 'origin_not_allowed', 'Payments are not enabled for this website address.', cors);

  const pay = (store.payments || {}) as StripePublicConfig;
  if (!pay.enabled) return errorJson(409, 'payments_disabled', 'Online payments are not enabled for this store.', cors);
  const db = admin();
  const { data: rateOk, error: rateErr } = await db.rpc('hit_rate_limit', { p_key: `co:${store.id}:${ip}`, p_window_seconds: 600, p_max: 30 });
  if (rateErr) console.error('hit_rate_limit', rateErr.message);
  else if (rateOk === false) return errorJson(429, 'rate_limited', 'Too many attempts. Please wait a few minutes and try again.', cors);

  const tsSecret = env('TURNSTILE_SECRET_KEY');
  if (tsSecret) {
    const r = await verifyTurnstile(body.turnstileToken, tsSecret, ip, fetch, 'checkout');
    if (!r.success) return errorJson(403, 'bot_check_failed', 'The security check failed. Please try again.', cors, { reasons: r.errorCodes });
  }

  // ---- cart: products, variants, stock and prices from the stored snapshot ----
  const raw = Array.isArray(body.lines) ? body.lines.slice(0, 101) : [];
  const ids = [...new Set(raw.map(l => (l && typeof l === 'object' ? String((l as { productId?: unknown }).productId ?? '') : '')).filter(Boolean))].slice(0, 100);
  const { data: prods, error: pErr } = ids.length ? await db.from('products').select('id, title, active, price, image, kind, recurring, variants').eq('store_id', store.id).in('id', ids) : { data: [], error: null };
  if (pErr) throw pErr;
  const catalog: CatalogProduct[] = (prods || []).map(p => ({ ...p, price: Number(p.price) }));
  const cart = validateCart(raw, catalog);
  if (!cart.ok) return errorJson(409, 'cart_invalid', cart.errors[0]?.message || 'Your cart could not be checked out.', cors, { errors: cart.errors });

  // ---- totals: same engine as the storefront (discounts → shipping → tax) ----
  const cfg = (store.checkout_config || {}) as unknown as EngineConfig;
  const codes = (Array.isArray(body.codes) ? body.codes : []).filter((c): c is string => typeof c === 'string').map(c => c.trim().toUpperCase().slice(0, 40)).filter(Boolean).slice(0, 10);
  const country = /^([A-Z]{2}|\*)$/.test(str(body.country, 2).toUpperCase()) ? str(body.country, 2).toUpperCase() : '';
  const region = str(body.region, 100), rateId = body.rateId == null ? undefined : str(body.rateId, 80) || undefined;
  const ship = needsShipping(cart.lines); // services / digital goods only → no shipping charge ('none')
  const totals = CK.totals(cfg, cart.lines.map(l => ({ productId: l.productId, variantId: l.variantId, price: l.price, quantity: l.quantity, title: l.title })), { codes, country, region, rateId: ship ? rateId : 'none' }, Date.now());
  const zones = Array.isArray(cfg.zones) ? cfg.zones : [];
  if (ship && zones.length && !totals.shippingRateId)
    return errorJson(400, 'shipping_required', country ? 'Sorry, we do not ship to this country yet.' : 'Choose your shipping country to continue.', cors);
  const currency = store.currency || 'USD';

  // ---- money flow: platform / destination / direct ----
  const accountId = store.stripe_account_id || null;
  if (!accountId && env('REQUIRE_CONNECTED_ACCOUNT') === 'true') return errorJson(409, 'account_not_connected', 'This store has not finished setting up payments yet.', cors);
  if (accountId) {
    const { data: acct } = await db.from('connected_accounts').select('charges_enabled').eq('stripe_account_id', accountId).maybeSingle();
    if (acct && !acct.charges_enabled) return errorJson(409, 'account_not_ready', 'This store is still completing its payment setup. Please try again later.', cors);
  }
  const how = connectMode(pay, accountId), reqOpts: Stripe.RequestOptions = how === 'direct' && accountId ? { stripeAccount: accountId } : {};

  // ---- where Stripe sends the shopper back ----
  const base = safeReturnBase(body.returnUrl, store.allowed_origins || [], store.site_url || '');
  if (!base) return errorJson(400, 'no_return_url', 'Card payments work once the store is published at an https:// address (set it in Settings › Domains).', cors);
  const successUrl = base + 'checkout.html?zt_checkout=success&session_id={CHECKOUT_SESSION_ID}', cancelUrl = base + 'cart.html?zt_checkout=cancel';

  // ---- one pending order per checkout attempt (idempotent across double clicks and retries) ----
  const email = EMAIL.test(str(body.customer?.email, 200)) ? str(body.customer?.email, 200).toLowerCase() : '';
  const checkoutId = safeCheckoutId(body.checkoutId);
  let key = await idempotencyKey('zt_cs', canonicalCart({ storeId: store.id, checkoutId, lines: cart.lines, codes: totals.appliedCodes, country, region, rateId: totals.shippingRateId, email, currency }));
  let orderId: string | null = null;
  const { data: prev } = await db.from('orders').select('id, stripe_checkout_session_id').eq('store_id', store.id).eq('idempotency_key', key).maybeSingle();
  if (prev?.stripe_checkout_session_id) {
    const s = await stripe().checkout.sessions.retrieve(prev.stripe_checkout_session_id, {}, reqOpts);
    if (s.status === 'open' && s.url) return json({ url: s.url, orderId: prev.id, sessionId: s.id, reused: true }, 200, cors);
    if (s.status === 'complete') return json({ url: successUrl.replace('{CHECKOUT_SESSION_ID}', s.id), orderId: prev.id, alreadyPaid: true }, 200, cors);
    key = `${key}_${Date.now().toString(36)}`; // expired: start a fresh session
  } else if (prev) orderId = prev.id;

  const mode = cart.lines.some(l => l.recurring) && pay.billing?.subscriptions !== false ? 'subscription' : 'payment';
  if (!orderId) {
    orderId = crypto.randomUUID();
    const { error: oErr } = await db.from('orders').insert({
      id: orderId, store_id: store.id, currency, subtotal: totals.subtotal, discount_total: totals.discountTotal, shipping: totals.shipping, shipping_discount: totals.shippingDiscount,
      tax: pay.automaticTax ? 0 : totals.tax, tax_inclusive: totals.taxInclusive, total: pay.automaticTax && !totals.taxInclusive ? roundMoney(totals.total - totals.tax) : totals.total,
      codes: totals.appliedCodes, applied: totals.applied, shipping_rate_id: totals.shippingRateId, shipping_name: totals.shippingName, country: country === '*' ? '' : country, region,
      email, name: str(body.customer?.name, 200), phone: str(body.customer?.phone, 50), note: str(body.note, 1000), checkout_mode: mode,
      stripe_account_id: accountId, livemode: pay.mode === 'live', source: 'storefront', session_ref: str(body.sessionRef, 64), idempotency_key: key,
      metadata: { checkoutId, ...(cart.priceChanges.length ? { priceChanges: cart.priceChanges } : {}) },
    });
    if (oErr) {
      if (oErr.code === '23505') return errorJson(409, 'busy', 'Your payment is already being prepared. Please try again in a moment.', cors);
      throw oErr;
    }
    const { error: lErr } = await db.from('order_lines').insert(cart.lines.map((l, i) => ({
      order_id: orderId, store_id: store.id, position: i, product_id: l.productId, variant_id: l.variantId, title: l.title, variant_title: l.variantTitle, sku: l.sku,
      unit_price: l.price, quantity: l.quantity, total: roundMoney(l.price * l.quantity), recurring: l.recurring,
    })));
    if (lErr) throw lErr;
  }

  // free order (100 % discount): nothing to charge
  if (mode === 'payment' && toMinor(totals.total, currency) === 0) {
    await db.from('orders').update({ status: 'open', financial_status: 'paid', paid_at: new Date().toISOString() }).eq('id', orderId);
    return json({ url: base + 'checkout.html?zt_checkout=success&order=' + orderId, orderId, free: true }, 200, cors);
  }

  const cp = couponFor(totals, currency, orderId);
  const coupon = cp ? await stripe().coupons.create(cp, { ...reqOpts, idempotencyKey: key + ':coupon' }) : null;
  const built = buildSessionParams({
    orderId, storeId: store.id, currency, lines: cart.lines, totals, cfg: pay, accountId, successUrl, cancelUrl, country,
    zoneCountries: zones.flatMap(z => z.countries || []), customerEmail: email || undefined, couponId: coupon?.id ?? null,
    feeEnvPercent: env('PLATFORM_FEE_PERCENT') || null, sessionRef: str(body.sessionRef, 64), siteBase: store.site_url || base,
  });
  const session = await stripe().checkout.sessions.create(built.params, { ...reqOpts, idempotencyKey: key });
  await db.from('orders').update({ stripe_checkout_session_id: session.id, application_fee_minor: built.applicationFeeMinor, amount_total_minor: session.amount_total }).eq('id', orderId);
  const expected = typeof body.expectedTotal === 'number' ? body.expectedTotal : null;
  return json({ url: session.url, orderId, sessionId: session.id, total: totals.total, currency, adjusted: expected != null && Math.abs(expected - totals.total) > 0.004 }, 200, cors);
});
