// Web / UI design document: schema, tree operations, components, styles and the normalize pass.
// Pure JS (no DOM): runs in Node tests. The React workspace lives in WebWorkspace.jsx.
//
// ─── Document schema (kind 'web', version 1) ─────────────────────────────────────────────────────────────
// {
//   kind: 'web', version: 1, name: string,
//   root: [nodeId],                          top-level nodes, bottom → top (frames, but any node type is allowed)
//   nodes: { [id]: Node },                   flat map; the tree is expressed with node.parent / node.children
//   startFrame: nodeId | null,               first frame shown by Present (falls back to the first top-level frame)
//   styles: { colors: [{ id, name, color: '#rrggbb', opacity: 0..1 }],
//             texts:  [{ id, name, fontFamily, fontSize, fontWeight, italic, lineHeight|null, letterSpacing }] },
//   images: { [imageId]: dataURL },          image bytes shared by image layers
//   canvasBg: '#rrggbb'
// }
// Node (all types): { id, type: 'frame'|'group'|'rect'|'ellipse'|'line'|'text'|'image', name, parent: id|null,
//   x, y, w, h (unrotated box in the parent's coordinate space), rotation (deg, about the box centre),
//   visible, locked, opacity 0..1,
//   fill: '#rrggbb'|null, fillOpacity, fillStyle?: colorStyleId, stroke: '#rrggbb'|null, strokeWidth,
//   radius: number | [tl, tr, br, bl],
//   effects: [{ type: 'drop-shadow'|'inner-shadow'|'layer-blur'|'background-blur', x, y, blur, spread, color, opacity, visible }],
//   constraints: { h: 'left'|'right'|'left-right'|'center'|'scale', v: 'top'|'bottom'|'top-bottom'|'center'|'scale' },
//   sizing: { h: 'fixed'|'hug'|'fill', v: 'fixed'|'hug'|'fill' }   (hug: auto layout frames; fill: children of auto layout)
//   ignoreLayout?: bool (absolute position inside an auto layout frame),
//   proto?: { target: frameId, transition: 'instant'|'dissolve'|'slide-left'|'slide-right', duration: ms } }
// frame / group: children: [id] (bottom → top; for auto layout also the flow order)
// frame: clip: bool, layout: null | { direction: 'horizontal'|'vertical', gap, padding: [t, r, b, l],
//   align: 'top-left'…'bottom-right' (9 points, 'center' in the middle), wrap: bool, wrapGap, distribute: 'packed'|'space-between' }
// text: text, fontFamily, fontSize, fontWeight, italic, lineHeight (px | null = auto 1.2×), letterSpacing (px),
//   align: 'left'|'center'|'right', textMode: 'auto-width'|'auto-height'|'fixed', textStyle?: textStyleId (colour = fill)
// image: imageId, imgW, imgH (natural size), fit: 'fill'|'fit'|'crop', crop: { scale ≥ 1, x: 0..1, y: 0..1 }
// line: horizontal segment of length w from (0, 0) (h = 0); angle via rotation; colour = stroke.
// Components: a main component is a frame with isComponent: true. An instance is a frame with componentId: mainId and
//   overrides: { [mainNodeId]: { text?, fill?, fillOpacity?, visible? }, __w?: true, __h?: true (instance resized) }. Its children are generated
//   copies of the main's subtree with ids `${instanceId}~${mainChildId}` and ref: mainChildId. The normalize pass
//   rebuilds them from the main, so edits to the main propagate; overrides survive. Nested copies keep componentId
//   (for "Go to main component") but carry ref, so only top-level instances are synced.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────

import { computeAutoLayout, applyConstraints, wrapText } from './layout.js';
import { localMatrix, absMatrix, boundsOf, applyVec, invert, mul, apply } from './geometry.js';

export const WEB_DOC_VERSION = 1;
export const DEFAULT_FONT = 'Inter, system-ui, sans-serif';
export const FONTS = [DEFAULT_FONT, 'Arial, sans-serif', 'Helvetica, Arial, sans-serif', 'Verdana, sans-serif', 'Trebuchet MS, sans-serif',
  'system-ui, sans-serif', 'Georgia, serif', 'Times New Roman, serif', 'Courier New, monospace', 'ui-monospace, Menlo, monospace'];

export const DEVICE_PRESETS = [
  { group: 'Desktop', name: 'Desktop', w: 1440, h: 1024 }, { group: 'Desktop', name: 'Laptop', w: 1280, h: 832 },
  { group: 'Desktop', name: 'Wide screen', w: 1920, h: 1080 },
  { group: 'Tablet', name: 'Tablet', w: 834, h: 1194 }, { group: 'Tablet', name: 'Tablet mini', w: 744, h: 1133 },
  { group: 'Tablet', name: 'Tablet landscape', w: 1194, h: 834 },
  { group: 'Phone', name: 'Mobile', w: 390, h: 844 }, { group: 'Phone', name: 'Mobile large', w: 430, h: 932 },
  { group: 'Phone', name: 'Mobile small', w: 360, h: 800 },
  { group: 'Other', name: 'Square post', w: 1080, h: 1080 }, { group: 'Other', name: 'Presentation 16:9', w: 1920, h: 1080 },
  { group: 'Other', name: 'Watch', w: 198, h: 242 },
];

// ─── helpers ───
let seq = 0;
const rnd = Math.random().toString(36).slice(2, 6);
export const newId = (p = 'n') => p + rnd + (++seq).toString(36);
export const isInstanceRoot = n => !!(n && n.componentId && !n.ref);
export const clone = v => v == null ? v : JSON.parse(JSON.stringify(v));

