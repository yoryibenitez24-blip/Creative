import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { develop, developDefaults } from '../engine/develop.js';
import { resample } from '../engine/geometry.js';
import { SlidersHorizontal, Crop, Grid3x3, Bandage, Layers, Sparkles, History, Trash2, Pencil } from 'lucide-react';
import {
  CROP_DEFAULTS, GEOMETRY_DEFAULTS, SPOT_DEFAULTS, cropSettingsToRect, isCropIdentity, uprightFor, autoStraightenAngle, findSpotSource, spotMask,
} from '../engine/develop2.js';
import { PANELS, DEFAULT_SYNC_PANELS, blendPreset as blend, applyPreset } from '../engine/catalog.js';
import { CropOverlay, CropPanel, GeometryPanel, GuidedOverlay, RemovePanel, SpotsOverlay, straightenCrop } from './GeometryTools.jsx';
import { Slider } from './DevelopPanels.jsx';

// Lightroom-Mobile-style tool switcher for the Camera Raw Filter and Library · Develop:
// Edit · Crop · Geometry · Remove · Masking · Presets · Versions. The tools' engines live in
// develop2.js (crop, geometry, spots) and masks.js; their widgets in GeometryTools.jsx and
// MaskingPanel.jsx. This module wires them to a host's settings state.
//
//   const ct = useDevelopTools({ s, replace, getSource, mk, presets, savePreset, deletePreset,
//                                versions, createVersion, applyVersion, renameVersion, deleteVersion, imageSize })
//     imageSize            [w, h] of the full-resolution image (optional; crop sizes are shown in these pixels)
//     s                    current develop settings;  replace(next, label) stores new settings
//     getSource()          undeveloped preview proxy {w,h,data} (Upright, Auto straighten, spot sources)
//     mk                   useMasking() result (the Masking tool turns mk.on on/off)
//     presets              [{ id, name, builtin?, settings }]; savePreset(name, panels); deletePreset(id)
//     versions             [{ name, settings }]; createVersion(name); applyVersion(i); renameVersion(i, name); deleteVersion(i)
//   ct.tool                'edit' | 'crop' | 'geometry' | 'remove' | 'masking' | 'presets' | 'versions'
//   <ToolRail ct={ct} />   the switcher (vertical icon rail)
//   ct.panel               right-hand panel content for crop/geometry/remove/presets/versions (null otherwise)
//   ct.overlay(canvasRef)  on-canvas widget for crop / guided upright / remove (null otherwise)
//   viewSettings(s, tool, pick)   what the PREVIEW renders: crop / geometry are bypassed while a
//                                 tool edits the uncropped (or uncorrected) frame
//   previewSize(s, w, h)          canvas size for a preview of view settings s on a w×h proxy

export const TOOLS = [
  ['edit', 'Edit', SlidersHorizontal], ['crop', 'Crop', Crop], ['geometry', 'Geometry', Grid3x3], ['remove', 'Remove', Bandage],
  ['masking', 'Masking', Layers], ['presets', 'Presets', Sparkles], ['versions', 'Versions', History],
];

/** Settings the preview renders for the active tool (and active eyedropper). */
export function viewSettings(s, tool, pick) {
  const sourceFrame = tool === 'remove' || tool === 'masking' || !!pick || (tool === 'geometry' && s.geometry?.upright === 'guided');
  const noCrop = sourceFrame || tool === 'crop' || tool === 'geometry';
  if (!noCrop) return s;
  return { ...s, bypass: { ...(s.bypass || {}), crop: true, ...(sourceFrame ? { geometry: true } : {}) } };
}
/** Output size of the develop result for view settings `s` on a w×h input. */
export function previewSize(s, w, h) {
  if (s.bypass?.crop || !s.crop || isCropIdentity(s.crop)) return [w, h];
  const r = cropSettingsToRect(s.crop, w, h); return [r.outW, r.outH];
}

/** Absolutely positioned box that exactly covers `canvasRef` (render it inside the canvas' positioned container). */
export function CanvasBox({ canvasRef, children, className = '' }) {
  const el = useRef(), [box, setBox] = useState(null);
  useLayoutEffect(() => {
    const measure = () => {
      const c = canvasRef.current, me = el.current, par = me?.offsetParent; if (!c || !par) return;
      const a = c.getBoundingClientRect(), p = par.getBoundingClientRect();
      const b = { left: a.left - p.left - par.clientLeft + par.scrollLeft, top: a.top - p.top - par.clientTop + par.scrollTop, width: a.width, height: a.height };
      setBox(o => o && Math.abs(o.left - b.left) < 0.5 && Math.abs(o.top - b.top) < 0.5 && Math.abs(o.width - b.width) < 0.5 && Math.abs(o.height - b.height) < 0.5 ? o : b);
    };
    measure();
    const ro = new ResizeObserver(measure); if (canvasRef.current) ro.observe(canvasRef.current);
    window.addEventListener('resize', measure); const iv = setInterval(measure, 300);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); clearInterval(iv); };
  }, []);
  return <div ref={el} className={'ctBox ' + className} style={box ? { left: box.left, top: box.top, width: box.width, height: box.height } : { left: 0, top: 0, width: 0, height: 0, visibility: 'hidden' }}
    onClick={e => e.stopPropagation()}>{box && box.width > 0 && children}</div>;
}

