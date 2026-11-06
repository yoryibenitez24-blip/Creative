// Runs registry pixel operations off the main thread (built to dist/ops-worker.js).
import { runOp } from './ops.js';
self.onmessage = ({ data: { id, op, params, ctx, w, h, buffer, mask } }) => {
  try {
    const out = runOp(op, { w, h, data: new Uint8ClampedArray(buffer) }, params, { ...ctx, mask: mask ? new Uint8Array(mask) : null });
    self.postMessage({ id, w: out.w, h: out.h, buffer: out.data.buffer }, [out.data.buffer]);
  } catch (e) { self.postMessage({ id, error: e.message || 'Operation failed' }); }
};
