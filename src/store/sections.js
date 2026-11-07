// Section library of the store builder. Each entry:
//   { label, group, pages: page keys it can be added to, defaults: settings, fields: inspector schema,
//     blocks?: list keys whose items can be reordered on the canvas, render(settings, ctx, section) → HTML string }
// The SAME render functions produce the in-app live preview and the exported static site.
//
// Field schema: { key, label, type, options?, min?, max?, step?, item? (sub-fields for type 'list'), itemLabel?, show?(settings) }
//   types: text | textarea | number | color | select | toggle | image | link | collection | list | datetime | blocks
//
// ctx (built by render.js): { store, page, path, root, e(text), t(multiline → <p>), pic(ref, {size, alt, cls, eager, fallback}),
//   img(ref, size) → url, link(target), money(n), products(source, collectionId, limit), card(product, quickAdd, index),
//   icon(name), btn(label, target, cls, editKey), stars(rating, reviews), collectionHref(col), productHref(p), allCollections(),
//   orderedCollections(ids), collectionImage(col), collectionProducts(col), product, collection, checkoutEnabled, overlayHeader,
//   ed(key) → ' data-edit="key"' in the editor (inline text editing; '@field' = a field of the current product),
//   blk(path) → ' data-block="list.index"' in the editor (canvas drag & drop of blocks), people (sample people photos) }

import { frameOf } from './frame.js';

const CONTENT = ['home', 'about', 'contact', 'collection', 'product', 'cart', 'checkout'];
const linkF = (key, label) => ({ key, label, type: 'link' });
const imgF = (key = 'image', label = 'Image') => ({ key, label, type: 'image' });
const txt = (key, label) => ({ key, label, type: 'text' });
const area = (key, label) => ({ key, label, type: 'textarea' });
const toggle = (key, label) => ({ key, label, type: 'toggle' });
const head = (s, ctx, cls = '') => `<div class="sec-head ${cls}">${s.eyebrow ? `<p class="eyebrow"${ctx.ed('eyebrow')}>${ctx.e(s.eyebrow)}</p>` : ''}${s.heading ? `<h2 class="sec-title"${ctx.edh('heading', s.heading)}>${ctx.h(s.heading)}</h2>` : ''}${s.text ? `<div class="sec-sub"${ctx.ed('text')}>${ctx.t(s.text)}</div>` : ''}</div>`;
const hasHead = s => s.heading || s.text || s.eyebrow;
const wrap = (sec, cls, inner, style = '') => `<section class="sec ${cls}" id="${sec.id}"${style ? ` style="${style}"` : ''} data-sid="${sec.id}" data-type="${sec.type}"><div class="wrap" data-reveal>${inner}</div></section>`;
const SOURCE = { key: 'source', label: 'Products', type: 'select', options: [['featured', 'Featured products'], ['all', 'All products'], ['collection', 'From a collection'], ['newest', 'Newest'], ['sale', 'On sale']] };
const COLLECTION = { key: 'collection', label: 'Collection', type: 'collection', show: s => s.source === 'collection' };
const COLS = (o = [2, 3, 4, 5]) => ({ key: 'columns', label: 'Columns', type: 'select', options: o.map(n => [n, String(n)]) });
const EYEBROW = txt('eyebrow', 'Eyebrow');
const HEAD = txt('heading', 'Heading (*stars* = italic accent)');
const STICKER = txt('sticker', 'Rotating sticker text (blank = none)');
/** Points of an n-pointed burst / star polygon in a 100×100 box (inner radius = r × outer). */
export const burst = (n, r) => Array.from({ length: n * 2 }, (_, i) => { const a = Math.PI * i / n - Math.PI / 2, d = i % 2 ? 48 * r : 48; return `${(50 + d * Math.cos(a)).toFixed(1)},${(50 + d * Math.sin(a)).toFixed(1)}`; }).join(' ');
/** Rotating circular text badge (decorative: the words are repeated in nearby copy or are pure flavour). */
export function sticker(text, ctx, sec, cls = '') {
  const t = String(text || '').trim(); if (!t) return '';
  const id = 'stk-' + sec.id + (cls ? '-' + cls : ''), one = t.toUpperCase().replace(/\s*·\s*$/, '') + ' · ';
  let words = one; while (words.length < 30) words += one;
  return `<span class="sticker ${cls}" aria-hidden="true"><svg viewBox="0 0 200 200"><defs><path id="${id}" d="M100,100 m-72,0 a72,72 0 1,1 144,0 a72,72 0 1,1 -144,0"/></defs><circle class="stk-bg" cx="100" cy="100" r="99"/><g class="stk-spin"><text><textPath href="#${id}" textLength="448" lengthAdjust="spacing">${ctx.e(words)}</textPath></text></g><polygon class="stk-star" points="${burst(8, 0.42).split(' ').map(pt => pt.split(',').map(v => (+v * 0.7 + 65).toFixed(1)).join(',')).join(' ')}"/></svg></span>`;
}
export const FEATURE_ICONS = ['truck', 'shield', 'refresh', 'star', 'heart', 'leaf', 'clock', 'chat', 'gift', 'bolt', 'check', 'lock', 'globe', 'award', 'users', 'play', 'sparkle', 'box'];
const STEP_ICONS = [...FEATURE_ICONS, 'search', 'ruler', 'bag', 'camera', 'pin', 'card', 'mail', 'music'];
const SOCIAL = { instagram: ['Instagram', 'camera'], facebook: ['Facebook', 'users'], tiktok: ['TikTok', 'music'], youtube: ['YouTube', 'play'], x: ['X', 'at'], pinterest: ['Pinterest', 'pin'] };
const PAY_ICON = s => /card|visa|credit|debit/i.test(s) ? 'card' : /wallet|pay|apple|google/i.test(s) ? 'wallet' : /bank|transfer|wire/i.test(s) ? 'bank' : /cash|delivery|cod/i.test(s) ? 'cash' : 'lock';
/** Approximate width of the store name in em of the heading font (sizes the giant footer wordmark to fit one line). */
const GLYPH_W = { anton: .44, condensed: .44, impact: .5, archivo: .8, unbounded: .86, grotesk: .78, syne: .7, fredoka: .6, spacemono: .62, mono: .62 };
const wordmarkEm = st => { const n = st.logo.text || st.name, k = GLYPH_W[st.theme.fonts.heading] || .58; return Math.max(3, Math.round(n.length * k * (st.theme.headingCase === 'uppercase' ? 1.18 : 1) * 100) / 100); };
const initials = n => String(n || '?').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();

function btns(ctx, a, al, b, bl, prefix = '') {
  return (a || b) ? `<div class="btns">${a ? ctx.btn(a, al, 'btn-lg', prefix + 'buttonLabel') : ''}${b ? ctx.btn(b, bl, 'btn-lg btn-ghost', prefix + 'button2Label') : ''}</div>` : '';
}

// ---------- product page blocks (product-main.settings.blocks = [{ type, on, ...settings }]) ----------
export const PRODUCT_BLOCKS = {
  breadcrumb: { label: 'Breadcrumb', defaults: {}, fields: [] },
  title: { label: 'Title & rating', defaults: { showRating: true }, fields: [toggle('showRating', 'Show rating summary')] },
  price: { label: 'Price', defaults: { showSaved: true }, fields: [toggle('showSaved', 'Show “you save” amount')] },
  bnpl: { label: 'Pay-later note', defaults: { text: 'or 4 interest-free payments of {amount}' }, fields: [txt('text', 'Text ({amount} = price ÷ 4)')], hint: 'Informational text only — no payment provider is connected.' },
  urgency: { label: 'Low-stock alert', defaults: { threshold: 5 }, fields: [{ key: 'threshold', label: 'Show “Only N left” at or below', type: 'number', min: 1, max: 100 }], hint: 'Uses the real stock of the selected variant.' },
  dispatch: { label: 'Same-day dispatch timer', defaults: { cutoff: 14 }, fields: [{ key: 'cutoff', label: 'Order cut-off hour (0–23)', type: 'number', min: 0, max: 23 }] },
  social: { label: 'Social proof (sample)', defaults: { count: 18, text: '{count} people bought this today', avatars: true, toasts: false, messages: 'Someone in Berlin just bought this|Someone in Lisbon just bought this' }, sample: true,
    fields: [{ key: 'count', label: 'Number', type: 'number', min: 1, max: 9999 }, txt('text', 'Text ({count} = number)'), toggle('avatars', 'Avatar stack'), toggle('toasts', 'Recent-purchase pop-ups'), txt('messages', 'Pop-up messages (separated by |)')],
    hint: 'Sample data. Only turn this on with real numbers from your shop.' },
  variants: { label: 'Variant pickers', defaults: { style: 'auto' }, fields: [{ key: 'style', label: 'Style', type: 'select', options: [['auto', 'Automatic (colours as swatches)'], ['pills', 'Pills'], ['images', 'Image swatches for colours']] }] },
  sizeguide: { label: 'Size guide', defaults: { label: 'Size guide', table: 'Size | Chest (cm) | Waist (cm)\nS | 88–92 | 72–76\nM | 96–100 | 80–84\nL | 104–108 | 88–92\nXL | 112–116 | 96–100' }, fields: [txt('label', 'Link label'), area('table', 'Table (rows on lines, cells separated by |)')] },
  buy: { label: 'Quantity & buy buttons', defaults: { buttonLabel: 'Add to cart', buyNow: true, wishlist: true }, fields: [txt('buttonLabel', 'Button label'), toggle('buyNow', 'Buy now button'), toggle('wishlist', 'Wishlist button')] },
  delivery: { label: 'Delivery estimate', defaults: { min: 2, max: 5, text: 'Estimated delivery' }, fields: [txt('text', 'Label'), { key: 'min', label: 'Earliest (business days)', type: 'number', min: 0, max: 60 }, { key: 'max', label: 'Latest (business days)', type: 'number', min: 0, max: 90 }] },
  trust: { label: 'Trust badges', defaults: { items: 'Secure checkout|Free 30-day returns|2-year warranty' }, fields: [txt('items', 'Badges (separated by |)')] },
  details: { label: 'Accordions', defaults: { materialsTitle: 'Materials & care', shippingTitle: 'Shipping & returns', shipping: 'Ships within 1–2 business days. Free returns within 30 days.' }, fields: [txt('materialsTitle', 'Materials title'), txt('shippingTitle', 'Shipping title'), area('shipping', 'Shipping & returns text')], hint: 'Description and materials come from the product editor.' },
  specs: { label: 'Spec table', defaults: { rows: 'Material | 100% organic cotton\nFit | Relaxed\nOrigin | Portugal' }, fields: [area('rows', 'Rows (label | value)')] },
  text: { label: 'Text', defaults: { text: 'Free exchanges on every order.' }, fields: [area('text', 'Text')] },
};
export const DEFAULT_PRODUCT_BLOCKS = ['breadcrumb', 'title', 'price', 'bnpl', 'variants', 'sizeguide', 'urgency', 'buy', 'dispatch', 'delivery', 'trust', 'details'];
export const productBlocks = (types = DEFAULT_PRODUCT_BLOCKS, over = {}) => types.map(t => ({ type: t, on: !PRODUCT_BLOCKS[t].sample, ...structuredClone(PRODUCT_BLOCKS[t].defaults), ...(over[t] || {}) }));

