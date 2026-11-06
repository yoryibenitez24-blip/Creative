import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import * as CM from '../src/engine/colormgmt.js';
import { parseIcc, paraEval } from '../src/engine/icc.js';
import { encodePng16, embedIccInPng8, embedIccInJpeg, extractIccFromJpeg, readPngChunks, crc32 } from '../src/engine/png16.js';

const deflate = b => new Uint8Array(zlib.deflateSync(b));
const px = (...cols) => ({ w: cols.length, h: 1, data: new Uint8ClampedArray(cols.flatMap(c => [...c, 255])) });
const grid = step => { const c = []; for (let r = 0; r < 256; r += step) for (let g = 0; g < 256; g += step) for (let b = 0; b < 256; b += step) c.push([r, g, b]); return c; };

test('Lab known values (D50, Bradford)', () => {
  const w = CM.rgbToLab([255, 255, 255]);
  assert.ok(Math.abs(w[0] - 100) < 0.01 && Math.abs(w[1]) < 0.01 && Math.abs(w[2]) < 0.01, `white ${w}`);
  const r = CM.rgbToLab([255, 0, 0]);
  [54.29, 80.80, 69.89].forEach((v, i) => assert.ok(Math.abs(r[i] - v) < 0.5, `red ${r}`));
  const k = CM.rgbToLab([0, 0, 0]); assert.ok(Math.abs(k[0]) < 1e-9);
});

test('sRGB → Lab → sRGB round trip within 1 code value', () => {
  // float Lab: exact for every colour
  for (const c of grid(17)) CM.labToRgb(CM.rgbToLab(c)).forEach((v, i) => assert.ok(Math.abs(v - c[i]) <= 0.5, `${c}`));
  // 8-bit PSD-encoded Lab buffer: neutrals and moderate colours within 1 code value; every colour within ΔE 1.5 (8-bit a/b steps are 1 unit)
  const cols = grid(17), buf = px(...cols), orig = new Uint8ClampedArray(buf.data);
  CM.rgbToLabBuffer(buf, 'sRGB');
  const wi = cols.findIndex(c => c.every(v => v === 255)) * 4;
  assert.deepEqual([...buf.data.subarray(wi, wi + 3)], [255, 128, 128]); // L=100, a=b=0
  CM.labToRgbBuffer(buf, 'sRGB');
  let within1 = 0;
  cols.forEach((c, i) => {
    const back = [...buf.data.subarray(i * 4, i * 4 + 3)], err = Math.max(...back.map((v, k) => Math.abs(v - c[k])));
    if (err <= 1) within1++;
    if (c[0] === c[1] && c[1] === c[2]) assert.ok(err <= 1, `${c} → ${back}`);
    assert.ok(CM.deltaE76(CM.rgbToLab(c), CM.rgbToLab(back)) < 1.5, `${c} → ${back}`);
  });
  assert.ok(within1 / cols.length > 0.7, `${within1}/${cols.length} within 1`);
  assert.equal(orig[3], buf.data[3]);
});

test('sRGB red → Display P3 ≈ (234, 51, 35)', () => {
  const b = px([255, 0, 0], [255, 255, 255], [0, 0, 0], [128, 128, 128]);
  CM.convertBuffer(b, 'sRGB IEC61966-2.1', 'Display P3', 'relative');
  [234, 51, 35].forEach((v, i) => assert.ok(Math.abs(b.data[i] - v) <= 2, `got ${[...b.data.subarray(0, 3)]}`));
  assert.deepEqual([...b.data.subarray(4, 7)], [255, 255, 255]);
  assert.deepEqual([...b.data.subarray(8, 11)], [0, 0, 0]);
  [128, 128, 128].forEach((v, i) => assert.ok(Math.abs(b.data[12 + i] - v) <= 1));
});

