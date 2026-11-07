// Image resolution for the builder (browser only).
//   genUrl(ref)                     → blob: URL of a procedural 'gen:' image (cached for the session)
//   createImageResolver(assetStore, onLoad) → { url(ref), ready(refs): Promise<void> }
//       'asset:<id>' refs are loaded from the AssetStore lazily; onLoad() is called when one arrives.
//   uploadImage(file, assetStore)   → Promise<ImageRef>  (downscaled to ≤ 2000 px; 'asset:<id>' or a data: URL)
import { artSvg, artDataUrl, isGen } from './art.js';

const genCache = new Map();
export function genUrl(ref) {
  if (!isGen(ref)) return ref && /^(data:|blob:|https?:)/.test(ref) ? ref : '';
  let u = genCache.get(ref);
  if (!u) {
    u = typeof URL !== 'undefined' && URL.createObjectURL && typeof Blob !== 'undefined' ? URL.createObjectURL(new Blob([artSvg(ref)], { type: 'image/svg+xml' })) : artDataUrl(ref);
    genCache.set(ref, u);
  }
  return u;
}

export function createImageResolver(assetStore, onLoad) {
  const urls = new Map(), pending = new Map();
  const load = ref => {
    if (pending.has(ref)) return pending.get(ref);
    const p = (async () => {
      try { const blob = await assetStore.get(ref.slice(6)); urls.set(ref, URL.createObjectURL(blob)); onLoad && onLoad(); }
      catch { urls.set(ref, ''); }
    })();
    pending.set(ref, p); return p;
  };
  return {
    url(ref) {
      if (!ref) return '';
      if (!ref.startsWith('asset:')) return genUrl(ref);
      if (urls.has(ref)) return urls.get(ref);
      if (assetStore) load(ref);
      return '';
    },
    async ready(refs) { await Promise.all(refs.filter(r => r && r.startsWith('asset:') && !urls.has(r) && assetStore).map(load)); },
  };
}

export async function uploadImage(file, assetStore, max = 2000) {
  let blob = file;
  try {
    if (file.type !== 'image/svg+xml' && typeof createImageBitmap === 'function') {
      const bmp = await createImageBitmap(file);
      if (Math.max(bmp.width, bmp.height) > max) {
        const k = max / Math.max(bmp.width, bmp.height), c = document.createElement('canvas');
        c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
        c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
        const type = file.type === 'image/png' || file.type === 'image/webp' ? 'image/png' : 'image/jpeg';
        blob = await new Promise(res => c.toBlob(res, type, 0.9)) || file;
      }
      bmp.close && bmp.close();
    }
  } catch { blob = file; }
  if (assetStore) return 'asset:' + await assetStore.put(blob);
  return await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
}
