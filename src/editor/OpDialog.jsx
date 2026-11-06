import AngleDial from './AngleDial.jsx';
import React, { useEffect, useRef, useState } from 'react';
import { defaults } from '../engine/ops.js';
import { curveLut } from '../engine/color.js';

// Generic dialog for registry operations (Image > Adjustments, Filter). Every change re-runs
// the op in the worker on the full target (debounced) and shows it on the canvas when Preview
// is on, like Photoshop's dialogs. OK commits one undo step; Cancel restores the pixels.

export function Histogram({ hist, channel = 'l' }) {
  if (!hist) return null;
  const h = hist[channel === 'rgb' ? 'l' : channel] || hist.l, max = Math.max(1, ...h);
  const d = Array.from(h, (v, x) => `M${x} 100V${100 - Math.sqrt(v / max) * 100}`).join('');
  return <svg className="histogram" viewBox="0 0 256 100" preserveAspectRatio="none" aria-label="Histogram"><path d={d} stroke="currentColor" strokeWidth="1" /></svg>;
}

export function CurveEditor({ value, onChange, hist }) {
  const [ch, setCh] = useState('rgb');
  const svg = useRef(), drag = useRef(null);
  const pts = value[ch];
  const toPt = e => { const r = svg.current.getBoundingClientRect(); return [Math.round(Math.min(255, Math.max(0, (e.clientX - r.left) / r.width * 255))), Math.round(Math.min(255, Math.max(0, 255 - (e.clientY - r.top) / r.height * 255)))]; };
  const set = next => onChange({ ...value, [ch]: next });
  const down = e => {
    e.preventDefault(); svg.current.setPointerCapture(e.pointerId);
    const p = toPt(e); let i = pts.findIndex(q => Math.abs(q[0] - p[0]) < 8 && Math.abs(q[1] - p[1]) < 12);
    let next = pts;
    if (i < 0) { next = [...pts, p].sort((a, b) => a[0] - b[0]); i = next.findIndex(q => q === p || (q[0] === p[0] && q[1] === p[1])); set(next); }
    drag.current = { i, next };
  };
  const move = e => { const d = drag.current; if (!d) return; const p = toPt(e); const next = d.next.map((q, k) => k === d.i ? p : q); d.next = next; set(next); };
  // dragging a point well above the box removes it (endpoints are kept so the curve stays defined)
  const up = e => { const d = drag.current; drag.current = null; if (d && e.clientY < svg.current.getBoundingClientRect().top - 20 && d.next.length > 2) set(d.next.filter((_, k) => k !== d.i)); };
  return <div className="curveEditor">
    <div className="segmented" role="group" aria-label="Curve channel">{[['rgb', 'RGB'], ['r', 'Red'], ['g', 'Green'], ['b', 'Blue']].map(([k, l]) => <button key={k} aria-pressed={ch === k} className={ch === k ? 'on' : ''} onClick={() => setCh(k)}>{l}</button>)}</div>
    <div className="curveBox">
      <Histogram hist={hist} channel={ch} />
      <svg ref={svg} viewBox="0 0 255 255" aria-label="Curve" onPointerDown={down} onPointerMove={move} onPointerUp={up}>
        {[64, 128, 192].map(v => <g key={v} stroke="#ffffff22"><path d={`M${v} 0V255`} /><path d={`M0 ${v}H255`} /></g>)}
        <path d="M0 255L255 0" stroke="#ffffff33" fill="none" />
        <CurvePath pts={pts} />
        {pts.map(([x, y], i) => <rect key={i} x={x - 4} y={255 - y - 4} width="8" height="8" className="curvePoint" />)}
      </svg>
    </div>
    <small className="hint">Click to add a point, drag to shape, drag a point above the box to remove it.</small>
    <button onClick={() => set([[0, 0], [255, 255]])}>Reset {ch === 'rgb' ? 'RGB' : ch.toUpperCase()} curve</button>
  </div>;
}
function CurvePath({ pts }) { const lut = curveLut(pts); return <path d={'M' + Array.from(lut, (v, x) => `${x} ${255 - v}`).join('L')} stroke="#c9b8ff" strokeWidth="1.5" fill="none" />; }

