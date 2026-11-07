// Order side effects shared by stripe-webhook and send-email (Deno; database + email provider).
import type { Db, StoreRow } from './runtime.ts';
import { env, downloadUrl } from './runtime.ts';
import { orderConfirmation, sendMail, type OrderForEmail } from './email.ts';
import { normalizeService, normalizeDigital } from './services.js';
import { serviceRecords, type PaidLine } from './fulfil.ts';

export function emailEnv() {
  return { EMAIL_PROVIDER: env('EMAIL_PROVIDER'), RESEND_API_KEY: env('RESEND_API_KEY'), SENDGRID_API_KEY: env('SENDGRID_API_KEY'), POSTMARK_TOKEN: env('POSTMARK_SERVER_TOKEN') || env('POSTMARK_TOKEN') };
}

/** Send the order confirmation once (orders.email_sent_at guards against duplicates). force = resend. */
export async function sendOrderConfirmation(db: Db, orderId: string, force = false): Promise<{ ok: boolean; skipped?: string; error?: string }> {
  const { data: order, error } = await db.from('orders').select('*').eq('id', orderId).maybeSingle();
  if (error) throw error;
  if (!order) return { ok: false, error: 'order not found' };
  if (order.email_sent_at && !force) return { ok: true, skipped: 'already sent' };
  if (!order.email) return { ok: false, skipped: 'no customer email' };
  const { data: store } = await db.from('stores').select('*').eq('id', order.store_id).maybeSingle();
  const st = (store || {}) as Partial<StoreRow>, em = (st.email || {}) as { fromEmail?: string; replyTo?: string; senderName?: string; orderPrefix?: string; provider?: string };
  const ev = emailEnv();
  if (!ev.EMAIL_PROVIDER) {
    if (em.provider === 'none' && !force) return { ok: true, skipped: 'email provider set to none in Settings' };
    if (em.provider && em.provider !== 'none') ev.EMAIL_PROVIDER = em.provider;
  }
  const fromEmail = em.fromEmail || env('EMAIL_FROM');
  if (!fromEmail) return { ok: false, skipped: 'no sender address (Settings › Integrations › Email, or EMAIL_FROM)' };
  const { data: lines } = await db.from('order_lines').select('product_id, title, variant_title, quantity, unit_price, total').eq('order_id', orderId).order('position');
  const o: OrderForEmail = {
    number: order.number, currency: order.currency, email: order.email, name: order.name, lines: (lines || []).map(l => ({ ...l, unit_price: +l.unit_price, total: +l.total })),
    subtotal: +order.subtotal, discount_total: +order.discount_total, shipping: +order.shipping, tax: +order.tax, tax_inclusive: order.tax_inclusive, total: +order.total,
    shipping_name: order.shipping_name, codes: order.codes, shipping_address: order.shipping_address,
  };
  const { data: dls } = await db.from('digital_downloads').select('title, token').eq('order_id', orderId);
  const { data: bks } = await db.from('bookings').select('product_id, starts_at, timezone').eq('order_id', orderId);
  o.downloads = (dls || []).map(d => ({ title: d.title, url: downloadUrl(d.token) }));
  o.bookings = (bks || []).map(b => ({ title: o.lines.find(l => (l as { product_id?: string }).product_id === b.product_id)?.title || 'Session', start: b.starts_at, timezone: b.timezone }));
  const name = em.senderName || st.name || 'Store';
  const mail = orderConfirmation(o, { name: st.name || name, siteUrl: st.site_url || '', replyTo: em.replyTo, orderPrefix: em.orderPrefix });
  const res = await sendMail(ev, { to: order.email, from: `${name.replace(/[<>"]/g, '')} <${fromEmail}>`, replyTo: em.replyTo || undefined, ...mail, tag: 'order-confirmation' }, fetch);
  if (res.ok) await db.from('orders').update({ email_sent_at: new Date().toISOString() }).eq('id', orderId);
  else console.error('order email failed', orderId, res.error);
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}

/** After an order became paid: stock in the catalog snapshot, analytics `order_placed`, confirmation email. */
export async function afterPaid(db: Db, orderId: string): Promise<void> {
  const { data: order } = await db.from('orders').select('id, store_id, total, session_ref, metadata').eq('id', orderId).maybeSingle();
  if (!order || order.metadata?.after_paid) return;
  await db.from('orders').update({ metadata: { ...(order.metadata || {}), after_paid: new Date().toISOString() } }).eq('id', orderId);
  const { data: lines } = await db.from('order_lines').select('product_id, variant_id, quantity').eq('order_id', orderId);
  for (const l of lines || []) {
    const { error } = await db.rpc('decrement_stock', { p_store_id: order.store_id, p_product_id: l.product_id, p_variant_id: l.variant_id, p_qty: l.quantity });
    if (error) console.error('decrement_stock', error.message);
  }
  await db.from('analytics_events').insert({ store_id: order.store_id, type: 'order_placed', session_id: order.session_ref || '', value: order.total, order_id: order.id, path: 'checkout.html' });
  await fulfilServices(db, orderId).catch(e => console.error('services', e));
  await sendOrderConfirmation(db, orderId).catch(e => console.error('order email', e));
}

/** Paid order → bookings (status 'requested'), service projects (stage 'new') and digital download grants. Idempotent. */
export async function fulfilServices(db: Db, orderId: string): Promise<void> {
  const { data: order } = await db.from('orders').select('id, store_id, customer_id, name, email, phone, paid_at').eq('id', orderId).maybeSingle();
  if (!order) return;
  const { data: lines } = await db.from('order_lines').select('product_id, title, quantity, kind, details').eq('order_id', orderId).in('kind', ['service', 'digital']);
  if (!lines?.length) return;
  const ids = [...new Set(lines.map(l => l.product_id))];
  const { data: prods } = await db.from('products').select('id, title, service, digital').eq('store_id', order.store_id).in('id', ids);
  const byId = new Map((prods || []).map(p => [p.id, { id: p.id, title: p.title, service: p.service ? normalizeService(p.service) : null, digital: p.digital ? normalizeDigital(p.digital) : null }]));
  const recs = serviceRecords(order, lines as PaidLine[], byId, Date.now());
  const [{ count: hasB }, { count: hasP }] = await Promise.all([
    db.from('bookings').select('id', { count: 'exact', head: true }).eq('order_id', orderId),
    db.from('service_projects').select('id', { count: 'exact', head: true }).eq('order_id', orderId),
  ]);
  if (recs.bookings.length && !hasB) { const { error } = await db.from('bookings').insert(recs.bookings); if (error) throw error; }
  if (recs.projects.length && !hasP) { const { error } = await db.from('service_projects').insert(recs.projects); if (error) throw error; }
  if (recs.downloads.length) { const { error } = await db.from('digital_downloads').upsert(recs.downloads, { onConflict: 'order_id,product_id', ignoreDuplicates: true }); if (error) throw error; }
}
