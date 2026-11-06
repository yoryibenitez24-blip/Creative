// Develop part 2 engine (src/engine/develop2.js): Point Color, Geometry / Upright, Crop & Straighten,
// Remove / Heal / Clone spots. Real pixels in, measured pixels out.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as D from '../src/engine/develop2.js';
import { rgbToHsl, hslToRgb } from '../src/engine/color.js';
import { resample } from '../src/engine/geometry.js';

const make = (w, h, f) => { const data = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = f(x, y); const o = (y * w + x) * 4; data[o] = v[0]; data[o + 1] = v[1]; data[o + 2] = v[2]; data[o + 3] = v[3] ?? 255; } return { w, h, data }; };
const px = (b, x, y) => Array.from(b.data.subarray((y * b.w + x) * 4, (y * b.w + x) * 4 + 4));
const ss = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
/** Supersampled render of f(x, y) → 0..1 mixing two colours. */
const render = (w, h, cov, c0, c1, n = 4) => make(w, h, (x, y) => { let a = 0; for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) a += cov(x + (i + 0.5) / n, y + (j + 0.5) / n); a /= n * n; return c0.map((v, k) => v + (c1[k] - v) * a); });
const meanAbs = (a, b) => { let s = 0, n = 0; for (let i = 0; i < a.data.length; i += 4) for (let c = 0; c < 3; c++) { s += Math.abs(a.data[i + c] - b.data[i + c]); n++; } return s / n; };

// ---------------- Point Color ----------------
test('point colour shifts only the targeted hue', () => {
  const cols = [[200, 40, 40], [40, 170, 60], [40, 60, 200], [128, 128, 128]];
  const img = make(120, 40, x => cols[Math.floor(x / 30)]);
  const sw = D.samplePointColor(img, 15 / 120, 0.5, 0.02);
  assert.ok(Math.abs(sw.hue - 0) < 1 && sw.sat > 0.6, 'sampled the red swatch');
  const out = D.applyPointColor(img, { swatches: [{ ...sw, hueShift: 100, satShift: -40, lumShift: 30 }] });
  const [h0, s0, l0] = rgbToHsl(...px(img, 10, 20).slice(0, 3)), [h1, s1, l1] = rgbToHsl(...px(out, 10, 20).slice(0, 3));
  assert.ok(Math.abs(h1 - h0 - 30) < 2, `red hue moved by ~30° (${h1 - h0})`);
  assert.ok(s1 < s0 - 0.1 && l1 > l0 + 0.05, 'saturation down, luminance up');
  for (const x of [45, 75, 105]) assert.deepEqual(px(out, x, 20), px(img, x, 20), `untargeted colour at x=${x} unchanged`);
  // neutral swatch = identity
  assert.deepEqual(D.applyPointColor(img, { swatches: [sw] }).data, img.data);
  // linear-plane form agrees with the encoded form
  const N = img.w * img.h, lin = v => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const R = new Float32Array(N), G = new Float32Array(N), B = new Float32Array(N);
  for (let i = 0; i < N; i++) { R[i] = lin(img.data[i * 4]); G[i] = lin(img.data[i * 4 + 1]); B[i] = lin(img.data[i * 4 + 2]); }
  assert.equal(D.pointColor(R, G, B, img.w, img.h, { swatches: [{ ...sw, hueShift: 100 }] }), true);
  const ref = D.applyPointColor(img, { swatches: [{ ...sw, hueShift: 100 }] }), i0 = 20 * 120 + 10;
  const e = l => 255 * (l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055);
  assert.ok(Math.abs(e(R[i0]) - ref.data[i0 * 4]) < 1.5 && Math.abs(e(G[i0]) - ref.data[i0 * 4 + 1]) < 1.5);
});

