import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beginPaint, applyDab, fillArea, createBuffer, BLEND_MODES, blendLum } from '../src/engine/raster.js';
import { gradientSampler, evalStops, GRADIENT_PRESETS } from '../src/engine/fill.js';
import { projectiveTransform } from '../src/engine/warp.js';
import {
  colorReplaceProcess, backgroundEraserProcess, magicErase, redEye, patternSource, makePattern, PATTERN_NAMES,
  historySource, historyProcess, contentAwareMove, perspectiveCropQuadToRect, perspectiveCrop, measure, straightenAngle, mixerProcess,
} from '../src/engine/tools2.js';
import { createLivewire } from '../src/engine/livewire.js';
import { rng } from '../src/engine/color.js';

const solid = (w, h, rgba) => { const b = createBuffer(w, h); for (let i = 0; i < w * h; i++) b.data.set(rgba, i * 4); return b; };
const px = (b, x, y) => Array.from(b.data.subarray((y * b.w + x) * 4, (y * b.w + x) * 4 + 4));
const near = (a, b, tol, msg) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) <= tol, `${msg}: got ${a} want ${b}`));

// ---------------------------------------------------------------- blend modes

const ref = {
  multiply: (b, s) => b * s, screen: (b, s) => b + s - b * s,
  overlay: (b, s) => b <= 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s),
  hardLight: (b, s) => s <= 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s),
  softLight: (b, s) => s <= 0.5 ? b - (1 - 2 * s) * b * (1 - b) : b + (2 * s - 1) * ((b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b)) - b),
  darken: Math.min, lighten: Math.max, difference: (b, s) => Math.abs(b - s), exclusion: (b, s) => b + s - 2 * b * s,
};

test('separable paint blend modes match the W3C formulas (opaque backdrop, full and half opacity)', () => {
  const B = [200, 100, 50, 255], S = [100, 150, 250];
  for (const [mode, f] of Object.entries(ref)) for (const op of [1, 0.5]) {
    const buf = solid(4, 4, B); fillArea(buf, { color: S, blend: mode, opacity: op });
    const want = [0, 1, 2].map(c => Math.round(f(B[c] / 255, S[c] / 255) * 255 * op + B[c] * (1 - op)));
    near(px(buf, 1, 1), [...want, 255], 1, mode + '@' + op);
  }
});

test('blend modes also apply on the source path and on partially transparent backdrops', () => {
  const B = [40, 200, 120, 128], S = [220, 60, 90];
  const a = solid(3, 3, B), b = solid(3, 3, B);
  fillArea(a, { color: S, blend: 'screen', opacity: 0.7 });
  fillArea(b, { source: (x, y, o) => { o[0] = S[0]; o[1] = S[1]; o[2] = S[2]; o[3] = 255; return o; }, blend: 'screen', opacity: 0.7 });
  assert.deepEqual(a.data, b.data);
  // W3C: co = sa·((1-ab)·Cs + ab·B) + (1-sa)·ab·Cb ; ao = sa + ab(1-sa)
  const sa = 0.7, ab = 128 / 255, ao = sa + ab * (1 - sa);
  const want = [0, 1, 2].map(c => { const cb = B[c] / 255, cs = S[c] / 255; return Math.round((sa * ((1 - ab) * cs + ab * ref.screen(cb, cs)) + (1 - sa) * ab * cb) / ao * 255); });
  near(px(a, 0, 0), [...want, Math.round(ao * 255)], 1, 'screen over half-alpha');
});

test("blend 'normal' is identical to omitting blend; every mode name is accepted", () => {
  const mk = () => { const b = solid(32, 32, [90, 30, 200, 160]); return b; };
  const a = mk(), b = mk();
  const ca = beginPaint(a, { color: [10, 250, 30], opacity: 0.8, hardness: 0.3 }), cb = beginPaint(b, { color: [10, 250, 30], opacity: 0.8, hardness: 0.3, blend: 'normal' });
  for (const d of [{ x: 10, y: 12, size: 15, flow: 0.6 }, { x: 14, y: 14, size: 15, flow: 0.6 }]) { applyDab(ca, d); applyDab(cb, d); }
  assert.deepEqual(a.data, b.data);
  assert.equal(BLEND_MODES.length, 16);
  for (const m of BLEND_MODES) { const t = solid(2, 2, [100, 100, 100, 255]); fillArea(t, { color: [200, 50, 20], blend: m }); }
});

