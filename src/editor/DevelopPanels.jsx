import React, { useState } from 'react';
import { developDefaults, autoWhiteBalance, wbFromRgb, PROFILES, BANDS } from '../engine/develop.js';
import { rgbToHsl } from '../engine/color.js';
import { CurveEditor } from './OpDialog.jsx';

// Shared develop-panel UI used by the Camera Raw Filter (CameraRaw.jsx) and the Develop module of
// the Library/Develop workspace (DevelopWorkspace.jsx). Controls and aria-labels are part of the
// E2E contract — keep them stable.
//
// <DevelopPanelStack> props:
//   s          full develop settings (developDefaults() shape)
//   set(patch)             shallow-merge top-level keys
//   setIn(key, patch)      merge into a nested object (curve, mixer, grading, lensBlur, calibration)
//   open, toggle(id)       which panels are expanded
//   hist                   histogram of the current preview ({r,g,b,l}) for the point-curve editor
//   pick, setPick(kind)    active eyedropper: 'wb' | 'fringe' | 'focus' | null
//   getSource()            → the undeveloped preview buffer (for Auto white balance), or null

const lin = v => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };

export function Slider({ label, value, min, max, step = 1, onChange, def = 0, gradient }) {
  const fmt = v => step < 1 ? (+v).toFixed(2) : Math.round(v);
  return <div className="crsSlider" onDoubleClick={() => onChange(def)} title="Double-click to reset">
    <div className="crsRow"><span>{label}</span><input type="number" aria-label={label + ' value'} min={min} max={max} step={step} value={fmt(value)} onChange={e => { const v = +e.target.value; if (Number.isFinite(v)) onChange(Math.max(min, Math.min(max, v))); }} /></div>
    <input type="range" aria-label={label} min={min} max={max} step={step} value={value} onChange={e => onChange(+e.target.value)} style={gradient ? { background: gradient } : undefined} />
  </div>;
}
export function Panel({ id, title, open, toggle, bypass, setBypass, children }) {
  return <section className="crsPanel">
    <header><button className="crsTitle" aria-expanded={open} onClick={() => toggle(id)}>{open ? '▾' : '▸'} {title}</button>
      {setBypass && <button className={'crsEye' + (bypass ? ' off' : '')} aria-pressed={!bypass} aria-label={(bypass ? 'Show ' : 'Hide ') + title + ' adjustments'} title="Toggle this panel's adjustments" onClick={() => setBypass(!bypass)}>◉</button>}</header>
    {open && <div className="crsBody">{children}</div>}
  </section>;
}
export const Tabs = ({ value, set, items, label }) => <div className="segmented crsTabs" role="group" aria-label={label}>{items.map(([v, l]) => <button key={v} aria-pressed={value === v} className={value === v ? 'on' : ''} onClick={() => set(v)}>{l}</button>)}</div>;

export const PANELS_OPEN_DEFAULT = { light: true, color: true, effects: false, curve: false, mixer: false, grading: false, detail: false, optics: false, lensBlur: false, calibration: false };

/** Profile select (+ amount for non-default profiles). */
export function ProfileControls({ s, set }) {
  return <>
    <label className="crsProfile"><span>Profile</span><select aria-label="Profile" value={s.profile} onChange={e => set({ profile: e.target.value })}>{Object.entries(PROFILES).map(([k, p]) => <option key={k} value={k}>{p.name}</option>)}</select></label>
    {s.profile !== 'color' && <Slider label="Profile amount" value={s.profileAmount} min={0} max={200} def={100} onChange={v => set({ profileAmount: v })} />}
  </>;
}

/**
 * Settings patch for an eyedropper click at pixel (x, y) of the undeveloped preview `buf`.
 * pick: 'wb' | 'fringe' | 'focus'. Returns { patch } for set(), or { setIn: [key, patch] } for focus.
 */
