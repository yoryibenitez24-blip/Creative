import React, { useEffect, useRef } from 'react';

// Photoshop-style Brush Preset picker popover.
// brush: { size (px, 1..1000), hardness (0..1), angle (deg, -180..180, 0 = pointing right, CCW positive),
//          roundness (0.01..1), spacing (0.01..2, fraction of the diameter), ...anything else is passed through }.
// onChange always receives the whole brush object ({ ...brush, ...changes }).
// CSS: dist/css/toolui.css (plus the shared .opField slider rows from modern.css).

export const BRUSH_PRESETS = [
  { name: 'Soft Round', size: 45, hardness: 0, angle: 0, roundness: 1, spacing: 0.25 },
  { name: 'Hard Round', size: 30, hardness: 1, angle: 0, roundness: 1, spacing: 0.25 },
  { name: 'Hard Pixel 1 px', size: 1, hardness: 1, angle: 0, roundness: 1, spacing: 0.25 },
  { name: 'Airbrush Soft', size: 120, hardness: 0, angle: 0, roundness: 1, spacing: 0.1 },
  { name: 'Flat 45°', size: 40, hardness: 0.9, angle: 45, roundness: 0.25, spacing: 0.1 },
  { name: 'Chisel', size: 36, hardness: 1, angle: -30, roundness: 0.12, spacing: 0.05 },
  { name: 'Large Soft Cloud', size: 400, hardness: 0.1, angle: 0, roundness: 0.8, spacing: 0.3 },
];

const LIMITS = { size: [1, 1000], hardness: [0, 1], angle: [-180, 180], roundness: [0.01, 1], spacing: [0.01, 2] };
const clamp = (k, v) => Math.max(LIMITS[k][0], Math.min(LIMITS[k][1], v));
const wrapAngle = a => { a = Math.round(a); while (a > 180) a -= 360; while (a < -180) a += 360; return a; };
// Size slider is non-linear (cubic) so small brushes stay controllable, as in Photoshop.
const sizeToPos = s => Math.round(Math.cbrt((s - 1) / 999) * 1000);
const posToSize = p => Math.max(1, Math.round(1 + 999 * Math.pow(p / 1000, 3)));
const DEFAULTS = { size: 30, hardness: 1, angle: 0, roundness: 1, spacing: 0.25 };

// Draws a stroke thumbnail (an S curve stamped with the brush tip) on a canvas.
export function drawBrushStroke(canvas, b) {
  const ctx = canvas.getContext('2d'); if (!ctx) return;
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  const d = Math.max(1, Math.min(H * 0.7, b.size <= 3 ? b.size : 3 + Math.sqrt(b.size) * 1.4));
  const r = d / 2, hard = b.hardness ?? 1, rad = -(b.angle || 0) * Math.PI / 180, rnd = b.roundness ?? 1;
  const step = Math.max(0.5, d * Math.min(b.spacing ?? 0.25, 0.5));
  ctx.fillStyle = '#e8e8ec';
  const pad = r + 3, pts = [];
  for (let x = pad; x <= W - pad; x += 0.5) pts.push([x, H / 2 + Math.sin((x - pad) / (W - 2 * pad) * Math.PI * 2) * (H / 2 - r - 3) * 0.75]);
  let acc = step;
  for (let i = 1; i < pts.length; i++) {
    acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (acc < step) continue;
    acc = 0;
    ctx.save();
    ctx.translate(pts[i][0], pts[i][1]); ctx.rotate(rad); ctx.scale(1, rnd);
    if (hard >= 0.99 || r < 1) { ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); }
    else {
      const g = ctx.createRadialGradient(0, 0, r * hard, 0, 0, r);
      g.addColorStop(0, 'rgba(232,232,236,0.35)'); g.addColorStop(1, 'rgba(232,232,236,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#e8e8ec';
    }
    ctx.restore();
  }
}