test('point colour range and variance', () => {
  // hue ramp 0..120°: narrow range touches fewer pixels than a wide one; variance unifies hues
  const img = make(121, 4, x => hslToRgb(x, 0.7, 0.5));
  const base = D.samplePointColor(img, 60.5 / 121, 0.5, 0.001);
  const changed = r => { const o = D.applyPointColor(img, { swatches: [{ ...base, satShift: -100, range: { hue: r, sat: 50, lum: 50 } }] }); let n = 0; for (let x = 0; x < 121; x++) if (px(o, x, 1).some((v, k) => k < 3 && Math.abs(v - px(img, x, 1)[k]) > 2)) n++; return n; };
  assert.ok(changed(10) < changed(50) && changed(50) < changed(100), 'range widens the selection');
  const v = D.applyPointColor(img, { swatches: [{ ...base, variance: 100 }] });
  const hueAt = (b, x) => rgbToHsl(...px(b, x, 1).slice(0, 3))[0];
  assert.ok(Math.abs(hueAt(v, 50) - 60) < Math.abs(hueAt(img, 50) - 60) * 0.5, 'variance pulls nearby hues to the swatch');
});

// ---------------- Geometry ----------------
const horizon = (w, h, deg) => { const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return render(w, h, (x, y) => ss(0.5 + (-(x - w / 2) * s + (y - h * 0.55) * c)), [205, 215, 235], [70, 95, 60]); };
const longestNear = (lines, horiz) => lines.filter(l => horiz ? Math.abs(l.angle) < 30 : Math.abs(l.angle) > 60)[0];

test('Upright Level fixes a rotated horizon to within 0.5°', () => {
  for (const deg of [3, -4.5]) {
    const img = horizon(400, 300, deg);
    const lines = D.detectLines(img), hz = longestNear(lines, true);
    assert.ok(hz && Math.abs(hz.angle - deg) < 0.3, `detected horizon ${hz?.angle} ≈ ${deg}`);
    const corr = D.uprightSolve(lines, 'level', 400 / 300);
    assert.ok(Math.abs(corr.rotate + deg) < 0.5 && corr.vertical === 0 && corr.horizontal === 0, `level rotate ${corr.rotate}`);
    const g = { upright: 'level', uprightCorrection: corr, constrainCrop: true }, out = D.applyGeometry(img, D.geometryMatrix(g, 400, 300));
    const after = longestNear(D.detectLines(out), true);
    assert.ok(Math.abs(after.angle) < 0.5, `horizon after Level: ${after.angle}°`);
    assert.ok(Math.abs(D.autoStraightenAngle(img) + deg) < 0.5, 'auto straighten angle');
  }
});

// converging verticals: stripes through a vanishing point above the frame (camera tilted up) + two horizontal bars
const keystone = (w, h) => { const vx = w / 2, vy = -2.2 * h; return render(w, h, (x, y) => { const u = (x - vx) / (y - vy) * h * 2.2, s = Math.sin(u / 34 * Math.PI); const bar = Math.abs(y - h * 0.3) < 3 || Math.abs(y - h * 0.75) < 3; return bar ? 1 : ss(0.5 + s * 6); }, [230, 225, 215], [50, 55, 70]); };

