// Colour management, colour modes and high bit depth (pure JS, no DOM; runs in Node and workers).
//
// What is real here:
//  * Built-in RGB spaces (sRGB, Display P3, Adobe RGB (1998), ProPhoto RGB, Rec.2020) built from
//    their published primaries, white points and transfer curves. The PCS is ICC D50 XYZ;
//    every space is Bradford-adapted to D50. Profiles loaded from .icc/.icm files (matrix/TRC
//    RGB and gray TRC) become the same kind of space object via profileToSpace().
//  * convertBuffer(): RGB → RGB conversion through a 33³ 3D LUT with tetrahedral interpolation,
//    for the four ICC intents (see mapRgb below for exactly what each intent does), with black
//    point compensation and optional ordered dithering.
//  * Lab mode (8-bit, encoded like PSD), Grayscale, Indexed (median cut + Floyd–Steinberg),
//    Bitmap and Duotone (monotone/duotone with transfer curves).
//  * CMYK: we cannot ship licensed press profiles, so CMYK uses a documented parametric press
//    model, "Zertake generic CMYK (approximation)": Demichel-weighted Neugebauer primaries with
//    FOGRA39/SWOP-like solid colours, a midtone dot-gain curve, a multiplicative black ink, GCR
//    black generation, total ink limit and black ink limit. It is plausible, not a measured
//    characterisation; numbers will differ from a real press profile by several ΔE.
//  * High bit depth: 16-bit (Uint16, encoded values 0..65535) and 32-bit (Float32, linear light,
//    unbounded) RGBA containers, conversions to/from 8 bits, Levels/Curves/Exposure/Gaussian
//    Blur at float precision, and HDR Toning (exposure & gamma, histogram equalisation, local
//    adaptation with an edge-aware guided-filter base/detail split).

import { buildIccProfile as buildIcc, parseIcc, curveToFunction, D50_ICC } from './icc.js';
import { hexToRgb } from './color.js';

export const D50 = D50_ICC;
export const GENERIC_CMYK = 'Zertake generic CMYK (approximation)';

// ---------- small matrix helpers ----------
const mulMV = (m, v) => [m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2], m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2], m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2]];
const mulMM = (a, b) => a.map(r => [0, 1, 2].map(j => r[0] * b[0][j] + r[1] * b[1][j] + r[2] * b[2][j]));
export function inv3(m) {
  const [[a, b, c], [d, e, f], [g, h, i]] = m, A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
  return [[A / det, -(b * i - c * h) / det, (b * f - c * e) / det], [B / det, (a * i - c * g) / det, -(a * f - c * d) / det], [C / det, -(a * h - b * g) / det, (a * e - b * d) / det]];
}
const xyToXYZ = ([x, y]) => [x / y, 1, (1 - x - y) / y];

const BRADFORD = [[0.8951, 0.2664, -0.1614], [-0.7502, 1.7135, 0.0367], [0.0389, -0.0685, 1.0296]];
const BRADFORD_INV = inv3(BRADFORD);
/** Bradford chromatic adaptation matrix from white XYZ `src` to white XYZ `dst`. */
export function bradford(src, dst) {
  const s = mulMV(BRADFORD, src), d = mulMV(BRADFORD, dst);
  return mulMM(BRADFORD_INV, mulMM([[d[0] / s[0], 0, 0], [0, d[1] / s[1], 0], [0, 0, d[2] / s[2]]], BRADFORD));
}

// ---------- Lab ----------
const LE = 216 / 24389, LK = 24389 / 27;
const fLab = t => (t > LE ? Math.cbrt(t) : (LK * t + 16) / 116);
const fInv = t => (t * t * t > LE ? t * t * t : (116 * t - 16) / LK);
/** XYZ (D50-relative, Y of white = 1) → CIE Lab. */
export function xyzToLab([X, Y, Z], white = D50) {
  const fx = fLab(X / white[0]), fy = fLab(Y / white[1]), fz = fLab(Z / white[2]);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
export function labToXyz([L, a, b], white = D50) {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  return [fInv(fx) * white[0], (L > LK * LE ? fy * fy * fy : L / LK) * white[1], fInv(fz) * white[2]];
}
export const deltaE76 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// ---------- transfer curves ----------
const trcSrgb = { decode: e => (e <= 0.04045 ? e / 12.92 : ((e + 0.055) / 1.055) ** 2.4), encode: l => (l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055), icc: { type: 'table' } };
const trcGamma = g => ({ decode: e => (e <= 0 ? 0 : e ** g), encode: l => (l <= 0 ? 0 : l ** (1 / g)), icc: { type: 'gamma', gamma: g } });
const trcProPhoto = { decode: e => (e < 16 / 512 ? e / 16 : e ** 1.8), encode: l => (l < 1 / 512 ? 16 * l : l ** (1 / 1.8)), icc: { type: 'table' } };
const trc2020 = { decode: e => (e < 0.0812428 ? e / 4.5 : ((e + 0.0992968) / 1.0992968) ** (1 / 0.45)), encode: l => (l < 0.0180540 ? 4.5 * l : 1.0992968 * l ** 0.45 - 0.0992968), icc: { type: 'table' } };

/** Build a decode/encode pair from any monotone decode function (used for ICC tables and paras). */
function trcFromDecode(decode, icc = { type: 'table' }) {
  const N = 4096, inv = new Float32Array(N + 1);
  // invert by bisection once into a table; encode() interpolates it
  for (let i = 0; i <= N; i++) {
    const y = i / N; let lo = 0, hi = 1;
    for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (decode(m) < y) lo = m; else hi = m; }
    inv[i] = (lo + hi) / 2;
  }
  return { decode: e => decode(Math.min(1, Math.max(0, e))), encode: l => { const f = Math.min(N, Math.max(0, l * N)), i = Math.min(N - 1, f | 0); return inv[i] + (inv[i + 1] - inv[i]) * (f - i); }, icc };
}

// ---------- spaces ----------
function makeRgbSpace(name, primaries, whiteXy, trc, aliases = []) {
  const whiteXYZ = xyToXYZ(whiteXy);
  const P = primaries.map(xyToXYZ), M = [[P[0][0], P[1][0], P[2][0]], [P[0][1], P[1][1], P[2][1]], [P[0][2], P[1][2], P[2][2]]];
  const S = mulMV(inv3(M), whiteXYZ);
  const toXYZ = M.map(r => [r[0] * S[0], r[1] * S[1], r[2] * S[2]]);
  return finishRgbSpace({ name, aliases, primaries, whiteXYZ, toXYZ, trc });
}
function finishRgbSpace(sp) {
  const ad = bradford(sp.whiteXYZ, D50);
  sp.kind = 'rgb';
  sp.toPCS = sp.toPCS || mulMM(ad, sp.toXYZ);
  sp.fromPCS = inv3(sp.toPCS);
  sp.fromXYZ = inv3(sp.toXYZ);
  const t = sp.trcs || [sp.trc, sp.trc, sp.trc];
  sp.trcs = t;
  // 256-entry decode table for 8-bit input
  sp.dec8 = [0, 1, 2].map(c => Float64Array.from({ length: 256 }, (_, i) => t[c].decode(i / 255)));
  return sp;
}

