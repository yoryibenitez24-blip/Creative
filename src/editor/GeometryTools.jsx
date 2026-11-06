import React, { useEffect, useRef, useState } from 'react';
import { ASPECT_PRESETS, CROP_DEFAULTS, GEOMETRY_DEFAULTS, SPOT_DEFAULTS, cropAspectRatio, cropSettingsToRect, cropInside, fitCropToAngle, applyAspectToCrop, pointColorSwatch } from '../engine/develop2.js';
import { hslToRgb } from '../engine/color.js';
import { Lock, LockOpen, Ratio, RotateCcw, RotateCw, FlipHorizontal2, FlipVertical2, Pipette, X } from 'lucide-react';

// Lightroom-style edit tools for the Camera Raw / Develop workspace (engine: src/engine/develop2.js).
// Every widget is controlled: it renders its value and reports edits through onChange-style
// callbacks; nothing is stored here except transient drag state. Overlays (CropOverlay,
// GuidedOverlay, SpotsOverlay) are absolutely positioned SVGs that fill their parent, so mount them
// in a positioned box that exactly covers the preview canvas. All coordinates are fractions of
// the image (0..1), so the same settings work on the proxy and at full resolution.
// Styles: dist/css/develop2.css (+ crs*/segmented/optCheck from style.css / modern.css).

// ---------------- shared bits ----------------
const fillVars = (v, o, min, max) => { const p = x => (Math.min(max, Math.max(min, x)) - min) / (max - min) * 100; const a = p(v), b = p(o); return { '--plo': Math.min(a, b) / 100, '--phi': Math.max(a, b) / 100 }; };

/** Ring-thumb slider: label + numeric value row, range below, double-click resets (as in DevelopPanels). */
export function Slider({ label, aria = label, value, min, max, step = 1, onChange, def = 0, gradient, disabled }) {
  const fmt = v => step < 1 ? (+v).toFixed(step < 0.1 ? 2 : 1) : Math.round(v);
  return <div className="crsSlider" onDoubleClick={() => !disabled && onChange(def)} title="Double-click to reset">
    <div className="crsRow"><span>{label}</span><input type="number" aria-label={aria + ' value'} disabled={disabled} min={min} max={max} step={step} value={fmt(value)} onChange={e => { const v = +e.target.value; if (Number.isFinite(v)) onChange(Math.max(min, Math.min(max, v))); }} /></div>
    <input type="range" aria-label={aria} disabled={disabled} min={min} max={max} step={step} value={value} onChange={e => onChange(+e.target.value)} style={gradient ? { background: gradient } : fillVars(value, def, min, max)} />
  </div>;
}

/** Size of an element in CSS px, kept current with a ResizeObserver. */
function useBox(ref) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const read = () => { const r = el.getBoundingClientRect(); setBox(b => b.w === r.width && b.h === r.height ? b : { w: r.width, h: r.height }); };
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read); ro.observe(el); return () => ro.disconnect();
  }, []);
  return box;
}
/** Pointer position as fractions (0..1) of the element's box. */
const fracOf = (el, e) => { const r = el.getBoundingClientRect(); return [(e.clientX - r.left) / (r.width || 1), (e.clientY - r.top) / (r.height || 1)]; };
const rot = (x, y, deg, cx, cy) => { const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), dx = x - cx, dy = y - cy; return [cx + dx * c - dy * s, cy + dx * s + dy * c]; };

// =====================================================================================
// Crop
// =====================================================================================

/** Change the straighten angle; a maximal crop stays maximal, any other crop shrinks only as needed. */
export function straightenCrop(crop, angle, W, H, presets = ASPECT_PRESETS) {
  const c = { ...CROP_DEFAULTS, ...crop }, ratio = cropAspectRatio(c, W, H, presets) ?? (c.w * W) / (c.h * H);
  const maxed = fitCropToAngle(applyAspectToCrop(c, ratio, W, H), W, H);
  const wasMax = Math.abs(maxed.w - c.w) < 2e-3 && Math.abs(maxed.h - c.h) < 2e-3;
  const next = { ...c, angle: Math.max(-45, Math.min(45, angle)) };
  return wasMax ? fitCropToAngle(applyAspectToCrop(next, ratio, W, H), W, H) : fitCropToAngle(next, W, H);
}

