// Storefront renderer: store document → HTML pages, CSS and the runtime script.
// Used by the builder's live preview (inline CSS/JS, srcdoc iframe) and the static exporter (files).
//
//   sitePages(store)                         → [{ route, path, title }]  every page of the exported site
//   pagePath(store, route)                   → 'index.html' | 'collections/<slug>.html' | 'products/<slug>.html' | 'pages/about.html' | …
//   renderPage(store, route, opts)           → full HTML document string (= composePage(renderParts(...)))
//   renderParts / composePage / diffParts    → part-wise rendering used by the builder to patch the live preview in place
//       route = { page, productId?, collectionId? }
//       opts  = { mode: 'export'|'preview', imageUrl(ref) → url (root-relative path or absolute URL),
//                 commerce?: commerce document or { discounts } (discount codes, shipping, tax, order webhook in the cart),
//                 editor?: bool (builder selection overlay), script?: false (static thumbnail, no runtime),
//                 small?: bool (gallery thumbnails: small photo crops, no srcset) }
//   storeCss(store)                          → assets/styles.css
//   storeScript(store, imageUrl, {preview})  → assets/store.js (cart kit + runtime + data)
//   resolveHref(fromPath, href)              → site-root-relative path ('products/x.html'), or null for external links

import { SECTIONS } from './sections.js';
import { FONT_STACKS, collectionProducts, activeProducts, PAGE_LABELS } from './model.js';
import { cartKit } from './cart.js';
import { storeRuntime } from './runtime.js';
import { photoUrl, PHOTOS } from './photos.js';
import { editorAgent } from './agent.js';
import { checkoutConfig, commerceScript } from './commerce.js';
import { frameOf, productFrame, frameStyle, isDefaultFrame } from './frame.js';

export const ALL_COLLECTION = { id: 'all', title: 'All products', slug: 'all', description: '', image: null, rule: { type: 'all', value: '', productIds: [] } };
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ESC[c]);
const paras = s => String(s || '').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean).map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
export const cents = n => Math.round((+n || 0) * 100);

export function formatMoney(amount, currency) {
  try { return new Intl.NumberFormat(currency.locale || 'en-US', { style: 'currency', currency: currency.code || 'USD' }).format(+amount || 0); }
  catch { return (currency.code || '') + ' ' + (+amount || 0).toFixed(2); }
}

export function pagePath(store, route) {
  switch (route.page) {
    case 'home': return 'index.html';
    case 'collection': { const c = store.collections.find(x => x.id === route.collectionId); return 'collections/' + (c ? c.slug : 'all') + '.html'; }
    case 'product': { const p = store.products.find(x => x.id === route.productId) || activeProducts(store)[0]; return 'products/' + (p ? p.slug : 'product') + '.html'; }
    case 'about': case 'contact': return 'pages/' + route.page + '.html';
    case 'cart': return 'cart.html';
    case 'checkout': return 'checkout.html';
  }
  return 'index.html';
}

export function sitePages(store) {
  const out = [{ route: { page: 'home' }, title: store.name }];
  out.push({ route: { page: 'collection', collectionId: 'all' }, title: 'All products' });
  for (const c of store.collections) out.push({ route: { page: 'collection', collectionId: c.id }, title: c.title });
  for (const p of activeProducts(store)) out.push({ route: { page: 'product', productId: p.id }, title: p.title });
  for (const k of ['about', 'contact', 'cart', 'checkout']) out.push({ route: { page: k }, title: PAGE_LABELS[k] });
  return out.map(x => ({ ...x, path: pagePath(store, x.route) }));
}

