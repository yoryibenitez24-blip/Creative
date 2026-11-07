// POST /functions/v1/track — first-party storefront analytics (deploy with --no-verify-jwt; sendBeacon sends no headers).
// Body (text/plain or JSON): { storeId, sessionId, events: [...] } — see _shared/track.ts. Always answers 204 quickly;
// rate limited per IP (in memory) and per IP + store (database). The raw IP is never stored: only a SHA-256 of
// IP + TRACK_SALT + the current day, so visitors cannot be followed across days.
import { serve, admin, env } from '../_shared/runtime.ts';
import { readJson } from '../_shared/http.ts';
import { createLimiter, clientIp } from '../_shared/ratelimit.ts';
import { sha256Hex } from '../_shared/idempotency.ts';
import { eventRows, headerCountry } from '../_shared/track.ts';

const perIp = createLimiter(120, 60_000);
const known = new Map<string, number>(); // storeId → checked at (ms); avoids a lookup per beacon
const STORE_TTL = 5 * 60_000;

serve(['POST'], async (req, cors) => {
  const done = new Response(null, { status: 204, headers: cors });
  const ip = clientIp(req.headers);
  if (!perIp.hit(ip || 'unknown').allowed) return done;
  const body = await readJson<{ storeId?: unknown }>(req, 16 * 1024);
  const storeId = typeof body?.storeId === 'string' && /^[\w-]{1,80}$/.test(body.storeId) ? body.storeId : '';
  if (!storeId) return done;
  const db = admin(), now = Date.now();
  if (!(known.get(storeId)! > now - STORE_TTL)) {
    const { data } = await db.from('stores').select('id').eq('id', storeId).maybeSingle();
    if (!data) return done;
    known.set(storeId, now);
    if (known.size > 5000) known.clear();
  }
  const { data: ok } = await db.rpc('hit_rate_limit', { p_key: `tr:${storeId}:${ip}`, p_window_seconds: 600, p_max: 600 });
  if (ok === false) return done;
  const day = new Date(now).toISOString().slice(0, 10);
  const ipHash = ip ? (await sha256Hex(`${ip}|${env('TRACK_SALT') || 'zertake'}|${day}`)).slice(0, 32) : '';
  const rows = eventRows(body, { storeId, ipHash, country: headerCountry(req.headers), userAgent: req.headers.get('user-agent') || '', now });
  if (rows.length) {
    const { error } = await db.from('analytics_events').insert(rows);
    if (error) console.error('track insert', error.message);
  }
  return done;
});