export function same(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!same(a[k], b[k])) return false;
  return true;
}

const BASE = { rotation: 0, visible: true, locked: false, opacity: 1, fill: null, fillOpacity: 1, stroke: null, strokeWidth: 1, radius: 0, effects: [], constraints: { h: 'left', v: 'top' }, sizing: { h: 'fixed', v: 'fixed' } };
const TYPE_DEFAULTS = {
  frame: { name: 'Frame', fill: '#ffffff', clip: true, layout: null, children: [] },
  group: { name: 'Group', children: [] },
  rect: { name: 'Rectangle', fill: '#d9d9d9' },
  ellipse: { name: 'Ellipse', fill: '#d9d9d9' },
  line: { name: 'Line', stroke: '#111111', strokeWidth: 2, h: 0 },
  text: { name: 'Text', text: 'Text', fill: '#111111', fontFamily: DEFAULT_FONT, fontSize: 16, fontWeight: 400, italic: false, lineHeight: null, letterSpacing: 0, align: 'left', textMode: 'auto-width', sizing: { h: 'hug', v: 'hug' } },
  image: { name: 'Image', fill: null, imageId: null, imgW: 0, imgH: 0, fit: 'fill', crop: { scale: 1, x: 0.5, y: 0.5 } },
};

/** Create a node object with defaults (does not insert it). */
export function makeNode(type, props = {}) {
  const n = { id: props.id || newId(), type, parent: null, x: 0, y: 0, w: 100, h: 100, ...clone(BASE), ...clone(TYPE_DEFAULTS[type] || {}), ...props };
  if (type === 'line') n.h = 0;
  if (type === 'text' && !props.name) n.name = String(n.text).slice(0, 40) || 'Text';
  return n;
}

export const DEFAULT_LAYOUT = { direction: 'horizontal', gap: 10, padding: [10, 10, 10, 10], align: 'top-left', wrap: false, wrapGap: 10, distribute: 'packed' };

/** Mutable working copy over an immutable doc (copy-on-write node map). */
export class Draft {
  constructor(doc) { this.doc = doc; this.nodes = doc.nodes; this.root = doc.root; this.own = false; this.meta = {}; this.changes = 0; }
  get(id) { return this.nodes[id]; }
  _own() { if (!this.own) { this.nodes = { ...this.nodes }; this.own = true; } }
  set(id, patch) {
    const n = this.nodes[id]; if (!n) return false;
    let diff = false; for (const k in patch) if (!same(n[k], patch[k])) { diff = true; break; }
    if (!diff) return false;
    this._own(); const m = { ...n, ...patch }; for (const k in patch) if (patch[k] === undefined) delete m[k];
    this.nodes[id] = m; this.changes++; return true;
  }
  put(node) { const o = this.nodes[node.id]; if (o && same(o, node)) return false; this._own(); this.nodes[node.id] = node; this.changes++; return true; }
  del(id) { if (!(id in this.nodes)) return; this._own(); delete this.nodes[id]; this.changes++; }
  setRoot(r) { this.root = r; this.changes++; }
  done(extra = {}) {
    if (!this.own && this.root === this.doc.root && !Object.keys(extra).length && !Object.keys(this.meta).length) return this.doc;
    return { ...this.doc, nodes: this.nodes, root: this.root, ...this.meta, ...extra };
  }
}

// ─── tree queries ───
export const childrenOf = (doc, pid) => pid ? (doc.nodes[pid]?.children || []) : doc.root;
export function descendants(nodes, id, out = []) { for (const c of nodes[id]?.children || []) { out.push(c); descendants(nodes, c, out); } return out; }
export function ancestors(nodes, id) { const a = []; for (let p = nodes[id]?.parent; p; p = nodes[p]?.parent) a.push(p); return a; }
export const isAncestor = (nodes, a, id) => ancestors(nodes, id).includes(a);
export const topFrameOf = (nodes, id) => { let n = nodes[id]; while (n?.parent) n = nodes[n.parent]; return n; };
/** The instance (top-level instance root) that owns a generated node, or null. */
export function ownerInstance(nodes, id) { for (let p = nodes[id]?.parent; p; p = nodes[p]?.parent) if (isInstanceRoot(nodes[p])) return p; return null; }
export const insideInstance = (nodes, id) => !!nodes[id]?.ref && !!ownerInstance(nodes, id);
/** Drop ids whose ancestor is also in the list (keeps the outermost). */
export const outermost = (nodes, ids) => ids.filter(id => nodes[id] && !ids.some(o => o !== id && isAncestor(nodes, o, id)));

const listIn = (d, pid) => pid ? (d.get(pid)?.children || []) : d.root;
function setList(d, pid, list) { if (pid) d.set(pid, { children: list }); else d.setRoot(list); }
function detach(d, id) { const n = d.get(id); if (!n) return; setList(d, n.parent, listIn(d, n.parent).filter(c => c !== id)); }
function attach(d, id, pid, index) {
  const list = [...listIn(d, pid)]; const i = index == null || index < 0 || index > list.length ? list.length : index;
  list.splice(i, 0, id); setList(d, pid, list); d.set(id, { parent: pid || null });
}

