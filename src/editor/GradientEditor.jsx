import React, { useEffect, useMemo, useRef, useState } from 'react';

// Photoshop-style Gradient Editor dialog plus the small options-bar gradient swatch.
// Gradient model: { name, stops: [{ at: 0..1, color: '#rrggbb', opacity: 0..1 }] }.
// Colour and opacity stops are merged: every stop carries both. The opacity markers above the
// bar and the colour markers below it are two views of the same stops (dragging either moves it).
// CSS: dist/css/toolui.css (plus the shared .opDialog / .opField rules from modern.css).

const LS_KEY = 'zertake.gradients';
const clamp01 = v => Math.max(0, Math.min(1, v));
const round3 = v => Math.round(v * 1000) / 1000;
const hex2 = n => Math.round(n).toString(16).padStart(2, '0');

export function hexToRgb(hex) {
  let h = String(hex || '#000000').replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [0, 0, 0];
}
export const rgbToHex = ([r, g, b]) => '#' + hex2(r) + hex2(g) + hex2(b);

// Sorted, clamped copy of a stop list (always at least two stops).
export function normalizeStops(stops) {
  const list = (Array.isArray(stops) ? stops : []).map(s => ({
    at: clamp01(+s.at || 0),
    color: /^#[0-9a-f]{6}$/i.test(s.color) ? s.color.toLowerCase() : rgbToHex(hexToRgb(s.color)),
    opacity: s.opacity == null ? 1 : clamp01(+s.opacity),
  })).sort((a, b) => a.at - b.at);
  if (list.length === 0) return [{ at: 0, color: '#000000', opacity: 1 }, { at: 1, color: '#ffffff', opacity: 1 }];
  if (list.length === 1) return [{ ...list[0], at: 0 }, { ...list[0], at: 1 }];
  return list;
}

// Colour of the gradient at t (0..1): [r, g, b, a] with a in 0..1 (linear interpolation, no midpoints).
export function sampleStops(stops, t) {
  const s = normalizeStops(stops);
  if (t <= s[0].at) return [...hexToRgb(s[0].color), s[0].opacity];
  const last = s[s.length - 1];
  if (t >= last.at) return [...hexToRgb(last.color), last.opacity];
  let i = 0;
  while (i < s.length - 2 && t > s[i + 1].at) i++;
  const a = s[i], b = s[i + 1], k = b.at > a.at ? (t - a.at) / (b.at - a.at) : 0;
  const ca = hexToRgb(a.color), cb = hexToRgb(b.color);
  return [0, 1, 2].map(j => Math.round(ca[j] + (cb[j] - ca[j]) * k)).concat(a.opacity + (b.opacity - a.opacity) * k);
}

// A CSS `background` value (use it as the `background` shorthand, not `background-image`):
// the gradient left to right over an 8 px checkerboard that shows transparency.
export function stopsToCss(stops) {
  const s = normalizeStops(stops);
  const parts = s.map(p => { const [r, g, b] = hexToRgb(p.color); return `rgba(${r},${g},${b},${round3(p.opacity)}) ${round3(p.at * 100)}%`; });
  return `linear-gradient(90deg, ${parts.join(', ')}), repeating-conic-gradient(#c8c8c8 0 25%, #ffffff 0 50%) 0 0 / 8px 8px`;
}

// Small clickable gradient preview, like the options-bar gradient picker.
export function GradientSwatch({ value, onClick, label = 'Gradient' }) {
  return <button type="button" className="gradSwatch" aria-label={label} title={value?.name ? `${label}: ${value.name}` : label}
    onClick={onClick} style={{ background: stopsToCss(value?.stops) }} />;
}

function loadLocal() {
  try { const v = JSON.parse(localStorage.getItem(LS_KEY) || '[]'); return Array.isArray(v) ? v.filter(p => p && Array.isArray(p.stops)) : []; } catch { return []; }
}
function saveLocal(list) { try { localStorage.setItem(LS_KEY, JSON.stringify(list)); } catch { /* storage unavailable: list stays in memory */ } }

let nextId = 1;
const withIds = stops => normalizeStops(stops).map(s => ({ ...s, id: nextId++ }));
const strip = stops => stops.map(({ at, color, opacity }) => ({ at: round3(at), color, opacity: round3(opacity) })).sort((a, b) => a.at - b.at);