/** Largest t in [0,1] for which lerp(a, b, t) still lies inside the image. */
function constrainLerp(a, b, W, H) {
  const at = t => ({ ...b, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, w: a.w + (b.w - a.w) * t, h: a.h + (b.h - a.h) * t });
  if (cropInside(b, W, H)) return b;
  if (!cropInside(a, W, H)) return fitCropToAngle(b, W, H);
  let lo = 0, hi = 1; for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (cropInside(at(m), W, H)) lo = m; else hi = m; }
  return at(lo);
}

/** Move the crop by (dx, dy) fractions, sliding along the image edges instead of sticking to them. */
const moveCrop = (c, dx, dy, W, H) => { const a = constrainLerp(c, { ...c, x: c.x + dx }, W, H); return constrainLerp(a, { ...a, y: a.y + dy }, W, H); };

const HANDLES = [['nw', 'top-left', 0, 0], ['n', 'top', 0.5, 0], ['ne', 'top-right', 1, 0], ['e', 'right', 1, 0.5], ['se', 'bottom-right', 1, 1], ['s', 'bottom', 0.5, 1], ['sw', 'bottom-left', 0, 1], ['w', 'left', 0, 0.5]];

/** Resize the crop rect (straightened-frame pixels) by moving handle `k` to (qx, qy). */
function resizeRect(r0, k, qx, qy, ratio, minPx) {
  let { x0, y0, x1, y1 } = r0;
  if (k.includes('w')) x0 = Math.min(qx, x1 - minPx); if (k.includes('e')) x1 = Math.max(qx, x0 + minPx);
  if (k.includes('n')) y0 = Math.min(qy, y1 - minPx); if (k.includes('s')) y1 = Math.max(qy, y0 + minPx);
  if (ratio) {
    let w = x1 - x0, h = y1 - y0;
    if (k.length === 2) { // corner: dominant axis wins, opposite corner anchored
      if (w / h > ratio) h = w / ratio; else w = h * ratio;
      if (k.includes('w')) x0 = x1 - w; else x1 = x0 + w;
      if (k.includes('n')) y0 = y1 - h; else y1 = y0 + h;
    } else if (k === 'e' || k === 'w') { h = w / ratio; const cy = (r0.y0 + r0.y1) / 2; y0 = cy - h / 2; y1 = cy + h / 2; }
    else { w = h * ratio; const cx = (r0.x0 + r0.x1) / 2; x0 = cx - w / 2; x1 = cx + w / 2; }
  }
  return { x0, y0, x1, y1 };
}

/**
 * Crop box over the (un-straightened, un-flipped) preview. The box is drawn rotated by −angle, the
 * way the straightened frame sits on the source. Drag inside to move, handles to resize (aspect
 * lock honoured), outside the box to straighten. Handles are focusable: arrow keys nudge them by
 * 0.5 % (Shift: 5 %).
 * Props: crop (develop settings.crop), onChange(crop), aspect (w/h number to force, null = free;
 * omit to use the crop's own preset/lock), imageW, imageH (image size in px, any scale).
 */
