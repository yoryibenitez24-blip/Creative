// 16-bit PNG writer and ICC embedding for PNG and JPEG (pure JS, no DOM).
//
// Deflate is injected so the same code runs in the browser/worker (CompressionStream) and in
// Node (zlib). deflateFn(bytes: Uint8Array) → Uint8Array | Promise<Uint8Array> must return a
// zlib-wrapped stream (RFC 1950), which is what both CompressionStream('deflate') and
// zlib.deflateSync produce, and what PNG IDAT and iCCP require.

const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
/** CRC-32 (ISO 3309 / PNG). */
export function crc32(bytes, crc = 0) {
  let c = ~crc >>> 0;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return ~c >>> 0;
}

/** Deflate using the platform CompressionStream (browsers, workers, Node ≥ 18). */
export async function streamDeflate(bytes) {
  const s = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];
const ascii = s => Uint8Array.from(s, c => c.charCodeAt(0) & 255);
function chunk(type, data) {
  const out = new Uint8Array(12 + data.length), dv = new DataView(out.buffer);
  dv.setUint32(0, data.length); out.set(ascii(type), 4); out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
const concat = parts => { const n = parts.reduce((a, p) => a + p.length, 0), o = new Uint8Array(n); let k = 0; for (const p of parts) { o.set(p, k); k += p.length; } return o; };

/** iCCP chunk payload: profile name (Latin-1, 1..79 chars), NUL, compression method 0, zlib data. */
async function iccpChunk(iccBytes, name, deflateFn) {
  const nm = String(name || 'ICC Profile').replace(/[^\x20-\x7e]/g, '').trim().slice(0, 79) || 'ICC Profile';
  return chunk('iCCP', concat([ascii(nm), new Uint8Array([0, 0]), await deflateFn(iccBytes)]));
}

/**
 * Encode a 16-bit RGBA image as PNG (colour type 6, bit depth 16, filter: Up per row).
 * @param img16 { w, h, data: Uint16Array (RGBA, 0..65535) }
 * @param deflateFn see module comment
 * @param opts { icc?: Uint8Array, iccName?: string }
 * @returns Promise<Uint8Array>
 */
export async function encodePng16(img16, deflateFn = streamDeflate, { icc, iccName } = {}) {
  const { w, h, data } = img16;
  if (!(data instanceof Uint16Array) || data.length !== w * h * 4) throw new Error('encodePng16 expects { w, h, data: Uint16Array(w*h*4) }.');
  const ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 16; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const stride = w * 8, raw = new Uint8Array((stride + 1) * h);
  const row = new Uint8Array(stride), prev = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    for (let i = 0, s = y * w * 4; i < w * 4; i++) { const v = data[s + i]; row[i * 2] = v >> 8; row[i * 2 + 1] = v & 255; }
    const o = y * (stride + 1);
    raw[o] = 2; // Up filter: good for smooth 16-bit gradients, trivially reversible
    for (let i = 0; i < stride; i++) raw[o + 1 + i] = (row[i] - prev[i]) & 255;
    prev.set(row);
  }
  const parts = [new Uint8Array(PNG_SIG), chunk('IHDR', ihdr)];
  if (icc) parts.push(await iccpChunk(icc, iccName, deflateFn));
  parts.push(chunk('IDAT', await deflateFn(raw)), chunk('IEND', new Uint8Array(0)));
  return concat(parts);
}

/** Split a PNG into chunks [{ type, data }]. Throws on bad signature or CRC. */
export function readPngChunks(png) {
  for (let i = 0; i < 8; i++) if (png[i] !== PNG_SIG[i]) throw new Error('Not a PNG file.');
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength), out = [];
  for (let o = 8; o < png.length;) {
    const len = dv.getUint32(o), type = String.fromCharCode(...png.subarray(o + 4, o + 8));
    if (o + 12 + len > png.length) throw new Error('Truncated PNG chunk ' + type);
    const data = png.subarray(o + 8, o + 8 + len);
    if (crc32(png.subarray(o + 4, o + 8 + len)) !== dv.getUint32(o + 8 + len)) throw new Error('Bad CRC in PNG chunk ' + type);
    out.push({ type, data }); o += 12 + len;
    if (type === 'IEND') break;
  }
  return out;
}

