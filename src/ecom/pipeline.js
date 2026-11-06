// Browser-side pipeline of the E-commerce studio: decoding / encoding, a serial queue in front of
// the pixel-op worker, per-item caches (working image, retouched image, cut-out) and rendering of
// one item for one preset. Uses the DOM (createImageBitmap, canvas) — not for src/engine.
//
// Heavy pixel work goes through runOp (the ops worker): 'resample' (downscale on import and the
// product resize), 'cameraRaw' (retouch). Matte refinement / cut-out and compositing use the pure
// functions in ./engine.js through tryOp(): if the lead registers 'ecomCutout' / 'ecomCompose' in
// src/engine/ops.js they run in the worker automatically; until then they run here, async.

import { productBounds, cropBuffer, ecomCutoutOp, ecomComposeOp, placeProduct, batchScales, retouchSettings, isRetouchIdentity } from './engine.js';
import { resolvePreset, backgroundStats, checkPreset, FORMATS } from './presets.js';

export const WORK_MAX = 2400; // long side of the working image (originals larger than this are downscaled once)
const tick = () => new Promise(r => setTimeout(r, 0));

/** Serialise calls: the ops client cancels a running job when a new one starts. */
export function createQueue(runOp) {
  let chain = Promise.resolve();
  const unknown = new Set();
  const run = (op, buf, params, ctx = {}) => { const p = chain.then(() => runOp(op, buf, params, ctx)); chain = p.catch(() => {}); return p; };
  /** Run a registry op in the worker, or `local` here when the worker does not know the op. */
  const tryOp = async (op, buf, params, local) => {
    if (!unknown.has(op)) {
      try { return await run(op, buf, params); }
      catch (e) { if (!/unknown operation/i.test(e.message || '')) throw e; unknown.add(op); }
    }
    await tick(); return local(buf, params);
  };
  return { run, tryOp };
}

// ------------------------------------------------------------------ codecs ------------------
const mkCanvas = (w, h) => { if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h); const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
export async function decodeBlob(blob) {
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'default', premultiplyAlpha: 'none' });
  const c = mkCanvas(bmp.width, bmp.height), x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(bmp, 0, 0); bmp.close?.();
  const d = x.getImageData(0, 0, c.width, c.height);
  return { w: d.width, h: d.height, data: d.data };
}
export function bufToCanvas(buf, canvas) {
  const c = canvas || mkCanvas(buf.w, buf.h); c.width = buf.w; c.height = buf.h;
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(buf.data), buf.w, buf.h), 0, 0);
  return c;
}
/** Encode RGBA → Blob. JPEG has no alpha, so transparent pixels are flattened onto white first. */
export async function encodeBuf(buf, format = 'png', quality = 92) {
  const f = FORMATS[format] || FORMATS.png;
  let b = buf;
  if (format === 'jpeg') {
    const d = new Uint8ClampedArray(buf.data);
    for (let i = 0; i < d.length; i += 4) { const a = d[i + 3] / 255; if (a < 1) { d[i] = d[i] * a + 255 * (1 - a); d[i + 1] = d[i + 1] * a + 255 * (1 - a); d[i + 2] = d[i + 2] * a + 255 * (1 - a); d[i + 3] = 255; } }
    b = { w: buf.w, h: buf.h, data: d };
  }
  const c = bufToCanvas(b), q = f.mime === 'image/png' ? undefined : Math.max(0.05, Math.min(1, quality / 100));
  if (c.convertToBlob) return c.convertToBlob({ type: f.mime, quality: q });
  return new Promise((res, rej) => c.toBlob(bl => bl ? res(bl) : rej(Error('Encoding failed')), f.mime, q));
}

// ------------------------------------------------------------------ LRU ---------------------
class LRU { constructor(n) { this.n = n; this.m = new Map(); } get(k) { if (!this.m.has(k)) return undefined; const v = this.m.get(k); this.m.delete(k); this.m.set(k, v); return v; } set(k, v) { this.m.delete(k); this.m.set(k, v); while (this.m.size > this.n) this.m.delete(this.m.keys().next().value); return v; } clear() { this.m.clear(); } }

const keyOf = o => JSON.stringify(o);
const aiKey = ai => ai ? ai.w + 'x' + ai.h + ':' + ai.b64.length + ':' + ai.b64.slice(0, 48) + ai.b64.slice(-48) : 'none';

/**
 * createPipeline({ assetStore, runOp }) → pipeline object (see methods below).
 */
