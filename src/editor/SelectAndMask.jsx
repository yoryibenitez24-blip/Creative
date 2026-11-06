import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Brush, Hand, Lasso, Paintbrush, Wand2, ZoomIn } from 'lucide-react';
import { REFINE_DEFAULTS, OUTPUTS, applyEdits, edgeBand, makeProxy, refineMask, decontaminateColors, paintStroke } from '../engine/refine.js';
import { maskOutline } from '../engine/selection.js';

// Select › Select and Mask… workspace (full screen, like Camera Raw).
//
// Props
//   image    ImageData at document size (composite, or the active layer placed at doc coords)
//   mask     Uint8Array(docW*docH) initial selection (may be all 0)
//   onCancel ()
//   onApply  ({ mask: Uint8Array(docW*docH), output, decontaminated?: {w,h,data}, settings })
//   run?     optional worker runner (op, buf, params, ctx) → Promise<buf> (opsClient.runInWorker);
//            used when the op 'refineEdge' (engine/refine.js refineAlphaOp) is registered.
//            Without it everything is computed on the main thread.
//   backdrop? optional ImageData at doc size of the layers below, for the "On Layers" view.
//
// Editing tools record edits in document coordinates; the preview replays them on a down-scaled
// proxy (≤ 1000 px long side with High Quality Preview, ≤ 500 px without) and OK replays them and
// refines at full resolution.

const STORE = 'zertake.selectAndMask.v1';
const VIEWS = [['onion', 'Onion Skin'], ['ants', 'Marching Ants'], ['overlay', 'Overlay'], ['black', 'On Black'], ['white', 'On White'], ['bw', 'Black & White'], ['layers', 'On Layers']];
const VIEW_KEYS = { onion: 'O', ants: 'M', overlay: 'V', black: 'A', white: 'T', bw: 'K', layers: 'Y' };
const TOOLS = [
  ['quick', 'Quick Selection Tool', Wand2, 'W'], ['refine', 'Refine Edge Brush Tool', Paintbrush, 'R'], ['brush', 'Brush Tool', Brush, 'B'],
  ['lasso', 'Object-free Lasso Tool', Lasso, 'L'], ['hand', 'Hand Tool', Hand, 'H'], ['zoom', 'Zoom Tool', ZoomIn, 'Z'],
];
const PIXEL_OUTPUTS = ['newLayer', 'newLayerMask', 'newDocument'];
const DEFAULT_VIEW = { mode: 'onion', opacity: { onion: 50, overlay: 50, black: 50, white: 50 }, overlayColor: '#ff0000', showEdge: false, showOriginal: false, hq: true };
const DEFAULT_SETTINGS = { ...REFINE_DEFAULTS, output: 'selection' };

function loadStored() { try { const s = JSON.parse(localStorage.getItem(STORE) || 'null'); return s && s.remember ? s : null; } catch { return null; } }
function saveStored(v) { try { if (v) localStorage.setItem(STORE, JSON.stringify(v)); else localStorage.removeItem(STORE); } catch { /* storage unavailable */ } }
const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) || 0);

function Slider({ label, value, min, max, step = 1, onChange, def = 0, unit }) {
  const fmt = v => step < 1 ? (+v).toFixed(1) : Math.round(v);
  return <div className="crsSlider" onDoubleClick={() => onChange(def)} title="Double-click to reset">
    <div className="crsRow"><span>{label}{unit && <small className="smUnit"> {unit}</small>}</span><input type="number" aria-label={label + ' value'} min={min} max={max} step={step} value={fmt(value)} onChange={e => { const v = +e.target.value; if (Number.isFinite(v)) onChange(Math.max(min, Math.min(max, v))); }} /></div>
    <input type="range" aria-label={label} min={min} max={max} step={step} value={value} onChange={e => onChange(+e.target.value)} />
  </div>;
}
function Section({ title, open, toggle, children }) {
  return <section className="crsPanel"><header><button className="crsTitle" aria-expanded={open} onClick={toggle}>{open ? '▾' : '▸'} {title}</button></header>{open && <div className="crsBody">{children}</div>}</section>;
}

