import { aiSegment } from './aiClient.js';
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  MASK_TYPES, typeLabel, LOCAL_DEFAULTS, BRUSH_DEFAULTS, createMask, createComponent, evaluateMask, normAdjust, lstar,
} from '../engine/masks.js';
import { resample } from '../engine/geometry.js';
import { hslToRgb } from '../engine/color.js';
import { Slider, Panel } from './DevelopPanels.jsx';

// Lightroom-style Masking for the Camera Raw Filter (CameraRaw.jsx) and Library · Develop
// (DevelopWorkspace.jsx). The masks live in the develop settings (`settings.masks`, see
// src/engine/masks.js), so they go through the host's normal settings state: OK in Camera Raw and
// history / undo in Develop include them. Rendering happens in the worker inside develop().
//
//   const mk = useMasking({ masks, setMasks, getSource, resetKey })
//     masks                 settings.masks (array, may be undefined)
//     setMasks(next, label) store a new masks array; label names the change for history
//     getSource()           the UNDEVELOPED preview buffer {w,h,data} or null (overlay, colour picking)
//     resetKey              selection / tool state resets when this changes (e.g. the photo id)
//     windowKeys            true: handle the keys itself with a capture listener on window while
//                           Masking is on (Camera Raw); false: the host calls mk.onKey(e) (Develop)
//   <MaskingPanel mk={mk} />                         right-hand panel (mask list, components, sliders)
//   <MaskCanvasLayer mk={mk} canvasRef={canvas} />   on-canvas overlay + tools; render it as a child of
//                                                    the positioned element that contains the canvas
//   mk.on / mk.setOn(bool)                           Masking mode (the host swaps its panels)
//   mk.onKey(e) → true when handled                  O overlay, Esc leave tool, Delete component, [ ] brush size
//
// Subject / Sky / Background use automatic, deterministic, non-AI detection (decision D-001).