test('Upright Vertical removes keystone: converging verticals become vertical within 1°', () => {
  const img = keystone(360, 360), lines = D.detectLines(img);
  const verts = lines.filter(l => Math.abs(l.angle) > 60 && l.length > 0.15);
  assert.ok(verts.length >= 6 && verts.some(l => Math.abs(Math.abs(l.angle) - 90) > 3), 'input has converging verticals');
  const corr = D.uprightSolve(lines, 'vertical', 1);
  assert.ok(corr.vertical < -10 && Math.abs(corr.rotate) < 0.5, `vertical correction ${JSON.stringify(corr)}`);
  const M = D.geometryMatrix({ upright: 'vertical', uprightCorrection: corr }, 360, 360);
  for (const l of D.transformLines(verts, M, 360, 360)) assert.ok(90 - Math.abs(l.angle) < 1, `mapped line at ${l.angle}°`);
  // with real pixels: warp, re-detect
  const out = D.applyGeometry(img, D.geometryMatrix({ upright: 'vertical', uprightCorrection: corr, constrainCrop: true }, 360, 360));
  const again = D.detectLines(out).filter(l => Math.abs(l.angle) > 60 && l.length > 0.15);
  assert.ok(again.length >= 4);
  for (const l of again) assert.ok(90 - Math.abs(l.angle) < 1, `re-detected vertical at ${l.angle}°`);
  // Full and Auto also straighten them; Guided with two guides along two stripes makes those exactly vertical
  for (const mode of ['full', 'auto']) { const c = D.uprightSolve(lines, mode, 1), Mm = D.geometryMatrix({ upright: mode, uprightCorrection: c }, 360, 360); const dev = Math.max(...D.transformLines(verts, Mm, 360, 360).map(l => 90 - Math.abs(l.angle))); assert.ok(dev < (mode === 'auto' ? 2.5 : 1), `${mode}: ${dev}`); }
  const guides = [verts[0], verts.find(l => Math.sign(l.angle) !== Math.sign(verts[0].angle))].map(l => [l.x0, l.y0, l.x1, l.y1]);
  const gc = D.uprightSolve(guides, 'guided', 1), Mg = D.geometryMatrix({ upright: 'guided', uprightCorrection: gc }, 360, 360);
  for (const l of D.transformLines(guides, Mg, 360, 360)) assert.ok(90 - Math.abs(l.angle) < 0.1, `guide → ${l.angle}`);
  assert.deepEqual(D.uprightSolve(lines, 'off', 1), { rotate: 0, vertical: 0, horizontal: 0 });
});

test('manual geometry matrices behave', () => {
  const W = 400, H = 300, hx = 0.5, hy = 0.375, ap = (M, x, y) => D.mat3Apply(M, x, y);
  assert.ok(D.isGeometryIdentity(D.GEOMETRY_DEFAULTS));
  let M = D.geometryMatrix({ vertical: -50 }, W, H);
  assert.ok(ap(M, hx, -hy)[0] - ap(M, -hx, -hy)[0] > ap(M, hx, hy)[0] - ap(M, -hx, hy)[0] + 0.1, 'Vertical < 0 widens the top');
  assert.ok(Math.abs(ap(M, 0, 0)[0]) < 1e-12 && Math.abs(ap(M, 0, 0)[1]) < 1e-12, 'centre fixed');
  M = D.geometryMatrix({ horizontal: 50 }, W, H);
  assert.ok(ap(M, hx, hy)[1] - ap(M, hx, -hy)[1] > ap(M, -hx, hy)[1] - ap(M, -hx, -hy)[1] + 0.1, 'Horizontal > 0 enlarges the right side');
  M = D.geometryMatrix({ rotate: 10 }, W, H); const p = ap(M, 0.2, 0);
  assert.ok(Math.abs(Math.atan2(p[1], p[0]) * 180 / Math.PI - 10) < 1e-9 && Math.abs(Math.hypot(p[0], p[1]) - 0.2) < 1e-9, 'rotate = clockwise rotation');
  M = D.geometryMatrix({ scale: 120 }, W, H); assert.ok(Math.abs(ap(M, 0.1, 0.05)[0] - 0.12) < 1e-12 && Math.abs(ap(M, 0.1, 0.05)[1] - 0.06) < 1e-12);
  M = D.geometryMatrix({ aspect: 100 }, W, H); const q = ap(M, 0.1, 0.1); assert.ok(q[0] > 0.1 && q[1] < 0.1 && Math.abs(q[0] * q[1] - 0.01) < 1e-12, 'aspect stretches x, squeezes y, keeps area');
  M = D.geometryMatrix({ offsetX: 100, offsetY: -50 }, W, H); const o = ap(M, 0, 0); assert.ok(Math.abs(o[0] - 0.5) < 1e-12 && Math.abs(o[1] + 0.1875) < 1e-12, "offset ±100 = half the image size");
  // upright correction is ignored when upright is off, added otherwise
  const uc = { rotate: 2, vertical: 0, horizontal: 0 };
  assert.ok(D.isGeometryIdentity({ upright: 'off', uprightCorrection: uc }));
  assert.deepEqual(D.geometryMatrix({ upright: 'level', uprightCorrection: uc }, W, H).map(v => +v.toFixed(12)), D.geometryMatrix({ rotate: 2 }, W, H).map(v => +v.toFixed(12)));
  // pixels: rotate 90° about the centre of a square image moves the left-edge marker to the top
  const img = make(41, 41, (x, y) => x < 4 && Math.abs(y - 20) < 3 ? [255, 0, 0] : [0, 0, 255]);
  const r = D.applyGeometry(img, D.mat3Mul([0, -1, 0, 1, 0, 0, 0, 0, 1], D.mat3Mul([1, 0, 0, 0, 1, 0, 0, 0, 1], [1, 0, 0, 0, 1, 0, 0, 0, 1])));
  assert.equal(px(r, 20, 1)[0], 255); assert.equal(px(r, 1, 20)[0], 0);
  // identity → exact copy
  assert.deepEqual(D.applyGeometry(img, D.geometryMatrix({}, 41, 41)).data, img.data);
});

