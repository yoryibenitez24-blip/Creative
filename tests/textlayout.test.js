import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutText, layoutOnPath, warpPoint, warpRaster, parsePath, applyCharStyle, editText, charStyleAt, isLegacyText, opticalKern } from '../src/engine/textlayout.js';

// Deterministic fake metric: every glyph is 0.5 em wide, the pair "AV" kerns by -0.1 em.
const px = font => +/([\d.]+)px/.exec(font)[1];
const measure = (text, font) => { const s = px(font); let w = [...text].length * 0.5 * s; for (let i = 1; i < text.length; i++) if (text[i - 1] + text[i] === 'AV') w -= 0.1 * s; return w; };
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const base = { type: 'text', x: 0, y: 0, w: 1000, h: 1000, size: 10, font: 'Arial', fill: '#000' };
const xs = line => line.glyphs.map(g => g.x);

test('legacy point text: newlines only, baseline at (i+1)*size*1.1, legacy spacing px per gap', () => {
  const L = layoutText({ ...base, text: 'ab\ncd', spacing: 3 }, measure);
  assert.equal(L.lines.length, 2); close(L.lines[0].y, 11); close(L.lines[1].y, 22);
  assert.deepEqual(xs(L.lines[0]), [0, 8]);
  assert.ok(isLegacyText({ ...base, text: 'x', spacing: 3, align: 'center' }));
  assert.ok(!isLegacyText({ ...base, text: 'x', tracking: 50 }));
  const c = layoutText({ ...base, w: 100, text: 'abcd', align: 'center' }, measure).lines[0]; close(c.x, 40);
});

test('paragraph text wraps greedily inside the box and honours explicit newlines', () => {
  const L = layoutText({ ...base, kind: 'paragraph', w: 50, text: 'aaa bbb ccc\ndd' }, measure); // 5px per glyph: "aaa bbb" = 35, + " ccc" = 55 > 50
  assert.deepEqual(L.lines.map(l => l.glyphs.map(g => g.ch).join('').trim()), ['aaa bbb', 'ccc', 'dd']);
  assert.ok(L.lines.every(l => l.width <= 50));
  const long = layoutText({ ...base, kind: 'paragraph', w: 22, text: 'abcdefgh' }, measure);
  assert.deepEqual(long.lines.map(l => l.glyphs.length), [4, 4]);
  const of = layoutText({ ...base, kind: 'paragraph', w: 50, h: 20, text: 'aaa bbb ccc ddd eee' }, measure);
  assert.ok(of.overflow); assert.ok(of.lines.some(l => l.hidden));
});

test('hyphenation breaks before consonant+vowel with a hyphen glyph', () => {
  const L = layoutText({ ...base, kind: 'paragraph', w: 40, hyphenate: true, text: 'wonderful' }, measure);
  assert.deepEqual(L.lines.map(l => l.glyphs.map(g => g.ch).join('')), ['wonder-', 'ful']); // "wonder-" = 7 × 5px fits 40
  assert.equal(layoutText({ ...base, kind: 'paragraph', w: 40, text: 'wonderful' }, measure).lines[0].glyphs.length, 8, 'no hyphenation → hard break');
});

test('justification fills the width exactly; last line stays left unless justify-all', () => {
  const L = layoutText({ ...base, kind: 'paragraph', w: 50, align: 'justify-left', text: 'aa bb cc dd ee' }, measure);
  const l0 = L.lines[0], last = l0.glyphs[l0.glyphs.length - 1];
  // trailing spaces are excluded; the last visible glyph's right edge lands on the box edge
  const vis = l0.glyphs.filter(g => g.ch !== ' '), lv = vis[vis.length - 1];
  close(lv.x + lv.advance, 50); assert.ok(last);
  const lastLine = L.lines[L.lines.length - 1]; close(lastLine.x, 0); close(lastLine.width, lastLine.glyphs.length * 5);
  const all = layoutText({ ...base, kind: 'paragraph', w: 50, align: 'justify-all', text: 'aa bb' }, measure).lines[0];
  close(all.glyphs[4].x + all.glyphs[4].advance, 50);
});

test('tracking adds tracking/1000 × size per gap; legacy spacing ignored when tracking is set', () => {
  const a = layoutText({ ...base, size: 20, text: 'abcd' }, measure).lines[0];
  const b = layoutText({ ...base, size: 20, text: 'abcd', tracking: 100, spacing: 99 }, measure).lines[0];
  b.glyphs.forEach((g, i) => close(g.x - a.glyphs[i].x, i * 100 / 1000 * 20));
  close(b.width - a.width, 3 * 2);
});