// ─── text measuring ───
/** Approximate measure for Node / tests: average glyph width 0.55 em (+5 % for bold) plus letter spacing. */
export const approxMeasure = (str, f) => str.length * f.size * (f.weight >= 600 ? 0.58 : 0.55) + str.length * (f.letterSpacing || 0);
export const fontOf = n => ({ family: n.fontFamily || DEFAULT_FONT, size: n.fontSize || 16, weight: n.fontWeight || 400, italic: !!n.italic, letterSpacing: n.letterSpacing || 0 });
export const lineHeightOf = n => n.lineHeight || Math.round((n.fontSize || 16) * 1.2);
/** Lines and size of a text node: { lines, lineHeight, width, height }. */
export function textLayout(n, measure = approxMeasure) {
  const f = fontOf(n), m = s => measure(s, f);
  const auto = n.textMode === 'auto-width' && n.sizing?.h !== 'fill';
  const lines = wrapText(n.text, auto ? Infinity : Math.max(1, n.w), m);
  const lh = lineHeightOf(n);
  return { lines, lineHeight: lh, width: Math.max(0, ...lines.map(m)), height: lines.length * lh };
}

// ─── normalize: styles → components → text → layout / groups ───
const OWN_ROOT_KEYS = new Set(['id', 'name', 'parent', 'x', 'y', 'w', 'h', 'rotation', 'visible', 'locked', 'children', 'isComponent', 'componentId', 'overrides', 'proto', 'constraints', 'sizing', 'ref', 'ignoreLayout']);
const OVERRIDE_KEYS = ['text', 'fill', 'fillOpacity', 'visible'];

function applyStyles(d, styles) {
  const colors = Object.fromEntries((styles?.colors || []).map(s => [s.id, s]));
  const texts = Object.fromEntries((styles?.texts || []).map(s => [s.id, s]));
  for (const id in d.nodes) {
    const n = d.nodes[id];
    if (n.fillStyle) { const s = colors[n.fillStyle]; d.set(id, s ? { fill: s.color, fillOpacity: s.opacity ?? 1 } : { fillStyle: undefined }); }
    if (n.textStyle) {
      const s = texts[n.textStyle];
      d.set(id, s ? { fontFamily: s.fontFamily, fontSize: s.fontSize, fontWeight: s.fontWeight, italic: !!s.italic, lineHeight: s.lineHeight ?? null, letterSpacing: s.letterSpacing || 0 } : { textStyle: undefined });
    }
  }
}

function syncInstance(d, iid) {
  const inst = d.get(iid), main = d.get(inst.componentId);
  if (!main || !main.isComponent || iid === main.id || ancestors(d.nodes, iid).includes(main.id)) return;
  const ov = inst.overrides || {};
  const rootPatch = {};
  for (const k in main) if (!OWN_ROOT_KEYS.has(k)) rootPatch[k] = main[k];
  for (const k in inst) if (!OWN_ROOT_KEYS.has(k) && !(k in main)) rootPatch[k] = undefined;
  const hugH = main.layout && inst.sizing?.h === 'hug', hugV = main.layout && inst.sizing?.v === 'hug';
  if (!hugH && !ov.__size && !ov.__w) rootPatch.w = main.w;
  if (!hugV && !ov.__size && !ov.__h) rootPatch.h = main.h;
  const ro = ov[main.id]; if (ro) for (const k of OVERRIDE_KEYS) if (k !== 'visible' && ro[k] !== undefined) { rootPatch[k] = ro[k]; if (k === 'fill') rootPatch.fillStyle = undefined; }
  d.set(iid, rootPatch);
  const keep = new Set();
  const build = (srcPid, newPid, oldW, oldH, newW, newH, constrain) => {
    const out = [];
    for (const cid of d.get(srcPid)?.children || []) {
      const c = d.get(cid); if (!c || cid === iid) continue;
      const nid = iid + '~' + cid; keep.add(nid);
      const node = { ...c, id: nid, parent: newPid, ref: cid };
      delete node.isComponent;
      const o = ov[cid];
      if (o) for (const k of OVERRIDE_KEYS) if (o[k] !== undefined) { node[k] = o[k]; if (k === 'fill') delete node.fillStyle; }
      if (constrain && (oldW !== newW || oldH !== newH)) Object.assign(node, applyConstraints(c, { w: oldW, h: oldH }, { w: newW, h: newH }));
      const kids = c.children ? build(cid, nid, c.w, c.h, node.w, node.h, !c.layout && c.type === 'frame') : null;
      if (c.type === 'group' && (node.w !== c.w || node.h !== c.h) && kids) {
        // groups scale their content
        for (const k of kids) { const kn = d.get(k), sc = applyConstraints({ ...kn, constraints: { h: 'scale', v: 'scale' } }, { w: c.w, h: c.h }, { w: node.w, h: node.h }); d.set(k, sc); }
      }
      if (kids) node.children = kids;
      const old = d.get(nid);
      if (old) {
        // geometry that the layout pass derives anyway is kept from the previous copy, so an unchanged instance
        // keeps its object identities (stable rendering) instead of flip-flopping between main and laid-out values
        const pl = d.get(srcPid)?.layout && !c.ignoreLayout;
        if (pl) { node.x = old.x; node.y = old.y; if (c.sizing?.h === 'fill') node.w = old.w; if (c.sizing?.v === 'fill') node.h = old.h; }
        if (c.type === 'text' && c.textMode !== 'fixed') { node.h = old.h; if (c.textMode === 'auto-width' && c.sizing?.h !== 'fill') node.w = old.w; }
        if (c.layout && c.sizing?.h === 'hug') node.w = old.w;
        if (c.layout && c.sizing?.v === 'hug') node.h = old.h;
      }
      d.put(old && same(old, node) ? old : node);
      out.push(nid);
    }
    return out;
  };
  const cur = d.get(iid);
  const kids = build(main.id, iid, main.w, main.h, cur.w, cur.h, !main.layout);
  for (const old of descendants(d.nodes, iid)) if (!keep.has(old)) d.del(old);
  d.set(iid, { children: kids });
}

