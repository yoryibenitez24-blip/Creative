// Shared building blocks of the commerce admin: context, form fields, cards, modal/confirm, badges,
// SVG charts and empty-state illustrations. Styles: dist/css/admin.css (prefix "ca").
import React, { createContext, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';

export const AdminCtx = createContext(null);
export const useAdmin = () => useContext(AdminCtx);

// ---------- layout ----------
export function Page({ title, back, actions, children, subtitle, narrow }) {
  return <div className={'caPage' + (narrow ? ' narrow' : '')}>
    <div className="caPageHead">
      {back}
      <div className="caPageTitle"><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>
      <div className="caPageActions">{actions}</div>
    </div>
    {children}
  </div>;
}
export function Card({ title, actions, children, className = '', pad = true, ...rest }) {
  return <section className={'caCard ' + className} aria-label={typeof title === 'string' ? title : undefined} {...rest}>
    {(title || actions) && <header className="caCardHead">{title && <h2>{title}</h2>}{actions && <div className="caCardActions">{actions}</div>}</header>}
    <div className={pad ? 'caCardBody' : ''}>{children}</div>
  </section>;
}
export const Grid = ({ children, cols = 2, className = '' }) => <div className={`caGrid c${cols} ${className}`}>{children}</div>;
export const Badge = ({ tone = 'neutral', children }) => <span className={'caBadge ' + tone}>{children}</span>;
const KIND = { primary: 'caPrimary', danger: 'caDanger', plain: 'caPlain' };
export const Btn = ({ kind = '', icon: Icon, children, className = '', ...p }) => <button type="button" className={`caBtn ${KIND[kind] || ''} ${className}`} {...p}>{Icon && <Icon size={14} aria-hidden="true" />}{children}</button>;

// ---------- fields (label → control via htmlFor; hints are linked with aria-describedby) ----------
export function Field({ label, hint, children, wide }) {
  const id = useId();
  const body = typeof children === 'function' ? children(id, hint ? id + '-hint' : undefined) : children;
  return <div className={'caField' + (wide ? ' wide' : '')}><label className="caLabel" htmlFor={id}>{label}</label>{body}{hint && <small className="caHint" id={id + '-hint'}>{hint}</small>}</div>;
}
export function Text({ label, value, onChange, hint, wide, type = 'text', placeholder, ...p }) {
  return <Field label={label} hint={hint} wide={wide}>{(id, d) => <input id={id} aria-describedby={d} className="caInput" type={type} value={value ?? ''} placeholder={placeholder} onChange={e => onChange(e.target.value)} {...p} />}</Field>;
}
export function Area({ label, value, onChange, rows = 4, hint, wide, ...p }) {
  return <Field label={label} hint={hint} wide={wide}>{(id, d) => <textarea id={id} aria-describedby={d} className="caInput" rows={rows} value={value ?? ''} onChange={e => onChange(e.target.value)} {...p} />}</Field>;
}
/** Number field that keeps the typed text while editing and reports numbers (or null when empty and allowEmpty). */
export function Num({ label, value, onChange, hint, wide, min, max, step = 'any', allowEmpty, prefix, suffix, ...p }) {
  const [text, setText] = useState(value == null ? '' : String(value));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setText(value == null ? '' : String(value)); }, [value]);
  const emit = t => {
    setText(t);
    if (t.trim() === '') { if (allowEmpty) onChange(null); return; }
    const n = +t; if (Number.isFinite(n)) onChange(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n)));
  };
  return <Field label={label} hint={hint} wide={wide}>{(id, d) => <span className="caAffix">{prefix && <i>{prefix}</i>}
    <input id={id} aria-describedby={d} className="caInput" type="number" inputMode="decimal" min={min} max={max} step={step} value={text} onFocus={() => { focused.current = true; }}
      onBlur={() => { focused.current = false; setText(value == null ? '' : String(value)); }} onChange={e => emit(e.target.value)} {...p} />{suffix && <i>{suffix}</i>}</span>}</Field>;
}
export function Select({ label, value, onChange, options, hint, wide, ...p }) {
  return <Field label={label} hint={hint} wide={wide}>{(id, d) => <select id={id} aria-describedby={d} className="caInput" value={value ?? ''} onChange={e => onChange(e.target.value)} {...p}>
    {options.map(o => Array.isArray(o) ? <option key={o[0]} value={o[0]}>{o[1]}</option> : <option key={o} value={o}>{o}</option>)}
  </select>}</Field>;
}
export function Check({ label, checked, onChange, hint, ...p }) {
  const id = useId();
  return <div className="caCheck"><input id={id} type="checkbox" aria-describedby={hint ? id + '-hint' : undefined} checked={!!checked} onChange={e => onChange(e.target.checked)} {...p} />
    <span><label htmlFor={id}>{label}</label>{hint && <small className="caHint" id={id + '-hint'}>{hint}</small>}</span></div>;
}
export function Tags({ label, value, onChange, hint }) {
  const [t, setT] = useState('');
  const add = () => { const v = t.split(',').map(x => x.trim()).filter(Boolean); if (v.length) onChange([...new Set([...(value || []), ...v])]); setT(''); };
  return <div className="caField"><span className="caLabel">{label}</span>
    <div className="caTags">{(value || []).map(x => <span key={x} className="caTag">{x}<button type="button" aria-label={`Remove tag ${x}`} onClick={() => onChange(value.filter(y => y !== x))}><X size={11} /></button></span>)}
      <input className="caTagInput" aria-label={label} value={t} placeholder="Add tag, press Enter" onChange={e => setT(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } else if (e.key === 'Backspace' && !t && value?.length) onChange(value.slice(0, -1)); }} onBlur={add} />
    </div>{hint && <small className="caHint">{hint}</small>}</div>;
}
export function Segmented({ label, value, onChange, options }) {
  return <div className="segmented caSeg" role="group" aria-label={label}>
    {options.map(([k, l, n]) => <button key={k} type="button" aria-pressed={value === k} className={value === k ? 'on' : ''} onClick={() => onChange(k)}>{l}{n != null && <span className="caSegCount">{n}</span>}</button>)}
  </div>;
}

