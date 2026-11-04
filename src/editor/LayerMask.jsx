import React, { useEffect, useRef, useState } from 'react';
import { maskSurface } from './surfaces.js';
import { assetStore } from './store.js';
import { sampleMask } from '../engine/mask.js';

// SVG <mask> for a layer. Chromium ignores <foreignObject> inside <mask>, so the mask is shown
// through an <image> whose blob URL is refreshed after loads and during mask painting (one
// encode in flight at a time). With feather or density set, the image shows the effective
// mask computed by engine/mask.js sampleMask() over the document, which is exactly what
// Layer > Apply mask bakes, so preview, export and apply cannot drift apart.
// Export swaps the blob URL for a data URL (data-mask-surface).
export function MaskDef({ id, layer, surfaces, docW, docH }) {
  const m = layer.mask;
  const img = useRef();
  const processed = m.feather > 0 || m.density < 1;
  useEffect(() => {
    const o = maskSurface(layer);
    const s = surfaces.ensure(o);
    let url = null, dead = false, busy = false, again = false;
    const source = () => {
      if (!processed) return s.canvas;
      const raw = m.assetId ? s.ctx.getImageData(0, 0, o.w, o.h) : null;
      const eff = sampleMask(m, raw && { data: raw.data }, 0, 0, docW, docH);
      const out = new ImageData(docW, docH);
      for (let i = 0; i < eff.length; i++) { const v = Math.round(eff[i]); out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = v; out.data[i * 4 + 3] = 255; }
      const c = document.createElement('canvas'); c.width = docW; c.height = docH; c.getContext('2d').putImageData(out, 0, 0);
      return c;
    };
    const refresh = () => {
      if (dead) return;
      if (busy) { again = true; return; }
      busy = true;
      source().toBlob(b => {
        busy = false;
        if (dead || !b) return;
        const u = URL.createObjectURL(b);
        img.current?.setAttribute('href', u);
        if (url) URL.revokeObjectURL(url);
        url = u;
        if (again) { again = false; refresh(); }
      }, 'image/png');
    };
    const off = surfaces.subscribe(o.id, refresh);
    if (surfaces.isReady(o)) refresh();
    return () => { dead = true; off(); if (url) setTimeout(() => URL.revokeObjectURL(url), 1000); };
  }, [surfaces, layer.id, m.assetId, m.w, m.h, m.fill, m.x, m.y, m.feather, m.density, docW, docH]);
  const region = { x: -1, y: -1, width: docW + 2, height: docH + 2 };
  const g = m.fill;
  const box = processed ? { x: 0, y: 0, width: docW, height: docH } : { x: m.x, y: m.y, width: m.w, height: m.h };
  return <mask id={id} maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" {...region} style={{ maskType: 'luminance', colorInterpolation: 'sRGB' }}>
    <rect {...region} fill={`rgb(${g},${g},${g})`} />
    <image ref={img} data-mask-surface={layer.id + '#mask'} data-processed={processed ? '1' : undefined} {...box} preserveAspectRatio="none" style={{ imageRendering: 'pixelated' }} />
  </mask>;
}

/** Small mask thumbnail for the layers panel. */
export function MaskThumb({ mask }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!mask.assetId) { setUrl(null); return; }
    let u, dead = false;
    assetStore.get(mask.assetId).then(b => { if (!dead) { u = URL.createObjectURL(b); setUrl(u); } }).catch(() => setUrl(null));
    return () => { dead = true; if (u) URL.revokeObjectURL(u); };
  }, [mask.assetId]);
  const g = mask.fill;
  return <span className={'maskThumb' + (mask.enabled ? '' : ' off')} style={{ background: `rgb(${g},${g},${g})` }}>{url && <img src={url} alt="" />}</span>;
}
