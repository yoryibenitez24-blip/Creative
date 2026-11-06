// Advanced type engine: Photoshop-style character/paragraph layout, text on a path and warp text.
// Pure JS (no DOM). Glyph widths come from an injected `measure(text, cssFont) => px` so Node tests can
// use a deterministic fake metric and the browser a canvas 2D context. Optional extras on the measure
// function: `measure.bounds(text, cssFont) => { left, right }` (ink extents relative to the pen origin,
// used by optical kerning).
//
// Layer fields (all optional, defaults keep legacy text layers rendering exactly as before):
//   kind 'point'|'paragraph'; character props (CHAR_DEFAULTS); paragraph props (PARA_DEFAULTS);
//   runs [{start, end, ...charOverrides}] (end exclusive, indices into layer.text);
//   kerningPairs {[i]: 1/1000 em} = manual kerning between text[i-1] and text[i];
//   onPath {d, offset %, side 'left'|'right'} | null; warp {style, bend, hDistortion, vDistortion, horizontal}.
// Legacy fields still honoured: `spacing` (px added after every glyph, used when `tracking` is absent)
// and `lineHeight` (multiplier, default 1.1, used when `leading` is absent).

export const FONT_FAMILIES = [
  'Arial, sans-serif', 'Helvetica, Arial, sans-serif', 'Verdana, sans-serif', 'Tahoma, sans-serif',
  'Trebuchet MS, sans-serif', 'Segoe UI, sans-serif', 'system-ui, sans-serif', 'Georgia, serif',
  'Times New Roman, serif', 'Palatino Linotype, Palatino, serif', 'Garamond, serif', 'Courier New, monospace',
  'Consolas, monospace', 'Lucida Console, monospace', 'Impact, sans-serif', 'Comic Sans MS, cursive',
];

export const CHAR_DEFAULTS = {
  font: 'Arial, sans-serif', weight: 400, italic: false, size: 60, leading: undefined, tracking: undefined,
  kerning: 'metrics', vScale: 100, hScale: 100, baselineShift: 0, fill: '#000000', fauxBold: false,
  fauxItalic: false, allCaps: false, smallCaps: false, superscript: false, subscript: false, underline: false,
  strikethrough: false, ligatures: true, language: 'en-US',
};
export const PARA_DEFAULTS = { align: 'left', indentLeft: 0, indentRight: 0, indentFirst: 0, spaceBefore: 0, spaceAfter: 0, hyphenate: false };
export const WARP_STYLES = ['none', 'arc', 'arcLower', 'arcUpper', 'arch', 'bulge', 'shellLower', 'shellUpper', 'flag', 'wave', 'fish', 'rise', 'fisheye', 'inflate', 'squeeze', 'twist'];
export const WARP_DEFAULT = { style: 'none', bend: 50, hDistortion: 0, vDistortion: 0, horizontal: true };

export const SUPER_SIZE = 0.583, SUPER_POS = 0.333, SMALLCAPS_SIZE = 0.7;
const CHAR_KEYS = Object.keys(CHAR_DEFAULTS);

export const fontString = (st, size) => `${st.italic ? 'italic ' : ''}${st.weight} ${+size.toFixed(3)}px ${st.font}`;

/** Resolved character style at text index i (layer props + defaults, then runs in order). */
export function charStyleAt(layer, i) {
  const st = {};
  for (const k of CHAR_KEYS) st[k] = layer[k] ?? CHAR_DEFAULTS[k];
  for (const r of layer.runs || []) if (i >= r.start && i < r.end) for (const k of CHAR_KEYS) if (r[k] !== undefined) st[k] = r[k];
  return st;
}
export const paraStyle = layer => { const p = {}; for (const k in PARA_DEFAULTS) p[k] = layer[k] ?? PARA_DEFAULTS[k]; return p; };

/** True when the layer only uses legacy fields, i.e. it can be rendered with the original single <text>. */
export function isLegacyText(layer) {
  if ((layer.kind || 'point') !== 'point' || layer.onPath || (layer.warp && layer.warp.style !== 'none')) return false;
  if ((layer.runs || []).length || Object.keys(layer.kerningPairs || {}).length) return false;
  if (!['left', 'center', 'right', undefined].includes(layer.align)) return false;
  for (const k of CHAR_KEYS) if (!['font', 'weight', 'size', 'fill', 'language'].includes(k) && layer[k] !== undefined && layer[k] !== CHAR_DEFAULTS[k]) return false;
  for (const k of ['indentLeft', 'indentRight', 'indentFirst', 'spaceBefore', 'spaceAfter']) if (layer[k]) return false;
  return true;
}

