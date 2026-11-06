import AngleDial from './AngleDial.jsx';
import React, { useState } from 'react';
import { FX_LABELS, FX_TYPES, MULTI, newEffect, normalizeStyle, CONTOURS, PATTERNS, GLOBAL_LIGHT } from '../engine/styles.js';

// Layer Style dialog. Edits are live (the parent applies them without history) until OK or Cancel.
const BLENDS = [['normal', 'Normal'], ['multiply', 'Multiply'], ['color-burn', 'Color Burn'], ['darken', 'Darken'], ['screen', 'Screen'], ['color-dodge', 'Color Dodge'], ['lighten', 'Lighten'], ['overlay', 'Overlay'], ['soft-light', 'Soft Light'], ['hard-light', 'Hard Light'], ['difference', 'Difference'], ['exclusion', 'Exclusion'], ['hue', 'Hue'], ['saturation', 'Saturation'], ['color', 'Color'], ['luminosity', 'Luminosity']];
const CONTOUR_OPTS = Object.keys(CONTOURS).map(k => [k, k.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase())]);
const BUILTIN_STYLES = {
  'Soft shadow': { effects: [{ type: 'dropShadow', opacity: 45, distance: 8, size: 18 }] },
  'Outline': { effects: [{ type: 'stroke', size: 4, color: '#111111' }] },
  'Neon glow': { effects: [{ type: 'outerGlow', color: '#7cf7ff', size: 22, opacity: 90 }, { type: 'innerGlow', color: '#ffffff', size: 6 }] },
  'Embossed': { effects: [{ type: 'bevel', size: 8, depth: 160 }, { type: 'dropShadow', opacity: 40, distance: 4, size: 6 }] },
  'Gold': { effects: [{ type: 'gradientOverlay', gradFrom: '#7a5310', gradTo: '#ffe08a', angle: 90 }, { type: 'bevel', size: 6, depth: 200, hiColor: '#fff5cc' }, { type: 'stroke', size: 2, color: '#5b3d08' }] },
  'Glass': { blending: { fillOpacity: 20 }, effects: [{ type: 'innerShadow', opacity: 50, size: 10, distance: 0, color: '#ffffff', blend: 'screen' }, { type: 'stroke', size: 1, color: '#ffffff', opacity: 70 }] },
};
const loadUserStyles = () => { try { return JSON.parse(localStorage.getItem('zertake-styles') || '{}'); } catch { return {}; } };

const Num = ({ label, value, set, min = 0, max = 100, step = 1, unit }) => unit === '°' && max - min === 360
  ? <label className="lsField dialField"><span>{label}</span><AngleDial label={label} value={value} onChange={set} min={min} max={max} /><input type="number" aria-label={label + ' value'} min={min} max={max} step={step} value={value} onChange={e => { const v = +e.target.value; if (Number.isFinite(v)) set(Math.max(min, Math.min(max, v))); }} /><small>°</small></label>
  : <label className="lsField"><span>{label}</span><input type="range" aria-label={label} min={min} max={max} step={step} value={value} style={{ '--hi': ((value - min) / (max - min) * 100) + '%' }} onChange={e => set(+e.target.value)} /><input type="number" aria-label={label + ' value'} min={min} max={max} step={step} value={value} onChange={e => { const v = +e.target.value; if (Number.isFinite(v)) set(Math.max(min, Math.min(max, v))); }} />{unit && <small>{unit}</small>}</label>;
const Sel = ({ label, value, set, options }) => <label className="lsField"><span>{label}</span><select aria-label={label} value={value} onChange={e => set(e.target.value)}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>;
const Col = ({ label, value, set }) => <label className="lsField"><span>{label}</span><input type="color" aria-label={label} value={value} onChange={e => set(e.target.value)} /></label>;
const Chk = ({ label, value, set, disabled, title }) => <label className="optCheck" title={title}><input type="checkbox" aria-label={label} disabled={disabled} checked={!!value} onChange={e => set(e.target.checked)} />{label}</label>;
function SplitRange({ label, value, set }) {
  // four handles: black lo/hi, white lo/hi (Alt-split in Photoshop); exposed as four number fields + two sliders
  const [b0, b1, w0, w1] = value;
  return <div className="lsBlendIf"><span>{label}</span>
    <div className="lsGrad" />
    <div className="lsSplit">
      <Num label={label + ' black'} value={b0} set={v => set([v, Math.max(v, b1), Math.max(Math.max(v, b1), w0), w1])} min={0} max={255} />
      <Num label={label + ' black split'} value={b1} set={v => set([Math.min(b0, v), v, Math.max(v, w0), w1])} min={0} max={255} />
      <Num label={label + ' white split'} value={w0} set={v => set([b0, Math.min(b1, v), v, Math.max(v, w1)])} min={0} max={255} />
      <Num label={label + ' white'} value={w1} set={v => set([b0, b1, Math.min(w0, v), v])} min={0} max={255} />
    </div></div>;
}

