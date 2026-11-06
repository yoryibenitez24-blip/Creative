import React, { useEffect, useMemo, useRef } from 'react';
import { layoutText, layoutOnPath, warpRaster, isLegacyText, charStyleAt, paraStyle, WARP_DEFAULT } from '../engine/textlayout.js';

// Rendering of text layers (point / paragraph / on path / warped) as SVG in the layer's local
// coordinates (origin = top-left of the text box), plus an in-place text editor.

// ---------- browser measure (canvas 2D, cached) ----------
let mctx = null; const mcache = new Map();
function ctx2d() {
  if (!mctx) {
    const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(8, 8) : document.createElement('canvas');
    mctx = c.getContext('2d');
    if (typeof document !== 'undefined' && document.fonts?.addEventListener) document.fonts.addEventListener('loadingdone', () => { mcache.clear(); warpCache.clear(); });
  }
  return mctx;
}
/** measure(text, cssFont) => advance width in px (uses the font's own kerning, as SVG does). */
export const measure = (text, font) => {
  const k = font + '\u0000' + text; let w = mcache.get(k);
  if (w === undefined) { const c = ctx2d(); c.font = font; w = c.measureText(text).width; if (mcache.size > 20000) mcache.clear(); mcache.set(k, w); }
  return w;
};
/** Ink extents for optical kerning: left = where ink starts (px right of the pen), right = where it ends. */
measure.bounds = (text, font) => { const c = ctx2d(); c.font = font; const m = c.measureText(text); return { left: -m.actualBoundingBoxLeft, right: m.actualBoundingBoxRight }; };

const r3 = v => Math.round(v * 1000) / 1000;
const styleKey = g => [g.css, g.fill, g.scaleX, g.scaleY, g.skew, g.fauxBold, g.y, g.language, g.ligatures].join('|');

function glyphText(gs, layer, key, extra = {}) {
  const g = gs[0], tf = g.scaleX !== 1 || g.scaleY !== 1 || g.skew;
  const x0 = g.x, xs = gs.map(q => r3(tf ? (q.x - x0) / g.scaleX : q.x)).join(' ');
  const bold = g.fauxBold && !layer.stroke;
  return <text key={key} fontFamily={g.font} fontSize={r3(g.size)} fontWeight={g.weight} fontStyle={g.italic ? 'italic' : undefined}
    fill={g.fill} stroke={layer.stroke || (bold ? g.fill : undefined)} strokeWidth={layer.stroke ? layer.strokeWidth || 0 : bold ? r3(g.size * 0.04) : undefined}
    strokeLinejoin={bold ? 'round' : undefined} xmlLang={g.language} style={{ whiteSpace: 'pre', fontVariantLigatures: g.ligatures ? undefined : 'none', fontKerning: 'none' }}
    x={xs} y={tf ? 0 : r3(g.y)} transform={tf ? `translate(${r3(x0)} ${r3(g.y)}) scale(${g.scaleX} ${g.scaleY})${g.skew ? ` skewX(${g.skew})` : ''}` : undefined} {...extra}>
    {gs.map(q => q.ch).join('')}
  </text>;
}

function decorations(line, key) {
  const out = [];
  line.glyphs.forEach((g, i) => {
    if (!g.decoration) return;
    const th = Math.max(0.5, g.nominal * 0.06), right = i < line.glyphs.length - 1 ? line.glyphs[i + 1].x : g.x + g.advance;
    const w = Math.max(g.advance, right - g.x);
    if (g.decoration.includes('underline')) out.push(<rect key={key + 'u' + i} x={r3(g.x)} y={r3(line.y + g.nominal * 0.1)} width={r3(w)} height={r3(th)} fill={g.fill} />);
    if (g.decoration.includes('line-through')) out.push(<rect key={key + 's' + i} x={r3(g.x)} y={r3(g.y - g.size * 0.3)} width={r3(w)} height={r3(th)} fill={g.fill} />);
  });
  return out;
}

/** Glyph-accurate SVG for a layout (one <text> per uniformly styled run, with a per-glyph x list). */
function LayoutSvg({ layer, layout }) {
  const els = [];
  layout.lines.forEach((line, li) => {
    if (line.hidden) return;
    let i = 0; const gs = line.glyphs;
    while (i < gs.length) {
      let j = i + 1;
      if (gs[i].ch.length === 1) while (j < gs.length && gs[j].ch.length === 1 && styleKey(gs[j]) === styleKey(gs[i])) j++;
      els.push(glyphText(gs.slice(i, j), layer, li + ':' + i));
      i = j;
    }
    els.push(...decorations(line, 'd' + li));
  });
  return <g data-text-kind={layer.kind || 'point'}>{els}</g>;
}