/**
 * Insert an iCCP chunk into an existing PNG (any bit depth) right after IHDR. Existing iCCP,
 * sRGB, gAMA and cHRM chunks are removed (the PNG spec gives iCCP precedence and forbids iCCP
 * together with sRGB). Returns Promise<Uint8Array>.
 */
export async function embedIccInPng8(pngBytes, iccBytes, deflateFn = streamDeflate, iccName = 'ICC Profile') {
  const chunks = readPngChunks(pngBytes);
  const parts = [new Uint8Array(PNG_SIG)];
  for (const c of chunks) {
    if (['iCCP', 'sRGB', 'gAMA', 'cHRM'].includes(c.type)) continue;
    parts.push(chunk(c.type, c.data));
    if (c.type === 'IHDR') parts.push(await iccpChunk(iccBytes, iccName, deflateFn));
  }
  return concat(parts);
}

/**
 * Embed an ICC profile in a JPEG as APP2 "ICC_PROFILE" segments (max 65519 profile bytes each,
 * 1-based sequence numbers). Inserted after SOI and any APP0/APP1 (JFIF/Exif); existing ICC
 * APP2 segments are removed. Synchronous; returns Uint8Array.
 */
export function embedIccInJpeg(jpegBytes, iccBytes) {
  const j = jpegBytes;
  if (j[0] !== 0xff || j[1] !== 0xd8) throw new Error('Not a JPEG file.');
  const MAX = 65519, n = Math.ceil(iccBytes.length / MAX);
  if (n > 255) throw new Error('ICC profile is too large for JPEG embedding.');
  const segs = [];
  for (let i = 0; i < n; i++) {
    const part = iccBytes.subarray(i * MAX, Math.min(iccBytes.length, (i + 1) * MAX)), len = 2 + 12 + 2 + part.length;
    const s = new Uint8Array(2 + len);
    s[0] = 0xff; s[1] = 0xe2; s[2] = len >> 8; s[3] = len & 255;
    s.set(ascii('ICC_PROFILE'), 4); s[15] = 0; s[16] = i + 1; s[17] = n; s.set(part, 18);
    segs.push(s);
  }
  const keep = [j.subarray(0, 2)];
  let o = 2, inserted = false;
  while (o + 4 <= j.length && j[o] === 0xff) {
    const m = j[o + 1];
    if (m === 0xd9 || m === 0xda) break; // EOI / start of scan: the rest is entropy-coded data
    if (m >= 0xd0 && m <= 0xd7 || m === 0x01) { keep.push(j.subarray(o, o + 2)); o += 2; continue; }
    const len = (j[o + 2] << 8) | j[o + 3], seg = j.subarray(o, o + 2 + len);
    if (!inserted && m !== 0xe0 && m !== 0xe1) { keep.push(...segs); inserted = true; }
    const isIcc = m === 0xe2 && len >= 16 && String.fromCharCode(...seg.subarray(4, 15)) === 'ICC_PROFILE';
    if (!isIcc) keep.push(seg);
    o += 2 + len;
  }
  if (!inserted) keep.push(...segs);
  keep.push(j.subarray(o));
  return concat(keep);
}

/** Read an embedded ICC profile back out of a JPEG (joins APP2 segments in sequence), or null. */
export function extractIccFromJpeg(j) {
  const parts = []; let o = 2;
  while (o + 4 <= j.length && j[o] === 0xff) {
    const m = j[o + 1]; if (m === 0xda || m === 0xd9) break;
    const len = (j[o + 2] << 8) | j[o + 3];
    if (m === 0xe2 && String.fromCharCode(...j.subarray(o + 4, o + 15)) === 'ICC_PROFILE') parts[j[o + 16] - 1] = j.subarray(o + 18, o + 2 + len);
    o += 2 + len;
  }
  return parts.length && parts.every(Boolean) ? concat(parts) : null;
}