const D65xy = [0.3127, 0.3290], D50xy = [0.3457, 0.3585];
export const RGB_SPACES = [
  makeRgbSpace('sRGB IEC61966-2.1', [[0.64, 0.33], [0.30, 0.60], [0.15, 0.06]], D65xy, trcSrgb, ['sRGB']),
  makeRgbSpace('Display P3', [[0.680, 0.320], [0.265, 0.690], [0.150, 0.060]], D65xy, trcSrgb, ['P3', 'Display P3 (D65)']),
  makeRgbSpace('Adobe RGB (1998)', [[0.64, 0.33], [0.21, 0.71], [0.15, 0.06]], D65xy, trcGamma(563 / 256), ['Adobe RGB']),
  makeRgbSpace('ProPhoto RGB', [[0.7347, 0.2653], [0.1596, 0.8404], [0.0366, 0.0001]], D50xy, trcProPhoto, ['ROMM RGB']),
  makeRgbSpace('Rec.2020', [[0.708, 0.292], [0.170, 0.797], [0.131, 0.046]], D65xy, trc2020, ['ITU-R BT.2020', 'Rec. ITU-R BT.2020-1']),
];
// Gray spaces: gray values encode luminance Y (relative to the D50 white) through a TRC.
export const GRAY_SPACES = [
  { name: 'sGray', kind: 'gray', trc: trcSrgb, aliases: ['Gray (sRGB TRC)'] },
  { name: 'Gray Gamma 2.2', kind: 'gray', trc: trcGamma(2.2), aliases: [] },
  { name: 'Gray Gamma 1.8', kind: 'gray', trc: trcGamma(1.8), aliases: [] },
];
for (const g of GRAY_SPACES) g.dec8 = Float64Array.from({ length: 256 }, (_, i) => g.trc.decode(i / 255));

export const RGB_PROFILE_NAMES = RGB_SPACES.map(s => s.name);
export const GRAY_PROFILE_NAMES = GRAY_SPACES.map(s => s.name);
export const INTENTS = [['perceptual', 'Perceptual'], ['saturation', 'Saturation'], ['relative', 'Relative Colorimetric'], ['absolute', 'Absolute Colorimetric']];

/** Turn a parsed ICC profile (icc.js parseIcc) into a space object usable for conversion. */
export function profileToSpace(p) {
  if (!p.convertible) throw new Error(p.reason || 'Profile is not supported for conversion.');
  const name = p.description || 'Embedded profile';
  if (p.kind === 'gray-trc') {
    const d = curveToFunction(p.trc.k);
    const g = { name, kind: 'gray', trc: trcFromDecode(d), aliases: [], icc: p };
    g.dec8 = Float64Array.from({ length: 256 }, (_, i) => g.trc.decode(i / 255));
    return g;
  }
  const toPCS = [[p.rXYZ[0], p.gXYZ[0], p.bXYZ[0]], [p.rXYZ[1], p.gXYZ[1], p.bXYZ[1]], [p.rXYZ[2], p.gXYZ[2], p.bXYZ[2]]];
  // Media white: v2 profiles store the native white in wtpt; v4 stores D50 and the adaptation in chad.
  let whiteXYZ = p.whitePoint || D50;
  if (p.chad) whiteXYZ = mulMV(inv3(p.chad), D50);
  const ad = bradford(whiteXYZ, D50);
  const toXYZ = mulMM(inv3(ad), toPCS);
  const trcs = ['r', 'g', 'b'].map(c => { const t = p.trc[c]; return t.kind === 'gamma' ? trcGamma(t.gamma) : trcFromDecode(curveToFunction(t)); });
  return finishRgbSpace({ name, aliases: [], whiteXYZ, toXYZ, toPCS, trc: trcs[0], trcs, icc: p });
}

/**
 * Resolve a profile reference into a space object.
 * Accepts: a built-in name or alias ('sRGB IEC61966-2.1', 'Display P3', 'sGray', ...),
 * `{ name, bytes }` (ICC bytes, e.g. a loaded or embedded profile), a parsed ICC object or a space.
 */
const iccCache = new Map();
export function getSpace(ref) {
  if (ref == null || ref === '') return RGB_SPACES[0];
  if (typeof ref === 'object' && (ref.kind === 'rgb' || ref.kind === 'gray') && ref.trc) return ref;
  if (typeof ref === 'object' && ref.bytes) {
    const key = (ref.name || '') + ':' + ref.bytes.length + ':' + hashBytes(ref.bytes);
    if (!iccCache.has(key)) { const sp = profileToSpace(parseIcc(ref.bytes)); if (ref.name) sp.name = ref.name; iccCache.set(key, sp); }
    return iccCache.get(key);
  }
  if (typeof ref === 'object' && ref.convertible !== undefined) return profileToSpace(ref);
  const s = String(ref).toLowerCase();
  const hit = [...RGB_SPACES, ...GRAY_SPACES].find(sp => sp.name.toLowerCase() === s || sp.aliases.some(a => a.toLowerCase() === s));
  if (!hit) throw new Error(`Unknown colour profile "${ref}".`);
  return hit;
}
function hashBytes(b) { let h = 2166136261; for (let i = 0; i < b.length; i += Math.max(1, b.length >> 12)) h = Math.imul(h ^ b[i], 16777619); return h >>> 0; }

/** ICC bytes for a built-in RGB profile (v2 matrix/TRC), for embedding in exports. */
export const buildIccProfile = name => buildIcc(name, getSpace);

/** Default Edit › Color Settings. Persist this object in app preferences (not per document). */
export function defaultColorSettings() {
  return {
    rgb: 'sRGB IEC61966-2.1', cmyk: GENERIC_CMYK, gray: 'sGray',
    policyRgb: 'preserve', policyCmyk: 'preserve', policyGray: 'preserve',
    askOnOpen: true, askOnPaste: true, askOnMissing: false,
    intent: 'relative', bpc: true, dither: true,
    cmykModel: defaultCmykParams(),
  };
}

// ---------- RGB → RGB mapping (single colour, floats 0..1) ----------
const inGamut = (v, eps = 1e-6) => v[0] >= -eps && v[0] <= 1 + eps && v[1] >= -eps && v[1] <= 1 + eps && v[2] >= -eps && v[2] <= 1 + eps;
const clip01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const lchToLab = (L, C, h) => [L, C * Math.cos(h), C * Math.sin(h)];

/** Largest chroma at (L, h) that a linear-RGB space can hold (bisection). */
function maxChroma(sp, L, h, hint = 200) {
  let lo = 0, hi = hint;
  for (let k = 0; k < 22; k++) { const m = (lo + hi) / 2; if (inGamut(mulMV(sp.fromPCS, labToXyz(lchToLab(L, m, h))))) lo = m; else hi = m; }
  return lo;
}

/**
 * Map one colour (encoded 0..1 in `src`) to linear-or-encoded values in `dst`, returning encoded
 * 0..1 floats. Intents:
 *  - relative: D50-relative PCS, out-of-gamut values clipped per channel (what matrix CMMs do).
 *  - absolute: no white-point adaptation (native XYZ of both spaces), then clip. A D65 white
 *    shown in a D50 space therefore looks bluish, as with ICC absolute colorimetric.
 *  - perceptual: in LCh(D50), chroma is compressed toward the neutral axis with a soft knee at
 *    80 % of the destination boundary, scaled by how far the source gamut extends at that
 *    lightness and hue. Colours inside both gamuts below the knee are unchanged.
 *  - saturation: out-of-gamut colours are moved to the destination boundary at constant
 *    lightness and hue (keeps them as saturated as the destination allows); in-gamut unchanged.
 * Black point compensation: scales XYZ so the source black maps onto the destination black. For
 * RGB matrix spaces both blacks are 0, so BPC only matters for the CMYK press model.
 */
export function mapRgb(rgb, src, dst, intent = 'relative') {
  const lin = [src.trcs[0].decode(rgb[0]), src.trcs[1].decode(rgb[1]), src.trcs[2].decode(rgb[2])];
  let out;
  if (intent === 'absolute') out = mulMV(dst.fromXYZ, mulMV(src.toXYZ, lin));
  else {
    const xyz = mulMV(src.toPCS, lin);
    out = mulMV(dst.fromPCS, xyz);
    if (!inGamut(out) && (intent === 'perceptual' || intent === 'saturation')) {
      const [L, a, b] = xyzToLab(xyz), C = Math.hypot(a, b), h = Math.atan2(b, a);
      const Lc = Math.min(100, Math.max(0, L)), cd = maxChroma(dst, Lc, h, Math.max(C, 1));
      let c2 = cd;
      if (intent === 'perceptual') {
        const cs = Math.max(C, maxChroma(src, Lc, h, 260)), knee = 0.8 * cd;
        c2 = C <= knee ? C : knee + (C - knee) * (cd - knee) / Math.max(1e-9, cs - knee);
      }
      out = mulMV(dst.fromPCS, labToXyz(lchToLab(Lc, Math.min(c2, cd), h)));
    } else if (intent === 'perceptual' && src !== dst) {
      // in-gamut colours above the knee are compressed too, so gradations into the boundary stay smooth
      const [L, a, b] = xyzToLab(xyz), C = Math.hypot(a, b);
      if (C > 1) {
        const h = Math.atan2(b, a), cd = maxChroma(dst, L, h, 260), knee = 0.8 * cd;
        if (C > knee) {
          const cs = maxChroma(src, L, h, 260);
          if (cs > cd) out = mulMV(dst.fromPCS, labToXyz(lchToLab(L, knee + (C - knee) * (cd - knee) / (cs - knee), h)));
        }
      }
    }
  }
  return [dst.trcs[0].encode(clip01(out[0])), dst.trcs[1].encode(clip01(out[1])), dst.trcs[2].encode(clip01(out[2]))];
}

