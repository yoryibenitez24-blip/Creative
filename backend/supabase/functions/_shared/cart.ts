// Server-side cart validation against the stored catalog snapshot (pure).
// The shopper's browser sends only product id, variant id and quantity. Prices, titles and stock always come from
// the `products` table; a price sent by the client is ignored (it is only compared to report a change).

export type Interval = 'day' | 'week' | 'month' | 'year';
export interface Recurring { interval: Interval; intervalCount?: number }
export interface CatalogVariant { id: string; title?: string; options?: string[]; price: number | null; sku?: string; stock: number | null }
/** Service fields the checkout needs (snapshot of product.service, see src/store/serviceProduct.js). */
export interface CatalogService {
  pricing?: { model?: string; stripePriceId?: string };
  booking?: { enabled?: boolean };
  intake?: { id: string; label: string; type: string; required: boolean; options?: string[] }[];
  addOns?: { id: string; name: string; price: number }[];
}
export interface CatalogProduct {
  id: string; title: string; active: boolean; price: number; image?: string;
  kind?: 'physical' | 'digital' | 'service'; recurring?: Recurring | null; variants: CatalogVariant[];
  service?: CatalogService | null;
}
export interface IntakeAnswer { question: string; answer: string }
export interface CartInputLine { productId?: unknown; variantId?: unknown; quantity?: unknown; price?: unknown; start?: unknown; intake?: unknown; addOns?: unknown }
export interface ValidLine {
  productId: string; variantId: string; title: string; variantTitle: string; sku: string;
  /** unit price charged = base price + add-ons */
  price: number; basePrice: number; quantity: number; image: string; kind: 'physical' | 'digital' | 'service'; recurring: Recurring | null;
  /** services: booked slot start (ISO) when booking is enabled, intake answers, chosen add-ons, Stripe price of a retainer */
  start: string | null; intake: IntakeAnswer[]; addOns: { id: string; name: string; price: number }[]; stripePriceId: string;
}
export type CartErrorCode = 'empty' | 'too_many_lines' | 'bad_line' | 'unknown_product' | 'inactive' | 'unknown_variant' | 'bad_quantity' | 'out_of_stock'
  | 'booking_required' | 'intake_required' | 'intake_invalid' | 'unknown_addon';
export interface CartError { code: CartErrorCode; productId?: string; variantId?: string; available?: number; message: string }
export interface PriceChange { productId: string; variantId: string; client: number; server: number }
export interface CartResult { ok: boolean; lines: ValidLine[]; errors: CartError[]; priceChanges: PriceChange[] }

export const MAX_LINES = 100;
export const MAX_QTY = 999;
const INTERVALS: Interval[] = ['day', 'week', 'month', 'year'];

const id = (v: unknown): string => (typeof v === 'string' && v.length > 0 && v.length <= 120 ? v : '');

export function normalizeRecurring(r: unknown): Recurring | null {
  if (!r || typeof r !== 'object') return null;
  const o = r as Record<string, unknown>, interval = o.interval as Interval;
  if (!INTERVALS.includes(interval)) return null;
  const n = Math.round(Number(o.intervalCount ?? 1));
  return { interval, intervalCount: Number.isFinite(n) && n >= 1 && n <= 365 ? n : 1 };
}

export function validateCart(input: unknown, catalog: CatalogProduct[]): CartResult {
  const errors: CartError[] = [], priceChanges: PriceChange[] = [], lines: ValidLine[] = [];
  const raw = Array.isArray(input) ? input as CartInputLine[] : [];
  if (!raw.length) return { ok: false, lines, errors: [{ code: 'empty', message: 'Your cart is empty.' }], priceChanges };
  if (raw.length > MAX_LINES) return { ok: false, lines, errors: [{ code: 'too_many_lines', message: `A cart can hold at most ${MAX_LINES} different items.` }], priceChanges };
  const byId = new Map(catalog.map(p => [p.id, p]));
  const merged = new Map<string, ValidLine>();
  for (const l of raw) {
    if (!l || typeof l !== 'object') { errors.push({ code: 'bad_line', message: 'Invalid cart line.' }); continue; }
    const pid = id(l.productId), vid = id(l.variantId), q = Number(l.quantity);
    const p = byId.get(pid);
    if (!p) { errors.push({ code: 'unknown_product', productId: pid, message: 'A product in your cart is no longer available.' }); continue; }
    if (!p.active) { errors.push({ code: 'inactive', productId: pid, message: `“${p.title}” is no longer available.` }); continue; }
    const v = p.variants.find(x => x.id === vid);
    if (!v) { errors.push({ code: 'unknown_variant', productId: pid, variantId: vid, message: `The chosen option of “${p.title}” is no longer available.` }); continue; }
    if (!Number.isInteger(q) || q < 1 || q > MAX_QTY) { errors.push({ code: 'bad_quantity', productId: pid, variantId: vid, message: `Invalid quantity for “${p.title}”.` }); continue; }
    const price = v.price != null ? Number(v.price) : Number(p.price);
    if (!(price >= 0) || !Number.isFinite(price)) { errors.push({ code: 'unknown_variant', productId: pid, variantId: vid, message: `“${p.title}” has no price.` }); continue; }
    if (l.price != null && Number.isFinite(Number(l.price)) && Math.round(Number(l.price) * 100) !== Math.round(price * 100)) priceChanges.push({ productId: pid, variantId: vid, client: Number(l.price), server: price });
    const kind = p.kind === 'digital' || p.kind === 'service' ? p.kind : 'physical';
    const svc = kind === 'service' ? checkService(p, l, q) : { ok: true as const, start: null, intake: [], addOns: [] };
    if (!svc.ok) { errors.push({ ...svc.error, productId: pid, variantId: vid }); continue; }
    const extra = svc.addOns.reduce((sum, a) => sum + Math.round(a.price * 100), 0) / 100;
    const key = pid + '|' + vid, prev = merged.get(key);
    if (prev && kind !== 'service') { prev.quantity = Math.min(MAX_QTY, prev.quantity + q); continue; }
    const vt = v.title || (v.options || []).filter(Boolean).join(' / ');
    const line: ValidLine = { productId: pid, variantId: vid, title: p.title, variantTitle: vt, sku: v.sku || '', price: Math.round((price + extra) * 100) / 100, basePrice: price, quantity: q, image: p.image || '',
      kind, recurring: normalizeRecurring(p.recurring), start: svc.start, intake: svc.intake, addOns: svc.addOns,
      stripePriceId: kind === 'service' && p.service?.pricing?.model === 'retainer' && /^price_[A-Za-z0-9]{6,}$/.test(p.service.pricing.stripePriceId || '') ? p.service.pricing.stripePriceId! : '' };
    merged.set(key + (kind === 'service' ? '|' + lines.length : ''), line); lines.push(line);
  }
  for (const line of lines) {
    const v = byId.get(line.productId)!.variants.find(x => x.id === line.variantId)!;
    if (v.stock != null && line.quantity > v.stock) errors.push({ code: 'out_of_stock', productId: line.productId, variantId: line.variantId, available: Math.max(0, v.stock),
      message: v.stock > 0 ? `Only ${v.stock} of “${line.title}${line.variantTitle ? ' (' + line.variantTitle + ')' : ''}” left.` : `“${line.title}${line.variantTitle ? ' (' + line.variantTitle + ')' : ''}” is sold out.` });
  }
  return { ok: errors.length === 0 && lines.length > 0, lines, errors, priceChanges };
}