export function createPipeline({ assetStore, runOp }) {
  const q = createQueue(runOp);
  const work = new LRU(8), retouched = new LRU(6), cuts = new LRU(6), bgImages = new LRU(2), pending = new Map();
  const once = (key, fn) => { if (pending.has(key)) return pending.get(key); const p = fn().finally(() => pending.delete(key)); pending.set(key, p); return p; };

  /** Working image of an item (original, downscaled to ≤ WORK_MAX on its long side). */
  const workImage = item => {
    const hit = work.get(item.assetId); if (hit) return Promise.resolve(hit);
    return once('work:' + item.assetId, async () => {
      let buf = await decodeBlob(await assetStore.get(item.assetId));
      const k = Math.min(1, WORK_MAX / Math.max(buf.w, buf.h));
      if (k < 1) buf = await q.run('resample', buf, { w: Math.round(buf.w * k), h: Math.round(buf.h * k), method: 'bicubic' });
      return work.set(item.assetId, buf);
    });
  };
  /** Working image with the item's light retouch applied (Camera Raw op in the worker). */
  const retouchedImage = async item => {
    const src = await workImage(item);
    if (isRetouchIdentity(item.retouch)) return src;
    const key = item.assetId + keyOf(item.retouch), hit = retouched.get(key); if (hit) return hit;
    return once('rt:' + key, async () => retouched.set(key, await q.run('cameraRaw', src, { settings: retouchSettings(src, item.retouch) })));
  };
  /** Cut-out of an item → { cut (full working size RGBA), bounds, alpha view } (cached). */
  const cutoutOf = async item => {
    if (!item.ai) throw Error('Remove the background of “' + item.name + '” first');
    const key = keyOf([item.assetId, aiKey(item.ai), item.matte, item.strokes, item.retouch]), hit = cuts.get(key); if (hit) return hit;
    return once('cut:' + key, async () => {
      const guide = await workImage(item), img = await retouchedImage(item);
      const params = { ai: item.ai, matte: item.matte, strokes: item.strokes, guide: img === guide ? null : guide };
      const cut = await q.tryOp('ecomCutout', img, params, (b, p) => ecomCutoutOp(b, p));
      const a = new Uint8Array(cut.w * cut.h); for (let i = 0; i < a.length; i++) a[i] = cut.data[i * 4 + 3];
      return cuts.set(key, { cut, bounds: productBounds(a, cut.w, cut.h), w: cut.w, h: cut.h });
    });
  };
  const backgroundImage = async id => {
    if (!id) return null; const hit = bgImages.get(id); if (hit) return hit;
    return bgImages.set(id, await decodeBlob(await assetStore.get(id)));
  };

  /**
   * Render one item for one preset. opts: { settings (project settings), items (all items, for the
   * uniform batch scale), scale (preview factor ≤ 1) }. Returns { buf, place, product, upscale, canvas }.
   */
  async function render(item, opts) {
    const s = opts.settings, preset = resolvePreset(opts.presetId || s.presetId, s.custom), k = opts.scale || 1;
    const c = await cutoutOf(item);
    if (!c.bounds) throw Error('No product was found in “' + item.name + '” — restore it with the touch-up brush');
    const canvas = { W: Math.max(1, Math.round(preset.w * k)), H: Math.max(1, Math.round(preset.h * k)) };
    const L = Math.max(c.w, c.h);
    let scale;
    if (s.framing.sizing === 'uniform') {
      const batch = (opts.items || [item]).filter(it => it.ai && it.bounds && it.workW);
      const list = batch.map(it => it.id === item.id ? { w: c.bounds.w, h: c.bounds.h, L } : { w: it.bounds.w, h: it.bounds.h, L: Math.max(it.workW, it.workH) });
      if (!batch.some(it => it.id === item.id)) list.push({ w: c.bounds.w, h: c.bounds.h, L });
      const scales = batchScales(list, { W: preset.w, H: preset.h }, s.framing), idx = batch.findIndex(it => it.id === item.id);
      scale = scales[idx >= 0 ? idx : scales.length - 1] * k;
    }
    const place = placeProduct(c.bounds, canvas, { ...s.framing, scale });
    const crop = cropBuffer(c.cut, c.bounds);
    const product = (place.w === crop.w && place.h === crop.h) ? crop : await q.run('resample', crop, { w: place.w, h: place.h, method: 'bicubic' });
    const bgImage = s.background.type === 'image' ? await backgroundImage(s.background.imageId) : null;
    if (s.background.type === 'image' && !bgImage) throw Error('Choose a background image first');
    const params = { canvas, place, background: s.background, shadow: s.shadow, reflection: s.reflection, bgImage };
    const buf = await q.tryOp('ecomCompose', product, params, (b, p) => ecomComposeOp(b, p));
    return { buf, place, product, canvas, preset, bounds: c.bounds, workW: c.w, workH: c.h, upscale: place.scale / k * c.w / item.w };
  }

  /** Full-size render + encode + checklist for one item and preset. */
  async function check(item, opts) {
    const r = await render(item, { ...opts, scale: 1 }), fmt = opts.settings.export.format;
    const blob = await encodeBuf(r.buf, fmt, opts.settings.export.quality);
    const stats = backgroundStats(r.buf, r.place, r.product);
    return { ...r, blob, rows: checkPreset(r.preset, { w: r.buf.w, h: r.buf.h, place: r.place, stats, bytes: blob.size, format: fmt, upscale: r.upscale }) };
  }

  return {
    queue: q, workImage, retouchedImage, cutoutOf, backgroundImage, render, check,
    clear: () => { work.clear(); retouched.clear(); cuts.clear(); bgImages.clear(); },
  };
}
