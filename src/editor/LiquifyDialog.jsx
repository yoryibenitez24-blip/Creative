import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeftFromLine, Droplets, Expand, Flame, Hand, History, MoveRight, RotateCw, Shrink, Snowflake, Waves, ZoomIn } from 'lucide-react';
import * as L from '../engine/liquify.js';
import { resample } from '../engine/geometry.js';

// Filter › Liquify: full-screen workspace. All editing happens on a down-scaled proxy (≤ 1200 px on
// the longest side) with a displacement field of the proxy's size; strokes update only the dirty
// rectangle of the preview. OK hands the proxy-resolution field to onApply; the ops function
// liquifyOp (src/engine/liquify.js) upsamples it and warps the full-resolution layer in the worker.
//
// Props: source (ImageData of the layer), onCancel(), onApply({ field: { w, h, dx, dy } }).

const PROXY_MAX = 1200, UNDO_MAX = 8;
const TOOLS = [
  ['forwardWarp', 'Forward Warp', 'W', MoveRight],
  ['reconstruct', 'Reconstruct', 'R', History],
  ['smooth', 'Smooth', 'E', Waves],
  ['twirlClockwise', 'Twirl Clockwise', 'C', RotateCw],
  ['pucker', 'Pucker', 'S', Shrink],
  ['bloat', 'Bloat', 'B', Expand],
  ['pushLeft', 'Push Left', 'O', ArrowLeftFromLine],
  ['freezeMask', 'Freeze Mask', 'F', Snowflake],
  ['thawMask', 'Thaw Mask', 'D', Flame],
  ['hand', 'Hand', 'H', Hand],
  ['zoom', 'Zoom', 'Z', ZoomIn],
];
const MESH = { small: 48, medium: 24, large: 12 };
const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));

function Slider({ label, value, min, max, step = 1, onChange, disabled }) {
  return <div className={'crsSlider' + (disabled ? ' lqDisabled' : '')}>
    <div className="crsRow"><span>{label}</span><input type="number" aria-label={label + ' value'} disabled={disabled} min={min} max={max} step={step} value={Math.round(value)} onChange={e => { const v = +e.target.value; if (Number.isFinite(v)) onChange(Math.max(min, Math.min(max, v))); }} /></div>
    <input type="range" aria-label={label} disabled={disabled} min={min} max={max} step={step} value={value} onChange={e => onChange(+e.target.value)} />
  </div>;
}

// effective tool with Alt held: Twirl reverses, Pucker ↔ Bloat
const altTool = (t, alt) => !alt ? t : t === 'twirlClockwise' ? 'twirlCounterClockwise' : t === 'pucker' ? 'bloat' : t === 'bloat' ? 'pucker' : t;

