import React, { useRef } from 'react';

// Photoshop-style angle wheel: 0° points right, positive angles turn counter-clockwise.
// Drag (or click) anywhere on the wheel; Shift snaps to 15°; arrow keys nudge (Shift ×10).
export default function AngleDial({ label, value, onChange, min = -180, max = 180, size = 30 }) {
  const ref = useRef(null);
  const wrap = a => { while (a > max) a -= 360; while (a < min) a += 360; return Math.round(a); };
  const fromEvent = e => {
    const r = ref.current.getBoundingClientRect();
    let a = Math.atan2(-(e.clientY - (r.top + r.height / 2)), e.clientX - (r.left + r.width / 2)) * 180 / Math.PI;
    if (e.shiftKey) a = Math.round(a / 15) * 15;
    onChange(wrap(a));
  };
  const down = e => { e.preventDefault(); ref.current.setPointerCapture?.(e.pointerId); fromEvent(e); };
  const move = e => { if (e.buttons & 1) fromEvent(e); };
  const key = e => {
    const d = { ArrowUp: 1, ArrowRight: -1, ArrowDown: -1, ArrowLeft: 1 }[e.key];
    if (d) { e.preventDefault(); onChange(wrap(value + d * (e.shiftKey ? 10 : 1))); }
  };
  const rad = value * Math.PI / 180, c = size / 2, len = c - 4;
  return <span ref={ref} className="angleDial" role="slider" tabIndex={0} aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} aria-valuetext={value + '°'}
    style={{ width: size, height: size }} onPointerDown={down} onPointerMove={move} onKeyDown={key} title="Drag to set the angle (Shift snaps to 15°)">
    <svg width={size} height={size} aria-hidden="true">
      <circle cx={c} cy={c} r={c - 1.5} fill="none" stroke="currentColor" strokeOpacity=".55" strokeWidth="1.5" />
      <line x1={c} y1={c} x2={c + Math.cos(rad) * len} y2={c - Math.sin(rad) * len} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx={c} cy={c} r="1.6" fill="currentColor" />
    </svg>
  </span>;
}
