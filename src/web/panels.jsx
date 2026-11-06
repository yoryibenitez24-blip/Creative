import React, { useState } from 'react';
import {
  Frame, Square, Circle, Minus, Type, Image as ImageIcon, Group, Component, Diamond, Eye, EyeOff, Lock, Unlock, ChevronRight, ChevronDown, ChevronsUpDown,
  Plus, Trash2, AlignStartVertical, AlignCenterVertical, AlignEndVertical, AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal,
  ArrowRight, ArrowDown, WrapText, AlignLeft, AlignCenter, AlignRight, Link2Off, Copy, Download, Play, Unlink, Crosshair, RotateCcw, Italic,
  AlignHorizontalSpaceBetween, AlignVerticalSpaceBetween,
} from 'lucide-react';
import { NumField, Row, ValueSlider } from '../editor/Inspector.jsx';
import { DEVICE_PRESETS, FONTS, isInstanceRoot, ownerInstance, styleUsers } from './model.js';
import { ALIGNS, padArray } from './layout.js';
import { cssForNode } from './codegen.js';
import { WEB_TEMPLATES } from './templates.js';

// Side panels of the Web / UI workspace: Layers, Assets (components, templates, shared styles), Design (properties),
// Prototype and Inspect. They are controlled: all edits go through the `act` API supplied by WebWorkspace.

const TYPE_ICON = { frame: Frame, group: Group, rect: Square, ellipse: Circle, line: Minus, text: Type, image: ImageIcon };
const TYPE_NAME = { frame: 'Frame', group: 'Group', rect: 'Rectangle', ellipse: 'Ellipse', line: 'Line', text: 'Text', image: 'Image' };
export const iconFor = n => n.isComponent ? Component : n.componentId ? Diamond : TYPE_ICON[n.type] || Square;
export const typeLabel = n => n.isComponent ? 'Main component' : isInstanceRoot(n) ? 'Instance' : n.componentId ? 'Nested instance' : TYPE_NAME[n.type] || 'Layer';