test('metrics kerning, numeric kerning, manual kerning pair', () => {
  const m = layoutText({ ...base, text: 'AVA' }, measure).lines[0];
  close(m.glyphs[1].x, 5 - 1); close(m.glyphs[2].x, 9);
  const none = layoutText({ ...base, text: 'AVA', kerning: 'none' }, measure).lines[0]; close(none.glyphs[1].x, 5);
  const num = layoutText({ ...base, text: 'abc', kerning: -50 }, measure).lines[0]; close(num.glyphs[1].x, 4.5); close(num.glyphs[2].x, 9);
  const pair = layoutText({ ...base, text: 'abc', kerningPairs: { 2: 200 } }, measure).lines[0];
  close(pair.glyphs[1].x, 5); close(pair.glyphs[2].x, 12);
  close(opticalKern('A', 'V', '400 10px Arial', 10, measure), -1); // no bounds → metrics
});

test('indents and space before/after', () => {
  const L = layoutText({ ...base, kind: 'paragraph', w: 100, text: 'ab\ncd', indentLeft: 10, indentFirst: 7, indentRight: 5, spaceBefore: 4, spaceAfter: 6, leading: 'auto' }, measure);
  close(L.lines[0].x, 17); close(L.lines[1].x, 17);
  close(L.lines[0].y, 12); close(L.lines[1].y, 12 + 6 + 4 + 12);
  const r = layoutText({ ...base, kind: 'paragraph', w: 100, text: 'ab', align: 'right', indentRight: 5 }, measure).lines[0];
  close(r.x + r.width, 95);
});

test('leading auto = 1.2 × size, explicit px, largest in line wins', () => {
  close(layoutText({ ...base, size: 50, leading: 'auto', text: 'a\nb' }, measure).lines[1].y, 120);
  close(layoutText({ ...base, leading: 30, text: 'a\nb' }, measure).lines[1].y, 60);
  const L = layoutText({ ...base, leading: 'auto', text: 'ab', runs: [{ start: 1, end: 2, size: 40 }] }, measure);
  close(L.lines[0].y, 48);
});

test('superscript and subscript: 58.3% size, shifted ±33.3% of the size; baseline shift raises', () => {
  const L = layoutText({ ...base, size: 30, text: 'xyz', runs: [{ start: 1, end: 2, superscript: true }, { start: 2, end: 3, subscript: true }] }, measure).lines[0];
  close(L.glyphs[1].size, 30 * 0.583); close(L.glyphs[1].y, L.y - 0.333 * 30); close(L.glyphs[2].y, L.y + 0.333 * 30);
  close(L.glyphs[1].advance, 0.5 * 30 * 0.583);
  const b = layoutText({ ...base, text: 'a', baselineShift: 4 }, measure).lines[0]; close(b.glyphs[0].y, b.y - 4);
});

test('allCaps, smallCaps, horizontal/vertical scale', () => {
  const L = layoutText({ ...base, text: 'aB', allCaps: true }, measure).lines[0];
  assert.deepEqual(L.glyphs.map(g => g.ch), ['A', 'B']);
  const s = layoutText({ ...base, text: 'aB', smallCaps: true }, measure).lines[0];
  assert.equal(s.glyphs[0].ch, 'A'); close(s.glyphs[0].size, 7); close(s.glyphs[1].size, 10);
  const h = layoutText({ ...base, text: 'ab', hScale: 200, vScale: 50 }, measure).lines[0];
  close(h.glyphs[1].x, 10); assert.equal(h.glyphs[0].scaleY, 0.5);
});

test('runs: applyCharStyle splits runs; editText keeps styles attached', () => {
  const layer = { ...base, text: 'hello world' };
  const runs = applyCharStyle(layer, 0, 5, { fill: '#f00' });
  assert.equal(charStyleAt({ ...layer, runs }, 4).fill, '#f00'); assert.equal(charStyleAt({ ...layer, runs }, 5).fill, '#000');
  const runs2 = applyCharStyle({ ...layer, runs }, 2, 8, { weight: 700 });
  const l2 = { ...layer, runs: runs2 };
  assert.equal(charStyleAt(l2, 1).weight, 400); assert.equal(charStyleAt(l2, 3).weight, 700); assert.equal(charStyleAt(l2, 3).fill, '#f00');
  const p = editText({ ...layer, runs: [{ start: 6, end: 11, weight: 700 }] }, 'hello big world');
  assert.deepEqual([p.runs[0].start, p.runs[0].end], [10, 15], 'text typed before a run shifts it');
  const q = editText({ ...layer, runs, kerningPairs: { 7: 50 } }, 'hello!! world');
  assert.equal(q.runs[0].end, 7, 'typed at the end of a run extends it'); assert.deepEqual(q.kerningPairs, { 9: 50 });
});