function EffectPanel({ e, set, light, setLight }) {
  const s = k => v => set({ ...e, [k]: v });
  const angle = <><Num label="Angle" value={e.useGlobal ? light.angle : e.angle} set={v => e.useGlobal ? setLight({ ...light, angle: v }) : set({ ...e, angle: v })} min={-180} max={180} unit="°" /><Chk label="Use Global Light" value={e.useGlobal} set={s('useGlobal')} /></>;
  const blend = <><Sel label="Blend Mode" value={e.blend} set={s('blend')} options={BLENDS} /><Num label="Opacity" value={e.opacity} set={s('opacity')} unit="%" /></>;
  const contour = <><Sel label="Contour" value={e.contour} set={s('contour')} options={CONTOUR_OPTS} /><Chk label="Anti-aliased" value={e.antiAlias} set={s('antiAlias')} /></>;
  const fillSrc = <><Sel label="Fill" value={e.fill} set={s('fill')} options={[['color', 'Color'], ['gradient', 'Gradient']]} />{e.fill === 'gradient' ? <><Col label="Gradient from" value={e.gradFrom} set={s('gradFrom')} /><Col label="Gradient to" value={e.gradTo} set={s('gradTo')} /></> : <Col label="Color" value={e.color} set={s('color')} />}</>;
  switch (e.type) {
    case 'dropShadow': return <><h4>Drop Shadow</h4><h5>Structure</h5>{blend}<Col label="Color" value={e.color} set={s('color')} />{angle}<Num label="Distance" value={e.distance} set={s('distance')} max={300} unit="px" /><Num label="Spread" value={e.spread} set={s('spread')} unit="%" /><Num label="Size" value={e.size} set={s('size')} max={250} unit="px" /><h5>Quality</h5>{contour}<Num label="Noise" value={e.noise} set={s('noise')} unit="%" /><Chk label="Layer Knocks Out Drop Shadow" value={e.knockout} set={s('knockout')} /></>;
    case 'innerShadow': return <><h4>Inner Shadow</h4><h5>Structure</h5>{blend}<Col label="Color" value={e.color} set={s('color')} />{angle}<Num label="Distance" value={e.distance} set={s('distance')} max={300} unit="px" /><Num label="Choke" value={e.choke} set={s('choke')} unit="%" /><Num label="Size" value={e.size} set={s('size')} max={250} unit="px" /><h5>Quality</h5>{contour}<Num label="Noise" value={e.noise} set={s('noise')} unit="%" /></>;
    case 'outerGlow': case 'innerGlow': return <><h4>{FX_LABELS[e.type]}</h4><h5>Structure</h5>{blend}<Num label="Noise" value={e.noise} set={s('noise')} unit="%" />{fillSrc}<h5>Elements</h5><Sel label="Technique" value={e.technique} set={s('technique')} options={[['softer', 'Softer'], ['precise', 'Precise']]} />{e.type === 'innerGlow' && <Sel label="Source" value={e.source} set={s('source')} options={[['center', 'Center'], ['edge', 'Edge']]} />}<Num label={e.type === 'innerGlow' ? 'Choke' : 'Spread'} value={e.type === 'innerGlow' ? e.choke : e.spread} set={s(e.type === 'innerGlow' ? 'choke' : 'spread')} unit="%" /><Num label="Size" value={e.size} set={s('size')} max={250} unit="px" /><h5>Quality</h5>{contour}<Num label="Range" value={e.range} set={s('range')} min={1} unit="%" /><Num label="Jitter" value={e.jitter} set={s('jitter')} unit="%" /></>;
    case 'bevel': return <><h4>Bevel & Emboss</h4><h5>Structure</h5><Sel label="Style" value={e.style} set={s('style')} options={[['outer', 'Outer Bevel'], ['inner', 'Inner Bevel'], ['emboss', 'Emboss'], ['pillow', 'Pillow Emboss'], ['stroke', 'Stroke Emboss']]} /><Sel label="Technique" value={e.technique} set={s('technique')} options={[['smooth', 'Smooth'], ['chiselHard', 'Chisel Hard'], ['chiselSoft', 'Chisel Soft']]} /><Num label="Depth" value={e.depth} set={s('depth')} min={1} max={1000} unit="%" /><Sel label="Direction" value={e.direction} set={s('direction')} options={[['up', 'Up'], ['down', 'Down']]} /><Num label="Size" value={e.size} set={s('size')} max={250} unit="px" /><Num label="Soften" value={e.soften} set={s('soften')} max={16} unit="px" />
      <h5>Shading</h5>{angle}<Num label="Altitude" value={e.useGlobal ? light.altitude : e.altitude} set={v => e.useGlobal ? setLight({ ...light, altitude: v }) : set({ ...e, altitude: v })} min={0} max={90} unit="°" /><Sel label="Gloss Contour" value={e.gloss} set={s('gloss')} options={CONTOUR_OPTS} /><Chk label="Anti-aliased" value={e.antiAlias} set={s('antiAlias')} />
      <Sel label="Highlight Mode" value={e.hiBlend} set={s('hiBlend')} options={BLENDS} /><Col label="Highlight color" value={e.hiColor} set={s('hiColor')} /><Num label="Highlight opacity" value={e.hiOpacity} set={s('hiOpacity')} unit="%" />
      <Sel label="Shadow Mode" value={e.shBlend} set={s('shBlend')} options={BLENDS} /><Col label="Shadow color" value={e.shColor} set={s('shColor')} /><Num label="Shadow opacity" value={e.shOpacity} set={s('shOpacity')} unit="%" />
      <h5><Chk label="Contour" value={e.contourOn} set={s('contourOn')} /></h5>{e.contourOn && <><Sel label="Bevel contour" value={e.contour} set={s('contour')} options={CONTOUR_OPTS} /><Num label="Contour range" value={e.contourRange} set={s('contourRange')} min={1} unit="%" /></>}
      <h5><Chk label="Texture" value={e.textureOn} set={s('textureOn')} /></h5>{e.textureOn && <><Sel label="Pattern" value={e.pattern} set={s('pattern')} options={Object.entries(PATTERNS)} /><Num label="Texture scale" value={e.textureScale} set={s('textureScale')} min={1} max={1000} unit="%" /><Num label="Texture depth" value={e.textureDepth} set={s('textureDepth')} min={-1000} max={1000} unit="%" /><Chk label="Invert texture" value={e.textureInvert} set={s('textureInvert')} /></>}</>;
    case 'satin': return <><h4>Satin</h4>{blend}<Col label="Color" value={e.color} set={s('color')} /><Num label="Angle" value={e.angle} set={s('angle')} min={-180} max={180} unit="°" /><Num label="Distance" value={e.distance} set={s('distance')} min={1} max={250} unit="px" /><Num label="Size" value={e.size} set={s('size')} max={250} unit="px" />{contour}<Chk label="Invert" value={e.invert} set={s('invert')} /></>;
    case 'colorOverlay': return <><h4>Color Overlay</h4>{blend}<Col label="Color" value={e.color} set={s('color')} /></>;
    case 'gradientOverlay': return <><h4>Gradient Overlay</h4>{blend}<Col label="Gradient from" value={e.gradFrom} set={s('gradFrom')} /><Col label="Gradient to" value={e.gradTo} set={s('gradTo')} /><Chk label="Reverse" value={e.reverse} set={s('reverse')} /><Sel label="Style" value={e.style} set={s('style')} options={[['linear', 'Linear'], ['radial', 'Radial'], ['angle', 'Angle'], ['reflected', 'Reflected'], ['diamond', 'Diamond']]} /><Chk label="Align with Layer" value={e.align} set={s('align')} /><Num label="Angle" value={e.angle} set={s('angle')} min={-180} max={180} unit="°" /><Num label="Scale" value={e.scale} set={s('scale')} min={10} max={150} unit="%" /><Chk label="Dither" value={e.dither} set={s('dither')} /></>;
    case 'patternOverlay': return <><h4>Pattern Overlay</h4>{blend}<Sel label="Pattern" value={e.pattern} set={s('pattern')} options={Object.entries(PATTERNS)} /><Num label="Scale" value={e.scale} set={s('scale')} min={1} max={1000} unit="%" /><Chk label="Link with Layer" value={e.link} set={s('link')} /></>;
    case 'stroke': return <><h4>Stroke</h4><h5>Structure</h5><Num label="Size" value={e.size} set={s('size')} min={1} max={250} unit="px" /><Sel label="Position" value={e.position} set={s('position')} options={[['outside', 'Outside'], ['inside', 'Inside'], ['center', 'Center']]} />{blend}<h5>Fill Type</h5><Sel label="Fill Type" value={e.fill} set={s('fill')} options={[['color', 'Color'], ['gradient', 'Gradient'], ['pattern', 'Pattern']]} />{e.fill === 'color' ? <Col label="Color" value={e.color} set={s('color')} /> : e.fill === 'gradient' ? <><Col label="Gradient from" value={e.gradFrom} set={s('gradFrom')} /><Col label="Gradient to" value={e.gradTo} set={s('gradTo')} /></> : <Sel label="Pattern" value={e.pattern} set={s('pattern')} options={Object.entries(PATTERNS)} />}</>;
    default: return null;
  }
}