export function CropOverlay({ crop, onChange, aspect, imageW, imageH }) {
  const ref = useRef(null), box = useBox(ref), drag = useRef(null);
  const c = { ...CROP_DEFAULTS, ...crop }, W = imageW || 1, H = imageH || 1;
  const ratio = aspect !== undefined ? aspect : cropAspectRatio(c, W, H);
  const kx = box.w / W, ky = box.h / H;
  const corners = cropSettingsToRect(c, W, H).corners.map(([x, y]) => [x * kx, y * ky]);
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const toQ = e => { const [fx, fy] = fracOf(ref.current, e); return rot(fx * W, fy * H, c.angle, W / 2, H / 2); };   // straightened-frame px
  const rectOf = cc => ({ x0: cc.x * W, y0: cc.y * H, x1: (cc.x + cc.w) * W, y1: (cc.y + cc.h) * H });
  const fromRect = (cc, r) => ({ ...cc, x: r.x0 / W, y: r.y0 / H, w: (r.x1 - r.x0) / W, h: (r.y1 - r.y0) / H });
  const minPx = Math.min(W, H) * 0.03;

  const start = (kind, e) => {
    e.stopPropagation(); e.preventDefault();
    ref.current.setPointerCapture?.(e.pointerId);
    const q = toQ(e), cx = (c.x + c.w / 2) * W, cy = (c.y + c.h / 2) * H, [sx, sy] = fracOf(ref.current, e);
    const centre = rot(cx, cy, -c.angle, W / 2, H / 2);
    drag.current = { kind, c0: c, q0: q, a0: Math.atan2(sy * H - centre[1], sx * W - centre[0]), centre };
  };
  const move = e => {
    const d = drag.current; if (!d) return;
    const { c0 } = d;
    if (d.kind === 'rotate') {
      const [sx, sy] = fracOf(ref.current, e), a = Math.atan2(sy * H - d.centre[1], sx * W - d.centre[0]);
      const delta = (a - d.a0) * 180 / Math.PI, ang = Math.round(Math.max(-45, Math.min(45, c0.angle - delta)) * 10) / 10;
      onChange(straightenCrop(c0, ang, W, H)); return;
    }
    // positions in the frame of the drag start (the angle does not change while moving/resizing)
    const [fx, fy] = fracOf(ref.current, e), [qx, qy] = rot(fx * W, fy * H, c0.angle, W / 2, H / 2);
    if (d.kind === 'move') { onChange(moveCrop(c0, (qx - d.q0[0]) / W, (qy - d.q0[1]) / H, W, H)); return; }
    const r = resizeRect(rectOf(c0), d.kind, qx, qy, ratio, minPx);
    onChange(constrainLerp(c0, fromRect(c0, r), W, H));
  };
  const end = () => { drag.current = null; };
  const nudge = (k, e) => {
    const step = (e.shiftKey ? 0.05 : 0.005) * Math.max(W, H), dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!dir) return; e.preventDefault();
    const r0 = rectOf(c), dx = dir[0] * step, dy = dir[1] * step;
    if (k === 'move') { onChange(moveCrop(c, dx / W, dy / H, W, H)); return; }
    const px = k.includes('w') ? r0.x0 : k.includes('e') ? r0.x1 : (r0.x0 + r0.x1) / 2, py = k.includes('n') ? r0.y0 : k.includes('s') ? r0.y1 : (r0.y0 + r0.y1) / 2;
    onChange(constrainLerp(c, fromRect(c, resizeRect(r0, k, px + dx, py + dy, ratio, minPx)), W, H));
  };
  const poly = corners.map(p => p.join(',')).join(' ');
  const grid = [1 / 3, 2 / 3].flatMap(t => [[lerp(corners[0], corners[1], t), lerp(corners[3], corners[2], t)], [lerp(corners[0], corners[3], t), lerp(corners[1], corners[2], t)]]);
  const hs = 9;
  return <svg ref={ref} className="d2Overlay d2Crop" role="group" aria-label="Crop overlay" viewBox={`0 0 ${box.w || 1} ${box.h || 1}`} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
    <path className="d2CropShade" fillRule="evenodd" d={`M0 0H${box.w}V${box.h}H0Z M${poly.replace(/ /g, ' L')}Z`} aria-label="Rotate crop" role="button" tabIndex={-1} onPointerDown={e => start('rotate', e)} />
    <polygon className="d2CropBox" points={poly} role="button" aria-label="Move crop" tabIndex={0} onPointerDown={e => start('move', e)} onKeyDown={e => nudge('move', e)} />
    {grid.map(([a, b], i) => <line key={i} className="d2CropGrid" x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />)}
    {HANDLES.map(([k, name, u, v]) => { const top = lerp(corners[0], corners[1], u), bot = lerp(corners[3], corners[2], u), [x, y] = lerp(top, bot, v); return <rect key={k} className={'d2Handle d2H-' + k} x={x - hs / 2} y={y - hs / 2} width={hs} height={hs} role="button" tabIndex={0} aria-label={'Crop handle ' + name} transform={`rotate(${-c.angle} ${x} ${y})`} onPointerDown={e => start(k, e)} onKeyDown={e => nudge(k, e)} />; })}
  </svg>;
}

/**
 * Crop & Straighten panel. Props: crop, onChange(crop), onAuto() (the host computes
 * autoStraightenAngle(preview) and calls onChange(straightenCrop(crop, angle, W, H))),
 * aspects (default ASPECT_PRESETS), imageW, imageH (source size, any scale; needed for aspect fits).
 */
