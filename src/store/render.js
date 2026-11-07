// Storefront renderer: store document → HTML pages, CSS and the runtime script.
// Used by the builder's live preview (inline CSS/JS, srcdoc iframe) and the static exporter (files).
//
//   sitePages(store)                         → [{ route, path, title }]  every page of the exported site
//   pagePath(store, route)                   → 'index.html' | 'collections/<slug>.html' | 'products/<slug>.html' | 'pages/about.html' | …
//   renderPage(store, route, opts)           → full HTML document string
//       route = { page, productId?, collectionId? }
//       opts  = { mode: 'export'|'preview', imageUrl(ref) → url (root-relative path or absolute URL),
//                 editor?: bool (builder selection overlay), script?: false (static thumbnail, no runtime) }
//   storeCss(store)                          → assets/styles.css
//   storeScript(store, imageUrl, {preview})  → assets/store.js (cart kit + runtime + data)
//   resolveHref(fromPath, href)              → site-root-relative path ('products/x.html'), or null for external links

import { SECTIONS } from './sections.js';
import { FONT_STACKS, collectionProducts, activeProducts, PAGE_LABELS } from './model.js';
import { cartKit } from './cart.js';
import { storeRuntime } from './runtime.js';

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

const ICONS = {
  bag: '<path d="M6 7h12l-1 13H7z"/><path d="M9 7a3 3 0 0 1 6 0"/>', menu: '<path d="M4 7h16M4 12h16M4 17h16"/>', close: '<path d="M6 6l12 12M18 6 6 18"/>',
  left: '<path d="M15 6l-6 6 6 6"/>', right: '<path d="M9 6l6 6-6 6"/>', check: '<path d="M5 12l5 5 9-10"/>', play: '<circle cx="12" cy="12" r="9"/><path d="M10 9v6l5-3z"/>',
  pin: '<path d="M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>', truck: '<path d="M3 6h11v10H3zM14 9h4l3 3v4h-7"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>', refresh: '<path d="M20 11a8 8 0 0 0-14-4L4 9M4 4v5h5M4 13a8 8 0 0 0 14 4l2-2M20 20v-5h-5"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>', heart: '<path d="M12 20s-8-5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 9c0 6-8 11-8 11z"/>',
  leaf: '<path d="M5 19c0-9 6-14 15-14 0 9-5 15-14 15M5 19l7-7"/>', gift: '<path d="M4 10h16v10H4zM3 7h18v3H3zM12 7v13M12 7c-2-4-6-3-5 0M12 7c2-4 6-3 5 0"/>',
  bolt: '<path d="M13 3 5 14h6l-1 7 8-11h-6z"/>', lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>', award: '<circle cx="12" cy="9" r="6"/><path d="M8.5 14 7 21l5-3 5 3-1.5-7"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2 20c0-4 3-6 7-6s7 2 7 6"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14c2.5.5 4 2.5 4 6"/>',
};
export const icon = n => `<svg class="ico" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n] || ICONS.check}</svg>`;

