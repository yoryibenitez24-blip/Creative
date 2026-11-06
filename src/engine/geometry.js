// Pixel geometry for Image Size, Canvas Size, rotate/flip and crop. Buffers are straight-alpha RGBA8.

const make = (w, h) => ({ w, h, data: new Uint8ClampedArray(w * h * 4) });

export function flipH(buf) { const o = make(buf.w, buf.h); for (let y = 0; y < buf.h; y++) for (let x = 0; x < buf.w; x++) o.data.set(buf.data.subarray((y * buf.w + x) * 4, (y * buf.w + x) * 4 + 4), (y * buf.w + buf.w - 1 - x) * 4); return o; }
export function flipV(buf) { const o = make(buf.w, buf.h), row = buf.w * 4; for (let y = 0; y < buf.h; y++) o.data.set(buf.data.subarray(y * row, (y + 1) * row), (buf.h - 1 - y) * row); return o; }
export function rotate90(buf, clockwise = true) {
  const o = make(buf.h, buf.w);
  for (let y = 0; y < buf.h; y++) for (let x = 0; x < buf.w; x++) {
    const nx = clockwise ? buf.h - 1 - y : y, ny = clockwise ? x : buf.w - 1 - x;
    o.data.set(buf.data.subarray((y * buf.w + x) * 4, (y * buf.w + x) * 4 + 4), (ny * o.w + nx) * 4);
  }
  return o;
}
export const rotate180 = buf => flipV(flipH(buf));

/** Place buf at (dx,dy) inside a new w×h transparent buffer (Canvas Size, crop). */
export function placeInto(buf, w, h, dx, dy) {
  const o = make(w, h);
  for (let y = 0; y < buf.h; y++) {
    const ty = y + dy; if (ty < 0 || ty >= h) continue;
    const x0 = Math.max(0, -dx), x1 = Math.min(buf.w, w - dx); if (x1 <= x0) continue;
    o.data.set(buf.data.subarray((y * buf.w + x0) * 4, (y * buf.w + x1) * 4), (ty * w + x0 + dx) * 4);
  }
  return o;
}

const cubic = t => { t = Math.abs(t); return t <= 1 ? 1.5 * t ** 3 - 2.5 * t ** 2 + 1 : t < 2 ? -0.5 * t ** 3 + 2.5 * t ** 2 - 4 * t + 2 : 0; }; // Catmull-Rom (a = −0.5)

/**
 * Resample to nw×nh. method: nearest | bilinear | bicubic. Downscaling widens the kernel by the
 * scale factor (area-correct), so reductions do not alias. Works on premultiplied alpha.
 */
export function resample(buf, nw, nh, method = 'bicubic') {
  nw = Math.max(1, Math.round(nw)); nh = Math.max(1, Math.round(nh));
  if (method === 'nearest') {
    const o = make(nw, nh);
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) { const sx = Math.min(buf.w - 1, Math.floor((x + 0.5) * buf.w / nw)), sy = Math.min(buf.h - 1, Math.floor((y + 0.5) * buf.h / nh)); o.data.set(buf.data.subarray((sy * buf.w + sx) * 4, (sy * buf.w + sx) * 4 + 4), (y * nw + x) * 4); }
    return o;
  }
  const kernel = method === 'bilinear' ? t => Math.max(0, 1 - Math.abs(t)) : cubic, support = method === 'bilinear' ? 1 : 2;
  // separable: horizontal pass into float premultiplied, then vertical
  const pass = (src, sw, sh, dw, horizontal) => {
    const n = horizontal ? sw : sh, outLen = dw; // dw = output length along the pass direction
    const scale = n / outLen, fs = Math.max(1, scale), rad = support * fs;
    const lines = horizontal ? sh : sw, out = new Float32Array(outLen * lines * 4);
    for (let i = 0; i < outLen; i++) {
      const c = (i + 0.5) * scale - 0.5, lo = Math.ceil(c - rad), hi = Math.floor(c + rad);
      const ws = []; let tot = 0;
      for (let k = lo; k <= hi; k++) { const wgt = kernel((k - c) / fs); ws.push([Math.min(n - 1, Math.max(0, k)), wgt]); tot += wgt; }
      for (let l = 0; l < lines; l++) {
        let r = 0, g = 0, b = 0, a = 0;
        for (const [k, wgt] of ws) { const p = horizontal ? (l * sw + k) * 4 : (k * sw + l) * 4; r += src[p] * wgt; g += src[p + 1] * wgt; b += src[p + 2] * wgt; a += src[p + 3] * wgt; }
        const q = horizontal ? (l * outLen + i) * 4 : (i * sw + l) * 4;
        out[q] = r / tot; out[q + 1] = g / tot; out[q + 2] = b / tot; out[q + 3] = a / tot;
      }
    }
    return out;
  };
  const pre = new Float32Array(buf.data.length);
  for (let i = 0; i < pre.length; i += 4) { const a = buf.data[i + 3] / 255; pre[i] = buf.data[i] * a; pre[i + 1] = buf.data[i + 1] * a; pre[i + 2] = buf.data[i + 2] * a; pre[i + 3] = buf.data[i + 3]; }
  const h1 = pass(pre, buf.w, buf.h, nw, true);       // nw × buf.h
  const v1 = pass(h1, nw, buf.h, nh, false);           // nw × nh
  const o = make(nw, nh);
  for (let i = 0; i < v1.length; i += 4) { const a = Math.min(255, Math.max(0, v1[i + 3])); o.data[i + 3] = Math.round(a); if (a > 0.5) { const k = 255 / a; o.data[i] = v1[i] * k; o.data[i + 1] = v1[i + 1] * k; o.data[i + 2] = v1[i + 2] * k; } }
  return o;
}

/** Anchor (0..2, 0..2 grid) → offset of old content inside the new canvas. */
export const anchorOffset = (oldW, oldH, newW, newH, ax, ay) => [Math.round((newW - oldW) * ax / 2), Math.round((newH - oldH) * ay / 2)];