export function Section({ title, children, right, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return <section className={'insSection wbSection' + (open ? ' open' : '')}>
    <div className="insHead"><button aria-expanded={open} onClick={() => setOpen(!open)}><span>{title}</span></button>{right}
      <button className="insChevron" aria-label={(open ? 'Collapse ' : 'Expand ') + title} onClick={() => setOpen(!open)}>{open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</button></div>
    {open && <div className="insBody">{children}</div>}
  </section>;
}

export function Select({ label, value, options, onChange, disabled }) {
  return <label className="insSelect wbSelect" title={label}>
    <select aria-label={label} value={value} disabled={disabled} onChange={e => onChange(e.target.value)}>
      {options.map(o => Array.isArray(o) ? <option key={o[0]} value={o[0]}>{o[1]}</option> : <option key={o} value={o}>{o}</option>)}
    </select><ChevronsUpDown size={13} />
  </label>;
}

export function Seg({ label, value, options, onChange, icons }) {
  return <div className={'segmented wbSeg' + (icons ? ' icons' : '')} role="group" aria-label={label}>
    {options.map(([v, text, Icon]) => <button key={v} aria-label={icons ? text : undefined} title={text} aria-pressed={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>
      {Icon ? <Icon size={14} /> : text}</button>)}
  </div>;
}

const Btn = ({ label, onClick, children, disabled, className = '' }) => <button className={'wbBtn ' + className} aria-label={label} title={label} onClick={onClick} disabled={disabled}>{children}</button>;
const IconBtn = ({ label, on, onClick, children, disabled }) => <button className={'insIcon' + (on ? ' on' : '')} aria-label={label} title={label} aria-pressed={on === undefined ? undefined : !!on} onClick={onClick} disabled={disabled}>{children}</button>;

export function ColorField({ label, color, opacity = 1, onColor, onOpacity, disabled }) {
  const hex = /^#[0-9a-f]{6}$/i.test(color || '') ? color : '#000000';
  const [draft, setDraft] = useState(null);
  return <div className="insColor">
    <input type="color" aria-label={label} value={hex} disabled={disabled} onChange={e => onColor(e.target.value)} />
    <input className="insHex" aria-label={label + ' hex'} disabled={disabled} value={draft ?? hex.slice(1).toUpperCase()} onChange={e => setDraft(e.target.value)}
      onBlur={() => { const v = (draft || '').replace('#', ''); if (/^[0-9a-f]{6}$/i.test(v)) onColor('#' + v.toLowerCase()); setDraft(null); }}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
    {onOpacity && <NumField label={label + ' opacity'} value={Math.round(opacity * 100)} min={0} max={100} suffix="%" disabled={disabled} onChange={v => onOpacity(v / 100)} />}
  </div>;
}

// ─────────────────────────── Layers ───────────────────────────
export function LayersPanel({ doc, sel, act, hover, setHover }) {
  const [collapsed, setCollapsed] = useState({});
  const [renaming, setRenaming] = useState(null);
  const [drop, setDrop] = useState(null);
  const nodes = doc.nodes, selSet = new Set(sel);
  const expandedAuto = new Set(); for (const id of sel) for (let p = nodes[id]?.parent; p; p = nodes[p]?.parent) expandedAuto.add(p);
  const isOpen = n => collapsed[n.id] === true ? false : collapsed[n.id] === false ? true : expandedAuto.has(n.id) || (!n.parent && !isInstanceRoot(n));
  const rows = [];
  const walk = (ids, depth) => { for (let i = ids.length - 1; i >= 0; i--) { const n = nodes[ids[i]]; if (!n) continue; rows.push([n, depth]); if (n.children?.length && isOpen(n)) walk(n.children, depth + 1); } };
  walk(doc.root, 0);
  const onDragOver = (e, n) => {
    if (!e.dataTransfer.types.includes('text/x-web-layer')) return;
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect(), f = (e.clientY - r.top) / r.height;
    const container = (n.type === 'frame' || n.type === 'group') && !n.componentId && !n.ref;
    setDrop({ id: n.id, where: container && f > 0.3 && f < 0.7 ? 'inside' : f < 0.5 ? 'above' : 'below' });
  };
  const onDrop = (e, n) => {
    e.preventDefault(); const ids = JSON.parse(e.dataTransfer.getData('text/x-web-layer') || '[]'); const d = drop; setDrop(null);
    if (!d || !ids.length || ids.includes(n.id)) return;
    if (d.where === 'inside') act.moveTo(ids, n.id, null);
    else { const list = n.parent ? nodes[n.parent].children : doc.root; const i = list.indexOf(n.id); act.moveTo(ids, n.parent || null, d.where === 'above' ? i + 1 : i); }
  };
  return <div className="wbLayers" role="tree" aria-label="Layers">
    {!rows.length && <p className="wbEmpty">No layers yet. Pick the Frame tool (F) and drag on the canvas, or choose a device preset.</p>}
    {rows.map(([n, depth]) => {
      const Icon = iconFor(n); const locked = n.locked, hidden = n.visible === false;
      const inInst = !!n.ref;
      return <div key={n.id} role="treeitem" aria-selected={selSet.has(n.id)} aria-label={n.name} data-layer={n.id}
        className={'wbLayer' + (selSet.has(n.id) ? ' sel' : '') + (hover === n.id ? ' hov' : '') + (hidden ? ' hidden' : '') + (n.isComponent || n.componentId ? ' comp' : '') + (drop?.id === n.id ? ' drop-' + drop.where : '')}
        style={{ paddingLeft: 6 + depth * 14 }} draggable={!inInst && renaming !== n.id}
        onDragStart={e => { const ids = selSet.has(n.id) ? sel : [n.id]; e.dataTransfer.setData('text/x-web-layer', JSON.stringify(ids)); e.dataTransfer.effectAllowed = 'move'; }}
        onDragOver={e => onDragOver(e, n)} onDragLeave={() => setDrop(null)} onDrop={e => onDrop(e, n)}
        onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)}
        onClick={e => act.select(e.shiftKey || e.metaKey || e.ctrlKey ? (selSet.has(n.id) ? sel.filter(x => x !== n.id) : [...sel, n.id]) : [n.id])}>
        {n.children?.length ? <button className="wbTwisty" aria-label={(isOpen(n) ? 'Collapse ' : 'Expand ') + n.name} onClick={e => { e.stopPropagation(); setCollapsed(c => ({ ...c, [n.id]: isOpen(n) })); }}>{isOpen(n) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</button> : <span className="wbTwisty" />}
        <Icon size={13} className="wbLayerIcon" />
        {renaming === n.id
          ? <input className="wbRename" aria-label={'Rename ' + n.name} autoFocus defaultValue={n.name} onClick={e => e.stopPropagation()}
            onBlur={e => { setRenaming(null); if (e.target.value.trim() && e.target.value !== n.name) act.rename(n.id, e.target.value.trim()); }}
            onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { e.currentTarget.value = n.name; e.currentTarget.blur(); } e.stopPropagation(); }} />
          : <span className="wbLayerName" onDoubleClick={e => { e.stopPropagation(); if (!inInst) setRenaming(n.id); }}>{n.name}</span>}
        <span className="wbLayerTools">
          {!inInst && <button aria-label={(locked ? 'Unlock ' : 'Lock ') + n.name} className={locked ? 'on' : ''} onClick={e => { e.stopPropagation(); act.patch([n.id], { locked: !locked }, locked ? 'Unlock layer' : 'Lock layer'); }}>{locked ? <Lock size={12} /> : <Unlock size={12} />}</button>}
          <button aria-label={(hidden ? 'Show ' : 'Hide ') + n.name} className={hidden ? 'on' : ''} onClick={e => { e.stopPropagation(); act.patch([n.id], { visible: hidden }, hidden ? 'Show layer' : 'Hide layer'); }}>{hidden ? <EyeOff size={12} /> : <Eye size={12} />}</button>
        </span>
      </div>;
    })}
  </div>;
}