export default function SelectAndMask({ image, mask: maskProp, onCancel, onApply, run, backdrop }) {
  const W = image.width, H = image.height;
  const mask = useMemo(() => maskProp && maskProp.length === W * H ? maskProp : new Uint8Array(W * H), [maskProp, W, H]);
  const full = useMemo(() => ({ w: W, h: H, data: image.data }), [image]);
  const stored = useMemo(loadStored, []);
  const [s, setS] = useState(() => ({ ...DEFAULT_SETTINGS, ...(stored?.settings || {}) }));
  const [view, setView] = useState(() => ({ ...DEFAULT_VIEW, ...(stored?.view || {}), opacity: { ...DEFAULT_VIEW.opacity, ...(stored?.view?.opacity || {}) } }));
  const [remember, setRemember] = useState(!!stored);
  const [tool, setTool] = useState('quick'), [mode, setMode] = useState('add'), [size, setSize] = useState(() => Math.max(10, Math.round(Math.max(W, H) / 40)));
  const [open, setOpen] = useState({ view: true, edge: true, global: true, output: true });
  const [zoom, setZoom] = useState(1), [pan, setPan] = useState({ x: 0, y: 0 }), [box, setBox] = useState({ w: 800, h: 600 });
  const [busy, setBusy] = useState(false), [applying, setApplying] = useState(false), [err, setErr] = useState(null);
  const [tick, setTick] = useState(0); // bumps when the proxy mask / refined result change
  const [cursor, setCursor] = useState(null), [lassoPts, setLassoPts] = useState(null), [space, setSpace] = useState(false);
  const proxy = useRef(null), cur = useRef(null), refined = useRef(null), edits = useRef([]), stroke = useRef(null), job = useRef(0), timer = useRef(0);
  const canvas = useRef(), viewEl = useRef(), root = useRef(), backProxy = useRef(null);
  const set = patch => setS(v => ({ ...v, ...patch }));
  const setV = patch => setView(v => ({ ...v, ...patch }));
  const opts = { radius: s.radius, smartRadius: s.smartRadius, smooth: s.smooth, feather: s.feather, contrast: s.contrast, shiftEdge: s.shiftEdge };
  const effTool = space ? 'hand' : tool;

  // ---------- proxy (re)build ----------
  useEffect(() => {
    const p = makeProxy(full, mask, view.hq ? 1000 : 500);
    proxy.current = p; backProxy.current = backdrop ? makeProxy({ w: W, h: H, data: backdrop.data }, null, view.hq ? 1000 : 500).buf : null;
    cur.current = applyEdits(p.buf, p.mask, edits.current, p.scale); refined.current = null;
    setTick(t => t + 1); schedule();
  }, [view.hq]);
  useLayoutEffect(() => { // fit to the view area
    const el = viewEl.current; if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight })); ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight }); return () => ro.disconnect();
  }, []);
  useEffect(() => { root.current?.focus(); }, []);

  // ---------- refinement (debounced; worker when available) ----------
  const schedule = () => { clearTimeout(timer.current); timer.current = setTimeout(recompute, 140); };
  const recompute = async () => {
    const p = proxy.current, c = cur.current; if (!p || !c) return;
    const id = ++job.current; setBusy(true); setErr(null);
    try {
      let a;
      if (run) {
        const buf = { w: p.buf.w, h: p.buf.h, data: new Uint8ClampedArray(p.buf.data) };
        for (let i = 0; i < c.mask.length; i++) buf.data[i * 4 + 3] = c.mask[i];
        const r = await run('refineEdge', buf, { ...optsRef.current, refineBrush: c.refineBrush }, { scale: p.scale });
        a = new Uint8Array(c.mask.length); for (let i = 0; i < a.length; i++) a[i] = r.data[i * 4 + 3];
      } else {
        await new Promise(r => setTimeout(r, 0));
        if (id !== job.current) return;
        a = refineMask(p.buf, c.mask, { ...optsRef.current, scale: p.scale }, { refineBrush: c.refineBrush });
      }
      if (id !== job.current) return;
      refined.current = a; setBusy(false); setTick(t => t + 1);
    } catch (e) { if (!e.cancelled && id === job.current) { setErr(e.message); setBusy(false); } }
  };
  const optsRef = useRef(opts); optsRef.current = opts;
  useEffect(schedule, [s.radius, s.smartRadius, s.smooth, s.feather, s.contrast, s.shiftEdge]);
  useEffect(() => () => clearTimeout(timer.current), []);

  // ---------- edits ----------
  const pushEdit = e => {
    const p = proxy.current; edits.current = [...edits.current, e];
    cur.current = applyEdits(p.buf, null, [e], p.scale, cur.current); refined.current = null; setTick(t => t + 1); schedule();
  };
  const undo = () => {
    if (!edits.current.length) return; const p = proxy.current;
    edits.current = edits.current.slice(0, -1); cur.current = applyEdits(p.buf, p.mask, edits.current, p.scale); refined.current = null; setTick(t => t + 1); schedule();
  };

  // ---------- display ----------
  const shown = () => { const c = cur.current; if (!c) return null; return view.showOriginal ? proxy.current.mask : refined.current || c.mask; };
  const band = useMemo(() => {
    if (!view.showEdge || !proxy.current || !cur.current) return null;
    return edgeBand(proxy.current.buf, cur.current.mask, { ...opts, scale: proxy.current.scale }, { refineBrush: cur.current.refineBrush }).unknown;
  }, [view.showEdge, tick, s.radius, s.smartRadius]);
  useEffect(() => {
    const p = proxy.current, A = shown(), cv = canvas.current; if (!p || !A || !cv) return;
    const { w, h, data: I } = p.buf; cv.width = w; cv.height = h;
    const out = new ImageData(w, h), o = out.data, m = view.mode, op = (view.opacity[m] ?? 50) / 100, col = m === 'overlay' ? hexRgb(view.overlayColor) : m === 'white' ? [255, 255, 255] : [0, 0, 0];
    const bk = backProxy.current?.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, q = i * 4, chk = ((x >> 3) + (y >> 3)) & 1 ? 204 : 255, ia = I[q + 3] / 255;
      let a = A[i] / 255; if (band && !band[i]) a = m === 'bw' ? a : 0;
      for (let c = 0; c < 3; c++) {
        const v = I[q + c] * ia + chk * (1 - ia); let r;
        if (m === 'bw') r = (band && !band[i] ? 0 : a * 255);
        else if (m === 'ants') r = v;
        else if (m === 'onion') r = v * a + (v * (1 - op) + chk * op) * (1 - a);
        else if (m === 'layers') { const b = bk ? bk[q + c] * bk[q + 3] / 255 + chk * (1 - bk[q + 3] / 255) : chk; const fa = a * ia; r = I[q + c] * fa + b * (1 - fa); }
        else r = v * a + (v * (1 - op) + col[c] * op) * (1 - a);
        o[q + c] = r;
      }
      o[q + 3] = 255;
    }
    cv.getContext('2d').putImageData(out, 0, 0);
  }, [tick, view, band]);
  const ants = useMemo(() => {
    if (view.mode !== 'ants' || !proxy.current) return '';
    const A = shown(); return A ? maskOutline(A, proxy.current.buf.w, proxy.current.buf.h) : '';
  }, [tick, view.mode, view.showOriginal]);

  // ---------- view transform ----------
  const pw = proxy.current?.buf.w || W, ph = proxy.current?.buf.h || H, scale = proxy.current?.scale || 1;
  const fit = Math.min((box.w - 40) / pw, (box.h - 40) / ph) || 1;
  const z = fit * zoom, dispW = pw * z, dispH = ph * z;
  const left = (box.w - dispW) / 2 + pan.x, top = (box.h - dispH) / 2 + pan.y;
  const docPerScreen = 1 / (z * scale);
  const toDoc = e => { const r = canvas.current.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * pw / scale, (e.clientY - r.top) / r.height * ph / scale]; };
  const zoomAt = (factor, e) => {
    const nz = Math.min(32, Math.max(0.1, zoom * factor)), r = viewEl.current.getBoundingClientRect();
    const mx = e ? e.clientX - r.left : box.w / 2, my = e ? e.clientY - r.top : box.h / 2, k = nz / zoom;
    // keep the point under the cursor fixed
    setPan({ x: mx - box.w / 2 - (mx - left - dispW / 2) * k, y: my - box.h / 2 - (my - top - dispH / 2) * k }); setZoom(nz);
  };

  const wheelRef = useRef(); wheelRef.current = e => { e.preventDefault(); if (e.ctrlKey || e.metaKey) zoomAt(e.deltaY < 0 ? 1.25 : 0.8, e); else setPan(p => ({ x: p.x - e.deltaX, y: p.y - e.deltaY })); };
  useEffect(() => { // native listener: React's wheel handler is passive and cannot stop page zoom
    const el = viewEl.current, f = e => wheelRef.current(e); el.addEventListener('wheel', f, { passive: false }); return () => el.removeEventListener('wheel', f);
  }, []);

  // ---------- pointer ----------
  const down = e => {
    if (applying || e.button !== 0 || !proxy.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const [x, y] = toDoc(e), sub = e.altKey ? mode !== 'subtract' : mode === 'subtract';
    if (effTool === 'hand') { stroke.current = { tool: 'hand', sx: e.clientX, sy: e.clientY, pan }; return; }
    if (effTool === 'zoom') { zoomAt(e.altKey ? 0.5 : 2, e); return; }
    const st = { tool: effTool, mode: sub ? 'subtract' : 'add', pts: [x, y], r: size / 2 };
    stroke.current = st;
    if (effTool === 'lasso') { setLassoPts([x, y]); return; }
    applySegment(st, 0);
  };
  // live feedback: apply the newest part of the stroke to the proxy; the whole stroke is recorded once
  const applySegment = (st, from) => {
    const p = proxy.current, seg = { ...st, pts: st.pts.slice(Math.max(0, from - 2)) };
    if (st.tool === 'brush' || st.tool === 'refine') { const sp = seg.pts.map(v => v * p.scale); paintStroke(st.tool === 'brush' ? cur.current.mask : cur.current.refineBrush, p.buf.w, p.buf.h, sp, st.r * p.scale, st.mode !== 'subtract'); }
    else cur.current = applyEdits(p.buf, null, [seg], p.scale, cur.current);
    refined.current = null; setTick(t => t + 1);
  };
  const move = e => {
    if (proxy.current && canvas.current) { const [x, y] = toDoc(e); setCursor({ x, y }); }
    const st = stroke.current; if (!st) return;
    if (st.tool === 'hand') { setPan({ x: st.pan.x + e.clientX - st.sx, y: st.pan.y + e.clientY - st.sy }); return; }
    const [x, y] = toDoc(e), lx = st.pts[st.pts.length - 2], ly = st.pts[st.pts.length - 1];
    const minStep = st.tool === 'lasso' ? docPerScreen * 2 : Math.max(docPerScreen, st.r / 3);
    if (Math.hypot(x - lx, y - ly) < minStep) return;
    const from = st.pts.length; st.pts.push(x, y);
    if (st.tool === 'lasso') setLassoPts([...st.pts]); else applySegment(st, from);
  };
  const up = () => {
    const st = stroke.current; stroke.current = null; if (!st || st.tool === 'hand') return;
    const e = { tool: st.tool, mode: st.mode, pts: st.pts.map(v => Math.round(v * 100) / 100), r: st.r };
    if (st.tool === 'lasso') { setLassoPts(null); if (st.pts.length >= 6) pushEdit(e); return; }
    edits.current = [...edits.current, e]; schedule(); // proxy already updated live
  };

  // ---------- apply ----------
  const apply = () => {
    if (applying) return;
    setApplying(true); setErr(null);
    setTimeout(async () => {
      try {
        const base = applyEdits(full, mask, edits.current, 1);
        const pixelOut = PIXEL_OUTPUTS.includes(s.output), decon = s.decontaminate && pixelOut;
        let a, decontaminated;
        if (run) {
          const buf = { w: W, h: H, data: new Uint8ClampedArray(full.data) };
          for (let i = 0; i < base.mask.length; i++) buf.data[i * 4 + 3] = base.mask[i];
          const r = await run('refineEdge', buf, { ...opts, decontaminate: decon, decontaminateAmount: s.decontaminateAmount, refineBrush: base.refineBrush }, { scale: 1 });
          a = new Uint8Array(W * H); for (let i = 0; i < a.length; i++) { a[i] = r.data[i * 4 + 3]; r.data[i * 4 + 3] = full.data[i * 4 + 3]; }
          if (decon) decontaminated = { w: W, h: H, data: r.data };
        } else {
          a = refineMask(full, base.mask, opts, { refineBrush: base.refineBrush });
          if (decon) decontaminated = decontaminateColors(full, a, s.decontaminateAmount);
        }
        saveStored(remember ? { remember: true, settings: s, view } : null);
        onApply({ mask: a, output: s.output, ...(decontaminated ? { decontaminated } : {}), settings: { ...s } });
      } catch (e) { setErr(e.message || 'Refinement failed'); setApplying(false); }
    }, 30);
  };

  // ---------- keyboard ----------
  const keyState = useRef(); keyState.current = { apply, onCancel, applying, undo };
  useEffect(() => {
    const kd = e => {
      const k = keyState.current, t = e.target, typing = t && (t.tagName === 'SELECT' || (t.tagName === 'INPUT' && !['checkbox', 'range', 'radio'].includes(t.type)));
      if (e.key === 'Escape') { e.preventDefault(); if (!k.applying) k.onCancel(); return; }
      if (e.key === 'Enter' && t?.tagName !== 'BUTTON') { e.preventDefault(); k.apply(); return; }
      if (typing || k.applying) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); k.undo(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === ' ') { e.preventDefault(); setSpace(true); return; }
      const key = e.key.toUpperCase();
      if (key === 'F') { e.preventDefault(); setView(v => ({ ...v, mode: VIEWS[(VIEWS.findIndex(x => x[0] === v.mode) + 1) % VIEWS.length][0] })); }
      else if (key === 'X') setView(v => ({ ...v, showOriginal: !v.showOriginal }));
      else if (key === 'J') setView(v => ({ ...v, showEdge: !v.showEdge }));
      else if (key === 'P') setView(v => ({ ...v, hq: !v.hq }));
      else if (e.key === '[') setSize(v => Math.max(1, Math.round(v / 1.2)));
      else if (e.key === ']') setSize(v => Math.min(1000, Math.round(v * 1.2) + 1));
      else { const tl = TOOLS.find(x => x[3] === key); if (tl) setTool(tl[0]); else { const vm = Object.entries(VIEW_KEYS).find(x => x[1] === key); if (vm) setView(v => ({ ...v, mode: vm[0] })); } }
    };
    const ku = e => { if (e.key === ' ') setSpace(false); };
    window.addEventListener('keydown', kd, true); window.addEventListener('keyup', ku, true);
    return () => { window.removeEventListener('keydown', kd, true); window.removeEventListener('keyup', ku, true); };
  }, []);

  const brushTool = ['quick', 'refine', 'brush'].includes(tool), modeTool = brushTool || tool === 'lasso';
  const modeLabels = tool === 'refine' ? ['Expand detection area', 'Restore original edge'] : ['Add to selection', 'Subtract from selection'];
  const opacityMode = ['onion', 'overlay', 'black', 'white'].includes(view.mode);
  const pctDoc = Math.round(z * scale * 100);
  const cursorR = size / 2 * scale; // in proxy px (svg units)
  const decontOn = s.decontaminate;

  return <div className="cameraRaw selectMask" role="dialog" aria-label="Select and Mask" ref={root} tabIndex={-1}>
    <div className="crsTop"><strong>Select and Mask</strong>
      <span className="crsStatus" role="status">{err || (applying ? 'Refining at full resolution…' : busy ? 'Updating preview…' : 'Preview ready')}</span>
      <span className="smZoomPct" aria-label="Zoom level">{pctDoc}%</span>
      <div className="crsTopRight"><button className="smUndo" disabled={applying} onClick={undo} title="Undo the last stroke (Ctrl+Z)">Undo stroke</button></div>
    </div>
    <div className="smOptions" role="toolbar" aria-label="Tool options">
      {brushTool && <label className="smSize"><span>Size</span><input type="range" aria-label="Brush size" min={1} max={1000} value={size} onChange={e => setSize(+e.target.value)} /><input type="number" aria-label="Brush size value" min={1} max={1000} value={size} onChange={e => { const v = +e.target.value; if (v >= 1) setSize(Math.min(1000, v)); }} /><small>px</small></label>}
      {modeTool && <div className="segmented smMode" role="group" aria-label="Tool mode">{['add', 'subtract'].map((m, i) => <button key={m} aria-pressed={mode === m} className={mode === m ? 'on' : ''} aria-label={modeLabels[i]} title={modeLabels[i] + (i ? ' (or hold Alt)' : '')} onClick={() => setMode(m)}>{i ? '−' : '+'} {modeLabels[i]}</button>)}</div>}
      {tool === 'zoom' && <><button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>Fit Screen</button><button onClick={() => { setZoom(1 / (fit * scale)); setPan({ x: 0, y: 0 }); }}>100%</button><span className="hint">Click to zoom in, Alt-click to zoom out</span></>}
      {tool === 'hand' && <span className="hint">Drag to pan (hold Space with any tool)</span>}
      {tool === 'quick' && <span className="hint">Paint over the object; hold Alt to subtract</span>}
      {tool === 'refine' && <span className="hint">Paint over hair or fur to recompute the edge there</span>}
    </div>
    <div className="crsMain">
      <nav className="smTools" role="toolbar" aria-label="Tools" aria-orientation="vertical">
        {TOOLS.map(([id, label, Icon, key]) => <button key={id} aria-label={label} aria-pressed={tool === id} className={tool === id ? 'on' : ''} title={`${label} (${key})`} onClick={() => setTool(id)}><Icon size={17} strokeWidth={1.6} /></button>)}
      </nav>
      <div className={'smView tool-' + effTool} ref={viewEl} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={() => setCursor(null)}
