import React, { useEffect, useState } from 'react';
import { Field } from './OpDialog.jsx';
import { parseIcc } from '../engine/icc.js';
import { RGB_PROFILE_NAMES, GRAY_PROFILE_NAMES, INTENTS, GENERIC_CMYK, defaultColorSettings, defaultCmykParams } from '../engine/colormgmt.js';

// Colour management and Image › Mode dialogs. Pure UI: every dialog reports its result through
// onApply and never touches the document itself. Optional onChange(params) props fire on every
// edit so the caller can run a live preview in the worker (same pattern as OpDialog).
// CSS: dist/css/color.css (plus the shared .opDialog / .opField / .optCheck / .segmented rules).

const POLICIES = [['preserve', 'Preserve Embedded Profiles'], ['convert', 'Convert to Working Space'], ['off', 'Off']];
const GCR = [['none', 'None'], ['light', 'Light'], ['medium', 'Medium'], ['heavy', 'Heavy'], ['maximum', 'Maximum']];
export const LAB_TARGET = 'Lab Color';
const nameOf = p => (p == null ? "Don't Color Manage" : typeof p === 'string' ? p : p.name || 'Embedded profile');

function Shell({ title, children, onCancel, onOk, okDisabled, wide }) {
  return <div className={'opDialog colorDialog' + (wide ? ' wide' : '')} role="dialog" aria-label={title} onPointerDown={e => e.stopPropagation()}
    onKeyDown={e => { if (e.key === 'Escape') onCancel(); if (e.key === 'Enter' && !okDisabled && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON' && e.target.type !== 'file') onOk(); }}>
    <header><h3>{title}</h3></header>
    <div className="opFields">{children}</div>
    <footer><button onClick={onCancel}>Cancel</button><button className="primary" disabled={okDisabled} onClick={onOk}>OK</button></footer>
  </div>;
}
const Group = ({ legend, children }) => <fieldset className="cdGroup"><legend>{legend}</legend>{children}</fieldset>;
const sel = (label, options) => ({ type: 'select', label, options: options.map(o => (Array.isArray(o) ? o : [o, o])) });
const rng = (label, min, max, step = 1, unit) => ({ type: 'range', label, min, max, step, unit });
const chk = label => ({ type: 'checkbox', label });

/** Load an .icc/.icm file → { profile: {name, bytes}, parsed } or { error }. */
async function loadIccFile(file, wantSpace) {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer()), parsed = parseIcc(bytes);
    if (!parsed.convertible) return { error: parsed.reason, parsed };
    const space = parsed.colorSpace === 'GRAY' ? 'Gray' : parsed.colorSpace;
    if (wantSpace && space !== wantSpace) return { error: `"${parsed.description || file.name}" is a ${space} profile; this document needs a ${wantSpace} profile.`, parsed };
    return { profile: { name: parsed.description || file.name.replace(/\.(icc|icm)$/i, ''), bytes }, parsed };
  } catch (e) { return { error: `${file.name}: ${e.message}` }; }
}
function LoadProfile({ label, wantSpace, onLoaded }) {
  const [msg, setMsg] = useState(null);
  return <div className="cdLoad">
    <label className="cdFile">{label}<input type="file" accept=".icc,.icm,application/vnd.iccprofile" aria-label={label}
      onChange={async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; const r = await loadIccFile(f, wantSpace); setMsg(r.error ? { error: r.error } : { ok: `Loaded "${r.profile.name}" (ICC v${r.parsed.version}, ${r.parsed.colorSpace}).` }); if (r.profile) onLoaded(r.profile); }} /></label>
    {msg && (msg.error ? <p className="cdError" role="alert">{msg.error}</p> : <p className="cdInfo" role="status">{msg.ok}</p>)}
  </div>;
}

/**
 * Edit › Color Settings.
 * settings: see defaultColorSettings() in colormgmt.js; onApply(newSettings).
 */