// ─────────────────────────── Assets ───────────────────────────
export function AssetsPanel({ doc, sel, act }) {
  const comps = Object.values(doc.nodes).filter(n => n.isComponent);
  const first = doc.nodes[sel[0]];
  const textSel = sel.map(id => doc.nodes[id]).filter(n => n?.type === 'text');
  return <div className="wbAssets">
    <Section title="Components">
      {!comps.length && <p className="insHint">Select layers and press Ctrl+Alt+K to create a component.</p>}
      {comps.map(c => <div key={c.id} className="wbAssetRow">
        <Component size={13} className="wbCompIcon" />
        <button className="wbLinkBtn" aria-label={'Go to component ' + c.name} onClick={() => act.goTo(c.id)}>{c.name}</button>
        <Btn label={'Insert instance of ' + c.name} onClick={() => act.insertInstance(c.id)}><Plus size={13} /> Instance</Btn>
      </div>)}
    </Section>
    <Section title="Color styles" right={<IconBtn label="Create color style from selection" disabled={!first || !(first.fill || first.stroke)} onClick={() => act.createColorStyle()}><Plus size={14} /></IconBtn>}>
      {!(doc.styles?.colors || []).length && <p className="insHint">Select a layer with a fill and press + to save its colour as a shared style.</p>}
      {(doc.styles?.colors || []).map(s => <div key={s.id} className="wbStyleRow">
        <input type="color" aria-label={`Color style ${s.name} color`} value={s.color} onChange={e => act.updateStyle('colors', s.id, { color: e.target.value }, 'Edit color style')} />
        <input className="wbStyleName" aria-label={`Color style ${s.name} name`} defaultValue={s.name} key={s.name} onBlur={e => e.target.value.trim() && e.target.value !== s.name && act.updateStyle('colors', s.id, { name: e.target.value.trim() }, 'Rename style')} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
        <small>{styleUsers(doc, 'colors', s.id).length}</small>
        <IconBtn label={`Apply color style ${s.name}`} disabled={!sel.length} onClick={() => act.applyColorStyle(s.id)}><Plus size={13} /></IconBtn>
        <IconBtn label={`Delete color style ${s.name}`} onClick={() => act.deleteStyle('colors', s.id)}><Trash2 size={13} /></IconBtn>
      </div>)}
    </Section>
    <Section title="Text styles" right={<IconBtn label="Create text style from selection" disabled={!textSel.length} onClick={() => act.createTextStyle()}><Plus size={14} /></IconBtn>}>
      {!(doc.styles?.texts || []).length && <p className="insHint">Select a text layer and press + to save its typography as a shared style.</p>}
      {(doc.styles?.texts || []).map(s => <div key={s.id} className="wbTextStyle">
        <div className="wbStyleRow">
          <Type size={13} />
          <input className="wbStyleName" aria-label={`Text style ${s.name} name`} defaultValue={s.name} key={s.name} onBlur={e => e.target.value.trim() && e.target.value !== s.name && act.updateStyle('texts', s.id, { name: e.target.value.trim() }, 'Rename style')} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
          <small>{styleUsers(doc, 'texts', s.id).length}</small>
          <IconBtn label={`Apply text style ${s.name}`} disabled={!textSel.length} onClick={() => act.applyTextStyle(s.id)}><Plus size={13} /></IconBtn>
          <IconBtn label={`Delete text style ${s.name}`} onClick={() => act.deleteStyle('texts', s.id)}><Trash2 size={13} /></IconBtn>
        </div>
        <div className="insPair">
          <NumField label={`Text style ${s.name} size`} glyph="S" value={s.fontSize} min={1} onChange={v => act.updateStyle('texts', s.id, { fontSize: v }, 'Edit text style')} />
          <Select label={`Text style ${s.name} weight`} value={s.fontWeight} options={WEIGHTS} onChange={v => act.updateStyle('texts', s.id, { fontWeight: +v }, 'Edit text style')} />
        </div>
      </div>)}
    </Section>
    <Section title="Templates" defaultOpen={false}>
      {WEB_TEMPLATES.map(t => <button key={t.id} className="wbPreset" aria-label={'Insert template ' + t.name} onClick={() => act.insertTemplate(t.id)}><span>{t.name}</span><small>{t.description}</small></button>)}
    </Section>
  </div>;
}

const WEIGHTS = [[100, 'Thin'], [300, 'Light'], [400, 'Regular'], [500, 'Medium'], [600, 'Semibold'], [700, 'Bold'], [800, 'Extra bold'], [900, 'Black']];

// ─────────────────────────── Design ───────────────────────────
const ALIGN_LABEL = a => a === 'center' ? 'center' : a.replace('-', ' ');
const EFFECT_TYPES = [['drop-shadow', 'Drop shadow'], ['inner-shadow', 'Inner shadow'], ['layer-blur', 'Layer blur'], ['background-blur', 'Background blur']];

export function FramePresets({ act }) {
  return <Section title="Frame presets">
    {['Desktop', 'Tablet', 'Phone', 'Other'].map(g => <div key={g} className="wbPresetGroup"><h5>{g}</h5>
      {DEVICE_PRESETS.filter(p => p.group === g).map(p => <button key={p.name} className="wbPreset" aria-label={`Frame preset ${p.name}`} onClick={() => act.addFramePreset(p)}><span>{p.name}</span><small>{p.w} × {p.h}</small></button>)}
    </div>)}
  </Section>;
}

