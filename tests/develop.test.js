import { test } from 'node:test';
import assert from 'node:assert/strict';
import { develop, developDefaults, autoWhiteBalance, autoTone, wbFromRgb, guided } from '../src/engine/develop.js';

const mk = (w, h, f) => { const d = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = f(x, y); d.set([v[0], v[1], v[2], v[3] ?? 255], (y * w + x) * 4); } return { w, h, data: d }; };
const copy = b => ({ w: b.w, h: b.h, data: new Uint8ClampedArray(b.data) });
const run = (b, s, ctx) => develop(copy(b), s, ctx);
const at = (b, x, y) => [...b.data.slice((y * b.w + x) * 4, (y * b.w + x) * 4 + 4)];
const maxDiff = (a, b) => { let m = 0; for (let i = 0; i < a.data.length; i++) m = Math.max(m, Math.abs(a.data[i] - b.data[i])); return m; };
const meanL = (b, x0 = 0, y0 = 0, x1 = b.w, y1 = b.h) => { let s = 0, n = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const p = at(b, x, y); s += 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]; n++; } return s / n; };
const std = (b, x0, y0, x1, y1) => { const m = meanL(b, x0, y0, x1, y1); let s = 0, n = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const p = at(b, x, y); s += (0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2] - m) ** 2; n++; } return Math.sqrt(s / n); };

// photo-like fixture: smooth gradient sky, textured "fabric" patch, flat patch, edges, partial alpha
const photo = mk(96, 64, (x, y) => {
  if (x < 6 && y < 6) return [120, 120, 120, 128];
  if (y < 20) return [90 + x, 130 + x / 2, 200, 255];
  if (x < 32) return [128, 128, 128, 255]; // flat patch
  if (x < 64) { const t = ((x * 7 + y * 13) % 9) * 6 + ((x >> 2) + (y >> 2)) % 2 * 24; return [100 + t, 80 + t, 60 + t, 255]; } // texture
  return x < 80 ? [30, 30, 30, 255] : [230, 230, 230, 255];
});

test('develop: defaults are the identity (alpha untouched)', () => {
  assert.equal(maxDiff(run(photo, {}), photo), 0);
  assert.equal(maxDiff(run(photo, developDefaults()), photo), 0);
});

test('develop: exposure +1 EV doubles linear light; temperature warms; auto WB neutralises a cast', () => {
  const g = mk(4, 4, () => [128, 128, 128]);
  assert.equal(at(run(g, { exposure: 1 }), 1, 1)[0], 176);
  const warm = at(run(g, { temp: 50 }), 1, 1); assert.ok(warm[0] > warm[2] + 20);
  const cast = mk(8, 8, () => [150, 128, 100]);
  const fixed = at(run(cast, autoWhiteBalance(cast)), 3, 3);
  assert.ok(Math.abs(fixed[0] - fixed[2]) < 12 && Math.abs(fixed[1] - fixed[0]) < 12, 'neutral after auto WB: ' + fixed);
  const n = wbFromRgb(0.2, 0.2, 0.2); assert.deepEqual([n.temp, n.tint], [0, 0]);
});

test('develop: Texture changes fabric detail without changing flat-patch brightness; Clarity differs from Texture', () => {
  const t = run(photo, { texture: 80 }), c = run(photo, { clarity: 80 });
  assert.ok(std(t, 36, 26, 60, 60) > std(photo, 36, 26, 60, 60) * 1.05, 'texture boosts fabric detail');
  assert.ok(Math.abs(meanL(t, 4, 26, 28, 60) - meanL(photo, 4, 26, 28, 60)) < 0.6, 'flat patch unchanged');
  const neg = run(photo, { texture: -80 }); assert.ok(std(neg, 36, 26, 60, 60) < std(photo, 36, 26, 60, 60), 'negative texture smooths');
  assert.ok(maxDiff(t, c) > 3, 'texture and clarity differ measurably');
});

test('develop: Dehaze raises contrast of a hazy scene; negative dehaze lowers it; no new clipping', () => {
  const hazy = mk(64, 48, (x, y) => { const v = 150 + ((x >> 3) + (y >> 3)) % 2 * 30; return [v, v + 5, v + 12]; });
  const d = run(hazy, { dehaze: 70 }), nd = run(hazy, { dehaze: -70 });
  assert.ok(std(d, 0, 0, 64, 48) > std(hazy, 0, 0, 64, 48) * 1.2, 'dehaze adds contrast');
  assert.ok(std(nd, 0, 0, 64, 48) < std(hazy, 0, 0, 64, 48), 'negative dehaze adds haze');
});