export function ColorSettingsDialog({ settings, onCancel, onApply }) {
  const [s, setS] = useState(() => ({ ...defaultColorSettings(), ...(settings || {}), cmykModel: { ...defaultCmykParams(), ...(settings?.cmykModel || {}) } }));
  const set = (k, v) => setS(x => ({ ...x, [k]: v })), setM = (k, v) => setS(x => ({ ...x, cmykModel: { ...x.cmykModel, [k]: v } }));
  return <Shell title="Color Settings" wide onCancel={onCancel} onOk={() => onApply(s)}>
    <Group legend="Working Spaces">
      <Field p={sel('RGB working space', RGB_PROFILE_NAMES)} value={s.rgb} onChange={v => set('rgb', v)} />
      <div className="cdRow"><span>CMYK working space</span><b>{GENERIC_CMYK}</b></div>
      <Field p={rng('Dot gain', 0, 40, 1, '%')} value={s.cmykModel.dotGain} onChange={v => setM('dotGain', v)} />
      <Field p={sel('Black generation', GCR)} value={s.cmykModel.gcr} onChange={v => setM('gcr', v)} />
      <Field p={rng('Black ink limit', 50, 100, 1, '%')} value={s.cmykModel.blackLimit} onChange={v => setM('blackLimit', v)} />
      <Field p={rng('Total ink limit', 200, 400, 5, '%')} value={s.cmykModel.til} onChange={v => setM('til', v)} />
      <Field p={sel('Gray working space', GRAY_PROFILE_NAMES)} value={s.gray} onChange={v => set('gray', v)} />
    </Group>
    <Group legend="Color Management Policies">
      <Field p={sel('RGB policy', POLICIES)} value={s.policyRgb} onChange={v => set('policyRgb', v)} />
      <Field p={sel('CMYK policy', POLICIES)} value={s.policyCmyk} onChange={v => set('policyCmyk', v)} />
      <Field p={sel('Gray policy', POLICIES)} value={s.policyGray} onChange={v => set('policyGray', v)} />
      <Field p={chk('Profile mismatches: ask when opening')} value={s.askOnOpen} onChange={v => set('askOnOpen', v)} />
      <Field p={chk('Profile mismatches: ask when pasting')} value={s.askOnPaste} onChange={v => set('askOnPaste', v)} />
      <Field p={chk('Missing profiles: ask when opening')} value={s.askOnMissing} onChange={v => set('askOnMissing', v)} />
    </Group>
    <Group legend="Conversion Options">
      <div className="cdRow"><span>Engine</span><b>Zertake CMM (built-in)</b></div>
      <Field p={sel('Intent', INTENTS)} value={s.intent} onChange={v => set('intent', v)} />
      <Field p={chk('Use black point compensation')} value={s.bpc} onChange={v => set('bpc', v)} />
      <Field p={chk('Use dither (8-bit/channel images)')} value={s.dither} onChange={v => set('dither', v)} />
    </Group>
    <p className="hint">CMYK uses a parametric press model (an approximation, not a measured press profile).</p>
  </Shell>;
}

/**
 * Edit › Assign Profile. current: profile name | {name, bytes} | null (untagged).
 * mode: 'RGB' | 'Gray'. onApply(null | profileName | {name, bytes}) — null means "Don't Color Manage".
 */
export function AssignProfileDialog({ current, mode = 'RGB', workingSpace, onCancel, onApply }) {
  const builtIns = mode === 'Gray' ? GRAY_PROFILE_NAMES : RGB_PROFILE_NAMES;
  const working = workingSpace || builtIns[0];
  const [choice, setChoice] = useState(current == null ? 'none' : nameOf(current) === working ? 'working' : 'profile');
  const [loaded, setLoaded] = useState(() => (current && typeof current === 'object' ? [current] : []));
  const [pick, setPick] = useState(current ? nameOf(current) : working);
  const options = [...builtIns, ...loaded.map(l => l.name).filter(n => !builtIns.includes(n))];
  const result = () => (choice === 'none' ? null : choice === 'working' ? working : loaded.find(l => l.name === pick) || pick);
  return <Shell title="Assign Profile" onCancel={onCancel} onOk={() => onApply(result())}>
    <div className="cdRow"><span>Current</span><b>{nameOf(current)}</b></div>
    <div role="radiogroup" aria-label="Assign profile" className="cdRadios">
      <label><input type="radio" name="assign" checked={choice === 'none'} onChange={() => setChoice('none')} />Don't Color Manage This Document</label>
      <label><input type="radio" name="assign" checked={choice === 'working'} onChange={() => setChoice('working')} />Working {mode}: {working}</label>
      <label><input type="radio" name="assign" checked={choice === 'profile'} onChange={() => setChoice('profile')} />Profile:</label>
    </div>
    {choice === 'profile' && <>
      <Field p={sel('Profile', options)} value={pick} onChange={setPick} />
      <LoadProfile label="Load profile file (.icc, .icm)" wantSpace={mode} onLoaded={p => { setLoaded(l => [...l.filter(x => x.name !== p.name), p]); setPick(p.name); }} />
    </>}
    <p className="hint">Assigning keeps the pixel values and changes how they are interpreted, so colours change on screen.</p>
  </Shell>;
}

