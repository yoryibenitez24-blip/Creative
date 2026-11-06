// Whole-document geometry (Canvas Size, Crop, Image Size, Image Rotation) for the layer model.
// Pixel data (paint layers, mask assets) is transformed separately with engine/geometry.js;
// these functions compute the new layer/mask rectangles and vector-layer properties.

const R = Math.round;

/** Rectangle mapping for a whole-canvas transform of a W×H document. */
export function mapRect(kind, W, H, x, y, w, h) {
  switch (kind) {
    case 'rotate90cw': return [H - (y + h), x, h, w];
    case 'rotate90ccw': return [y, W - (x + w), h, w];
    case 'rotate180': return [W - (x + w), H - (y + h), w, h];
    case 'flipH': return [W - (x + w), y, w, h];
    case 'flipV': return [x, H - (y + h), w, h];
    default: throw Error('Unknown transform ' + kind);
  }
}
export const swapsSize = kind => kind === 'rotate90cw' || kind === 'rotate90ccw';

/** Vector layers (rect/ellipse/text/image) rotate about their own centre: move the centre, adjust rotation/flip. */
export function transformVectorLayer(l, kind, W, H) {
  const cx = l.x + l.w / 2, cy = l.y + l.h / 2;
  let ncx, ncy, rot = l.rotation || 0, flipX = !!l.flipX, flipY = !!l.flipY;
  switch (kind) {
    case 'rotate90cw': ncx = H - cy; ncy = cx; rot += 90; break;
    case 'rotate90ccw': ncx = cy; ncy = W - cx; rot -= 90; break;
    case 'rotate180': ncx = W - cx; ncy = H - cy; rot += 180; break;
    case 'flipH': ncx = W - cx; ncy = cy; rot = -rot; flipX = !flipX; break;
    case 'flipV': ncx = cx; ncy = H - cy; rot = -rot; flipY = !flipY; break;
  }
  rot = ((rot % 360) + 540) % 360 - 180;
  return { ...l, x: ncx - l.w / 2, y: ncy - l.h / 2, rotation: rot, flipX, flipY };
}

/** Shift every layer and every mask (masks are document-space, so all of them move). */
export function shiftDoc(doc, dx, dy) {
  return {
    ...doc,
    layers: doc.layers.map(l => ({ ...l, x: l.type === 'raster' ? R(l.x + dx) : l.x + dx, y: l.type === 'raster' ? R(l.y + dy) : l.y + dy, ...(l.mask ? { mask: { ...l.mask, x: R(l.mask.x + dx), y: R(l.mask.y + dy) } } : {}) })),
    selection: null,
  };
}

/** Canvas Size / Crop: new size with content offset (dx,dy). Non-destructive: pixels outside stay in the layers. */
export function resizeCanvas(doc, w, h, dx, dy) {
  return { ...shiftDoc(doc, dx, dy), w: R(w), h: R(h), lastSelection: doc.selection || doc.lastSelection || null };
}

/** Image Size: scale geometry of every layer. Paint layers and mask assets need pixel resampling to the returned sizes. */
export function scaleDoc(doc, nw, nh) {
  const sx = nw / doc.w, sy = nh / doc.h, s = Math.sqrt(sx * sy);
  return {
    ...doc, w: R(nw), h: R(nh), selection: null,
    layers: doc.layers.map(l => {
      const out = l.type === 'raster'
        ? { ...l, x: R(l.x * sx), y: R(l.y * sy), w: Math.max(1, R(l.w * sx)), h: Math.max(1, R(l.h * sy)) }
        : { ...l, x: l.x * sx, y: l.y * sy, w: l.w * sx, h: l.h * sy, ...(l.size ? { size: l.size * sy } : {}), ...(l.strokeWidth ? { strokeWidth: l.strokeWidth * s } : {}), ...(l.radius ? { radius: l.radius * s } : {}), ...(l.spacing ? { spacing: l.spacing * sx } : {}) };
      if (l.mask) out.mask = { ...l.mask, x: R(l.mask.x * sx), y: R(l.mask.y * sy), w: Math.max(1, R(l.mask.w * sx)), h: Math.max(1, R(l.mask.h * sy)), feather: l.mask.feather * s };
      return out;
    }),
  };
}

/** Whole-canvas rotate/flip: rectangles and vector properties (pixels via geometry.js). */
export function transformDoc(doc, kind) {
  const W = doc.w, H = doc.h, swap = swapsSize(kind);
  return {
    ...doc, w: swap ? H : W, h: swap ? W : H, selection: null,
    layers: doc.layers.map(l => {
      const out = l.type === 'raster' ? (() => { const [x, y, w, h] = mapRect(kind, W, H, l.x, l.y, l.w, l.h); return { ...l, x, y, w, h }; })() : transformVectorLayer(l, kind, W, H);
      if (l.mask) { const [x, y, w, h] = mapRect(kind, W, H, l.mask.x, l.mask.y, l.mask.w, l.mask.h); out.mask = { ...l.mask, x, y, w, h }; }
      return out;
    }),
  };
}

/** Rotate/flip one layer in place about its own centre (Edit > Transform). */
export function transformLayerInPlace(l, kind) {
  if (l.type !== 'raster') {
    if (kind === 'flipH') return { ...l, flipX: !l.flipX, rotation: -(l.rotation || 0) };
    if (kind === 'flipV') return { ...l, flipY: !l.flipY, rotation: -(l.rotation || 0) };
    const d = kind === 'rotate90cw' ? 90 : kind === 'rotate90ccw' ? -90 : 180;
    return { ...l, rotation: ((((l.rotation || 0) + d) % 360) + 540) % 360 - 180 };
  }
  if (!swapsSize(kind)) return l;
  const cx = l.x + l.w / 2, cy = l.y + l.h / 2;
  return { ...l, w: l.h, h: l.w, x: R(cx - l.h / 2), y: R(cy - l.w / 2) };
}

/** Anchor grid (0..2 × 0..2) → offset of the old content inside a new canvas. */
export const anchorOffset = (oldW, oldH, newW, newH, ax, ay) => [R((newW - oldW) * ax / 2), R((newH - oldH) * ay / 2)];