test('constrain crop leaves no transparent corners', () => {
  const img = make(300, 200, (x, y) => [x % 256, y, 128]);
  for (const g of [{ rotate: 8 }, { vertical: -60, rotate: -5 }, { horizontal: 70 }, { scale: 60 }, { offsetX: 40, offsetY: -30 }]) {
    const loose = D.applyGeometry(img, D.geometryMatrix(g, 300, 200));
    let transparent = 0; for (let i = 3; i < loose.data.length; i += 4) if (loose.data[i] < 255) transparent++;
    assert.ok(transparent > 100, `${JSON.stringify(g)} without constrain has empty areas`);
    for (const out of [D.applyGeometry(img, D.geometryMatrix({ ...g, constrainCrop: true }, 300, 200)), D.applyGeometry(img, D.geometryMatrix(g, 300, 200), { constrainCrop: true })]) {
      let min = 255; for (let i = 3; i < out.data.length; i += 4) min = Math.min(min, out.data[i]);
      assert.equal(min, 255, `${JSON.stringify(g)} constrained has no transparent pixel`);
    }
  }
});

// ---------------- Crop ----------------
const coords = (w, h) => make(w, h, (x, y) => [x, y, 0]); // pixel value encodes its own position
test('crop rectangle, flips and quarter turns map pixels exactly', () => {
  const img = coords(200, 100);
  let o = D.applyCrop(img, { x: 0.25, y: 0.2, w: 0.5, h: 0.5 });
  assert.deepEqual([o.w, o.h], [100, 50]); assert.deepEqual(px(o, 0, 0).slice(0, 2), [50, 20]); assert.deepEqual(px(o, 99, 49).slice(0, 2), [149, 69]);
  o = D.applyCrop(img, { x: 0.25, y: 0.2, w: 0.5, h: 0.5, flipH: true }); assert.deepEqual(px(o, 0, 0).slice(0, 2), [149, 20]);
  o = D.applyCrop(img, { x: 0.25, y: 0.2, w: 0.5, h: 0.5, flipV: true }); assert.deepEqual(px(o, 0, 0).slice(0, 2), [50, 69]);
  o = D.applyCrop(img, { x: 0.25, y: 0.2, w: 0.5, h: 0.5, rotate90: 1 });
  assert.deepEqual([o.w, o.h], [50, 100]); assert.deepEqual(px(o, 49, 0).slice(0, 2), [50, 20], 'clockwise: top-left goes to top-right'); assert.deepEqual(px(o, 0, 0).slice(0, 2), [50, 69]);
  o = D.applyCrop(img, { x: 0.25, y: 0.2, w: 0.5, h: 0.5, rotate90: 2 }); assert.deepEqual([o.w, o.h], [100, 50]); assert.deepEqual(px(o, 0, 0).slice(0, 2), [149, 69]);
  o = D.applyCrop(img, { x: 0.25, y: 0.2, w: 0.5, h: 0.5, rotate90: 3 }); assert.deepEqual([o.w, o.h], [50, 100]); assert.deepEqual(px(o, 0, 0).slice(0, 2), [149, 20]);
  o = D.applyCrop(img, { x: 0.25, y: 0.2, w: 0.5, h: 0.5, rotate90: 1, flipH: true }); assert.deepEqual(px(o, 49, 0).slice(0, 2), [149, 20], 'flip happens before the quarter turn');
  assert.deepEqual(D.applyCrop(img, D.CROP_DEFAULTS).data, img.data);
});

