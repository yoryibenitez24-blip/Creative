import React from 'react';
import { OP_BY_ID, defaults } from '../engine/ops.js';
import { PATTERNS } from '../engine/styles.js';
import { Field, CurveEditor } from './OpDialog.jsx';

// Inspector section for adjustment layers (editable Image › Adjustments) and fill layers.
// onChange(patch, live): live=true while dragging (one undo step at the end via endLive).
export default function AdjustPanel({ layer, onChange, endLive }) {
  if (layer.type === 'adjustment') {
    const op = OP_BY_ID[layer.adj.op], params = { ...defaults(op), ...layer.adj.params };
    const set = (k, v, live) => onChange({ adj: { ...layer.adj, params: { ...params, [k]: v } } }, live);
    return <div className="propertySection adjPanel" onPointerUp={endLive} onKeyUp={endLive}>
      <h4>{op.name.replace('…', '')}<span>Adjustment layer</span></h4>
      <p className="hint">Affects every visible layer below it. Use its mask to limit where it applies.</p>
      {op.params.map(p => p.type === 'curve' ? <CurveEditor key={p.key} value={params[p.key]} onChange={v => set(p.key, v)} /> : <Field key={p.key} p={p} value={params[p.key]} onChange={v => set(p.key, v, p.type === 'range')} />)}
      <div className="maskButtons"><button onClick={() => onChange({ adj: { ...layer.adj, params: defaults(op) } })}>Reset</button></div>
    </div>;
  }
  if (layer.type === 'fill') {
    const f = layer.fillSpec, set = (k, v, live) => onChange({ fillSpec: { ...f, [k]: v } }, live);
    return <div className="propertySection adjPanel" onPointerUp={endLive} onKeyUp={endLive}>
      <h4>{f.kind === 'solid' ? 'Solid Color' : f.kind === 'gradient' ? 'Gradient Fill' : 'Pattern Fill'}<span>Fill layer</span></h4>
      {f.kind === 'solid' && <label className="opField"><span>Color</span><input type="color" aria-label="Fill color" value={f.color} onChange={e => set('color', e.target.value)} /></label>}
      {f.kind === 'gradient' && <>
        <label className="opField"><span>From</span><input type="color" aria-label="Gradient from" value={f.gradFrom} onChange={e => set('gradFrom', e.target.value)} /></label>
        <label className="opField"><span>To</span><input type="color" aria-label="Gradient to" value={f.gradTo} onChange={e => set('gradTo', e.target.value)} /></label>
        <label className="opField"><span>Style</span><select aria-label="Gradient style" value={f.style} onChange={e => set('style', e.target.value)}>{['linear', 'radial', 'angle', 'reflected', 'diamond'].map(s => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}</select></label>
        <Field p={{ key: 'angle', label: 'Angle', type: 'range', min: -180, max: 180, step: 1, unit: '°' }} value={f.angle} onChange={v => set('angle', v, true)} />
        <Field p={{ key: 'scale', label: 'Scale', type: 'range', min: 10, max: 150, step: 1, unit: '%' }} value={f.scale} onChange={v => set('scale', v, true)} />
        <label className="optCheck"><input type="checkbox" checked={!!f.reverse} onChange={e => set('reverse', e.target.checked)} />Reverse</label>
      </>}
      {f.kind === 'pattern' && <>
        <label className="opField"><span>Pattern</span><select aria-label="Pattern" value={f.pattern} onChange={e => set('pattern', e.target.value)}>{Object.entries(PATTERNS).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label>
        <Field p={{ key: 'scale', label: 'Scale', type: 'range', min: 25, max: 1000, step: 1, unit: '%' }} value={f.scale} onChange={v => set('scale', v, true)} />
      </>}
    </div>;
  }
  return null;
}
