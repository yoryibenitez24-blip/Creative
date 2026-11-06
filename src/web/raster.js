// Canvas 2D rasterizer for PNG export of a node (frame or layer) at 1× / 2× / 3×. Browser only (uses canvas
// and Image); mirrors the editor's CSS rules: inside strokes, box shadows, inner shadows, blurs, clipping.

import { textLayout, fontOf } from './model.js';
import { localMatrix } from './geometry.js';
import { imageRect, rgba } from './codegen.js';

const loadImg = src => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });

/** Append the node's outline (optionally grown by `grow` px on every side) to the current path. */
function addShape(ctx, n, grow = 0) {
  const w = Math.max(0, n.w + 2 * grow), h = Math.max(0, n.h + 2 * grow);
  if (n.type === 'ellipse') { ctx.ellipse(n.w / 2, n.h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); return; }
  const r = (Array.isArray(n.radius) ? n.radius : [n.radius || 0, n.radius || 0, n.radius || 0, n.radius || 0])
    .map(v => v ? Math.max(0, Math.min(v + grow, w / 2, h / 2)) : 0);
  if (ctx.roundRect) ctx.roundRect(-grow, -grow, w, h, r); else ctx.rect(-grow, -grow, w, h);
}
function shapePath(ctx, n) { ctx.beginPath(); addShape(ctx, n); }

const fontString = n => { const f = fontOf(n); return `${f.italic ? 'italic ' : ''}${f.weight} ${f.size}px ${f.family}`; };

/** Canvas-based text measure for the browser (cached). */
export function canvasMeasure() {
  const c = document.createElement('canvas').getContext('2d'); const cache = new Map();
  return (str, f) => {
    const key = `${f.italic ? 'i' : ''}${f.weight}|${f.size}|${f.family}|${f.letterSpacing}|${str}`;
    let w = cache.get(key);
    if (w === undefined) {
      c.font = `${f.italic ? 'italic ' : ''}${f.weight} ${f.size}px ${f.family}`;
      w = c.measureText(str).width + str.length * (f.letterSpacing || 0);
      if (cache.size > 20000) cache.clear();
      cache.set(key, w);
    }
    return w;
  };
}

