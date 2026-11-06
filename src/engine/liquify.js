// Filter › Liquify engine. Pure JS (no DOM): runs in Node tests, on the main thread and in the
// ops worker.
//
// Displacement field: { w, h, dx: Float32Array(w*h), dy: Float32Array(w*h) }.
// It is a BACKWARD map: output pixel (x, y) samples the source at (x + dx, y + dy).
//
// Every distortion tool is expressed as a local backward offset u(p) on the CURRENT (already
// warped) image. Composition: the new field is d'(p) = u(p) + d(p + u(p)), with d sampled
// bilinearly, so repeated pushes keep moving the same content instead of just adding vectors.
// Reconstruct scales the field toward 0 and Smooth blurs it locally; both act on the field itself.
// A freeze mask (Uint8Array(w*h), 0..255) scales every tool's strength by (1 - mask/255).

export const TOOLS = ['forwardWarp', 'reconstruct', 'smooth', 'twirlClockwise', 'twirlCounterClockwise', 'pucker', 'bloat', 'pushLeft', 'freezeMask', 'thawMask'];
/** Tools that keep acting while the pointer is held still (strength per dab is scaled by `rate`). */
export const STATIONARY_TOOLS = new Set(['reconstruct', 'smooth', 'twirlClockwise', 'twirlCounterClockwise', 'pucker', 'bloat']);
export const DEFAULT_BRUSH = { size: 100, density: 50, pressure: 100, rate: 80 };

export function createField(w, h) {
  return { w, h, dx: new Float32Array(w * h), dy: new Float32Array(w * h) };
}
export const cloneField = f => ({ w: f.w, h: f.h, dx: Float32Array.from(f.dx), dy: Float32Array.from(f.dy) });
/** True when no displacement exceeds `eps` px. */
export function isIdentity(f, eps = 1e-3) {
  for (let i = 0; i < f.dx.length; i++) if (Math.abs(f.dx[i]) > eps || Math.abs(f.dy[i]) > eps) return false;
  return true;
}

// Bilinear sample of one field channel at (x, y), clamped to the edges.
function sampleChannel(a, w, h, x, y) {
  if (x < 0) x = 0; else if (x > w - 1) x = w - 1;
  if (y < 0) y = 0; else if (y > h - 1) y = h - 1;
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = x0 + 1 < w ? x0 + 1 : x0, y1 = y0 + 1 < h ? y0 + 1 : y0;
  const fx = x - x0, fy = y - y0, r0 = y0 * w, r1 = y1 * w;
  const top = a[r0 + x0] + (a[r0 + x1] - a[r0 + x0]) * fx, bot = a[r1 + x0] + (a[r1 + x1] - a[r1 + x0]) * fx;
  return top + (bot - top) * fy;
}
export const sampleField = (f, x, y) => [sampleChannel(f.dx, f.w, f.h, x, y), sampleChannel(f.dy, f.w, f.h, x, y)];

/**
 * Brush falloff at normalised distance t = r / radius (0 at the centre, 1 at the rim).
 * density 0 → hard brush (full strength to the rim), 100 → soft brush (falls off from the centre).
 */
export function brushWeight(t, density = 50) {
  if (t >= 1) return 0;
  const hard = 1 - Math.max(0, Math.min(100, density)) / 100;
  if (t <= hard) return 1;
  const s = (t - hard) / (1 - hard), k = 1 - s;
  return k * k * (3 - 2 * k); // smoothstep from 1 at `hard` to 0 at the rim
}

const radiusOf = brush => Math.max(0.5, (brush.size ?? DEFAULT_BRUSH.size) / 2);
const pressureOf = (brush, dab) => Math.max(0, Math.min(1, ((brush.pressure ?? DEFAULT_BRUSH.pressure) / 100) * (dab.pressure ?? 1)));
const rateOf = brush => Math.max(0, Math.min(1, (brush.rate ?? DEFAULT_BRUSH.rate) / 100));

/**
 * Applies one dab IN PLACE to `field` (and `freeze` for the mask tools).
 * dab = { x, y, px?, py?, pressure? } in field pixels; (px, py) is the previous pointer position
 * (needed by Forward Warp and Push Left; for those, a move longer than a quarter radius is split
 * into sub-dabs so fast drags stay smooth). brush = { size (diameter px), density, pressure, rate }.
 * Returns the changed rectangle [x0, y0, x1, y1] (inclusive-exclusive) or null.
 */
