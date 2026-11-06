import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyCatalog, normalizeCatalog, importPhotos, getPhoto, parseExif, exifDateToISO, formatExif,
  setRating, setFlag, setLabel, setKeywords, parseKeywords, filterPhotos, sortPhotos,
  addCollection, renameCollection, deleteCollection, addToCollection,
  pickPanels, pasteSettings, syncSettings, PANELS, setDevelop, updateDevelop, recordHistory, goToHistory,
  addSnapshot, applySnapshot, createVirtualCopy, removePhotos, resetDevelop, describeChange,
  exportFileName, planExport, fitLongEdge, renderForExport, applyPreset, savePreset, allPresets, BUILTIN_PRESETS,
  settingsHash, previewCacheKey, cachePut, cacheGet, referencedAssetIds, compactSettings, expandSettings,
  memoryCatalogBackend,
} from '../src/engine/catalog.js';
import { developDefaults, DEVELOP_DEFAULTS } from '../src/engine/develop.js';

// ---- tiny synthetic JPEG with an APP1 Exif block (big-endian TIFF) ----
function makeJpegWithExif({ make = 'Zcam', model = 'Zcam Z1', dto = '2024:05:17 14:03:21', iso = 400, fnum = [28, 10], exp = [1, 250], focal = [50, 1], lens = 'Prime 50mm', orientation = 6 } = {}) {
  const bytes = []; const u16 = v => bytes.push((v >> 8) & 255, v & 255); const u32 = v => { u16(v >>> 16); u16(v & 0xffff); };
  const strs = []; // deferred data blocks: [offsetPatchIndex, data]
  // TIFF header
  bytes.push(0x4d, 0x4d); u16(42); u32(8);
  const entry = (tag, type, count, valueOrBytes) => {
    u16(tag); u16(type); u32(count);
    if (Array.isArray(valueOrBytes)) { const at = bytes.length; u32(0); strs.push([at, valueOrBytes]); }
    else if (type === 3) { u16(valueOrBytes); u16(0); }
    else u32(valueOrBytes);
  };
  const ascii = s => [...s].map(c => c.charCodeAt(0)).concat(0);
  const rational = ([n, d]) => [n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255, d >>> 24, (d >> 16) & 255, (d >> 8) & 255, d & 255];
  // IFD0: Make, Model, Orientation, ExifIFD pointer
  u16(4);
  entry(0x010f, 2, make.length + 1, ascii(make));
  entry(0x0110, 2, model.length + 1, ascii(model));
  entry(0x0112, 3, 1, orientation);
  const exifPtrAt = bytes.length + 8; entry(0x8769, 4, 1, 0);
  u32(0);
  const flush = () => { for (const [at, data] of strs.splice(0)) { const off = bytes.length; bytes.push(...data); if (bytes.length % 2) bytes.push(0); bytes[at] = off >>> 24; bytes[at + 1] = (off >> 16) & 255; bytes[at + 2] = (off >> 8) & 255; bytes[at + 3] = off & 255; } };
  flush();
  // Exif IFD
  const exifOff = bytes.length; bytes[exifPtrAt] = exifOff >>> 24; bytes[exifPtrAt + 1] = (exifOff >> 16) & 255; bytes[exifPtrAt + 2] = (exifOff >> 8) & 255; bytes[exifPtrAt + 3] = exifOff & 255;
  u16(6);
  entry(0x829a, 5, 1, rational(exp));
  entry(0x829d, 5, 1, rational(fnum));
  entry(0x8827, 3, 1, iso);
  entry(0x9003, 2, dto.length + 1, ascii(dto));
  entry(0x920a, 5, 1, rational(focal));
  entry(0xa434, 2, lens.length + 1, ascii(lens));
  u32(0);
  flush();
  const tiff = bytes;
  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const len = app1.length + 2;
  // SOI, an APP0 (JFIF) first to prove marker walking, APP1, then EOI
  const app0 = [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0];
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, app0.length + 2, ...app0, 0xff, 0xe1, len >> 8, len & 255, ...app1, 0xff, 0xd9]);
}