// ---------- 3D LUT ----------
/** Build a G³×3 Float32 LUT of f(r,g,b) for r,g,b on a regular 0..1 grid (b fastest). */
export function buildLut3(f, G = 33) {
  const lut = new Float32Array(G * G * G * 3);
  let o = 0;
  for (let r = 0; r < G; r++) for (let g = 0; g < G; g++) for (let b = 0; b < G; b++) {
    const v = f([r / (G - 1), g / (G - 1), b / (G - 1)]);
    lut[o++] = v[0]; lut[o++] = v[1]; lut[o++] = v[2];
  }
  return { G, lut };
}
/** Tetrahedral interpolation of an 8-bit RGB triple into out[0..2] (LUT units). */
export function lookup3({ G, lut }, r, g, b, out) {
  const s = (G - 1) / 255, fr = r * s, fg = g * s, fb = b * s;
  const ir = Math.min(G - 2, fr | 0), ig = Math.min(G - 2, fg | 0), ib = Math.min(G - 2, fb | 0);
  const dr = fr - ir, dg = fg - ig, db = fb - ib;
  const SR = G * G * 3, SG = G * 3, SB = 3, base = ir * SR + ig * SG + ib * SB;
  // choose the tetrahedron containing (dr,dg,db)
  let a1, a2, w0, w1, w2, w3;
  if (dr >= dg) {
    if (dg >= db) { a1 = SR; a2 = SR + SG; w0 = 1 - dr; w1 = dr - dg; w2 = dg - db; w3 = db; }
    else if (dr >= db) { a1 = SR; a2 = SR + SB; w0 = 1 - dr; w1 = dr - db; w2 = db - dg; w3 = dg; }
    else { a1 = SB; a2 = SR + SB; w0 = 1 - db; w1 = db - dr; w2 = dr - dg; w3 = dg; }
  } else {
    if (db >= dg) { a1 = SB; a2 = SG + SB; w0 = 1 - db; w1 = db - dg; w2 = dg - dr; w3 = dr; }
    else if (db >= dr) { a1 = SG; a2 = SG + SB; w0 = 1 - dg; w1 = dg - db; w2 = db - dr; w3 = dr; }
    else { a1 = SG; a2 = SR + SG; w0 = 1 - dg; w1 = dg - dr; w2 = dr - db; w3 = db; }
  }
  const a3 = SR + SG + SB;
  for (let c = 0; c < 3; c++) out[c] = w0 * lut[base + c] + w1 * lut[base + a1 + c] + w2 * lut[base + a2 + c] + w3 * lut[base + a3 + c];
  return out;
}

// 4×4 Bayer matrix for ordered dithering on quantisation to 8 bits
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + 0.5) / 16 - 0.5);
const lutCache = new Map();
function cachedLut(key, make) { if (!lutCache.has(key)) { if (lutCache.size > 24) lutCache.delete(lutCache.keys().next().value); lutCache.set(key, make()); } return lutCache.get(key); }
const spaceIds = new WeakMap(); let nextSpaceId = 1;
const keyOf = sp => { if (!spaceIds.has(sp)) spaceIds.set(sp, nextSpaceId++); return sp.name + '#' + spaceIds.get(sp); };

/** Apply a 0..1 output LUT to an 8-bit RGBA buffer in place (alpha kept; optional ordered dither). */
function applyLut3(buf, L, dither) {
  const d = buf.data, o = [0, 0, 0];
  for (let y = 0, p = 0; y < buf.h; y++) for (let x = 0; x < buf.w; x++, p += 4) {
    if (d[p + 3] === 0) continue;
    lookup3(L, d[p], d[p + 1], d[p + 2], o);
    const t = dither ? BAYER4[(y & 3) * 4 + (x & 3)] : 0;
    d[p] = o[0] * 255 + t + 0.5 | 0; d[p + 1] = o[1] * 255 + t + 0.5 | 0; d[p + 2] = o[2] * 255 + t + 0.5 | 0;
  }
  return buf;
}

/**
 * Convert an 8-bit RGBA buffer between RGB (or gray) profiles, in place.
 * @param buf { w, h, data: Uint8ClampedArray } (gray documents store gray in R=G=B)
 * @param from, to profile refs (see getSpace)
 * @param intent 'perceptual' | 'saturation' | 'relative' | 'absolute'
 * @param opts { bpc?: boolean, dither?: boolean, grid?: number }
 */
export function convertBuffer(buf, from, to, intent = 'relative', opts = {}) {
  const src = getSpace(from), dst = getSpace(to), { dither = false, grid = 33 } = opts;
  if (src === dst && intent !== 'absolute') return buf;
  if (src.kind === 'gray' || dst.kind === 'gray') return convertGray(buf, src, dst);
  const L = cachedLut(`${keyOf(src)}>${keyOf(dst)}:${intent}:${grid}`, () => buildLut3(v => mapRgb(v, src, dst, intent), grid));
  return applyLut3(buf, L, dither);
}

/** Gray ↔ RGB and gray ↔ gray (luminance-preserving; neutral axis maps to neutral axis). */
function convertGray(buf, src, dst) {
  const d = buf.data, lut = new Uint8ClampedArray(256 * 3);
  if (src.kind === 'gray' && dst.kind === 'gray') { for (let i = 0; i < 256; i++) lut[i * 3] = lut[i * 3 + 1] = lut[i * 3 + 2] = Math.round(dst.trc.encode(src.dec8[i]) * 255); }
  else if (src.kind === 'gray') { for (let i = 0; i < 256; i++) for (let c = 0; c < 3; c++) lut[i * 3 + c] = Math.round(dst.trcs[c].encode(src.dec8[i]) * 255); }
  else return rgbToGrayscale(buf, { space: src, gray: dst, method: 'luminance' });
  for (let p = 0; p < d.length; p += 4) { const g = d[p]; d[p] = lut[g * 3]; d[p + 1] = lut[g * 3 + 1]; d[p + 2] = lut[g * 3 + 2]; }
  return buf;
}

// ---------- Grayscale ----------
/**
 * RGB → Grayscale, in place (result in R=G=B, alpha kept).
 * method 'luminance' (default): colorimetric — linear-light Y from the source space's D50 matrix,
 *   re-encoded with the gray profile's TRC. This is what an ICC conversion to a gray profile does.
 * method 'perceptual': Photoshop-style weights 0.299 R + 0.587 G + 0.114 B on encoded values.
 * Default gray profile 'sGray' uses the sRGB curve, so the result displays correctly as sRGB.
 */
export function rgbToGrayscale(buf, { space = 'sRGB IEC61966-2.1', gray = 'sGray', method = 'luminance' } = {}) {
  const sp = getSpace(space), gs = getSpace(gray), d = buf.data, Y = sp.toPCS[1];
  const enc = new Uint8ClampedArray(4097); for (let i = 0; i <= 4096; i++) enc[i] = Math.round(gs.trc.encode(i / 4096) * 255);
  const [dr, dg, db] = sp.dec8;
  for (let p = 0; p < d.length; p += 4) {
    const v = method === 'perceptual' ? Math.round(0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2])
      : enc[Math.round(Math.min(1, Y[0] * dr[d[p]] + Y[1] * dg[d[p + 1]] + Y[2] * db[d[p + 2]]) * 4096)];
    d[p] = d[p + 1] = d[p + 2] = v;
  }
  return buf;
}

