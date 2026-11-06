// Marketing templates: original banner / social / card layouts that place the cut-out product and
// editable text. `layoutTemplate` is pure (element list in canvas px); `drawTemplate` paints the
// elements on any CanvasRenderingContext2D-compatible context (browser canvas, OffscreenCanvas,
// @napi-rs/canvas in tests).
//
// Element kinds: rect {x,y,w,h,r?,fill}, gradient {x,y,w,h,from,to,angle}, circle {cx,cy,r,fill},
// product {x,y,w,h, shadow?}, text {text,x,y,maxW,size,weight,color,align,baseline?,lines?,strike?,
// track?}, pill {x,y,w,h,fill,text,color,size}.

export const TEMPLATE_FIELDS = {
  headline: 'Headline', subline: 'Subline', price: 'Price', oldPrice: 'Old price', badge: 'Badge text', cta: 'Button text',
  bgColor: 'Background colour', accentColor: 'Accent colour', textColor: 'Text colour',
};
const COMMON = { headline: 'Summer Sale', subline: 'Fresh picks for sunny days', price: '$49', oldPrice: '$69', badge: '-30%', cta: 'Shop now', bgColor: '#f4efe6', accentColor: '#ff5a36', textColor: '#1d1b22' };

const FONT = '"Inter", "Helvetica Neue", Arial, sans-serif';

