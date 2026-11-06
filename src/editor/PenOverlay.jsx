import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import * as P from '../engine/paths.js';

// Pen-family tools as an SVG <g> drawn inside the document SVG (document coordinates).
//
// Props
//   tool      'pen' | 'freeform' | 'curvature' | 'addAnchor' | 'deleteAnchor' | 'convert' | 'pathSelect' | 'direct'
//   path      the Path being edited (Work Path, a saved path, a shape layer's path or a vector mask)
//   onChange(path, label)   every change, including intermediate states while dragging
//   onCommit?(path, label)  exactly once at the end of each gesture / key command (one history step)
//   onSelectionChange?({ anchors: string[] ("sub:index"), subpaths: number[] })
//   zoom      screen px per document px (keeps handles a constant on-screen size)
//   toDoc(event) → {x, y} document coordinates of a pointer event
//   options   { rubberBand, autoAddDelete, mode: 'path'|'shape', pathOp: 'combine'|'subtract'|'intersect'|'exclude'
//               (op for new subpaths), curveFit (Freeform tolerance, document px, default 2) }
// Modifiers: Shift constrains to 45° / extends selections, Alt breaks handle symmetry (Pen: Alt over an
// anchor or handle = Convert Point; Path Selection: Alt-drag duplicates), Ctrl/Cmd = Direct Selection
// while a pen tool is active. Keys: Esc/Enter finish the open subpath, Delete/Backspace remove selected
// anchors (Direct Selection) or subpaths (Path Selection), arrows nudge (Shift ×10).

const PEN_TOOLS = ['pen', 'freeform', 'curvature', 'addAnchor', 'deleteAnchor', 'convert'];
const k = (s, i) => s + ':' + i;
const parseKey = key => key.split(':').map(Number);
const EMPTY = { subpaths: [] };

function constrain45(from, p) {
  const dx = p.x - from.x, dy = p.y - from.y, L = Math.hypot(dx, dy);
  if (!L) return { x: p.x, y: p.y };
  const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4), proj = dx * Math.cos(a) + dy * Math.sin(a);
  return { x: from.x + Math.cos(a) * proj, y: from.y + Math.sin(a) * proj };
}

function withSub(path, si, f) {
  const next = P.clonePath(path);
  next.subpaths[si] = f(next.subpaths[si]);
  return next;
}

// Re-run curvature handles on the given anchors (and keep corners cornered).
function recurve(path, si, idxs) {
  return withSub(path, si, s => {
    const n = s.points.length;
    for (let i of idxs) {
      if (s.closed) i = ((i % n) + n) % n;
      if (i >= 0 && i < n) s = P.curvatureHandles(s, i);
    }
    return s;
  });
}

function validKeys(path, keys) {
  return new Set([...keys].filter(key => { const [s, i] = parseKey(key); return path.subpaths[s] && i < path.subpaths[s].points.length; }));
}