const AUTO_TYPES = ['subject', 'people', 'sky', 'background', 'all'];
const AI_TYPES = ['subject', 'people', 'background'];
const DRAG_TYPES = ['linear', 'radial'];
const OP_SIGN = { add: '+', subtract: '−', intersect: '∩' };
const isTyping = t => t && (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable || (t.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button', 'color'].includes(t.type)));
const clone = v => structuredClone(v);

function proxyOf(buf, max) {
  if (!buf) return null;
  const k = Math.min(1, max / Math.max(buf.w, buf.h));
  return k >= 1 ? buf : resample(buf, Math.max(1, Math.round(buf.w * k)), Math.max(1, Math.round(buf.h * k)), 'bilinear');
}

export function useMasking({ masks, setMasks, getSource, resetKey, windowKeys = false }) {
  const list = Array.isArray(masks) ? masks : [];
  const [on, setOn] = useState(false);
  const [selId, setSelId] = useState(null), [compId, setCompId] = useState(null);
  const [tool, setTool] = useState(null); // { kind: 'brush'|'linear'|'radial'|'color'|'luminance', compId?, pending?: { op, type } }
  const [brush, setBrush] = useState({ ...BRUSH_DEFAULTS, erase: false });
  const [overlay, setOverlay] = useState({ show: true, color: '#ff3b30', opacity: 55 });
  const [busy, setBusy] = useState(null);
  const listRef = useRef(list); listRef.current = list;
  useEffect(() => { setSelId(null); setCompId(null); setTool(null); }, [resetKey]);

  const src = getSource?.() || null;
  const proxy = useMemo(() => proxyOf(src, 512), [src]);
  const thumbSrc = useMemo(() => proxyOf(proxy, 56), [proxy]);
  const sel = list.find(m => m.id === selId) || null;
  const comp = sel?.components.find(c => c.id === compId) || null;

  const commit = (next, label) => setMasks(next, label);
  const updateMask = (id, fn, label) => commit(listRef.current.map(m => m.id === id ? fn(clone(m)) : m), label);
  const updateComp = (mid, cid, fn, label) => updateMask(mid, m => ({ ...m, components: m.components.map(c => c.id === cid ? fn(c) : c) }), label);

  // On-device AI (aiseg.js via aiClient.js): runs once per component, the small alpha is stored in
  // params.ai so the proxy preview and the full-resolution render use the same result.
  const runAI = async (mid, cid, type) => {
    const src = getSource?.(); if (!src) return;
    setBusy('Detecting ' + (type === 'people' ? 'people' : type === 'background' ? 'the background' : 'the subject') + ' (on-device AI)…');
    try { const ai = await aiSegment(type === 'people' ? 'people' : 'subject', src); updateMask(mid, m => ({ ...m, components: m.components.map(x => x.id === cid ? { ...x, params: { ...x.params, ai } } : x) }), null); }
    catch (e) { setBusy('AI detection unavailable (' + e.message + '); using classical detection.'); setTimeout(() => setBusy(null), 4000); return; }
    setBusy(null);
  };
  const autoBusy = type => { if (AUTO_TYPES.includes(type) && type !== 'all') setBusy('Detecting ' + (type === 'background' ? 'background' : type) + '…'); };
  /** Create a component of `type`: op 'new' = new mask, otherwise added to the selected mask. Drag tools wait for a drag. */
  const start = (type, op = 'new') => {
    if (op !== 'new' && !sel) op = 'new';
    if (DRAG_TYPES.includes(type)) { setTool({ kind: type, pending: { op, type } }); return; }
    const c = createComponent(type, op === 'new' ? 'add' : op);
    const mid = place(c, op);
    if (AI_TYPES.includes(type) && getSource) runAI(mid, c.id, type);
    if (type === 'brush') setTool({ kind: 'brush', compId: c.id });
    else if (type === 'color' || type === 'luminance') setTool({ kind: type, compId: c.id });
    else setTool(null);
    autoBusy(type);
  };
  const place = (c, op) => {
    let mid = selId;
    if (op === 'new') { const m = createMask(c.type, null, listRef.current); m.components = [{ ...c, op: 'add' }]; commit([...listRef.current, m], 'New ' + typeLabel(c.type) + ' Mask'); setSelId(m.id); mid = m.id; }
    else updateMask(selId, m => ({ ...m, components: [...m.components, c] }), (op === 'subtract' ? 'Subtract ' : 'Add ') + typeLabel(c.type));
    setCompId(c.id); return mid;
  };
  const deleteComp = cid => {
    if (!sel) return; const left = sel.components.filter(c => c.id !== cid);
    if (!left.length) { commit(listRef.current.filter(m => m.id !== sel.id), 'Delete Mask'); setSelId(null); }
    else updateMask(sel.id, m => ({ ...m, components: left }), 'Delete Mask Component');
    setCompId(null); setTool(null);
  };
  const selectComp = c => { setCompId(c.id); if (c.type === 'brush') setTool({ kind: 'brush', compId: c.id }); else if (c.type === 'color' || c.type === 'luminance') setTool({ kind: c.type, compId: c.id }); else setTool(null); };

  // overlay of the selected mask on a ≤512 px proxy (main thread; detection results are cached)
  const [ovAlpha, setOvAlpha] = useState(null);
  const ovKey = sel && proxy ? JSON.stringify([sel.components, sel.invert]) : '';
  useEffect(() => {
    if (!ovKey || !on) { setOvAlpha(null); setBusy(null); return; }
    let live = true; const t = setTimeout(() => { if (!live) return; try { setOvAlpha({ a: evaluateMask({ ...sel, amount: 100 }, proxy), w: proxy.w, h: proxy.h }); } finally { setBusy(null); } }, busy ? 30 : 0);
    return () => { live = false; clearTimeout(t); };
  }, [ovKey, proxy, on]);

  // windowKeys: listen on window (capture) so the keys work wherever the focus is in the host
  const keyRef = useRef(); keyRef.current = e => onKey(e);
  useEffect(() => {
    if (!windowKeys || !on) return;
    const h = e => { if (keyRef.current(e)) { e.preventDefault(); e.stopPropagation(); } };
    window.addEventListener('keydown', h, true); return () => window.removeEventListener('keydown', h, true);
  }, [windowKeys, on]);
  const onKey = e => {
    if (!on || e.ctrlKey || e.metaKey) return false;
    const k = e.key;
    if (k === 'Escape' && tool) { setTool(null); if (isTyping(e.target)) e.target.blur?.(); return true; }
    if (isTyping(e.target)) return false;
    if ((k === 'o' || k === 'O') && !e.altKey) { setOverlay(o => ({ ...o, show: !o.show })); return true; }
    if (k === 'Delete' || k === 'Backspace') { if (comp) deleteComp(comp.id); return true; }
    if ((k === '[' || k === ']') && tool?.kind === 'brush') { setBrush(b => ({ ...b, size: Math.max(0.005, Math.min(0.5, b.size * (k === ']' ? 1.15 : 1 / 1.15))) })); return true; }
    return false;
  };

  return {
    on, setOn: v => { setOn(v); if (!v) setTool(null); }, list, sel, comp, selId, setSelId: id => { setSelId(id); setCompId(null); setTool(null); }, compId, selectComp,
    tool, setTool, brush, setBrush, overlay, setOverlay, busy, proxy, thumbSrc, ovAlpha, src,
    commit, updateMask, updateComp, start, place, deleteComp, onKey,
  };
}

// ---------------------------------------------------------------- small UI pieces
function Menu({ label, text, items, className = '' }) {
  const [open, setOpen] = useState(false), ref = useRef();
  useEffect(() => {
    if (!open) return;
    const close = e => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = e => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    window.addEventListener('pointerdown', close, true); window.addEventListener('keydown', esc, true);
    return () => { window.removeEventListener('pointerdown', close, true); window.removeEventListener('keydown', esc, true); };
  }, [open]);
  return <span className={'mkMenuWrap ' + className} ref={ref}>
    <button className="mkMenuBtn" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}>{text}</button>
    {open && <div className="mkMenu" role="menu" aria-label={label}>{items.map(([l, fn, disabled]) => <button key={l} role="menuitem" disabled={disabled} onClick={() => { setOpen(false); fn(); }}>{l}</button>)}</div>}
  </span>;
}
const typeItems = (fn, exclude = []) => MASK_TYPES.filter(([t]) => !exclude.includes(t)).map(([t, l]) => [l, () => fn(t)]);

function Thumb({ mask, src }) {
  const ref = useRef();
  const key = src ? JSON.stringify([mask.components, mask.invert]) : '';
  useEffect(() => {
    const c = ref.current; if (!c || !src) return;
    const a = evaluateMask({ ...mask, amount: 100 }, src); c.width = src.w; c.height = src.h;
    const im = new ImageData(src.w, src.h); for (let i = 0; i < a.length; i++) { const v = Math.round(30 + a[i] * 225); im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = v; im.data[i * 4 + 3] = 255; }
    c.getContext('2d').putImageData(im, 0, 0);
  }, [key, src]);
  return <canvas ref={ref} className="mkThumb" aria-hidden="true" />;
}

function ColorTint({ value, onChange }) {
  const [r, g, b] = hslToRgb(value.hue, 1, 0.5), field = useRef();
  const pick = e => { const rc = field.current.getBoundingClientRect(); onChange({ hue: Math.round(Math.max(0, Math.min(1, (e.clientX - rc.left) / rc.width)) * 359), saturation: Math.round((1 - Math.max(0, Math.min(1, (e.clientY - rc.top) / rc.height))) * 100) }); };
  return <div className="mkTint">
    <div className="crsRow"><span>Color</span><span className="mkSwatch" style={{ background: value.saturation ? `rgba(${r | 0},${g | 0},${b | 0},${0.25 + value.saturation / 133})` : 'transparent' }} aria-label={'Tint color: ' + (value.saturation ? 'hue ' + value.hue + ', saturation ' + value.saturation : 'none')} role="img" />
      {value.saturation > 0 && <button className="mkLink" onClick={() => onChange({ hue: value.hue, saturation: 0 })}>Clear tint</button>}</div>
    <div ref={field} className="mkTintField" role="group" aria-label="Mask color picker" onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); pick(e); }} onPointerMove={e => { if (e.buttons) pick(e); }}>
      <i style={{ left: value.hue / 359 * 100 + '%', top: (100 - value.saturation) + '%' }} /></div>
    <Slider label="Tint hue" aria="Mask color hue" value={value.hue} min={0} max={359} onChange={v => onChange({ ...value, hue: v })} gradient="linear-gradient(90deg,red,yellow,lime,cyan,blue,magenta,red)" />
    <Slider label="Tint saturation" aria="Mask color saturation" value={value.saturation} min={0} max={100} onChange={v => onChange({ ...value, saturation: v })} />
  </div>;
}