function lineLeading(layer, st) {
  if (st.leading === 'auto') return 1.2 * st.size;
  if (typeof st.leading === 'number') return st.leading;
  return st.size * (layer.lineHeight || 1.1);
}

/** Optical kerning (approximation): average of the font's metrics kerning and a sidebearing correction
 *  that moves the pair's ink gap toward the gap of the reference pair "nn". Ink extents are bounding
 *  boxes, so diagonal shapes (A/V) are only partly captured. Falls back to metrics without bounds. */
export function opticalKern(a, b, font, size, measure) {
  const m = measure(a + b, font) - measure(a, font) - measure(b, font);
  if (!measure.bounds || /\s/.test(a + b)) return m;
  const gap = (x, y) => (measure(x, font) - measure.bounds(x, font).right) + measure.bounds(y, font).left;
  const tight = Math.max(-0.12 * size, Math.min(0.06 * size, gap('n', 'n') - gap(a, b)));
  return (m + tight) / 2;
}

// Build styled glyphs for text[start, end). Each glyph: pre = space before it (tracking of previous + kerning).
function buildGlyphs(layer, start, end, measure, text) {
  const out = [], pairs = layer.kerningPairs || {};
  for (let i = start; i < end; i++) {
    const st = charStyleAt(layer, i);
    let ch = text[i] === '\n' ? ' ' : text[i], size = st.size, shift = st.baselineShift;
    if (st.allCaps) ch = ch.toUpperCase();
    else if (st.smallCaps && ch !== ch.toUpperCase()) { ch = ch.toUpperCase(); size *= SMALLCAPS_SIZE; }
    if (st.superscript) { shift += st.size * SUPER_POS; size *= SUPER_SIZE; } else if (st.subscript) { shift -= st.size * SUPER_POS; size *= SUPER_SIZE; }
    const css = fontString(st, size), sx = st.hScale / 100;
    const g = {
      ch, index: i, size, font: st.font, weight: st.weight, italic: st.italic, fill: st.fill, css,
      scaleX: sx, scaleY: st.vScale / 100, skew: st.fauxItalic ? -12 : 0, fauxBold: st.fauxBold, shift,
      decoration: st.underline || st.strikethrough ? (st.underline ? 'underline' : '') + (st.underline && st.strikethrough ? ' ' : '') + (st.strikethrough ? 'line-through' : '') : '',
      language: st.language, ligatures: st.ligatures, nominal: st.size, leading: lineLeading(layer, st),
      advance: measure(ch, css) * sx,
      track: st.tracking != null ? st.tracking / 1000 * st.size : (layer.spacing || 0), pre: 0,
    };
    const prev = out[out.length - 1];
    if (prev) {
      let k = 0;
      if (typeof st.kerning === 'number') k = st.kerning / 1000 * st.size;
      else if (st.kerning !== 'none' && prev.css === css) k = (st.kerning === 'optical' ? opticalKern(prev.ch, ch, css, size, measure) : measure(prev.ch + ch, css) - measure(prev.ch, css) - measure(ch, css)) * sx;
      g.pre = prev.track + k + (pairs[i] || 0) / 1000 * st.size;
    }
    out.push(g);
  }
  return out;
}

const isSpace = g => g.ch === ' ' || g.ch === '\t';
const width = (gs, a, b) => { let w = 0; for (let i = a; i < b; i++) w += gs[i].advance + (i > a ? gs[i].pre : 0); return w; };
const trimEnd = (gs, a, b) => { while (b > a && isSpace(gs[b - 1])) b--; return b; };
const isLetter = c => /\p{L}/u.test(c), isVowel = c => /[aeiouyàáâäãåæèéêëìíîïòóôöõøùúûüÿ]/i.test(c);

// Simple hyphenation rule: break before a consonant that is followed by a vowel, keeping >= 3 letters on each side.
function hyphenPoints(gs, a, b) {
  const pts = [];
  for (let p = a + 3; p <= b - 3; p++) if (isLetter(gs[p - 1].ch) && isLetter(gs[p].ch) && !isVowel(gs[p].ch) && isVowel(gs[p + 1].ch)) pts.push(p);
  return pts;
}

