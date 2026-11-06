// Layer styles: data model, defaults, contours, patterns and SVG filter graphs.
//
// A layer may carry `style = { blending: {...}, effects: [{id, type, enabled, ...params}] }`.
// Each effect becomes its own SVG <filter> (built here as plain data, rendered by
// src/editor/LayerFx.jsx) applied to a copy of the layer's pixels, and is drawn as a separate
// element with CSS mix-blend-mode, so effect blend modes act on the layers underneath like
// Photoshop's. Order (bottom → top): drop shadow, outer glow, [knockout], content (× fill
// opacity), inner shadow, inner glow, satin, colour/gradient/pattern overlay, bevel, stroke.
// Document-wide Global Light lives on doc.globalLight {angle, altitude}.

import { curveLut, hexToRgb } from './color.js';

export const FX_TYPES = ['bevel', 'stroke', 'innerShadow', 'innerGlow', 'satin', 'colorOverlay', 'gradientOverlay', 'patternOverlay', 'outerGlow', 'dropShadow'];
export const FX_LABELS = { bevel: 'Bevel & Emboss', stroke: 'Stroke', innerShadow: 'Inner Shadow', innerGlow: 'Inner Glow', satin: 'Satin', colorOverlay: 'Color Overlay', gradientOverlay: 'Gradient Overlay', patternOverlay: 'Pattern Overlay', outerGlow: 'Outer Glow', dropShadow: 'Drop Shadow' };
export const MULTI = ['stroke', 'innerShadow', 'colorOverlay', 'gradientOverlay', 'dropShadow'];
export const BELOW = ['dropShadow', 'outerGlow'];
export const INTERIOR = ['innerShadow', 'innerGlow', 'satin', 'colorOverlay', 'gradientOverlay', 'patternOverlay'];
export const ABOVE = ['bevel', 'stroke'];

export const FX_DEFAULTS = {
  dropShadow: { blend: 'multiply', color: '#000000', opacity: 75, angle: 120, useGlobal: true, distance: 5, spread: 0, size: 5, contour: 'linear', antiAlias: false, noise: 0, knockout: true },
  innerShadow: { blend: 'multiply', color: '#000000', opacity: 75, angle: 120, useGlobal: true, distance: 5, choke: 0, size: 5, contour: 'linear', antiAlias: false, noise: 0 },
  outerGlow: { blend: 'screen', opacity: 75, noise: 0, fill: 'color', color: '#ffffbe', gradFrom: '#ffffbe', gradTo: '#ff8800', technique: 'softer', spread: 0, size: 5, contour: 'linear', antiAlias: false, range: 50, jitter: 0 },
  innerGlow: { blend: 'screen', opacity: 75, noise: 0, fill: 'color', color: '#ffffbe', gradFrom: '#ffffbe', gradTo: '#ff8800', technique: 'softer', source: 'edge', choke: 0, size: 5, contour: 'linear', antiAlias: false, range: 50, jitter: 0 },
  bevel: { style: 'inner', technique: 'smooth', depth: 100, direction: 'up', size: 5, soften: 0, angle: 120, useGlobal: true, altitude: 30, gloss: 'linear', antiAlias: false, hiBlend: 'screen', hiColor: '#ffffff', hiOpacity: 75, shBlend: 'multiply', shColor: '#000000', shOpacity: 75, contourOn: false, contour: 'linear', contourRange: 50, textureOn: false, pattern: 'canvas', textureScale: 100, textureDepth: 100, textureInvert: false },
  satin: { blend: 'multiply', color: '#000000', opacity: 50, angle: 19, distance: 11, size: 14, contour: 'gaussian', antiAlias: true, invert: true },
  colorOverlay: { blend: 'normal', color: '#ff0000', opacity: 100 },
  gradientOverlay: { blend: 'normal', opacity: 100, gradFrom: '#000000', gradTo: '#ffffff', reverse: false, style: 'linear', align: true, angle: 90, scale: 100, dither: false },
  patternOverlay: { blend: 'normal', opacity: 100, pattern: 'checker', scale: 100, link: true },
  stroke: { size: 3, position: 'outside', blend: 'normal', opacity: 100, fill: 'color', color: '#000000', gradFrom: '#000000', gradTo: '#ffffff', pattern: 'checker' },
};
export const BLENDING_DEFAULTS = { fillOpacity: 100, channels: { r: true, g: true, b: true }, knockout: 'none', blendInterior: false, blendClipped: true, transparencyShapes: true, maskHidesEffects: false, vectorMaskHidesEffects: false, blendIf: { channel: 'gray', current: [0, 0, 255, 255], underlying: [0, 0, 255, 255] } };
export const GLOBAL_LIGHT = { angle: 120, altitude: 30 };