const rec = (n, extra = {}) => ({ assetId: 'sha256-' + n, name: n + '.jpg', w: 400, h: 300, ...extra });
function sample() {
  let { cat } = importPhotos(emptyCatalog(), [rec('b'), rec('a'), rec('c')], 1000);
  ({ cat } = importPhotos(cat, [rec('d', { exif: { dateTimeOriginal: '2020:01:01 10:00:00' } })], 2000));
  return cat;
}

test('import: records get defaults, ids, batches; duplicates are skipped; persists through the memory backend', async () => {
  let { cat, added, duplicates } = importPhotos(emptyCatalog(), [rec('x'), rec('y'), rec('x')], 5);
  assert.deepEqual(added, ['p1', 'p2']); assert.deepEqual(duplicates, ['x.jpg']);
  const p = getPhoto(cat, 'p1');
  assert.equal(p.rating, 0); assert.equal(p.flag, null); assert.equal(p.label, null);
  assert.deepEqual(p.develop, developDefaults()); assert.equal(p.history.length, 1); assert.equal(p.importedAt, 5);
  const be = memoryCatalogBackend(); await be.save(cat);
  const back = normalizeCatalog(await be.load());
  assert.deepEqual(back.photos.map(q => q.name), ['x.jpg', 'y.jpg']);
  assert.deepEqual(normalizeCatalog(null).photos, []);
  assert.throws(() => normalizeCatalog({ version: 99 }));
});

test('EXIF: synthetic JPEG APP1 parsed (date, camera, lens, ISO, aperture, shutter, focal, orientation)', () => {
  const e = parseExif(makeJpegWithExif());
  assert.equal(e.make, 'Zcam'); assert.equal(e.model, 'Zcam Z1'); assert.equal(e.lens, 'Prime 50mm');
  assert.equal(e.dateTimeOriginal, '2024:05:17 14:03:21'); assert.equal(e.iso, 400);
  assert.equal(e.fNumber, 2.8); assert.equal(e.exposureTime, 1 / 250); assert.equal(e.focalLength, 50); assert.equal(e.orientation, 6);
  assert.equal(exifDateToISO(e.dateTimeOriginal), '2024-05-17T14:03:21');
  const rows = Object.fromEntries(formatExif(e));
  assert.equal(rows.Camera, 'Zcam Z1'); assert.equal(rows.Exposure, '1/250 s'); assert.equal(rows.Aperture, 'f/2.8'); assert.equal(rows['Focal length'], '50 mm');
  const { cat } = importPhotos(emptyCatalog(), [rec('e', { exif: e })]);
  assert.equal(cat.photos[0].captureDate, '2024-05-17T14:03:21');
  assert.equal(parseExif(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), null, 'PNG → null');
  assert.equal(parseExif(new Uint8Array([0xff, 0xd8, 0xff, 0xd9])), null, 'JPEG without EXIF → null');
  assert.equal(parseExif(makeJpegWithExif().slice(0, 40)), null, 'truncated → null, no throw');
});