export function DesignPanel({ doc, sel, act, tool, exportScale, setExportScale }) {
  const nodes = doc.nodes;
  const list = sel.map(id => nodes[id]).filter(Boolean);
  if (!list.length) return <div className="wbDesign">
    {tool === 'frame' && <FramePresets act={act} />}
    <Section title="Canvas"><Row label="Background"><ColorField label="Canvas background" color={doc.canvasBg} onColor={c => act.setDoc({ canvasBg: c }, 'Canvas background')} /></Row></Section>
    {tool !== 'frame' && <FramePresets act={act} />}
  </div>;
  const n = list[0], single = list.length === 1;
  const par = n.parent ? nodes[n.parent] : null;
  const owner = n.ref ? ownerInstance(nodes, n.id) : null;
  const locked = !!owner; // generated instance children: only overrides
  const ids = list.map(x => x.id);
  const patch = (p, label) => act.patch(ids, p, label);
  const Icon = iconFor(n);
  const kinds = new Set(list.map(x => x.type));
  const allText = kinds.size === 1 && kinds.has('text');
  const hasFill = list.every(x => x.type !== 'line' && x.type !== 'group');
  const radiusOK = list.every(x => ['frame', 'rect', 'image'].includes(x.type));
  const radius = Array.isArray(n.radius) ? n.radius : [n.radius || 0, n.radius || 0, n.radius || 0, n.radius || 0];
  const [perCorner, setPerCorner] = [Array.isArray(n.radius), v => patch({ radius: v ? radius : radius[0] }, 'Corner radius')];
  return <div className="wbDesign">
    <div className="insTitle"><Icon size={16} /><span>{single ? n.name : `${list.length} layers`}</span><small>{single ? typeLabel(n) : 'Mixed'}</small></div>
    {owner && <p className="insHint wbNote">Part of instance “{nodes[owner].name}”. Text, fill and visibility changes are kept as overrides; edit the main component for everything else.</p>}
    <div className="insBlock">
      <Row label="Align"><div className="insIcons" role="group" aria-label="Align layers">
        <IconBtn label="Align left" disabled={locked} onClick={() => act.align('left')}><AlignStartVertical size={15} /></IconBtn>
        <IconBtn label="Align horizontal centers" disabled={locked} onClick={() => act.align('hcenter')}><AlignCenterVertical size={15} /></IconBtn>
        <IconBtn label="Align right" disabled={locked} onClick={() => act.align('right')}><AlignEndVertical size={15} /></IconBtn>
        <IconBtn label="Align top" disabled={locked} onClick={() => act.align('top')}><AlignStartHorizontal size={15} /></IconBtn>
        <IconBtn label="Align vertical centers" disabled={locked} onClick={() => act.align('vcenter')}><AlignCenterHorizontal size={15} /></IconBtn>
        <IconBtn label="Align bottom" disabled={locked} onClick={() => act.align('bottom')}><AlignEndHorizontal size={15} /></IconBtn>
        {list.length > 2 && <><IconBtn label="Distribute horizontal spacing" onClick={() => act.distribute('h')}><AlignHorizontalSpaceBetween size={15} /></IconBtn>
          <IconBtn label="Distribute vertical spacing" onClick={() => act.distribute('v')}><AlignVerticalSpaceBetween size={15} /></IconBtn></>}
      </div></Row>
      {single && <>
        <Row label="Position"><NumField label="X" glyph="X" value={n.x} disabled={locked || !!par?.layout && !n.ignoreLayout} onChange={v => act.resize(n.id, { x: v }, 'Move')} /><NumField label="Y" glyph="Y" value={n.y} disabled={locked || !!par?.layout && !n.ignoreLayout} onChange={v => act.resize(n.id, { y: v }, 'Move')} /></Row>
        <Row label="Size"><NumField label="Width" glyph="W" value={n.w} min={0} disabled={locked || n.type === 'group' && false} onChange={v => act.resize(n.id, { w: v }, 'Resize')} />
          {n.type !== 'line' ? <NumField label="Height" glyph="H" value={n.h} min={0} disabled={locked} onChange={v => act.resize(n.id, { h: v }, 'Resize')} /> : <NumField label="Stroke weight" glyph="S" value={n.strokeWidth} min={0} onChange={v => patch({ strokeWidth: v }, 'Stroke weight')} />}</Row>
        <Row label="Rotation"><NumField label="Rotation" glyph="°" value={n.rotation || 0} step={1} disabled={locked || !!par?.layout && !n.ignoreLayout} onChange={v => act.resize(n.id, { rotation: ((v % 360) + 360) % 360 }, 'Rotate')} />
          <NumField label="Opacity" glyph="%" value={Math.round((n.opacity ?? 1) * 100)} min={0} max={100} disabled={locked} onChange={v => patch({ opacity: v / 100 }, 'Opacity')} /></Row>
      </>}
    </div>

    {single && !locked && par && !par.layout && par.type === 'frame' && <Section title="Constraints">
      <Row label="Horizontal"><Select label="Horizontal constraint" value={n.constraints?.h || 'left'} options={[['left', 'Left'], ['right', 'Right'], ['left-right', 'Left & right'], ['center', 'Center'], ['scale', 'Scale']]} onChange={v => patch({ constraints: { ...n.constraints, h: v } }, 'Constraints')} /></Row>
      <Row label="Vertical"><Select label="Vertical constraint" value={n.constraints?.v || 'top'} options={[['top', 'Top'], ['bottom', 'Bottom'], ['top-bottom', 'Top & bottom'], ['center', 'Center'], ['scale', 'Scale']]} onChange={v => patch({ constraints: { ...n.constraints, v: v } }, 'Constraints')} /></Row>
    </Section>}

    {single && !locked && (par?.layout || n.layout || n.type === 'text') && <Section title="Sizing">
      {(() => {
        const opts = axis => [['fixed', 'Fixed'], ...((n.layout || n.type === 'text') ? [['hug', 'Hug contents']] : []), ...(par?.layout && !n.ignoreLayout ? [['fill', 'Fill container']] : [])];
        const setSz = (axis, v) => {
          const s = { ...(n.sizing || {}), [axis]: v }; const p = { sizing: s };
          if (n.type === 'text') { if (axis === 'h') p.textMode = v === 'hug' ? 'auto-width' : 'auto-height'; if (axis === 'v') p.textMode = v === 'hug' ? (s.h === 'hug' ? 'auto-width' : 'auto-height') : 'fixed'; }
          patch(p, 'Sizing');
        };
        const val = axis => { const v = n.sizing?.[axis] || 'fixed'; return opts(axis).some(o => o[0] === v) ? v : 'fixed'; };
        return <><Row label="Width"><Select label="Width sizing" value={val('h')} options={opts('h')} onChange={v => setSz('h', v)} /></Row>
          <Row label="Height"><Select label="Height sizing" value={val('v')} options={opts('v')} onChange={v => setSz('v', v)} /></Row></>;
      })()}
      {par?.layout && <label className="wbCheck"><input type="checkbox" checked={!!n.ignoreLayout} onChange={e => patch({ ignoreLayout: e.target.checked }, 'Ignore auto layout')} /> Ignore auto layout (absolute position)</label>}
    </Section>}

    {single && n.type === 'frame' && !locked && <Section title="Auto layout" right={n.layout
      ? <IconBtn label="Remove auto layout" onClick={() => act.setLayout(n.id, null, 'Remove auto layout')}><Minus size={14} /></IconBtn>
      : <IconBtn label="Add auto layout" onClick={() => act.addAutoLayout()}><Plus size={14} /></IconBtn>}>
      {!n.layout ? <p className="insHint">Shift+A adds auto layout: children flow in a row or column with gap and padding.</p> : <AutoLayoutFields n={n} act={act} />}
    </Section>}

    {single && n.type === 'frame' && !locked && <Section title="Frame">
      <label className="wbCheck"><input type="checkbox" checked={!!n.clip} onChange={e => patch({ clip: e.target.checked }, 'Clip content')} /> Clip content</label>
    </Section>}

    {radiusOK && !locked && <Section title="Corner radius" right={<IconBtn label="Independent corners" on={perCorner} onClick={() => setPerCorner(!perCorner)}><Square size={13} /></IconBtn>}>
      {perCorner ? <div className="insCorners">{['Top left', 'Top right', 'Bottom right', 'Bottom left'].map((l, i) => <NumField key={l} label={'Radius ' + l.toLowerCase()} value={radius[i]} min={0} onChange={v => { const r = [...radius]; r[i] = v; patch({ radius: r }, 'Corner radius'); }} />)}</div>
        : <NumField label="Corner radius" glyph="R" value={radius[0]} min={0} onChange={v => patch({ radius: v }, 'Corner radius')} />}
    </Section>}

    {allText && <TextFields n={n} patch={patch} doc={doc} act={act} locked={locked} ids={ids} />}

    {hasFill && n.type !== 'text' && <Section title="Fill" right={n.fill ? (!locked && <IconBtn label="Remove fill" onClick={() => patch({ fill: null }, 'Remove fill')}><Minus size={14} /></IconBtn>) : <IconBtn label="Add fill" onClick={() => patch({ fill: '#d9d9d9', fillOpacity: 1 }, 'Add fill')}><Plus size={14} /></IconBtn>}>
      {n.fill ? <FillField n={n} doc={doc} patch={patch} act={act} /> : <p className="insHint">No fill.</p>}
    </Section>}

    {!locked && n.type !== 'group' && n.type !== 'text' && <Section title="Stroke" right={n.stroke && n.type !== 'line' ? <IconBtn label="Remove stroke" onClick={() => patch({ stroke: null }, 'Remove stroke')}><Minus size={14} /></IconBtn> : !n.stroke ? <IconBtn label="Add stroke" onClick={() => patch({ stroke: '#111111', strokeWidth: n.strokeWidth || 1 }, 'Add stroke')}><Plus size={14} /></IconBtn> : null}>
      {n.stroke ? <><ColorField label="Stroke color" color={n.stroke} onColor={c => patch({ stroke: c }, 'Stroke color')} />
        <NumField label="Stroke width" glyph="W" value={n.strokeWidth} min={0} onChange={v => patch({ strokeWidth: v }, 'Stroke width')} /><p className="insHint">Strokes are drawn inside the layer.</p></> : <p className="insHint">No stroke.</p>}
    </Section>}

    {!locked && <EffectsSection n={n} patch={patch} />}

    {single && n.type === 'image' && !locked && <Section title="Image">
      <Seg label="Image fit" value={n.fit || 'fill'} options={[['fill', 'Fill'], ['fit', 'Fit'], ['crop', 'Crop']]} onChange={v => patch({ fit: v }, 'Image fit')} />
      {n.fit === 'crop' && <>
        <ValueSlider label="Crop zoom" value={Math.round((n.crop?.scale || 1) * 100)} min={100} max={400} onChange={v => patch({ crop: { ...n.crop, scale: v / 100 } }, 'Crop image')} />
        <ValueSlider label="Crop horizontal" value={Math.round((n.crop?.x ?? 0.5) * 100)} min={0} max={100} onChange={v => patch({ crop: { ...n.crop, x: v / 100 } }, 'Crop image')} />
        <ValueSlider label="Crop vertical" value={Math.round((n.crop?.y ?? 0.5) * 100)} min={0} max={100} onChange={v => patch({ crop: { ...n.crop, y: v / 100 } }, 'Crop image')} />
      </>}
      <Btn label="Replace image" onClick={() => act.replaceImage(n.id)}><ImageIcon size={13} /> Replace image…</Btn>
    </Section>}

    {single && (n.isComponent || n.componentId) && <Section title={n.isComponent ? 'Main component' : 'Instance'}>
      {n.isComponent && <p className="insHint">{Object.values(nodes).filter(x => x.componentId === n.id && !x.ref).length} instance(s). Edits here update every instance.</p>}
      {n.componentId && <>
        <Btn label="Go to main component" disabled={!nodes[n.componentId]} onClick={() => act.goTo(n.componentId)}><Crosshair size={13} /> Go to main component</Btn>
        {isInstanceRoot(n) && <>
          <Btn label="Reset overrides" disabled={!Object.keys(n.overrides || {}).length} onClick={() => act.resetOverrides(n.id)}><RotateCcw size={13} /> Reset overrides</Btn>
          <Btn label="Detach instance" onClick={() => act.detach(n.id)}><Unlink size={13} /> Detach instance</Btn></>}
      </>}
    </Section>}
    {!n.componentId && !n.isComponent && !locked && <Section title="Component" defaultOpen={false}><Btn label="Create component" onClick={() => act.createComponent()}><Component size={13} /> Create component (Ctrl+Alt+K)</Btn></Section>}

    {single && <ExportSection n={n} act={act} scale={exportScale} setScale={setExportScale} />}
  </div>;
}