>
        <canvas ref={canvas} aria-label="Select and Mask preview" style={{ left, top, width: dispW, height: dispH }} />
        <svg className="smOverlay" style={{ left, top, width: dispW, height: dispH }} viewBox={`0 0 ${pw} ${ph}`} aria-hidden="true">
          {ants && <><path d={ants} className="smAntsA" strokeWidth={1 / z} /><path d={ants} className="smAntsB" strokeWidth={1 / z} strokeDasharray={`${4 / z} ${4 / z}`} /></>}
          {lassoPts && <polyline points={lassoPts.map(v => v * scale).join(' ')} className="smLasso" strokeWidth={1.5 / z} />}
          {cursor && brushTool && !space && <circle cx={cursor.x * scale} cy={cursor.y * scale} r={cursorR} className="smCursor" strokeWidth={1.2 / z} />}
        </svg>
        {applying && <div className="smBusy" role="alert" aria-busy="true">Refining at full resolution…</div>}
      </div>
      <aside className="crsSide">
        <div className="crsScroll">
          <Section title="View Mode" open={open.view} toggle={() => setOpen(o => ({ ...o, view: !o.view }))}>
            <div className="crsRow"><span>View</span><select aria-label="View mode" value={view.mode} onChange={e => setV({ mode: e.target.value })}>{VIEWS.map(([v, l]) => <option key={v} value={v}>{l} ({VIEW_KEYS[v]})</option>)}</select></div>
            {opacityMode && <Slider label={view.mode === 'onion' ? 'Transparency' : 'Opacity'} unit="%" value={view.opacity[view.mode]} min={0} max={100} def={50} onChange={v => setV({ opacity: { ...view.opacity, [view.mode]: v } })} />}
            {view.mode === 'overlay' && <div className="crsRow"><span>Overlay color</span><input type="color" aria-label="Overlay color" value={view.overlayColor} onChange={e => setV({ overlayColor: e.target.value })} /></div>}
            {view.mode === 'layers' && !backdrop && <p className="hint">No layers below: shown over transparency.</p>}
            <label className="optCheck"><input type="checkbox" aria-label="Show Edge" checked={view.showEdge} onChange={e => setV({ showEdge: e.target.checked })} />Show Edge (J)</label>
            <label className="optCheck"><input type="checkbox" aria-label="Show Original" checked={view.showOriginal} onChange={e => setV({ showOriginal: e.target.checked })} />Show Original (X)</label>
            <label className="optCheck"><input type="checkbox" aria-label="High Quality Preview" checked={view.hq} onChange={e => setV({ hq: e.target.checked })} />High Quality Preview</label>
          </Section>
          <Section title="Edge Detection" open={open.edge} toggle={() => setOpen(o => ({ ...o, edge: !o.edge }))}>
            <Slider label="Radius" unit="px" value={s.radius} min={0} max={250} onChange={v => set({ radius: v })} />
            <label className="optCheck"><input type="checkbox" aria-label="Smart Radius" checked={s.smartRadius} onChange={e => set({ smartRadius: e.target.checked })} />Smart Radius</label>
          </Section>
          <Section title="Global Refinements" open={open.global} toggle={() => setOpen(o => ({ ...o, global: !o.global }))}>
            <Slider label="Smooth" value={s.smooth} min={0} max={100} onChange={v => set({ smooth: v })} />
            <Slider label="Feather" unit="px" value={s.feather} min={0} max={250} step={0.1} onChange={v => set({ feather: v })} />
            <Slider label="Contrast" unit="%" value={s.contrast} min={0} max={100} onChange={v => set({ contrast: v })} />
            <Slider label="Shift Edge" unit="%" value={s.shiftEdge} min={-100} max={100} onChange={v => set({ shiftEdge: v })} />
            <div className="smButtons"><button disabled={applying} onClick={() => pushEdit({ tool: 'clear' })}>Clear Selection</button><button disabled={applying} onClick={() => pushEdit({ tool: 'invert' })}>Invert</button></div>
          </Section>
          <Section title="Output Settings" open={open.output} toggle={() => setOpen(o => ({ ...o, output: !o.output }))}>
            <label className="optCheck"><input type="checkbox" aria-label="Decontaminate Colors" checked={decontOn} onChange={e => { const on = e.target.checked; set({ decontaminate: on, ...(on && !PIXEL_OUTPUTS.includes(s.output) ? { output: 'newLayerMask' } : {}) }); }} />Decontaminate Colors</label>
            {decontOn && <Slider label="Amount" unit="%" value={s.decontaminateAmount} min={0} max={100} def={100} onChange={v => set({ decontaminateAmount: v })} />}
            <div className="crsRow"><span>Output To</span><select aria-label="Output To" value={s.output} onChange={e => set({ output: e.target.value })}>{OUTPUTS.map(([v, l]) => <option key={v} value={v} disabled={decontOn && !PIXEL_OUTPUTS.includes(v)}>{l}</option>)}</select></div>
            <label className="optCheck"><input type="checkbox" aria-label="Remember Settings" checked={remember} onChange={e => { setRemember(e.target.checked); if (!e.target.checked) saveStored(null); }} />Remember Settings</label>
          </Section>
        </div>
        <footer className="crsFooter"><button onClick={onCancel} disabled={applying}>Cancel</button><button className="primary" onClick={apply} disabled={applying}>{applying ? 'Working…' : 'OK'}</button></footer>
      </aside>
    </div>
  </div>;
}
