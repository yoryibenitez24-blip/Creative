// Browser pixel surfaces for raster (paint) layers.
//
// One HTMLCanvasElement per raster layer id holds the decoded pixels shown on
// screen. The document only stores the content-addressed asset id; a surface
// knows which asset it currently displays, so committing a stroke (which changes
// the id) does not trigger a reload, while undo/redo (which restores an older id)
// does. Canvases are created outside React so a stroke can start on a layer that
// has not been rendered yet.

export function createSurfaces(store, onError) {
  const map = new Map();

  function make(layer) {
    const canvas = document.createElement('canvas');
    canvas.width = layer.w; canvas.height = layer.h;
    canvas.className = 'rasterSurface';
    canvas.dataset.layerId = layer.id;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const s = { canvas, ctx, assetId: undefined, loadingId: undefined, error: null };
    map.set(layer.id, s);
    return s;
  }

  function load(s, id) {
    s.loadingId = id;
    if (id === null) { s.ctx.clearRect(0, 0, s.canvas.width, s.canvas.height); s.assetId = null; s.error = null; return; }
    (async () => {
      const blob = await store.get(id);
      const bmp = await createImageBitmap(blob);
      if (s.loadingId !== id) return; // superseded by a newer load
      s.ctx.clearRect(0, 0, s.canvas.width, s.canvas.height);
      s.ctx.drawImage(bmp, 0, 0);
      bmp.close?.();
      s.assetId = id; s.error = null;
    })().catch(e => { if (s.loadingId === id) { s.error = e.message; onError?.(e.message); } });
  }

  return {
    ensure(layer) {
      let s = map.get(layer.id);
      if (!s || s.canvas.width !== layer.w || s.canvas.height !== layer.h) s = make(layer);
      if (s.loadingId !== layer.assetId) load(s, layer.assetId);
      return s;
    },
    get: id => map.get(id),
    /** Called right before a commit that sets the layer's asset to `id` with pixels already on the canvas. */
    markCommitted(layerId, id) { const s = map.get(layerId); if (s) { s.assetId = id; s.loadingId = id; } },
    isReady(layer) { const s = map.get(layer.id); return !!s && s.assetId === layer.assetId && !s.error; },
    dispose() { map.clear(); },
  };
}

export function canvasToPngBlob(imageData) {
  const c = document.createElement('canvas');
  c.width = imageData.width; c.height = imageData.height;
  c.getContext('2d').putImageData(imageData, 0, 0);
  return new Promise((resolve, reject) => c.toBlob(b => b ? resolve(b) : reject(Error('PNG encoding failed')), 'image/png'));
}