function makeCtx(store, route, opts) {
  const path = pagePath(store, route), root = path.includes('/') ? '../' : '';
  const mode = store.checkout.mode, checkoutEnabled = mode !== 'none';
  const img = ref => { if (!ref) return ''; const u = opts.imageUrl(ref) || ''; return /^(data:|blob:|https?:|\/)/.test(u) ? esc(u) : esc(root + u); };
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
  const card = (p, quick, index = 0) => {
    const lo = minPrice(p), hi = maxPrice(p), sale = p.compareAt && p.compareAt > lo, sold = p.variants.every(v => v.stock != null && v.stock <= 0);
    const single = p.variants.length === 1;
    const q = quick && checkoutEnabled && !sold ? (single ? `<button type="button" class="quick" data-quick-add="${p.id}" aria-label="Add ${esc(p.title)} to cart">Add to cart</button>` : `<a class="quick" href="${productHref(p)}" aria-label="Choose options for ${esc(p.title)}">Choose options</a>`) : '';
    return `<article class="pcard" data-card data-price="${lo}" data-category="${esc(p.category)}" data-title="${esc(p.title)}" data-index="${index}">
      <a class="pcard-link" href="${productHref(p)}"><div class="pcard-img">${p.images[0] ? `<img src="${img(p.images[0])}" alt="${esc(p.title)}" loading="lazy">` : ''}${p.images[1] ? `<img class="alt" src="${img(p.images[1])}" alt="" loading="lazy">` : ''}
      ${sold ? '<span class="badge sold">Sold out</span>' : sale ? '<span class="badge">Sale</span>' : ''}</div>
      <div class="pcard-body"><h3>${esc(p.title)}</h3><p class="price">${lo !== hi ? 'From ' : ''}${money(lo)}${sale ? ` <s>${money(p.compareAt)}</s>` : ''}</p></div></a>${q}</article>`;
  };
  const btn = (label, target, cls = '') => `<a class="btn ${cls}" href="${link(target)}">${esc(label)}</a>`;
  const isCurrent = t => link(t) === rel(path);
  const allCollections = () => store.collections.length ? store.collections : [ALL_COLLECTION];
  const collectionImage = c => collectionProducts(store, c).find(p => p.images[0])?.images[0] || null;
  const product = route.page === 'product' ? store.products.find(p => p.id === route.productId) || activeProducts(store)[0] || store.products[0] || null : null;
  const collection = route.page === 'collection' ? findCol(route.collectionId) || ALL_COLLECTION : null;
  return { store, page: route.page, path, root, e: esc, t: paras, img, link, money, products, card, btn, icon, isCurrent, allCollections, collectionImage, collectionHref, productHref,
    collectionProducts: c => collectionProducts(store, c), product, collection, checkoutEnabled };
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

export function renderPage(store, route, opts) {
  const ctx = makeCtx(store, route, opts);
  const sections = store.pages[route.page] || [];
  const body = sections.map(s => renderSection(s, ctx)).join('\n');
  const desc = ctx.product ? ctx.product.description.slice(0, 160) : store.seo.description;
  const preview = opts.mode !== 'export';
  const css = preview ? `<style>${storeCss(store)}</style>` : `<link rel="stylesheet" href="${ctx.root}assets/styles.css">`;
  const js = opts.script === false ? '' : preview ? `<script>${storeScript(store, opts.imageUrl, { preview: true })}</script>` : `<script src="${ctx.root}assets/store.js"></script>`;
  const drawer = ctx.checkoutEnabled ? `<div class="drawer" data-drawer hidden><div class="drawer-scrim" data-cart-close></div>
    <aside class="drawer-panel" role="dialog" aria-modal="true" aria-labelledby="drawer-title"><div class="drawer-head"><h2 id="drawer-title">Your cart</h2><button type="button" class="icon-btn x" data-cart-close aria-label="Close cart">${icon('close')}</button></div>
    <div class="drawer-lines" data-drawer-lines></div><div class="drawer-foot" data-drawer-foot hidden><p class="subtotal"><span>Subtotal</span><strong data-cart-subtotal></strong></p>
    <a class="btn btn-wide" href="${ctx.link('checkout')}">Checkout</a><a class="link center" href="${ctx.link('cart')}">View cart</a></div></aside></div>` : '';
  return `<!doctype html>
<html lang="en" data-root="${ctx.root}" data-path="${ctx.path}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(pageTitle(store, ctx))}</title>
${desc ? `<meta name="description" content="${esc(desc)}">` : ''}
<meta property="og:title" content="${esc(pageTitle(store, ctx))}">
${css}
</head>
<body class="page-${route.page}">
<a class="skip" href="#main">Skip to content</a>
${SECTIONS.announcement.render({}, ctx)}
${renderSection(store.layout.header, ctx)}
<main id="main">
${body}
</main>
${renderSection(store.layout.footer, ctx)}
${drawer}
${js}${opts.editor ? `<script>${EDITOR_SCRIPT}</script>` : ''}
</body>
</html>`;
}

/** Data the runtime needs on every page (only active products; image/url paths are site-root-relative). */
export function runtimeData(store, imageUrl, preview = false) {
  return {
    id: store.id, name: store.name, currency: store.currency, preview,
    checkout: { mode: store.checkout.mode, phone: store.checkout.phone.replace(/\D/g, ''), email: store.checkout.email, shippingNote: store.checkout.shippingNote },
    products: activeProducts(store).map(p => ({
      id: p.id, title: p.title, url: 'products/' + p.slug + '.html', image: p.images[0] ? imageUrl(p.images[0]) : '', price: p.price, compareAt: p.compareAt,
      options: p.options.map(o => o.name), paymentLink: store.checkout.paymentLinks[p.id] || '',
      variants: p.variants.map(v => ({ id: v.id, options: v.options, price: v.price, sku: v.sku, stock: v.stock })),
    })),
  };
}

export function storeScript(store, imageUrl, { preview = false } = {}) {
  const data = JSON.stringify(runtimeData(store, imageUrl, preview)).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, '');
  return `/* Storefront runtime — generated by Zertake Studio */\n(function () {\n'use strict';\nvar K = (${cartKit.toString()})();\nvar D = ${data};\n(${storeRuntime.toString()})(K, D, window, document);\n})();\n`;
}