test('straighten: rotation about the image centre, fit inside, aspect presets', () => {
  const img = coords(201, 201), c = { x: 0.3, y: 0.3, w: 0.4, h: 0.4, angle: 10 }, r = D.cropSettingsToRect(c, 201, 201);
  const o = D.applyCrop(img, c);
  assert.deepEqual([o.w, o.h], [80, 80]);
  // output pixel → source position: rotate by −10° about the image centre
  const a = -10 * Math.PI / 180;
  for (const [x, y] of [[0, 0], [79, 0], [40, 40], [10, 70]]) {
    const qx = 0.3 * 201 + (x + 0.5) * 80.4 / 80, qy = 0.3 * 201 + (y + 0.5) * 80.4 / 80, dx = qx - 100.5, dy = qy - 100.5;
    const sx = 100.5 + dx * Math.cos(a) - dy * Math.sin(a), sy = 100.5 + dx * Math.sin(a) + dy * Math.cos(a), v = px(o, x, y);
    assert.ok(Math.abs(v[0] - (sx - 0.5)) < 0.6 && Math.abs(v[1] - (sy - 0.5)) < 0.6, `(${x},${y}) → ${v} vs ${sx},${sy}`);
    const m = D.mat3Apply(r.matrix, x + 0.5, y + 0.5); assert.ok(Math.abs(m[0] - sx) < 1e-9 && Math.abs(m[1] - sy) < 1e-9);
  }
  const full = { ...D.CROP_DEFAULTS, angle: 12 };
  assert.equal(D.cropInside(full, 300, 200), false);
  const fit = D.fitCropToAngle(full, 300, 200); assert.ok(D.cropInside(fit, 300, 200) && fit.w > 0.6 && Math.abs(fit.w * 300 / (fit.h * 200) - 1.5) < 1e-6, 'fitted, aspect kept');
  const out = D.applyCrop(make(300, 200, () => [9, 9, 9]), fit); let min = 255; for (let i = 3; i < out.data.length; i += 4) min = Math.min(min, out.data[i]); assert.equal(min, 255);
  const sq = D.applyAspectToCrop(D.CROP_DEFAULTS, 1, 300, 200); assert.ok(Math.abs(sq.w * 300 - sq.h * 200) < 1e-6 && Math.abs(sq.h - 1) < 1e-9);
  assert.equal(D.cropAspectRatio({ aspect: 'original', lockAspect: true }, 300, 200), 1.5);
  assert.equal(D.cropAspectRatio({ aspect: '4:5', lockAspect: true, aspectSwap: true }, 300, 200), 5 / 4);
  assert.equal(D.cropAspectRatio({ aspect: '4:5', lockAspect: false }, 300, 200), null);
  assert.deepEqual(D.ASPECT_PRESETS.map(p => p.label), ['Original', 'As Shot', '1 : 1', '4 : 5', '5 : 7', '2 : 3', '3 : 4', '16 : 9', '9 : 16', 'Custom']);
  // auto straighten + crop levels a tilted horizon
  const tilted = horizon(400, 300, 4), ang = D.autoStraightenAngle(tilted);
  const lv = D.applyCrop(tilted, D.fitCropToAngle({ ...D.CROP_DEFAULTS, angle: ang }, 400, 300));
  assert.ok(Math.abs(longestNear(D.detectLines(lv), true).angle) < 0.5);
});