export function Field({ p, value, onChange }) {
  if (p.type === 'range' && p.unit === '°' && p.max - p.min === 360) return <label className="opField dialField"><span>{p.label}</span><AngleDial label={p.label} value={value} onChange={onChange} min={p.min} max={p.max} /><input type="number" aria-label={p.label + ' value'} min={p.min} max={p.max} step={p.step} value={value} onChange={e => { const v = +e.target.value; if (Number.isFinite(v)) onChange(Math.min(p.max, Math.max(p.min, v))); }} /><small>°</small></label>;
  if (p.type === 'range') return <label className="opField"><span>{p.label}</span>
    <input type="range" aria-label={p.label} min={p.min} max={p.max} step={p.step} value={value} style={{ '--hi': ((value - p.min) / (p.max - p.min) * 100) + '%' }} onChange={e => onChange(+e.target.value)} />
    <input type="number" aria-label={p.label + ' value'} min={p.min} max={p.max} step={p.step} value={value} onChange={e => { const v = +e.target.value; if (Number.isFinite(v)) onChange(Math.min(p.max, Math.max(p.min, v))); }} />{p.unit && <small>{p.unit}</small>}</label>;
  if (p.type === 'select') return <label className="opField"><span>{p.label}</span><select aria-label={p.label} value={value} onChange={e => onChange(e.target.value)}>{p.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>;
  if (p.type === 'checkbox') return <label className="optCheck"><input type="checkbox" aria-label={p.label} checked={!!value} onChange={e => onChange(e.target.checked)} />{p.label}</label>;
  if (p.type === 'color') return <label className="opField"><span>{p.label}</span><input type="color" aria-label={p.label} value={value} onChange={e => onChange(e.target.value)} /></label>;
  if (p.type === 'kernel') return <label className="opField column"><span>{p.label}</span><textarea aria-label={p.label} defaultValue={value.join(', ')} onBlur={e => { const k = e.target.value.split(/[\s,]+/).filter(Boolean).map(Number); if ((k.length === 9 || k.length === 25) && k.every(Number.isFinite)) onChange(k); }} /></label>;
  return null;
}

export default function OpDialog({ op, hist, busy, error, onChange, onCancel, onApply, preview, setPreview, initial }) {
  const [params, setParams] = useState(() => initial || defaults(op));
  useEffect(() => { onChange(params); }, [params]);
  const set = (k, v) => setParams(p => ({ ...p, [k]: v }));
  return <div className="opDialog" role="dialog" aria-label={op.name.replace('…', '')} onPointerDown={e => e.stopPropagation()} onKeyDown={e => { if (e.key === 'Escape') onCancel(); if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') onApply(params); }}>
    <header><h3>{op.name.replace('…', '')}</h3><span className="opStatus" role="status">{error ? error : busy ? 'Processing…' : 'Ready'}</span></header>
    {op.histogram && op.id !== 'curves' && <Histogram hist={hist} channel={params.channel || 'l'} />}
    <div className="opFields">
      {op.params.map(p => p.type === 'curve'
        ? <CurveEditor key={p.key} value={params[p.key]} hist={hist} onChange={v => set(p.key, v)} />
        : <Field key={p.key} p={p} value={params[p.key]} onChange={v => set(p.key, v)} />)}
    </div>
    <footer>
      <label className="optCheck"><input type="checkbox" checked={preview} onChange={e => setPreview(e.target.checked)} />Preview</label>
      <button onClick={() => setParams(defaults(op))}>Reset</button>
      <button onClick={onCancel}>Cancel</button>
      <button className="primary" disabled={busy && !preview} onClick={() => onApply(params)}>OK</button>
    </footer>
  </div>;
}