test('LUT conversion matches direct math and round-trips sRGB → ProPhoto → sRGB', () => {
  const cols = grid(51), b = px(...cols), o = new Uint8ClampedArray(b.data);
  CM.convertBuffer(b, 'sRGB', 'Adobe RGB (1998)', 'relative');
  cols.forEach((c, i) => { const d = CM.mapRgb(c.map(v => v / 255), CM.getSpace('sRGB'), CM.getSpace('Adobe RGB (1998)')); d.forEach((v, k) => assert.ok(Math.abs(v * 255 - b.data[i * 4 + k]) <= 1.5, `${c} ${d}`)); });
  // 8-bit round trip through a wider space: mean error < 1 code value (dark saturated colours lose
  // more because 8-bit quantisation is amplified by the steep TRC near black, as in any CMM)
  for (const sp of ['Display P3', 'Adobe RGB (1998)']) {
    const r = px(...cols); CM.convertBuffer(r, 'sRGB', sp, 'relative'); CM.convertBuffer(r, sp, 'sRGB', 'relative');
    let sum = 0; for (let i = 0; i < o.length; i++) sum += Math.abs(o[i] - r.data[i]);
    assert.ok(sum / o.length < 1, `${sp} mean round-trip error ${sum / o.length}`);
  }
});

test('perceptual keeps out-of-gamut gradation; absolute shifts white', () => {
  const b = px([0, 255, 0], [0, 230, 0]); CM.convertBuffer(b, 'Display P3', 'sRGB', 'perceptual');
  assert.ok(b.data[1] > b.data[5], 'P3 greens stay ordered after compression');
  const rel = px([0, 255, 0]); CM.convertBuffer(rel, 'Display P3', 'sRGB', 'relative');
  assert.deepEqual([...rel.data.subarray(0, 3)], [0, 255, 0]); // per-channel clip
  assert.ok(b.data[2] > 20, 'perceptual keeps hue (adds blue instead of clipping to pure green)');
  const a = px([255, 255, 255]); CM.convertBuffer(a, 'sRGB', 'ProPhoto RGB', 'absolute');
  assert.ok(a.data[2] > a.data[0], `D65 white is bluish in a D50 space: ${[...a.data.subarray(0, 3)]}`);
});

test('ICC: build, parse back, same primaries and TRC', () => {
  for (const name of ['sRGB IEC61966-2.1', 'Display P3', 'Adobe RGB (1998)', 'ProPhoto RGB']) {
    const bytes = CM.buildIccProfile(name), p = parseIcc(bytes), sp = CM.getSpace(name);
    assert.equal(p.description, name); assert.equal(p.kind, 'rgb-matrix'); assert.ok(p.convertible);
    assert.equal(p.size, bytes.length); assert.equal(p.colorSpace, 'RGB'); assert.equal(p.deviceClass, 'mntr');
    [p.rXYZ, p.gXYZ, p.bXYZ].forEach((v, j) => v.forEach((x, i) => assert.ok(Math.abs(x - sp.toPCS[i][j]) < 1e-4, name)));
    const back = CM.getSpace({ name, bytes });
    for (let i = 0; i <= 255; i += 15) assert.ok(Math.abs(back.trcs[0].decode(i / 255) - sp.trcs[0].decode(i / 255)) < 1e-4);
    const b = px([200, 30, 90]); CM.convertBuffer(b, 'sRGB', { name: 'loaded', bytes }, 'relative');
    const c = px([200, 30, 90]); CM.convertBuffer(c, 'sRGB', name, 'relative');
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(b.data[i] - c.data[i]) <= 1);
  }
  assert.throws(() => parseIcc(new Uint8Array(200)), /Not an ICC profile/);
});

test('ICC: para types and LUT profile reported honestly', () => {
  assert.equal(paraEval(0, [2], 0.5), 0.25);
  const srgb = [2.4, 1 / 1.055, 0.055 / 1.055, 1 / 12.92, 0.04045];
  assert.ok(Math.abs(paraEval(3, srgb, 0.5) - 0.21404) < 1e-4);
  assert.ok(Math.abs(paraEval(4, [...srgb, 0.1, 0.2], 0.01) - (0.01 / 12.92 + 0.2)) < 1e-9);
  // fake CMYK LUT profile: header + desc + A2B0
  const b = new Uint8Array(CM.buildIccProfile('sRGB'));
  const dv = new DataView(b.buffer);
  b.set([67, 77, 89, 75], 16); b.set([112, 114, 116, 114], 12); // 'CMYK', 'prtr'
  for (let i = 0; i < dv.getUint32(128); i++) { const o = 132 + i * 12; if (String.fromCharCode(...b.subarray(o, o + 4)) === 'rXYZ') b.set([65, 50, 66, 48], o); }
  const p = parseIcc(b);
  assert.equal(p.kind, 'lut'); assert.equal(p.convertible, false); assert.match(p.reason, /LUT-based CMYK profile/);
  assert.throws(() => CM.getSpace({ name: 'x', bytes: b }), /LUT-based/);
});