// ---------- Lab mode ----------
/**
 * RGB → Lab, in place. Channels are encoded like 8-bit PSD Lab: L 0..255 = 0..100,
 * a and b stored with +128 offset (clamped to −128..127). Alpha kept.
 */
export function rgbToLabBuffer(buf, space = 'sRGB IEC61966-2.1') {
  const sp = getSpace(space), d = buf.data, [dr, dg, db] = sp.dec8, M = sp.toPCS;
  for (let p = 0; p < d.length; p += 4) {
    const lin = [dr[d[p]], dg[d[p + 1]], db[d[p + 2]]], [L, a, b] = xyzToLab(mulMV(M, lin));
    d[p] = Math.round(L * 2.55); d[p + 1] = Math.round(a + 128); d[p + 2] = Math.round(b + 128);
  }
  return buf;
}
/** Lab (8-bit PSD encoding) → RGB, in place; out-of-gamut Lab is mapped with `intent`. */
export function labToRgbBuffer(buf, space = 'sRGB IEC61966-2.1', intent = 'relative') {
  const sp = getSpace(space), d = buf.data, cache = new Map();
  for (let p = 0; p < d.length; p += 4) {
    const key = (d[p] << 16) | (d[p + 1] << 8) | d[p + 2];
    let o = cache.get(key);
    if (!o) {
      const lab = [d[p] / 2.55, d[p + 1] - 128, d[p + 2] - 128];
      let lin = mulMV(sp.fromPCS, labToXyz(lab));
      if (!inGamut(lin) && intent !== 'relative' && intent !== 'absolute') {
        const C = Math.hypot(lab[1], lab[2]), h = Math.atan2(lab[2], lab[1]), cd = maxChroma(sp, Math.min(100, lab[0]), h, Math.max(1, C));
        lin = mulMV(sp.fromPCS, labToXyz(lchToLab(lab[0], Math.min(C, cd), h)));
      }
      o = lin.map((v, c) => Math.round(sp.trcs[c].encode(clip01(v)) * 255));
      cache.set(key, o);
    }
    d[p] = o[0]; d[p + 1] = o[1]; d[p + 2] = o[2];
  }
  return buf;
}
/** Single colour helpers. */
export const rgbToLab = (rgb, space = 'sRGB IEC61966-2.1') => { const sp = getSpace(space); return xyzToLab(mulMV(sp.toPCS, rgb.map((v, c) => sp.trcs[c].decode(v / 255)))); };
export const labToRgb = (lab, space = 'sRGB IEC61966-2.1') => { const sp = getSpace(space); return mulMV(sp.fromPCS, labToXyz(lab)).map((v, c) => sp.trcs[c].encode(clip01(v)) * 255); };

// ---------- CMYK press model ----------
/**
 * Parameters of "Zertake generic CMYK (approximation)". All percentages 0..100.
 * dotGain: midtone dot gain (20 → a 50 % dot prints as 70 %); til: total ink limit (sum of
 * C+M+Y+K); blackLimit: maximum K; gcr: 'none'|'light'|'medium'|'heavy'|'maximum'.
 */
export function defaultCmykParams() { return { name: GENERIC_CMYK, dotGain: 20, til: 300, blackLimit: 100, gcr: 'medium', paper: [95, 0, -2] }; }

// Solid colours (Lab D50, measured-like values in the style of FOGRA39 / SWOP coated).
const SOLIDS = { W: null, C: [55, -37, -50], M: [48, 74, -3], Y: [89, -5, 93], MY: [47, 68, 48], CY: [50, -65, 27], CM: [24, 22, -46], CMY: [23, 0, 0], K: [16, 0, 0] };
const GCR_CURVES = {
  none: () => 0,
  light: g => (g < 0.45 ? 0 : ((g - 0.45) / 0.55) ** 1.4),
  medium: g => (g < 0.2 ? 0 : ((g - 0.2) / 0.8) ** 1.15),
  heavy: g => (g < 0.08 ? 0 : (g - 0.08) / 0.92),
  maximum: g => g,
};
const modelCache = new Map();

/** Build (and cache) the press model for `params`. */
export function cmykModel(params = {}) {
  const p = { ...defaultCmykParams(), ...params }, key = JSON.stringify(p);
  if (modelCache.has(key)) return modelCache.get(key);
  const paperAbs = labToXyz(p.paper);
  // media-relative primaries: paper becomes the D50 white (ICC relative colorimetric convention)
  const rel = lab => labToXyz(lab).map((v, i) => v * D50[i] / paperAbs[i]);
  const P = { W: [...D50] };
  for (const k of Object.keys(SOLIDS)) if (SOLIDS[k]) P[k] = rel(SOLIDS[k]);
  const order = ['W', 'C', 'M', 'Y', 'CM', 'CY', 'MY', 'CMY'], prim = order.map(k => P[k]);
  const Tk = P.K.map((v, i) => v / D50[i]), dg = p.dotGain / 100, flare = 0.004;
  const gain = v => v + dg * 4 * v * (1 - v);
  /** CMYK fractions 0..1 → media-relative XYZ (D50). */
  function forward(c, m, y, k) {
    c = gain(c); m = gain(m); y = gain(y); k = gain(k);
    const w = [(1 - c) * (1 - m) * (1 - y), c * (1 - m) * (1 - y), m * (1 - c) * (1 - y), y * (1 - c) * (1 - m), c * m * (1 - y), c * y * (1 - m), m * y * (1 - c), c * m * y];
    const o = [0, 0, 0];
    for (let i = 0; i < 8; i++) for (let j = 0; j < 3; j++) o[j] += w[i] * prim[i][j];
    for (let j = 0; j < 3; j++) o[j] = (o[j] * (1 - k + k * Tk[j])) * (1 - flare) + flare * D50[j];
    return o;
  }
  const fLabOf = (c, m, y, k) => xyzToLab(forward(c, m, y, k));
  const til = p.til / 100, kMax = p.blackLimit / 100, gcr = GCR_CURVES[p.gcr] || GCR_CURVES.medium;
  /** Solve C,M,Y for a target Lab with K fixed (damped Gauss–Newton with numeric Jacobian). */
  function solveCmy(target, k, start, wts) {
    let x = start.slice();
    for (let it = 0; it < 14; it++) {
      const f0 = fLabOf(x[0], x[1], x[2], k), r = [0, 1, 2].map(i => (f0[i] - target[i]) * wts[i]);
      if (Math.hypot(r[0], r[1], r[2]) < 0.02) break;
      const J = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], h = 1e-3;
      for (let j = 0; j < 3; j++) {
        const xx = x.slice(); xx[j] = xx[j] > 1 - h ? xx[j] - h : xx[j] + h; const s = xx[j] - x[j];
        const f1 = fLabOf(xx[0], xx[1], xx[2], k);
        for (let i = 0; i < 3; i++) J[i][j] = (f1[i] - f0[i]) * wts[i] / s;
      }
      // Levenberg–Marquardt step: (JᵀJ + λI) δ = −Jᵀr
      const JtJ = [0, 1, 2].map(a => [0, 1, 2].map(b => J[0][a] * J[0][b] + J[1][a] * J[1][b] + J[2][a] * J[2][b] + (a === b ? 1e-2 : 0)));
      const Jtr = [0, 1, 2].map(a => J[0][a] * r[0] + J[1][a] * r[1] + J[2][a] * r[2]);
      const dlt = mulMV(inv3(JtJ), Jtr);
      x = x.map((v, j) => Math.min(1, Math.max(0, v - dlt[j])));
    }
    return x;
  }
  function limitInk(c, m, y, k) {
    const sum = c + m + y + k;
    if (sum > til) { // remove ink equally from C, M and Y (K is kept: it carries the detail)
      let ex = sum - til;
      const v = [c, m, y];
      for (let pass = 0; pass < 3 && ex > 1e-9; pass++) {
        const n = v.filter(t => t > 0).length; if (!n) break;
        const cut = ex / n;
        for (let i = 0; i < 3; i++) if (v[i] > 0) { const d = Math.min(v[i], cut); v[i] -= d; ex -= d; }
      }
      [c, m, y] = v;
    }
    return [c, m, y, k];
  }
  /** Separate a media-relative Lab target into CMYK fractions (GCR → K, then C,M,Y solved, ink limits). */
  function separate(lab, wts = [1, 1, 1], start) {
    const g0 = Math.max(0, Math.min(1, 1 - lab[0] / 100));
    const cmy0 = solveCmy(lab, 0, start ? start.slice(0, 3) : [g0, g0, g0], wts);
    const k = Math.min(kMax, gcr(Math.min(cmy0[0], cmy0[1], cmy0[2])));
    const cmy = k > 0 ? solveCmy(lab, k, cmy0.map(v => Math.max(0, v - k * 0.6)), wts) : cmy0;
    return limitInk(cmy[0], cmy[1], cmy[2], k);
  }
  const model = { name: p.name || GENERIC_CMYK, kind: 'cmyk', params: p, forward, forwardLab: fLabOf, separate, paperAbs };
  // press black: what the separation of L=0 actually prints
  const kb = separate([0, 0, 0]);
  model.black = forward(...kb); model.blackY = model.black[1]; model.blackLab = xyzToLab(model.black);
  modelCache.set(key, model);
  return model;
}
const resolveModel = m => (m && m.kind === 'cmyk' ? m : cmykModel(m || {}));