let n = 0;
export const newEffect = type => ({ id: 'fx' + Date.now().toString(36) + (n++).toString(36), type, enabled: true, ...structuredClone(FX_DEFAULTS[type]) });
export const emptyStyle = () => ({ blending: structuredClone(BLENDING_DEFAULTS), effects: [] });
export const normalizeStyle = st => ({ blending: { ...structuredClone(BLENDING_DEFAULTS), ...(st?.blending || {}), channels: { r: true, g: true, b: true, ...(st?.blending?.channels || {}) }, blendIf: { ...BLENDING_DEFAULTS.blendIf, ...(st?.blending?.blendIf || {}) } }, effects: (st?.effects || []).filter(e => FX_DEFAULTS[e.type]).map(e => ({ ...structuredClone(FX_DEFAULTS[e.type]), ...e })) });
const isDefaultRange = r => r[0] === 0 && r[1] === 0 && r[2] === 255 && r[3] === 255;
export function styleActive(st) {
  if (!st) return false;
  const b = { ...BLENDING_DEFAULTS, ...st.blending };
  return st.effects?.some(e => e.enabled) || b.fillOpacity < 100 || b.knockout !== 'none' || !b.channels?.r || !b.channels?.g || !b.channels?.b || !isDefaultRange(b.blendIf?.current || [0, 0, 255, 255]) || !isDefaultRange(b.blendIf?.underlying || [0, 0, 255, 255]);
}
export const needsBackdrop = st => { const b = st?.blending; return !!b && (!isDefaultRange(b.blendIf?.underlying || [0, 0, 255, 255]) || !(b.channels?.r ?? true) || !(b.channels?.g ?? true) || !(b.channels?.b ?? true)); };

// ---------- contours ----------
export const CONTOURS = {
  linear: [[0, 0], [255, 255]], cone: [[0, 0], [128, 255], [255, 0]], coneInverted: [[0, 255], [128, 0], [255, 255]],
  gaussian: [[0, 0], [64, 16], [128, 128], [192, 240], [255, 255]], halfRound: [[0, 0], [60, 170], [128, 228], [255, 255]],
  ring: [[0, 0], [64, 255], [128, 0], [192, 255], [255, 0]], rollingSlope: [[0, 0], [90, 160], [160, 110], [255, 255]], shallowSlope: [[0, 0], [255, 140]],
  doubleRing: [[0, 0], [42, 255], [85, 0], [128, 255], [170, 0], [212, 255], [255, 0]],
};
/** feComponentTransfer tableValues for a contour (33 samples, 0..1). */
export function contourTable(name, range = 100) {
  const lut = curveLut(CONTOURS[name] || CONTOURS.linear), k = Math.max(0.01, range / 100);
  return Array.from({ length: 33 }, (_, i) => { const x = Math.min(255, Math.round(Math.min(1, i / 32 / k) * 255)); return +(lut[x] / 255).toFixed(4); });
}

