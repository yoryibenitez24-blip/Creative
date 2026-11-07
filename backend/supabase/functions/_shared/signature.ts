// Stripe-Signature header parsing and verification (pure; Web Crypto HMAC-SHA256).
// The webhook function verifies with the official `stripe.webhooks.constructEventAsync`; this module is used to
// pick between the platform and the Connect endpoint secrets cheaply, for diagnostics in the log, and in tests.
// Header format: "t=1492774577,v1=5257a869…,v1=…,v0=…"  signed payload = `${t}.${rawBody}`.

export interface ParsedSignature { timestamp: number | null; v1: string[] }

export function parseSignatureHeader(header: string | null | undefined): ParsedSignature {
  const out: ParsedSignature = { timestamp: null, v1: [] };
  for (const part of String(header || '').split(',')) {
    const i = part.indexOf('='); if (i < 0) continue;
    const k = part.slice(0, i).trim(), v = part.slice(i + 1).trim();
    if (k === 't' && /^\d{1,12}$/.test(v)) out.timestamp = Number(v);
    else if (k === 'v1' && /^[0-9a-f]{64}$/i.test(v)) out.v1.push(v.toLowerCase());
  }
  return out;
}

async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(sig), b => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export type SignatureCheck = { ok: true; timestamp: number } | { ok: false; reason: 'malformed' | 'no_match' | 'too_old' };

/** Verify `header` for `payload` with one endpoint secret (whsec_…). Tolerance in seconds (Stripe's default is 300). */
export async function verifySignature(payload: string, header: string | null | undefined, secret: string, toleranceSec = 300, nowSec = Math.floor(Date.now() / 1000)): Promise<SignatureCheck> {
  const p = parseSignatureHeader(header);
  if (p.timestamp == null || !p.v1.length) return { ok: false, reason: 'malformed' };
  const expected = await hmacHex(secret, `${p.timestamp}.${payload}`);
  if (!p.v1.some(s => timingSafeEqual(s, expected))) return { ok: false, reason: 'no_match' };
  if (toleranceSec > 0 && Math.abs(nowSec - p.timestamp) > toleranceSec) return { ok: false, reason: 'too_old' };
  return { ok: true, timestamp: p.timestamp };
}

/** Build a header for tests / local replays (same as stripe.webhooks.generateTestHeaderString). */
export async function signPayload(payload: string, secret: string, timestamp = Math.floor(Date.now() / 1000)): Promise<string> {
  return `t=${timestamp},v1=${await hmacHex(secret, `${timestamp}.${payload}`)}`;
}