export function CropPanel({ crop, onChange, onAuto, aspects = ASPECT_PRESETS, imageW = 1, imageH = 1 }) {
  const c = { ...CROP_DEFAULTS, ...crop }, W = imageW, H = imageH;
  const preset = aspects.find(p => p.id === c.aspect) || aspects[0], ratio = cropAspectRatio(c, W, H, aspects);
  const setAspect = (patch) => { const n = { ...c, ...patch }, r = cropAspectRatio(n, W, H, aspects); onChange(r ? applyAspectToCrop(n, r, W, H) : n); };
  return <div className="d2Panel d2CropPanel">
    <div className="crsRow d2Row"><span>Aspect</span>
      <select aria-label="Aspect ratio" value={preset.id} onChange={e => setAspect({ aspect: e.target.value, lockAspect: e.target.value !== 'custom' })}>{aspects.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
      <button className={'d2Icon' + (c.lockAspect && preset.ratio != null ? ' on' : '')} aria-pressed={!!(c.lockAspect && preset.ratio != null)} aria-label="Lock aspect ratio" title="Lock aspect ratio" disabled={preset.ratio == null} onClick={() => setAspect({ lockAspect: !c.lockAspect })}>{c.lockAspect && preset.ratio != null ? <Lock size={14} /> : <LockOpen size={14} />}</button>
      <button className="d2Icon" aria-label="Swap aspect orientation" title="Swap orientation (portrait / landscape)" disabled={!ratio || Math.abs(ratio - 1) < 1e-6} onClick={() => setAspect({ aspectSwap: !c.aspectSwap })}><Ratio size={14} /></button>
    </div>
    <Slider label="Straighten" value={c.angle} min={-45} max={45} step={0.1} onChange={v => onChange(straightenCrop(c, v, W, H, aspects))} />
    <div className="d2Buttons">
      <button aria-label="Auto straighten" onClick={onAuto}>Auto</button>
      <button aria-label="Rotate left 90°" title="Rotate 90° counter-clockwise" onClick={() => onChange({ ...c, rotate90: ((c.rotate90 | 0) + 3) % 4 })}><RotateCcw size={14} /></button>
      <button aria-label="Rotate right 90°" title="Rotate 90° clockwise" onClick={() => onChange({ ...c, rotate90: ((c.rotate90 | 0) + 1) % 4 })}><RotateCw size={14} /></button>
      <button aria-label="Flip horizontal" aria-pressed={!!c.flipH} className={c.flipH ? 'on' : ''} onClick={() => onChange({ ...c, flipH: !c.flipH })}><FlipHorizontal2 size={14} /></button>
      <button aria-label="Flip vertical" aria-pressed={!!c.flipV} className={c.flipV ? 'on' : ''} onClick={() => onChange({ ...c, flipV: !c.flipV })}><FlipVertical2 size={14} /></button>
      <button aria-label="Reset crop" onClick={() => onChange({ ...CROP_DEFAULTS })}>Reset</button>
    </div>
    <div className="d2Note" aria-live="polite">{Math.round(c.w * W)} × {Math.round(c.h * H)} px{c.rotate90 % 2 ? ' (turned)' : ''}</div>
  </div>;
}

// =====================================================================================
// Geometry (Upright + manual transform)
// =====================================================================================
const UPRIGHT = [['off', 'Off'], ['auto', 'Auto'], ['guided', 'Guided'], ['level', 'Level'], ['vertical', 'Vertical'], ['full', 'Full']];

/**
 * Geometry panel. Props: geometry (settings.geometry), onChange(geometry), onUpright(mode) — the
 * host solves the correction (uprightFor(preview, mode, guides)) and stores
 * { upright: mode, uprightCorrection } in the geometry. Guided mode is solved from geometry.guides.
 */
export function GeometryPanel({ geometry, onChange, onUpright }) {
  const g = { ...GEOMETRY_DEFAULTS, ...geometry }, set = patch => onChange({ ...g, ...patch });
  const nGuides = (g.guides || []).length;
  return <div className="d2Panel d2GeometryPanel">
    <div className="d2Label">Upright</div>
    <div className="segmented d2Upright" role="group" aria-label="Upright mode">{UPRIGHT.map(([m, l]) => <button key={m} aria-label={'Upright ' + l} aria-pressed={g.upright === m} className={g.upright === m ? 'on' : ''} onClick={() => onUpright(m)}>{l}</button>)}</div>
    {g.upright === 'guided' && <div className="d2Note">{nGuides < 2 ? 'Draw 2 to 4 guides along lines that should be vertical or horizontal.' : `${nGuides} guide${nGuides > 1 ? 's' : ''} — drag the ends to refine.`}
      {nGuides > 0 && <button className="d2Link" aria-label="Clear guides" onClick={() => set({ guides: [] })}>Clear</button>}</div>}
    {g.upright !== 'off' && g.uprightCorrection && <div className="d2Note">Correction: {g.uprightCorrection.rotate.toFixed(1)}°, vertical {Math.round(g.uprightCorrection.vertical)}, horizontal {Math.round(g.uprightCorrection.horizontal)}</div>}
    <div className="d2Label">Manual transforms</div>
    <Slider label="Vertical" aria="Vertical transform" value={g.vertical} min={-100} max={100} onChange={v => set({ vertical: v })} />
    <Slider label="Horizontal" aria="Horizontal transform" value={g.horizontal} min={-100} max={100} onChange={v => set({ horizontal: v })} />
    <Slider label="Rotate" aria="Rotate transform" value={g.rotate} min={-10} max={10} step={0.1} onChange={v => set({ rotate: v })} />
    <Slider label="Aspect" aria="Aspect transform" value={g.aspect} min={-100} max={100} onChange={v => set({ aspect: v })} />
    <Slider label="Scale" aria="Scale transform" value={g.scale} min={50} max={150} def={100} onChange={v => set({ scale: v })} />
    <Slider label="Offset X" value={g.offsetX} min={-100} max={100} step={0.1} onChange={v => set({ offsetX: v })} />
    <Slider label="Offset Y" value={g.offsetY} min={-100} max={100} step={0.1} onChange={v => set({ offsetY: v })} />
    <label className="optCheck"><input type="checkbox" aria-label="Constrain crop" checked={!!g.constrainCrop} onChange={e => set({ constrainCrop: e.target.checked })} />Constrain crop</label>
    <button className="d2Wide" aria-label="Reset geometry" onClick={() => onChange({ ...GEOMETRY_DEFAULTS, guides: [] })}>Reset geometry</button>
  </div>;
}

/**
 * Guided Upright: drag on the image to draw a guide (up to 4); drag an end point to adjust it;
 * double-click a guide or press Delete on it to remove it. guides: [[x0, y0, x1, y1] fractions].
 * Draw on the uncorrected image (or map the guides back with the inverse geometry matrix).
 */
export function GuidedOverlay({ guides = [], onChange, max = 4 }) {
  const ref = useRef(null), box = useBox(ref), drag = useRef(null), [draft, setDraft] = useState(null);
  const P = ([x, y]) => [x * box.w, y * box.h];
  const down = e => {
    if (guides.length >= max) return;
    ref.current.setPointerCapture?.(e.pointerId);
    const p = fracOf(ref.current, e); drag.current = { kind: 'new', p0: p }; setDraft([...p, ...p]);
  };
  const grab = (i, end, e) => { e.stopPropagation(); ref.current.setPointerCapture?.(e.pointerId); drag.current = { kind: 'end', i, end }; };
  const move = e => {
    const d = drag.current; if (!d) return;
    const [x, y] = fracOf(ref.current, e).map(v => Math.max(0, Math.min(1, v)));
    if (d.kind === 'new') setDraft([d.p0[0], d.p0[1], x, y]);
    else onChange(guides.map((g, k) => k !== d.i ? g : d.end ? [g[0], g[1], x, y] : [x, y, g[2], g[3]]));
  };
  const up = () => {
    const d = drag.current; drag.current = null;
    if (d?.kind === 'new' && draft) { const len = Math.hypot((draft[2] - draft[0]) * box.w, (draft[3] - draft[1]) * box.h); if (len > 12) onChange([...guides, draft.map(v => Math.round(v * 1e5) / 1e5)]); }
    setDraft(null);
  };
  const remove = i => onChange(guides.filter((_, k) => k !== i));
  return <svg ref={ref} className="d2Overlay d2Guided" role="group" aria-label="Guided Upright overlay" viewBox={`0 0 ${box.w || 1} ${box.h || 1}`} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
    {guides.map((g, i) => { const [a, b] = [P([g[0], g[1]]), P([g[2], g[3]])], vert = Math.abs(b[1] - a[1]) > Math.abs(b[0] - a[0]); return <g key={i} className={'d2Guide ' + (vert ? 'v' : 'h')}>
      <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} role="button" tabIndex={0} aria-label={`Guide ${i + 1}`} onDoubleClick={e => { e.stopPropagation(); remove(i); }} onPointerDown={e => e.stopPropagation()} onKeyDown={e => { if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(i); } }} />
      <circle cx={a[0]} cy={a[1]} r={5} aria-label={`Guide ${i + 1} start`} role="button" onPointerDown={e => grab(i, 0, e)} />
      <circle cx={b[0]} cy={b[1]} r={5} aria-label={`Guide ${i + 1} end`} role="button" onPointerDown={e => grab(i, 1, e)} />
    </g>; })}
    {draft && <line className="d2GuideDraft" x1={draft[0] * box.w} y1={draft[1] * box.h} x2={draft[2] * box.w} y2={draft[3] * box.h} />}
  </svg>;
}