function LumStrip({ p }) {
  const pct = v => Math.max(0, Math.min(100, v)) + '%';
  return <div className="mkLumStrip" aria-hidden="true">
    <div className="mkLumSel" style={{ left: pct(p.lo - p.loFeather), width: `calc(${pct(p.hi + p.hiFeather)} - ${pct(p.lo - p.loFeather)})` }}>
      <div className="mkLumCore" style={{ left: ((p.loFeather) / Math.max(1e-6, p.hi + p.hiFeather - p.lo + p.loFeather) * 100) + '%', right: ((p.hiFeather) / Math.max(1e-6, p.hi + p.hiFeather - p.lo + p.loFeather) * 100) + '%' }} /></div>
  </div>;
}

function ComponentEditor({ mk, m, c }) {
  const p = c.params, up = (patch, label) => mk.updateComp(m.id, c.id, x => ({ ...x, params: { ...x.params, ...patch } }), label);
  const toolOn = mk.tool?.compId === c.id;
  switch (c.type) {
    case 'subject': case 'sky': case 'background': case 'people':
      return <div className="mkEditor"><p className="mkNote">{c.type === 'sky' ? 'Automatic sky detection (classical) — refine with Add / Subtract.' : c.params?.ai ? 'Detected on your device with AI (' + (c.type === 'people' ? 'MODNet' : 'U²-Net') + ') — nothing is uploaded. Refine with Add / Subtract.' : 'Detecting on your device…'}</p>
        <Slider label="Sensitivity" aria="Detection sensitivity" value={p.sensitivity ?? 50} min={0} max={100} def={50} onChange={v => up({ sensitivity: v }, typeLabel(c.type) + ' Sensitivity')} /></div>;
    case 'brush': {
      const b = mk.brush, sb = patch => mk.setBrush(x => ({ ...x, ...patch }));
      return <div className="mkEditor">
        <div className="mkRowBtns"><button aria-pressed={toolOn} className={toolOn ? 'on' : ''} onClick={() => mk.setTool(toolOn ? null : { kind: 'brush', compId: c.id })}>Brush tool</button>
          <div className="segmented" role="group" aria-label="Brush mode"><button aria-pressed={!b.erase} className={!b.erase ? 'on' : ''} onClick={() => sb({ erase: false })}>Add</button><button aria-pressed={b.erase} className={b.erase ? 'on' : ''} onClick={() => sb({ erase: true })}>Erase</button></div>
          <button disabled={!p.strokes?.length} onClick={() => up({ strokes: [] }, 'Clear Brush')}>Clear</button></div>
        <Slider label="Size" aria="Brush size" value={Math.round(b.size * 1000) / 10} min={0.5} max={50} step={0.5} def={BRUSH_DEFAULTS.size * 100} onChange={v => sb({ size: v / 100 })} />
        <Slider label="Feather" aria="Brush feather" value={b.feather} min={0} max={100} def={BRUSH_DEFAULTS.feather} onChange={v => sb({ feather: v })} />
        <Slider label="Flow" aria="Brush flow" value={b.flow} min={1} max={100} def={100} onChange={v => sb({ flow: v })} />
        <Slider label="Density" aria="Brush density" value={b.density} min={1} max={100} def={100} onChange={v => sb({ density: v })} />
        <p className="mkNote">Paint on the image. [ and ] change the size; hold Alt to erase. {p.strokes?.length || 0} stroke{p.strokes?.length === 1 ? '' : 's'}.</p></div>;
    }
    case 'linear': return <div className="mkEditor"><p className="mkNote">Drag the handles on the image: the outer lines set where the effect starts and ends, the middle one moves it, the round knob rotates it.</p></div>;
    case 'radial': return <div className="mkEditor">
      <Slider label="Feather" aria="Radial feather" value={p.feather ?? 50} min={0} max={100} def={50} onChange={v => up({ feather: v }, 'Radial Feather')} />
      <div className="segmented" role="group" aria-label="Radial effect side"><button aria-pressed={p.inside !== false} className={p.inside !== false ? 'on' : ''} onClick={() => up({ inside: true }, 'Radial Inside')}>Inside</button><button aria-pressed={p.inside === false} className={p.inside === false ? 'on' : ''} onClick={() => up({ inside: false }, 'Radial Outside')}>Outside</button></div>
      <p className="mkNote">Drag the centre to move, the edge handles to resize, the top knob to rotate, the inner knob for feather.</p></div>;
    case 'color': return <div className="mkEditor">
      <div className="mkRowBtns"><button aria-pressed={toolOn} className={toolOn ? 'on' : ''} onClick={() => mk.setTool(toolOn ? null : { kind: 'color', compId: c.id })}>Sample color</button></div>
      <div className="mkSamples">{(p.samples || []).map((s, i) => <button key={i} className="mkSample" style={{ background: `rgb(${s[0]},${s[1]},${s[2]})` }} aria-label={'Remove color sample ' + (i + 1)} title="Remove sample" onClick={() => up({ samples: p.samples.filter((_, j) => j !== i) }, 'Remove Color Sample')} />)}
        {!p.samples?.length && <span className="mkNote">Click the image to sample a colour; Shift-click adds up to 5.</span>}</div>
      <Slider label="Refine" aria="Color range refine" value={p.refine ?? 50} min={0} max={100} def={50} onChange={v => up({ refine: v }, 'Color Range Refine')} /></div>;
    case 'luminance': return <div className="mkEditor">
      <div className="mkRowBtns"><button aria-pressed={toolOn} className={toolOn ? 'on' : ''} onClick={() => mk.setTool(toolOn ? null : { kind: 'luminance', compId: c.id })}>Sample luminance</button></div>
      <LumStrip p={p} />
      <Slider label="Range low" aria="Luminance range low" value={p.lo} min={0} max={100} def={60} onChange={v => up({ lo: Math.min(v, p.hi) }, 'Luminance Range')} />
      <Slider label="Range high" aria="Luminance range high" value={p.hi} min={0} max={100} def={100} onChange={v => up({ hi: Math.max(v, p.lo) }, 'Luminance Range')} />
      <Slider label="Low feather" aria="Luminance low feather" value={p.loFeather} min={0} max={50} def={15} onChange={v => up({ loFeather: v }, 'Luminance Feather')} />
      <Slider label="High feather" aria="Luminance high feather" value={p.hiFeather} min={0} max={50} def={0} onChange={v => up({ hiFeather: v }, 'Luminance Feather')} /></div>;
    case 'all': return <div className="mkEditor"><p className="mkNote">Covers the whole image — subtract other components to build “everything except…”.</p></div>;
    default: return null;
  }
}

