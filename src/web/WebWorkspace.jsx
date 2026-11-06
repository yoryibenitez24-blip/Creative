import React, { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  ArrowLeft, MousePointer2, Frame as FrameIcon, Square, Circle, Minus, Type, Image as ImageIcon, Hand, Play, Undo2, Redo2, ZoomIn, ZoomOut, Maximize, Ruler,
} from 'lucide-react';
import {
  normalize, finalize, migrateWebDoc, makeNode, insertNode, removeNodes, reparent, reorder, cloneSubtrees, pasteSubtrees, duplicateNodes, wrapNodes,
  ungroup, addAutoLayout, setLayout, createComponent, createInstance, detachInstance, resetOverrides, patchNode, resizeNode, addColorStyle,
  addTextStyle, updateStyle, deleteStyle, childrenOf, outermost, isInstanceRoot, ownerInstance, nextFramePosition, newId, textLayout, isAncestor,
} from './model.js';
import { absMatrix, absBounds, apply, invert, hitTest, unionBounds, intersects, contains, localMatrix, applyVec, mul, I } from './geometry.js';
import { createWebDoc, WEB_TEMPLATES, insertTemplate } from './templates.js';
import { cssForNode, exportFrameHtml, exportSvg, nodeStyle } from './codegen.js';
import { renderNodeToCanvas, canvasToBlob, canvasMeasure } from './raster.js';
import { NodeView, Present } from './render.jsx';
import { LayersPanel, AssetsPanel, DesignPanel, PrototypePanel, InspectPanel } from './panels.jsx';

export { createWebDoc, WEB_TEMPLATES };

/*
 * Zertake Studio — Web / UI design workspace (full screen).
 *
 *   <WebWorkspace doc={webDoc} onChange={(doc, label) => …} onExit={() => …} />
 *
 * doc: a web design document (schema in ./model.js, kind 'web'); null/undefined starts a blank desktop design.
 * onChange(doc, label): called once per committed edit with the new document and a human-readable history label
 *   ('Add rectangle', 'Gap', 'Undo', …). Pass the doc back as the `doc` prop. Transient states while dragging are not
 *   emitted. A doc prop that is not the last emitted one (e.g. the host's own undo) replaces the workspace state.
 * onExit(): the user pressed the back button.
 * Keyboard shortcuts are handled on window in the capture phase while this component is mounted; handled keys are
 * stopped there (stopImmediatePropagation) so the host's own shortcuts do not fire twice. Inputs keep their keys.
 */

let MEASURE = null;
const getMeasure = () => MEASURE || (MEASURE = typeof document !== 'undefined' ? canvasMeasure() : undefined);
let CLIPBOARD = null; // internal clipboard, shared by all mounts: { nodes, roots, images }

