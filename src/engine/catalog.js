// Photo catalog for the Library / Develop workspace (Lightroom-style, non-destructive).
//
// Pure functions over an immutable catalog object, plus two persistence backends with the same
// interface (`{ load(): Promise<catalog|null>, save(catalog): Promise<void> }`): a Map-like memory
// backend for tests and an IndexedDB backend for the browser (its own database, so the editor's
// `zertake-studio` database version is never bumped). No DOM is used here; IndexedDB is only
// touched when idbCatalogBackend() is actually called (it also exists in workers).
//
// Pixels never live in the catalog. A photo references its original file by `assetId` (the
// SHA-256 id of the original blob in the AssetStore). Thumbnails/previews are blobs in the same
// AssetStore; the catalog maps a cache key (assetId, settings hash, size) → blob id (`cat.cache`).
//
// Develop settings: `photo.develop` holds full settings (developDefaults() merged). History
// entries, snapshots and presets hold *sparse* settings (only keys that differ from the defaults)
// to keep the catalog small; expandSettings() turns them back into full settings. Both forms are
// valid input for develop(), which merges with the defaults itself.

import { developDefaults, develop } from './develop.js';
import { resample } from './geometry.js';

export const CATALOG_VERSION = 1;
export const HISTORY_LIMIT = 60;
export const CACHE_LIMIT = 4000;
export const LABELS = ['red', 'yellow', 'green', 'blue', 'purple'];
export const FLAGS = ['pick', 'reject'];

const clone = v => structuredClone(v);
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------- catalog object

export function emptyCatalog() {
  return { version: CATALOG_VERSION, nextId: 1, lastImport: 0, photos: [], collections: [], presets: [], cache: {} };
}

/** Fill in missing fields of a loaded catalog (older or partial data); refuses newer versions. */
export function normalizeCatalog(raw) {
  if (!raw) return emptyCatalog();
  if ((raw.version || 1) > CATALOG_VERSION) throw Error('This catalog was saved by a newer version of Zertake Studio.');
  const c = { ...emptyCatalog(), ...raw, version: CATALOG_VERSION };
  c.photos = (c.photos || []).map(p => ({ rating: 0, flag: null, label: null, keywords: [], collections: [], snapshots: [], ...p, develop: expandSettings(p.develop), history: p.history?.length ? p.history : [{ label: 'Import', settings: {} }], historyIndex: p.historyIndex ?? Math.max(0, (p.history?.length || 1) - 1) }));
  return c;
}

const byId = (cat, id) => cat.photos.find(p => p.id === id);
export const getPhoto = byId;
const mapPhotos = (cat, ids, fn) => { const set = new Set([].concat(ids)); return { ...cat, photos: cat.photos.map(p => set.has(p.id) ? fn(p) : p) }; };

// ---------------------------------------------------------------- settings helpers

/** Sparse settings: only top-level keys whose value differs from developDefaults(). */
export function compactSettings(s) {
  const d = developDefaults(), out = {};
  for (const [k, v] of Object.entries(s || {})) if (!same(v, d[k])) out[k] = clone(v);
  return out;
}
/** Full settings from sparse/partial settings (nested objects are merged with the defaults). */
export function expandSettings(s) { return mergeDeep(developDefaults(), s || {}); }

/** Deep merge of plain objects; arrays and scalars in `patch` replace. Returns a new object. */
export function mergeDeep(base, patch) {
  const out = clone(base);
  for (const [k, v] of Object.entries(patch || {})) out[k] = isObj(v) && isObj(out[k]) ? mergeDeep(out[k], v) : clone(v);
  return out;
}