export default function PenOverlay({ tool, path, onChange, onCommit, onSelectionChange, zoom = 1, toDoc, options = {} }) {
  const [draft, setDraft] = useState(null);
  const [active, setActive] = useState(null); // index of the open subpath being drawn (pen / curvature)
  const [selAnchors, setSelAnchors] = useState(() => new Set());
  const [selSubs, setSelSubs] = useState(() => new Set());
  const [shownExtra, setShownExtra] = useState(() => new Set()); // anchors whose handles show without being selected
  const [hover, setHover] = useState(null);
  const [marquee, setMarquee] = useState(null);
  const [freeform, setFreeform] = useState(null);
  const gesture = useRef(null);
  const cur = draft || path || EMPTY;
  const curRef = useRef(cur); curRef.current = cur;
  const r = 6 / zoom; // pick radius in document px

  const anchorsSel = useMemo(() => validKeys(cur, selAnchors), [cur, selAnchors]);
  const subsSel = useMemo(() => new Set([...selSubs].filter(s => cur.subpaths[s])), [cur, selSubs]);
  const activeSub = active != null && cur.subpaths[active] && !cur.subpaths[active].closed ? active : null;
  const shown = useMemo(() => {
    const s = new Set([...anchorsSel, ...validKeys(cur, shownExtra)]);
    if (activeSub != null) s.add(k(activeSub, cur.subpaths[activeSub].points.length - 1));
    return s;
  }, [anchorsSel, shownExtra, activeSub, cur]);

  // Reset transient state when the tool changes.
  useEffect(() => { setActive(null); setHover(null); setMarquee(null); setFreeform(null); gesture.current = null; }, [tool]);
  useEffect(() => { onSelectionChange?.({ anchors: [...anchorsSel], subpaths: [...subsSel] }); }, [anchorsSel, subsSel]); // eslint-disable-line

  const cb = useRef(); cb.current = { onChange, onCommit };
  const emit = (next, label) => { setDraft(next); cb.current.onChange?.(next, label); };
  const finish = (next, label) => { cb.current.onCommit?.(next, label); setDraft(null); };
  const commitNow = (next, label) => { emit(next, label); finish(next, label); };

  // ---------------------------------------------------------------- keyboard
  const keyState = useRef(); keyState.current = { tool, activeSub, anchorsSel, subsSel, cur };
  useEffect(() => {
    const onKey = e => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const { tool, activeSub, anchorsSel, subsSel, cur } = keyState.current;
      const handled = () => { e.preventDefault(); e.stopPropagation(); };
      if ((e.key === 'Escape' || e.key === 'Enter') && activeSub != null) { setActive(null); handled(); return; }
      const direct = tool === 'direct' || (PEN_TOOLS.includes(tool) && anchorsSel.size);
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (tool === 'pathSelect' && subsSel.size) { commitNow(P.deleteSubpaths(cur, [...subsSel]), 'Delete Path'); setSelSubs(new Set()); handled(); }
        else if (direct && anchorsSel.size) { commitNow(P.deleteAnchors(cur, anchorsSel), 'Delete Anchor Point'); setSelAnchors(new Set()); setActive(null); handled(); }
        return;
      }
      const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (arrows[e.key]) {
        const step = e.shiftKey ? 10 : 1, [dx, dy] = arrows[e.key];
        if (tool === 'pathSelect' && subsSel.size) { commitNow(P.translatePath(cur, dx * step, dy * step, [...subsSel]), 'Nudge'); handled(); }
        else if (direct && anchorsSel.size) { commitNow(P.moveAnchors(cur, anchorsSel, dx * step, dy * step), 'Nudge'); handled(); }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []); // eslint-disable-line

  // ---------------------------------------------------------------- pointer
  const effectiveTool = e => (PEN_TOOLS.includes(tool) && (e.ctrlKey || e.metaKey) ? 'direct' : tool);
  const hitAll = p => P.hitTest(curRef.current, p, r, { handles: shown });

  function startDirect(e, p, h) {
    const path = curRef.current;
    if (h?.type === 'handle') { gesture.current = { kind: 'handle', ...h, startPath: path, alt: e.altKey, label: 'Drag Handle' }; return; }
    if (h?.type === 'anchor') {
      const key = k(h.sub, h.index);
      let sel = new Set(anchorsSel);
      if (e.shiftKey) { if (sel.has(key)) sel.delete(key); else sel.add(key); }
      else if (!sel.has(key)) sel = new Set([key]);
      setSelAnchors(sel); setShownExtra(new Set());
      if (sel.has(key)) gesture.current = { kind: 'anchors', keys: [...sel], start: p, startPath: path, label: 'Drag Anchor' };
      return;
    }
    if (h?.type === 'segment') {
      const n = path.subpaths[h.sub].points.length;
      if (!e.shiftKey) setSelAnchors(new Set());
      setShownExtra(new Set([k(h.sub, h.index), k(h.sub, (h.index + 1) % n)]));
      gesture.current = { kind: 'segment', sub: h.sub, seg: h.index, t: h.t, start: p, startPath: path, label: 'Drag Curve' };
      return;
    }
    if (!e.shiftKey) { setSelAnchors(new Set()); setShownExtra(new Set()); }
    gesture.current = { kind: 'marquee', target: 'anchors', start: p, additive: e.shiftKey };
  }

  function onPointerDown(e) {
    if (e.button !== 0 || !toDoc) return;
    const p = toDoc(e);
    e.currentTarget.setPointerCapture?.(e.pointerId);
    e.stopPropagation();
    const path = curRef.current, eff = effectiveTool(e), h = hitAll(p);
    gesture.current = null;
    const base = { downAt: p, moved: false };

    if (eff === 'direct') startDirect(e, p, h);
    else if (eff === 'pathSelect') {
      const si = P.subpathAt(path, p, r);
      if (si >= 0) {
        let sel = new Set(subsSel);
        if (e.shiftKey) { if (sel.has(si)) sel.delete(si); else sel.add(si); }
        else if (!sel.has(si)) sel = new Set([si]);
        setSelSubs(sel);
        if (sel.has(si)) gesture.current = { kind: 'subs', subs: [...sel], start: p, startPath: path, dup: e.altKey, label: e.altKey ? 'Duplicate Path' : 'Move Path' };
      } else {
        if (!e.shiftKey) setSelSubs(new Set());
        gesture.current = { kind: 'marquee', target: 'subs', start: p, additive: e.shiftKey };
      }
    } else if (eff === 'pen') penDown(e, p, h);
    else if (eff === 'freeform') {
      gesture.current = { kind: 'freeform' };
      setFreeform([p]);
    } else if (eff === 'curvature') curvatureDown(e, p, h);
    else if (eff === 'addAnchor') {
      if (h?.type === 'segment') insertAndDrag(path, h);
      else startDirect(e, p, h);
    } else if (eff === 'deleteAnchor') {
      if (h?.type === 'anchor') { commitNow(P.deleteAnchor(path, h.sub, h.index), 'Delete Anchor Point'); setSelAnchors(new Set()); }
      else if (h?.type === 'handle') gesture.current = { kind: 'handle', ...h, startPath: path, alt: e.altKey, label: 'Drag Handle' };
    } else if (eff === 'convert') convertDown(p, h);
    if (gesture.current) Object.assign(gesture.current, base);
  }

  function insertAndDrag(path, h) {
    const next = P.insertAnchor(path, h.sub, h.index, h.t), key = k(h.sub, h.index + 1);
    emit(next, 'Add Anchor Point');
    setSelAnchors(new Set([key])); setShownExtra(new Set());
    gesture.current = { kind: 'anchors', keys: [key], start: { x: h.x, y: h.y }, startPath: next, label: 'Add Anchor Point', committed: false, dirty: true };
  }

  function convertDown(p, h) {
    const path = curRef.current;
    if (h?.type === 'handle') { gesture.current = { kind: 'handle', ...h, startPath: path, alt: true, label: 'Convert Point' }; return; }
    if (h?.type === 'anchor') {
      const a = path.subpaths[h.sub].points[h.index];
      setShownExtra(new Set([k(h.sub, h.index)]));
      gesture.current = { kind: 'convertAnchor', sub: h.sub, index: h.index, hadHandles: !!(a.in || a.out), startPath: path, label: 'Convert Point' };
    }
  }

  function penDown(e, p, h) {
    const path = curRef.current;
    if (e.altKey && h && (h.type === 'handle' || h.type === 'anchor') && !(activeSub != null && h.sub === activeSub && h.index === path.subpaths[activeSub].points.length - 1)) { convertDown(p, h); return; }
    if (activeSub != null) {
      const sub = path.subpaths[activeSub], n = sub.points.length;
      if (h?.type === 'anchor' && h.sub === activeSub && h.index === 0 && n >= 2) {
        const next = withSub(path, activeSub, s => ({ ...s, closed: true }));
        emit(next, 'Close Path'); setActive(null);
        gesture.current = { kind: 'penDrag', sub: activeSub, index: 0, startPath: next, label: 'Close Path', dirty: true };
        return;
      }
      if (h?.type === 'anchor' && h.sub === activeSub && h.index === n - 1) {
        // click: remove the outgoing handle (next segment starts as a corner); drag: pull a new one
        const next = withSub(path, activeSub, s => { s.points[n - 1].out = null; s.points[n - 1].smooth = false; return s; });
        emit(next, 'Convert Point');
        gesture.current = { kind: 'handle', sub: activeSub, index: n - 1, which: 'out', startPath: next, alt: true, label: 'Convert Point', dirty: true };
        return;
      }
      if (h?.type === 'anchor' && h.sub !== activeSub) {
        const other = path.subpaths[h.sub], m = other.points.length;
        if (!other.closed && (h.index === 0 || h.index === m - 1)) {
          const add = h.index === 0 ? other : P.reverseSubpath(other);
          const next = P.clonePath(path);
          next.subpaths[activeSub].points.push(...P.cloneSubpath(add).points);
          next.subpaths.splice(h.sub, 1);
          commitNow(next, 'Connect Path');
          setActive(null);
          return;
        }
      }
      let q = e.shiftKey ? constrain45(sub.points[n - 1], p) : p;
      const next = withSub(path, activeSub, s => { s.points.push(P.anchor(q.x, q.y)); return s; });
      emit(next, 'Add Anchor Point');
      gesture.current = { kind: 'penDrag', sub: activeSub, index: n, startPath: next, label: 'Add Anchor Point', dirty: true };
      return;
    }
    if (h?.type === 'handle') { gesture.current = { kind: 'handle', ...h, startPath: path, alt: e.altKey, label: 'Drag Handle' }; return; }
    if (options.autoAddDelete !== false && h?.type === 'segment') { insertAndDrag(path, h); return; }
    if (h?.type === 'anchor') {
      const s = path.subpaths[h.sub], m = s.points.length;
      if (!s.closed && (h.index === m - 1 || h.index === 0)) {
        if (h.index === 0 && m > 1) { const next = P.clonePath(path); next.subpaths[h.sub] = P.reverseSubpath(s); commitNow(next, 'Continue Path'); }
        setActive(h.sub);
        return;
      }
      if (options.autoAddDelete !== false) { commitNow(P.deleteAnchor(path, h.sub, h.index), 'Delete Anchor Point'); setSelAnchors(new Set()); return; }
    }
    const next = P.clonePath(path);
    next.subpaths.push({ closed: false, op: options.pathOp || 'combine', points: [P.anchor(p.x, p.y)] });
    const si = next.subpaths.length - 1;
    emit(next, path.subpaths.length ? 'Add Anchor Point' : 'New Work Path');
    setActive(si); setSelAnchors(new Set()); setSelSubs(new Set());
    gesture.current = { kind: 'penDrag', sub: si, index: 0, startPath: next, label: path.subpaths.length ? 'Add Anchor Point' : 'New Work Path', dirty: true };
  }

  function curvatureDown(e, p, h) {
    const path = curRef.current;
    if (activeSub != null) {
      const n = path.subpaths[activeSub].points.length;
      if (h?.type === 'anchor' && h.sub === activeSub && h.index === 0 && n >= 2) {
        let next = withSub(path, activeSub, s => ({ ...s, closed: true }));
        next = recurve(next, activeSub, [n - 1, 0, 1]);
        commitNow(next, 'Close Path'); setActive(null);
        return;
      }
      if (h?.type === 'anchor') { gesture.current = { kind: 'curvMove', sub: h.sub, index: h.index, startPath: path, start: p, label: 'Drag Anchor' }; return; }
      let next = withSub(path, activeSub, s => { s.points.push(P.anchor(p.x, p.y, null, null, true)); return s; });
      next = recurve(next, activeSub, [n - 2, n - 1, n]);
      emit(next, 'Add Anchor Point');
      gesture.current = { kind: 'curvMove', sub: activeSub, index: n, startPath: next, start: p, label: 'Add Anchor Point', dirty: true };
      return;
    }
    if (h?.type === 'anchor') {
      const s = path.subpaths[h.sub], m = s.points.length;
      if (!s.closed && (h.index === m - 1 || h.index === 0) && m >= 1) {
        if (h.index === 0 && m > 1) { const next = P.clonePath(path); next.subpaths[h.sub] = P.reverseSubpath(s); emit(next, 'Drag Anchor'); gesture.current = { kind: 'curvMove', sub: h.sub, index: m - 1, startPath: next, start: p, label: 'Drag Anchor', dirty: true }; }
        else gesture.current = { kind: 'curvMove', sub: h.sub, index: h.index, startPath: path, start: p, label: 'Drag Anchor' };
        setActive(h.sub);
        return;
      }
      gesture.current = { kind: 'curvMove', sub: h.sub, index: h.index, startPath: path, start: p, label: 'Drag Anchor' };
      return;
    }
    if (h?.type === 'segment') {
      let next = P.insertAnchor(path, h.sub, h.index, h.t);
      next.subpaths[h.sub].points[h.index + 1].smooth = true;
      next = recurve(next, h.sub, [h.index, h.index + 1, h.index + 2]);
      emit(next, 'Add Anchor Point');
      gesture.current = { kind: 'curvMove', sub: h.sub, index: h.index + 1, startPath: next, start: { x: h.x, y: h.y }, label: 'Add Anchor Point', dirty: true };
      return;
    }
    const next = P.clonePath(path);
    next.subpaths.push({ closed: false, op: options.pathOp || 'combine', points: [P.anchor(p.x, p.y, null, null, true)] });
    commitNow(next, path.subpaths.length ? 'Add Anchor Point' : 'New Work Path');
    setActive(next.subpaths.length - 1);
  }

  function onPointerMove(e) {
    if (!toDoc) return;
    const p = toDoc(e), g = gesture.current;
    if (!g) {
      if (PEN_TOOLS.includes(tool) || tool === 'direct' || tool === 'pathSelect') setHover({ p, h: hitAll(p), ctrl: e.ctrlKey || e.metaKey, alt: e.altKey });
      return;
    }
    if (!g.moved && g.downAt && Math.hypot(p.x - g.downAt.x, p.y - g.downAt.y) * zoom < 3) return;
    g.moved = true;
    const sp = g.startPath;
    let next = null;
    if (g.kind === 'penDrag') {
      const a = sp.subpaths[g.sub].points[g.index];
      const q = e.shiftKey ? constrain45(a, p) : p;
      if (!e.altKey) { next = P.moveHandle(sp, g.sub, g.index, 'out', q.x, q.y, { symmetric: true }); g.frozenIn = next.subpaths[g.sub].points[g.index].in; }
      else { // Alt breaks the pair: the incoming handle stays where it was
        next = P.moveHandle(sp, g.sub, g.index, 'out', q.x, q.y, { independent: true });
        if (g.frozenIn) next.subpaths[g.sub].points[g.index].in = { ...g.frozenIn };
      }
    } else if (g.kind === 'handle') {
      const a = sp.subpaths[g.sub].points[g.index], q = e.shiftKey ? constrain45(a, p) : p;
      next = P.moveHandle(sp, g.sub, g.index, g.which, q.x, q.y, { independent: g.alt || e.altKey });
    } else if (g.kind === 'anchors') {
      let d = { x: p.x - g.start.x, y: p.y - g.start.y };
      if (e.shiftKey) d = constrain45({ x: 0, y: 0 }, d);
      next = P.moveAnchors(sp, g.keys, d.x, d.y);
    } else if (g.kind === 'segment') {
      next = P.dragSegment(sp, g.sub, g.seg, g.t, p.x - g.start.x, p.y - g.start.y);
    } else if (g.kind === 'subs') {
      if (g.dup && !g.dupDone) {
        const d = P.duplicateSubpaths(sp, g.subs);
        g.startPath = d.path; g.subs = d.indices; g.dupDone = true;
        setSelSubs(new Set(d.indices));
      }
      let d = { x: p.x - g.start.x, y: p.y - g.start.y };
      if (e.shiftKey) d = constrain45({ x: 0, y: 0 }, d);
      next = P.translatePath(g.startPath, d.x, d.y, g.subs);
    } else if (g.kind === 'convertAnchor') {
      const a = sp.subpaths[g.sub].points[g.index];
      const q = e.shiftKey ? constrain45(a, p) : p;
      next = P.moveHandle(P.convertPoint(sp, g.sub, g.index, false), g.sub, g.index, 'out', q.x, q.y, { symmetric: true });
    } else if (g.kind === 'curvMove') {
      next = P.moveAnchor(sp, g.sub, g.index, p.x, p.y);
      next = recurve(next, g.sub, [g.index - 1, g.index, g.index + 1]);
    } else if (g.kind === 'marquee') {
      setMarquee({ x: Math.min(g.start.x, p.x), y: Math.min(g.start.y, p.y), w: Math.abs(p.x - g.start.x), h: Math.abs(p.y - g.start.y) });
    } else if (g.kind === 'freeform') {
      setFreeform(f => (f && Math.hypot(p.x - f[f.length - 1].x, p.y - f[f.length - 1].y) * zoom >= 1.5 ? [...f, p] : f));
    }
    if (next) { g.dirty = true; g.last = next; emit(next, g.label); }
  }

  function onPointerUp(e) {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (g.kind === 'marquee') {
      const m = marquee; setMarquee(null);
      if (!m || !g.moved) return;
      const inside = a => a.x >= m.x && a.x <= m.x + m.w && a.y >= m.y && a.y <= m.y + m.h;
      if (g.target === 'anchors') {
        const sel = new Set(g.additive ? anchorsSel : []);
        cur.subpaths.forEach((s, si) => s.points.forEach((a, i) => { if (inside(a)) sel.add(k(si, i)); }));
        setSelAnchors(sel);
      } else {
        const sel = new Set(g.additive ? subsSel : []);
        cur.subpaths.forEach((s, si) => { if (s.points.some(inside)) sel.add(si); });
        setSelSubs(sel);
      }
      return;
    }
    if (g.kind === 'freeform') {
      const pts = freeform || []; setFreeform(null);
      if (pts.length < 2) return;
      const first = pts[0], last = pts[pts.length - 1];
      const closed = pts.length > 3 && Math.hypot(first.x - last.x, first.y - last.y) <= r;
      const sub = P.fitBezier(closed ? pts.slice(0, -1) : pts, options.curveFit ?? 2, closed);
      sub.op = options.pathOp || 'combine';
      if (sub.points.length < 2) return;
      const next = P.clonePath(curRef.current);
      next.subpaths.push(sub);
      commitNow(next, 'Freeform Pen');
      return;
    }
    if (g.kind === 'convertAnchor' && !g.moved) {
      if (g.hadHandles) commitNow(P.convertPoint(g.startPath, g.sub, g.index, false), 'Convert Point');
      return;
    }
    if (g.dirty) finish(g.last || g.startPath, g.label);
    else setDraft(null);
  }

  function onDoubleClick(e) {
    if (tool !== 'curvature' || !toDoc) return;
    const p = toDoc(e), h = P.hitTest(curRef.current, p, r);
    if (h?.type !== 'anchor') return;
    const path = curRef.current, a = path.subpaths[h.sub].points[h.index];
    let next = withSub(path, h.sub, s => { s.points[h.index].smooth = !a.smooth; return s; });
    next = recurve(next, h.sub, [h.index - 1, h.index, h.index + 1]);
    commitNow(next, 'Convert Point');
  }

  // ---------------------------------------------------------------- hover feedback (cursor class)
  let hoverKind = '';
  if (hover && !gesture.current) {
    const t = hover.ctrl && PEN_TOOLS.includes(tool) ? 'direct' : tool, h = hover.h;
    if (t === 'pen') {
      if (activeSub != null) hoverKind = h?.type === 'anchor' && h.sub === activeSub && h.index === 0 && cur.subpaths[activeSub].points.length >= 2 ? 'close' : h?.type === 'anchor' && h.sub === activeSub ? 'convert' : 'pen';
      else if (hover.alt && h && h.type !== 'segment') hoverKind = 'convert';
      else if (options.autoAddDelete !== false && h?.type === 'segment') hoverKind = 'add';
      else if (h?.type === 'anchor') { const s = cur.subpaths[h.sub]; hoverKind = !s.closed && (h.index === 0 || h.index === s.points.length - 1) ? 'continue' : options.autoAddDelete !== false ? 'delete' : 'pen'; }
      else hoverKind = 'new';
    } else if (t === 'curvature') hoverKind = activeSub != null && h?.type === 'anchor' && h.sub === activeSub && h.index === 0 ? 'close' : h?.type === 'segment' ? 'add' : 'pen';
    else if (t === 'addAnchor') hoverKind = h?.type === 'segment' ? 'add' : '';
    else if (t === 'deleteAnchor') hoverKind = h?.type === 'anchor' ? 'delete' : '';
    else if (t === 'convert') hoverKind = h && h.type !== 'segment' ? 'convert' : '';
    else hoverKind = h ? 'target' : '';
  }

  // ---------------------------------------------------------------- render
  const sw = 1 / zoom, as = 7 / zoom, hr = 3.5 / zoom;
  const d = P.pathToD(cur);
  let rubber = null;
  if (hover && !gesture.current && activeSub != null && !hover.ctrl) {
    const s = cur.subpaths[activeSub], last = s.points[s.points.length - 1], q = hover.p;
    if (tool === 'pen' && options.rubberBand) {
      const c1 = last.out || last;
      rubber = `M${last.x} ${last.y}C${c1.x} ${c1.y} ${q.x} ${q.y} ${q.x} ${q.y}`;
    } else if (tool === 'curvature') {
      let tmp = withSub(cur, activeSub, t => { t.points.push(P.anchor(q.x, q.y, null, null, true)); return t; });
      const n = tmp.subpaths[activeSub].points.length;
      tmp = recurve(tmp, activeSub, [n - 3, n - 2, n - 1]);
      const ts = tmp.subpaths[activeSub], seg = P.segmentControls(ts, n - 2), prev = n >= 3 ? P.segmentControls(ts, n - 3) : null;
      rubber = (prev ? `M${prev[0].x} ${prev[0].y}C${prev[1].x} ${prev[1].y} ${prev[2].x} ${prev[2].y} ${prev[3].x} ${prev[3].y}` : `M${seg[0].x} ${seg[0].y}`) + `C${seg[1].x} ${seg[1].y} ${seg[2].x} ${seg[2].y} ${seg[3].x} ${seg[3].y}`;
    }
  }
  const showAnchors = tool !== 'pathSelect';
  const handleEls = [];
  if (showAnchors) for (const key of shown) {
    const [si, i] = parseKey(key), a = cur.subpaths[si].points[i];
    for (const w of ['in', 'out']) if (a[w]) handleEls.push(
      <g key={key + w}><line x1={a.x} y1={a.y} x2={a[w].x} y2={a[w].y} className="penHandleLine" strokeWidth={sw} /><circle cx={a[w].x} cy={a[w].y} r={hr} className="penHandle" strokeWidth={sw} /></g>);
  }
  return <g className={`penOverlay penTool-${tool}${hoverKind ? ' penHover-' + hoverKind : ''}`} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onPointerLeave={() => setHover(null)} onDoubleClick={onDoubleClick} data-testid="pen-overlay">
    <rect x={-1e6} y={-1e6} width={2e6} height={2e6} fill="transparent" pointerEvents="all" />
    <g pointerEvents="none">
      {d && <path d={d} className="penPathUnder" strokeWidth={3 * sw} fill="none" />}
      {d && <path d={d} className="penPath" strokeWidth={sw} fill="none" />}
      {tool === 'pathSelect' && [...subsSel].map(si => <path key={si} d={P.subpathToD(cur.subpaths[si])} className="penPathSelected" strokeWidth={2 * sw} fill="none" />)}
      {rubber && <path d={rubber} className="penRubber" strokeWidth={sw} fill="none" />}
      {freeform && freeform.length > 1 && <polyline points={freeform.map(q => q.x + ',' + q.y).join(' ')} className="penPath" strokeWidth={sw} fill="none" />}
      {handleEls}
      {cur.subpaths.map((s, si) => s.points.map((a, i) => {
        const filled = tool === 'pathSelect' ? subsSel.has(si) : anchorsSel.has(k(si, i)) || (activeSub === si && i === s.points.length - 1);
        if (!showAnchors && !filled) return null;
        return <rect key={si + ':' + i} x={a.x - as / 2} y={a.y - as / 2} width={as} height={as} className={filled ? 'penAnchor on' : 'penAnchor'} strokeWidth={sw} />;
      }))}
      {marquee && <rect x={marquee.x} y={marquee.y} width={marquee.w} height={marquee.h} className="penMarquee" strokeWidth={sw} strokeDasharray={`${4 * sw} ${3 * sw}`} />}
    </g>
  </g>;
}

/**
 * Renders a 'shape' layer (see shapeLayerDefaults in engine/paths.js) in document coordinates:
 * fill (exact for every path op), then a stroke aligned inside / center / outside, dashed when
 * strokeDash is set (multiples of strokeWidth). Opacity, blend mode and masks belong to the caller's wrapper.
 */
export function ShapeLayerSvg({ layer }) {
  const uid = 'shp' + useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const { path, fill, stroke, strokeWidth = 0, strokeAlign = 'center', strokeDash = [], strokeCap = 'butt', strokeJoin = 'miter', fillRule = 'nonzero', x = 0, y = 0 } = layer;
  if (P.isEmptyPath(path)) return null;
  const pad = Math.max(2, strokeWidth * 2 + 2), pb = P.pathBounds(path) || { x: 0, y: 0, w: 0, h: 0 };
  const bounds = { x: pb.x - pad, y: pb.y - pad, w: pb.w + 2 * pad, h: pb.h + 2 * pad };
  const vm = P.vectorMaskSvg(path, { fillRule, idPrefix: uid + 'f', bounds });
  const mu = { maskUnits: 'userSpaceOnUse', x: bounds.x, y: bounds.y, width: bounds.w, height: bounds.h };
  const hasStroke = stroke && strokeWidth > 0;
  const needInside = hasStroke && strokeAlign === 'inside', needOutside = hasStroke && strokeAlign === 'outside';
  const out = needOutside ? P.vectorMaskSvg(path, { fillRule, idPrefix: uid + 'o', bounds, invert: true }) : null;
  const dash = strokeDash?.length ? strokeDash.map(v => v * strokeWidth).join(' ') : undefined;
  const strokeEl = w => <path d={vm.d} fill="none" stroke={stroke} strokeWidth={w} strokeDasharray={dash} strokeLinecap={strokeCap} strokeLinejoin={strokeJoin} />;
  return <g transform={x || y ? `translate(${x} ${y})` : undefined}>
    {(!vm.simple || needInside) && <mask id={uid + 'F'} {...mu} dangerouslySetInnerHTML={{ __html: vm.markup }} />}
    {out && <mask id={uid + 'O'} {...mu} dangerouslySetInnerHTML={{ __html: out.markup }} />}
    {fill && (vm.simple ? <path d={vm.d} fill={fill} fillRule={fillRule} /> : <rect x={bounds.x} y={bounds.y} width={bounds.w} height={bounds.h} fill={fill} mask={`url(#${uid}F)`} />)}
    {hasStroke && strokeAlign === 'center' && strokeEl(strokeWidth)}
    {needInside && <g mask={`url(#${uid}F)`}>{strokeEl(strokeWidth * 2)}</g>}
    {needOutside && <g mask={`url(#${uid}O)`}>{strokeEl(strokeWidth * 2)}</g>}
  </g>;
}

/** Small SVG thumbnail of a path (used by the Paths panel; usable for layer thumbnails). */
export function PathThumb({ path, docW, docH, size = 40, fill = '#c9c9d0' }) {
  const b = docW && docH ? { x: 0, y: 0, w: docW, h: docH } : (P.pathBounds(path) || { x: 0, y: 0, w: 1, h: 1 });
  const s = Math.max(b.w, b.h) || 1, vx = b.x - (s - b.w) / 2, vy = b.y - (s - b.h) / 2;
  return <svg className="pathThumb" width={size} height={size} viewBox={`${vx} ${vy} ${s} ${s}`} aria-hidden="true">
    <rect x={vx} y={vy} width={s} height={s} className="pathThumbBg" />
    <path d={P.pathToD(path)} fill={fill} fillRule="nonzero" stroke={fill} strokeWidth={s / 60} />
  </svg>;
}