test('non-separable modes: color keeps backdrop luminosity, luminosity takes source luminosity, hue/saturation', () => {
  const B = [180, 120, 60, 255], S = [30, 90, 230];
  const run = mode => { const b = solid(2, 2, B); fillArea(b, { color: S, blend: mode }); return px(b, 0, 0); };
  const L = c => blendLum([c[0] / 255, c[1] / 255, c[2] / 255]) * 255;
  const col = run('color'); assert.ok(Math.abs(L(col) - L(B)) < 1.5, 'color keeps lum'); assert.ok(col[2] > col[0], 'takes blue hue');
  const lu = run('luminosity'); assert.ok(Math.abs(L(lu) - L(S)) < 1.5, 'luminosity from source'); assert.ok(lu[0] > lu[2], 'keeps orange hue');
  const sat = run('saturation'); assert.ok(Math.abs(L(sat) - L(B)) < 1.5); assert.ok(sat[0] > sat[1] && sat[1] > sat[2], 'keeps hue order');
  const hue = run('hue'); assert.ok(Math.abs(L(hue) - L(B)) < 1.5); assert.ok(hue[2] > hue[1] && hue[1] > hue[0], 'takes source hue order');
  const grey = solid(2, 2, [128, 128, 128, 255]); fillArea(grey, { color: [255, 0, 0], blend: 'saturation' }); near(px(grey, 0, 0), [128, 128, 128, 255], 0, 'saturation on grey stays grey'); // grey backdrop has no hue
});

test('behind paints only under existing alpha, clear erases', () => {
  const b = createBuffer(3, 1); b.data.set([255, 0, 0, 255, 255, 0, 0, 128, 0, 0, 0, 0]);
  fillArea(b, { color: [0, 0, 255], blend: 'behind' });
  near(px(b, 0, 0), [255, 0, 0, 255], 0, 'opaque untouched');
  near(px(b, 2, 0), [0, 0, 255, 255], 0, 'transparent filled');
  const m = px(b, 1, 0); assert.equal(m[3], 255); assert.ok(m[0] > 120 && m[2] > 120, 'half pixel keeps red over blue: ' + m);
  const c = solid(2, 2, [10, 20, 30, 200]); fillArea(c, { color: [0, 0, 0], blend: 'clear', opacity: 0.5 });
  near(px(c, 0, 0), [10, 20, 30, 100], 0, 'clear halves alpha');
});

// ---------------------------------------------------------------- tip angle / roundness

const footprint = opts => { const b = createBuffer(64, 64), ctx = beginPaint(b, { color: [0, 0, 0], hardness: 1, ...opts }); applyDab(ctx, { x: 32, y: 32, size: 40 }); return b; };
test('roundness makes an elliptical dab along the tip angle', () => {
  const a = footprint({ roundness: 0.25, angle: 0 });
  assert.equal(px(a, 32 + 16, 32)[3], 255, 'long axis horizontal');
  assert.equal(px(a, 32, 32 + 10)[3], 0, 'short axis vertical');
  let n = 0; for (let i = 3; i < a.data.length; i += 4) n += a.data[i] / 255;
  assert.ok(Math.abs(n - Math.PI * 19.5 * 4.5) < 25, 'ellipse area ' + n); // ~½ px lost to the anti-aliased rim, like the round dab
  const v = footprint({ roundness: 0.25, angle: 90 });
  assert.equal(px(v, 32, 32 - 16)[3], 255); assert.equal(px(v, 32 + 10, 32)[3], 0);
  const d = footprint({ roundness: 0.25, angle: 45 }); // counter-clockwise: up-right on screen
  assert.equal(px(d, 32 + 11, 32 - 11)[3], 255); assert.equal(px(d, 32 + 11, 32 + 11)[3], 0);
});
test('roundness 1 is exactly the classic round dab whatever the angle', () => {
  assert.deepEqual(footprint({ roundness: 1, angle: 37, hardness: 0.4 }).data, footprint({ hardness: 0.4 }).data);
});

// ---------------------------------------------------------------- gradient stops

