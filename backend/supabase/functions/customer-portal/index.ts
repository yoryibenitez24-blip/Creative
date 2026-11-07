// POST /functions/v1/customer-portal — Stripe Billing customer portal (manage subscriptions, payment methods, invoices).
// Two ways in:
//   shopper: { storeId, sessionId: 'cs_…', returnUrl } — the Checkout Session id from the success page proves the purchase;
//   owner:   { storeId, customerId: 'cus_…', returnUrl } with the owner's access token (to open a customer's portal).
// Needs settings.payments.stripe.billing.customerPortal = true and a portal configuration in the Stripe dashboard
// (Settings › Billing › Customer portal; on the connected account for Standard/direct charges).
// → { url }
import type Stripe from 'npm:stripe@23.1.0';
import { serve, stripe, loadStore, json, errorJson } from '../_shared/runtime.ts';
import { readJson, safeReturnBase } from '../_shared/http.ts';
import { requireOwner } from '../_shared/owner.ts';
import { createLimiter, clientIp } from '../_shared/ratelimit.ts';
import { connectMode, type StripePublicConfig } from '../_shared/checkout.ts';
import { idOf } from '../_shared/webhook.ts';

const limiter = createLimiter(10, 60_000);

serve(['POST'], async (req, cors) => {
  if (!limiter.hit(clientIp(req.headers)).allowed) return errorJson(429, 'rate_limited', 'Too many requests.', cors);
  const body = await readJson<{ storeId?: string; sessionId?: string; customerId?: string; returnUrl?: string }>(req);
  if (!body) return errorJson(400, 'bad_request', 'Invalid request.', cors);
  const store = await loadStore(body.storeId);
  if (!store) return errorJson(404, 'unknown_store', 'Unknown store.', cors);
  const pay = (store.payments || {}) as StripePublicConfig;
  if (!pay.billing?.customerPortal) return errorJson(409, 'portal_disabled', 'The customer portal is not enabled for this store.', cors);
  const reqOpts: Stripe.RequestOptions = connectMode(pay, store.stripe_account_id) === 'direct' && store.stripe_account_id ? { stripeAccount: store.stripe_account_id } : {};

  let customer: string | null = null;
  if (body.customerId) {
    const auth = await requireOwner(req, body.storeId, cors);
    if (!auth.ok) return auth.response;
    customer = /^cus_[A-Za-z0-9]{6,}$/.test(body.customerId) ? body.customerId : null;
  } else if (typeof body.sessionId === 'string' && /^cs_[A-Za-z0-9_]{8,250}$/.test(body.sessionId)) {
    const s = await stripe().checkout.sessions.retrieve(body.sessionId, {}, reqOpts);
    if (s.metadata?.store_id !== store.id) return errorJson(404, 'unknown_session', 'Unknown checkout session.', cors);
    customer = idOf(s.customer);
  }
  if (!customer) return errorJson(400, 'no_customer', 'No customer account was found for this purchase.', cors);
  const base = safeReturnBase(body.returnUrl, store.allowed_origins || [], store.site_url || '');
  const portal = await stripe().billingPortal.sessions.create({ customer, ...(base ? { return_url: base } : {}) }, reqOpts);
  return json({ url: portal.url }, 200, cors);
});