export default function LayerStyleDialog({ layer, light: light0, initialSection = 'blending', onChange, onOk, onCancel }) {
  const [st, setSt] = useState(() => normalizeStyle(layer.style));
  const [light, setLightState] = useState(light0 || GLOBAL_LIGHT);
  const [sel, setSel] = useState(() => { if (initialSection === 'blending' || initialSection === 'styles') return initialSection; const e = normalizeStyle(layer.style).effects.find(x => x.type === initialSection); return e ? e.id : initialSection; });
  const [preview, setPreview] = useState(true), [userStyles, setUserStyles] = useState(loadUserStyles);
  const push = (nextSt, nextLight = light) => { setSt(nextSt); setLightState(nextLight); onChange(preview ? nextSt : null, nextLight); };
  const setLight = l => push(st, l);
  const b = st.blending, setB = patch => push({ ...st, blending: { ...b, ...patch } });
  const toggleType = type => { const has = st.effects.filter(e => e.type === type); if (has.length) push({ ...st, effects: st.effects.map(e => e.type === type ? { ...e, enabled: !has.some(h => h.enabled) } : e) }); else { const e = newEffect(type); push({ ...st, effects: [...st.effects, e] }); setSel(e.id); } };
  const addAnother = type => { const e = newEffect(type); push({ ...st, effects: [...st.effects, e] }); setSel(e.id); };
  const selectType = type => { let e = st.effects.find(x => x.type === type); if (!e) { e = newEffect(type); push({ ...st, effects: [...st.effects, e] }); } setSel(e.id); };
  const cur = st.effects.find(e => e.id === sel);
  const applyPreset = p => push(normalizeStyle({ blending: { ...st.blending, ...(p.blending || {}) }, effects: (p.effects || []).map(e => ({ ...newEffect(e.type), ...e })) }));
  const saveStyle = () => { const name = prompt('Style name', 'My style ' + (Object.keys(userStyles).length + 1)); if (!name) return; const next = { ...userStyles, [name]: { blending: st.blending, effects: st.effects } }; setUserStyles(next); try { localStorage.setItem('zertake-styles', JSON.stringify(next)); } catch { /* storage unavailable: the style lives for this session */ } };
  return <div className="layerStyle" role="dialog" aria-label="Layer Style" onPointerDown={e => e.stopPropagation()} onKeyDown={e => { if (e.key === 'Escape') onCancel(); }}>
    <header><strong>Layer Style</strong><span>Name: {layer.name}</span></header>
    <div className="lsBody">
      <nav className="lsList" aria-label="Styles and effects">
        <button className={sel === 'styles' ? 'on' : ''} onClick={() => setSel('styles')}>Styles</button>
        <button className={sel === 'blending' ? 'on' : ''} onClick={() => setSel('blending')}>Blending Options</button>
        {FX_TYPES.flatMap(type => { const list = st.effects.filter(e => e.type === type); const items = list.length ? list : [null]; return items.map((e, i) => <div key={type + i} className={'lsItem' + (cur && e && cur.id === e.id ? ' on' : '')}>
          <input type="checkbox" aria-label={FX_LABELS[type] + (i ? ' ' + (i + 1) : '')} checked={!!e?.enabled} onChange={() => e ? push({ ...st, effects: st.effects.map(x => x.id === e.id ? { ...x, enabled: !x.enabled } : x) }) : toggleType(type)} />
          <button onClick={() => e ? setSel(e.id) : selectType(type)}>{FX_LABELS[type]}</button>
          {MULTI.includes(type) && i === items.length - 1 && <button className="lsPlus" aria-label={'Add another ' + FX_LABELS[type]} title={'Add another ' + FX_LABELS[type]} onClick={() => addAnother(type)}>+</button>}
          {e && list.length > 1 && <button className="lsPlus" aria-label={'Delete ' + FX_LABELS[type]} title="Delete this effect" onClick={() => { push({ ...st, effects: st.effects.filter(x => x.id !== e.id) }); setSel('blending'); }}>−</button>}
        </div>); })}
      </nav>
      <div className="lsPanel">
        {sel === 'styles' && <><h4>Styles</h4><div className="lsPresets">{Object.entries({ ...BUILTIN_STYLES, ...userStyles }).map(([n, p]) => <button key={n} onClick={() => applyPreset(p)}>{n}</button>)}</div><p className="hint">Built-in styles are original Zertake presets; New Style… saves yours in this browser.</p></>}
        {sel === 'blending' && <><h4>Blending Options</h4><h5>General Blending</h5>
          <p className="hint">Blend mode and opacity of the whole layer are set in the Layers inspector.</p>
          <h5>Advanced Blending</h5>
          <Num label="Fill Opacity" value={b.fillOpacity} set={v => setB({ fillOpacity: v })} unit="%" />
          <div className="lsRow"><span>Channels:</span><Chk label="R" value={b.channels.r} set={v => setB({ channels: { ...b.channels, r: v } })} /><Chk label="G" value={b.channels.g} set={v => setB({ channels: { ...b.channels, g: v } })} /><Chk label="B" value={b.channels.b} set={v => setB({ channels: { ...b.channels, b: v } })} /></div>
          <Sel label="Knockout" value={b.knockout} set={v => setB({ knockout: v })} options={[['none', 'None'], ['shallow', 'Shallow'], ['deep', 'Deep']]} />
          <Chk label="Blend Interior Effects as Group" value={b.blendInterior} set={v => setB({ blendInterior: v })} />
          <Chk label="Blend Clipped Layers as Group" value={b.blendClipped} set={v => setB({ blendClipped: v })} />
          <Chk label="Transparency Shapes Layer" value={b.transparencyShapes} set={v => setB({ transparencyShapes: v })} />
          <Chk label="Layer Mask Hides Effects" value={b.maskHidesEffects} set={v => setB({ maskHidesEffects: v })} />
          <Chk label="Vector Mask Hides Effects" value={b.vectorMaskHidesEffects} set={v => setB({ vectorMaskHidesEffects: v })} disabled title="Vector masks are not implemented yet" />
          <h5>Blend If</h5>
          <Sel label="Blend If" value={b.blendIf.channel} set={v => setB({ blendIf: { ...b.blendIf, channel: v } })} options={[['gray', 'Gray'], ['red', 'Red'], ['green', 'Green'], ['blue', 'Blue']]} />
          <SplitRange label="This Layer" value={b.blendIf.current} set={v => setB({ blendIf: { ...b.blendIf, current: v } })} />
          <SplitRange label="Underlying Layer" value={b.blendIf.underlying} set={v => setB({ blendIf: { ...b.blendIf, underlying: v } })} />
        </>}
        {cur && <EffectPanel e={cur} light={light} setLight={setLight} set={next => push({ ...st, effects: st.effects.map(x => x.id === next.id ? next : x) })} />}
      </div>
      <div className="lsActions">
        <button className="primary" onClick={() => onOk(st, light)}>OK</button>
        <button onClick={onCancel}>Cancel</button>
        <button onClick={saveStyle}>New Style…</button>
        <label className="optCheck"><input type="checkbox" checked={preview} onChange={e => { setPreview(e.target.checked); onChange(e.target.checked ? st : null, light); }} />Preview</label>
      </div>
    </div>
  </div>;
}