function FillField({ n, doc, patch, act }) {
  const style = n.fillStyle && (doc.styles?.colors || []).find(s => s.id === n.fillStyle);
  if (style) return <div className="wbStyleChip"><span className="wbSwatch" style={{ background: style.color }} /><span>{style.name}</span>
    <IconBtn label="Detach color style" onClick={() => patch({ fill: n.fill, fillStyle: undefined }, 'Detach style')}><Link2Off size={13} /></IconBtn></div>;
  return <ColorField label="Fill color" color={n.fill} opacity={n.fillOpacity ?? 1} onColor={c => patch({ fill: c }, 'Fill color')} onOpacity={o => patch({ fill: n.fill, fillOpacity: o }, 'Fill opacity')} />;
}

function AutoLayoutFields({ n, act }) {
  const L = n.layout, pad = padArray(L.padding);
  const set = (p, label) => act.setLayout(n.id, { ...L, ...p }, label);
  return <>
    <Row label="Direction"><Seg label="Layout direction" icons value={L.direction} options={[['horizontal', 'Horizontal', ArrowRight], ['vertical', 'Vertical', ArrowDown]]} onChange={v => set({ direction: v }, 'Layout direction')} />
      <IconBtn label="Wrap" on={!!L.wrap} onClick={() => set({ wrap: !L.wrap }, L.wrap ? 'No wrap' : 'Wrap')}><WrapText size={15} /></IconBtn></Row>
    <Row label="Spacing"><NumField label="Gap" glyph="↔" value={L.gap} disabled={L.distribute === 'space-between'} onChange={v => set({ gap: v }, 'Gap')} />
      {L.wrap && <NumField label="Row gap" glyph="↕" value={L.wrapGap ?? L.gap} onChange={v => set({ wrapGap: v }, 'Row gap')} />}</Row>
    <Row label="Distribute"><Seg label="Distribution" value={L.distribute || 'packed'} options={[['packed', 'Packed'], ['space-between', 'Space between']]} onChange={v => set({ distribute: v }, 'Distribution')} /></Row>
    <div className="wbAlignRow">
      <div className="wbAlign9" role="group" aria-label="Alignment">
        {ALIGNS.map(a => <button key={a} aria-label={'Align ' + ALIGN_LABEL(a)} aria-pressed={L.align === a} className={L.align === a ? 'on' : ''} onClick={() => set({ align: a }, 'Alignment')}><i /></button>)}
      </div>
      <div className="wbPad">
        {['Top', 'Right', 'Bottom', 'Left'].map((s, i) => <NumField key={s} label={'Padding ' + s.toLowerCase()} glyph={s[0]} value={pad[i]} min={0} onChange={v => { const p = [...pad]; p[i] = v; set({ padding: p }, 'Padding'); }} />)}
      </div>
    </div>
  </>;
}