function makeHyphen(g, measure) { return { ...g, ch: '-', index: g.index, pre: g.track, advance: measure('-', g.css) * g.scaleX, hyphen: true }; }

// Greedy line breaking of one paragraph's glyphs. Returns arrays of glyphs per line.
function breakLines(gs, availFor, hyphenate, measure) {
  const lines = []; let s = 0;
  if (!gs.length) return [[]];
  while (s < gs.length) {
    const avail = availFor(lines.length);
    let e = s, lastBreak = -1;
    for (let i = s; i < gs.length; i++) {
      if (!isSpace(gs[i]) && i > s && width(gs, s, i + 1) > avail) break;
      e = i + 1; if (isSpace(gs[i])) lastBreak = i + 1;
    }
    if (e >= gs.length) { lines.push(gs.slice(s)); break; }
    let lineEnd, next;
    const wordStart = lastBreak > s ? lastBreak : s;
    let wordEnd = e; while (wordEnd < gs.length && !isSpace(gs[wordEnd])) wordEnd++;
    let hy = -1;
    if (hyphenate) for (const p of hyphenPoints(gs, wordStart, wordEnd)) { const h = makeHyphen(gs[p - 1], measure); if (width(gs, s, p) + h.pre + h.advance <= avail) hy = p; }
    if (hy > 0) { lines.push([...gs.slice(s, hy), makeHyphen(gs[hy - 1], measure)]); s = hy; continue; }
    if (lastBreak > s) { lineEnd = lastBreak; next = lastBreak; } else { lineEnd = Math.max(e, s + 1); next = lineEnd; }
    lines.push(gs.slice(s, lineEnd));
    s = next; while (s < gs.length && isSpace(gs[s])) s++;
  }
  return lines;
}

/**
 * layoutText(layer, measure) => { lines:[{ y, x, width, leading, hidden, glyphs:[glyph] }], width, height, overflow, bounds }
 * Coordinates are layer-local (origin top-left of the text box); line.y and glyph.y are baselines
 * (glyph.y includes baseline shift / super- and subscript). Glyph fields: ch, index, x, y, advance, size,
 * font, weight, italic, fill, css, scaleX, scaleY, skew, fauxBold, decoration, language, ligatures.
 */
export function layoutText(layer, measure) {
  const text = String(layer.text ?? ''), kind = layer.kind === 'paragraph' ? 'paragraph' : 'point', P = paraStyle(layer);
  const boxW = layer.w || 0, boxH = layer.h || 0, lines = [];
  let y = 0, start = 0, pIndex = 0, maxRight = 0, minX = Infinity;
  const paras = text.split('\n');
  for (let pi = 0; pi < paras.length; pi++) {
    const end = start + paras[pi].length;
    const gs = buildGlyphs(layer, start, end, measure, text);
    const availFor = li => boxW - P.indentLeft - P.indentRight - (li === 0 ? P.indentFirst : 0);
    const pl = kind === 'paragraph' ? breakLines(gs, availFor, P.hyphenate, measure) : [gs];
    if (pi > 0) y += P.spaceBefore;
    pl.forEach((lg, li) => {
      const isLast = li === pl.length - 1, emptySt = charStyleAt(layer, start);
      const leading = lg.length ? Math.max(...lg.map(g => g.leading)) : lineLeading(layer, emptySt);
      const maxSize = lg.length ? Math.max(...lg.map(g => g.nominal)) : emptySt.size;
      const n = kind === 'paragraph' ? trimEnd(lg, 0, lg.length) : lg.length;
      const xs = []; let cx = 0;
      for (let i = 0; i < lg.length; i++) { if (i) cx += lg[i].pre; xs.push(cx); cx += lg[i].advance; }
      const w = n ? xs[n - 1] + lg[n - 1].advance : 0, avail = availFor(li), off = P.indentLeft + (li === 0 ? P.indentFirst : 0);
      let al = P.align, x0 = off;
      if (al.startsWith('justify')) {
        const just = kind === 'paragraph' && (!isLast || al === 'justify-all') && n > 1 && avail > w;
        if (just) {
          const spaces = []; for (let i = 1; i < n - 1; i++) if (isSpace(lg[i])) spaces.push(i);
          const extra = avail - w, targets = spaces.length ? spaces.map(i => i + 1) : Array.from({ length: n - 1 }, (_, i) => i + 1);
          const per = extra / targets.length; let acc = 0, t = 0;
          for (let i = 0; i < lg.length; i++) { while (t < targets.length && targets[t] <= i) { acc += per; t++; } xs[i] += acc; }
          al = 'left';
        } else al = al === 'justify-all' ? 'left' : al.slice(8);
      }
      if (al === 'center') x0 = off + (avail - w) / 2; else if (al === 'right') x0 = off + avail - w;
      y += leading;
      const glyphs = lg.map((g, i) => ({ ...g, x: x0 + xs[i], y: y - g.shift }));
      const descent = 0.25 * maxSize;
      lines.push({ y, x: x0, width: w, leading, maxSize, paragraph: pIndex, hidden: kind === 'paragraph' && y + descent > boxH + 1e-6, glyphs });
      maxRight = Math.max(maxRight, x0 + w); minX = Math.min(minX, x0);
    });
    if (pi < paras.length - 1) y += P.spaceAfter;
    start = end + 1; pIndex++;
  }
  const last = lines[lines.length - 1], first = lines[0];
  const height = last ? last.y + 0.25 * last.maxSize : 0;
  const top = first ? first.y - 0.8 * first.maxSize : 0;
  return {
    lines, width: kind === 'paragraph' ? boxW : maxRight, height,
    overflow: kind === 'paragraph' && lines.some(l => l.hidden),
    bounds: { x: Number.isFinite(minX) ? minX : 0, y: top, w: Math.max(0, maxRight - (Number.isFinite(minX) ? minX : 0)), h: Math.max(0, height - top) },
  };
}