test('CMYK model: round trip bounded, ink limits, gamut warning flags saturated blue', () => {
  const cols = grid(51), b = px(...cols);
  const c = CM.rgbToCmyk(b, { space: 'sRGB' });
  for (let i = 0; i < c.cmyk.length; i += 4) assert.ok(c.cmyk[i] + c.cmyk[i + 1] + c.cmyk[i + 2] + c.cmyk[i + 3] <= 300 * 2.55 + 4, 'total ink ≤ 300 %');
  const back = CM.cmykToRgb(c, { space: 'sRGB' });
  const mask = CM.gamutMask(b, 'sRGB');
  // in-gamut colours must come back close (ΔE76 < 6 after BPC), out-of-gamut ones are flagged
  let inG = 0;
  cols.forEach((col, i) => {
    if (mask[i]) return; inG++;
    const e = CM.deltaE76(CM.rgbToLab(col), CM.rgbToLab([...back.data.subarray(i * 4, i * 4 + 3)]));
    const dark = CM.rgbToLab(col)[0] < 20;
    assert.ok(e < (dark ? 10 : 6), `${col} ΔE ${e.toFixed(2)}`);
  });
  assert.ok(inG >= 40, `${inG} in-gamut colours`);
  const g = CM.gamutMask(px([0, 0, 255], [128, 128, 128], [200, 170, 140], [255, 255, 255]), 'sRGB');
  assert.deepEqual([...g], [255, 0, 0, 0]);
  const white = CM.rgbToCmyk(px([255, 255, 255]), {}); assert.deepEqual([...white.cmyk], [0, 0, 0, 0]);
  const gray = CM.rgbToCmyk(px([60, 60, 60]), {}); assert.ok(gray.cmyk[3] > 60, 'medium GCR puts K into dark neutrals');
  const pr = CM.proofBuffer(px([0, 0, 255]), 'sRGB', {}); assert.ok(pr.data[2] < 200 && pr.data[0] > 20, 'proof desaturates blue');
});

