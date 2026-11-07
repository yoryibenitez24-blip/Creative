// Idempotency keys for Stripe requests (pure; uses Web Crypto, available in Deno and Node ≥ 20).
// The key covers the store, the shopper's checkout attempt id and a canonical form of everything that shapes the
// Checkout Session, so a double-click or a retry reuses the same session while a changed cart gets a new one
// (Stripe rejects a reused key with different parameters).

export interface CanonicalCartInput {
  storeId: string; checkoutId: string;
  lines: { productId: string; variantId: string; quantity: number; price?: number }[];
  codes?: string[]; country?: string; region?: string; rateId?: string | null; email?: string; currency?: string;
}

/** Order-independent, whitespace-free canonical string. */
export function canonicalCart(i: CanonicalCartInput): string {
  const lines = [...i.lines].map(l => `${l.productId}|${l.variantId}|${l.quantity}|${l.price ?? ''}`).sort();
  const codes = [...(i.codes || [])].map(c => c.trim().toUpperCase()).filter(Boolean).sort();
  return JSON.stringify([i.storeId, i.checkoutId, lines, codes, (i.country || '').toUpperCase(), (i.region || '').trim().toLowerCase(),
    i.rateId || '', (i.email || '').trim().toLowerCase(), (i.currency || '').toUpperCase()]);
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
}

/** Stripe allows keys up to 255 characters; ours are `<prefix>_<64 hex>`. */
export async function idempotencyKey(prefix: string, parts: string): Promise<string> {
  return `${prefix.replace(/[^\w-]/g, '').slice(0, 40)}_${await sha256Hex(parts)}`;
}

/** A shopper-supplied checkout attempt id is accepted only in a safe shape; otherwise the server makes one up. */
export function safeCheckoutId(v: unknown): string {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(v) ? v : crypto.randomUUID();
}