// ---------------- Spots ----------------
const gradient = (w, h) => make(w, h, (x, y) => [40 + x, 80 + y / 2, 150 - x / 3]);
const withDot = (b, cx, cy, r, col = [10, 10, 10]) => { const o = { w: b.w, h: b.h, data: new Uint8ClampedArray(b.data) }; for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) < r) o.data.set(col, (y * b.w + x) * 4); return o; };
const maxErr = (a, b, cx, cy, r) => { let m = 0; for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) < r) for (let c = 0; c < 3; c++) m = Math.max(m, Math.abs(a.data[(y * a.w + x) * 4 + c] - b.data[(y * a.w + x) * 4 + c])); return m; };

test("spots: 'remove' removes a dot on a smooth gradient", () => {
  const clean = gradient(160, 120), img = withDot(clean, 80, 60, 5);
  const spot = { mode: 'remove', points: [0.5, 0.5], size: 16 / 160, feather: 0, opacity: 100 };
  const out = D.applySpots(img, [spot]);
  const e = maxErr(out, clean, 80, 60, 9);
  assert.ok(e <= 2, `residual ${e}`);
  // on a striped texture the stripes are continued through the removed area
  const stripes = make(160, 120, x => x % 8 < 4 ? [200, 180, 160] : [60, 70, 80]), sd = withDot(stripes, 80, 60, 5, [255, 0, 0]);
  const so = D.applySpots(sd, [spot]);
  let bad = 0, n = 0; for (let y = 55; y < 65; y++) for (let x = 75; x < 85; x++) { if (Math.hypot(x + 0.5 - 80, y + 0.5 - 60) >= 5) continue; n++; if (Math.abs(so.data[(y * 160 + x) * 4] - stripes.data[(y * 160 + x) * 4]) > 40) bad++; }
  assert.ok(bad / n < 0.15, `stripe texture continued (${bad}/${n} off)`);
  assert.deepEqual(D.applySpots(img, [spot]).data, out.data, 'deterministic');
  assert.deepEqual(px(out, 5, 5), px(img, 5, 5), 'outside untouched');
});

test("spots: 'heal' matches colour to the destination, 'clone' copies", () => {
  // textured gradient: heal from a far source keeps texture and adapts the colour level
  const tex = (x, y) => ((x * 7 + y * 13) % 5) * 3;
  const clean = make(160, 120, (x, y) => [40 + x + tex(x, y), 80 + y / 2 + tex(x, y), 150 - x / 3]), img = withDot(clean, 80, 60, 6, [250, 20, 20]);
  const healSpot = { mode: 'heal', points: [0.5, 0.5], size: 18 / 160, feather: 0, opacity: 100, source: { dx: -40 / 160, dy: 0 } };
  const healed = D.applySpots(img, [healSpot]);
  let err = 0, n = 0; for (let y = 54; y < 66; y++) for (let x = 74; x < 86; x++) { if (Math.hypot(x + 0.5 - 80, y + 0.5 - 60) >= 6) continue; err += Math.abs(healed.data[(y * 160 + x) * 4] - clean.data[(y * 160 + x) * 4]); n++; }
  assert.ok(err / n < 4, `heal mean error ${err / n}`);
  const cloned = D.applySpots(img, [{ ...healSpot, mode: 'clone' }]);
  assert.deepEqual(px(cloned, 80, 60), px(img, 40, 60), 'clone = exact copy from the source');
  assert.ok(Math.abs(px(cloned, 80, 60)[0] - px(clean, 80, 60)[0]) > 30, 'clone does not adapt colour');
  // heal on a pure gradient reproduces it exactly (lighting difference absorbed by the membrane)
  const g = gradient(160, 120), gh = D.applySpots(withDot(g, 80, 60, 6), [{ ...healSpot, source: { dx: -40 / 160, dy: 20 / 120 } }]);
  assert.ok(maxErr(gh, g, 80, 60, 9) <= 2, `heal residual ${maxErr(gh, g, 80, 60, 9)}`);
  // opacity 50 → halfway between original and the clone
  const half = D.applySpots(img, [{ ...healSpot, mode: 'clone', opacity: 50 }]);
  assert.ok(Math.abs(px(half, 80, 60)[0] - (px(img, 80, 60)[0] + px(img, 40, 60)[0]) / 2) <= 1);
  // feather: soft edge
  const soft = D.applySpots(img, [{ ...healSpot, mode: 'clone', feather: 100 }]);
  const edge = px(soft, 80 + 7, 60)[0], hardE = px(cloned, 80 + 7, 60)[0];
  assert.ok(edge !== hardE);
  // auto source on a horizontal gradient chooses a vertical shift (same colours)
  const mask = new Uint8Array(160 * 120); for (let y = 0; y < 120; y++) for (let x = 0; x < 160; x++) if (Math.hypot(x + 0.5 - 80, y + 0.5 - 60) < 8) mask[y * 160 + x] = 255;
  const s = D.findSpotSource(make(160, 120, x => [x, x, x]), mask);
  assert.ok(Math.abs(s.dx) < 1e-9 && Math.abs(s.dy) > 0.1, JSON.stringify(s));
  // auto source heal removes the dot on the gradient
  const auto = D.applySpots(withDot(g, 80, 60, 6), [{ ...healSpot, source: null }]);
  assert.ok(maxErr(auto, g, 80, 60, 9) <= 3);
  // a brushed stroke (multi-point path) covers a line
  const lineImg = make(160, 120, (x, y) => Math.abs(y - 60) < 2 && x > 40 && x < 120 ? [0, 0, 0] : [40 + x, 80 + y / 2, 150 - x / 3]);
  const st = D.applySpots(lineImg, [{ mode: 'heal', points: [40 / 160, 0.5, 80 / 160, 0.5, 120 / 160, 0.5], size: 10 / 160, feather: 0, opacity: 100, source: { dx: 0, dy: -20 / 120 } }]);
  assert.ok(maxErr(st, gradient(160, 120), 80, 60, 3) <= 3);
});