test('develop: grain amount 0 is identity; seeded and deterministic; size and roughness change structure; zero-mean', () => {
  const g = mk(64, 64, () => [128, 128, 128]);
  assert.equal(maxDiff(run(g, { grainAmount: 0, grainSize: 80 }), g), 0);
  const a = run(g, { grainAmount: 60 }), b = run(g, { grainAmount: 60 });
  assert.equal(maxDiff(a, b), 0);
  assert.ok(Math.abs(meanL(a) - 128) < 2, 'zero-mean grain');
  assert.ok(maxDiff(a, run(g, { grainAmount: 60, grainSize: 90 })) > 3, 'size changes structure');
  assert.ok(maxDiff(a, run(g, { grainAmount: 60, grainRoughness: 0 })) > 3, 'roughness changes structure');
  // document-space: the same document pixel gets the same grain at preview scale 1 with an offset buffer
  const crop = mk(16, 16, () => [128, 128, 128]); const c = run(crop, { grainAmount: 60 }, { offsetX: 10, offsetY: 20 });
  assert.deepEqual(at(c, 3, 4), at(a, 13, 24));
});

test('develop: vignette darkens corners, not the centre; highlight protection reduces it on bright pixels', () => {
  const g = mk(80, 60, () => [180, 180, 180]), v = run(g, { vignetteAmount: -80 });
  assert.ok(at(v, 1, 1)[0] < 120 && Math.abs(at(v, 40, 30)[0] - 180) <= 2);
  const w = mk(80, 60, () => [250, 250, 250]);
  assert.ok(at(run(w, { vignetteAmount: -80, vignetteHighlights: 100 }), 1, 1)[0] > at(run(w, { vignetteAmount: -80 }), 1, 1)[0]);
});

test('develop: highlights/shadows/whites/blacks/contrast move the right tones', () => {
  const ramp = mk(256, 4, x => [x, x, x]);
  assert.ok(at(run(ramp, { shadows: 80 }), 30, 1)[0] > 40);
  assert.ok(at(run(ramp, { highlights: -80 }), 235, 1)[0] < 230);
  const c = run(ramp, { contrast: 60 }); assert.ok(at(c, 60, 1)[0] < 60 && at(c, 200, 1)[0] > 200);
  assert.ok(at(run(ramp, { blacks: -60 }), 20, 1)[0] < 20);
});

test('develop: curves, HSL mixer, monochrome profile, color grading, calibration', () => {
  const g = mk(4, 4, () => [128, 128, 128]);
  const inv = run(g, { curve: { ...developDefaults().curve, rgb: [[0, 255], [255, 0]] } }); assert.equal(at(inv, 0, 0)[0], 127);
  const red = mk(4, 4, () => [200, 40, 40]);
  const desat = run(red, { mixer: { ...developDefaults().mixer, sat: { ...developDefaults().mixer.sat, red: -100 } } });
  assert.ok(at(desat, 0, 0)[0] - at(desat, 0, 0)[1] < 40);
  const mono = at(run(red, { profile: 'monochrome' }), 0, 0); assert.ok(mono[0] === mono[1] && mono[1] === mono[2]);
  const graded = at(run(g, { grading: { ...developDefaults().grading, global: { hue: 220, sat: 80, lum: 0 } } }), 0, 0); assert.ok(graded[2] > graded[0] + 10);
  assert.ok(maxDiff(run(red, { calibration: { ...developDefaults().calibration, redHue: 60 } }), red) > 5);
  assert.ok(at(run(g, { profile: 'neutral' }), 0, 0)[0] === 128, 'neutral profile keeps mid grey');
});

