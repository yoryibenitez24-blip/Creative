// Minimal store-only (method 0, no compression) ZIP writer with CRC-32.
// Images are already compressed (JPEG/PNG/WebP), so storing them is both fast and as small as
// deflating would be. Pure JS: runs in the browser, in workers and in Node.
//
//   createZip([{ name: 'a.jpg', data: Uint8Array, date?: Date }]) → Uint8Array (a complete .zip)
//
// Limits: ZIP32 only (each file and the whole archive < 4 GiB, < 65 535 entries). Names are
// stored as UTF-8 with general-purpose flag bit 11 set.

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();

/** CRC-32 (IEEE 802.3, as used by ZIP and gzip) of a byte array. `prev` continues a running CRC. */
export function crc32(bytes, prev = 0) {
  let c = (prev ^ 0xffffffff) >>> 0;
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** MS-DOS date/time words for a JS Date (local time, 2-second resolution, years 1980–2107). */
export function dosDateTime(d = new Date()) {
  const y = Math.min(2107, Math.max(1980, d.getFullYear()));
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}

/**
 * Build a store-only ZIP archive.
 * @param {{name:string, data:Uint8Array|ArrayBuffer, date?:Date}[]} files
 * @returns {Uint8Array}
 */
export function createZip(files) {
  const enc = new TextEncoder(), entries = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(String(f.name).replace(/\\/g, '/').replace(/^\/+/, ''));
    const data = f.data instanceof Uint8Array ? f.data : new Uint8Array(f.data);
    const { time, date } = dosDateTime(f.date || new Date());
    const e = { name, data, crc: crc32(data), time, date, offset };
    entries.push(e);
    offset += 30 + name.length + data.length;
  }
  const cdSize = entries.reduce((s, e) => s + 46 + e.name.length, 0);
  if (offset + cdSize + 22 > 0xffffffff || entries.length > 0xffff) throw Error('The archive is too large for a ZIP32 file');
  const out = new Uint8Array(offset + cdSize + 22), v = new DataView(out.buffer);
  let p = 0;
  const u16 = x => { v.setUint16(p, x, true); p += 2; }, u32 = x => { v.setUint32(p, x >>> 0, true); p += 4; };
  for (const e of entries) {
    u32(0x04034b50); u16(20); u16(0x0800); u16(0); u16(e.time); u16(e.date);
    u32(e.crc); u32(e.data.length); u32(e.data.length); u16(e.name.length); u16(0);
    out.set(e.name, p); p += e.name.length; out.set(e.data, p); p += e.data.length;
  }
  const cdStart = p;
  for (const e of entries) {
    u32(0x02014b50); u16(20); u16(20); u16(0x0800); u16(0); u16(e.time); u16(e.date);
    u32(e.crc); u32(e.data.length); u32(e.data.length); u16(e.name.length); u16(0); u16(0); u16(0); u16(0); u32(0); u32(e.offset);
    out.set(e.name, p); p += e.name.length;
  }
  u32(0x06054b50); u16(0); u16(0); u16(entries.length); u16(entries.length); u32(p - cdStart); u32(cdStart); u16(0);
  return out;
}

/**
 * Read a store-only ZIP (as written by createZip) back into [{name, data}], verifying every CRC.
 * Used by tests and to re-open exported archives; deflated entries are rejected.
 */
export function readZip(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), dec = new TextDecoder();
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 0xffff); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw Error('Not a ZIP file');
  const n = v.getUint16(eocd + 10, true); let p = v.getUint32(eocd + 16, true);
  const out = [];
  for (let k = 0; k < n; k++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw Error('Bad central directory');
    const method = v.getUint16(p + 10, true), crc = v.getUint32(p + 16, true), size = v.getUint32(p + 20, true), nl = v.getUint16(p + 28, true), xl = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true), off = v.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nl));
    if (method !== 0) throw Error('Compressed entries are not supported: ' + name);
    const lnl = v.getUint16(off + 26, true), lxl = v.getUint16(off + 28, true), data = u8.slice(off + 30 + lnl + lxl, off + 30 + lnl + lxl + size);
    if (crc32(data) !== crc) throw Error('CRC mismatch in ' + name);
    out.push({ name, data });
    p += 46 + nl + xl + cl;
  }
  return out;
}
