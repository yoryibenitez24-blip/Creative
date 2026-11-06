import React, { useEffect, useRef, useState } from 'react';
import { FONT_FAMILIES, WARP_STYLES, WARP_DEFAULT, charStyleAt, paraStyle, applyCharStyle, warpPoint, layoutText } from '../engine/textlayout.js';
import { Field } from './OpDialog.jsx';
import { renderWarped, measure } from './TextLayer.jsx';

// Photoshop-style Character and Paragraph panels and the Warp Text dialog.
// Character changes apply to the whole layer, or, when `selection` ({start, end}, end exclusive,
// e.g. from TextEditOverlay) is a non-empty range, to those characters as a style run (patch = {runs}).
// With a collapsed caret inside the text, the kerning amount edits the manual pair at the caret.

const WEIGHTS = [[100, 'Thin'], [300, 'Light'], [400, 'Regular'], [500, 'Medium'], [600, 'Semibold'], [700, 'Bold'], [800, 'Extra Bold'], [900, 'Black']];
const LANGUAGES = [['en-US', 'English: USA'], ['en-GB', 'English: UK'], ['de-DE', 'German'], ['fr-FR', 'French'], ['es-ES', 'Spanish'], ['it-IT', 'Italian'], ['nl-NL', 'Dutch'], ['pt-BR', 'Portuguese: Brazilian'], ['sv-SE', 'Swedish'], ['da-DK', 'Danish'], ['nb-NO', 'Norwegian'], ['fi-FI', 'Finnish'], ['pl-PL', 'Polish'], ['cs-CZ', 'Czech'], ['tr-TR', 'Turkish'], ['ru-RU', 'Russian'], ['ja-JP', 'Japanese'], ['zh-CN', 'Chinese: Simplified']];
const WARP_NAMES = { none: 'None', arc: 'Arc', arcLower: 'Arc Lower', arcUpper: 'Arc Upper', arch: 'Arch', bulge: 'Bulge', shellLower: 'Shell Lower', shellUpper: 'Shell Upper', flag: 'Flag', wave: 'Wave', fish: 'Fish', rise: 'Rise', fisheye: 'Fish Eye', inflate: 'Inflate', squeeze: 'Squeeze', twist: 'Twist' };
const family = f => String(f).split(',')[0].replace(/['"]/g, '').trim();

// Number field: typing a valid number applies it immediately; blur/Enter normalises the text.
// With a placeholder, clearing the field applies '' (used for "Auto" leading).
function Num({ label, value, onChange, step = 1, min, max, unit, placeholder }) {
  const [draft, setDraft] = useState(null);
  const clamp = n => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
  const apply = v => { if (v === '' && placeholder) onChange(''); else if (v !== '' && Number.isFinite(+v)) onChange(clamp(+v)); };
  const shown = draft ?? (value === '' || value == null ? '' : +(+value).toFixed(2));
  return <label className="typeNum" title={label}><span>{label}</span>
    <input type="number" aria-label={label} step={step} min={min} max={max} value={shown} placeholder={placeholder}
      onChange={e => { setDraft(e.target.value); apply(e.target.value); }}
      onBlur={() => setDraft(null)} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') setDraft(null); }} />
    {unit && <small>{unit}</small>}</label>;
}

function Toggle({ label, text, on, onClick, style }) {
  return <button type="button" className={'typeToggle' + (on ? ' on' : '')} aria-label={label} title={label} aria-pressed={!!on} onClick={onClick} style={style}>{text}</button>;
}

export function CharacterPanel({ layer, selection, onChange }) {
  const ranged = selection && selection.end > selection.start;
  const caret = selection && selection.end === selection.start && selection.start > 0 && selection.start < String(layer.text ?? '').length ? selection.start : null;
  const st = charStyleAt(layer, ranged ? selection.start : 0);
  const set = patch => onChange(ranged ? { runs: applyCharStyle(layer, selection.start, selection.end, patch) } : patch);
  const fonts = FONT_FAMILIES.includes(st.font) ? FONT_FAMILIES : [st.font, ...FONT_FAMILIES];
  const kernMode = typeof st.kerning === 'number' ? 'custom' : st.kerning;
  const kernValue = caret != null ? (layer.kerningPairs?.[caret] || 0) : typeof st.kerning === 'number' ? st.kerning : 0;
  const setKern = v => caret != null ? onChange({ kerningPairs: { ...(layer.kerningPairs || {}), [caret]: v } }) : set({ kerning: v });
  const leading = st.leading === 'auto' || st.leading == null ? '' : st.leading;
  const tracking = st.tracking ?? Math.round((layer.spacing || 0) / st.size * 1000);
  return <div className="typePanel" role="group" aria-label="Character">
    <h4>Character{ranged ? <small> · {selection.end - selection.start} selected</small> : caret != null ? <small> · caret at {caret}</small> : null}</h4>
    <div className="typeRow">
      <select aria-label="Font family" value={st.font} onChange={e => set({ font: e.target.value })} style={{ flex: 2 }}>
        {fonts.map(f => <option key={f} value={f} style={{ fontFamily: f }}>{family(f)}</option>)}
      </select>
      <select aria-label="Font style" value={st.weight + '|' + (st.italic ? 1 : 0)} onChange={e => { const [w, i] = e.target.value.split('|'); set({ weight: +w, italic: i === '1' }); }} style={{ flex: 1.4 }}>
        {WEIGHTS.flatMap(([w, n]) => [<option key={w} value={w + '|0'}>{n}</option>, <option key={w + 'i'} value={w + '|1'}>{n} Italic</option>])}
        {!WEIGHTS.some(([w]) => w === +st.weight) && <option value={st.weight + '|' + (st.italic ? 1 : 0)}>{st.weight}</option>}
      </select>
    </div>
    <div className="typeGrid">
      <Num label="Font size" value={st.size} min={1} max={2000} step={1} unit="px" onChange={v => set({ size: v })} />
      <Num label="Leading" value={leading} min={0} max={4000} placeholder={st.leading == null ? 'Auto (' + (layer.lineHeight || 1.1) + '×)' : 'Auto'} unit="px" onChange={v => set({ leading: v === '' ? 'auto' : v })} />
      <label className="typeNum"><span>Kerning</span>
        <select aria-label="Kerning method" value={caret != null ? 'custom' : kernMode} disabled={caret != null} onChange={e => set({ kerning: e.target.value === 'custom' ? 0 : e.target.value })}>
          <option value="metrics">Metrics</option><option value="optical">Optical</option><option value="none">0</option><option value="custom">Custom</option>
        </select></label>
      <Num label={caret != null ? 'Kerning at caret' : 'Kerning amount'} value={kernValue} min={-1000} max={10000} step={5} unit="/1000 em" onChange={setKern} />
      <Num label="Tracking" value={tracking} min={-1000} max={10000} step={5} unit="/1000 em" onChange={v => set({ tracking: v })} />
      <Num label="Baseline shift" value={st.baselineShift} min={-1000} max={1000} step={1} unit="px" onChange={v => set({ baselineShift: v })} />
      <Num label="Vertical scale" value={st.vScale} min={1} max={1000} unit="%" onChange={v => set({ vScale: v })} />
      <Num label="Horizontal scale" value={st.hScale} min={1} max={1000} unit="%" onChange={v => set({ hScale: v })} />
    </div>
    <label className="typeColor"><span>Color</span><input type="color" aria-label="Text color" value={/^#[0-9a-f]{6}$/i.test(st.fill) ? st.fill : '#000000'} onChange={e => set({ fill: e.target.value })} /><code>{String(st.fill).toUpperCase()}</code></label>
    <div className="typeToggles" role="group" aria-label="Type styles">
      <Toggle label="Faux Bold" text="T" style={{ fontWeight: 800 }} on={st.fauxBold} onClick={() => set({ fauxBold: !st.fauxBold })} />
      <Toggle label="Faux Italic" text="T" style={{ fontStyle: 'italic' }} on={st.fauxItalic} onClick={() => set({ fauxItalic: !st.fauxItalic })} />
      <Toggle label="All Caps" text="TT" on={st.allCaps} onClick={() => set({ allCaps: !st.allCaps, smallCaps: false })} />
      <Toggle label="Small Caps" text={<>T<small>T</small></>} on={st.smallCaps} onClick={() => set({ smallCaps: !st.smallCaps, allCaps: false })} />
      <Toggle label="Superscript" text={<>T<sup>1</sup></>} on={st.superscript} onClick={() => set({ superscript: !st.superscript, subscript: false })} />
      <Toggle label="Subscript" text={<>T<sub>1</sub></>} on={st.subscript} onClick={() => set({ subscript: !st.subscript, superscript: false })} />
      <Toggle label="Underline" text="T" style={{ textDecoration: 'underline' }} on={st.underline} onClick={() => set({ underline: !st.underline })} />
      <Toggle label="Strikethrough" text="T" style={{ textDecoration: 'line-through' }} on={st.strikethrough} onClick={() => set({ strikethrough: !st.strikethrough })} />
    </div>
    <div className="typeRow">
      <label className="optCheck"><input type="checkbox" aria-label="Standard ligatures" checked={st.ligatures} onChange={e => set({ ligatures: e.target.checked })} />Ligatures</label>
      <select aria-label="Language" value={st.language} onChange={e => set({ language: e.target.value })}>
        {(LANGUAGES.some(([v]) => v === st.language) ? LANGUAGES : [[st.language, st.language], ...LANGUAGES]).map(([v, n]) => <option key={v} value={v}>{n}</option>)}
      </select>
    </div>
    <small className="hint">Optical kerning is an approximation: it averages the font's kerning with a correction from measured glyph bounds.</small>
  </div>;
}

// Alignment icon: 4 lines; `kind` decides each line's horizontal placement.
function AlignIcon({ kind }) {
  const lens = [14, 10, 14, 8];
  return <svg width="16" height="14" viewBox="0 0 16 14" aria-hidden="true">{lens.map((l, i) => {
    const last = i === 3, full = kind.startsWith('justify') && (!last || kind === 'justify-all');
    const a = full ? 'full' : kind.replace('justify-', '');
    const w = full ? 14 : l, x = a === 'center' ? 1 + (14 - w) / 2 : a === 'right' ? 15 - w : 1;
    return <rect key={i} x={x} y={1 + i * 3.4} width={w} height="1.6" fill="currentColor" />;
  })}</svg>;
}
const ALIGNS = [['left', 'Left align text'], ['center', 'Center text'], ['right', 'Right align text'], ['justify-left', 'Justify last left'], ['justify-center', 'Justify last centered'], ['justify-right', 'Justify last right'], ['justify-all', 'Justify all']];

/** onChange(patch): paragraph props are layer-wide. Converting to paragraph text keeps the current
 *  box (w/h) when it is large enough, otherwise sizes it to the measured text; to point text drops wrapping. */
export function ParagraphPanel({ layer, onChange }) {
  const P = paraStyle(layer), para = layer.kind === 'paragraph';
  const convert = () => {
    if (para) return onChange({ kind: 'point' });
    const L = layoutText(layer, measure);
    onChange({ kind: 'paragraph', w: Math.max(layer.w || 0, Math.ceil(L.width) + 2), h: Math.max(layer.h || 0, Math.ceil(L.height) + 2) });
  };
  return <div className="typePanel" role="group" aria-label="Paragraph">
    <h4>Paragraph<small> · {para ? 'Paragraph text' : 'Point text'}</small></h4>
    <div className="typeAligns" role="group" aria-label="Paragraph alignment">
      {ALIGNS.map(([k, n]) => <button key={k} type="button" aria-label={n} title={n + (k.startsWith('justify') && !para ? ' (paragraph text only; point text uses the last-line alignment)' : '')} aria-pressed={P.align === k} className={'typeToggle' + (P.align === k ? ' on' : '')} onClick={() => onChange({ align: k })}><AlignIcon kind={k} /></button>)}
    </div>
    <div className="typeGrid">
      <Num label="Indent left margin" value={P.indentLeft} min={-2000} max={2000} unit="px" onChange={v => onChange({ indentLeft: v })} />
      <Num label="Indent right margin" value={P.indentRight} min={-2000} max={2000} unit="px" onChange={v => onChange({ indentRight: v })} />
      <Num label="Indent first line" value={P.indentFirst} min={-2000} max={2000} unit="px" onChange={v => onChange({ indentFirst: v })} />
      <Num label="Space before paragraph" value={P.spaceBefore} min={0} max={2000} unit="px" onChange={v => onChange({ spaceBefore: v })} />
      <Num label="Space after paragraph" value={P.spaceAfter} min={0} max={2000} unit="px" onChange={v => onChange({ spaceAfter: v })} />
    </div>
    <label className="optCheck"><input type="checkbox" aria-label="Hyphenate" checked={P.hyphenate} disabled={!para} onChange={e => onChange({ hyphenate: e.target.checked })} />Hyphenate{!para && <small> (paragraph text)</small>}</label>
    <button type="button" className="typeConvert" onClick={convert}>{para ? 'Convert to Point Text' : 'Convert to Paragraph Text'}</button>
  </div>;
}

function WarpPreview({ layer, warp }) {
  const ref = useRef(null);
  const sample = { ...layer, text: String(layer.text || 'Sample').split('\n')[0].slice(0, 40) || 'Sample', kind: 'point', onPath: null, x: 0, y: 0 };
  useEffect(() => {
    const cv = ref.current; if (!cv) return; const c = cv.getContext('2d'), W = cv.width, H = cv.height;
    c.clearRect(0, 0, W, H); c.fillStyle = '#151517'; c.fillRect(0, 0, W, H);
    const r = renderWarped(sample, warp, 6e5);
    if (!r) return;
    const box = { x: Math.min(r.x, 0), y: Math.min(r.y, 0), w: 0, h: 0 };
    const L = layoutText(sample, measure).bounds, gx = [r.x, r.x + r.w, L.x, L.x + L.w], gy = [r.y, r.y + r.h, L.y, L.y + L.h];
    box.x = Math.min(...gx); box.y = Math.min(...gy); box.w = Math.max(...gx) - box.x; box.h = Math.max(...gy) - box.y;
    const k = Math.min((W - 20) / box.w, (H - 20) / box.h), tx = (W - box.w * k) / 2 - box.x * k, ty = (H - box.h * k) / 2 - box.y * k;
    // warped grid (the envelope), then the warped text
    c.strokeStyle = '#6d5aa8'; c.lineWidth = 1;
    const wp = { ...WARP_DEFAULT, ...warp }, P = (x, y) => { const p = warpPoint(wp.style, wp.bend, wp.hDistortion, wp.vDistortion, L, x, y, wp.horizontal !== false); return [tx + p.x * k, ty + p.y * k]; };
    for (let i = 0; i <= 6; i++) for (const vert of [0, 1]) {
      c.beginPath();
      for (let j = 0; j <= 30; j++) { const a = i / 6, b = j / 30, [x, y] = vert ? P(L.x + a * L.w, L.y + b * L.h) : P(L.x + b * L.w, L.y + a * L.h); j ? c.lineTo(x, y) : c.moveTo(x, y); }
      c.stroke();
    }
    const img = new Image(); img.onload = () => c.drawImage(img, tx + r.x * k, ty + r.y * k, r.w * k, r.h * k); img.src = r.url;
  });
  return <canvas ref={ref} className="typeWarpPreview" width="300" height="140" aria-label="Warp preview" role="img" />;
}

/** Warp Text dialog. onApply(warp) receives { style, bend, hDistortion, vDistortion, horizontal }. */
export function WarpTextDialog({ layer, onCancel, onApply }) {
  const [w, setW] = useState(() => ({ ...WARP_DEFAULT, ...(layer.warp || {}), style: layer.warp?.style || 'arc' }));
  const set = (k, v) => setW(p => ({ ...p, [k]: v })), off = w.style === 'none';
  return <div className="opDialog typeWarpDialog" role="dialog" aria-label="Warp Text" onPointerDown={e => e.stopPropagation()}
    onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') onCancel(); if (e.key === 'Enter' && e.target.tagName !== 'SELECT') onApply(w); }}>
    <header><h3>Warp Text</h3>{layer.onPath?.d && <span className="opStatus" role="status">Text on a path is not warped</span>}</header>
    <div className="opFields">
      <label className="opField"><span>Style</span><select aria-label="Warp style" value={w.style} onChange={e => set('style', e.target.value)}>{WARP_STYLES.map(s => <option key={s} value={s}>{WARP_NAMES[s]}</option>)}</select></label>
      <div className="typeRow" role="radiogroup" aria-label="Warp orientation">
        <label className="optCheck"><input type="radio" name="typeWarpOrient" aria-label="Horizontal" checked={w.horizontal !== false} disabled={off} onChange={() => set('horizontal', true)} />Horizontal</label>
        <label className="optCheck"><input type="radio" name="typeWarpOrient" aria-label="Vertical" checked={w.horizontal === false} disabled={off} onChange={() => set('horizontal', false)} />Vertical</label>
      </div>
      <fieldset disabled={off} className="typeFieldset">
        <Field p={{ type: 'range', label: 'Bend', min: -100, max: 100, step: 1, unit: '%' }} value={w.bend} onChange={v => set('bend', v)} />
        <Field p={{ type: 'range', label: 'Horizontal Distortion', min: -100, max: 100, step: 1, unit: '%' }} value={w.hDistortion} onChange={v => set('hDistortion', v)} />
        <Field p={{ type: 'range', label: 'Vertical Distortion', min: -100, max: 100, step: 1, unit: '%' }} value={w.vDistortion} onChange={v => set('vDistortion', v)} />
      </fieldset>
      <WarpPreview layer={layer} warp={w} />
    </div>
    <footer>
      <button type="button" onClick={() => onApply({ ...WARP_DEFAULT, style: 'none' })}>Remove Warp</button>
      <button type="button" onClick={onCancel}>Cancel</button>
      <button type="button" className="primary" onClick={() => onApply(w)}>OK</button>
    </footer>
  </div>;
}
