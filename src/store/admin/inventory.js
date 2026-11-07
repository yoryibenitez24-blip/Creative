// Inventory: stock lives on the store document (store.products[].variants[].stock, null = not tracked);
// every change is logged in commerce.inventoryLog. Pure functions: (store, commerce, …) → { store, commerce }.
import { cid, variantMeta } from './model.js';

const clone = o => JSON.parse(JSON.stringify(o));
const isoOf = now => new Date(now == null ? Date.now() : now).toISOString();

export function findVariant(store, productId, variantId) {
  const p = store.products.find(x => x.id === productId);
  return { product: p || null, variant: p ? p.variants.find(v => v.id === variantId) || null : null };
}

/**
 * Apply stock changes. changes: [{ productId, variantId, delta } | { productId, variantId, set }].
 * Untracked variants (stock null) are skipped unless `set` is given (which starts tracking). Stock never goes below 0.
 * opts: { reason: 'manual'|'set'|'order'|'restock'|'import', orderId, note, now }
 * Returns { store, commerce, changed: [{ productId, variantId, before, after }] }.
 */
export function adjustStock(store, commerce, changes, opts = {}) {
  const s = clone(store), c = clone(commerce), at = isoOf(opts.now), changed = [];
  for (const ch of changes || []) {
    const { variant } = findVariant(s, ch.productId, ch.variantId);
    if (!variant) continue;
    const before = variant.stock;
    let after;
    if (ch.set != null && ch.set !== '') after = Math.max(0, Math.round(+ch.set || 0));
    else { if (before == null) continue; after = Math.max(0, before + Math.round(+ch.delta || 0)); }
    if (after === before) continue;
    variant.stock = after;
    changed.push({ productId: ch.productId, variantId: ch.variantId, before, after });
    c.inventoryLog.push({ id: cid('inv'), at, productId: ch.productId, variantId: ch.variantId, delta: after - (before || 0), stockAfter: after,
      reason: opts.reason || (ch.set != null ? 'set' : 'manual'), orderId: opts.orderId || null, note: opts.note || '' });
  }
  if (c.inventoryLog.length > 3000) c.inventoryLog = c.inventoryLog.slice(-3000);
  return { store: changed.length ? s : store, commerce: changed.length ? c : commerce, changed };
}

/** Decrement stock for an order's lines (once; sets order.inventoryApplied). Returns { store, commerce }. */
export function decrementForOrder(store, commerce, orderId, now) {
  const o = commerce.orders.find(x => x.id === orderId);
  if (!o || o.inventoryApplied) return { store, commerce };
  const r = adjustStock(store, commerce, o.lines.map(l => ({ productId: l.productId, variantId: l.variantId, delta: -l.quantity })), { reason: 'order', orderId, note: 'Order ' + o.name, now });
  const c = r.commerce === commerce ? clone(commerce) : r.commerce;
  c.orders.find(x => x.id === orderId).inventoryApplied = true;
  return { store: r.store, commerce: c };
}

/** Put an order's quantities back in stock (only if they were taken). Returns { store, commerce }. */
export function restockOrder(store, commerce, orderId, now) {
  const o = commerce.orders.find(x => x.id === orderId);
  if (!o || !o.inventoryApplied) return { store, commerce };
  const r = adjustStock(store, commerce, o.lines.map(l => ({ productId: l.productId, variantId: l.variantId, delta: l.quantity })), { reason: 'restock', orderId, note: 'Restock ' + o.name, now });
  const c = r.commerce === commerce ? clone(commerce) : r.commerce;
  c.orders.find(x => x.id === orderId).inventoryApplied = false;
  return { store: r.store, commerce: c };
}

/** Every tracked variant with its stock and whether it is low (≤ threshold) or out. */
export function stockRows(store, commerce) {
  const th = commerce?.settings?.general?.lowStockThreshold ?? 5, rows = [];
  for (const p of store.products) for (const v of p.variants) {
    rows.push({ product: p, variant: v, tracked: v.stock != null, stock: v.stock, low: v.stock != null && v.stock > 0 && v.stock <= th, out: v.stock != null && v.stock <= 0, continueSelling: variantMeta(commerce, p.id, v.id).continueSelling });
  }
  return rows;
}

export const productStock = p => p.variants.some(v => v.stock != null) ? p.variants.reduce((n, v) => n + (v.stock || 0), 0) : null;

/** How many units of a variant can still be ordered (Infinity when untracked or "continue selling"). */
export function sellable(store, commerce, productId, variantId) {
  const { variant } = findVariant(store, productId, variantId);
  if (!variant) return 0;
  if (variant.stock == null || variantMeta(commerce, productId, variantId).continueSelling) return Infinity;
  return variant.stock;
}