function TextFields({ n, patch, doc, act, locked }) {
  const style = n.textStyle && (doc.styles?.texts || []).find(s => s.id === n.textStyle);
  const [draft, setDraft] = useState(null);
  return <Section title="Text">
    <textarea className="insText" aria-label="Text content" value={draft ?? n.text} onChange={e => setDraft(e.target.value)} onBlur={() => { if (draft != null && draft !== n.text) patch({ text: draft }, 'Edit text'); setDraft(null); }} />
    <ColorField label="Text color" color={n.fill} opacity={n.fillOpacity ?? 1} onColor={c => patch({ fill: c }, 'Text color')} onOpacity={o => patch({ fill: n.fill, fillOpacity: o }, 'Text opacity')} />
    {!locked && <>
      {style ? <div className="wbStyleChip"><Type size={13} /><span>{style.name}</span><IconBtn label="Detach text style" onClick={() => patch({ textStyle: undefined }, 'Detach style')}><Link2Off size={13} /></IconBtn></div> : <>
        <Select label="Font family" value={n.fontFamily} options={FONTS.includes(n.fontFamily) ? FONTS.map(f => [f, f.split(',')[0]]) : [[n.fontFamily, n.fontFamily.split(',')[0]], ...FONTS.map(f => [f, f.split(',')[0]])]} onChange={v => patch({ fontFamily: v }, 'Font')} />
        <div className="insPair"><Select label="Font weight" value={n.fontWeight} options={WEIGHTS} onChange={v => patch({ fontWeight: +v }, 'Font weight')} />
          <NumField label="Font size" glyph="S" value={n.fontSize} min={1} onChange={v => patch({ fontSize: v }, 'Font size')} /></div>
        <div className="insPair"><NumField label="Line height" glyph="LH" value={n.lineHeight ?? ''} placeholder="Auto" min={0} onChange={v => patch({ lineHeight: v || null }, 'Line height')} />
          <NumField label="Letter spacing" glyph="LS" value={n.letterSpacing || 0} step={0.1} onChange={v => patch({ letterSpacing: v }, 'Letter spacing')} /></div>
      </>}
      <div className="wbTextRow">
        <Seg label="Text align" icons value={n.align || 'left'} options={[['left', 'Align text left', AlignLeft], ['center', 'Align text center', AlignCenter], ['right', 'Align text right', AlignRight]]} onChange={v => patch({ align: v }, 'Text align')} />
        <IconBtn label="Italic" on={!!n.italic} onClick={() => patch({ italic: !n.italic }, 'Italic')}><Italic size={14} /></IconBtn>
      </div>
      <Seg label="Text resizing" value={n.textMode} options={[['auto-width', 'Auto width'], ['auto-height', 'Auto height'], ['fixed', 'Fixed']]}
        onChange={v => patch({ textMode: v, sizing: { h: v === 'auto-width' ? 'hug' : n.sizing?.h === 'fill' ? 'fill' : 'fixed', v: v === 'fixed' ? (n.sizing?.v === 'fill' ? 'fill' : 'fixed') : 'hug' } }, 'Text resizing')} />
    </>}
  </Section>;
}

