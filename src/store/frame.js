// Image framing (focal point / alignment, zoom, fit) for every image a store template lets the user set.
//
// Section and list-item settings keep the frame next to the image field `<key>` (e.g. `image`, `avatar`):
//   <key>Pos:  { x: 0..100, y: 0..100 }   focal point in % of the image (object-position) — 50/50 = centre
//   <key>Fit:  'cover' | 'contain'         how the image fills its box
//   <key>Zoom: 100..200                    % scale around the focal point (cover only)
// Collections keep the same three fields for `image` (imagePos / imageFit / imageZoom).
// Products keep one frame per image, aligned with product.images: imageFrames: [{ x, y, zoom, fit }].
//
// The renderer turns a frame into an inline style on the <img> (object-position, object-fit, scale + transform-origin),
// so the builder preview and the exported static site show the same crop.

export const FRAME_DEFAULT = Object.freeze({ x: 50, y: 50, zoom: 100, fit: 'cover' });
/** The 9 alignment presets: [name, label, x, y]. */
export const ALIGN_PRESETS = [
  ['top-left', 'Top left', 0, 0], ['top', 'Top', 50, 0], ['top-right', 'Top right', 100, 0],
  ['left', 'Left', 0, 50], ['center', 'Center', 50, 50], ['right', 'Right', 100, 50],
  ['bottom-left', 'Bottom left', 0, 100], ['bottom', 'Bottom', 50, 100], ['bottom-right', 'Bottom right', 100, 100],
];

const clampNum = (v, d, lo, hi) => { const n = typeof v === 'string' && v.trim() === '' ? NaN : +v; return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n * 10) / 10)) : d; };

/** Complete, clamped frame from a loose object ({ x, y, zoom, fit }). */
export function normFrame(f) {
  f = f && typeof f === 'object' ? f : {};
  return { x: clampNum(f.x, 50, 0, 100), y: clampNum(f.y, 50, 0, 100), zoom: clampNum(f.zoom, 100, 100, 200), fit: f.fit === 'contain' ? 'contain' : 'cover' };
}

/** Frame of image field `key` stored on `owner` (section settings, list item or collection). */
export function frameOf(owner, key = 'image') {
  if (!owner || typeof owner !== 'object') return { ...FRAME_DEFAULT };
  const p = owner[key + 'Pos'];
  return normFrame({ x: p?.x, y: p?.y, zoom: owner[key + 'Zoom'], fit: owner[key + 'Fit'] });
}

/** The settings patch that stores `frame` for image field `key` ({ <key>Pos, <key>Fit, <key>Zoom }). */
export function framePatch(key, frame) {
  const f = normFrame(frame);
  return { [key + 'Pos']: { x: f.x, y: f.y }, [key + 'Fit']: f.fit, [key + 'Zoom']: f.zoom };
}

/** Normalise the frame fields of image field `key` on `owner` in place (defaults for old documents). */
export function normalizeFrameFields(owner, key = 'image') {
  if (owner && typeof owner === 'object') Object.assign(owner, framePatch(key, frameOf(owner, key)));
  return owner;
}

/** Product image frames, one per image (missing → centred defaults). */
export function productFrames(p) {
  const given = Array.isArray(p?.imageFrames) ? p.imageFrames : [];
  return (p?.images || []).map((_, i) => normFrame(given[i]));
}
export const productFrame = (p, i) => normFrame(Array.isArray(p?.imageFrames) ? p.imageFrames[i] : null);

/** Keep product.imageFrames aligned when images move / are removed (mutates p). */
export function moveProductImage(p, from, to) {
  const fr = productFrames(p);
  const [im] = p.images.splice(from, 1); p.images.splice(to, 0, im);
  const [f] = fr.splice(from, 1); fr.splice(to, 0, f);
  p.imageFrames = fr;
}
export function removeProductImage(p, i) {
  const fr = productFrames(p);
  p.images.splice(i, 1); fr.splice(i, 1);
  p.imageFrames = fr;
}

export const isDefaultFrame = f => !f || (f.x === 50 && f.y === 50 && f.zoom === 100 && f.fit !== 'contain');
/** Name of the matching alignment preset, or '' for a custom focal point. */
export const presetOf = f => (ALIGN_PRESETS.find(([, , x, y]) => x === f.x && y === f.y) || [''])[0];

/**
 * Inline CSS for a framed <img> ('' for the default frame).
 * `zoom: false` drops the scale (tiny avatars and thumbnails show alignment only).
 */
export function frameStyle(f, { zoom = true } = {}) {
  if (!f) return '';
  const out = [];
  if (f.x !== 50 || f.y !== 50) out.push(`object-position:${f.x}% ${f.y}%`);
  if (f.fit === 'contain') out.push('object-fit:contain');
  else if (zoom && f.zoom > 100) out.push(`scale:${+(f.zoom / 100).toFixed(3)}`, `transform-origin:${f.x}% ${f.y}%`);
  return out.join(';');
}