/**
 * Edit › Convert to Profile. current: source profile (name | {name,bytes}).
 * onApply({ to, intent, bpc, dither }) where to is an RGB/gray profile name, {name, bytes},
 * GENERIC_CMYK (convert to CMYK mode) or LAB_TARGET ('Lab Color').
 */
export function ConvertProfileDialog({ current, defaults = {}, onCancel, onApply }) {
  const [loaded, setLoaded] = useState([]);
  const [to, setTo] = useState(defaults.to && typeof defaults.to === 'string' ? defaults.to : 'Display P3');
  const [intent, setIntent] = useState(defaults.intent || 'relative'), [bpc, setBpc] = useState(defaults.bpc ?? true), [dither, setDither] = useState(defaults.dither ?? true);
  const options = [...RGB_PROFILE_NAMES.map(n => [n, 'RGB: ' + n]), [GENERIC_CMYK, 'CMYK: ' + GENERIC_CMYK], [LAB_TARGET, 'Lab Color'], ...GRAY_PROFILE_NAMES.map(n => [n, 'Gray: ' + n]),
    ...loaded.map(l => [l.name, 'Loaded: ' + l.name])];
  return <Shell title="Convert to Profile" onCancel={onCancel} onOk={() => onApply({ to: loaded.find(l => l.name === to) || to, intent, bpc, dither })}>
    <div className="cdRow"><span>Source space</span><b>{nameOf(current)}</b></div>
    <Field p={sel('Destination profile', options)} value={to} onChange={setTo} />
    <LoadProfile label="Load destination profile (.icc, .icm)" onLoaded={p => { setLoaded(l => [...l.filter(x => x.name !== p.name), p]); setTo(p.name); }} />
    <Field p={sel('Intent', INTENTS)} value={intent} onChange={setIntent} />
    <Field p={chk('Use black point compensation')} value={bpc} onChange={setBpc} />
    <Field p={chk('Use dither')} value={dither} onChange={setDither} />
    {to === GENERIC_CMYK && <p className="hint">CMYK conversion uses the parametric Zertake press model (an approximation).</p>}
  </Shell>;
}

/**
 * Image › Mode submenu. kind 'mode' entries change the colour mode, 'depth' entries the bit depth.
 * dialog: the export of this file to open first (absent → convert directly).
 * requires: Photoshop rule — Bitmap and Duotone need a Grayscale document first.
 */
export const MODE_ITEMS = [
  { id: 'mode.bitmap', label: 'Bitmap…', kind: 'mode', value: 'Bitmap', dialog: 'BitmapDialog', requires: ['Grayscale'] },
  { id: 'mode.grayscale', label: 'Grayscale', kind: 'mode', value: 'Grayscale' },
  { id: 'mode.duotone', label: 'Duotone…', kind: 'mode', value: 'Duotone', dialog: 'DuotoneDialog', requires: ['Grayscale', 'Duotone'] },
  { id: 'mode.indexed', label: 'Indexed Color…', kind: 'mode', value: 'Indexed', dialog: 'IndexedColorDialog', requires: ['RGB', 'Grayscale', 'Indexed'] },
  { id: 'mode.rgb', label: 'RGB Color', kind: 'mode', value: 'RGB' },
  { id: 'mode.cmyk', label: 'CMYK Color', kind: 'mode', value: 'CMYK' },
  { id: 'mode.lab', label: 'Lab Color', kind: 'mode', value: 'Lab' },
  { id: 'mode.sep1', kind: 'separator' },
  { id: 'depth.8', label: '8 Bits/Channel', kind: 'depth', value: 8 },
  { id: 'depth.16', label: '16 Bits/Channel', kind: 'depth', value: 16 },
  { id: 'depth.32', label: '32 Bits/Channel', kind: 'depth', value: 32, dialogDown: 'HdrToningDialog' },
];
/** Menu state for an item given the document colour { mode, bitDepth }: { checked, enabled }. */
export function modeItemState(item, color = {}) {
  const mode = color.mode || 'RGB', depth = color.bitDepth || 8;
  if (item.kind === 'mode') return { checked: mode === item.value, enabled: mode !== item.value && (!item.requires || item.requires.includes(mode)) && (depth === 8 || !['Bitmap', 'Indexed', 'Duotone'].includes(item.value)) };
  if (item.kind === 'depth') return { checked: depth === item.value, enabled: depth !== item.value && !(item.value !== 8 && ['Bitmap', 'Indexed', 'Duotone'].includes(mode)) && !(item.value === 32 && mode !== 'RGB') };
  return { checked: false, enabled: false };
}