// ---------- text on path ----------

/** Parse an SVG path (M L H V C S Q T Z, absolute and relative) into flattened polylines [[x,y],...] per subpath. */
export function parsePath(d, steps = 24) {
  const toks = String(d || '').match(/[MLHVCSQTZmlhvcsqtz]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) || [];
  const subs = []; let cur = null, x = 0, y = 0, sx = 0, sy = 0, cmd = '', i = 0, lc = null, lq = null;
  const num = () => +toks[i++];
  const bez = (pts) => { for (let k = 1; k <= steps; k++) { const t = k / steps; cur.push(pts.length === 3 ? q2(pts, t) : c3(pts, t)); } };
  const q2 = ([a, b, c], t) => [(1 - t) ** 2 * a[0] + 2 * (1 - t) * t * b[0] + t * t * c[0], (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * b[1] + t * t * c[1]];
  const c3 = ([a, b, c, e], t) => { const u = 1 - t; return [u ** 3 * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t ** 3 * e[0], u ** 3 * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t ** 3 * e[1]]; };
  while (i < toks.length) {
    if (/[a-z]/i.test(toks[i])) cmd = toks[i++];
    else if (!cmd) { i++; continue; }
    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase(), ox = rel ? x : 0, oy = rel ? y : 0;
    if (C === 'Z') { if (cur) { cur.push([sx, sy]); x = sx; y = sy; } cmd = ''; lc = lq = null; continue; }
    if (i >= toks.length || /[a-z]/i.test(toks[i])) { cmd = ''; continue; }
    if (C === 'M') { x = ox + num(); y = oy + num(); sx = x; sy = y; cur = [[x, y]]; subs.push(cur); cmd = rel ? 'l' : 'L'; lc = lq = null; continue; }
    if (!cur) { cur = [[x, y]]; subs.push(cur); }
    if (C === 'L') { x = ox + num(); y = oy + num(); cur.push([x, y]); lc = lq = null; }
    else if (C === 'H') { x = ox + num(); cur.push([x, y]); lc = lq = null; }
    else if (C === 'V') { y = oy + num(); cur.push([x, y]); lc = lq = null; }
    else if (C === 'C' || C === 'S') {
      const p1 = C === 'C' ? [ox + num(), oy + num()] : lc ? [2 * x - lc[0], 2 * y - lc[1]] : [x, y];
      const p2 = [ox + num(), oy + num()], p3 = [ox + num(), oy + num()];
      bez([[x, y], p1, p2, p3]); lc = p2; lq = null; [x, y] = p3;
    } else if (C === 'Q' || C === 'T') {
      const p1 = C === 'Q' ? [ox + num(), oy + num()] : lq ? [2 * x - lq[0], 2 * y - lq[1]] : [x, y];
      const p2 = [ox + num(), oy + num()];
      bez([[x, y], p1, p2]); lq = p1; lc = null; [x, y] = p2;
    } else i++;
  }
  return subs;
}

function polyAt(poly, cum, s) {
  let lo = 1; while (lo < cum.length - 1 && cum[lo] < s) lo++;
  const a = poly[lo - 1], b = poly[lo], seg = cum[lo] - cum[lo - 1] || 1, t = (s - cum[lo - 1]) / seg;
  return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, angle: Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI };
}