/** Stable short hash of the effective settings (sparse form), for preview cache keys. */
export function settingsHash(s) {
  const str = stableJson(compactSettings(expandSettings(s)));
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
function stableJson(v) {
  if (Array.isArray(v)) return '[' + v.map(stableJson).join(',') + ']';
  if (isObj(v)) return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stableJson(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
export const previewCacheKey = (assetId, settings, size) => assetId + '|' + settingsHash(settings) + '|' + size;

/** Copy/paste/sync groups. Every develop key (except per-panel visibility `bypass`) is in exactly one group. */
export const PANELS = {
  profile: { name: 'Profile', keys: ['profile', 'profileAmount'] },
  whiteBalance: { name: 'White Balance', keys: ['wb', 'temp', 'tint'] },
  light: { name: 'Light', keys: ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks'] },
  presence: { name: 'Presence (Texture, Clarity, Dehaze, Vibrance, Saturation)', keys: ['texture', 'clarity', 'dehaze', 'vibrance', 'saturation'] },
  curve: { name: 'Curve', keys: ['curve'] },
  mixer: { name: 'Color Mixer', keys: ['mixer'] },
  grading: { name: 'Color Grading', keys: ['grading'] },
  detail: { name: 'Detail', keys: ['sharpenAmount', 'sharpenRadius', 'sharpenDetail', 'sharpenMasking', 'nrLuminance', 'nrDetail', 'nrContrast', 'nrColor', 'nrColorDetail', 'nrColorSmoothness'] },
  optics: { name: 'Optics', keys: ['removeCA', 'distortion', 'lensVignette', 'lensVignetteMidpoint', 'defringePurple', 'purpleHueLo', 'purpleHueHi', 'defringeGreen', 'greenHueLo', 'greenHueHi'] },
  lensBlur: { name: 'Lens Blur', keys: ['lensBlur'] },
  effects: { name: 'Effects (Vignette, Grain)', keys: ['vignetteAmount', 'vignetteMidpoint', 'vignetteRoundness', 'vignetteFeather', 'vignetteHighlights', 'grainAmount', 'grainSize', 'grainRoughness', 'grainSeed'] },
  calibration: { name: 'Calibration', keys: ['calibration'] },
  pointColor: { name: 'Point Color', keys: ['pointColor'] },
  geometry: { name: 'Geometry', keys: ['geometry'] },
  crop: { name: 'Crop', keys: ['crop'] },
  remove: { name: 'Remove (spots)', keys: ['spots'] },
};
/** Panels selected by default in Copy / Sync / Save Preset (Lightroom leaves spot removal out). */
export const DEFAULT_SYNC_PANELS = Object.keys(PANELS).filter(p => p !== 'remove');
export const ALL_PANELS = Object.keys(PANELS);

/** Partial settings holding only the keys of the chosen panels (deep copies). */
export function pickPanels(settings, panels = ALL_PANELS) {
  const s = expandSettings(settings), out = {};
  for (const p of panels) for (const k of PANELS[p]?.keys || []) out[k] = clone(s[k]);
  return out;
}

const KEY_LABELS = {
  profile: 'Profile', profileAmount: 'Profile Amount', wb: 'White Balance', temp: 'Temperature', tint: 'Tint',
  exposure: 'Exposure', contrast: 'Contrast', highlights: 'Highlights', shadows: 'Shadows', whites: 'Whites', blacks: 'Blacks',
  texture: 'Texture', clarity: 'Clarity', dehaze: 'Dehaze', vibrance: 'Vibrance', saturation: 'Saturation',
  vignetteAmount: 'Vignette Amount', vignetteMidpoint: 'Vignette Midpoint', vignetteRoundness: 'Vignette Roundness', vignetteFeather: 'Vignette Feather', vignetteHighlights: 'Vignette Highlights',
  grainAmount: 'Grain Amount', grainSize: 'Grain Size', grainRoughness: 'Grain Roughness', grainSeed: 'Grain Seed',
  spots: 'Remove', pointColor: 'Point Color', geometry: 'Geometry', crop: 'Crop', masks: 'Masking', versions: 'Versions',
  curve: 'Tone Curve', mixer: 'Color Mixer', grading: 'Color Grading', lensBlur: 'Lens Blur', calibration: 'Calibration', bypass: 'Panel Visibility',
  sharpenAmount: 'Sharpening', sharpenRadius: 'Sharpening Radius', sharpenDetail: 'Sharpening Detail', sharpenMasking: 'Sharpening Masking',
  nrLuminance: 'Noise Reduction', nrDetail: 'Noise Detail', nrContrast: 'Noise Contrast', nrColor: 'Color Noise Reduction', nrColorDetail: 'Color Noise Detail', nrColorSmoothness: 'Color Smoothness',
  removeCA: 'Remove Chromatic Aberration', distortion: 'Distortion', lensVignette: 'Lens Vignette', lensVignetteMidpoint: 'Lens Vignette Midpoint',
  defringePurple: 'Purple Amount', purpleHueLo: 'Purple Hue', purpleHueHi: 'Purple Hue', defringeGreen: 'Green Amount', greenHueLo: 'Green Hue', greenHueHi: 'Green Hue',
};

/** History label for a settings change, named after the changed control(s). */
export function describeChange(prev, next) {
  const a = expandSettings(prev), b = expandSettings(next);
  let keys = Object.keys(b).filter(k => !same(a[k], b[k]));
  if (keys.some(k => k === 'temp' || k === 'tint')) keys = keys.filter(k => k !== 'wb');
  const names = [...new Set(keys.map(k => KEY_LABELS[k] || k))];
  if (!names.length) return 'No change';
  return names.length <= 2 ? names.join(', ') : names.length + ' settings';
}

// ---------------------------------------------------------------- import

/**
 * Add photos as one import batch. records: [{ assetId, name, w, h, exif? }].
 * Suspected duplicates (same original assetId already in the catalog as a master) are skipped.
 * → { cat, added: [ids], duplicates: [names] }
 */
export function importPhotos(cat, records, now = Date.now()) {
  const batch = cat.lastImport + 1, photos = [...cat.photos], added = [], duplicates = [];
  let nextId = cat.nextId;
  const have = new Set(cat.photos.filter(p => !p.virtualOf).map(p => p.assetId));
  for (const r of records) {
    if (have.has(r.assetId)) { duplicates.push(r.name); continue; }
    have.add(r.assetId);
    const id = 'p' + nextId++;
    photos.push(newPhoto(id, r, now, batch));
    added.push(id);
  }
  return { cat: { ...cat, photos, nextId, lastImport: added.length ? batch : cat.lastImport }, added, duplicates };
}
function newPhoto(id, r, now, batch) {
  const exif = r.exif || null;
  return {
    id, assetId: r.assetId, name: r.name, w: r.w, h: r.h, importedAt: now, importBatch: batch,
    captureDate: exif?.dateTimeOriginal ? exifDateToISO(exif.dateTimeOriginal) : null, exif,
    rating: 0, flag: null, label: null, keywords: [], collections: [],
    develop: developDefaults(), history: [{ label: 'Import', settings: {} }], historyIndex: 0, snapshots: [],
  };
}

/** Remove photos (and the virtual copies of removed masters). Originals stay in the AssetStore. */
export function removePhotos(cat, ids) {
  const gone = new Set(ids);
  for (const p of cat.photos) if (p.virtualOf && gone.has(p.virtualOf)) gone.add(p.id);
  return { ...cat, photos: cat.photos.filter(p => !gone.has(p.id)) };
}

/** Virtual copy: same original, independent develop settings/history/snapshots. → { cat, id } */
export function createVirtualCopy(cat, id) {
  const src = byId(cat, id); if (!src) return { cat, id: null };
  const master = src.virtualOf || src.id, n = cat.photos.filter(p => p.virtualOf === master).length + 1;
  const vid = 'p' + cat.nextId;
  const copy = { ...clone(src), id: vid, virtualOf: master, name: src.name.replace(/ \(Copy \d+\)$/, '') + ` (Copy ${n})`, importedAt: src.importedAt,
    history: [{ label: 'Virtual Copy', settings: compactSettings(src.develop) }], historyIndex: 0, snapshots: [] };
  const i = cat.photos.findIndex(p => p.id === id);
  const photos = [...cat.photos]; photos.splice(i + 1, 0, copy);
  return { cat: { ...cat, photos, nextId: cat.nextId + 1 }, id: vid };
}

// ---------------------------------------------------------------- attributes

export function setRating(cat, ids, rating) { const r = Math.max(0, Math.min(5, Math.round(rating))); return mapPhotos(cat, ids, p => ({ ...p, rating: r })); }
export function setFlag(cat, ids, flag) { if (flag !== null && !FLAGS.includes(flag)) throw Error('Unknown flag ' + flag); return mapPhotos(cat, ids, p => ({ ...p, flag })); }
/** Setting the same label again on a single photo toggles it off (Lightroom behaviour). */
export function setLabel(cat, ids, label) {
  if (label !== null && !LABELS.includes(label)) throw Error('Unknown label ' + label);
  const list = [].concat(ids), toggleOff = label && list.every(id => byId(cat, id)?.label === label);
  return mapPhotos(cat, ids, p => ({ ...p, label: toggleOff ? null : label }));
}
export function parseKeywords(text) { return [...new Set(String(text).split(/[,;\n]/).map(k => k.trim()).filter(Boolean))]; }
export function setKeywords(cat, ids, keywords) { return mapPhotos(cat, ids, p => ({ ...p, keywords: [...keywords] })); }
export function addKeywords(cat, ids, keywords) { return mapPhotos(cat, ids, p => ({ ...p, keywords: [...new Set([...p.keywords, ...keywords])] })); }
export function allKeywords(cat) { return [...new Set(cat.photos.flatMap(p => p.keywords))].sort((a, b) => a.localeCompare(b)); }

// ---------------------------------------------------------------- collections

export function addCollection(cat, name) {
  const id = 'c' + cat.nextId;
  return { cat: { ...cat, nextId: cat.nextId + 1, collections: [...cat.collections, { id, name: String(name).trim() || 'Untitled Collection' }] }, id };
}
export function renameCollection(cat, id, name) { return { ...cat, collections: cat.collections.map(c => c.id === id ? { ...c, name: String(name).trim() || c.name } : c) }; }
export function deleteCollection(cat, id) {
  return { ...cat, collections: cat.collections.filter(c => c.id !== id), photos: cat.photos.map(p => p.collections.includes(id) ? { ...p, collections: p.collections.filter(x => x !== id) } : p) };
}
export function addToCollection(cat, ids, colId) { return mapPhotos(cat, ids, p => p.collections.includes(colId) ? p : { ...p, collections: [...p.collections, colId] }); }
export function removeFromCollection(cat, ids, colId) { return mapPhotos(cat, ids, p => ({ ...p, collections: p.collections.filter(x => x !== colId) })); }

// ---------------------------------------------------------------- filter & sort

/**
 * filter: { source: 'all'|'picks'|'recent'|'<collectionId>', text, minRating (0–5, ≥),
 *           flag: 'any'|'pick'|'reject'|'unflagged', label: 'any'|'none'|<colour>, keyword }
 */
export function filterPhotos(cat, filter = {}) {
  const { source = 'all', text = '', minRating = 0, flag = 'any', label = 'any', keyword = '' } = filter;
  const q = text.trim().toLowerCase(), kw = keyword.trim().toLowerCase();
  return cat.photos.filter(p => {
    if (source === 'picks' && p.flag !== 'pick') return false;
    if (source === 'recent' && p.importBatch !== cat.lastImport) return false;
    if (source !== 'all' && source !== 'picks' && source !== 'recent' && !p.collections.includes(source)) return false;
    if (p.rating < minRating) return false;
    if (flag === 'unflagged' ? p.flag !== null : flag !== 'any' && p.flag !== flag) return false;
    if (label === 'none' ? p.label !== null : label !== 'any' && p.label !== label) return false;
    if (kw && !p.keywords.some(k => k.toLowerCase() === kw)) return false;
    if (q) {
      const hay = [p.name, ...p.keywords, p.exif?.make, p.exif?.model, p.exif?.lens].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

const captureTime = p => p.captureDate ? Date.parse(p.captureDate) : p.importedAt;
/** key: 'capture'|'import'|'name'|'rating'; dir: 'asc'|'desc'. Ties fall back to name, then id. Returns a new array. */
export function sortPhotos(photos, key = 'capture', dir = 'asc') {
  const val = { capture: captureTime, import: p => p.importedAt, rating: p => p.rating, name: () => 0 }[key] || captureTime;
  const k = dir === 'desc' ? -1 : 1;
  return [...photos].sort((a, b) => (val(a) - val(b)) * k || a.name.localeCompare(b.name, undefined, { numeric: true }) * (key === 'name' ? k : 1) || (a.id < b.id ? -1 : 1));
}

// ---------------------------------------------------------------- develop, history, snapshots

/** Replace a photo's develop settings without a history entry (live slider drags). */
export function updateDevelop(cat, id, settings) { return mapPhotos(cat, id, p => ({ ...p, develop: expandSettings(settings) })); }

/** Push the current develop settings as a history step (drops redo steps after the current one). */
export function recordHistory(cat, id, label) {
  return mapPhotos(cat, id, p => {
    const cur = compactSettings(p.develop), base = p.history.slice(0, p.historyIndex + 1);
    if (same(base[base.length - 1]?.settings, cur)) return p;
    const history = [...base, { label, settings: cur }].slice(-HISTORY_LIMIT);
    return { ...p, history, historyIndex: history.length - 1 };
  });
}
/** Set settings and record a history step labelled `label` (default: the changed control's name). */
export function setDevelop(cat, id, settings, label) {
  const p = byId(cat, id); if (!p) return cat;
  return recordHistory(updateDevelop(cat, id, settings), id, label || describeChange(p.develop, settings));
}
/** Jump to a history step (later steps stay until the next edit, like Lightroom). */
export function goToHistory(cat, id, index) {
  return mapPhotos(cat, id, p => p.history[index] ? { ...p, develop: expandSettings(p.history[index].settings), historyIndex: index } : p);
}
export function clearHistory(cat, id) { return mapPhotos(cat, id, p => ({ ...p, history: [{ label: 'History cleared', settings: compactSettings(p.develop) }], historyIndex: 0 })); }

export function addSnapshot(cat, id, name) {
  return mapPhotos(cat, id, p => ({ ...p, snapshots: [...p.snapshots, { name: String(name).trim() || 'Snapshot ' + (p.snapshots.length + 1), settings: compactSettings(p.develop) }] }));
}
export function applySnapshot(cat, id, index) {
  const p = byId(cat, id), snap = p?.snapshots[index]; if (!snap) return cat;
  return setDevelop(cat, id, expandSettings(snap.settings), 'Snapshot: ' + snap.name);
}
export function renameSnapshot(cat, id, index, name) { const n = String(name).trim(); return n ? mapPhotos(cat, id, p => ({ ...p, snapshots: p.snapshots.map((sn, i) => i === index ? { ...sn, name: n } : sn) })) : cat; }
export function deleteSnapshot(cat, id, index) { return mapPhotos(cat, id, p => ({ ...p, snapshots: p.snapshots.filter((_, i) => i !== index) })); }

/** Paste partial settings (from pickPanels) onto photos, one history step each. */
export function pasteSettings(cat, ids, partial, label = 'Paste Settings') {
  let c = cat;
  for (const id of [].concat(ids)) { const p = byId(c, id); if (p) c = setDevelop(c, id, { ...p.develop, ...clone(partial) }, label); }
  return c;
}
/** Sync the chosen panels from one photo to others. */
export function syncSettings(cat, sourceId, targetIds, panels = ALL_PANELS) {
  const src = byId(cat, sourceId); if (!src) return cat;
  return pasteSettings(cat, targetIds.filter(id => id !== sourceId), pickPanels(src.develop, panels), 'Sync Settings');
}
export function resetDevelop(cat, ids) { let c = cat; for (const id of [].concat(ids)) c = setDevelop(c, id, developDefaults(), 'Reset Settings'); return c; }

// ---------------------------------------------------------------- presets

/** Built-in presets (original looks). Each holds only the keys it changes. */
import { PRESET_LIBRARY } from './presetLibrary.js';
const ESSENTIALS = [
  { id: 'b-clean-pop', name: 'Clean Pop', builtin: true, settings: { contrast: 14, highlights: -22, shadows: 18, clarity: 10, vibrance: 22 } },
  { id: 'b-soft-matte', name: 'Soft Matte', builtin: true, settings: { contrast: -12, highlights: -10, curve: { rgb: [[0, 26], [128, 130], [255, 240]] }, saturation: -8 } },
  { id: 'b-warm-afternoon', name: 'Warm Afternoon', builtin: true, settings: { wb: 'custom', temp: 18, tint: 4, vibrance: 10, grading: { highlights: { hue: 42, sat: 14, lum: 0 } } } },
  { id: 'b-cool-dusk', name: 'Cool Dusk', builtin: true, settings: { wb: 'custom', temp: -16, tint: 3, grading: { shadows: { hue: 220, sat: 18, lum: 0 } }, contrast: 8 } },
  { id: 'b-faded-film', name: 'Faded Film', builtin: true, settings: { contrast: -10, saturation: -18, grainAmount: 22, grainSize: 30, vignetteAmount: -14, curve: { rgb: [[0, 30], [255, 236]] } } },
  { id: 'b-silver-mono', name: 'Silver Mono', builtin: true, settings: { profile: 'monochrome', profileAmount: 100, contrast: 18, clarity: 14 } },
  { id: 'b-crisp-detail', name: 'Crisp Detail', builtin: true, settings: { sharpenAmount: 60, sharpenMasking: 20, texture: 18, clarity: 8 } },
];
/** Built-in presets: the 7 essentials plus the categorised original library (presetLibrary.js). */
export const BUILTIN_PRESETS = [...ESSENTIALS.map(p => ({ ...p, category: 'Essentials' })), ...PRESET_LIBRARY];

/** Apply a preset: deep-merges ONLY the preset's keys into the settings. */
export function applyPreset(settings, preset) { return mergeDeep(expandSettings(settings), preset.settings); }
/**
 * Preset with an Amount (Lightroom Mobile): `base` + (applyPreset(base) − base) · amount/100 for every
 * numeric value the preset changes (nested objects and equal-length numeric arrays such as curve
 * points included); non-numeric values switch at 50 %. amount 0..200.
 */
export function blendPreset(base, preset, amount = 100) {
  const b = expandSettings(base), t = applyPreset(b, preset), k = amount / 100;
  const mix = (x, y) => {
    if (typeof x === 'number' && typeof y === 'number') return x + (y - x) * k;
    if (Array.isArray(x) && Array.isArray(y) && x.length === y.length) return x.map((v, i) => mix(v, y[i]));
    if (isObj(x) && isObj(y)) { const o = { ...x }; for (const key of Object.keys(y)) o[key] = key in x ? mix(x[key], y[key]) : (k >= 0.5 ? clone(y[key]) : undefined); return o; }
    return same(x, y) ? x : k >= 0.5 ? clone(y) : clone(x);
  };
  return mix(b, t);
}
export function allPresets(cat) { return [...BUILTIN_PRESETS, ...cat.presets]; }
/** Save a user preset from the chosen panels of `settings`. → { cat, id } */
export function savePreset(cat, name, settings, panels = ALL_PANELS) {
  const id = 'u' + cat.nextId;
  return { cat: { ...cat, nextId: cat.nextId + 1, presets: [...cat.presets, { id, name: String(name).trim() || 'User Preset', settings: pickPanels(settings, panels) }] }, id };
}
export function deletePreset(cat, id) { return { ...cat, presets: cat.presets.filter(p => p.id !== id) }; }

// ---------------------------------------------------------------- preview cache, references

export const cacheGet = (cat, key) => cat.cache[key] || null;
export function cachePut(cat, key, blobId) {
  const cache = { ...cat.cache }; delete cache[key]; cache[key] = blobId;
  const keys = Object.keys(cache); for (let i = 0; i < keys.length - CACHE_LIMIT; i++) delete cache[keys[i]];
  return { ...cat, cache };
}
/** Every AssetStore id the catalog needs (originals + cached previews): include these if assets are ever garbage-collected. */
export function referencedAssetIds(cat) { return [...new Set([...cat.photos.map(p => p.assetId), ...Object.values(cat.cache)])]; }

// ---------------------------------------------------------------- export

/** Fit w×h into a long edge (never upscales). longEdge 0/null = original size. */
export function fitLongEdge(w, h, longEdge) {
  if (!longEdge || Math.max(w, h) <= longEdge) return { w, h };
  const k = longEdge / Math.max(w, h);
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/** File name from a template with {name}, {seq} / {seq:N} (zero-padded) and {date} (YYYY-MM-DD capture date, else import date). */
export function exportFileName(template, photo, seq, ext) {
  const base = photo.name.replace(/\.[^.]+$/, '');
  const d = photo.captureDate ? new Date(photo.captureDate) : new Date(photo.importedAt);
  const date = isNaN(d) ? 'undated' : d.toISOString().slice(0, 10);
  let s = String(template || '{name}').replace(/\{name\}/g, base).replace(/\{date\}/g, date).replace(/\{seq(?::(\d+))?\}/g, (_, n) => String(seq).padStart(+n || 1, '0'));
  s = s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().replace(/^\.+/, '') || 'photo';
  return s + '.' + ext;
}

/**
 * Plan an export of several photos. opts: { format: 'jpeg'|'png', quality (0–100), longEdge, template, startSeq }.
 * → [{ id, fileName, mime, quality (0–1), w, h }] with unique file names.
 */
export function planExport(photos, opts = {}) {
  const { format = 'jpeg', quality = 90, longEdge = 0, template = '{name}', startSeq = 1 } = opts;
  const ext = format === 'png' ? 'png' : 'jpg', mime = format === 'png' ? 'image/png' : 'image/jpeg', used = new Set();
  return photos.map((p, i) => {
    let fileName = exportFileName(template, p, startSeq + i, ext);
    for (let n = 2; used.has(fileName.toLowerCase()); n++) fileName = fileName.replace(/(-\d+)?\.(\w+)$/, `-${n}.$2`);
    used.add(fileName.toLowerCase());
    return { id: p.id, fileName, mime, quality: Math.max(0, Math.min(100, quality)) / 100, ...fitLongEdge(p.w, p.h, longEdge) };
  });
}

/** Pure full-resolution render for export: develop() at scale 1, then area-correct resample to the long edge. */
export function renderForExport(buf, settings, { longEdge = 0 } = {}) {
  const out = develop({ w: buf.w, h: buf.h, data: new Uint8ClampedArray(buf.data) }, expandSettings(settings), { scale: 1 });
  const size = fitLongEdge(out.w, out.h, longEdge);
  return size.w === out.w && size.h === out.h ? out : resample(out, size.w, size.h, 'bicubic');
}

// ---------------------------------------------------------------- EXIF (JPEG APP1)

/** '2024:05:17 14:03:21' → '2024-05-17T14:03:21' (local time, no zone), or null. */
export function exifDateToISO(s) {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(s || '').trim());
  return m && m[1] !== '0000' ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}` : null;
}

/**
 * Minimal EXIF reader for JPEG files: walks the markers to APP1 "Exif", reads IFD0 (Make, Model,
 * Orientation) and the Exif sub-IFD (DateTimeOriginal, ISO, FNumber, ExposureTime, FocalLength,
 * LensModel). Returns null for non-JPEG input or when no EXIF block is present; never throws.
 */
export function parseExif(input) {
  try {
    const b = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (b[0] !== 0xff || b[1] !== 0xd8) return null;
    let p = 2;
    while (p + 4 <= b.length) {
      if (b[p] !== 0xff) return null;
      const marker = b[p + 1];
      if (marker === 0xd9 || marker === 0xda) return null; // EOI / start of scan: no EXIF before image data
      if (marker === 0xff) { p++; continue; }
      if (marker >= 0xd0 && marker <= 0xd7) { p += 2; continue; }
      const len = (b[p + 2] << 8) | b[p + 3];
      if (marker === 0xe1 && len >= 8 && b[p + 4] === 0x45 && b[p + 5] === 0x78 && b[p + 6] === 0x69 && b[p + 7] === 0x66 && b[p + 8] === 0 && b[p + 9] === 0)
        return readTiff(b.subarray(p + 10, Math.min(b.length, p + 2 + len)));
      p += 2 + len;
    }
    return null;
  } catch { return null; }
}

function readTiff(t) {
  const le = t[0] === 0x49 && t[1] === 0x49;
  if (!le && !(t[0] === 0x4d && t[1] === 0x4d)) return null;
  const dv = new DataView(t.buffer, t.byteOffset, t.byteLength);
  const u16 = o => dv.getUint16(o, le), u32 = o => dv.getUint32(o, le);
  if (u16(2) !== 42) return null;
  const SIZES = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
  const readIfd = off => {
    const tags = {};
    if (off < 8 || off + 2 > t.length) return tags;
    const n = u16(off);
    for (let i = 0; i < n; i++) {
      const e = off + 2 + i * 12; if (e + 12 > t.length) break;
      const tag = u16(e), type = u16(e + 2), count = u32(e + 4), size = (SIZES[type] || 0) * count;
      if (!size) continue;
      const at = size <= 4 ? e + 8 : u32(e + 8);
      if (at + size > t.length) continue;
      let v;
      if (type === 2) { v = ''; for (let k = 0; k < count && t[at + k]; k++) v += String.fromCharCode(t[at + k]); v = v.trim(); }
      else if (type === 3) v = u16(at);
      else if (type === 4) v = u32(at);
      else if (type === 9) v = dv.getInt32(at, le);
      else if (type === 5) { const d = u32(at + 4); v = d ? u32(at) / d : 0; }
      else if (type === 10) { const d = dv.getInt32(at + 4, le); v = d ? dv.getInt32(at, le) / d : 0; }
      else if (type === 1 || type === 7) v = t[at];
      tags[tag] = v;
    }
    return tags;
  };
  const ifd0 = readIfd(u32(4)), ex = ifd0[0x8769] ? readIfd(ifd0[0x8769]) : {};
  const out = {
    make: ifd0[0x010f] || null, model: ifd0[0x0110] || null, orientation: ifd0[0x0112] || 1,
    dateTimeOriginal: ex[0x9003] || ex[0x9004] || ifd0[0x0132] || null,
    iso: ex[0x8827] ?? null, fNumber: ex[0x829d] ?? null, exposureTime: ex[0x829a] ?? null,
    focalLength: ex[0x920a] ?? null, lens: ex[0xa434] || null,
  };
  const found = Object.entries(out).some(([k, v]) => k !== 'orientation' && v != null) || out.orientation !== 1;
  return found ? out : null;
}

/** Human-readable EXIF rows [[label, value]] for the Metadata panel. */
export function formatExif(exif) {
  if (!exif) return [];
  const rows = [];
  const cam = [exif.make, exif.model && exif.make && exif.model.startsWith(exif.make) ? exif.model.slice(exif.make.length).trim() : exif.model].filter(Boolean).join(' ');
  if (cam) rows.push(['Camera', cam]);
  if (exif.lens) rows.push(['Lens', exif.lens]);
  if (exif.dateTimeOriginal) rows.push(['Captured', (exifDateToISO(exif.dateTimeOriginal) || exif.dateTimeOriginal).replace('T', ' ')]);
  if (exif.exposureTime) rows.push(['Exposure', exif.exposureTime >= 1 ? `${+exif.exposureTime.toFixed(1)} s` : `1/${Math.round(1 / exif.exposureTime)} s`]);
  if (exif.fNumber) rows.push(['Aperture', 'f/' + +exif.fNumber.toFixed(1)]);
  if (exif.iso) rows.push(['ISO', String(exif.iso)]);
  if (exif.focalLength) rows.push(['Focal length', +exif.focalLength.toFixed(1) + ' mm']);
  if (exif.orientation && exif.orientation !== 1) rows.push(['Orientation', String(exif.orientation)]);
  return rows;
}

// ---------------------------------------------------------------- persistence backends

/** In-memory backend (tests). `data` exposes the last saved catalog. */
export function memoryCatalogBackend(initial = null) {
  const b = { data: initial ? clone(initial) : null, load: async () => b.data ? clone(b.data) : null, save: async cat => { b.data = clone(cat); } };
  return b;
}

/** IndexedDB backend: database `zertake-catalog`, object store `catalog`, one record 'main'. */
export function idbCatalogBackend(dbName = 'zertake-catalog') {
  const open = () => new Promise((resolve, reject) => {
    const r = globalThis.indexedDB.open(dbName, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('catalog')) r.result.createObjectStore('catalog'); };
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error || Error('Could not open the catalog database'));
  });
  const tx = (mode, fn) => open().then(d => new Promise((resolve, reject) => {
    const t = d.transaction('catalog', mode), req = fn(t.objectStore('catalog')); let value;
    if (req) req.onsuccess = () => { value = req.result; };
    t.oncomplete = () => { d.close(); resolve(value); };
    t.onerror = t.onabort = () => { d.close(); reject(t.error || Error('Catalog storage failed')); };
  }));
  return { load: () => tx('readonly', s => s.get('main')).then(v => v || null), save: cat => tx('readwrite', s => s.put(cat, 'main')) };
}