function PathSvg({ layer }) {
  const r = layoutOnPath(layer, measure);
  return <g data-text-kind="path">{r.glyphs.filter(g => !g.hidden && g.ch !== ' ').map((g, i) => {
    const bold = g.fauxBold && !layer.stroke;
    return <text key={i} transform={`translate(${r3(g.x)} ${r3(g.y)}) rotate(${r3(g.angle)}) scale(${g.scaleX} ${g.scaleY})${g.skew ? ` skewX(${g.skew})` : ''}`}
      x={r3(-g.advance / 2 / g.scaleX)} y={r3(g.dy / g.scaleY)} fontFamily={g.font} fontSize={r3(g.size)} fontWeight={g.weight} fontStyle={g.italic ? 'italic' : undefined}
      fill={g.fill} stroke={layer.stroke || (bold ? g.fill : undefined)} strokeWidth={layer.stroke ? layer.strokeWidth || 0 : bold ? r3(g.size * 0.04) : undefined}
      textDecoration={g.decoration || undefined} xmlLang={g.language}>{g.ch}</text>;
  })}</g>;
}

// ---------- warp (raster) ----------
const warpCache = new Map();
/** Draws a layout into a 2D context; local coordinates (lx, ly) map to canvas ((lx-ox)*s, (ly-oy)*s). */
export function drawLayout(c, layout, layer, s, ox, oy) {
  for (const line of layout.lines) {
    if (line.hidden) continue;
    for (const g of line.glyphs) {
      c.save(); c.translate((g.x - ox) * s, (g.y - oy) * s); c.scale(s * g.scaleX, s * g.scaleY);
      if (g.skew) c.transform(1, 0, Math.tan(g.skew * Math.PI / 180), 1, 0, 0);
      c.font = g.css; c.fillStyle = g.fill; c.fillText(g.ch, 0, 0);
      const bold = g.fauxBold && !layer.stroke;
      if (layer.stroke && layer.strokeWidth || bold) { c.lineJoin = 'round'; c.strokeStyle = layer.stroke || g.fill; c.lineWidth = layer.stroke ? layer.strokeWidth : g.size * 0.04; c.strokeText(g.ch, 0, 0); }
      c.restore();
      if (g.decoration) {
        c.fillStyle = g.fill; const th = Math.max(0.5, g.nominal * 0.06) * s, w = g.advance * s;
        if (g.decoration.includes('underline')) c.fillRect((g.x - ox) * s, (line.y + g.nominal * 0.1 - oy) * s, w, th);
        if (g.decoration.includes('line-through')) c.fillRect((g.x - ox) * s, (g.y - g.size * 0.3 - oy) * s, w, th);
      }
    }
  }
}

/** Renders the layer's text warped; returns { url, x, y, w, h } in layer-local coordinates (or null). */
export function renderWarped(layer, warp = layer.warp, maxPixels = 4e6) {
  const key = JSON.stringify([layer.text, layer.w, layer.h, layer.kind, layer.runs, layer.kerningPairs, warp, ...Object.keys(layer).filter(k => /^(font|weight|italic|size|leading|lineHeight|tracking|spacing|kerning|vScale|hScale|baselineShift|fill|stroke|strokeWidth|faux|allCaps|smallCaps|super|sub|under|strike|align|indent|space|hyphen)/.test(k)).sort().map(k => [k, layer[k]])]);
  if (warpCache.has(key)) return warpCache.get(key);
  const layout = layoutText(layer, measure), b = layout.bounds;
  if (!b.w || !b.h) return null;
  const pad = Math.max(4, (layer.size || 60) * 0.3), lx = b.x - pad, ly = b.y - pad, lw = b.w + 2 * pad, lh = b.h + 2 * pad;
  const s = Math.max(0.25, Math.min(2, Math.sqrt(maxPixels / (lw * lh * 2.5))));
  const cw = Math.ceil(lw * s), ch = Math.ceil(lh * s);
  const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
  const c = cv.getContext('2d'); drawLayout(c, layout, layer, s, lx, ly);
  const src = c.getImageData(0, 0, cw, ch);
  const out = warpRaster({ w: cw, h: ch, data: src.data }, { ...WARP_DEFAULT, ...warp }, { x: pad * s, y: pad * s, w: b.w * s, h: b.h * s });
  const oc = document.createElement('canvas'); oc.width = out.w; oc.height = out.h;
  oc.getContext('2d').putImageData(new ImageData(out.data, out.w, out.h), 0, 0);
  const res = { url: oc.toDataURL('image/png'), x: lx + out.ox / s, y: ly + out.oy / s, w: out.w / s, h: out.h / s };
  if (warpCache.size > 40) warpCache.delete(warpCache.keys().next().value);
  warpCache.set(key, res);
  return res;
}

function WarpSvg({ layer }) {
  const r = renderWarped(layer);
  return r ? <image data-text-kind="warp" href={r.url} x={r3(r.x)} y={r3(r.y)} width={r3(r.w)} height={r3(r.h)} preserveAspectRatio="none" /> : null;
}

