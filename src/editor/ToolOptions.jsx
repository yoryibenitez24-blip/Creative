import React from 'react';
import { BRUSH_LIMITS } from '../engine/brush.js';

const num = (label, value, onChange, { min, max, step = 1, suffix = '', scale = 1 }) =>
  <label className="opt"><span>{label}</span>
    <input type="range" aria-label={label} min={min * scale} max={max * scale} step={step} value={Math.round(value * scale * 100) / 100} onChange={e => onChange(+e.target.value / scale)} />
    <input type="number" aria-label={label + ' value'} min={min * scale} max={max * scale} step={step} value={Math.round(value * scale * 100) / 100} onChange={e => { const v = +e.target.value; if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v / scale))); }} />
    {suffix && <small>{suffix}</small>}
  </label>;

const MODES = [['replace', 'New selection'], ['add', 'Add to selection (Shift)'], ['subtract', 'Subtract from selection (Alt)'], ['intersect', 'Intersect with selection (Shift+Alt)']];

export default function ToolOptions({ tool, brush, setBrush, sel, setSel, variant, setVariant, polyActive }) {
  if (tool === 'brush' || tool === 'eraser') {
    const set = (k) => v => setBrush({ ...brush, [k]: v });
    return <div className="optionsBar" role="toolbar" aria-label={(tool === 'brush' ? 'Brush' : 'Eraser') + ' options'} onPointerDown={e => e.stopPropagation()}>
      <strong>{tool === 'brush' ? 'Brush' : 'Eraser'}</strong>
      {num('Size', brush.size, set('size'), { min: BRUSH_LIMITS.size[0], max: BRUSH_LIMITS.size[1], suffix: 'px' })}
      {num('Hardness', brush.hardness, set('hardness'), { min: 0, max: 1, scale: 100, suffix: '%' })}
      {num('Opacity', brush.opacity, set('opacity'), { min: 0, max: 1, scale: 100, suffix: '%' })}
      {num('Flow', brush.flow, set('flow'), { min: 0, max: 1, scale: 100, suffix: '%' })}
      {num('Spacing', brush.spacing, set('spacing'), { min: BRUSH_LIMITS.spacing[0], max: 2, scale: 100, suffix: '%' })}
      {num('Smoothing', brush.smoothing, set('smoothing'), { min: 0, max: 0.95, scale: 100, suffix: '%' })}
      <label className="optCheck"><input type="checkbox" checked={brush.pressureSize} onChange={e => setBrush({ ...brush, pressureSize: e.target.checked })} />Pen pressure → size</label>
      <label className="optCheck"><input type="checkbox" checked={brush.pressureFlow} onChange={e => setBrush({ ...brush, pressureFlow: e.target.checked })} />Pen pressure → flow</label>
    </div>;
  }
  if (tool === 'marquee' || tool === 'lasso') {
    const variants = tool === 'marquee' ? [['rect', 'Rectangular'], ['ellipse', 'Elliptical']] : [['free', 'Freehand'], ['polygon', 'Polygonal']];
    return <div className="optionsBar" role="toolbar" aria-label="Selection options" onPointerDown={e => e.stopPropagation()}>
      <div className="segmented" role="group" aria-label="Shape">{variants.map(([v, l]) => <button key={v} aria-pressed={variant === v} className={variant === v ? 'on' : ''} onClick={() => setVariant(v)}>{l}</button>)}</div>
      <div className="segmented" role="group" aria-label="Selection mode">{MODES.map(([m, l]) => <button key={m} title={l} aria-label={l} aria-pressed={sel.mode === m} className={sel.mode === m ? 'on' : ''} onClick={() => setSel({ ...sel, mode: m })}>{m === 'replace' ? 'New' : m === 'add' ? 'Add' : m === 'subtract' ? 'Subtract' : 'Intersect'}</button>)}</div>
      {num('Feather', sel.feather, v => setSel({ ...sel, feather: v }), { min: 0, max: 250, suffix: 'px' })}
      {tool === 'lasso' && variant === 'polygon' && <small className="optHint">{polyActive ? 'Click to add points · Double-click or Enter to close · Backspace removes a point · Esc cancels' : 'Click to place the first point'}</small>}
    </div>;
  }
  return null;
}