export function applyDabInPlace(field, tool, dab, brush = DEFAULT_BRUSH, freeze = null) {
  const R = radiusOf(brush);
  if (tool === 'forwardWarp' || tool === 'pushLeft') {
    const px = dab.px ?? dab.x, py = dab.py ?? dab.y, vx = dab.x - px, vy = dab.y - py, len = Math.hypot(vx, vy);
    if (len < 1e-6) return null;
    const n = Math.max(1, Math.ceil(len / (R * 0.25)));
    let rect = null;
    for (let i = 1; i <= n; i++) {
      const sub = { x: px + vx * i / n, y: py + vy * i / n, px: px + vx * (i - 1) / n, py: py + vy * (i - 1) / n, pressure: dab.pressure };
      rect = unionRect(rect, singleDab(field, tool, sub, brush, freeze, R));
    }
    return rect;
  }
  return singleDab(field, tool, dab, brush, freeze, R);
}

function unionRect(a, b) {
  if (!a) return b; if (!b) return a;
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

function singleDab(field, tool, dab, brush, freeze, R) {
  const { w, h, dx, dy } = field, cx = dab.x, cy = dab.y;
  const x0 = Math.max(0, Math.floor(cx - R)), y0 = Math.max(0, Math.floor(cy - R));
  const x1 = Math.min(w, Math.ceil(cx + R) + 1), y1 = Math.min(h, Math.ceil(cy + R) + 1);
  if (x0 >= x1 || y0 >= y1) return null;
  const density = brush.density ?? DEFAULT_BRUSH.density, P = pressureOf(brush, dab), step = P * rateOf(brush);
  const bw = x1 - x0, bh = y1 - y0;

  if (tool === 'freezeMask' || tool === 'thawMask') {
    if (!freeze) return null;
    const sign = tool === 'freezeMask' ? 1 : -1;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const wgt = brushWeight(Math.hypot(x - cx, y - cy) / R, density);
      if (wgt > 0) { const i = y * w + x; freeze[i] = Math.max(0, Math.min(255, Math.round(freeze[i] + sign * 255 * wgt * P))); }
    }
    return [x0, y0, x1, y1];
  }

  const protect = i => freeze ? 1 - freeze[i] / 255 : 1;

  if (tool === 'reconstruct') {
    const k = 0.25 * step;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = y * w + x, a = k * brushWeight(Math.hypot(x - cx, y - cy) / R, density) * protect(i);
      if (a > 0) { dx[i] *= 1 - a; dy[i] *= 1 - a; }
    }
    return [x0, y0, x1, y1];
  }

  if (tool === 'smooth') {
    // local box blur of the field (radius ~ R/4) blended in by brush weight
    const br = Math.max(1, Math.round(R / 4)), k = 0.6 * step, nx = new Float32Array(bw * bh), ny = new Float32Array(bw * bh);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      let sx = 0, sy = 0, n = 0;
      for (let j = -br; j <= br; j += Math.max(1, br >> 1)) for (let i = -br; i <= br; i += Math.max(1, br >> 1)) {
        const xx = Math.min(w - 1, Math.max(0, x + i)), yy = Math.min(h - 1, Math.max(0, y + j)), q = yy * w + xx;
        sx += dx[q]; sy += dy[q]; n++;
      }
      nx[(y - y0) * bw + x - x0] = sx / n; ny[(y - y0) * bw + x - x0] = sy / n;
    }
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = y * w + x, a = k * brushWeight(Math.hypot(x - cx, y - cy) / R, density) * protect(i);
      if (a > 0) { const j = (y - y0) * bw + x - x0; dx[i] += (nx[j] - dx[i]) * a; dy[i] += (ny[j] - dy[i]) * a; }
    }
    return [x0, y0, x1, y1];
  }

  // Composed tools: compute the local backward offset u, then d' = u + d(p + u).
  let offset;
  if (tool === 'forwardWarp') {
    const vx = dab.x - dab.px, vy = dab.y - dab.py;
    offset = (x, y, wgt) => [-vx * wgt * P, -vy * wgt * P];
  } else if (tool === 'pushLeft') {
    // content moves to the left of the drag direction (dragging up pushes left)
    const vx = dab.x - dab.px, vy = dab.y - dab.py, mx = vy, my = -vx;
    offset = (x, y, wgt) => [-mx * wgt * P, -my * wgt * P];
  } else if (tool === 'twirlClockwise' || tool === 'twirlCounterClockwise') {
    const dir = tool === 'twirlClockwise' ? 1 : -1, maxA = 0.2 * step * dir;
    offset = (x, y, wgt) => {
      // content rotates by +a (clockwise on a y-down screen) → sample at rotation by -a
      const a = -maxA * wgt, c = Math.cos(a), s = Math.sin(a), rx = x - cx, ry = y - cy;
      return [c * rx - s * ry - rx, s * rx + c * ry - ry];
    };
  } else if (tool === 'pucker' || tool === 'bloat') {
    const k = (tool === 'pucker' ? 1 : -1) * 0.12 * step;
    offset = (x, y, wgt) => [(x - cx) * k * wgt, (y - cy) * k * wgt];
  } else throw new Error('Unknown Liquify tool: ' + tool);

  const nx = new Float32Array(bw * bh), ny = new Float32Array(bw * bh), touched = new Uint8Array(bw * bh);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = y * w + x, wgt = brushWeight(Math.hypot(x - cx, y - cy) / R, density) * protect(i);
    if (wgt <= 0) continue;
    const [ux, uy] = offset(x, y, wgt), j = (y - y0) * bw + x - x0;
    nx[j] = ux + sampleChannel(dx, w, h, x + ux, y + uy);
    ny[j] = uy + sampleChannel(dy, w, h, x + ux, y + uy);
    touched[j] = 1;
  }
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const j = (y - y0) * bw + x - x0;
    if (touched[j]) { dx[y * w + x] = nx[j]; dy[y * w + x] = ny[j]; }
  }
  return [x0, y0, x1, y1];
}