export function sampleForPick(pick, buf, x, y, s) {
  if (pick === 'focus') return { setIn: ['lensBlur', { focusX: (x + 0.5) / buf.w, focusY: (y + 0.5) / buf.h, enabled: true }] };
  let R = 0, G = 0, B = 0, n = 0;
  for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) { const xx = Math.min(buf.w - 1, Math.max(0, x + i)), yy = Math.min(buf.h - 1, Math.max(0, y + j)), q = (yy * buf.w + xx) * 4; R += buf.data[q]; G += buf.data[q + 1]; B += buf.data[q + 2]; n++; }
  R /= n; G /= n; B /= n;
  if (pick === 'wb') return { patch: { wb: 'custom', ...wbFromRgb(lin(R), lin(G), lin(B)) } };
  if (pick === 'fringe') { const [hh] = rgbToHsl(R, G, B); return { patch: hh >= 240 ? { defringePurple: Math.max(s.defringePurple, 8), purpleHueLo: Math.max(0, Math.round((hh - 240) / 1.2) - 15), purpleHueHi: Math.min(100, Math.round((hh - 240) / 1.2) + 15) } : { defringeGreen: Math.max(s.defringeGreen, 8), greenHueLo: Math.max(0, Math.round((hh - 40) / 1.6) - 10), greenHueHi: Math.min(100, Math.round((hh - 40) / 1.6) + 10) } }; }
  return {};
}
export const pickHint = pick => pick === 'wb' ? 'Click a neutral grey or white area' : pick === 'focus' ? 'Click the point that should stay in focus' : 'Click a purple or green fringe';