// ---------- patterns (original procedural tiles) ----------
export const PATTERNS = { checker: 'Checkerboard', dots: 'Dots', stripes: 'Diagonal stripes', grid: 'Grid', canvas: 'Canvas weave', bricks: 'Bricks', noise: 'Noise' };
export function patternTile(name, size = 16) {
  const w = size, h = size, d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v;
    switch (name) {
      case 'dots': v = Math.hypot(x - w / 2 + 0.5, y - h / 2 + 0.5) < size * 0.28 ? 40 : 220; break;
      case 'stripes': v = ((x + y) % size) < size / 2 ? 60 : 210; break;
      case 'grid': v = x === 0 || y === 0 ? 50 : 225; break;
      case 'canvas': v = 150 + ((x % 4 < 2) !== (y % 4 < 2) ? 40 : -30) + ((x * 7 + y * 3) % 5) * 6; break;
      case 'bricks': { const row = Math.floor(y / (h / 2)), off = row % 2 ? w / 2 : 0; v = y % (h / 2) === 0 || (x + off) % w === 0 ? 70 : 190; break; }
      case 'noise': { let t = Math.imul(x * 374761393 + y * 668265263, 1274126177); v = 100 + ((t >>> 24) % 120); break; }
      default: v = ((x < w / 2) !== (y < h / 2)) ? 60 : 210;
    }
    d.set([v, v, v, 255], (y * w + x) * 4);
  }
  return { w, h, data: d };
}

// ---------- geometry helpers ----------
export const lightVector = (angle, distance) => { const a = angle * Math.PI / 180; return [-Math.cos(a) * distance, Math.sin(a) * distance]; };
export function effectExtent(e) {
  switch (e.type) {
    case 'dropShadow': return e.distance + e.size * 1.5 + 4;
    case 'outerGlow': return e.size * 1.5 + 4;
    case 'stroke': return e.position === 'inside' ? 2 : e.size + 4;
    case 'bevel': return e.style === 'outer' || e.style === 'emboss' || e.style === 'pillow' ? e.size * 1.5 + 4 : 2;
    default: return 2;
  }
}
/** Axis-aligned document bounds of a (possibly rotated) layer rectangle. */
export function layerBounds(l) {
  const cx = l.x + l.w / 2, cy = l.y + l.h / 2, a = (l.rotation || 0) * Math.PI / 180, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
  const hw = (l.w * c + l.h * s) / 2, hh = (l.w * s + l.h * c) / 2;
  return { x: cx - hw, y: cy - hh, w: hw * 2, h: hh * 2 };
}

// ---------- filter graphs (data) ----------
// Node: [tag, attrs, children?]. `flood(c, op)` etc. are helpers; result names are scoped per filter.
const P = (tag, attrs, children) => [tag, attrs, children || []];
const floodIn = (color, opacity, alphaRes, out) => [P('feFlood', { floodColor: color, floodOpacity: opacity / 100, result: out + 'c' }), P('feComposite', { in: out + 'c', in2: alphaRes, operator: 'in', result: out })];
const table = (inRes, values, out) => P('feComponentTransfer', { in: inRes, result: out }, [P('feFuncA', { type: 'table', tableValues: values.join(' ') })]);
const blur = (inRes, sd, out) => P('feGaussianBlur', { in: inRes, stdDeviation: Math.max(0, sd), result: out });
const morph = (inRes, op, r, out) => r > 0 ? P('feMorphology', { in: inRes, operator: op, radius: r, result: out }) : P('feOffset', { in: inRes, dx: 0, dy: 0, result: out });
const noiseNodes = (inRes, amount, out, seed = 3) => amount > 0 ? [P('feTurbulence', { type: 'fractalNoise', baseFrequency: 0.9, numOctaves: 2, seed, result: out + 'n' }), P('feColorMatrix', { in: out + 'n', type: 'matrix', values: '0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1 0 0 0 0', result: out + 'na' }), P('feComposite', { in: inRes, in2: out + 'na', operator: 'arithmetic', k1: amount / 100, k2: 1 - amount / 100, k3: 0, k4: 0, result: out })] : [P('feOffset', { in: inRes, dx: 0, dy: 0, result: out })];
const clipShape = (ts, bounds) => ts ? 'SourceAlpha' : 'clipBox';
const clipBoxNode = (ts, b) => ts ? [] : [P('feFlood', { floodColor: '#000', floodOpacity: 1, x: b.x, y: b.y, width: b.w, height: b.h, result: 'clipBox' })];
const gradTable = (from, to) => { const a = hexToRgb(from), b = hexToRgb(to); return [0, 1, 2].map(c => [a[c] / 255, b[c] / 255]); };