/**
 * Pure: applies a list of dabs with one tool and returns { field, freeze } (new copies).
 * Each dab may omit px/py; they default to the previous dab's position (first dab: itself).
 */
export function applyStroke(field, tool, dabs, brush = DEFAULT_BRUSH, freeze = null) {
  const f = cloneField(field), m = freeze ? Uint8Array.from(freeze) : null;
  let prev = null;
  for (const d of dabs) {
    const dab = { ...d, px: d.px ?? (prev ? prev.x : d.x), py: d.py ?? (prev ? prev.y : d.y) };
    applyDabInPlace(f, tool, dab, brush, m);
    prev = d;
  }
  return { field: f, freeze: m };
}

/** Pure: removes `amount` (0..1) of the distortion everywhere, sparing frozen pixels proportionally. */
export function reconstructAll(field, amount = 1, freeze = null) {
  const f = cloneField(field), a = Math.max(0, Math.min(1, amount));
  for (let i = 0; i < f.dx.length; i++) {
    const k = 1 - a * (freeze ? 1 - freeze[i] / 255 : 1);
    f.dx[i] *= k; f.dy[i] *= k;
  }
  return f;
}
/** Pure: returns an identity field of the same size (Restore All ignores the freeze mask, like Photoshop). */
export const restoreAll = field => createField(field.w, field.h);

/** Resamples a field to w × h bilinearly, scaling the vectors by the size ratio. */
export function resampleField(field, w, h) {
  if (field.w === w && field.h === h) return cloneField(field);
  const out = createField(w, h), sx = field.w / w, sy = field.h / h;
  for (let y = 0; y < h; y++) {
    const fy = (y + 0.5) * sy - 0.5;
    for (let x = 0; x < w; x++) {
      const fx = (x + 0.5) * sx - 0.5, i = y * w + x;
      out.dx[i] = sampleChannel(field.dx, field.w, field.h, fx, fy) / sx;
      out.dy[i] = sampleChannel(field.dy, field.w, field.h, fx, fy) / sy;
    }
  }
  return out;
}

/**
 * Warps the rectangle [x0,y0,x1,y1) of `dst` (same size as src and field) from `src` through
 * `field`. Edge-clamped sampling; bilinear interpolation is done on premultiplied colour so
 * transparent pixels do not bleed dark fringes. method: 'bilinear' | 'nearest'.
 */
export function applyFieldInto(dst, src, field, rect = null, method = 'bilinear') {
  const { w, h } = src, s = src.data, o = dst.data, { dx, dy } = field;
  const [x0, y0, x1, y1] = rect ? [Math.max(0, rect[0]), Math.max(0, rect[1]), Math.min(w, rect[2]), Math.min(h, rect[3])] : [0, 0, w, h];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = y * w + x, q = i * 4;
    let sx = x + dx[i], sy = y + dy[i];
    if (sx < 0) sx = 0; else if (sx > w - 1) sx = w - 1;
    if (sy < 0) sy = 0; else if (sy > h - 1) sy = h - 1;
    if (method === 'nearest') {
      const p = (Math.round(sy) * w + Math.round(sx)) * 4;
      o[q] = s[p]; o[q + 1] = s[p + 1]; o[q + 2] = s[p + 2]; o[q + 3] = s[p + 3];
      continue;
    }
    const xa = Math.floor(sx), ya = Math.floor(sy), xb = xa + 1 < w ? xa + 1 : xa, yb = ya + 1 < h ? ya + 1 : ya;
    const fx = sx - xa, fy = sy - ya;
    const p00 = (ya * w + xa) * 4, p10 = (ya * w + xb) * 4, p01 = (yb * w + xa) * 4, p11 = (yb * w + xb) * 4;
    const w00 = (1 - fx) * (1 - fy) * s[p00 + 3], w10 = fx * (1 - fy) * s[p10 + 3], w01 = (1 - fx) * fy * s[p01 + 3], w11 = fx * fy * s[p11 + 3];
    const A = w00 + w10 + w01 + w11;
    if (A <= 1e-6) { o[q] = o[q + 1] = o[q + 2] = o[q + 3] = 0; continue; }
    o[q] = (s[p00] * w00 + s[p10] * w10 + s[p01] * w01 + s[p11] * w11) / A;
    o[q + 1] = (s[p00 + 1] * w00 + s[p10 + 1] * w10 + s[p01 + 1] * w01 + s[p11 + 1] * w11) / A;
    o[q + 2] = (s[p00 + 2] * w00 + s[p10 + 2] * w10 + s[p01 + 2] * w01 + s[p11 + 2] * w11) / A;
    o[q + 3] = A;
  }
  return dst;
}

