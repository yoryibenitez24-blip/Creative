import React from 'react';
import { BRUSH_LIMITS } from '../engine/brush.js';

const num = (label, value, onChange, { min, max, step = 1, suffix = '', scale = 1 }) =>
  <label className="opt"><span>{label}</span>
    <input type="range" aria-label={label} min={min * scale} max={max * scale} step={step} value={Math.round(value * scale * 100) / 100} onChange={e => onChange(+e.target.value / scale)} />
    <input type="number" aria-label={label + ' value'} min={min * scale} max={max * scale} step={step} value={Math.round(value * scale * 100) / 100} onChange={e => { const v = +e.target.value; if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v / scale))); }} />
    {suffix && <small>{suffix}</small>}
  </label>;
const check = (label, value, onChange) => <label className="optCheck"><input type="checkbox" aria-label={label} checked={!!value} onChange={e => onChange(e.target.checked)} />{label}</label>;
const pick = (label, value, onChange, options) => <label className="opt"><span>{label}</span><select aria-label={label} value={value} onChange={e => onChange(e.target.value)}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>;
const segmented = (label, value, onChange, options) => <div className="segmented" role="group" aria-label={label}>{options.map(([v, l]) => <button key={v} aria-pressed={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>)}</div>;

const MODES = [['replace', 'New'], ['add', 'Add'], ['subtract', 'Subtract'], ['intersect', 'Intersect']];
const MODE_TITLES = { replace: 'New selection', add: 'Add to selection (Shift)', subtract: 'Subtract from selection (Alt)', intersect: 'Intersect with selection (Shift+Alt)' };
export const VARIANTS = {
  marquee: [['rect', 'Rectangular'], ['ellipse', 'Elliptical']],
  lasso: [['free', 'Freehand'], ['polygon', 'Polygonal']],
  brush: [['brush', 'Brush'], ['pencil', 'Pencil']],
  fill: [['gradient', 'Gradient'], ['bucket', 'Paint Bucket']],
  tone: [['dodge', 'Dodge'], ['burn', 'Burn'], ['sponge', 'Sponge']],
  focus: [['blur', 'Blur'], ['sharpen', 'Sharpen'], ['smudge', 'Smudge']],
  heal: [['spot', 'Spot Healing'], ['healing', 'Healing Brush'], ['patch', 'Patch']],
  wand: [['quick', 'Quick Selection'], ['wand', 'Magic Wand']],
  pen: [['pen', 'Pen'], ['freeform', 'Freeform Pen'], ['curvature', 'Curvature Pen'], ['addAnchor', 'Add Anchor Point'], ['deleteAnchor', 'Delete Anchor Point'], ['convert', 'Convert Point']],
  pathSelect: [['pathSelect', 'Path Selection'], ['direct', 'Direct Selection']],
};
export const TOOL_NAMES = { move: 'Move', hand: 'Hand', zoom: 'Zoom', marquee: 'Marquee', lasso: 'Lasso', wand: 'Magic Wand', crop: 'Crop', eyedropper: 'Eyedropper', heal: 'Healing', brush: 'Brush', clone: 'Clone Stamp', eraser: 'Eraser', fill: 'Gradient / Bucket', tone: 'Dodge / Burn / Sponge', focus: 'Blur / Sharpen / Smudge', pen: 'Pen', pathSelect: 'Path Selection' };

export default function ToolOptions({ pen, onMask, tool, brush, setBrush, sel, setSel, variant, setVariant, polyActive, opts, setOpt, crop }) {
  const o = opts[tool] || {}, set = k => v => setOpt(tool, { ...o, [k]: v });
  const bar = (label, children) => <div className="optionsBar" role="toolbar" aria-label={label} onPointerDown={e => e.stopPropagation()}>{children}</div>;
  const variantSeg = VARIANTS[tool] && segmented('Tool variant', variant, setVariant, VARIANTS[tool]);
  const brushCore = (withFlow = true) => <>
    {num('Size', brush.size, v => setBrush({ ...brush, size: v }), { min: BRUSH_LIMITS.size[0], max: BRUSH_LIMITS.size[1], suffix: 'px' })}
    {num('Hardness', brush.hardness, v => setBrush({ ...brush, hardness: v }), { min: 0, max: 1, scale: 100, suffix: '%' })}
    {withFlow && num('Opacity', brush.opacity, v => setBrush({ ...brush, opacity: v }), { min: 0, max: 1, scale: 100, suffix: '%' })}
  </>;
  const maskTag = onMask && <span className="maskTag" role="status">On layer mask · black hides, white reveals{tool === 'eraser' ? ' · eraser paints the background colour' : ''}</span>;
  if (tool === 'brush' || tool === 'eraser') {
    const s = k => v => setBrush({ ...brush, [k]: v });
    return bar((tool === 'brush' ? (variant === 'pencil' ? 'Pencil' : 'Brush') : 'Eraser') + ' options', <>
      {tool === 'brush' ? variantSeg : <strong>Eraser</strong>}{maskTag}
      {num('Size', brush.size, s('size'), { min: BRUSH_LIMITS.size[0], max: BRUSH_LIMITS.size[1], suffix: 'px' })}
      {!(tool === 'brush' && variant === 'pencil') && num('Hardness', brush.hardness, s('hardness'), { min: 0, max: 1, scale: 100, suffix: '%' })}
      {num('Opacity', brush.opacity, s('opacity'), { min: 0, max: 1, scale: 100, suffix: '%' })}
      {num('Flow', brush.flow, s('flow'), { min: 0, max: 1, scale: 100, suffix: '%' })}
      {num('Spacing', brush.spacing, s('spacing'), { min: BRUSH_LIMITS.spacing[0], max: 2, scale: 100, suffix: '%' })}
      {num('Smoothing', brush.smoothing, s('smoothing'), { min: 0, max: 0.95, scale: 100, suffix: '%' })}
      {check('Pen pressure → size', brush.pressureSize, s('pressureSize'))}
      {check('Pen pressure → flow', brush.pressureFlow, s('pressureFlow'))}
    </>);
  }
  if (tool === 'marquee' || tool === 'lasso' || tool === 'wand') {
    return bar('Selection options', <>
      {variantSeg}
      <div className="segmented" role="group" aria-label="Selection mode">{MODES.map(([m, l]) => <button key={m} title={MODE_TITLES[m]} aria-label={MODE_TITLES[m]} aria-pressed={sel.mode === m} className={sel.mode === m ? 'on' : ''} onClick={() => setSel({ ...sel, mode: m })}>{l}</button>)}</div>
      {tool === 'wand' && variant === 'quick' ? <>{num('Size', brush.size, v => setBrush({ ...brush, size: v }), { min: 1, max: 300, suffix: 'px' })}{check('Sample all layers', o.allLayers, set('allLayers'))}<small className="optHint">Paint over the area; each stroke adds (Alt subtracts)</small></> : tool === 'wand' ? <>
        {num('Tolerance', o.tolerance, set('tolerance'), { min: 0, max: 255 })}
        {check('Anti-alias', o.antiAlias, set('antiAlias'))}{check('Contiguous', o.contiguous, set('contiguous'))}{check('Sample all layers', o.allLayers, set('allLayers'))}
      </> : num('Feather', sel.feather, v => setSel({ ...sel, feather: v }), { min: 0, max: 250, suffix: 'px' })}
      {tool === 'lasso' && variant === 'polygon' && <small className="optHint">{polyActive ? 'Click to add points · Double-click or Enter to close · Backspace removes a point · Esc cancels' : 'Click to place the first point'}</small>}
    </>);
  }
  if (tool === 'fill') {
    return bar(variant === 'bucket' ? 'Paint Bucket options' : 'Gradient options', <>
      {variantSeg}{maskTag}
      {variant === 'bucket' ? <>
        {num('Tolerance', o.tolerance, set('tolerance'), { min: 0, max: 255 })}
        {num('Opacity', o.opacity, set('opacity'), { min: 0, max: 1, scale: 100, suffix: '%' })}
        {check('Anti-alias', o.antiAlias, set('antiAlias'))}{check('Contiguous', o.contiguous, set('contiguous'))}{check('All layers', o.allLayers, set('allLayers'))}
      </> : <>
        {segmented('Gradient type', o.type, set('type'), [['linear', 'Linear'], ['radial', 'Radial'], ['angle', 'Angle'], ['reflected', 'Reflected'], ['diamond', 'Diamond']])}
        {pick('Colours', o.colors, set('colors'), [['fgbg', 'Foreground → Background'], ['fgclear', 'Foreground → Transparent'], ['bw', 'Black → White']])}
        {num('Opacity', o.opacity, set('opacity'), { min: 0, max: 1, scale: 100, suffix: '%' })}
        {check('Reverse', o.reverse, set('reverse'))}{check('Dither', o.dither, set('dither'))}
      </>}
    </>);
  }
  if (tool === 'eyedropper') return bar('Eyedropper options', <><strong>Eyedropper</strong>
    {pick('Sample size', String(o.size), v => set('size')(+v), [['1', 'Point sample'], ['3', '3 × 3 average'], ['5', '5 × 5 average'], ['11', '11 × 11 average'], ['31', '31 × 31 average']])}
    {pick('Sample', o.sample, set('sample'), [['all', 'All layers'], ['layer', 'Current layer']])}
    <small className="optHint">Click sets the foreground colour · Alt-click sets the background</small></>);
  if (tool === 'clone') return bar('Clone Stamp options', <><strong>Clone Stamp</strong>{brushCore()}{check('Aligned', o.aligned, set('aligned'))}
    <small className="optHint">{o.source ? `Source set at ${Math.round(o.source.x)}, ${Math.round(o.source.y)}` : 'Alt-click to set the source point'}</small></>);
  if (tool === 'heal') return bar('Healing options', <>{variantSeg}{brushCore(false)}
    <small className="optHint">{variant === 'patch' ? 'Draw around the area to fix, then drag the selection onto clean texture' : variant === 'spot' ? 'Paint over a blemish; texture is taken from nearby and blended in' : o.source ? `Source set at ${Math.round(o.source.x)}, ${Math.round(o.source.y)}` : 'Alt-click to set the source point'}</small></>);
  if (tool === 'tone') return bar('Toning options', <>{variantSeg}{brushCore(false)}
    {variant === 'sponge' ? pick('Mode', o.sponge, set('sponge'), [['desaturate', 'Desaturate'], ['saturate', 'Saturate']]) : pick('Range', o.range, set('range'), [['shadows', 'Shadows'], ['midtones', 'Midtones'], ['highlights', 'Highlights']])}
    {num(variant === 'sponge' ? 'Flow' : 'Exposure', o.exposure, set('exposure'), { min: 0.01, max: 1, scale: 100, suffix: '%' })}
    {variant !== 'sponge' && check('Protect tones', o.protect, set('protect'))}</>);
  if (tool === 'focus') return bar('Blur / Sharpen / Smudge options', <>{variantSeg}{brushCore(false)}
    {num('Strength', o.strength, set('strength'), { min: 0.01, max: 1, scale: 100, suffix: '%' })}</>);
  if (tool === 'crop') return bar('Crop options', <><strong>Crop</strong>
    <div className="segmented icons ratioIcons" role="group" aria-label="Aspect ratio">{[['1:1', 'Square 1 : 1', 14, 14], ['3:2', 'Landscape 3 : 2', 18, 12], ['4:5', 'Portrait 4 : 5', 11, 15], ['free', 'Free ratio', 0, 0]].map(([v, n, w, h]) => <button key={v} aria-label={n} title={n} aria-pressed={o.ratio === v} className={o.ratio === v ? 'on' : ''} onClick={() => set('ratio')(v)}>{w ? <span className="rIcon" style={{ width: w, height: h }} /> : '⋯'}</button>)}</div>
    {pick('Ratio', o.ratio, set('ratio'), [['free', 'Free'], ['original', 'Original ratio'], ['1:1', '1 : 1 (square)'], ['4:5', '4 : 5'], ['3:2', '3 : 2'], ['16:9', '16 : 9']])}
    {crop && <span className="optHint">{Math.round(crop.w)} × {Math.round(crop.h)} px</span>}
    <button className="optButton" onClick={crop?.cancel} disabled={!crop}>Cancel</button><button className="optButton primary" onClick={crop?.apply} disabled={!crop}>Apply crop ⏎</button></>);
  if ((tool === 'pen' || tool === 'pathSelect') && pen) return bar(tool === 'pen' ? 'Pen options' : 'Path selection options', <>{variantSeg}
    {pick('Tool mode', pen.opts.mode, v => pen.set({ ...pen.opts, mode: v }), [['path', 'Path'], ['shape', 'Shape']])}
    {pick('Path operations', pen.opts.pathOp, v => pen.set({ ...pen.opts, pathOp: v }), [['combine', 'Combine Shapes'], ['subtract', 'Subtract Front Shape'], ['intersect', 'Intersect Shape Areas'], ['exclude', 'Exclude Overlapping Shapes']])}
    <span className="optHint">Make:</span><button className="optButton" onClick={pen.toSelection}>Selection</button><button className="optButton" onClick={pen.toMask}>Mask</button><button className="optButton" onClick={pen.toShape}>Shape</button><button className="optButton" onClick={pen.save}>Save path</button>
    <small className="optHint">{tool === 'pen' ? 'Click for corners, drag for curves, click the first point to close · Esc/Enter ends the path' : 'Drag to move · Alt-drag duplicates · Delete removes'}</small></>);
  if (tool === 'zoom') return bar('Zoom options', <><strong>Zoom</strong><small className="optHint">Click to zoom in · Alt-click to zoom out · drag left/right for scrubby zoom</small></>);
  return null;
}