/**
 * layoutOnPath(layer, measure, onPath = layer.onPath) => { glyphs, length, width, overflow }
 * Text runs along the first subpath of onPath.d (newlines become spaces). Each glyph gets x, y (the point
 * on the path under the glyph's horizontal centre, on the baseline), angle (degrees, the path tangent),
 * dy (= -baseline shift, along the glyph's local y) and hidden (beyond the path ends). side 'right' flips
 * the text to the other side by running the path backwards. offset is the start position in % of length;
 * alignment centre/right places the text in the remaining length.
 */
export function layoutOnPath(layer, measure, onPath = layer.onPath) {
  let poly = (parsePath(onPath?.d)[0] || []).filter((p, k, a) => !k || p[0] !== a[k - 1][0] || p[1] !== a[k - 1][1]);
  if (onPath?.side === 'right') poly = [...poly].reverse();
  const text = String(layer.text ?? '');
  const gs = buildGlyphs(layer, 0, text.length, measure, text);
  const xs = []; let cx = 0;
  gs.forEach((g, i) => { if (i) cx += g.pre; xs.push(cx); cx += g.advance; });
  const w = cx;
  if (poly.length < 2) return { glyphs: [], length: 0, width: w, overflow: gs.length > 0 };
  const cum = [0]; for (let k = 1; k < poly.length; k++) cum.push(cum[k - 1] + Math.hypot(poly[k][0] - poly[k - 1][0], poly[k][1] - poly[k - 1][1]));
  const L = cum[cum.length - 1], start = Math.max(0, Math.min(100, onPath.offset || 0)) / 100 * L, avail = L - start;
  const al = paraStyle(layer).align.replace('justify-', '');
  const s0 = start + (al === 'center' ? (avail - w) / 2 : al === 'right' ? avail - w : 0);
  let overflow = false;
  const glyphs = gs.map((g, i) => {
    const s = s0 + xs[i] + g.advance / 2, hidden = s < -1e-9 || s > L + 1e-9;
    if (hidden) overflow = true;
    const p = polyAt(poly, cum, Math.max(0, Math.min(L, s)));
    return { ...g, x: p.x, y: p.y, angle: p.angle, dy: -g.shift, hidden };
  });
  return { glyphs, length: L, width: w, overflow };
}

// ---------- warp text ----------

/**
 * warpPoint(style, bend, hd, vd, bounds, x, y, horizontal = true) => {x, y}
 * Photoshop-like warp styles as smooth deformations of the bounds rectangle {x, y, w, h}. bend, hd, vd in
 * -100..100. Vertical orientation applies the same function with the axes swapped. bend 0 and zero
 * distortion is the identity.
 */
