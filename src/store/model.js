// Store document model for the online-store builder (src/store/StoreBuilder.jsx).
//
// A store is one JSON document (persisted by the host app as-is):
//
// {
//   kind: 'store', version: 1, id, templateId, name,
//   logo: { text, image: ImageRef|null, height },
//   theme: {
//     colors: { background, surface, text, muted, primary, primaryText, accent, border },   // '#rrggbb'
//     fonts: { heading, body },          // keys of FONT_STACKS (system / web-safe stacks only)
//     headingWeight: 400..900, headingCase: 'none'|'uppercase', radius: 0..32 (px),
//     buttons: 'solid'|'outline'|'pill'|'sharp', density: 'compact'|'comfortable'|'airy',
//     headerStyle: 'split'|'left'|'centered'|'minimal', cardStyle: 'plain'|'card'|'bordered',
//     imageRatio: 'square'|'portrait'|'landscape', shadow: 'none'|'soft'|'strong',
//     headingScale: 'regular'|'large'|'huge', tracking: 'tight'|'normal'|'wide'
//   },
//   currency: { code: 'USD', locale: 'en-US' },
//   announcement: { enabled, text, link: LinkTarget, style: 'static'|'marquee' },   // marquee: messages separated by '|'
//   fallbackArt: ImageRef|null,         // procedural art shown when a photo cannot load (offline)
//   layout: { header: Section, footer: Section },     // shared by every page
//   pages: { home, collection, product, about, contact, cart, checkout: Section[] },
//   products: [{ id, title, slug, description, price, compareAt|null, images: ImageRef[],
//                options: [{ name, values: string[] }],
//                variants: [{ id, options: string[] (aligned with product.options), price|null (null = product price),
//                             sku, stock|null (null = not tracked) }],
//                category, tags: string[] ('new' shows a New badge), featured, status: 'active'|'draft',
//                rating: 0..5|null, reviews: int (shown as stars on cards), art: 'gen:…'|null (offline fallback image) }],
//   collections: [{ id, title, slug, description, image, rule: { type: 'all'|'manual'|'category'|'tag', value, productIds } }],
//   navigation: { main: [{ id, label, target: LinkTarget }], footer: [...] },
//   social: { instagram, facebook, tiktok, youtube, x, pinterest },   // full URLs, '' = hidden
//   contact: { email, phone, address, hours },
//   checkout: { mode: 'whatsapp'|'email'|'paymentLinks'|'none', phone, email, paymentLinks: { [productId]: url }, shippingNote, note },
//   seo: { title, description }
// }
//
// Section   = { id, type, hidden?: bool, settings: {...} } — types and settings: src/store/sections.js
// ImageRef  = 'asset:sha256-…' (blob in the app AssetStore) | 'unsplash:<id>' (curated photo from src/store/photos.js, hot-linked)
//             | 'gen:…' (procedural art, src/store/art.js) | 'data:…' | 'https://…'
// LinkTarget= 'home' | 'collection:<id>' | 'collection:all' | 'product:<id>' | 'page:about' | 'page:contact' | 'cart' | 'checkout'
//             | 'url:<absolute url, mailto: or tel:>' | '#<anchor>'

import { SECTIONS } from './sections.js';