const GROUPS = [
  ['light', 'Light', [['exposure', 'Exposure', -4, 4, 0.05], ['contrast', 'Contrast'], ['highlights', 'Highlights'], ['shadows', 'Shadows'], ['whites', 'Whites'], ['blacks', 'Blacks']]],
  ['color', 'Color', [['temp', 'Temp', -100, 100, 1, 'linear-gradient(90deg,#3a6cff,#ddd,#ffb43a)'], ['tint', 'Tint', -100, 100, 1, 'linear-gradient(90deg,#3adf5a,#ddd,#e04adf)'], ['hue', 'Hue', -180, 180], ['saturation', 'Saturation']]],
  ['effects', 'Effects', [['texture', 'Texture'], ['clarity', 'Clarity'], ['dehaze', 'Dehaze'], ['defringe', 'Defringe', 0, 100]]],
  ['detail', 'Detail', [['sharpness', 'Sharpness'], ['noise', 'Noise', 0, 100]]],
];

/** Right-hand Masking panel. */
export function MaskingPanel({ mk }) {
  const [open, setOpen] = useState({ light: true, color: true, effects: false, detail: false });
  const [renaming, setRenaming] = useState(null);
  const { list, sel } = mk;
  const adj = sel ? normAdjust(sel.adjust) : null;
  const setAdj = (patch, label) => mk.updateMask(sel.id, m => ({ ...m, adjust: { ...normAdjust(m.adjust), ...patch } }), label);
  const pending = mk.tool?.pending;
  return <section className="mkPanel" aria-label="Masking">
    <div className="mkHead"><strong>Masks</strong>
      <Menu label="Create New Mask" text="＋ Create New Mask" items={typeItems(t => mk.start(t, 'new'))} className="mkCreate" /></div>
    <div className="mkList" role="list" aria-label="Masks">
      {!list.length && <p className="mkNote">No masks yet. Create one to adjust part of the image: Subject, People and Background are found with on-device AI (nothing is uploaded); Sky with classical detection.</p>}
      {list.map(m => {
        const on = m.id === mk.selId;
        return <div key={m.id} role="listitem" className={'mkRow' + (on ? ' on' : '') + (m.enabled === false ? ' off' : '')}>
          <button className="mkSel" aria-label={'Select ' + m.name} aria-pressed={on} onClick={() => mk.setSelId(on ? null : m.id)} onDoubleClick={() => setRenaming(m.id)}>
            <Thumb mask={m} src={mk.thumbSrc} /><span className="mkChip" style={{ background: mk.overlay.color }} />
            {renaming === m.id ? null : <span className="mkName">{m.name}</span>}</button>
          {renaming === m.id && <input className="mkRename" aria-label="Mask name" autoFocus defaultValue={m.name} onBlur={e => { const v = e.target.value.trim(); if (v && v !== m.name) mk.updateMask(m.id, x => ({ ...x, name: v }), 'Rename Mask'); setRenaming(null); }} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setRenaming(null); }} />}
          <button className={'mkIcon' + (m.enabled === false ? ' dim' : '')} aria-label={(m.enabled === false ? 'Show ' : 'Hide ') + m.name} aria-pressed={m.enabled !== false} title="Show / hide this mask's adjustments" onClick={() => mk.updateMask(m.id, x => ({ ...x, enabled: x.enabled === false }), 'Mask Visibility')}>◉</button>
          <button className={'mkIcon' + (m.invert ? ' on' : '')} aria-label={'Invert ' + m.name} aria-pressed={!!m.invert} title="Invert mask" onClick={() => mk.updateMask(m.id, x => ({ ...x, invert: !x.invert }), 'Invert Mask')}>◐</button>
          <Menu label={m.name + ' options'} text="…" items={[
            ['Duplicate mask', () => { const d = clone(m); d.id = 'm' + Math.random().toString(36).slice(2, 9); d.name = m.name + ' copy'; d.components.forEach(c => { c.id = 'c' + Math.random().toString(36).slice(2, 9); }); const i = list.indexOf(m); mk.commit([...list.slice(0, i + 1), d, ...list.slice(i + 1)], 'Duplicate Mask'); mk.setSelId(d.id); }],
            ['Rename mask', () => setRenaming(m.id)],
            ['Delete mask', () => { mk.commit(list.filter(x => x.id !== m.id), 'Delete Mask'); if (on) mk.setSelId(null); }],
          ]} />
        </div>;
      })}
    </div>
    <div className="mkOverlayRow">
      <label className="optCheck"><input type="checkbox" checked={mk.overlay.show} onChange={e => mk.setOverlay(o => ({ ...o, show: e.target.checked }))} />Show Overlay (O)</label>
      <input type="color" aria-label="Overlay color" value={mk.overlay.color} onChange={e => mk.setOverlay(o => ({ ...o, color: e.target.value }))} />
      <input type="range" aria-label="Overlay opacity" min={10} max={90} value={mk.overlay.opacity} onChange={e => mk.setOverlay(o => ({ ...o, opacity: +e.target.value }))} />
    </div>
    {(mk.busy || pending || mk.tool) && <div className="mkStatus" role="status">{mk.busy || (pending ? 'Drag on the image to place the ' + typeLabel(pending.type).toLowerCase() + ' (Esc cancels).' : mk.tool.kind === 'brush' ? 'Brush: paint on the image (Esc leaves the tool).' : mk.tool.kind === 'color' ? 'Click the image to sample a colour; Shift-click adds.' : mk.tool.kind === 'luminance' ? 'Click the image to set the luminance range around that tone.' : '')}</div>}
    {sel && <>
      <div className="mkComps">
        <div className="mkHead"><strong>{sel.name}</strong>
          <Menu label="Add to mask" text="Add" items={typeItems(t => mk.start(t, 'add'))} />
          <Menu label="Subtract from mask" text="Subtract" items={typeItems(t => mk.start(t, 'subtract'))} /></div>
        {sel.components.map((c, i) => {
          const n = i + 1, active = c.id === mk.compId;
          return <div key={c.id} className={'mkComp' + (active ? ' on' : '')}>
            <button className="mkSel" aria-label={'Component ' + n + ': ' + typeLabel(c.type)} aria-pressed={active} onClick={() => active ? mk.selectComp({ id: null }) : mk.selectComp(c)}>
              <span className={'mkOp ' + c.op} title={c.op}>{OP_SIGN[c.op] || '+'}</span><span className="mkName">{typeLabel(c.type)}{c.invert ? ' (inverted)' : ''}</span></button>
            <button className={'mkIcon' + (c.invert ? ' on' : '')} aria-label={'Invert component ' + n} aria-pressed={!!c.invert} title="Invert component" onClick={() => mk.updateComp(sel.id, c.id, x => ({ ...x, invert: !x.invert }), 'Invert Component')}>◐</button>
            <button className="mkIcon" aria-label={'Delete component ' + n} title="Delete component (Delete)" onClick={() => mk.deleteComp(c.id)}>×</button>
            <Menu label={'Component ' + n + ' options'} text="…" items={[
              ['Add mode', () => mk.updateComp(sel.id, c.id, x => ({ ...x, op: 'add' }), 'Component Mode'), c.op === 'add'],
              ['Subtract mode', () => mk.updateComp(sel.id, c.id, x => ({ ...x, op: 'subtract' }), 'Component Mode'), c.op === 'subtract'],
              ['Intersect mode', () => mk.updateComp(sel.id, c.id, x => ({ ...x, op: 'intersect' }), 'Component Mode'), c.op === 'intersect'],
              ['Invert component', () => mk.updateComp(sel.id, c.id, x => ({ ...x, invert: !x.invert }), 'Invert Component')],
              ['Delete component', () => mk.deleteComp(c.id)],
            ]} />
          </div>;
        })}
        {mk.comp && <ComponentEditor mk={mk} m={sel} c={mk.comp} />}
      </div>
      <div className="mkAdjust">
        <Slider label="Amount" aria="Mask amount" value={sel.amount ?? 100} min={0} max={100} def={100} onChange={v => mk.updateMask(sel.id, m => ({ ...m, amount: v }), 'Mask Amount')} />
        <div className="mkRowBtns"><button onClick={() => setAdj({ ...LOCAL_DEFAULTS, color: { ...LOCAL_DEFAULTS.color } }, 'Reset Mask Sliders')}>Reset mask sliders</button></div>
        {GROUPS.map(([id, title, items]) => <Panel key={id} id={id} title={title} open={open[id]} toggle={k => setOpen(o => ({ ...o, [k]: !o[k] }))}>
          {items.map(([k, l, min = -100, max = 100, step = 1, gradient]) => <Slider key={k} label={l} aria={'Mask ' + l} value={adj[k]} min={min} max={max} step={step} gradient={gradient} onChange={v => setAdj({ [k]: v }, 'Mask ' + l)} />)}
          {id === 'color' && <ColorTint value={adj.color} onChange={v => setAdj({ color: v }, 'Mask Color')} />}
        </Panel>)}
      </div>
    </>}
  </section>;
}