function EffectsSection({ n, patch }) {
  const fx = n.effects || [];
  const set = (i, p) => patch({ effects: fx.map((e, j) => j === i ? { ...e, ...p } : e) }, 'Edit effect');
  return <Section title="Effects" defaultOpen={fx.length > 0} right={<IconBtn label="Add effect" onClick={() => patch({ effects: [...fx, { type: 'drop-shadow', x: 0, y: 4, blur: 12, spread: 0, color: '#000000', opacity: 0.25, visible: true }] }, 'Add effect')}><Plus size={14} /></IconBtn>}>
    {!fx.length && <p className="insHint">Drop and inner shadows, layer blur and background blur.</p>}
    {fx.map((e, i) => <div key={i} className="wbEffect">
      <div className="wbEffectHead"><Select label={`Effect ${i + 1} type`} value={e.type} options={EFFECT_TYPES} onChange={v => set(i, { type: v })} />
        <IconBtn label={`${e.visible === false ? 'Show' : 'Hide'} effect ${i + 1}`} on={e.visible !== false} onClick={() => set(i, { visible: e.visible === false })}>{e.visible === false ? <EyeOff size={13} /> : <Eye size={13} />}</IconBtn>
        <IconBtn label={`Remove effect ${i + 1}`} onClick={() => patch({ effects: fx.filter((_, j) => j !== i) }, 'Remove effect')}><Trash2 size={13} /></IconBtn></div>
      {e.type.endsWith('shadow') ? <>
        <div className="insCorners"><NumField label={`Effect ${i + 1} X`} glyph="X" value={e.x} onChange={v => set(i, { x: v })} /><NumField label={`Effect ${i + 1} Y`} glyph="Y" value={e.y} onChange={v => set(i, { y: v })} />
          <NumField label={`Effect ${i + 1} blur`} glyph="B" value={e.blur} min={0} onChange={v => set(i, { blur: v })} /><NumField label={`Effect ${i + 1} spread`} glyph="S" value={e.spread} onChange={v => set(i, { spread: v })} /></div>
        <ColorField label={`Effect ${i + 1} color`} color={e.color} opacity={e.opacity ?? 0.25} onColor={c => set(i, { color: c })} onOpacity={o => set(i, { opacity: o })} />
      </> : <NumField label={`Effect ${i + 1} blur`} glyph="B" value={e.blur} min={0} onChange={v => set(i, { blur: v })} />}
    </div>)}
  </Section>;
}