type ServiceCheck = { ok: true; start: string | null; intake: IntakeAnswer[]; addOns: { id: string; name: string; price: number }[] } | { ok: false; error: CartError };
const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[A-Za-z]{2,}$/;

/** Service line: booking slot present (when booking is on; the slot itself is checked against the calendar by the
 *  caller), required intake questions answered with valid values, add-ons known (priced from the snapshot). */
export function checkService(p: CatalogProduct, l: CartInputLine, q: number): ServiceCheck {
  const s = p.service || {}, title = p.title;
  let start: string | null = null;
  if (s.booking?.enabled) {
    const t = typeof l.start === 'string' ? Date.parse(l.start) : NaN;
    if (!Number.isFinite(t)) return { ok: false, error: { code: 'booking_required', message: `Choose a date and time for “${title}”.` } };
    if (q !== 1) return { ok: false, error: { code: 'bad_quantity', message: `Book “${title}” one session at a time.` } };
    start = new Date(t).toISOString();
  }
  const given = Array.isArray(l.intake) ? l.intake.slice(0, 50) as { question?: unknown; answer?: unknown; id?: unknown }[] : [];
  const intake: IntakeAnswer[] = [];
  for (const qq of s.intake || []) {
    const a = given.find(x => x && (x.id === qq.id || x.question === qq.label));
    let ans = a && a.answer != null ? (typeof a.answer === 'boolean' ? (a.answer ? 'Yes' : '') : String(a.answer)).trim().slice(0, 4000) : '';
    if (qq.type === 'checkbox' && /^(true|yes|on|1)$/i.test(ans)) ans = 'Yes';
    if (!ans) { if (qq.required) return { ok: false, error: { code: 'intake_required', message: `Please answer “${qq.label}” for “${title}”.` } }; continue; }
    const bad = (qq.type === 'email' && !EMAIL.test(ans)) || (qq.type === 'url' && !/^https?:\/\/\S+$/i.test(ans)) || (qq.type === 'select' && (qq.options || []).length > 0 && !(qq.options || []).includes(ans));
    if (bad) return { ok: false, error: { code: 'intake_invalid', message: `Check your answer to “${qq.label}”.` } };
    intake.push({ question: qq.label, answer: ans });
  }
  const ids = Array.isArray(l.addOns) ? [...new Set(l.addOns.slice(0, 50).map(x => (x && typeof x === 'object' ? (x as { id?: unknown }).id : x)).filter((x): x is string => typeof x === 'string'))] : [];
  const addOns: { id: string; name: string; price: number }[] = [];
  for (const id of ids) {
    const a = (s.addOns || []).find(x => x.id === id);
    if (!a) return { ok: false, error: { code: 'unknown_addon', message: `An extra chosen for “${title}” is no longer offered.` } };
    addOns.push({ id: a.id, name: a.name, price: Math.max(0, Number(a.price) || 0) });
  }
  return { ok: true, start, intake, addOns };
}

/** Does the cart need a shipping address? (services and digital goods do not) */
export const needsShipping = (lines: ValidLine[]): boolean => lines.some(l => l.kind === 'physical');
/** Subscription checkout when any line is recurring. */
export const isSubscription = (lines: ValidLine[]): boolean => lines.some(l => l.recurring != null || !!l.stripePriceId);