// =====================================================================================
// Remove / Heal / Clone
// =====================================================================================
const MODES = [['remove', 'Remove'], ['heal', 'Heal'], ['clone', 'Clone']];

/**
 * Remove tool panel. Props: tool ('remove'|'heal'|'clone'), setTool, brush { size (fraction of the
 * long side), feather 0..100, opacity 0..100 }, setBrush(brush), spots, onDeleteSpot(id),
 * showOverlay, setShowOverlay(bool). New strokes use the current tool + brush (see SpotsOverlay).
 */
export function RemovePanel({ tool, setTool, brush, setBrush, spots = [], onDeleteSpot, showOverlay, setShowOverlay }) {
  const b = { size: SPOT_DEFAULTS.size, feather: SPOT_DEFAULTS.feather, opacity: SPOT_DEFAULTS.opacity, ...brush };
  return <div className="d2Panel d2RemovePanel">
    <div className="segmented" role="group" aria-label="Remove tool mode">{MODES.map(([m, l]) => <button key={m} aria-label={l + ' mode'} aria-pressed={tool === m} className={tool === m ? 'on' : ''} onClick={() => setTool(m)}>{l}</button>)}</div>
    <div className="d2Note">{tool === 'remove' ? 'Paint over the distraction; it is rebuilt from its surroundings.' : tool === 'heal' ? 'Paint over the spot; texture comes from a matching area, colour from the surroundings.' : 'Paint over the area; it is copied exactly from the source.'} Drag a spot's source to change it.</div>
    <Slider label="Size" aria="Brush size" value={Math.round(b.size * 1000) / 10} min={0.5} max={25} step={0.1} def={SPOT_DEFAULTS.size * 100} onChange={v => setBrush({ ...b, size: v / 100 })} />
    <Slider label="Feather" aria="Brush feather" value={b.feather} min={0} max={100} def={SPOT_DEFAULTS.feather} onChange={v => setBrush({ ...b, feather: v })} />
    <Slider label="Opacity" aria="Brush opacity" value={b.opacity} min={0} max={100} def={100} onChange={v => setBrush({ ...b, opacity: v })} />
    <label className="optCheck"><input type="checkbox" aria-label="Visualize spots" checked={!!showOverlay} onChange={e => setShowOverlay(e.target.checked)} />Visualize spots</label>
    {spots.length > 0 && <ul className="d2SpotList" aria-label="Spots">{spots.map((s, i) => <li key={s.id ?? i}><span>{i + 1}. {MODES.find(m => m[0] === s.mode)?.[1] || s.mode}</span><span className="d2Dim">{Math.round((s.size ?? 0) * 1000) / 10}%</span><button className="d2Icon" aria-label={`Delete spot ${i + 1}`} onClick={() => onDeleteSpot(s.id ?? i)}><X size={12} /></button></li>)}</ul>}
  </div>;
}

