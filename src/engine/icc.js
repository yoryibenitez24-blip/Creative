// ICC profile reading and writing (pure JS, no DOM).
//
// parseIcc(bytes) reads ICC v2 and v4 profiles: the header, the tag table, the description
// (v2 'desc' or v4 'mluc'), wtpt, chad, rXYZ/gXYZ/bXYZ, rTRC/gTRC/bTRC/kTRC as 'curv'
// (identity, gamma or table) or 'para' (all five ICC function types). Matrix/TRC RGB profiles
// and gray TRC profiles can be used for conversion (profileToSpace in colormgmt.js). LUT-based
// profiles (A2B0/B2A0 with mft1, mft2, mAB or mBA, which covers every CMYK profile) are parsed
// for their description only and reported honestly with `convertible: false` and a reason.
//
// buildIccProfile(name) writes a real ICC v2.1 display profile (matrix/TRC) for the built-in
// RGB spaces so exports can embed them (PNG iCCP, JPEG APP2, PSD).

export const D50_ICC = [0.9642, 1.0, 0.8249]; // ICC PCS illuminant (s15Fixed16 0xF6D6, 0x10000, 0xD32D)

const sig = (dv, o) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
const s15 = (dv, o) => dv.getInt32(o) / 65536;
const xyzAt = (dv, o) => [s15(dv, o), s15(dv, o + 4), s15(dv, o + 8)];

/** Evaluate a parametric curve ('para') of ICC function type 0..4 for x in 0..1. */
export function paraEval(type, p, x) {
  const [g, a = 1, b = 0, c = 0, d = 0, e = 0, f = 0] = p;
  const pw = v => (v > 0 ? v ** g : 0);
  switch (type) {
    case 0: return pw(x);
    case 1: return x >= -b / a ? pw(a * x + b) : 0;
    case 2: return x >= -b / a ? pw(a * x + b) + c : c;
    case 3: return x >= d ? pw(a * x + b) : c * x;
    case 4: return x >= d ? pw(a * x + b) + e : c * x + f;
    default: throw new Error('Unknown parametric curve type ' + type);
  }
}

/** A tone curve as { kind, decode(x) → linear, ... }; tables are linearly interpolated. */
function readCurve(dv, o, size) {
  const t = sig(dv, o);
  if (t === 'curv') {
    const n = dv.getUint32(o + 8);
    if (n === 0) return { kind: 'gamma', gamma: 1 };
    if (n === 1) return { kind: 'gamma', gamma: dv.getUint16(o + 12) / 256 };
    const table = new Float32Array(n);
    for (let i = 0; i < n; i++) table[i] = dv.getUint16(o + 12 + i * 2) / 65535;
    return { kind: 'table', table };
  }
  if (t === 'para') {
    const type = dv.getUint16(o + 8), count = [1, 3, 4, 5, 7][type];
    if (count === undefined) throw new Error('Unknown parametric curve type ' + type);
    const params = [];
    for (let i = 0; i < count; i++) params.push(s15(dv, o + 12 + i * 4));
    return { kind: 'para', type, params };
  }
  throw new Error(`Unsupported curve type '${t}'`);
}

/** Turn a parsed curve into a decode function (encoded 0..1 → linear 0..1). */
export function curveToFunction(c) {
  if (c.kind === 'gamma') return x => (x <= 0 ? 0 : x ** c.gamma);
  if (c.kind === 'para') return x => paraEval(c.type, c.params, x);
  const t = c.table, n = t.length - 1;
  return x => { const f = Math.min(n, Math.max(0, x * n)), i = Math.min(n - 1, f | 0), u = f - i; return t[i] + (t[i + 1] - t[i]) * u; };
}

function readText(dv, o, size) {
  const t = sig(dv, o);
  if (t === 'desc') { // v2 textDescriptionType: ASCII count + string
    const n = dv.getUint32(o + 8); let s = '';
    for (let i = 0; i < n && o + 12 + i < dv.byteLength; i++) { const ch = dv.getUint8(o + 12 + i); if (!ch) break; s += String.fromCharCode(ch); }
    return s;
  }
  if (t === 'mluc') { // v4 multiLocalizedUnicodeType: prefer en-US, else first record
    const n = dv.getUint32(o + 8), rs = dv.getUint32(o + 12);
    let pick = null;
    for (let i = 0; i < n; i++) {
      const r = o + 16 + i * rs, lang = String.fromCharCode(dv.getUint8(r), dv.getUint8(r + 1)), ctry = String.fromCharCode(dv.getUint8(r + 2), dv.getUint8(r + 3));
      const rec = { len: dv.getUint32(r + 4), off: dv.getUint32(r + 8) };
      if (!pick || (lang === 'en' && (ctry === 'US' || pick.lang !== 'en'))) pick = { ...rec, lang };
    }
    if (!pick) return '';
    let s = '';
    for (let i = 0; i + 1 < pick.len; i += 2) s += String.fromCharCode(dv.getUint16(o + pick.off + i));
    return s.replace(/\0+$/, '');
  }
  if (t === 'text') { let s = ''; for (let i = 8; i < size; i++) { const ch = dv.getUint8(o + i); if (!ch) break; s += String.fromCharCode(ch); } return s; }
  return '';
}

