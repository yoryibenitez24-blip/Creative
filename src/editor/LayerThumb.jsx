import React, { useEffect, useRef } from 'react';
import { Type, SlidersHorizontal, Box } from 'lucide-react';
import { smartSurface } from '../engine/smart.js';
import { pathToD, pathBounds, isEmptyPath } from '../engine/paths.js';

// Layers-panel thumbnail that shows what the layer really contains, framed like the document
// (Photoshop style): painted pixels, placed images, Smart Object contents, shapes in their colour,
// a transparency checkerboard for empty layers. Text keeps the T icon.
const S = 34; // drawing resolution (CSS shows it at 28 px)

function fit(docW, docH) { const k = Math.min(S / docW, S / docH); return { k, ox: (S - docW * k) / 2, oy: (S - docH * k) / 2, w: docW * k, h: docH * k }; }

function SurfaceThumb({ surfaces, obj, place, docW, docH, version }) {
  const ref = useRef(null);
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = 0; const c = ref.current; if (!c) return;
      const ctx = c.getContext('2d'); ctx.clearRect(0, 0, S, S);
      const s = surfaces.ensure(obj); if (!s?.canvas) return;
      const f = fit(docW, docH), r = place(f);
      ctx.imageSmoothingQuality = 'high';
      try { ctx.drawImage(s.canvas, r.x, r.y, Math.max(0.5, r.w), Math.max(0.5, r.h)); } catch { /* canvas not ready */ }
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(draw); };
    draw();
    const off = surfaces.subscribe(obj.id, schedule);
    return () => { off(); if (raf) cancelAnimationFrame(raf); };
  }, [surfaces, obj.id, obj.assetId, obj.w, obj.h, docW, docH, version]);
  return <canvas ref={ref} width={S} height={S} className="thumbCanvas" />;
}

export default function LayerThumb({ layer: l, surfaces, docW, docH }) {
  const f = fit(docW, docH);
  const frame = <span className="thumbFrame" style={{ left: f.ox / S * 100 + '%', top: f.oy / S * 100 + '%', width: f.w / S * 100 + '%', height: f.h / S * 100 + '%' }} />;
  if (l.type === 'text') return <Type size={14} />;
  if (l.type === 'adjustment') return <SlidersHorizontal size={14} />;
  if (l.type === 'fill') return <span className="thumbSwatch" style={{ background: l.fillSpec.kind === 'solid' ? l.fillSpec.color : 'linear-gradient(90deg,' + (l.fillSpec.gradFrom || '#000') + ',' + (l.fillSpec.gradTo || '#fff') + ')' }} />;
  let body;
  if (l.type === 'raster') body = <SurfaceThumb surfaces={surfaces} obj={l} docW={docW} docH={docH} version={l.assetId} place={g => ({ x: g.ox + l.x * g.k, y: g.oy + l.y * g.k, w: l.w * g.k, h: l.h * g.k })} />;
  else if (l.type === 'smart') body = <SurfaceThumb surfaces={surfaces} obj={smartSurface(l)} docW={docW} docH={docH} version={l.smart.renderId || l.smart.sourceId}
    place={g => { const kx = l.w / l.smart.sw, ky = l.h / l.smart.sh, p = l.smart.renderId ? (smartSurface(l).w - l.smart.sw) / 2 : 0; return { x: g.ox + (l.x - p * kx) * g.k, y: g.oy + (l.y - p * ky) * g.k, w: smartSurface(l).w * kx * g.k, h: smartSurface(l).h * ky * g.k }; }} />;
  else {
    const t = `translate(${l.x} ${l.y}) rotate(${l.rotation || 0} ${l.w / 2} ${l.h / 2})`;
    const shape = l.type === 'image' ? <image href={l.src} width={l.w} height={l.h} preserveAspectRatio="none" />
      : l.type === 'ellipse' ? <ellipse cx={l.w / 2} cy={l.h / 2} rx={l.w / 2} ry={l.h / 2} fill={l.fill} fillOpacity={l.fillOpacity ?? 1} />
      : l.type === 'rect' ? <rect width={l.w} height={l.h} rx={Array.isArray(l.radius) ? l.radius[0] : l.radius || 0} fill={l.fill} fillOpacity={l.fillOpacity ?? 1} />
      : l.type === 'shape' && !isEmptyPath(l.path) ? <path d={pathToD(l.path)} fill={l.fill || '#888'} fillRule={l.fillRule || 'nonzero'} /> : null;
    body = <svg viewBox={`0 0 ${docW} ${docH}`} width={S} height={S} className="thumbCanvas" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><g transform={l.type === 'shape' ? `translate(${l.x || 0} ${l.y || 0})` : t}>{shape}</g></svg>;
  }
  return <span className="thumbReal">{frame}{body}{l.type === 'smart' && <span className="thumbBadge" aria-label="Smart Object" title="Smart Object"><Box size={8} /></span>}</span>;
}