// Builder-only overlay: hover outline, click-to-select (posts {storeSelect: id}), host-driven highlight.
const EDITOR_SCRIPT = `(function(){var mode='edit';var css=document.createElement('style');css.textContent='[data-sid]{position:relative}.zsel-hover{outline:2px dashed rgba(80,140,255,.8)!important;outline-offset:-2px}.zsel-on{outline:2px solid #3b82f6!important;outline-offset:-2px}';document.head.appendChild(css);
function sec(t){return t&&t.closest?t.closest('[data-sid]'):null}
addEventListener('mouseover',function(e){if(mode!=='edit')return;document.querySelectorAll('.zsel-hover').forEach(function(x){x.classList.remove('zsel-hover')});var s=sec(e.target);if(s)s.classList.add('zsel-hover')});
addEventListener('click',function(e){if(mode!=='edit')return;var s=sec(e.target);e.preventDefault();e.stopPropagation();if(s)parent.postMessage({storeSelect:s.getAttribute('data-sid')},'*')},true);
addEventListener('submit',function(e){if(mode!=='edit')return;e.preventDefault();e.stopPropagation()},true);
addEventListener('message',function(e){var d=e.data||{};if(d.storeMode)mode=d.storeMode;if('storeHighlight' in d){document.querySelectorAll('.zsel-on').forEach(function(x){x.classList.remove('zsel-on')});var s=d.storeHighlight&&document.querySelector('[data-sid="'+d.storeHighlight+'"]');if(s){s.classList.add('zsel-on');if(d.scroll)s.scrollIntoView({block:'nearest',behavior:'smooth'})}}});
addEventListener('keydown',function(e){var t=e.target;if(t&&/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))return;if((e.ctrlKey||e.metaKey)&&!e.altKey&&/^[zy]$/i.test(e.key)){e.preventDefault();parent.postMessage({storeKey:e.key.toLowerCase()==='y'||e.shiftKey?'redo':'undo'},'*')}});
parent.postMessage({storeReady:true},'*')})();`;

export function storeCss(store) {
  const t = store.theme, c = t.colors;
  const pad = { compact: 44, comfortable: 72, airy: 112 }[t.density], gap = { compact: 16, comfortable: 24, airy: 32 }[t.density];
  const btnR = t.buttons === 'pill' ? '999px' : t.buttons === 'sharp' ? '0' : t.radius + 'px';
  const ratio = { square: '1 / 1', portrait: '4 / 5', landscape: '4 / 3' }[t.imageRatio];
  const vars = `:root{--bg:${c.background};--surface:${c.surface};--text:${c.text};--muted:${c.muted};--primary:${c.primary};--on-primary:${c.primaryText};--accent:${c.accent};--border:${c.border};
--font-h:${FONT_STACKS[t.fonts.heading][1]};--font-b:${FONT_STACKS[t.fonts.body][1]};--hw:${t.headingWeight};--hcase:${t.headingCase};--r:${t.radius}px;--btn-r:${btnR};--pad:${pad}px;--gap:${gap}px;--ratio:${ratio}}`;
  const btn = t.buttons === 'outline'
    ? '.btn{background:transparent;color:var(--text);border:2px solid var(--text)}.btn:hover{background:var(--text);color:var(--bg)}'
    : '.btn{background:var(--primary);color:var(--on-primary);border:2px solid var(--primary)}.btn:hover{filter:brightness(1.12)}';
  const card = t.cardStyle === 'card' ? '.pcard{background:var(--surface);border-radius:var(--r);overflow:hidden}.pcard-body{padding:12px 14px 4px}.pcard .quick{margin:0 14px 14px}'
    : t.cardStyle === 'bordered' ? '.pcard{border:1px solid var(--border);border-radius:var(--r);overflow:hidden}.pcard-img{border-radius:0!important}.pcard-body{padding:12px 14px 4px}.pcard .quick{margin:0 14px 14px}' : '';
  return vars + '\n' + BASE_CSS + btn + card;
}

