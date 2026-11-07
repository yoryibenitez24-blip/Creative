import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, ChevronRight, Plus, Trash2, Upload, Camera, X, RotateCcw } from 'lucide-react';
import { ALIGN_PRESETS, FRAME_DEFAULT, frameOf, framePatch, normFrame } from './frame.js';
import { NumField, ValueSlider } from '../editor/Inspector.jsx';
import { PAGE_LABELS } from './model.js';
import { SECTIONS } from './sections.js';

// Generic, labelled form controls for the store builder panels (dark modern inspector look).
// Every control carries a unique aria-label built from the `label` prop.

export { NumField, ValueSlider };

export const Field = ({ label, children, hint }) => <div className="stField"><span className="stFieldLabel">{label}</span>{children}{hint && <small className="stHint">{hint}</small>}</div>;

export function TextInput({ label, value, onChange, placeholder, type = 'text', list }) {
  return <Field label={label}><input className="stInput" type={type} aria-label={label} value={value ?? ''} placeholder={placeholder} list={list} onChange={e => onChange(e.target.value)} /></Field>;
}

export function TextArea({ label, value, onChange, rows = 3, placeholder }) {
  return <Field label={label}><textarea className="insText stArea" aria-label={label} rows={rows} value={value ?? ''} placeholder={placeholder} onChange={e => onChange(e.target.value)} /></Field>;
}

export function Select({ label, value, onChange, options, bare }) {
  const sel = <div className="insSelect"><select aria-label={label} value={value ?? ''} onChange={e => onChange(e.target.value)}>
    {options.map(o => Array.isArray(o) ? <option key={String(o[0])} value={o[0]}>{o[1]}</option> : <optgroup key={o.group} label={o.group}>{o.options.map(x => <option key={x[0]} value={x[0]}>{x[1]}</option>)}</optgroup>)}
  </select><ChevronDown size={14} /></div>;
  return bare ? sel : <Field label={label}>{sel}</Field>;
}

export function Toggle({ label, value, onChange }) {
  return <label className="stToggle"><span>{label}</span><input type="checkbox" role="switch" aria-label={label} checked={!!value} onChange={e => onChange(e.target.checked)} /><i aria-hidden="true" /></label>;
}