export function ToolRail({ ct }) {
  return <nav className="ctRail" aria-label="Edit tools">{TOOLS.map(([id, label, Icon]) => {
    const on = ct.tool === id, dot = (id === 'masking' && ct.counts.masks) || (id === 'remove' && ct.counts.spots) || (id === 'crop' && ct.counts.crop) || (id === 'geometry' && ct.counts.geometry);
    return <button key={id} className={'ctTool' + (on ? ' on' : '')} aria-label={label + ' tool'} aria-pressed={on} title={label} onClick={() => ct.setTool(id)}>
      <Icon size={18} strokeWidth={1.7} /><span>{label}</span>{dot ? <i className="ctDot" aria-hidden="true" /> : null}</button>;
  })}</nav>;
}

// Preset thumbnails: each preset rendered on a ~112 px copy of the photo (main thread, cached by id).
function usePresetThumbs(getSource, presets, category) {
  const [thumbs, setThumbs] = useState({}); const tiny = useRef(null), done = useRef({});
  useEffect(() => {
    const src = getSource?.(); if (!src) return;
    if (!tiny.current || tiny.current.from !== src) { const k = Math.min(1, 112 / Math.max(src.w, src.h)); tiny.current = { from: src, buf: k < 1 ? resample(src, Math.max(1, Math.round(src.w * k)), Math.max(1, Math.round(src.h * k)), 'bilinear') : src }; done.current = {}; setThumbs({}); }
    const todo = presets.filter(p => (!category || p.category === category || (category === 'User presets' && !p.builtin)) && !done.current[p.id]);
    let i = 0, alive = true;
    const step = () => { if (!alive) return; const t0 = performance.now(); const out = {};
      while (i < todo.length && performance.now() - t0 < 24) { const p = todo[i++]; done.current[p.id] = true;
        try { const b = tiny.current.buf, r = develop({ w: b.w, h: b.h, data: new Uint8ClampedArray(b.data) }, applyPreset(developDefaults(), p), { scale: b.w / 1600 }); const c = document.createElement('canvas'); c.width = r.w; c.height = r.h; c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(r.data), r.w, r.h), 0, 0); out[p.id] = c.toDataURL('image/jpeg', 0.8); } catch { /* skip */ } }
      if (Object.keys(out).length) setThumbs(t => ({ ...t, ...out })); if (i < todo.length) setTimeout(step, 16); };
    step(); return () => { alive = false; };
  }, [presets, category, getSource]);
  return thumbs;
}

function PresetsPanel({ presets, active, amount, onApply, onAmount, onSave, onDelete, getSource }) {
  const [saving, setSaving] = useState(false), [name, setName] = useState(''), [panels, setPanels] = useState(() => [...DEFAULT_SYNC_PANELS]);
  const cats = [...new Set(presets.filter(p => p.builtin).map(p => p.category || 'Built-in')), 'User presets'];
  const [cat, setCat] = useState(cats[0]), [q, setQ] = useState('');
  const list = presets.filter(p => q ? p.name.toLowerCase().includes(q.toLowerCase()) : cat === 'User presets' ? !p.builtin : (p.category || 'Built-in') === cat && p.builtin);
  const thumbs = usePresetThumbs(getSource, presets, q ? null : cat);
  return <div className="ctPanel" aria-label="Presets">
    {active && <div className="ctAmount"><Slider label={'Amount · ' + active.name} aria="Preset amount" value={amount} min={0} max={200} def={100} onChange={onAmount} /></div>}
    <input className="ctSearch" type="search" aria-label="Search presets" placeholder="Search presets" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.stopPropagation()} />
    {!q && <div className="ctCats" role="tablist" aria-label="Preset categories">{cats.map(c => <button key={c} role="tab" aria-selected={cat === c} className={cat === c ? 'on' : ''} onClick={() => setCat(c)}>{c}</button>)}</div>}
    {!list.length && <p className="d2Note">{cat === 'User presets' && !q ? 'No user presets yet — save the current settings below.' : 'No presets match.'}</p>}
    <div className="ctGrid">{list.map(p => <div key={p.id} className={'ctTile' + (active?.id === p.id ? ' on' : '')}>
      <button className="ctTileBtn" aria-label={'Apply preset ' + p.name} aria-pressed={active?.id === p.id} title={(p.category ? p.category + ' · ' : '') + p.name} onClick={() => onApply(p)}>
        <span className="ctThumb">{thumbs[p.id] ? <img src={thumbs[p.id]} alt="" /> : <span className="ctThumbWait" />}</span><span className="ctTileName">{p.name}</span></button>
      {!p.builtin && <button className="d2Icon ctTileDel" aria-label={'Delete preset ' + p.name} title="Delete preset" onClick={() => onDelete(p.id)}><Trash2 size={12} /></button>}
    </div>)}</div>
    {!saving ? <button className="d2Wide" onClick={() => { setSaving(true); setName(''); }}>Save Preset…</button>
      : <form className="ctSave" aria-label="Save preset" onSubmit={e => { e.preventDefault(); if (!panels.length) return; onSave(name.trim() || 'User Preset', panels); setSaving(false); setCat('User presets'); }}>
        <label className="ctField"><span>Preset name</span><input aria-label="Preset name" value={name} autoFocus onChange={e => setName(e.target.value)} onKeyDown={e => e.stopPropagation()} /></label>
        <div className="ctChecks">{Object.entries(PANELS).map(([k, p]) => <label key={k} className="optCheck"><input type="checkbox" aria-label={'Include ' + p.name} checked={panels.includes(k)} onChange={e => setPanels(v => e.target.checked ? [...v, k] : v.filter(x => x !== k))} />{p.name}</label>)}</div>
        <div className="d2Buttons"><button type="button" onClick={() => setSaving(false)}>Cancel</button><button type="submit" disabled={!panels.length}>Save</button></div>
      </form>}
  </div>;
}

