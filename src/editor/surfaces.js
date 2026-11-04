// Browser pixel surfaces for raster layers and layer masks.
//
// One HTMLCanvasElement per surface id (a layer id, or `<layerId>#mask`) holds the decoded
// pixels. The document only stores content-addressed asset ids. A surface remembers which
// content key it shows (the asset id, or `fill:<v>` for a uniform mask), so committing a
// stroke (which changes the id) does not reload it, while undo/redo restoring an older id
// does. Canvases are created outside React so a stroke can start before the layer renders.
// Subscribers (mask previews) are notified after a load and when a stroke repaints.

// Only mask surfaces have a numeric grey `fill`; layer objects may carry an unrelated colour string.
const maskFill = o => typeof o.fill === 'number' ? o.fill : null;
const contentKey = o => o.assetId !== null ? o.assetId : maskFill(o) === null ? 'empty' : 'fill:' + maskFill(o);

export const maskSurface = l => ({ id: l.id + '#mask', w: l.mask.w, h: l.mask.h, assetId: l.mask.assetId, fill: l.mask.fill });

export function createSurfaces(store, onError) {
  const map = new Map();
  const listeners = new Map();
  const notify = id => { for (const f of listeners.get(id) || []) f(); };

  function make(o) {
    const canvas = document.createElement('canvas');
    canvas.width = o.w; canvas.height = o.h;
    canvas.className = 'rasterSurface';
    canvas.dataset.layerId = o.id;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const s = { id: o.id, canvas, ctx, key: undefined, loadingKey: undefined, error: null };
    map.set(o.id, s);
    return s;
  }

  function load(s, o) {
    const key = contentKey(o);
    s.loadingKey = key;
    if (o.assetId === null) {
      s.ctx.clearRect(0, 0, s.canvas.width, s.canvas.height);
      if (maskFill(o) !== null) { s.ctx.fillStyle = `rgb(${o.fill},${o.fill},${o.fill})`; s.ctx.fillRect(0, 0, s.canvas.width, s.canvas.height); }
      s.key = key; s.error = null; notify(s.id);
      return;
    }
    (async () => {
      const blob = await store.get(o.assetId);
      const bmp = await createImageBitmap(blob);
      if (s.loadingKey !== key) return; // superseded by a newer load
      s.ctx.clearRect(0, 0, s.canvas.width, s.canvas.height);
      s.ctx.drawImage(bmp, 0, 0);
      bmp.close?.();
      s.key = key; s.error = null; notify(s.id);
    })().catch(e => { if (s.loadingKey === key) { s.error = e.message; onError?.(e.message); } });
  }

  return {
    ensure(o) {
      let s = map.get(o.id);
      if (!s || s.canvas.width !== o.w || s.canvas.height !== o.h) s = make(o);
      if (s.loadingKey !== contentKey(o)) load(s, o);
      return s;
    },
    get: id => map.get(id),
    /** Force the next ensure() to reload from the document (used after a failed save). */
    invalidate(id) { const s = map.get(id); if (s) s.loadingKey = undefined; },
    /** Called right before a commit that sets the surface's asset to `id` with pixels already on the canvas. */
    markCommitted(surfaceId, id) { const s = map.get(surfaceId); if (s) { s.key = id; s.loadingKey = id; } },
    isReady(o) { const s = map.get(o.id); return !!s && s.key === contentKey(o) && !s.error; },
    subscribe(id, f) { if (!listeners.has(id)) listeners.set(id, new Set()); listeners.get(id).add(f); return () => listeners.get(id)?.delete(f); },
    notify,
    dispose() { map.clear(); listeners.clear(); },
  };
}

export function canvasToPngBlob(imageData) {
  const c = document.createElement('canvas');
  c.width = imageData.width; c.height = imageData.height;
  c.getContext('2d').putImageData(imageData, 0, 0);
  return new Promise((resolve, reject) => c.toBlob(b => b ? resolve(b) : reject(Error('PNG encoding failed')), 'image/png'));
}