/**
 * Build the filter primitive list for one effect (or one half of a bevel: part 'hi'|'sh').
 * opts: {light:{angle, altitude}, transparencyShapes, bounds, images:{gradient, pattern}}
 */
export function buildEffectFilter(e, opts = {}) {
  const light = opts.light || GLOBAL_LIGHT, angle = e.useGlobal ? light.angle : e.angle, ts = opts.transparencyShapes !== false, b = opts.bounds || { x: 0, y: 0, w: 0, h: 0 };
  const clip = clipShape(ts, b), pre = clipBoxNode(ts, b);
  const nodes = [];
  switch (e.type) {
    case 'dropShadow': {
      const spread = e.size * e.spread / 100, [dx, dy] = lightVector(angle, e.distance);
      nodes.push(morph('SourceAlpha', 'dilate', spread, 'a1'), blur('a1', (e.size - spread) / 2, 'a2'), P('feOffset', { in: 'a2', dx, dy, result: 'a3' }), table('a3', contourTable(e.contour), 'a4'), ...noiseNodes('a4', e.noise, 'a5'), ...floodIn(e.color, e.opacity, 'a5', 'sh'));
      if (e.knockout) nodes.push(P('feComposite', { in: 'sh', in2: 'SourceAlpha', operator: 'out', result: 'out' })); else nodes.push(P('feOffset', { in: 'sh', dx: 0, dy: 0, result: 'out' }));
      break;
    }
    case 'innerShadow': {
      const choke = e.size * e.choke / 100, [dx, dy] = lightVector(angle, e.distance);
      nodes.push(...pre, table('SourceAlpha', [1, 0], 'inv'), morph('inv', 'dilate', choke, 'i1'), blur('i1', (e.size - choke) / 2, 'i2'), P('feOffset', { in: 'i2', dx, dy, result: 'i3' }), table('i3', contourTable(e.contour), 'i4'), ...noiseNodes('i4', e.noise, 'i5'), ...floodIn(e.color, e.opacity, 'i5', 'is'), P('feComposite', { in: 'is', in2: clip, operator: 'in', result: 'out' }));
      break;
    }
    case 'outerGlow': case 'innerGlow': {
      const inner = e.type === 'innerGlow', amt = inner ? e.size * e.choke / 100 : e.size * e.spread / 100;
      const precise = e.technique === 'precise';
      const src = inner ? (e.source === 'center' ? 'SourceAlpha' : 'inv') : 'SourceAlpha';
      if (inner) nodes.push(...pre, table('SourceAlpha', [1, 0], 'inv'));
      if (inner && e.source === 'center') nodes.push(morph(src, 'erode', amt, 'g1'), blur('g1', precise ? 0.5 : (e.size - amt) / 2, 'g2'));
      else nodes.push(morph(src, 'dilate', precise ? e.size : amt, 'g1'), blur('g1', precise ? 0.7 : (e.size - amt) / 2, 'g2'));
      nodes.push(table('g2', contourTable(e.contour, e.range * 2), 'g3'), ...noiseNodes('g3', e.noise, 'g4', 7));
      if (e.fill === 'gradient') {
        const [r, g, bl] = gradTable(e.gradFrom, e.gradTo);
        nodes.push(P('feColorMatrix', { in: 'g4', type: 'matrix', values: '0 0 0 1 0  0 0 0 1 0  0 0 0 1 0  0 0 0 1 0', result: 'g5' }), P('feComponentTransfer', { in: 'g5', result: 'g6' }, [P('feFuncR', { type: 'table', tableValues: r.reverse().join(' ') }), P('feFuncG', { type: 'table', tableValues: g.reverse().join(' ') }), P('feFuncB', { type: 'table', tableValues: bl.reverse().join(' ') }), P('feFuncA', { type: 'linear', slope: e.opacity / 100 })]), P('feComposite', { in: 'g6', in2: 'g4', operator: 'in', result: 'gl' }));
      } else nodes.push(...floodIn(e.color, e.opacity, 'g4', 'gl'));
      nodes.push(inner ? P('feComposite', { in: 'gl', in2: clip, operator: 'in', result: 'out' }) : P('feComposite', { in: 'gl', in2: 'SourceAlpha', operator: 'out', result: 'out' }));
      break;
    }
    case 'satin': {
      const a = e.angle * Math.PI / 180, dx = Math.cos(a) * e.distance, dy = -Math.sin(a) * e.distance;
      nodes.push(...pre, blur('SourceAlpha', e.size / 2, 's0'), P('feOffset', { in: 's0', dx, dy, result: 's1' }), P('feOffset', { in: 's0', dx: -dx, dy: -dy, result: 's2' }),
        P('feComposite', { in: 's1', in2: 's2', operator: 'arithmetic', k1: 0, k2: 1, k3: -1, k4: 0, result: 'd1' }), P('feComposite', { in: 's2', in2: 's1', operator: 'arithmetic', k1: 0, k2: 1, k3: -1, k4: 0, result: 'd2' }),
        P('feComposite', { in: 'd1', in2: 'd2', operator: 'arithmetic', k1: 0, k2: 1, k3: 1, k4: 0, result: 'd3' }), table('d3', contourTable(e.contour), 'd4'), ...(e.invert ? [table('d4', [1, 0], 'd5')] : [P('feOffset', { in: 'd4', dx: 0, dy: 0, result: 'd5' })]),
        ...floodIn(e.color, e.opacity, 'd5', 'st'), P('feComposite', { in: 'st', in2: clip, operator: 'in', result: 'out' }));
      break;
    }
    case 'colorOverlay':
      nodes.push(...pre, ...floodIn(e.color, e.opacity, clip, 'out')); break;
    case 'gradientOverlay': case 'patternOverlay': {
      const img = e.type === 'gradientOverlay' ? opts.images?.gradient : opts.images?.pattern;
      nodes.push(...pre, P('feImage', { href: img || '', x: b.x, y: b.y, width: b.w, height: b.h, preserveAspectRatio: 'none', result: 'im' }), P('feComponentTransfer', { in: 'im', result: 'im2' }, [P('feFuncA', { type: 'linear', slope: e.opacity / 100 })]), P('feComposite', { in: 'im2', in2: clip, operator: 'in', result: 'out' }));
      break;
    }
    case 'stroke': {
      const s = e.size;
      if (e.position === 'outside') nodes.push(morph('SourceAlpha', 'dilate', s, 'k1'), P('feComposite', { in: 'k1', in2: 'SourceAlpha', operator: 'out', result: 'ring' }));
      else if (e.position === 'inside') nodes.push(morph('SourceAlpha', 'erode', s, 'k1'), P('feComposite', { in: 'SourceAlpha', in2: 'k1', operator: 'out', result: 'ring' }));
      else nodes.push(morph('SourceAlpha', 'dilate', s / 2, 'k1'), morph('SourceAlpha', 'erode', s / 2, 'k2'), P('feComposite', { in: 'k1', in2: 'k2', operator: 'out', result: 'ring' }));
      if (e.fill === 'color') nodes.push(...floodIn(e.color, e.opacity, 'ring', 'out'));
      else nodes.push(P('feImage', { href: (e.fill === 'gradient' ? opts.images?.gradient : opts.images?.pattern) || '', x: b.x - s, y: b.y - s, width: b.w + 2 * s, height: b.h + 2 * s, preserveAspectRatio: 'none', result: 'im' }), P('feComponentTransfer', { in: 'im', result: 'im2' }, [P('feFuncA', { type: 'linear', slope: e.opacity / 100 })]), P('feComposite', { in: 'im2', in2: 'ring', operator: 'in', result: 'out' }));
      break;
    }
    case 'bevel': {
      const part = opts.part || 'hi', size = Math.max(1, e.size), alt = (e.useGlobal ? light.altitude : e.altitude), az = -(e.useGlobal ? light.angle : e.angle);
      const sinE = Math.sin(alt * Math.PI / 180), dir = e.direction === 'down' ? -1 : 1;
      const base = e.style === 'outer' ? morph('SourceAlpha', 'dilate', size, 'b0') : e.style === 'stroke' ? morph('SourceAlpha', 'dilate', size, 'b0') : P('feOffset', { in: 'SourceAlpha', dx: 0, dy: 0, result: 'b0' });
      const sd = e.technique === 'smooth' ? size / 2 : e.technique === 'chiselSoft' ? size / 3 : size / 5;
      nodes.push(...pre, base);
      if (e.technique !== 'smooth') nodes.push(morph('b0', 'erode', size / 4, 'b0e')); else nodes.push(P('feOffset', { in: 'b0', dx: 0, dy: 0, result: 'b0e' }));
      nodes.push(blur('b0e', sd + e.soften / 2, 'b1'));
      if (e.contourOn) nodes.push(table('b1', contourTable(e.contour, e.contourRange * 2), 'b2')); else nodes.push(P('feOffset', { in: 'b1', dx: 0, dy: 0, result: 'b2' }));
      if (e.textureOn && opts.images?.texture) nodes.push(P('feImage', { href: opts.images.texture, x: b.x, y: b.y, width: b.w, height: b.h, preserveAspectRatio: 'none', result: 'tx' }), P('feColorMatrix', { in: 'tx', type: 'matrix', values: `0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  ${e.textureInvert ? -0.3 : 0.3} 0 0 0 ${e.textureInvert ? 0.3 : 0}`, result: 'txa' }), P('feComposite', { in: 'b2', in2: 'txa', operator: 'arithmetic', k1: 0, k2: 1, k3: e.textureDepth / 100, k4: 0, result: 'b3' }));
      else nodes.push(P('feOffset', { in: 'b2', dx: 0, dy: 0, result: 'b3' }));
      nodes.push(P('feDiffuseLighting', { in: 'b3', surfaceScale: dir * (e.depth / 100) * size * (e.style === 'pillow' ? -1 : 1), diffuseConstant: 1, lightingColor: '#ffffff', result: 'lit' }, [P('feDistantLight', { azimuth: az, elevation: alt })]));
      nodes.push(P('feComponentTransfer', { in: 'lit', result: 'lit2' }, [P('feFuncR', { type: 'table', tableValues: contourTable(e.gloss).join(' ') })]));
      const k = part === 'hi' ? 1 / Math.max(0.05, 1 - sinE) : 1 / Math.max(0.05, sinE);
      const row = part === 'hi' ? `${k} 0 0 0 ${-k * sinE}` : `${-k} 0 0 0 ${k * sinE}`;
      nodes.push(P('feColorMatrix', { in: 'lit2', type: 'matrix', values: `0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  ${row}`, result: 'm' }));
      const color = part === 'hi' ? e.hiColor : e.shColor, op = part === 'hi' ? e.hiOpacity : e.shOpacity;
      nodes.push(...floodIn(color, op, 'm', 'bv'));
      if (e.style === 'inner') nodes.push(P('feComposite', { in: 'bv', in2: clip, operator: 'in', result: 'out' }));
      else if (e.style === 'outer') nodes.push(P('feComposite', { in: 'bv', in2: 'b0', operator: 'in', result: 'bo' }), P('feComposite', { in: 'bo', in2: 'SourceAlpha', operator: 'out', result: 'out' }));
      else nodes.push(P('feComposite', { in: 'bv', in2: 'b0', operator: 'in', result: 'out' }));
      break;
    }
    default: throw Error('Unknown effect ' + e.type);
  }
  return nodes;
}

/** Blend If factor table (alpha multiplier) from a 4-point range [b0, b1, w0, w1] (0..255). */
export function blendIfTable([b0, b1, w0, w1]) {
  return Array.from({ length: 64 }, (_, i) => {
    const v = i / 63 * 255;
    const lo = v < b0 ? 0 : v >= b1 ? 1 : (v - b0) / Math.max(1, b1 - b0);
    const hi = v > w1 ? 0 : v <= w0 ? 1 : (w1 - v) / Math.max(1, w1 - w0);
    return +(Math.min(lo, hi)).toFixed(4);
  });
}
export const BLEND_IF_CHANNEL_ROW = { gray: '0.2126 0.7152 0.0722 0 0', red: '1 0 0 0 0', green: '0 1 0 0 0', blue: '0 0 1 0 0' };