function productBlock(b, i, p, s, ctx, st) {
  const at = ctx.blk('blocks.' + i), E = k => ctx.ed('blocks.' + i + '.' + k);
  const { v0, ok, price, cmp } = st;
  switch (b.type) {
    case 'breadcrumb': return `<nav class="crumbs pb"${at} aria-label="Breadcrumb"><a href="${ctx.link('home')}">Home</a><span aria-hidden="true">/</span><a href="${ctx.link('collection:all')}">Shop</a><span aria-hidden="true">/</span><span aria-current="page">${ctx.e(p.title)}</span></nav>`;
    case 'title': {
      const r = st.rating;
      return `<div class="pb pb-title"${at}>${p.category ? `<p class="eyebrow">${ctx.e(p.category)}</p>` : ''}<h1 class="ptitle-h"${ctx.ed('@title')}>${ctx.e(p.title)}</h1>${b.showRating && r.avg ? `<a class="rating-link" href="#reviews">${ctx.stars(r.avg, r.count)}<span>${r.count ? `${r.count} review${r.count === 1 ? '' : 's'}` : ''}</span></a>` : ''}</div>`;
    }
    case 'price': return `<p class="pprice pb"${at}><span data-price>${ctx.money(price)}</span> <s class="compare" data-compare${cmp ? '' : ' hidden'}>${cmp ? ctx.money(cmp) : ''}</s>${b.showSaved ? ` <span class="saved" data-saved${cmp ? '' : ' hidden'}>${cmp ? `Save ${ctx.money(cmp - price)} (${Math.round((1 - price / cmp) * 100)}%)` : ''}</span>` : ''}</p>`;
    case 'bnpl': return `<p class="bnpl pb"${at} data-bnpl="${ctx.e(b.text)}">${ctx.e(b.text).replace('{amount}', `<strong>${ctx.money(Math.round(price * 25) / 100)}</strong>`)}</p>`;
    case 'urgency': return `<p class="urgency pb"${at} data-low-stock="${+b.threshold || 5}"${v0 && v0.stock != null && v0.stock > 0 && v0.stock <= b.threshold ? '' : ' hidden'}>${ctx.icon('bolt')}<span>Only <b data-left>${v0?.stock ?? ''}</b> left in stock</span></p>`;
    case 'dispatch': return `<p class="dispatch pb"${at} data-dispatch="${Math.min(23, Math.max(0, +b.cutoff || 0))}">${ctx.icon('truck')}<span>Order today for fast dispatch</span></p>`;
    case 'social': {
      const av = b.avatars ? `<span class="avstack" aria-hidden="true">${ctx.people.slice(0, 4).map(r => ctx.pic(r, { size: 'avatar', alt: '' })).join('')}</span>` : '';
      const msgs = String(b.messages || '').split('|').map(x => x.trim()).filter(Boolean);
      return `<p class="socialp pb"${at}>${av}<span>${ctx.e(String(b.text || '').replace('{count}', b.count))}</span></p>${b.toasts && msgs.length ? `<div class="toasts" data-toasts="${ctx.e(JSON.stringify(msgs))}" aria-live="polite"></div>` : ''}`;
    }
    case 'variants': return p.options.length ? `<div class="pb pb-variants"${at}>${p.options.map((o, k) => {
      const sw = b.style !== 'pills' && ctx.isSwatch(o.name), imgs = sw && b.style === 'images' && p.images.length >= o.values.length;
      return `<fieldset class="opt"><legend>${ctx.e(o.name)}: <span data-opt-value="${k}">${ctx.e(v0 ? v0.options[k] : '')}</span>${k === st.sizeIdx && st.guide ? ` <button type="button" class="link sg-link" data-modal-open="sg-${p.id}">${ctx.icon('ruler')}${ctx.e(st.guide.label || 'Size guide')}</button>` : ''}</legend>
        <div class="pills${sw ? ' swatches' : ''}${imgs ? ' imgswatch' : ''}">${o.values.map((val, vi) => `<label class="pill"><input type="radio" name="opt${k}" value="${ctx.e(val)}"${imgs ? ` data-image="${vi}"` : ''}${v0 && v0.options[k] === val ? ' checked' : ''}><span>${imgs ? ctx.pic(p.images[vi], { size: 'thumb', alt: '', fallback: p.art, ...ctx.pframe(p, vi) }) : sw ? `<i style="background:${ctx.colorOf(val)}"></i>` : ''}${ctx.e(val)}</span></label>`).join('')}</div></fieldset>`;
    }).join('')}${v0 && v0.sku ? `<p class="pmeta"><span>SKU <span data-sku>${ctx.e(v0.sku)}</span></span></p>` : ''}</div>` : '';
    case 'sizeguide': return st.sizeIdx < 0 ? `<p class="pb"${at}><button type="button" class="link sg-link" data-modal-open="sg-${p.id}">${ctx.icon('ruler')}${ctx.e(b.label || 'Size guide')}</button></p>` : `<span class="pb-marker"${at} hidden></span>`;
    case 'buy': return ctx.checkoutEnabled ? `<div class="buy pb"${at}><div class="qty"><button type="button" data-qty-step="-1" aria-label="Decrease quantity">−</button><input type="number" name="qty" value="1" min="1" max="999" aria-label="Quantity" inputmode="numeric"><button type="button" data-qty-step="1" aria-label="Increase quantity">+</button></div>
        <button class="btn btn-lg" type="submit" data-add-to-cart${ok ? '' : ' disabled'}${E('buttonLabel')}>${ctx.e(ok ? b.buttonLabel || 'Add to cart' : 'Sold out')}</button>
        ${b.wishlist ? `<button type="button" class="round light wish-lg" data-wish="${p.id}" aria-pressed="false" aria-label="Save ${ctx.e(p.title)} to wishlist">${ctx.icon('heart')}</button>` : ''}
        ${b.buyNow ? `<button class="btn btn-lg btn-ghost buy-now" type="submit" name="buynow" value="1" data-buy-now${ok ? '' : ' disabled'}>Buy it now</button>` : ''}</div>`
      : `<p class="note pb"${at}>${ctx.store.contact.email ? `To order, <a href="${ctx.link('page:contact')}">contact us</a>.` : 'Online ordering is not available.'}</p>`;
    case 'delivery': return `<p class="delivery pb"${at} data-delivery="${+b.min || 0},${Math.max(+b.min || 0, +b.max || 0)}">${ctx.icon('clock')}<span><span${E('text')}>${ctx.e(b.text || 'Estimated delivery')}</span>: <b data-delivery-dates>${+b.min || 0}–${Math.max(+b.min || 0, +b.max || 0)} business days</b></span></p>`;
    case 'trust': return `<ul class="trust pb"${at}>${String(b.items || '').split('|').map(x => x.trim()).filter(Boolean).map((x, j) => `<li>${ctx.icon(['lock', 'refresh', 'shield', 'truck'][j % 4])}<span>${ctx.e(x)}</span></li>`).join('')}</ul>`;
    case 'details': {
      const rows = [['Description', p.description, '@description'], [b.materialsTitle, p.materials, '@materials'], [b.shippingTitle, b.shipping, 'blocks.' + i + '.shipping']].filter(([t, x]) => t && x);
      return `<div class="acc pb"${at}>${rows.map(([t, x, key], j) => `<details${j ? '' : ' open'}><summary><span>${ctx.e(t)}</span><i aria-hidden="true">${ctx.icon('plus')}</i></summary><div class="prose"${ctx.ed(key)}>${ctx.t(x)}</div></details>`).join('')}</div>`;
    }
    case 'specs': return `<table class="specs pb"${at}><tbody>${String(b.rows || '').split('\n').map(r => r.split('|').map(c => c.trim())).filter(r => r[0]).map(([k, v]) => `<tr><th scope="row">${ctx.e(k)}</th><td>${ctx.e(v || '')}</td></tr>`).join('')}</tbody></table>`;
    case 'text': return `<div class="prose pb"${at}${E('text')}>${ctx.t(b.text)}</div>`;
  }
  return '';
}

function heroHtml(s, ctx, sec) {
  const vars = [`--ov:${(s.overlay || 0) / 100}`, s.background ? `--hero-bg:${s.background}` : '', s.textColor ? `--hero-fg:${s.textColor}` : ''].filter(Boolean).join(';');
      const cls = `hero hl-${s.layout} h-${s.height} al-${s.align}${ctx.overlayHeader && ctx.firstSectionId === sec.id ? ' under-header' : ''}`;
      const open = (extra = '') => `<section class="${cls}" id="${sec.id}" data-sid="${sec.id}" data-type="hero" style="${vars}"${extra}>`;
      const copy = (x, tag = 'h1', p = '') => `<div class="hero-copy">${x.eyebrow ? `<p class="eyebrow"${ctx.ed(p ? 'eyebrow' : 'eyebrow')}>${ctx.e(x.eyebrow)}</p>` : ''}<${tag} class="hero-title"${ctx.edh(p + 'heading', x.heading)}>${ctx.h(x.heading || '')}</${tag}>${x.text ? `<div class="hero-text"${ctx.ed(p + 'text')}>${ctx.t(x.text)}</div>` : ''}${btns(ctx, x.buttonLabel, x.buttonLink || 'collection:all', x.button2Label, x.button2Link, p)}</div>`;
      if (s.layout === 'carousel' || s.layout === 'wordmark') {
        const slides = s.slides && s.slides.length ? s.slides : [{ image: s.image, imagePos: s.imagePos, imageFit: s.imageFit, imageZoom: s.imageZoom, heading: s.heading, text: s.text, buttonLabel: s.buttonLabel, buttonLink: s.buttonLink }];
        const fromSlides = !!(s.slides && s.slides.length), n = slides.length, wm = s.layout === 'wordmark';
        const index = wm && n > 1 ? `<ol class="vindex" role="group" aria-label="Choose slide">${slides.map((_, i) => `<li><button type="button" data-dot="${i}" aria-label="Slide ${i + 1}"${i ? '' : ' aria-current="true"'}>${String(i + 1).padStart(2, '0')}</button></li>`).join('')}</ol>` : '';
        return open(` aria-roledescription="carousel" aria-label="${ctx.e(s.heading || 'Highlights')}" data-carousel${s.autoplay > 0 && n > 1 ? ` data-autoplay="${s.autoplay * 1000}"` : ''}`) +
          (wm ? `<p class="wordmark-big" aria-hidden="true"${ctx.ed('wordmark')}>${ctx.e(s.wordmark || ctx.store.name)}</p>` : '') +
          `<div class="hero-track" data-carousel-track tabindex="0">${slides.map((sl, i) => `<div class="hero-slide" role="group" aria-roledescription="slide" aria-label="${i + 1} of ${n}"${fromSlides ? ctx.blk('slides.' + i) : ''}>
            <div class="hero-media">${sl.image ? ctx.pic(sl.image, { size: 'hero', eager: i === 0, ...ctx.framed(sl, 'image', fromSlides ? 'slides.' + i : '') }) : ''}</div><div class="hero-shade"></div>
            <div class="wrap">${copy({ ...sl, eyebrow: i === 0 ? s.eyebrow : '', button2Label: i === 0 ? s.button2Label : '', button2Link: s.button2Link }, i ? 'h2' : 'h1', fromSlides ? 'slides.' + i + '.' : '')}</div></div>`).join('')}</div>
          ${index}${n > 1 ? `<div class="wrap hero-ctrl">${wm ? '' : `<div class="dots" role="group" aria-label="Choose slide">${slides.map((_, i) => `<button type="button" data-dot="${i}" aria-label="Slide ${i + 1}"${i ? '' : ' aria-current="true"'}></button>`).join('')}</div>`}
          <span class="counter" data-counter>01 / ${String(n).padStart(2, '0')}</span><div class="arrows"><button class="round" type="button" data-carousel-prev aria-label="Previous slide">${ctx.icon('left')}</button><button class="round" type="button" data-carousel-next aria-label="Next slide">${ctx.icon('right')}</button></div></div>` : ''}</section>`;
      }
      if (s.layout === 'split') return open() + `<div class="wrap hero-split"><div class="hero-panel">${copy(s)}</div><div class="hero-media rounded">${s.image ? ctx.pic(s.image, { size: 'wide', eager: true, ...ctx.framed(s) }) : ''}</div></div></section>`;
      if (s.layout === 'image') return open() + `<div class="hero-media">${s.image ? ctx.pic(s.image, { size: 'hero', eager: true, ...ctx.framed(s) }) : ''}</div><div class="hero-shade"></div><div class="wrap">${copy(s)}</div></section>`;
      if (s.layout === 'gradient') return open() + `<div class="hero-orbs" aria-hidden="true"><i></i><i></i><i></i></div><div class="wrap hero-grad">${copy(s)}${s.image ? `<div class="hero-float">${ctx.pic(s.image, { size: 'wide', eager: true, ...ctx.framed(s) })}</div>` : ''}</div></section>`;
      return open() + `<div class="wrap">${copy(s)}</div></section>`;
}