/** Pure: returns a new buffer = buf warped through field (field must be buf-sized; see liquifyOp). */
export function applyField(buf, field, method = 'bilinear') {
  if (field.w !== buf.w || field.h !== buf.h) field = resampleField(field, buf.w, buf.h);
  return applyFieldInto({ w: buf.w, h: buf.h, data: new Uint8ClampedArray(buf.data.length) }, buf, field, null, method);
}

/**
 * Forward position (in output space) of the source point (x, y): solves p + d(p) = q by fixed-point
 * iteration. Used to draw the mesh overlay.
 */
export function forwardPoint(field, x, y, iterations = 4) {
  let px = x, py = y;
  for (let k = 0; k < iterations; k++) { const [ux, uy] = sampleField(field, px, py); px = x - ux; py = y - uy; }
  return [px, py];
}

// ---- (de)serialization -------------------------------------------------------------------------

const toB64 = f32 => {
  const bytes = new Uint8Array(f32.length * 4), dv = new DataView(bytes.buffer);
  for (let i = 0; i < f32.length; i++) dv.setFloat32(i * 4, f32[i], true);
  let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (b64, n) => {
  const s = atob(b64); if (s.length !== n * 4) throw new Error('Liquify mesh data has the wrong length');
  const bytes = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  const dv = new DataView(bytes.buffer), out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = dv.getFloat32(i * 4, true);
  return out;
};

/**
 * Compact JSON-safe form of a field: stored at ≤ maxDim on its longest side (vectors rescaled),
 * Float32 little-endian base64. { format:'zertake-liquify-mesh', version:1, w, h, sw, sh, dx, dy }
 * where w,h is the original field size and sw,sh the stored size.
 */
export function serializeField(field, maxDim = 512) {
  const k = Math.min(1, maxDim / Math.max(field.w, field.h));
  const sw = Math.max(1, Math.round(field.w * k)), sh = Math.max(1, Math.round(field.h * k));
  const s = resampleField(field, sw, sh);
  return { format: 'zertake-liquify-mesh', version: 1, w: field.w, h: field.h, sw, sh, dx: toB64(s.dx), dy: toB64(s.dy) };
}
/** Inverse of serializeField. Pass (w, h) to get the field at another size (e.g. a new proxy). */
export function deserializeField(obj, w = obj.w, h = obj.h) {
  if (!obj || obj.format !== 'zertake-liquify-mesh') throw new Error('Not a Liquify mesh file');
  if (obj.version !== 1) throw new Error('Unsupported Liquify mesh version ' + obj.version);
  const n = obj.sw * obj.sh;
  return resampleField({ w: obj.sw, h: obj.sh, dx: fromB64(obj.dx, n), dy: fromB64(obj.dy, n) }, w, h);
}

/**
 * Ops-registry function: (buf, params) → buf. params.field = { w, h, dx, dy } with dx/dy as
 * Float32Array or plain arrays, or a serializeField() object. The field may be smaller than buf
 * (e.g. the dialog's proxy); it is upsampled bilinearly with its vectors scaled. params.method
 * ('bilinear' default | 'nearest').
 */
export function liquifyOp(buf, params = {}) {
  const f = params.field;
  if (!f) return { w: buf.w, h: buf.h, data: new Uint8ClampedArray(buf.data) };
  const field = f.format === 'zertake-liquify-mesh' ? deserializeField(f, buf.w, buf.h)
    : resampleField({ w: f.w, h: f.h, dx: f.dx instanceof Float32Array ? f.dx : Float32Array.from(f.dx), dy: f.dy instanceof Float32Array ? f.dy : Float32Array.from(f.dy) }, buf.w, buf.h);
  return applyField(buf, field, params.method || 'bilinear');
}