function VersionsPanel({ versions, onCreate, onApply, onRename, onDelete }) {
  const [name, setName] = useState(''), [ren, setRen] = useState(null);
  return <div className="ctPanel" aria-label="Versions">
    <form className="ctSave" onSubmit={e => { e.preventDefault(); onCreate(name.trim() || 'Version ' + (versions.length + 1)); setName(''); }}>
      <label className="ctField"><span>Version name</span><input aria-label="Version name" placeholder={'Version ' + (versions.length + 1)} value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.stopPropagation()} /></label>
      <button type="submit" className="d2Wide">Create Version</button></form>
    <p className="d2Note">A version is a named copy of all current settings. Click one to go back to it.</p>
    <div className="ctList" role="list" aria-label="Version list">{versions.map((v, i) => <div key={i} role="listitem" className="ctRow">
      {ren === i ? <input className="ctRename" aria-label="Rename version" autoFocus defaultValue={v.name} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setRen(null); }} onBlur={e => { if (e.target.value.trim() && e.target.value.trim() !== v.name) onRename(i, e.target.value.trim()); setRen(null); }} />
        : <button className="ctItem" aria-label={'Apply version ' + v.name} onClick={() => onApply(i)} onDoubleClick={() => setRen(i)}>{v.name}</button>}
      <button className="d2Icon" aria-label={'Rename version ' + v.name} title="Rename" onClick={() => setRen(i)}><Pencil size={12} /></button>
      <button className="d2Icon" aria-label={'Delete version ' + v.name} title="Delete" onClick={() => onDelete(i)}><Trash2 size={12} /></button>
    </div>)}
      {!versions.length && <p className="d2Note">No versions yet.</p>}</div>
  </div>;
}

const sid = () => 's' + Math.random().toString(36).slice(2, 9);