const TOOLS = [
  ['move', 'Move', MousePointer2, 'V'], ['frame', 'Frame', FrameIcon, 'F'], ['rect', 'Rectangle', Square, 'R'], ['ellipse', 'Ellipse', Circle, 'O'],
  ['line', 'Line', Minus, 'L'], ['text', 'Text', Type, 'T'], ['hand', 'Hand', Hand, 'H'],
];
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const HANDLE_POS = { nw: [0, 0], n: [0.5, 0], ne: [1, 0], e: [1, 0.5], se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5] };
const CURSOR = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };
const LABEL = { frame: 'Add frame', rect: 'Add rectangle', ellipse: 'Add ellipse', line: 'Add line' };
const isField = t => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
const download = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); };
const fileName = s => (String(s).replace(/[\\/:*?"<>|]+/g, '-').trim() || 'export');
const corners = (m, w, h) => [apply(m, 0, 0), apply(m, w, 0), apply(m, w, h), apply(m, 0, h)];
const edges = b => ({ x: [b.x, b.x + b.w / 2, b.x + b.w], y: [b.y, b.y + b.h / 2, b.y + b.h] });

/** Snap a moving box to target boxes. Returns the correction and guide lines (world coords). */
function snapBox(box, targets, thr, axes = { x: [0, 1, 2], y: [0, 1, 2] }) {
  const me = edges(box); let bx = null, by = null;
  for (const t of targets) {
    const te = edges(t);
    for (const i of axes.x) for (const v of te.x) { const d = v - me.x[i]; if (Math.abs(d) <= thr && (!bx || Math.abs(d) < Math.abs(bx.d))) bx = { d, v }; }
    for (const i of axes.y) for (const v of te.y) { const d = v - me.y[i]; if (Math.abs(d) <= thr && (!by || Math.abs(d) < Math.abs(by.d))) by = { d, v }; }
  }
  const dx = bx ? bx.d : 0, dy = by ? by.d : 0, nb = { x: box.x + dx, y: box.y + dy, w: box.w, h: box.h };
  const guides = [];
  if (bx) { const hits = targets.filter(t => edges(t).x.some(v => Math.abs(v - bx.v) < 0.01)); const ys = [nb.y, nb.y + nb.h, ...hits.flatMap(t => [t.y, t.y + t.h])]; guides.push({ x1: bx.v, y1: Math.min(...ys), x2: bx.v, y2: Math.max(...ys) }); }
  if (by) { const hits = targets.filter(t => edges(t).y.some(v => Math.abs(v - by.v) < 0.01)); const xs = [nb.x, nb.x + nb.w, ...hits.flatMap(t => [t.x, t.x + t.w])]; guides.push({ x1: Math.min(...xs), y1: by.v, x2: Math.max(...xs), y2: by.v }); }
  return { dx, dy, guides };
}

/** Red measurement lines between box a (selection) and b (hovered layer, or the container around it). */
function measureLines(a, b) {
  const out = [];
  if (contains(b, a)) {
    const cy = a.y + a.h / 2, cx = a.x + a.w / 2;
    out.push({ x1: b.x, y1: cy, x2: a.x, y2: cy }, { x1: a.x + a.w, y1: cy, x2: b.x + b.w, y2: cy }, { x1: cx, y1: b.y, x2: cx, y2: a.y }, { x1: cx, y1: a.y + a.h, x2: cx, y2: b.y + b.h });
  } else {
    const oy = [Math.max(a.y, b.y), Math.min(a.y + a.h, b.y + b.h)], ox = [Math.max(a.x, b.x), Math.min(a.x + a.w, b.x + b.w)];
    const my = oy[0] < oy[1] ? (oy[0] + oy[1]) / 2 : a.y + a.h / 2, mx = ox[0] < ox[1] ? (ox[0] + ox[1]) / 2 : a.x + a.w / 2;
    if (b.x >= a.x + a.w) out.push({ x1: a.x + a.w, y1: my, x2: b.x, y2: my }); else if (a.x >= b.x + b.w) out.push({ x1: b.x + b.w, y1: my, x2: a.x, y2: my });
    if (b.y >= a.y + a.h) out.push({ x1: mx, y1: a.y + a.h, x2: mx, y2: b.y }); else if (a.y >= b.y + b.h) out.push({ x1: mx, y1: b.y + b.h, x2: mx, y2: a.y });
  }
  return out.filter(l => Math.hypot(l.x2 - l.x1, l.y2 - l.y1) > 0.01);
}

export default function WebWorkspace({ doc: docProp, onChange, onExit }) {
  const measure = getMeasure();
  const [, force] = useReducer(x => x + 1, 0);
  // ── document state: head = last committed doc, live = transient doc while dragging ──
  const headRef = useRef(null), emitted = useRef(null), seen = useRef(Symbol('none'));
  if (seen.current !== docProp) {
    seen.current = docProp;
    if (docProp !== emitted.current || !headRef.current) headRef.current = normalize(migrateWebDoc(docProp ?? createWebDoc('desktop')), measure);
  }
  const [live, setLive] = useState(null);
  const doc = live || headRef.current;
  const docRef = useRef(doc); docRef.current = doc;
  const hist = useRef({ past: [], future: [] });

  const [sel, setSelState] = useState([]);
  const selRef = useRef(sel); selRef.current = sel;
  const setSel = useCallback(s => { const v = (Array.isArray(s) ? s : []).filter(Boolean); selRef.current = v; setSelState(v); }, []);
  const [view, setViewState] = useState({ x: 100, y: 100, z: 0.5 });
  const viewRef = useRef(view);
  const setView = useCallback(v => { const nv = typeof v === 'function' ? v(viewRef.current) : v; viewRef.current = nv; setViewState(nv); }, []);
  const [tool, setTool] = useState('move');
  const [rightTab, setRightTab] = useState('design');
  const [leftTab, setLeftTab] = useState('layers');
  const [hover, setHover] = useState(null);
  const [overlay, setOverlay] = useState({ guides: [], marquee: null });
  const [editing, setEditing] = useState(null); // { id|null, parent, x, y, w, mode, value }
  const [presenting, setPresenting] = useState(null);
  const [rulers, setRulers] = useState(false);
  const [alt, setAlt] = useState(false);
  const [menu, setMenu] = useState(null);
  const [toast, setToast] = useState(null);
  const [exportScale, setExportScale] = useState(2);
  const [spaceDown, setSpaceDown] = useState(false);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const canvasRef = useRef(null), fileRef = useRef(null), replaceRef = useRef(null), drag = useRef(null), store = useRef({});
  store.current = { doc, measure, interactive: false };
  const say = useCallback(msg => { setToast(msg); clearTimeout(say.t); say.t = setTimeout(() => setToast(null), 2200); }, []);

  // keep the selection valid
  useEffect(() => { if (sel.some(id => !doc.nodes[id])) setSel(sel.filter(id => doc.nodes[id])); }, [doc]);

  const commit = useCallback((next, label) => {
    const prev = headRef.current;
    const out = finalize(prev, next, measure);
    setLive(null);
    if (out === prev || (out.nodes === prev.nodes && out.root === prev.root && out.styles === prev.styles && out.startFrame === prev.startFrame && out.canvasBg === prev.canvasBg && out.name === prev.name && out.images === prev.images)) { force(); return prev; }
    const h = hist.current; h.past.push(prev); if (h.past.length > 200) h.past.shift(); h.future = [];
    headRef.current = out; emitted.current = out; force();
    onChange?.(out, label);
    return out;
  }, [onChange, measure]);
  const run = useCallback((fn, label) => {
    const r = fn(headRef.current); if (!r) return;
    const d = r.nodes ? r : r.doc; if (!d) return;
    commit(d, label);
    if (r.ids) setSel(r.ids); else if (r.id) setSel([r.id]);
  }, [commit]);
  const undo = useCallback(() => {
    const h = hist.current; if (!h.past.length) return;
    const prev = h.past.pop(); h.future.push(headRef.current);
    headRef.current = prev; emitted.current = prev; setLive(null); force(); onChange?.(prev, 'Undo');
  }, [onChange]);
  const redo = useCallback(() => {
    const h = hist.current; if (!h.future.length) return;
    const next = h.future.pop(); h.past.push(headRef.current);
    headRef.current = next; emitted.current = next; setLive(null); force(); onChange?.(next, 'Redo');
  }, [onChange]);

  // ── view ──
  const toWorld = useCallback((cx, cy) => { const r = canvasRef.current.getBoundingClientRect(), v = viewRef.current; return [(cx - r.left - v.x) / v.z, (cy - r.top - v.y) / v.z]; }, []);
  const zoomAt = useCallback((z, sx, sy) => setView(v => { const nz = Math.min(256, Math.max(0.02, z)); if (sx == null) { sx = size.w / 2; sy = size.h / 2; } return { z: nz, x: sx - (sx - v.x) * nz / v.z, y: sy - (sy - v.y) * nz / v.z }; }), [size]);
  const fitBounds = useCallback(b => {
    if (!b || !canvasRef.current) return;
    const r = canvasRef.current.getBoundingClientRect(), pad = 60;
    const z = Math.min(8, Math.max(0.02, Math.min((r.width - pad * 2) / Math.max(1, b.w), (r.height - pad * 2) / Math.max(1, b.h))));
    setView({ z, x: r.width / 2 - (b.x + b.w / 2) * z, y: r.height / 2 - (b.y + b.h / 2) * z });
  }, []);
  const fitAll = useCallback(() => fitBounds(unionBounds(docRef.current.root.map(id => absBounds(docRef.current.nodes, id)))), [fitBounds]);
  const fitSel = useCallback(() => { const b = unionBounds(selRef.current.map(id => absBounds(docRef.current.nodes, id))); if (b) fitBounds(b); else fitAll(); }, [fitBounds, fitAll]);
  useLayoutEffect(() => {
    const el = canvasRef.current; if (!el) return;
    const ro = new ResizeObserver(() => { const r = el.getBoundingClientRect(); setSize({ w: r.width, h: r.height }); });
    ro.observe(el); const r = el.getBoundingClientRect(); setSize({ w: r.width, h: r.height });
    if (docRef.current.root.length) fitAll();
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const el = canvasRef.current; if (!el) return;
    const onWheel = e => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) zoomAt(viewRef.current.z * Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025)), e.clientX - r.left, e.clientY - r.top);
      else { const k = e.deltaMode === 1 ? 16 : 1; setView(v => ({ ...v, x: v.x - (e.shiftKey ? e.deltaY : e.deltaX) * k, y: v.y - (e.shiftKey ? 0 : e.deltaY) * k })); }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  // ── selection helpers ──
  const containerAt = useCallback((d, wx, wy, skip) => {
    const path = hitTest(d, wx, wy, { tol: 0, skip });
    for (let i = path.length - 1; i >= 0; i--) {
      const n = d.nodes[path[i]];
      if (n.type === 'frame' && !n.componentId && !n.ref) return n.id;
    }
    return null;
  }, []);
  /** Which node a click on `path` selects (top-level frame children first; drills to siblings of the selection). */
  const pickFromPath = useCallback((d, path, deep) => {
    if (!path.length) return null;
    if (deep) { for (let i = path.length - 1; i >= 0; i--) if (d.nodes[path[i]].type !== 'group' || i === 0) return path[i]; }
    const parents = new Set(selRef.current.map(id => d.nodes[id]?.parent).filter(Boolean));
    const selected = new Set(selRef.current);
    for (let j = path.length - 1; j >= 1; j--) if (parents.has(d.nodes[path[j]].parent) || selected.has(d.nodes[path[j]].parent)) return path[j];
    const top = d.nodes[path[0]];
    if (top.type === 'frame' && path.length > 1) return path[1];
    return path[0];
  }, []);

  // ── pointer interaction ──
  const onPointerDown = e => {
    if (menu) setMenu(null);
    if (editing) { commitText(); return; }
    const el = canvasRef.current; el.setPointerCapture?.(e.pointerId);
    const [wx, wy] = toWorld(e.clientX, e.clientY);
    const d = headRef.current;
    if (e.button === 1 || spaceDown || tool === 'hand' || (e.button === 0 && e.target.dataset?.pan)) { drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, v: viewRef.current }; return; }
    if (e.button === 2) {
      const path = hitTest(d, wx, wy, { tol: 4 / viewRef.current.z });
      const pick = pickFromPath(d, path, false);
      if (pick && !selRef.current.includes(pick)) setSel([pick]);
      return;
    }
    const handle = e.target.dataset?.handle, label = e.target.dataset?.label;
    if (handle) { startTransform(handle, wx, wy, e); return; }
    if (label) { setSel(e.shiftKey ? [...new Set([...selRef.current, label])] : [label]); startMove([label], wx, wy, e); return; }
    if (['frame', 'rect', 'ellipse', 'line', 'text'].includes(tool)) {
      const parent = containerAt(d, wx, wy, null);
      drag.current = { kind: 'create', tool, parent, sx: wx, sy: wy, x: wx, y: wy, moved: false };
      return;
    }
    const path = hitTest(d, wx, wy, { tol: 4 / viewRef.current.z });
    const deep = e.ctrlKey || e.metaKey;
    let pick = pickFromPath(d, path, deep);
    if (pick && !deep && path.length === 1 && d.nodes[pick].type === 'frame' && d.nodes[pick].children.length && !selRef.current.includes(pick)) {
      // background of a top-level frame with content: marquee inside it
      startMarquee(pick, wx, wy, e.shiftKey); return;
    }
    if (!pick) { startMarquee(null, wx, wy, e.shiftKey); return; }
    if (e.shiftKey) { setSel(selRef.current.includes(pick) ? selRef.current.filter(x => x !== pick) : [...selRef.current, pick]); return; }
    let ids = selRef.current.includes(pick) ? selRef.current : [pick];
    setSel(ids);
    startMove(ids, wx, wy, e);
  };

  const startMarquee = (scope, wx, wy, add) => { drag.current = { kind: 'marquee', scope, sx: wx, sy: wy, base: add ? selRef.current : [] }; if (!add) setSel([]); };

  const startMove = (ids, wx, wy) => {
    const d = headRef.current;
    ids = outermost(d.nodes, ids).filter(id => !d.nodes[id].locked && !d.nodes[id].ref);
    if (!ids.length) return;
    const moving = new Set(ids);
    const parentIds = new Set(ids.map(id => d.nodes[id].parent || null));
    const targets = [];
    for (const pid of parentIds) {
      for (const c of childrenOf(d, pid)) if (!moving.has(c) && d.nodes[c].visible !== false) targets.push(absBounds(d.nodes, c));
      if (pid) targets.push(absBounds(d.nodes, pid));
    }
    const one = ids.length === 1 ? d.nodes[ids[0]] : null;
    const inAL = one && one.parent && d.nodes[one.parent].layout && !one.ignoreLayout;
    drag.current = { kind: 'move', ids, sx: wx, sy: wy, start: d, box: unionBounds(ids.map(id => absBounds(d.nodes, id))), targets, inAL, moved: false,
      orig: Object.fromEntries(ids.map(id => [id, { x: d.nodes[id].x, y: d.nodes[id].y, inv: invert(d.nodes[id].parent ? absMatrix(d.nodes, d.nodes[id].parent) : I) }])) };
  };

  const startTransform = (handle, wx, wy, e) => {
    const d = headRef.current, ids = outermost(d.nodes, selRef.current).filter(id => !d.nodes[id].locked && !d.nodes[id].ref);
    if (!ids.length) return;
    if (handle === 'rot') {
      const n = d.nodes[ids[0]], m = absMatrix(d.nodes, n.id), c = apply(m, n.w / 2, n.h / 2);
      drag.current = { kind: 'rotate', id: n.id, c, a0: Math.atan2(wy - c[1], wx - c[0]), r0: n.rotation || 0 };
      return;
    }
    if (ids.length === 1) {
      const n = d.nodes[ids[0]], M = absMatrix(d.nodes, n.id);
      const axisAligned = Math.abs(M[1]) < 1e-9 && Math.abs(M[2]) < 1e-9;
      const targets = [...childrenOf(d, n.parent || null).filter(c => c !== n.id).map(c => absBounds(d.nodes, c)), ...(n.parent ? [absBounds(d.nodes, n.parent)] : [])];
      drag.current = { kind: 'resize', handle, id: n.id, n0: n, inv: invert(M), M, L: localMatrix(n), axisAligned, targets };
    } else {
      drag.current = { kind: 'resize-multi', handle, ids, B: unionBounds(ids.map(id => absBounds(d.nodes, id))), boxes: Object.fromEntries(ids.map(id => [id, { b: absBounds(d.nodes, id), n: d.nodes[id], pinv: invert(d.nodes[id].parent ? absMatrix(d.nodes, d.nodes[id].parent) : I) }])) };
    }
  };

  const onPointerMove = e => {
    const g = drag.current;
    const [wx, wy] = toWorld(e.clientX, e.clientY);
    if (!g) {
      if (tool === 'move' && !spaceDown) {
        const d = docRef.current; const path = hitTest(d, wx, wy, { tol: 4 / viewRef.current.z });
        const pick = pickFromPath(d, path, e.ctrlKey || e.metaKey);
        if (pick !== hover) setHover(pick);
      }
      if (e.altKey !== alt) setAlt(e.altKey);
      return;
    }
    const head = headRef.current, z = viewRef.current.z;
    if (g.kind === 'pan') { setView({ ...g.v, x: g.v.x + e.clientX - g.sx, y: g.v.y + e.clientY - g.sy }); return; }
    if (g.kind === 'marquee') {
      const r = { x: Math.min(g.sx, wx), y: Math.min(g.sy, wy), w: Math.abs(wx - g.sx), h: Math.abs(wy - g.sy) };
      const cands = childrenOf(head, g.scope).filter(id => head.nodes[id].visible !== false && !head.nodes[id].locked);
      const hit = cands.filter(id => intersects(r, absBounds(head.nodes, id)));
      setSel([...new Set([...g.base, ...hit])]);
      setOverlay({ guides: [], marquee: r });
      return;
    }
    if (g.kind === 'create') {
      g.moved = g.moved || Math.hypot(wx - g.sx, wy - g.sy) * z > 3; g.x = wx; g.y = wy;
      if (!g.moved || g.tool === 'text') { if (g.tool === 'text') setOverlay({ guides: [], marquee: g.moved ? { x: Math.min(g.sx, wx), y: Math.min(g.sy, wy), w: Math.abs(wx - g.sx), h: Math.abs(wy - g.sy) } : null }); return; }
      const node = shapeFromDrag(g, e.shiftKey, e.altKey);
      g.node = node;
      setLive(finalize(head, insertNode(head, node, g.parent), measure));
      setSel([node.id]);
      return;
    }
    if (g.kind === 'move') {
      let dx = wx - g.sx, dy = wy - g.sy;
      if (!g.moved && Math.hypot(dx, dy) * z < 3) return;
      g.moved = true;
      if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      if (g.inAL) {
        // reorder inside the auto layout frame by pointer position
        const id = g.ids[0], pid = head.nodes[id].parent, P = head.nodes[pid], horiz = P.layout.direction !== 'vertical';
        const sibs = P.children.filter(c => c !== id && !head.nodes[c].ignoreLayout);
        const pb = absBounds(head.nodes, pid);
        if (wx < pb.x || wy < pb.y || wx > pb.x + pb.w || wy > pb.y + pb.h) {
          g.outside = true; setOverlay({ guides: [], marquee: null, ghost: { ...g.box, x: g.box.x + dx, y: g.box.y + dy } }); setLive(null); return;
        }
        g.outside = false;
        const idx = sibs.filter(c => { const b = absBounds(head.nodes, c); return horiz ? b.x + b.w / 2 < wx : b.y + b.h / 2 < wy; }).length;
        const order = [...sibs]; order.splice(idx, 0, id);
        const full = P.children.map(c => head.nodes[c].ignoreLayout ? c : null);
        let k = 0; const children = full.map(c => c ?? order[k++]);
        g.order = children;
        setLive(finalize(head, { ...head, nodes: { ...head.nodes, [pid]: { ...P, children } } }, measure));
        setOverlay({ guides: [], marquee: null });
        return;
      }
      const s = snapBox({ ...g.box, x: g.box.x + dx, y: g.box.y + dy }, g.targets, 6 / z);
      if (!e.ctrlKey && !e.metaKey) { dx += s.dx; dy += s.dy; }
      const nodes = { ...head.nodes };
      for (const id of g.ids) { const o = g.orig[id]; const [lx, ly] = applyVec(o.inv, dx, dy); nodes[id] = { ...nodes[id], x: o.x + lx, y: o.y + ly }; }
      setLive(finalize(head, { ...head, nodes }, measure));
      setOverlay({ guides: e.ctrlKey || e.metaKey ? [] : s.guides, marquee: null });
      return;
    }
    if (g.kind === 'resize') {
      const n0 = g.n0, h = g.handle;
      let [lx, ly] = apply(g.inv, wx, wy);
      let x0 = 0, y0 = 0, x1 = n0.w, y1 = n0.h;
      const guides = [];
      if (g.axisAligned && !e.ctrlKey && !e.metaKey) {
        // snap the moving edges (world = M applied to local)
        const thr = 6 / z, wxS = apply(g.M, lx, ly);
        const tx = g.targets.flatMap(t => edges(t).x), ty = g.targets.flatMap(t => edges(t).y);
        const near = (v, list) => list.reduce((b, t) => Math.abs(t - v) <= thr && (b == null || Math.abs(t - v) < Math.abs(b - v)) ? t : b, null);
        if (/[ew]/.test(h)) { const sx = near(wxS[0], tx); if (sx != null) { lx = apply(g.inv, sx, wy)[0]; guides.push({ x1: sx, y1: -1e5, x2: sx, y2: 1e5, local: true }); } }
        if (/[ns]/.test(h)) { const sy = near(wxS[1], ty); if (sy != null) { ly = apply(g.inv, wx, sy)[1]; guides.push({ x1: -1e5, y1: sy, x2: 1e5, y2: sy, local: true }); } }
      }
      if (h.includes('w')) x0 = lx; if (h.includes('e')) x1 = lx; if (h.includes('n')) y0 = ly; if (h.includes('s')) y1 = ly;
      if (e.altKey) { if (h.includes('w')) x1 = n0.w - x0; if (h.includes('e')) x0 = n0.w - x1; if (h.includes('n')) y1 = n0.h - y0; if (h.includes('s')) y0 = n0.h - y1; }
      if (e.shiftKey && n0.h > 0 && n0.type !== 'line') {
        const ratio = n0.w / n0.h; let w = x1 - x0, hh = y1 - y0;
        if (h.length === 2) { if (Math.abs(w / n0.w) > Math.abs(hh / n0.h)) hh = Math.sign(hh || 1) * Math.abs(w) / ratio; else w = Math.sign(w || 1) * Math.abs(hh) * ratio; }
        else if (/[ew]/.test(h)) { hh = Math.abs(w) / ratio; y0 = (n0.h - hh) / 2; y1 = y0 + hh; } else { w = Math.abs(hh) * ratio; x0 = (n0.w - w) / 2; x1 = x0 + w; }
        if (h.includes('w')) x0 = x1 - w; else if (h.includes('e')) x1 = x0 + w;
        if (h.includes('n')) y0 = y1 - hh; else if (h.includes('s')) y1 = y0 + hh;
      }
      if (n0.type === 'line') { y0 = 0; y1 = 0; }
      const nx = Math.min(x0, x1), ny = Math.min(y0, y1), nw = Math.max(n0.type === 'line' ? 1 : 1, Math.abs(x1 - x0)), nh = n0.type === 'line' ? 0 : Math.max(1, Math.abs(y1 - y0));
      const pc = apply(g.L, nx + nw / 2, ny + nh / 2);
      const box = { x: pc[0] - nw / 2, y: pc[1] - nh / 2, w: nw, h: nh };
      setLive(finalize(head, resizeNode(head, g.id, box, measure), measure));
      setOverlay({ guides: guides.map(gg => clipGuide(gg, head, g.id, box)), marquee: null });
      return;
    }
    if (g.kind === 'resize-multi') {
      const B = g.B, h = g.handle; let x0 = B.x, y0 = B.y, x1 = B.x + B.w, y1 = B.y + B.h;
      if (h.includes('w')) x0 = Math.min(wx, x1 - 1); if (h.includes('e')) x1 = Math.max(wx, x0 + 1); if (h.includes('n')) y0 = Math.min(wy, y1 - 1); if (h.includes('s')) y1 = Math.max(wy, y0 + 1);
      let sx = (x1 - x0) / B.w, sy = (y1 - y0) / B.h;
      if (e.shiftKey) { const s = h.length === 2 ? Math.max(sx, sy) : /[ew]/.test(h) ? sx : sy; sx = sy = s; if (h.includes('w')) x0 = x1 - B.w * s; else x1 = x0 + B.w * s; if (h.includes('n')) y0 = y1 - B.h * s; else y1 = y0 + B.h * s; }
      let cur = head;
      for (const id of g.ids) {
        const { b, n, pinv } = g.boxes[id];
        const nb = { x: x0 + (b.x - B.x) * sx, y: y0 + (b.y - B.y) * sy, w: b.w * sx, h: b.h * sy };
        const c = apply(pinv, nb.x + nb.w / 2, nb.y + nb.h / 2);
        const w = n.w * sx, hh = n.type === 'line' ? 0 : n.h * sy;
        cur = resizeNode(cur, id, { x: c[0] - w / 2, y: c[1] - hh / 2, w, h: hh }, measure);
      }
      setLive(finalize(head, cur, measure));
      return;
    }
    if (g.kind === 'rotate') {
      let deg = g.r0 + (Math.atan2(wy - g.c[1], wx - g.c[0]) - g.a0) * 180 / Math.PI;
      if (e.shiftKey) deg = Math.round(deg / 15) * 15;
      deg = ((Math.round(deg * 100) / 100) % 360 + 360) % 360;
      setLive(finalize(head, patchNode(head, g.id, { rotation: deg }), measure));
    }
  };
  const clipGuide = (gg, d, id, box) => {
    const b = absBounds({ ...d.nodes, [id]: { ...d.nodes[id], ...box } }, id);
    return gg.x1 === gg.x2 ? { x1: gg.x1, x2: gg.x1, y1: b.y - 40, y2: b.y + b.h + 40 } : { y1: gg.y1, y2: gg.y1, x1: b.x - 40, x2: b.x + b.w + 40 };
  };

  const shapeFromDrag = (g, shift, altKey) => {
    const d = headRef.current;
    const pinv = g.parent ? invert(absMatrix(d.nodes, g.parent)) : I;
    let { sx, sy, x, y } = g;
    if (g.tool === 'line') {
      let dx = x - sx, dy = y - sy;
      if (shift) { const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4), len = Math.hypot(dx, dy); dx = Math.cos(a) * len; dy = Math.sin(a) * len; }
      const p0 = apply(pinv, sx, sy), p1 = apply(pinv, sx + dx, sy + dy);
      const len = Math.max(1, Math.hypot(p1[0] - p0[0], p1[1] - p0[1])), ang = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]) * 180 / Math.PI;
      const cx = (p0[0] + p1[0]) / 2, cy = (p0[1] + p1[1]) / 2;
      return makeNode('line', { id: g.node?.id, x: cx - len / 2, y: cy, w: len, h: 0, rotation: Math.round((((ang % 360) + 360) % 360) * 100) / 100 });
    }
    let w = x - sx, h = y - sy;
    if (shift) { const m = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * m; h = Math.sign(h || 1) * m; }
    let x0 = sx, y0 = sy;
    if (altKey) { x0 = sx - w; y0 = sy - h; w *= 2; h *= 2; }
    const a = apply(pinv, Math.min(x0, x0 + w), Math.min(y0, y0 + h));
    const props = { id: g.node?.id, x: Math.round(a[0]), y: Math.round(a[1]), w: Math.max(1, Math.round(Math.abs(w))), h: Math.max(1, Math.round(Math.abs(h))) };
    if (g.tool === 'frame') { const count = Object.values(d.nodes).filter(n => n.type === 'frame').length + 1; return makeNode('frame', { ...props, name: 'Frame ' + count }); }
    return makeNode(g.tool, props);
  };

  const onPointerUp = e => {
    const g = drag.current; drag.current = null;
    setOverlay({ guides: [], marquee: null });
    if (!g) return;
    const head = headRef.current;
    const [wx, wy] = toWorld(e.clientX, e.clientY);
    if (g.kind === 'create') {
      if (g.tool === 'text') {
        const pinv = g.parent ? invert(absMatrix(head.nodes, g.parent)) : I;
        const a = apply(pinv, Math.min(g.sx, wx), Math.min(g.sy, wy));
        setEditing({ id: null, parent: g.parent, x: Math.round(a[0]), y: Math.round(a[1]), w: g.moved ? Math.max(20, Math.round(Math.abs(wx - g.sx))) : null, value: '' });
        setTool('move');
        return;
      }
      let node = g.node;
      if (!g.moved) {
        const dflt = g.tool === 'line' ? 100 : 100;
        const fake = { ...g, x: g.sx + dflt, y: g.tool === 'line' ? g.sy : g.sy + dflt };
        node = shapeFromDrag(fake, false, false);
      }
      run(d => ({ doc: insertNode(d, node, g.parent), id: node.id }), LABEL[g.tool]);
      setTool('move');
      return;
    }
    if (g.kind === 'move' && g.moved) {
      if (g.inAL) {
        if (g.outside) {
          const id = g.ids[0];
          const target = containerAt(head, wx, wy, new Set(g.ids));
          run(d => {
            let out = reparent(d, [id], target, null);
            const n = out.nodes[id], b = absBounds(out.nodes, id), [dx, dy] = applyVec(invert(target ? absMatrix(out.nodes, target) : I), wx - (b.x + b.w / 2), wy - (b.y + b.h / 2));
            out = patchNode(out, id, { x: n.x + dx, y: n.y + dy });
            return { doc: out, ids: [id] };
          }, 'Move layer');
        } else if (g.order) {
          const pid = head.nodes[g.ids[0]].parent;
          commit({ ...head, nodes: { ...head.nodes, [pid]: { ...head.nodes[pid], children: g.order } } }, 'Reorder');
        } else setLive(null);
        return;
      }
      let moved = live || head;
      const target = containerAt(moved, wx, wy, new Set(g.ids));
      const cur = g.ids.map(id => moved.nodes[id].parent || null);
      const box = unionBounds(g.ids.map(id => absBounds(moved.nodes, id)));
      const topFrames = g.ids.every(id => !moved.nodes[id].parent && moved.nodes[id].type === 'frame');
      const fits = target && contains(absBounds(moved.nodes, target), box);
      if (cur.some(p => p !== target) && (!topFrames || fits)) {
        let index = null;
        const T = target && moved.nodes[target];
        if (T?.layout) { const horiz = T.layout.direction !== 'vertical'; index = T.children.filter(c => { const b = absBounds(moved.nodes, c); return horiz ? b.x + b.w / 2 < wx : b.y + b.h / 2 < wy; }).length; }
        moved = reparent(moved, g.ids, target, index);
      }
      commit(moved, g.ids.length > 1 ? 'Move layers' : 'Move layer');
      return;
    }
    if (g.kind === 'move' || g.kind === 'marquee' || g.kind === 'pan') { setLive(null); return; }
    if (g.kind === 'resize' || g.kind === 'resize-multi') { if (live) commit(live, 'Resize'); return; }
    if (g.kind === 'rotate') { if (live) commit(live, 'Rotate'); }
  };

  const onDoubleClick = e => {
    const [wx, wy] = toWorld(e.clientX, e.clientY);
    const d = headRef.current;
    const label = e.target.dataset?.label;
    if (label) { fitBounds(absBounds(d.nodes, label)); return; }
    const path = hitTest(d, wx, wy, { tol: 4 / viewRef.current.z });
    if (!path.length) return;
    const cur = selRef.current.length === 1 ? selRef.current[0] : null;
    const i = cur ? path.indexOf(cur) : -1;
    if (cur && d.nodes[cur]?.type === 'text' && i === path.length - 1) { editText(cur); return; }
    if (i >= 0 && i < path.length - 1) { const next = path[i + 1]; setSel([next]); if (d.nodes[next].type === 'text' && i + 1 === path.length - 1) { /* select first, edit on next double click */ } return; }
    const pick = pickFromPath(d, path, false);
    if (pick && d.nodes[pick].type === 'text') { setSel([pick]); editText(pick); }
  };

  // ── text editing ──
  const editText = id => { const n = headRef.current.nodes[id]; if (!n || n.type !== 'text') return; setSel([id]); setEditing({ id, value: n.text }); };
  const editingRef = useRef(editing); editingRef.current = editing;
  const commitText = useCallback(() => {
    const ed = editingRef.current; if (!ed) return;
    editingRef.current = null; setEditing(null);
    const d = headRef.current;
    if (ed.id) {
      const n = d.nodes[ed.id]; if (!n) return;
      if (!ed.value.trim() && !n.ref) { run(dd => removeNodes(dd, [ed.id]), 'Delete text'); setSel([]); }
      else if (ed.value !== n.text) run(dd => patchNode(dd, ed.id, { text: ed.value, name: n.ref || n.name !== String(n.text).slice(0, 40) ? n.name : ed.value.slice(0, 40) }), 'Edit text');
      return;
    }
    if (!ed.value.trim()) return;
    const node = makeNode('text', { x: ed.x, y: ed.y, text: ed.value, ...(ed.w ? { w: ed.w, textMode: 'auto-height', sizing: { h: 'fixed', v: 'hug' } } : {}) });
    run(dd => ({ doc: insertNode(dd, node, ed.parent), id: node.id }), 'Add text');
  }, [run]);

  // ── commands ──
  const selection = () => outermost(headRef.current.nodes, selRef.current).filter(id => headRef.current.nodes[id]);
  const cmd = useMemo(() => ({
    delete: () => { const ids = selection(); if (!ids.length) return; run(d => removeNodes(d, ids), ids.length > 1 ? 'Delete layers' : 'Delete layer'); setSel([]); },
    duplicate: () => { const ids = selection(); if (ids.length) run(d => duplicateNodes(d, ids), 'Duplicate'); },
    copy: () => { const ids = selection().filter(id => !headRef.current.nodes[id].ref); if (!ids.length) return; CLIPBOARD = { ...cloneSubtrees(headRef.current.nodes, ids), images: headRef.current.images }; say(`Copied ${ids.length} layer${ids.length > 1 ? 's' : ''}`); },
    cut: () => { cmd.copy(); cmd.delete(); },
    paste: () => {
      if (!CLIPBOARD) return;
      const d = headRef.current, s = selRef.current.length === 1 ? d.nodes[selRef.current[0]] : null;
      let parent = null;
      if (s && s.type === 'frame' && !s.componentId && !s.ref && !CLIPBOARD.roots.some(r => CLIPBOARD.nodes[r].componentId === s.id)) parent = s.id;
      else if (s && s.parent && !s.ref) parent = s.parent;
      const tops = !parent && CLIPBOARD.roots.every(r => CLIPBOARD.nodes[r].type === 'frame');
      run(d0 => {
        let dd = { ...d0, images: { ...(CLIPBOARD.images || {}), ...d0.images } };
        let dx = 0, dy = 0;
        if (tops) { const p = nextFramePosition(d0), minX = Math.min(...CLIPBOARD.roots.map(r => CLIPBOARD.nodes[r].x)), minY = Math.min(...CLIPBOARD.roots.map(r => CLIPBOARD.nodes[r].y)); dx = p.x - minX; dy = p.y - minY; }
        else if (!parent) { dx = 10; dy = 10; }
        return pasteSubtrees(dd, CLIPBOARD, parent, null, dx, dy);
      }, 'Paste');
    },
    group: () => { const ids = selection(); if (ids.length) run(d => wrapNodes(d, ids, 'group'), 'Group'); },
    frameSel: () => { const ids = selection(); if (ids.length) run(d => wrapNodes(d, ids, 'frame', { name: 'Frame', fill: null, clip: false }), 'Frame selection'); },
    ungroup: () => { const ids = selection(); if (ids.length) run(d => ungroup(d, ids), 'Ungroup'); },
    autoLayout: () => { const ids = selection(); if (ids.length) run(d => addAutoLayout(d, ids), 'Add auto layout'); },
    component: () => { const ids = selection(); if (ids.length) run(d => createComponent(d, ids), 'Create component'); },
    order: how => { const ids = selection(); if (ids.length) run(d => reorder(d, ids, how), { front: 'Bring to front', back: 'Send to back', forward: 'Bring forward', backward: 'Send backward' }[how]); },
    toggle: key => { const ids = selection(); if (!ids.length) return; const n = headRef.current.nodes[ids[0]]; const v = key === 'visible' ? n.visible === false : !n.locked; run(d => ids.reduce((a, id) => patchNode(a, id, { [key]: v }), d), key === 'visible' ? (v ? 'Show layer' : 'Hide layer') : (v ? 'Lock layer' : 'Unlock layer')); },
    nudge: (dx, dy) => {
      const d = headRef.current, ids = selection().filter(id => !d.nodes[id].locked && !d.nodes[id].ref); if (!ids.length) return;
      const one = d.nodes[ids[0]], P = one.parent && d.nodes[one.parent];
      if (ids.length === 1 && P?.layout && !one.ignoreLayout) {
        const horiz = P.layout.direction !== 'vertical', step = (horiz ? dx : dy) || (horiz ? dy : dx); if (!step) return;
        const list = [...P.children], i = list.indexOf(one.id), j = Math.max(0, Math.min(list.length - 1, i + Math.sign(step)));
        if (i === j) return; list.splice(i, 1); list.splice(j, 0, one.id);
        run(dd => ({ ...dd, nodes: { ...dd.nodes, [P.id]: { ...dd.nodes[P.id], children: list } } }), 'Reorder'); return;
      }
      run(dd => ids.reduce((a, id) => { const n = a.nodes[id]; const inv = invert(n.parent ? absMatrix(a.nodes, n.parent) : I); const [lx, ly] = applyVec(inv, dx, dy); return patchNode(a, id, { x: n.x + lx, y: n.y + ly }); }, dd), 'Nudge');
    },
    selectAll: () => { const d = headRef.current; const s = selRef.current[0]; const pid = s ? d.nodes[s]?.parent || null : null; setSel(childrenOf(d, pid).filter(id => d.nodes[id].visible !== false && !d.nodes[id].locked)); },
    escape: () => { const d = headRef.current, s = selRef.current; if (s.length && d.nodes[s[0]]?.parent) setSel([d.nodes[s[0]].parent]); else setSel([]); },
    enter: () => { const d = headRef.current, s = selRef.current; if (s.length !== 1) return; const n = d.nodes[s[0]]; if (n.type === 'text') editText(n.id); else if (n.children?.length) setSel([...n.children]); },
  }), [run, say]);

  // panel API
  const act = useMemo(() => ({
    select: ids => setSel(ids),
    patch: (ids, p, label) => run(d => ids.reduce((a, id) => patchNode(a, id, p), d), label),
    rename: (id, name) => run(d => patchNode(d, id, { name }), 'Rename layer'),
    resize: (id, box, label) => run(d => resizeNode(d, id, box, measure), label),
    setLayout: (id, layout, label) => run(d => setLayout(d, id, layout), label),
    addAutoLayout: () => cmd.autoLayout(),
    createComponent: () => cmd.component(),
    moveTo: (ids, parent, index) => run(d => ({ doc: reparent(d, ids, parent, index), ids }), 'Move layer'),
    setDoc: (p, label) => run(d => ({ ...d, ...p }), label),
    align: kind => {
      const d = headRef.current, ids = selection().filter(id => !d.nodes[id].ref); if (!ids.length) return;
      let ref;
      if (ids.length === 1) { const n = d.nodes[ids[0]]; if (!n.parent) return; ref = absBounds(d.nodes, n.parent); }
      else ref = unionBounds(ids.map(id => absBounds(d.nodes, id)));
      run(dd => ids.reduce((a, id) => {
        const b = absBounds(a.nodes, id), n = a.nodes[id];
        const dx = kind === 'left' ? ref.x - b.x : kind === 'right' ? ref.x + ref.w - b.x - b.w : kind === 'hcenter' ? ref.x + ref.w / 2 - b.x - b.w / 2 : 0;
        const dy = kind === 'top' ? ref.y - b.y : kind === 'bottom' ? ref.y + ref.h - b.y - b.h : kind === 'vcenter' ? ref.y + ref.h / 2 - b.y - b.h / 2 : 0;
        const [lx, ly] = applyVec(invert(n.parent ? absMatrix(a.nodes, n.parent) : I), dx, dy);
        return patchNode(a, id, { x: n.x + lx, y: n.y + ly });
      }, dd), 'Align');
    },
    distribute: axis => {
      const d = headRef.current, ids = selection().filter(id => !d.nodes[id].ref); if (ids.length < 3) return;
      const bs = ids.map(id => ({ id, b: absBounds(d.nodes, id) })).sort((a, b) => axis === 'h' ? a.b.x - b.b.x : a.b.y - b.b.y);
      const first = bs[0].b, last = bs[bs.length - 1].b;
      const total = axis === 'h' ? last.x + last.w - first.x : last.y + last.h - first.y;
      const sum = bs.reduce((a, x) => a + (axis === 'h' ? x.b.w : x.b.h), 0), gap = (total - sum) / (bs.length - 1);
      let pos = axis === 'h' ? first.x : first.y;
      run(dd => bs.reduce((a, { id, b }) => {
        const dv = pos - (axis === 'h' ? b.x : b.y); pos += (axis === 'h' ? b.w : b.h) + gap;
        const n = a.nodes[id]; const [lx, ly] = applyVec(invert(n.parent ? absMatrix(a.nodes, n.parent) : I), axis === 'h' ? dv : 0, axis === 'v' ? dv : 0);
        return patchNode(a, id, { x: n.x + lx, y: n.y + ly });
      }, dd), 'Distribute');
    },
    goTo: id => { const d = headRef.current; if (!d.nodes[id]) return; setSel([id]); fitBounds(absBounds(d.nodes, id)); },
    detach: id => run(d => ({ doc: detachInstance(d, id), id }), 'Detach instance'),
    resetOverrides: id => run(d => resetOverrides(d, id), 'Reset overrides'),
    insertInstance: mainId => {
      const d = headRef.current, s = selRef.current.length === 1 ? d.nodes[selRef.current[0]] : null, main = d.nodes[mainId];
      let parent = s && s.type === 'frame' && !s.componentId && !s.ref && s.id !== mainId && !isAncestor(d.nodes, mainId, s.id) ? s.id : null;
      let x, y;
      if (parent) { const P = d.nodes[parent]; x = Math.max(0, (P.w - main.w) / 2); y = Math.max(0, (P.h - main.h) / 2); }
      else { const v = viewRef.current; x = Math.round((size.w / 2 - v.x) / v.z - main.w / 2); y = Math.round((size.h / 2 - v.y) / v.z - main.h / 2); }
      run(dd => createInstance(dd, mainId, parent, Math.round(x), Math.round(y)), 'Insert instance');
    },
    insertTemplate: tid => { run(d => insertTemplate(d, tid, measure), 'Insert template'); setTimeout(fitSel, 0); },
    createColorStyle: () => { const d = headRef.current, n = d.nodes[selRef.current[0]]; if (!n) return; const ids = selRef.current.filter(id => d.nodes[id].type !== 'line' && d.nodes[id].fill); run(dd => addColorStyle(dd, { color: n.fill || n.stroke, opacity: n.fill ? n.fillOpacity ?? 1 : 1 }, ids).doc, 'Create color style'); },
    createTextStyle: () => { const d = headRef.current, ids = selRef.current.filter(id => d.nodes[id]?.type === 'text'); if (!ids.length) return; run(dd => addTextStyle(dd, d.nodes[ids[0]], null, ids).doc, 'Create text style'); },
    applyColorStyle: sid => { const d = headRef.current, s = d.styles.colors.find(x => x.id === sid); run(dd => selRef.current.filter(id => dd.nodes[id] && dd.nodes[id].type !== 'line' && dd.nodes[id].type !== 'group').reduce((a, id) => a.nodes[id].ref ? patchNode(a, id, { fill: s.color, fillOpacity: s.opacity }) : patchNode(a, id, { fillStyle: sid, fill: s.color }), dd), 'Apply color style'); },
    applyTextStyle: sid => run(dd => selRef.current.filter(id => dd.nodes[id]?.type === 'text' && !dd.nodes[id].ref).reduce((a, id) => patchNode(a, id, { textStyle: sid }), dd), 'Apply text style'),
    updateStyle: (kind, id, p, label) => run(d => updateStyle(d, kind, id, p), label),
    deleteStyle: (kind, id) => run(d => deleteStyle(d, kind, id), 'Delete style'),
    replaceImage: id => { replaceRef.current.dataset.target = id; replaceRef.current.click(); },
    addFramePreset: p => {
      const d = headRef.current, pos = nextFramePosition(d);
      const n = makeNode('frame', { name: p.name, x: pos.x, y: pos.y, w: p.w, h: p.h });
      run(dd => ({ doc: insertNode(dd, n, null), id: n.id }), 'Add frame');
      setTool('move');
      setTimeout(() => fitBounds({ x: n.x, y: n.y, w: n.w, h: n.h }), 0);
    },
    exportNode: async (id, fmt, scale) => {
      const d = headRef.current, n = d.nodes[id]; if (!n) return;
      if (fmt === 'svg') { download(new Blob([exportSvg(d, id, measure)], { type: 'image/svg+xml' }), fileName(n.name) + '.svg'); say('SVG exported'); return; }
      const c = await renderNodeToCanvas(d, id, scale, measure);
      download(await canvasToBlob(c), fileName(n.name) + (scale > 1 ? `@${scale}x` : '') + '.png'); say('PNG exported');
    },
    exportHtml: id => { const d = headRef.current, n = d.nodes[id]; if (!n) return; download(new Blob([exportFrameHtml(d, id)], { type: 'text/html' }), fileName(n.name) + '.html'); say('HTML exported'); },
    copyCss: id => { const css = cssForNode(headRef.current, id); navigator.clipboard?.writeText(css).then(() => say('CSS copied'), () => say('Clipboard unavailable — select the code to copy')); },
    present: () => startPresent(),
  }), [run, measure, size, fitBounds, fitSel, say, cmd]);

  const startPresent = () => {
    const d = headRef.current; const s = selRef.current[0];
    let top = s && d.nodes[s]; while (top?.parent) top = d.nodes[top.parent];
    const frames = d.root.filter(id => d.nodes[id].type === 'frame');
    const start = top && top.type === 'frame' && s ? top.id : d.startFrame && d.nodes[d.startFrame] ? d.startFrame : frames[0];
    if (start) setPresenting(start);
  };

  // ── image import ──
  const importImage = (file, targetId) => {
    if (!file || !/^image\//.test(file.type)) return;
    const fr = new FileReader();
    fr.onload = () => {
      const url = fr.result, img = new Image();
      img.onload = () => {
        const imgId = newId('img'), iw = img.naturalWidth, ih = img.naturalHeight;
        if (targetId) { run(d => patchNode({ ...d, images: { ...d.images, [imgId]: url } }, targetId, { imageId: imgId, imgW: iw, imgH: ih }), 'Replace image'); return; }
        const d = headRef.current, s = selRef.current.length === 1 ? d.nodes[selRef.current[0]] : null;
        const parent = s && s.type === 'frame' && !s.componentId && !s.ref ? s.id : null;
        const P = parent && d.nodes[parent];
        const k = Math.min(1, (P ? P.w * 0.8 : 800) / iw, (P ? P.h * 0.8 : 800) / ih);
        const w = Math.round(iw * k), h = Math.round(ih * k), v = viewRef.current;
        const x = P ? (P.w - w) / 2 : (size.w / 2 - v.x) / v.z - w / 2, y = P ? (P.h - h) / 2 : (size.h / 2 - v.y) / v.z - h / 2;
        const n = makeNode('image', { name: file.name.replace(/\.[^.]+$/, '') || 'Image', x: Math.round(x), y: Math.round(y), w, h, imageId: imgId, imgW: iw, imgH: ih });
        run(dd => ({ doc: insertNode({ ...dd, images: { ...dd.images, [imgId]: url } }, n, parent), id: n.id }), 'Place image');
      };
      img.src = url;
    };
    fr.readAsDataURL(file);
  };

  // ── keyboard ──
  useEffect(() => {
    if (presenting) return;
    const down = e => {
      if (e.key === 'Alt') setAlt(true);
      if (isField(e.target)) return;
      const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase(), code = e.code;
      let handled = true;
      if (e.key === ' ') { if (!e.repeat) setSpaceDown(true); }
      else if (mod && code === 'KeyZ') e.shiftKey ? redo() : undo();
      else if (mod && code === 'KeyY') redo();
      else if (mod && e.altKey && code === 'KeyK') cmd.component();
      else if (mod && e.altKey && code === 'KeyG') cmd.frameSel();
      else if (mod && code === 'KeyG') e.shiftKey ? cmd.ungroup() : cmd.group();
      else if (mod && code === 'KeyD') cmd.duplicate();
      else if (mod && code === 'KeyC') cmd.copy();
      else if (mod && code === 'KeyX') cmd.cut();
      else if (mod && code === 'KeyV') cmd.paste();
      else if (mod && code === 'KeyA') cmd.selectAll();
      else if (mod && e.shiftKey && code === 'KeyH') cmd.toggle('visible');
      else if (mod && e.shiftKey && code === 'KeyL') cmd.toggle('locked');
      else if (mod && code === 'BracketRight') cmd.order(e.shiftKey || e.altKey ? 'front' : 'forward');
      else if (mod && code === 'BracketLeft') cmd.order(e.shiftKey || e.altKey ? 'back' : 'backward');
      else if (mod && (k === '=' || k === '+')) zoomAt(viewRef.current.z * 1.25);
      else if (mod && k === '-') zoomAt(viewRef.current.z / 1.25);
      else if (mod && k === '0') zoomAt(1);
      else if (mod) handled = false;
      else if (e.shiftKey && code === 'KeyA') cmd.autoLayout();
      else if (e.shiftKey && code === 'Digit1') fitAll();
      else if (e.shiftKey && code === 'Digit2') fitSel();
      else if (e.shiftKey && code === 'Digit0') zoomAt(1);
      else if (e.shiftKey && code === 'KeyR') setRulers(r => !r);
      else if (k === 'delete' || k === 'backspace') cmd.delete();
      else if (k.startsWith('arrow')) { const s = e.shiftKey ? 10 : 1; cmd.nudge(k === 'arrowleft' ? -s : k === 'arrowright' ? s : 0, k === 'arrowup' ? -s : k === 'arrowdown' ? s : 0); }
      else if (k === 'escape') { if (menu) setMenu(null); else cmd.escape(); }
      else if (k === 'enter') cmd.enter();
      else if (!e.shiftKey && !e.altKey && { v: 1, f: 1, a: 1, r: 1, o: 1, l: 1, t: 1, h: 1 }[k]) setTool({ v: 'move', f: 'frame', a: 'frame', r: 'rect', o: 'ellipse', l: 'line', t: 'text', h: 'hand' }[k]);
      else handled = false;
      if (handled) { e.preventDefault(); e.stopImmediatePropagation(); }
    };
    const up = e => { if (e.key === ' ') setSpaceDown(false); if (e.key === 'Alt') setAlt(false); };
    const blur = () => { setSpaceDown(false); setAlt(false); };
    window.addEventListener('keydown', down, true); window.addEventListener('keyup', up, true); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', down, true); window.removeEventListener('keyup', up, true); window.removeEventListener('blur', blur); };
  }, [presenting, undo, redo, cmd, zoomAt, fitAll, fitSel, menu]);

  // ── overlay geometry (screen space) ──
  const v = view;
  const S = (x, y) => [x * v.z + v.x, y * v.z + v.y];
  const poly = (id, d = doc) => { const n = d.nodes[id]; if (!n) return ''; const m = absMatrix(d.nodes, id); return corners(m, n.w, n.type === 'line' ? 0 : n.h).map(p => S(...p).join(',')).join(' '); };
  const selNodes = sel.map(id => doc.nodes[id]).filter(Boolean);
  const single = selNodes.length === 1 ? selNodes[0] : null;
  let handles = null;
  if (selNodes.length && tool === 'move' && !editing && !selNodes.every(n => n.ref)) {
    if (single) {
      const m = absMatrix(doc.nodes, single.id), hs = single.type === 'line' ? ['w', 'e'] : HANDLES;
      const top = apply(m, single.w / 2, 0), c = apply(m, single.w / 2, single.h / 2);
      const up = [top[0] - c[0], top[1] - c[1]], len = Math.hypot(...up) || 1;
      const rot = single.type === 'line' ? S(...apply(m, single.w / 2, -22 / v.z)) : S(top[0] + up[0] / len * 22 / v.z, top[1] + up[1] / len * 22 / v.z);
      const P = single.parent && doc.nodes[single.parent];
      handles = { pts: hs.map(h => [h, S(...apply(m, HANDLE_POS[h][0] * single.w, HANDLE_POS[h][1] * (single.type === 'line' ? 0 : single.h)))]), rot: P?.layout && !single.ignoreLayout ? null : rot, rotFrom: S(...top) };
    } else {
      const b = unionBounds(selNodes.map(n => absBounds(doc.nodes, n.id)));
      handles = { box: b, pts: HANDLES.map(h => [h, S(b.x + HANDLE_POS[h][0] * b.w, b.y + HANDLE_POS[h][1] * b.h)]), rot: null };
    }
  }
  const selBox = selNodes.length ? unionBounds(selNodes.map(n => absBounds(doc.nodes, n.id))) : null;
  let measures = [];
  if (alt && selBox && !drag.current) {
    let other = hover && !sel.includes(hover) ? hover : null;
    if (!other && single?.parent) other = single.parent;
    if (other && doc.nodes[other]) measures = measureLines(selBox, absBounds(doc.nodes, other));
  }
  const protoLinks = rightTab === 'prototype' ? Object.values(doc.nodes).filter(n => n.proto?.target && doc.nodes[n.proto.target] && n.visible !== false).map(n => {
    const a = absBounds(doc.nodes, n.id), b = absBounds(doc.nodes, n.proto.target);
    const [x1, y1] = S(a.x + a.w, a.y + a.h / 2), right = b.x > a.x + a.w / 2;
    const [x2, y2] = S(right ? b.x : b.x + b.w, b.y + Math.min(b.h / 2, 40 / v.z));
    const dx = Math.max(40, Math.abs(x2 - x1) / 2) * (right ? 1 : -1);
    return { id: n.id, d: `M${x1},${y1} C${x1 + Math.abs(dx)},${y1} ${x2 - dx},${y2} ${x2},${y2}`, start: [x1, y1], sel: sel.includes(n.id) };
  }) : [];
  const topFrames = doc.root.map(id => doc.nodes[id]).filter(n => n && n.type === 'frame' && n.visible !== false);

  // text editor geometry
  let editor = null;
  if (editing) {
    const n = editing.id ? doc.nodes[editing.id] : makeNode('text', { text: editing.value, x: editing.x, y: editing.y, ...(editing.w ? { w: editing.w, textMode: 'auto-height' } : {}) });
    if (n) {
      const tmp = { ...n, text: editing.value || ' ' };
      const t = textLayout(tmp, measure);
      const m = editing.id ? absMatrix(doc.nodes, n.id) : mul(editing.parent ? absMatrix(doc.nodes, editing.parent) : I, [1, 0, 0, 1, editing.x, editing.y]);
      const w = n.textMode === 'auto-width' && n.sizing?.h !== 'fill' ? Math.max(8, Math.ceil(t.width) + 2) : n.w;
      const style = nodeStyle(doc, { ...n, effects: [] }, 'absolute');
      editor = { m, w, h: Math.max(t.height, t.lineHeight), style };
    }
  }

  const ctxItems = () => {
    const d = headRef.current, s = selection(), n = d.nodes[s[0]], has = s.length > 0;
    return [
      ['Copy', 'Ctrl+C', cmd.copy, has], ['Paste', 'Ctrl+V', cmd.paste, !!CLIPBOARD], ['Duplicate', 'Ctrl+D', cmd.duplicate, has], ['Delete', 'Del', cmd.delete, has], null,
      ['Group selection', 'Ctrl+G', cmd.group, has], ['Ungroup', 'Ctrl+Shift+G', cmd.ungroup, has && !!n?.children && !n.componentId], ['Frame selection', 'Ctrl+Alt+G', cmd.frameSel, has], ['Add auto layout', 'Shift+A', cmd.autoLayout, has], null,
      ['Create component', 'Ctrl+Alt+K', cmd.component, has && !n?.componentId], ['Go to main component', '', () => act.goTo(n.componentId), !!n?.componentId], ['Detach instance', '', () => act.detach(n.id), isInstanceRoot(n)], null,
      ['Bring to front', 'Ctrl+Shift+]', () => cmd.order('front'), has], ['Bring forward', 'Ctrl+]', () => cmd.order('forward'), has], ['Send backward', 'Ctrl+[', () => cmd.order('backward'), has], ['Send to back', 'Ctrl+Shift+[', () => cmd.order('back'), has], null,
      [n?.visible === false ? 'Show' : 'Hide', 'Ctrl+Shift+H', () => cmd.toggle('visible'), has], [n?.locked ? 'Unlock' : 'Lock', 'Ctrl+Shift+L', () => cmd.toggle('locked'), has],
    ];
  };

  const cursor = spaceDown || tool === 'hand' ? (drag.current?.kind === 'pan' ? 'grabbing' : 'grab') : tool === 'move' ? 'default' : tool === 'text' ? 'text' : 'crosshair';
  const rulerTicks = (len, offset, z) => { const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000]; const st = steps.find(s => s * z >= 60) || 10000; const out = []; const start = Math.floor(-offset / z / st) * st; for (let w = start; w * z + offset < len; w += st) out.push([w, w * z + offset]); return out; };

  if (presenting) return <div className="wbRoot"><Present doc={doc} startId={presenting} measure={measure} onExit={() => setPresenting(null)} /></div>;

  return <div className="wbRoot" data-testid="web-workspace" onContextMenu={e => e.preventDefault()}>
    <header className="wbTop">
      <button className="wbBtn ghost" aria-label="Exit Web workspace" onClick={() => onExit?.()}><ArrowLeft size={15} /></button>
      <input className="wbDocName" aria-label="Design name" value={doc.name} onChange={e => { const nd = { ...headRef.current, name: e.target.value }; headRef.current = nd; emitted.current = nd; force(); }} onBlur={() => onChange?.(headRef.current, 'Rename design')} />
      <div className="wbTools" role="toolbar" aria-label="Tools">
        {TOOLS.map(([id, name, Icon, key]) => <button key={id} className={'wbTool' + (tool === id ? ' on' : '')} aria-label={`${name} (${key})`} aria-pressed={tool === id} title={`${name} (${key})`} onClick={() => setTool(id)}><Icon size={16} /></button>)}
        <button className="wbTool" aria-label="Place image" title="Place image" onClick={() => fileRef.current.click()}><ImageIcon size={16} /></button>
      </div>
      <div className="wbTopRight">
        <button className="wbTool" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!hist.current.past.length} onClick={undo}><Undo2 size={16} /></button>
        <button className="wbTool" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!hist.current.future.length} onClick={redo}><Redo2 size={16} /></button>
        <span className="wbSep" />
        <button className={'wbTool' + (rulers ? ' on' : '')} aria-label="Rulers" aria-pressed={rulers} title="Rulers (Shift+R)" onClick={() => setRulers(r => !r)}><Ruler size={16} /></button>
        <button className="wbTool" aria-label="Zoom out" onClick={() => zoomAt(v.z / 1.25)}><ZoomOut size={16} /></button>
        <button className="wbZoom" aria-label="Zoom to 100%" title="Zoom to 100% (Shift+0)" onClick={() => zoomAt(1)}>{Math.round(v.z * 100)}%</button>
        <button className="wbTool" aria-label="Zoom in" onClick={() => zoomAt(v.z * 1.25)}><ZoomIn size={16} /></button>
        <button className="wbTool" aria-label="Zoom to fit" title="Zoom to fit (Shift+1)" onClick={fitAll}><Maximize size={16} /></button>
        <button className="wbBtn primary" aria-label="Present" onClick={startPresent} disabled={!topFrames.length}><Play size={14} /> Present</button>
      </div>
    </header>
    <div className="wbBody">
      <aside className="wbLeft">
        <div className="wbTabs" role="tablist">{[['layers', 'Layers'], ['assets', 'Assets']].map(([k, l]) => <button key={k} role="tab" aria-selected={leftTab === k} className={leftTab === k ? 'on' : ''} onClick={() => setLeftTab(k)}>{l}</button>)}</div>
        <div className="wbScroll">{leftTab === 'layers' ? <LayersPanel doc={doc} sel={sel} act={act} hover={hover} setHover={setHover} /> : <AssetsPanel doc={doc} sel={sel} act={act} />}</div>
      </aside>
      <main className={'wbCanvas' + (rulers ? ' withRulers' : '')} ref={canvasRef} style={{ cursor, background: doc.canvasBg }} aria-label="Design canvas"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onDoubleClick={onDoubleClick}
        onPointerLeave={() => !drag.current && setHover(null)}
        onContextMenu={e => { e.preventDefault(); const r = canvasRef.current.getBoundingClientRect(); setMenu({ x: e.clientX - r.left, y: e.clientY - r.top }); }}
        onDragOver={e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }}
        onDrop={e => { e.preventDefault(); for (const f of e.dataTransfer.files) importImage(f); }}>
        <div className="wbWorld" style={{ transform: `translate(${v.x}px, ${v.y}px) scale(${v.z})` }}>
          {doc.root.map(id => <NodeView key={id} node={doc.nodes[id]} store={store} />)}
          {editing?.id && <style>{`.wbWorld [data-id="${editing.id}"] .wbText{visibility:hidden}`}</style>}
          {editor && <textarea className="wbTextEditor" aria-label="Edit text" autoFocus value={editing.value}
            style={{ ...editor.style, position: 'absolute', left: 0, top: 0, width: editor.w + 'px', height: editor.h + 'px', transform: `matrix(${editor.m.join(',')})`, transformOrigin: '0 0', display: 'block', background: 'transparent', boxShadow: 'none', resize: 'none', overflow: 'hidden', whiteSpace: editor.style.whiteSpace }}
            onChange={e => setEditing(ed => ({ ...ed, value: e.target.value }))} onPointerDown={e => e.stopPropagation()}
            onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); commitText(); } }} onBlur={commitText} />}
        </div>
        {v.z >= 8 && <div className="wbPixelGrid" style={{ backgroundSize: `${v.z}px ${v.z}px`, backgroundPosition: `${v.x}px ${v.y}px` }} />}
        <svg className="wbOverlay" width={size.w} height={size.h}>
          <defs><marker id="wbArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--wb-proto)" /></marker></defs>
          {topFrames.map(n => { const [x, y] = S(n.x, n.y); return <text key={n.id} data-label={n.id} x={x} y={y - 6} className={'wbFrameLabel' + (sel.includes(n.id) ? ' sel' : '') + (n.isComponent ? ' comp' : '')}>{n.isComponent ? '◆ ' : ''}{n.name}</text>; })}
          {hover && !sel.includes(hover) && doc.nodes[hover] && !drag.current && <polygon points={poly(hover)} className={'wbHover' + (doc.nodes[hover].isComponent || doc.nodes[hover].componentId ? ' comp' : '')} />}
          {selNodes.map(n => <polygon key={n.id} points={poly(n.id)} className={'wbSel' + (n.isComponent || n.componentId ? ' comp' : '')} />)}
          {selNodes.filter(n => n.layout).map(n => { const m = absMatrix(doc.nodes, n.id); return n.children.map(c => doc.nodes[c]).filter(Boolean).map(c => <polygon key={c.id} points={corners(mul(m, localMatrix(c)), c.w, c.h).map(p => S(...p).join(',')).join(' ')} className="wbFlowChild" />); })}
          {handles?.box && <rect x={S(handles.box.x, 0)[0]} y={S(0, handles.box.y)[1]} width={handles.box.w * v.z} height={handles.box.h * v.z} className="wbSel" />}
          {handles?.rot && <><line x1={handles.rotFrom[0]} y1={handles.rotFrom[1]} x2={handles.rot[0]} y2={handles.rot[1]} className="wbRotStem" /><circle data-handle="rot" cx={handles.rot[0]} cy={handles.rot[1]} r={5} className="wbHandle rot" /></>}
          {handles?.pts.map(([h, [x, y]]) => <rect key={h} data-handle={h} x={x - 4} y={y - 4} width={8} height={8} className="wbHandle" style={{ cursor: CURSOR[h] }} />)}
          {selBox && !editing && <g className="wbSize"><rect x={S(selBox.x + selBox.w / 2, 0)[0] - 36} y={S(0, selBox.y + selBox.h)[1] + 8} width={72} height={18} rx={4} /><text x={S(selBox.x + selBox.w / 2, 0)[0]} y={S(0, selBox.y + selBox.h)[1] + 21}>{single ? `${Math.round(single.w)} × ${Math.round(single.h)}` : `${Math.round(selBox.w)} × ${Math.round(selBox.h)}`}</text></g>}
          {overlay.guides.map((g, i) => { const a = S(g.x1, g.y1), b = S(g.x2, g.y2); return <line key={i} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} className="wbGuide" />; })}
          {overlay.ghost && <rect x={S(overlay.ghost.x, 0)[0]} y={S(0, overlay.ghost.y)[1]} width={overlay.ghost.w * v.z} height={overlay.ghost.h * v.z} className="wbGhost" />}
          {measures.map((l, i) => { const a = S(l.x1, l.y1), b = S(l.x2, l.y2), len = Math.round(Math.hypot(l.x2 - l.x1, l.y2 - l.y1)); return <g key={i} className="wbMeasure"><line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} /><rect x={(a[0] + b[0]) / 2 - 16} y={(a[1] + b[1]) / 2 - 9} width={32} height={18} rx={4} /><text x={(a[0] + b[0]) / 2} y={(a[1] + b[1]) / 2 + 4}>{len}</text></g>; })}
          {overlay.marquee && <rect x={S(overlay.marquee.x, 0)[0]} y={S(0, overlay.marquee.y)[1]} width={overlay.marquee.w * v.z} height={overlay.marquee.h * v.z} className="wbMarquee" />}
          {protoLinks.map(l => <g key={l.id} className={'wbProto' + (l.sel ? ' sel' : '')}><path d={l.d} markerEnd="url(#wbArrow)" /><circle cx={l.start[0]} cy={l.start[1]} r={4} /></g>)}
          {rulers && <g className="wbRulers">
            <rect x={0} y={0} width={size.w} height={20} /><rect x={0} y={0} width={20} height={size.h} />
            {selBox && <><rect className="hl" x={S(selBox.x, 0)[0]} y={0} width={selBox.w * v.z} height={20} /><rect className="hl" x={0} y={S(0, selBox.y)[1]} width={20} height={selBox.h * v.z} /></>}
            {rulerTicks(size.w, v.x, v.z).map(([w, x]) => <g key={'x' + w}><line x1={x} y1={12} x2={x} y2={20} /><text x={x + 3} y={10}>{w}</text></g>)}
            {rulerTicks(size.h, v.y, v.z).map(([w, y]) => <g key={'y' + w}><line x1={12} y1={y} x2={20} y2={y} /><text x={10} y={y - 3} transform={`rotate(-90 10 ${y - 3})`}>{w}</text></g>)}
            <rect x={0} y={0} width={20} height={20} />
          </g>}
        </svg>
        {menu && <div className="wbMenu" role="menu" style={{ left: menu.x, top: menu.y }} onPointerDown={e => e.stopPropagation()}>
          {ctxItems().map((it, i) => it ? <button key={i} role="menuitem" disabled={!it[3]} onClick={() => { setMenu(null); it[2](); }}><span>{it[0]}</span><small>{it[1]}</small></button> : <hr key={i} />)}
        </div>}
        {toast && <div className="wbToast" role="status">{toast}</div>}
      </main>
      <aside className="wbRight">
        <div className="wbTabs" role="tablist">{[['design', 'Design'], ['prototype', 'Prototype'], ['inspect', 'Inspect']].map(([k, l]) => <button key={k} role="tab" aria-selected={rightTab === k} className={rightTab === k ? 'on' : ''} onClick={() => setRightTab(k)}>{l}</button>)}</div>
        <div className="wbScroll inspector">
          {rightTab === 'design' && <DesignPanel doc={doc} sel={sel} act={act} tool={tool} exportScale={exportScale} setExportScale={setExportScale} />}
          {rightTab === 'prototype' && <PrototypePanel doc={doc} sel={sel} act={act} />}
          {rightTab === 'inspect' && <InspectPanel doc={doc} sel={sel} act={act} />}
        </div>
      </aside>
    </div>
    <input ref={fileRef} type="file" accept="image/*" hidden aria-label="Image file" onChange={e => { importImage(e.target.files[0]); e.target.value = ''; }} />
    <input ref={replaceRef} type="file" accept="image/*" hidden aria-label="Replacement image file" onChange={e => { importImage(e.target.files[0], e.target.dataset.target); e.target.value = ''; }} />
  </div>;
}