export function warpPoint(style, bend, hd, vd, bounds, x, y, horizontal = true) {
  if (!horizontal) {
    const r = warpPoint(style, bend, vd, hd, { x: bounds.y, y: bounds.x, w: bounds.h, h: bounds.w }, y, x, true);
    return { x: r.y, y: r.x };
  }
  const hw = Math.max(1e-9, bounds.w / 2), hh = Math.max(1e-9, bounds.h / 2), cx = bounds.x + hw, cy = bounds.y + hh;
  const s = (bend || 0) / 100;
  let dx = x - cx, dy = y - cy;
  const u = dx / hw, v = dy / hh, cu = Math.max(-1, Math.min(1, u)), cv = Math.max(-1, Math.min(1, v));
  const hump = 1 - cu * cu;
  const arc = (ex, ey) => {
    const a = s * Math.PI / 3, R = hw / a, phi = ex / R, rr = R - ey;
    return [rr * Math.sin(phi), R - rr * Math.cos(phi) - R * (1 - Math.cos(a)) / 2];
  };
  if (s !== 0) switch (style) {
    case 'arc': [dx, dy] = arc(dx, dy); break;
    case 'arcLower': case 'arcUpper': {
      const [ax, ay] = arc(dx, dy), t = style === 'arcLower' ? (cv + 1) / 2 : (1 - cv) / 2;
      dx += (ax - dx) * t; dy += (ay - dy) * t; break;
    }
    case 'arch': dy -= s * hump * hh; break;
    case 'bulge': dy *= 1 + s * 0.5 * hump; break;
    case 'shellLower': dy += s * hump * (cv + 1) / 2 * hh; break;
    case 'shellUpper': dy -= s * hump * (1 - cv) / 2 * hh; break;
    case 'flag': dy -= s * Math.sin(cu * Math.PI) * hh * 0.5; break;
    case 'wave': dy -= s * Math.sin(cu * Math.PI + cv * Math.PI / 4) * hh * 0.5; break;
    case 'fish': dy *= 1 + s * 0.6 * Math.sin(Math.PI * (cu + 1) / 2) * (1 - cu) / 1.3; break;
    case 'rise': dy -= s * Math.sin(cu * Math.PI / 2) * hh; break;
    case 'fisheye': { const r = Math.hypot(u, v); if (r < 1) { const f = 1 + s * 0.5 * (1 - r * r); dx *= f; dy *= f; } break; }
    case 'inflate': dx *= 1 + s * 0.4 * (1 - cv * cv); dy *= 1 + s * 0.5 * hump; break;
    case 'squeeze': dx *= 1 - s * 0.4 * (1 - cv * cv); dy *= 1 + s * 0.5 * hump; break;
    case 'twist': { const r = Math.min(1, Math.hypot(u, v)), t = s * Math.PI / 2 * (1 - r) ** 2, c = Math.cos(t), sn = Math.sin(t); [dx, dy] = [dx * c - dy * sn, dx * sn + dy * c]; break; }
    default: break;
  }
  const H = (hd || 0) / 100, V = (vd || 0) / 100;
  if (H) dy *= 1 + H * 0.5 * Math.max(-1, Math.min(1, dx / hw));
  if (V) dx *= 1 + V * 0.5 * Math.max(-1, Math.min(1, dy / hh));
  if (style === 'none' && !H && !V) return { x, y };
  return { x: cx + dx, y: cy + dy };
}

/**
 * warpRaster(srcBuf, warp, bounds, cell = 4) => { w, h, data, ox, oy }
 * Forward-maps a grid of triangles covering srcBuf through warpPoint and rasterises each destination
 * triangle with bilinear sampling (premultiplied, so edges have no dark fringes). bounds are in source
 * pixel coordinates; the result's pixel (0,0) lies at source coordinates (ox, oy).
 */
