// Analytics ingest: storefront events → analytics_events rows (pure).
// The storefront (payRuntime in src/store/commerce.js) sends { storeId, sessionId, events: [{ type, path, at, productId?,
// variantId?, quantity?, value?, tz?, lang?, referrer?, utm? }] } as text/plain (sendBeacon). order_placed is NOT accepted
// from browsers: the webhook records it from the paid order.

export const TRACK_TYPES = ['visit', 'page_view', 'view_product', 'add_to_cart', 'checkout_started'] as const;
export const MAX_EVENTS_PER_BATCH = 20;

export interface TrackContext { storeId: string; ipHash: string; country: string; userAgent: string; now: number }
export interface TrackRow {
  store_id: string; type: string; session_id: string; path: string; product_id: string; variant_id: string; quantity: number; value: number;
  referrer: string; utm: Record<string, string>; country: string; geo_source: '' | 'header' | 'timezone'; timezone: string; lang: string;
  ip_hash: string; user_agent: string; occurred_at: string;
}

const s = (v: unknown, n: number): string => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const TZ = /^[A-Za-z]+(?:[/_+-][A-Za-z0-9_+-]+)*$/;

/** Country from the edge's geo headers (Cloudflare and common CDNs), '' when absent or unknown ('XX', 'T1'). */
export function headerCountry(h: { get(n: string): string | null }): string {
  for (const n of ['cf-ipcountry', 'x-country-code', 'x-vercel-ip-country', 'cloudfront-viewer-country', 'x-geo-country']) {
    const v = (h.get(n) || '').trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(v) && v !== 'XX' && v !== 'T1') return v;
  }
  return '';
}

export function eventRows(body: unknown, ctx: TrackContext): TrackRow[] {
  if (!body || typeof body !== 'object') return [];
  const b = body as { sessionId?: unknown; events?: unknown };
  const sid = /^[\w-]{4,64}$/.test(s(b.sessionId, 64)) ? s(b.sessionId, 64) : '';
  if (!sid || !Array.isArray(b.events)) return [];
  const out: TrackRow[] = [];
  for (const raw of b.events.slice(0, MAX_EVENTS_PER_BATCH)) {
    if (!raw || typeof raw !== 'object') continue;
    const e = raw as Record<string, unknown>, type = s(e.type, 30);
    if (!(TRACK_TYPES as readonly string[]).includes(type)) continue;
    const at = Date.parse(s(e.at, 40));
    const occurred = Number.isFinite(at) && Math.abs(at - ctx.now) < 6 * 3600_000 ? new Date(at) : new Date(ctx.now); // clamp clock skew
    const tz = TZ.test(s(e.tz, 60)) ? s(e.tz, 60) : '';
    const utm: Record<string, string> = {};
    if (e.utm && typeof e.utm === 'object') for (const k of ['source', 'medium', 'campaign', 'content', 'term']) { const v = s((e.utm as Record<string, unknown>)[k], 100); if (v) utm[k] = v; }
    let ref = s(e.referrer, 200);
    try { ref = ref ? new URL(ref).origin : ''; } catch { ref = ''; }
    out.push({
      store_id: ctx.storeId, type, session_id: sid, path: s(e.path, 200).replace(/[^\w./-]/g, ''), product_id: s(e.productId, 80), variant_id: s(e.variantId, 80),
      quantity: Math.max(0, Math.min(9999, Math.round(Number(e.quantity) || 0))), value: Math.max(0, Math.min(1e7, Math.round((Number(e.value) || 0) * 100) / 100)),
      referrer: type === 'visit' ? ref : '', utm: type === 'visit' ? utm : {}, country: ctx.country, geo_source: ctx.country ? 'header' : tz ? 'timezone' : '',
      timezone: tz, lang: /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(s(e.lang, 20)) ? s(e.lang, 20) : '',
      ip_hash: ctx.ipHash, user_agent: ctx.userAgent.slice(0, 300), occurred_at: occurred.toISOString(),
    });
  }
  return out;
}
