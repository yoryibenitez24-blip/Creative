// Code generation for the web design document: CSS style objects (shared by the editor renderer, so the canvas and
// the exported HTML use the same rules), "Copy CSS" text, self-contained HTML+CSS export and SVG export. Pure JS.

import { textLayout, approxMeasure, isInstanceRoot } from './model.js';
import { alignParts, padArray } from './layout.js';
import { localMatrix } from './geometry.js';

const r2 = v => Math.round((+v || 0) * 100) / 100;
const px = v => r2(v) + 'px';
export function rgba(hex, a = 1) {
  if (!hex) return 'transparent';
  const h = hex.replace('#', ''); const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return a >= 1 ? '#' + h.toLowerCase() : `rgba(${r}, ${g}, ${b}, ${r2(a)})`;
}
const radiusCss = n => {
  if (n.type === 'ellipse') return '50%';
  const r = n.radius; if (Array.isArray(r)) return r.every(v => v === r[0]) ? (r[0] ? px(r[0]) : null) : r.map(px).join(' ');
  return r ? px(r) : null;
};
const JUST = { start: 'flex-start', center: 'center', end: 'flex-end' };

/** Geometry of an image inside its box for fit 'fill' (cover) / 'fit' (contain) / 'crop' (cover × scale at focal x/y). */
export function imageRect(n) {
  const iw = n.imgW || n.w || 1, ih = n.imgH || n.h || 1;
  const s = n.fit === 'fit' ? Math.min(n.w / iw, n.h / ih) : Math.max(n.w / iw, n.h / ih) * (n.fit === 'crop' ? Math.max(1, n.crop?.scale || 1) : 1);
  const dw = iw * s, dh = ih * s;
  const fx = n.fit === 'crop' ? n.crop?.x ?? 0.5 : 0.5, fy = n.fit === 'crop' ? n.crop?.y ?? 0.5 : 0.5;
  return { x: (n.w - dw) * fx, y: (n.h - dh) * fy, w: dw, h: dh };
}

/**
 * CSS for one node as a style object (camelCase keys, string values).
 * mode: 'absolute' (left/top/width/height inside the parent), 'flex' (child of an auto layout frame), 'root' (exported frame).
 */
