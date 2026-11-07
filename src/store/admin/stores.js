// Multi-store workspace data (pure helpers).
//
// Workspace fields:
//   stores: [{ id, handle, store, commerce, createdAt }]   store = store document (../model.js), commerce = back-office doc (./model.js)
//   activeStoreId: id of the store the E-commerce section opens by default
//   plan: 'starter' | 'growth' | 'pro'   (account level, see ./plans.js)
// Older workspaces kept a single `storeDoc` + `commerceDoc`; migrateStores() moves them into one entry.
import { uniqueHandle } from '../../routes.js';
import { DEFAULT_PLAN, planFor } from './plans.js';

const rid = () => 'st_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/** A new store entry; the handle is made unique among `stores`. */
export function storeEntry(store, { stores = [], commerce = null, id = rid(), createdAt = Date.now() } = {}) {
  return { id, handle: uniqueHandle(store && store.name, stores.map(s => s.handle)), store, commerce, createdAt };
}

/** Bring a saved workspace to the multi-store shape without losing data. Returns the same object when nothing changes. */
export function migrateStores(saved) {
  if (!saved || typeof saved !== 'object') return saved;
  let changed = false, stores = Array.isArray(saved.stores) ? saved.stores.filter(e => e && e.store) : [];
  if (stores.length !== (saved.stores || []).length) changed = true;
  const next = { ...saved };
  if (saved.storeDoc) {
    // keep the legacy single store as the first entry (unless it was already migrated)
    if (!stores.some(e => e.store && e.store.id && e.store.id === saved.storeDoc.id)) stores = [storeEntry(saved.storeDoc, { stores, commerce: saved.commerceDoc || null, createdAt: 0 }), ...stores];
    changed = true;
  }
  if ('storeDoc' in next || 'commerceDoc' in next) { delete next.storeDoc; delete next.commerceDoc; changed = true; }
  // every entry needs a unique handle and an id
  const taken = new Set();
  stores = stores.map(e => {
    let h = e.handle;
    if (!h || taken.has(h) || h === 'new' || h === 'stores') { h = uniqueHandle(e.store.name, taken); changed = true; }
    taken.add(h);
    const id = e.id || rid(); if (!e.id) changed = true;
    return h === e.handle && id === e.id ? e : { ...e, id, handle: h };
  });
  const activeStoreId = stores.some(e => e.id === saved.activeStoreId) ? saved.activeStoreId : stores[0] ? stores[0].id : null;
  const plan = planFor(saved.plan).id === saved.plan ? saved.plan : DEFAULT_PLAN;
  if (activeStoreId !== saved.activeStoreId || plan !== saved.plan || !Array.isArray(saved.stores)) changed = true;
  return changed ? { ...next, stores, activeStoreId, plan } : saved;
}

export const findStore = (stores, idOrHandle) => (stores || []).find(e => e.id === idOrHandle) || (stores || []).find(e => e.handle === idOrHandle) || null;

/** Replace fields of one entry. */
export function updateStoreEntry(state, id, patch) {
  return { ...state, stores: state.stores.map(e => e.id === id ? { ...e, ...(typeof patch === 'function' ? patch(e) : patch) } : e) };
}

/** Rename a store: store document name + a fresh unique handle. */
export function renameStore(state, id, name) {
  const nm = String(name || '').trim(); if (!nm) return state;
  const others = state.stores.filter(e => e.id !== id).map(e => e.handle);
  return updateStoreEntry(state, id, e => ({ store: { ...e.store, name: nm }, handle: uniqueHandle(nm, others) }));
}

/** Remove a store; the active store moves to the first remaining one. */
export function removeStore(state, id) {
  const stores = state.stores.filter(e => e.id !== id);
  return { ...state, stores, activeStoreId: state.activeStoreId === id ? (stores[0] ? stores[0].id : null) : state.activeStoreId };
}