// ---------------------------------------------------------------- on-canvas layer
const DEG = Math.PI / 180;
/** Overlay and interactive tools positioned exactly over `canvasRef` (child of its positioned container). */
export function MaskCanvasLayer({ mk, canvasRef }) {
  const layer = useRef(), ov = useRef(), [box, setBox] = useState(null);
  const [drag, setDrag] = useState(null), [cursor, setCursor] = useState(null), [stroke, setStroke] = useState(null);
  // follow the canvas' on-screen box
  useLayoutEffect(() => {
    const measure = () => {
      const c = canvasRef.current, el = layer.current; if (!c || !el?.offsetParent) return;
      const a = c.getBoundingClientRect(), p = el.offsetParent.getBoundingClientRect();
      const b = { left: a.left - p.left - el.offsetParent.clientLeft + el.offsetParent.scrollLeft, top: a.top - p.top - el.offsetParent.clientTop + el.offsetParent.scrollTop, width: a.width, height: a.height };
      setBox(o => o && Math.abs(o.left - b.left) < 0.5 && Math.abs(o.top - b.top) < 0.5 && Math.abs(o.width - b.width) < 0.5 && Math.abs(o.height - b.height) < 0.5 ? o : b);
    };
    measure();
    const ro = new ResizeObserver(measure); if (canvasRef.current) ro.observe(canvasRef.current); if (layer.current?.offsetParent) ro.observe(layer.current.offsetParent);
    window.addEventListener('resize', measure); const iv = setInterval(measure, 500);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); clearInterval(iv); };
  }, []);
  // red overlay
  useEffect(() => {
    const c = ov.current, o = mk.ovAlpha; if (!c) return;
    if (!o || !mk.overlay.show) { c.width = 1; c.height = 1; c.getContext('2d').clearRect(0, 0, 1, 1); return; }
    c.width = o.w; c.height = o.h; const im = new ImageData(o.w, o.h), hex = mk.overlay.color, r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16), k = mk.overlay.opacity / 100 * 255;
    for (let i = 0; i < o.a.length; i++) { im.data[i * 4] = r; im.data[i * 4 + 1] = g; im.data[i * 4 + 2] = b; im.data[i * 4 + 3] = o.a[i] * k; }
    c.getContext('2d').putImageData(im, 0, 0);
  }, [mk.ovAlpha, mk.overlay]);

  const W = box?.width || 1, H = box?.height || 1, tool = mk.tool, sel = mk.sel, comp = mk.comp;
  const norm = e => { const r = layer.current.getBoundingClientRect(); return [Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))]; };
  const interactive = !!tool;

  // ----- tool pointer handling (brush, gradient creation, sampling)
  const sample = (nx, ny) => {
    const s = mk.src; if (!s) return null; const x = Math.min(s.w - 1, Math.floor(nx * s.w)), y = Math.min(s.h - 1, Math.floor(ny * s.h)); let R = 0, G = 0, B = 0, n = 0;
    for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) { const xx = Math.min(s.w - 1, Math.max(0, x + i)), yy = Math.min(s.h - 1, Math.max(0, y + j)), q = (yy * s.w + xx) * 4; R += s.data[q]; G += s.data[q + 1]; B += s.data[q + 2]; n++; }
    return [Math.round(R / n), Math.round(G / n), Math.round(B / n)];
  };
  const down = e => {
    if (!tool || e.button !== 0) return; e.preventDefault(); e.stopPropagation();
    const p = norm(e);
    if (tool.kind === 'brush') { layer.current.setPointerCapture(e.pointerId); const b = mk.brush; setStroke({ mode: b.erase || e.altKey ? 'erase' : 'add', size: b.size, feather: b.feather, flow: b.flow, density: b.density, points: [p[0], p[1]] }); return; }
    if (tool.pending) { layer.current.setPointerCapture(e.pointerId); setDrag({ kind: 'create', type: tool.pending.type, a: p, b: p }); return; }
    if (tool.kind === 'color' || tool.kind === 'luminance') {
      const c = sample(p[0], p[1]); if (!c || !sel) return; const target = sel.components.find(x => x.id === tool.compId); if (!target) return;
      if (tool.kind === 'color') { const prev = target.params.samples || []; mk.updateComp(sel.id, target.id, x => ({ ...x, params: { ...x.params, samples: e.shiftKey ? [...prev, c].slice(-5) : [c] } }), 'Color Range Sample'); }
      else { const L = Math.round(lstar(c[0], c[1], c[2])); mk.updateComp(sel.id, target.id, x => ({ ...x, params: { ...x.params, lo: Math.max(0, L - 12), hi: Math.min(100, L + 12), loFeather: 10, hiFeather: 10 } }), 'Luminance Range Sample'); }
    }
  };
  const move = e => {
    if (!box) return; const p = norm(e);
    if (tool?.kind === 'brush') setCursor(p);
    if (stroke) { const last = stroke.points.slice(-2), minStep = stroke.size * Math.max(W, H) / 8 / Math.max(W, H); const dx = (p[0] - last[0]) * W / Math.max(W, H), dy = (p[1] - last[1]) * H / Math.max(W, H); if (Math.hypot(dx, dy) >= minStep) setStroke(s => ({ ...s, points: [...s.points, p[0], p[1]] })); }
    else if (drag?.kind === 'create') setDrag(d => ({ ...d, b: p }));
  };
  const up = () => {
    if (stroke) {
      const st = stroke; setStroke(null);
      if (sel && sel.components.some(c => c.id === tool.compId)) mk.updateComp(sel.id, tool.compId, x => ({ ...x, params: { ...x.params, strokes: [...(x.params.strokes || []), st] } }), st.mode === 'erase' ? 'Brush Erase' : 'Brush Stroke');
      return;
    }
    if (drag?.kind === 'create') {
      const d = drag; setDrag(null); const dx = (d.b[0] - d.a[0]) * W, dy = (d.b[1] - d.a[1]) * H;
      if (Math.hypot(dx, dy) < 6) return; // a click, not a drag
      const params = d.type === 'linear' ? { x0: d.a[0], y0: d.a[1], x1: d.b[0], y1: d.b[1] } : { cx: d.a[0], cy: d.a[1], rx: Math.max(0.01, Math.abs(d.b[0] - d.a[0])), ry: Math.max(0.01, Math.abs(d.b[1] - d.a[1])), angle: 0, feather: 50, inside: true };
      mk.place(createComponent(d.type, tool.pending.op === 'new' ? 'add' : tool.pending.op, params), tool.pending.op); mk.setTool(null);
    }
  };

  // ----- handle dragging (linear / radial components of the selected mask)
  const handleDown = (e, which) => {
    e.preventDefault(); e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ kind: 'handle', which, start: norm(e), p0: { ...comp.params } });
  };
  const handleMove = e => {
    if (drag?.kind !== 'handle' || !comp || !sel) return;
    const p = norm(e), q = drag.p0, d = [p[0] - drag.start[0], p[1] - drag.start[1]]; let np = null;
    if (comp.type === 'linear') {
      if (drag.which === 'start') np = { x0: q.x0 + d[0], y0: q.y0 + d[1] };
      else if (drag.which === 'end') np = { x1: q.x1 + d[0], y1: q.y1 + d[1] };
      else if (drag.which === 'move') np = { x0: q.x0 + d[0], y0: q.y0 + d[1], x1: q.x1 + d[0], y1: q.y1 + d[1] };
      else if (drag.which === 'rotate') {
        const mx = (q.x0 + q.x1) / 2 * W, my = (q.y0 + q.y1) / 2 * H, a0 = Math.atan2(drag.start[1] * H - my, drag.start[0] * W - mx), a1 = Math.atan2(p[1] * H - my, p[0] * W - mx), da = a1 - a0, co = Math.cos(da), si = Math.sin(da);
        const rot = (x, y) => { const dx = x * W - mx, dy = y * H - my; return [(mx + dx * co - dy * si) / W, (my + dx * si + dy * co) / H]; };
        const [x0, y0] = rot(q.x0, q.y0), [x1, y1] = rot(q.x1, q.y1); np = { x0, y0, x1, y1 };
      }
    } else if (comp.type === 'radial') {
      const cx = q.cx * W, cy = q.cy * H, ang = (q.angle || 0) * DEG, px = p[0] * W - cx, py = p[1] * H - cy, u = px * Math.cos(ang) + py * Math.sin(ang), v = -px * Math.sin(ang) + py * Math.cos(ang);
      if (drag.which === 'move') np = { cx: q.cx + d[0], cy: q.cy + d[1] };
      else if (drag.which === 'rx') np = { rx: Math.max(0.005, Math.abs(u) / W) };
      else if (drag.which === 'ry') np = { ry: Math.max(0.005, Math.abs(v) / H) };
      else if (drag.which === 'rotate') np = { angle: Math.round((Math.atan2(py, px) / DEG + 90 + 540) % 360 - 180) };
      else if (drag.which === 'feather') np = { feather: Math.round(Math.max(0, Math.min(100, (1 - Math.abs(u) / Math.max(1, q.rx * W)) * 100))) };
    }
    if (np) mk.updateComp(sel.id, comp.id, x => ({ ...x, params: { ...x.params, ...np } }), comp.type === 'linear' ? 'Linear Gradient' : 'Radial Gradient');
  };
  const handleUp = () => setDrag(null);
  const H_ = (which, x, y, label, cls = '') => <circle key={which} className={'mkHandle ' + cls} cx={x} cy={y} r={which === 'move' ? 7 : 6} role="button" aria-label={label} onPointerDown={e => handleDown(e, which)} onPointerMove={handleMove} onPointerUp={handleUp} />;

  let shapes = null;
  const showHandles = !tool && comp && sel && (comp.type === 'linear' || comp.type === 'radial');
  if (showHandles && comp.type === 'linear') {
    const q = comp.params, ax = q.x0 * W, ay = q.y0 * H, bx = q.x1 * W, by = q.y1 * H, dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len, L = Math.hypot(W, H);
    const line = (x, y, k, dash) => <line key={k} x1={x - nx * L} y1={y - ny * L} x2={x + nx * L} y2={y + ny * L} className={'mkLine' + (dash ? ' dash' : '')} />;
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    shapes = <>{line(ax, ay, 'a')}{line(mx, my, 'm', true)}{line(bx, by, 'b')}<line x1={mx} y1={my} x2={mx + nx * 50} y2={my + ny * 50} className="mkLine thin" />
      {H_('start', ax, ay, 'Gradient start handle')}{H_('end', bx, by, 'Gradient end handle')}{H_('move', mx, my, 'Gradient center handle', 'center')}{H_('rotate', mx + nx * 50, my + ny * 50, 'Gradient rotate handle', 'rot')}</>;
  } else if (showHandles && comp.type === 'radial') {
    const q = comp.params, cx = q.cx * W, cy = q.cy * H, a = q.rx * W, b = q.ry * H, ang = q.angle || 0, t = ang * DEG, inner = 1 - (q.feather ?? 50) / 100;
    const pt = (u, v) => [cx + u * Math.cos(t) - v * Math.sin(t), cy + u * Math.sin(t) + v * Math.cos(t)];
    const [rx1, ry1] = pt(a, 0), [rx2, ry2] = pt(-a, 0), [tx, ty] = pt(0, -b), [bx2, by2] = pt(0, b), [ox, oy] = pt(0, -b - 26), [fx, fy] = pt(a * inner, 0);
    shapes = <><ellipse cx={cx} cy={cy} rx={a} ry={b} transform={`rotate(${ang} ${cx} ${cy})`} className="mkLine" />{inner > 0.01 && <ellipse cx={cx} cy={cy} rx={a * inner} ry={b * inner} transform={`rotate(${ang} ${cx} ${cy})`} className="mkLine dash" />}
      <line x1={tx} y1={ty} x2={ox} y2={oy} className="mkLine thin" />
      {H_('move', cx, cy, 'Radial center handle', 'center')}{H_('rx', rx1, ry1, 'Radial width handle')}{<circle className="mkHandle" cx={rx2} cy={ry2} r={6} role="button" aria-label="Radial width handle (left)" onPointerDown={e => handleDown(e, 'rx')} onPointerMove={handleMove} onPointerUp={handleUp} />}
      {H_('ry', tx, ty, 'Radial height handle')}{<circle className="mkHandle" cx={bx2} cy={by2} r={6} role="button" aria-label="Radial height handle (bottom)" onPointerDown={e => handleDown(e, 'ry')} onPointerMove={handleMove} onPointerUp={handleUp} />}
      {H_('rotate', ox, oy, 'Radial rotate handle', 'rot')}{H_('feather', fx, fy, 'Radial feather handle', 'feather')}</>;
  }
  let preview = null;
  if (drag?.kind === 'create') {
    const ax = drag.a[0] * W, ay = drag.a[1] * H, bx = drag.b[0] * W, by = drag.b[1] * H;
    preview = drag.type === 'linear' ? <><line x1={ax} y1={ay} x2={bx} y2={by} className="mkLine" /><circle cx={ax} cy={ay} r={4} className="mkDot" /><circle cx={bx} cy={by} r={4} className="mkDot" /></>
      : <ellipse cx={ax} cy={ay} rx={Math.abs(bx - ax)} ry={Math.abs(by - ay)} className="mkLine" />;
  }
  const L = Math.max(W, H);
  const pts = s => { const o = []; for (let i = 0; i < s.points.length; i += 2) o.push((s.points[i] * W).toFixed(1) + ',' + (s.points[i + 1] * H).toFixed(1)); return o.join(' '); };
  return <div ref={layer} className={'mkLayer' + (interactive ? ' active' : '') + (tool?.kind === 'brush' ? ' brush' : '')} aria-label="Mask overlay" style={box ? { left: box.left, top: box.top, width: box.width, height: box.height } : { left: 0, top: 0, width: 0, height: 0, visibility: 'hidden' }}
    onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={() => setCursor(null)} onClick={e => { if (interactive) e.stopPropagation(); }}>
    <canvas ref={ov} className="mkOverlay" aria-hidden="true" />
    <svg width={W} height={H} className="mkSvg">
      {shapes}{preview}
      {stroke && <polyline points={pts(stroke)} className={'mkStroke' + (stroke.mode === 'erase' ? ' erase' : '')} strokeWidth={stroke.size * L} />}
      {tool?.kind === 'brush' && cursor && <><circle cx={cursor[0] * W} cy={cursor[1] * H} r={mk.brush.size * L / 2} className="mkCursor" /><circle cx={cursor[0] * W} cy={cursor[1] * H} r={mk.brush.size * L / 2 * (1 - mk.brush.feather / 100)} className="mkCursor inner" /></>}
    </svg>
  </div>;
}

/** Edit | Masking switch for the top of the right-hand panel. */
export function MaskModeBar({ mk }) {
  const n = mk.list.filter(m => m.enabled !== false).length;
  return <div className="mkModeBar"><div className="segmented" role="group" aria-label="Panel mode">
    <button aria-label="Edit panels" aria-pressed={!mk.on} className={!mk.on ? 'on' : ''} onClick={() => mk.setOn(false)}>Edit</button>
    <button aria-label="Masking" aria-pressed={mk.on} className={mk.on ? 'on' : ''} onClick={() => mk.setOn(true)} title="Masking: local adjustments">Masking{n > 0 && <span className="mkDot" aria-hidden="true" />}</button>
  </div></div>;
}