export default function GradientEditor({ value, fg = '#000000', bg = '#ffffff', presets = [], onChange, onCancel, onOk }) {
  const [stops, setStops] = useState(() => withIds(value?.stops));
  const [name, setName] = useState(value?.name || 'Custom');
  const [sel, setSel] = useState(() => null);
  const [local, setLocal] = useState(loadLocal);
  const [removing, setRemoving] = useState(null); // id of a stop being dragged off the bar
  const barRef = useRef(null);
  const drag = useRef(null);
  const first = useRef(true);

  const sorted = useMemo(() => [...stops].sort((a, b) => a.at - b.at), [stops]);
  const current = { name, stops: strip(stops) };
  const selStop = stops.find(s => s.id === sel) || null;

  useEffect(() => { if (first.current) { first.current = false; return; } onChange?.(current); }, [stops, name]);
  useEffect(() => { if (sel == null && sorted.length) setSel(sorted[0].id); }, [sel, sorted]);

  const patch = (id, p) => setStops(list => list.map(s => s.id === id ? { ...s, ...p } : s));
  const remove = id => {
    if (stops.length <= 2) return;
    const rest = stops.filter(s => s.id !== id);
    setStops(rest);
    if (sel === id) setSel([...rest].sort((a, b) => a.at - b.at)[0].id);
  };
  const posFrom = clientX => { const r = barRef.current.getBoundingClientRect(); return clamp01((clientX - r.left) / r.width); };
  const addAt = clientX => {
    const at = posFrom(clientX);
    const [r, g, b, a] = sampleStops(stops, at);
    const s = { id: nextId++, at, color: rgbToHex([r, g, b]), opacity: a };
    setStops(list => [...list, s]);
    setSel(s.id);
  };

  const startDrag = (e, s, lane) => {
    e.preventDefault(); e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    e.currentTarget.focus();
    setSel(s.id);
    drag.current = { id: s.id, lane, y0: e.clientY };
  };
  const moveDrag = e => {
    const d = drag.current; if (!d) return;
    const dy = e.clientY - d.y0;
    // colour markers come off downwards, opacity markers upwards (away from the bar)
    const off = (d.lane === 'color' ? dy : -dy) > 30 && stops.length > 2;
    d.off = off;
    setRemoving(off ? d.id : null);
    if (!off) patch(d.id, { at: posFrom(e.clientX) });
  };
  const endDrag = () => {
    const d = drag.current; drag.current = null; if (!d) return;
    if (d.off) remove(d.id);
    setRemoving(null);
  };
  const markerKey = (e, s) => {
    const step = e.shiftKey ? 0.1 : 0.01;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); patch(s.id, { at: clamp01(s.at - step) }); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); patch(s.id, { at: clamp01(s.at + step) }); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); remove(s.id); }
  };

  const applyPreset = p => { setStops(withIds(p.stops)); setName(p.name || 'Custom'); setSel(null); };
  const addPreset = () => { const list = [...local, { name: name.trim() || 'Custom', stops: strip(stops) }]; setLocal(list); saveLocal(list); };
  const deleteLocal = i => { const list = local.filter((_, j) => j !== i); setLocal(list); saveLocal(list); };

  const lane = kind => <div className={'gradLane ' + kind} onPointerDown={e => { if (e.button === 0) addAt(e.clientX); }}
    title={`Click to add a ${kind === 'color' ? 'colour' : 'opacity'} stop`}>
    {sorted.map((s, i) => {
      const label = `${kind === 'color' ? 'Color' : 'Opacity'} stop ${i + 1}`;
      return <span key={s.id} role="slider" tabIndex={0} aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(s.at * 100)}
        aria-valuetext={`${Math.round(s.at * 100)}%, ${kind === 'color' ? s.color : Math.round(s.opacity * 100) + '% opacity'}`}
        className={'gradStop' + (s.id === sel ? ' on' : '') + (s.id === removing ? ' removing' : '')}
        style={{ left: s.at * 100 + '%', '--c': kind === 'color' ? s.color : `rgba(255,255,255,${s.opacity})` }}
        onPointerDown={e => startDrag(e, s, kind)} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}
        onKeyDown={e => markerKey(e, s)} onFocus={() => setSel(s.id)} />;
    })}
  </div>;

  const allPresets = [...presets.map(p => ({ ...p, local: false })), ...local.map((p, i) => ({ ...p, local: true, li: i }))];
  const seen = {};
  const presetLabel = p => { const base = `Preset ${p.name || 'Untitled'}`; seen[base] = (seen[base] || 0) + 1; return seen[base] > 1 ? `${base} ${seen[base]}` : base; };

  return <div className="opDialog gradEditor" role="dialog" aria-label="Gradient Editor" onPointerDown={e => e.stopPropagation()}
    onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel?.(); } else if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'color') { e.preventDefault(); onOk?.(current); } }}>
    <header><h3>Gradient Editor</h3></header>
    <div className="gradPresets" role="group" aria-label="Gradient presets">
      {allPresets.map((p, i) => {
        const label = presetLabel(p);
        return <span key={i} className="gradPresetCell">
          <button type="button" className="gradPreset" aria-label={label} title={p.name} style={{ background: stopsToCss(p.stops) }} onClick={() => applyPreset(p)} />
          {p.local && <button type="button" className="gradPresetDel" aria-label={`Delete ${label}`} title="Delete preset" onClick={() => deleteLocal(p.li)}>×</button>}
        </span>;
      })}
    </div>
    <div className="gradNameRow">
      <label className="gradName"><span>Name</span><input type="text" aria-label="Gradient name" value={name} onChange={e => setName(e.target.value)} /></label>
      <button type="button" className="optButton" aria-label="New preset from gradient" onClick={addPreset}>New</button>
    </div>
    <div className="gradBarWrap">
      {lane('opacity')}
      <div ref={barRef} className="gradBar" role="img" aria-label="Gradient preview" style={{ background: stopsToCss(stops) }} />
      {lane('color')}
    </div>
    <p className="gradHint">Click above or below the bar to add a stop; drag a stop away from the bar to remove it.</p>
    {selStop && <fieldset className="gradStopEdit">
      <legend>Selected stop</legend>
      <label className="opField"><span>Color</span><input type="color" aria-label="Stop color" value={selStop.color} onChange={e => patch(selStop.id, { color: e.target.value })} /></label>
      <div className="gradQuick">
        <button type="button" className="optButton" aria-label="Use foreground color" onClick={() => patch(selStop.id, { color: normalizeStops([{ at: 0, color: fg }])[0].color })}><i style={{ background: fg }} />Foreground</button>
        <button type="button" className="optButton" aria-label="Use background color" onClick={() => patch(selStop.id, { color: normalizeStops([{ at: 0, color: bg }])[0].color })}><i style={{ background: bg }} />Background</button>
      </div>
      <label className="opField"><span>Opacity</span>
        <input type="range" aria-label="Stop opacity" min={0} max={100} value={Math.round(selStop.opacity * 100)} style={{ '--p': selStop.opacity }} onChange={e => patch(selStop.id, { opacity: +e.target.value / 100 })} />
        <input type="number" aria-label="Stop opacity value" min={0} max={100} value={Math.round(selStop.opacity * 100)} onChange={e => { const v = +e.target.value; if (Number.isFinite(v)) patch(selStop.id, { opacity: clamp01(v / 100) }); }} /><small>%</small></label>
      <label className="opField"><span>Location</span>
        <input type="range" aria-label="Stop location" min={0} max={100} step={0.1} value={round3(selStop.at * 100)} style={{ '--p': selStop.at }} onChange={e => patch(selStop.id, { at: clamp01(+e.target.value / 100) })} />
        <input type="number" aria-label="Stop location value" min={0} max={100} step={0.1} value={Math.round(selStop.at * 1000) / 10} onChange={e => { const v = +e.target.value; if (Number.isFinite(v)) patch(selStop.id, { at: clamp01(v / 100) }); }} /><small>%</small></label>
      <button type="button" className="optButton" aria-label="Delete stop" disabled={stops.length <= 2} onClick={() => remove(selStop.id)}>Delete stop</button>
    </fieldset>}
    <footer>
      <button type="button" onClick={() => onCancel?.()}>Cancel</button>
      <button type="button" className="primary" onClick={() => onOk?.(current)}>OK</button>
    </footer>
  </div>;
}