// ---------------- Resolution independence ----------------
test('same settings at two scales agree after resampling', () => {
  const big = make(400, 300, (x, y) => { const v = Math.sin(x / 23) * 60 + Math.cos(y / 17) * 50; return [128 + v, 128 - v / 2, 100 + y / 4]; });
  const small = resample(big, 200, 150, 'bilinear');
  const cmp = (fn, tol) => { const b = fn(small), A = fn(big), a = resample(A, b.w, b.h, 'bilinear'); assert.deepEqual([A.w / 2, A.h / 2], [b.w, b.h]); const e = meanAbs(a, b); assert.ok(e < tol, `mean diff ${e}`); };
  const g = { vertical: -30, horizontal: 15, rotate: 4, aspect: 20, scale: 110, offsetX: 10, offsetY: -5, constrainCrop: true };
  cmp(b => D.applyGeometry(b, D.geometryMatrix(g, b.w, b.h)), 2.5);
  cmp(b => D.applyCrop(b, { x: 0.1, y: 0.2, w: 0.6, h: 0.5, angle: 7, flipH: true, rotate90: 1 }), 2.5);
  const spots = [{ mode: 'clone', points: [0.3, 0.4, 0.5, 0.45], size: 0.05, feather: 50, opacity: 100, source: { dx: 0.2, dy: 0.1 } }, { mode: 'heal', points: [0.7, 0.7], size: 0.06, feather: 30, opacity: 80, source: { dx: -0.15, dy: -0.2 } }];
  cmp(b => D.applySpots(b, spots), 2.5);
  cmp(b => D.applyPointColor(b, { swatches: [{ ...D.samplePointColor(big, 0.5, 0.5, 0.02), hueShift: 60, satShift: 30 }] }), 1.5);
  // detected lines are in fractions, so Upright gives the same correction at both scales
  const t = horizon(400, 300, 3), ts = resample(t, 200, 150, 'bilinear');
  assert.ok(Math.abs(D.uprightSolve(D.detectLines(t), 'level', 4 / 3).rotate - D.uprightSolve(D.detectLines(ts), 'level', 4 / 3).rotate) < 0.3);
});