function measureText(d, id, measure) {
  const n = d.get(id);
  if (n.textMode === 'fixed') return;
  const t = textLayout(n, measure);
  if (n.textMode === 'auto-width' && n.sizing?.h !== 'fill') d.set(id, { w: Math.ceil(t.width), h: t.height });
  else d.set(id, { h: t.height });
}

function fitGroup(d, id) {
  const g = d.get(id);
  if (!g.children.length) return;
  const bs = g.children.map(c => d.get(c)).filter(Boolean).map(c => boundsOf(localMatrix(c), c.w, c.h));
  if (!bs.length) return;
  const minx = Math.min(...bs.map(b => b.x)), miny = Math.min(...bs.map(b => b.y));
  const w = Math.max(...bs.map(b => b.x + b.w)) - minx, h = Math.max(...bs.map(b => b.y + b.h)) - miny;
  if (Math.abs(minx) < 1e-6 && Math.abs(miny) < 1e-6 && Math.abs(w - g.w) < 1e-6 && Math.abs(h - g.h) < 1e-6) return;
  for (const c of g.children) { const n = d.get(c); d.set(c, { x: n.x - minx, y: n.y - miny }); }
  // keep the world position: G' = G + c - c' + R(dvec + c' - c)
  const r = (g.rotation || 0) * Math.PI / 180, cos = Math.cos(r), sin = Math.sin(r);
  const vx = minx + w / 2 - g.w / 2, vy = miny + h / 2 - g.h / 2;
  d.set(id, { w, h, x: g.x + g.w / 2 - w / 2 + cos * vx - sin * vy, y: g.y + g.h / 2 - h / 2 + sin * vx + cos * vy });
}

/** Children of a non-auto-layout frame (or group: scale) follow the parent's size change. */
function afterResize(d, id, ow, oh, measure) {
  const n = d.get(id); if (!n) return;
  if (n.type === 'text') { measureText(d, id, measure); return; }
  if (n.type === 'frame' && n.layout) { runAutoLayout(d, id, measure); return; }
  if ((n.type === 'frame' || n.type === 'group') && n.children?.length && (ow !== n.w || oh !== n.h)) {
    for (const c of n.children) {
      const k = d.get(c); if (!k) continue;
      const box = applyConstraints(n.type === 'group' ? { ...k, constraints: { h: 'scale', v: 'scale' } } : k, { w: ow, h: oh }, { w: n.w, h: n.h });
      d.set(c, box);
      if (box.w !== k.w || box.h !== k.h) afterResize(d, c, k.w, k.h, measure);
    }
  }
}

function runAutoLayout(d, id, measure) {
  const n = d.get(id), L = n.layout;
  const kids = n.children.map(c => d.get(c)).filter(Boolean);
  const res = computeAutoLayout({
    w: n.w, h: n.h, direction: L.direction, gap: L.gap, padding: L.padding, align: L.align, wrap: L.wrap, wrapGap: L.wrapGap, distribute: L.distribute,
    sizingW: n.sizing?.h === 'hug' ? 'hug' : 'fixed', sizingH: n.sizing?.v === 'hug' ? 'hug' : 'fixed',
  }, kids.map(k => ({ x: k.x, y: k.y, w: k.w, h: k.h, sizingW: k.sizing?.h, sizingH: k.sizing?.v, visible: k.visible, absolute: k.ignoreLayout })));
  d.set(id, { w: res.w, h: res.h });
  kids.forEach((k, i) => {
    if (k.ignoreLayout || k.visible === false) return;
    const b = res.items[i];
    d.set(k.id, { x: b.x, y: b.y, w: b.w, h: b.h });
    if (b.w !== k.w || b.h !== k.h) afterResize(d, k.id, k.w, k.h, measure);
  });
}

function layoutTree(d, id, measure) {
  const n = d.get(id); if (!n) return;
  if (n.type === 'text') measureText(d, id, measure);
  for (const c of n.children || []) layoutTree(d, c, measure);
  const m = d.get(id);
  if (m.type === 'group') { if (!m.children.length) { detach(d, id); d.del(id); return; } fitGroup(d, id); }
  if (m.type === 'frame' && m.layout) runAutoLayout(d, id, measure);
}

/** Resolve styles, rebuild instances from their main components, measure text and run auto layout / group bounds. */
export function normalize(doc, measure = approxMeasure) {
  const d = new Draft(doc);
  applyStyles(d, doc.styles);
  for (let pass = 0; pass < 2; pass++) {
    for (let it = 0; it < 4; it++) {
      const before = d.changes;
      for (const id of Object.keys(d.nodes)) if (d.nodes[id] && isInstanceRoot(d.nodes[id])) syncInstance(d, id);
      if (d.changes === before) break;
    }
    for (const id of [...d.root]) layoutTree(d, id, measure);
  }
  return d.done();
}

/** normalize + give every ancestor of a changed node a new object identity (lets the renderer memoize by node). */
export function finalize(prev, next, measure) {
  const doc = normalize(next, measure);
  if (!prev || doc.nodes === prev.nodes) return doc;
  const nodes = { ...doc.nodes }, touched = new Set();
  for (const id in nodes) {
    if (nodes[id] === prev.nodes[id]) continue;
    for (let p = nodes[id].parent; p && !touched.has(p) && nodes[p]; p = nodes[p].parent) {
      if (nodes[p] === prev.nodes[p]) nodes[p] = { ...nodes[p] };
      touched.add(p);
    }
  }
  return { ...doc, nodes };
}