test('Grayscale, Bitmap, Duotone, Indexed', () => {
  const g = CM.rgbToGrayscale(px([255, 0, 0], [255, 255, 255], [0, 0, 0], [119, 119, 119]));
  assert.equal(g.data[0], g.data[1]); assert.equal(g.data[4], 255); assert.equal(g.data[8], 0);
  assert.ok(Math.abs(g.data[12] - 119) <= 1, 'neutral grey keeps its value in sGray');
  assert.ok(Math.abs(g.data[0] - 130) <= 1, `red luminance Y=0.2225 encodes to 130 → ${g.data[0]}`);
  const pg = CM.rgbToGrayscale(px([255, 0, 0]), { method: 'perceptual' }); assert.equal(pg.data[0], 76);

  const ramp = { w: 64, h: 8, data: new Uint8ClampedArray(64 * 8 * 4) };
  for (let i = 0; i < 64 * 8; i++) ramp.data.set([(i % 64) * 4, (i % 64) * 4, (i % 64) * 4, 255], i * 4);
  for (const method of ['threshold', 'pattern', 'diffusion']) {
    const b = CM.bitmapMode({ ...ramp, data: new Uint8ClampedArray(ramp.data) }, { method });
    const vals = new Set(); for (let i = 0; i < b.data.length; i += 4) vals.add(b.data[i]);
    assert.deepEqual([...vals].sort((a, c) => a - c), [0, 255], method);
    let mean = 0; for (let i = 0; i < b.data.length; i += 4) mean += b.data[i]; mean /= 64 * 8;
    assert.ok(Math.abs(mean - 126) < 12, `${method} keeps mean tone (${mean})`);
  }
  const d = CM.duotone(px([255, 255, 255], [0, 0, 0], [128, 128, 128]), { inks: [{ color: '#000000', curve: [[0, 0], [100, 100]] }] });
  assert.deepEqual([...d.data.subarray(0, 3)], [255, 255, 255]); assert.deepEqual([...d.data.subarray(4, 7)], [0, 0, 0]); assert.ok(Math.abs(d.data[8] - 128) <= 1);
  const d2 = CM.duotone(px([0, 0, 0]), { inks: [{ color: '#ff0000', curve: [[0, 0], [100, 100]] }, { color: '#00ffff', curve: [[0, 0], [100, 50]] }] });
  assert.deepEqual([...d2.data.subarray(0, 3)], [128, 0, 0]);

  const img = { w: 40, h: 30, data: new Uint8ClampedArray(40 * 30 * 4) };
  for (let y = 0; y < 30; y++) for (let x = 0; x < 40; x++) img.data.set([x * 6, y * 8, (x * y) & 255, 255], (y * 40 + x) * 4);
  for (const dither of ['none', 'diffusion']) {
    const r = CM.indexedColor({ ...img, data: new Uint8ClampedArray(img.data) }, { palette: 'adaptive', colors: 16, dither });
    const used = new Set(); for (let i = 0; i < r.data.length; i += 4) used.add((r.data[i] << 16) | (r.data[i + 1] << 8) | r.data[i + 2]);
    assert.ok(used.size <= 16 && r.palette.length <= 16, `${used.size} colours`);
    assert.ok(Math.max(...r.indices) < r.palette.length);
  }
  const web = CM.indexedColor({ ...img, data: new Uint8ClampedArray(img.data) }, { palette: 'web', dither: 'none' });
  for (let i = 0; i < web.data.length; i += 4) assert.equal(web.data[i] % 51, 0);
});

test('high bit depth: conversions, float ops, tone mapping', () => {
  const b = px([0, 64, 128], [255, 200, 3]);
  const h16 = CM.toHighBit(b, 16); assert.equal(h16.data[2], 128 * 257);
  assert.deepEqual([...CM.toEightBit(h16, { dither: false }).data], [...b.data]);
  const h32 = CM.toHighBit(b, 32); assert.ok(Math.abs(h32.data[2] - 0.2158605) < 1e-5);
  assert.deepEqual([...CM.toEightBit(h32, { dither: false }).data], [...b.data]);
  assert.deepEqual([...CM.toEightBit(CM.convertDepth(CM.convertDepth(h16, 32), 16), { dither: false }).data], [...b.data]);
  // exposure +1 stop in linear light doubles 32-bit values and keeps > 1
  const e = CM.exposureHigh(CM.toHighBit(px([255, 128, 0]), 32), { exposure: 1 });
  assert.ok(Math.abs(e.data[0] - 2) < 1e-6);
  // 16-bit levels keep sub-8-bit precision: a 0..255 ramp stretched ×4 yields > 256 distinct values
  const ramp = { w: 256, h: 1, data: new Uint8ClampedArray(1024) }; for (let i = 0; i < 256; i++) ramp.data.set([i, i, i, 255], i * 4);
  const lv = CM.levelsHigh(CM.curvesHigh(CM.toHighBit(ramp, 16), { points: { rgb: [[0, 0], [255, 255]] } }), { inBlack: 0, inWhite: 64 });
  assert.equal(lv.data[64 * 4], 65535); assert.equal(lv.data[32 * 4], 32768);
  const bl = CM.gaussianBlurHigh(CM.toHighBit(px([0, 0, 0], [255, 255, 255], [0, 0, 0]), 16), { radius: 1 });
  assert.ok(bl.data[4] < 65535 && bl.data[0] > 0);
  // tone mapping: HDR scene with values up to 64 maps into 0..255 with order kept
  const hdr = { w: 64, h: 4, depth: 32, data: new Float32Array(64 * 4 * 4) };
  for (let i = 0; i < 64 * 4; i++) { const v = 2 ** ((i % 64) / 4 - 10); hdr.data.set([v, v * 0.8, v * 0.6, 1], i * 4); }
  for (const method of ['exposureGamma', 'equalize', 'local']) {
    const o = CM.toneMap(hdr, { method, exposure: method === 'exposureGamma' ? -4 : 0 });
    assert.equal(o.data.length, 64 * 4 * 4);
    for (let x = 1; x < 64; x++) assert.ok(o.data[(64 + x) * 4] >= o.data[(64 + x - 1) * 4], `${method} monotone at ${x}`);
    if (method !== 'exposureGamma') { assert.ok(o.data[(64 + 63) * 4] > 200 && o.data[64 * 4] < 70, method); }
  }
});