test('path parser flattens M/L/H/V/C/Q/Z absolute and relative', () => {
  const [p] = parsePath('M0 0 l10 0 V10 h-10 z');
  assert.deepEqual(p, [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]);
  const [c] = parsePath('M0 0 C0 10 10 10 10 0', 4); assert.deepEqual(c[c.length - 1], [10, 0]); close(c[2][1], 7.5);
  const [q] = parsePath('m0 0 q5 10 10 0', 2); assert.deepEqual(q[1], [5, 5]);
});

test('text on a straight path places glyphs along it with the path angle', () => {
  const r = layoutOnPath({ ...base, text: 'abc' }, measure, { d: 'M0 0 L100 100', offset: 0, side: 'left' });
  const step = 5 / Math.SQRT2;
  r.glyphs.forEach((g, i) => { close(g.angle, 45); close(g.x, (2.5 + 5 * i) / Math.SQRT2); close(g.y, g.x); });
  close(r.glyphs[1].x - r.glyphs[0].x, step);
  const f = layoutOnPath({ ...base, text: 'abc' }, measure, { d: 'M0 0 L100 0', offset: 50, side: 'right' });
  close(f.glyphs[0].angle, 180); close(f.glyphs[0].x, 47.5);
  const o = layoutOnPath({ ...base, text: 'abcdef' }, measure, { d: 'M0 0 L20 0', offset: 0 });
  assert.ok(o.overflow); assert.ok(o.glyphs[5].hidden); assert.ok(!o.glyphs[0].hidden);
});

test('warp: bend 0 is identity, arc with bend > 0 lifts the centre; vertical swaps axes', () => {
  const B = { x: 0, y: 0, w: 200, h: 50 };
  for (const st of ['arc', 'bulge', 'flag', 'twist', 'fisheye', 'wave']) for (const [x, y] of [[0, 0], [37, 12], [200, 50]]) assert.deepEqual(warpPoint(st, 0, 0, 0, B, x, y), { x, y });
  const c = warpPoint('arc', 50, 0, 0, B, 100, 0), e = warpPoint('arc', 50, 0, 0, B, 0, 0);
  assert.ok(c.y < 0, 'centre top is lifted'); assert.ok(c.y < e.y, 'centre higher than the edge'); close(c.x, 100);
  const n = warpPoint('arc', -50, 0, 0, B, 100, 0); assert.ok(n.y > 0);
  const v = warpPoint('arch', 50, 0, 0, { x: 0, y: 0, w: 50, h: 200 }, 0, 100, false); assert.ok(v.x < 0);
  const hd = warpPoint('none', 0, 50, 0, B, 200, 0); assert.ok(hd.y < 0);
});

test('warpRaster: identity reproduces pixels; arch moves opaque pixels upward', () => {
  const W = 40, H = 10, data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) data.set([i % 255, 100, 50, 255], i * 4);
  const src = { w: W, h: H, data }, B = { x: 0, y: 0, w: W, h: H };
  const id = warpRaster(src, { style: 'arc', bend: 0 }, B);
  assert.deepEqual([id.w, id.h, id.ox, id.oy], [W, H, 0, 0]);
  for (const [x, y] of [[0, 0], [17, 5], [39, 9]]) assert.deepEqual([...id.data.slice((y * W + x) * 4, (y * W + x) * 4 + 4)], [...data.slice((y * W + x) * 4, (y * W + x) * 4 + 4)]);
  const a = warpRaster(src, { style: 'arch', bend: 100 }, B);
  assert.ok(a.oy < 0); const col = 20 - a.ox, row = -3 - a.oy; // 3 px above the original top, centre column (lifted by up to 5 px)
  assert.equal(a.data[(row * a.w + col) * 4 + 3], 255);
  assert.equal(a.data[((0 - a.oy - 1) * a.w + (0 - a.ox)) * 4 + 3], 0, 'corner area above the left edge stays empty');
});