async function drawNode(ctx, doc, n, isRoot, imgs, measure) {
  if (!n || n.visible === false) return;
  ctx.save();
  if (!isRoot) { const m = localMatrix(n); ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]); }
  ctx.globalAlpha *= n.opacity ?? 1;
  const T = ctx.getTransform(), k = Math.hypot(T.a, T.b) || 1;
  const fx = (n.effects || []).filter(e => e.visible !== false);
  const blur = fx.find(e => e.type === 'layer-blur');
  if (blur && !ctx.__inBlur) {
    // render the layer into an offscreen canvas, then composite it blurred
    const off = document.createElement('canvas'); off.width = ctx.canvas.width; off.height = ctx.canvas.height;
    const o = off.getContext('2d'); o.__inBlur = true; o.setTransform(T); o.globalAlpha = 1;
    await drawNode(o, doc, { ...n, rotation: 0, x: 0, y: 0, opacity: 1 }, true, imgs, measure);
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.filter = `blur(${blur.blur * k}px)`; ctx.drawImage(off, 0, 0); ctx.filter = 'none';
    ctx.restore(); return;
  }
  const isShape = !['text', 'line', 'group'].includes(n.type);
  if (isShape) {
    // drop shadows: a copy of the (spread) shape is drawn far away so only its shadow lands; the shape's own
    // interior is clipped out like CSS box-shadow. Shadow offsets are in device space, so map them through the matrix.
    for (const e of fx.filter(e => e.type === 'drop-shadow')) {
      const off = 1e4;
      ctx.save(); ctx.beginPath(); ctx.rect(-1e5, -1e5, 2e5, 2e5); addShape(ctx, n); ctx.clip('evenodd');
      ctx.shadowColor = rgba(e.color || '#000000', e.opacity ?? 0.25); ctx.shadowBlur = e.blur * k;
      ctx.shadowOffsetX = T.a * (off + e.x) + T.c * e.y; ctx.shadowOffsetY = T.b * (off + e.x) + T.d * e.y;
      ctx.translate(-off, 0); ctx.beginPath(); addShape(ctx, n, e.spread || 0); ctx.fillStyle = '#000'; ctx.fill(); ctx.restore();
    }
    const bg = fx.find(e => e.type === 'background-blur');
    if (bg) {
      const snap = document.createElement('canvas'); snap.width = ctx.canvas.width; snap.height = ctx.canvas.height; snap.getContext('2d').drawImage(ctx.canvas, 0, 0);
      ctx.save(); shapePath(ctx, n); ctx.clip(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.filter = `blur(${bg.blur * k}px)`; ctx.drawImage(snap, 0, 0); ctx.restore();
    }
    if (n.fill) { shapePath(ctx, n); ctx.fillStyle = rgba(n.fill, n.fillOpacity ?? 1); ctx.fill(); }
    if (n.type === 'image' && imgs[n.imageId]) {
      ctx.save(); shapePath(ctx, n); ctx.clip(); const r = imageRect(n); ctx.drawImage(imgs[n.imageId], r.x, r.y, r.w, r.h); ctx.restore();
    }
    for (const e of fx.filter(e => e.type === 'inner-shadow')) {
      ctx.save(); shapePath(ctx, n); ctx.clip();
      ctx.shadowColor = rgba(e.color || '#000000', e.opacity ?? 0.25); ctx.shadowBlur = e.blur * k;
      ctx.shadowOffsetX = T.a * e.x + T.c * e.y; ctx.shadowOffsetY = T.b * e.x + T.d * e.y;
      ctx.beginPath(); ctx.rect(-1e4, -1e4, 2e4, 2e4); addShape(ctx, n, -(e.spread || 0));
      ctx.fillStyle = '#000'; ctx.fill('evenodd'); ctx.restore();
    }
    if (n.stroke && n.strokeWidth > 0) { ctx.save(); shapePath(ctx, n); ctx.clip(); shapePath(ctx, n); ctx.lineWidth = n.strokeWidth * 2; ctx.strokeStyle = rgba(n.stroke); ctx.stroke(); ctx.restore(); }
  }
  if (n.type === 'line') {
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(n.w, 0); ctx.lineWidth = n.strokeWidth || 1; ctx.strokeStyle = rgba(n.stroke || '#000000'); ctx.lineCap = 'butt'; ctx.stroke();
  }
  if (n.type === 'text') {
    const t = textLayout(n, measure);
    ctx.font = fontString(n); ctx.fillStyle = rgba(n.fill || '#000000', n.fillOpacity ?? 1);
    if ('letterSpacing' in ctx) ctx.letterSpacing = (n.letterSpacing || 0) + 'px';
    ctx.textBaseline = 'middle'; ctx.textAlign = n.align === 'center' ? 'center' : n.align === 'right' ? 'right' : 'left';
    const x = n.align === 'center' ? n.w / 2 : n.align === 'right' ? n.w : 0;
    const shadows = fx.filter(e => e.type === 'drop-shadow');
    t.lines.forEach((l, i) => {
      const y = i * t.lineHeight + t.lineHeight / 2;
      for (const e of shadows) { ctx.save(); ctx.shadowColor = rgba(e.color || '#000000', e.opacity ?? 0.25); ctx.shadowBlur = e.blur * k; ctx.shadowOffsetX = T.a * e.x + T.c * e.y; ctx.shadowOffsetY = T.b * e.x + T.d * e.y; ctx.fillText(l, x, y); ctx.restore(); }
      ctx.fillText(l, x, y);
    });
  }
  if (n.children?.length) {
    if (n.type === 'frame' && n.clip) { shapePath(ctx, n); ctx.clip(); }
    for (const c of n.children) await drawNode(ctx, doc, doc.nodes[c], false, imgs, measure);
  }
  ctx.restore();
}

/** Render node `id` to a canvas at `scale` (its own box at the origin). Resolves to the canvas. */
export async function renderNodeToCanvas(doc, id, scale = 1, measure) {
  const n = doc.nodes[id];
  const ids = new Set(); const walk = x => { const k = doc.nodes[x]; if (!k) return; if (k.imageId) ids.add(k.imageId); (k.children || []).forEach(walk); }; walk(id);
  const imgs = {}; await Promise.all([...ids].map(async i => { if (doc.images?.[i]) imgs[i] = await loadImg(doc.images[i]); }));
  const h = n.type === 'line' ? Math.max(1, n.strokeWidth || 1) : n.h;
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(n.w * scale)); c.height = Math.max(1, Math.round(h * scale));
  const ctx = c.getContext('2d'); ctx.scale(scale, scale);
  if (n.type === 'line') ctx.translate(0, h / 2);
  if (document.fonts?.ready) await document.fonts.ready;
  await drawNode(ctx, doc, n, true, imgs, measure || canvasMeasure());
  return c;
}

export const canvasToBlob = c => new Promise(res => c.toBlob(res, 'image/png'));