test('develop: noise reduction lowers noise but keeps a hard edge; sharpening steepens an edge', () => {
  const noisy = mk(64, 32, (x, y) => { const base = x < 32 ? 60 : 190, n = ((x * 31 + y * 17) % 13) - 6; return [base + n * 3, base + n * 3, base + n * 3]; });
  const nr = run(noisy, { nrLuminance: 80 });
  assert.ok(std(nr, 4, 4, 28, 28) < std(noisy, 4, 4, 28, 28) * 0.7, 'noise reduced');
  assert.ok(at(nr, 36, 16)[0] - at(nr, 27, 16)[0] > 100, 'edge kept');
  const edge = mk(40, 8, x => x < 20 ? [80, 80, 80] : [170, 170, 170]);
  const sh = run(edge, { sharpenAmount: 100, sharpenRadius: 1.5, sharpenDetail: 100 });
  assert.ok(at(sh, 18, 4)[0] < 80 && at(sh, 21, 4)[0] > 170);
  const chroma = mk(32, 32, (x, y) => [128 + ((x + y) % 2) * 30, 128, 128 - ((x + y) % 2) * 30]);
  const cn = run(chroma, { nrColor: 100 });
  assert.ok(Math.abs(at(cn, 10, 10)[0] - at(cn, 11, 10)[0]) < Math.abs(at(chroma, 10, 10)[0] - at(chroma, 11, 10)[0]));
});

test('develop: Remove chromatic aberration re-aligns R and B to G; defringe desaturates purple fringes', () => {
  // radial edges with red scaled outward and blue inward by 0.4 %
  const W = 200, H = 160, cx = W / 2, cy = H / 2;
  const ring = s => (x, y) => { const r = Math.hypot((x + 0.5 - cx) / s, (y + 0.5 - cy) / s); return 128 + 100 * Math.sin(r / 2.5); };
  const fr = ring(1.01), fg = ring(1), fb = ring(0.99);
  const img = mk(W, H, (x, y) => [fr(x, y), fg(x, y), fb(x, y)]);
  const fringe = b => { let s = 0; for (let i = 0; i < b.data.length; i += 4) s += Math.abs(b.data[i] - b.data[i + 1]) + Math.abs(b.data[i + 2] - b.data[i + 1]); return s; };
  assert.ok(fringe(run(img, { removeCA: true })) < fringe(img) * 0.6, `CA removed ${fringe(run(img, { removeCA: true }))} vs ${fringe(img)}`);
  const purple = mk(40, 10, x => x < 18 ? [20, 20, 20] : x < 21 ? [150, 40, 200] : [235, 235, 235]);
  const df = at(run(purple, { defringePurple: 20 }), 19, 5); assert.ok(Math.abs(df[0] - df[2]) < 40, 'purple fringe neutralised: ' + df);
});

test('develop: optics distortion and lens vignetting; lens blur keeps the focus sharp and blurs far areas', () => {
  const checker = mk(80, 80, (x, y) => ((x >> 2) + (y >> 2)) % 2 ? [255, 255, 255] : [0, 0, 0]);
  assert.ok(maxDiff(run(checker, { distortion: 50 }), checker) > 50);
  const g = mk(80, 60, () => [120, 120, 120]); const lv = run(g, { lensVignette: 80 }); assert.ok(at(lv, 1, 1)[0] > 125 && Math.abs(at(lv, 40, 30)[0] - 120) <= 2);
  const lb = run(checker, { lensBlur: { ...developDefaults().lensBlur, enabled: true, amount: 100, focusX: 0.5, focusY: 0.5, focalNear: 0, focalFar: 10 } });
  assert.equal(maxDiff({ data: lb.data.slice((40 * 80 + 38) * 4, (40 * 80 + 42) * 4) }, { data: checker.data.slice((40 * 80 + 38) * 4, (40 * 80 + 42) * 4) }), 0, 'in focus');
  const corner = at(lb, 2, 2)[0]; assert.ok(corner > 40 && corner < 215, 'corner blurred towards grey: ' + corner);
});

test('develop: auto tone brightens a dark image; guided filter keeps a step edge', () => {
  const dark = mk(32, 32, (x, y) => [20 + x, 20 + y, 25]);
  const t = autoTone(dark); assert.ok(t.exposure > 0.3, 'exposure ' + t.exposure);
  assert.ok(meanL(run(dark, t)) > meanL(dark) + 15);
  const N = 20, I = new Float32Array(N * N); for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) I[y * N + x] = x < 10 ? 0 : 1;
  const q = guided(I, I, N, N, 3, 1e-4); assert.ok(q[10 * N + 8] < 0.1 && q[10 * N + 11] > 0.9);
});