export function Segmented({ label, value, onChange, options }) {
  return <Field label={label}><div className="segmented stSeg" role="group" aria-label={label}>
    {options.map(([v, l]) => <button key={v} type="button" aria-pressed={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>)}
  </div></Field>;
}

export function ColorField({ label, value, onChange }) {
  const [draft, setDraft] = useState(null);
  const hex = /^#[0-9a-f]{6}$/i.test(value || '') ? value : '#000000';
  return <div className="stColor"><span className="stFieldLabel">{label}</span><div className="insColor">
    <input type="color" aria-label={label} value={hex} onChange={e => onChange(e.target.value)} />
    <input className="insHex" aria-label={label + ' hex'} value={draft ?? hex.toUpperCase().slice(1)} onChange={e => setDraft(e.target.value)}
      onBlur={() => { if (draft && /^[0-9a-f]{6}$/i.test(draft)) onChange('#' + draft.toLowerCase()); setDraft(null); }} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
  </div></div>;
}

/** Link target picker: pages, collections, products, or a custom URL. */
export function LinkPicker({ label, value, onChange, store }) {
  const v = value || 'home';
  const anchors = store.pages.home.filter(s => SECTIONS[s.type]).map(s => ['#' + s.id, 'Home: ' + SECTIONS[s.type].label + (s.settings.heading ? ' – ' + String(s.settings.heading).slice(0, 24) : '')]);
  const custom = v.startsWith('url:') || (v.startsWith('#') && !anchors.some(a => a[0] === v));
  const opts = [
    { group: 'Pages', options: [['home', 'Home'], ['collection:all', 'All products'], ['page:about', PAGE_LABELS.about], ['page:contact', PAGE_LABELS.contact], ['cart', 'Cart'], ['checkout', 'Checkout'], ['custom', 'Custom URL or anchor…']] },
    ...(anchors.length ? [{ group: 'Home page sections', options: anchors }] : []),
    ...(store.collections.length ? [{ group: 'Collections', options: store.collections.map(c => ['collection:' + c.id, c.title]) }] : []),
    ...(store.products.length ? [{ group: 'Products', options: store.products.map(p => ['product:' + p.id, p.title]) }] : []),
  ];
  return <Field label={label}>
    <Select bare label={label} value={custom ? 'custom' : v} options={opts} onChange={x => onChange(x === 'custom' ? 'url:https://' : x)} />
    {custom && <input className="stInput" aria-label={label + ' URL'} value={v.startsWith('url:') ? v.slice(4) : v} placeholder="https://… or mailto:…"
      onChange={e => { const x = e.target.value.trim(); onChange(x.startsWith('#') ? x : 'url:' + x); }} />}
  </Field>;
}

/**
 * Image position: focal point (drag the crosshair on the thumbnail, arrow keys), 3×3 alignment grid, zoom, fit, reset.
 * frame = { x, y, zoom, fit } (src/store/frame.js); onChange(frame, coalesceKey) — drags pass a coalesce key so one drag
 * is one undo step. `fit`/`zoom` false hide those controls (avatars).
 */
export function FrameControl({ label, src, frame, onChange, fit = true, zoom = true, heading = 'Position' }) {
  const f = normFrame(frame), box = useRef(null), raf = useRef(0), next = useRef(null), fRef = useRef(f);
  const [broken, setBroken] = useState('');   // src that failed to load (offline photo): show a neutral 4:3 stand-in
  fRef.current = f;
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  const set = (patch, co) => onChange(normFrame({ ...fRef.current, ...patch }), co);
  const at = e => { const r = box.current.getBoundingClientRect(); return { x: Math.round(Math.min(100, Math.max(0, (e.clientX - r.left) / r.width * 100))), y: Math.round(Math.min(100, Math.max(0, (e.clientY - r.top) / r.height * 100))) }; };
  const queue = p => { next.current = p; if (!raf.current) raf.current = requestAnimationFrame(() => { raf.current = 0; if (next.current) set(next.current, 'focal'); next.current = null; }); };
  const down = e => { if (e.button) return; e.preventDefault(); box.current.setPointerCapture?.(e.pointerId); box.current.focus(); queue(at(e)); };
  const move = e => { if (box.current.hasPointerCapture?.(e.pointerId)) queue(at(e)); };
  const key = e => {
    const d = e.shiftKey ? 10 : 2, k = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] }[e.key];
    if (k) { e.preventDefault(); set({ x: f.x + k[0], y: f.y + k[1] }, 'focal-key'); }
  };
  const isDefault = f.x === 50 && f.y === 50 && f.zoom === 100 && f.fit === 'cover';
  return <div className="stFrameCtl" role="group" aria-label={label + ' position'}>
    <div className="stFrameHead"><span className="stFieldLabel">{heading}</span><output className="stFrameRead">{f.x}% · {f.y}%</output>
      <button type="button" className="stFrameReset" aria-label={'Reset ' + label.toLowerCase() + ' position'} title="Reset to centre" disabled={isDefault} onClick={() => onChange({ ...FRAME_DEFAULT })}><RotateCcw size={11} />Reset</button></div>
    <div className="stFrameRow">
      <div className="stFocusWell">
        {src ? <div className="stFocus" ref={box} tabIndex={0} role="slider" aria-label={label + ' focal point'} aria-valuetext={`${f.x}% from left, ${f.y}% from top`} aria-valuenow={f.x} aria-valuemin={0} aria-valuemax={100}
          onPointerDown={down} onPointerMove={move} onKeyDown={key}>
          {broken === src ? <span className="stFocusStandIn">Preview unavailable</span> : <img src={src} alt="" draggable={false} onError={() => setBroken(src)} />}
          <span className="stFocusV" style={{ left: f.x + '%' }} /><span className="stFocusH" style={{ top: f.y + '%' }} />
          <span className="stFocusDot" style={{ left: f.x + '%', top: f.y + '%' }} />
        </div> : <span className="stHint">No preview</span>}
      </div>
      <div className="stAlignGrid" role="group" aria-label={label + ' alignment'}>
        {ALIGN_PRESETS.map(([k, l, x, y]) => { const on = f.x === x && f.y === y; return <button key={k} type="button" className={on ? 'on' : ''} aria-pressed={on} title={l}
          aria-label={`Align ${label.toLowerCase()} ${l.toLowerCase()}`} onClick={() => set({ x, y })}><i /></button>; })}
      </div>
    </div>
    {zoom && <div className={'stFrameZoom' + (f.fit === 'contain' ? ' off' : '')}><ValueSlider label={label + ' zoom'} value={f.zoom} min={100} max={200} step={5} onChange={v => set({ zoom: v }, 'zoom')} /></div>}
    {fit && <div className="segmented stSeg stFrameFit" role="group" aria-label={label + ' fit'}>
      {[['cover', 'Fill (cover)'], ['contain', 'Fit (contain)']].map(([v, l]) => <button key={v} type="button" aria-pressed={f.fit === v} className={f.fit === v ? 'on' : ''} onClick={() => set({ fit: v })}>{l}</button>)}
    </div>}
  </div>;
}

