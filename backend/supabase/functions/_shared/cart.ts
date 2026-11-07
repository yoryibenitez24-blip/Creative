// Server-side cart validation against the stored catalog snapshot (pure).
// The shopper's browser sends only product id, variant id and quantity. Prices, titles and stock always come from
// the `products` table; a price sent by the client is ignored (it is only compared to report a change).

export type Interval = 'day' | 'week' | 'month' | 'year';
export interface Recurring { interval: Interval; intervalCount?: number }
export interface CatalogVariant { id: string; title?: string; options?: string[]; price: number | null; sku?: string; stock: number | null }
export interface CatalogProduct {
  id: string; title: string; active: boolean; price: number; image?: string;
  kind?: 'physical' | 'digital' | 'service'; recurring?: Recurring | null; variants: CatalogVariant[];
}
export interface CartInputLine { productId?: unknown; variantId?: unknown; quantity?: unknown; price?: unknown }
export interface ValidLine {
  productId: string; variantId: string; title: string; variantTitle: string; sku: string;
  price: number; quantity: number; image: string; kind: 'physical' | 'digital' | 'service'; recurring: Recurring | null;
}
export type CartErrorCode = 'empty' | 'too_many_lines' | 'bad_line' | 'unknown_product' | 'inactive' | 'unknown_variant' | 'bad_quantity' | 'out_of_stock';
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
    const key = pid + '|' + vid, prev = merged.get(key);
    if (prev) { prev.quantity = Math.min(MAX_QTY, prev.quantity + q); continue; }
    const vt = v.title || (v.options || []).filter(Boolean).join(' / ');
    const line: ValidLine = { productId: pid, variantId: vid, title: p.title, variantTitle: vt, sku: v.sku || '', price, quantity: q, image: p.image || '',
      kind: p.kind === 'digital' || p.kind === 'service' ? p.kind : 'physical', recurring: normalizeRecurring(p.recurring) };
    merged.set(key, line); lines.push(line);
  }
  for (const line of lines) {
    const v = byId.get(line.productId)!.variants.find(x => x.id === line.variantId)!;
    if (v.stock != null && line.quantity > v.stock) errors.push({ code: 'out_of_stock', productId: line.productId, variantId: line.variantId, available: Math.max(0, v.stock),
      message: v.stock > 0 ? `Only ${v.stock} of “${line.title}${line.variantTitle ? ' (' + line.variantTitle + ')' : ''}” left.` : `“${line.title}${line.variantTitle ? ' (' + line.variantTitle + ')' : ''}” is sold out.` });
  }
  return { ok: errors.length === 0 && lines.length > 0, lines, errors, priceChanges };
}

/** Does the cart need a shipping address? (services and digital goods do not) */
export const needsShipping = (lines: ValidLine[]): boolean => lines.some(l => l.kind === 'physical');
/** Subscription checkout when any line is recurring. */
export const isSubscription = (lines: ValidLine[]): boolean => lines.some(l => l.recurring != null);
