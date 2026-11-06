// Main-thread client for the on-device segmentation worker (dist/ai-worker.js).
// aiSegment(kind, buf) → Promise<{ w, h, b64 }> ready to store in a mask component's params.ai.
import { encodeAlpha } from '../engine/aiseg.js';

let worker = null, next = 1; const jobs = new Map();
function ensure() {
  if (worker) return worker;
  worker = new Worker('/ai-worker.js', { type: 'module' });
  worker.onmessage = ({ data }) => { const j = jobs.get(data.id); if (!j) return; jobs.delete(data.id); if (data.error) j.reject(Error(data.error)); else j.resolve({ w: data.w, h: data.h, data: new Uint8Array(data.buffer) }); };
  worker.onerror = e => { for (const j of jobs.values()) j.reject(Error('The AI worker stopped' + (e.message ? ': ' + e.message : ''))); jobs.clear(); worker.terminate(); worker = null; };
  return worker;
}
export function aiSegment(kind, buf) {
  const w = ensure(), id = next++, copy = new Uint8ClampedArray(buf.data);
  return new Promise((resolve, reject) => { jobs.set(id, { resolve: a => resolve(encodeAlpha(a)), reject }); w.postMessage({ id, kind, w: buf.w, h: buf.h, buffer: copy.buffer }, [copy.buffer]); });
}