function useLive(initial, onChange) {
  const [p, setP] = useState(initial);
  useEffect(() => { if (onChange) onChange(p); }, [p]);
  return [p, (k, v) => setP(x => ({ ...x, [k]: v }))];
}

/** Image › Mode › Indexed Color. onApply({ palette, colors, dither, amount }) → indexedColor() params. */
export function IndexedColorDialog({ initial, onChange, onCancel, onApply }) {
  const [p, set] = useLive({ palette: 'adaptive', colors: 256, dither: 'diffusion', amount: 75, ...(initial || {}) }, onChange);
  const fixed = p.palette === 'web' || p.palette === 'blackwhite' || p.palette === 'exact';
  return <Shell title="Indexed Color" onCancel={onCancel} onOk={() => onApply(p)}>
    <Field p={sel('Palette', [['exact', 'Exact'], ['adaptive', 'Local (Adaptive)'], ['uniform', 'Uniform'], ['web', 'Web'], ['grayscale', 'Grayscale'], ['blackwhite', 'Black and White']])} value={p.palette} onChange={v => set('palette', v)} />
    {!fixed && <Field p={rng('Colors', 2, 256)} value={p.colors} onChange={v => set('colors', v)} />}
    <Field p={sel('Dither', [['none', 'None'], ['diffusion', 'Diffusion']])} value={p.dither} onChange={v => set('dither', v)} />
    {p.dither === 'diffusion' && <Field p={rng('Amount', 0, 100, 1, '%')} value={p.amount} onChange={v => set('amount', v)} />}
  </Shell>;
}

/** Image › Mode › Bitmap. onApply({ method, threshold }) → bitmapMode() params. */
export function BitmapDialog({ initial, onChange, onCancel, onApply }) {
  const [p, set] = useLive({ method: 'diffusion', threshold: 128, ...(initial || {}) }, onChange);
  return <Shell title="Bitmap" onCancel={onCancel} onOk={() => onApply(p)}>
    <Field p={sel('Method', [['threshold', '50% Threshold'], ['pattern', 'Pattern Dither'], ['diffusion', 'Diffusion Dither']])} value={p.method} onChange={v => set('method', v)} />
    {p.method === 'threshold' && <Field p={rng('Threshold', 1, 255)} value={p.threshold} onChange={v => set('threshold', v)} />}
  </Shell>;
}

const DUO_STEPS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
const straight = () => DUO_STEPS.map(x => [x, x]);
/** Image › Mode › Duotone. onApply({ inks: [{ color, curve: [[in%, out%]...] }] }) → duotone() params. */
export function DuotoneDialog({ initial, onChange, onCancel, onApply }) {
  const [p, setP] = useState(() => ({ type: 'monotone', inks: [{ color: '#000000', curve: straight() }, { color: '#c06020', curve: straight() }], ...(initial || {}) }));
  const out = { inks: p.inks.slice(0, p.type === 'duotone' ? 2 : 1).map(i => ({ color: i.color, curve: i.curve.filter(q => q[1] !== '' && Number.isFinite(+q[1])).map(([x, y]) => [x, +y]) })) };
  useEffect(() => { onChange && onChange(out); }, [p]);
  const setInk = (k, patch) => setP(x => ({ ...x, inks: x.inks.map((i, j) => (j === k ? { ...i, ...patch } : i)) }));
  return <Shell title="Duotone Options" wide onCancel={onCancel} onOk={() => onApply(out)}>
    <Field p={sel('Type', [['monotone', 'Monotone'], ['duotone', 'Duotone']])} value={p.type} onChange={v => setP(x => ({ ...x, type: v }))} />
    {p.inks.slice(0, p.type === 'duotone' ? 2 : 1).map((ink, k) => <Group key={k} legend={`Ink ${k + 1}`}>
      <Field p={{ type: 'color', label: `Ink ${k + 1} color` }} value={ink.color} onChange={v => setInk(k, { color: v })} />
      <div className="duoCurve">{ink.curve.map(([x, y], j) => <label key={x}><span>{x}%</span>
        <input type="number" min="0" max="100" aria-label={`Ink ${k + 1} at ${x}%`} value={y}
          onChange={e => { const v = e.target.value === '' ? '' : Math.max(0, Math.min(100, +e.target.value)); setInk(k, { curve: ink.curve.map((q, i) => (i === j ? [q[0], v] : q)) }); }} /></label>)}</div>
      <button onClick={() => setInk(k, { curve: straight() })}>Reset ink {k + 1} curve</button>
    </Group>)}
    <p className="hint">Each field sets the ink percentage printed for that grey level; leave a field empty to let the curve interpolate.</p>
  </Shell>;
}