function ExportSection({ n, act, scale, setScale }) {
  const [fmt, setFmt] = useState('png');
  return <Section title="Export" defaultOpen={true}>
    <div className="exportFormats"><Seg label="Export format" value={fmt} options={[['png', 'PNG'], ['svg', 'SVG']]} onChange={setFmt} />
      {fmt === 'png' && <Seg label="Export scale" value={scale} options={[[1, '1×'], [2, '2×'], [3, '3×']]} onChange={setScale} />}</div>
    <Btn label={`Export ${fmt.toUpperCase()}`} className="primary" onClick={() => act.exportNode(n.id, fmt, scale)}><Download size={13} /> Export {n.name}</Btn>
    {n.type === 'frame' && <Btn label="Export frame as HTML" onClick={() => act.exportHtml(n.id)}><Download size={13} /> Export frame as HTML + CSS</Btn>}
  </Section>;
}

// ─────────────────────────── Prototype ───────────────────────────
export function PrototypePanel({ doc, sel, act }) {
  const frames = doc.root.map(id => doc.nodes[id]).filter(n => n?.type === 'frame');
  const n = sel.length === 1 ? doc.nodes[sel[0]] : null;
  const p = n?.proto;
  return <div className="wbDesign">
    <Section title="Flow">
      <Row label="Start"><Select label="Starting frame" value={doc.startFrame || frames[0]?.id || ''} options={frames.length ? frames.map(f => [f.id, f.name]) : [['', 'No frames']]} onChange={v => act.setDoc({ startFrame: v }, 'Starting frame')} /></Row>
      <Btn label="Present prototype" className="primary" disabled={!frames.length} onClick={() => act.present()}><Play size={13} /> Present</Btn>
    </Section>
    {n ? <Section title="Interaction">
      <p className="insHint">On click → Navigate to</p>
      <Select label="Navigate to" value={p?.target || ''} options={[['', 'None'], ...frames.filter(f => f.id !== n.id).map(f => [f.id, f.name])]}
        onChange={v => act.patch([n.id], { proto: v ? { transition: 'instant', duration: 300, ...(p || {}), target: v } : undefined }, v ? 'Add prototype link' : 'Remove prototype link')} />
      {p && <>
        <Row label="Animation"><Select label="Transition" value={p.transition || 'instant'} options={[['instant', 'Instant'], ['dissolve', 'Dissolve'], ['slide-left', 'Slide left'], ['slide-right', 'Slide right']]} onChange={v => act.patch([n.id], { proto: { ...p, transition: v } }, 'Transition')} /></Row>
        {p.transition !== 'instant' && <Row label="Duration"><NumField label="Transition duration" value={p.duration ?? 300} min={0} max={5000} suffix="ms" onChange={v => act.patch([n.id], { proto: { ...p, duration: v } }, 'Transition duration')} /></Row>}
      </>}
    </Section> : <Section title="Interaction"><p className="insHint">Select one layer to link it to a frame.</p></Section>}
  </div>;
}

// ─────────────────────────── Inspect ───────────────────────────
export function InspectPanel({ doc, sel, act }) {
  const n = sel.length === 1 ? doc.nodes[sel[0]] : null;
  if (!n) return <div className="wbDesign"><Section title="Inspect"><p className="insHint">Select one layer to see its CSS.</p></Section></div>;
  const css = cssForNode(doc, n.id);
  return <div className="wbDesign">
    <Section title="CSS">
      <pre className="wbCode" aria-label="Generated CSS">{css}</pre>
      <Btn label="Copy CSS" className="primary" onClick={() => act.copyCss(n.id)}><Copy size={13} /> Copy CSS</Btn>
    </Section>
    {n.type === 'frame' && <Section title="Code export"><Btn label="Export frame as HTML" onClick={() => act.exportHtml(n.id)}><Download size={13} /> Export frame as HTML + CSS</Btn>
      <p className="insHint">One self-contained .html file. Auto layout frames become flexbox, other frames use absolute positioning.</p></Section>}
  </div>;
}