test('gradient stops interpolate colour and opacity, honour midpoints and reverse', () => {
  const stops = [{ at: 0, color: '#000000' }, { at: 0.5, color: '#ff0000' }, { at: 1, color: '#ffffff', opacity: 0 }];
  near(evalStops(stops, 0.25), [127.5, 0, 0, 255], 0.01, 'quarter');
  near(evalStops(stops, 0.75), [255, 127.5, 127.5, 127.5], 0.01, 'three quarters');
  near(evalStops([{ at: 1, color: '#ffffff' }, { at: 0, color: '#000000', mid: 0.25 }], 0.25), [127.5, 127.5, 127.5, 255], 0.01, 'midpoint (unsorted input)');
  const g = gradientSampler({ x0: 0, y0: 0, x1: 100, y1: 0, stops, dither: false }), o = [0, 0, 0, 0];
  near(g(24, 0, o).map(Math.round), [125, 0, 0, 255], 0, 'sampler t=.245');
  const r = gradientSampler({ x0: 0, y0: 0, x1: 100, y1: 0, stops, dither: false, reverse: true });
  assert.ok(r(1, 0, o)[3] < 10 && r(99, 0, [0, 0, 0, 0])[3] === 255, 'reversed');
});
test('gradient presets are well formed', () => {
  assert.equal(GRADIENT_PRESETS.length, 8);
  for (const p of GRADIENT_PRESETS) { assert.ok(p.name && p.stops.length >= 2); for (const s of p.stops) assert.ok(s.at >= 0 && s.at <= 1 && /^#[0-9a-f]{6}$/.test(s.color)); }
  const stripes = GRADIENT_PRESETS.find(p => p.name === 'Transparent Stripes');
  assert.equal(evalStops(stripes.stops, 0.05)[3], 255); assert.equal(evalStops(stripes.stops, 0.15)[3], 0);
});

// ---------------------------------------------------------------- color replacement / background eraser

test('colour replacement recolours pixels near the sample and keeps their luminosity', () => {
  const b = createBuffer(2, 1); b.data.set([200, 40, 40, 255, 40, 180, 40, 255]);
  fillArea(b, { process: colorReplaceProcess({ color: [0, 0, 255], mode: 'color', tolerance: 40, sample: [200, 40, 40] }) });
  const r = px(b, 0, 0), L = c => blendLum(c.map(v => v / 255)) * 255;
  assert.ok(r[2] > r[0] && r[2] > r[1], 'now blue: ' + r);
  assert.ok(Math.abs(L(r) - L([200, 40, 40])) < 1.5, 'luminosity kept');
  near(px(b, 1, 0), [40, 180, 40, 255], 0, 'far colour untouched');
  const l = createBuffer(1, 1); l.data.set([200, 40, 40, 255]);
  fillArea(l, { process: colorReplaceProcess({ color: [255, 255, 255], mode: 'luminosity', tolerance: 40, sample: [200, 40, 40] }) });
  assert.ok(Math.abs(L(px(l, 0, 0)) - 255) < 2, 'luminosity mode takes the brightness');
});

test('background eraser removes only colours near the sample and respects the protected colour', () => {
  const b = createBuffer(4, 1); b.data.set([250, 250, 250, 255, 235, 240, 245, 255, 20, 60, 200, 255, 245, 245, 245, 255]);
  const proc = backgroundEraserProcess({ sample: [250, 250, 250], tolerance: 30 });
  fillArea(b, { process: proc });
  assert.equal(px(b, 0, 0)[3], 0); assert.equal(px(b, 1, 0)[3], 0, 'within tolerance');
  near(px(b, 2, 0), [20, 60, 200, 255], 0, 'subject kept');
  const c = createBuffer(2, 1); c.data.set([250, 250, 250, 255, 240, 240, 240, 255]);
  fillArea(c, { process: backgroundEraserProcess({ sample: [250, 250, 250], tolerance: 30, protectForeground: [240, 240, 240] }) });
  assert.equal(px(c, 1, 0)[3], 255, 'protected');
});

// ---------------------------------------------------------------- magic eraser

test('magic eraser clears the contiguous (or global) matching region only', () => {
  const b = solid(20, 10, [0, 0, 0, 255]);
  for (let y = 2; y < 6; y++) for (const x0 of [2, 12]) for (let x = x0; x < x0 + 4; x++) b.data.set([255, 255, 255, 255], (y * 20 + x) * 4);
  const c = magicErase(b, 3, 3, { tolerance: 10, antiAlias: false });
  assert.equal(px(c, 3, 3)[3], 0); assert.equal(px(c, 13, 3)[3], 255, 'other square kept'); assert.equal(px(c, 0, 0)[3], 255);
  const g = magicErase(b, 3, 3, { tolerance: 10, contiguous: false, antiAlias: false });
  assert.equal(px(g, 13, 3)[3], 0);
  const h = magicErase(b, 3, 3, { tolerance: 10, antiAlias: false, opacity: 0.5 }); assert.equal(px(h, 3, 3)[3], 128);
  assert.equal(px(b, 3, 3)[3], 255, 'input untouched');
});

// ---------------------------------------------------------------- red eye

test('red eye reduces red only in red pupils inside the rect', () => {
  const b = solid(80, 40, [220, 170, 140, 255]);
  for (const cx of [20, 60]) for (let y = 0; y < 40; y++) for (let x = 0; x < 80; x++) if (Math.hypot(x + 0.5 - cx, y + 0.5 - 20) < 6) b.data.set([200, 30, 35, 255], (y * 80 + x) * 4);
  const o = redEye(b, { x: 12, y: 12, w: 16, h: 16 }, { pupilSize: 50, darken: 50 });
  const c = px(o, 20, 20); assert.ok(c[0] < 60, 'pupil no longer red: ' + c); assert.ok(Math.abs(c[0] - (c[1] + c[2]) / 2) < 12, 'neutral');
  near(px(o, 14, 14), [220, 170, 140, 255], 0, 'skin in rect untouched');
  near(px(o, 60, 20), [200, 30, 35, 255], 0, 'other eye untouched');
});

// ---------------------------------------------------------------- pattern stamp

test('pattern tiles repeat and anchor as requested', () => {
  for (const n of PATTERN_NAMES) { const t = makePattern(n, { size: 8 }); assert.ok(t.w >= 8 && t.h === 8 && t.data.length === t.w * t.h * 4); }
  const t = makePattern('checker', { size: 8 }), o = [0, 0, 0, 0], q = [0, 0, 0, 0];
  const s = patternSource(t, 0, 0, true);
  for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) assert.deepEqual(s(x, y, o), s(x + 8, y + 16, q).slice());
  assert.notDeepEqual(s(0, 0, o).slice(), s(4, 0, q).slice());
  const al = patternSource(t, 3, 5, true); assert.deepEqual(al(0, 0, o).slice(), [...t.data.subarray((5 * 8 + 3) * 4, (5 * 8 + 3) * 4 + 4)]);
  const na = patternSource(t, 3, 5, false); assert.deepEqual(na(3, 5, o).slice(), [...t.data.subarray(0, 4)]);
  const buf = createBuffer(16, 16); fillArea(buf, { source: s });
  assert.deepEqual(px(buf, 1, 1), px(buf, 9, 9));
});

// ---------------------------------------------------------------- history brush

test('history brush restores the snapshot (process restores transparency too)', () => {
  const snap = solid(8, 8, [10, 200, 30, 255]); snap.data.set([0, 0, 0, 0], 0);
  const cur = solid(8, 8, [250, 0, 0, 255]);
  fillArea(cur, { process: historyProcess(snap) });
  near(px(cur, 3, 3), [10, 200, 30, 255], 0, 'restored'); assert.equal(px(cur, 0, 0)[3], 0, 'transparency restored');
  const c2 = solid(8, 8, [250, 0, 0, 255]); fillArea(c2, { source: historySource(snap, 1, 0), opacity: 0.5 });
  near(px(c2, 7, 0), [250, 0, 0, 255], 0, 'outside snapshot → nothing');
  near(px(c2, 3, 3), [130, 100, 15, 255], 1, 'half-opacity over');
});

// ---------------------------------------------------------------- content-aware move

test('content-aware move moves the patch and rebuilds the vacated area', () => {
  const W = 72, H = 48, b = createBuffer(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = (x >> 2) % 2 ? 210 : 50; b.data.set([v, v, v, 255], (y * W + x) * 4); }
  const mask = new Uint8Array(W * H);
  for (let y = 18; y < 28; y++) for (let x = 10; x < 20; x++) { mask[y * W + x] = 255; b.data.set([230, 20, 20, 255], (y * W + x) * 4); }
  const o = contentAwareMove(b, mask, 32, 0, { mode: 'move', adaptation: 3 });
  for (let y = 20; y < 26; y++) for (let x = 44; x < 50; x++) { const c = px(o, x, y); assert.ok(c[0] > 150 && c[1] < 110, 'patch at destination ' + c); }
  let red = 0; for (let y = 18; y < 28; y++) for (let x = 10; x < 20; x++) { const c = px(o, x, y); if (c[0] > 150 && c[1] < 110) red++; }
  assert.equal(red, 0, 'hole no longer the object colour');
  near(px(o, 66, 4), px(b, 66, 4), 0, 'far pixels untouched');
  const e = contentAwareMove(b, mask, 32, 0, { mode: 'extend' });
  near(px(e, 14, 22), [230, 20, 20, 255], 0, 'extend keeps the source');
  assert.ok(px(e, 46, 22)[0] > 150 && px(e, 46, 22)[1] < 110);
});

// ---------------------------------------------------------------- perspective crop

test('perspective crop rectifies a skewed checkerboard', () => {
  const S = 128, board = createBuffer(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const v = ((x >> 4) + (y >> 4)) % 2 ? 255 : 0; board.data.set([v, v, v, 255], (y * S + x) * 4); }
  const quad = [[30, 20], [190, 45], [170, 160], [10, 140]], warped = projectiveTransform(board, quad);
  const q = quad.map(([x, y]) => [x - warped.x, y - warped.y]);
  const geo = perspectiveCropQuadToRect(q, S, S); assert.equal(geo.w, S); assert.equal(geo.matrix.length, 9);
  const auto = perspectiveCropQuadToRect([[0, 0], [100, 0], [100, 50], [0, 50]]); assert.deepEqual([auto.w, auto.h], [100, 50]);
  const out = perspectiveCrop(warped, q, S, S);
  let bad = 0, n = 0;
  for (let y = 2; y < S - 2; y++) for (let x = 2; x < S - 2; x++) {
    if (x % 16 < 2 || x % 16 > 13 || y % 16 < 2 || y % 16 > 13) continue; // skip pixels next to square edges
    n++; if (Math.abs(out.data[(y * S + x) * 4] - board.data[(y * S + x) * 4]) > 60) bad++;
  }
  assert.ok(bad / n < 0.01, 'mismatch ' + bad + '/' + n);
  // straight vertical edge: in every row the 0→255 transition of the first square sits at x≈16
  for (let y = 4; y < 12; y++) { let t = -1; for (let x = 8; x < 24; x++) if (out.data[(y * S + x) * 4] > 127) { t = x; break; } assert.ok(Math.abs(t - 16) <= 1, 'row ' + y + ' edge at ' + t); }
});

// ---------------------------------------------------------------- ruler / straighten

test('ruler measure uses Photoshop angles and straighten picks the nearest axis', () => {
  const m = measure(0, 0, 10, -10); assert.ok(Math.abs(m.angle - 45) < 1e-9 && Math.abs(m.length - Math.SQRT2 * 10) < 1e-9);
  assert.equal(measure(0, 0, -10, 0).angle, 180); assert.equal(measure(0, 0, 0, 10).angle, -90);
  const a = Math.atan2(10, 100) * 180 / Math.PI;
  assert.ok(Math.abs(straightenAngle(0, 0, 100, -10) + a) < 1e-9, 'rising line → rotate clockwise');
  assert.ok(Math.abs(straightenAngle(0, 0, 100, 10) - a) < 1e-9);
  assert.ok(Math.abs(straightenAngle(0, 0, 10, 100) + a) < 1e-9, 'near-vertical line straightened to vertical');
  assert.ok(Math.abs(straightenAngle(100, 0, 0, 10) + a) < 1e-9, 'direction of drawing does not matter');
  assert.equal(straightenAngle(0, 0, 50, 0), 0);
});

// ---------------------------------------------------------------- mixer brush

test('mixer brush: dry = plain paint, wet picks up canvas colour, low load runs dry', () => {
  const dry = mixerProcess({ wet: 0, load: 100, mix: 0, color: [0, 0, 255] }), b = solid(2, 2, [255, 0, 0, 255]);
  fillArea(b, { process: dry.process }); near(px(b, 0, 0), [0, 0, 255, 255], 0, 'dry brush paints its colour');
  const wet = mixerProcess({ wet: 100, load: 50, mix: 100, color: [0, 0, 255] });
  wet.update([255, 0, 0]);
  assert.ok(wet.state.paint[0] > 200, 'picked up red'); assert.ok(wet.state.color[0] > 100, 'reservoir contaminated');
  const c = solid(2, 2, [255, 0, 0, 255]); fillArea(c, { process: wet.process }); assert.ok(px(c, 0, 0)[0] > 200, 'smears canvas colour');
  const low = mixerProcess({ wet: 0, load: 1, mix: 50, color: [0, 255, 0] });
  const t1 = createBuffer(1, 1); fillArea(t1, { process: low.process }); assert.equal(t1.data[3], 255, 'fresh load deposits');
  for (let i = 0; i < 5; i++) low.update([0, 0, 0]);
  assert.equal(low.state.amount, 0);
  const t2 = createBuffer(1, 1); fillArea(t2, { process: low.process }); assert.equal(t2.data[3], 0, 'empty brush deposits nothing');
  low.reset(); assert.equal(low.state.amount, 1);
});

// ---------------------------------------------------------------- livewire

function edgeImage(W, H, E, seed = 3) {
  const d = new Uint8ClampedArray(W * H * 4), r = rng(seed);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = (x < E(y) ? 60 : 190) + r() * 30 - 15, p = (y * W + x) * 4; d[p] = d[p + 1] = d[p + 2] = v; d[p + 3] = 255; }
  return { w: W, h: H, data: d };
}

