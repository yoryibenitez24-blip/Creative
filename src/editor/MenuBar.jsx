import React, { useEffect, useRef } from 'react';

// Menu bar with nested submenus. Items: [label, fn, shortcut, {disabled}] | {label, children:[...]} | '-' (separator).
export function Items({ items, close }) {
  return items.map((it, i) => {
    if (it === '-') return <div key={'sep' + i} className="menuSep" role="separator" />;
    if (!Array.isArray(it)) return <div key={it.label} className="subWrap"><button role="menuitem" aria-haspopup="menu" aria-label={it.label}>{it.label}<small aria-hidden="true">▸</small></button><div className="dropdown submenu" role="menu">{<Items items={it.children} close={close} />}</div></div>;
    const [label, fn, k, opt = {}] = it;
    return <button role="menuitem" aria-label={label} key={label} disabled={opt.disabled} onClick={() => { close(); fn(); }}>{label}<small aria-hidden="true">{k}</small></button>;
  });
}

export default function MenuBar({ menus, open, setOpen }) {
  const ref = useRef();
  useEffect(() => {
    if (!open) return;
    const off = e => { if (!ref.current?.contains(e.target)) setOpen(null); };
    const esc = e => { if (e.key === 'Escape') setOpen(null); };
    window.addEventListener('pointerdown', off); window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('pointerdown', off); window.removeEventListener('keydown', esc); };
  }, [open]);
  return <div className="menus" ref={ref} role="menubar">{Object.keys(menus).map(m => <div className="menuWrap" key={m}>
    <button aria-haspopup="menu" aria-expanded={open === m} onClick={() => setOpen(open === m ? null : m)} onPointerEnter={() => open && open !== m && setOpen(m)}>{m}</button>
    {open === m && <div className="dropdown" role="menu"><Items items={menus[m]} close={() => setOpen(null)} /></div>}
  </div>)}</div>;
}
