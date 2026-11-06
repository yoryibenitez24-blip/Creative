import React, { useEffect, useMemo, useRef } from 'react';
import { normalizeStyle, buildEffectFilter, effectExtent, layerBounds, GLOBAL_LIGHT, BELOW, INTERIOR, blendIfTable, BLEND_IF_CHANNEL_ROW, patternTile } from '../engine/styles.js';
import { gradientSampler } from '../engine/fill.js';

// Renders a layer with its Layer Style. See src/engine/styles.js for the model and ordering.

const toEl = (node, key) => { const [tag, attrs, children] = node; return React.createElement(tag, { key, ...attrs }, children.map((c, i) => toEl(c, i))); };
export const FilterDef = ({ id, nodes, region }) => <filter id={id} filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" x={region.x} y={region.y} width={region.width} height={region.height} colorInterpolationFilters="sRGB">{nodes.map((n, i) => toEl(n, i))}</filter>;

/** <image> showing a paint surface, refreshed (one PNG encode in flight) when the surface changes. */
export function SurfaceImage({ surfaces, surfaceObj, x, y, width, height, id }) {
  const img = useRef();
  useEffect(() => {
    const s = surfaces.ensure(surfaceObj);
    let url = null, dead = false, busy = false, again = false;
    const refresh = () => { if (dead) return; if (busy) { again = true; return; } busy = true; s.canvas.toBlob(b => { busy = false; if (dead || !b) return; const u = URL.createObjectURL(b); img.current?.setAttribute('href', u); if (url) URL.revokeObjectURL(url); url = u; if (again) { again = false; refresh(); } }, 'image/png'); };
    const off = surfaces.subscribe(surfaceObj.id, refresh);
    if (surfaces.isReady(surfaceObj)) refresh();
    return () => { dead = true; off(); if (url) setTimeout(() => URL.revokeObjectURL(url), 1000); };
  }, [surfaces, surfaceObj.id, surfaceObj.assetId, surfaceObj.w, surfaceObj.h]);
  return <image ref={img} id={id} x={x} y={y} width={width} height={height} preserveAspectRatio="none" />;
}

export function gradientImage(e, b) {
  const w = Math.max(1, Math.min(2048, Math.round(b.w))), h = Math.max(1, Math.min(2048, Math.round(b.h))), c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d'), img = ctx.createImageData(w, h), a = (e.angle ?? 90) * Math.PI / 180, len = Math.hypot(w, h) / 2 * (e.scale ?? 100) / 100;
  const cx = w / 2, cy = h / 2, dx = Math.cos(a) * len, dy = -Math.sin(a) * len;
  const s = gradientSampler({ type: e.style || 'linear', x0: e.style === 'radial' || e.style === 'angle' || e.style === 'diamond' ? cx : cx - dx, y0: e.style === 'radial' || e.style === 'angle' || e.style === 'diamond' ? cy : cy - dy, x1: cx + dx, y1: cy + dy, from: e.gradFrom, to: e.gradTo, reverse: e.reverse, dither: !!e.dither });
  const o = [0, 0, 0, 0];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { s(x, y, o); img.data.set(o, (y * w + x) * 4); }
  ctx.putImageData(img, 0, 0); return c.toDataURL('image/png');
}
export function patternImage(name, scale, b) {
  const tile = patternTile(name, Math.max(4, Math.round(16 * (scale ?? 100) / 100))), w = Math.max(1, Math.min(2048, Math.round(b.w))), h = Math.max(1, Math.min(2048, Math.round(b.h)));
  const t = document.createElement('canvas'); t.width = tile.w; t.height = tile.h; t.getContext('2d').putImageData(new ImageData(tile.data, tile.w, tile.h), 0, 0);
  const c = document.createElement('canvas'); c.width = w; c.height = h; const ctx = c.getContext('2d'); ctx.fillStyle = ctx.createPattern(t, 'repeat'); ctx.fillRect(0, 0, w, h);
  return c.toDataURL('image/png');
}