export const STORE_VERSION = 1;
export const PAGE_KEYS = ['home', 'collection', 'product', 'about', 'contact', 'cart', 'checkout'];
export const PAGE_LABELS = { home: 'Home', collection: 'Collection', product: 'Product', about: 'About', contact: 'Contact', cart: 'Cart', checkout: 'Checkout' };
/** Sections a page cannot work without (they can be moved and edited, not deleted or hidden). */
export const REQUIRED = { collection: 'collection-main', product: 'product-main', cart: 'cart-main', checkout: 'checkout-main' };
export const CHECKOUT_MODES = [['whatsapp', 'WhatsApp order'], ['email', 'Email order'], ['paymentLinks', 'Payment links'], ['none', 'Catalog only (no checkout)']];
export const CURRENCIES = [['USD', 'en-US'], ['EUR', 'de-DE'], ['GBP', 'en-GB'], ['CAD', 'en-CA'], ['AUD', 'en-AU'], ['JPY', 'ja-JP'], ['INR', 'en-IN'], ['BRL', 'pt-BR'], ['MXN', 'es-MX'], ['CHF', 'de-CH'], ['SEK', 'sv-SE'], ['NZD', 'en-NZ'], ['ZAR', 'en-ZA'], ['AED', 'en-AE'], ['SGD', 'en-SG']];
export const FONT_STACKS = {
  system: ['System sans', 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'],
  inter: ['Neo-grotesk (Inter)', '"Inter Display", Inter, "SF Pro Display", "Helvetica Neue", Arial, sans-serif'],
  avenir: ['Geometric (Avenir)', '"Avenir Next", Avenir, Futura, "Century Gothic", "Inter", "Segoe UI", sans-serif'],
  iowan: ['Book serif (Iowan)', '"Iowan Old Style", Charter, "Bitstream Charter", "Palatino Linotype", Palatino, Georgia, serif'],
  display: ['Display serif (Didot)', 'Didot, "Bodoni 72", "Bodoni MT", "Playfair Display", Charter, "Bitstream Charter", Georgia, serif'],
  helvetica: ['Helvetica / Arial', '"Helvetica Neue", Helvetica, Arial, sans-serif'],
  grotesk: ['Grotesk', '"Arial Black", "Helvetica Neue", Arial, sans-serif'],
  verdana: ['Humanist sans', 'Verdana, "Trebuchet MS", Tahoma, sans-serif'],
  trebuchet: ['Trebuchet', '"Trebuchet MS", "Lucida Grande", "Lucida Sans Unicode", sans-serif'],
  georgia: ['Georgia serif', 'Georgia, "Times New Roman", Times, serif'],
  didone: ['Didone serif', 'Didot, "Bodoni MT", "Bodoni 72", "Playfair Display", Charter, Georgia, serif'],
  garamond: ['Garamond serif', 'Garamond, "EB Garamond", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif'],
  palatino: ['Palatino', '"Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif'],
  mono: ['Monospace', 'ui-monospace, "SF Mono", Menlo, Consolas, "Courier New", monospace'],
  rounded: ['Rounded', 'ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", "Nunito", "Trebuchet MS", sans-serif'],
  condensed: ['Condensed grotesk', '"Bebas Neue", Oswald, "Barlow Condensed", "Roboto Condensed", "Arial Narrow", "Helvetica Neue Condensed", Impact, "Inter Display", sans-serif'],
  impact: ['Impact display', 'Impact, Haettenschweiler, "Arial Narrow Bold", "Arial Black", sans-serif'],
};

let counter = 0;
export const uid = (p = 'x') => p + '_' + Date.now().toString(36).slice(-5) + (counter++).toString(36) + Math.random().toString(36).slice(2, 6);
export const slugify = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'item';
const clone = o => JSON.parse(JSON.stringify(o));
const hex = (v, d) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : d;
const num = (v, d, lo = -Infinity, hi = Infinity) => { const n = typeof v === 'string' && v.trim() === '' ? NaN : +v; return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const pick = (v, list, d) => list.includes(v) ? v : d;
const str = (v, d = '') => v == null ? d : String(v);

export const DEFAULT_THEME = {
  colors: { background: '#ffffff', surface: '#f5f5f4', text: '#171717', muted: '#6b6b6b', primary: '#171717', primaryText: '#ffffff', accent: '#e85d2a', border: '#e5e5e5' },
  fonts: { heading: 'system', body: 'system' }, headingWeight: 700, headingCase: 'none', radius: 8,
  buttons: 'pill', density: 'comfortable', headerStyle: 'split', cardStyle: 'plain', imageRatio: 'portrait', shadow: 'soft', headingScale: 'large', tracking: 'tight',
};

export function newSection(type, settings = {}) {
  const def = SECTIONS[type];
  if (!def) throw Error('Unknown section type ' + type);
  return { id: uid('s'), type, hidden: false, settings: { ...clone(def.defaults || {}), ...clone(settings) } };
}

export function newProduct(over = {}) {
  const p = { id: uid('p'), title: 'New product', slug: '', description: '', price: 0, compareAt: null, images: [], options: [], variants: [], category: '', tags: [], featured: false, status: 'active', ...over };
  return normalizeProduct(p);
}

/** Cartesian product of the option values. Keeps existing variants (price/SKU/stock) whose option values match. */
export function generateVariants(product) {
  const opts = (product.options || []).filter(o => o.name && o.values && o.values.length);
  let combos = [[]];
  for (const o of opts) combos = combos.flatMap(c => o.values.map(v => [...c, v]));
  const old = new Map((product.variants || []).map(v => [(v.options || []).join('\u0001'), v]));
  const base = slugify(product.slug || product.title).toUpperCase();
  return combos.map(c => {
    const prev = old.get(c.join('\u0001'));
    if (prev) return { ...prev, options: c };
    return { id: uid('v'), options: c, price: null, sku: [base, ...c.map(v => slugify(v).toUpperCase())].join('-').slice(0, 48), stock: null };
  });
}

export function normalizeProduct(p) {
  const out = {
    id: str(p.id) || uid('p'), title: str(p.title, 'Untitled product').trim() || 'Untitled product', slug: slugify(p.slug || p.title),
    description: str(p.description), price: num(p.price, 0, 0), compareAt: p.compareAt == null || p.compareAt === '' ? null : num(p.compareAt, null, 0),
    images: Array.isArray(p.images) ? p.images.filter(x => typeof x === 'string' && x) : [],
    options: (Array.isArray(p.options) ? p.options : []).slice(0, 3).map(o => ({ name: str(o.name).trim(), values: [...new Set((o.values || []).map(v => str(v).trim()).filter(Boolean))] })).filter(o => o.name),
    variants: [], category: str(p.category).trim(), tags: (Array.isArray(p.tags) ? p.tags : str(p.tags).split(/[;,]/)).map(t => str(t).trim()).filter(Boolean),
    featured: !!p.featured, status: pick(p.status, ['active', 'draft'], 'active'),
    rating: p.rating == null || p.rating === '' ? null : Math.round(num(p.rating, 0, 0, 5) * 10) / 10, reviews: Math.round(num(p.reviews, 0, 0)),
    art: typeof p.art === 'string' && p.art.startsWith('gen:') ? p.art : null,
  };
  const given = (Array.isArray(p.variants) ? p.variants : []).map(v => ({
    id: str(v.id) || uid('v'), options: (v.options || []).map(x => str(x)), price: v.price == null || v.price === '' ? null : num(v.price, null, 0),
    sku: str(v.sku), stock: v.stock == null || v.stock === '' ? null : Math.round(num(v.stock, 0, 0)),
  }));
  out.variants = generateVariants({ ...out, variants: given });
  return out;
}

export const variantPrice = (p, v) => v && v.price != null ? v.price : p.price;
export const variantLabel = (p, v) => (v?.options || []).join(' / ');
export const inStock = v => v.stock == null || v.stock > 0;

function uniqueSlugs(list) {
  const seen = new Set();
  for (const it of list) { let s = it.slug || 'item', k = 2; while (seen.has(s)) s = it.slug + '-' + k++; it.slug = s; seen.add(s); }
}

function normalizeSection(s, page) {
  if (!s || !SECTIONS[s.type]) return null;
  const def = SECTIONS[s.type];
  if (page && def.pages && !def.pages.includes(page) && !def.pages.includes('*')) return null;
  return { id: str(s.id) || uid('s'), type: s.type, hidden: REQUIRED[page] === s.type ? false : !!s.hidden, settings: { ...clone(def.defaults || {}), ...(s.settings || {}) } };
}

export function normalizeLink(t) {
  t = str(t).trim();
  if (/^(home|cart|checkout|collection:[\w-]+|product:[\w-]+|page:(about|contact)|url:.+|#[\w-]+)$/.test(t)) return t;
  if (/^(https?:|mailto:|tel:)/i.test(t)) return 'url:' + t;
  return 'home';
}

/** Return a complete, valid store document (defaults filled, ids/slugs unique, required sections present). */
export function normalizeStore(input) {
  const s = input && typeof input === 'object' ? clone(input) : {};
  const th = s.theme || {}, dc = DEFAULT_THEME.colors, c = th.colors || {};
  const out = {
    kind: 'store', version: STORE_VERSION, id: str(s.id) || uid('store'), templateId: str(s.templateId), name: str(s.name, 'My store').trim() || 'My store',
    logo: { text: str(s.logo?.text ?? s.name ?? 'My store'), image: typeof s.logo?.image === 'string' && s.logo.image ? s.logo.image : null, height: num(s.logo?.height, 32, 16, 120) },
    theme: {
      colors: Object.fromEntries(Object.keys(dc).map(k => [k, hex(c[k], dc[k])])),
      fonts: { heading: FONT_STACKS[th.fonts?.heading] ? th.fonts.heading : 'system', body: FONT_STACKS[th.fonts?.body] ? th.fonts.body : 'system' },
      headingWeight: Math.round(num(th.headingWeight, 700, 300, 900) / 100) * 100, headingCase: pick(th.headingCase, ['none', 'uppercase'], 'none'), radius: num(th.radius, 8, 0, 32),
      buttons: pick(th.buttons, ['solid', 'outline', 'pill', 'sharp'], 'solid'), density: pick(th.density, ['compact', 'comfortable', 'airy'], 'comfortable'),
      headerStyle: pick(th.headerStyle, ['split', 'left', 'centered', 'minimal'], 'split'), cardStyle: pick(th.cardStyle, ['plain', 'card', 'bordered'], 'plain'),
      imageRatio: pick(th.imageRatio, ['square', 'portrait', 'landscape'], 'portrait'),
      shadow: pick(th.shadow, ['none', 'soft', 'strong'], 'soft'), headingScale: pick(th.headingScale, ['regular', 'large', 'huge'], 'large'), tracking: pick(th.tracking, ['tight', 'normal', 'wide'], 'tight'),
    },
    currency: { code: /^[A-Z]{3}$/.test(s.currency?.code || '') ? s.currency.code : 'USD', locale: str(s.currency?.locale, 'en-US') || 'en-US' },
    announcement: { enabled: s.announcement ? !!s.announcement.enabled : false, text: str(s.announcement?.text), link: s.announcement?.link ? normalizeLink(s.announcement.link) : '', style: pick(s.announcement?.style, ['static', 'marquee'], 'static') },
    fallbackArt: typeof s.fallbackArt === 'string' && s.fallbackArt.startsWith('gen:') ? s.fallbackArt : null,
    layout: {
      header: normalizeSection(s.layout?.header?.type === 'header' ? s.layout.header : { type: 'header' }),
      footer: normalizeSection(s.layout?.footer?.type === 'footer' ? s.layout.footer : { type: 'footer' }),
    },
    pages: {},
    products: (Array.isArray(s.products) ? s.products : []).map(normalizeProduct),
    collections: [],
    navigation: {},
    social: Object.fromEntries(['instagram', 'facebook', 'tiktok', 'youtube', 'x', 'pinterest'].map(k => [k, str(s.social?.[k]).trim()])),
    contact: { email: str(s.contact?.email), phone: str(s.contact?.phone), address: str(s.contact?.address), hours: str(s.contact?.hours) },
    checkout: {
      mode: pick(s.checkout?.mode, CHECKOUT_MODES.map(m => m[0]), 'whatsapp'), phone: str(s.checkout?.phone), email: str(s.checkout?.email),
      paymentLinks: Object.fromEntries(Object.entries(s.checkout?.paymentLinks || {}).filter(([, v]) => typeof v === 'string' && v.trim()).map(([k, v]) => [k, v.trim()])),
      shippingNote: str(s.checkout?.shippingNote), note: str(s.checkout?.note),
    },
    seo: { title: str(s.seo?.title), description: str(s.seo?.description) },
  };
  uniqueSlugs(out.products);
  const ids = new Set(); for (const p of out.products) { if (ids.has(p.id)) p.id = uid('p'); ids.add(p.id); }
  out.collections = (Array.isArray(s.collections) ? s.collections : []).map(col => ({
    id: str(col.id) || uid('c'), title: str(col.title, 'Collection') || 'Collection', slug: slugify(col.slug || col.title), description: str(col.description),
    image: typeof col.image === 'string' && col.image ? col.image : null,
    rule: { type: pick(col.rule?.type, ['all', 'manual', 'category', 'tag'], 'all'), value: str(col.rule?.value), productIds: (col.rule?.productIds || []).filter(id => ids.has(id)) },
  }));
  uniqueSlugs(out.collections); for (const col of out.collections) if (col.slug === 'all') col.slug = 'all-' + col.id.slice(-4);
  for (const k of ['main', 'footer']) out.navigation[k] = (Array.isArray(s.navigation?.[k]) ? s.navigation[k] : k === 'main' ? [{ label: 'Shop', target: 'collection:all' }, { label: 'About', target: 'page:about' }, { label: 'Contact', target: 'page:contact' }] : [])
    .map(it => ({ id: str(it.id) || uid('n'), label: str(it.label, 'Link'), target: normalizeLink(it.target) }));
  for (const page of PAGE_KEYS) {
    const list = (Array.isArray(s.pages?.[page]) ? s.pages[page] : defaultPage(page)).map(x => normalizeSection(x, page)).filter(Boolean);
    const sids = new Set(); for (const x of list) { if (sids.has(x.id)) x.id = uid('s'); sids.add(x.id); }
    if (REQUIRED[page] && !list.some(x => x.type === REQUIRED[page])) list.push(newSection(REQUIRED[page]));
    out.pages[page] = list;
  }
  return out;
}

export function defaultPage(page) {
  const S = (type, settings) => ({ type, settings });
  switch (page) {
    case 'home': return [S('hero'), S('featured-products'), S('newsletter')];
    case 'collection': return [S('collection-main')];
    case 'product': return [S('product-main'), S('related-products')];
    case 'about': return [S('page-title', { heading: 'About us' }), S('rich-text')];
    case 'contact': return [S('page-title', { heading: 'Contact' }), S('contact-form')];
    case 'cart': return [S('cart-main')];
    case 'checkout': return [S('checkout-main')];
  }
  return [];
}

// ---------- queries used by the renderer and the UI ----------
export const activeProducts = store => store.products.filter(p => p.status === 'active');
export function collectionProducts(store, col) {
  const act = activeProducts(store);
  if (!col || col.rule.type === 'all') return act;
  if (col.rule.type === 'manual') { const m = new Map(act.map(p => [p.id, p])); return col.rule.productIds.map(id => m.get(id)).filter(Boolean); }
  const v = col.rule.value.trim().toLowerCase();
  if (col.rule.type === 'category') return act.filter(p => p.category.toLowerCase() === v);
  return act.filter(p => p.tags.some(t => t.toLowerCase() === v));
}
export const categories = store => [...new Set(store.products.map(p => p.category).filter(Boolean))].sort();
export function findProduct(store, id) { return store.products.find(p => p.id === id) || null; }
export function imageRefs(store) {
  const out = new Set(), add = r => { if (typeof r === 'string' && r) out.add(r); };
  add(store.logo.image); add(store.fallbackArt);
  for (const p of store.products) { p.images.forEach(add); add(p.art); }
  for (const c of store.collections) add(c.image);
  const walk = v => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.values(v).forEach(walk); else if (typeof v === 'string' && /^(asset:|gen:|unsplash:|data:image\/)/.test(v)) add(v); };
  for (const page of PAGE_KEYS) walk(store.pages[page].map(s => s.settings));
  walk([store.layout.header.settings, store.layout.footer.settings]);
  return [...out];
}

// ---------- CSV import / export ----------
// One row per variant (Shopify-like). Rows sharing a `handle` form one product; product-level columns are read
// from the first row of each handle. Columns:
//   handle, title, description, category, tags (separated by ';'), status (active|draft), featured (yes|no),
//   price, compare_at, images (image refs or https URLs separated by '|'),
//   option1_name, option1_value, option2_name, option2_value, option3_name, option3_value,
//   variant_sku, variant_price (blank = product price), variant_stock (blank = not tracked), payment_link
export const CSV_COLUMNS = ['handle', 'title', 'description', 'category', 'tags', 'status', 'featured', 'price', 'compare_at', 'images', 'option1_name', 'option1_value', 'option2_name', 'option2_value', 'option3_name', 'option3_value', 'variant_sku', 'variant_price', 'variant_stock', 'payment_link'];

const csvCell = v => { v = v == null ? '' : String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
export function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  text = String(text).replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

export function productsToCsv(store) {
  const lines = [CSV_COLUMNS.join(',')];
  for (const p of store.products) p.variants.forEach((v, i) => {
    const first = i === 0, o = k => p.options[k];
    const row = {
      handle: p.slug, title: first ? p.title : '', description: first ? p.description : '', category: first ? p.category : '', tags: first ? p.tags.join(';') : '',
      status: first ? p.status : '', featured: first ? (p.featured ? 'yes' : 'no') : '', price: first ? p.price : '', compare_at: first && p.compareAt != null ? p.compareAt : '',
      images: first ? p.images.filter(r => !r.startsWith('data:')).join('|') : '', payment_link: first ? store.checkout.paymentLinks[p.id] || '' : '',
      variant_sku: v.sku, variant_price: v.price ?? '', variant_stock: v.stock ?? '',
    };
    for (let k = 0; k < 3; k++) { row[`option${k + 1}_name`] = o(k) ? o(k).name : ''; row[`option${k + 1}_value`] = o(k) ? v.options[k] ?? '' : ''; }
    lines.push(CSV_COLUMNS.map(c => csvCell(row[c])).join(','));
  });
  return lines.join('\r\n') + '\r\n';
}

/**
 * Merge products from CSV into the store (matched by handle = slug; unknown handles are added).
 * Returns { store, added, updated, errors: string[] }. The input store is not mutated.
 */
export function importProductsCsv(store, text) {
  const rows = parseCsv(text), errors = [];
  if (!rows.length) return { store, added: 0, updated: 0, errors: ['The file is empty'] };
  const head = rows[0].map(h => h.trim().toLowerCase());
  if (!head.includes('handle') && !head.includes('title')) return { store, added: 0, updated: 0, errors: ['Missing a "handle" or "title" column'] };
  const get = (r, k) => { const i = head.indexOf(k); return i < 0 ? '' : (r[i] ?? '').trim(); };
  const groups = new Map();
  rows.slice(1).forEach((r, n) => {
    const handle = slugify(get(r, 'handle') || get(r, 'title'));
    if (!get(r, 'handle') && !get(r, 'title')) { errors.push(`Row ${n + 2}: no handle or title`); return; }
    if (!groups.has(handle)) groups.set(handle, []);
    groups.get(handle).push(r);
  });
  const next = clone(store); let added = 0, updated = 0;
  for (const [handle, rs] of groups) {
    const r0 = rs[0], existing = next.products.find(p => p.slug === handle);
    const options = [];
    for (let k = 1; k <= 3; k++) { const name = get(r0, `option${k}_name`); if (name) options.push({ name, values: [...new Set(rs.map(r => get(r, `option${k}_value`)).filter(Boolean))] }); }
    const price = get(r0, 'price');
    if (price && !Number.isFinite(+price)) errors.push(`${handle}: price "${price}" is not a number`);
    const base = existing || { id: uid('p') };
    const p = normalizeProduct({
      ...base, slug: handle, title: get(r0, 'title') || base.title || handle, description: head.includes('description') ? get(r0, 'description') : base.description,
      category: get(r0, 'category') || base.category || '', tags: get(r0, 'tags') ? get(r0, 'tags').split(';') : base.tags || [],
      status: get(r0, 'status') || base.status || 'active', featured: get(r0, 'featured') ? /^(yes|true|1)$/i.test(get(r0, 'featured')) : !!base.featured,
      price: Number.isFinite(+price) && price !== '' ? +price : base.price ?? 0, compareAt: get(r0, 'compare_at') !== '' ? +get(r0, 'compare_at') : null,
      images: get(r0, 'images') ? get(r0, 'images').split('|').map(s => s.trim()).filter(Boolean) : base.images || [],
      options,
      variants: rs.map(r => ({ options: options.map((o, k) => get(r, `option${k + 1}_value`)), sku: get(r, 'variant_sku'), price: get(r, 'variant_price'), stock: get(r, 'variant_stock') })),
    });
    const link = get(r0, 'payment_link');
    if (link) next.checkout.paymentLinks[p.id] = link;
    if (existing) { next.products[next.products.indexOf(existing)] = p; updated++; } else { next.products.push(p); added++; }
  }
  return { store: normalizeStore(next), added, updated, errors };
}
