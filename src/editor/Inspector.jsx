import React, { useState } from 'react';
import { Type, Square, Circle, ImagePlus, Paintbrush, Box, PenTool, SlidersHorizontal, Layers, ChevronUp, ChevronRight, ChevronsUpDown, Underline, Italic, CaseUpper, AlignLeft, AlignCenter, AlignRight,
  AlignStartVertical, AlignCenterVertical, AlignEndVertical, AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal, RotateCw, Minus, Plus, Baseline, MoveVertical, Eye, EyeOff } from 'lucide-react';
import { FONT_FAMILIES } from '../engine/textlayout.js';
import { FX_LABELS } from '../engine/styles.js';

// Properties inspector for the selected layer: compact rows (Align, Position, Size, Radius), a
// Text Style block for type, and collapsible Fill / Border / Effects / Layer sections.

const r2 = v => Math.round((+v || 0) * 100) / 100;
const TYPE_INFO = {
  text: ['Text', Type], rect: ['Rectangle', Square], ellipse: ['Ellipse', Circle], image: ['Image', ImagePlus], raster: ['Pixel layer', Paintbrush],
  smart: ['Smart Object', Box], shape: ['Shape', PenTool], adjustment: ['Adjustment', SlidersHorizontal], fill: ['Fill layer', Layers],
};
const WEIGHTS = [[300, 'Light'], [400, 'Regular'], [500, 'Medium'], [600, 'Semibold'], [700, 'Bold'], [800, 'Extra Bold'], [900, 'Black']];
const BLEND_LABEL = m => m.replace(/(^|-)(\w)/g, (_, a, c) => (a ? ' ' : '') + c.toUpperCase());

export const Row = ({ label, children }) => <div className="insRow"><span className="insLabel">{label}</span><div className="insFields">{children}</div></div>;

export function NumField({ label, glyph, value, onChange, step = 1, min, max, suffix, placeholder, disabled }) {
  const [draft, setDraft] = useState(null);
  const commit = v => { if (v === '' || !Number.isFinite(+v)) return; let n = +v; if (min != null) n = Math.max(min, n); if (max != null) n = Math.min(max, n); onChange(n); };
  return <label className={'insNum' + (disabled ? ' off' : '')} title={label}>
    {glyph !== undefined && <span className="insGlyph" aria-hidden="true">{glyph}</span>}
    <input type="number" aria-label={label} step={step} min={min} max={max} placeholder={placeholder} disabled={disabled}
      value={draft ?? (value === '' || value == null ? '' : r2(value))}
      onChange={e => { setDraft(e.target.value); commit(e.target.value); }} onBlur={() => setDraft(null)}
      onKeyDown={e => { if (e.key === 'Enter') { commit(e.currentTarget.value); setDraft(null); e.currentTarget.blur(); } }} />
    {suffix && <small>{suffix}</small>}
  </label>;
}

/** Value slider in the modern style: white thumb on a thin track, value shown on the right. */
export function ValueSlider({ label, value, min = 0, max = 100, step = 1, onChange, format = v => Math.round(v) + '%' }) {
  return <div className="insSlider"><div className="insSliderHead"><span>{label}</span><output>{format(value)}</output></div>
    <input type="range" className="vslider" aria-label={label} min={min} max={max} step={step} value={value} style={{ '--fill': ((value - min) / (max - min) * 100) + '%' }} onChange={e => onChange(+e.target.value)} /></div>;
}

function Section({ title, open, onToggle, children, right }) {
  return <section className={'insSection' + (open ? ' open' : '')}>
    <div className="insHead"><button aria-expanded={open} onClick={onToggle}><span>{title}</span></button>{right}<button className="insChevron" aria-label={(open ? 'Collapse ' : 'Expand ') + title} onClick={onToggle}>{open ? <ChevronUp size={15} /> : <ChevronRight size={15} />}</button></div>
    {open && <div className="insBody">{children}</div>}
  </section>;
}

const IconBtn = ({ label, on, onClick, children }) => <button className={'insIcon' + (on ? ' on' : '')} aria-label={label} title={label} aria-pressed={on === undefined ? undefined : !!on} onClick={onClick}>{children}</button>;

function ColorRow({ label, value, onChange, alpha, onAlpha }) {
  const hex = typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff';
  const [draft, setDraft] = useState(null);
  return <div className="insColor">
    <input type="color" aria-label={label} value={hex} onChange={e => onChange(e.target.value)} />
    <input className="insHex" aria-label={label + ' hex'} value={draft ?? hex.toUpperCase().slice(1)} onChange={e => setDraft(e.target.value)}
      onBlur={() => { if (draft && /^[0-9a-f]{6}$/i.test(draft)) onChange('#' + draft.toLowerCase()); setDraft(null); }} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
    {onAlpha && <NumField label={label + ' opacity'} value={Math.round(alpha * 100)} min={0} max={100} suffix="%" onChange={v => onAlpha(v / 100)} />}
  </div>;
}

/**
 * props: layer, doc, patch(obj), onAlign(kind), mode, openStyle(section), advancedType (node for Character/Paragraph panels),
 *        blendModes [[value,label]], textValue, onText(text)
 */