/**
 * props: l (layer), docId, doc {w,h,bg,globalLight}, inner (transformed content element),
 * maskUrl, maskDef, surfaces, backdrop (data URL of layers below, for Blend If underlying / channels),
 * srcId, preview (false disables the style while the dialog's Preview is off)
 */
export function StyledLayer({ l, docId, doc, inner, maskUrl, maskDef, surfaces, backdrop, srcId, rasterSrcObj }) {
  const st = useMemo(() => normalizeStyle(l.style), [l.style]);
  const bl = st.blending, pre = `fx-${docId}-${l.id}`, light = doc.globalLight || GLOBAL_LIGHT;
  const hides = !!(bl.maskHidesEffects && maskUrl);
  const bounds = l.type === 'raster' ? { x: l.x, y: l.y, w: l.w, h: l.h } : layerBounds(l);
  const fx = st.effects.filter(e => e.enabled);
  const ext = Math.max(4, ...fx.map(effectExtent));
  const region = { x: bounds.x - ext, y: bounds.y - ext, width: bounds.w + 2 * ext, height: bounds.h + 2 * ext };
  const images = useMemo(() => Object.fromEntries(fx.map(e => [e.id, {
    gradient: (e.type === 'gradientOverlay' || (e.type === 'stroke' && e.fill === 'gradient') || ((e.type === 'outerGlow' || e.type === 'innerGlow') && e.fill === 'gradient')) ? gradientImage(e, e.type === 'stroke' ? { w: bounds.w + 2 * e.size, h: bounds.h + 2 * e.size } : bounds) : null,
    pattern: (e.type === 'patternOverlay' || (e.type === 'stroke' && e.fill === 'pattern')) ? patternImage(e.pattern, e.scale, bounds) : null,
    texture: e.type === 'bevel' && e.textureOn ? patternImage(e.pattern, e.textureScale, bounds) : null,
  }])), [JSON.stringify(fx), bounds.w, bounds.h]);
  const effect = (e, part) => {
    const fid = `${pre}-${e.id}${part || ''}`, nodes = buildEffectFilter(e, { light, transparencyShapes: bl.transparencyShapes, bounds, images: images[e.id], part });
    const blend = e.type === 'bevel' ? (part === 'hi' ? e.hiBlend : e.shBlend) : e.blend;
    return <g key={fid} style={{ mixBlendMode: blend }} data-fx={e.type}><FilterDef id={fid} nodes={nodes} region={region} /><use href={'#' + srcId} filter={`url(#${fid})`} /></g>;
  };
  const byType = types => fx.filter(e => types.includes(e.type));
  const below = [...byType(['dropShadow']), ...byType(['outerGlow'])].map(e => effect(e));
  const interiorOrder = ['patternOverlay', 'gradientOverlay', 'colorOverlay', 'satin', 'innerGlow', 'innerShadow'];
  const interior = interiorOrder.flatMap(t => byType([t])).map(e => effect(e));
  const above = [...byType(['stroke']).map(e => effect(e)), ...byType(['bevel']).flatMap(e => [effect(e, 'sh'), effect(e, 'hi')])];

  // Blend If and channel restrictions act on the content (fill), in document space.
  const bi = bl.blendIf, row = BLEND_IF_CHANNEL_ROW[bi.channel] || BLEND_IF_CHANNEL_ROW.gray;
  const curOn = !(bi.current[0] === 0 && bi.current[1] === 0 && bi.current[2] === 255 && bi.current[3] === 255);
  const undOn = backdrop && !(bi.underlying[0] === 0 && bi.underlying[1] === 0 && bi.underlying[2] === 255 && bi.underlying[3] === 255);
  const ch = bl.channels, chOn = backdrop && (!ch.r || !ch.g || !ch.b);
  let contentFilter = null;
  if (curOn || undOn || chOn) {
    const n = [];
    const P = (tag, attrs, children = []) => [tag, attrs, children];
    n.push(P('feColorMatrix', { in: 'SourceGraphic', type: 'matrix', values: `0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  ${curOn ? row : '0 0 0 0 1'}`, result: 'cf' }), P('feComponentTransfer', { in: 'cf', result: 'f1' }, [P('feFuncA', { type: 'table', tableValues: (curOn ? blendIfTable(bi.current) : [1, 1]).join(' ') })]));
    if (backdrop) n.push(P('feImage', { href: backdrop, x: 0, y: 0, width: doc.w, height: doc.h, preserveAspectRatio: 'none', result: 'bd' }));
    if (undOn) n.push(P('feColorMatrix', { in: 'bd', type: 'matrix', values: `0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  ${row}`, result: 'uf' }), P('feComponentTransfer', { in: 'uf', result: 'f2' }, [P('feFuncA', { type: 'table', tableValues: blendIfTable(bi.underlying).join(' ') })]), P('feComposite', { in: 'f1', in2: 'f2', operator: 'in', result: 'f' }));
    else n.push(P('feOffset', { in: 'f1', dx: 0, dy: 0, result: 'f' }));
    n.push(P('feComposite', { in: 'SourceGraphic', in2: 'f', operator: 'in', result: 'c' }));
    if (chOn) {
      // diagonal channel selectors: checked channels come from the layer, unchecked ones from the layers below
      const diag = m => `${m[0]} 0 0 0 0  0 ${m[1]} 0 0 0  0 0 ${m[2]} 0 0  0 0 0 1 0`, on = [ch.r, ch.g, ch.b].map(v => v ? 1 : 0);
      n.push(P('feColorMatrix', { in: 'c', type: 'matrix', values: diag(on), result: 'c1' }), P('feColorMatrix', { in: 'bd', type: 'matrix', values: diag(on.map(v => 1 - v)), result: 'b1' }), P('feComposite', { in: 'b1', in2: 'c', operator: 'in', result: 'b2' }), P('feComposite', { in: 'c1', in2: 'b2', operator: 'arithmetic', k1: 0, k2: 1, k3: 1, k4: 0, result: 's' }), P('feComponentTransfer', { in: 's', result: 'out' }, [P('feFuncA', { type: 'linear', slope: 0.5 })]));
    }
    contentFilter = <FilterDef id={pre + '-content'} nodes={n} region={{ x: 0, y: 0, width: doc.w, height: doc.h }} />;
  }
  const ko = bl.knockout !== 'none' && <g key="ko"><FilterDef id={pre + '-ko'} nodes={[['feFlood', { floodColor: doc.bg === 'transparent' ? '#ffffff' : doc.bg, floodOpacity: 1, result: 'f' }, []], ['feComposite', { in: 'f', in2: 'SourceAlpha', operator: 'in' }, []]]} region={region} /><use href={'#' + srcId} filter={`url(#${pre}-ko)`} /></g>;
  const contentMask = !hides && maskUrl ? maskUrl : undefined;
  const content = l.type === 'raster'
    ? <g mask={contentMask}>{inner}</g>
    : <g id={srcId} mask={contentMask}>{inner}</g>;
  return <g data-layer-id={l.id} data-styled="true" opacity={l.opacity} style={{ mixBlendMode: l.blend || 'normal' }} mask={hides ? maskUrl : undefined}>
    {maskDef}
    <defs>{l.type === 'raster' && rasterSrcObj && <g id={srcId} mask={contentMask}><SurfaceImage surfaces={surfaces} surfaceObj={rasterSrcObj} x={l.x} y={l.y} width={l.w} height={l.h} /></g>}{contentFilter}</defs>
    {below}
    {ko}
    <g opacity={bl.fillOpacity / 100} filter={contentFilter ? `url(#${pre}-content)` : undefined}>{content}{bl.blendInterior && interior}</g>
    {!bl.blendInterior && interior}
    {above}
  </g>;
}
