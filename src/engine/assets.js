// Content-addressed asset store.
//
// Pixel data (raster layer PNGs) is stored once per unique content under
// id = "sha256-<hex>". Documents and undo snapshots hold only the id, so history
// steps never duplicate pixels and identical content is deduplicated.
// Persistence goes through an injected backend (IndexedDB in the browser, a Map in tests).

export async function hashBytes(bytes) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return 'sha256-' + Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

export function memoryBackend() {
  const m = new Map();
  return { get: async id => m.get(id), put: async (id, blob) => { m.set(id, blob); }, keys: async () => [...m.keys()], delete: async id => { m.delete(id); }, map: m };
}

export class AssetStore {
  constructor(backend) { this.backend = backend; this.blobs = new Map(); this.urls = new Map(); }

  async put(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const id = await hashBytes(bytes);
    if (!this.blobs.has(id)) {
      this.blobs.set(id, blob);
      await this.backend.put(id, blob); // throws on quota errors: callers must not commit a doc that references an unsaved asset
    }
    return id;
  }

  async get(id) {
    if (this.blobs.has(id)) return this.blobs.get(id);
    const blob = await this.backend.get(id);
    if (!blob) throw Error('Missing pixel data for asset ' + id.slice(0, 18) + '…');
    this.blobs.set(id, blob);
    return blob;
  }

  has(id) { return this.blobs.has(id); }

  /** Delete persisted assets that no persisted document references. In-session blobs stay for undo. */
  async collect(referenced) {
    const keep = new Set(referenced);
    let removed = 0;
    for (const id of await this.backend.keys()) if (!keep.has(id)) { await this.backend.delete(id); removed++; }
    return removed;
  }
}

export async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function base64ToBlob(b64, type) {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return new Blob([bytes], { type });
}

/** Serialize the assets a document references into an envelope map {id:{type,data}}. */
export async function exportAssets(store, ids) {
  const out = {};
  for (const id of ids) { const blob = await store.get(id); out[id] = { type: blob.type || 'image/png', data: await blobToBase64(blob) }; }
  return out;
}

/** Import envelope assets, verifying each hash matches its content. */
export async function importAssets(store, assets) {
  for (const [id, a] of Object.entries(assets || {})) {
    const blob = base64ToBlob(a.data, a.type || 'image/png');
    const actual = await store.put(blob);
    if (actual !== id) throw Error('Project asset ' + id.slice(0, 18) + '… is corrupt (hash mismatch)');
  }
}