/** The ten develop panels (Light … Calibration). */
export function DevelopPanelStack({ s, set, setIn, open, toggle, hist, pick, setPick, getSource }) {
  const [curveMode, setCurveMode] = useState('parametric'), [mixTab, setMixTab] = useState('hue'), [gradeTab, setGradeTab] = useState('shadows');
  const bp = id => [!!s.bypass?.[id], v => set({ bypass: { ...s.bypass, [id]: v } })];
  const mono = s.profile === 'monochrome';
  const g = s.grading[gradeTab];
  return <>
    <Panel id="light" title="Light" open={open.light} toggle={toggle} bypass={bp('light')[0]} setBypass={bp('light')[1]}>
      <Slider label="Exposure" value={s.exposure} min={-5} max={5} step={0.05} onChange={v => set({ exposure: v })} />
      {[['contrast', 'Contrast'], ['highlights', 'Highlights'], ['shadows', 'Shadows'], ['whites', 'Whites'], ['blacks', 'Blacks']].map(([k, l]) => <Slider key={k} label={l} value={s[k]} min={-100} max={100} onChange={v => set({ [k]: v })} />)}
    </Panel>
    <Panel id="color" title="Color" open={open.color} toggle={toggle} bypass={bp('color')[0]} setBypass={bp('color')[1]}>
      <div className="crsRow"><span>White balance</span><select aria-label="White balance" value={s.wb} onChange={e => { const v = e.target.value, src = getSource?.(); if (v === 'asShot') set({ wb: v, temp: 0, tint: 0 }); else if (v === 'auto' && src) set({ wb: v, ...autoWhiteBalance(src) }); else set({ wb: v }); }}><option value="asShot">As Shot</option><option value="auto">Auto</option><option value="custom">Custom</option></select>
        <button className={'crsPick' + (pick === 'wb' ? ' on' : '')} aria-label="White balance eyedropper" title="White balance eyedropper" onClick={() => setPick(pick === 'wb' ? null : 'wb')}>⌖</button></div>
      <Slider label="Temperature" value={s.temp} min={-100} max={100} onChange={v => set({ temp: v, wb: 'custom' })} gradient="linear-gradient(90deg,#3a6cff,#ddd,#ffb43a)" />
      <Slider label="Tint" value={s.tint} min={-100} max={100} onChange={v => set({ tint: v, wb: 'custom' })} gradient="linear-gradient(90deg,#3adf5a,#ddd,#e04adf)" />
      <Slider label="Vibrance" value={s.vibrance} min={-100} max={100} onChange={v => set({ vibrance: v })} />
      <Slider label="Saturation" value={s.saturation} min={-100} max={100} onChange={v => set({ saturation: v })} />
    </Panel>
    <Panel id="effects" title="Effects" open={open.effects} toggle={toggle} bypass={bp('effects')[0]} setBypass={bp('effects')[1]}>
      <Slider label="Texture" value={s.texture} min={-100} max={100} onChange={v => set({ texture: v })} />
      <Slider label="Clarity" value={s.clarity} min={-100} max={100} onChange={v => set({ clarity: v })} />
      <Slider label="Dehaze" value={s.dehaze} min={-100} max={100} onChange={v => set({ dehaze: v })} />
      <h5>Vignette</h5>
      <Slider label="Vignette amount" value={s.vignetteAmount} min={-100} max={100} onChange={v => set({ vignetteAmount: v })} />
      <Slider label="Vignette midpoint" value={s.vignetteMidpoint} min={0} max={100} def={50} onChange={v => set({ vignetteMidpoint: v })} />
      <Slider label="Vignette roundness" value={s.vignetteRoundness} min={-100} max={100} onChange={v => set({ vignetteRoundness: v })} />
      <Slider label="Vignette feather" value={s.vignetteFeather} min={0} max={100} def={50} onChange={v => set({ vignetteFeather: v })} />
      <Slider label="Vignette highlights" value={s.vignetteHighlights} min={0} max={100} onChange={v => set({ vignetteHighlights: v })} />
      <h5>Grain</h5>
      <Slider label="Grain amount" value={s.grainAmount} min={0} max={100} onChange={v => set({ grainAmount: v })} />
      <Slider label="Grain size" value={s.grainSize} min={0} max={100} def={25} onChange={v => set({ grainSize: v })} />
      <Slider label="Grain roughness" value={s.grainRoughness} min={0} max={100} def={50} onChange={v => set({ grainRoughness: v })} />
    </Panel>
    <Panel id="curve" title="Curve" open={open.curve} toggle={toggle} bypass={bp('curve')[0]} setBypass={bp('curve')[1]}>
      <Tabs label="Curve adjust" value={curveMode} set={setCurveMode} items={[['parametric', 'Parametric'], ['point', 'Point']]} />
      {curveMode === 'parametric' ? <>
        {[['highlights', 'Curve highlights'], ['lights', 'Curve lights'], ['darks', 'Curve darks'], ['shadows', 'Curve shadows']].map(([k, l]) => <Slider key={k} label={l} value={s.curve[k]} min={-100} max={100} onChange={v => setIn('curve', { [k]: v })} />)}
        {[['split1', 'Shadow split', 25], ['split2', 'Midtone split', 50], ['split3', 'Highlight split', 75]].map(([k, l, d]) => <Slider key={k} label={l} value={s.curve[k]} min={5} max={95} def={d} onChange={v => setIn('curve', { [k]: v })} />)}
      </> : <CurveEditor value={{ rgb: s.curve.rgb, r: s.curve.r, g: s.curve.g, b: s.curve.b }} hist={hist} onChange={v => setIn('curve', v)} />}
    </Panel>
    <Panel id="mixer" title={mono ? 'B&W Mixer' : 'Color Mixer'} open={open.mixer} toggle={toggle} bypass={bp('mixer')[0]} setBypass={bp('mixer')[1]}>
      {mono ? BANDS.map(b => <Slider key={b} label={b[0].toUpperCase() + b.slice(1)} value={s.mixer.gray[b]} min={-100} max={100} def={developDefaults().mixer.gray[b]} onChange={v => setIn('mixer', { gray: { ...s.mixer.gray, [b]: v } })} />)
        : <><Tabs label="Mixer adjust" value={mixTab} set={setMixTab} items={[['hue', 'Hue'], ['sat', 'Saturation'], ['lum', 'Luminance']]} />
          {BANDS.map(b => <Slider key={b} label={b[0].toUpperCase() + b.slice(1)} value={s.mixer[mixTab][b]} min={-100} max={100} onChange={v => setIn('mixer', { [mixTab]: { ...s.mixer[mixTab], [b]: v } })} />)}</>}
    </Panel>
    <Panel id="grading" title="Color Grading" open={open.grading} toggle={toggle} bypass={bp('grading')[0]} setBypass={bp('grading')[1]}>
      <Tabs label="Grading range" value={gradeTab} set={setGradeTab} items={[['shadows', 'Shadows'], ['midtones', 'Midtones'], ['highlights', 'Highlights'], ['global', 'Global']]} />
      <Slider label="Grading hue" value={g.hue} min={0} max={359} onChange={v => setIn('grading', { [gradeTab]: { ...g, hue: v } })} gradient="linear-gradient(90deg,red,yellow,lime,cyan,blue,magenta,red)" />
      <Slider label="Grading saturation" value={g.sat} min={0} max={100} onChange={v => setIn('grading', { [gradeTab]: { ...g, sat: v } })} />
      <Slider label="Grading luminance" value={g.lum} min={-100} max={100} onChange={v => setIn('grading', { [gradeTab]: { ...g, lum: v } })} />
      <Slider label="Grading blending" value={s.grading.blending} min={0} max={100} def={50} onChange={v => setIn('grading', { blending: v })} />
      <Slider label="Grading balance" value={s.grading.balance} min={-100} max={100} onChange={v => setIn('grading', { balance: v })} />
    </Panel>
    <Panel id="detail" title="Detail" open={open.detail} toggle={toggle} bypass={bp('detail')[0]} setBypass={bp('detail')[1]}>
      <Slider label="Sharpening" value={s.sharpenAmount} min={0} max={150} onChange={v => set({ sharpenAmount: v })} />
      <Slider label="Sharpening radius" value={s.sharpenRadius} min={0.5} max={3} step={0.1} def={1} onChange={v => set({ sharpenRadius: v })} />
      <Slider label="Sharpening detail" value={s.sharpenDetail} min={0} max={100} def={25} onChange={v => set({ sharpenDetail: v })} />
      <Slider label="Sharpening masking" value={s.sharpenMasking} min={0} max={100} onChange={v => set({ sharpenMasking: v })} />
      <Slider label="Noise Reduction" value={s.nrLuminance} min={0} max={100} onChange={v => set({ nrLuminance: v })} />
      <Slider label="Noise detail" value={s.nrDetail} min={0} max={100} def={50} onChange={v => set({ nrDetail: v })} />
      <Slider label="Noise contrast" value={s.nrContrast} min={0} max={100} onChange={v => set({ nrContrast: v })} />
      <Slider label="Color Noise Reduction" value={s.nrColor} min={0} max={100} onChange={v => set({ nrColor: v })} />
      <Slider label="Color detail" value={s.nrColorDetail} min={0} max={100} def={50} onChange={v => set({ nrColorDetail: v })} />
      <Slider label="Color smoothness" value={s.nrColorSmoothness} min={0} max={100} def={50} onChange={v => set({ nrColorSmoothness: v })} />
      <p className="hint">The preview is down-scaled; radii are converted so the full-resolution result matches.</p>
    </Panel>
    <Panel id="optics" title="Optics" open={open.optics} toggle={toggle} bypass={bp('optics')[0]} setBypass={bp('optics')[1]}>
      <label className="optCheck"><input type="checkbox" aria-label="Remove chromatic aberration" checked={s.removeCA} onChange={e => set({ removeCA: e.target.checked })} />Remove chromatic aberration</label>
      <Slider label="Distortion" value={s.distortion} min={-100} max={100} onChange={v => set({ distortion: v })} />
      <Slider label="Lens vignette" value={s.lensVignette} min={-100} max={100} onChange={v => set({ lensVignette: v })} />
      <Slider label="Lens vignette midpoint" value={s.lensVignetteMidpoint} min={0} max={100} def={50} onChange={v => set({ lensVignetteMidpoint: v })} />
      <h5>Defringe <button className={'crsPick' + (pick === 'fringe' ? ' on' : '')} aria-label="Sample fringe" title="Sample fringe" onClick={() => setPick(pick === 'fringe' ? null : 'fringe')}>⌖</button></h5>
      <Slider label="Purple Amount" value={s.defringePurple} min={0} max={20} onChange={v => set({ defringePurple: v })} />
      <Slider label="Purple Hue from" value={s.purpleHueLo} min={0} max={100} def={30} onChange={v => set({ purpleHueLo: Math.min(v, s.purpleHueHi - 10) })} gradient="linear-gradient(90deg,#5a3cff,#c03cff,#ff3c9a)" />
      <Slider label="Purple Hue to" value={s.purpleHueHi} min={0} max={100} def={70} onChange={v => set({ purpleHueHi: Math.max(v, s.purpleHueLo + 10) })} gradient="linear-gradient(90deg,#5a3cff,#c03cff,#ff3c9a)" />
      <Slider label="Green Amount" value={s.defringeGreen} min={0} max={20} onChange={v => set({ defringeGreen: v })} />
      <Slider label="Green Hue from" value={s.greenHueLo} min={0} max={100} def={40} onChange={v => set({ greenHueLo: Math.min(v, s.greenHueHi - 10) })} gradient="linear-gradient(90deg,#c8d63c,#3cd65a,#3cc8d6)" />
      <Slider label="Green Hue to" value={s.greenHueHi} min={0} max={100} def={60} onChange={v => set({ greenHueHi: Math.max(v, s.greenHueLo + 10) })} gradient="linear-gradient(90deg,#c8d63c,#3cd65a,#3cc8d6)" />
    </Panel>
    <Panel id="lensBlur" title="Lens Blur" open={open.lensBlur} toggle={toggle} bypass={bp('lensBlur')[0]} setBypass={bp('lensBlur')[1]}>
      <label className="optCheck"><input type="checkbox" aria-label="Apply lens blur" checked={s.lensBlur.enabled} onChange={e => setIn('lensBlur', { enabled: e.target.checked })} />Apply</label>
      <Slider label="Blur amount" value={s.lensBlur.amount} min={0} max={100} def={50} onChange={v => setIn('lensBlur', { amount: v })} />
      <div className="crsRow"><span>Bokeh</span><select aria-label="Bokeh" value={s.lensBlur.bokeh} onChange={e => setIn('lensBlur', { bokeh: e.target.value })}><option value="circle">Circle</option><option value="hexagon">Hexagon</option></select></div>
      <Slider label="Boost" value={s.lensBlur.boost} min={0} max={100} onChange={v => setIn('lensBlur', { boost: v })} />
      <div className="crsRow"><span>Depth</span><select aria-label="Depth map" value={s.lensBlur.depth} onChange={e => setIn('lensBlur', { depth: e.target.value })}><option value="radial">Radial from focus point</option><option value="linear">Linear (tilt) from focus point</option></select>
        <button className={'crsPick' + (pick === 'focus' ? ' on' : '')} aria-label="Set focus point" title="Set focus point" onClick={() => setPick(pick === 'focus' ? null : 'focus')}>⌖</button></div>
      {s.lensBlur.depth === 'linear' && <Slider label="Angle" value={s.lensBlur.angle} min={0} max={180} def={90} onChange={v => setIn('lensBlur', { angle: v })} />}
      <Slider label="Focal range near" value={s.lensBlur.focalNear} min={0} max={100} onChange={v => setIn('lensBlur', { focalNear: Math.min(v, s.lensBlur.focalFar) })} />
      <Slider label="Focal range far" value={s.lensBlur.focalFar} min={0} max={100} def={20} onChange={v => setIn('lensBlur', { focalFar: Math.max(v, s.lensBlur.focalNear) })} />
      <p className="hint">Depth comes from the focus map you define (no AI depth estimation).</p>
    </Panel>
    <Panel id="calibration" title="Calibration" open={open.calibration} toggle={toggle} bypass={bp('calibration')[0]} setBypass={bp('calibration')[1]}>
      <div className="crsRow"><span>Process</span><select aria-label="Process version" value="1" onChange={() => {}}><option value="1">Zertake 1 (Current)</option></select></div>
      <Slider label="Shadows Tint" value={s.calibration.shadowTint} min={-100} max={100} onChange={v => setIn('calibration', { shadowTint: v })} />
      {[['red', 'Red'], ['green', 'Green'], ['blue', 'Blue']].map(([c, l]) => <div key={c}><h5>{l} Primary</h5>
        <Slider label={l + ' Hue'} value={s.calibration[c + 'Hue']} min={-100} max={100} onChange={v => setIn('calibration', { [c + 'Hue']: v })} />
        <Slider label={l + ' Saturation'} value={s.calibration[c + 'Sat']} min={-100} max={100} onChange={v => setIn('calibration', { [c + 'Sat']: v })} /></div>)}
    </Panel>
  </>;
}

/** RGB histogram of a preview ({r,g,b} from adjust.js histogram()). */
export function RgbHistogram({ hist, label = 'Histogram' }) {
  const path = ch => { if (!hist) return ''; const h = hist[ch], m = Math.max(1, ...h); return Array.from(h, (v, x) => `${x === 0 ? 'M' : 'L'}${x} ${100 - Math.sqrt(v / m) * 100}`).join('') + 'L255 100L0 100Z'; };
  return <svg className="crsHist" viewBox="0 0 255 100" preserveAspectRatio="none" aria-label={label}>{['r', 'g', 'b'].map(c => <path key={c} d={path(c)} fill={c === 'r' ? '#ff4a4a66' : c === 'g' ? '#4aff6a66' : '#4a7dff66'} />)}</svg>;
}
