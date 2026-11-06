// On-device segmentation models for masking (decision D-001, lifted by the user for local masking).
// The models run with onnxruntime-web in a worker inside the user's browser. No image ever leaves
// the machine, and nothing is downloaded at runtime: the weights ship with the app (dist/models/).
//
//   subject / background: U²-Netp, salient-object detection, 320×320 input (Qin et al., Apache-2.0)
//   people:               MODNet, portrait matting, ≤512 px input (Ke et al., Apache-2.0)
//
// This module is pure: callers pass in the `ort` namespace and a session, so the same code runs in
// the browser worker and in Node tests. The result is a small alpha map ({w, h, data: Uint8Array}).
// masks.js upsamples it to the render size and refines its edges with a guided filter, so a mask stays
// resolution-independent and every render is deterministic once the alpha is stored in the settings.

export const AI_MODELS = {
  subject: { file: 'models/u2netp.onnx', name: 'U²-Netp', fixed: 320, mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225], minmax: true },
  people: { file: 'models/modnet.onnx', name: 'MODNet', long: 512, mean: [0.5, 0.5, 0.5], std: [0.5, 0.5, 0.5], minmax: false },
};
export const modelFor = kind => AI_MODELS[kind === 'people' ? 'people' : 'subject'];

/** Bilinear resample of RGBA (straight) into a planar CHW float tensor normalised with mean/std. */
export function preprocess(buf, model) {
  let W, H;
  if (model.fixed) { W = H = model.fixed; }
  else { const k = model.long / Math.max(buf.w, buf.h); W = Math.max(32, Math.round(buf.w * k / 32) * 32); H = Math.max(32, Math.round(buf.h * k / 32) * 32); }
  const t = new Float32Array(3 * W * H), { w, h, data } = buf, plane = W * H;
  for (let y = 0; y < H; y++) {
    const sy = Math.min(h - 1, Math.max(0, (y + 0.5) * h / H - 0.5)), y0 = Math.floor(sy), y1 = Math.min(h - 1, y0 + 1), fy = sy - y0;
    for (let x = 0; x < W; x++) {
      const sx = Math.min(w - 1, Math.max(0, (x + 0.5) * w / W - 0.5)), x0 = Math.floor(sx), x1 = Math.min(w - 1, x0 + 1), fx = sx - x0;
      const a = (y0 * w + x0) * 4, b = (y0 * w + x1) * 4, c = (y1 * w + x0) * 4, d = (y1 * w + x1) * 4, o = y * W + x;
      for (let ch = 0; ch < 3; ch++) {
        const v = ((data[a + ch] * (1 - fx) + data[b + ch] * fx) * (1 - fy) + (data[c + ch] * (1 - fx) + data[d + ch] * fx) * fy) / 255;
        t[ch * plane + o] = (v - model.mean[ch]) / model.std[ch];
      }
    }
  }
  return { data: t, dims: [1, 3, H, W], W, H };
}

/** Model output (1×1×H×W) → Uint8 alpha map. U²-Net output is min-max normalised (as the authors do). */
export function postprocess(out, W, H, model) {
  let lo = Infinity, hi = -Infinity;
  if (model.minmax) for (let i = 0; i < W * H; i++) { const v = out[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
  const span = model.minmax ? (hi - lo || 1) : 1, base = model.minmax ? lo : 0, a = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) { const v = (out[i] - base) / span; a[i] = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255); }
  return { w: W, h: H, data: a };
}

/** Run one model on an RGBA buffer. `session` is an ort.InferenceSession for modelFor(kind). */
export async function segment(ort, session, buf, kind) {
  const model = modelFor(kind), { data, dims, W, H } = preprocess(buf, model);
  const feeds = { [session.inputNames[0]]: new ort.Tensor('float32', data, dims) };
  const res = await session.run(feeds);
  const out = res[session.outputNames[0]].data;
  return postprocess(out, W, H, model);
}

// ---- compact storage in develop settings (base64 of the 8-bit alpha) ----
export function encodeAlpha({ w, h, data }) {
  let s = ''; for (let i = 0; i < data.length; i += 32768) s += String.fromCharCode.apply(null, data.subarray(i, i + 32768));
  return { w, h, b64: typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'binary').toString('base64') };
}
const DEC = new Map();
export function decodeAlpha(ai) {
  if (DEC.has(ai.b64)) return DEC.get(ai.b64);
  const bin = typeof atob === 'function' ? atob(ai.b64) : Buffer.from(ai.b64, 'base64').toString('binary');
  const a = new Float32Array(ai.w * ai.h); for (let i = 0; i < a.length; i++) a[i] = bin.charCodeAt(i) / 255;
  if (DEC.size > 16) DEC.delete(DEC.keys().next().value);
  DEC.set(ai.b64, a); return a;
}