export function useDevelopTools({ s, replace, getSource, mk, presets = [], savePreset, deletePreset, versions = [], createVersion, applyVersion, renameVersion, deleteVersion, imageSize }) {
  const [tool, setToolState] = useState('edit');
  const [spotTool, setSpotTool] = useState('heal'), [brush, setBrush] = useState({ size: SPOT_DEFAULTS.size, feather: SPOT_DEFAULTS.feather, opacity: SPOT_DEFAULTS.opacity });
  const [showSpots, setShowSpots] = useState(true), [selSpot, setSelSpot] = useState(null);
  const [preset, setPreset] = useState(null); // { p, base, amount }
  const sRef = useRef(s); sRef.current = s;
  const setTool = t => { setToolState(t); mk?.setOn(t === 'masking'); if (t !== 'presets') setPreset(null); };
  const src = getSource?.();
  // crop maths in full-resolution pixels when the host knows them (the panel then shows the real output size)
  const W = imageSize?.[0] || src?.w || 1, H = imageSize?.[1] || src?.h || 1;
  const crop = { ...CROP_DEFAULTS, ...(s.crop || {}) }, geo = { ...GEOMETRY_DEFAULTS, guides: [], ...(s.geometry || {}) }, spots = s.spots || [];
  const put = (patch, label) => replace({ ...sRef.current, ...patch }, label);

  const setGeometry = g => {
    const prev = { ...GEOMETRY_DEFAULTS, ...(sRef.current.geometry || {}) };
    if (g.upright === 'guided' && JSON.stringify(g.guides) !== JSON.stringify(prev.guides) && src) g = { ...g, uprightCorrection: (g.guides || []).length >= 2 ? uprightFor(src, 'guided', g.guides) : null };
    put({ geometry: g }, 'Geometry');
  };
  const onUpright = mode => {
    const g = { ...GEOMETRY_DEFAULTS, guides: [], ...(sRef.current.geometry || {}) };
    const corr = mode === 'off' || !src ? null : mode === 'guided' ? ((g.guides || []).length >= 2 ? uprightFor(src, 'guided', g.guides) : null) : uprightFor(src, mode, []);
    put({ geometry: { ...g, upright: mode, uprightCorrection: corr } }, 'Upright ' + mode);
  };
  const addStroke = points => {
    const spot = { id: sid(), mode: spotTool, points, size: brush.size, feather: brush.feather, opacity: brush.opacity, source: null };
    if (src) { try { spot.source = findSpotSource(src, spotMask(spot, src.w, src.h).hard); } catch { spot.source = null; } }
    put({ spots: [...(sRef.current.spots || []), spot] }, spotTool === 'remove' ? 'Remove' : spotTool === 'heal' ? 'Heal' : 'Clone');
    setSelSpot(spot.id);
  };
  const applyPresetAt = (p, base, amount) => replace(blend(base, p, amount), 'Preset: ' + p.name);

  let panel = null;
  if (tool === 'crop') panel = <CropPanel crop={crop} imageW={W} imageH={H} onChange={c => put({ crop: c }, 'Crop')} onAuto={() => { if (src) put({ crop: straightenCrop(crop, autoStraightenAngle(src), W, H) }, 'Auto Straighten'); }} />;
  else if (tool === 'geometry') panel = <GeometryPanel geometry={geo} onChange={setGeometry} onUpright={onUpright} />;
  else if (tool === 'remove') panel = <RemovePanel tool={spotTool} setTool={setSpotTool} brush={brush} setBrush={setBrush} spots={spots} showOverlay={showSpots} setShowOverlay={setShowSpots}
    onDeleteSpot={id => put({ spots: spots.filter((x, i) => (x.id ?? i) !== id) }, 'Delete Spot')} />;
  else if (tool === 'presets') panel = <PresetsPanel getSource={getSource} presets={presets} active={preset?.p} amount={preset?.amount ?? 100}
    onApply={p => { const base = preset ? preset.base : sRef.current; setPreset({ p, base, amount: 100 }); applyPresetAt(p, base, 100); }}
    onAmount={v => { if (!preset) return; setPreset({ ...preset, amount: v }); applyPresetAt(preset.p, preset.base, v); }}
    onSave={(name, panels) => savePreset?.(name, panels)} onDelete={id => deletePreset?.(id)} />;
  else if (tool === 'versions') panel = <VersionsPanel versions={versions} onCreate={n => createVersion?.(n)} onApply={i => applyVersion?.(i)} onRename={(i, n) => renameVersion?.(i, n)} onDelete={i => deleteVersion?.(i)} />;

  const overlay = canvasRef => {
    if (!src) return null;
    if (tool === 'crop') return <CanvasBox canvasRef={canvasRef}><CropOverlay crop={crop} imageW={W} imageH={H} onChange={c => put({ crop: c }, 'Crop')} /></CanvasBox>;
    if (tool === 'geometry' && geo.upright === 'guided') return <CanvasBox canvasRef={canvasRef}><GuidedOverlay guides={geo.guides || []} onChange={guides => setGeometry({ ...geo, guides })} /></CanvasBox>;
    if (tool === 'remove') return <CanvasBox canvasRef={canvasRef}><SpotsOverlay spots={spots.map((x, i) => ({ ...x, id: x.id ?? 'i' + i }))} selectedId={selSpot} onSelect={setSelSpot} tool={spotTool} brush={brush} visible={showSpots}
      onMoveSource={(id, source) => put({ spots: (sRef.current.spots || []).map((x, i) => (x.id ?? 'i' + i) === id ? { ...x, source } : x) }, 'Move Spot Source')} onAddStroke={addStroke} /></CanvasBox>;
    return null;
  };
  const counts = { masks: (s.masks || []).filter(m => m.enabled !== false).length, spots: spots.length, crop: !isCropIdentity(crop), geometry: geo.upright !== 'off' || ['vertical', 'horizontal', 'rotate', 'aspect', 'offsetX', 'offsetY'].some(k => geo[k]) || geo.scale !== 100 };
  return { tool, setTool, panel, overlay, counts };
}