/** Image picker: thumbnail, upload, product photo studio, remove; with `onFrame` also the image position controls. */
export function ImageField({ label, value, onChange, imageUrl, onUpload, onOpenPhotoStudio, frame, onFrame, frameOpts }) {
  const input = useRef(null);
  const url = value ? imageUrl(value) : '';
  const framing = !!(value && onFrame);
  return <div className="stImageField"><span className="stFieldLabel">{label}</span>
    <div className="stImageRow">
      {!framing && <div className="stThumb" aria-hidden="true">{url ? <img src={url} alt="" /> : <span>None</span>}</div>}
      <div className="stImageBtns">
        <button type="button" className="stBtn" aria-label={'Upload ' + label} onClick={() => input.current.click()}><Upload size={13} />Upload</button>
        {onOpenPhotoStudio && <button type="button" className="stBtn ghost" aria-label={'Product photo studio for ' + label} title="Product photo studio" onClick={onOpenPhotoStudio}><Camera size={13} />Product photo studio</button>}
        {value && <button type="button" className="stBtn ghost" aria-label={'Remove ' + label} onClick={() => onChange(null)}><X size={13} />Remove</button>}
      </div>
    </div>
    <input ref={input} type="file" accept="image/*" hidden aria-label={label + ' file'} onChange={async e => { const f = e.target.files[0]; e.target.value = ''; if (f) onChange(await onUpload(f)); }} />
    {framing && <FrameControl label={label} src={url} frame={frame} onChange={onFrame} {...frameOpts} />}
  </div>;
}

