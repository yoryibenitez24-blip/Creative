import React from 'react';
import { MAX_FEATHER } from '../engine/mask.js';

// Inspector section for the selected layer's mask.
export default function MaskPanel({ layer, target, setTarget, hasSelection, actions }) {
  const m = layer.mask;
  if (!m) {
    return <div className="propertySection maskPanel"><h4>Layer mask<span>None</span></h4>
      <p className="hint">White reveals, black hides. {hasSelection ? 'Adding a mask now uses the current selection.' : 'Make a selection first to mask part of the layer.'}</p>
      <div className="maskButtons">
        <button onClick={() => actions.add(hasSelection ? 'revealSelection' : 'revealAll')}>{hasSelection ? 'Reveal selection' : 'Add mask (reveal all)'}</button>
        <button onClick={() => actions.add(hasSelection ? 'hideSelection' : 'hideAll')}>{hasSelection ? 'Hide selection' : 'Add mask (hide all)'}</button>
      </div>
    </div>;
  }
  const pct = v => Math.round(v * 100);
  return <div className="propertySection maskPanel"><h4>Layer mask<span>{m.enabled ? 'Enabled' : 'Disabled'}</span></h4>
    <div className="segmented" role="group" aria-label="Edit target">
      <button aria-pressed={!target} className={!target ? 'on' : ''} onClick={() => setTarget(false)}>Edit layer</button>
      <button aria-pressed={target} className={target ? 'on' : ''} onClick={() => setTarget(true)}>Edit mask</button>
    </div>
    <label className="optCheck"><input type="checkbox" aria-label="Mask enabled" checked={m.enabled} onChange={e => actions.patch({ enabled: e.target.checked })} />Enabled</label>
    <label className="optCheck"><input type="checkbox" aria-label="Mask linked" checked={m.linked} onChange={e => actions.patch({ linked: e.target.checked })} />Linked (moves with layer)</label>
    <label className="opt"><span>Density</span>
      <input type="range" aria-label="Mask density" min="0" max="100" value={pct(m.density)} onChange={e => actions.patch({ density: +e.target.value / 100 }, true)} onPointerUp={actions.endLive} onKeyUp={actions.endLive} />
      <input type="number" aria-label="Mask density value" min="0" max="100" value={pct(m.density)} onChange={e => { const v = +e.target.value; if (Number.isFinite(v)) actions.patch({ density: Math.min(100, Math.max(0, v)) / 100 }); }} /><small>%</small></label>
    <label className="opt"><span>Feather</span>
      <input type="range" aria-label="Mask feather" min="0" max={MAX_FEATHER} value={m.feather} onChange={e => actions.patch({ feather: +e.target.value }, true)} onPointerUp={actions.endLive} onKeyUp={actions.endLive} />
      <input type="number" aria-label="Mask feather value" min="0" max={MAX_FEATHER} value={m.feather} onChange={e => { const v = +e.target.value; if (Number.isFinite(v)) actions.patch({ feather: Math.min(MAX_FEATHER, Math.max(0, v)) }); }} /><small>px</small></label>
    <div className="maskButtons">
      <button onClick={actions.invert}>Invert</button>
      <button onClick={actions.apply} disabled={layer.type !== 'raster'} title={layer.type !== 'raster' ? 'Apply mask is available on paint layers; rasterizing other layer types is not implemented yet' : 'Bake the mask into the layer pixels'}>Apply</button>
      <button onClick={actions.remove}>Delete mask</button>
    </div>
  </div>;
}