export function nodeStyle(doc, n, mode = 'absolute') {
  const s = {};
  const par = n.parent ? doc.nodes[n.parent] : null;
  if (mode === 'root') { s.position = 'relative'; s.width = px(n.w); s.height = px(n.h); s.flexShrink = '0'; }
  else if (mode === 'flex' && !n.ignoreLayout) {
    const horiz = par.layout.direction !== 'vertical';
    s.position = 'relative'; s.flexShrink = '0';
    const fillMain = (horiz ? n.sizing?.h : n.sizing?.v) === 'fill' && (horiz ? par.sizing?.h : par.sizing?.v) !== 'hug';
    const fillCross = (horiz ? n.sizing?.v : n.sizing?.h) === 'fill' && (horiz ? par.sizing?.v : par.sizing?.h) !== 'hug';
    if (fillMain) { s.flex = '1 1 0'; s[horiz ? 'minWidth' : 'minHeight'] = '0'; } else s[horiz ? 'width' : 'height'] = px(horiz ? n.w : n.h);
    if (fillCross && !par.layout.wrap) s.alignSelf = 'stretch'; else s[horiz ? 'height' : 'width'] = px(horiz ? n.h : n.w);
    if (fillCross && par.layout.wrap) s[horiz ? 'height' : 'width'] = px(horiz ? n.h : n.w);
  } else {
    s.position = 'absolute'; s.left = px(n.x); s.top = px(n.type === 'line' ? n.y - (n.strokeWidth || 1) / 2 : n.y);
    s.width = px(n.w); s.height = px(n.type === 'line' ? n.strokeWidth || 1 : n.h);
  }
  if (mode === 'flex' && n.type === 'line') s.height = px(n.strokeWidth || 1);
  s.boxSizing = 'border-box';
  if (n.visible === false) s.display = 'none';
  if (n.rotation && mode !== 'root') s.transform = `rotate(${r2(n.rotation)}deg)`;
  if (n.opacity != null && n.opacity < 1) s.opacity = String(r2(n.opacity));
  if (n.type === 'line') s.background = rgba(n.stroke || '#000000', 1);
  else if (n.type !== 'text' && n.fill) s.background = rgba(n.fill, n.fillOpacity ?? 1);
  if (n.type === 'image' && n.imageId && doc.images?.[n.imageId]) {
    const r = imageRect(n);
    s.backgroundImage = `url("${doc.images[n.imageId]}")`; s.backgroundRepeat = 'no-repeat';
    s.backgroundSize = `${px(r.w)} ${px(r.h)}`; s.backgroundPosition = `${px(r.x)} ${px(r.y)}`;
  }
  if (n.type !== 'text' && n.type !== 'line' && n.type !== 'group') { const r = radiusCss(n); if (r) s.borderRadius = r; }
  const shadows = [], tshadows = [], filters = [];
  for (const e of n.effects || []) {
    if (e.visible === false) continue;
    const col = rgba(e.color || '#000000', e.opacity ?? 0.25);
    if (e.type === 'drop-shadow') (n.type === 'text' ? tshadows : shadows).push(`${px(e.x)} ${px(e.y)} ${px(e.blur)}${n.type === 'text' ? '' : ' ' + px(e.spread)} ${col}`);
    else if (e.type === 'inner-shadow' && n.type !== 'text') shadows.push(`inset ${px(e.x)} ${px(e.y)} ${px(e.blur)} ${px(e.spread)} ${col}`);
    else if (e.type === 'layer-blur') filters.push(`blur(${px(e.blur)})`);
    else if (e.type === 'background-blur') s.backdropFilter = `blur(${px(e.blur)})`;
  }
  if (n.stroke && n.strokeWidth > 0 && !['line', 'text', 'group'].includes(n.type)) shadows.push(`inset 0 0 0 ${px(n.strokeWidth)} ${rgba(n.stroke)}`);
  if (shadows.length) s.boxShadow = shadows.join(', ');
  if (tshadows.length) s.textShadow = tshadows.join(', ');
  if (filters.length) s.filter = filters.join(' ');
  if (n.type === 'frame' && n.clip) s.overflow = 'hidden';
  if (n.type === 'frame' && n.layout) Object.assign(s, flexCss(n));
  if (n.type === 'text') {
    s.color = rgba(n.fill || '#000000', n.fillOpacity ?? 1);
    s.fontFamily = n.fontFamily; s.fontSize = px(n.fontSize); s.fontWeight = String(n.fontWeight || 400);
    if (n.italic) s.fontStyle = 'italic';
    s.lineHeight = px(n.lineHeight || Math.round(n.fontSize * 1.2));
    if (n.letterSpacing) s.letterSpacing = px(n.letterSpacing);
    s.textAlign = n.align || 'left';
    s.whiteSpace = n.textMode === 'auto-width' && n.sizing?.h !== 'fill' ? 'pre' : 'pre-wrap';
    s.overflowWrap = 'break-word';
  }
  return s;
}

/** Flexbox properties for an auto layout frame. */
export function flexCss(n) {
  const L = n.layout, horiz = L.direction !== 'vertical';
  const { v, h } = alignParts(L.align), main = horiz ? h : v, cross = horiz ? v : h;
  const p = padArray(L.padding);
  const s = { display: 'flex', flexDirection: horiz ? 'row' : 'column' };
  if (L.wrap) { s.flexWrap = 'wrap'; s[horiz ? 'columnGap' : 'rowGap'] = px(L.gap); s[horiz ? 'rowGap' : 'columnGap'] = px(L.wrapGap ?? L.gap); s.alignContent = JUST[cross]; }
  else if (L.gap) s.gap = px(L.gap);
  if (p.some(Boolean)) s.padding = p.map(px).join(' ');
  s.justifyContent = L.distribute === 'space-between' ? 'space-between' : JUST[main];
  s.alignItems = JUST[cross];
  return s;
}

const kebab = k => k.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
export const cssText = (s, indent = '') => Object.entries(s).map(([k, v]) => `${indent}${kebab(k)}: ${v};`).join('\n');
export const modeFor = (doc, n) => { const p = n.parent ? doc.nodes[n.parent] : null; return p?.layout && !n.ignoreLayout ? 'flex' : 'absolute'; };

/** "Copy CSS" text for one layer (auto layout children are described as flex items). */
export function cssForNode(doc, id) {
  const n = doc.nodes[id]; if (!n) return '';
  const s = nodeStyle(doc, n, modeFor(doc, n));
  if (s.backgroundImage) s.backgroundImage = 'url("image.png")';
  return `/* ${n.name} */\n` + cssText(s);
}