/** Resolve an href found on page `fromPath` to a site path ('products/x.html'); null for external/anchor links. */
export function resolveHref(fromPath, href) {
  if (!href || /^([a-z]+:|\/\/|#)/i.test(href)) return null;
  const parts = fromPath.split('/').slice(0, -1);
  for (const seg of href.split(/[?#]/)[0].split('/')) { if (seg === '..') parts.pop(); else if (seg && seg !== '.') parts.push(seg); }
  return parts.join('/');
}

/** Route for a site path (inverse of pagePath); null if the path is not a page of this store. */
export function routeForPath(store, path) {
  return sitePages(store).find(p => p.path === path)?.route || null;
}


// ---------- photos ('unsplash:<id>' refs, hot-linked with size-appropriate crops and 1x/2x srcset) ----------
const PEOPLE = (PHOTOS.fashion.people || []).map(([id]) => 'unsplash:' + id);
const PHOTO_ALT = new Map(Object.values(PHOTOS).flatMap(g => Object.values(g).flat()));
export const isPhoto = r => typeof r === 'string' && r.startsWith('unsplash:');
/** [width, height|null] per use; the 2x candidate doubles both. */
export const PHOTO_SIZES = { hero: [1800, null], wide: [1100, null], large: [1000, null], card: [640, null], square: [480, 480], thumb: [160, 200], avatar: [96, 96], logo: [400, null], panel: [320, null] };
/**
 * Photo URLs for a use. Fixed-height sizes (square, thumb, avatar) are cropped server-side at the centre; a framed image
 * (custom focal point / zoom / fit) is requested uncropped instead (width only, a little larger), so the CSS
 * object-position + scale positions it exactly the same way in the builder preview and in the exported site.
 */
export function photoSrc(ref, size = 'card', frame = null) {
  const id = ref.slice(9);
  let [w, h] = PHOTO_SIZES[size] || PHOTO_SIZES.card;
  if (frame && !isDefaultFrame(frame)) {
    if (h) { w = Math.round(Math.max(w, h) * 1.5); h = null; }
    if (frame.fit !== 'contain' && frame.zoom >= 150 && w < 1200) w = Math.round(w * 1.5);
  }
  return { src: photoUrl(id, w, h), srcset: `${photoUrl(id, w, h)} 1x, ${photoUrl(id, w * 2, h ? h * 2 : null)} 2x`, alt: PHOTO_ALT.get(id) || '' };
}

const ICONS = {
  bag: '<path d="M5 8h14l-1.2 12H6.2z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>', menu: '<path d="M4 7h16M4 12h16M4 17h10"/>', close: '<path d="M6 6l12 12M18 6 6 18"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>', heart: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z"/>',
  left: '<path d="M15 5l-7 7 7 7"/>', right: '<path d="M9 5l7 7-7 7"/>', arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>', plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M5 12l5 5 9-10"/>', play: '<circle cx="12" cy="12" r="9"/><path d="M10 9v6l5-3z"/>',
  pin: '<path d="M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>', mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>', phone: '<path d="M6 3h3l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v3a2 2 0 0 1-2 2A17 17 0 0 1 4 5a2 2 0 0 1 2-2z"/>',
  truck: '<path d="M3 6h11v10H3zM14 9h4l3 3v4h-7"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>', refresh: '<path d="M20 11a8 8 0 0 0-14-4L4 9M4 4v5h5M4 13a8 8 0 0 0 14 4l2-2M20 20v-5h-5"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>', 'star-fill': '<path fill="currentColor" stroke="none" d="M12 2.8l2.8 5.8 6.4.9-4.6 4.5 1.1 6.3L12 17.3l-5.7 3 1.1-6.3-4.6-4.5 6.4-.9z"/>',
  leaf: '<path d="M5 19c0-9 6-14 15-14 0 9-5 15-14 15M5 19l7-7"/>', gift: '<path d="M4 10h16v10H4zM3 7h18v3H3zM12 7v13M12 7c-2-4-6-3-5 0M12 7c2-4 6-3 5 0"/>',
  bolt: '<path d="M13 3 5 14h6l-1 7 8-11h-6z"/>', lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>', award: '<circle cx="12" cy="9" r="6"/><path d="M8.5 14 7 21l5-3 5 3-1.5-7"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2 20c0-4 3-6 7-6s7 2 7 6"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14c2.5.5 4 2.5 4 6"/>',
  camera: '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".8" fill="currentColor"/>', music: '<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
  at: '<circle cx="12" cy="12" r="4"/><path d="M16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.5 7.1"/>', sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2 2.2.8-2.2.8L19 22l-.8-2.2-2.2-.8 2.2-.8z"/>',
  box: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5 12 12l8-4.5M12 12v9"/>', card: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18M7 15h3"/>',
  wallet: '<path d="M4 7h15a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a1 1 0 0 1-1-1z"/><path d="M4 7l11-3v3M16 13.5h2"/>', bank: '<path d="M3 10h18L12 4zM5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18"/>',
  ruler: '<path d="M3 15 15 3l6 6L9 21z"/><path d="m7 11 2 2M10 8l2 2M13 5l2 2"/>',
  cash: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6.5 9.5v5M17.5 9.5v5"/>',
};
export const icon = n => `<svg class="ico" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n] || ICONS.check}</svg>`;

const COLOR_NAMES = { black: '#111111', white: '#f7f7f5', bone: '#e9e4d8', cream: '#f1e8d6', sand: '#d8c3a5', oat: '#d9ccb4', beige: '#d6c4a8', camel: '#b8875a', brown: '#6d4c35', red: '#c0392b', ruby: '#9b1b30', berry: '#7a1f4a', rose: '#d98a9b', 'rose gold': '#d4a28c', pink: '#e8a0b4', nude: '#d9a88c', coral: '#ff7b6b', orange: '#f08a24', ember: '#e2603a', rust: '#b5532f', yellow: '#f2c94c', honey: '#d9a441', gold: '#cfa652', green: '#3f8f5a', sage: '#9fb29f', moss: '#6b7a4b', forest: '#2f4a33', olive: '#7a7a45', teal: '#1f9d8f', mint: '#a8dcc8', blue: '#2f6fd6', navy: '#1f2a44', sky: '#8cc4ee', purple: '#7b4bc4', lilac: '#c8b6e2', grey: '#9a9a9a', gray: '#9a9a9a', charcoal: '#3a3a3a', graphite: '#4a4d52', silver: '#c9ccd1', platinum: '#e2e4e7', denim: '#3b5a80' };
const isSwatch = name => /colou?r|shade|metal|finish|fabric/i.test(name);
const colorOf = v => { const k = String(v).trim().toLowerCase(); if (COLOR_NAMES[k]) return COLOR_NAMES[k]; let h = 0; for (const ch of k) h = (h * 31 + ch.charCodeAt(0)) % 360; return `hsl(${h} 45% 55%)`; };

function makeCtx(store, route, opts) {
  const editor = !!opts.editor;
  const path = pagePath(store, route), root = path.includes('/') ? '../' : '';
  const mode = store.checkout.mode, checkoutEnabled = mode !== 'none';
  const plain = ref => { if (!ref) return ''; const u = opts.imageUrl(ref) || ''; return /^(data:|blob:|https?:|\/)/.test(u) ? esc(u) : esc(root + u); };
  const img = (ref, size = 'card') => !ref ? '' : isPhoto(ref) ? esc(photoSrc(ref, size).src) : plain(ref);
  /** <img> with srcset for photos and an offline fallback to procedural art. */
  /**
   * <img> for an image ref. frame = { x, y, zoom, fit } (src/store/frame.js) → inline object-position / object-fit / scale;
   * fr = the frame's key, marked as data-fr in the editor so the builder can patch just the image's style and src
   * ('image', 'slides.0.image', 'p:<productId>:<index>', 'c:<collectionId>').
   */
  const pic = (ref, { size = 'card', alt, cls = '', eager = false, fallback, frame, fr } = {}) => {
    if (!ref) return '';
    const fb = fallback || store.fallbackArt;
    const fst = frameStyle(frame, { zoom: !['avatar', 'thumb'].includes(size) });
    const a = `${fst ? ` style="${fst}"` : ''}${editor && fr ? ` data-fr="${esc(fr)}"` : ''} class="${[cls, fst.includes('scale:') ? 'fz' : ''].filter(Boolean).join(' ')}" alt="${esc(alt ?? (isPhoto(ref) ? photoSrc(ref, size).alt : ''))}"${eager ? ' fetchpriority="high"' : ' loading="lazy"'} decoding="async"`;
    if (!isPhoto(ref)) return `<img src="${plain(ref)}"${a}>`;
    const p = photoSrc(ref, opts.small ? 'panel' : size, frame);
    return `<img src="${esc(p.src)}"${opts.small ? '' : ` srcset="${esc(p.srcset)}"`}${a}${fb ? ` onerror="this.onerror=null;this.removeAttribute('srcset');this.src='${plain(fb)}'"` : ''}>`;
  };
  /** pic() options for image field `key` of a settings object / list item at settings path `path` ('' = top level). */
  const framed = (owner, key = 'image', path = '') => ({ frame: frameOf(owner, key), fr: (path ? path + '.' : '') + key });
  /** pic() options for image `i` of product `p`. */
  const pframe = (p, i = 0) => ({ frame: productFrame(p, i), fr: 'p:' + p.id + ':' + i });
  const rel = p => root + p;
  const findCol = id => id === 'all' ? ALL_COLLECTION : store.collections.find(c => c.id === id);
  const collectionHref = c => rel('collections/' + c.slug + '.html');
  const productHref = p => rel('products/' + p.slug + '.html');
  const link = t => {
    t = String(t || 'home');
    if (t === 'home') return rel('index.html');
    if (t === 'cart') return rel('cart.html');
    if (t === 'checkout') return rel('checkout.html');
    if (t.startsWith('page:')) return rel('pages/' + t.slice(5) + '.html');
    if (t.startsWith('collection:')) { const c = findCol(t.slice(11)); return c ? collectionHref(c) : rel('collections/all.html'); }
    if (t.startsWith('product:')) { const p = store.products.find(x => x.id === t.slice(8) && x.status === 'active'); return p ? productHref(p) : rel('collections/all.html'); }
    if (t.startsWith('url:')) return esc(t.slice(4));
    if (t.startsWith('#')) return route.page !== 'home' && store.pages.home.some(s => '#' + s.id === t) ? rel('index.html') + esc(t) : esc(t);
    return rel('index.html');
  };
  const money = n => esc(formatMoney(n, store.currency));
  const minPrice = p => Math.min(...p.variants.map(v => v.price ?? p.price));
  const maxPrice = p => Math.max(...p.variants.map(v => v.price ?? p.price));
  const products = (source, colId, limit) => {
    let ps = activeProducts(store);
    if (source === 'featured') { const f = ps.filter(p => p.featured); ps = f.length ? f : ps; }
    else if (source === 'collection') ps = collectionProducts(store, findCol(colId) || ALL_COLLECTION);
    else if (source === 'newest') ps = [...ps].reverse();
    else if (source === 'sale') { const f = ps.filter(p => p.compareAt && p.compareAt > p.price); ps = f.length ? f : ps; }
    return ps.slice(0, Math.max(1, +limit || 8));
  };
  const stars = (r, n) => `<span class="rating" role="img" aria-label="Rated ${r} out of 5${n ? ` from ${n} reviews` : ''}"><span class="stars-bg">${icon('star-fill').repeat(5)}<span class="stars-fg" style="width:${Math.round(r / 5 * 100)}%">${icon('star-fill').repeat(5)}</span></span>${n ? `<small>(${n})</small>` : ''}</span>`;
  const card = (p, quick, index = 0) => {
    const lo = minPrice(p), hi = maxPrice(p), sale = p.compareAt && p.compareAt > lo, sold = p.variants.every(v => v.stock != null && v.stock <= 0);
    const single = p.variants.length === 1, href = productHref(p);
    const q = quick && checkoutEnabled && !sold ? (single ? `<button type="button" class="quick" data-quick-add="${p.id}" aria-label="Add ${esc(p.title)} to cart">${icon('plus')}<span>Quick add</span></button>` : `<a class="quick" href="${href}" aria-label="Choose options for ${esc(p.title)}">${icon('plus')}<span>Choose options</span></a>`) : '';
    const sw = p.options.find(o => isSwatch(o.name));
    const swatches = sw ? `<span class="swatches-mini" aria-label="${sw.values.length} ${esc(sw.name.toLowerCase())}s">${sw.values.slice(0, 5).map(v => `<i title="${esc(v)}" style="background:${colorOf(v)}"></i>`).join('')}${sw.values.length > 5 ? `<small>+${sw.values.length - 5}</small>` : ''}</span>` : '';
    const badge = sold ? '<span class="badge sold">Sold out</span>' : sale ? `<span class="badge sale">−${Math.round((1 - lo / p.compareAt) * 100)}%</span>` : p.tags.includes('new') ? '<span class="badge">New</span>' : '';
    return `<article class="pcard" data-card data-price="${lo}" data-category="${esc(p.category)}" data-title="${esc(p.title)}" data-index="${index}">
      <div class="pcard-media"><a class="pcard-img" href="${href}" tabindex="-1" aria-hidden="true">${p.images[0] ? pic(p.images[0], { size: 'card', alt: '', fallback: p.art, ...pframe(p, 0) }) : p.art ? pic(p.art, { alt: '' }) : ''}${p.images[1] ? pic(p.images[1], { size: 'card', alt: '', cls: 'alt', fallback: p.art, ...pframe(p, 1) }) : ''}</a>
      ${badge}<button type="button" class="wish" data-wish="${p.id}" aria-pressed="false" aria-label="Save ${esc(p.title)} to wishlist">${icon('heart')}</button>${q}</div>
      <div class="pcard-body"><h3><a href="${href}">${esc(p.title)}</a></h3><p class="price">${lo !== hi ? '<span class="from">From</span> ' : ''}${money(lo)}${sale ? ` <s>${money(p.compareAt)}</s>` : ''}</p>
      ${p.rating || swatches ? `<div class="pcard-meta">${p.rating ? stars(p.rating, p.reviews) : ''}${swatches}</div>` : ''}</div></article>`;
  };
  const ed = key => editor && key ? ` data-edit="${esc(key)}"` : '';
  const blk = path => editor ? ` data-block="${esc(path)}"` : '';
  const btn = (label, target, cls = '', key) => `<a class="btn ${cls}" href="${link(target)}"${ed(key)}>${esc(label)}</a>`;
  const orderedCollections = ids => { const all = allCollections(); if (!ids || !ids.length) return all; const m = new Map(all.map(c => [c.id, c])); const out = ids.map(id => m.get(id)).filter(Boolean); return [...out, ...all.filter(c => !out.includes(c))]; };
  const isCurrent = t => link(t) === rel(path);
  const allCollections = () => store.collections.length ? store.collections : [ALL_COLLECTION];
  const collectionImage = c => collectionProducts(store, c).find(p => p.images[0])?.images[0] || null;
  const product = route.page === 'product' ? store.products.find(p => p.id === route.productId) || activeProducts(store)[0] || store.products[0] || null : null;
  const collection = route.page === 'collection' ? findCol(route.collectionId) || ALL_COLLECTION : null;
  const first = (store.pages[route.page] || []).find(s => !s.hidden);
  const overlayHeader = !!(store.layout.header.settings.transparent && first && first.type === 'hero' && ['image', 'carousel', 'gradient'].includes(first.settings.layout));
  return { store, page: route.page, path, root, e: esc, t: paras, img, pic, framed, pframe, link, money, products, card, stars, btn, icon, isCurrent, allCollections, orderedCollections, collectionImage, collectionHref, productHref, editor, ed, blk, people: PEOPLE,
    collectionProducts: c => collectionProducts(store, c), product, collection, checkoutEnabled, overlayHeader, firstSectionId: first?.id, isSwatch, colorOf };
}

export function renderSection(sec, ctx) {
  const def = SECTIONS[sec.type];
  if (!def || sec.hidden) return '';
  try { return def.render(sec.settings, ctx, sec); }
  catch (err) { return `<section class="sec" data-sid="${sec.id}"><div class="wrap"><p class="empty">This section could not be shown (${esc(err.message)}).</p></div></section>`; }
}

function pageTitle(store, ctx) {
  const base = store.seo.title || store.name;
  if (ctx.page === 'home') return base;
  if (ctx.product) return `${ctx.product.title} – ${store.name}`;
  if (ctx.collection) return `${ctx.collection.title} – ${store.name}`;
  return `${PAGE_LABELS[ctx.page]} – ${store.name}`;
}

/**
 * Render a page as separate parts so the builder can patch a live preview in place:
 * { path, root, title, desc, themeColor, css, bodyClass, bodyStyle, ann, header, footer, overlays, sections: [{ id, html }], data }
 */
export function renderParts(store, route, opts) {
  const ctx = makeCtx(store, route, opts);
  const sections = store.pages[route.page] || [];
  const hero = ctx.overlayHeader ? sections.find(s => s.id === ctx.firstSectionId) : null;
  const overFg = hero ? hero.settings.textColor || (hero.settings.layout === 'gradient' ? store.theme.colors.primaryText : '#ffffff') : '';
  const drawer = (attr, title, id, inner) => `<div class="drawer" ${attr} hidden><div class="drawer-scrim" data-drawer-close></div>
    <aside class="drawer-panel" role="dialog" aria-modal="true" aria-labelledby="${id}"><div class="drawer-head"><h2 id="${id}">${title}</h2><button type="button" class="hicon x" data-drawer-close aria-label="Close ${title.toLowerCase()}">${icon('close')}</button></div>${inner}</aside></div>`;
  const cart = ctx.checkoutEnabled ? drawer('data-drawer', 'Your cart', 'drawer-title', `<div class="ship-bar" data-ship-bar hidden></div><div class="drawer-lines" data-drawer-lines></div><div class="drawer-foot" data-drawer-foot hidden><div data-discount-box></div><div class="summary" data-summary></div>
    <a class="btn btn-lg btn-wide" href="${ctx.link('checkout')}">Checkout</a><a class="link center" href="${ctx.link('cart')}">View cart</a></div>`) : '';
  const wish = drawer('data-wish-drawer', 'Wishlist', 'wish-title', '<div class="drawer-lines" data-wish-lines></div>');
  const search = `<div class="search" data-search hidden><div class="drawer-scrim" data-search-close></div><div class="search-panel" role="dialog" aria-modal="true" aria-label="Search products">
    <div class="search-bar">${icon('search')}<input type="search" data-search-input placeholder="Search products" aria-label="Search products" autocomplete="off"><button type="button" class="hicon" data-search-close aria-label="Close search">${icon('close')}</button></div>
    <div class="search-results" data-search-results aria-live="polite"></div></div></div>`;
  const preview = opts.mode !== 'export';
  return {
    path: ctx.path, root: ctx.root, title: pageTitle(store, ctx), desc: ctx.product ? ctx.product.description.slice(0, 160) : store.seo.description,
    themeColor: store.theme.colors.background, css: preview ? storeCss(store) : '',
    bodyClass: `page-${route.page}${ctx.overlayHeader ? ' has-over' : ''}`, bodyStyle: overFg ? `--over-fg:${overFg}` : '',
    ann: SECTIONS.announcement.render({}, ctx), header: renderSection(store.layout.header, ctx), footer: renderSection(store.layout.footer, ctx),
    overlays: cart + wish + search,
    sections: sections.map(s => ({ id: s.id, html: renderSection(s, ctx) })),
    data: preview && opts.script !== false ? JSON.stringify(runtimeData(store, opts.imageUrl, true, opts.commerce)) : '',
    script: opts.script === false ? '' : preview ? storeScript(store, opts.imageUrl, { preview: true, commerce: opts.commerce }) : '',
  };
}

/** Assemble parts into an HTML document. In the editor every part is wrapped in comment markers (<!--zp:key-->…<!--/zp:key-->). */
export function composePage(p, opts = {}) {
  const m = (k, html) => opts.editor ? `<!--zp:${k}-->${html}<!--/zp:${k}-->` : html;
  const preview = opts.mode !== 'export';
  const css = preview ? `<style data-store-css>${p.css}</style>` : `<link rel="stylesheet" href="${p.root}assets/styles.css">`;
  const js = opts.script === false ? '' : preview ? `<script>${p.script}</script>` : `<script src="${p.root}assets/store.js"></script>`;
  return `<!doctype html>
<html lang="en" data-root="${p.root}" data-path="${p.path}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(p.title)}</title>
${p.desc ? `<meta name="description" content="${esc(p.desc)}">` : ''}
<meta property="og:title" content="${esc(p.title)}">
<meta name="theme-color" content="${p.themeColor}">
${css}
</head>
<body class="${p.bodyClass}"${p.bodyStyle ? ` style="${p.bodyStyle}"` : ''}>
<a class="skip" href="#main">Skip to content</a>
${m('ann', p.ann)}
${m('header', p.header)}
<main id="main">
${p.sections.map(s => m('s:' + s.id, s.html)).join('\n')}
</main>
${m('footer', p.footer)}
${m('overlays', p.overlays)}
${js}${opts.editor ? `<script>(${editorAgent.toString()})(window, document);</script>` : ''}
</body>
</html>`;
}

export function renderPage(store, route, opts) { return composePage(renderParts(store, route, opts), opts); }

/** Difference between two renderParts results, as a patch for the preview agent (null = nothing changed). */
export function diffParts(a, b) {
  const patch = {}; let any = false;
  for (const k of ['css', 'title', 'bodyClass', 'bodyStyle', 'ann', 'header', 'footer', 'overlays', 'data']) if (a[k] !== b[k]) { patch[k] = b[k]; any = true; }
  const old = new Map(a.sections.map(s => [s.id, s.html]));
  const changed = {}, frames = {};
  for (const s of b.sections) if (old.get(s.id) !== s.html) {
    changed[s.id] = s.html; any = true;
    const f = old.has(s.id) ? frameDiff(old.get(s.id), s.html) : null;
    if (f) frames[s.id] = f;
  }
  if (Object.keys(changed).length) patch.sections = changed;
  if (Object.keys(frames).length) patch.frames = frames;
  const ao = a.sections.map(s => s.id).join(','), bo = b.sections.map(s => s.id).join(',');
  if (ao !== bo) { patch.order = b.sections.map(s => s.id); any = true; }
  return any ? patch : null;
}

// Framed images carry data-fr in the editor. When a section changed only in the src/srcset/style/class of those images
// (an alignment, zoom or fit edit), the patch also lists just those attributes, so the preview agent can update the
// existing <img> elements in place (no new elements, no image reload, no flicker) instead of replacing the section.
const FR_IMG = /<img\b[^>]*\bdata-fr="[^"]*"[^>]*>/g, FR_ATTR = / (src|srcset|style|class|onerror)="([^"]*)"/g;
const UNESC = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
const frAttrs = tag => { const o = { src: null, srcset: null, style: null, class: null, onerror: null }; tag.replace(FR_ATTR, (m, k, v) => { o[k] = v.replace(/&(amp|lt|gt|quot|#39);/g, e => UNESC[e]); return m; }); return o; };
/** { n: framed image count, set: [[index, { src, srcset, style, class, onerror } (null = remove; src only when it changed)]] } or null. */
export function frameDiff(a, b) {
  const ta = a.match(FR_IMG) || [], tb = b.match(FR_IMG) || [];
  if (!tb.length || ta.length !== tb.length) return null;
  const strip = h => h.replace(FR_IMG, t => t.replace(FR_ATTR, ''));
  if (strip(a) !== strip(b)) return null;
  const set = [];
  tb.forEach((t, i) => {
    if (t === ta[i]) return;
    const x = frAttrs(ta[i]), y = frAttrs(t);
    if (x.src === y.src && x.srcset === y.srcset) { delete y.src; delete y.srcset; delete y.onerror; }
    set.push([i, y]);
  });
  return { n: tb.length, set };
}

/** Data the runtime needs on every page (only active products; image/url paths are site-root-relative). */
export function runtimeData(store, imageUrl, preview = false, commerce = null) {
  const thumb = (ref, frame) => !ref ? '' : isPhoto(ref) ? photoSrc(ref, 'thumb', frame).src : imageUrl(ref);
  return {
    id: store.id, name: store.name, currency: store.currency, preview, commerce: checkoutConfig(store, commerce),
    checkout: { mode: store.checkout.mode, phone: store.checkout.phone.replace(/\D/g, ''), email: store.checkout.email, shippingNote: store.checkout.shippingNote, freeShipping: store.checkout.freeShipping || 0 },
    products: activeProducts(store).map(p => ({
      id: p.id, title: p.title, url: 'products/' + p.slug + '.html', image: thumb(p.images[0] || p.art, p.images[0] ? productFrame(p, 0) : null), ...(p.images[0] && frameStyle(productFrame(p, 0), { zoom: false }) ? { imageStyle: frameStyle(productFrame(p, 0), { zoom: false }) } : {}), fallback: p.art ? imageUrl(p.art) : '', category: p.category, price: p.price, compareAt: p.compareAt,
      options: p.options.map(o => o.name), paymentLink: store.checkout.paymentLinks[p.id] || '',
      variants: p.variants.map(v => ({ id: v.id, options: v.options, price: v.price, sku: v.sku, stock: v.stock })),
    })),
  };
}

export function storeScript(store, imageUrl, { preview = false, commerce = null } = {}) {
  const data = JSON.stringify(runtimeData(store, imageUrl, preview, commerce)).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, '');
  return `/* Storefront runtime — generated by Zertake Studio */\n(function () {\n'use strict';\nvar K = (${cartKit.toString()})();\n${commerceScript()}var D = ${data};\n(${storeRuntime.toString()})(K, D, window, document, CK);\n})();\n`;
}

export function storeCss(store) {
  const t = store.theme, c = t.colors;
  const pad = { compact: 56, comfortable: 96, airy: 136 }[t.density], gap = { compact: 16, comfortable: 24, airy: 32 }[t.density];
  const btnR = t.buttons === 'pill' ? '999px' : t.buttons === 'sharp' ? '0px' : Math.min(t.radius, 14) + 'px';
  const ratio = { square: '1 / 1', portrait: '4 / 5', landscape: '4 / 3' }[t.imageRatio];
  const shadow = { none: 'none', soft: '0 1px 2px rgba(0,0,0,.04), 0 12px 32px -12px rgba(0,0,0,.18)', strong: '0 2px 6px rgba(0,0,0,.08), 0 30px 60px -20px rgba(0,0,0,.35)' }[t.shadow];
  const hs = { regular: 0.85, large: 1, huge: 1.18 }[t.headingScale], track = { tight: '-0.035em', normal: '-0.01em', wide: '0.04em' }[t.tracking];
  const vars = `:root{--bg:${c.background};--surface:${c.surface};--text:${c.text};--muted:${c.muted};--primary:${c.primary};--on-primary:${c.primaryText};--accent:${c.accent};--border:${c.border};
--font-h:${FONT_STACKS[t.fonts.heading][1]};--font-b:${FONT_STACKS[t.fonts.body][1]};--hw:${t.headingWeight};--hcase:${t.headingCase};--hs:${hs};--track:${track};
--r:${t.radius}px;--r-lg:${Math.min(36, Math.round(t.radius * 1.5))}px;--r-sm:${Math.round(t.radius * .6)}px;--btn-r:${btnR};--pad:${pad}px;--gap:${gap}px;--ratio:${ratio};--shadow:${shadow}}`;
  const btn = t.buttons === 'outline'
    ? '.btn{background:transparent;color:var(--text);border:1.5px solid currentColor}.btn:hover{background:var(--text);color:var(--bg);border-color:var(--text)}'
    : '.btn{background:var(--primary);color:var(--on-primary);border:1.5px solid var(--primary)}.btn:hover{transform:translateY(-1px);box-shadow:0 10px 24px -10px var(--primary)}';
  const card = t.cardStyle === 'card' ? '.pcard{background:var(--surface);border-radius:var(--r-lg);padding:8px;box-shadow:var(--shadow)}.pcard-body{padding:14px 10px 8px}'
    : t.cardStyle === 'bordered' ? '.pcard{border:1px solid var(--border);border-radius:var(--r-lg);padding:8px}.pcard-body{padding:14px 10px 8px}' : '';
  return vars + '\n' + BASE_CSS + btn + card;
}

const BASE_CSS = `*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.65 var(--font-b);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;overflow-x:hidden}
img{max-width:100%;display:block}
:has(>img.fz){overflow:hidden}
a{color:inherit;text-decoration-thickness:1px;text-underline-offset:3px}
h1,h2,h3{font-family:var(--font-h);font-weight:var(--hw);text-transform:var(--hcase);line-height:1.04;margin:0 0 .45em;letter-spacing:var(--track);text-wrap:balance}
p{margin:0 0 1em}
button,input,select,textarea{font:inherit;color:inherit}
:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
[hidden]{display:none!important}
::selection{background:var(--accent);color:#fff}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.skip{position:absolute;left:-9999px;top:0;background:var(--primary);color:var(--on-primary);padding:8px 14px;z-index:100}.skip:focus{left:8px}
.wrap{max-width:1360px;margin:0 auto;padding:0 clamp(16px,4vw,48px)}
.sec{padding:var(--pad) 0}
.sec-head{margin-bottom:clamp(24px,3vw,44px);max-width:760px}.sec-head.center{text-align:center;margin-left:auto;margin-right:auto}.sec-head.flat{margin-bottom:0}
.sec-head.row{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;max-width:none}
.sec-title{font-size:calc(clamp(30px,4.2vw,60px) * var(--hs));margin:0}
.sec-sub{color:var(--muted);max-width:620px;margin-top:14px;font-size:17px}.center .sec-sub{margin-left:auto;margin-right:auto}.sec-sub p:last-child{margin:0}
.eyebrow{display:inline-flex;align-items:center;gap:8px;text-transform:uppercase;letter-spacing:.16em;font-size:12px;font-weight:600;color:var(--accent);margin:0 0 14px}
.eyebrow::before{content:"";width:18px;height:1.5px;background:currentColor}
.al-center{text-align:center}.al-center .sec-sub,.al-center .hero-text{margin-left:auto;margin-right:auto}.al-center .btns{justify-content:center}.al-center .eyebrow::before{display:none}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:10px;min-height:48px;padding:0 28px;border-radius:var(--btn-r);font-weight:600;text-decoration:none;cursor:pointer;transition:transform .25s cubic-bezier(.2,.7,.3,1),box-shadow .25s,background .2s,color .2s,filter .2s;font-size:15px;letter-spacing:.01em;white-space:nowrap}
.btn-lg{min-height:56px;padding:0 34px;font-size:16px}
.btn:disabled{opacity:.45;cursor:not-allowed;transform:none!important;box-shadow:none!important}
.btn-wide{width:100%}
.btn.btn-ghost{background:transparent;color:inherit;border:1.5px solid currentColor;box-shadow:none}.btn.btn-ghost:hover{background:color-mix(in srgb,currentColor 14%,transparent)}
.btn.btn-inv{background:var(--bg);color:var(--text);border-color:var(--bg)}
.btns{display:flex;flex-wrap:wrap;gap:12px;margin-top:32px}
.link{background:none;border:0;padding:0;text-decoration:underline;cursor:pointer;color:var(--muted);font-size:14px}.link.center{display:block;text-align:center;margin-top:14px}
.more{display:inline-flex;align-items:center;gap:8px;font-weight:600;text-decoration:none;white-space:nowrap;padding-bottom:4px;border-bottom:1.5px solid currentColor}.more .ico{transition:transform .25s}.more:hover .ico{transform:translateX(4px)}
.round{display:inline-grid;place-items:center;width:52px;height:52px;border-radius:50%;border:0;background:#111;color:#fff;cursor:pointer;transition:transform .2s,background .2s,opacity .2s;flex:none}.round:hover{transform:scale(1.06)}
.round.light{background:var(--bg);color:var(--text);box-shadow:inset 0 0 0 1px var(--border)}.round.sm{width:40px;height:40px}
.arrows{display:flex;gap:10px}
.note{color:var(--muted);font-size:14px}.note.small{font-size:12.5px}.note.warn{color:#b42318}.note .ico{width:16px;height:16px;vertical-align:-3px}
.empty{color:var(--muted)}
.badge{position:absolute;top:14px;left:14px;z-index:2;background:var(--bg);color:var(--text);font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:6px 11px;border-radius:999px;box-shadow:0 2px 8px rgba(0,0,0,.08)}
.badge.sale{background:var(--accent);color:#fff}.badge.sold{background:var(--text);color:var(--bg)}
.ico{flex:none;vertical-align:middle}
/* reveal on scroll (only when the runtime runs; respects reduced motion) */
.js:not(.editing) [data-reveal]{opacity:0;transform:translateY(32px);transition:opacity .9s cubic-bezier(.2,.7,.2,1),transform .9s cubic-bezier(.2,.7,.2,1)}
.js:not(.editing) [data-reveal].in{opacity:1;transform:none}
.js:not(.editing) [data-reveal] .grid>*{transition:opacity .7s,transform .7s}
.js:not(.editing) [data-reveal]:not(.in) .grid>*{opacity:0;transform:translateY(20px)}
.grid>*:nth-child(2){transition-delay:.08s}.grid>*:nth-child(3){transition-delay:.16s}.grid>*:nth-child(4){transition-delay:.24s}.grid>*:nth-child(5){transition-delay:.32s}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}*,*::before,*::after{animation-duration:.001s!important;animation-iteration-count:1!important;transition-duration:.001s!important}.js:not(.editing) [data-reveal],.js:not(.editing) [data-reveal]:not(.in) .grid>*{opacity:1;transform:none}}
/* announcement */
.ann{background:var(--primary);color:var(--on-primary);font-size:13px;letter-spacing:.03em;overflow:hidden;position:relative;z-index:31}.ann a{text-decoration:none;display:block}
.ann-static{display:flex;justify-content:center;gap:18px;padding:10px 16px;text-align:center;flex-wrap:wrap}.ann-static i,.ann-run i{opacity:.6;font-style:normal}
.ann-track{display:flex;width:max-content;animation:zmq 38s linear infinite}.ann-run{display:flex;gap:28px;padding:10px 14px;white-space:nowrap}
.ann:hover .ann-track{animation-play-state:paused}
@keyframes zmq{to{transform:translateX(-50%)}}
/* header */
.site-header{--hfg:var(--text);position:relative;z-index:30;color:var(--hfg);background:color-mix(in srgb,var(--bg) 92%,transparent);border-bottom:1px solid color-mix(in srgb,var(--border) 70%,transparent);transition:background .35s,color .35s,border-color .35s,box-shadow .35s}
.site-header.sticky{position:sticky;top:0}
.site-header.scrolled{background:color-mix(in srgb,var(--bg) 78%,transparent);-webkit-backdrop-filter:saturate(1.6) blur(16px);backdrop-filter:saturate(1.6) blur(16px);box-shadow:0 8px 30px -18px rgba(0,0,0,.35)}
.site-header.over{margin-bottom:-78px}
.site-header.over:not(.scrolled){--hfg:var(--over-fg,#fff);background:transparent;border-color:transparent}
.hdr-in{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:24px;height:78px}
.logo{font-family:var(--font-h);font-weight:var(--hw);text-transform:var(--hcase);font-size:24px;text-decoration:none;letter-spacing:var(--track);display:flex;align-items:center;color:inherit;white-space:nowrap}
.nav{display:flex;gap:clamp(16px,2.4vw,36px);justify-content:center}.nav a{text-decoration:none;font-size:15px;font-weight:500;position:relative;padding:6px 0;opacity:.88;transition:opacity .2s}
.nav a::after{content:"";position:absolute;left:0;right:0;bottom:0;height:1.5px;background:currentColor;transform:scaleX(0);transform-origin:right;transition:transform .35s cubic-bezier(.2,.7,.2,1)}
.nav a:hover,.nav a[aria-current]{opacity:1}.nav a:hover::after,.nav a[aria-current]::after{transform:scaleX(1);transform-origin:left}
.hdr-actions{display:flex;gap:4px;justify-content:flex-end}
.hicon{position:relative;display:inline-grid;place-items:center;width:44px;height:44px;border-radius:50%;border:0;background:transparent;color:inherit;cursor:pointer;text-decoration:none;transition:background .2s}.hicon:hover{background:color-mix(in srgb,currentColor 10%,transparent)}
.hicon .ico{width:22px;height:22px}
.hcount{position:absolute;top:3px;right:1px;min-width:19px;height:19px;padding:0 5px;border-radius:10px;background:var(--accent);color:#fff;font-size:11px;font-weight:700;display:grid;place-items:center;line-height:1}
.menu-toggle{display:none}
.hdr-split .logo{grid-column:1}.hdr-split .nav{grid-column:2}.hdr-split .hdr-actions{grid-column:3}
.hdr-left .hdr-in{grid-template-columns:auto 1fr auto}.hdr-left .nav{justify-content:flex-start;margin-left:20px}
.hdr-centered .hdr-in{grid-template-columns:1fr auto 1fr;height:auto;padding-top:14px;row-gap:4px}.hdr-centered .logo{grid-column:2;grid-row:1;font-size:28px}.hdr-centered .nav{grid-column:1/-1;grid-row:2;padding:4px 0 12px}.hdr-centered .hdr-actions{grid-column:3;grid-row:1}.hdr-centered .menu-toggle{grid-column:1;grid-row:1}
.hdr-centered.over{margin-bottom:-112px}
.hdr-minimal .hdr-in{grid-template-columns:auto 1fr auto}.hdr-minimal .menu-toggle{display:inline-grid}.hdr-minimal .logo{grid-column:2;justify-content:center}.hdr-minimal .nav{display:none}
.navdrawer{position:fixed;inset:0;z-index:60}
.navdrawer-panel{position:absolute;left:0;top:0;bottom:0;width:min(400px,88%);background:var(--bg);color:var(--text);padding:20px 24px;display:flex;flex-direction:column;animation:zinl .35s cubic-bezier(.2,.7,.2,1)}
.navdrawer-links{display:grid;margin-top:16px}.navdrawer-links a{display:flex;justify-content:space-between;align-items:center;padding:16px 0;border-bottom:1px solid var(--border);text-decoration:none;font:var(--hw) 26px/1.2 var(--font-h);text-transform:var(--hcase);letter-spacing:var(--track)}
@keyframes zinl{from{transform:translateX(-40px);opacity:0}}
/* hero */
.hero{position:relative;overflow:hidden;background:var(--hero-bg,var(--surface));color:var(--hero-fg,var(--text))}
.hero.h-small{--hh:440px}.hero.h-medium{--hh:600px}.hero.h-large{--hh:clamp(560px,92vh,820px)}.hero.h-full{--hh:clamp(600px,100vh,1000px)}
.hero-copy{position:relative;z-index:2;max-width:760px}.al-center .hero-copy{margin:0 auto}
.hero-title{font-size:calc(clamp(44px,7.4vw,124px) * var(--hs));line-height:.96;margin:0 0 .3em}
.hero-text{font-size:clamp(16px,1.4vw,20px);max-width:540px;opacity:.86}.hero-text p:last-child{margin:0}
.hero .eyebrow{color:inherit;opacity:.85}
.hero-media{position:absolute;inset:0}.hero-media img{width:100%;height:100%;object-fit:cover;transform:scale(1.04);animation:zken 18s ease-out forwards}
@keyframes zken{to{transform:scale(1)}}
.hero-shade{position:absolute;inset:0;background:linear-gradient(90deg,rgba(0,0,0,calc(var(--ov) + .25)) 0%,rgba(0,0,0,var(--ov)) 45%,rgba(0,0,0,calc(var(--ov) * .3)) 100%),linear-gradient(0deg,rgba(0,0,0,calc(var(--ov) * .8)),transparent 40%)}
.al-center .hero-shade{background:rgba(0,0,0,var(--ov))}
.hl-image,.hl-carousel{--hero-fg-d:#fff;color:var(--hero-fg,#fff);background:var(--hero-bg,#1c1a18)}
.hl-image{min-height:var(--hh);display:flex;align-items:flex-end}.hl-image>.wrap{width:100%;padding-top:140px;padding-bottom:clamp(48px,8vh,96px)}
.hl-image .btn:not(.btn-ghost),.hl-carousel .btn:not(.btn-ghost){background:var(--hero-fg,#fff);color:#111;border-color:var(--hero-fg,#fff)}
.hl-carousel{min-height:var(--hh)}
.hero-track{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;overscroll-behavior-x:contain}.hero-track::-webkit-scrollbar{display:none}
.hero-slide{position:relative;flex:0 0 100%;scroll-snap-align:start;min-height:var(--hh);display:flex;align-items:flex-end}
.hero-slide>.wrap{position:relative;z-index:2;width:100%;padding-top:140px;padding-bottom:clamp(110px,14vh,150px)}
.hero-ctrl{position:absolute;left:0;right:0;bottom:clamp(28px,5vh,48px);z-index:3;display:flex;align-items:center;gap:20px}
.dots{display:flex;gap:8px}.dots button{width:28px;height:4px;border-radius:4px;border:0;padding:0;background:currentColor;opacity:.35;cursor:pointer;transition:width .35s,opacity .35s}.dots button[aria-current]{width:56px;opacity:1}
.counter{font:600 13px/1 var(--font-b);letter-spacing:.12em;opacity:.85;font-variant-numeric:tabular-nums}
.hero-ctrl .arrows{margin-left:auto}.hero-ctrl .round{background:rgba(10,10,10,.85);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}
.hl-split{background:var(--hero-bg,var(--bg));padding:calc(var(--pad) * .5) 0}
.hero-split{display:grid;grid-template-columns:1fr 1.05fr;gap:clamp(24px,4vw,64px);align-items:stretch;min-height:calc(var(--hh) - var(--pad))}
.hero-panel{display:flex;align-items:center;padding:clamp(24px,4vw,56px) 0}
.hero-media.rounded{position:relative;border-radius:var(--r-lg);overflow:hidden;min-height:420px;box-shadow:var(--shadow)}.hero-media.rounded img{position:absolute;inset:0}
.hl-gradient{min-height:var(--hh);display:flex;align-items:center;color:var(--hero-fg,var(--on-primary));background:var(--hero-bg,var(--primary))}
.hero-orbs i{position:absolute;border-radius:50%;filter:blur(70px);opacity:.75;animation:zorb 18s ease-in-out infinite alternate}
.hero-orbs i:nth-child(1){width:55vw;height:55vw;left:-15vw;top:-20vw;background:var(--accent)}.hero-orbs i:nth-child(2){width:40vw;height:40vw;right:-10vw;bottom:-15vw;background:color-mix(in srgb,var(--accent) 50%,#fff);animation-delay:-6s}.hero-orbs i:nth-child(3){width:30vw;height:30vw;left:40%;top:30%;background:color-mix(in srgb,var(--primary) 60%,#000);animation-delay:-11s}
@keyframes zorb{to{transform:translate(8vw,6vh) scale(1.15)}}
.hero-grad{position:relative;z-index:2;display:grid;grid-template-columns:1.2fr .8fr;gap:48px;align-items:center;width:100%;padding-top:120px;padding-bottom:80px}
.hero-float{border-radius:var(--r-lg);overflow:hidden;aspect-ratio:4/5;box-shadow:0 40px 80px -30px rgba(0,0,0,.5);transform:rotate(2deg)}.hero-float img{width:100%;height:100%;object-fit:cover}
.hl-gradient .btn:not(.btn-ghost){background:var(--on-primary);color:var(--primary);border-color:var(--on-primary)}
.hl-text{background:var(--hero-bg,var(--bg))}.hl-text .wrap{padding-top:calc(var(--pad) * 1.1);padding-bottom:calc(var(--pad) * .8)}.hl-text .hero-copy{max-width:1100px}.hl-text .hero-title{font-size:calc(clamp(52px,10vw,168px) * var(--hs))}
.under-header .hero-copy{margin-top:20px}
/* marquee */
.marquee{overflow:hidden;padding:clamp(18px,3vw,34px) 0;border-block:1px solid var(--border)}
.mq-track{display:flex;width:max-content;animation:zmq var(--speed) linear infinite}.mq-run{display:flex;align-items:center;gap:clamp(20px,3vw,48px);padding-right:clamp(20px,3vw,48px)}
.mq-run span{font:var(--hw) calc(clamp(34px,5.4vw,84px) * var(--hs))/1 var(--font-h);text-transform:var(--hcase);letter-spacing:var(--track);white-space:nowrap}
.mq-run i{font-style:normal;color:var(--accent);font-size:clamp(20px,2.4vw,34px)}
.mq-outline span{color:transparent;-webkit-text-stroke:1.2px var(--text)}
.mq-accent{background:var(--accent);color:#fff;border:0}.mq-accent i{color:inherit}
/* grids & product cards */
.grid{display:grid;gap:var(--gap)}.cols-1{grid-template-columns:1fr}.cols-2{grid-template-columns:repeat(2,1fr)}.cols-3{grid-template-columns:repeat(3,1fr)}.cols-4{grid-template-columns:repeat(4,1fr)}.cols-5{grid-template-columns:repeat(5,1fr)}
.pgrid{row-gap:calc(var(--gap) * 1.8)}
.pcard{position:relative;display:flex;flex-direction:column;min-width:0}
.pcard-media{position:relative;border-radius:var(--r);overflow:hidden;background:var(--surface);aspect-ratio:var(--ratio)}
.pcard-img{position:absolute;inset:0;display:block}
.pcard-img img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transition:opacity .5s ease,transform 1.1s cubic-bezier(.2,.7,.2,1)}.pcard-img img.alt{opacity:0}
.pcard:hover .pcard-img img{transform:scale(1.05)}.pcard:hover .pcard-img img.alt{opacity:1}
.wish{position:absolute;top:12px;right:12px;z-index:2;width:38px;height:38px;border-radius:50%;border:0;display:grid;place-items:center;background:color-mix(in srgb,var(--bg) 88%,transparent);color:var(--text);cursor:pointer;opacity:0;transform:translateY(-4px);transition:opacity .25s,transform .25s,color .2s}
.pcard:hover .wish,.wish:focus-visible,.wish[aria-pressed=true]{opacity:1;transform:none}.wish[aria-pressed=true]{color:#e0245e}.wish[aria-pressed=true] .ico path,.wish-lg[aria-pressed=true] .ico path{fill:currentColor}.wish .ico{width:18px;height:18px}
.quick{position:absolute;left:12px;right:12px;bottom:12px;z-index:2;display:flex;align-items:center;justify-content:center;gap:8px;min-height:44px;border:0;border-radius:var(--btn-r);background:color-mix(in srgb,var(--bg) 92%,transparent);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);color:var(--text);font-weight:600;font-size:14px;cursor:pointer;text-decoration:none;opacity:0;transform:translateY(10px);transition:opacity .3s,transform .3s,background .2s,color .2s}
.quick .ico{width:16px;height:16px}.quick:hover{background:var(--primary);color:var(--on-primary)}
.pcard:hover .quick,.quick:focus-visible{opacity:1;transform:none}
@media (hover:none){.quick,.wish{opacity:1;transform:none}.quick span{display:none}.quick{left:auto;width:44px;padding:0;border-radius:50%}}
.pcard-body{padding:16px 2px 4px}.pcard-body h3{font:600 16px/1.35 var(--font-b);margin:0 0 4px;text-transform:none;letter-spacing:0}.pcard-body h3 a{text-decoration:none}.pcard-body h3 a::after{content:"";position:absolute;inset:0;z-index:1}
.price{margin:0;font-weight:600;font-variant-numeric:tabular-nums}.price s,.compare{color:var(--muted);font-weight:400;margin-left:6px}.price .from{color:var(--muted);font-weight:400;font-size:.9em}
.pcard-meta{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:8px;position:relative;z-index:2}
.rating{display:inline-flex;align-items:center;gap:6px;color:var(--text)}.rating small{color:var(--muted);font-size:13px}
.stars-bg{position:relative;display:inline-flex;color:color-mix(in srgb,var(--text) 18%,transparent)}.stars-bg .ico,.stars-fg .ico{width:14px;height:14px}
.stars-fg{position:absolute;left:0;top:0;display:inline-flex;overflow:hidden;white-space:nowrap;color:var(--accent)}
.swatches-mini{display:inline-flex;align-items:center;gap:5px}.swatches-mini i{width:14px;height:14px;border-radius:50%;box-shadow:inset 0 0 0 1px rgba(0,0,0,.15)}.swatches-mini small{color:var(--muted);font-size:12px}
.ptrack{display:grid;grid-auto-flow:column;grid-auto-columns:calc((100% - 3 * var(--gap)) / 4);gap:var(--gap);overflow-x:auto;scroll-snap-type:x mandatory;padding:4px 0 12px;scrollbar-width:none;margin-top:clamp(24px,3vw,40px)}.ptrack::-webkit-scrollbar{display:none}.ptrack>*{scroll-snap-align:start}
/* category cards */
.ccard{position:relative;display:block;border-radius:var(--r-lg);overflow:hidden;background:var(--surface);text-decoration:none;isolation:isolate;aspect-ratio:3/4}
.cc-square .ccard{aspect-ratio:1}.cc-wide .ccard{aspect-ratio:4/3}
.ccard img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transition:transform 1.2s cubic-bezier(.2,.7,.2,1)}.ccard:hover img{transform:scale(1.07)}
.ccard::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,transparent 45%,rgba(0,0,0,.55));z-index:0}
.ccard-label{position:absolute;left:16px;right:16px;bottom:16px;z-index:1;display:flex;align-items:flex-end;justify-content:space-between;gap:12px;color:#fff}
.ccard-label b{display:block;font:var(--hw) calc(clamp(22px,2.2vw,32px) * var(--hs))/1.05 var(--font-h);text-transform:var(--hcase);letter-spacing:var(--track)}.ccard-label small{opacity:.85;font-size:13px}
.ccard .round{background:#fff;color:#111;transition:transform .3s}.ccard:hover .round{transform:rotate(-45deg)}
/* editorial image + text */
.split{display:grid;grid-template-columns:1.1fr 1fr;gap:clamp(32px,6vw,96px);align-items:center}.split.rev .split-media{order:2}
.split-media{border-radius:var(--r-lg);overflow:hidden;aspect-ratio:4/5;background:var(--surface)}.split-media img{width:100%;height:100%;object-fit:cover}
.split-copy .prose{font-size:17px;max-width:520px}
.it-overlap .split{grid-template-columns:1fr;position:relative}.it-overlap .split-media{aspect-ratio:16/8}
.it-overlap .split-copy{position:relative;margin:-140px 0 0 clamp(16px,6vw,96px);max-width:560px;background:var(--bg);padding:clamp(28px,4vw,52px);border-radius:var(--r-lg);box-shadow:var(--shadow)}.it-overlap .split.rev .split-copy{margin-left:auto;margin-right:clamp(16px,6vw,96px)}
.it-full{padding:0}.it-full .wrap{max-width:none;padding:0}.it-full .split{grid-template-columns:1fr;position:relative;min-height:80vh}.it-full .split-media{position:absolute;inset:0;border-radius:0;aspect-ratio:auto}
.it-full .split-media::after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,rgba(0,0,0,.6),rgba(0,0,0,.1))}.it-full .split-copy{position:relative;z-index:1;color:#fff;padding:var(--pad) clamp(16px,6vw,96px);max-width:720px}.it-full .prose{color:#fff;opacity:.88}.it-full .btn{background:#fff;color:#111;border-color:#fff}
.prose{color:var(--muted)}.prose p:last-child{margin-bottom:0}
/* bento */
.bento-grid{display:grid;gap:var(--gap);grid-template-columns:repeat(4,1fr);grid-auto-rows:minmax(220px,auto)}
.tile{position:relative;border-radius:var(--r-lg);overflow:hidden;background:var(--surface);padding:clamp(22px,2.4vw,34px);display:flex;flex-direction:column;justify-content:flex-end;text-decoration:none;min-height:240px;isolation:isolate;transition:transform .4s cubic-bezier(.2,.7,.2,1)}
a.tile:hover{transform:translateY(-4px)}
.tile img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:-2;transition:transform 1.2s cubic-bezier(.2,.7,.2,1)}.tile:hover img{transform:scale(1.06)}
.tile.has-img{color:#fff}.tile.has-img::before{content:"";position:absolute;inset:0;z-index:-1;background:linear-gradient(180deg,rgba(0,0,0,0) 35%,rgba(0,0,0,.65))}
.tile h3{font-size:calc(clamp(22px,2.2vw,34px) * var(--hs));margin:0 0 6px}.tile p{margin:0;opacity:.85;max-width:420px}.tile .round{position:absolute;top:18px;right:18px;background:var(--bg);color:var(--text)}
.n3 .t0{grid-column:span 2;grid-row:span 2}.n3 .t1,.n3 .t2{grid-column:span 2}
.n4 .t0{grid-column:span 2;grid-row:span 2}.n4 .t3{grid-column:span 2}
.n5 .t0{grid-column:span 2;grid-row:span 2}.n2 .tile{grid-column:span 2;min-height:420px}.n1 .tile{grid-column:1/-1;min-height:420px}
.tile:not(.has-img):nth-child(even){background:var(--primary);color:var(--on-primary)}
/* features */
.feature{display:flex;flex-direction:column;gap:18px;padding:clamp(24px,2.6vw,36px);border-radius:var(--r-lg);background:var(--surface);height:100%}
.f-icon{display:inline-grid;place-items:center;width:56px;height:56px;border-radius:18px;background:var(--bg);color:var(--accent);box-shadow:var(--shadow)}.f-icon .ico{width:26px;height:26px}
.feature h3{font-size:calc(22px * var(--hs));margin:0 0 6px}.feature p{color:var(--muted);margin:0}
.f-strip{padding:clamp(28px,4vw,48px) 0;border-block:1px solid var(--border)}.f-strip .feature{flex-direction:row;align-items:center;background:none;padding:0}.f-strip .f-icon{width:48px;height:48px;border-radius:50%;box-shadow:none;background:var(--surface)}.f-strip h3{font:600 16px var(--font-b);text-transform:none;letter-spacing:0;margin:0 0 2px}.f-strip p{font-size:14px}
/* testimonials */
.quote{margin:0;padding:clamp(26px,3vw,40px);background:var(--surface);border-radius:var(--r-lg);display:flex;flex-direction:column;gap:18px;height:100%}
.quote .stars{display:flex;color:var(--accent)}.quote .stars .ico{width:17px;height:17px}
.quote blockquote{margin:0;font:400 calc(clamp(18px,1.6vw,22px) * var(--hs))/1.45 var(--font-h);letter-spacing:-.005em;flex:1}
.quote figcaption{display:flex;align-items:center;gap:14px;font-size:14px}.quote figcaption small{display:block;color:var(--muted)}
.avatar{width:48px;height:48px;border-radius:50%;object-fit:cover;flex:none}.avatar.initials{display:grid;place-items:center;background:var(--primary);color:var(--on-primary);font-weight:700;font-size:15px}
/* logos */
.logos{padding:calc(var(--pad) * .5) 0}.logos-title{text-align:center;color:var(--muted);text-transform:uppercase;letter-spacing:.18em;font-size:12px;margin-bottom:24px}
.logo-row{list-style:none;padding:0;margin:0;display:flex;flex-wrap:wrap;justify-content:center;gap:24px clamp(32px,6vw,80px);align-items:center}
.logo-row img{max-height:40px;width:auto;opacity:.7}.wordmark{font-size:24px;opacity:.5;font-weight:700;transition:opacity .2s}.wordmark:hover{opacity:.9}.wm1{font-family:Georgia,serif;font-style:italic}.wm2{letter-spacing:.24em;text-transform:uppercase;font-size:16px}.wm3{font-family:ui-monospace,monospace}
/* faq + curriculum */
.faq-grid{display:grid;grid-template-columns:.9fr 1.1fr;gap:clamp(32px,6vw,96px);align-items:start}.faq-grid .sec-head{position:sticky;top:110px}
.faq-list details,.acc details{border-bottom:1px solid var(--border)}
.faq-list summary,.acc summary,.modules summary{cursor:pointer;list-style:none;display:flex;justify-content:space-between;align-items:center;gap:16px}
.faq-list summary::-webkit-details-marker,.acc summary::-webkit-details-marker,.modules summary::-webkit-details-marker{display:none}
.faq-list summary{padding:24px 0;font:600 calc(19px * var(--hs))/1.35 var(--font-b)}
summary i{display:grid;place-items:center;width:36px;height:36px;border-radius:50%;background:var(--surface);flex:none;transition:transform .3s,background .3s}details[open]>summary i{transform:rotate(45deg);background:var(--primary);color:var(--on-primary)}
.faq-list .prose{padding:0 52px 24px 0}
.modules{list-style:none;padding:0;margin:0;display:grid;gap:12px}.modules details{border-radius:var(--r-lg);background:var(--surface)}
.modules summary{padding:22px 24px}.m-no{font:var(--hw) 15px var(--font-h);color:var(--accent)}.m-title{font-weight:600;flex:1;font-size:17px}.m-title small{display:block;color:var(--muted);font-weight:400;font-size:13px}
.modules ul{list-style:none;margin:0;padding:0 24px 22px 62px;display:grid;gap:10px;color:var(--muted)}.modules li li{display:flex;gap:10px;align-items:center}
/* pricing */
.plan{position:relative;padding:clamp(28px,3vw,40px);border:1px solid var(--border);border-radius:var(--r-lg);background:var(--bg);display:flex;flex-direction:column;gap:6px;transition:transform .35s,box-shadow .35s}.plan:hover{transform:translateY(-4px);box-shadow:var(--shadow)}
.plan.hl{background:var(--primary);color:var(--on-primary);border-color:var(--primary)}.plan.hl li .ico{color:inherit}.plan.hl .plan-price small{color:inherit;opacity:.7}
.plan.hl .btn{background:var(--on-primary);color:var(--primary);border-color:var(--on-primary)}
.plan .badge{position:static;align-self:flex-start;margin-bottom:10px;background:var(--accent);color:#fff}.plan h3{font-size:calc(24px * var(--hs));margin:0}
.plan-price{font:var(--hw) calc(clamp(40px,4vw,56px) * var(--hs))/1.05 var(--font-h);letter-spacing:var(--track);margin:8px 0 18px}.plan-price small{font:400 15px var(--font-b);color:var(--muted);margin-left:6px;letter-spacing:0}
.plan ul{list-style:none;padding:0;margin:0 0 28px;display:grid;gap:12px;flex:1}.plan li{display:flex;gap:10px}.plan li .ico{color:var(--accent);width:18px;height:18px;margin-top:3px}
/* newsletter */
.nl-card{position:relative;border-radius:var(--r-lg);overflow:hidden;background:var(--surface);padding:clamp(40px,7vw,96px) clamp(20px,5vw,64px);isolation:isolate}
.nl-media{position:absolute;inset:0;z-index:-1}.nl-media img{width:100%;height:100%;object-fit:cover}.nl-media::after{content:"";position:absolute;inset:0;background:rgba(0,0,0,.5)}
.nl-photo .nl-card{color:#fff}.nl-photo .sec-sub{color:#fff;opacity:.85}.nl-photo .eyebrow{color:#fff}
.nl-form{display:flex;gap:10px;max-width:520px;margin:0 auto;padding:6px;border-radius:calc(var(--btn-r) + 6px);background:var(--bg);box-shadow:var(--shadow)}
.nl-form input{flex:1;min-width:0;height:52px;padding:0 18px;border:0;background:transparent;color:var(--text)}.nl-form input:focus{outline:none}.nl-form .btn{min-height:52px}
/* rich text */
.rt-large .prose{font:400 calc(clamp(24px,3vw,42px) * var(--hs))/1.25 var(--font-h);color:var(--text);letter-spacing:var(--track);max-width:1000px}.al-center.rt-large .prose{margin:0 auto}
.richtext .sec-title{margin-bottom:24px}.rt-regular .prose{max-width:720px;font-size:18px}.al-center.rt-regular .prose{margin:0 auto}
/* banner */
.banner-in{position:relative;overflow:hidden;border-radius:var(--r-lg);padding:clamp(48px,8vw,120px) clamp(24px,5vw,72px);text-align:center;isolation:isolate}
.b-solid .banner-in{background:var(--accent);color:#fff}.b-solid .sec-sub{color:inherit;opacity:.9}
.b-outline .banner-in{border:1.5px solid var(--text)}
.b-image .banner-in{color:#fff;background:#222}.banner-media{position:absolute;inset:0;z-index:-1}.banner-media img{width:100%;height:100%;object-fit:cover}.banner-media::after{content:"";position:absolute;inset:0;background:rgba(0,0,0,.45)}.b-image .sec-sub{color:#fff}
.banner-copy{max-width:760px;margin:0 auto}.banner-copy .sec-sub{margin:16px auto 28px}.banner .eyebrow{color:inherit}
.b-outline .btn-inv{background:var(--primary);color:var(--on-primary);border-color:var(--primary)}
/* countdown */
.cd-card{display:grid;grid-template-columns:1fr;gap:0;border-radius:var(--r-lg);overflow:hidden;background:var(--primary);color:var(--on-primary)}.cd-photo .cd-card{grid-template-columns:1.1fr .9fr}
.cd-copy{padding:clamp(36px,5vw,72px)}.cd-copy .sec-sub{color:inherit;opacity:.8}.cd-copy .eyebrow{color:inherit}
.cd-media{position:relative;min-height:320px}.cd-media img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.cd{display:flex;gap:12px;flex-wrap:wrap}.cd div{min-width:92px;padding:18px 12px 14px;border-radius:var(--r);background:color-mix(in srgb,var(--on-primary) 10%,transparent);text-align:center}
.cd span{display:block;font:var(--hw) calc(44px * var(--hs))/1 var(--font-h);font-variant-numeric:tabular-nums;letter-spacing:var(--track)}.cd small{opacity:.7;font-size:12px;text-transform:uppercase;letter-spacing:.12em}
.cd-copy .btn{background:var(--on-primary);color:var(--primary);border-color:var(--on-primary)}
/* gallery + insta */
.gallery figure{margin:0;border-radius:var(--r-lg);overflow:hidden;position:relative}.gallery img{width:100%;aspect-ratio:4/5;object-fit:cover;transition:transform 1.1s cubic-bezier(.2,.7,.2,1)}.gallery figure:hover img{transform:scale(1.05)}
.gallery .g1 img,.gallery .g3 img{aspect-ratio:1}.gallery figcaption{position:absolute;left:14px;bottom:14px;background:var(--bg);padding:6px 12px;border-radius:999px;font-size:13px}
.handle{color:var(--muted);text-decoration:none;font-weight:600}.insta-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:clamp(6px,1vw,14px)}
.insta-cell{position:relative;aspect-ratio:1;overflow:hidden;border-radius:var(--r)}.insta-cell img{width:100%;height:100%;object-fit:cover;transition:transform .8s}.insta-cell span{position:absolute;inset:0;display:grid;place-items:center;background:rgba(0,0,0,.35);color:#fff;opacity:0;transition:opacity .3s}
.insta-cell:hover span{opacity:1}.insta-cell:hover img{transform:scale(1.08)}
/* locations */
.loc-wrap{display:grid;gap:clamp(24px,5vw,72px);align-items:center}.loc-photo .loc-wrap{grid-template-columns:1fr 1fr}
.loc-media{border-radius:var(--r-lg);overflow:hidden;aspect-ratio:4/3}.loc-media img{width:100%;height:100%;object-fit:cover}
.loc-body{display:grid;gap:18px}.loc{padding:clamp(22px,2.4vw,32px);background:var(--surface);border-radius:var(--r-lg)}.loc h3{font-size:calc(22px * var(--hs))}.loc p{display:flex;gap:12px;color:var(--muted);margin:0 0 8px}.loc .ico{color:var(--accent)}
/* page title */
.ptitle{padding-bottom:calc(var(--pad) * .4)}.ptitle .sec-title{font-size:calc(clamp(40px,6vw,88px) * var(--hs))}
.pt-photo{padding:0}.pt-photo .wrap{max-width:none;padding:0;position:relative;min-height:420px;display:flex;align-items:flex-end;color:#fff}
.pt-media{position:absolute;inset:0}.pt-media img{width:100%;height:100%;object-fit:cover}.pt-media::after{content:"";position:absolute;inset:0;background:linear-gradient(0deg,rgba(0,0,0,.6),rgba(0,0,0,.1))}
.pt-photo .pt-copy{position:relative;max-width:1360px;width:100%;margin:0 auto;padding:120px clamp(16px,4vw,48px) 56px}.pt-photo .sec-sub{color:#fff;opacity:.85}.pt-photo .eyebrow{color:#fff}
/* forms */
.contact-list{list-style:none;padding:0;margin:0;display:grid;gap:14px}.contact-list li{display:flex;gap:12px;align-items:center}.contact-list .ico{color:var(--accent)}
.form{display:grid;gap:16px}.form label{display:grid;gap:7px;font-size:14px;font-weight:600}
.card-form{padding:clamp(24px,3vw,40px);background:var(--surface);border-radius:var(--r-lg)}
.form input,.form textarea,.toolbar select,.toolbar input{width:100%;padding:14px 16px;border:1px solid var(--border);border-radius:var(--r-sm);background:var(--bg);font-weight:400;transition:border-color .2s,box-shadow .2s}
.form input:focus,.form textarea:focus,.toolbar select:focus,.toolbar input:focus{outline:none;border-color:var(--text);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 25%,transparent)}
/* collection */
.cmain{padding-top:clamp(28px,4vw,56px)}.cm-head{margin-bottom:28px}.cm-head .sec-title{font-size:calc(clamp(40px,6vw,88px) * var(--hs))}
.crumbs{display:flex;gap:8px;font-size:13px;color:var(--muted);margin-bottom:18px}.crumbs a{text-decoration:none}.crumbs a:hover{color:var(--text)}
.chips{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:18px}.chip{border:1px solid var(--border);background:var(--bg);border-radius:999px;padding:9px 18px;cursor:pointer;font-size:14px;font-weight:500;transition:background .2s,color .2s,border-color .2s}
.chip:hover{border-color:var(--text)}.chip[aria-pressed=true]{background:var(--text);color:var(--bg);border-color:var(--text)}
.toolbar{display:flex;flex-wrap:wrap;gap:12px;align-items:end;margin-bottom:32px;padding:16px;border-radius:var(--r-lg);background:var(--surface)}.toolbar label{display:grid;gap:4px;font-size:12px;color:var(--muted);font-weight:600;min-width:150px}.toolbar input{width:130px}.toolbar select,.toolbar input{height:46px;padding:0 14px}
.count{margin-left:auto;color:var(--muted);font-size:14px;align-self:center}
/* product */
.pmain{padding-top:clamp(20px,3vw,40px)}
.product{display:grid;grid-template-columns:1.15fr 1fr;gap:clamp(28px,5vw,80px);align-items:start}
.pgallery{display:grid;grid-template-columns:84px 1fr;gap:14px;position:sticky;top:100px}.pgallery>.pmain-img:only-child{grid-column:1/-1}
.pmain-img{position:relative;aspect-ratio:var(--ratio);background:var(--surface);border-radius:var(--r-lg);overflow:hidden}.pslide,.pmain-img>img{position:absolute;inset:0}.pslide img,.pmain-img>img{width:100%;height:100%;object-fit:cover;animation:zfade .5s ease}
@keyframes zfade{from{opacity:.3}}
.thumbs{display:flex;flex-direction:column;gap:10px}.thumb{width:84px;aspect-ratio:4/5;padding:0;border:2px solid transparent;border-radius:var(--r-sm);overflow:hidden;cursor:pointer;background:var(--surface);transition:border-color .2s,opacity .2s;opacity:.7}.thumb[aria-current]{border-color:var(--text);opacity:1}.thumb img{width:100%;height:100%;object-fit:cover}
.pinfo{padding-top:8px}.ptitle-h{font-size:calc(clamp(34px,4vw,60px) * var(--hs));margin-bottom:12px}.pinfo .rating{margin-bottom:14px}.pprice{font-size:24px;font-weight:600;margin:10px 0 26px;font-variant-numeric:tabular-nums}
.opt{border:0;padding:0;margin:0 0 22px}.opt legend{font-size:14px;margin-bottom:10px;color:var(--muted)}.opt legend span{color:var(--text);font-weight:600}
.pills{display:flex;flex-wrap:wrap;gap:8px}.pill{position:relative}.pill input{position:absolute;opacity:0;pointer-events:none}
.pill span{display:inline-flex;align-items:center;gap:8px;min-width:54px;justify-content:center;padding:11px 18px;border:1px solid var(--border);border-radius:var(--btn-r);cursor:pointer;font-size:14px;font-weight:500;transition:border-color .2s,background .2s,color .2s}
.pill span:hover{border-color:var(--text)}.pill input:checked+span{border-color:var(--text);background:var(--text);color:var(--bg)}.pill input:focus-visible+span{outline:2px solid var(--accent);outline-offset:2px}
.swatches .pill span i{width:16px;height:16px;border-radius:50%;box-shadow:inset 0 0 0 1px rgba(0,0,0,.18)}
.pmeta{display:flex;gap:18px;font-size:13px;color:var(--muted)}.stock::before{content:"";display:inline-block;width:8px;height:8px;border-radius:50%;background:#2fa36b;margin-right:6px}
.buy{display:flex;gap:10px;margin:18px 0 24px}.buy .btn{flex:1}
.qty{display:inline-grid;grid-template-columns:44px 52px 44px;border:1px solid var(--border);border-radius:var(--btn-r);overflow:hidden;height:56px}.qty button{background:none;border:0;cursor:pointer;font-size:20px}.qty button:hover{background:var(--surface)}.qty input{border:0;text-align:center;background:transparent;-moz-appearance:textfield;width:100%;font-weight:600}
.qty input::-webkit-inner-spin-button{display:none}.qty.sm{grid-template-columns:30px 38px 30px;height:34px;margin-top:8px}
.wish-lg{width:56px;height:56px}
.perks{list-style:none;padding:18px 0;margin:0 0 8px;display:grid;gap:10px;border-top:1px solid var(--border)}.perks li{display:flex;gap:12px;align-items:center;font-size:14px}.perks .ico{color:var(--accent)}
.acc summary{padding:18px 0;font-weight:600}.acc .prose{padding-bottom:20px}
/* drawers, cart, search */
.lines{list-style:none;margin:0;padding:0}.line{display:grid;grid-template-columns:76px 1fr auto;gap:14px;padding:16px 0;border-bottom:1px solid var(--border);align-items:start}
.line img,.line .noimg{width:76px;height:92px;object-fit:cover;border-radius:var(--r-sm);background:var(--surface)}.line-info{display:grid;gap:2px;font-size:14px}.line-info a{font-weight:600;text-decoration:none}.line-info small{color:var(--muted)}.line-info .link{justify-self:start;font-size:12.5px;margin-top:4px}
.subtotal{display:flex;justify-content:space-between;font-size:18px;margin:18px 0}
.cartpage .wrap{max-width:900px}.cart-sum{max-width:400px;margin-left:auto}
.drawer,.search{position:fixed;inset:0;z-index:60}.drawer-scrim{position:absolute;inset:0;background:rgba(10,10,10,.42);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);animation:zfade .3s}
.drawer-panel{position:absolute;right:0;top:0;bottom:0;width:min(440px,100%);background:var(--bg);color:var(--text);display:flex;flex-direction:column;padding:22px 26px;box-shadow:-30px 0 80px rgba(0,0,0,.25);animation:zin .4s cubic-bezier(.2,.7,.2,1)}
@keyframes zin{from{transform:translateX(40px);opacity:0}}
.drawer-head{display:flex;justify-content:space-between;align-items:center}.drawer-head h2{font-size:calc(26px * var(--hs));margin:0}.drawer-lines{flex:1;overflow:auto;margin:12px 0}
.wish-item .line-info .btn{min-height:36px;padding:0 16px;font-size:13px;justify-self:start;margin-top:6px}
body.drawer-open{overflow:hidden}
.search-panel{position:absolute;left:0;right:0;top:0;background:var(--bg);color:var(--text);padding:22px clamp(16px,4vw,48px) 28px;box-shadow:0 30px 80px rgba(0,0,0,.25);animation:zdrop .35s cubic-bezier(.2,.7,.2,1);max-height:85vh;overflow:auto}
@keyframes zdrop{from{transform:translateY(-24px);opacity:0}}
.search-bar{max-width:900px;margin:0 auto;display:flex;align-items:center;gap:12px;border-bottom:1.5px solid var(--text);padding-bottom:10px}.search-bar input{flex:1;border:0;background:transparent;font:var(--hw) calc(clamp(22px,3vw,34px) * var(--hs)) var(--font-h);min-width:0}.search-bar input:focus{outline:none}
.search-results{max-width:900px;margin:18px auto 0;display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:16px}.search-results a{text-decoration:none;display:grid;gap:8px;font-size:14px}.search-results img{width:100%;aspect-ratio:4/5;object-fit:cover;border-radius:var(--r-sm);background:var(--surface)}
.search-results small{color:var(--muted)}
/* checkout */
.co-grid{display:grid;grid-template-columns:1.2fr 1fr;gap:clamp(28px,5vw,72px);align-items:start;margin-top:24px}.co-summary{background:var(--surface);border-radius:var(--r-lg);padding:28px;position:sticky;top:100px}.co-summary h2{font-size:calc(22px * var(--hs))}
.co-result{margin-top:20px;padding:22px;border:1px solid var(--border);border-radius:var(--r-lg)}
.paylist{list-style:none;padding:0;margin:0;display:grid;gap:10px}.paylist li{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--border)}
/* footer */
.site-footer{background:var(--surface);padding:clamp(56px,7vw,96px) 0 28px;font-size:15px;margin-top:calc(var(--pad) * .4)}
.ft-grid{display:grid;grid-template-columns:1.6fr 1fr 1fr 1.4fr;gap:clamp(28px,4vw,64px)}
.site-footer h3{font:600 13px var(--font-b);text-transform:uppercase;letter-spacing:.14em;margin-bottom:18px;color:var(--muted)}
.site-footer ul{list-style:none;padding:0;margin:0;display:grid;gap:10px}.site-footer a{text-decoration:none}.site-footer a:hover{text-decoration:underline}
.ft-brand .logo{font-size:calc(34px * var(--hs))}.ft-brand p{color:var(--muted);max-width:340px;margin:16px 0 22px}
.social{display:flex!important;gap:8px!important}.social a{display:grid;place-items:center;width:42px;height:42px;border-radius:50%;border:1px solid var(--border);transition:background .2s,color .2s}.social a:hover{background:var(--text);color:var(--bg);text-decoration:none}
.nl-mini{display:flex;border-bottom:1.5px solid var(--text);padding-bottom:6px}.nl-mini input{flex:1;border:0;background:transparent;padding:10px 0;min-width:0}.nl-mini input:focus{outline:none}.nl-mini button{border:0;background:none;cursor:pointer;padding:0 6px}
.ft-bottom{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:16px;border-top:1px solid var(--border);margin-top:clamp(40px,5vw,72px);padding-top:24px;color:var(--muted);font-size:13px}.ft-bottom p{margin:0}
.pays{display:flex!important;flex-wrap:wrap;gap:8px!important}.pays li{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:999px;background:var(--bg);border:1px solid var(--border);font-size:12px;color:var(--text)}.pays .ico{width:16px;height:16px}
/* ---- round 3: header variants, wordmark hero, social proof ---- */
.hdr-pill{background:transparent!important;border:0!important;box-shadow:none!important;padding-top:14px}.hdr-pill.over{margin-bottom:-92px}
.hdr-pill .hdr-in{background:color-mix(in srgb,var(--bg) 82%,transparent);-webkit-backdrop-filter:blur(18px) saturate(1.5);backdrop-filter:blur(18px) saturate(1.5);border-radius:999px;height:64px;padding:0 10px 0 26px;box-shadow:0 10px 40px -18px rgba(0,0,0,.35);color:var(--text);max-width:1180px}
.hdr-pill .nav a{padding:8px 14px;border-radius:999px}.hdr-pill .nav a::after{display:none}.hdr-pill .nav a:hover,.hdr-pill .nav a[aria-current]{background:color-mix(in srgb,var(--text) 8%,transparent)}
.hdr-pill.over:not(.scrolled){--hfg:var(--text)}
.hdr-search .hdr-in{grid-template-columns:auto auto 1fr auto;height:72px}.hdr-search .subnav{display:flex;justify-content:flex-start;gap:22px;padding-bottom:12px;overflow-x:auto;scrollbar-width:none}
.hsearch{display:flex;align-items:center;gap:12px;height:48px;border-radius:999px;border:1px solid var(--border);background:var(--surface);padding:0 18px;color:var(--muted);cursor:pointer;font-size:15px;width:100%;max-width:640px;justify-self:center;text-align:left;transition:border-color .2s,box-shadow .2s}.hsearch:hover{border-color:var(--text);box-shadow:var(--shadow)}
.hbadge{display:inline-flex;align-items:center;gap:6px;background:var(--accent);color:#111;font-weight:700;font-size:12.5px;padding:7px 12px;border-radius:999px;white-space:nowrap}.hbadge .ico{width:15px;height:15px}
.hl-wordmark{min-height:var(--hh);color:var(--hero-fg,#fff);background:var(--hero-bg,#0b0b0b)}
.wordmark-big{position:absolute;left:0;right:0;top:clamp(70px,10vh,110px);z-index:2;margin:0;text-align:center;font:var(--hw) clamp(80px,19vw,330px)/.8 var(--font-h);text-transform:uppercase;letter-spacing:-.02em;color:var(--hero-fg,#fff);mix-blend-mode:difference;pointer-events:none;white-space:nowrap;overflow:hidden}
.hl-wordmark .hero-title{font-size:calc(clamp(30px,3.8vw,60px) * var(--hs));max-width:16ch}.hl-wordmark .hero-slide>.wrap{padding-top:45vh}
.vindex{position:absolute;right:clamp(16px,3vw,40px);top:50%;transform:translateY(-50%);z-index:3;list-style:none;margin:0;padding:0;display:grid;gap:10px}
.vindex button{border:0;background:none;color:inherit;font:600 14px/1 var(--font-b);letter-spacing:.1em;opacity:.45;cursor:pointer;padding:6px 0 6px 18px;position:relative;font-variant-numeric:tabular-nums}.vindex button::before{content:"";position:absolute;left:0;top:50%;width:10px;height:1.5px;background:currentColor;transition:width .3s}
.vindex button[aria-current]{opacity:1}.vindex button[aria-current]::before{width:14px;left:-6px}
.sproof{padding:calc(var(--pad) * .45) 0}.sproof-in{display:flex;align-items:center;gap:18px;flex-wrap:wrap}.al-center .sproof-in{justify-content:center}.sproof p{margin:4px 0 0;font-weight:600;font-size:17px}
.avstack{display:inline-flex}.avstack img{width:34px;height:34px;border-radius:50%;object-fit:cover;border:2px solid var(--bg);margin-left:-10px}.avstack img:first-child{margin-left:0}.avstack.lg img{width:48px;height:48px;margin-left:-14px}
/* ---- product page layouts & blocks ---- */
.pinfo .pform{display:grid;gap:14px}.pinfo .pb{margin:0}.pb-marker{display:none!important}
.pinfo .crumbs{margin-bottom:0}.pinfo .ptitle-h{margin-bottom:6px}.rating-link{display:inline-flex;align-items:center;gap:8px;text-decoration:none;color:var(--muted);font-size:14px}.rating-link:hover span:last-child{text-decoration:underline}
.pprice{margin:0!important}.saved{display:inline-block;margin-left:8px;font-size:13px;font-weight:700;color:var(--accent);background:color-mix(in srgb,var(--accent) 12%,transparent);padding:4px 10px;border-radius:999px;vertical-align:3px}
.bnpl{font-size:14px;color:var(--muted)}.bnpl strong{color:var(--text)}
.urgency,.dispatch,.delivery,.socialp{display:flex;align-items:center;gap:10px;font-size:14px}.urgency{color:#c2410c;font-weight:600}.urgency .ico{color:#c2410c}.dispatch .ico,.delivery .ico{color:var(--accent)}
.socialp{color:var(--muted)}.socialp span{color:var(--text)}
.trust{list-style:none;padding:16px 0 0;margin:0;display:flex;flex-wrap:wrap;gap:10px 22px;border-top:1px solid var(--border)}.trust li{display:flex;align-items:center;gap:8px;font-size:13.5px}.trust .ico{width:18px;height:18px;color:var(--accent)}
.specs{width:100%;border-collapse:collapse;font-size:13px;text-transform:uppercase;letter-spacing:.06em}.specs th,.specs td{padding:12px 0;border-bottom:1px solid var(--border);text-align:left;font-weight:500}.specs th{color:var(--muted);width:40%}
.sg-link{display:inline-flex;align-items:center;gap:6px;margin-left:10px;font-size:13px;color:var(--text)}.sg-link .ico{width:16px;height:16px}
.pill.soldout span{color:var(--muted);text-decoration:line-through;background:repeating-linear-gradient(135deg,transparent 0 6px,color-mix(in srgb,var(--border) 70%,transparent) 6px 7px)}
.imgswatch .pill span{padding:4px 12px 4px 4px}.imgswatch .pill img{width:40px;height:40px;object-fit:cover;border-radius:calc(var(--btn-r) / 2 + 2px)}
.buy{flex-wrap:wrap}.buy .buy-now{flex-basis:100%}
.zoomable{cursor:zoom-in}.zoomable.zooming img{transform:scale(1.8);transform-origin:var(--zx,50%) var(--zy,50%);transition:transform .15s}
.pslide.video video{width:100%;height:100%;object-fit:cover;background:#000}.vthumb{position:relative}.vthumb span{position:absolute;inset:0;display:grid;place-items:center;color:#fff;background:rgba(0,0,0,.35)}
.pl-editorial .product{grid-template-columns:.9fr 1.4fr}.pl-editorial .pgallery{order:2;position:static;display:grid;grid-template-columns:1fr 1fr;gap:12px}.pl-editorial .pinfo{order:1;position:sticky;top:100px;align-self:start}
.pl-editorial .pmain-img,.pl-stack .pmain-img{aspect-ratio:auto;background:none;border-radius:0;overflow:visible;display:contents}.pl-editorial .pslide,.pl-stack .pslide{position:relative;inset:auto;aspect-ratio:var(--ratio);border-radius:var(--r);overflow:hidden;background:var(--surface)}
.pl-editorial .pslide:first-child{grid-column:1/-1}.pl-editorial .pslide:nth-child(even):last-of-type{grid-column:1/-1}.pl-editorial .pmain-img>.badge,.pl-stack .pmain-img>.badge{position:fixed;display:none}
.pl-stack .wrap{max-width:none;padding-left:0}.pl-stack .product{grid-template-columns:1.5fr 1fr;gap:clamp(24px,4vw,64px)}.pl-stack .pgallery{position:static;display:grid;grid-template-columns:1fr;gap:6px}.pl-stack .pslide{border-radius:0}.pl-stack .pinfo{position:sticky;top:100px;align-self:start;padding-right:clamp(16px,4vw,48px)}
.pl-compact .product{grid-template-columns:.8fr 1.2fr;gap:32px}.pl-compact .pgallery{grid-template-columns:64px 1fr}.pl-compact .thumb{width:64px}.pl-compact .ptitle-h{font-size:calc(clamp(26px,3vw,38px) * var(--hs))}.pl-compact .pinfo{padding:24px;background:var(--surface);border-radius:var(--r-lg)}
.pl-classic .pinfo{position:sticky;top:100px;align-self:start}
.sticky-atc{position:fixed;left:0;right:0;bottom:0;z-index:40;background:color-mix(in srgb,var(--bg) 90%,transparent);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);border-top:1px solid var(--border);box-shadow:0 -12px 40px -20px rgba(0,0,0,.35);animation:zup .3s ease}
@keyframes zup{from{transform:translateY(100%)}}
.sticky-in{display:flex;align-items:center;gap:14px;height:76px}.sticky-in img{width:52px;height:52px;border-radius:var(--r-sm);object-fit:cover}.sticky-info{flex:1;display:grid;min-width:0}.sticky-info b{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.sticky-info span{color:var(--muted);font-size:14px}
.modal{position:fixed;inset:0;z-index:70;display:grid;place-items:center}.modal-panel{position:relative;background:var(--bg);color:var(--text);border-radius:var(--r-lg);padding:24px 28px;width:min(620px,92vw);max-height:86vh;overflow:auto;box-shadow:0 40px 100px rgba(0,0,0,.35);animation:zdrop .3s}
.sgtable{width:100%;border-collapse:collapse;margin-top:12px;font-size:14px}.sgtable th,.sgtable td{padding:12px 10px;border-bottom:1px solid var(--border);text-align:left}.sgtable th{background:var(--surface)}
.toasts{position:fixed;left:16px;bottom:16px;z-index:45;display:grid;gap:8px}.toast{display:flex;align-items:center;gap:12px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:14px;padding:12px 14px;box-shadow:var(--shadow);font-size:14px;animation:zup .35s ease}.toast button{border:0;background:none;cursor:pointer;font-size:18px;color:var(--muted)}
.ship-bar{background:var(--surface);border-radius:var(--r);padding:12px 14px;margin:12px 0;font-size:14px}.ship-bar p{margin:0 0 8px}.ship-track{display:block;height:6px;border-radius:6px;background:color-mix(in srgb,var(--text) 10%,transparent);overflow:hidden}.ship-track i{display:block;height:100%;background:var(--accent);border-radius:6px;transition:width .4s}
/* bundle, reviews, ugc, recently viewed */
.bundle-in{display:grid;grid-template-columns:1fr auto;gap:28px;align-items:center;padding:clamp(18px,3vw,32px);border-radius:var(--r-lg);background:var(--surface)}
.bundle-items{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.bplus{font-size:24px;color:var(--muted)}
.bitem{display:grid;grid-template-columns:auto 72px 1fr;grid-template-rows:auto auto;gap:2px 12px;align-items:center;background:var(--bg);border-radius:var(--r);padding:10px 14px 10px 10px;cursor:pointer;min-width:220px;transition:opacity .2s}.bitem.off{opacity:.45}
.bitem input{grid-row:1/3;accent-color:var(--primary);width:18px;height:18px}.bimg{grid-row:1/3}.bimg img{width:72px;height:72px;object-fit:cover;border-radius:var(--r-sm)}.btitle{font-weight:600;font-size:14px}.btitle small{display:block;color:var(--muted);font-weight:400;font-size:12px}.bitem b{font-size:14px}
.bundle-sum{min-width:240px;text-align:right}.bundle-sum p{margin:0;color:var(--muted)}.btotal{font:var(--hw) calc(32px * var(--hs))/1.2 var(--font-h);color:var(--text)!important;margin:4px 0 14px!important}
.rv-grid{display:grid;grid-template-columns:.8fr 1.6fr;gap:clamp(28px,5vw,72px);align-items:start}.rv-sum{position:sticky;top:100px}.rv-avg{font:var(--hw) 64px/1 var(--font-h);margin:10px 0 6px}.rv-avg small{font-size:20px;color:var(--muted);margin-left:6px}
.rv-bars{list-style:none;padding:0;margin:18px 0 0;display:grid;gap:8px;font-size:13px}.rv-bars li{display:grid;grid-template-columns:44px 1fr 28px;gap:10px;align-items:center}.rv-bars .ico{width:12px;height:12px;color:var(--accent)}.rbar{height:6px;border-radius:6px;background:color-mix(in srgb,var(--text) 10%,transparent);overflow:hidden}.rbar i{display:block;height:100%;background:var(--accent)}
.rv-photos{display:flex;gap:10px;margin-bottom:18px;overflow-x:auto}.rv-photos img{width:110px;height:110px;object-fit:cover;border-radius:var(--r)}
.rv-list{list-style:none;padding:0;margin:0}.review{padding:22px 0;border-bottom:1px solid var(--border)}.review h3{font:600 17px var(--font-b);text-transform:none;letter-spacing:0;margin:8px 0 4px}.review p{margin:0 0 8px;color:var(--muted)}.rv-top{display:flex;align-items:center;gap:12px}
.rv-by{display:flex;align-items:center;gap:8px;font-size:13px}.avatar.sm{width:28px;height:28px;font-size:11px}.rv-photo{width:80px;height:80px;object-fit:cover;border-radius:var(--r-sm)}
.sample-tag{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;background:var(--surface);color:var(--muted);padding:3px 8px;border-radius:999px}
.ugc-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:var(--gap)}.ugc-cell{position:relative;margin:0;border-radius:var(--r-lg);overflow:hidden;aspect-ratio:3/4}.ugc-cell.u1,.ugc-cell.u3{margin-top:40px}
.ugc-cell img{width:100%;height:100%;object-fit:cover;transition:transform 1s}.ugc-cell:hover img{transform:scale(1.05)}
.ugc-cell figcaption{position:absolute;left:10px;right:10px;bottom:10px;display:flex;justify-content:space-between;align-items:center;gap:8px;background:color-mix(in srgb,var(--bg) 88%,transparent);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);padding:8px 12px;border-radius:999px;font-size:13px}.ugc-cell figcaption a{display:inline-flex;align-items:center;gap:4px;font-weight:600;text-decoration:none}.ugc-cell .ico{width:14px;height:14px}
.recent-track{grid-auto-columns:calc((100% - 5 * var(--gap)) / 6)}.rcard{display:grid;gap:6px;text-decoration:none;font-size:14px}.rcard img,.rcard .noimg{width:100%;aspect-ratio:var(--ratio);object-fit:cover;border-radius:var(--r);background:var(--surface)}.rcard b{font-weight:600}
@media (max-width:900px){
.hdr-search .hdr-in{grid-template-columns:auto 1fr auto}.hdr-search .hsearch{grid-column:1/-1;grid-row:2;margin-bottom:10px}.hdr-search .hdr-in{height:auto;padding-top:10px}.hbadge{display:none}.hdr-search .subnav{display:none}
.hdr-pill .hdr-in{padding:0 8px;height:58px}.pl-editorial .product,.pl-stack .product,.pl-compact .product{grid-template-columns:1fr}.pl-editorial .pinfo,.pl-stack .pinfo,.pl-classic .pinfo{position:static}.pl-editorial .pgallery{order:0}.pl-stack .wrap{padding-left:clamp(16px,4vw,48px)}.pl-stack .pinfo{padding-right:0}
.pl-editorial .pgallery,.pl-stack .pgallery{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;gap:8px}.pl-editorial .pslide,.pl-stack .pslide{flex:0 0 86%;scroll-snap-align:start}
.bundle-in,.rv-grid{grid-template-columns:1fr}.bundle-sum{text-align:left}.rv-sum{position:static}.ugc-grid{grid-template-columns:1fr 1fr}.ugc-cell.u1,.ugc-cell.u3{margin-top:0}.recent-track{grid-auto-columns:42%}.vindex{top:auto;bottom:110px;transform:none}.wordmark-big{top:90px}
}
/* ---- commerce: discounts, totals, shipping ---- */
.summary{display:grid;gap:6px;margin:14px 0}.summary .subtotal{margin:4px 0}
.sumrow{display:flex;justify-content:space-between;gap:12px;font-size:15px}.sumrow.muted{color:var(--muted);font-size:14px}.sumrow.save{color:#15803d;font-weight:600}.sumrow.total{font-size:19px;padding-top:10px;margin-top:4px;border-top:1px solid var(--border)}.sumrow s{color:var(--muted);font-weight:400}
.dcode{display:flex;gap:8px;margin-top:12px}.dcode input{flex:1;min-width:0;height:44px;padding:0 14px;border:1px solid var(--border);border-radius:var(--btn-r);background:var(--bg);text-transform:uppercase;letter-spacing:.04em}.dcode .btn{min-height:44px;padding:0 18px}
.dchips{list-style:none;padding:0;margin:8px 0 0;display:flex;flex-wrap:wrap;gap:6px}.dchips li{display:inline-flex;align-items:center;gap:6px;background:var(--surface);border-radius:999px;padding:4px 6px 4px 12px;font-size:13px;font-weight:600;letter-spacing:.04em}.dchips button{border:0;background:var(--bg);width:22px;height:22px;border-radius:50%;cursor:pointer}
[data-discount-msg]{margin:8px 0 0}
.shipf{border:1px solid var(--border);border-radius:var(--r);padding:14px 16px;margin:0;display:grid;gap:12px}.shipf legend{font-weight:600;padding:0 6px}.shipf select{width:100%;padding:12px 14px;border:1px solid var(--border);border-radius:var(--r-sm);background:var(--bg)}
.rates{display:grid;gap:8px}.rate{display:flex!important;align-items:center;gap:10px;padding:12px 14px;border:1px solid var(--border);border-radius:var(--r-sm);cursor:pointer;font-weight:500!important}.rate span{flex:1}.rate input{accent-color:var(--primary)}
/* responsive */
@media (max-width:1100px){.cols-4,.cols-5{grid-template-columns:repeat(3,1fr)}.ptrack{grid-auto-columns:calc((100% - 2 * var(--gap)) / 3)}.ft-grid{grid-template-columns:1fr 1fr}.bento-grid{grid-template-columns:repeat(2,1fr)}.n3 .t0,.n4 .t0,.n5 .t0{grid-row:span 1}.n4 .t3{grid-column:span 2}}
@media (max-width:900px){
.menu-toggle{display:inline-grid}.nav{display:none}.hdr-in{grid-template-columns:auto 1fr auto;height:64px;gap:8px}.hdr-split .logo,.hdr-left .logo{grid-column:2;justify-content:center}.hdr-split .hdr-actions{grid-column:3}
.hdr-centered .hdr-in{height:64px;padding-top:0}.hdr-centered .logo{font-size:22px}.site-header.over,.hdr-centered.over{margin-bottom:-64px}.logo{font-size:20px}
.hero-split,.split,.product,.co-grid,.faq-grid,.hero-grad,.cd-photo .cd-card,.loc-photo .loc-wrap{grid-template-columns:1fr}.split.rev .split-media{order:0}.faq-grid .sec-head{position:static}
.hero-float{display:none}.pgallery{position:static;grid-template-columns:1fr}.thumbs{flex-direction:row;order:2;overflow-x:auto}.thumb{width:70px;flex:none}.co-summary{position:static}
.it-overlap .split-copy{margin:-60px 12px 0!important}.hero-media.rounded{min-height:340px}
}
@media (max-width:640px){
.cols-2,.cols-3,.cols-4,.cols-5{grid-template-columns:1fr 1fr}.features .grid,.testimonials .grid,.pricing .grid,.locations .grid{grid-template-columns:1fr}.clist .grid{grid-template-columns:1fr 1fr}
.ptrack{grid-auto-columns:72%}.hero.h-large,.hero.h-full{--hh:clamp(520px,88vh,760px)}.hero.h-medium{--hh:560px}.hero-title{font-size:calc(clamp(40px,12vw,64px) * var(--hs))}.hl-text .hero-title{font-size:calc(clamp(44px,13vw,76px) * var(--hs))}
.hero-ctrl .counter{display:none}.hero-shade{background:linear-gradient(0deg,rgba(0,0,0,calc(var(--ov) + .45)) 0%,rgba(0,0,0,calc(var(--ov) + .1)) 55%,rgba(0,0,0,calc(var(--ov) * .5)) 100%)}.round{width:44px;height:44px}.sec-head.row{flex-direction:column;align-items:flex-start}
.insta-grid{grid-template-columns:repeat(3,1fr)}.nl-form{flex-direction:column;background:none;box-shadow:none;padding:0}.nl-form input{background:var(--bg);border-radius:var(--btn-r)}.cd div{min-width:68px}.cd span{font-size:30px}
.bento-grid{grid-template-columns:1fr}.bento-grid .tile{grid-column:auto!important;min-height:260px}.ccard-label b{font-size:20px}.ccard .round{width:34px;height:34px}
.toolbar label{min-width:0;flex:1 1 40%}.toolbar input{width:100%}.count{margin-left:0;width:100%}.ft-grid{grid-template-columns:1fr}.buy{flex-wrap:wrap}.buy .btn{flex-basis:100%;order:3}.pcard-body h3{font-size:15px}
}
`;