// ─── edit operations (all return a new doc; call finalize/normalize afterwards) ───

/**
 * Patch a node. Inside an instance only text / fill / fillOpacity / visible can change: they become overrides on the
 * instance. Setting fill drops a colour style link; setting a font property drops a text style link.
 */
export function patchNode(doc, id, patch) {
  const n = doc.nodes[id]; if (!n) return doc;
  const d = new Draft(doc);
  const owner = n.ref ? ownerInstance(doc.nodes, id) : null;
  const p = { ...patch };
  if ('fill' in p && !('fillStyle' in p)) p.fillStyle = undefined;
  if (['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'italic'].some(k => k in p) && !('textStyle' in p)) p.textStyle = undefined;
  if (owner) {
    const inst = doc.nodes[owner], o = { ...(inst.overrides || {}) }, cur = { ...(o[n.ref] || {}) };
    for (const k of OVERRIDE_KEYS) if (k in p) cur[k] = p[k];
    o[n.ref] = cur; d.set(owner, { overrides: o });
    return d.done();
  }
  if (isInstanceRoot(n)) {
    const main = doc.nodes[n.componentId], o = { ...(n.overrides || {}) };
    const own = {}, ov = {};
    for (const k in p) { if (OWN_ROOT_KEYS.has(k)) own[k] = p[k]; else if (OVERRIDE_KEYS.includes(k)) ov[k] = p[k]; }
    if ('w' in own && own.w !== n.w) o.__w = true;
    if ('h' in own && own.h !== n.h) o.__h = true;
    if (main && Object.keys(ov).length) o[main.id] = { ...(o[main.id] || {}), ...ov };
    d.set(id, { ...own, overrides: o });
    return d.done();
  }
  d.set(id, p);
  return d.done();
}

/** Set position/size; applies constraints for frame children, scales group children; text switches to fixed/auto-height. */
export function resizeNode(doc, id, box, measure) {
  const n = doc.nodes[id]; if (!n) return doc;
  const patch = { ...box };
  if (n.type === 'line') patch.h = 0;
  if (n.type === 'text') {
    if (box.h != null && Math.abs(box.h - n.h) > 0.01) patch.textMode = 'fixed';
    else if (box.w != null && Math.abs(box.w - n.w) > 0.01 && n.textMode === 'auto-width') patch.textMode = 'auto-height';
  }
  const par = n.parent && doc.nodes[n.parent];
  if (par?.layout) {
    const s = { ...(n.sizing || {}) };
    if (box.w != null && Math.abs(box.w - n.w) > 0.01) s.h = 'fixed';
    if (box.h != null && Math.abs(box.h - n.h) > 0.01) s.v = 'fixed';
    patch.sizing = s;
  }
  if (n.layout) {
    const s = { ...(patch.sizing || n.sizing || {}) };
    if (box.w != null && Math.abs(box.w - n.w) > 0.01 && s.h === 'hug') s.h = 'fixed';
    if (box.h != null && Math.abs(box.h - n.h) > 0.01 && s.v === 'hug') s.v = 'fixed';
    patch.sizing = s;
  }
  let out = patchNode(doc, id, patch);
  if (n.ref) return doc; // generated copies cannot be resized
  const d = new Draft(out);
  const m = d.get(id);
  if ((m.w !== n.w || m.h !== n.h) && !isInstanceRoot(m)) afterResize(d, id, n.w, n.h, measure);
  return d.done();
}

/** Insert a node (or a prepared subtree: extra = other nodes keyed by id) under parentId at index. */
export function insertNode(doc, node, parentId = null, index = null, extra = {}) {
  const d = new Draft(doc);
  for (const k in extra) d.put(extra[k]);
  d.put({ ...node, parent: parentId || null });
  attach(d, node.id, parentId, index);
  return d.done();
}

export function removeNodes(doc, ids) {
  const d = new Draft(doc);
  for (const id of outermost(doc.nodes, ids)) {
    const n = d.get(id); if (!n) continue;
    if (n.ref && ownerInstance(d.nodes, id)) { const dd = patchNode({ ...doc, nodes: d.nodes, root: d.root }, id, { visible: false }); d.nodes = dd.nodes; d.own = false; continue; }
    for (const c of descendants(d.nodes, id)) d.del(c);
    detach(d, id); d.del(id);
  }
  const startFrame = d.nodes[doc.startFrame] ? doc.startFrame : null;
  return d.done(startFrame !== doc.startFrame ? { startFrame } : {});
}

/** Move nodes to a new parent / index, keeping their on-canvas position (rotation composes). */
export function reparent(doc, ids, parentId, index = null) {
  const d = new Draft(doc);
  const pm = parentId ? absMatrix(doc.nodes, parentId) : [1, 0, 0, 1, 0, 0];
  const inv = invert(pm);
  let i = index;
  for (const id of outermost(doc.nodes, ids)) {
    const n = d.get(id); if (!n || n.ref || id === parentId || (parentId && isAncestor(d.nodes, id, parentId))) continue;
    const m = absMatrix(d.nodes, id);
    const [cx, cy] = apply(m, n.w / 2, n.h / 2);
    const [lx, ly] = apply(inv, cx, cy);
    const rot = Math.atan2(m[1], m[0]) * 180 / Math.PI - Math.atan2(pm[1], pm[0]) * 180 / Math.PI;
    const sameParent = (n.parent || null) === (parentId || null);
    if (sameParent && i != null) { const cur = listIn(d, parentId).indexOf(id); if (cur < i) i--; }
    detach(d, id);
    const deg = Math.round((((rot % 360) + 360) % 360) * 1000) / 1000;
    d.set(id, { x: lx - n.w / 2, y: ly - n.h / 2, rotation: deg >= 360 ? 0 : deg });
    attach(d, id, parentId, i);
    if (i != null) i++;
  }
  return d.done();
}

/** z-order inside the parent: 'forward' | 'backward' | 'front' | 'back'. */
export function reorder(doc, ids, how) {
  const d = new Draft(doc);
  const byParent = new Map();
  for (const id of ids) { const n = doc.nodes[id]; if (!n || n.ref) continue; const k = n.parent || null; if (!byParent.has(k)) byParent.set(k, []); byParent.get(k).push(id); }
  for (const [pid, sel] of byParent) {
    let list = [...listIn(d, pid)];
    const s = new Set(sel);
    if (how === 'front') list = [...list.filter(x => !s.has(x)), ...list.filter(x => s.has(x))];
    else if (how === 'back') list = [...list.filter(x => s.has(x)), ...list.filter(x => !s.has(x))];
    else if (how === 'forward') { for (let i = list.length - 2; i >= 0; i--) if (s.has(list[i]) && !s.has(list[i + 1])) [list[i], list[i + 1]] = [list[i + 1], list[i]]; }
    else if (how === 'backward') { for (let i = 1; i < list.length; i++) if (s.has(list[i]) && !s.has(list[i - 1])) [list[i], list[i - 1]] = [list[i - 1], list[i]]; }
    setList(d, pid, list);
  }
  return d.done();
}

/**
 * Deep copy of subtrees with fresh ids: { nodes: {id: node}, roots: [id] }. Generated instance children are not copied
 * (the copy is re-synced); a copied main component becomes an instance of it.
 */
export function cloneSubtrees(nodes, ids) {
  const out = {}, roots = [];
  const copy = (id, pid) => {
    const n = nodes[id]; const nid = newId();
    const c = clone(n); c.id = nid; c.parent = pid; delete c.ref;
    if (n.isComponent) { delete c.isComponent; c.componentId = id; c.overrides = {}; c.children = []; c.name = n.name; }
    else if (n.componentId) { c.children = []; c.overrides = clone(n.overrides || {}); }
    else if (n.children) c.children = n.children.map(k => copy(k, nid));
    out[nid] = c; return nid;
  };
  for (const id of outermost(nodes, ids)) roots.push(copy(id, nodes[id].parent || null));
  return { nodes: out, roots };
}

/** Insert copied subtrees (from cloneSubtrees) under parentId; returns { doc, ids }. dx/dy offset the roots. */
export function pasteSubtrees(doc, clip, parentId = null, index = null, dx = 0, dy = 0) {
  const fresh = cloneSubtrees(clip.nodes, clip.roots); // never reuse ids
  const d = new Draft(doc);
  for (const k in fresh.nodes) d.put(fresh.nodes[k]);
  let i = index;
  for (const r of fresh.roots) { const n = d.get(r); d.set(r, { x: n.x + dx, y: n.y + dy }); attach(d, r, parentId, i); if (i != null) i++; }
  return { doc: d.done(), ids: fresh.roots };
}

/** Duplicate in place (+10 offset; top-level frames go to the right). Returns { doc, ids }. */
export function duplicateNodes(doc, ids) {
  let cur = doc; const out = [];
  for (const id of outermost(doc.nodes, ids)) {
    const n = cur.nodes[id]; if (!n || n.ref) continue;
    const pid = n.parent || null;
    const src = { nodes: cur.nodes, roots: [id] };
    const idx = childrenOf(cur, pid).indexOf(id);
    const top = !pid;
    const par = pid && cur.nodes[pid];
    let dx = 10, dy = 10;
    if (top && n.type === 'frame') { dx = n.w + 60; dy = 0; }
    if (par?.layout) { dx = 0; dy = 0; }
    const r = pasteSubtrees(cur, src, pid, idx + 1, dx, dy);
    cur = r.doc; out.push(...r.ids);
  }
  return { doc: cur, ids: out };
}

function boundsInParent(nodes, ids) {
  const bs = ids.map(id => { const n = nodes[id]; return boundsOf(localMatrix(n), n.w, n.h); });
  const x = Math.min(...bs.map(b => b.x)), y = Math.min(...bs.map(b => b.y));
  return { x, y, w: Math.max(...bs.map(b => b.x + b.w)) - x, h: Math.max(...bs.map(b => b.y + b.h)) - y };
}

/** Wrap nodes in a new container (group or frame). Returns { doc, id }. */
export function wrapNodes(doc, ids, type = 'group', props = {}) {
  ids = outermost(doc.nodes, ids).filter(id => !doc.nodes[id].ref);
  if (!ids.length) return { doc, id: null };
  const pid = doc.nodes[ids[0]].parent || null;
  let cur = doc;
  if (ids.some(id => (cur.nodes[id].parent || null) !== pid)) cur = reparent(cur, ids, pid);
  const list = childrenOf(cur, pid);
  ids = list.filter(id => ids.includes(id)); // keep z-order
  const b = boundsInParent(cur.nodes, ids);
  const index = Math.max(...ids.map(id => list.indexOf(id))) - ids.length + 1;
  const box = makeNode(type, { x: b.x, y: b.y, w: b.w, h: b.h, ...(type === 'frame' ? { fill: null, clip: false } : {}), ...props, children: [] });
  const par = pid && cur.nodes[pid];
  if (par?.layout) box.sizing = { h: 'fixed', v: 'fixed' };
  const d = new Draft(cur);
  for (const id of ids) detach(d, id);
  d.put({ ...box, parent: pid });
  attach(d, box.id, pid, index);
  for (const id of ids) { const n = d.get(id); d.set(id, { x: n.x - b.x, y: n.y - b.y, parent: box.id }); }
  d.set(box.id, { children: ids });
  return { doc: d.done(), id: box.id };
}

/** Ungroup groups / remove frames (children move to the parent at the same place). Returns { doc, ids }. */
export function ungroup(doc, ids) {
  let cur = doc; const out = [];
  for (const id of outermost(doc.nodes, ids)) {
    const g = cur.nodes[id];
    if (!g || !g.children || g.ref || isInstanceRoot(g)) continue;
    const pid = g.parent || null, idx = childrenOf(cur, pid).indexOf(id), kids = [...g.children];
    cur = reparent(cur, kids, pid, idx);
    cur = removeNodes(cur, [id]);
    out.push(...kids);
  }
  return { doc: cur, ids: out };
}

/** Shift+A: add auto layout to a frame (inferring direction, gap and padding), or wrap the selection in an auto layout frame. */
export function addAutoLayout(doc, ids) {
  ids = outermost(doc.nodes, ids);
  const one = ids.length === 1 && doc.nodes[ids[0]];
  if (one && one.type === 'frame' && !one.layout && !one.ref && !isInstanceRoot(one)) {
    return { doc: setLayout(doc, one.id, inferLayout(doc.nodes, one)), id: one.id };
  }
  const kids = ids.map(id => doc.nodes[id]);
  const b = boundsInParent(doc.nodes, ids);
  const r = wrapNodes(doc, ids, 'frame', { name: 'Auto layout', fill: null, clip: false });
  if (!r.id) return r;
  const wrapper = { ...r.doc.nodes[r.id], w: b.w, h: b.h, children: kids.map(k => k.id) };
  const layout = inferLayout(r.doc.nodes, wrapper, true);
  return { doc: patchNode(setLayout(r.doc, r.id, layout), r.id, { sizing: { h: 'hug', v: 'hug' } }), id: r.id };
}

/** Guess direction / gap / padding from how the children are currently placed. */
export function inferLayout(nodes, frame, tight = false) {
  const kids = (frame.children || []).map(id => nodes[id]).filter(Boolean);
  if (!kids.length) return { ...clone(DEFAULT_LAYOUT) };
  const bs = kids.map(k => boundsOf(localMatrix(k), k.w, k.h));
  const spanX = Math.max(...bs.map(b => b.x + b.w)) - Math.min(...bs.map(b => b.x));
  const spanY = Math.max(...bs.map(b => b.y + b.h)) - Math.min(...bs.map(b => b.y));
  const sumW = bs.reduce((a, b) => a + b.w, 0), sumH = bs.reduce((a, b) => a + b.h, 0);
  const horizontal = kids.length > 1 ? spanX - sumW > spanY - sumH ? spanX / sumW >= spanY / sumH : spanX / Math.max(1, sumW) > spanY / Math.max(1, sumH) : frame.w >= frame.h;
  const order = bs.map((b, i) => [b, i]).sort((a, b) => horizontal ? a[0].x - b[0].x : a[0].y - b[0].y);
  let gaps = [];
  for (let i = 1; i < order.length; i++) gaps.push(horizontal ? order[i][0].x - (order[i - 1][0].x + order[i - 1][0].w) : order[i][0].y - (order[i - 1][0].y + order[i - 1][0].h));
  const gap = gaps.length ? Math.max(0, Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length)) : 10;
  const minX = Math.min(...bs.map(b => b.x)), minY = Math.min(...bs.map(b => b.y));
  const pad = tight ? [0, 0, 0, 0] : [Math.max(0, Math.round(minY)), Math.max(0, Math.round(frame.w - Math.max(...bs.map(b => b.x + b.w)))), Math.max(0, Math.round(frame.h - Math.max(...bs.map(b => b.y + b.h)))), Math.max(0, Math.round(minX))];
  return { ...clone(DEFAULT_LAYOUT), direction: horizontal ? 'horizontal' : 'vertical', gap, padding: pad, _order: order.map(o => kids[o[1]].id) };
}

/** Patch a frame's layout (null removes it). Adding layout sorts children into their visual order. */
export function setLayout(doc, id, layout) {
  const n = doc.nodes[id]; if (!n) return doc;
  if (layout && layout._order) {
    const { _order, ...rest } = layout;
    const d = new Draft(patchNode(doc, id, { layout: rest }));
    if (!n.ref && !isInstanceRoot(n)) d.set(id, { children: _order.concat(n.children.filter(c => !_order.includes(c))) });
    return d.done();
  }
  return patchNode(doc, id, { layout });
}

// ─── components ───
let compN = 0;
/** Ctrl+Alt+K: turn a frame into a main component, or wrap the selection in a new one. Returns { doc, id }. */
export function createComponent(doc, ids) {
  ids = outermost(doc.nodes, ids).filter(id => !doc.nodes[id].ref);
  if (!ids.length) return { doc, id: null };
  const one = ids.length === 1 && doc.nodes[ids[0]];
  if (one && one.type === 'frame' && !one.componentId && !one.isComponent && !descendants(doc.nodes, one.id).some(c => doc.nodes[c].isComponent)) {
    return { doc: patchNode(doc, one.id, { isComponent: true, name: /^Frame/.test(one.name) ? 'Component ' + (++compN) : one.name }), id: one.id };
  }
  if (one?.isComponent) return { doc, id: one.id };
  const r = wrapNodes(doc, ids, 'frame', { name: (one && one.name) || 'Component ' + (++compN), fill: null, clip: false });
  return { doc: patchNode(r.doc, r.id, { isComponent: true }), id: r.id };
}

/** Place an instance of main component `mainId`. Returns { doc, id } (id null if it would nest the component in itself). */
export function createInstance(doc, mainId, parentId = null, x = 0, y = 0, index = null) {
  const main = doc.nodes[mainId];
  if (!main?.isComponent) return { doc, id: null };
  if (parentId && (parentId === mainId || isAncestor(doc.nodes, mainId, parentId))) return { doc, id: null };
  const inst = makeNode('frame', { name: main.name, x, y, w: main.w, h: main.h, componentId: mainId, overrides: {}, children: [], sizing: clone(main.sizing) });
  return { doc: insertNode(doc, inst, parentId, index), id: inst.id };
}

/** Turn an instance into plain layers (nested instances stay instances of their own main). Returns the new doc. */
export function detachInstance(doc, id) {
  const n = doc.nodes[id]; if (!n?.componentId) return doc;
  const d = new Draft(doc);
  d.set(id, { componentId: undefined, overrides: undefined, ref: undefined });
  const walk = pid => {
    for (const c of d.get(pid).children || []) {
      const k = d.get(c); d.set(c, { ref: undefined });
      if (!k.componentId) walk(c);
    }
  };
  walk(id);
  return d.done();
}

export function resetOverrides(doc, id) {
  if (!isInstanceRoot(doc.nodes[id])) return doc;
  const d = new Draft(doc); d.set(id, { overrides: {} }); return d.done();
}

// ─── shared styles ───
export function addColorStyle(doc, { name, color, opacity = 1 }, applyTo = []) {
  const id = newId('cs');
  let out = { ...doc, styles: { ...doc.styles, colors: [...(doc.styles?.colors || []), { id, name: name || 'Color ' + ((doc.styles?.colors || []).length + 1), color, opacity }] } };
  for (const nid of applyTo) out = patchNode(out, nid, { fillStyle: id, fill: color, fillOpacity: opacity });
  return { doc: out, id };
}
export function addTextStyle(doc, fromNode, name, applyTo = []) {
  const id = newId('ts');
  const s = { id, name: name || `${fromNode.fontSize}/${fromNode.fontWeight}`, fontFamily: fromNode.fontFamily, fontSize: fromNode.fontSize, fontWeight: fromNode.fontWeight, italic: !!fromNode.italic, lineHeight: fromNode.lineHeight ?? null, letterSpacing: fromNode.letterSpacing || 0 };
  let out = { ...doc, styles: { ...doc.styles, texts: [...(doc.styles?.texts || []), s] } };
  for (const nid of applyTo) out = patchNode(out, nid, { textStyle: id });
  return { doc: out, id };
}
export function updateStyle(doc, kind, id, patch) {
  const list = (doc.styles?.[kind] || []).map(s => s.id === id ? { ...s, ...patch } : s);
  return { ...doc, styles: { ...doc.styles, [kind]: list } };
}
/** Delete a style; layers keep its current values. */
export function deleteStyle(doc, kind, id) {
  const d = new Draft(doc), key = kind === 'colors' ? 'fillStyle' : 'textStyle';
  for (const nid in doc.nodes) if (doc.nodes[nid][key] === id) d.set(nid, { [key]: undefined });
  return d.done({ styles: { ...doc.styles, [kind]: (doc.styles?.[kind] || []).filter(s => s.id !== id) } });
}
export const styleUsers = (doc, kind, id) => Object.values(doc.nodes).filter(n => n[kind === 'colors' ? 'fillStyle' : 'textStyle'] === id).map(n => n.id);

// ─── documents ───
export function emptyDoc(name = 'Untitled design') {
  return { kind: 'web', version: WEB_DOC_VERSION, name, root: [], nodes: {}, startFrame: null, styles: { colors: [], texts: [] }, images: {}, canvasBg: '#1b1b1e' };
}
/** Accept a stored doc (or anything else) and return a valid web doc. */
export function migrateWebDoc(doc) {
  if (!doc || doc.kind !== 'web') return emptyDoc();
  if (doc.version === WEB_DOC_VERSION && doc.nodes && doc.root && doc.styles?.colors && doc.styles?.texts && doc.images) return doc;
  if ((doc.version || 1) > WEB_DOC_VERSION) throw new Error('This web design was saved by a newer version of Zertake Studio.');
  const base = emptyDoc(doc.name);
  return { ...base, ...doc, styles: { colors: [], texts: [], ...(doc.styles || {}) }, images: doc.images || {}, version: WEB_DOC_VERSION };
}

/** Next free spot to the right of the existing top-level nodes. */
export function nextFramePosition(doc) {
  const tops = doc.root.map(id => doc.nodes[id]).filter(Boolean);
  if (!tops.length) return { x: 0, y: 0 };
  return { x: Math.max(...tops.map(n => n.x + n.w)) + 100, y: Math.min(...tops.map(n => n.y)) };
}

export { absMatrix, mul, applyVec };