export function warpRaster(srcBuf, warp, bounds, cell = 4) {
  const { w: W, h: Hh, data: S } = srcBuf, wp = { ...WARP_DEFAULT, ...(warp || {}) };
  const nx = Math.max(1, Math.ceil(W / cell)), ny = Math.max(1, Math.ceil(Hh / cell));
  const V = [];
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
    const sx = Math.min(W, i * cell), sy = Math.min(Hh, j * cell), p = warpPoint(wp.style, wp.bend, wp.hDistortion, wp.vDistortion, bounds, sx, sy, wp.horizontal !== false);
    V.push([sx, sy, p.x, p.y]);
  }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const v of V) { x0 = Math.min(x0, v[2]); y0 = Math.min(y0, v[3]); x1 = Math.max(x1, v[2]); y1 = Math.max(y1, v[3]); }
  const ox = Math.floor(x0), oy = Math.floor(y0), w = Math.max(1, Math.ceil(x1) - ox), h = Math.max(1, Math.ceil(y1) - oy);
  const acc = new Float32Array(w * h * 4), cov = new Uint8Array(w * h);
  const sample = (fx, fy, o) => {
    fx -= 0.5; fy -= 0.5;
    const xa = Math.floor(fx), ya = Math.floor(fy), tx = fx - xa, ty = fy - ya;
    let r = 0, g = 0, b = 0, a = 0;
    for (let k = 0; k < 4; k++) {
      const px = xa + (k & 1), py = ya + (k >> 1); if (px < 0 || py < 0 || px >= W || py >= Hh) continue;
      const wt = ((k & 1) ? tx : 1 - tx) * ((k >> 1) ? ty : 1 - ty), q = (py * W + px) * 4, al = S[q + 3] * wt;
      r += S[q] * al; g += S[q + 1] * al; b += S[q + 2] * al; a += al;
    }
    acc[o] = r; acc[o + 1] = g; acc[o + 2] = b; acc[o + 3] = a;
  };
  const tri = (A, B, C) => {
    const ax = A[2] - ox, ay = A[3] - oy, bx = B[2] - ox, by = B[3] - oy, cx = C[2] - ox, cy = C[3] - oy;
    const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy); if (Math.abs(den) < 1e-12) return;
    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx))), maxX = Math.min(w - 1, Math.ceil(Math.max(ax, bx, cx)));
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cy))), maxY = Math.min(h - 1, Math.ceil(Math.max(ay, by, cy)));
    for (let py = minY; py <= maxY; py++) for (let px = minX; px <= maxX; px++) {
      const o = py * w + px; if (cov[o]) continue;
      const qx = px + 0.5, qy = py + 0.5;
      const l1 = ((by - cy) * (qx - cx) + (cx - bx) * (qy - cy)) / den, l2 = ((cy - ay) * (qx - cx) + (ax - cx) * (qy - cy)) / den, l3 = 1 - l1 - l2;
      if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
      cov[o] = 1; sample(l1 * A[0] + l2 * B[0] + l3 * C[0], l1 * A[1] + l2 * B[1] + l3 * C[1], o * 4);
    }
  };
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const a = V[j * (nx + 1) + i], b = V[j * (nx + 1) + i + 1], c = V[(j + 1) * (nx + 1) + i], d = V[(j + 1) * (nx + 1) + i + 1];
    tri(a, b, d); tri(a, d, c);
  }
  const data = new Uint8ClampedArray(w * h * 4);
  for (let o = 0; o < w * h; o++) { const a = acc[o * 4 + 3]; if (a > 0) { data[o * 4] = acc[o * 4] / a; data[o * 4 + 1] = acc[o * 4 + 1] / a; data[o * 4 + 2] = acc[o * 4 + 2] / a; data[o * 4 + 3] = a; } }
  return { w, h, data, ox, oy };
}

// ---------- editing helpers ----------

/** Set character props on text[start,end) as a run; returns the new runs array (normalised, merged). */
export function applyCharStyle(layer, start, end, patch) {
  const n = String(layer.text ?? '').length; start = Math.max(0, Math.min(n, start)); end = Math.max(start, Math.min(n, end));
  if (start === end) return layer.runs || [];
  const runs = [];
  for (const r of layer.runs || []) {
    if (r.end <= start || r.start >= end) { runs.push(r); continue; }
    if (r.start < start) runs.push({ ...r, end: start });
    const mid = { ...r, start: Math.max(r.start, start), end: Math.min(r.end, end) };
    for (const k in patch) delete mid[k];
    if (Object.keys(mid).length > 2) runs.push(mid);
    if (r.end > end) runs.push({ ...r, start: end });
  }
  runs.push({ start, end, ...patch });
  return runs.sort((a, b) => a.start - b.start);
}

/** Patch for a text edit: keeps runs and manual kerning pairs attached to the same characters. */
export function editText(layer, next) {
  const prev = String(layer.text ?? ''); next = String(next ?? '');
  let a = 0; while (a < prev.length && a < next.length && prev[a] === next[a]) a++;
  let b = 0; while (b < prev.length - a && b < next.length - a && prev[prev.length - 1 - b] === next[next.length - 1 - b]) b++;
  const oldEnd = prev.length - b, delta = next.length - prev.length, insEnd = next.length - b;
  // New characters inherit the style of the character before them (as in Photoshop).
  const mapStart = i => (i < a || (i === a && a === 0) ? i : i >= oldEnd && i > a ? i + delta : insEnd);
  const mapEnd = i => (i < a ? i : i >= oldEnd && i > a ? i + delta : insEnd);
  const map = i => (i < a ? i : i >= oldEnd ? i + delta : a);
  const patch = { text: next };
  if (layer.runs?.length) patch.runs = layer.runs.map(r => ({ ...r, start: mapStart(r.start), end: mapEnd(r.end) })).filter(r => r.end > r.start);
  if (layer.kerningPairs) { const kp = {}; for (const k in layer.kerningPairs) { const i = +k; if (i < a || i >= oldEnd) kp[map(i)] = layer.kerningPairs[k]; } patch.kerningPairs = kp; }
  return patch;
}