test('ratings, flags, labels, keywords, collections → filters and sort', () => {
  let cat = sample();
  cat = setRating(cat, ['p1', 'p2'], 4); cat = setRating(cat, 'p3', 2); cat = setRating(cat, 'p4', 9);
  cat = setFlag(cat, ['p1'], 'pick'); cat = setFlag(cat, 'p3', 'reject');
  cat = setLabel(cat, ['p2', 'p3'], 'red'); cat = setLabel(cat, 'p3', 'red'); // toggles p3 off
  cat = setKeywords(cat, 'p2', parseKeywords('beach, Sunset; beach'));
  const names = f => filterPhotos(cat, f).map(p => p.name).sort().join();
  assert.equal(getPhoto(cat, 'p4').rating, 5, 'clamped');
  assert.equal(names({ minRating: 4 }), 'a.jpg,b.jpg,d.jpg');
  assert.equal(names({ flag: 'pick' }), 'b.jpg'); assert.equal(names({ source: 'picks' }), 'b.jpg');
  assert.equal(names({ flag: 'unflagged' }), 'a.jpg,d.jpg'); assert.equal(names({ flag: 'reject' }), 'c.jpg');
  assert.equal(names({ label: 'red' }), 'a.jpg'); assert.equal(names({ label: 'none' }), 'b.jpg,c.jpg,d.jpg');
  assert.equal(names({ keyword: 'sunset' }), 'a.jpg'); assert.equal(names({ text: 'BEACH' }), 'a.jpg'); assert.equal(names({ text: 'c.j' }), 'c.jpg');
  assert.equal(names({ source: 'recent' }), 'd.jpg');
  let col; ({ cat, id: col } = addCollection(cat, 'Trip'));
  cat = addToCollection(cat, ['p1', 'p3'], col); cat = renameCollection(cat, col, 'Holiday');
  assert.equal(names({ source: col }), 'b.jpg,c.jpg'); assert.equal(cat.collections[0].name, 'Holiday');
  assert.equal(names({ source: col, minRating: 3 }), 'b.jpg');
  cat = deleteCollection(cat, col); assert.equal(getPhoto(cat, 'p1').collections.length, 0);
  // sort
  assert.deepEqual(sortPhotos(cat.photos, 'name').map(p => p.name), ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg']);
  assert.deepEqual(sortPhotos(cat.photos, 'name', 'desc').map(p => p.name), ['d.jpg', 'c.jpg', 'b.jpg', 'a.jpg']);
  assert.deepEqual(sortPhotos(cat.photos, 'rating', 'desc').map(p => p.name), ['d.jpg', 'a.jpg', 'b.jpg', 'c.jpg']);
  assert.deepEqual(sortPhotos(cat.photos, 'import', 'desc').map(p => p.name), ['d.jpg', 'a.jpg', 'b.jpg', 'c.jpg']);
  assert.equal(sortPhotos(cat.photos, 'capture')[0].name, 'a.jpg', 'import time 1000 (1970) before capture 2020');
  assert.throws(() => setFlag(cat, 'p1', 'maybe')); assert.throws(() => setLabel(cat, 'p1', 'pink'));
});

test('copy/paste with a panel subset only touches those keys; sync skips the source; panels cover every key', () => {
  const covered = Object.values(PANELS).flatMap(p => p.keys).sort();
  assert.deepEqual(covered, Object.keys(DEVELOP_DEFAULTS).filter(k => k !== 'bypass').sort());
  let cat = sample();
  cat = setDevelop(cat, 'p1', { ...developDefaults(), exposure: 1.2, temp: 30, wb: 'custom', clarity: 40, curve: { ...developDefaults().curve, darks: 20 } });
  cat = setDevelop(cat, 'p2', { ...developDefaults(), contrast: 50, clarity: -10 });
  const copied = pickPanels(getPhoto(cat, 'p1').develop, ['light', 'whiteBalance']);
  assert.deepEqual(Object.keys(copied).sort(), ['blacks', 'contrast', 'exposure', 'highlights', 'shadows', 'temp', 'tint', 'wb', 'whites']);
  cat = pasteSettings(cat, ['p2'], copied);
  const p2 = getPhoto(cat, 'p2').develop;
  assert.equal(p2.exposure, 1.2); assert.equal(p2.temp, 30); assert.equal(p2.contrast, 0, 'light panel pasted as a whole');
  assert.equal(p2.clarity, -10, 'presence not pasted'); assert.equal(p2.curve.darks, 0, 'curve not pasted');
  assert.equal(getPhoto(cat, 'p2').history.at(-1).label, 'Paste Settings');
  cat = syncSettings(cat, 'p1', ['p1', 'p3'], ['curve']);
  assert.equal(getPhoto(cat, 'p3').develop.curve.darks, 20); assert.equal(getPhoto(cat, 'p3').develop.exposure, 0);
  assert.equal(getPhoto(cat, 'p1').history.at(-1).label, describeChange(developDefaults(), getPhoto(cat, 'p1').develop), 'source untouched by sync');
  cat = resetDevelop(cat, ['p2']); assert.deepEqual(getPhoto(cat, 'p2').develop, developDefaults());
});

test('history labels, jump back, branch on edit; snapshots restore', () => {
  let cat = sample();
  const d = developDefaults();
  cat = setDevelop(cat, 'p1', { ...d, exposure: 0.5 });
  cat = updateDevelop(cat, 'p1', { ...d, exposure: 0.5, temp: 20, wb: 'custom' }); cat = recordHistory(cat, 'p1', describeChange({ ...d, exposure: 0.5 }, getPhoto(cat, 'p1').develop));
  cat = recordHistory(cat, 'p1', 'duplicate'); // identical settings → no new step
  let p = getPhoto(cat, 'p1');
  assert.deepEqual(p.history.map(h => h.label), ['Import', 'Exposure', 'Temperature']);
  assert.deepEqual(p.history[1].settings, { exposure: 0.5 }, 'history is stored sparse');
  cat = addSnapshot(cat, 'p1', 'Warm');
  cat = goToHistory(cat, 'p1', 1); p = getPhoto(cat, 'p1');
  assert.equal(p.develop.exposure, 0.5); assert.equal(p.develop.temp, 0); assert.equal(p.history.length, 3, 'later steps kept until the next edit');
  cat = setDevelop(cat, 'p1', { ...p.develop, contrast: 10 }); p = getPhoto(cat, 'p1');
  assert.deepEqual(p.history.map(h => h.label), ['Import', 'Exposure', 'Contrast']);
  cat = applySnapshot(cat, 'p1', 0); p = getPhoto(cat, 'p1');
  assert.equal(p.develop.temp, 20); assert.equal(p.develop.contrast, 0); assert.equal(p.history.at(-1).label, 'Snapshot: Warm');
  assert.equal(describeChange(d, { ...d, curve: { ...d.curve, rgb: [[0, 10], [255, 255]] } }), 'Tone Curve');
  assert.equal(describeChange(d, { ...d, exposure: 1, contrast: 2, clarity: 3 }), '3 settings');
});

test('virtual copies have independent settings and are removed with their master', () => {
  let cat = sample(), vid;
  cat = setDevelop(cat, 'p1', { ...developDefaults(), exposure: 1 });
  ({ cat, id: vid } = createVirtualCopy(cat, 'p1'));
  const v = getPhoto(cat, vid);
  assert.equal(v.virtualOf, 'p1'); assert.equal(v.assetId, 'sha256-b'); assert.equal(v.name, 'b.jpg (Copy 1)'); assert.equal(v.develop.exposure, 1);
  cat = setDevelop(cat, vid, { ...v.develop, exposure: -1, saturation: -100 });
  assert.equal(getPhoto(cat, 'p1').develop.exposure, 1); assert.equal(getPhoto(cat, 'p1').develop.saturation, 0);
  assert.equal(getPhoto(cat, vid).develop.exposure, -1);
  assert.equal(cat.photos.findIndex(p => p.id === vid), 1, 'copy sits next to its master');
  // a second copy made from the copy still points at the master
  let v2; ({ cat, id: v2 } = createVirtualCopy(cat, vid)); assert.equal(getPhoto(cat, v2).virtualOf, 'p1'); assert.equal(getPhoto(cat, v2).name, 'b.jpg (Copy 2)');
  assert.equal(importPhotos(cat, [rec('b')]).duplicates.length, 1, 'still a duplicate of the master');
  cat = removePhotos(cat, ['p1']);
  assert.deepEqual(cat.photos.map(p => p.name).sort(), ['a.jpg', 'c.jpg', 'd.jpg']);
});

test('presets merge only their keys (deep), user presets keep only the chosen panels', () => {
  const base = { ...developDefaults(), exposure: 0.7, grading: { ...developDefaults().grading, shadows: { hue: 200, sat: 30, lum: 5 }, balance: 20 } };
  const warm = BUILTIN_PRESETS.find(p => p.name === 'Warm Afternoon');
  const out = applyPreset(base, warm);
  assert.equal(out.exposure, 0.7, 'non-preset key kept'); assert.equal(out.temp, 18);
  assert.deepEqual(out.grading.highlights, { hue: 42, sat: 14, lum: 0 });
  assert.deepEqual(out.grading.shadows, { hue: 200, sat: 30, lum: 5 }, 'nested sibling kept'); assert.equal(out.grading.balance, 20);
  let cat = sample(), id;
  ({ cat, id } = savePreset(cat, 'Mine', { ...developDefaults(), clarity: 33, exposure: 2 }, ['presence']));
  const mine = allPresets(cat).find(p => p.id === id);
  assert.ok(!('exposure' in mine.settings)); assert.equal(mine.settings.clarity, 33);
  assert.equal(applyPreset({ ...developDefaults(), exposure: -1 }, mine).exposure, -1);
  assert.equal(allPresets(cat).length, BUILTIN_PRESETS.length + 1);
});

test('export naming template, unique names, long-edge sizing and a real full-res render', () => {
  const p = { name: 'IMG_0042.JPG', captureDate: '2024-05-17T14:03:21', importedAt: 0, w: 4000, h: 3000 };
  assert.equal(exportFileName('{name}', p, 1, 'jpg'), 'IMG_0042.jpg');
  assert.equal(exportFileName('{date}_{seq:3}', p, 7, 'png'), '2024-05-17_007.png');
  assert.equal(exportFileName('trip-{seq}-{name}', p, 12, 'jpg'), 'trip-12-IMG_0042.jpg');
  assert.equal(exportFileName('a/b:{name}', p, 1, 'jpg'), 'a_b_IMG_0042.jpg');
  assert.equal(exportFileName('{date}', { ...p, captureDate: null, importedAt: Date.UTC(2023, 0, 2) }, 1, 'jpg'), '2023-01-02.jpg');
  const plan = planExport([p, { ...p, w: 300, h: 600 }], { format: 'jpeg', quality: 80, longEdge: 2048, template: '{name}' });
  assert.deepEqual(plan.map(x => x.fileName), ['IMG_0042.jpg', 'IMG_0042-2.jpg']);
  assert.deepEqual([plan[0].w, plan[0].h, plan[0].mime, plan[0].quality], [2048, 1536, 'image/jpeg', 0.8]);
  assert.deepEqual([plan[1].w, plan[1].h], [300, 600], 'never upscales');
  assert.deepEqual(fitLongEdge(10, 5, 0), { w: 10, h: 5 });
  // real pixels: 40×20 mid grey, exposure +1 → 176 (as in develop.test.js), resized to 20×10
  const buf = { w: 40, h: 20, data: new Uint8ClampedArray(40 * 20 * 4).map((_, i) => i % 4 === 3 ? 255 : 128) };
  const out = renderForExport(buf, { exposure: 1 }, { longEdge: 20 });
  assert.deepEqual([out.w, out.h], [20, 10]);
  assert.deepEqual([...out.data.slice(0, 4)], [176, 176, 176, 255]);
  assert.equal(buf.data[0], 128, 'source untouched');
  const same = renderForExport(buf, {}, {}); assert.deepEqual([same.w, same.h, same.data[0]], [40, 20, 128]);
});

test('settings hash / preview cache keys / sparse settings round-trip', () => {
  const d = developDefaults();
  assert.equal(settingsHash(d), settingsHash({}));
  assert.notEqual(settingsHash({ exposure: 1 }), settingsHash({}));
  assert.equal(settingsHash({ exposure: 1, contrast: 2 }), settingsHash({ contrast: 2, exposure: 1 }));
  assert.equal(previewCacheKey('sha256-a', {}, 320), 'sha256-a|' + settingsHash({}) + '|320');
  assert.deepEqual(expandSettings(compactSettings({ ...d, clarity: 5 })), { ...d, clarity: 5 });
  let cat = sample(); cat = cachePut(cat, 'k1', 'sha256-thumb');
  assert.equal(cacheGet(cat, 'k1'), 'sha256-thumb'); assert.equal(cacheGet(cat, 'nope'), null);
  assert.deepEqual(referencedAssetIds(cat).sort(), ['sha256-a', 'sha256-b', 'sha256-c', 'sha256-d', 'sha256-thumb']);
});
