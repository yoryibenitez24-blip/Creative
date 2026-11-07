// Stripe objects → database rows for the webhook (pure, so the mapping is unit-tested without Stripe or Postgres).
import type Stripe from 'npm:stripe@23.1.0';
import { fromMinor } from './money.ts';

export const HANDLED_EVENTS = [
  'checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed', 'checkout.session.expired',
  'payment_intent.succeeded', 'payment_intent.payment_failed', 'payment_intent.canceled', 'payment_intent.amount_capturable_updated',
  'charge.refunded', 'refund.created', 'refund.updated', 'refund.failed',
  'charge.dispute.created', 'charge.dispute.updated', 'charge.dispute.closed',
  'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted', 'customer.subscription.paused', 'customer.subscription.resumed',
  'invoice.paid', 'invoice.payment_failed',
  'account.updated', 'account.application.deauthorized',
] as const;

export const idOf = (x: string | { id: string } | null | undefined): string | null => (x == null ? null : typeof x === 'string' ? x : x.id);
const iso = (sec: number | null | undefined): string | null => (sec ? new Date(sec * 1000).toISOString() : null);

export type Financial = 'pending' | 'authorized' | 'paid' | 'partially_refunded' | 'refunded' | 'voided' | 'failed';

/** Address in the admin's shape (src/store/admin/model.js Address). */
export function addressOf(name: string | null | undefined, a: Stripe.Address | null | undefined, phone?: string | null) {
  if (!a) return null;
  return { name: name || '', company: '', address1: a.line1 || '', address2: a.line2 || '', city: a.city || '', province: a.state || '', zip: a.postal_code || '', country: a.country || '', phone: phone || '' };
}

/** Order patch for checkout.session.completed / async_payment_* / expired. */
export function orderPatchFromSession(s: Stripe.Checkout.Session, type: string) {
  const cd = s.customer_details, ship = s.collected_information?.shipping_details || null;
  const patch: Record<string, unknown> = {
    stripe_checkout_session_id: s.id, stripe_payment_intent_id: idOf(s.payment_intent), stripe_subscription_id: idOf(s.subscription), stripe_customer_id: idOf(s.customer),
    livemode: s.livemode,
  };
  if (cd?.email) patch.email = cd.email.toLowerCase();
  if (cd?.name) patch.name = cd.name;
  if (cd?.phone) patch.phone = cd.phone;
  if (cd?.address) patch.billing_address = addressOf(cd.name, cd.address, cd.phone);
  if (ship?.address) patch.shipping_address = addressOf(ship.name, ship.address, cd?.phone);
  if (s.amount_total != null) { patch.amount_total_minor = s.amount_total; if (s.currency) patch.total = fromMinor(s.amount_total, s.currency); }
  if (s.total_details?.amount_tax && s.currency && s.automatic_tax?.enabled) patch.tax = fromMinor(s.total_details.amount_tax, s.currency);
  if (s.total_details?.amount_discount && s.currency && s.allow_promotion_codes) patch.discount_total = fromMinor(s.total_details.amount_discount, s.currency);
  if (type === 'checkout.session.expired') { patch.status = 'cancelled'; patch.cancelled_at = new Date().toISOString(); return patch; }
  if (type === 'checkout.session.async_payment_failed') { patch.financial_status = 'failed'; return patch; }
  patch.status = 'open';
  if (s.payment_status === 'paid' || s.payment_status === 'no_payment_required') { patch.financial_status = 'paid'; patch.paid_at = new Date().toISOString(); }
  return patch;
}

export function financialFromIntent(pi: Pick<Stripe.PaymentIntent, 'status' | 'last_payment_error'>): Financial | null {
  switch (pi.status) {
    case 'succeeded': return 'paid';
    case 'requires_capture': return 'authorized';
    case 'canceled': return 'voided';
    case 'requires_payment_method': return pi.last_payment_error ? 'failed' : null;
    default: return null;
  }
}

export function paymentRow(pi: Stripe.PaymentIntent, storeId: string, orderId: string | null, account: string | null) {
  const ch = idOf(pi.latest_charge);
  return {
    store_id: storeId, order_id: orderId, stripe_payment_intent_id: pi.id, stripe_charge_id: ch, stripe_account_id: account,
    amount_minor: pi.amount, amount_received_minor: pi.amount_received, currency: pi.currency.toUpperCase(), status: pi.status,
    capture_method: pi.capture_method, payment_method_type: pi.payment_method_types?.[0] || '',
    application_fee_minor: pi.application_fee_amount || 0, livemode: pi.livemode,
  };
}

export function refundRow(r: Stripe.Refund, storeId: string, orderId: string | null) {
  return {
    store_id: storeId, order_id: orderId, stripe_refund_id: r.id, stripe_charge_id: idOf(r.charge), stripe_payment_intent_id: idOf(r.payment_intent),
    amount_minor: r.amount, currency: r.currency.toUpperCase(), status: r.status || 'pending', reason: r.reason || '',
  };
}

/** Financial status after refunds: refundedMinor = sum of succeeded refunds. */
export function financialAfterRefunds(chargedMinor: number, refundedMinor: number): Financial {
  if (refundedMinor <= 0) return 'paid';
  return refundedMinor >= chargedMinor ? 'refunded' : 'partially_refunded';
}

export function disputeRow(d: Stripe.Dispute, storeId: string, orderId: string | null) {
  return {
    store_id: storeId, order_id: orderId, stripe_dispute_id: d.id, stripe_charge_id: idOf(d.charge), stripe_payment_intent_id: idOf(d.payment_intent),
    amount_minor: d.amount, currency: d.currency.toUpperCase(), reason: d.reason || '', status: d.status, evidence_due_by: iso(d.evidence_details?.due_by),
  };
}

export function subscriptionRow(sub: Stripe.Subscription, storeId: string, orderId: string | null) {
  const items = sub.items.data.map(it => ({
    price: it.price.id, product: idOf(it.price.product), quantity: it.quantity ?? 1, unit_amount: it.price.unit_amount,
    interval: it.price.recurring?.interval || null, interval_count: it.price.recurring?.interval_count || null, current_period_end: iso(it.current_period_end),
  }));
  const periodEnd = sub.items.data.reduce<number | null>((m, it) => (it.current_period_end && (!m || it.current_period_end < m) ? it.current_period_end : m), null);
  return {
    store_id: storeId, ...(orderId ? { order_id: orderId } : {}), stripe_subscription_id: sub.id, stripe_customer_id: idOf(sub.customer), status: sub.status, items,
    cancel_at_period_end: sub.cancel_at_period_end, current_period_end: iso(periodEnd), trial_end: iso(sub.trial_end), canceled_at: iso(sub.canceled_at), livemode: sub.livemode,
  };
}

/** Metadata the checkout puts on sessions, payment intents and subscriptions. */
export function orderRef(meta: Stripe.Metadata | null | undefined): { orderId: string | null; storeId: string | null } {
  const m = meta || {};
  const ok = (v: string | undefined) => (v && v.length <= 80 ? v : null);
  return { orderId: ok(m.order_id), storeId: ok(m.store_id) };
}