const spotPath = (pts, ox = 0, oy = 0) => pts.length <= 2 ? null : 'M' + pts.reduce((a, v, i) => (i % 2 ? a.push(`${pts[i - 1] + ox},${v + oy}`) : 0, a), []).join(' L');

/**
 * Spot painting + visualisation over the preview. Props: spots (each with an `id`), selectedId,
 * onSelect(id), onMoveSource(id, { dx, dy }) (fractions; called live while dragging),
 * onAddStroke(points) (fractions [x, y, …]; the host creates { id, mode: tool, points, ...brush,
 * source: findSpotSource or null }), brush { size, feather, opacity }, tool, visible (default true;
 * false hides the markers but still lets you paint).
 */
export function SpotsOverlay({ spots = [], selectedId, onSelect, onMoveSource, onAddStroke, brush = {}, tool = 'heal', visible = true }) {
  const ref = useRef(null), box = useBox(ref), drag = useRef(null), [stroke, setStroke] = useState(null), [hover, setHover] = useState(null);
  const L = Math.max(box.w, box.h), r = Math.max(2, (brush.size ?? SPOT_DEFAULTS.size) * L / 2);
  const down = e => {
    if (e.button !== undefined && e.button !== 0) return;
    ref.current.setPointerCapture?.(e.pointerId);
    const p = fracOf(ref.current, e); drag.current = { kind: 'paint' }; setStroke([p[0], p[1]]);
  };
  const grabSource = (s, e) => {
    e.stopPropagation(); ref.current.setPointerCapture?.(e.pointerId); onSelect?.(s.id);
    const p = fracOf(ref.current, e); drag.current = { kind: 'source', id: s.id, p0: p, s0: s.source || { dx: 0, dy: 0 } };
  };
  const move = e => {
    const p = fracOf(ref.current, e); setHover(p);
    const d = drag.current; if (!d) return;
    if (d.kind === 'paint') setStroke(st => { const lx = st[st.length - 2], ly = st[st.length - 1]; return Math.hypot((p[0] - lx) * box.w, (p[1] - ly) * box.h) > r * 0.3 ? [...st, p[0], p[1]] : st; });
    else onMoveSource(d.id, { dx: d.s0.dx + p[0] - d.p0[0], dy: d.s0.dy + p[1] - d.p0[1] });
  };
  const up = () => {
    const d = drag.current; drag.current = null;
    if (d?.kind === 'paint' && stroke) onAddStroke(stroke.map(v => Math.round(Math.max(0, Math.min(1, v)) * 1e5) / 1e5));
    setStroke(null);
  };
  const shape = (pts, rad, ox, oy, cls, extra = {}) => pts.length <= 2 ? <circle className={cls} cx={pts[0] + ox} cy={pts[1] + oy} r={rad} {...extra} /> : <path className={cls} d={spotPath(pts, ox, oy)} strokeWidth={rad * 2} {...extra} />;
  return <svg ref={ref} className={'d2Overlay d2Spots tool-' + tool} role="group" aria-label="Spots overlay" viewBox={`0 0 ${box.w || 1} ${box.h || 1}`} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={() => setHover(null)} onKeyDown={e => { if (e.key === 'Escape') { drag.current = null; setStroke(null); } }}>
    {visible && spots.map((s, i) => {
      const pts = []; const P = s.points || []; for (let k = 0; k + 1 < P.length; k += 2) pts.push(P[k] * box.w, P[k + 1] * box.h);
      if (!pts.length) return null;
      const rad = Math.max(2, (s.size ?? SPOT_DEFAULTS.size) * L / 2), sel = s.id === selectedId, src = s.source, ox = src ? src.dx * box.w : 0, oy = src ? src.dy * box.h : 0;
      return <g key={s.id ?? i} className={'d2Spot' + (sel ? ' sel' : '')}>
        {src && <line className="d2SpotLink" x1={pts[0]} y1={pts[1]} x2={pts[0] + ox} y2={pts[1] + oy} />}
        {src && shape(pts, rad, ox, oy, 'd2SpotSrc', { role: 'button', 'aria-label': `Spot ${i + 1} source`, onPointerDown: e => grabSource(s, e) })}
        {shape(pts, rad, 0, 0, 'd2SpotDst', { role: 'button', tabIndex: 0, 'aria-label': `Spot ${i + 1}`, 'aria-pressed': sel, onPointerDown: e => { e.stopPropagation(); onSelect?.(s.id); }, onKeyDown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect?.(s.id); } } })}
      </g>;
    })}
    {stroke && shape(stroke.map((v, i) => i % 2 ? v * box.h : v * box.w), r, 0, 0, 'd2SpotDraft')}
    {hover && !stroke && <circle className="d2BrushCursor" cx={hover[0] * box.w} cy={hover[1] * box.h} r={r} pointerEvents="none" />}
  </svg>;
}

