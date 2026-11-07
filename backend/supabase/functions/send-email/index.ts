// POST /functions/v1/send-email — (re)send an order confirmation.
// Auth: the store owner's access token, or the service-role key (server-to-server).
// Body: { orderId, force?: boolean }   → { ok, skipped?, error? }
// The webhook sends confirmations itself when an order is paid; this endpoint is for "Resend confirmation" in the
// admin and for testing the email setup. Provider by secret: RESEND_API_KEY | SENDGRID_API_KEY | POSTMARK_SERVER_TOKEN
// (POSTMARK_TOKEN also accepted); sender: Settings › Integrations › Email "from" address, or the EMAIL_FROM secret.
import { serve, admin, env, json, errorJson } from '../_shared/runtime.ts';
import { readJson, bearer } from '../_shared/http.ts';
import { requireOwner } from '../_shared/owner.ts';
import { sendOrderConfirmation } from '../_shared/orders.ts';

serve(['POST'], async (req, cors) => {
  const body = await readJson<{ orderId?: string; force?: boolean }>(req);
  if (!body || typeof body.orderId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.orderId)) return errorJson(400, 'bad_request', 'orderId is required.', cors);
  const db = admin();
  const { data: order } = await db.from('orders').select('id, store_id').eq('id', body.orderId).maybeSingle();
  if (!order) return errorJson(404, 'not_found', 'Order not found.', cors);
  const service = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!(service && bearer(req) === service)) {
    const auth = await requireOwner(req, order.store_id, cors);
    if (!auth.ok) return auth.response;
  }
  const r = await sendOrderConfirmation(db, order.id, !!body.force);
  return json(r, r.ok ? 200 : 502, cors);
});