/** Black point compensation (scalar, Y-based, toward the D50 white). */
const bpcXyz = (xyz, srcBlackY, dstBlackY) => { const s = (1 - dstBlackY) / (1 - srcBlackY); return xyz.map((v, i) => (v - srcBlackY * D50[i]) * s + dstBlackY * D50[i]); };

const CMYK_WEIGHTS = { relative: [1, 1, 1], absolute: [1, 1, 1], perceptual: [2, 1, 1], saturation: [0.5, 1, 1] };
/** Target Lab (media-relative) for an encoded RGB colour going to press. */
function pressTarget(rgb, sp, model, bpc) {
  let xyz = mulMV(sp.toPCS, rgb.map((v, c) => sp.trcs[c].decode(v)));
  if (bpc) xyz = bpcXyz(xyz, 0, model.blackY);
  return xyzToLab(xyz);
}

/**
 * RGB(A) 8-bit buffer → CMYK image { w, h, cmyk: Uint8ClampedArray(w*h*4) (0..255 = 0..100 % ink), alpha }.
 * For CMYK destinations every intent uses a minimum-ΔE separation; perceptual weights lightness
 * ×2 (keeps tonal structure), saturation weights it ×0.5 (keeps chroma). Separation runs on a
 * 17³ grid with tetrahedral interpolation (separation is smooth; each node costs a solve).
 */
export function rgbToCmyk(buf, { space = 'sRGB IEC61966-2.1', model, intent = 'relative', bpc = true } = {}) {
  const sp = getSpace(space), M = resolveModel(model), G = 17, wts = CMYK_WEIGHTS[intent] || CMYK_WEIGHTS.relative;
  const L = cachedLut(`sep:${keyOf(sp)}:${JSON.stringify(M.params)}:${intent}:${bpc}`, () => {
    let prev = null; const cm = buildLut3(v => { prev = M.separate(pressTarget(v, sp, M, bpc), wts, prev); return [prev[0], prev[1], prev[2]]; }, G);
    prev = null; const k = buildLut3(v => { prev = M.separate(pressTarget(v, sp, M, bpc), wts, prev); return [prev[3], 0, 0]; }, G);
    return { cm, k };
  });
  const d = buf.data, n = buf.w * buf.h, cmyk = new Uint8ClampedArray(n * 4), alpha = new Uint8ClampedArray(n), o = [0, 0, 0], ok = [0, 0, 0];
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    lookup3(L.cm, d[p], d[p + 1], d[p + 2], o); lookup3(L.k, d[p], d[p + 1], d[p + 2], ok);
    cmyk[p] = Math.round(o[0] * 255); cmyk[p + 1] = Math.round(o[1] * 255); cmyk[p + 2] = Math.round(o[2] * 255); cmyk[p + 3] = Math.round(ok[0] * 255);
    alpha[i] = d[p + 3];
  }
  return { w: buf.w, h: buf.h, cmyk, alpha };
}
/**
 * CMYK image → 8-bit RGBA buffer. simulatePaper (absolute colorimetric for the paper) shows the
 * paper's own white and the real ink black, as Photoshop's "Simulate Paper Color" does.
 */
export function cmykToRgb(img, { space = 'sRGB IEC61966-2.1', model, intent = 'relative', bpc = true, simulatePaper = false } = {}) {
  const sp = getSpace(space), M = resolveModel(model), n = img.w * img.h, out = new Uint8ClampedArray(n * 4), cache = new Map();
  const toRgb = (c, m, y, k) => {
    let xyz = M.forward(c / 255, m / 255, y / 255, k / 255);
    if (simulatePaper) xyz = xyz.map((v, i) => v * M.paperAbs[i] / D50[i]);
    else if (bpc) xyz = bpcXyz(xyz, M.blackY, 0);
    let lin = mulMV(sp.fromPCS, xyz);
    if (!inGamut(lin) && intent !== 'relative' && intent !== 'absolute') {
      const [Lv, a, b] = xyzToLab(xyz), h = Math.atan2(b, a);
      lin = mulMV(sp.fromPCS, labToXyz(lchToLab(Lv, Math.min(Math.hypot(a, b), maxChroma(sp, Math.min(100, Lv), h, 200)), h)));
    }
    return lin.map((v, i) => Math.round(sp.trcs[i].encode(clip01(v)) * 255));
  };
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const c = img.cmyk[p], m = img.cmyk[p + 1], y = img.cmyk[p + 2], k = img.cmyk[p + 3], key = ((c << 24) | (m << 16) | (y << 8) | k) >>> 0;
    let v = cache.get(key); if (!v) { v = toRgb(c, m, y, k); if (cache.size < 1 << 20) cache.set(key, v); }
    out[p] = v[0]; out[p + 1] = v[1]; out[p + 2] = v[2]; out[p + 3] = img.alpha ? img.alpha[i] : 255;
  }
  return { w: img.w, h: img.h, data: out };
}

/**
 * Soft proof: simulate RGB → press → RGB. `proof` is a CMYK model/params object, or an RGB
 * profile ref to simulate another RGB device. Returns a new RGBA buffer.
 * opts: { intent, bpc, simulatePaper }
 */
export function proofBuffer(buf, fromSpace = 'sRGB IEC61966-2.1', proof = {}, opts = {}) {
  const { intent = 'relative', bpc = true, simulatePaper = false } = opts;
  const copy = { w: buf.w, h: buf.h, data: new Uint8ClampedArray(buf.data) };
  if (typeof proof === 'string' || proof.bytes || proof.kind === 'rgb') {
    convertBuffer(copy, fromSpace, proof, intent); return convertBuffer(copy, proof, fromSpace, 'relative');
  }
  const sp = getSpace(fromSpace), M = resolveModel(proof), wts = CMYK_WEIGHTS[intent] || CMYK_WEIGHTS.relative;
  const L = cachedLut(`proof:${keyOf(sp)}:${JSON.stringify(M.params)}:${intent}:${bpc}:${simulatePaper}`, () => {
    let prev = null;
    return buildLut3(v => {
      prev = M.separate(pressTarget(v, sp, M, bpc), wts, prev);
      let xyz = M.forward(...prev);
      if (simulatePaper) xyz = xyz.map((t, i) => t * M.paperAbs[i] / D50[i]);
      else if (bpc) xyz = bpcXyz(xyz, M.blackY, 0);
      return mulMV(sp.fromPCS, xyz).map((t, i) => sp.trcs[i].encode(clip01(t)));
    }, 17);
  });
  return applyLut3(copy, L, false);
}