export const TEMPLATES = [
  {
    id: 'sale-banner', name: 'Sale banner', w: 1200, h: 628, fields: ['headline', 'subline', 'price', 'cta', 'bgColor', 'accentColor', 'textColor'],
    defaults: { ...COMMON, headline: 'Summer Sale', subline: 'Up to 50 % off selected items' },
    layout: (p, W, H) => [
      { kind: 'rect', x: 0, y: 0, w: W, h: H, fill: p.bgColor },
      { kind: 'circle', cx: W * 0.74, cy: H * 0.52, r: H * 0.44, fill: p.accentColor, alpha: 0.18 },
      { kind: 'rect', x: 0, y: 0, w: 14, h: H, fill: p.accentColor },
      { kind: 'product', x: W * 0.52, y: H * 0.1, w: W * 0.44, h: H * 0.8, shadow: true },
      { kind: 'text', text: p.headline, x: 70, y: 110, maxW: W * 0.44, size: 78, weight: 800, color: p.textColor, lines: 2 },
      { kind: 'text', text: p.subline, x: 72, y: 330, maxW: W * 0.42, size: 30, weight: 500, color: p.textColor, alpha: 0.75, lines: 2 },
      { kind: 'text', text: p.price, x: 70, y: 420, maxW: 300, size: 54, weight: 800, color: p.accentColor },
      { kind: 'pill', x: 72, y: 500, w: 230, h: 64, fill: p.textColor, color: p.bgColor, text: p.cta, size: 26 },
    ],
  },
  {
    id: 'instagram-post', name: 'Instagram post', w: 1080, h: 1080, fields: ['headline', 'subline', 'price', 'bgColor', 'accentColor', 'textColor'],
    defaults: { ...COMMON, headline: 'Made to last', subline: 'Everyday essentials', bgColor: '#e9f0ff', accentColor: '#3d5afe' },
    layout: (p, W, H) => [
      { kind: 'gradient', x: 0, y: 0, w: W, h: H, from: p.bgColor, to: '#ffffff', angle: 90 },
      { kind: 'text', text: p.headline, x: W / 2, y: 90, maxW: W - 160, size: 84, weight: 800, color: p.textColor, align: 'center' },
      { kind: 'text', text: p.subline, x: W / 2, y: 196, maxW: W - 200, size: 34, weight: 500, color: p.textColor, align: 'center', alpha: 0.7 },
      { kind: 'product', x: W * 0.15, y: H * 0.27, w: W * 0.7, h: H * 0.6, shadow: true },
      { kind: 'pill', x: W - 300, y: H - 150, w: 230, h: 84, fill: p.accentColor, color: '#ffffff', text: p.price, size: 42 },
    ],
  },
  {
    id: 'story', name: 'Story', w: 1080, h: 1920, fields: ['headline', 'subline', 'price', 'cta', 'bgColor', 'accentColor', 'textColor'],
    defaults: { ...COMMON, headline: 'Just dropped', subline: 'Limited stock — get yours today', bgColor: '#1c1a24', accentColor: '#c6ff4a', textColor: '#ffffff' },
    layout: (p, W, H) => [
      { kind: 'rect', x: 0, y: 0, w: W, h: H, fill: p.bgColor },
      { kind: 'circle', cx: W / 2, cy: H * 0.5, r: W * 0.46, fill: p.accentColor, alpha: 0.16 },
      { kind: 'text', text: p.headline, x: W / 2, y: 190, maxW: W - 160, size: 120, weight: 800, color: p.textColor, align: 'center', lines: 2 },
      { kind: 'product', x: W * 0.1, y: H * 0.27, w: W * 0.8, h: H * 0.46, shadow: true },
      { kind: 'text', text: p.subline, x: W / 2, y: H * 0.77, maxW: W - 200, size: 44, weight: 500, color: p.textColor, align: 'center', alpha: 0.8, lines: 2 },
      { kind: 'text', text: p.price, x: W / 2, y: H * 0.84, maxW: W - 200, size: 76, weight: 800, color: p.accentColor, align: 'center' },
      { kind: 'pill', x: W / 2 - 220, y: H - 260, w: 440, h: 110, fill: p.accentColor, color: p.bgColor, text: p.cta, size: 46 },
    ],
  },
  {
    id: 'product-card', name: 'Product card', w: 1080, h: 1350, fields: ['headline', 'subline', 'price', 'oldPrice', 'bgColor', 'accentColor', 'textColor'],
    defaults: { ...COMMON, headline: 'Classic Product', subline: 'Free shipping · 30-day returns', bgColor: '#ffffff', accentColor: '#e0245e' },
    layout: (p, W, H) => [
      { kind: 'rect', x: 0, y: 0, w: W, h: H, fill: p.bgColor },
      { kind: 'rect', x: 60, y: 60, w: W - 120, h: H * 0.62, r: 36, fill: '#f1f1f4' },
      { kind: 'product', x: 120, y: 110, w: W - 240, h: H * 0.62 - 100, shadow: true },
      { kind: 'text', text: p.headline, x: 70, y: H * 0.62 + 110, maxW: W - 140, size: 64, weight: 800, color: p.textColor, lines: 2 },
      { kind: 'text', text: p.subline, x: 72, y: H * 0.62 + 230, maxW: W - 140, size: 32, weight: 500, color: p.textColor, alpha: 0.6 },
      { kind: 'text', text: p.price, x: 70, y: H - 130, maxW: 400, size: 76, weight: 800, color: p.accentColor },
      { kind: 'text', text: p.oldPrice, x: 400, y: H - 116, maxW: 300, size: 44, weight: 500, color: p.textColor, alpha: 0.45, strike: true },
    ],
  },
  {
    id: 'discount-badge', name: 'Discount badge', w: 1080, h: 1080, fields: ['headline', 'badge', 'price', 'bgColor', 'accentColor', 'textColor'],
    defaults: { ...COMMON, headline: 'Weekend deal', badge: '-30%', bgColor: '#fff6e8', accentColor: '#ff3b30' },
    layout: (p, W, H) => [
      { kind: 'rect', x: 0, y: 0, w: W, h: H, fill: p.bgColor },
      { kind: 'product', x: W * 0.1, y: H * 0.1, w: W * 0.8, h: H * 0.66, shadow: true },
      { kind: 'circle', cx: W - 210, cy: 210, r: 150, fill: p.accentColor },
      { kind: 'text', text: p.badge, x: W - 210, y: 210, maxW: 250, size: 96, weight: 900, color: '#ffffff', align: 'center', baseline: 'middle' },
      { kind: 'text', text: p.headline, x: 80, y: H - 200, maxW: W * 0.6, size: 64, weight: 800, color: p.textColor },
      { kind: 'text', text: p.price, x: W - 80, y: H - 200, maxW: 360, size: 72, weight: 800, color: p.accentColor, align: 'right' },
    ],
  },
  {
    id: 'new-arrival', name: 'New arrival', w: 1200, h: 1200, fields: ['headline', 'subline', 'cta', 'bgColor', 'accentColor', 'textColor'],
    defaults: { ...COMMON, headline: 'NEW ARRIVAL', subline: 'The spring collection is here', bgColor: '#101014', accentColor: '#ffd23f', textColor: '#ffffff' },
    layout: (p, W, H) => [
      { kind: 'rect', x: 0, y: 0, w: W, h: H, fill: p.bgColor },
      { kind: 'rect', x: 0, y: H * 0.7, w: W, h: H * 0.3, fill: p.accentColor },
      { kind: 'text', text: p.headline, x: W / 2, y: 80, maxW: W - 120, size: 130, weight: 900, color: p.accentColor, align: 'center', track: 6 },
      { kind: 'product', x: W * 0.17, y: H * 0.2, w: W * 0.66, h: H * 0.58, shadow: true },
      { kind: 'text', text: p.subline, x: W / 2, y: H * 0.83, maxW: W - 200, size: 46, weight: 700, color: p.bgColor, align: 'center' },
      { kind: 'text', text: p.cta, x: W / 2, y: H * 0.9, maxW: W - 200, size: 34, weight: 600, color: p.bgColor, align: 'center', alpha: 0.75 },
    ],
  },
];
export const TEMPLATE_BY_ID = Object.fromEntries(TEMPLATES.map(t => [t.id, t]));

/** Element list for a template with params (missing params fall back to the template defaults). */
export function layoutTemplate(tpl, params = {}) {
  const p = { ...tpl.defaults, ...params };
  return tpl.layout(p, tpl.w, tpl.h).filter(e => e.kind !== 'text' && e.kind !== 'pill' || String(e.text ?? '').trim());
}