function StrokeThumb({ brush, w = 120, h = 30 }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current) drawBrushStroke(ref.current, brush); }, [brush.size, brush.hardness, brush.angle, brush.roundness, brush.spacing]);
  return <canvas ref={ref} width={w} height={h} className="brushThumb" aria-hidden="true" />;
}

// Circle with the brush-tip ellipse: drag the arrow to set the angle, drag either dot to set the roundness.
function TipShape({ angle, roundness, onChange, size = 104 }) {
  const ref = useRef(null);
  const mode = useRef(null);
  const c = size / 2, R = c - 10, rad = angle * Math.PI / 180;
  const ux = Math.cos(rad), uy = -Math.sin(rad);    // major axis (screen coords)
  const vx = -uy, vy = ux;                          // minor axis
  const ry = Math.max(1, R * roundness);
  const local = e => { const r = ref.current.getBoundingClientRect(); return [e.clientX - r.left - c, e.clientY - r.top - c]; };
  const apply = e => {
    const [x, y] = local(e);
    if (mode.current === 'angle') {
      let a = Math.atan2(-y, x) * 180 / Math.PI;
      if (e.shiftKey) a = Math.round(a / 15) * 15;
      onChange({ angle: wrapAngle(a) });
    } else if (mode.current === 'round') {
      onChange({ roundness: Math.round(clamp('roundness', Math.abs(x * vx + y * vy) / R) * 100) / 100 });
    }
  };
  const down = m => e => { e.preventDefault(); e.stopPropagation(); mode.current = m; ref.current.setPointerCapture?.(e.pointerId); e.currentTarget.focus?.(); apply(e); };
  const move = e => { if (mode.current) apply(e); };
  const up = () => { mode.current = null; };
  const keyAngle = e => {
    const d = { ArrowUp: 1, ArrowLeft: 1, ArrowDown: -1, ArrowRight: -1 }[e.key];
    if (d) { e.preventDefault(); onChange({ angle: wrapAngle(angle + d * (e.shiftKey ? 10 : 1)) }); }
  };
  const keyRound = e => {
    const d = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
    if (d) { e.preventDefault(); onChange({ roundness: Math.round(clamp('roundness', roundness + d * (e.shiftKey ? 0.1 : 0.01)) * 100) / 100 }); }
  };
  const ax = c + ux * R, ay = c + uy * R;
  const dot = s => [c + vx * ry * s, c + vy * ry * s];
  const [d1x, d1y] = dot(1), [d2x, d2y] = dot(-1);
  return <svg ref={ref} className="tipShape" width={size} height={size} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
    onPointerDown={down('angle')} aria-label="Brush tip shape" role="group">
    <circle cx={c} cy={c} r={R} className="tipRing" />
    <line x1={c - R} y1={c} x2={c + R} y2={c} className="tipAxis" />
    <ellipse cx={c} cy={c} rx={R} ry={ry} transform={`rotate(${-angle} ${c} ${c})`} className="tipEllipse" />
    <line x1={c} y1={c} x2={ax} y2={ay} className="tipArrowLine" />
    <g role="slider" tabIndex={0} aria-label="Angle handle" aria-valuemin={-180} aria-valuemax={180} aria-valuenow={angle} aria-valuetext={angle + '°'}
      className="tipHandle" onPointerDown={down('angle')} onKeyDown={keyAngle}>
      <polygon points={`${ax + ux * 7},${ay + uy * 7} ${ax - ux * 2 + vx * 5},${ay - uy * 2 + vy * 5} ${ax - ux * 2 - vx * 5},${ay - uy * 2 - vy * 5}`} />
    </g>
    {[[d1x, d1y, 'Roundness handle'], [d2x, d2y, 'Roundness handle opposite']].map(([x, y, l]) =>
      <circle key={l} cx={x} cy={y} r={5} role="slider" tabIndex={0} aria-label={l} aria-valuemin={1} aria-valuemax={100} aria-valuenow={Math.round(roundness * 100)}
        aria-valuetext={Math.round(roundness * 100) + '%'} className="tipDot" onPointerDown={down('round')} onKeyDown={keyRound} />)}
  </svg>;
}

