// Registry of destructive pixel operations (Image > Adjustments, Filter menu, geometry).
// Each op: {id, name, menu, group, ledger, params:[{key,label,type,…}], run(buf, params, ctx) → buf}.
// The same registry drives the dialogs (src/editor/OpDialog.jsx), the worker
// (src/engine/ops-worker.js) and the tests. runOp() applies the op and blends the result back
// through the selection mask, so every op respects selections the same way.

import * as A from './adjust.js';
import * as F from './filters.js';
import * as G from './geometry.js';
import { BW_DEFAULTS } from './adjust.js';
import { develop } from './develop.js';
import { projectiveTransform, meshWarp } from './warp.js';
import { contentAwareFill } from './inpaint.js';

const r = (key, label, min, max, def, step = 1, unit = '') => ({ key, label, type: 'range', min, max, default: def, step, unit });
const sel = (key, label, options, def) => ({ key, label, type: 'select', options, default: def });
const chk = (key, label, def = false) => ({ key, label, type: 'checkbox', default: def });
const col = (key, label, def) => ({ key, label, type: 'color', default: def });
const seed = { key: 'seed', label: 'Seed', type: 'range', min: 1, max: 9999, default: 1, step: 1 };

export const OPS = [
  // ---- Image > Adjustments ----
  { id: 'brightnessContrast', name: 'Brightness/Contrast…', menu: 'adjust', ledger: 'IMGADJ-BRICON', params: [r('brightness', 'Brightness', -150, 150, 0), r('contrast', 'Contrast', -50, 100, 0)], run: A.brightnessContrast },
  { id: 'levels', name: 'Levels…', menu: 'adjust', ledger: 'IMGADJ-LEVELS', params: [sel('channel', 'Channel', [['rgb', 'RGB'], ['r', 'Red'], ['g', 'Green'], ['b', 'Blue']], 'rgb'), r('inBlack', 'Input black', 0, 253, 0), r('gamma', 'Midtones (gamma)', 0.1, 9.99, 1, 0.01), r('inWhite', 'Input white', 2, 255, 255), r('outBlack', 'Output black', 0, 255, 0), r('outWhite', 'Output white', 0, 255, 255)], histogram: true, run: A.levels },
  { id: 'curves', name: 'Curves…', menu: 'adjust', ledger: 'IMGADJ-CURVES', params: [{ key: 'points', label: 'Curve', type: 'curve', default: { rgb: [[0, 0], [255, 255]], r: [[0, 0], [255, 255]], g: [[0, 0], [255, 255]], b: [[0, 0], [255, 255]] } }], histogram: true, run: A.curves },
  { id: 'exposure', name: 'Exposure…', menu: 'adjust', ledger: 'IMGADJ-EXPOSURE', params: [r('exposure', 'Exposure', -5, 5, 0, 0.01, 'EV'), r('offset', 'Offset', -0.5, 0.5, 0, 0.001), r('gamma', 'Gamma correction', 0.1, 9.99, 1, 0.01)], run: A.exposure },
  { id: 'vibrance', name: 'Vibrance…', menu: 'adjust', ledger: 'IMGADJ-VIBRANCE', params: [r('vibrance', 'Vibrance', -100, 100, 0), r('saturation', 'Saturation', -100, 100, 0)], run: A.vibrance },
  { id: 'hueSaturation', name: 'Hue/Saturation…', menu: 'adjust', ledger: 'IMGADJ-HUESAT', params: [r('hue', 'Hue', -180, 180, 0), r('saturation', 'Saturation', -100, 100, 0), r('lightness', 'Lightness', -100, 100, 0), chk('colorize', 'Colorize')], run: A.hueSaturation },
  { id: 'colorBalance', name: 'Color Balance…', menu: 'adjust', ledger: 'IMGADJ-COLOR-BALANCE', params: [sel('range', 'Tone', [['shadows', 'Shadows'], ['midtones', 'Midtones'], ['highlights', 'Highlights']], 'midtones'), r('cr', 'Cyan ↔ Red', -100, 100, 0), r('mg', 'Magenta ↔ Green', -100, 100, 0), r('yb', 'Yellow ↔ Blue', -100, 100, 0), chk('preserveLuminosity', 'Preserve luminosity', true)], run: A.colorBalance },
  { id: 'blackWhite', name: 'Black & White…', menu: 'adjust', ledger: 'IMGADJ-BW', params: [...Object.entries(BW_DEFAULTS).map(([k, v]) => r(k, k[0].toUpperCase() + k.slice(1), -200, 300, v, 1, '%')), chk('tint', 'Tint'), col('tintColor', 'Tint colour', '#e1d3b4')], run: A.blackWhite },
  { id: 'photoFilter', name: 'Photo Filter…', menu: 'adjust', ledger: 'IMGADJ-PHOTO-FILTER', params: [col('color', 'Filter colour', '#ec8a00'), r('density', 'Density', 0, 100, 25, 1, '%'), chk('preserveLuminosity', 'Preserve luminosity', true)], run: A.photoFilter },
  { id: 'channelMixer', name: 'Channel Mixer…', menu: 'adjust', ledger: 'IMGADJ-CHANNEL-MIXER', params: [...['r', 'g', 'b'].flatMap(o => [['r', 'Red'], ['g', 'Green'], ['b', 'Blue'], ['c', 'Constant']].map(([s, n]) => r(o + s, `${o.toUpperCase()} output: ${n}`, -200, 200, o === s ? 100 : 0, 1, '%'))), chk('monochrome', 'Monochrome')], run: A.channelMixer },
  { id: 'invert', name: 'Invert', menu: 'adjust', ledger: 'IMGADJ-INVERT', params: [], run: A.invert },
  { id: 'posterize', name: 'Posterize…', menu: 'adjust', ledger: 'IMGADJ-POSTERIZE', params: [r('levels', 'Levels', 2, 255, 4)], run: A.posterize },
  { id: 'threshold', name: 'Threshold…', menu: 'adjust', ledger: 'IMGADJ-THRESHOLD', params: [r('level', 'Threshold level', 1, 255, 128)], histogram: true, run: A.threshold },
  { id: 'gradientMap', name: 'Gradient Map…', menu: 'adjust', ledger: 'IMGADJ-GRADIENT-MAP', params: [col('from', 'Shadows colour', '#000000'), col('to', 'Highlights colour', '#ffffff'), chk('reverse', 'Reverse')], run: A.gradientMap },
  { id: 'desaturate', name: 'Desaturate', menu: 'adjust', ledger: 'IMGADJ-DESATURATE', params: [], run: A.desaturate },
  { id: 'equalize', name: 'Equalize', menu: 'adjust', ledger: 'IMGADJ-EQUALIZE', params: [], run: A.equalize },

  // ---- Filter ----
  { id: 'gaussianBlur', name: 'Gaussian Blur…', menu: 'filter', group: 'Blur', ledger: 'FLT-BLUR-GAUSSIAN', params: [r('radius', 'Radius', 0.1, 250, 4, 0.1, 'px')], run: F.gaussianBlur },
  { id: 'boxBlur', name: 'Box Blur…', menu: 'filter', group: 'Blur', ledger: 'FLT-BLUR-BOX', params: [r('radius', 'Radius', 1, 250, 4, 1, 'px')], run: F.boxBlur },
  { id: 'motionBlur', name: 'Motion Blur…', menu: 'filter', group: 'Blur', ledger: 'FLT-BLUR-MOTION', params: [r('angle', 'Angle', -180, 180, 0, 1, '°'), r('distance', 'Distance', 1, 400, 20, 1, 'px')], run: F.motionBlur },
  { id: 'radialBlur', name: 'Radial Blur…', menu: 'filter', group: 'Blur', ledger: 'FLT-BLUR-RADIAL', params: [r('amount', 'Amount', 1, 100, 10), sel('mode', 'Method', [['spin', 'Spin'], ['zoom', 'Zoom']], 'spin'), r('cx', 'Centre X', 0, 1, 0.5, 0.01), r('cy', 'Centre Y', 0, 1, 0.5, 0.01)], run: F.radialBlur },
  { id: 'unsharpMask', name: 'Unsharp Mask…', menu: 'filter', group: 'Sharpen', ledger: 'FLT-SHARPEN-UNSHARP-MASK', params: [r('amount', 'Amount', 1, 500, 100, 1, '%'), r('radius', 'Radius', 0.1, 250, 1.5, 0.1, 'px'), r('threshold', 'Threshold', 0, 255, 0, 1, 'levels')], run: F.unsharpMask },
  { id: 'sharpen', name: 'Sharpen', menu: 'filter', group: 'Sharpen', ledger: 'FLT-SHARPEN-SHARPEN', params: [], run: F.sharpen },
  { id: 'sharpenMore', name: 'Sharpen More', menu: 'filter', group: 'Sharpen', ledger: 'FLT-SHARPEN-SHARPEN-MORE', params: [], run: F.sharpenMore },
  { id: 'highPass', name: 'High Pass…', menu: 'filter', group: 'Other', ledger: 'FLT-OTHER-HIGH-PASS', params: [r('radius', 'Radius', 0.1, 250, 10, 0.1, 'px')], run: F.highPass },
  { id: 'addNoise', name: 'Add Noise…', menu: 'filter', group: 'Noise', ledger: 'FLT-NOISE-ADD-NOISE', params: [r('amount', 'Amount', 0.1, 400, 10, 0.1, '%'), sel('distribution', 'Distribution', [['uniform', 'Uniform'], ['gaussian', 'Gaussian']], 'gaussian'), chk('monochromatic', 'Monochromatic'), seed], run: F.addNoise },
  { id: 'median', name: 'Median…', menu: 'filter', group: 'Noise', ledger: 'FLT-NOISE-MEDIAN', params: [r('radius', 'Radius', 1, 50, 1, 1, 'px')], run: F.median },
  { id: 'dustScratches', name: 'Dust & Scratches…', menu: 'filter', group: 'Noise', ledger: 'FLT-NOISE-DUST-SCRATCHES', params: [r('radius', 'Radius', 1, 50, 2, 1, 'px'), r('threshold', 'Threshold', 0, 255, 10, 1, 'levels')], run: F.dustScratches },
  { id: 'despeckle', name: 'Despeckle', menu: 'filter', group: 'Noise', ledger: 'FLT-NOISE-DESPECKLE', params: [], run: F.despeckle },
  { id: 'minimum', name: 'Minimum…', menu: 'filter', group: 'Other', ledger: 'FLT-OTHER-MINIMUM', params: [r('radius', 'Radius', 1, 100, 1, 1, 'px')], run: F.minimum },
  { id: 'maximum', name: 'Maximum…', menu: 'filter', group: 'Other', ledger: 'FLT-OTHER-MAXIMUM', params: [r('radius', 'Radius', 1, 100, 1, 1, 'px')], run: F.maximum },
  { id: 'offset', name: 'Offset…', menu: 'filter', group: 'Other', ledger: 'FLT-OTHER-OFFSET', params: [r('dx', 'Horizontal', -2000, 2000, 0, 1, 'px'), r('dy', 'Vertical', -2000, 2000, 0, 1, 'px'), sel('edge', 'Undefined areas', [['wrap', 'Wrap around'], ['repeat', 'Repeat edge pixels'], ['transparent', 'Set to transparent']], 'wrap')], run: F.offset },
  { id: 'customKernel', name: 'Custom…', menu: 'filter', group: 'Other', ledger: 'FLT-OTHER-CUSTOM-CONVOLUTION', params: [{ key: 'kernel', label: 'Kernel (3×3 or 5×5, comma separated)', type: 'kernel', default: [0, 0, 0, 0, 1, 0, 0, 0, 0] }, r('scale', 'Scale', 1, 9999, 1), r('offset', 'Offset', -255, 255, 0)], run: F.customKernel },
  { id: 'emboss', name: 'Emboss…', menu: 'filter', group: 'Stylize', ledger: 'FLT-STYLIZE-EMBOSS', params: [r('angle', 'Angle', -180, 180, 135, 1, '°'), r('height', 'Height', 1, 100, 3, 1, 'px'), r('amount', 'Amount', 1, 500, 100, 1, '%')], run: F.emboss },
  { id: 'findEdges', name: 'Find Edges', menu: 'filter', group: 'Stylize', ledger: 'FLT-STYLIZE-FIND-EDGES', params: [], run: F.findEdges },
  { id: 'solarize', name: 'Solarize', menu: 'filter', group: 'Stylize', ledger: 'FLT-STYLIZE-SOLARIZE', params: [], run: F.solarize },
  { id: 'diffuse', name: 'Diffuse…', menu: 'filter', group: 'Stylize', ledger: 'FLT-STYLIZE-DIFFUSE', params: [r('radius', 'Radius', 1, 20, 2, 1, 'px'), seed], run: F.diffuse },
  { id: 'wind', name: 'Wind…', menu: 'filter', group: 'Stylize', ledger: 'FLT-STYLIZE-WIND', params: [r('strength', 'Strength', 2, 200, 20, 1, 'px'), sel('direction', 'Direction', [['right', 'From the left'], ['left', 'From the right']], 'right')], run: F.wind },
  { id: 'oilPaint', name: 'Oil Paint…', menu: 'filter', group: 'Stylize', ledger: 'FLT-STYLIZE-OIL-PAINT', params: [r('radius', 'Stylization radius', 1, 10, 3, 1, 'px')], run: F.oilPaint },
  { id: 'mosaic', name: 'Mosaic…', menu: 'filter', group: 'Pixelate', ledger: 'FLT-PIXELATE-MOSAIC', params: [r('cell', 'Cell size', 2, 200, 10, 1, 'px')], run: F.mosaic },
  { id: 'crystallize', name: 'Crystallize…', menu: 'filter', group: 'Pixelate', ledger: 'FLT-PIXELATE-CRYSTALLIZE', params: [r('cell', 'Cell size', 3, 300, 12, 1, 'px'), seed], run: F.crystallize },
  { id: 'colorHalftone', name: 'Color Halftone…', menu: 'filter', group: 'Pixelate', ledger: 'FLT-PIXELATE-COLOR-HALFTONE', params: [r('radius', 'Max radius', 2, 64, 4, 1, 'px')], run: F.colorHalftone },
  { id: 'twirl', name: 'Twirl…', menu: 'filter', group: 'Distort', ledger: 'FLT-DISTORT-TWIRL', params: [r('angle', 'Angle', -999, 999, 50, 1, '°')], run: F.twirl },
  { id: 'pinch', name: 'Pinch…', menu: 'filter', group: 'Distort', ledger: 'FLT-DISTORT-PINCH', params: [r('amount', 'Amount', -100, 100, 50, 1, '%')], run: F.pinch },
  { id: 'spherize', name: 'Spherize…', menu: 'filter', group: 'Distort', ledger: 'FLT-DISTORT-SPHERIZE', params: [r('amount', 'Amount', -100, 100, 100, 1, '%')], run: F.spherize },
  { id: 'ripple', name: 'Ripple…', menu: 'filter', group: 'Distort', ledger: 'FLT-DISTORT-RIPPLE', params: [r('amount', 'Amount', -999, 999, 100, 1, '%'), sel('size', 'Size', [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']], 'medium')], run: F.ripple },
  { id: 'wave', name: 'Wave…', menu: 'filter', group: 'Distort', ledger: 'FLT-DISTORT-WAVE', params: [r('wavelength', 'Wavelength', 2, 999, 60, 1, 'px'), r('amplitude', 'Amplitude', 0, 999, 10, 1, 'px'), sel('type', 'Type', [['sine', 'Sine'], ['triangle', 'Triangle'], ['square', 'Square']], 'sine')], run: F.wave },
  { id: 'polarCoordinates', name: 'Polar Coordinates…', menu: 'filter', group: 'Distort', ledger: 'FLT-DISTORT-POLAR-COORDINATES', params: [sel('mode', 'Conversion', [['rectToPolar', 'Rectangular to polar'], ['polarToRect', 'Polar to rectangular']], 'rectToPolar')], run: F.polarCoordinates },
  { id: 'clouds', name: 'Clouds', menu: 'filter', group: 'Render', ledger: 'FLT-RENDER-CLOUDS', params: [r('scale', 'Scale', 8, 1024, 128, 1, 'px'), seed], run: F.clouds },
  { id: 'differenceClouds', name: 'Difference Clouds', menu: 'filter', group: 'Render', ledger: 'FLT-RENDER-DIFFERENCE-CLOUDS', params: [r('scale', 'Scale', 8, 1024, 128, 1, 'px'), seed], run: (b, p, c) => F.clouds(b, { ...p, difference: true }, c) },

  // ---- Camera Raw Filter (own full-screen dialog, src/editor/CameraRaw.jsx) ----
  { id: 'cameraRaw', name: 'Camera Raw Filter…', menu: 'special', ledger: 'FILT-CAMERA-RAW', params: [], run: (b, p, c) => develop(b, p.settings || {}, c) },
  { id: 'contentAwareFill', name: 'Content-Aware Fill', menu: 'special', ledger: 'RETOUCH-CA-FILL', needsSelection: true, params: [], run: (b, p, c) => {
    if (!c.mask) throw Error('Make a selection around what should be removed first');
    const hole = new Uint8Array(b.w * b.h), ox = c.offsetX || 0, oy = c.offsetY || 0;
    for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) { const dx = x + ox, dy = y + oy; if (dx >= 0 && dy >= 0 && dx < c.docW && dy < c.docH && c.mask[dy * c.docW + dx] > 127) hole[y * b.w + x] = 255; }
    return contentAwareFill(b, hole, { seed: p.seed || 1 });
  } },
  // ---- geometry (size-changing; no selection blending) ----
  { id: 'flipH', name: 'Flip Horizontal', menu: 'geometry', geometry: true, params: [], run: G.flipH },
  { id: 'flipV', name: 'Flip Vertical', menu: 'geometry', geometry: true, params: [], run: G.flipV },
  { id: 'rotate90cw', name: 'Rotate 90° clockwise', menu: 'geometry', geometry: true, params: [], run: b => G.rotate90(b, true) },
  { id: 'rotate90ccw', name: 'Rotate 90° counter-clockwise', menu: 'geometry', geometry: true, params: [], run: b => G.rotate90(b, false) },
  { id: 'rotate180', name: 'Rotate 180°', menu: 'geometry', geometry: true, params: [], run: G.rotate180 },
  { id: 'resample', name: 'Resample', menu: 'geometry', geometry: true, params: [], run: (b, p) => G.resample(b, p.w, p.h, p.method) },
  { id: 'projective', name: 'Free Transform', menu: 'geometry', geometry: true, params: [], run: (b, p) => projectiveTransform(b, p.quad, p.method) },
  { id: 'meshWarp', name: 'Warp', menu: 'geometry', geometry: true, params: [], run: (b, p) => meshWarp(b, p.grid, p.method) },
  { id: 'place', name: 'Place', menu: 'geometry', geometry: true, params: [], run: (b, p) => G.placeInto(b, p.w, p.h, p.dx, p.dy) },
];

export const OP_BY_ID = Object.fromEntries(OPS.map(o => [o.id, o]));
export const defaults = op => Object.fromEntries(op.params.map(p => [p.key, structuredClone(p.default)]));

/**
 * Run an op on a copy of `buf` and blend the result back through the selection mask.
 * ctx: {fg, bg, offsetX, offsetY, mask (document Uint8Array|null), docW, docH}
 * Returns a new buffer; the input is not modified.
 */
export function runOp(id, buf, params = {}, ctx = {}) {
  const op = OP_BY_ID[id];
  if (!op) throw Error('Unknown operation ' + id);
  const p = { ...defaults(op), ...params };
  const work = { w: buf.w, h: buf.h, data: new Uint8ClampedArray(buf.data) };
  const out = op.run(work, p, ctx) || work;
  if (op.geometry || !ctx.mask) return out;
  const { mask, docW, docH, offsetX = 0, offsetY = 0 } = ctx, o = out.data, src = buf.data;
  for (let y = 0; y < buf.h; y++) for (let x = 0; x < buf.w; x++) {
    const dx = x + offsetX, dy = y + offsetY;
    const s = dx < 0 || dy < 0 || dx >= docW || dy >= docH ? 0 : mask[dy * docW + dx] / 255;
    if (s === 1) continue;
    const i = (y * buf.w + x) * 4;
    for (let c = 0; c < 4; c++) o[i + c] = src[i + c] + (o[i + c] - src[i + c]) * s;
  }
  return out;
}
