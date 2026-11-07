// GET /functions/v1/order-status?store=<id>&session_id=cs_…  (or &order=<uuid> for free orders)
// Used by the storefront's success page. The Checkout Session id (only the buyer's browser has it) is the key; the
// answer is minimal and the email address is masked.
// → { order: { number, status, financialStatus, total, currency, email } } | 404
import { serve, admin, json, errorJson, downloadUrl } from '../_shared/runtime.ts';
import { createLimiter, clientIp } from '../_shared/ratelimit.ts';
import { maskEmail } from '../_shared/http.ts';

const limiter = createLimiter(30, 60_000);

serve(['GET'], async (req, cors) => {
  if (!limiter.hit(clientIp(req.headers)).allowed) return errorJson(429, 'rate_limited', 'Too many requests.', cors);
  const q = new URL(req.url).searchParams, store = q.get('store') || '', sid = q.get('session_id') || '', oid = q.get('order') || '';
  if (!/^[\w-]{1,80}$/.test(store) || !(/^cs_[A-Za-z0-9_]{8,250}$/.test(sid) || /^[0-9a-f-]{36}$/i.test(oid))) return errorJson(400, 'bad_request', 'Invalid request.', cors);
  const db = admin();
  let query = db.from('orders').select('id, number, status, financial_status, total, currency, email').eq('store_id', store);
  query = sid ? query.eq('stripe_checkout_session_id', sid) : query.eq('id', oid).eq('total', 0);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) return errorJson(404, 'not_found', 'Order not found yet.', cors);
  let downloads: { title: string; url: string }[] = [];
  if (data.financial_status === 'paid' || data.financial_status === 'partially_refunded') {
    const { data: dl } = await db.from('digital_downloads').select('title, token').eq('order_id', data.id);
    downloads = (dl || []).map(d => ({ title: d.title, url: downloadUrl(d.token) }));
  }
  return json({ order: { number: data.number, status: data.status, financialStatus: data.financial_status, total: Number(data.total), currency: data.currency, email: maskEmail(data.email), downloads } }, 200, cors);
});