const BASE_CSS = `*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.6 var(--font-b);-webkit-font-smoothing:antialiased}
img{max-width:100%;display:block}
a{color:inherit}
h1,h2,h3{font-family:var(--font-h);font-weight:var(--hw);text-transform:var(--hcase);line-height:1.15;margin:0 0 .5em;letter-spacing:-.01em}
p{margin:0 0 1em}
button,input,select,textarea{font:inherit;color:inherit}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
[hidden]{display:none!important}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.skip{position:absolute;left:-9999px;top:0;background:var(--primary);color:var(--on-primary);padding:8px 14px;z-index:100}.skip:focus{left:8px}
.wrap{max-width:1200px;margin:0 auto;padding:0 24px}
.sec{padding:var(--pad) 0}
.narrow .wrap{max-width:820px}
.sec-title{font-size:clamp(26px,3.4vw,40px)}
.sec-sub{color:var(--muted);max-width:640px;margin-bottom:24px}
.sec-head{margin-bottom:28px}.sec-head.row{display:flex;align-items:end;justify-content:space-between;gap:16px}.sec-head.center{text-align:center}
.al-center{text-align:center}.al-center .sec-sub,.al-center .hero-text{margin-left:auto;margin-right:auto}.al-center .btns{justify-content:center}
.eyebrow{text-transform:uppercase;letter-spacing:.14em;font-size:12px;font-weight:600;color:var(--accent);margin-bottom:12px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:46px;padding:0 26px;border-radius:var(--btn-r);font-weight:600;text-decoration:none;cursor:pointer;transition:filter .15s,background .15s,color .15s;font-size:15px}
.btn:disabled{opacity:.45;cursor:not-allowed}
.btn-wide{width:100%}
.btns{display:flex;flex-wrap:wrap;gap:12px;margin-top:24px}
.link{background:none;border:0;padding:0;text-decoration:underline;cursor:pointer;color:var(--muted);font-size:14px}.link.center{display:block;text-align:center;margin-top:12px}
.icon-btn{display:inline-grid;place-items:center;width:40px;height:40px;border-radius:999px;border:1px solid var(--border);background:var(--bg);cursor:pointer}
.note{color:var(--muted);font-size:14px}.note.small{font-size:12.5px}.note.warn{color:#b42318}
.empty{color:var(--muted)}
.badge{position:absolute;top:10px;left:10px;background:var(--accent);color:#fff;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:4px 9px;border-radius:999px}.badge.sold{background:var(--text);color:var(--bg)}
.ico{flex:none;vertical-align:middle}
/* announcement + header */
.ann{background:var(--primary);color:var(--on-primary);text-align:center;font-size:13px;padding:9px 16px;letter-spacing:.02em}.ann a{text-decoration:none}
.site-header{background:var(--bg);border-bottom:1px solid var(--border);z-index:20}.site-header.sticky{position:sticky;top:0}
.hdr-in{display:flex;align-items:center;gap:28px;min-height:70px}
.logo{font-family:var(--font-h);font-weight:var(--hw);text-transform:var(--hcase);font-size:22px;text-decoration:none;letter-spacing:-.01em;display:flex;align-items:center}
.nav{display:flex;gap:26px;flex:1}.nav a{text-decoration:none;font-size:15px;color:var(--text);opacity:.85}.nav a:hover,.nav a[aria-current]{opacity:1;text-decoration:underline;text-underline-offset:6px}
.hdr-actions{display:flex;gap:8px;margin-left:auto}
.cart-btn{position:relative;display:grid;place-items:center;width:42px;height:42px;border-radius:999px;text-decoration:none}.cart-btn:hover{background:var(--surface)}
.cart-count{position:absolute;top:2px;right:0;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:var(--accent);color:#fff;font-size:11px;font-weight:700;display:grid;place-items:center}
.menu-toggle{display:none;background:none;border:0;padding:8px;cursor:pointer}
.hdr-centered .hdr-in{display:grid;grid-template-columns:1fr auto 1fr;padding-top:10px}.hdr-centered .logo{grid-column:2;justify-content:center}.hdr-centered .nav{grid-column:1/-1;grid-row:2;justify-content:center;padding:6px 0 14px}.hdr-centered .hdr-actions{grid-column:3;grid-row:1}.hdr-centered .menu-toggle{grid-row:1;grid-column:1}
.hdr-minimal .menu-toggle{display:block}.hdr-minimal .nav{display:none}
body.menu-open .hdr-minimal .nav{display:flex;flex-direction:column;position:absolute;left:0;right:0;top:100%;background:var(--bg);padding:16px 24px;border-bottom:1px solid var(--border);gap:14px}
/* hero */
.hero{position:relative;overflow:hidden;background:var(--surface)}
.hero.h-small{--hh:360px}.hero.h-medium{--hh:520px}.hero.h-large{--hh:680px}
.hl-image{min-height:var(--hh);display:flex;align-items:center;color:#fff;background:#222}
.hero-bg,.hero-slide>img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.hl-image::after{content:"";position:absolute;inset:0;background:rgba(0,0,0,var(--ov))}
.hl-image .hero-copy,.hero-slide .hero-copy{position:relative;z-index:1;width:100%}
.hero-copy .hero-title{font-size:clamp(36px,6vw,72px);max-width:14ch}.al-center .hero-title{margin-left:auto;margin-right:auto}
.hero-text{font-size:18px;max-width:560px;opacity:.9}
.hl-image .eyebrow,.hero-slide .eyebrow{color:#fff;opacity:.85}
.hl-image .btn:not(.btn-alt),.hero-slide .btn{background:#fff;color:#111;border-color:#fff}.hl-image .btn-alt{background:transparent;color:#fff;border-color:#fff}
.hero-split{display:grid;grid-template-columns:1fr 1fr;gap:48px;align-items:center;min-height:calc(var(--hh) - 2*var(--pad))}.hero-media img{width:100%;aspect-ratio:4/5;object-fit:cover;border-radius:var(--r)}
.hl-gradient{min-height:var(--hh);display:flex;align-items:center;color:var(--on-primary);background:linear-gradient(120deg,var(--primary),var(--accent),var(--primary));background-size:300% 300%;animation:zgrad 14s ease infinite}
.hl-gradient .eyebrow{color:inherit;opacity:.8}.hl-gradient .btn{background:var(--on-primary);color:var(--primary);border-color:var(--on-primary)}.hl-gradient .btn-alt{background:transparent;color:var(--on-primary)}
@keyframes zgrad{0%{background-position:0 50%}50%{background-position:100% 50%}100%{background-position:0 50%}}
@media (prefers-reduced-motion:reduce){.hl-gradient{animation:none}}
.hl-text{background:var(--bg)}.hl-text .hero-copy{padding:calc(var(--pad)*1.2) 24px}.hl-text .hero-title{font-size:clamp(40px,8vw,96px);max-width:18ch}
.hl-carousel{color:#fff}.hero-track{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none}.hero-track::-webkit-scrollbar{display:none}
.hero-slide{position:relative;flex:0 0 100%;scroll-snap-align:start;min-height:var(--hh);display:flex;align-items:center;background:#222}.hero-slide::after{content:"";position:absolute;inset:0;background:rgba(0,0,0,var(--ov))}
.car-btn{position:absolute;top:50%;transform:translateY(-50%);z-index:2;width:44px;height:44px;border-radius:999px;border:0;background:rgba(255,255,255,.9);color:#111;cursor:pointer;display:grid;place-items:center}.car-btn.prev{left:16px}.car-btn.next{right:16px}
/* grids & cards */
.grid{display:grid;gap:var(--gap)}.cols-1{grid-template-columns:1fr}.cols-2{grid-template-columns:repeat(2,1fr)}.cols-3{grid-template-columns:repeat(3,1fr)}.cols-4{grid-template-columns:repeat(4,1fr)}.cols-5{grid-template-columns:repeat(5,1fr)}
.pcard{position:relative;display:flex;flex-direction:column}
.pcard-link{text-decoration:none;display:block}
.pcard-img{position:relative;aspect-ratio:var(--ratio);background:var(--surface);border-radius:var(--r);overflow:hidden}
.pcard-img img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transition:opacity .3s,transform .5s}.pcard-img img.alt{opacity:0}
.pcard:hover .pcard-img img.alt{opacity:1}.pcard:hover .pcard-img img:first-child{transform:scale(1.03)}
.pcard-body{padding:12px 0 4px}.pcard-body h3{font-size:16px;margin:0 0 4px;text-transform:none;font-family:var(--font-b);font-weight:600;letter-spacing:0}
.price{margin:0;font-weight:600}.price s,.compare{color:var(--muted);font-weight:400;margin-left:6px}
.quick{margin-top:8px;align-self:flex-start;background:none;border:1px solid var(--border);border-radius:var(--btn-r);padding:7px 14px;font-size:13px;cursor:pointer;text-decoration:none}.quick:hover{border-color:var(--text)}
.center-btn{text-align:center;margin-top:36px}
.ptrack{display:grid;grid-auto-flow:column;grid-auto-columns:calc((100% - 3*var(--gap))/4);gap:var(--gap);overflow-x:auto;scroll-snap-type:x mandatory;padding-bottom:8px;scrollbar-width:thin}.ptrack>*{scroll-snap-align:start}
.car-nav{display:flex;gap:8px}
.ccard{position:relative;display:block;aspect-ratio:4/5;border-radius:var(--r);overflow:hidden;background:var(--surface);text-decoration:none}.ccard img{width:100%;height:100%;object-fit:cover;transition:transform .5s}.ccard:hover img{transform:scale(1.04)}
.ccard-title{position:absolute;left:16px;bottom:16px;background:var(--bg);padding:8px 16px;border-radius:var(--btn-r);font-weight:600}
/* content */
.split{display:grid;grid-template-columns:1fr 1fr;gap:56px;align-items:center}.split.rev .split-media{order:2}
.split-media img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:var(--r)}
.prose{color:var(--muted)}.prose p:last-child{margin-bottom:0}
.feature{padding:8px 0}.f-icon{display:inline-grid;place-items:center;width:48px;height:48px;border-radius:999px;background:var(--surface);color:var(--accent);margin-bottom:14px}.feature h3{font-size:18px}.feature p{color:var(--muted);margin:0}
.features .sec-title,.testimonials .sec-title,.pricing .sec-title,.gallery .sec-title,.locations .sec-title,.clist .sec-title{margin-bottom:28px}
.quote{margin:0;padding:28px;background:var(--surface);border-radius:var(--r)}.quote blockquote{margin:10px 0 16px;font-size:17px}.quote figcaption{color:var(--muted);font-size:14px}.stars{color:var(--accent);letter-spacing:2px}
.logos-title{text-align:center;color:var(--muted);text-transform:uppercase;letter-spacing:.14em;font-size:12px}.logo-row{list-style:none;padding:0;margin:0;display:flex;flex-wrap:wrap;justify-content:center;gap:24px 56px;align-items:center}
.logo-row img{max-height:40px;width:auto;opacity:.7}.wordmark{font-size:22px;opacity:.55;font-weight:700}.wm1{font-family:Georgia,serif;font-style:italic}.wm2{letter-spacing:.2em;text-transform:uppercase;font-size:16px}.wm3{font-family:ui-monospace,monospace}
.faq-list details{border-bottom:1px solid var(--border);padding:18px 0}.faq-list summary{cursor:pointer;font-weight:600;font-size:17px;list-style:none;display:flex;justify-content:space-between;gap:16px}.faq-list summary::after{content:"+";font-size:22px;line-height:1}.faq-list details[open] summary::after{content:"–"}.faq-list .prose{margin-top:10px}
.newsletter{background:var(--surface);text-align:center}.newsletter .sec-sub{margin-left:auto;margin-right:auto}
.nl-form{display:flex;gap:10px;max-width:480px;margin:0 auto}.nl-form input{flex:1;min-width:0;height:48px;padding:0 16px;border:1px solid var(--border);border-radius:var(--btn-r);background:var(--bg)}
.banner-in{position:relative;overflow:hidden;border-radius:var(--r);padding:clamp(32px,6vw,72px);text-align:center}.b-solid .banner-in{background:var(--accent);color:#fff}.b-solid .sec-sub{color:inherit;opacity:.9;margin:0 auto 20px}
.b-outline .banner-in{border:2px solid var(--text)}.b-outline .sec-sub{margin:0 auto 20px}
.b-image .banner-in{color:#fff;background:#222}.banner-bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.55}.banner-copy{position:relative}.b-image .sec-sub{color:#fff;margin:0 auto 20px}
.btn.btn-inv{background:#fff;color:#111;border-color:#fff}
.countdown{text-align:center;background:var(--surface)}.countdown .sec-sub{margin:0 auto 24px}.cd{display:flex;justify-content:center;gap:16px}.cd div{min-width:84px;padding:16px 8px;background:var(--bg);border-radius:var(--r);border:1px solid var(--border)}.cd span{display:block;font:var(--hw) 36px/1 var(--font-h);font-variant-numeric:tabular-nums}.cd small{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.08em}
.modules{list-style:none;padding:0;margin:0;display:grid;gap:12px}.modules details{border:1px solid var(--border);border-radius:var(--r);background:var(--bg)}
.modules summary{display:flex;gap:16px;align-items:center;padding:18px 20px;cursor:pointer;list-style:none}.m-no{font:var(--hw) 14px var(--font-h);color:var(--accent)}.m-title{font-weight:600;flex:1}.m-meta{color:var(--muted);font-size:13px}
.modules ul{list-style:none;margin:0;padding:0 20px 16px 52px;display:grid;gap:8px;color:var(--muted)}.modules li li{display:flex;gap:10px;align-items:center}
.plan{position:relative;padding:32px;border:1px solid var(--border);border-radius:var(--r);background:var(--bg);display:flex;flex-direction:column}.plan.hl{border:2px solid var(--accent);box-shadow:0 20px 50px -30px rgba(0,0,0,.4)}
.plan .badge{position:static;align-self:flex-start;margin-bottom:12px}.plan-price{font:var(--hw) 40px/1.1 var(--font-h)}.plan-price small{font:400 15px var(--font-b);color:var(--muted);margin-left:4px}
.plan ul{list-style:none;padding:0;margin:0 0 24px;display:grid;gap:10px;flex:1}.plan li{display:flex;gap:10px}.plan li .ico{color:var(--accent)}
.gallery figure{margin:0}.gallery img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:var(--r)}.gallery figcaption{color:var(--muted);font-size:14px;margin-top:8px}
.handle{color:var(--muted);text-decoration:none}.insta-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:6px}.insta-cell{aspect-ratio:1;overflow:hidden}.insta-cell img{width:100%;height:100%;object-fit:cover}
.loc{padding:28px;background:var(--surface);border-radius:var(--r)}.loc p{display:flex;gap:10px;color:var(--muted)}
.ptitle{padding-bottom:0}.ptitle .sec-title{font-size:clamp(32px,5vw,56px)}
.contact-list{list-style:none;padding:0;margin:0;display:grid;gap:12px}.contact-list li{display:flex;gap:10px;align-items:center}
.form{display:grid;gap:14px}.form label{display:grid;gap:6px;font-size:14px;font-weight:600}
.form input,.form textarea,.toolbar select,.toolbar input{width:100%;padding:12px 14px;border:1px solid var(--border);border-radius:calc(var(--r)/1.5);background:var(--bg);font-weight:400}
/* collection */
.cmain{padding-top:calc(var(--pad)*.6)}.cmain .ptitle{margin-bottom:24px}
.toolbar select,.toolbar input{height:44px}
.toolbar{display:flex;flex-wrap:wrap;gap:12px;align-items:end;margin-bottom:24px;padding-bottom:16px;border-bottom:1px solid var(--border)}.toolbar label{display:grid;gap:4px;font-size:12px;color:var(--muted);min-width:140px}.toolbar input{width:120px}.count{margin-left:auto;color:var(--muted);font-size:14px}
/* product */
.pmain{padding-top:24px}.crumbs{display:flex;gap:8px;font-size:13px;color:var(--muted);margin-bottom:24px}.crumbs a{text-decoration:none}
.product{display:grid;grid-template-columns:1.1fr 1fr;gap:56px;align-items:start}
.pmain-img{aspect-ratio:var(--ratio);background:var(--surface);border-radius:var(--r);overflow:hidden}.pmain-img img{width:100%;height:100%;object-fit:cover}
.thumbs{display:flex;gap:10px;margin-top:12px;flex-wrap:wrap}.thumb{width:76px;height:76px;padding:0;border:2px solid transparent;border-radius:calc(var(--r)/1.5);overflow:hidden;cursor:pointer;background:var(--surface)}.thumb[aria-current]{border-color:var(--text)}.thumb img{width:100%;height:100%;object-fit:cover}
.pinfo{position:sticky;top:96px}.ptitle-h{font-size:clamp(28px,3.5vw,42px)}.pprice{font-size:22px;font-weight:600}
.opt{border:0;padding:0;margin:0 0 18px}.opt legend{font-size:14px;margin-bottom:8px;color:var(--muted)}.opt legend span{color:var(--text);font-weight:600}
.pills{display:flex;flex-wrap:wrap;gap:8px}.pill input{position:absolute;opacity:0;pointer-events:none}.pill span{display:inline-block;min-width:48px;text-align:center;padding:9px 16px;border:1px solid var(--border);border-radius:var(--btn-r);cursor:pointer;font-size:14px}
.pill input:checked+span{border-color:var(--text);background:var(--text);color:var(--bg)}.pill input:focus-visible+span{outline:2px solid var(--accent);outline-offset:2px}
.pmeta{display:flex;gap:16px;font-size:13px;color:var(--muted)}
.buy{display:flex;gap:12px;margin:16px 0 28px}.buy .btn{flex:1}
.qty{display:inline-grid;grid-template-columns:40px 56px 40px;border:1px solid var(--border);border-radius:var(--btn-r);overflow:hidden;height:46px}.qty button{background:none;border:0;cursor:pointer;font-size:18px}.qty input{border:0;text-align:center;background:transparent;-moz-appearance:textfield;width:100%}
.qty input::-webkit-inner-spin-button{display:none}.qty.sm{grid-template-columns:30px 40px 30px;height:32px;margin-top:6px}
.tabs [role=tablist]{display:flex;gap:20px;border-bottom:1px solid var(--border);margin-bottom:16px}.tabs [role=tab]{background:none;border:0;padding:10px 0;cursor:pointer;color:var(--muted);border-bottom:2px solid transparent;margin-bottom:-1px;font-weight:600}.tabs [role=tab][aria-selected=true]{color:var(--text);border-color:var(--text)}
/* cart */
.lines{list-style:none;margin:0;padding:0}.line{display:grid;grid-template-columns:72px 1fr auto;gap:14px;padding:14px 0;border-bottom:1px solid var(--border);align-items:start}
.line img,.line .noimg{width:72px;height:72px;object-fit:cover;border-radius:calc(var(--r)/1.5);background:var(--surface)}.line-info{display:grid;gap:2px;font-size:14px}.line-info a{font-weight:600;text-decoration:none}.line-info small{color:var(--muted)}.line-info .link{justify-self:start;font-size:12.5px;margin-top:4px}
.subtotal{display:flex;justify-content:space-between;font-size:17px;margin:18px 0}
.cart-sum{max-width:380px;margin-left:auto}
.drawer{position:fixed;inset:0;z-index:50}.drawer-scrim{position:absolute;inset:0;background:rgba(0,0,0,.4)}
.drawer-panel{position:absolute;right:0;top:0;bottom:0;width:min(420px,100%);background:var(--bg);display:flex;flex-direction:column;padding:20px 24px;box-shadow:-20px 0 60px rgba(0,0,0,.2);animation:zin .25s ease}
@keyframes zin{from{transform:translateX(30px);opacity:0}}
.drawer-head{display:flex;justify-content:space-between;align-items:center}.drawer-head h2{font-size:22px;margin:0}.drawer-lines{flex:1;overflow:auto;margin:12px 0}
body.drawer-open{overflow:hidden}
/* checkout */
.co-grid{display:grid;grid-template-columns:1.2fr 1fr;gap:48px;align-items:start}.co-summary{background:var(--surface);border-radius:var(--r);padding:24px}.co-summary h2{font-size:20px}
.co-result{margin-top:20px;padding:20px;border:1px solid var(--border);border-radius:var(--r)}
.paylist{list-style:none;padding:0;margin:0;display:grid;gap:10px}.paylist li{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--border)}
/* footer */
.site-footer{background:var(--surface);padding:56px 0 28px;margin-top:0;font-size:14px}.ft-grid{display:grid;grid-template-columns:2fr repeat(3,1fr);gap:32px}
.site-footer h3{font-size:13px;text-transform:uppercase;letter-spacing:.1em;font-family:var(--font-b)}.site-footer ul{list-style:none;padding:0;margin:0;display:grid;gap:8px}.site-footer a{text-decoration:none;color:var(--muted)}.site-footer a:hover{color:var(--text)}
.ft-brand p{color:var(--muted);max-width:320px;margin-top:12px}.ft-copy{border-top:1px solid var(--border);margin-top:40px;padding-top:20px;color:var(--muted);font-size:13px}
/* responsive */
@media (max-width:1000px){.cols-4,.cols-5{grid-template-columns:repeat(3,1fr)}.ptrack{grid-auto-columns:calc((100% - 2*var(--gap))/3)}.ft-grid{grid-template-columns:1fr 1fr}}
@media (max-width:760px){
.wrap{padding:0 16px}.sec{padding:calc(var(--pad)*.6) 0}
.cols-2,.cols-3,.cols-4,.cols-5{grid-template-columns:1fr 1fr}.features .grid,.testimonials .grid,.pricing .grid,.locations .grid{grid-template-columns:1fr}
.ptrack{grid-auto-columns:70%}.hero-split,.split,.product,.co-grid{grid-template-columns:1fr;gap:28px}.split.rev .split-media{order:0}.pinfo{position:static}
.menu-toggle{display:block}.nav{display:none}.hdr-in{gap:12px;min-height:60px}.hdr-centered .hdr-in{grid-template-columns:auto 1fr auto;padding-top:0}.hdr-centered .nav{display:none}
body.menu-open .nav{display:flex;flex-direction:column;position:absolute;left:0;right:0;top:100%;background:var(--bg);padding:16px;border-bottom:1px solid var(--border);gap:14px}
.site-header{position:relative}.site-header.sticky{position:sticky}
.hero.h-large{--hh:520px}.hero.h-medium{--hh:440px}.hero-copy .hero-title{font-size:clamp(32px,9vw,48px)}.hero-text{font-size:16px}
.insta-grid{grid-template-columns:repeat(3,1fr)}.nl-form{flex-direction:column}.cd div{min-width:64px}.cd span{font-size:26px}
.toolbar label{min-width:0;flex:1 1 40%}.toolbar input{width:100%}.count{margin-left:0;width:100%}.ft-grid{grid-template-columns:1fr}.buy{flex-direction:column}.qty{align-self:flex-start}
}
`;