/**
 * Gamut warning: Uint8Array(w*h), 255 where the colour cannot be printed by the CMYK model within
 * `threshold` ΔE76 (after black point compensation), 0 elsewhere. Transparent pixels are 0.
 */
export function gamutMask(buf, space = 'sRGB IEC61966-2.1', cmyk = {}, { threshold = 5, bpc = true } = {}) {
  const sp = getSpace(space), M = resolveModel(cmyk);
  const L = cachedLut(`gamut:${keyOf(sp)}:${JSON.stringify(M.params)}:${bpc}`, () => {
    let prev = null;
    return buildLut3(v => { const t = pressTarget(v, sp, M, bpc); prev = M.separate(t, [1, 1, 1], prev); return [deltaE76(t, M.forwardLab(...prev)), 0, 0]; }, 17);
  });
  const d = buf.data, n = buf.w * buf.h, mask = new Uint8Array(n), o = [0, 0, 0];
  for (let i = 0, p = 0; i < n; i++, p += 4) { if (!d[p + 3]) continue; lookup3(L, d[p], d[p + 1], d[p + 2], o); if (o[0] > threshold) mask[i] = 255; }
  return mask;
}

// ---------- Indexed colour ----------
/** Median-cut palette of at most n colours from opaque pixels. */
export function medianCutPalette(buf, n = 256) {
  const d = buf.data, counts = new Map();
  for (let p = 0; p < d.length; p += 4) { if (d[p + 3] < 128) continue; const k = (d[p] << 16) | (d[p + 1] << 8) | d[p + 2]; counts.set(k, (counts.get(k) || 0) + 1); }
  const cols = [...counts].map(([k, c]) => [(k >> 16) & 255, (k >> 8) & 255, k & 255, c]);
  if (!cols.length) return [[0, 0, 0]];
  if (cols.length <= n) return cols.map(c => c.slice(0, 3));
  const boxes = [cols];
  while (boxes.length < n) {
    // split the box with the largest (range × pixel count)
    let bi = -1, best = -1, bc = 0;
    boxes.forEach((b, i) => {
      if (b.length < 2) return;
      for (let c = 0; c < 3; c++) { let lo = 255, hi = 0, cnt = 0; for (const v of b) { if (v[c] < lo) lo = v[c]; if (v[c] > hi) hi = v[c]; cnt += v[3]; } const s = (hi - lo) * Math.sqrt(cnt); if (s > best) { best = s; bi = i; bc = c; } }
    });
    if (bi < 0 || best <= 0) break;
    const b = boxes[bi].sort((u, v) => u[bc] - v[bc]);
    let tot = 0; for (const v of b) tot += v[3];
    let acc = 0, cut = 1;
    for (let i = 0; i < b.length - 1; i++) { acc += b[i][3]; if (acc >= tot / 2) { cut = i + 1; break; } }
    boxes.splice(bi, 1, b.slice(0, cut), b.slice(cut));
  }
  return boxes.map(b => { let r = 0, g = 0, bl = 0, c = 0; for (const v of b) { r += v[0] * v[3]; g += v[1] * v[3]; bl += v[2] * v[3]; c += v[3]; } return [Math.round(r / c), Math.round(g / c), Math.round(bl / c)]; });
}
function fixedPalette(kind, n) {
  if (kind === 'web') { const p = []; for (let r = 0; r < 6; r++) for (let g = 0; g < 6; g++) for (let b = 0; b < 6; b++) p.push([r * 51, g * 51, b * 51]); return p; }
  if (kind === 'grayscale') return Array.from({ length: n }, (_, i) => { const v = Math.round(i * 255 / Math.max(1, n - 1)); return [v, v, v]; });
  if (kind === 'blackwhite') return [[0, 0, 0], [255, 255, 255]];
  if (kind === 'uniform') { const s = Math.max(2, Math.floor(Math.cbrt(n))), p = []; for (let r = 0; r < s; r++) for (let g = 0; g < s; g++) for (let b = 0; b < s; b++) p.push([r, g, b].map(v => Math.round(v * 255 / (s - 1)))); return p; }
  return null;
}
/**
 * Indexed Color, in place. params: { palette: 'exact'|'adaptive'|'web'|'uniform'|'grayscale'|'blackwhite',
 * colors: 2..256, dither: 'none'|'diffusion', amount: 0..100 (diffusion strength) }.
 * Returns the buffer with `buf.palette` ([[r,g,b]...]) and `buf.indices` (Uint8Array) attached.
 */
export function indexedColor(buf, { palette = 'adaptive', colors = 256, dither = 'diffusion', amount = 75 } = {}) {
  const n = Math.max(2, Math.min(256, colors | 0));
  let pal = fixedPalette(palette, n) || medianCutPalette(buf, palette === 'exact' ? 256 : n);
  if (palette === 'exact' && pal.length > 256) pal = medianCutPalette(buf, 256);
  const { w, h, data: d } = buf, idx = new Uint8Array(w * h), cache = new Map();
  const near = (r, g, b) => {
    const k = (r << 16) | (g << 8) | b; let v = cache.get(k);
    if (v === undefined) { let bd = Infinity; v = 0; for (let i = 0; i < pal.length; i++) { const q = pal[i], e = 2 * (q[0] - r) ** 2 + 4 * (q[1] - g) ** 2 + 3 * (q[2] - b) ** 2; if (e < bd) { bd = e; v = i; } } cache.set(k, v); }
    return v;
  };
  const fs = dither === 'diffusion' ? amount / 100 : 0;
  const err = fs ? new Float32Array((w + 2) * 2 * 3) : null;
  for (let y = 0; y < h; y++) {
    const cur = (y & 1) * (w + 2) * 3, nxt = ((y + 1) & 1) * (w + 2) * 3;
    if (fs) err.fill(0, nxt, nxt + (w + 2) * 3);
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4, e = cur + (x + 1) * 3;
      const r = Math.round(Math.min(255, Math.max(0, d[p] + (fs ? err[e] : 0)))), g = Math.round(Math.min(255, Math.max(0, d[p + 1] + (fs ? err[e + 1] : 0)))), b = Math.round(Math.min(255, Math.max(0, d[p + 2] + (fs ? err[e + 2] : 0))));
      const i = near(r, g, b), q = pal[i];
      idx[y * w + x] = i; d[p] = q[0]; d[p + 1] = q[1]; d[p + 2] = q[2];
      if (fs) for (let c = 0; c < 3; c++) {
        const ev = ([r, g, b][c] - q[c]) * fs;
        err[e + 3 + c] += ev * 7 / 16; err[nxt + x * 3 + c] += ev * 3 / 16; err[nxt + (x + 1) * 3 + c] += ev * 5 / 16; err[nxt + (x + 2) * 3 + c] += ev / 16;
      }
    }
  }
  buf.palette = pal; buf.indices = idx;
  return buf;
}

// ---------- Bitmap ----------
const BAYER8 = (() => { const m = [[0]]; let s = 1; let a = m; while (s < 8) { const b = []; for (let y = 0; y < s * 2; y++) { b.push([]); for (let x = 0; x < s * 2; x++) b[y].push(4 * a[y % s][x % s] + [0, 2, 3, 1][(y >= s) * 2 + (x >= s)]); } a = b; s *= 2; } return a; })();
/**
 * Bitmap (1-bit look, stored as black/white RGBA), in place. Luminance first (sRGB weights on
 * encoded values). params: { method: 'threshold'|'pattern'|'diffusion', threshold: 0..255 }.
 * 'pattern' is an 8×8 Bayer ordered dither; 'diffusion' is Floyd–Steinberg.
 */
export function bitmapMode(buf, { method = 'diffusion', threshold = 128 } = {}) {
  const { w, h, data: d } = buf, g = new Float32Array(w * h);
  for (let i = 0, p = 0; i < g.length; i++, p += 4) g[i] = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, v = g[i];
    const t = method === 'pattern' ? (BAYER8[y & 7][x & 7] + 0.5) * 4 : method === 'diffusion' ? 128 : threshold;
    const o = v >= t ? 255 : 0;
    if (method === 'diffusion') {
      const e = v - o;
      if (x + 1 < w) g[i + 1] += e * 7 / 16;
      if (y + 1 < h) { if (x > 0) g[i + w - 1] += e * 3 / 16; g[i + w] += e * 5 / 16; if (x + 1 < w) g[i + w + 1] += e / 16; }
    }
    const p = i * 4; d[p] = d[p + 1] = d[p + 2] = o;
  }
  return buf;
}

