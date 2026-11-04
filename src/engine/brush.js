// Deterministic brush stroke sampler.
//
// Input: pointer samples already converted to DOCUMENT pixel coordinates.
// Output: dabs {x, y, size, flow} placed at a fixed document-space spacing.
// Nothing here depends on zoom, pan or screen pixels, so the same document-space
// input produces the same dabs at every zoom level.

export const DEFAULT_BRUSH = Object.freeze({
  size: 24,         // diameter in document px
  hardness: 0.8,    // 0..1 fraction of radius that is fully opaque
  opacity: 1,       // 0..1 maximum stroke opacity (caps build-up)
  flow: 1,          // 0..1 per-dab deposit
  spacing: 0.15,    // fraction of current diameter between dabs
  smoothing: 0,     // 0..0.95 exponential smoothing of the input path
  pressureSize: true,
  pressureFlow: false,
  minSize: 0.05,    // diameter fraction at zero pressure
});

export const BRUSH_LIMITS = { size: [1, 1000], hardness: [0, 1], opacity: [0, 1], flow: [0, 1], spacing: [0.01, 2], smoothing: [0, 0.95] };

export function clampBrush(b) {
  const out = { ...DEFAULT_BRUSH, ...b };
  for (const [k, [lo, hi]] of Object.entries(BRUSH_LIMITS)) out[k] = Math.min(hi, Math.max(lo, Number.isFinite(out[k]) ? out[k] : DEFAULT_BRUSH[k]));
  return out;
}

export function createStroke(brush) {
  return { brush: clampBrush(brush), last: null, smooth: null, raw: null, residual: 0 };
}

function dabSize(b, p) { return b.pressureSize ? b.size * (b.minSize + (1 - b.minSize) * p) : b.size; }
function dabFlow(b, p) { return b.pressureFlow ? b.flow * p : b.flow; }

function emitTo(stroke, target, out) {
  const b = stroke.brush;
  const from = stroke.last;
  const dx = target.x - from.x, dy = target.y - from.y;
  const dist = Math.hypot(dx, dy);
  if (dist === 0) { stroke.last = { ...target }; return; }
  let travelled = 0;
  // walk the segment, recomputing step from the interpolated pressure
  for (let guard = 0; guard < 100000; guard++) {
    const t0 = travelled / dist;
    const p = from.p + (target.p - from.p) * t0;
    const step = Math.max(0.5, dabSize(b, p) * b.spacing);
    const need = step - stroke.residual;
    if (travelled + need > dist) { stroke.residual += dist - travelled; break; }
    travelled += need;
    stroke.residual = 0;
    const t = travelled / dist;
    const pp = from.p + (target.p - from.p) * t;
    out.push({ x: from.x + dx * t, y: from.y + dy * t, size: dabSize(b, pp), flow: dabFlow(b, pp), pressure: pp });
  }
  stroke.last = { ...target };
}

/** Feed one input sample; returns the dabs it produced (possibly none). */
export function addPoint(stroke, { x, y, pressure = 1 }) {
  const p = Math.min(1, Math.max(0, Number.isFinite(pressure) ? pressure : 1));
  const raw = { x, y, p };
  stroke.raw = raw;
  const out = [];
  if (!stroke.last) {
    stroke.smooth = { ...raw };
    stroke.last = { ...raw };
    const b = stroke.brush;
    out.push({ x, y, size: dabSize(b, p), flow: dabFlow(b, p), pressure: p });
    return out;
  }
  const k = 1 - stroke.brush.smoothing;
  const s = stroke.smooth;
  stroke.smooth = { x: s.x + (raw.x - s.x) * k, y: s.y + (raw.y - s.y) * k, p: s.p + (raw.p - s.p) * k };
  emitTo(stroke, stroke.smooth, out);
  return out;
}

/** Catch up the smoothed path to the last real sample at stroke end. */
export function finishStroke(stroke) {
  const out = [];
  if (stroke.last && stroke.raw && stroke.brush.smoothing > 0) emitTo(stroke, stroke.raw, out);
  return out;
}

/** Convenience: full stroke from a list of document-space samples. */
export function sampleStroke(brush, points) {
  const s = createStroke(brush);
  const dabs = [];
  for (const pt of points) dabs.push(...addPoint(s, pt));
  dabs.push(...finishStroke(s));
  return dabs;
}
