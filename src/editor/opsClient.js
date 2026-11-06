// Main-thread client for the pixel-operation worker. One job at a time: starting a new job
// terminates a running one (real cancellation, not just ignoring the result).
let worker = null, current = null, nextId = 1;

function spawn() {
  worker = new Worker('/ops-worker.js');
  worker.onmessage = ({ data }) => {
    if (!current || data.id !== current.id) return;
    const job = current; current = null;
    if (data.error) job.reject(Error(data.error));
    else job.resolve({ w: data.w, h: data.h, data: new Uint8ClampedArray(data.buffer) });
  };
  worker.onerror = e => { const job = current; current = null; worker.terminate(); worker = null; job?.reject(Error('The filter worker stopped unexpectedly' + (e.message ? ': ' + e.message : '') + '. Your image is unchanged.')); };
}

/** Run op on a COPY of buf (the caller keeps its pixels). ctx.mask is a document-sized Uint8Array or null. */
export function runInWorker(op, buf, params, ctx = {}) {
  cancelJob();
  if (!worker) spawn();
  const id = nextId++, copy = new Uint8ClampedArray(buf.data), mask = ctx.mask ? new Uint8Array(ctx.mask) : null;
  return new Promise((resolve, reject) => {
    current = { id, resolve, reject };
    const transfer = [copy.buffer]; if (mask) transfer.push(mask.buffer);
    worker.postMessage({ id, op, params, ctx: { ...ctx, mask: undefined }, w: buf.w, h: buf.h, buffer: copy.buffer, mask: mask && mask.buffer }, transfer);
  });
}

export function cancelJob() {
  if (!current) return;
  const job = current; current = null;
  worker?.terminate(); worker = null;
  job.reject(Object.assign(Error('cancelled'), { cancelled: true }));
}