/** HDR Toning (32 → 8/16 bits). onApply(params) → toneMap() params. */
export function HdrToningDialog({ initial, onChange, onCancel, onApply }) {
  const [p, set] = useLive({ method: 'local', exposure: 0, gamma: 1, radius: 16, strength: 0.6, detail: 100, saturation: 100, edgeSmoothness: 0.02, ...(initial || {}) }, onChange);
  return <Shell title="HDR Toning" onCancel={onCancel} onOk={() => onApply(p)}>
    <Field p={sel('Method', [['local', 'Local Adaptation'], ['exposureGamma', 'Exposure and Gamma'], ['equalize', 'Equalize Histogram']])} value={p.method} onChange={v => set('method', v)} />
    {p.method === 'local' && <>
      <Field p={rng('Radius', 1, 200, 1, 'px')} value={p.radius} onChange={v => set('radius', v)} />
      <Field p={rng('Strength', 0, 1, 0.01)} value={p.strength} onChange={v => set('strength', v)} />
      <Field p={rng('Detail', 0, 300, 1, '%')} value={p.detail} onChange={v => set('detail', v)} />
      <Field p={rng('Saturation', 0, 200, 1, '%')} value={p.saturation} onChange={v => set('saturation', v)} />
      <Field p={rng('Edge smoothness', 0.001, 0.5, 0.001)} value={p.edgeSmoothness} onChange={v => set('edgeSmoothness', v)} />
    </>}
    <Field p={rng('Exposure', -5, 5, 0.05, 'EV')} value={p.exposure} onChange={v => set('exposure', v)} />
    <Field p={rng('Gamma', 0.1, 4, 0.01)} value={p.gamma} onChange={v => set('gamma', v)} />
  </Shell>;
}

/**
 * View › Proof Setup › Custom. setup: { device, model, intent, bpc, simulatePaper }.
 * onApply(setup). device is 'cmyk' (uses `model`, CMYK press params) or an RGB profile name.
 * Caller: proofBuffer(buf, docProfile, device === 'cmyk' ? model : device, { intent, bpc, simulatePaper }).
 */
export function ProofSetupDialog({ setup, onCancel, onApply }) {
  const [s, setS] = useState(() => ({ device: 'cmyk', intent: 'relative', bpc: true, simulatePaper: false, ...(setup || {}), model: { ...defaultCmykParams(), ...(setup?.model || {}) } }));
  const set = (k, v) => setS(x => ({ ...x, [k]: v })), setM = (k, v) => setS(x => ({ ...x, model: { ...x.model, [k]: v } }));
  const cmyk = s.device === 'cmyk';
  return <Shell title="Customize Proof Condition" onCancel={onCancel} onOk={() => onApply(s)}>
    <Field p={sel('Device to simulate', [['cmyk', GENERIC_CMYK], ...RGB_PROFILE_NAMES.map(n => [n, n])])} value={s.device} onChange={v => set('device', v)} />
    {cmyk && <>
      <Field p={rng('Proof dot gain', 0, 40, 1, '%')} value={s.model.dotGain} onChange={v => setM('dotGain', v)} />
      <Field p={sel('Proof black generation', GCR)} value={s.model.gcr} onChange={v => setM('gcr', v)} />
      <Field p={rng('Proof total ink limit', 200, 400, 5, '%')} value={s.model.til} onChange={v => setM('til', v)} />
    </>}
    <Field p={sel('Rendering intent', INTENTS)} value={s.intent} onChange={v => set('intent', v)} />
    <Field p={chk('Black point compensation')} value={s.bpc} onChange={v => set('bpc', v)} />
    {cmyk && <Field p={chk('Simulate paper color')} value={s.simulatePaper} onChange={v => set('simulatePaper', v)} />}
  </Shell>;
}
