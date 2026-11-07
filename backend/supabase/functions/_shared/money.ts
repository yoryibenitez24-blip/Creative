// Currency helpers (pure; runs in Deno and in Node ≥ 22.6 with type stripping for the unit tests).
// Stripe amounts are integers in the currency's smallest unit. Most currencies have 2 decimals, a few have none,
// five have three (Stripe requires their last digit to be 0).
// https://docs.stripe.com/currencies#zero-decimal

export const ZERO_DECIMAL = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
]);
export const THREE_DECIMAL = new Set(['BHD', 'JOD', 'KWD', 'OMR', 'TND']);

export function normalizeCurrency(code: unknown, fallback = 'USD'): string {
  const c = String(code ?? '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(c) ? c : fallback;
}

export function minorUnitFactor(currency: string): number {
  const c = normalizeCurrency(currency);
  return ZERO_DECIMAL.has(c) ? 1 : THREE_DECIMAL.has(c) ? 1000 : 100;
}

/** Major-unit amount (19.99) → Stripe integer amount (1999). Three-decimal currencies are rounded to a multiple of 10. */
export function toMinor(amount: number, currency: string): number {
  const f = minorUnitFactor(currency), n = Math.round((Number(amount) || 0) * f);
  return f === 1000 ? Math.round(n / 10) * 10 : n;
}

export function fromMinor(minor: number, currency: string): number {
  const f = minorUnitFactor(currency);
  return Math.round(Number(minor) || 0) / f;
}

/** Round a major-unit amount to cents the way the storefront engine does (Math.round(x * 100) / 100). */
export const roundMoney = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;