// =====================================================================================
// Point Color
// =====================================================================================
const swatchCss = s => { const [r, g, b] = hslToRgb(s.hue, s.sat, s.lum); return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`; };

/**
 * Point Color panel. Props: value ({ swatches: [...] } = settings.pointColor), onChange(value),
 * onPick() — the host enters eyedropper mode; on a click it appends
 * samplePointColor(preview, x, y) to value.swatches (max 8). The last added swatch is selected.
 */
export function PointColorPanel({ value, onChange, onPick, picking = false }) {
  const sw = value?.swatches || [], [sel, setSel] = useState(sw.length - 1), prevLen = useRef(sw.length);
  useEffect(() => { if (sw.length > prevLen.current) setSel(sw.length - 1); else if (sel >= sw.length) setSel(sw.length - 1); prevLen.current = sw.length; }, [sw.length]);
  const cur = sw[sel];
  const upd = patch => onChange({ ...value, swatches: sw.map((s, i) => i === sel ? { ...s, ...patch } : s) });
  const updRange = patch => upd({ range: { ...(cur.range || pointColorSwatch().range), ...patch } });
  const hueGrad = cur ? `linear-gradient(90deg, ${[-30, -15, 0, 15, 30].map(d => swatchCss({ ...cur, hue: cur.hue + d, sat: Math.max(cur.sat, 0.5), lum: 0.5 })).join(',')})` : undefined;
  return <div className="d2Panel d2PointColor">
    <div className="crsRow d2Row"><span>Point Color</span>
      <button className={'crsPick' + (picking ? ' on' : '')} aria-label="Point color eyedropper" aria-pressed={picking} title="Sample a colour from the image" disabled={sw.length >= 8} onClick={onPick}><Pipette size={13} /></button></div>
    <div className="d2Swatches" role="group" aria-label="Point color swatches">
      {sw.map((s, i) => <button key={i} className={'d2Swatch' + (i === sel ? ' on' : '')} style={{ background: swatchCss(s) }} aria-pressed={i === sel} aria-label={`Point color swatch ${i + 1}`} onClick={() => setSel(i)} />)}
      {!sw.length && <span className="d2Dim">Use the eyedropper to sample a colour.</span>}
    </div>
    {cur && <>
      <div className="d2Buttons"><button aria-label="Delete point color swatch" onClick={() => onChange({ ...value, swatches: sw.filter((_, i) => i !== sel) })}>Delete swatch</button>
        <button aria-label="Reset point color swatch" onClick={() => upd({ hueShift: 0, satShift: 0, lumShift: 0, variance: 0, range: pointColorSwatch().range })}>Reset</button></div>
      <Slider label="Hue" aria="Point hue shift" value={cur.hueShift} min={-100} max={100} onChange={v => upd({ hueShift: v })} gradient={hueGrad} />
      <Slider label="Saturation" aria="Point saturation shift" value={cur.satShift} min={-100} max={100} onChange={v => upd({ satShift: v })} gradient={`linear-gradient(90deg, ${swatchCss({ ...cur, sat: 0 })}, ${swatchCss({ ...cur, sat: 1 })})`} />
      <Slider label="Luminance" aria="Point luminance shift" value={cur.lumShift} min={-100} max={100} onChange={v => upd({ lumShift: v })} gradient={`linear-gradient(90deg, ${swatchCss({ ...cur, lum: 0.1 })}, ${swatchCss({ ...cur, lum: 0.9 })})`} />
      <Slider label="Variance" aria="Point variance" value={cur.variance} min={0} max={100} onChange={v => upd({ variance: v })} />
      <div className="d2Label">Range</div>
      <Slider label="Hue Range" aria="Point hue range" value={cur.range?.hue ?? 50} min={0} max={100} def={50} onChange={v => updRange({ hue: v })} />
      <Slider label="Saturation Range" aria="Point saturation range" value={cur.range?.sat ?? 50} min={0} max={100} def={50} onChange={v => updRange({ sat: v })} />
      <Slider label="Luminance Range" aria="Point luminance range" value={cur.range?.lum ?? 50} min={0} max={100} def={50} onChange={v => updRange({ lum: v })} />
    </>}
  </div>;
}
