// PSD export (8-bit RGB, PSD version 1) via ag-psd's writer.
// Layer order: doc.layers and ag-psd children are both bottom-first.
// What is kept editable in Photoshop: layer names, order, visibility, opacity, blend mode,
// clipping, raster layer masks (with density/feather), and layer effects that have a
// Photoshop equivalent (drop/inner shadow, outer/inner glow, colour overlay, stroke, bevel,
// satin, fill opacity). Pixels of shape, text, image, fill and adjustment layers are exported
// as rendered pixels; the compatibility report says so per layer. Nothing is silently dropped.

import { writePsd } from 'ag-psd';
import { hexToRgb } from './engine/color.js';
import { normalizeStyle, GLOBAL_LIGHT } from './engine/styles.js';

const BLEND = { 'normal': 'normal', 'multiply': 'multiply', 'screen': 'screen', 'overlay': 'overlay', 'darken': 'darken', 'lighten': 'lighten', 'difference': 'difference', 'exclusion': 'exclusion', 'color-dodge': 'color dodge', 'color-burn': 'color burn', 'soft-light': 'soft light', 'hard-light': 'hard light', 'hue': 'hue', 'saturation': 'saturation', 'color': 'color', 'luminosity': 'luminosity' };
const rgb = hex => { const [r, g, b] = hexToRgb(hex); return { r, g, b }; };
const px = v => ({ units: 'Pixels', value: v });

/** Photoshop layer effects for a Zertake style (effects without an equivalent are reported). */
export function effectsFor(style, light = GLOBAL_LIGHT, report = []) {
  const st = normalizeStyle(style), fx = {};
  const ang = e => e.useGlobal ? light.angle : e.angle;
  const push = (k, v) => { (fx[k] = fx[k] || []).push(v); };
  for (const e of st.effects) {
    const base = { enabled: e.enabled, blendMode: BLEND[e.blend] || 'normal', opacity: (e.opacity ?? 100) / 100 };
    switch (e.type) {
      case 'dropShadow': push('dropShadow', { ...base, color: rgb(e.color), useGlobalLight: e.useGlobal, angle: ang(e), distance: px(e.distance), choke: px(e.size * e.spread / 100), size: px(e.size), noise: e.noise / 100, layerConceals: e.knockout }); break;
      case 'innerShadow': push('innerShadow', { ...base, color: rgb(e.color), useGlobalLight: e.useGlobal, angle: ang(e), distance: px(e.distance), choke: px(e.size * e.choke / 100), size: px(e.size), noise: e.noise / 100 }); break;
      case 'outerGlow': fx.outerGlow = { ...base, color: rgb(e.fill === 'gradient' ? e.gradFrom : e.color), size: px(e.size), choke: px(e.size * e.spread / 100), noise: e.noise / 100, range: e.range / 100, source: 'edge' }; break;
      case 'innerGlow': fx.innerGlow = { ...base, color: rgb(e.fill === 'gradient' ? e.gradFrom : e.color), size: px(e.size), choke: px(e.size * e.choke / 100), noise: e.noise / 100, range: e.range / 100, source: e.source }; break;
      case 'colorOverlay': push('solidFill', { ...base, color: rgb(e.color) }); break;
      case 'stroke': push('stroke', { ...base, size: px(e.size), position: e.position, fillType: e.fill === 'color' ? 'color' : e.fill, color: rgb(e.color) }); if (e.fill !== 'color') report.push(`stroke ${e.fill} fill exported as its first colour`); break;
      case 'satin': fx.satin = { ...base, color: rgb(e.color), angle: e.angle, distance: px(e.distance), size: px(e.size), invert: e.invert }; break;
      case 'bevel': fx.bevel = { enabled: e.enabled, style: { inner: 'inner bevel', outer: 'outer bevel', emboss: 'emboss', pillow: 'pillow emboss', stroke: 'stroke emboss' }[e.style], technique: { smooth: 'smooth', chiselHard: 'chisel hard', chiselSoft: 'chisel soft' }[e.technique], strength: e.depth, direction: e.direction, size: px(e.size), soften: px(e.soften), angle: ang(e), altitude: e.useGlobal ? light.altitude : e.altitude, useGlobalLight: e.useGlobal, highlightBlendMode: BLEND[e.hiBlend], highlightColor: rgb(e.hiColor), highlightOpacity: e.hiOpacity / 100, shadowBlendMode: BLEND[e.shBlend], shadowColor: rgb(e.shColor), shadowOpacity: e.shOpacity / 100 }; break;
      default: report.push(`${e.type} effect has no exported equivalent yet and was rendered into the composite only`);
    }
  }
  return Object.keys(fx).length ? fx : undefined;
}

/**
 * doc: Zertake document. layers: [{layer, imageData (cropped RGBA), left, top, mask?:{imageData, left, top, defaultColor}}]
 * composite: ImageData of the whole document (shown by readers that ignore layers).
 * Returns {buffer: ArrayBuffer, report: string[]}.
 */
export function buildPsd(doc, layers, composite) {
  const report = [];
  const children = layers.map(({ layer: l, imageData, left, top, mask }) => {
    const notes = [];
    const st = l.style ? normalizeStyle(l.style) : null;
    const child = {
      name: l.name || 'Layer', hidden: !l.visible, opacity: l.opacity ?? 1, blendMode: BLEND[l.blend || 'normal'] || 'normal',
      clipping: !!l.clipped, left, top, imageData, protected: l.locked ? { position: true } : undefined,
    };
    if (st) { child.fillOpacity = st.blending.fillOpacity / 100; const fx = effectsFor(l.style, doc.globalLight, notes); if (fx) child.effects = fx; }
    if (mask) child.mask = { left: mask.left, top: mask.top, right: mask.left + mask.imageData.width, bottom: mask.top + mask.imageData.height, defaultColor: mask.defaultColor, disabled: !l.mask.enabled, positionRelativeToLayer: false, userMaskDensity: l.mask.density, userMaskFeather: l.mask.feather, imageData: mask.imageData };
    if (['rect', 'ellipse', 'text', 'image', 'fill', 'adjustment'].includes(l.type)) notes.push(`${l.type === 'adjustment' ? 'adjustment layer' : l.type === 'fill' ? 'fill layer' : l.type + ' layer'} exported as rendered pixels`);
    if (st && (st.blending.knockout !== 'none' || !st.blending.channels.r || !st.blending.channels.g || !st.blending.channels.b)) notes.push('knockout / channel restrictions not exported');
    for (const n of notes) report.push(`${l.name}: ${n}`);
    return child;
  });
  const psd = { width: doc.w, height: doc.h, children, imageData: composite };
  const buffer = writePsd(psd, { generateThumbnail: false, noBackground: true });
  return { buffer, report };
}

/** Crop RGBA ImageData to its non-transparent bounds (empty → 1×1 transparent at 0,0). */
export function cropToContent(img) {
  const { width: w, height: h, data } = img; let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; }
  if (x1 < 0) return { imageData: { width: 1, height: 1, data: new Uint8ClampedArray(4) }, left: 0, top: 0 };
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1, out = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y++) out.set(data.subarray(((y + y0) * w + x0) * 4, ((y + y0) * w + x1 + 1) * 4), y * cw * 4);
  return { imageData: { width: cw, height: ch, data: out }, left: x0, top: y0 };
}