function Row({ label, value, min, max, step = 1, unit, set, pos, toPos, fromPos }) {
  const sv = toPos ? toPos(value) : value, smin = toPos ? 0 : min, smax = toPos ? 1000 : max;
  return <label className="opField"><span>{label}</span>
    <input type="range" aria-label={label} min={smin} max={smax} step={toPos ? 1 : step} value={sv} aria-valuetext={`${value}${unit || ''}`}
      style={{ '--p': (sv - smin) / (smax - smin) }} onChange={e => set(fromPos ? fromPos(+e.target.value) : +e.target.value)} />
    <input type="number" aria-label={label + ' value'} min={min} max={max} step={step} value={value} onChange={e => { const v = +e.target.value; if (Number.isFinite(v) && e.target.value !== '') set(Math.max(min, Math.min(max, v))); }} />
    {unit && <small>{unit}</small>}</label>;
}

const sameTip = (a, p) => ['size', 'hardness', 'angle', 'roundness', 'spacing'].every(k => Math.abs((a[k] ?? DEFAULTS[k]) - p[k]) < 1e-6);

export default function BrushPicker({ brush, presets = BRUSH_PRESETS, onChange, onClose }) {
  const b = { ...DEFAULTS, ...brush };
  const rootRef = useRef(null);
  const set = p => onChange?.({ ...brush, ...p });
  useEffect(() => {
    const key = e => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); onClose?.(); } };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  const pct = v => Math.round(v * 100);
  return <div ref={rootRef} className="brushPicker" role="dialog" aria-label="Brush preset picker" onPointerDown={e => e.stopPropagation()}>
    <div className="brushTop">
      <div className="brushSliders">
        <Row label="Size" value={Math.round(b.size)} min={1} max={1000} unit="px" set={v => set({ size: clamp('size', Math.round(v)) })} toPos={sizeToPos} fromPos={posToSize} />
        <Row label="Hardness" value={pct(b.hardness)} min={0} max={100} unit="%" set={v => set({ hardness: clamp('hardness', v / 100) })} />
        <Row label="Spacing" value={pct(b.spacing)} min={1} max={200} unit="%" set={v => set({ spacing: clamp('spacing', v / 100) })} />
      </div>
      <div className="brushTip">
        <TipShape angle={wrapAngle(b.angle)} roundness={clamp('roundness', b.roundness)} onChange={set} />
        <label className="brushTipNum"><span>Angle</span><input type="number" aria-label="Angle" min={-180} max={180} value={wrapAngle(b.angle)} onChange={e => { const v = +e.target.value; if (e.target.value !== '' && Number.isFinite(v)) set({ angle: wrapAngle(Math.max(-180, Math.min(180, v))) }); }} /><small>°</small></label>
        <label className="brushTipNum"><span>Roundness</span><input type="number" aria-label="Roundness" min={1} max={100} value={pct(b.roundness)} onChange={e => { const v = +e.target.value; if (e.target.value !== '' && Number.isFinite(v)) set({ roundness: clamp('roundness', v / 100) }); }} /><small>%</small></label>
      </div>
    </div>
    <div className="brushList" role="listbox" aria-label="Brush presets">
      {presets.map(p => {
        const on = sameTip(b, p);
        return <button key={p.name} type="button" role="option" aria-selected={on} aria-label={`Brush ${p.name}`} className={'brushPreset' + (on ? ' on' : '')}
          onClick={() => { const { name, ...tip } = p; set(tip); }}>
          <StrokeThumb brush={p} />
          <span className="brushPresetName">{p.name}</span>
          <small>{p.size}</small>
        </button>;
      })}
    </div>
    <div className="brushPreview"><StrokeThumb brush={b} w={260} h={44} /></div>
  </div>;
}
