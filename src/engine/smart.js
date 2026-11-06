// Smart Objects: an embedded, never-modified source image plus a non-destructive stack of
// smart filters. The layer's geometry (x, y, w, h, rotation, flip) is a transform of the
// source, so scaling down and back up never loses pixels.
//
// layer = { type: 'smart', x, y, w, h, rotation, ...,
//           smart: { sourceId, sw, sh,            // embedded source asset and its pixel size
//                    filters: [{ id, op, params, enabled }], // applied bottom → top
//                    filtersOn,                     // the "Smart Filters" eye
//                    renderId } }                   // cached result of the stack (or null)
//
// The cache is only an optimisation: renderStack() can always rebuild it from the source.

/** Transparent margin added around the source while filters run, so blurs and glows are not cut off. */
export const padOf = smart => Number.isInteger(smart.pad) ? smart.pad : Math.min(256, Math.ceil(Math.max(smart.sw, smart.sh) / 4));
/** Offset (source px) of the shown surface relative to the source's top-left corner. */
export const smartOffset = smart => smart.renderId ? padOf(smart) : 0;

/** Surface descriptor (see editor/surfaces.js): the filtered render (padded) or the plain source. */
export const smartSurface = l => {
  const p = smartOffset(l.smart);
  return { id: l.id + '#smart', w: l.smart.sw + 2 * p, h: l.smart.sh + 2 * p, assetId: l.smart.renderId || l.smart.sourceId };
};

export function padBuffer(buf, p) {
  if (!p) return buf;
  const w = buf.w + 2 * p, h = buf.h + 2 * p, data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < buf.h; y++) data.set(buf.data.subarray(y * buf.w * 4, (y + 1) * buf.w * 4), ((y + p) * w + p) * 4);
  return { w, h, data };
}

export const activeFilters = smart => smart.filtersOn === false ? [] : smart.filters.filter(f => f.enabled !== false);

/** True when the cached render is the plain source (no active filters). */
export const isPlain = smart => activeFilters(smart).length === 0;

/** Create a smart object layer from a source asset; `base` carries id/name/opacity/blend/mask/style… */
export function makeSmartLayer(base, sourceId, sw, sh, x, y) {
  const { assetId, develop, adj, fillSpec, text, src, ...keep } = base;
  return { ...keep, type: 'smart', x, y, w: sw, h: sh, rotation: base.rotation || 0, smart: { sourceId, sw, sh, filters: [], filtersOn: true, renderId: null } };
}

/**
 * Run the active filter stack. `run(op, buf, params, ctx)` executes one registry op (worker or
 * direct). `upTo` limits the stack to filters before that index (used to preview an edit).
 */
export async function renderStack(source, smart, run, ctx = {}, upTo = Infinity) {
  // Always padded, so a partial stack (filter editing) has the same geometry as the full render.
  let buf = padBuffer(source, padOf(smart));
  const list = smart.filtersOn === false ? [] : smart.filters.slice(0, upTo);
  for (const f of list) {
    if (f.enabled === false) continue;
    buf = await run(f.op, buf, f.params || {}, { ...ctx, mask: null, offsetX: 0, offsetY: 0, docW: buf.w, docH: buf.h, scale: 1 });
  }
  return buf;
}

export const smartUpdate = (l, patch) => ({ ...l, smart: { ...l.smart, ...patch } });
export const addFilter = (l, f, renderId) => smartUpdate(l, { filters: [...l.smart.filters, f], renderId, filtersOn: true });
export const setFilter = (l, id, patch) => smartUpdate(l, { filters: l.smart.filters.map(f => f.id === id ? { ...f, ...patch } : f) });
export const removeFilter = (l, id) => smartUpdate(l, { filters: l.smart.filters.filter(f => f.id !== id) });
export const moveFilter = (l, id, d) => {
  const fs = [...l.smart.filters], i = fs.findIndex(f => f.id === id), j = i + d;
  if (i < 0 || j < 0 || j >= fs.length) return l;
  [fs[i], fs[j]] = [fs[j], fs[i]];
  return smartUpdate(l, { filters: fs });
};

/** Replace the contents and keep the on-canvas size of the old contents (Photoshop keeps the transform). */
export function replaceContents(l, sourceId, sw, sh) {
  const kx = l.w / l.smart.sw, ky = l.h / l.smart.sh;
  const w = Math.max(1, sw * kx), h = Math.max(1, sh * ky);
  return { ...l, x: l.x + (l.w - w) / 2, y: l.y + (l.h - h) / 2, w, h, smart: { ...l.smart, sourceId, sw, sh, renderId: null } };
}
