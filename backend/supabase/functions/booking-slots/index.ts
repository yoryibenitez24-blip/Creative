// GET /functions/v1/booking-slots?store=<id>&product=<id>&from=YYYY-MM-DD&days=7 — free times of a bookable service.
// Same rules as the admin (bookingSlots in src/store/admin/services.js, bundled into _shared/services.js) applied to the
// bookings stored in the backend, so two shoppers cannot see a slot that is already booked (create-checkout-session
// checks the slot again before charging). → { timezone, durationMinutes, slots: [{ date, start, end }] }
import { serve, admin, json, errorJson } from '../_shared/runtime.ts';
import { createLimiter, clientIp } from '../_shared/ratelimit.ts';
import { bookingSlots, normalizeService, zonedDay } from '../_shared/services.js';

const limiter = createLimiter(60, 60_000);

serve(['GET'], async (req, cors) => {
  if (!limiter.hit(clientIp(req.headers)).allowed) return errorJson(429, 'rate_limited', 'Too many requests.', cors);
  const q = new URL(req.url).searchParams, store = q.get('store') || '', product = q.get('product') || '';
  if (!/^[\w-]{1,80}$/.test(store) || !/^[\w-]{1,120}$/.test(product)) return errorJson(400, 'bad_request', 'Invalid request.', cors);
  const db = admin();
  const { data: p } = await db.from('products').select('id, active, kind, service').eq('store_id', store).eq('id', product).maybeSingle();
  if (!p || !p.active || p.kind !== 'service') return errorJson(404, 'not_found', 'Unknown service.', cors);
  const svc = normalizeService(p.service);
  if (!svc.booking.enabled) return json({ timezone: svc.booking.timezone, durationMinutes: svc.durationMinutes, slots: [] }, 200, cors);
  const days = Math.max(1, Math.min(31, Number(q.get('days')) || 7)), now = Date.now();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(q.get('from') || '') && (q.get('from') as string) >= zonedDay(now, svc.booking.timezone) ? q.get('from') as string : zonedDay(now, svc.booking.timezone);
  const start = Date.parse(from + 'T00:00:00Z') - 2 * 86400_000, end = start + (days + 4) * 86400_000;
  const { data: busy } = await db.from('bookings').select('product_id, starts_at, ends_at, status').eq('store_id', store)
    .gte('ends_at', new Date(start).toISOString()).lte('starts_at', new Date(end).toISOString());
  const slots = bookingSlots({ id: p.id, service: svc }, { from, days, now, bookings: (busy || []).map(b => ({ productId: b.product_id, start: b.starts_at, end: b.ends_at, status: b.status })) });
  return json({ timezone: svc.booking.timezone, durationMinutes: svc.durationMinutes, slots }, 200, cors);
});