const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slug = t => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'layer';

/** A single self-contained HTML file for a frame: absolute layout for free frames, flexbox for auto layout. */
export function exportFrameHtml(doc, frameId) {
  const f = doc.nodes[frameId]; if (!f) return '';
  const rules = []; let k = 0;
  const visit = (n, mode) => {
    const cls = `z${++k}-${slug(n.name)}`;
    rules.push(`.${cls} {\n${cssText(nodeStyle(doc, n, mode), '  ')}\n}`);
    const attrs = `class="${cls}" data-name="${esc(n.name)}"`;
    if (n.type === 'text') return `<div ${attrs}>${esc(n.text)}</div>`;
    if (n.type === 'line') return `<div ${attrs}></div>`;
    const kids = (n.children || []).map(c => doc.nodes[c]).filter(Boolean).map(c => visit(c, n.layout && !c.ignoreLayout ? 'flex' : 'absolute'));
    return `<div ${attrs}>${kids.length ? '\n' + kids.join('\n') + '\n' : ''}</div>`;
  };
  const body = visit(f, 'root');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(f.name)}</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { min-height: 100vh; display: flex; justify-content: center; align-items: flex-start; background: #e9e9ec; font-family: system-ui, sans-serif; }
${rules.join('\n')}
</style>
</head>
<body>
${body}
</body>
</html>
`;
}

// ─── SVG ───
const num = v => r2(v);
const rectPath = (w, h, r) => {
  const [tl, tr, br, bl] = (Array.isArray(r) ? r : [r || 0, r || 0, r || 0, r || 0]).map(v => Math.max(0, Math.min(v, w / 2, h / 2)));
  return `M${num(tl)},0 H${num(w - tr)} A${num(tr)},${num(tr)} 0 0 1 ${num(w)},${num(tr)} V${num(h - br)} A${num(br)},${num(br)} 0 0 1 ${num(w - br)},${num(h)} H${num(bl)} A${num(bl)},${num(bl)} 0 0 1 0,${num(h - bl)} V${num(tl)} A${num(tl)},${num(tl)} 0 0 1 ${num(tl)},0 Z`;
};
export const shapePathD = n => n.type === 'ellipse'
  ? `M0,${num(n.h / 2)} A${num(n.w / 2)},${num(n.h / 2)} 0 1 0 ${num(n.w)},${num(n.h / 2)} A${num(n.w / 2)},${num(n.h / 2)} 0 1 0 0,${num(n.h / 2)} Z`
  : rectPath(n.w, n.h, n.radius);

/** SVG document for a node (the node's own position is dropped; its box starts at 0,0). Background blur is not representable. */
export function exportSvg(doc, id, measure = approxMeasure) {
  const root = doc.nodes[id]; if (!root) return '';
  const defs = []; let k = 0;
  const uid = p => `${p}${++k}`;
  const visit = (n, isRoot) => {
    if (n.visible === false) return '';
    const m = isRoot ? null : localMatrix(n);
    const attrs = [];
    if (m) attrs.push(`transform="matrix(${m.map(num).join(' ')})"`);
    if (n.opacity != null && n.opacity < 1) attrs.push(`opacity="${num(n.opacity)}"`);
    const fx = (n.effects || []).filter(e => e.visible !== false && e.type !== 'background-blur');
    if (fx.length) {
      const fid = uid('f'); const parts = [];
      let src = 'SourceGraphic'; const merges = [];
      for (const e of fx) {
        const col = e.color || '#000000', op = e.opacity ?? 0.25;
        if (e.type === 'drop-shadow') { const r = uid('r'); parts.push(`<feDropShadow dx="${num(e.x)}" dy="${num(e.y)}" stdDeviation="${num(e.blur / 2)}" flood-color="${col}" flood-opacity="${num(op)}" result="${r}"/>`); merges.unshift(r); }
        if (e.type === 'inner-shadow') {
          const r = uid('r');
          parts.push(`<feComponentTransfer in="SourceAlpha" result="${r}a"><feFuncA type="table" tableValues="1 0"/></feComponentTransfer><feOffset dx="${num(e.x)}" dy="${num(e.y)}" result="${r}b"/><feGaussianBlur stdDeviation="${num(e.blur / 2)}" result="${r}c"/><feFlood flood-color="${col}" flood-opacity="${num(op)}"/><feComposite operator="in" in2="${r}c"/><feComposite operator="in" in2="SourceAlpha" result="${r}"/>`);
          merges.push(r);
        }
        if (e.type === 'layer-blur') { const r = uid('r'); parts.push(`<feGaussianBlur in="${src}" stdDeviation="${num(e.blur / 2)}" result="${r}"/>`); src = r; }
      }
      const shadowsBelow = merges.filter(r => parts.some(p => p.includes('feDropShadow') && p.includes(`result="${r}"`)));
      const inner = merges.filter(r => !shadowsBelow.includes(r));
      parts.push(`<feMerge>${shadowsBelow.map(r => `<feMergeNode in="${r}"/>`).join('')}<feMergeNode in="${src}"/>${inner.map(r => `<feMergeNode in="${r}"/>`).join('')}</feMerge>`);
      defs.push(`<filter id="${fid}" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB">${parts.join('')}</filter>`);
      attrs.push(`filter="url(#${fid})"`);
    }
    const out = [];
    const fill = n.fill ? `fill="${n.fill}"${(n.fillOpacity ?? 1) < 1 ? ` fill-opacity="${num(n.fillOpacity)}"` : ''}` : 'fill="none"';
    if (n.type === 'line') out.push(`<line x1="0" y1="0" x2="${num(n.w)}" y2="0" stroke="${n.stroke || '#000'}" stroke-width="${num(n.strokeWidth || 1)}"/>`);
    else if (n.type === 'text') {
      const t = textLayout(n, measure);
      const anchor = n.align === 'center' ? 'middle' : n.align === 'right' ? 'end' : 'start';
      const x = n.align === 'center' ? n.w / 2 : n.align === 'right' ? n.w : 0;
      out.push(`<text font-family="${esc(n.fontFamily)}" font-size="${num(n.fontSize)}" font-weight="${n.fontWeight || 400}"${n.italic ? ' font-style="italic"' : ''}${n.letterSpacing ? ` letter-spacing="${num(n.letterSpacing)}"` : ''} text-anchor="${anchor}" dominant-baseline="central" ${fill} xml:space="preserve">` +
        t.lines.map((l, i) => `<tspan x="${num(x)}" y="${num(i * t.lineHeight + t.lineHeight / 2)}">${esc(l)}</tspan>`).join('') + '</text>');
    } else if (n.type !== 'group') {
      const d = shapePathD(n);
      if (n.fill) out.push(`<path d="${d}" ${fill}/>`);
      if (n.type === 'image' && n.imageId && doc.images?.[n.imageId]) {
        const cid = uid('c'); defs.push(`<clipPath id="${cid}"><path d="${d}"/></clipPath>`);
        const r = imageRect(n);
        out.push(`<image href="${doc.images[n.imageId]}" x="${num(r.x)}" y="${num(r.y)}" width="${num(r.w)}" height="${num(r.h)}" preserveAspectRatio="none" clip-path="url(#${cid})"/>`);
      }
      if (n.stroke && n.strokeWidth > 0) {
        const cid = uid('c'); defs.push(`<clipPath id="${cid}"><path d="${d}"/></clipPath>`);
        out.push(`<path d="${d}" fill="none" stroke="${n.stroke}" stroke-width="${num(n.strokeWidth * 2)}" clip-path="url(#${cid})"/>`);
      }
    }
    const kids = (n.children || []).map(c => visit(doc.nodes[c], false)).join('');
    if (kids) {
      if (n.type === 'frame' && n.clip) { const cid = uid('c'); defs.push(`<clipPath id="${cid}"><path d="${shapePathD(n)}"/></clipPath>`); out.push(`<g clip-path="url(#${cid})">${kids}</g>`); }
      else out.push(kids);
    }
    return `<g data-name="${esc(n.name)}"${attrs.length ? ' ' + attrs.join(' ') : ''}>${out.join('')}</g>`;
  };
  const body = visit(root, true);
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${num(root.w)}" height="${num(Math.max(root.h, root.type === 'line' ? root.strokeWidth || 1 : 0))}" viewBox="0 ${root.type === 'line' ? num(-(root.strokeWidth || 1) / 2) : 0} ${num(root.w)} ${num(Math.max(root.h, root.type === 'line' ? root.strokeWidth || 1 : 0))}">` +
    (defs.length ? `<defs>${defs.join('')}</defs>` : '') + body + '</svg>';
}

export { isInstanceRoot };
