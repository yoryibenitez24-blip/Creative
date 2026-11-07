// HTTP helpers shared by the Edge Functions (pure: only Web APIs).

export const ALLOW_HEADERS = 'authorization, x-client-info, apikey, content-type, x-zt-store';

/** CORS headers. With an allow-list, only listed origins are reflected; without one every origin is allowed. */
export function corsHeaders(origin: string | null, allowed: string[] = []): Record<string, string> {
  const list = allowed.map(normalizeOrigin).filter(Boolean);
  const o = origin ? normalizeOrigin(origin) : '';
  const allow = !list.length ? '*' : o && list.includes(o) ? o : list[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': ALLOW_HEADERS,
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Max-Age': '86400',
    ...(allow !== '*' ? { Vary: 'Origin' } : {}),
  };
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}

export function errorJson(status: number, code: string, message: string, headers: Record<string, string> = {}, extra: Record<string, unknown> = {}): Response {
  return json({ error: { code, message, ...extra } }, status, headers);
}

/** Read a JSON body (also accepts text/plain, which sendBeacon and no-preflight fetches use) with a size cap. */
export async function readJson<T = unknown>(req: Request, maxBytes = 64 * 1024): Promise<T | null> {
  const len = Number(req.headers.get('content-length') || 0);
  if (len > maxBytes) return null;
  const text = await req.text();
  if (!text || text.length > maxBytes) return null;
  try { return JSON.parse(text) as T; } catch { return null; }
}

/** "https://Shop.example.com/path" → "https://shop.example.com" ('' when not http(s)). */
export function normalizeOrigin(u: string): string {
  try {
    const x = new URL(String(u).trim());
    return x.protocol === 'https:' || x.protocol === 'http:' ? x.origin.toLowerCase() : '';
  } catch { return ''; }
}

const isLocal = (host: string): boolean => host === 'localhost' || host === '127.0.0.1' || host === '[::1]';

/**
 * Where Stripe sends the shopper back. The storefront proposes its own base URL; it is used only when it is https
 * (or http on localhost) and, if the store has an allow-list, its origin is listed. Otherwise the store's site URL.
 * → absolute base URL ending in '/', or '' when neither is usable.
 */
export function safeReturnBase(proposed: unknown, allowedOrigins: string[], siteUrl: string): string {
  const pick = (u: string): string => {
    try {
      const x = new URL(u);
      const okProto = x.protocol === 'https:' || (x.protocol === 'http:' && isLocal(x.hostname));
      if (!okProto || x.username || x.password) return '';
      x.search = ''; x.hash = '';
      if (!x.pathname.endsWith('/')) x.pathname = x.pathname.replace(/[^/]*$/, '');
      return x.href;
    } catch { return ''; }
  };
  const allowed = allowedOrigins.map(normalizeOrigin).filter(Boolean);
  if (typeof proposed === 'string' && proposed) {
    const p = pick(proposed);
    if (p && (!allowed.length || allowed.includes(normalizeOrigin(p)))) return p;
  }
  return siteUrl ? pick(siteUrl.endsWith('/') ? siteUrl : siteUrl + '/') : '';
}

export const bearer = (req: Request): string => {
  const h = req.headers.get('authorization') || '';
  return /^Bearer\s+/i.test(h) ? h.replace(/^Bearer\s+/i, '').trim() : '';
};

/** 'ada@example.com' → 'a••@example.com' (enough for a shopper to recognise, useless to anyone else). */
export const maskEmail = (e: string): string => {
  const [u, d] = String(e || '').split('@');
  return d ? `${u.slice(0, 1)}${'•'.repeat(Math.max(1, Math.min(6, u.length - 1)))}@${d}` : '';
};