/** <TextLayerSvg layer={l}/>: drop-in replacement for the text branch of layerContent(). Legacy layers
 *  produce exactly the original markup; others are rendered from layoutText / layoutOnPath / warp. */
export function TextLayerSvg({ layer: l }) {
  if (l.onPath?.d) return <PathSvg layer={l} />;
  if (l.warp && l.warp.style && l.warp.style !== 'none') return <WarpSvg layer={l} />;
  if (isLegacyText(l)) return <text fontFamily={l.font || 'Arial, sans-serif'} fontSize={l.size} fontWeight={l.weight || 400} stroke={l.stroke} strokeWidth={l.strokeWidth || 0} fill={l.fill} letterSpacing={l.spacing || 0} textAnchor={l.align === 'center' ? 'middle' : l.align === 'right' ? 'end' : 'start'}>{String(l.text ?? '').split('\n').map((t, i) => <tspan key={i} x={l.align === 'center' ? l.w / 2 : l.align === 'right' ? l.w : 0} y={(i + 1) * l.size * (l.lineHeight || 1.1)}>{t}</tspan>)}</text>;
  return <LayoutSvg layer={l} layout={layoutText(l, measure)} />;
}

/** Layout of a text layer with the browser metric (for hit boxes, overflow badges, auto-sizing point text). */
export const measureTextLayer = layer => layer.onPath?.d ? layoutOnPath(layer, measure) : layoutText(layer, measure);

/**
 * In-place editor: place inside the layer's local coordinate group (same transform as TextLayerSvg).
 * A transparent textarea in a <foreignObject> sits over the rendered text so the user types on canvas
 * and sees the real rendering update; only the caret and selection highlight come from the textarea.
 * For text on a path or warped text the textarea text is shown instead (glyphs cannot be aligned).
 * onChange(text, { start, end }) fires on input and on selection change (same text);
 * onExit() fires on Esc and Ctrl/Cmd+Enter. It deliberately does NOT exit on blur, so the user can
 * select characters and then click Character panel controls; the host ends editing when the user
 * clicks elsewhere on the canvas or switches tool/layer.
 */
export function TextEditOverlay({ layer, zoom = 1, onChange, onExit }) {
  const ref = useRef(null);
  useEffect(() => { const t = ref.current; if (!t) return; t.focus({ preventScroll: true }); const n = t.value.length; t.setSelectionRange(n, n); }, []);
  const st = charStyleAt(layer, 0), P = paraStyle(layer), para = layer.kind === 'paragraph';
  const layout = useMemo(() => layoutText(layer, measure), [layer]);
  const lead = layout.lines[0]?.leading || st.size * 1.2, fancy = !!(layer.onPath?.d || (layer.warp && layer.warp.style !== 'none'));
  const w = para ? layer.w : Math.max(layer.w || 0, layout.width + st.size), h = Math.max(para ? layer.h : 0, layout.height + st.size * 0.5, lead * 1.3);
  // CSS line box: baseline sits at (lead - (asc + desc)) / 2 + asc; shift it to our baseline at `lead`.
  const padTop = Math.max(0, lead - ((lead - 1.117 * st.size) / 2 + 0.905 * st.size));
  const align = P.align.startsWith('justify') ? (P.align === 'justify-all' ? 'justify' : P.align.slice(8)) : P.align;
  const sel = t => ({ start: t.selectionStart, end: t.selectionEnd });
  const box = 1 / Math.max(0.05, zoom);
  return <foreignObject x={0} y={0} width={w} height={h} style={{ overflow: 'visible' }} onPointerDown={e => e.stopPropagation()}>
    <textarea ref={ref} className="typeEditArea" aria-label="Edit text on canvas" spellCheck={false} value={String(layer.text ?? '')} lang={st.language}
      onChange={e => onChange(e.target.value, sel(e.target))} onSelect={e => onChange(e.target.value, sel(e.target))}
      onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); onExit(); } }}
      style={{
        width: w, height: h, boxSizing: 'border-box', margin: 0, border: 0, resize: 'none', overflow: 'hidden', background: fancy ? '#000000aa' : 'transparent',
        outline: `${box}px dashed #b5a2ef`, padding: `${padTop}px ${P.indentRight}px 0 ${P.indentLeft}px`, textIndent: P.indentFirst,
        fontFamily: st.font, fontSize: st.size, fontWeight: st.weight, fontStyle: st.italic ? 'italic' : 'normal', lineHeight: lead + 'px',
        letterSpacing: (st.tracking != null ? st.tracking / 1000 * st.size : layer.spacing || 0) + 'px', textAlign: align,
        whiteSpace: para ? 'pre-wrap' : 'pre', textTransform: st.allCaps ? 'uppercase' : 'none',
        color: fancy ? '#fff' : 'transparent', caretColor: st.fill === 'transparent' ? '#b5a2ef' : st.fill,
      }} />
  </foreignObject>;
}
