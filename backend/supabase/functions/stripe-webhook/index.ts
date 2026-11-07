// POST /functions/v1/stripe-webhook — Stripe → backend. Deploy with --no-verify-jwt (Stripe sends no Supabase token).
// Verifies the Stripe-Signature header with STRIPE_WEBHOOK_SECRET (platform endpoint) or STRIPE_CONNECT_WEBHOOK_SECRET
// (Connect endpoint, "events on connected accounts" — needed for direct charges / Standard accounts), then applies the
// event idempotently: webhooks_log has one row per event id, and every write is an upsert keyed by a Stripe id.
// Returns 2xx once handled (or deliberately ignored); 5xx makes Stripe retry with back-off.
import type Stripe from 'npm:stripe@23.1.0';
import { serve, admin, stripe, cryptoProvider, env, ConfigError, json, errorJson, type Db } from '../_shared/runtime.ts';
import { verifySignature } from '../_shared/signature.ts';
import { orderPatchFromSession, financialFromIntent, paymentRow, refundRow, disputeRow, subscriptionRow, financialAfterRefunds, orderRef, idOf } from '../_shared/webhook.ts';
import { connectSummary, connectedAccountRow } from '../_shared/connect.ts';
import { afterPaid } from '../_shared/orders.ts';

const PAID_STATES = ['paid', 'partially_refunded', 'refunded'];

serve(['POST'], async (req) => {
  const secrets = [env('STRIPE_WEBHOOK_SECRET'), env('STRIPE_CONNECT_WEBHOOK_SECRET')].filter(Boolean);
  if (!secrets.length) throw new ConfigError('STRIPE_WEBHOOK_SECRET is not set. Run: supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_…');
  const raw = await req.text(), sig = req.headers.get('stripe-signature') || '';
  // cheap pre-check picks the matching secret; the official verifier then parses the event
  let secret = '';
  for (const s of secrets) if ((await verifySignature(raw, sig, s)).ok) { secret = s; break; }
  if (!secret) return errorJson(400, 'bad_signature', 'Invalid Stripe signature.');
  const event = await stripe().webhooks.constructEventAsync(raw, sig, secret, undefined, cryptoProvider);

  const db = admin();
  const log = { id: event.id, type: event.type, account: event.account ?? null, livemode: event.livemode, api_version: event.api_version, payload: event as unknown as Record<string, unknown> };
  const { error: insErr } = await db.from('webhooks_log').insert(log);
  if (insErr) {
    if (insErr.code !== '23505') throw insErr;
    const { data: row } = await db.from('webhooks_log').select('status, attempts').eq('id', event.id).maybeSingle();
    if (row && (row.status === 'processed' || row.status === 'ignored')) return json({ received: true, duplicate: true });
    await db.from('webhooks_log').update({ attempts: (row?.attempts || 1) + 1 }).eq('id', event.id);
  }
  try {
    const handled = await handle(db, event);
    await db.from('webhooks_log').update({ status: handled ? 'processed' : 'ignored', processed_at: new Date().toISOString(), error: null }).eq('id', event.id);
    return json({ received: true, handled });
  } catch (e) {
    await db.from('webhooks_log').update({ status: 'failed', error: String((e as Error)?.message || e).slice(0, 2000) }).eq('id', event.id);
    throw e; // 500 → Stripe retries
  }
});

async function orderById(db: Db, id: string | null) {
  if (!id) return null;
  const { data } = await db.from('orders').select('id, store_id, financial_status, status, amount_total_minor, paid_at').eq('id', id).maybeSingle();
  return data;
}
async function orderByIntent(db: Db, pi: string | null) {
  if (!pi) return null;
  const { data } = await db.from('orders').select('id, store_id, financial_status, status, amount_total_minor, paid_at').eq('stripe_payment_intent_id', pi).maybeSingle();
  return data;
}

async function upsertCustomer(db: Db, storeId: string, s: Stripe.Checkout.Session): Promise<string | null> {
  const email = s.customer_details?.email?.toLowerCase();
  if (!email) return null;
  const ship = s.collected_information?.shipping_details;
  const row: Record<string, unknown> = { store_id: storeId, email, name: s.customer_details?.name || '', phone: s.customer_details?.phone || '' };
  const cust = idOf(s.customer); if (cust) row.stripe_customer_id = cust;
  if (ship?.address) row.address = { name: ship.name, address1: ship.address.line1 || '', address2: ship.address.line2 || '', city: ship.address.city || '', province: ship.address.state || '', zip: ship.address.postal_code || '', country: ship.address.country || '' };
  const { data, error } = await db.from('customers').upsert(row, { onConflict: 'store_id,email' }).select('id').maybeSingle();
  if (error) { console.error('customer upsert', error.message); return null; }
  return data?.id ?? null;
}