export default function Inspector({ layer: l, patch, onAlign, mode, openStyle, advancedType, blendModes, onText }) {
  const [open, setOpen] = useState({ text: true, fill: true, border: false, effects: false, layer: true, more: false });
  const tog = k => () => setOpen(o => ({ ...o, [k]: !o[k] }));
  const [name, Icon] = TYPE_INFO[l.type] || ['Layer', Layers];
  const geom = !['raster', 'adjustment', 'fill', 'shape'].includes(l.type);
  const isText = l.type === 'text', hasFill = ['rect', 'ellipse', 'text', 'shape'].includes(l.type);
  const radius = Array.isArray(l.radius) ? l.radius : [l.radius || 0, l.radius || 0, l.radius || 0, l.radius || 0];
  const setCorner = (i, v) => { const r = [...radius]; r[i] = Math.max(0, v); patch({ radius: r.every(x => x === r[0]) ? r[0] : r }); };
  // type metrics (legacy fields stay readable)
  const size = l.size || 24;
  const leadingPct = l.leading === 'auto' ? 120 : Number.isFinite(+l.leading) && l.leading !== undefined && l.leading !== '' ? Math.round(l.leading / size * 100) : Math.round((l.lineHeight || 1.1) * 100);
  const tracking = l.tracking !== undefined ? l.tracking : Math.round((l.spacing || 0) / size * 1000);
  const align = l.align || 'left';
  const effects = (l.style?.effects || []).filter(e => e.enabled);
  return <div className="inspector" aria-label="Properties">
    <div className="insTitle"><Icon size={16} /><span>{name}</span><small>{l.locked ? 'Locked' : ''}</small></div>
    <div className="insBlock">
      <Row label="Align"><div className="insIcons" role="group" aria-label="Align to canvas">
        <IconBtn label="Align left" onClick={() => onAlign('left')}><AlignStartVertical size={15} /></IconBtn>
        <IconBtn label="Center horizontally" onClick={() => onAlign('hcenter')}><AlignCenterVertical size={15} /></IconBtn>
        <IconBtn label="Align right" onClick={() => onAlign('right')}><AlignEndVertical size={15} /></IconBtn>
        <IconBtn label="Align top" onClick={() => onAlign('top')}><AlignStartHorizontal size={15} /></IconBtn>
        <IconBtn label="Center vertically" onClick={() => onAlign('vcenter')}><AlignCenterHorizontal size={15} /></IconBtn>
        <IconBtn label="Align bottom" onClick={() => onAlign('bottom')}><AlignEndHorizontal size={15} /></IconBtn>
      </div></Row>
      <Row label="Position"><NumField label="X" glyph="X" value={l.x} onChange={v => patch({ x: v })} /><NumField label="Y" glyph="Y" value={l.y} onChange={v => patch({ y: v })} />
        {geom && <NumField label="Rotation" glyph={<RotateCw size={12} />} value={l.rotation || 0} min={-360} max={360} onChange={v => patch({ rotation: v })} />}</Row>
      {geom && <Row label="Size"><NumField label="Width" glyph="W" value={l.w} min={1} onChange={v => patch({ w: v })} /><NumField label="Height" glyph="H" value={l.h} min={1} onChange={v => patch({ h: v })} /></Row>}
      {l.type === 'rect' && <Row label="Radius"><div className="insCorners">{['Top-left', 'Top-right', 'Bottom-right', 'Bottom-left'].map((c, i) =>
        <NumField key={c} label={c + ' radius'} value={radius[i]} min={0} onChange={v => setCorner(i, v)} />)}</div></Row>}
    </div>

    {isText && <Section title="Text Style" open={open.text} onToggle={tog('text')}>
      <textarea className="insText" aria-label="Text content" value={l.text} onChange={e => onText(e.target.value)} />
      <label className="insSelect"><select aria-label="Font" value={l.font || 'Arial, sans-serif'} onChange={e => patch({ font: e.target.value })}>
        {[...new Set([l.font || 'Arial, sans-serif', ...FONT_FAMILIES])].map(f => <option key={f} value={f}>{f.split(',')[0].replace(/['"]/g, '')}</option>)}</select><ChevronsUpDown size={14} aria-hidden="true" /></label>
      <div className="insPair">
        <label className="insSelect"><select aria-label="Font weight" value={+l.weight || 400} onChange={e => patch({ weight: +e.target.value })}>
          {[...new Set([+l.weight || 400, ...WEIGHTS.map(w => w[0])])].sort((a, b) => a - b).map(w => <option key={w} value={w}>{(WEIGHTS.find(x => x[0] === w) || [w, String(w)])[1]}</option>)}</select><ChevronsUpDown size={14} aria-hidden="true" /></label>
        <div className="insStepper"><button aria-label="Decrease font size" onClick={() => patch({ size: Math.max(1, size - 1) })}><Minus size={13} /></button>
          <NumField label="Font size" value={size} min={1} max={2000} onChange={v => patch({ size: v })} /><button aria-label="Increase font size" onClick={() => patch({ size: size + 1 })}><Plus size={13} /></button></div>
      </div>
      <div className="insPair">
        <NumField label="Line height" glyph={<MoveVertical size={12} />} value={leadingPct} min={10} max={1000} suffix="%" onChange={v => patch({ leading: Math.round(size * v) / 100 })} />
        <NumField label="Tracking" glyph={<Baseline size={12} />} value={tracking} step={5} min={-1000} max={10000} onChange={v => patch({ tracking: v, spacing: 0 })} />
      </div>
      <div className="insIcons spread" role="group" aria-label="Text style">
        <IconBtn label="All caps" on={l.allCaps} onClick={() => patch({ allCaps: !l.allCaps })}><CaseUpper size={15} /></IconBtn>
        <IconBtn label="Underline" on={l.underline} onClick={() => patch({ underline: !l.underline })}><Underline size={15} /></IconBtn>
        <IconBtn label="Italic" on={l.italic || l.fauxItalic} onClick={() => patch({ italic: !(l.italic || l.fauxItalic), fauxItalic: false })}><Italic size={15} /></IconBtn>
        <span className="insSep" />
        <IconBtn label="Text left" on={align === 'left'} onClick={() => patch({ align: 'left' })}><AlignLeft size={15} /></IconBtn>
        <IconBtn label="Text center" on={align === 'center'} onClick={() => patch({ align: 'center' })}><AlignCenter size={15} /></IconBtn>
        <IconBtn label="Text right" on={align === 'right'} onClick={() => patch({ align: 'right' })}><AlignRight size={15} /></IconBtn>
      </div>
      <button className="insMore" aria-expanded={open.more} onClick={tog('more')}>{open.more ? 'Hide' : 'More'} type options (Character, Paragraph, Warp)</button>
      {open.more && <div className="insAdvanced">{advancedType}</div>}
    </Section>}

    {hasFill && <Section title="Fill" open={open.fill} onToggle={tog('fill')}>
      <ColorRow label="Fill color" value={l.fill} onChange={v => patch({ fill: v })} alpha={l.fillOpacity ?? 1} onAlpha={l.type === 'rect' || l.type === 'ellipse' ? v => patch({ fillOpacity: v }) : null} />
    </Section>}

    {hasFill && <Section title="Border" open={open.border} onToggle={tog('border')} right={l.stroke && l.strokeWidth > 0 ? <button className="insIcon" aria-label="Remove border" title="Remove border" onClick={() => patch({ strokeWidth: 0 })}><Minus size={13} /></button> : <button className="insIcon" aria-label="Add border" title="Add border" onClick={() => patch({ stroke: l.stroke || '#ffffff', strokeWidth: 2 })}><Plus size={13} /></button>}>
      <ColorRow label="Border color" value={l.stroke || '#ffffff'} onChange={v => patch({ stroke: v, strokeWidth: l.strokeWidth || 2 })} />
      <div className="insPair"><NumField label="Border width" glyph="W" value={l.strokeWidth || 0} min={0} max={500} onChange={v => patch({ strokeWidth: v, stroke: l.stroke || '#ffffff' })} />
        {l.type === 'shape' && <label className="insSelect"><select aria-label="Border position" value={l.strokeAlign || 'center'} onChange={e => patch({ strokeAlign: e.target.value })}><option value="inside">Inside</option><option value="center">Center</option><option value="outside">Outside</option></select><ChevronsUpDown size={14} aria-hidden="true" /></label>}</div>
    </Section>}

    <Section title="Effects" open={open.effects} onToggle={tog('effects')} right={<button className="insIcon" aria-label="Add effect" title="Add an effect (Layer Style)" onClick={() => openStyle('dropShadow')}><Plus size={13} /></button>}>
      {effects.length ? effects.map((e, i) => <button key={i} className="insEffect" onClick={() => openStyle(e.type)}><span>{FX_LABELS[e.type] || e.type}</span><ChevronRight size={13} /></button>)
        : <p className="insHint">No effects. Add a drop shadow, glow, stroke, bevel or overlay.</p>}
      <button className="insMore" onClick={() => openStyle('blending')}>Blending options…</button>
    </Section>

    <Section title="Appearance" open={open.layer} onToggle={tog('layer')} right={<button className="insIcon" aria-label={l.visible ? 'Hide layer' : 'Show layer'} title="Visibility" onClick={() => patch({ visible: !l.visible })}>{l.visible ? <Eye size={13} /> : <EyeOff size={13} />}</button>}>
      <ValueSlider label="Opacity" value={Math.round(l.opacity * 100)} onChange={v => patch({ opacity: v / 100 })} />
      {mode === 'Advanced' && <label className="insSelect"><select aria-label="Blend mode" value={l.blend || 'normal'} onChange={e => patch({ blend: e.target.value })}>{blendModes.map(([v, n]) => <option key={v} value={v}>{n || BLEND_LABEL(v)}</option>)}</select><ChevronsUpDown size={14} aria-hidden="true" /></label>}
    </Section>
  </div>;
}
