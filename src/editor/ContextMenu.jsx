import React, { useEffect, useRef } from 'react';
import { Items } from './MenuBar.jsx';

// Right-click menu at the pointer. Closes on outside click, Escape, scroll or window blur.
export default function ContextMenu({ menu, close }) {
  const ref = useRef();
  useEffect(() => {
    const off = e => { if (!ref.current?.contains(e.target)) close(); };
    const esc = e => { if (e.key === 'Escape') close(); };
    window.addEventListener('pointerdown', off, true); window.addEventListener('keydown', esc); window.addEventListener('blur', close);
    return () => { window.removeEventListener('pointerdown', off, true); window.removeEventListener('keydown', esc); window.removeEventListener('blur', close); };
  }, [close]);
  // keep the menu on screen
  const x = Math.min(menu.x, window.innerWidth - 240), y = Math.min(menu.y, window.innerHeight - Math.min(520, 26 * menu.items.length + 16));
  return <div ref={ref} className="dropdown contextMenu" role="menu" aria-label={menu.label || 'Context menu'} style={{ left: x, top: Math.max(8, y) }} onContextMenu={e => e.preventDefault()}><Items items={menu.items} close={close} /></div>;
}
