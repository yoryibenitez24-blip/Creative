// Project persistence for the E-commerce studio: IndexedDB database 'zertake-ecom' (object store
// 'projects', keyPath 'id'), or an in-memory Map where IndexedDB is unavailable (Node tests,
// private windows that block storage). Projects hold only asset ids + settings (non-destructive);
// the pixels live in the shared content-addressed AssetStore.
//
// Project:
// { id, name, created, updated, version: 1,
//   settings: { presetId, custom:{w,h}, framing, background, shadow, reflection, matte defaults,
//               export:{format, quality, template, presets:[ids], zip}, template:{id, params} },
//   items: [{ id, name, assetId, w, h, status, ai:{w,h,b64}|null, matte:{…}, strokes:[…],
//             retouch:{…}, bounds:{x,y,w,h}|null, workW, workH }] }

import { FRAMING_DEFAULTS, BACKGROUND_DEFAULTS, SHADOW_DEFAULTS, REFLECTION_DEFAULTS, MATTE_DEFAULTS, RETOUCH_DEFAULTS } from './engine.js';

export const DB_NAME = 'zertake-ecom', STORE = 'projects';
export const uid = (p = 'e') => p + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function defaultSettings() {
  return {
    presetId: 'amazon', custom: { w: 1500, h: 1500 },
    framing: { ...FRAMING_DEFAULTS }, background: { ...BACKGROUND_DEFAULTS }, shadow: { ...SHADOW_DEFAULTS }, reflection: { ...REFLECTION_DEFAULTS },
    export: { format: 'jpeg', quality: 92, template: '{name}_{preset}', presets: ['amazon'], zip: true },
    template: { id: 'sale-banner', params: {} },
  };
}
export const newItem = (name, assetId, w, h) => ({ id: uid('i'), name, assetId, w, h, status: 'imported', ai: null, matte: { ...MATTE_DEFAULTS }, strokes: [], retouch: { ...RETOUCH_DEFAULTS }, bounds: null, workW: 0, workH: 0 });
export const newProject = (name = 'Untitled project') => ({ id: uid('p'), name, created: Date.now(), updated: Date.now(), version: 1, settings: defaultSettings(), items: [] });

/** Fill missing fields of a stored project (older versions / partial writes) with defaults. */
export function normalizeProject(p) {
  const d = defaultSettings(), s = p.settings || {};
  return {
    ...p, version: 1,
    settings: { ...d, ...s, custom: { ...d.custom, ...s.custom }, framing: { ...d.framing, ...s.framing }, background: { ...d.background, ...s.background }, shadow: { ...d.shadow, ...s.shadow }, reflection: { ...d.reflection, ...s.reflection }, export: { ...d.export, ...s.export }, template: { ...d.template, ...s.template, params: { ...(s.template?.params || {}) } } },
    items: (p.items || []).map(it => ({ ...newItem(it.name, it.assetId, it.w, it.h), ...it, matte: { ...MATTE_DEFAULTS, ...it.matte }, retouch: { ...RETOUCH_DEFAULTS, ...it.retouch }, strokes: it.strokes || [], status: it.status === 'working' ? (it.ai ? 'cut' : 'imported') : it.status })),
  };
}

export function memoryProjectStore() {
  const m = new Map();
  return {
    kind: 'memory',
    list: async () => [...m.values()].map(p => ({ id: p.id, name: p.name, updated: p.updated, count: p.items.length })).sort((a, b) => b.updated - a.updated),
    get: async id => m.has(id) ? normalizeProject(structuredClone(m.get(id))) : null,
    put: async p => { m.set(p.id, structuredClone(p)); },
    delete: async id => { m.delete(id); },
  };
}

const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

/** Open the IndexedDB project store; resolves to the memory store when IndexedDB cannot be used. */
export async function openProjectStore(idb = globalThis.indexedDB) {
  if (!idb) return memoryProjectStore();
  let db;
  try {
    db = await new Promise((res, rej) => {
      const r = idb.open(DB_NAME, 1);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: 'id' }); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); r.onblocked = () => rej(Error('blocked'));
    });
  } catch { return memoryProjectStore(); }
  const tx = (mode, fn) => { const t = db.transaction(STORE, mode); return req(fn(t.objectStore(STORE))); };
  return {
    kind: 'indexeddb',
    list: async () => (await tx('readonly', s => s.getAll())).map(p => ({ id: p.id, name: p.name, updated: p.updated, count: p.items?.length || 0 })).sort((a, b) => b.updated - a.updated),
    get: async id => { const p = await tx('readonly', s => s.get(id)); return p ? normalizeProject(p) : null; },
    put: async p => { await tx('readwrite', s => s.put(p)); },
    delete: async id => { await tx('readwrite', s => s.delete(id)); },
  };
}
