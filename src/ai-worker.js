// On-device segmentation worker (built to dist/ai-worker.js as an ES module).
// Loads onnxruntime-web (WASM backend) and the bundled models from the app's own origin.
import * as ort from 'onnxruntime-web/wasm';
import { modelFor, segment } from './engine/aiseg.js';

ort.env.wasm.wasmPaths = new URL('./ort/', self.location.href).href;
ort.env.wasm.numThreads = 1; // threads need cross-origin isolation, which a plain static server does not give
const sessions = new Map();
async function session(kind) {
  const m = modelFor(kind);
  if (!sessions.has(m.file)) sessions.set(m.file, (async () => {
    const r = await fetch(new URL('./' + m.file, self.location.href));
    if (!r.ok) throw Error('The ' + m.name + ' model is missing (' + r.status + '). Run npm install, then npm run dev / build.');
    return ort.InferenceSession.create(new Uint8Array(await r.arrayBuffer()), { executionProviders: ['wasm'] });
  })().catch(e => { sessions.delete(m.file); throw e; }));
  return sessions.get(m.file);
}
self.onmessage = async ({ data: { id, kind, w, h, buffer } }) => {
  try {
    const s = await session(kind);
    const a = await segment(ort, s, { w, h, data: new Uint8ClampedArray(buffer) }, kind);
    self.postMessage({ id, w: a.w, h: a.h, buffer: a.data.buffer }, [a.data.buffer]);
  } catch (e) { self.postMessage({ id, error: e.message || String(e) }); }
};