/** Repeating items (slides, FAQ, plans…). */
export function ListField({ label, itemLabel = 'Item', items, item, onChange, renderField }) {
  const [open, setOpen] = useState(0);
  const list = Array.isArray(items) ? items : [];
  const set = (i, k, v) => onChange(list.map((x, j) => j === i ? { ...x, [k]: v } : x));
  const patch = (i, obj, co) => onChange(list.map((x, j) => j === i ? { ...x, ...obj } : x), co);
  const move = (i, d) => { const n = [...list]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x); onChange(n); setOpen(i + d); };
  const blank = () => Object.fromEntries(item.map(f => [f.key, f.type === 'toggle' ? false : f.type === 'image' ? null : f.type === 'link' ? 'home' : '']));
  const title = (x, i) => { const t = item.find(f => f.type === 'text'); return (t && x[t.key]) || `${itemLabel} ${i + 1}`; };
  return <div className="stList"><span className="stFieldLabel">{label}</span>
    {list.map((x, i) => <div key={i} className={'stListItem' + (open === i ? ' open' : '')}>
      <div className="stListHead">
        <button type="button" className="stListTitle" aria-expanded={open === i} aria-label={`${itemLabel} ${i + 1}: ${title(x, i)}`} onClick={() => setOpen(open === i ? -1 : i)}>{open === i ? <ChevronDown size={13} /> : <ChevronRight size={13} />}<span>{title(x, i)}</span></button>
        <button type="button" className="insIcon" aria-label={`Move ${itemLabel} ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}><ChevronUp size={13} /></button>
        <button type="button" className="insIcon" aria-label={`Move ${itemLabel} ${i + 1} down`} disabled={i === list.length - 1} onClick={() => move(i, 1)}><ChevronDown size={13} /></button>
        <button type="button" className="insIcon" aria-label={`Delete ${itemLabel} ${i + 1}`} onClick={() => onChange(list.filter((_, j) => j !== i))}><Trash2 size={13} /></button>
      </div>
      {open === i && <div className="stListBody">{item.map(f => <React.Fragment key={f.key}>{renderField({ ...f, label: `${itemLabel} ${i + 1} ${f.label.toLowerCase()}` }, x[f.key], v => set(i, f.key, v), x, (obj, co) => patch(i, obj, co))}</React.Fragment>)}</div>}
    </div>)}
    <button type="button" className="stBtn ghost wide" onClick={() => { onChange([...list, blank()]); setOpen(list.length); }}><Plus size={13} />Add {itemLabel.toLowerCase()}</button>
  </div>;
}

/**
 * Render one schema field (see sections.js) with the right control.
 * owner + onPatch(settingsPatch, coalesceKey): the object holding the field, so an image field can also edit its frame
 * (<key>Pos / <key>Fit / <key>Zoom); choosing a new image resets the frame.
 */
export function SchemaField({ field: f, value, onChange, env, owner, onPatch }) {
  const L = f.label;
  switch (f.type) {
    case 'text': return <TextInput label={L} value={value} onChange={onChange} />;
    case 'textarea': return <TextArea label={L} value={value} onChange={onChange} />;
    case 'number': return <Field label={L}><NumField label={L} value={value} min={f.min} max={f.max} step={f.step || 1} onChange={onChange} /></Field>;
    case 'color': return <ColorField label={L} value={value} onChange={onChange} />;
    case 'select': return <Select label={L} value={value} options={f.options.map(([v, l]) => [v, l])} onChange={v => onChange(typeof f.options[0][0] === 'number' ? +v : v)} />;
    case 'toggle': return <Toggle label={L} value={value} onChange={onChange} />;
    case 'datetime': return <TextInput label={L} type="datetime-local" value={value} onChange={onChange} />;
    case 'link': return <LinkPicker label={L} value={value} onChange={onChange} store={env.store} />;
    case 'collection': return <Select label={L} value={value} options={[['', 'All products'], ...env.store.collections.map(c => [c.id, c.title])]} onChange={onChange} />;
    case 'image': {
      const small = f.key === 'avatar' || /avatar/i.test(L);
      return <ImageField label={L} value={value} imageUrl={env.imageUrl} onUpload={env.upload} onOpenPhotoStudio={env.onOpenPhotoStudio}
        onChange={v => onPatch ? onPatch({ [f.key]: v, ...framePatch(f.key, FRAME_DEFAULT) }) : onChange(v)}
        frame={owner && frameOf(owner, f.key)} onFrame={owner && onPatch ? (fr, co) => onPatch(framePatch(f.key, fr), co) : null} frameOpts={{ fit: !small, zoom: !small }} />;
    }
    case 'list': return <ListField label={L} itemLabel={f.itemLabel} items={value} item={f.item} onChange={onChange} renderField={(ff, v, ch, item, patch) => <SchemaField field={ff} value={v} onChange={ch} env={env} owner={item} onPatch={patch} />} />;
  }
  return null;
}