/**
 * Parse ICC profile bytes. Returns
 * { version, deviceClass, colorSpace, pcs, intent, illuminant, description, copyright,
 *   tags: [{sig, offset, size}], whitePoint, chad, rXYZ, gXYZ, bXYZ, trc: {r,g,b}|{k},
 *   kind: 'rgb-matrix'|'gray-trc'|'lut', convertible, reason, bytes }
 * Throws on bytes that are not an ICC profile.
 */
export function parseIcc(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < 132) throw new Error('Not an ICC profile: file is too short.');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (sig(dv, 36) !== 'acsp') throw new Error("Not an ICC profile: missing 'acsp' signature.");
  const maj = dv.getUint8(8), min = dv.getUint8(9);
  const p = {
    size: dv.getUint32(0), version: `${maj}.${min >> 4}.${min & 15}`, major: maj,
    deviceClass: sig(dv, 12), colorSpace: sig(dv, 16).trim(), pcs: sig(dv, 20).trim(),
    intent: dv.getUint32(64), illuminant: xyzAt(dv, 68), creator: sig(dv, 80), tags: [], bytes,
  };
  const count = dv.getUint32(128);
  if (132 + count * 12 > bytes.length) throw new Error('Damaged ICC profile: tag table is truncated.');
  const tag = {};
  for (let i = 0; i < count; i++) {
    const b = 132 + i * 12, t = { sig: sig(dv, b), offset: dv.getUint32(b + 4), size: dv.getUint32(b + 8) };
    if (t.offset + t.size > bytes.length) throw new Error(`Damaged ICC profile: tag '${t.sig}' points outside the file.`);
    p.tags.push(t); tag[t.sig] = t;
  }
  const at = s => tag[s] && tag[s].offset;
  p.description = tag.desc ? readText(dv, at('desc'), tag.desc.size) : '';
  p.copyright = tag.cprt ? readText(dv, at('cprt'), tag.cprt.size) : '';
  if (tag.wtpt) p.whitePoint = xyzAt(dv, at('wtpt') + 8);
  if (tag.bkpt) p.blackPoint = xyzAt(dv, at('bkpt') + 8);
  if (tag.chad) { const o = at('chad') + 8; p.chad = [0, 1, 2].map(r => [0, 1, 2].map(c => s15(dv, o + (r * 3 + c) * 4))); }
  const hasLut = ['A2B0', 'A2B1', 'B2A0'].some(s => tag[s]);
  try {
    if (p.colorSpace === 'RGB' && tag.rXYZ && tag.gXYZ && tag.bXYZ && tag.rTRC && tag.gTRC && tag.bTRC) {
      p.rXYZ = xyzAt(dv, at('rXYZ') + 8); p.gXYZ = xyzAt(dv, at('gXYZ') + 8); p.bXYZ = xyzAt(dv, at('bXYZ') + 8);
      p.trc = { r: readCurve(dv, at('rTRC'), tag.rTRC.size), g: readCurve(dv, at('gTRC'), tag.gTRC.size), b: readCurve(dv, at('bTRC'), tag.bTRC.size) };
      p.kind = 'rgb-matrix';
    } else if (p.colorSpace === 'GRAY' && tag.kTRC) {
      p.trc = { k: readCurve(dv, at('kTRC'), tag.kTRC.size) };
      p.kind = 'gray-trc';
    } else p.kind = hasLut ? 'lut' : 'unknown';
  } catch (e) { p.kind = 'unknown'; p.reason = e.message; }
  if (p.pcs !== 'XYZ' && p.pcs !== 'Lab') { p.kind = 'unknown'; p.reason = 'Device link and abstract profiles cannot be used as document profiles.'; }
  p.convertible = p.kind === 'rgb-matrix' || p.kind === 'gray-trc';
  if (!p.convertible && !p.reason) p.reason = p.kind === 'lut'
    ? `"${p.description || 'This profile'}" is a LUT-based ${p.colorSpace} profile. Zertake can read its description but cannot convert colours with LUT-based profiles; only matrix/TRC RGB and gray profiles are supported.`
    : `"${p.description || 'This profile'}" (${p.colorSpace}) has no matrix/TRC or gray TRC tags that Zertake can use for conversion.`;
  return p;
}