/** Fit a product of size (pw, ph) into a slot (contain), centred horizontally, standing on the slot's bottom. */
export function fitInSlot(pw, ph, slot) {
  const s = Math.min(slot.w / pw, slot.h / ph), w = pw * s, h = ph * s;
  return { x: slot.x + (slot.w - w) / 2, y: slot.y + slot.h - h, w, h };
}

const fontOf = (e, size) => `${e.weight || 600} ${Math.round(size)}px ${FONT}`;

/** Break text into ≤ maxLines lines that fit maxW, shrinking the font when needed → {lines, size}. */
export function fitText(ctx, e) {
  const maxLines = e.lines || 1, words = String(e.text).split(/\s+/).filter(Boolean);
  for (let size = e.size; size >= 10; size = Math.floor(size * 0.92)) {
    ctx.font = fontOf(e, size);
    const widthOf = t => ctx.measureText(t).width + (e.track || 0) * Math.max(0, t.length - 1);
    const lines = []; let cur = '';
    for (const w of words) { const t = cur ? cur + ' ' + w : w; if (widthOf(t) <= e.maxW || !cur) cur = t; else { lines.push(cur); cur = w; } }
    if (cur) lines.push(cur);
    if (lines.length <= maxLines && lines.every(l => widthOf(l) <= e.maxW)) return { lines, size };
  }
  ctx.font = fontOf(e, 10); return { lines: [String(e.text)], size: 10 };
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r); ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r); ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r); ctx.closePath();
}

function drawText(ctx, e) {
  const { lines, size } = fitText(ctx, e), lh = size * 1.12;
  ctx.font = fontOf(e, size); ctx.fillStyle = e.color; ctx.textBaseline = e.baseline === 'middle' ? 'middle' : 'top';
  const y0 = e.baseline === 'middle' ? e.y - (lines.length - 1) * lh / 2 : e.y;
  lines.forEach((line, k) => {
    const y = y0 + k * lh, tw = ctx.measureText(line).width + (e.track || 0) * Math.max(0, line.length - 1);
    const x = e.align === 'center' ? e.x - tw / 2 : e.align === 'right' ? e.x - tw : e.x;
    ctx.textAlign = 'left';
    if (e.track) { let cx = x; for (const ch of line) { ctx.fillText(ch, cx, y); cx += ctx.measureText(ch).width + e.track; } }
    else ctx.fillText(line, x, y);
    if (e.strike) { ctx.fillRect(x, (e.baseline === 'middle' ? y : y + size * 0.55) - Math.max(2, size / 16) / 2, tw, Math.max(2, size / 16)); }
  });
}

/**
 * Paint a template. product: a CanvasImageSource with width/height (the transparent cut-out) or null.
 * The context must be tpl.w × tpl.h.
 */
export function drawTemplate(ctx, tpl, params, product) {
  const els = layoutTemplate(tpl, params);
  ctx.clearRect(0, 0, tpl.w, tpl.h);
  for (const e of els) {
    ctx.save(); ctx.globalAlpha = e.alpha ?? 1;
    if (e.kind === 'rect') { ctx.fillStyle = e.fill; if (e.r) { roundRect(ctx, e.x, e.y, e.w, e.h, e.r); ctx.fill(); } else ctx.fillRect(e.x, e.y, e.w, e.h); }
    else if (e.kind === 'gradient') {
      const t = (e.angle ?? 90) * Math.PI / 180, cx = e.x + e.w / 2, cy = e.y + e.h / 2, dx = Math.cos(t) * e.w / 2, dy = Math.sin(t) * e.h / 2;
      const g = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy); g.addColorStop(0, e.from); g.addColorStop(1, e.to); ctx.fillStyle = g; ctx.fillRect(e.x, e.y, e.w, e.h);
    } else if (e.kind === 'circle') { ctx.fillStyle = e.fill; ctx.beginPath(); ctx.arc(e.cx, e.cy, e.r, 0, Math.PI * 2); ctx.fill(); }
    else if (e.kind === 'product' && product) {
      const r = fitInSlot(product.width, product.height, e);
      if (e.shadow) { ctx.shadowColor = 'rgba(0,0,0,0.28)'; ctx.shadowBlur = Math.round(r.h * 0.06); ctx.shadowOffsetY = Math.round(r.h * 0.03); }
      ctx.drawImage(product, r.x, r.y, r.w, r.h);
    } else if (e.kind === 'text') drawText(ctx, e);
    else if (e.kind === 'pill') {
      ctx.fillStyle = e.fill; roundRect(ctx, e.x, e.y, e.w, e.h, e.h / 2); ctx.fill();
      drawText(ctx, { kind: 'text', text: e.text, x: e.x + e.w / 2, y: e.y + e.h / 2, maxW: e.w - e.h * 0.6, size: e.size, weight: 700, color: e.color, align: 'center', baseline: 'middle' });
    }
    ctx.restore();
  }
}