test('livewire snaps to a strong step edge and stays within 1 px of it', () => {
  const E = y => 120 + Math.round(25 * Math.sin(y / 30)), img = edgeImage(300, 260, E);
  const lw = createLivewire(img, { width: 10, contrast: 10, frequency: 57 });
  const a = lw.setAnchor(E(20) + 6, 20); assert.ok(Math.abs(a[0] - E(20)) <= 1, 'anchor snapped ' + a);
  const path = lw.pathTo(E(230) - 7, 230);
  assert.deepEqual(path[0], a); assert.ok(Math.abs(path.at(-1)[1] - 230) <= 10 && Math.abs(path.at(-1)[0] - E(path.at(-1)[1])) <= 1, 'end snapped to the edge');
  for (const [x, y] of path) assert.ok(x - E(y) >= -2 && x - E(y) <= 1, `(${x},${y}) edge ${E(y)}`);
  for (let i = 1; i < path.length; i++) assert.ok(Math.abs(path[i][0] - path[i - 1][0]) <= 1 && Math.abs(path[i][1] - path[i - 1][1]) <= 1, '8-connected');
});

test('livewire auto anchors on a stable prefix, commits segments and closes a polygon', () => {
  const W = 200, H = 200, d = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = x >= 50 && x < 150 && y >= 50 && y < 150 ? 220 : 30; d.set([v, v, v, 255], (y * W + x) * 4); }
  const lw = createLivewire({ w: W, h: H, data: d }, { frequency: 100 });
  lw.setAnchor(52, 50);
  let auto = null;
  for (let y = 60; y <= 140 && !auto; y += 10) { const p = lw.pathTo(146, y); auto = lw.autoAnchor(p); }
  assert.ok(auto, 'auto anchor found'); assert.ok(auto[0] >= 147 || auto[1] <= 51, 'on the square edge: ' + auto);
  lw.setAnchor(auto[0], auto[1], { snap: false });
  lw.setAnchor(150, 150);
  assert.equal(lw.anchors().length, 3);
  assert.equal(lw.removeLastAnchor()[0], auto[0]); lw.setAnchor(150, 150);
  const poly = lw.close();
  assert.ok(poly.length > 300, 'traced the square outline: ' + poly.length);
  for (const [x, y] of poly) assert.ok(Math.min(Math.abs(x - 49.5), Math.abs(x - 149.5), Math.abs(y - 49.5), Math.abs(y - 149.5)) <= 1.5, 'on boundary ' + x + ',' + y);
});

test('livewire pathTo meets the timing budget on 2000×1500 with a 300 px span', () => {
  const E = y => 700 + Math.round(40 * Math.sin(y / 60)), img = edgeImage(2000, 1500, E);
  const times = [];
  for (let k = 0; k < 4; k++) {
    const lw = createLivewire(img); lw.setAnchor(E(400 + k), 400 + k);
    const t = performance.now(); const p = lw.pathTo(E(700 + k) - 5, 700 + k); times.push(performance.now() - t);
    assert.ok(p.length >= 280, 'path length ' + p.length);
  }
  times.shift(); times.sort((a, b) => a - b); // first run warms the JIT
  console.log('livewire pathTo ms:', times.map(t => t.toFixed(1)).join(', '));
  assert.ok(times[1] < 30, 'median ' + times[1].toFixed(1) + ' ms');
});