export const SECTIONS = {
  announcement: {
    label: 'Announcement bar', group: 'Layout', pages: [], global: true, defaults: {}, fields: [],
    render: (s, ctx) => {
      const a = ctx.store.announcement;
      if (!a.enabled || !a.text) return '';
      const msgs = a.text.split('|').map(x => x.trim()).filter(Boolean);
      const one = msgs.map(m => `<span>${ctx.e(m)}</span>`).join('<i aria-hidden="true">✦</i>');
      const body = a.style === 'marquee'
        ? `<div class="ann-track" aria-hidden="true"><div class="ann-run">${one}<i>✦</i>${one}<i>✦</i></div><div class="ann-run">${one}<i>✦</i>${one}<i>✦</i></div></div><span class="sr">${ctx.e(msgs.join('. '))}</span>`
        : `<div class="ann-static">${one}</div>`;
      return `<div class="ann ann-${a.style}" data-sid="announcement" data-type="announcement">${a.link ? `<a href="${ctx.link(a.link)}">${body}</a>` : body}</div>`;
    },
  },

  header: {
    label: 'Header', group: 'Layout', pages: [], global: true,
    defaults: { sticky: true, transparent: true, showSearch: true, showWishlist: true, badge: '', searchPlaceholder: 'Search products' },
    fields: [toggle('sticky', 'Sticky header'), toggle('transparent', 'Transparent over the hero'), toggle('showSearch', 'Search button'), toggle('showWishlist', 'Wishlist button'),
      txt('badge', 'Badge (e.g. “Delivery in 15 min”)'), txt('searchPlaceholder', 'Search placeholder (search-first header)')],
    render: (s, ctx, sec) => {
      const st = ctx.store, style = st.theme.headerStyle;
      const logo = st.logo.image ? `<img src="${ctx.img(st.logo.image, 'logo')}" alt="${ctx.e(st.logo.text || st.name)}" style="height:${st.logo.height}px">` : `<span>${ctx.e(st.logo.text || st.name)}</span>`;
      const links = st.navigation.main.map(n => `<a href="${ctx.link(n.target)}"${ctx.isCurrent(n.target) ? ' aria-current="page"' : ''}>${ctx.e(n.label)}</a>`).join('');
      const search = style === 'search';
      const icons = [
        s.showSearch && !search ? `<button type="button" class="hicon" data-search-open aria-label="Search">${ctx.icon('search')}</button>` : '',
        s.showWishlist ? `<button type="button" class="hicon" data-wish-open aria-label="Wishlist">${ctx.icon('heart')}<span class="hcount" data-wish-count hidden>0</span></button>` : '',
        ctx.checkoutEnabled ? `<a class="hicon" href="${ctx.link('cart')}" data-cart-open aria-label="Open cart">${ctx.icon('bag')}<span class="hcount" data-cart-count hidden>0</span></a>` : '',
      ].join('');
      const mid = search ? `<button type="button" class="hsearch" data-search-open aria-label="${ctx.e(s.searchPlaceholder || 'Search products')}">${ctx.icon('search')}<span>${ctx.e(s.searchPlaceholder || 'Search products')}</span></button>` : `<nav class="nav" aria-label="Main">${links}</nav>`;
      return `<header class="site-header hdr-${style}${s.sticky ? ' sticky' : ''}${ctx.overlayHeader ? ' over' : ''}" data-sid="${sec.id}" data-type="header" data-header><div class="wrap hdr-in">
        <button class="hicon menu-toggle" type="button" aria-label="Open menu" aria-expanded="false" aria-controls="nav-drawer" data-menu-toggle>${ctx.icon('menu')}</button>
        <a class="logo" href="${ctx.link('home')}">${logo}</a>${s.badge ? `<span class="hbadge"${ctx.ed('badge')}>${ctx.icon('bolt')}${ctx.e(s.badge)}</span>` : ''}
        ${mid}
        <div class="hdr-actions">${icons}</div></div>${search ? `<nav class="nav subnav wrap" aria-label="Main">${links}</nav>` : ''}</header>
        <div class="navdrawer" id="nav-drawer" data-navdrawer hidden><div class="drawer-scrim" data-menu-close></div><nav class="navdrawer-panel" aria-label="Menu">
        <div class="drawer-head"><a class="logo" href="${ctx.link('home')}">${ctx.e(st.logo.text || st.name)}</a><button type="button" class="hicon" data-menu-close aria-label="Close menu">${ctx.icon('close')}</button></div>
        <div class="navdrawer-links">${st.navigation.main.map(n => `<a href="${ctx.link(n.target)}">${ctx.e(n.label)}${ctx.icon('arrow')}</a>`).join('')}</div></nav></div>`;
    },
  },

  footer: {
    label: 'Footer', group: 'Layout', pages: [], global: true,
    defaults: { text: 'Thoughtfully made goods, shipped with care.', showSocial: true, showContact: true, payments: '', copyright: '', newsletter: true, dark: false, wordmark: false },
    fields: [area('text', 'About text'), toggle('dark', 'Dark footer'), toggle('wordmark', 'Giant wordmark'), toggle('newsletter', 'Newsletter sign-up'), toggle('showContact', 'Show contact details'), toggle('showSocial', 'Show social links'),
      txt('payments', 'Payment methods shown (comma separated)'), txt('copyright', 'Copyright line')],
    render: (s, ctx, sec) => {
      const st = ctx.store, c = st.contact;
      const menu = st.navigation.footer.length ? `<div><h3>Shop</h3><ul>${st.navigation.footer.map(n => `<li><a href="${ctx.link(n.target)}">${ctx.e(n.label)}</a></li>`).join('')}</ul></div>` : '';
      const contact = s.showContact && (c.email || c.phone || c.address) ? `<div><h3>Help</h3><ul>${c.email ? `<li><a href="mailto:${ctx.e(c.email)}">${ctx.e(c.email)}</a></li>` : ''}${c.phone ? `<li><a href="tel:${ctx.e(c.phone.replace(/[^\d+]/g, ''))}">${ctx.e(c.phone)}</a></li>` : ''}${c.address ? `<li>${ctx.e(c.address)}</li>` : ''}<li><a href="${ctx.link('page:contact')}">Contact us</a></li></ul></div>` : '';
      const soc = Object.entries(st.social).filter(([, u]) => u);
      const social = s.showSocial && soc.length ? `<ul class="social">${soc.map(([k, u]) => `<li><a href="${ctx.e(u)}" rel="noopener" target="_blank" aria-label="${SOCIAL[k][0]}" title="${SOCIAL[k][0]}">${ctx.icon(SOCIAL[k][1])}</a></li>`).join('')}</ul>` : '';
      const to = c.email || st.checkout.email;
      const nl = s.newsletter && to ? `<div class="ft-nl"><h3>Stay in the loop</h3><form class="nl-mini" data-mailto-form="${ctx.e(to)}" data-subject="Newsletter sign-up"><label class="sr" for="fnl-${sec.id}">Email address</label><input id="fnl-${sec.id}" type="email" name="email" required placeholder="Email address" autocomplete="email"><button type="submit" aria-label="Subscribe">${ctx.icon('arrow')}</button></form></div>` : '';
      const pays = String(s.payments || '').split(',').map(x => x.trim()).filter(Boolean);
      return `<footer class="site-footer${s.dark ? ' ft-dark' : ''}" data-sid="${sec.id}" data-type="footer"><div class="wrap"><div class="ft-grid">
        <div class="ft-brand"><a class="logo" href="${ctx.link('home')}">${ctx.e(st.logo.text || st.name)}</a>${s.text ? `<p${ctx.ed('text')}>${ctx.e(s.text)}</p>` : ''}${social}</div>${menu}${contact}${nl}</div>
        <div class="ft-bottom"><p>${ctx.e(s.copyright || `© ${new Date().getFullYear()} ${st.name}`)}</p>${pays.length ? `<ul class="pays" aria-label="Payment methods">${pays.map(p => `<li title="${ctx.e(p)}">${ctx.icon(PAY_ICON(p))}<span>${ctx.e(p)}</span></li>`).join('')}</ul>` : ''}</div>${s.wordmark ? `<p class="ft-wordmark" aria-hidden="true" style="--wl:${wordmarkEm(st)}">${ctx.e(st.logo.text || st.name)}</p>` : ''}</div></footer>`;
    },
  },

  hero: {
    label: 'Hero', group: 'Intro', pages: CONTENT, blocks: ['slides'],
    defaults: { layout: 'image', eyebrow: '', heading: 'Made for everyday', text: 'Discover our latest collection.', buttonLabel: 'Shop now', buttonLink: 'collection:all', button2Label: '', button2Link: 'page:about', image: null, slides: [], align: 'left', height: 'large', overlay: 35, background: '', textColor: '', autoplay: 6, wordmark: '', sticker: '' },
    fields: [
      { key: 'layout', label: 'Layout', type: 'select', options: [['image', 'Full-bleed photo'], ['carousel', 'Photo carousel'], ['wordmark', 'Giant wordmark + numbered slides'], ['split', 'Split with photo'], ['gradient', 'Moving gradient'], ['text', 'Big type only']] },
      { ...txt('wordmark', 'Wordmark (blank = store name)'), show: s => s.layout === 'wordmark' },
      EYEBROW, txt('heading', 'Headline'), area('text', 'Text'),
      txt('buttonLabel', 'Button label'), linkF('buttonLink', 'Button link'), txt('button2Label', 'Second button label'), linkF('button2Link', 'Second button link'),
      { ...imgF(), show: s => !['carousel', 'wordmark', 'text'].includes(s.layout) },
      { key: 'slides', label: 'Slides', type: 'list', itemLabel: 'Slide', show: s => s.layout === 'carousel' || s.layout === 'wordmark', item: [imgF(), txt('heading', 'Headline'), txt('text', 'Text'), txt('buttonLabel', 'Button label'), linkF('buttonLink', 'Button link')] },
      { key: 'autoplay', label: 'Autoplay (seconds, 0 = off)', type: 'number', min: 0, max: 20, show: s => s.layout === 'carousel' || s.layout === 'wordmark' },
      { key: 'align', label: 'Alignment', type: 'select', options: [['left', 'Left'], ['center', 'Center']] },
      { key: 'height', label: 'Height', type: 'select', options: [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large'], ['full', 'Full screen']] },
      { key: 'overlay', label: 'Photo shade (%)', type: 'number', min: 0, max: 85, show: s => ['image', 'carousel', 'wordmark'].includes(s.layout) },
      { key: 'background', label: 'Background colour', type: 'color' }, { key: 'textColor', label: 'Text colour', type: 'color' }, STICKER,
    ],
    render: (s, ctx, sec) => heroHtml(s, ctx, sec).replace(/<\/section>$/, sticker(s.sticker, ctx, sec, 'hero-stk') + '</section>'),
  },


  marquee: {
    label: 'Scrolling text', group: 'Intro', pages: CONTENT,
    defaults: { text: 'New season | Free shipping | Easy returns | Made to last', style: 'solid', speed: 30, separator: '✦', tilt: false, background: '', textColor: '' },
    fields: [txt('text', 'Words (separated by |)'), { key: 'style', label: 'Style', type: 'select', options: [['solid', 'Solid'], ['outline', 'Outline'], ['accent', 'Accent band'], ['ticker', 'Slim ticker band']] }, { key: 'speed', label: 'Seconds per loop', type: 'number', min: 8, max: 120 },
      { key: 'separator', label: 'Separator', type: 'select', options: [['✦', '✦ Sparkle'], ['★', '★ Star'], ['●', '● Dot'], ['✺', '✺ Burst'], ['→', '→ Arrow'], ['/', '/ Slash']] }, toggle('tilt', 'Tilted band'),
      { key: 'background', label: 'Band colour', type: 'color' }, { key: 'textColor', label: 'Text colour', type: 'color' }],
    render: (s, ctx, sec) => {
      const words = String(s.text || '').split('|').map(x => x.trim()).filter(Boolean);
      const run = words.map(w => `<span>${ctx.e(w)}</span><i aria-hidden="true">${ctx.e(s.separator || '✦')}</i>`).join('');
      const vars = [`--speed:${s.speed || 30}s`, s.background ? `--mq-bg:${s.background}` : '', s.textColor ? `--mq-fg:${s.textColor}` : ''].filter(Boolean).join(';');
      return `<section class="marquee mq-${s.style}${s.tilt ? ' mq-tilt' : ''}${s.background ? ' mq-bg' : ''}" id="${sec.id}" data-sid="${sec.id}" data-type="marquee" style="${vars}"><div class="mq-track" aria-hidden="true"><div class="mq-run">${run}${run}</div><div class="mq-run">${run}${run}</div></div><p class="sr">${ctx.e(words.join(', '))}</p></section>`;
    },
  },

  'social-proof': {
    label: 'Social proof strip', group: 'Social proof', pages: CONTENT,
    defaults: { text: 'Loved by 25,000+ customers', rating: 4.8, avatars: [], align: 'center' },
    fields: [txt('text', 'Text'), { key: 'rating', label: 'Rating shown (0 = hide)', type: 'number', min: 0, max: 5, step: 0.1 }, { key: 'avatars', label: 'Avatars', type: 'list', itemLabel: 'Avatar', item: [imgF()] }, { key: 'align', label: 'Alignment', type: 'select', options: [['left', 'Left'], ['center', 'Center']] }],
    render: (s, ctx, sec) => {
      const av = (s.avatars || []).map((a, i) => [a, i]).filter(([a]) => a && a.image);
      return wrap(sec, `sproof al-${s.align}`, `<div class="sproof-in">${av.length ? `<span class="avstack lg">${av.slice(0, 5).map(([a, i]) => ctx.pic(a.image, { size: 'avatar', alt: '', ...ctx.framed(a, 'image', 'avatars.' + i) })).join('')}</span>` : ''}<div>${s.rating ? ctx.stars(s.rating, 0) : ''}<p${ctx.ed('text')}>${ctx.e(s.text)}</p></div></div>`);
    },
  },

  'featured-products': {
    label: 'Featured products', group: 'Products', pages: CONTENT,
    defaults: { eyebrow: '', heading: 'Best sellers', text: '', source: 'featured', collection: '', limit: 8, columns: 4, showQuickAdd: true, buttonLabel: 'View all', buttonLink: 'collection:all' },
    fields: [EYEBROW, txt('heading', 'Heading'), area('text', 'Text'), SOURCE, COLLECTION, { key: 'limit', label: 'Products shown', type: 'number', min: 1, max: 24 }, COLS(),
      toggle('showQuickAdd', 'Quick add buttons'), txt('buttonLabel', 'Button label'), linkF('buttonLink', 'Button link')],
    render: (s, ctx, sec) => {
      let ps = ctx.products(s.source, s.collection, s.limit);
      if (ps.length > s.columns && ps.length % s.columns) ps = ps.slice(0, ps.length - ps.length % s.columns); // no orphan row
      return wrap(sec, 'featured', `<div class="sec-head row">${head(s, ctx, 'flat')}${s.buttonLabel ? `<a class="more" href="${ctx.link(s.buttonLink)}"><span${ctx.ed('buttonLabel')}>${ctx.e(s.buttonLabel)}</span>${ctx.icon('arrow')}</a>` : ''}</div>${ps.length ? `<div class="grid pgrid cols-${s.columns}">${ps.map((p, i) => ctx.card(p, s.showQuickAdd, i)).join('')}</div>` : '<p class="empty">No products to show yet.</p>'}`);
    },
  },

  'product-carousel': {
    label: 'Product carousel', group: 'Products', pages: CONTENT,
    defaults: { eyebrow: '', heading: 'New arrivals', source: 'newest', collection: '', limit: 10 },
    fields: [EYEBROW, txt('heading', 'Heading'), SOURCE, COLLECTION, { key: 'limit', label: 'Products shown', type: 'number', min: 2, max: 24 }],
    render: (s, ctx, sec) => {
      const ps = ctx.products(s.source, s.collection, s.limit).filter(p => !ctx.product || p.id !== ctx.product.id);
      return ps.length ? wrap(sec, 'pcarousel', `<div class="sec-head row">${head(s, ctx, 'flat')}<div class="arrows"><button class="round light" type="button" data-carousel-prev aria-label="Scroll back">${ctx.icon('left')}</button><button class="round" type="button" data-carousel-next aria-label="Scroll forward">${ctx.icon('right')}</button></div></div>
        <div class="ptrack" data-carousel-track tabindex="0" aria-label="${ctx.e(s.heading || 'Products')}">${ps.map((p, i) => ctx.card(p, true, i)).join('')}</div>`) : '';
    },
  },

  'collection-list': {
    label: 'Category cards', group: 'Products', pages: CONTENT, blocks: ['collections'],
    defaults: { eyebrow: '', heading: 'Shop by category', collections: [], columns: 4, style: 'tall' },
    fields: [EYEBROW, txt('heading', 'Heading'), COLS([2, 3, 4]), { key: 'style', label: 'Card shape', type: 'select', options: [['tall', 'Tall'], ['square', 'Square'], ['wide', 'Wide']] }],
    render: (s, ctx, sec) => {
      const cols = ctx.orderedCollections(s.collections);
      return wrap(sec, 'clist', `${hasHead(s) ? head(s, ctx) : ''}<div class="grid cols-${s.columns} cc-${s.style}">${cols.map((c, i) => {
        const im = c.image || ctx.collectionImage(c), n = ctx.collectionProducts(c).length;
        return `<a class="ccard" href="${ctx.collectionHref(c)}"${ctx.blk('collections.' + i)}>${im ? ctx.pic(im, { size: 'card', alt: '', ...(c.image ? { frame: frameOf(c), fr: 'c:' + c.id } : {}) }) : ''}<span class="ccard-label"><span><b>${ctx.e(c.title)}</b><small>${n} ${n === 1 ? 'product' : 'products'}</small></span><span class="round sm">${ctx.icon('arrow')}</span></span></a>`;
      }).join('')}</div>`);
    },
  },

  'image-text': {
    label: 'Editorial image with text', group: 'Content', pages: CONTENT,
    defaults: { image: null, eyebrow: '', heading: 'Our story', text: 'Tell customers what makes your products special.', buttonLabel: '', buttonLink: 'page:about', imageSide: 'left', layout: 'split' },
    fields: [imgF(), EYEBROW, txt('heading', 'Heading'), area('text', 'Text'), txt('buttonLabel', 'Button label'), linkF('buttonLink', 'Button link'),
      { key: 'imageSide', label: 'Image side', type: 'select', options: [['left', 'Left'], ['right', 'Right']] }, { key: 'layout', label: 'Layout', type: 'select', options: [['split', 'Side by side'], ['overlap', 'Overlapping card'], ['full', 'Full-width photo']] }],
    render: (s, ctx, sec) => wrap(sec, `imgtext it-${s.layout}`, `<div class="split ${s.imageSide === 'right' ? 'rev' : ''}"><div class="split-media">${s.image ? ctx.pic(s.image, { size: 'wide', ...ctx.framed(s) }) : ''}</div>
      <div class="split-copy">${s.eyebrow ? `<p class="eyebrow"${ctx.ed('eyebrow')}>${ctx.e(s.eyebrow)}</p>` : ''}<h2 class="sec-title"${ctx.edh('heading', s.heading)}>${ctx.h(s.heading)}</h2><div class="prose"${ctx.ed('text')}>${ctx.t(s.text)}</div>${s.buttonLabel ? `<div class="btns">${ctx.btn(s.buttonLabel, s.buttonLink, 'btn-lg', 'buttonLabel')}</div>` : ''}</div></div>`),
  },

  bento: {
    label: 'Bento grid', group: 'Content', pages: CONTENT, blocks: ['items'],
    defaults: { eyebrow: '', heading: 'Why people love us', items: [{ image: null, title: 'Made to last', text: 'Quality you can feel.', link: 'collection:all' }, { image: null, title: 'Free shipping', text: 'On every order over 50.', link: '' }, { image: null, title: 'Easy returns', text: '30 days, no questions.', link: '' }] },
    fields: [EYEBROW, txt('heading', 'Heading'), { key: 'items', label: 'Tiles', type: 'list', itemLabel: 'Tile', item: [imgF(), txt('title', 'Title'), area('text', 'Text'), linkF('link', 'Link')] }],
    render: (s, ctx, sec) => wrap(sec, 'bento', `${hasHead(s) ? head(s, ctx) : ''}<div class="bento-grid n${Math.min(5, (s.items || []).length)}">${(s.items || []).map((it, i) => {
      const inner = `${it.image ? ctx.pic(it.image, { size: i === 0 ? 'wide' : 'card', ...ctx.framed(it, 'image', 'items.' + i) }) : ''}<div class="bento-copy"><h3${ctx.ed(`items.${i}.title`)}>${ctx.e(it.title)}</h3>${it.text ? `<p${ctx.ed(`items.${i}.text`)}>${ctx.e(it.text)}</p>` : ''}</div>${it.link ? `<span class="round sm">${ctx.icon('arrow')}</span>` : ''}`;
      const cls = `tile${it.image ? ' has-img' : ''} t${i}`;
      return it.link ? `<a class="${cls}" href="${ctx.link(it.link)}"${ctx.blk('items.' + i)}>${inner}</a>` : `<div class="${cls}"${ctx.blk('items.' + i)}>${inner}</div>`;
    }).join('')}</div>`),
  },

  features: {
    label: 'Features / benefits', group: 'Content', pages: CONTENT, blocks: ['items'],
    defaults: { heading: '', columns: 3, style: 'cards', items: [{ icon: 'truck', title: 'Free shipping', text: 'On orders over 50.' }, { icon: 'refresh', title: '30-day returns', text: 'Change your mind? No problem.' }, { icon: 'shield', title: 'Secure checkout', text: 'Your details stay private.' }] },
    fields: [txt('heading', 'Heading'), COLS([2, 3, 4]), { key: 'style', label: 'Style', type: 'select', options: [['cards', 'Cards'], ['strip', 'Compact strip']] },
      { key: 'items', label: 'Features', type: 'list', itemLabel: 'Feature', item: [{ key: 'icon', label: 'Icon', type: 'select', options: FEATURE_ICONS.map(i => [i, i[0].toUpperCase() + i.slice(1)]) }, txt('title', 'Title'), area('text', 'Text')] }],
    render: (s, ctx, sec) => wrap(sec, `features f-${s.style}`, `${s.heading ? `<div class="sec-head"><h2 class="sec-title"${ctx.ed('heading')}>${ctx.e(s.heading)}</h2></div>` : ''}<div class="grid cols-${s.columns}">${(s.items || []).map((it, i) => `<div class="feature"${ctx.blk('items.' + i)}><span class="f-icon" aria-hidden="true">${ctx.icon(it.icon)}</span><div><h3${ctx.ed(`items.${i}.title`)}>${ctx.e(it.title)}</h3><p${ctx.ed(`items.${i}.text`)}>${ctx.e(it.text)}</p></div></div>`).join('')}</div>`),
  },

  testimonials: {
    label: 'Testimonials', group: 'Social proof', pages: CONTENT, blocks: ['items'],
    defaults: { eyebrow: 'Reviews', heading: 'What customers say', style: 'cards', rating: '4.9', ratingText: 'Average from 2,000+ reviews', items: [{ quote: 'Exactly as described and beautifully packed.', name: 'Sam R.', role: 'Verified buyer', avatar: null }, { quote: 'Fast delivery and great quality. Ordering again!', name: 'Priya K.', role: 'Verified buyer', avatar: null }, { quote: 'My new favourite shop.', name: 'Leo M.', role: 'Verified buyer', avatar: null }] },
    fields: [EYEBROW, HEAD, { key: 'style', label: 'Style', type: 'select', options: [['cards', 'Cards'], ['big', 'Big quotes with a rating summary']] },
      { ...txt('rating', 'Rating shown (blank = hide)'), show: s => s.style === 'big' }, { ...txt('ratingText', 'Rating note'), show: s => s.style === 'big' },
      { key: 'items', label: 'Testimonials', type: 'list', itemLabel: 'Testimonial', item: [area('quote', 'Quote'), txt('name', 'Name'), txt('role', 'Role'), imgF('avatar', 'Photo')] }],
    render: (s, ctx, sec) => {
      const big = s.style === 'big', items = s.items || [];
      const summary = big ? `<div class="tq-sum">${head(s, ctx, 'flat')}${s.rating ? `<p class="tq-rate"><b${ctx.ed('rating')}>${ctx.e(s.rating)}</b><span>${ctx.stars(Math.min(5, Math.max(0, parseFloat(s.rating) || 5)), 0)}<small${ctx.ed('ratingText')}>${ctx.e(s.ratingText || '')}</small></span></p>` : ''}${items.some(it => it.avatar) ? `<span class="avstack lg">${items.map((it, i) => it.avatar ? ctx.pic(it.avatar, { size: 'avatar', alt: '', ...ctx.framed(it, 'avatar', 'items.' + i) }) : '').join('')}</span>` : ''}</div>` : head(s, ctx, 'center');
      return wrap(sec, `testimonials${big ? ' tq-big' : ''}`, `${big ? '<div class="tq-wrap">' : ''}${summary}<div class="grid cols-${big ? Math.min(2, Math.max(1, items.length)) : 3}">${items.map((it, i) => `<figure class="quote"${ctx.blk('items.' + i)}>${big ? '<span class="tq-mark" aria-hidden="true">“</span>' : ''}<div class="stars" role="img" aria-label="5 out of 5 stars">${ctx.icon('star-fill').repeat(5)}</div><blockquote${ctx.ed(`items.${i}.quote`)}>${ctx.e(it.quote)}</blockquote>
      <figcaption>${it.avatar ? ctx.pic(it.avatar, { size: 'avatar', cls: 'avatar', alt: '', ...ctx.framed(it, 'avatar', 'items.' + i) }) : `<span class="avatar initials" aria-hidden="true">${ctx.e(initials(it.name))}</span>`}<span><strong${ctx.ed(`items.${i}.name`)}>${ctx.e(it.name)}</strong>${it.role ? `<small${ctx.ed(`items.${i}.role`)}>${ctx.e(it.role)}</small>` : ''}</span></figcaption></figure>`).join('')}</div>${big ? '</div>' : ''}`);
    },
  },

  logos: {
    label: 'Logos strip', group: 'Social proof', pages: CONTENT, blocks: ['items'],
    defaults: { heading: 'As featured in', items: [{ name: 'Northwind' }, { name: 'Lumen Daily' }, { name: 'The Habit' }, { name: 'Field Notes' }, { name: 'Kinfolk & Co' }] },
    fields: [txt('heading', 'Heading'), { key: 'items', label: 'Logos', type: 'list', itemLabel: 'Logo', item: [txt('name', 'Name'), imgF('image', 'Logo image')] }],
    render: (s, ctx, sec) => wrap(sec, 'logos', `${s.heading ? `<p class="logos-title"${ctx.ed('heading')}>${ctx.e(s.heading)}</p>` : ''}<ul class="logo-row">${(s.items || []).map((it, i) => `<li${ctx.blk('items.' + i)}>${it.image ? `<img src="${ctx.img(it.image, 'logo')}" alt="${ctx.e(it.name)}">` : `<span class="wordmark wm${i % 4}"${ctx.ed(`items.${i}.name`)}>${ctx.e(it.name)}</span>`}</li>`).join('')}</ul>`),
  },

  faq: {
    label: 'FAQ', group: 'Content', pages: CONTENT, blocks: ['items'],
    defaults: { eyebrow: 'FAQ', heading: 'Questions, answered', text: '', items: [{ q: 'How long does shipping take?', a: 'Orders ship within 2 business days.' }, { q: 'Can I return an item?', a: 'Yes, within 30 days of delivery.' }] },
    fields: [EYEBROW, txt('heading', 'Heading'), area('text', 'Text'), { key: 'items', label: 'Questions', type: 'list', itemLabel: 'Question', item: [txt('q', 'Question'), area('a', 'Answer')] }],
    render: (s, ctx, sec) => wrap(sec, 'faq', `<div class="faq-grid">${head(s, ctx)}<div class="faq-list">${(s.items || []).map((it, i) => `<details${ctx.blk('items.' + i)}><summary><span${ctx.ed(`items.${i}.q`)}>${ctx.e(it.q)}</span><i aria-hidden="true">${ctx.icon('plus')}</i></summary><div class="prose"${ctx.ed(`items.${i}.a`)}>${ctx.t(it.a)}</div></details>`).join('')}</div></div>`),
  },

  newsletter: {
    label: 'Newsletter', group: 'Content', pages: CONTENT,
    defaults: { eyebrow: '', heading: 'Join the list', text: 'New arrivals and offers, once a month. No spam.', buttonLabel: 'Subscribe', action: '', image: null },
    fields: [EYEBROW, txt('heading', 'Heading'), area('text', 'Text'), txt('buttonLabel', 'Button label'), imgF('image', 'Background photo'), txt('action', 'Form action URL (blank = email to the store)')],
    render: (s, ctx, sec) => {
      const action = s.action && /^https?:\/\//.test(s.action) ? `action="${ctx.e(s.action)}" method="post"` : `data-mailto-form="${ctx.e(ctx.store.contact.email || ctx.store.checkout.email)}" data-subject="Newsletter sign-up"`;
      return wrap(sec, `newsletter${s.image ? ' nl-photo' : ''}`, `<div class="nl-card">${s.image ? `<div class="nl-media">${ctx.pic(s.image, { size: 'hero', ...ctx.framed(s) })}</div>` : ''}<div class="nl-body">${head(s, ctx, 'center')}
        <form class="nl-form" ${action}><label class="sr" for="nl-${sec.id}">Email address</label><input id="nl-${sec.id}" type="email" name="email" required placeholder="you@example.com" autocomplete="email"><button class="btn" type="submit"${ctx.ed('buttonLabel')}>${ctx.e(s.buttonLabel || 'Subscribe')}</button></form></div></div>`);
    },
  },

  'rich-text': {
    label: 'Statement text', group: 'Content', pages: CONTENT,
    defaults: { eyebrow: '', heading: 'Our promise', text: 'We design products to last, source responsibly and stand behind everything we sell.', align: 'center', size: 'large' },
    fields: [EYEBROW, txt('heading', 'Heading'), area('text', 'Text'), { key: 'align', label: 'Alignment', type: 'select', options: [['left', 'Left'], ['center', 'Center']] }, { key: 'size', label: 'Text size', type: 'select', options: [['regular', 'Regular'], ['large', 'Large statement']] }],
    render: (s, ctx, sec) => wrap(sec, `richtext al-${s.align} rt-${s.size}`, `${s.eyebrow ? `<p class="eyebrow"${ctx.ed('eyebrow')}>${ctx.e(s.eyebrow)}</p>` : ''}${s.heading ? `<h2 class="sec-title"${ctx.edh('heading', s.heading)}>${ctx.h(s.heading)}</h2>` : ''}<div class="prose"${ctx.ed('text')}>${ctx.t(s.text)}</div>`),
  },

  banner: {
    label: 'Banner / CTA', group: 'Intro', pages: CONTENT,
    defaults: { eyebrow: '', heading: 'Free shipping this week', text: 'On every order, no minimum.', buttonLabel: 'Shop now', buttonLink: 'collection:all', image: null, style: 'solid', sticker: '' },
    fields: [EYEBROW, txt('heading', 'Heading'), area('text', 'Text'), txt('buttonLabel', 'Button label'), linkF('buttonLink', 'Button link'),
      { key: 'style', label: 'Style', type: 'select', options: [['solid', 'Accent colour'], ['image', 'Background photo'], ['outline', 'Outline']] }, { ...imgF(), show: s => s.style === 'image' }, STICKER],
    render: (s, ctx, sec) => wrap(sec, `banner b-${s.style}`, `<div class="banner-in">${s.style === 'image' && s.image ? `<div class="banner-media">${ctx.pic(s.image, { size: 'hero', ...ctx.framed(s) })}</div>` : ''}<div class="banner-copy">${s.eyebrow ? `<p class="eyebrow"${ctx.ed('eyebrow')}>${ctx.e(s.eyebrow)}</p>` : ''}<h2 class="sec-title"${ctx.edh('heading', s.heading)}>${ctx.h(s.heading)}</h2>${s.text ? `<div class="sec-sub"${ctx.ed('text')}>${ctx.t(s.text)}</div>` : ''}${s.buttonLabel ? ctx.btn(s.buttonLabel, s.buttonLink, 'btn-lg btn-inv', 'buttonLabel') : ''}</div>${sticker(s.sticker, ctx, sec)}</div>`),
  },

  countdown: {
    label: 'Countdown / sale', group: 'Intro', pages: CONTENT,
    defaults: { eyebrow: 'Limited time', heading: 'The sale ends soon', text: 'Up to 30% off selected styles.', endsAt: '', buttonLabel: 'Shop the sale', buttonLink: 'collection:all', image: null },
    fields: [EYEBROW, txt('heading', 'Heading'), area('text', 'Text'), { key: 'endsAt', label: 'Ends at', type: 'datetime' }, txt('buttonLabel', 'Button label'), linkF('buttonLink', 'Button link'), imgF('image', 'Side photo')],
    render: (s, ctx, sec) => {
      const end = s.endsAt || new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 16);
      const unit = (k, l) => `<div><span data-cd="${k}">00</span><small>${l}</small></div>`;
      return wrap(sec, `countdown${s.image ? ' cd-photo' : ''}`, `<div class="cd-card"><div class="cd-copy">${head(s, ctx)}<div class="cd" data-countdown="${ctx.e(end)}" role="timer" aria-label="Time remaining">${unit('d', 'Days')}${unit('h', 'Hours')}${unit('m', 'Min')}${unit('s', 'Sec')}</div>${s.buttonLabel ? `<div class="btns">${ctx.btn(s.buttonLabel, s.buttonLink, 'btn-lg', 'buttonLabel')}</div>` : ''}</div>${s.image ? `<div class="cd-media">${ctx.pic(s.image, { size: 'wide', ...ctx.framed(s) })}</div>` : ''}</div>`);
    },
  },

  'editorial-hero': {
    label: 'Editorial hero (mixed type)', group: 'Intro', pages: CONTENT,
    defaults: { layout: 'split', metaLeft: 'Capsule 001', metaRight: 'New season', eyebrow: '', heading: 'Made for *making*', dot: true, text: 'Everyday pieces with a creative spirit — cut in small runs, built to be worn hard.', buttonLabel: 'Shop the capsule', buttonLink: 'collection:all', button2Label: '', button2Link: 'page:about', image: null, image2: null, shape: 'rect', caption: '', sticker: '', background: '', textColor: '' },
    fields: [{ key: 'layout', label: 'Layout', type: 'select', options: [['split', 'Type left, photo right'], ['stack', 'Huge centred type over a wide photo'], ['collage', 'Type with a tilted photo collage']] },
      txt('metaLeft', 'Small label, left'), txt('metaRight', 'Small label, right'), EYEBROW, HEAD, toggle('dot', 'Accent dot after the headline'), area('text', 'Text'),
      txt('buttonLabel', 'Button label'), linkF('buttonLink', 'Button link'), txt('button2Label', 'Second button label'), linkF('button2Link', 'Second button link'),
      imgF('image', 'Main photo'), { ...imgF('image2', 'Second photo'), show: s => s.layout !== 'stack' }, txt('caption', 'Photo caption'),
      { key: 'shape', label: 'Photo shape', type: 'select', options: [['rect', 'Rounded rectangle'], ['arch', 'Arch'], ['blob', 'Organic blob']], show: s => s.layout === 'split' }, STICKER,
      { key: 'background', label: 'Background colour', type: 'color' }, { key: 'textColor', label: 'Text colour', type: 'color' }],
    render: (s, ctx, sec) => {
      const vars = [s.background ? `--eh-bg:${s.background}` : '', s.textColor ? `--eh-fg:${s.textColor}` : ''].filter(Boolean).join(';');
      const meta = s.metaLeft || s.metaRight ? `<div class="eh-meta">${s.metaLeft ? `<span${ctx.ed('metaLeft')}>${ctx.e(s.metaLeft)}</span>` : '<span></span>'}${s.metaRight ? `<span${ctx.ed('metaRight')}>${ctx.e(s.metaRight)}</span>` : ''}</div>` : '';
      const title = `<h1 class="eh-title"><span${ctx.edh('heading', s.heading)}>${ctx.h(s.heading)}</span>${s.dot ? '<i class="eh-dot" aria-hidden="true"></i>' : ''}</h1>`;
      const copy = `<div class="eh-copy">${s.eyebrow ? `<p class="eyebrow"${ctx.ed('eyebrow')}>${ctx.e(s.eyebrow)}</p>` : ''}${title}${s.text ? `<div class="eh-text"${ctx.ed('text')}>${ctx.t(s.text)}</div>` : ''}${btns(ctx, s.buttonLabel, s.buttonLink, s.button2Label, s.button2Link)}</div>`;
      const one = s.image ? `<figure class="eh-fig eh-a">${ctx.pic(s.image, { size: s.layout === 'stack' ? 'hero' : 'wide', eager: true, ...ctx.framed(s, 'image') })}${s.caption ? `<figcaption${ctx.ed('caption')}>${ctx.e(s.caption)}</figcaption>` : ''}</figure>` : '';
      const two = s.image2 && s.layout !== 'stack' ? `<figure class="eh-fig eh-b">${ctx.pic(s.image2, { size: 'card', ...ctx.framed(s, 'image2') })}</figure>` : '';
      const media = one || two || s.sticker ? `<div class="eh-media">${one}${two}${sticker(s.sticker, ctx, sec)}</div>` : '';
      return `<section class="ehero eh-${s.layout}${s.layout === 'split' && s.shape !== 'rect' ? ' eh-sh-' + s.shape : ''}${s.background ? ' eh-tint' : ''}" id="${sec.id}" data-sid="${sec.id}" data-type="editorial-hero"${vars ? ` style="${vars}"` : ''}><div class="wrap">${meta}<div class="eh-grid">${copy}${media}</div></div></section>`;
    },
  },

  rail: {
    label: 'Clothes rail slider', group: 'Products', pages: CONTENT,
    defaults: { eyebrow: 'Capsule 001', heading: 'On the rail', metaRight: '04 objects / one creative spirit', source: 'featured', collection: '', limit: 8, showPrice: true, background: '' },
    fields: [EYEBROW, HEAD, txt('metaRight', 'Small label, right'), SOURCE, COLLECTION, { key: 'limit', label: 'Products shown', type: 'number', min: 2, max: 16 }, toggle('showPrice', 'Show prices'), { key: 'background', label: 'Background colour', type: 'color' }],
    render: (s, ctx, sec) => {
      const ps = ctx.products(s.source, s.collection, s.limit).filter(p => !ctx.product || p.id !== ctx.product.id);
      if (!ps.length) return '';
      const hanger = '<svg class="rail-hanger" viewBox="0 0 120 64" aria-hidden="true"><path d="M60 26V17a8 8 0 1 0-8-8"/><path d="M60 26 6 58h108z"/></svg>';
      const items = ps.map((p, i) => {
        const col = p.options.find(o => ctx.isSwatch(o.name)), sub = col ? col.values.slice(0, 2).join(' / ') : p.category;
        return `<li class="rail-item"><a class="rail-hang" href="${ctx.productHref(p)}" aria-label="${ctx.e(p.title)}">${hanger}<span class="rail-img">${p.images[0] ? ctx.pic(p.images[0], { size: 'card', alt: '', fallback: p.art, ...ctx.pframe(p, 0) }) : ctx.pic(p.art, { alt: '' })}</span></a>
          <p class="rail-cap"><span class="rail-no">${String(i + 1).padStart(2, '0')}</span><span><a href="${ctx.productHref(p)}">${ctx.e(p.title)}</a>${sub ? ` <small>— ${ctx.e(sub)}</small>` : ''}${s.showPrice ? `<b>${ctx.money(p.price)}</b>` : ''}</span></p></li>`;
      }).join('');
      return `<section class="sec rail" id="${sec.id}" data-sid="${sec.id}" data-type="rail"${s.background ? ` style="--rail-bg:${s.background}"` : ''}><div class="wrap" data-reveal>
        <div class="rail-head"><div>${s.eyebrow ? `<p class="meta"${ctx.ed('eyebrow')}>${ctx.e(s.eyebrow)}</p>` : ''}${s.heading ? `<h2 class="sec-title"${ctx.edh('heading', s.heading)}>${ctx.h(s.heading)}</h2>` : ''}</div>
        <div class="rail-side">${s.metaRight ? `<p class="meta"${ctx.ed('metaRight')}>${ctx.e(s.metaRight)}</p>` : ''}<div class="arrows"><button class="round light" type="button" data-carousel-prev aria-label="Previous items">${ctx.icon('left')}</button><button class="round" type="button" data-carousel-next aria-label="Next items">${ctx.icon('right')}</button></div></div></div>
        <div class="rail-stage"><div class="rail-bar" aria-hidden="true"></div><ul class="rail-track" data-carousel-track tabindex="0" aria-label="${ctx.e(String(s.heading || 'Products').replace(/\*/g, ''))}">${items}</ul></div></div></section>`;
    },
  },

  polaroids: {
    label: 'Polaroid collage', group: 'Media', pages: CONTENT, blocks: ['items'],
    defaults: { eyebrow: '', heading: 'One piece. *Three moods.*', text: '', background: '', items: [{ image: null, caption: 'Weekday', note: 'Tucked in, sleeves rolled', link: '' }, { image: null, caption: 'Weekend', note: 'Open over a tee', link: '' }, { image: null, caption: 'After dark', note: 'Buttoned to the top', link: '' }] },
    fields: [EYEBROW, HEAD, area('text', 'Text'), { key: 'background', label: 'Background colour', type: 'color' },
      { key: 'items', label: 'Photos', type: 'list', itemLabel: 'Photo', item: [imgF(), txt('caption', 'Caption'), txt('note', 'Small note'), linkF('link', 'Link')] }],
    render: (s, ctx, sec) => {
      const items = (s.items || []).map((it, i) => [it, i]).filter(([it]) => it.image || ctx.editor);
      return wrap(sec, `polaroids n${Math.min(5, items.length)}`, `${hasHead(s) ? head(s, ctx, 'center') : ''}<div class="pol-board">${items.map(([it, i]) => {
        const inner = `<span class="pol-img">${it.image ? ctx.pic(it.image, { size: 'card', alt: it.caption || '', ...ctx.framed(it, 'image', 'items.' + i) }) : ''}</span><figcaption><b${ctx.ed(`items.${i}.caption`)}>${ctx.e(it.caption || '')}</b>${it.note ? `<small${ctx.ed(`items.${i}.note`)}>${ctx.e(it.note)}</small>` : ''}</figcaption>`;
        return `<figure class="pol p${i % 5}"${ctx.blk('items.' + i)}>${it.link ? `<a href="${ctx.link(it.link)}">${inner}</a>` : inner}</figure>`;
      }).join('')}</div>`, s.background ? `--sec-bg:${s.background}` : '');
    },
  },

  steps: {
    label: 'Numbered steps', group: 'Content', pages: CONTENT, blocks: ['items'],
    defaults: { eyebrow: 'How it works', heading: 'From cart to *wardrobe*', text: '', style: 'line', background: '', items: [{ icon: 'search', title: 'Pick your favourite', text: 'Browse the collection.' }, { icon: 'ruler', title: 'Choose your fit', text: 'Use the size guide.' }, { icon: 'bag', title: 'Tap to order', text: 'Checkout in a minute.' }, { icon: 'box', title: 'Unbox', text: 'Plastic-free packaging.' }, { icon: 'heart', title: 'Wear on repeat', text: 'Made to last.' }] },
    fields: [EYEBROW, HEAD, area('text', 'Text'), { key: 'style', label: 'Style', type: 'select', options: [['line', 'Timeline with a dashed line'], ['cards', 'Numbered cards']] }, { key: 'background', label: 'Background colour', type: 'color' },
      { key: 'items', label: 'Steps', type: 'list', itemLabel: 'Step', item: [{ key: 'icon', label: 'Icon', type: 'select', options: STEP_ICONS.map(i => [i, i[0].toUpperCase() + i.slice(1)]) }, txt('title', 'Title'), area('text', 'Text')] }],
    render: (s, ctx, sec) => wrap(sec, `steps st-${s.style}`, `${hasHead(s) ? head(s, ctx, 'center') : ''}<ol class="steps-list n${Math.min(6, (s.items || []).length)}">${(s.items || []).map((it, i) => `<li class="step"${ctx.blk('items.' + i)}><span class="step-node"><span class="step-no">${String(i + 1).padStart(2, '0')}</span><span class="step-ico" aria-hidden="true">${ctx.icon(it.icon)}</span></span><h3${ctx.ed(`items.${i}.title`)}>${ctx.e(it.title)}</h3>${it.text ? `<p${ctx.ed(`items.${i}.text`)}>${ctx.e(it.text)}</p>` : ''}</li>`).join('')}</ol>`, s.background ? `--sec-bg:${s.background}` : ''),
  },

  'spec-list': {
    label: 'Spec list with dotted leaders', group: 'Content', pages: CONTENT,
    defaults: { eyebrow: 'The details', heading: 'Soft enough to *live in*', text: '', rows: 'Fabric | 100% organic cotton\nWeight | 180 gsm\nFit | Relaxed, dropped shoulder\nCare | Machine wash 30°\nMade in | Portugal', image: null, imageSide: 'left', buttonLabel: '', buttonLink: 'collection:all', background: '' },
    fields: [EYEBROW, HEAD, area('text', 'Text'), area('rows', 'Rows (label | value, one per line)'), imgF(), { key: 'imageSide', label: 'Photo side', type: 'select', options: [['left', 'Left'], ['right', 'Right']] },
      txt('buttonLabel', 'Button label'), linkF('buttonLink', 'Button link'), { key: 'background', label: 'Background colour', type: 'color' }],
    render: (s, ctx, sec) => {
      const rows = String(s.rows || '').split('\n').map(r => r.split('|').map(c => c.trim())).filter(r => r[0]);
      return wrap(sec, `speclist${s.image ? ' sl-photo' : ''}${s.imageSide === 'right' ? ' rev' : ''}`, `<div class="sl-grid">${s.image ? `<div class="sl-media">${ctx.pic(s.image, { size: 'wide', ...ctx.framed(s) })}</div>` : ''}<div class="sl-body">${head(s, ctx, 'flat')}
        <dl class="sl-rows">${rows.map(([k, v]) => `<div class="sl-row"><dt>${ctx.e(k)}</dt><span class="sl-dots" aria-hidden="true"></span><dd>${ctx.e(v || '')}</dd></div>`).join('')}</dl>${s.buttonLabel ? `<div class="btns">${ctx.btn(s.buttonLabel, s.buttonLink, 'btn-lg', 'buttonLabel')}</div>` : ''}</div></div>`, s.background ? `--sec-bg:${s.background}` : '');
    },
  },

  'drop-countdown': {
    label: 'Limited drop banner', group: 'Intro', pages: CONTENT,
    defaults: { eyebrow: 'Limited collection 02', heading: 'The next drop *lands soon*', text: 'Small run. When it is gone, it is gone.', endsAt: '', buttonLabel: 'Get early access', buttonLink: 'collection:all', image: null, sticker: 'Limited · Drop 02 · Small run', background: '', textColor: '', bursts: true },
    fields: [EYEBROW, HEAD, area('text', 'Text'), { key: 'endsAt', label: 'Counts down to', type: 'datetime' }, txt('buttonLabel', 'Button label'), linkF('buttonLink', 'Button link'), imgF('image', 'Photo'), STICKER,
      toggle('bursts', 'Burst shapes'), { key: 'background', label: 'Background colour', type: 'color' }, { key: 'textColor', label: 'Text colour', type: 'color' }],
    render: (s, ctx, sec) => {
      const end = s.endsAt || new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 16);
      const unit = (k, l) => `<div><span data-cd="${k}">00</span><small>${l}</small></div>`;
      const vars = [s.background ? `--dr-bg:${s.background}` : '', s.textColor ? `--dr-fg:${s.textColor}` : ''].filter(Boolean).join(';');
      const bursts = s.bursts ? `<span class="dr-bursts" aria-hidden="true">${[[12, 0.62], [16, 0.78], [8, 0.5]].map(([n, r], i) => `<svg class="burst b${i}" viewBox="0 0 100 100"><polygon points="${burst(n, r)}"/></svg>`).join('')}</span>` : '';
      return `<section class="sec drop${s.image ? ' dr-photo' : ''}" id="${sec.id}" data-sid="${sec.id}" data-type="drop-countdown"><div class="wrap" data-reveal><div class="dr-card"${vars ? ` style="${vars}"` : ''}>${bursts}
        <div class="dr-copy">${s.eyebrow ? `<p class="dr-tag"${ctx.ed('eyebrow')}>${ctx.e(s.eyebrow)}</p>` : ''}<h2 class="dr-title"${ctx.edh('heading', s.heading)}>${ctx.h(s.heading)}</h2>${s.text ? `<div class="dr-text"${ctx.ed('text')}>${ctx.t(s.text)}</div>` : ''}
        <div class="cd dr-cd" data-countdown="${ctx.e(end)}" role="timer" aria-label="Time remaining">${unit('d', 'Days')}${unit('h', 'Hours')}${unit('m', 'Min')}${unit('s', 'Sec')}</div>${s.buttonLabel ? `<div class="btns">${ctx.btn(s.buttonLabel, s.buttonLink, 'btn-lg', 'buttonLabel')}</div>` : ''}</div>
        ${s.image || s.sticker ? `<div class="dr-media">${s.image ? ctx.pic(s.image, { size: 'wide', ...ctx.framed(s) }) : ''}${sticker(s.sticker, ctx, sec)}</div>` : ''}</div></div></section>`;
    },
  },

  'split-feature': {
    label: 'Colour block feature', group: 'Content', pages: CONTENT, blocks: ['items'],
    defaults: { eyebrow: '', heading: 'Cut for *real life*', text: 'Every detail earns its place.', image: null, imageSide: 'right', shape: 'rect', background: '', textColor: '', sticker: '', buttonLabel: '', buttonLink: 'collection:all', items: [{ icon: 'leaf', title: 'Organic cotton', text: 'Soft from the first wear.' }, { icon: 'refresh', title: 'Easy care', text: 'Wash, hang, wear.' }, { icon: 'award', title: 'Built to last', text: 'Reinforced seams.' }] },
    fields: [EYEBROW, HEAD, area('text', 'Text'), imgF(), { key: 'imageSide', label: 'Photo side', type: 'select', options: [['right', 'Right'], ['left', 'Left']] },
      { key: 'shape', label: 'Photo shape', type: 'select', options: [['rect', 'Rounded rectangle'], ['arch', 'Arch'], ['blob', 'Organic blob'], ['circle', 'Circle'], ['tilt', 'Tilted card']] },
      { key: 'background', label: 'Block colour', type: 'color' }, { key: 'textColor', label: 'Text colour', type: 'color' }, STICKER, txt('buttonLabel', 'Button label'), linkF('buttonLink', 'Button link'),
      { key: 'items', label: 'Bullets', type: 'list', itemLabel: 'Bullet', item: [{ key: 'icon', label: 'Icon', type: 'select', options: FEATURE_ICONS.map(i => [i, i[0].toUpperCase() + i.slice(1)]) }, txt('title', 'Title'), txt('text', 'Text')] }],
    render: (s, ctx, sec) => {
      const vars = [s.background ? `--sf-bg:${s.background}` : '', s.textColor ? `--sf-fg:${s.textColor}` : ''].filter(Boolean).join(';');
      return `<section class="sec sfeat${s.imageSide === 'left' ? ' rev' : ''}" id="${sec.id}" data-sid="${sec.id}" data-type="split-feature"><div class="wrap" data-reveal><div class="sf-card"${vars ? ` style="${vars}"` : ''}>
        <div class="sf-copy">${s.eyebrow ? `<p class="eyebrow"${ctx.ed('eyebrow')}>${ctx.e(s.eyebrow)}</p>` : ''}<h2 class="sec-title"${ctx.edh('heading', s.heading)}>${ctx.h(s.heading)}</h2>${s.text ? `<div class="sf-text"${ctx.ed('text')}>${ctx.t(s.text)}</div>` : ''}
        <ul class="sf-list">${(s.items || []).map((it, i) => `<li${ctx.blk('items.' + i)}><span class="sf-ico" aria-hidden="true">${ctx.icon(it.icon)}</span><span><b${ctx.ed(`items.${i}.title`)}>${ctx.e(it.title)}</b>${it.text ? `<small${ctx.ed(`items.${i}.text`)}>${ctx.e(it.text)}</small>` : ''}</span></li>`).join('')}</ul>
        ${s.buttonLabel ? `<div class="btns">${ctx.btn(s.buttonLabel, s.buttonLink, 'btn-lg', 'buttonLabel')}</div>` : ''}</div>
        <div class="sf-media sh-${s.shape}">${s.image ? `<div class="sf-shape">${ctx.pic(s.image, { size: 'wide', ...ctx.framed(s) })}</div>` : ''}${sticker(s.sticker, ctx, sec)}</div></div></div></section>`;
    },
  },

  curriculum: {
    label: 'Course curriculum', group: 'Courses & services', pages: CONTENT, blocks: ['modules'],
    defaults: { eyebrow: 'Curriculum', heading: 'What you will learn', text: '', modules: [{ title: 'Module 1 — Foundations', duration: '45 min', lessons: 'Welcome\nCore concepts\nYour first project' }, { title: 'Module 2 — Going deeper', duration: '1 h 20 min', lessons: 'Techniques\nCommon mistakes\nPractice' }] },
    fields: [EYEBROW, txt('heading', 'Heading'), area('text', 'Text'), { key: 'modules', label: 'Modules', type: 'list', itemLabel: 'Module', item: [txt('title', 'Title'), txt('duration', 'Duration'), area('lessons', 'Lessons (one per line)')] }],
    render: (s, ctx, sec) => wrap(sec, 'curriculum', `<div class="faq-grid">${head(s, ctx)}<ol class="modules">${(s.modules || []).map((m, i) => {
      const ls = String(m.lessons || '').split('\n').map(x => x.trim()).filter(Boolean);
      return `<li${ctx.blk('modules.' + i)}><details${i === 0 ? ' open' : ''}><summary><span class="m-no">${String(i + 1).padStart(2, '0')}</span><span class="m-title"><span${ctx.ed(`modules.${i}.title`)}>${ctx.e(m.title)}</span><small>${ls.length} lessons${m.duration ? ' · ' + ctx.e(m.duration) : ''}</small></span><i aria-hidden="true">${ctx.icon('plus')}</i></summary><ul>${ls.map(l => `<li>${ctx.icon('play')}<span>${ctx.e(l)}</span></li>`).join('')}</ul></details></li>`;
    }).join('')}</ol></div>`),
  },

  pricing: {
    label: 'Pricing plans', group: 'Courses & services', pages: CONTENT, blocks: ['plans'],
    defaults: { eyebrow: 'Pricing', heading: 'Plans', text: '', plans: [{ name: 'Starter', price: '49', period: '/ month', features: 'Feature one\nFeature two', buttonLabel: 'Get started', buttonLink: 'page:contact', highlight: false }, { name: 'Pro', price: '99', period: '/ month', features: 'Everything in Starter\nPriority support', buttonLabel: 'Get started', buttonLink: 'page:contact', highlight: true }] },
    fields: [EYEBROW, txt('heading', 'Heading'), area('text', 'Text'), { key: 'plans', label: 'Plans', type: 'list', itemLabel: 'Plan', item: [txt('name', 'Name'), txt('price', 'Price'), txt('period', 'Period'), area('features', 'Features (one per line)'), txt('buttonLabel', 'Button label'), linkF('buttonLink', 'Button link'), toggle('highlight', 'Highlight')] }],
    render: (s, ctx, sec) => wrap(sec, 'pricing', `${head(s, ctx, 'center')}<div class="grid cols-${Math.min(4, Math.max(1, (s.plans || []).length))}">${(s.plans || []).map((p, i) => `<div class="plan${p.highlight ? ' hl' : ''}"${ctx.blk('plans.' + i)}>${p.highlight ? '<span class="badge">Most popular</span>' : ''}<h3${ctx.ed(`plans.${i}.name`)}>${ctx.e(p.name)}</h3><p class="plan-price">${/^\d+(\.\d+)?$/.test(String(p.price).trim()) ? ctx.money(+p.price) : ctx.e(p.price)}<small>${ctx.e(p.period || '')}</small></p><ul>${String(p.features || '').split('\n').filter(x => x.trim()).map(f => `<li>${ctx.icon('check')}<span>${ctx.e(f)}</span></li>`).join('')}</ul>${p.buttonLabel ? ctx.btn(p.buttonLabel, p.buttonLink, p.highlight ? 'btn-wide' : 'btn-wide btn-ghost', `plans.${i}.buttonLabel`) : ''}</div>`).join('')}</div>`),
  },

  gallery: {
    label: 'Gallery', group: 'Media', pages: CONTENT, blocks: ['images'],
    defaults: { heading: 'Gallery', columns: 3, images: [] },
    fields: [txt('heading', 'Heading'), COLS([2, 3, 4]), { key: 'images', label: 'Images', type: 'list', itemLabel: 'Image', item: [imgF(), txt('caption', 'Caption')] }],
    render: (s, ctx, sec) => wrap(sec, 'gallery', `${s.heading ? `<div class="sec-head"><h2 class="sec-title"${ctx.ed('heading')}>${ctx.e(s.heading)}</h2></div>` : ''}<div class="grid cols-${s.columns}">${(s.images || []).map((im, n) => im.image ? `<figure class="g${n % 5}"${ctx.blk('images.' + n)}>${ctx.pic(im.image, { size: 'card', alt: im.caption || '', ...ctx.framed(im, 'image', 'images.' + n) })}${im.caption ? `<figcaption${ctx.ed(`images.${n}.caption`)}>${ctx.e(im.caption)}</figcaption>` : ''}</figure>` : '').join('')}</div>`),
  },

  'insta-grid': {
    label: 'Instagram-style grid', group: 'Media', pages: CONTENT, blocks: ['images'],
    defaults: { heading: 'Follow along', handle: '@yourstore', images: [] },
    fields: [txt('heading', 'Heading'), txt('handle', 'Handle'), { key: 'images', label: 'Images', type: 'list', itemLabel: 'Image', item: [imgF()] }],
    render: (s, ctx, sec) => {
      const url = ctx.store.social.instagram;
      const own = (s.images || []).filter(i => i.image).length > 0;
      const list = own ? (s.images || []).map(i => i.image) : [...new Set(ctx.products('all', '', 12).map(p => p.images[0]).filter(Boolean))];
      const cell = (r, i) => r ? `<div class="insta-cell"${own ? ctx.blk('images.' + i) : ''}>${ctx.pic(r, { size: 'square', alt: '', ...(own ? ctx.framed(s.images[i], 'image', 'images.' + i) : {}) })}<span aria-hidden="true">${ctx.icon('camera')}</span></div>` : '';
      return wrap(sec, 'insta', `<div class="sec-head center">${s.heading ? `<h2 class="sec-title"${ctx.ed('heading')}>${ctx.e(s.heading)}</h2>` : ''}${s.handle ? (url ? `<a class="handle" href="${ctx.e(url)}" target="_blank" rel="noopener">${ctx.e(s.handle)}</a>` : `<p class="handle">${ctx.e(s.handle)}</p>`) : ''}</div><div class="insta-grid">${list.slice(0, 6).map(cell).join('')}</div>`);
    },
  },

  ugc: {
    label: 'Styled by you (UGC)', group: 'Media', pages: CONTENT, blocks: ['images'],
    defaults: { eyebrow: '#WornByYou', heading: 'Styled by you', text: 'Tag us to be featured.', images: [] },
    fields: [EYEBROW, txt('heading', 'Heading'), area('text', 'Text'), { key: 'images', label: 'Photos', type: 'list', itemLabel: 'Photo', item: [imgF(), txt('handle', 'Handle'), linkF('link', 'Shop the look link')] }],
    render: (s, ctx, sec) => {
      const ims = (s.images || []).filter(i => i.image);
      return ims.length ? wrap(sec, 'ugc', `${head(s, ctx, 'center')}<div class="ugc-grid">${(s.images || []).map((im, i) => im.image ? `<figure class="ugc-cell u${i % 4}"${ctx.blk('images.' + i)}>${ctx.pic(im.image, { size: 'card', alt: '', ...ctx.framed(im, 'image', 'images.' + i) })}${im.handle || im.link ? `<figcaption>${im.handle ? `<span${ctx.ed(`images.${i}.handle`)}>${ctx.e(im.handle)}</span>` : ''}${im.link ? `<a href="${ctx.link(im.link)}">Shop the look${ctx.icon('arrow')}</a>` : ''}</figcaption>` : ''}</figure>` : '').join('')}</div>`) : '';
    },
  },

  locations: {
    label: 'Locations & hours', group: 'Content', pages: CONTENT, blocks: ['items'],
    defaults: { heading: 'Visit us', items: [{ name: 'Main store', address: '12 Market Street', hours: 'Mon–Sat 9:00–18:00', phone: '' }], image: null },
    fields: [txt('heading', 'Heading'), imgF('image', 'Photo'), { key: 'items', label: 'Locations', type: 'list', itemLabel: 'Location', item: [txt('name', 'Name'), area('address', 'Address'), area('hours', 'Hours'), txt('phone', 'Phone')] }],
    render: (s, ctx, sec) => wrap(sec, `locations${s.image ? ' loc-photo' : ''}`, `<div class="loc-wrap">${s.image ? `<div class="loc-media">${ctx.pic(s.image, { size: 'wide', ...ctx.framed(s) })}</div>` : ''}<div class="loc-body">${s.heading ? `<h2 class="sec-title"${ctx.ed('heading')}>${ctx.e(s.heading)}</h2>` : ''}${(s.items || []).map((l, i) => `<div class="loc"${ctx.blk('items.' + i)}><h3${ctx.ed(`items.${i}.name`)}>${ctx.e(l.name)}</h3><p>${ctx.icon('pin')}<span>${ctx.e(l.address).replace(/\n/g, '<br>')}</span></p>${l.hours ? `<p>${ctx.icon('clock')}<span>${ctx.e(l.hours).replace(/\n/g, '<br>')}</span></p>` : ''}${l.phone ? `<p>${ctx.icon('phone')}<a href="tel:${ctx.e(l.phone.replace(/[^\d+]/g, ''))}">${ctx.e(l.phone)}</a></p>` : ''}</div>`).join('')}</div></div>`),
  },

  'page-title': {
    label: 'Page title', group: 'Intro', pages: CONTENT,
    defaults: { eyebrow: '', heading: 'Page title', text: '', image: null },
    fields: [EYEBROW, txt('heading', 'Heading'), area('text', 'Text'), imgF('image', 'Banner photo')],
    render: (s, ctx, sec) => wrap(sec, `ptitle${s.image ? ' pt-photo' : ''}`, `${s.image ? `<div class="pt-media">${ctx.pic(s.image, { size: 'hero', eager: true, ...ctx.framed(s) })}</div>` : ''}<div class="pt-copy">${s.eyebrow ? `<p class="eyebrow"${ctx.ed('eyebrow')}>${ctx.e(s.eyebrow)}</p>` : ''}<h1 class="sec-title"${ctx.ed('heading')}>${ctx.e(s.heading)}</h1>${s.text ? `<div class="sec-sub"${ctx.ed('text')}>${ctx.t(s.text)}</div>` : ''}</div>`),
  },

  'contact-form': {
    label: 'Contact form', group: 'Content', pages: CONTENT,
    defaults: { heading: 'Send us a message', text: 'We reply within one business day.', buttonLabel: 'Send message' },
    fields: [txt('heading', 'Heading'), area('text', 'Text'), txt('buttonLabel', 'Button label')],
    render: (s, ctx, sec) => {
      const c = ctx.store.contact, to = c.email || ctx.store.checkout.email;
      const det = [c.email && `<li>${ctx.icon('mail')}<a href="mailto:${ctx.e(c.email)}">${ctx.e(c.email)}</a></li>`, c.phone && `<li>${ctx.icon('phone')}<a href="tel:${ctx.e(c.phone.replace(/[^\d+]/g, ''))}">${ctx.e(c.phone)}</a></li>`, c.address && `<li>${ctx.icon('pin')}<span>${ctx.e(c.address)}</span></li>`, c.hours && `<li>${ctx.icon('clock')}<span>${ctx.e(c.hours)}</span></li>`].filter(Boolean).join('');
      return wrap(sec, 'contact', `<div class="split"><div class="split-copy">${head(s, ctx)}<ul class="contact-list">${det}</ul></div>
        <form class="form card-form" data-mailto-form="${ctx.e(to)}" data-subject="Message from the website">
        <label>Name<input name="name" required autocomplete="name"></label><label>Email<input type="email" name="email" required autocomplete="email"></label>
        <label>Message<textarea name="message" rows="5" required></textarea></label><button class="btn btn-lg" type="submit"${ctx.ed('buttonLabel')}>${ctx.e(s.buttonLabel || 'Send')}</button>
        ${to ? '' : '<p class="note">Add a contact email in the store settings to receive messages.</p>'}</form></div>`);
    },
  },

  'collection-main': {
    label: 'Product grid with filters', group: 'Products', pages: ['collection'],
    defaults: { showFilters: true, showSort: true, columns: 4, showQuickAdd: true },
    fields: [toggle('showFilters', 'Category & price filters'), toggle('showSort', 'Sorting'), COLS([2, 3, 4]), toggle('showQuickAdd', 'Quick add buttons')],
    render: (s, ctx, sec) => {
      const col = ctx.collection, ps = ctx.collectionProducts(col), cats = [...new Set(ps.map(p => p.category).filter(Boolean))].sort();
      const chips = s.showFilters && cats.length > 1 ? `<div class="chips" role="group" aria-label="Category"><button type="button" class="chip" data-chip="" aria-pressed="true">All</button>${cats.map(c => `<button type="button" class="chip" data-chip="${ctx.e(c)}" aria-pressed="false">${ctx.e(c)}</button>`).join('')}</div>` : '';
      const filters = s.showFilters ? `<label class="sel">Category<select data-filter-category><option value="">All</option>${cats.map(c => `<option>${ctx.e(c)}</option>`).join('')}</select></label>
        <label>Min price<input type="number" min="0" step="any" inputmode="decimal" data-filter-min placeholder="0"></label><label>Max price<input type="number" min="0" step="any" inputmode="decimal" data-filter-max placeholder="Any"></label>` : '';
      const sort = s.showSort ? `<label class="sel">Sort by<select data-sort><option value="featured">Featured</option><option value="price-asc">Price, low to high</option><option value="price-desc">Price, high to low</option><option value="title">Alphabetically</option></select></label>` : '';
      return wrap(sec, 'cmain', `<div class="cm-head"><nav class="crumbs" aria-label="Breadcrumb"><a href="${ctx.link('home')}">Home</a><span aria-hidden="true">/</span><span aria-current="page">${ctx.e(col.title)}</span></nav><h1 class="sec-title">${ctx.e(col.title)}</h1>${col.description ? `<div class="sec-sub">${ctx.t(col.description)}</div>` : ''}</div>
        <div data-collection>${chips}${filters || sort ? `<div class="toolbar">${filters}${sort}<span class="count" data-result-count aria-live="polite">${ps.length} products</span></div>` : ''}
        <div class="grid pgrid cols-${s.columns}" data-collection-grid>${ps.map((p, i) => ctx.card(p, s.showQuickAdd, i)).join('')}</div>
        <p class="empty" data-empty ${ps.length ? 'hidden' : ''}>No products match these filters.</p></div>`);
    },
  },

  'product-main': {
    label: 'Product details', group: 'Products', pages: ['product'], blocks: ['blocks'],
    defaults: { layout: 'classic', zoom: true, stickyBar: true, blocks: null },
    fields: [{ key: 'layout', label: 'Layout', type: 'select', options: [['classic', 'Classic two columns'], ['editorial', 'Editorial: text left, gallery right'], ['stack', 'Full-bleed gallery stack, sticky info'], ['compact', 'Compact (quick commerce)']] },
      toggle('zoom', 'Zoom on hover'), toggle('stickyBar', 'Sticky add-to-cart bar'), { key: 'blocks', label: 'Blocks', type: 'blocks' }],
    render: (s, ctx, sec) => {
      const p = ctx.product;
      if (!p) return wrap(sec, 'pmain', '<p class="empty">Add a product to see this page.</p>');
      const blocks = Array.isArray(s.blocks) && s.blocks.length ? s.blocks : productBlocks();
      const v0 = p.variants.find(v => v.stock == null || v.stock > 0) || p.variants[0];
      const ok = v0 && (v0.stock == null || v0.stock > 0);
      const price = v0 && v0.price != null ? v0.price : p.price, cmp = p.compareAt && p.compareAt > price ? p.compareAt : null;
      const rs = p.reviewsList, rating = rs.length ? { avg: Math.round(rs.reduce((a, r) => a + r.rating, 0) / rs.length * 10) / 10, count: rs.length } : { avg: p.rating || 0, count: p.reviews || 0 };
      const guide = blocks.find(b => b.type === 'sizeguide' && b.on);
      const sizeIdx = guide ? p.options.findIndex(o => /size/i.test(o.name)) : -1;
      const st = { v0, ok, price, cmp, rating, guide, sizeIdx };
      const layout = s.layout || 'classic', imgs = p.images;
      const zoom = s.zoom && (layout === 'classic' || layout === 'compact');
      const media = imgs.map((r, i) => `<div class="pslide" data-slide="${i}"${layout !== 'stack' && layout !== 'editorial' && i ? ' hidden' : ''}>${ctx.pic(r, { size: 'large', alt: i ? '' : p.title, eager: !i, fallback: p.art, ...ctx.pframe(p, i) })}</div>`).join('')
        + (p.video ? `<div class="pslide video" data-slide="${imgs.length}"${layout !== 'stack' && layout !== 'editorial' ? ' hidden' : ''}><video src="${ctx.e(ctx.img(p.video, 'large'))}" controls playsinline preload="none" aria-label="${ctx.e(p.title)} video"></video></div>` : '');
      const thumbs = (imgs.length > 1 || p.video) && (layout === 'classic' || layout === 'compact') ? `<div class="thumbs">${imgs.map((r, i) => `<button type="button" class="thumb" data-thumb="${i}" aria-label="Show image ${i + 1}"${i ? '' : ' aria-current="true"'}>${ctx.pic(r, { size: 'thumb', alt: '', fallback: p.art, ...ctx.pframe(p, i) })}</button>`).join('')}${p.video ? `<button type="button" class="thumb vthumb" data-thumb="${imgs.length}" aria-label="Play video">${imgs[0] ? ctx.pic(imgs[0], { size: 'thumb', alt: '', fallback: p.art }) : ''}<span>${ctx.icon('play')}</span></button>` : ''}</div>` : '';
      const badge = cmp ? `<span class="badge sale">−${Math.round((1 - price / cmp) * 100)}%</span>` : p.tags.includes('new') ? '<span class="badge">New</span>' : '';
      const gallery = `<div class="pgallery pg-${layout}" data-gallery>${thumbs}<div class="pmain-img${zoom ? ' zoomable' : ''}"${zoom ? ' data-zoom' : ''}>${media || (p.art ? `<div class="pslide" data-slide="0">${ctx.pic(p.art, { size: 'large', alt: p.title })}</div>` : '')}${badge}</div></div>`;
      const html = blocks.map((b, i) => b.on && PRODUCT_BLOCKS[b.type] ? productBlock(b, i, p, s, ctx, st) : (ctx.editor ? `<span class="pb-marker"${ctx.blk('blocks.' + i)} hidden></span>` : ''));
      const guideTable = guide ? String(guide.table || '').split('\n').map(r => r.split('|').map(c => c.trim())).filter(r => r.some(Boolean)) : [];
      const modal = guide ? `<div class="modal" id="sg-${p.id}" data-modal hidden><div class="drawer-scrim" data-modal-close></div><div class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="sgt-${p.id}"><div class="drawer-head"><h2 id="sgt-${p.id}">${ctx.e(guide.label || 'Size guide')}</h2><button type="button" class="hicon" data-modal-close aria-label="Close size guide">${ctx.icon('close')}</button></div>
        <table class="sgtable">${guideTable.map((r, i) => `<tr>${r.map(c => i ? `<td>${ctx.e(c)}</td>` : `<th scope="col">${ctx.e(c)}</th>`).join('')}</tr>`).join('')}</table></div></div>` : '';
      const sticky = s.stickyBar && ctx.checkoutEnabled ? `<div class="sticky-atc" data-sticky-atc hidden aria-hidden="true"><div class="wrap sticky-in">${imgs[0] ? ctx.pic(imgs[0], { size: 'thumb', alt: '', fallback: p.art, ...ctx.pframe(p, 0) }) : ''}<div class="sticky-info"><b>${ctx.e(p.title)}</b><span data-price>${ctx.money(price)}</span></div><button type="button" class="btn" data-sticky-add${ok ? '' : ' disabled'}>${ctx.e((blocks.find(b => b.type === 'buy') || {}).buttonLabel || 'Add to cart')}</button></div></div>` : '';
      return `<section class="sec pmain pl-${layout}" id="${sec.id}" data-sid="${sec.id}" data-type="product-main" data-product="${p.id}"><div class="wrap">
        <div class="product">${gallery}<div class="pinfo"><form class="pform" data-product-form="${p.id}">${html.join('')}</form></div></div></div>${modal}${sticky}</section>`;
    },
  },

  bundle: {
    label: 'Frequently bought together', group: 'Products', pages: ['product'],
    defaults: { heading: 'Frequently bought together', productIds: [], buttonLabel: 'Add all to cart' },
    fields: [txt('heading', 'Heading'), txt('buttonLabel', 'Button label')],
    render: (s, ctx, sec) => {
      const p = ctx.product; if (!p || !ctx.checkoutEnabled) return '';
      const all = ctx.products('all', '', 999).filter(x => x.id !== p.id && x.variants.some(v => v.stock == null || v.stock > 0));
      const picks = [...(s.productIds || []).map(id => all.find(x => x.id === id)).filter(Boolean), ...all.filter(x => x.category === p.category), ...all].filter((x, i, a) => a.indexOf(x) === i).slice(0, 2);
      if (!picks.length) return '';
      const items = [p, ...picks], price = x => { const v = x.variants.find(v => v.stock == null || v.stock > 0) || x.variants[0]; return v.price ?? x.price; };
      const total = items.reduce((a, x) => a + price(x), 0);
      return wrap(sec, 'bundle', `<div class="sec-head"><h2 class="sec-title"${ctx.ed('heading')}>${ctx.e(s.heading)}</h2></div><div class="bundle-in" data-bundle>
        <div class="bundle-items">${items.map((x, i) => `${i ? '<span class="bplus" aria-hidden="true">+</span>' : ''}<label class="bitem"><input type="checkbox" checked data-bundle-item="${x.id}" data-price="${price(x)}" aria-label="Include ${ctx.e(x.title)}"><span class="bimg">${x.images[0] ? ctx.pic(x.images[0], { size: 'square', alt: '', fallback: x.art, ...ctx.pframe(x, 0) }) : ''}</span><span class="btitle">${i ? '' : '<small>This item</small>'}${ctx.e(x.title)}</span><b>${ctx.money(price(x))}</b></label>`).join('')}</div>
        <div class="bundle-sum"><p>Total for <span data-bundle-count>${items.length}</span> items</p><p class="btotal" data-bundle-total>${ctx.money(total)}</p><button type="button" class="btn btn-lg btn-wide" data-bundle-add${ctx.ed('buttonLabel')}>${ctx.e(s.buttonLabel || 'Add all to cart')}</button></div></div>`);
    },
  },

  'product-reviews': {
    label: 'Product reviews', group: 'Social proof', pages: ['product'],
    defaults: { heading: 'Customer reviews', showPhotos: true },
    fields: [txt('heading', 'Heading'), toggle('showPhotos', 'Show review photos')],
    render: (s, ctx, sec) => {
      const p = ctx.product; if (!p) return '';
      const rs = p.reviewsList, n = rs.length;
      if (!n) return ctx.editor ? wrap(sec, 'reviews', `<h2 class="sec-title">${ctx.e(s.heading)}</h2><p class="empty">No reviews yet — add them in the product editor.</p>`) : '';
      const avg = Math.round(rs.reduce((a, r) => a + r.rating, 0) / n * 10) / 10;
      const bars = [5, 4, 3, 2, 1].map(k => { const c = rs.filter(r => r.rating === k).length; return `<li><span>${k} ${ctx.icon('star-fill')}</span><span class="rbar"><i style="width:${Math.round(c / n * 100)}%"></i></span><span>${c}</span></li>`; }).join('');
      const photos = s.showPhotos ? rs.filter(r => r.photo) : [];
      return `<section class="sec reviews" id="reviews" data-sid="${sec.id}" data-type="product-reviews"><div class="wrap" data-reveal><div class="rv-grid"><div class="rv-sum"><h2 class="sec-title"${ctx.ed('heading')}>${ctx.e(s.heading)}</h2><p class="rv-avg">${avg.toFixed(1)}<small>/ 5</small></p>${ctx.stars(avg, n)}<ul class="rv-bars">${bars}</ul></div>
        <div>${photos.length ? `<div class="rv-photos">${photos.map(r => ctx.pic(r.photo, { size: 'square', alt: 'Customer photo' })).join('')}</div>` : ''}<ul class="rv-list">${rs.map(r => `<li class="review"><div class="rv-top">${ctx.stars(r.rating, 0)}${r.sample ? '<span class="sample-tag">Sample review</span>' : ''}</div>${r.title ? `<h3>${ctx.e(r.title)}</h3>` : ''}<p>${ctx.e(r.text)}</p><p class="rv-by"><span class="avatar initials sm" aria-hidden="true">${ctx.e(initials(r.name))}</span>${ctx.e(r.name)}${r.date ? ` · <time datetime="${r.date}">${ctx.e(r.date)}</time>` : ''}</p>${r.photo && s.showPhotos ? ctx.pic(r.photo, { size: 'thumb', cls: 'rv-photo', alt: 'Photo from ' + r.name }) : ''}</li>`).join('')}</ul></div></div></div></section>`;
    },
  },

  'recently-viewed': {
    label: 'Recently viewed', group: 'Products', pages: CONTENT,
    defaults: { heading: 'Recently viewed' },
    fields: [txt('heading', 'Heading')],
    render: (s, ctx, sec) => `<section class="sec recent" id="${sec.id}" data-sid="${sec.id}" data-type="recently-viewed" data-recent="${ctx.product ? ctx.product.id : ''}" hidden><div class="wrap"><div class="sec-head"><h2 class="sec-title"${ctx.ed('heading')}>${ctx.e(s.heading)}</h2></div><div class="ptrack recent-track" data-recent-list></div></div></section>`,
  },

  'related-products': {
    label: 'You may also like', group: 'Products', pages: ['product'],
    defaults: { heading: 'You may also like', limit: 4 },
    fields: [txt('heading', 'Heading'), { key: 'limit', label: 'Products shown', type: 'number', min: 1, max: 12 }],
    render: (s, ctx, sec) => {
      const p = ctx.product, all = ctx.products('all', '', 999).filter(x => !p || x.id !== p.id);
      const same = p ? all.filter(x => x.category === p.category) : [];
      const ps = [...same, ...all.filter(x => !same.includes(x))].slice(0, s.limit);
      return ps.length ? wrap(sec, 'related', `${s.heading ? `<div class="sec-head"><h2 class="sec-title"${ctx.ed('heading')}>${ctx.e(s.heading)}</h2></div>` : ''}<div class="grid pgrid cols-${Math.max(2, Math.min(4, ps.length))}">${ps.map((x, i) => ctx.card(x, true, i)).join('')}</div>`) : '';
    },
  },

  'cart-main': {
    label: 'Cart', group: 'Products', pages: ['cart'],
    defaults: { heading: 'Your cart', emptyText: 'Your cart is empty.' },
    fields: [txt('heading', 'Heading'), txt('emptyText', 'Empty cart text')],
    render: (s, ctx, sec) => wrap(sec, 'cartpage', `<h1 class="sec-title"${ctx.ed('heading')}>${ctx.e(s.heading)}</h1>${ctx.checkoutEnabled ? `<div class="ship-bar" data-ship-bar hidden></div><div data-cart-page data-empty-text="${ctx.e(s.emptyText)}"><p class="empty">${ctx.e(s.emptyText)}</p></div>
      <noscript><p class="note">Turn on JavaScript to use the cart.</p></noscript>` : '<p class="note">This store does not take orders online.</p>'}`),
  },

  'checkout-main': {
    label: 'Checkout', group: 'Products', pages: ['checkout'],
    defaults: { heading: 'Checkout', note: '' },
    fields: [txt('heading', 'Heading'), area('note', 'Extra note')],
    render: (s, ctx, sec) => {
      const ck = ctx.store.checkout, mode = ck.mode;
      const how = { whatsapp: 'Your order is sent to us as a WhatsApp message. We confirm availability, shipping and payment with you in the chat.', email: 'Your order is sent to us by email from your mail app. We reply to confirm shipping and payment.', paymentLinks: 'Each product is paid on our payment provider’s secure page.', none: 'This store does not take orders online.' }[mode];
      const fields = mode === 'whatsapp' || mode === 'email' ? `<form class="form" data-checkout-form>
        <label>Full name<input name="name" required autocomplete="name"></label><label>Phone<input name="phone" type="tel" autocomplete="tel"></label>
        ${mode === 'email' ? '<label>Email<input name="email" type="email" required autocomplete="email"></label>' : ''}
        <label>Delivery address<textarea name="address" rows="3" autocomplete="street-address"></textarea></label><label>Notes<textarea name="notes" rows="2"></textarea></label><div data-ship-fields></div>
        <button class="btn btn-lg btn-wide" type="submit">${ctx.icon(mode === 'whatsapp' ? 'chat' : 'mail')}${mode === 'whatsapp' ? 'Send order on WhatsApp' : 'Send order by email'}</button></form>` : mode === 'paymentLinks' ? '<div data-pay-links></div>' : '';
      const missing = (mode === 'whatsapp' && !ck.phone) || (mode === 'email' && !ck.email);
      return wrap(sec, 'checkout', `<h1 class="sec-title"${ctx.ed('heading')}>${ctx.e(s.heading)}</h1><div class="co-grid" data-checkout data-mode="${mode}">
        <div class="co-form"><p class="sec-sub">${ctx.e(how)}</p>${missing ? '<p class="note warn">The store owner has not set up the order contact yet.</p>' : ''}${fields}
        <div class="co-result" data-checkout-result hidden></div>${s.note ? `<div class="prose note">${ctx.t(s.note)}</div>` : ''}${ck.shippingNote ? `<p class="note">${ctx.icon('truck')} ${ctx.e(ck.shippingNote)}</p>` : ''}
        ${mode !== 'none' ? `<p class="note small">${ctx.icon('lock')} Payments are handled outside this website — by the store owner directly or by their own payment links/provider. This site never asks for card details.</p>` : ''}</div>
        <aside class="co-summary" aria-label="Order summary"><h2>Order summary</h2><div data-checkout-lines><p class="empty">Your cart is empty.</p></div></aside></div>`);
    },
  },
};

export const SECTION_GROUPS = ['Intro', 'Products', 'Content', 'Social proof', 'Media', 'Courses & services'];
/** Section types that can be added to a page (excluding the shared layout sections). */
export const addableSections = page => Object.entries(SECTIONS).filter(([, d]) => !d.global && d.pages.includes(page)).map(([type, d]) => ({ type, label: d.label, group: d.group }));
