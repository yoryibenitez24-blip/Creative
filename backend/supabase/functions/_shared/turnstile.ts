// Cloudflare Turnstile server-side verification (pure; `fetch` is injected for tests).
// https://developers.cloudflare.com/turnstile/get-started/server-side-validation/

export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export interface TurnstileResult { success: boolean; errorCodes: string[]; action?: string; hostname?: string }
type FetchLike = (url: string, init: { method: string; body: FormData | URLSearchParams; headers?: Record<string, string> }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

export async function verifyTurnstile(token: unknown, secret: string, ip: string, fetchImpl: FetchLike, expectedAction?: string): Promise<TurnstileResult> {
  if (typeof token !== 'string' || !token || token.length > 2048) return { success: false, errorCodes: ['missing-input-response'] };
  const body = new URLSearchParams({ secret, response: token });
  if (ip) body.set('remoteip', ip);
  body.set('idempotency_key', crypto.randomUUID());
  try {
    const r = await fetchImpl(SITEVERIFY_URL, { method: 'POST', body });
    const j = (await r.json()) as { success?: boolean; 'error-codes'?: string[]; action?: string; hostname?: string };
    const ok = !!j.success && (!expectedAction || !j.action || j.action === expectedAction);
    return { success: ok, errorCodes: j['error-codes'] || (ok ? [] : ['action-mismatch']), action: j.action, hostname: j.hostname };
  } catch {
    return { success: false, errorCodes: ['internal-error'] };
  }
}