// ---------- Duotone ----------
/**
 * Monotone / duotone, in place. params: { inks: [{ color: '#rrggbb', curve: [[in%, out%]...] }] } (1 or 2 inks).
 * Grayscale value → ink coverage t (0 = white, 1 = solid), mapped through each ink's transfer
 * curve, then the inks are overprinted multiplicatively on white paper. A single black ink with a
 * straight curve reproduces the grayscale image.
 */
export function duotone(buf, { inks = [{ color: '#000000', curve: [[0, 0], [100, 100]] }] } = {}) {
  const d = buf.data, used = inks.slice(0, 2);
  const luts = used.map(ink => {
    const pts = (ink.curve && ink.curve.length ? ink.curve : [[0, 0], [100, 100]]).map(([x, y]) => [x / 100, y / 100]), f = curveFn(pts);
    const col = hexToRgb(ink.color).map(v => v / 255);
    return Array.from({ length: 256 }, (_, g) => { const t = Math.min(1, Math.max(0, f(1 - g / 255))); return col.map(c => 1 - t * (1 - c)); });
  });
  const out = Array.from({ length: 256 }, (_, g) => [0, 1, 2].map(c => Math.round(255 * luts.reduce((a, l) => a * l[g][c], 1))));
  for (let p = 0; p < d.length; p += 4) { const g = Math.round(0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2]), o = out[g]; d[p] = o[0]; d[p + 1] = o[1]; d[p + 2] = o[2]; }
  return buf;
}

/** Monotone cubic (Fritsch–Carlson) curve through [[x,y]] in 0..1, evaluated in float. */
export function curveFn(points) {
  const p = [...points].sort((a, b) => a[0] - b[0]).filter((q, i, a) => i === 0 || q[0] !== a[i - 1][0]);
  if (p.length === 0) return x => x;
  if (p.length === 1) return () => p[0][1];
  const n = p.length, dx = [], m = [], t = [];
  for (let i = 0; i < n - 1; i++) { dx[i] = p[i + 1][0] - p[i][0]; m[i] = (p[i + 1][1] - p[i][1]) / dx[i]; }
  t[0] = m[0]; t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  return x => {
    if (x <= p[0][0]) return p[0][1];
    if (x >= p[n - 1][0]) return p[n - 1][1];
    let i = 0; while (x > p[i + 1][0]) i++;
    const h = dx[i], u = (x - p[i][0]) / h, u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * p[i][1] + (u3 - 2 * u2 + u) * h * t[i] + (-2 * u3 + 3 * u2) * p[i + 1][1] + (u3 - u2) * h * t[i + 1];
  };
}

// ---------- high bit depth ----------
// Container: { w, h, depth: 16 | 32, data: Uint16Array | Float32Array } (RGBA, straight alpha).
//  16-bit: encoded values (same TRC as the 8-bit document), 0..65535 (8-bit v ↦ v × 257).
//  32-bit: LINEAR light floats (sRGB TRC removed), unbounded above 1, alpha 0..1 — like Photoshop.

const s2l = e => (e <= 0.04045 ? e / 12.92 : ((e + 0.055) / 1.055) ** 2.4);
const l2s = l => (l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055);

/** 8-bit buffer → 16- or 32-bit image. */
export function toHighBit(buf, depth = 16) {
  const n = buf.w * buf.h * 4, d = buf.data;
  if (depth === 16) { const o = new Uint16Array(n); for (let i = 0; i < n; i++) o[i] = d[i] * 257; return { w: buf.w, h: buf.h, depth: 16, data: o }; }
  const o = new Float32Array(n), lin = Float32Array.from({ length: 256 }, (_, i) => s2l(i / 255));
  for (let i = 0; i < n; i += 4) { o[i] = lin[d[i]]; o[i + 1] = lin[d[i + 1]]; o[i + 2] = lin[d[i + 2]]; o[i + 3] = d[i + 3] / 255; }
  return { w: buf.w, h: buf.h, depth: 32, data: o };
}
/**
 * High-bit image → 8-bit buffer. 16-bit: rounds (dither: adds ±0.5 LSB ordered noise first, which
 * removes banding in smooth gradients). 32-bit: clips linear values to 0..1 and applies the sRGB
 * curve (use toneMap() for a real HDR → LDR conversion).
 */
export function toEightBit(img, { dither = true } = {}) {
  const n = img.w * img.h * 4, o = new Uint8ClampedArray(n), d = img.data, w = img.w;
  for (let i = 0; i < n; i++) {
    const px = (i >> 2), x = px % w, y = (px / w) | 0, t = dither && (i & 3) !== 3 ? BAYER4[(y & 3) * 4 + (x & 3)] : 0;
    let v;
    if (img.depth === 16) v = d[i] / 257;
    else v = (i & 3) === 3 ? Math.min(1, Math.max(0, d[i])) * 255 : l2s(Math.min(1, Math.max(0, d[i]))) * 255;
    o[i] = Math.round(v + t);
  }
  return { w: img.w, h: img.h, data: o };
}
/** 16 ↔ 32 conversion. */
export function convertDepth(img, depth) {
  if (img.depth === depth) return img;
  const n = img.w * img.h * 4, d = img.data;
  if (depth === 32) { const o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = (i & 3) === 3 ? d[i] / 65535 : s2l(d[i] / 65535); return { w: img.w, h: img.h, depth: 32, data: o }; }
  const o = new Uint16Array(n); for (let i = 0; i < n; i++) o[i] = Math.round(65535 * Math.min(1, Math.max(0, (i & 3) === 3 ? d[i] : l2s(Math.min(1, Math.max(0, d[i]))))));
  return { w: img.w, h: img.h, depth: 16, data: o };
}

// Float working view: 16-bit → encoded 0..1; 32-bit → linear (unbounded).
const getF = img => (img.depth === 16 ? Float32Array.from(img.data, v => v / 65535) : Float32Array.from(img.data));
function putF(img, f) {
  if (img.depth === 16) for (let i = 0; i < f.length; i++) img.data[i] = Math.round(65535 * Math.min(1, Math.max(0, f[i])));
  else img.data.set(f);
  return img;
}
/** Apply per-channel float function f(v) (on encoded 0..1 values) to RGB. For 32-bit, f sees sRGB-encoded values; >1 is kept above 1 through an extended curve. */
function mapEncoded(img, f) {
  const a = getF(img), lin = img.depth === 32;
  for (let i = 0; i < a.length; i++) {
    if ((i & 3) === 3) continue;
    if (lin) { const v = a[i]; a[i] = v <= 1 ? s2l(Math.max(0, f(l2s(Math.max(0, v))))) : v * s2l(f(1)); }
    else a[i] = f(a[i]);
  }
  return putF(img, a);
}
/** Levels at high precision; same parameters as adjust.js levels (0..255 scale). */
export function levelsHigh(img, { inBlack = 0, inWhite = 255, gamma = 1, outBlack = 0, outWhite = 255 } = {}) {
  const span = Math.max(1e-3, inWhite - inBlack);
  return mapEncoded(img, v => { const x = Math.min(1, Math.max(0, (v * 255 - inBlack) / span)); return (outBlack + (outWhite - outBlack) * x ** (1 / gamma)) / 255; });
}
/** Curves at high precision; points like adjust.js: { rgb: [[x,y]...] } in 0..255. */
export function curvesHigh(img, { points = {} } = {}) {
  const f = curveFn((points.rgb || [[0, 0], [255, 255]]).map(([x, y]) => [x / 255, y / 255]));
  return mapEncoded(img, f);
}
/** Exposure (stops), offset and gamma correction in linear light, like adjust.js exposure. */
export function exposureHigh(img, { exposure: ev = 0, offset = 0, gamma = 1 } = {}) {
  const a = getF(img), k = 2 ** ev, lin = img.depth === 32;
  for (let i = 0; i < a.length; i++) {
    if ((i & 3) === 3) continue;
    const l = Math.max(0, (lin ? a[i] : s2l(a[i])) * k + offset) ** (1 / gamma);
    a[i] = lin ? l : l2s(Math.min(1, l));
  }
  return putF(img, a);
}
/** Gaussian blur (true separable kernel, σ = radius, premultiplied alpha) at float precision. */
export function gaussianBlurHigh(img, { radius = 4 } = {}) {
  const { w, h } = img, a = getF(img), s = Math.max(0.01, radius), R = Math.ceil(s * 3);
  const k = Float32Array.from({ length: 2 * R + 1 }, (_, i) => Math.exp(-((i - R) ** 2) / (2 * s * s))), ks = k.reduce((x, y) => x + y, 0);
  for (let i = 0; i < k.length; i++) k[i] /= ks;
  for (let i = 0; i < a.length; i += 4) { a[i] *= a[i + 3]; a[i + 1] *= a[i + 3]; a[i + 2] *= a[i + 3]; }
  const t = new Float32Array(a.length);
  const pass = (src, dst, horiz) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, al = 0;
      for (let j = -R; j <= R; j++) {
        const xx = horiz ? Math.min(w - 1, Math.max(0, x + j)) : x, yy = horiz ? y : Math.min(h - 1, Math.max(0, y + j)), p = (yy * w + xx) * 4, kv = k[j + R];
        r += src[p] * kv; g += src[p + 1] * kv; b += src[p + 2] * kv; al += src[p + 3] * kv;
      }
      const p = (y * w + x) * 4; dst[p] = r; dst[p + 1] = g; dst[p + 2] = b; dst[p + 3] = al;
    }
  };
  pass(a, t, true); pass(t, a, false);
  for (let i = 0; i < a.length; i += 4) { const al = a[i + 3]; if (al > 1e-8) { a[i] /= al; a[i + 1] /= al; a[i + 2] /= al; } }
  return putF(img, a);
}

