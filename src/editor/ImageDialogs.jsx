import React, { useState } from 'react';

const num = (label, value, set, extra = {}) => <label className="opField"><span>{label}</span><input type="number" aria-label={label} value={value} onChange={e => set(+e.target.value)} {...extra} /></label>;

/** Image > Image Size: pixel dimensions with constrained proportions and resampling method. */
export function ImageSizeDialog({ doc, onApply, onCancel }) {
  const [w, setW] = useState(doc.w), [h, setH] = useState(doc.h), [lock, setLock] = useState(true), [method, setMethod] = useState('bicubic');
  const ok = w >= 1 && h >= 1 && w <= 8000 && h <= 8000;
  return <div className="opDialog" role="dialog" aria-label="Image Size" onPointerDown={e => e.stopPropagation()}>
    <header><h3>Image Size</h3><span className="opStatus">{doc.w} × {doc.h} px now</span></header>
    <div className="opFields">
      {num('Width (px)', w, v => { setW(v); if (lock) setH(Math.max(1, Math.round(v * doc.h / doc.w))); }, { min: 1, max: 8000 })}
      {num('Height (px)', h, v => { setH(v); if (lock) setW(Math.max(1, Math.round(v * doc.w / doc.h))); }, { min: 1, max: 8000 })}
      <label className="optCheck"><input type="checkbox" checked={lock} onChange={e => setLock(e.target.checked)} />Constrain proportions</label>
      <label className="opField"><span>Resample</span><select aria-label="Resample" value={method} onChange={e => setMethod(e.target.value)}><option value="bicubic">Bicubic (smooth gradients)</option><option value="bilinear">Bilinear</option><option value="nearest">Nearest neighbour (hard edges)</option></select></label>
      {!ok && <p className="hint">Use 1–8000 px per side.</p>}
    </div>
    <footer><button onClick={onCancel}>Cancel</button><button className="primary" disabled={!ok} onClick={() => onApply(w, h, method)}>OK</button></footer>
  </div>;
}

/** Image > Canvas Size: new size and a 3×3 anchor for where the existing content sits. */
export function CanvasSizeDialog({ doc, onApply, onCancel }) {
  const [w, setW] = useState(doc.w), [h, setH] = useState(doc.h), [a, setA] = useState([1, 1]);
  const ok = w >= 1 && h >= 1 && w <= 8000 && h <= 8000;
  return <div className="opDialog" role="dialog" aria-label="Canvas Size" onPointerDown={e => e.stopPropagation()}>
    <header><h3>Canvas Size</h3><span className="opStatus">{doc.w} × {doc.h} px now</span></header>
    <div className="opFields">
      {num('Width (px)', w, setW, { min: 1, max: 8000 })}{num('Height (px)', h, setH, { min: 1, max: 8000 })}
      <div className="anchorGrid" role="group" aria-label="Anchor">{[0, 1, 2].flatMap(y => [0, 1, 2].map(x => <button key={x + '' + y} aria-label={`Anchor ${['top', 'middle', 'bottom'][y]} ${['left', 'centre', 'right'][x]}`} aria-pressed={a[0] === x && a[1] === y} className={a[0] === x && a[1] === y ? 'on' : ''} onClick={() => setA([x, y])} />))}</div>
      <p className="hint">Layers keep pixels outside the canvas; nothing is deleted.</p>
    </div>
    <footer><button onClick={onCancel}>Cancel</button><button className="primary" disabled={!ok} onClick={() => onApply(w, h, a[0], a[1])}>OK</button></footer>
  </div>;
}

/** Select > Modify > Expand/Contract/Border/Smooth/Feather. */
export function RadiusDialog({ title, label = 'Radius (px)', initial = 4, max = 250, onApply, onCancel }) {
  const [r, setR] = useState(initial);
  return <div className="opDialog" role="dialog" aria-label={title} onPointerDown={e => e.stopPropagation()} onKeyDown={e => { if (e.key === 'Enter') onApply(r); if (e.key === 'Escape') onCancel(); }}>
    <header><h3>{title}</h3></header>
    <div className="opFields">{num(label, r, v => setR(Math.max(0, Math.min(max, v))), { min: 0, max, autoFocus: true })}</div>
    <footer><button onClick={onCancel}>Cancel</button><button className="primary" onClick={() => onApply(r)}>OK</button></footer>
  </div>;
}