// ---------- writing ----------

class W {
  constructor() { this.a = []; }
  u8(v) { this.a.push(v & 255); return this; }
  u16(v) { return this.u8(v >> 8).u8(v); }
  u32(v) { return this.u16(v >>> 16).u16(v & 0xffff); }
  s15(v) { return this.u32(Math.round(v * 65536) | 0); }
  str(s) { for (const c of s) this.u8(c.charCodeAt(0)); return this; }
  pad() { while (this.a.length % 4) this.u8(0); return this; }
  bytes() { return Uint8Array.from(this.a); }
}
const xyzTag = v => new W().str('XYZ ').u32(0).s15(v[0]).s15(v[1]).s15(v[2]).bytes();
const textTag = s => new W().str('text').u32(0).str(s).u8(0).pad().bytes();
function descTag(s) { // v2 textDescriptionType with empty Unicode and ScriptCode parts
  const w = new W().str('desc').u32(0).u32(s.length + 1).str(s).u8(0).u32(0).u32(0).u16(0).u8(0);
  for (let i = 0; i < 67; i++) w.u8(0);
  return w.pad().bytes();
}
function curvTag(trc) {
  const w = new W().str('curv').u32(0);
  if (trc.icc.type === 'gamma') return w.u32(1).u16(Math.round(trc.icc.gamma * 256)).pad().bytes();
  const n = 1024; w.u32(n);
  for (let i = 0; i < n; i++) w.u16(Math.round(Math.min(1, Math.max(0, trc.decode(i / (n - 1)))) * 65535));
  return w.pad().bytes();
}

/**
 * Build ICC v2.1 matrix/TRC display profile bytes for a built-in RGB space (or any space object
 * from colormgmt.js with toPCS, white and trc). wtpt is the space's native media white (v2
 * convention); the colorants are Bradford-adapted to D50.
 * @param {string|object} nameOrSpace e.g. 'sRGB IEC61966-2.1', 'Display P3', 'Adobe RGB (1998)', 'ProPhoto RGB'
 * @param {(name:string)=>object} getSpace resolver from colormgmt.js (passed in to avoid a cycle)
 */
export function buildIccProfile(nameOrSpace, getSpace) {
  const sp = typeof nameOrSpace === 'string' ? getSpace(nameOrSpace) : nameOrSpace;
  if (!sp || sp.kind !== 'rgb') throw new Error('Only RGB matrix spaces can be written as ICC profiles.');
  const M = sp.toPCS, col = j => [M[0][j], M[1][j], M[2][j]];
  const tags = [
    ['desc', descTag(sp.name)],
    ['cprt', textTag('No copyright, use freely. Generated by Zertake Studio.')],
    ['wtpt', xyzTag(sp.whiteXYZ)],
    ['rXYZ', xyzTag(col(0))], ['gXYZ', xyzTag(col(1))], ['bXYZ', xyzTag(col(2))],
    ['rTRC', curvTag(sp.trc)],
  ];
  const shared = { gTRC: 'rTRC', bTRC: 'rTRC' }; // identical curves share one data block (allowed by ICC)
  const allSigs = [...tags.map(t => t[0]), 'gTRC', 'bTRC'];
  const tableEnd = 128 + 4 + allSigs.length * 12;
  let off = tableEnd; const offs = {};
  for (const [s, b] of tags) { offs[s] = [off, b.length]; off += b.length; }
  const size = off;
  const w = new W();
  const now = new Date(Date.UTC(2026, 0, 1)); // fixed date keeps the bytes deterministic
  w.u32(size).u32(0).u32(0x02100000).str('mntr').str('RGB ').str('XYZ ')
    .u16(now.getUTCFullYear()).u16(now.getUTCMonth() + 1).u16(now.getUTCDate()).u16(0).u16(0).u16(0)
    .str('acsp').u32(0).u32(0).u32(0).u32(0).u32(0).u32(0).u32(0).s15(D50_ICC[0]).s15(D50_ICC[1]).s15(D50_ICC[2]).str('ZRTK');
  while (w.a.length < 128) w.u8(0);
  w.u32(allSigs.length);
  for (const s of allSigs) { const [o, l] = offs[shared[s] || s]; w.str(s).u32(o).u32(l); }
  for (const [, b] of tags) for (const x of b) w.u8(x);
  return w.bytes();
}