// ---------- HDR toning ----------
function boxMean(src, w, h, r) { // O(N) box filter with clamped window (integral image)
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += src[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row; } }
  const o = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      o[y * w + x] = (I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0]) / ((x1 - x0) * (y1 - y0));
    }
  }
  return o;
}
/** Self-guided filter (He et al.): edge-aware smoothing of p with radius r and regulariser eps. */
export function guidedFilter(p, w, h, r, eps) {
  const n = p.length, pp = new Float32Array(n);
  for (let i = 0; i < n; i++) pp[i] = p[i] * p[i];
  const m = boxMean(p, w, h, r), m2 = boxMean(pp, w, h, r), A = new Float32Array(n), B = new Float32Array(n);
  for (let i = 0; i < n; i++) { const v = m2[i] - m[i] * m[i], a = v / (v + eps); A[i] = a; B[i] = m[i] - a * m[i]; }
  const mA = boxMean(A, w, h, r), mB = boxMean(B, w, h, r), q = new Float32Array(n);
  for (let i = 0; i < n; i++) q[i] = mA[i] * p[i] + mB[i];
  return q;
}

/**
 * HDR Toning: 32-bit linear image (or any high-bit/8-bit image, converted first) → 8-bit buffer.
 * params:
 *  method 'exposureGamma': out = sRGB((lin · 2^exposure)^(1/gamma)).
 *  method 'equalize': histogram equalisation of log luminance (2048 bins), colour ratios kept.
 *  method 'local': log-luminance is split into an edge-aware base (guided filter, `radius` px,
 *    `edgeSmoothness` regulariser) and detail. The base range is compressed by `strength`
 *    (0..1, 1 = strongest), detail is scaled by `detail` (%), then exposure, gamma and
 *    `saturation` (%) are applied. This is local adaptation in the Durand–Dorsey style.
 */
export function toneMap(img, { method = 'local', exposure = 0, gamma = 1, radius = 16, strength = 0.6, detail = 100, saturation = 100, edgeSmoothness = 0.02 } = {}) {
  if (!img.depth) img = toHighBit(img, 32);
  else if (img.depth === 16) img = convertDepth(img, 32);
  const { w, h, data: d } = img, n = w * h, out = new Uint8ClampedArray(n * 4), k = 2 ** exposure, ig = 1 / Math.max(0.05, gamma);
  const Y = new Float32Array(n);
  for (let i = 0; i < n; i++) Y[i] = Math.max(1e-6, 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]);
  let Yout;
  if (method === 'exposureGamma') Yout = null;
  else if (method === 'equalize') {
    const lg = Y.map(v => Math.log2(v)); let lo = Infinity, hi = -Infinity;
    for (const v of lg) { if (v < lo) lo = v; if (v > hi) hi = v; }
    const B = 2048, hist = new Float64Array(B), span = Math.max(1e-6, hi - lo), bin = v => Math.min(B - 1, ((v - lo) / span * B) | 0);
    for (const v of lg) hist[bin(v)]++;
    for (let i = 1; i < B; i++) hist[i] += hist[i - 1];
    Yout = new Float32Array(n);
    for (let i = 0; i < n; i++) Yout[i] = s2l(hist[bin(lg[i])] / n); // equalised in perceptual (sRGB-encoded) space
  } else {
    const lg = Y.map(v => Math.log10(v)), base = guidedFilter(lg, w, h, Math.max(1, Math.round(radius)), edgeSmoothness);
    let bmax = -Infinity, bmin = Infinity; for (const v of base) { if (v > bmax) bmax = v; if (v < bmin) bmin = v; }
    const range = Math.max(1e-6, bmax - bmin), target = 2.4 - 1.6 * Math.min(1, Math.max(0, strength)); // output base range in log10 units (2.4 ≈ 8 stops)
    const c = Math.min(1, target / range), dk = detail / 100;
    Yout = new Float32Array(n);
    for (let i = 0; i < n; i++) Yout[i] = 10 ** ((base[i] - bmax) * c + (lg[i] - base[i]) * dk);
  }
  const sat = saturation / 100;
  for (let i = 0; i < n; i++) {
    const p = i * 4, ratio = Yout ? Yout[i] / Y[i] : 1;
    for (let c = 0; c < 3; c++) {
      let v = Yout ? Yout[i] * Math.max(0, d[p + c] / Y[i]) ** sat : d[p + c] * ratio;
      v = Math.max(0, v * k) ** ig;
      out[p + c] = Math.round(l2s(Math.min(1, v)) * 255);
    }
    out[p + 3] = Math.round(Math.min(1, Math.max(0, d[p + 3])) * 255);
  }
  return { w, h, data: out };
}

// ---------- registry-style ops: (buf, params, ctx) => buf ----------
export const opConvertProfile = (buf, { from = 'sRGB IEC61966-2.1', to = 'sRGB IEC61966-2.1', intent = 'relative', bpc = true, dither = false } = {}) => convertBuffer(buf, from, to, intent, { bpc, dither });
export const opGrayscale = (buf, { space = 'sRGB IEC61966-2.1', gray = 'sGray', method = 'luminance' } = {}) => rgbToGrayscale(buf, { space, gray, method });
export const opIndexed = (buf, p = {}) => { const r = indexedColor(buf, p); delete r.indices; delete r.palette; return r; };
export const opBitmap = (buf, p = {}) => bitmapMode(rgbToGrayscale(buf, {}), p);
export const opDuotone = (buf, p = {}) => duotone(buf, p);
/** CMYK round trip (what converting to CMYK mode does to the RGB-displayed pixels). */
export const opCmykRoundTrip = (buf, { space = 'sRGB IEC61966-2.1', model = {}, intent = 'relative', bpc = true } = {}) => {
  const r = cmykToRgb(rgbToCmyk(buf, { space, model, intent, bpc }), { space, model, intent: 'relative', bpc });
  buf.data.set(r.data); return buf;
};
export const opLabRoundTrip = (buf, { space = 'sRGB IEC61966-2.1' } = {}) => labToRgbBuffer(rgbToLabBuffer(buf, space), space);
