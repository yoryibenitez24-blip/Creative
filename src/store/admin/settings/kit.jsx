// Building blocks of the Settings pages (styles: dist/css/settings.css, prefix "cs"): section with heading and
// description, rounded cards made of rows (label / value / chevron, "…" menus, inline selects, switches),
// validated text fields, copy lines and status pills.
import React, { useEffect, useId, useRef, useState } from 'react';
import { ChevronRight, Ellipsis, Copy, Check as CheckIcon } from 'lucide-react';
import { useAdmin } from '../ui.jsx';
import { validateField } from '../../integrations.js';

/** A titled group of settings: heading + one-line description, then a card. id → anchor "cs-<id>" for search jumps. */
export function Section({ id, title, desc, actions, children, bare }) {
  return <section className="csSection" id={id ? 'cs-' + id : undefined} aria-label={title}>
    <div className="csSecHead"><div className="csSecText"><h2>{title}</h2>{desc && <p>{desc}</p>}</div>{actions && <div className="csSecActions">{actions}</div>}</div>
    {bare ? children : <div className="csCard">{children}</div>}
  </section>;
}

/** One row of a card. With onClick the whole row is a button (chevron on the right). */
export function Row({ id, icon: Icon, label, sub, value, onClick, aside, menu, children, className = '', tone }) {
  const head = <>
    {Icon && <span className="csRowIcon" aria-hidden="true"><Icon size={16} /></span>}
    <span className="csRowMain"><span className="csRowLabel">{label}</span>{sub && <span className="csRowSub">{sub}</span>}</span>
    {value != null && value !== '' && <span className={'csRowValue' + (tone ? ' ' + tone : '')}>{value}</span>}
    {onClick && <ChevronRight className="csChev" size={16} aria-hidden="true" />}
  </>;
  return <div className={'csRow ' + className} id={id ? 'cs-' + id : undefined}>
    {onClick ? <button type="button" className="csRowBtn" onClick={onClick}>{head}</button> : <div className="csRowHead">{head}{aside && <div className="csRowAside">{aside}</div>}{menu}</div>}
    {children && <div className="csRowBody">{children}</div>}
  </div>;
}

/** Switch row (checkbox with role="switch"). */
export function Toggle({ id, label, desc, checked, onChange, disabled, children }) {
  const uid = useId();
  return <div className="csRow" id={id ? 'cs-' + id : undefined}>
    <div className="csRowHead">
      <span className="csRowMain"><label className="csRowLabel" htmlFor={uid}>{label}</label>{desc && <span className="csRowSub" id={uid + '-d'}>{desc}</span>}</span>
      <input id={uid} type="checkbox" role="switch" className="csSwitch" checked={!!checked} disabled={disabled} aria-describedby={desc ? uid + '-d' : undefined} onChange={e => onChange(e.target.checked)} />
    </div>
    {children && checked && <div className="csRowBody">{children}</div>}
  </div>;
}

/** Row with an inline select on the right (e.g. "Required / Optional / Don't include"). */
export function SelectRow({ id, label, desc, value, options, onChange }) {
  const uid = useId();
  return <div className="csRow" id={id ? 'cs-' + id : undefined}>
    <div className="csRowHead">
      <span className="csRowMain"><label className="csRowLabel" htmlFor={uid}>{label}</label>{desc && <span className="csRowSub">{desc}</span>}</span>
      <select id={uid} className="csSelect" value={value} onChange={e => onChange(e.target.value)}>{options.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
    </div>
  </div>;
}

/** Radio choices as a list of cards. */
export function Choice({ label, value, options, onChange, name }) {
  const uid = useId();
  return <div className="csChoice" role="radiogroup" aria-label={label}>{options.map(([k, l, d]) => <label key={k} className={'csChoiceItem' + (value === k ? ' on' : '')}>
    <input type="radio" name={name || uid} value={k} checked={value === k} onChange={() => onChange(k)} />
    <span><strong>{l}</strong>{d && <small>{d}</small>}</span></label>)}</div>;
}

/** Text input with validation (vkey → integrations.js VALIDATORS; secret-looking values are always refused). */
export function Input({ label, value, onChange, vkey, hint, placeholder, type = 'text', mono, wide, counter, maxLength, ...p }) {
  const id = useId(), v = value == null ? '' : String(value), err = vkey ? validateField(vkey, v) : '';
  return <div className={'caField' + (wide ? ' wide' : '')}>
    <label className="caLabel" htmlFor={id}>{label}{counter && <span className={'csCount' + (v.length > counter ? ' over' : '')} aria-hidden="true">{v.length}/{counter}</span>}</label>
    <input id={id} className={'caInput' + (mono ? ' csMono' : '') + (err ? ' csBad' : '')} type={type} value={v} placeholder={placeholder} maxLength={maxLength} spellCheck={mono ? false : undefined} autoComplete="off"
      aria-invalid={err ? true : undefined} aria-describedby={err ? id + '-e' : hint ? id + '-h' : undefined} onChange={e => onChange(e.target.value)} {...p} />
    {err ? <small className="csErr" id={id + '-e'} role="alert">{err}</small> : hint && <small className="caHint" id={id + '-h'}>{hint}</small>}
  </div>;
}

/** "…" menu. items: [[label, onClick, danger?]]. */
export function Menu({ label, items }) {
  const [open, setOpen] = useState(false), box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const off = e => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const key = e => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', off); window.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('mousedown', off); window.removeEventListener('keydown', key, true); };
  }, [open]);
  return <div className="csMenu" ref={box}>
    <button type="button" className="csIconBtn" aria-label={`${label} actions`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(v => !v)}><Ellipsis size={16} /></button>
    {open && <ul role="menu" className="csMenuList">{items.filter(Boolean).map(([l, fn, danger]) => <li key={l} role="none"><button type="button" role="menuitem" className={danger ? 'danger' : ''} onClick={() => { setOpen(false); fn(); }}>{l}</button></li>)}</ul>}
  </div>;
}

export const Pill = ({ tone = 'neutral', children }) => <span className={'csPill ' + tone}>{children}</span>;

/** Read-only value with a copy button. */
export function CopyLine({ label, value, wrap }) {
  const { notify } = useAdmin();
  const [done, setDone] = useState(false);
  const copy = () => { const p = navigator.clipboard?.writeText(value); (p || Promise.reject()).then(() => { setDone(true); setTimeout(() => setDone(false), 1400); notify(`${label} copied`); }, () => notify('Copy failed — select the text and copy it manually.')); };
  return <div className={'csCopy' + (wrap ? ' wrap' : '')}><code aria-label={label}>{value}</code>
    <button type="button" className="csIconBtn" aria-label={`Copy ${label}`} title="Copy" onClick={copy} disabled={!value}>{done ? <CheckIcon size={14} /> : <Copy size={14} />}</button></div>;
}

/** Flag emoji for an ISO 3166 alpha-2 code ('' for anything else). */
export const flag = code => /^[A-Z]{2}$/.test(code || '') ? String.fromCodePoint(...[...code].map(c => 0x1f1a5 + c.charCodeAt(0))) : '';

/** Small note line inside a card. */
export const Note = ({ children, tone = '', ...p }) => <div className={'csNote ' + tone} {...p}>{children}</div>;