// ---------- modal & confirm ----------
const stack = [];
export function Modal({ title, onClose, children, footer, wide }) {
  const id = useId(), box = useRef(null);
  useEffect(() => {
    stack.push(id);
    const prev = document.activeElement;
    const f = box.current?.querySelector('input,select,textarea,button:not(.caModalX)') || box.current; f?.focus();
    const onKey = e => {
      if (stack[stack.length - 1] !== id) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
      else if (e.key === 'Tab') {
        const els = [...box.current.querySelectorAll('a[href],button:not(:disabled),input:not(:disabled),select,textarea,[tabindex="0"]')];
        if (!els.length) return;
        const i = els.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); els[els.length - 1].focus(); } else if (!e.shiftKey && i === els.length - 1) { e.preventDefault(); els[0].focus(); }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('keydown', onKey, true); stack.splice(stack.indexOf(id), 1); prev?.focus?.(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <div className="caModal" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className={'caModalBox' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-label={title} ref={box} tabIndex={-1}>
      <header className="caModalHead"><h2>{title}</h2><button type="button" className="caIconBtn caModalX" aria-label="Close dialog" onClick={onClose}><X size={16} /></button></header>
      <div className="caModalBody">{children}</div>
      {footer && <footer className="caModalFoot">{footer}</footer>}
    </div>
  </div>;
}

/** Hook: [element, ask] — ask({ title, message, confirmLabel, danger, extra }) → Promise<false | { ok: true, ...state }>. */
export function useConfirm() {
  const [req, setReq] = useState(null);
  const ask = opts => new Promise(res => setReq({ ...opts, res }));
  const close = v => { req?.res(v); setReq(null); };
  const el = req && <ConfirmBox req={req} close={close} />;
  return [el, ask];
}
function ConfirmBox({ req, close }) {
  const [state, setState] = useState(req.initial || {});
  return <Modal title={req.title} onClose={() => close(false)} footer={<>
    <Btn onClick={() => close(false)}>Cancel</Btn>
    <Btn kind={req.danger ? 'danger' : 'primary'} onClick={() => close({ ok: true, ...state })}>{req.confirmLabel || 'Confirm'}</Btn>
  </>}>
    {req.message && <p className="caText">{req.message}</p>}
    {req.extra && req.extra(state, setState)}
  </Modal>;
}

// ---------- charts (SVG) ----------
const path = (pts) => pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
export function Sparkline({ values, label, width = 120, height = 34 }) {
  const max = Math.max(1e-9, ...values), n = values.length;
  const pts = values.map((v, i) => [n < 2 ? width / 2 : i * width / (n - 1), height - 3 - (v / max) * (height - 6)]);
  return <svg className="caSpark" viewBox={`0 0 ${width} ${height}`} width={width} height={height} preserveAspectRatio="none" role="img" aria-label={label}>
    {n > 1 && <path d={path(pts) + ` L${width} ${height} L0 ${height} Z`} className="area" />}
    {n > 1 && <path d={path(pts)} className="line" />}
  </svg>;
}

/** Width of an element in CSS px (ResizeObserver), so charts draw at real size and text never scales with the card. */
export function useWidth(ref, initial = 640) {
  const [w, setW] = useState(initial);
  useEffect(() => {
    const el = ref.current; if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([e]) => { const v = Math.round(e.contentRect.width); if (v > 0) setW(v); });
    ro.observe(el); return () => ro.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return w;
}
/** Clean axis: 0 … max in `n` equal round steps (1, 2, 2.5 or 5 × 10^k). */
export function niceTicks(v, n = 4) {
  if (!(v > 0)) return [0, 1, 2, 3, 4];
  const raw = v / n, p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p;
  const step = (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
  const top = Math.ceil(v / step - 1e-9) * step;
  return Array.from({ length: Math.round(top / step) + 1 }, (_, i) => +(i * step).toFixed(10));
}
/** "Show data table" disclosure: the table twin of a chart (every value readable without hovering). */
export function DataTable({ caption, columns, rows }) {
  return <details className="caDataTable">
    <summary>Show data table</summary>
    <div className="caDataScroll"><table className="caTable"><caption className="caVh">{caption}</caption>
      <thead><tr>{columns.map((c, i) => <th key={i} scope="col" className={i ? 'n' : ''}>{c}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => j ? <td key={j} className="n">{c}</td> : <th key={j} scope="row">{c}</th>)}</tr>)}</tbody>
    </table></div>
  </details>;
}

/**
 * Area chart (one series, optionally with the previous period as a grey context line). Crosshair + one tooltip listing
 * every series at that date, on hover and on keyboard focus (← → Home End). points: [{ label, short, value }].
 */
export function AreaChart({ points, format = v => String(v), label, height = 220, compare, seriesLabel = 'This period', compareLabel = 'Previous period' }) {
  const [hover, setHover] = useState(null);
  const box = useRef(null);
  const W = Math.max(240, useWidth(box)), H = height;
  const fmtTick = v => format(v, true);
  const cmp = compare && compare.length > 1 ? compare : null;
  const ticks = niceTicks(Math.max(0, ...points.map(p => p.value), ...(cmp || []).map(p => p.value)));
  const max = ticks[ticks.length - 1];
  const L = Math.max(34, 12 + Math.max(...ticks.map(t => fmtTick(t).length)) * 6.4), R = 10, T = 10, B = 26;
  const n = points.length, x = i => L + (n < 2 ? (W - L - R) / 2 : i * (W - L - R) / (n - 1)), y = v => T + (H - T - B) * (1 - v / max);
  const pts = points.map((p, i) => [x(i), y(p.value)]);
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((W - L) / 84))));
  const at = i => Math.max(0, Math.min(n - 1, i));
  const move = e => { const r = e.currentTarget.getBoundingClientRect(), px = (e.clientX - r.left) / r.width * W; setHover(at(Math.round((px - L) / ((W - L - R) / Math.max(1, n - 1))))); };
  const key = e => {
    const cur = hover ?? n - 1, j = { ArrowRight: cur + 1, ArrowLeft: cur - 1, Home: 0, End: n - 1 }[e.key];
    if (j != null) { e.preventDefault(); setHover(at(j)); }
    else if (e.key === 'Escape') setHover(null);
  };
  const h = hover != null && points[hover] ? hover : null, cv = h != null && cmp ? cmp[h] : null;
  const edge = h == null ? '' : pts[h][0] < W * 0.18 ? ' left' : pts[h][0] > W * 0.82 ? ' right' : '';
  const say = h == null ? '' : `${points[h].label}: ${format(points[h].value)}${cv ? `, ${compareLabel.toLowerCase()} ${format(cv.value)}` : ''}`;
  return <div className="caChart" ref={box}>
    {cmp && <div className="caLegend"><span><i className="cur" aria-hidden="true" />{seriesLabel}</span><span><i className="prev" aria-hidden="true" />{compareLabel}</span></div>}
    <div className="caChartPlot">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={label + ' (focus and use the arrow keys to read values)'} tabIndex={0}
        onMouseLeave={() => setHover(null)} onMouseMove={move} onFocus={() => setHover(v => v ?? n - 1)} onBlur={() => setHover(null)} onKeyDown={key}>
        {ticks.map((t, i) => <g key={i}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className={i ? 'grid' : 'base'} /><text x={L - 8} y={y(t) + 3.5} textAnchor="end" className="tick">{fmtTick(t)}</text></g>)}
        {points.map((p, i) => i % labelEvery === 0 && <text key={i} x={x(i)} y={H - 7} textAnchor={i === 0 && n > 1 ? 'start' : 'middle'} className="tick">{p.short || p.label}</text>)}
        {n > 1 && <path d={path(pts) + ` L${x(n - 1)} ${y(0)} L${x(0)} ${y(0)} Z`} className="area" />}
        {cmp && <path d={path(cmp.slice(0, n).map((p, i) => [x(i), y(p.value)]))} className="cmp" />}
        {n > 1 && <path d={path(pts)} className="line" />}
        {h != null && <line x1={pts[h][0]} x2={pts[h][0]} y1={T} y2={H - B} className="cursor" />}
        {h != null && cv && <circle cx={pts[h][0]} cy={y(cv.value)} r="4" className="dot prev" />}
        {n > 0 && <circle cx={pts[h ?? n - 1][0]} cy={pts[h ?? n - 1][1]} r="4.5" className="dot" />}
      </svg>
      {h != null && <div className={'caChartTip' + edge} style={{ left: pts[h][0] }} aria-hidden="true">
        <span className="caTipHead">{points[h].label}</span>
        <span className="caTipRow">{cmp && <i className="cur" />}<strong>{format(points[h].value)}</strong>{cmp && <small>{seriesLabel}</small>}</span>
        {cv && <span className="caTipRow"><i className="prev" /><strong>{format(cv.value)}</strong><small>{compareLabel}</small></span>}
      </div>}
      <span className="caVh" aria-live="polite">{say}</span>
    </div>
    <DataTable caption={label} columns={['Date', seriesLabel, ...(cmp ? [compareLabel] : [])]}
      rows={points.map((p, i) => [p.label, format(p.value), ...(cmp ? [cmp[i] ? format(cmp[i].value) : '—'] : [])])} />
  </div>;
}
/** Ranked horizontal bars (one series, one hue); hovering or focusing a row shows its share of the total. */
export function BarList({ items, format = v => v, label }) {
  const max = Math.max(1e-9, ...items.map(i => i.value)), total = items.reduce((s, i) => s + i.value, 0);
  return <ul className="caBars" aria-label={label}>{items.map(i => <li key={i.key || i.label} className="caMark" tabIndex={0}>
    <div className="caBarLabel"><span>{i.label}</span><strong>{format(i.value)}</strong></div>
    <div className="caBarTrack">{i.value > 0 && <div className="caBarFill" style={{ width: `${(i.value / max) * 100}%` }} />}</div>
    <span className="caMarkTip" aria-hidden="true"><strong>{total ? Math.round(i.value / total * 100) : 0}%</strong> of the total</span>
  </li>)}</ul>;
}

/**
 * Card whose header is a compact pill tab bar (WAI-ARIA tabs: ← → Home End, roving tabindex). The chosen tab is remembered
 * per card in localStorage. tabs: [{ key, label, count?, content, actions?, pad? }]; a single tab renders as a plain card.
 * footActions puts the active tab's actions under its content (for narrow side-column cards).
 */
export function TabCard({ id, label, tabs, className = '', footActions }) {
  const store = 'zertake.cardTab.' + id, uid = useId(), refs = useRef({});
  const [sel, setSel] = useState(() => { try { return localStorage.getItem(store) || ''; } catch { return ''; } });
  if (!tabs.length) return null;
  const active = tabs.find(t => t.key === sel) || tabs[0], multi = tabs.length > 1;
  const pick = (k, focus) => { setSel(k); try { localStorage.setItem(store, k); } catch { /* storage unavailable */ } if (focus) refs.current[k]?.focus(); };
  const onKey = e => {
    const i = tabs.indexOf(active), n = tabs.length, j = { ArrowRight: (i + 1) % n, ArrowLeft: (i - 1 + n) % n, Home: 0, End: n - 1 }[e.key];
    if (j != null) { e.preventDefault(); pick(tabs[j].key, true); }
  };
  const tid = k => `${uid}-t-${k}`, pid = k => `${uid}-p-${k}`;
  const acts = active.actions && <div className="caCardActions">{active.actions}</div>;
  return <section className={'caCard caTabCard ' + className} aria-label={multi ? label : tabs[0].label}>
    <header className="caCardHead">
      {multi ? <><h2 className="caVh">{label}</h2>
        <div role="tablist" aria-label={label} className="caTabList" onKeyDown={onKey}>{tabs.map(t => <button key={t.key} type="button" role="tab" id={tid(t.key)} aria-selected={t === active} aria-controls={pid(t.key)}
          tabIndex={t === active ? 0 : -1} ref={el => { refs.current[t.key] = el; }} onClick={() => pick(t.key)}>{t.label}{t.count ? <span className="caTabCount"><span className="caVh">, </span>{t.count}</span> : null}</button>)}</div></>
        : <h2>{tabs[0].label}</h2>}
      {!footActions && acts}
    </header>
    {tabs.map(t => <div key={t.key} id={pid(t.key)} role={multi ? 'tabpanel' : undefined} aria-labelledby={multi ? tid(t.key) : undefined} tabIndex={multi ? 0 : undefined} hidden={t !== active}
      className={'caTabPanel' + (t.pad === false ? '' : ' caCardBody')}>{t.content}{footActions && t === active && t.actions && <div className="caTabFoot">{t.actions}</div>}</div>)}
  </section>;
}
/** A formatted number with its decimal part dimmed ("$1,842" + ".56"). Text content stays the formatted string. */
export function BigNum({ value, className = '' }) {
  const m = /^(.*\d)([.,]\d{1,2})(\D*)$/.exec(String(value));
  return <span className={'caBig ' + className}>{m ? <>{m[1]}<span className="caDec">{m[2]}</span>{m[3]}</> : value}</span>;
}
/** Semicircle gauge (decorative; pair it with a real progressbar or text). value 0..1. */
export function Gauge({ value, label, sub }) {
  const v = Math.max(0, Math.min(1, +value || 0));
  return <div className="caGauge" aria-hidden="true">
    <svg viewBox="0 0 120 66" width="100%">
      <defs><linearGradient id="caGaugeG" x1="0" x2="1"><stop offset="0" className="g0" /><stop offset="1" className="g1" /></linearGradient></defs>
      <path d="M10 60 A50 50 0 0 1 110 60" className="track" pathLength="100" />
      {Array.from({ length: 21 }, (_, i) => { const a = Math.PI * (1 - i / 20), r1 = 38, r2 = i % 5 ? 35.5 : 34; return <line key={i} x1={60 + r1 * Math.cos(a)} y1={60 - r1 * Math.sin(a)} x2={60 + r2 * Math.cos(a)} y2={60 - r2 * Math.sin(a)} className="tick" />; })}
      {v > 0 && <path d="M10 60 A50 50 0 0 1 110 60" className="val" pathLength="100" strokeDasharray={`${v * 100} 100`} />}
    </svg>
    <div className="caGaugeText"><strong>{label}</strong>{sub && <span>{sub}</span>}</div>
  </div>;
}

// ---------- empty states (original SVG illustrations) ----------
const ART = {
  orders: <><rect x="34" y="18" width="52" height="66" rx="6" className="s2" /><path d="M44 34h32M44 44h32M44 54h20" className="ln" /><circle cx="84" cy="76" r="14" className="s1" /><path d="M78 76l4 4 8-8" className="ck" /></>,
  products: <><path d="M60 16l34 16v40L60 88 26 72V32z" className="s2" /><path d="M26 32l34 16 34-16M60 48v40" className="ln" /><circle cx="88" cy="24" r="10" className="s1" /><path d="M88 19v10M83 24h10" className="ck" /></>,
  customers: <><circle cx="48" cy="40" r="14" className="s2" /><path d="M24 84c0-16 11-26 24-26s24 10 24 26" className="s2" /><circle cx="80" cy="46" r="11" className="s1" /><path d="M64 84c2-12 8-20 16-20s16 8 17 20" className="s1" /></>,
  discounts: <><path d="M22 52l30-30h32v32L54 84z" className="s2" /><circle cx="72" cy="34" r="5" className="s1" /><path d="M46 62l18-18" className="ln" /></>,
  analytics: <><rect x="20" y="20" width="80" height="64" rx="8" className="s2" /><path d="M30 70l16-16 12 8 22-24" className="ln" /><circle cx="80" cy="38" r="5" className="s1" /></>,
  generic: <><rect x="26" y="26" width="68" height="52" rx="8" className="s2" /><path d="M38 44h44M38 56h28" className="ln" /></>,
};
export function Empty({ art = 'generic', title, children, action }) {
  return <div className="caEmpty"><svg viewBox="0 0 120 100" width="120" height="100" aria-hidden="true" className="caEmptyArt">{ART[art] || ART.generic}</svg>
    <h3>{title}</h3>{children && <p>{children}</p>}{action}</div>;
}

// ---------- misc ----------
export function useMoney(store) {
  return useMemo(() => {
    let nf; try { nf = new Intl.NumberFormat(store?.currency?.locale || 'en-US', { style: 'currency', currency: store?.currency?.code || 'USD' }); } catch { nf = null; }
    let short; try { short = new Intl.NumberFormat(store?.currency?.locale || 'en-US', { style: 'currency', currency: store?.currency?.code || 'USD', notation: 'compact', maximumFractionDigits: 1 }); } catch { short = null; }
    const f = (n, compact) => (compact && short ? short : nf) ? (compact && short ? short : nf).format(+n || 0) : (store?.currency?.code || '') + ' ' + (+n || 0).toFixed(2);
    return f;
  }, [store?.currency?.code, store?.currency?.locale]);
}
export const fmtDate = (iso, time) => { if (!iso) return ''; const d = new Date(iso); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + (time ? ' at ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : ''); };
export const pct = v => (Math.round(v * 1000) / 10).toFixed(1) + '%';

export const FIN = { pending: ['Payment pending', 'warn'], paid: ['Paid', 'ok'], partially_refunded: ['Partially refunded', 'info'], refunded: ['Refunded', 'neutral'], voided: ['Voided', 'neutral'] };
export const FUL = { unfulfilled: ['Unfulfilled', 'warn'], fulfilled: ['Fulfilled', 'ok'] };

export function Thumb({ src, fallback, alt = '', size = 40 }) {
  const { imageUrl } = useAdmin();
  const [failed, setFailed] = useState('');
  const main = src ? imageUrl(src) : '', fb = fallback ? imageUrl(fallback) : '';
  const u = failed === main ? fb : main || fb;
  return <span className="caThumb" style={{ width: size, height: size }}>{u ? <img src={u} alt={alt} loading="lazy" onError={() => { if (failed !== main) setFailed(main); }} /> : <svg viewBox="0 0 24 24" width={size * .45} height={size * .45} aria-hidden="true"><path d="M4 16l4-4 4 4 3-3 5 5M4 4h16v16H4z" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>}</span>;
}

/** Download a text file. */
export function download(name, text, type = 'text/plain') {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
/** Read a File chosen in an <input type=file> as text. */
export const readText = file => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsText(file); });
/** Open HTML in a new tab (for printable documents). Returns false when the pop-up was blocked. */
export function openHtml(html) {
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const w = window.open(url, '_blank'); setTimeout(() => URL.revokeObjectURL(url), 60000);
  return !!w;
}