test('16-bit PNG encodes and decodes', async () => {
  const w = 3, h = 2, data = new Uint16Array([0, 1, 256, 65535, 1000, 2000, 3000, 40000, 65535, 0, 12345, 54321, 7, 8, 9, 10, 11, 12, 13, 14, 60000, 50000, 40000, 30000]);
  const icc = CM.buildIccProfile('Display P3');
  const png = await encodePng16({ w, h, data }, deflate, { icc, iccName: 'Display P3' });
  const chunks = readPngChunks(png);
  assert.deepEqual(chunks.map(c => c.type), ['IHDR', 'iCCP', 'IDAT', 'IEND']);
  const ih = chunks[0].data; assert.equal(new DataView(ih.buffer, ih.byteOffset).getUint32(0), 3); assert.equal(ih[8], 16); assert.equal(ih[9], 6);
  const cp = chunks[1].data, z = cp.indexOf(0);
  assert.equal(String.fromCharCode(...cp.subarray(0, z)), 'Display P3');
  assert.deepEqual([...zlib.inflateSync(cp.subarray(z + 2))], [...icc]);
  const raw = zlib.inflateSync(chunks[2].data), stride = w * 8, prev = new Uint8Array(stride), got = [];
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    assert.equal(f, 2);
    for (let i = 0; i < stride; i++) prev[i] = (row[i] + prev[i]) & 255;
    for (let i = 0; i < stride; i += 2) got.push((prev[i] << 8) | prev[i + 1]);
  }
  assert.deepEqual(got, [...data]);
  assert.equal(crc32(new TextEncoder().encode('IEND')), 0xae426082);
});

test('embed ICC into 8-bit PNG and JPEG', async () => {
  const icc = CM.buildIccProfile('Adobe RGB (1998)');
  const png8 = await encodePng16({ w: 1, h: 1, data: new Uint16Array(4) }, deflate); // any valid PNG works as a container
  const out = await embedIccInPng8(png8, icc, deflate, 'Adobe RGB (1998)');
  const ch = readPngChunks(out); assert.deepEqual(ch.map(c => c.type), ['IHDR', 'iCCP', 'IDAT', 'IEND']);
  const again = readPngChunks(await embedIccInPng8(out, icc, deflate)); assert.equal(again.filter(c => c.type === 'iCCP').length, 1);

  // minimal JPEG structure: SOI, APP0 JFIF, DQT stub, SOS stub + data, EOI
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xdb, 0, 4, 0, 0, 0xff, 0xda, 0, 2, 1, 2, 3, 0xff, 0xd9]);
  const big = new Uint8Array(70000).map((_, i) => i & 255); big.set(icc.subarray(0, 128));
  for (const prof of [icc, big]) {
    const j = embedIccInJpeg(jpeg, prof);
    assert.deepEqual([...j.subarray(0, 2)], [0xff, 0xd8]); assert.deepEqual([...j.subarray(2, 4)], [0xff, 0xe0]);
    const app2 = j.indexOf(0xe2, 20); assert.equal(j[app2 - 1], 0xff); assert.equal(app2, 21);
    assert.equal(String.fromCharCode(...j.subarray(app2 + 3, app2 + 14)), 'ICC_PROFILE');
    const n = Math.ceil(prof.length / 65519); assert.equal(j[app2 + 16], n); assert.equal(j[app2 + 15], 1);
    assert.deepEqual([...extractIccFromJpeg(j)], [...prof]);
    assert.deepEqual([...j.subarray(j.length - 2)], [0xff, 0xd9]);
    assert.deepEqual([...extractIccFromJpeg(embedIccInJpeg(j, icc))], [...icc], 'replaces existing profile');
  }
});
