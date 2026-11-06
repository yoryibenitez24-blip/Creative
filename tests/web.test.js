// Web / UI workspace engine: auto layout, constraints, components, styles, geometry and code generation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeAutoLayout, applyConstraints, wrapText, alignParts } from '../src/web/layout.js';
import {
  emptyDoc, makeNode, insertNode, normalize, finalize, patchNode, resizeNode, addAutoLayout, setLayout, createComponent, createInstance, detachInstance,
  resetOverrides, addColorStyle, addTextStyle, updateStyle, deleteStyle, wrapNodes, ungroup, reparent, duplicateNodes, removeNodes, reorder,
  cloneSubtrees, pasteSubtrees, migrateWebDoc,
} from '../src/web/model.js';
import { hitTest, absBounds, absMatrix, apply } from '../src/web/geometry.js';
import { cssForNode, exportFrameHtml, exportSvg, nodeStyle, flexCss } from '../src/web/codegen.js';
import { createWebDoc, WEB_TEMPLATES, insertTemplate } from '../src/web/templates.js';

const near = (a, b, eps = 1e-6, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} ${a} ≉ ${b}`);
const box = (b, x, y, w, h) => { near(b.x, x, 1e-6, 'x'); near(b.y, y, 1e-6, 'y'); near(b.w, w, 1e-6, 'w'); near(b.h, h, 1e-6, 'h'); };

// ───────────── layout engine ─────────────
test('auto layout: hug both axes with gap and per-side padding', () => {
  const r = computeAutoLayout({ direction: 'horizontal', gap: 10, padding: [5, 6, 7, 8], align: 'top-left', sizingW: 'hug', sizingH: 'hug' },
    [{ w: 50, h: 20 }, { w: 30, h: 40 }]);
  assert.equal(r.w, 8 + 50 + 10 + 30 + 6); assert.equal(r.h, 5 + 40 + 7);
  box(r.items[0], 8, 5, 50, 20); box(r.items[1], 68, 5, 30, 40);
});

test('auto layout: fixed container shares space between fill items', () => {
  const r = computeAutoLayout({ w: 200, h: 60, direction: 'horizontal', gap: 10, padding: 10, sizingW: 'fixed', sizingH: 'fixed' },
    [{ w: 50, h: 20 }, { w: 1, h: 20, sizingW: 'fill' }, { w: 1, h: 20, sizingW: 'fill', sizingH: 'fill' }]);
  assert.equal(r.w, 200);
  box(r.items[0], 10, 10, 50, 20); box(r.items[1], 70, 10, 55, 20); box(r.items[2], 135, 10, 55, 40);
});

test('auto layout: nine-point alignment', () => {
  const C = a => computeAutoLayout({ w: 200, h: 100, direction: 'horizontal', gap: 0, padding: 0, align: a }, [{ w: 40, h: 20 }]).items[0];
  box(C('center'), 80, 40, 40, 20); box(C('bottom-right'), 160, 80, 40, 20); box(C('top-center'), 80, 0, 40, 20); box(C('center-left'), 0, 40, 40, 20);
  assert.deepEqual(alignParts('bottom-left'), { v: 'end', h: 'start' });
  // vertical direction: main axis is y
  const v = computeAutoLayout({ w: 100, h: 200, direction: 'vertical', gap: 10, padding: 0, align: 'bottom-center' }, [{ w: 20, h: 30 }, { w: 40, h: 30 }]);
  box(v.items[0], 40, 130, 20, 30); box(v.items[1], 30, 170, 40, 30);
});

test('auto layout: vertical hug with cross-axis fill and space-between', () => {
  const r = computeAutoLayout({ w: 120, direction: 'vertical', gap: 8, padding: [10, 10, 10, 10], sizingW: 'fixed', sizingH: 'hug' },
    [{ w: 30, h: 20, sizingW: 'fill' }, { w: 30, h: 25 }]);
  assert.equal(r.h, 10 + 20 + 8 + 25 + 10); box(r.items[0], 10, 10, 100, 20); box(r.items[1], 10, 38, 30, 25);
  const s = computeAutoLayout({ w: 200, h: 40, direction: 'horizontal', gap: 5, padding: 0, distribute: 'space-between' }, [{ w: 20, h: 10 }, { w: 20, h: 10 }, { w: 20, h: 10 }]);
  assert.deepEqual(s.items.map(i => i.x), [0, 90, 180]);
});

test('auto layout: wrap breaks lines and hugs the cross axis', () => {
  const r = computeAutoLayout({ w: 100, direction: 'horizontal', gap: 10, wrapGap: 6, padding: 0, wrap: true, sizingW: 'fixed', sizingH: 'hug' },
    [{ w: 40, h: 10 }, { w: 40, h: 14 }, { w: 40, h: 10 }]);
  box(r.items[0], 0, 0, 40, 10); box(r.items[1], 50, 0, 40, 14); box(r.items[2], 0, 20, 40, 10);
  assert.equal(r.h, 14 + 6 + 10);
});

test('auto layout: hidden and absolute items do not take part; fill in a hug axis is fixed', () => {
  const r = computeAutoLayout({ direction: 'horizontal', gap: 10, padding: 0, sizingW: 'hug', sizingH: 'hug' },
    [{ w: 10, h: 10 }, { w: 99, h: 99, visible: false }, { w: 30, h: 30, absolute: true, x: 500, y: 7 }, { w: 20, h: 5, sizingW: 'fill' }]);
  assert.equal(r.w, 40); assert.equal(r.h, 10); box(r.items[2], 500, 7, 30, 30); box(r.items[3], 20, 0, 20, 5);
});

test('constraints: every horizontal and vertical mode', () => {
  const c = (h, v) => applyConstraints({ x: 10, y: 20, w: 30, h: 40, constraints: { h, v } }, { w: 100, h: 200 }, { w: 150, h: 300 });
  box(c('left', 'top'), 10, 20, 30, 40);
  box(c('right', 'bottom'), 60, 120, 30, 40);
  box(c('left-right', 'top-bottom'), 10, 20, 80, 140);
  box(c('center', 'center'), 35, 70, 30, 40);
  box(c('scale', 'scale'), 15, 30, 45, 60);
});

test('wrapText: greedy wrapping with explicit newlines and long words', () => {
  const m = s => s.length * 10;
  assert.deepEqual(wrapText('aa bb cc', 50, m), ['aa bb', 'cc']);
  assert.deepEqual(wrapText('one\ntwo', Infinity, m), ['one', 'two']);
  assert.deepEqual(wrapText('abcdefgh', 30, m), ['abc', 'def', 'gh']);
});

// ───────────── model ─────────────
function frameWith(children, frameProps = {}) {
  let d = emptyDoc();
  const f = makeNode('frame', { x: 0, y: 0, w: 400, h: 300, ...frameProps });
  d = insertNode(d, f);
  for (const c of children) d = insertNode(d, c, f.id);
  return { d: normalize(d), f };
}

test('model: auto layout frame recomputes live when children change (gap, padding, text)', () => {
  const a = makeNode('rect', { x: 0, y: 0, w: 50, h: 20 }), t = makeNode('text', { text: 'Hi', fontSize: 10 });
  let { d, f } = frameWith([a, t]);
  d = normalize(setLayout(d, f.id, { direction: 'horizontal', gap: 10, padding: [4, 4, 4, 4], align: 'top-left', wrap: false, distribute: 'packed' }));
  d = normalize(patchNode(d, f.id, { sizing: { h: 'hug', v: 'hug' } }));
  const tw = 2 * 10 * 0.55;
  assert.equal(d.nodes[t.id].x, 4 + 50 + 10); near(d.nodes[f.id].w, 4 + 50 + 10 + Math.ceil(tw) + 4);
  d = normalize(setLayout(d, f.id, { ...d.nodes[f.id].layout, gap: 20, padding: [8, 8, 8, 8] }));
  assert.equal(d.nodes[a.id].x, 8); assert.equal(d.nodes[t.id].x, 8 + 50 + 20);
  d = normalize(patchNode(d, t.id, { text: 'Hello there' }));
  near(d.nodes[f.id].w, 8 + 50 + 20 + Math.ceil(11 * 10 * 0.55) + 8);
});

test('model: Shift+A infers direction, gap and padding from the current arrangement', () => {
  const a = makeNode('rect', { x: 20, y: 30, w: 40, h: 40 }), b = makeNode('rect', { x: 20, y: 90, w: 40, h: 40 });
  let { d, f } = frameWith([b, a], { w: 100, h: 160 });
  const r = addAutoLayout(d, [f.id]); d = normalize(r.doc);
  const L = d.nodes[f.id].layout;
  assert.equal(L.direction, 'vertical'); assert.equal(L.gap, 20); assert.deepEqual(L.padding, [30, 40, 30, 20]);
  assert.deepEqual(d.nodes[f.id].children, [a.id, b.id]);
  assert.equal(d.nodes[a.id].y, 30); assert.equal(d.nodes[b.id].y, 90);
  // wrapping a loose selection creates a hugging auto layout frame
  const c = makeNode('rect', { x: 0, y: 0, w: 10, h: 10 }), e = makeNode('rect', { x: 30, y: 0, w: 10, h: 10 });
  let g = frameWith([c, e]); const w = addAutoLayout(g.d, [c.id, e.id]); const gd = normalize(w.doc);
  assert.equal(gd.nodes[w.id].layout.direction, 'horizontal'); assert.equal(gd.nodes[w.id].w, 40); assert.equal(gd.nodes[w.id].h, 10);
});

test('model: resizing a frame applies constraints to its children (recursively)', () => {
  const r = makeNode('rect', { x: 300, y: 10, w: 50, h: 20, constraints: { h: 'right', v: 'top' } });
  const s = makeNode('rect', { x: 10, y: 10, w: 380, h: 20, constraints: { h: 'left-right', v: 'bottom' } });
  let { d, f } = frameWith([r, s]);
  d = normalize(resizeNode(d, f.id, { w: 500, h: 400 }));
  box(d.nodes[r.id], 400, 10, 50, 20); box(d.nodes[s.id], 10, 110, 480, 20);
});

test('components: main edits propagate, overrides (text / fill / visibility) survive', () => {
  const bg = makeNode('rect', { x: 0, y: 0, w: 120, h: 40, fill: '#0000ff' }), label = makeNode('text', { x: 10, y: 10, text: 'Buy' });
  let { d, f } = frameWith([bg, label], { w: 120, h: 40 });
  d = createComponent(d, [f.id]).doc;
  assert.ok(d.nodes[f.id].isComponent);
  const i1 = createInstance(d, f.id, null, 500, 0); d = normalize(i1.doc);
  const i2 = createInstance(d, f.id, null, 500, 100); d = normalize(i2.doc);
  const copyText = id => d.nodes[id + '~' + label.id], copyBg = id => d.nodes[id + '~' + bg.id];
  assert.equal(copyText(i1.id).text, 'Buy'); assert.equal(copyBg(i2.id).fill, '#0000ff');
  // overrides on instance 1
  d = normalize(patchNode(d, i1.id + '~' + label.id, { text: 'Order now', x: 999 }));
  d = normalize(patchNode(d, i1.id + '~' + bg.id, { fill: '#00ff00' }));
  d = normalize(patchNode(d, i2.id + '~' + label.id, { visible: false }));
  assert.equal(copyText(i1.id).text, 'Order now'); assert.equal(copyText(i1.id).x, 10, 'geometry is not overridable');
  // edit the main component
  d = normalize(patchNode(d, label.id, { text: 'Buy now', fontSize: 22 }));
  d = normalize(patchNode(d, bg.id, { fill: '#ff0000', radius: 8 }));
  assert.equal(copyText(i1.id).text, 'Order now'); assert.equal(copyText(i1.id).fontSize, 22);
  assert.equal(copyBg(i1.id).fill, '#00ff00'); assert.equal(copyBg(i1.id).radius, 8);
  assert.equal(copyText(i2.id).text, 'Buy now'); assert.equal(copyText(i2.id).visible, false); assert.equal(copyBg(i2.id).fill, '#ff0000');
  // new child in the main appears in instances
  const dot = makeNode('ellipse', { x: 100, y: 5, w: 10, h: 10 }); d = normalize(insertNode(d, dot, f.id));
  assert.ok(d.nodes[i2.id + '~' + dot.id]);
  // reset + detach
  d = normalize(resetOverrides(d, i1.id)); assert.equal(copyText(i1.id).text, 'Buy now');
  d = normalize(detachInstance(d, i2.id));
  assert.equal(d.nodes[i2.id].componentId, undefined);
  d = normalize(patchNode(d, label.id, { text: 'Changed' }));
  assert.equal(copyText(i2.id).text, 'Buy now', 'detached copy no longer follows the main');
  assert.equal(copyText(i1.id).text, 'Changed');
});

test('components: resized instance lays out children with the main component constraints', () => {
  const close = makeNode('rect', { x: 180, y: 10, w: 10, h: 10, constraints: { h: 'right', v: 'top' } });
  let { d, f } = frameWith([close], { w: 200, h: 100 });
  d = createComponent(d, [f.id]).doc;
  const i = createInstance(d, f.id, null, 0, 300); d = normalize(i.doc);
  d = normalize(resizeNode(d, i.id, { w: 300 }));
  assert.equal(d.nodes[i.id].w, 300); assert.equal(d.nodes[i.id + '~' + close.id].x, 280);
  d = normalize(patchNode(d, f.id, { h: 120 })); assert.equal(d.nodes[i.id].h, 120, 'height still follows the main');
});

test('components: duplicating a main component makes an instance; nesting into itself is refused', () => {
  const r = makeNode('rect', { x: 0, y: 0, w: 10, h: 10 });
  let { d, f } = frameWith([r], { w: 50, h: 50 });
  d = createComponent(d, [f.id]).doc;
  const dup = duplicateNodes(d, [f.id]); d = normalize(dup.doc);
  assert.equal(d.nodes[dup.ids[0]].componentId, f.id);
  assert.equal(createInstance(d, f.id, f.id, 0, 0).id, null);
});

test('styles: editing a shared color / text style updates every user; a direct edit detaches', () => {
  const a = makeNode('rect', { fill: '#111111' }), b = makeNode('ellipse', { fill: '#222222' }), t = makeNode('text', { text: 'x', fontSize: 12 });
  let { d } = frameWith([a, b, t]);
  const s = addColorStyle(d, { name: 'Brand', color: '#5b4bff' }, [a.id, b.id]); d = normalize(s.doc);
  d = normalize(updateStyle(d, 'colors', s.id, { color: '#ff8800' }));
  assert.equal(d.nodes[a.id].fill, '#ff8800'); assert.equal(d.nodes[b.id].fill, '#ff8800');
  d = normalize(patchNode(d, b.id, { fill: '#000000' }));
  d = normalize(updateStyle(d, 'colors', s.id, { color: '#00aa00' }));
  assert.equal(d.nodes[a.id].fill, '#00aa00'); assert.equal(d.nodes[b.id].fill, '#000000'); assert.equal(d.nodes[b.id].fillStyle, undefined);
  const ts = addTextStyle(d, { ...d.nodes[t.id], fontSize: 30, fontWeight: 700 }, 'H1', [t.id]); d = normalize(ts.doc);
  assert.equal(d.nodes[t.id].fontSize, 30);
  d = normalize(updateStyle(d, 'texts', ts.id, { fontSize: 40 })); assert.equal(d.nodes[t.id].fontSize, 40);
  d = normalize(deleteStyle(d, 'texts', ts.id)); assert.equal(d.nodes[t.id].textStyle, undefined); assert.equal(d.nodes[t.id].fontSize, 40);
});

test('groups and reparenting keep on-canvas positions, including rotation', () => {
  const a = makeNode('rect', { x: 10, y: 10, w: 20, h: 20 }), b = makeNode('rect', { x: 60, y: 30, w: 20, h: 40, rotation: 30 });
  let { d, f } = frameWith([a, b]);
  const before = [absBounds(d.nodes, a.id), absBounds(d.nodes, b.id)];
  const g = wrapNodes(d, [a.id, b.id], 'group'); d = normalize(g.doc);
  assert.equal(d.nodes[a.id].parent, g.id);
  [a.id, b.id].forEach((id, i) => { const k = absBounds(d.nodes, id); box(k, before[i].x, before[i].y, before[i].w, before[i].h); });
  // rotate the group, then ungroup: world corners must be unchanged
  d = normalize(patchNode(d, g.id, { rotation: 45 }));
  const corner = id => { const n = d.nodes[id]; return apply(absMatrix(d.nodes, id), n.w, n.h); };
  const c1 = corner(b.id);
  const u = ungroup(d, [g.id]); d = normalize(u.doc);
  assert.equal(d.nodes[g.id], undefined); assert.equal(d.nodes[b.id].parent, f.id);
  const c2 = corner(b.id); near(c1[0], c2[0], 1e-6); near(c1[1], c2[1], 1e-6);
  near(d.nodes[b.id].rotation, 75, 1e-6);
  // move into a rotated frame and back to the root
  const holder = makeNode('frame', { x: 500, y: 0, w: 200, h: 200, rotation: 90 }); d = normalize(insertNode(d, holder));
  const w0 = absBounds(d.nodes, a.id);
  d = normalize(reparent(d, [a.id], holder.id)); box(absBounds(d.nodes, a.id), w0.x, w0.y, w0.w, w0.h);
  d = normalize(reparent(d, [a.id], null)); box(absBounds(d.nodes, a.id), w0.x, w0.y, w0.w, w0.h);
  assert.ok(d.root.includes(a.id));
});

test('z-order, delete, copy / paste with fresh ids', () => {
  const a = makeNode('rect'), b = makeNode('rect'), c = makeNode('rect');
  let { d, f } = frameWith([a, b, c]);
  d = reorder(d, [a.id], 'front'); assert.deepEqual(d.nodes[f.id].children, [b.id, c.id, a.id]);
  d = reorder(d, [a.id], 'backward'); assert.deepEqual(d.nodes[f.id].children, [b.id, a.id, c.id]);
  d = reorder(d, [c.id], 'back'); assert.deepEqual(d.nodes[f.id].children, [c.id, b.id, a.id]);
  const clip = cloneSubtrees(d.nodes, [f.id]);
  const p = pasteSubtrees(d, clip, null, null, 500, 0); d = normalize(p.doc);
  const copy = d.nodes[p.ids[0]];
  assert.equal(copy.children.length, 3); assert.equal(copy.x, 500); assert.ok(copy.children.every(id => ![a.id, b.id, c.id].includes(id)));
  d = removeNodes(d, [f.id]); assert.equal(d.nodes[a.id], undefined); assert.equal(d.root.length, 1);
});

test('finalize gives changed nodes\' ancestors new identities, others keep theirs', () => {
  const a = makeNode('rect'), b = makeNode('rect');
  let { d, f } = frameWith([a, b]);
  const next = finalize(d, patchNode(d, a.id, { fill: '#123456' }));
  assert.notEqual(next.nodes[f.id], d.nodes[f.id]); assert.equal(next.nodes[b.id], d.nodes[b.id]);
  assert.equal(normalize(next), next, 'normalize is idempotent and returns the same object');
});

// ───────────── geometry ─────────────
test('hit-testing respects rotation and clipping', () => {
  const r = makeNode('rect', { x: 50, y: 50, w: 100, h: 20, rotation: 90 }); // occupies x 90..110, y 10..110 in the frame
  const out = makeNode('rect', { x: 350, y: 10, w: 100, h: 50 }); // sticks out of the 400 wide frame
  let { d, f } = frameWith([r, out], { clip: true });
  assert.deepEqual(hitTest(d, 100, 20), [f.id, r.id]);
  assert.deepEqual(hitTest(d, 60, 60), [f.id], 'unrotated box area is empty after rotation');
  assert.deepEqual(hitTest(d, 420, 20), [], 'clipped part is not hittable');
  d = patchNode(d, f.id, { clip: false });
  assert.deepEqual(hitTest(d, 420, 20), [f.id, out.id]);
  const e = makeNode('ellipse', { x: 200, y: 200, w: 100, h: 100 }); d = insertNode(d, e, f.id);
  assert.deepEqual(hitTest(d, 205, 205), [f.id], 'ellipse corner is outside the shape');
  d = patchNode(d, e.id, { locked: true }); assert.deepEqual(hitTest(d, 250, 250), [f.id]);
});

// ───────────── code generation ─────────────
test('CSS: geometry, background, border radius, stroke, shadows and typography', () => {
  const r = makeNode('rect', { name: 'Card', x: 12, y: 8, w: 200, h: 100, fill: '#ff0000', fillOpacity: 0.5, radius: [4, 4, 0, 0], stroke: '#000000', strokeWidth: 2,
    effects: [{ type: 'drop-shadow', x: 0, y: 4, blur: 10, spread: 1, color: '#000000', opacity: 0.25 }, { type: 'inner-shadow', x: 1, y: 1, blur: 2, spread: 0, color: '#ffffff', opacity: 1 }, { type: 'background-blur', blur: 6 }], rotation: 15, opacity: 0.8 });
  const t = makeNode('text', { name: 'Title', text: 'Hello', fontFamily: 'Georgia, serif', fontSize: 20, fontWeight: 700, lineHeight: 28, letterSpacing: 0.5, align: 'center', fill: '#333333' });
  let { d } = frameWith([r, t]);
  const css = cssForNode(d, r.id);
  for (const line of ['position: absolute;', 'left: 12px;', 'top: 8px;', 'width: 200px;', 'height: 100px;', 'background: rgba(255, 0, 0, 0.5);', 'border-radius: 4px 4px 0px 0px;',
    'box-shadow: 0px 4px 10px 1px rgba(0, 0, 0, 0.25), inset 1px 1px 2px 0px #ffffff, inset 0 0 0 2px #000000;', 'backdrop-filter: blur(6px);', 'transform: rotate(15deg);', 'opacity: 0.8;'])
    assert.ok(css.includes(line), 'missing ' + line + '\n' + css);
  const tc = cssForNode(d, t.id);
  for (const line of ['font-family: Georgia, serif;', 'font-size: 20px;', 'font-weight: 700;', 'line-height: 28px;', 'letter-spacing: 0.5px;', 'text-align: center;', 'color: #333333;', 'white-space: pre;'])
    assert.ok(tc.includes(line), 'missing ' + line);
});

test('CSS: auto layout becomes flexbox; fill children grow', () => {
  const a = makeNode('rect', { w: 40, h: 20 }), b = makeNode('rect', { w: 40, h: 20, sizing: { h: 'fill', v: 'fill' } });
  let { d, f } = frameWith([a, b], { w: 300, h: 80 });
  d = normalize(setLayout(d, f.id, { direction: 'horizontal', gap: 12, padding: [10, 20, 10, 20], align: 'center-right', wrap: false, distribute: 'packed' }));
  assert.deepEqual(flexCss(d.nodes[f.id]), { display: 'flex', flexDirection: 'row', gap: '12px', padding: '10px 20px 10px 20px', justifyContent: 'flex-end', alignItems: 'center' });
  const cb = cssForNode(d, b.id);
  assert.ok(cb.includes('flex: 1 1 0;') && cb.includes('align-self: stretch;') && !cb.includes('left:'), cb);
  const ca = cssForNode(d, a.id); assert.ok(ca.includes('width: 40px;') && ca.includes('flex-shrink: 0;'), ca);
  // the engine and the CSS agree on the fill width
  assert.equal(d.nodes[b.id].w, 300 - 20 - 20 - 40 - 12);
  const v = flexCss({ layout: { direction: 'vertical', gap: 4, padding: 0, align: 'bottom-left', wrap: true, wrapGap: 9, distribute: 'space-between' } });
  assert.equal(v.flexWrap, 'wrap'); assert.equal(v.rowGap, '4px'); assert.equal(v.columnGap, '9px'); assert.equal(v.justifyContent, 'space-between'); assert.equal(v.alignItems, 'flex-start');
});

test('HTML export: single self-contained file, flex for auto layout, absolute otherwise, escaped text', () => {
  const t = makeNode('text', { text: '<b>Tom & Jerry</b>', x: 5, y: 6 });
  const inner = makeNode('frame', { name: 'Row', x: 20, y: 30, w: 100, h: 40, fill: null, layout: { direction: 'horizontal', gap: 8, padding: [0, 0, 0, 0], align: 'top-left', wrap: false, distribute: 'packed' } });
  let { d, f } = frameWith([t, inner], { name: 'Home' });
  d = normalize(insertNode(d, makeNode('rect', { w: 10, h: 10 }), inner.id));
  const html = exportFrameHtml(d, f.id);
  assert.match(html, /^<!doctype html>/); assert.ok(html.includes('<title>Home</title>'));
  assert.ok(html.includes('&lt;b&gt;Tom &amp; Jerry&lt;/b&gt;')); assert.ok(!html.includes('<b>Tom'));
  assert.ok(html.includes('display: flex;') && html.includes('position: absolute;') && html.includes('left: 20px;'));
  assert.ok(!/(src|href)="http/.test(html), 'no external resources');
});

test('SVG export: shapes, rounded paths, clipping and text lines', () => {
  const r = makeNode('rect', { x: 10, y: 10, w: 50, h: 30, radius: 6, fill: '#00ff00', stroke: '#000000', strokeWidth: 2 });
  const t = makeNode('text', { text: 'A\nB', x: 0, y: 50, lineHeight: 20 });
  let { d, f } = frameWith([r, t], { clip: true, w: 200, h: 100 });
  const svg = exportSvg(d, f.id);
  assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" [^>]*width="200" height="100"/);
  assert.ok(svg.includes('fill="#00ff00"') && svg.includes('clipPath') && svg.includes('A6,6'));
  assert.ok(svg.includes('<tspan x="0" y="10">A</tspan><tspan x="0" y="30">B</tspan>'), svg);
  assert.ok(svg.includes('transform="matrix(1 0 0 1 10 10)"'));
  // nodeStyle for a line centres the stroke on its y
  const ln = makeNode('line', { x: 0, y: 50, w: 100, strokeWidth: 4 }); assert.equal(nodeStyle({ nodes: {}, images: {} }, ln).top, '48px');
});

test('templates: every template builds into a valid, normalized web doc', () => {
  for (const t of WEB_TEMPLATES) {
    const d = createWebDoc(t.id);
    assert.equal(d.kind, 'web'); assert.equal(d.version, 1); assert.ok(d.root.length >= 1);
    assert.equal(normalize(d), d, t.id + ' is normalized');
    for (const id in d.nodes) { const n = d.nodes[id]; if (n.parent) assert.ok(d.nodes[n.parent].children.includes(id), t.id + ' tree'); }
  }
  const login = createWebDoc('login');
  assert.ok(Object.values(login.nodes).some(n => n.proto?.transition === 'slide-left'));
  const landing = createWebDoc('landing');
  const inst = Object.values(landing.nodes).filter(n => n.componentId && !n.ref);
  assert.equal(inst.length, 2);
  const merged = insertTemplate(createWebDoc('mobile'), 'landing');
  assert.equal(merged.doc.root.length, 3); assert.equal(merged.doc.styles.colors.length, 4);
  assert.equal(migrateWebDoc(landing), landing); assert.equal(migrateWebDoc(null).kind, 'web');
  assert.throws(() => migrateWebDoc({ kind: 'web', version: 99 }));
  const custom = createWebDoc({ w: 300, h: 200, name: 'X' }); const cf = custom.nodes[custom.root[0]];
  assert.equal(custom.name, 'X'); assert.equal(cf.w, 300); assert.equal(cf.h, 200);
});