async function handle(db: Db, event: Stripe.Event): Promise<boolean> {
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
    case 'checkout.session.async_payment_failed':
    case 'checkout.session.expired': {
      const s = event.data.object;
      const ref = orderRef(s.metadata);
      const order = await orderById(db, ref.orderId || s.client_reference_id);
      if (!order) return false; // not created by create-checkout-session (e.g. a Payment Link)
      const patch = orderPatchFromSession(s, event.type);
      if (PAID_STATES.includes(order.financial_status) && patch.financial_status && patch.financial_status !== 'paid') delete patch.financial_status;
      if (event.type === 'checkout.session.expired' && order.status !== 'pending') return true;
      if (event.type !== 'checkout.session.expired') { const cid = await upsertCustomer(db, order.store_id, s); if (cid) patch.customer_id = cid; }
      if (order.paid_at) delete patch.paid_at;
      const { error } = await db.from('orders').update(patch).eq('id', order.id);
      if (error) throw error;
      if (patch.financial_status === 'paid' && !PAID_STATES.includes(order.financial_status)) await afterPaid(db, order.id);
      return true;
    }
    case 'payment_intent.succeeded':
    case 'payment_intent.payment_failed':
    case 'payment_intent.canceled':
    case 'payment_intent.amount_capturable_updated': {
      const pi = event.data.object;
      const ref = orderRef(pi.metadata);
      const order = (await orderById(db, ref.orderId)) || (await orderByIntent(db, pi.id));
      if (!order) return false;
      const { error } = await db.from('payments').upsert(paymentRow(pi, order.store_id, order.id, event.account ?? null), { onConflict: 'stripe_payment_intent_id' });
      if (error) throw error;
      const fin = financialFromIntent(pi);
      const patch: Record<string, unknown> = { stripe_payment_intent_id: pi.id };
      if (fin && !(PAID_STATES.includes(order.financial_status) && fin !== 'paid') && !(fin === 'failed' && order.financial_status !== 'pending')) patch.financial_status = fin;
      if (fin === 'paid' && !order.paid_at) { patch.paid_at = new Date().toISOString(); patch.status = 'open'; }
      if (fin === 'authorized') patch.status = 'open';
      await db.from('orders').update(patch).eq('id', order.id);
      if (fin === 'paid' && !PAID_STATES.includes(order.financial_status)) await afterPaid(db, order.id);
      return true;
    }
    case 'charge.refunded': {
      const ch = event.data.object;
      const order = await orderByIntent(db, idOf(ch.payment_intent));
      if (!order) return false;
      await db.from('orders').update({ financial_status: financialAfterRefunds(ch.amount_captured || ch.amount, ch.amount_refunded) }).eq('id', order.id);
      return true;
    }
    case 'refund.created':
    case 'refund.updated':
    case 'refund.failed': {
      const r = event.data.object;
      const order = await orderByIntent(db, idOf(r.payment_intent));
      if (!order) return false;
      const { error } = await db.from('refunds').upsert(refundRow(r, order.store_id, order.id), { onConflict: 'stripe_refund_id' });
      if (error) throw error;
      return true;
    }
    case 'charge.dispute.created':
    case 'charge.dispute.updated':
    case 'charge.dispute.closed': {
      const d = event.data.object;
      const order = await orderByIntent(db, idOf(d.payment_intent));
      if (!order) return false;
      const { error } = await db.from('disputes').upsert(disputeRow(d, order.store_id, order.id), { onConflict: 'stripe_dispute_id' });
      if (error) throw error;
      return true;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
    case 'customer.subscription.paused':
    case 'customer.subscription.resumed': {
      const sub = event.data.object;
      const ref = orderRef(sub.metadata);
      const order = await orderById(db, ref.orderId);
      const storeId = order?.store_id || ref.storeId;
      if (!storeId) return false;
      const { data: st } = await db.from('stores').select('id').eq('id', storeId).maybeSingle();
      if (!st) return false;
      const { error } = await db.from('subscriptions').upsert(subscriptionRow(sub, storeId, order?.id ?? null), { onConflict: 'stripe_subscription_id' });
      if (error) throw error;
      return true;
    }
    case 'account.updated': {
      const a = event.data.object;
      const { data: st } = await db.from('stores').select('id, owner_id').eq('stripe_account_id', a.id).maybeSingle();
      const { error } = await db.from('connected_accounts').upsert(connectedAccountRow(connectSummary(a), st?.id ?? null, st?.owner_id ?? null), { onConflict: 'stripe_account_id' });
      if (error) throw error;
      return true;
    }
    case 'account.application.deauthorized': {
      if (!event.account) return false;
      await db.from('stores').update({ stripe_account_id: null }).eq('stripe_account_id', event.account);
      await db.from('connected_accounts').update({ charges_enabled: false, payouts_enabled: false, onboarding_status: 'rejected' }).eq('stripe_account_id', event.account);
      return true;
    }
    default:
      return false; // logged as 'ignored' (invoice.*, payout.*, …)
  }
}
