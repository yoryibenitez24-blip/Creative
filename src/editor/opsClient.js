// Main-thread clients for the pixel-operation worker. Each client runs one job at a time:
// starting a new job terminates the running one (real cancellation). Dialogs use the default
// client; adjustment layers / smart filters use their own so they never cancel a dialog preview.
export function createOpsClient() {
  let worker = null, current = null, nextId = 1;
  const spawn = () => {
    worker = new Worker('/ops-worker.js');
    worker.onmessage = ({ data }) => {
      if (!current || data.id !== current.id) return;
      const job = current; current = null;
      if (data.error) job.reject(Error(data.error)); else job.resolve({ w: data.w, h: data.h, data: new Uint8ClampedArray(data.buffer) });
    };
    worker.onerror = e => { const job = current; current = null; worker.terminate(); worker = null; job?.reject(Error('The filter worker stopped unexpectedly' + (e.message ? ': ' + e.message : '') + '. Your image is unchanged.')); };
  };
  const cancel = () => { if (!current) return; const job = current; current = null; worker?.terminate(); worker = null; job.reject(Object.assign(Error('cancelled'), { cancelled: true })); };
  const run = (op, buf, params, ctx = {}) => {
    cancel();
    if (!worker) spawn();
    const id = nextId++, copy = new Uint8ClampedArray(buf.data), mask = ctx.mask ? new Uint8Array(ctx.mask) : null;
    return new Promise((resolve, reject) => {
      current = { id, resolve, reject };
      const transfer = [copy.buffer]; if (mask) transfer.push(mask.buffer);
      worker.postMessage({ id, op, params, ctx: { ...ctx, mask: undefined }, w: buf.w, h: buf.h, buffer: copy.buffer, mask: mask && mask.buffer }, transfer);
    });
  };
  return { run, cancel };
}
const main = createOpsClient();
/** Run op on a COPY of buf (the caller keeps its pixels). ctx.mask is a document-sized Uint8Array or null. */
export const runInWorker = main.run;
export const cancelJob = main.cancel;