export default function LiquifyDialog({ source, onCancel, onApply }) {
  // ---- proxy + engine state (mutable refs, not React state, so strokes do not re-render) ----
  const P = useRef(null);
  if (!P.current) {
    const W = source.width, H = source.height, k = Math.min(1, PROXY_MAX / Math.max(W, H));
    const full = { w: W, h: H, data: source.data };
    const src = k < 1 ? resample(full, Math.max(1, Math.round(W * k)), Math.max(1, Math.round(H * k)), 'bilinear') : { w: W, h: H, data: new Uint8ClampedArray(source.data) };
    const out = { w: src.w, h: src.h, data: new Uint8ClampedArray(src.data) };
    P.current = { W, H, src, out, scale: src.w / W, field: L.createField(src.w, src.h), freeze: new Uint8Array(src.w * src.h), maskImg: null };
  }
  const p = P.current, w = p.src.w, h = p.src.h;

  const [tool, setTool] = useState('forwardWarp');
  const [brush, setBrush] = useState(() => ({ size: Math.max(10, Math.round(Math.max(p.W, p.H) / 12)), density: 50, pressure: 100, rate: 80 }));
  const [stylus, setStylus] = useState(false);
  const [showMask, setShowMask] = useState(true), [maskColor, setMaskColor] = useState('#ff3030');
  const [showImage, setShowImage] = useState(true), [showMesh, setShowMesh] = useState(false), [meshSize, setMeshSize] = useState('medium'), [meshColor, setMeshColor] = useState('#8f8f99');
  const [preview, setPreview] = useState(true), [reconAmount, setReconAmount] = useState(50);
  const [view, setView] = useState({ z: 1, x: 0, y: 0 });
  const [undoDepth, setUndoDepth] = useState(0), [msg, setMsg] = useState(null), [spaceHand, setSpaceHand] = useState(false);

  const viewport = useRef(), imgCv = useRef(), maskCv = useRef(), meshCv = useRef(), cursor = useRef(), fileIn = useRef();
  const undo = useRef([]), stroke = useRef(null), raf = useRef(0), dirty = useRef(null), meshDirty = useRef(true);
  const live = useRef({}); // latest values for event handlers / timers
  live.current = { tool, brush, stylus, preview, showMask, maskColor, showMesh, meshSize, meshColor, view, spaceHand };

  const maxSize = Math.max(50, Math.min(5000, Math.max(p.W, p.H)));
  const stationary = L.STATIONARY_TOOLS.has(tool);
  const brushProxy = () => ({ ...live.current.brush, size: Math.max(1, live.current.brush.size * p.scale) });

  // ---- rendering ----
  const render = () => {
    raf.current = 0;
    const r = dirty.current; dirty.current = null;
    const { preview: pv, maskColor: mc } = live.current;
    if (r && imgCv.current) {
      const x0 = Math.max(0, r[0]), y0 = Math.max(0, r[1]), x1 = Math.min(w, r[2]), y1 = Math.min(h, r[3]);
      if (x1 > x0 && y1 > y0) {
        if (pv) L.applyFieldInto(p.out, p.src, p.field, [x0, y0, x1, y1]);
        const data = pv ? p.out.data : p.src.data;
        imgCv.current.getContext('2d').putImageData(new ImageData(data, w, h), 0, 0, x0, y0, x1 - x0, y1 - y0);
        // mask overlay
        if (!p.maskImg) p.maskImg = new ImageData(w, h);
        const [cr, cg, cb] = hexRgb(mc), m = p.maskImg.data;
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = y * w + x, q = i * 4; m[q] = cr; m[q + 1] = cg; m[q + 2] = cb; m[q + 3] = p.freeze[i] * 0.55; }
        maskCv.current.getContext('2d').putImageData(p.maskImg, 0, 0, x0, y0, x1 - x0, y1 - y0);
      }
    }
    if (meshDirty.current) { meshDirty.current = false; drawMesh(); }
  };
  const invalidate = (rect = [0, 0, w, h], mesh = true) => {
    if (rect) { const d = dirty.current; dirty.current = d ? [Math.min(d[0], rect[0]), Math.min(d[1], rect[1]), Math.max(d[2], rect[2]), Math.max(d[3], rect[3])] : rect; }
    if (mesh) meshDirty.current = true;
    if (!raf.current) raf.current = requestAnimationFrame(render);
  };
  const drawMesh = () => {
    const cv = meshCv.current, vp = viewport.current; if (!cv || !vp) return;
    const { showMesh: sm, meshSize: ms, meshColor: col, view: v } = live.current;
    const dpr = window.devicePixelRatio || 1, cw = vp.clientWidth, ch = vp.clientHeight;
    if (cv.width !== Math.round(cw * dpr) || cv.height !== Math.round(ch * dpr)) { cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr); }
    const g = cv.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height);
    if (!sm) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const step = Math.max(w, h) / MESH[ms], nx = Math.ceil(w / step), ny = Math.ceil(h / step);
    const pts = [];
    for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
      const [fx, fy] = L.forwardPoint(p.field, Math.min(w, i * step), Math.min(h, j * step));
      pts.push([v.x + fx * v.z, v.y + fy * v.z]);
    }
    g.strokeStyle = col; g.lineWidth = 1; g.globalAlpha = 0.85; g.beginPath();
    for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
      const a = pts[j * (nx + 1) + i];
      if (i < nx) { const b = pts[j * (nx + 1) + i + 1]; g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); }
      if (j < ny) { const b = pts[(j + 1) * (nx + 1) + i]; g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); }
    }
    g.stroke();
  };

  // initial canvas fill + fit to screen
  useEffect(() => {
    imgCv.current.width = maskCv.current.width = w; imgCv.current.height = maskCv.current.height = h;
    fit(); invalidate();
    const ro = new ResizeObserver(() => invalidate(null)); ro.observe(viewport.current);
    return () => { ro.disconnect(); cancelAnimationFrame(raf.current); clearInterval(stroke.current?.timer); };
  }, []);
  useEffect(() => invalidate(), [preview, maskColor]);
  useEffect(() => invalidate(null), [showMesh, meshSize, meshColor, view]);

  // ---- view ----
  const fit = () => {
    const vp = viewport.current; if (!vp) return;
    const z = Math.min((vp.clientWidth - 40) / w, (vp.clientHeight - 40) / h, 4);
    setView({ z, x: (vp.clientWidth - w * z) / 2, y: (vp.clientHeight - h * z) / 2 });
  };
  const zoomAt = (factor, sx, sy) => setView(v => {
    const vp = viewport.current;
    if (sx == null) { sx = vp.clientWidth / 2; sy = vp.clientHeight / 2; }
    const z = Math.max(0.05, Math.min(32, v.z * factor)), k = z / v.z;
    return { z, x: sx - (sx - v.x) * k, y: sy - (sy - v.y) * k };
  });
  const toLocal = e => { const r = viewport.current.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const toProxy = e => { const [sx, sy] = toLocal(e), v = live.current.view; return [(sx - v.x) / v.z, (sy - v.y) / v.z]; };

  // ---- undo ----
  const snapshot = () => {
    undo.current.push({ dx: Float32Array.from(p.field.dx), dy: Float32Array.from(p.field.dy), freeze: Uint8Array.from(p.freeze) });
    if (undo.current.length > UNDO_MAX) undo.current.shift();
    setUndoDepth(undo.current.length);
  };
  const doUndo = () => {
    const s = undo.current.pop(); if (!s) return;
    p.field = { w, h, dx: s.dx, dy: s.dy }; p.freeze = s.freeze;
    setUndoDepth(undo.current.length); invalidate();
  };
  const replaceField = f => { snapshot(); p.field = f; invalidate(); };
  const editMask = fn => { snapshot(); for (let i = 0; i < p.freeze.length; i++) p.freeze[i] = fn(p.freeze[i]); setShowMask(true); invalidate(); };

  // ---- strokes ----
  const dab = (x, y, px, py, pressure, alt) => {
    const t = altTool(live.current.tool, alt);
    const rect = L.applyDabInPlace(p.field, t, { x, y, px, py, pressure }, brushProxy(), p.freeze);
    if (rect) invalidate(rect, t !== 'freezeMask' && t !== 'thawMask');
  };
  const pressureOf = e => live.current.stylus && e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 1;
  const moveCursor = e => {
    const c = cursor.current; if (!c) return;
    const [sx, sy] = toLocal(e), d = live.current.brush.size * p.scale * live.current.view.z;
    c.style.display = ''; c.style.transform = `translate(${sx - d / 2}px, ${sy - d / 2}px)`; c.style.width = c.style.height = d + 'px';
  };
  const onPointerDown = e => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    viewport.current.setPointerCapture(e.pointerId);
    const t = live.current.tool, [sx, sy] = toLocal(e);
    if (t === 'hand' || live.current.spaceHand) { stroke.current = { pan: true, sx, sy, v: live.current.view }; return; }
    if (t === 'zoom') { zoomAt(e.altKey ? 0.5 : 2, sx, sy); return; }
    const [x, y] = toProxy(e), pr = pressureOf(e);
    snapshot();
    const s = stroke.current = { x, y, pressure: pr, alt: e.altKey, timer: 0 };
    if (t !== 'forwardWarp' && t !== 'pushLeft') dab(x, y, x, y, pr, e.altKey);
    if (L.STATIONARY_TOOLS.has(t)) s.timer = setInterval(() => { const c = stroke.current; if (c && !c.pan) dab(c.x, c.y, c.x, c.y, c.pressure, c.alt); }, 50);
  };
  const onPointerMove = e => {
    moveCursor(e);
    const s = stroke.current; if (!s) return;
    if (s.pan) { const [sx, sy] = toLocal(e); setView({ ...s.v, x: s.v.x + sx - s.sx, y: s.v.y + sy - s.sy }); return; }
    const [x, y] = toProxy(e), pr = pressureOf(e), t = live.current.tool;
    s.pressure = pr; s.alt = e.altKey;
    if (t === 'forwardWarp' || t === 'pushLeft') { dab(x, y, s.x, s.y, pr, e.altKey); s.x = x; s.y = y; return; }
    // painting tools: walk the path with a spacing of a quarter radius
    const spacing = Math.max(1, brushProxy().size / 8), len = Math.hypot(x - s.x, y - s.y);
    if (len < spacing) return;
    const n = Math.floor(len / spacing);
    for (let i = 1; i <= n; i++) dab(s.x + (x - s.x) * i / n, s.y + (y - s.y) * i / n, 0, 0, pr, e.altKey);
    s.x = x; s.y = y;
  };
  const endStroke = () => { const s = stroke.current; if (s) clearInterval(s.timer); stroke.current = null; };
  const onWheel = e => { const [sx, sy] = toLocal(e); zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, sx, sy); };

  // ---- mesh files ----
  const saveMesh = () => {
    const blob = new Blob([JSON.stringify(L.serializeField(p.field))], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'liquify-mesh.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000); setMsg('Mesh saved');
  };
  const loadMesh = async file => {
    try { replaceField(L.deserializeField(JSON.parse(await file.text()), w, h)); setMsg('Mesh loaded'); }
    catch (err) { setMsg('Could not load mesh: ' + err.message); }
  };
  const apply = () => onApply({ field: { w, h, dx: p.field.dx, dy: p.field.dy } });

  // ---- keyboard (capture phase, so the editor's own shortcuts never see these keys) ----
  useEffect(() => {
    const down = e => {
      const tag = e.target.tagName, mod = e.ctrlKey || e.metaKey;
      const typing = tag === 'TEXTAREA' || tag === 'SELECT' || (tag === 'INPUT' && ['text', 'number', 'search'].includes(e.target.type));
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel(); return; }
      if (e.key === 'Enter' && tag !== 'SELECT' && tag !== 'TEXTAREA') { e.preventDefault(); e.stopPropagation(); apply(); return; }
      if (mod && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); e.stopPropagation(); doUndo(); return; }
      if (typing || mod) return;
      if (e.key === ' ' && tag !== 'BUTTON') { e.preventDefault(); e.stopPropagation(); setSpaceHand(true); return; }
      if (e.key === '[' || e.key === ']') {
        e.preventDefault(); e.stopPropagation();
        setBrush(b => ({ ...b, size: Math.max(1, Math.min(maxSize, e.key === '[' ? Math.min(b.size - 1, Math.round(b.size * 0.9)) : Math.max(b.size + 1, Math.round(b.size * 1.1)))) }));
        return;
      }
      const hit = TOOLS.find(t => t[2] === e.key.toUpperCase());
      if (hit && !e.altKey) { e.preventDefault(); e.stopPropagation(); setTool(hit[0]); }
    };
    const up = e => { if (e.key === ' ') setSpaceHand(false); };
    window.addEventListener('keydown', down, true); window.addEventListener('keyup', up, true);
    return () => { window.removeEventListener('keydown', down, true); window.removeEventListener('keyup', up, true); };
  });

  const handMode = tool === 'hand' || spaceHand;
  const cursorClass = handMode ? ' hand' : tool === 'zoom' ? ' zoom' : '';
  const sb = (k, v) => setBrush(b => ({ ...b, [k]: v }));

  return <div className="cameraRaw liquify" role="dialog" aria-label="Liquify" aria-modal="true">
    <div className="crsTop"><strong>Liquify</strong>
      <span className="crsStatus" role="status">{msg || `Editing a ${w}×${h} preview of the ${p.W}×${p.H} layer; OK applies at full resolution.`}</span>
      <div className="crsTopRight lqZoom">
        <button className="optButton" aria-label="Zoom out" onClick={() => zoomAt(1 / 1.5)}>−</button>
        <span aria-label="Zoom level">{Math.round(view.z * p.scale * 100)}%</span>
        <button className="optButton" aria-label="Zoom in" onClick={() => zoomAt(1.5)}>+</button>
        <button className="optButton" aria-label="Fit on screen" onClick={fit}>Fit</button>
        <button className="optButton" aria-label="Undo" disabled={!undoDepth} title="Undo (Ctrl+Z)" onClick={doUndo}>Undo</button>
      </div>
    </div>
    <div className="crsMain">
      <nav className="lqTools" role="toolbar" aria-label="Liquify tools" aria-orientation="vertical">
        {TOOLS.map(([id, name, key, Icon]) => <button key={id} aria-label={name + ' Tool'} aria-pressed={tool === id} className={tool === id ? 'on' : ''} title={`${name} (${key})${id === 'twirlClockwise' ? ' — Alt: counter-clockwise' : id === 'pucker' || id === 'bloat' ? ' — Alt: reverse' : ''}`} onClick={() => setTool(id)}><Icon size={16} /></button>)}
      </nav>
      <div ref={viewport} className={'lqView' + cursorClass} aria-label="Liquify canvas" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endStroke} onPointerCancel={endStroke} onLostPointerCapture={endStroke} onWheel={onWheel}
        onPointerEnter={() => { if (cursor.current) cursor.current.style.display = ''; }} onPointerLeave={() => { if (cursor.current) cursor.current.style.display = 'none'; }}>
        <div className="lqStage" style={{ width: w, height: h, transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}>
          <canvas ref={imgCv} aria-label="Liquify preview" style={{ visibility: showImage ? 'visible' : 'hidden' }} />
          <canvas ref={maskCv} aria-hidden="true" style={{ visibility: showMask ? 'visible' : 'hidden' }} />
        </div>
        <canvas ref={meshCv} className="lqMesh" aria-hidden="true" />
        {!handMode && tool !== 'zoom' && <div ref={cursor} className="lqCursor" style={{ display: 'none' }} />}
      </div>
      <aside className="crsSide lqSide">
        <div className="crsScroll">
          <section className="crsPanel"><header><h4 className="lqHead">Brush Tool Options</h4></header><div className="crsBody">
            <Slider label="Brush size" value={brush.size} min={1} max={maxSize} onChange={v => sb('size', v)} />
            <Slider label="Brush density" value={brush.density} min={0} max={100} onChange={v => sb('density', v)} />
            <Slider label="Brush pressure" value={brush.pressure} min={1} max={100} onChange={v => sb('pressure', v)} />
            <Slider label="Brush rate" value={brush.rate} min={0} max={100} disabled={!stationary} onChange={v => sb('rate', v)} />
            <label className="optCheck"><input type="checkbox" aria-label="Stylus pressure" checked={stylus} onChange={e => setStylus(e.target.checked)} />Stylus pressure</label>
          </div></section>
          <section className="crsPanel"><header><h4 className="lqHead">Mask Options</h4></header><div className="crsBody">
            <div className="lqButtons">
              <button className="optButton" onClick={() => editMask(() => 255)}>Freeze All</button>
              <button className="optButton" onClick={() => editMask(() => 0)}>Thaw All</button>
              <button className="optButton" onClick={() => editMask(v => 255 - v)}>Invert Mask</button>
            </div>
          </div></section>
          <section className="crsPanel"><header><h4 className="lqHead">Reconstruct Options</h4></header><div className="crsBody">
            <Slider label="Reconstruct amount" value={reconAmount} min={0} max={100} onChange={setReconAmount} />
            <p className="hint">Removes this percentage of the distortion; frozen areas are protected.</p>
            <div className="lqButtons">
              <button className="optButton" onClick={() => replaceField(L.reconstructAll(p.field, reconAmount / 100, p.freeze))}>Reconstruct</button>
              <button className="optButton" onClick={() => replaceField(L.restoreAll(p.field))}>Restore All</button>
            </div>
          </div></section>
          <section className="crsPanel"><header><h4 className="lqHead">View Options</h4></header><div className="crsBody">
            <label className="optCheck"><input type="checkbox" aria-label="Show image" checked={showImage} onChange={e => setShowImage(e.target.checked)} />Show Image</label>
            <label className="optCheck"><input type="checkbox" aria-label="Show mesh" checked={showMesh} onChange={e => setShowMesh(e.target.checked)} />Show Mesh</label>
            <div className="crsRow"><span>Mesh size</span><select aria-label="Mesh size" value={meshSize} disabled={!showMesh} onChange={e => setMeshSize(e.target.value)}><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></div>
            <div className="crsRow"><span>Mesh colour</span><input type="color" aria-label="Mesh colour" value={meshColor} disabled={!showMesh} onChange={e => setMeshColor(e.target.value)} /></div>
            <label className="optCheck"><input type="checkbox" aria-label="Show mask" checked={showMask} onChange={e => setShowMask(e.target.checked)} />Show Mask</label>
            <div className="crsRow"><span>Mask colour</span><input type="color" aria-label="Mask colour" value={maskColor} disabled={!showMask} onChange={e => setMaskColor(e.target.value)} /></div>
          </div></section>
          <section className="crsPanel"><header><h4 className="lqHead">Mesh</h4></header><div className="crsBody">
            <div className="lqButtons">
              <button className="optButton" onClick={() => fileIn.current.click()}>Load Mesh…</button>
              <button className="optButton" onClick={saveMesh}>Save Mesh…</button>
              <input ref={fileIn} type="file" accept=".json,application/json" aria-label="Mesh file" hidden onChange={e => { const f = e.target.files[0]; e.target.value = ''; if (f) loadMesh(f); }} />
            </div>
          </div></section>
        </div>
        <footer className="crsFooter">
          <label className="optCheck lqPreview"><input type="checkbox" aria-label="Preview" checked={preview} onChange={e => setPreview(e.target.checked)} />Preview</label>
          <button onClick={onCancel}>Cancel</button><button className="primary" onClick={apply}>OK</button>
        </footer>
      </aside>
    </div>
  </div>;
}
