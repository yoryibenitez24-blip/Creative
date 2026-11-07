// Unit tests for the online store builder (src/store/*): model, templates, renderer, cart, CSV, exporter.
// Run: node --test tests/store.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { posix } from 'node:path';
import { normalizeStore, generateVariants, normalizeProduct, productsToCsv, importProductsCsv, parseCsv, CSV_COLUMNS, PAGE_KEYS, REQUIRED, collectionProducts, imageRefs } from '../src/store/model.js';
import { STORE_TEMPLATES, TEMPLATE_CATEGORIES, createStore } from '../src/store/templates.js';
import { renderPage, sitePages, storeScript, storeCss, resolveHref, routeForPath, pagePath } from '../src/store/render.js';
import { SECTIONS, addableSections } from '../src/store/sections.js';
import { cartKit } from '../src/store/cart.js';
import { buildSiteFiles, exportStoreZip, previewShellHtml, deployInstructions } from '../src/store/exporter.js';
import { artSvg, ART_KINDS, gen } from '../src/store/art.js';
import { readZip } from '../src/ecom/zip.js';
import { ALL_PHOTO_IDS, PHOTO_CREDITS_NOTE } from '../src/store/photos.js';
import { photoSrc } from '../src/store/render.js';

const imageUrl = ref => 'images/' + ref.length + '.svg';

test('normalizeStore fills defaults, clamps values and repairs ids, slugs and required sections', () => {
  const s = normalizeStore({});
  assert.equal(s.kind, 'store'); assert.equal(s.version, 1);
  for (const p of PAGE_KEYS) assert.ok(Array.isArray(s.pages[p]), p);
  for (const [page, type] of Object.entries(REQUIRED)) assert.ok(s.pages[page].some(x => x.type === type), page);
  assert.equal(s.layout.header.type, 'header'); assert.equal(s.layout.footer.type, 'footer');
  assert.equal(s.checkout.mode, 'whatsapp');

  const bad = normalizeStore({
    name: '  ', theme: { colors: { primary: 'red', accent: '#ABCDEF' }, radius: 999, buttons: 'weird', headingWeight: 1234, fonts: { heading: 'comic' } },
    currency: { code: 'usd' }, checkout: { mode: 'bitcoin', paymentLinks: { a: ' https://x ', b: '' } },
    products: [{ id: 'p1', title: 'Same', price: '-5' }, { id: 'p1', title: 'Same', price: 'abc', compareAt: '' }],
    pages: { home: [{ type: 'hero', settings: { heading: 'Hi' } }, { type: 'nope' }, { type: 'product-main' }], checkout: [] },
    collections: [{ title: 'All', rule: { type: 'manual', productIds: ['p1', 'ghost'] } }],
    navigation: { main: [{ label: 'X', target: 'https://example.com' }, { label: 'Y', target: 'javascript:alert(1)' }] },
  });
  assert.equal(bad.name, 'My store');
  assert.equal(bad.theme.colors.primary, '#171717'); assert.equal(bad.theme.colors.accent, '#abcdef');
  assert.equal(bad.theme.radius, 32); assert.equal(bad.theme.buttons, 'solid'); assert.equal(bad.theme.headingWeight, 900); assert.equal(bad.theme.fonts.heading, 'system');
  assert.equal(bad.currency.code, 'USD'); assert.equal(bad.checkout.mode, 'whatsapp'); assert.deepEqual(bad.checkout.paymentLinks, { a: 'https://x' });
  assert.notEqual(bad.products[0].id, bad.products[1].id); assert.deepEqual(bad.products.map(p => p.slug), ['same', 'same-2']);
  assert.equal(bad.products[0].price, 0); assert.equal(bad.products[1].price, 0); assert.equal(bad.products[1].compareAt, null);
  assert.deepEqual(bad.pages.home.map(x => x.type), ['hero'], 'unknown and page-restricted sections are dropped');
  assert.equal(bad.pages.home[0].settings.heading, 'Hi'); assert.equal(bad.pages.home[0].settings.layout, 'image', 'defaults merged');
  assert.deepEqual(bad.pages.checkout.map(x => x.type), ['checkout-main']);
  assert.notEqual(bad.collections[0].slug, 'all', 'collection slug cannot shadow collections/all.html');
  assert.deepEqual(bad.collections[0].rule.productIds, [bad.products[0].id]);
  assert.deepEqual(bad.navigation.main.map(n => n.target), ['url:https://example.com', 'home']);
  assert.deepEqual(normalizeStore(bad), bad, 'idempotent');
});

test('variant generation: Size × Color cartesian product keeps existing variant data', () => {
  const p = normalizeProduct({ title: 'Classic Tee', price: 20, options: [{ name: 'Size', values: ['S', 'M'] }, { name: 'Color', values: ['Red', 'Blue'] }] });
  assert.deepEqual(p.variants.map(v => v.options.join('/')), ['S/Red', 'S/Blue', 'M/Red', 'M/Blue']);
  assert.equal(p.variants[3].sku, 'CLASSIC-TEE-M-BLUE');
  p.variants[3].price = 25; p.variants[3].stock = 3;
  const keepId = p.variants[3].id;
  p.options[0].values.push('L');
  const vs = generateVariants(p);
  assert.equal(vs.length, 6);
  const mb = vs.find(v => v.options.join('/') === 'M/Blue');
  assert.equal(mb.id, keepId); assert.equal(mb.price, 25); assert.equal(mb.stock, 3);
  assert.equal(vs.find(v => v.options.join('/') === 'L/Red').price, null);
  assert.equal(normalizeProduct({ title: 'Plain', price: 5 }).variants.length, 1, 'no options → one default variant');
  assert.deepEqual(normalizeProduct({ title: 'x', options: [{ name: 'Size', values: ['S', 'S', ' ', 'M'] }] }).options[0].values, ['S', 'M']);
});

test('there are 24+ distinct templates; every one builds a valid store and renders every page', () => {
  assert.ok(STORE_TEMPLATES.length >= 24, String(STORE_TEMPLATES.length));
  assert.equal(new Set(STORE_TEMPLATES.map(t => t.id)).size, STORE_TEMPLATES.length);
  assert.equal(new Set(STORE_TEMPLATES.map(t => t.name)).size, STORE_TEMPLATES.length);
  assert.ok(TEMPLATE_CATEGORIES.length >= 6);
  const themes = new Set();
  for (const t of STORE_TEMPLATES) {
    const s = createStore(t.id);
    assert.deepEqual(normalizeStore(s), s, t.id + ' is already normalised');
    assert.ok(s.products.length >= 4, t.id); assert.ok(s.pages.home.length >= 4, t.id);
    assert.ok(s.products.every(p => p.images.length >= 1 && p.variants.length >= 1));
    themes.add(JSON.stringify(s.theme));
    for (const pg of sitePages(s)) {
      const html = renderPage(s, pg.route, { mode: 'export', imageUrl });
      assert.ok(html.startsWith('<!doctype html>'), pg.path);
      assert.doesNotMatch(html, /could not be shown|undefined|NaN|\[object Object\]/, `${t.id} ${pg.path}`);
      assert.match(html, /<main id="main">/);
    }
    // the editor preview (inline CSS + runtime + selection overlay) renders too
    const pv = renderPage(s, { page: 'home' }, { mode: 'preview', imageUrl: r => 'blob:x/' + r.length, editor: true });
    for (const sec of s.pages.home) assert.ok(pv.includes(`data-sid="${sec.id}"`) || sec.hidden, `${t.id} section ${sec.type} is selectable`);
    new Function(storeScript(s, imageUrl));
  }
  assert.equal(themes.size, STORE_TEMPLATES.length, 'every template has its own look');
});

test('every section type renders on its pages with default settings', () => {
  const s = createStore('general');
  for (const page of PAGE_KEYS) for (const { type } of addableSections(page)) {
    const st = structuredClone(s); st.pages[page] = [...st.pages[page], { id: 'sx', type, settings: structuredClone(SECTIONS[type].defaults) }];
    const html = renderPage(normalizeStore(st), { page }, { mode: 'export', imageUrl });
    assert.ok(html.includes('data-sid="sx"') || type === 'related-products', `${type} on ${page}`);
    assert.doesNotMatch(html, /could not be shown|undefined|NaN/, `${type} on ${page}`);
  }
  for (const layout of ['image', 'split', 'gradient', 'carousel', 'text']) {
    const st = structuredClone(s); st.pages.home = [{ id: 'hx', type: 'hero', settings: { ...SECTIONS.hero.defaults, layout, image: 'unsplash:' + ALL_PHOTO_IDS[0] } }];
    const html = renderPage(normalizeStore(st), { page: 'home' }, { mode: 'export', imageUrl });
    assert.match(html, new RegExp('hl-' + layout));
    assert.equal(/class="site-header[^"]* over"/.test(html), ['image', 'carousel', 'gradient'].includes(layout), 'transparent header only over photo/gradient heroes');
  }
});

test('links: paths, relative hrefs and route resolution', () => {
  const s = createStore('boutique'), p = s.products[0], c = s.collections[0];
  assert.equal(pagePath(s, { page: 'product', productId: p.id }), `products/${p.slug}.html`);
  assert.equal(pagePath(s, { page: 'collection', collectionId: c.id }), `collections/${c.slug}.html`);
  assert.equal(resolveHref('products/a.html', '../collections/all.html'), 'collections/all.html');
  assert.equal(resolveHref('index.html', 'pages/about.html'), 'pages/about.html');
  assert.equal(resolveHref('index.html', 'https://x.y/'), null);
  assert.deepEqual(routeForPath(s, `products/${p.slug}.html`), { page: 'product', productId: p.id });
  const html = renderPage(s, { page: 'product', productId: p.id }, { mode: 'export', imageUrl });
  assert.match(html, /href="\.\.\/assets\/styles\.css"/); assert.match(html, /src="\.\.\/assets\/store\.js"/); assert.match(html, /href="\.\.\/index\.html"/);
  // drafts are not published
  const d = structuredClone(s); d.products[0].status = 'draft';
  assert.ok(!sitePages(normalizeStore(d)).some(x => x.path === `products/${p.slug}.html`));
  assert.ok(storeCss(s).includes('--primary:' + s.theme.colors.primary));
});

test('collections by category, tag and manual pick', () => {
  const s = createStore('general');
  const cat = s.collections[0];
  assert.ok(collectionProducts(s, cat).every(p => p.category === cat.rule.value));
  const t = normalizeStore({ ...s, collections: [{ id: 'c1', title: 'Tagged', rule: { type: 'tag', value: 'tech' } }, { id: 'c2', title: 'Pick', rule: { type: 'manual', productIds: [s.products[2].id, s.products[0].id] } }] });
  assert.ok(collectionProducts(t, t.collections[0]).length > 0);
  assert.deepEqual(collectionProducts(t, t.collections[1]).map(p => p.id), [s.products[2].id, s.products[0].id]);
});

test('CSV export → import round trip (quotes, commas, newlines, variants, payment links)', () => {
  const s = createStore('coffee');
  s.products[0].description = 'Line one, with "quotes"\nLine two';
  s.products[0].variants[1].price = 33.5; s.products[0].variants[1].stock = 0;
  s.checkout.paymentLinks[s.products[1].id] = 'https://pay.example/abc';
  const csv = productsToCsv(s);
  assert.equal(parseCsv(csv)[0].join(','), CSV_COLUMNS.join(','));
  const empty = normalizeStore({ ...s, products: [], checkout: { ...s.checkout, paymentLinks: {} } });
  const r = importProductsCsv(empty, csv);
  assert.deepEqual(r.errors, []); assert.equal(r.added, s.products.length); assert.equal(r.updated, 0);
  const strip = st => st.products.map(p => ({ title: p.title, slug: p.slug, description: p.description, price: p.price, compareAt: p.compareAt, images: p.images, options: p.options, category: p.category, tags: p.tags, featured: p.featured, status: p.status, variants: p.variants.map(v => ({ options: v.options, price: v.price, sku: v.sku, stock: v.stock })) }));
  assert.deepEqual(strip(r.store), strip(s));
  assert.equal(r.store.checkout.paymentLinks[r.store.products[1].id], 'https://pay.example/abc');
  // re-import updates in place (matched by handle)
  const again = importProductsCsv(r.store, csv.replace(/,16,,/, ',17,,'));
  assert.equal(again.added, 0); assert.equal(again.updated, s.products.length);
  assert.equal(again.store.products[0].price, 17); assert.equal(again.store.products[0].id, r.store.products[0].id);
  const bad = importProductsCsv(empty, 'foo,bar\n1,2');
  assert.match(bad.errors[0], /handle/);
});

test('cart math, stock clamping and currency formatting (cartKit)', () => {
  const K = cartKit();
  const D = { id: 's', name: 'Shop', currency: { code: 'USD', locale: 'en-US' }, checkout: { mode: 'whatsapp', phone: '15551234567', shippingNote: 'Flat $5' },
    products: [
      { id: 'a', title: 'Tee', price: 0.1, compareAt: null, options: ['Size'], paymentLink: 'https://pay/a', variants: [{ id: 'a1', options: ['S'], price: null, sku: 'TEE-S', stock: null }, { id: 'a2', options: ['M'], price: 0.2, sku: 'TEE-M', stock: 2 }] },
      { id: 'b', title: 'Mug', price: 12.99, compareAt: 15, options: [], paymentLink: '', variants: [{ id: 'b1', options: [], price: null, sku: '', stock: 0 }] }] };
  let cart = K.add([], D, 'a', 'a1', 3);
  cart = K.add(cart, D, 'a', 'a2', 5);               // clamped to stock 2
  cart = K.add(cart, D, 'b', 'b1', 1);               // out of stock → dropped
  cart = K.add(cart, D, 'zz', 'x', 1);               // unknown → dropped
  assert.deepEqual(cart, [{ pid: 'a', vid: 'a1', qty: 3 }, { pid: 'a', vid: 'a2', qty: 2 }]);
  cart = K.add(cart, D, 'a', 'a1', 2);               // merges
  assert.equal(cart[0].qty, 5);
  const ls = K.lines(cart, D), t = K.totals(ls);
  assert.equal(t.subtotalCents, 5 * 10 + 2 * 20); assert.equal(t.count, 7); assert.equal(t.subtotal, 0.9);
  assert.equal(K.formatMoney(t.subtotal, D.currency), '$0.90');
  assert.equal(K.setQty(cart, D, 'a', 'a1', 0).length, 1); assert.equal(K.remove(cart, D, 'a', 'a2').length, 1);
  assert.deepEqual(K.findVariant(D.products[0], ['M']).id, 'a2');
  assert.equal(K.formatMoney(1234.5, { code: 'EUR', locale: 'de-DE' }).replace(/\s/g, ' '), '1.234,50 €');
  assert.equal(K.formatMoney(1500, { code: 'JPY', locale: 'ja-JP' }), '￥1,500');
  const text = K.orderText(ls, D, { name: 'Ada', address: '1 Road' });
  assert.match(text, /5 × Tee \(S\) \[TEE-S\] — \$0\.50/); assert.match(text, /Subtotal: \$0\.90 \(7 items\)/); assert.match(text, /Shipping: Flat \$5/); assert.match(text, /Name: Ada/);
  const wa = new URL(K.whatsappUrl('+1 (555) 123-4567', text));
  assert.equal(wa.host, 'wa.me'); assert.equal(wa.pathname, '/15551234567'); assert.equal(wa.searchParams.get('text'), text);
  const mail = K.mailtoUrl('orders@shop.example', 'Order', 'a&b');
  assert.equal(mail, 'mailto:orders@shop.example?subject=Order&body=a%26b');
  assert.deepEqual(K.paymentPlan(ls), [{ pid: 'a', title: 'Tee', qty: 7, url: 'https://pay/a' }]);
});

test('storeScript embeds the cart kit, runtime and data safely', () => {
  const s = createStore('jewelry');
  s.products[0].title = 'Ring </script><b>';
  const js = storeScript(normalizeStore(s), imageUrl);
  assert.ok(!js.includes('</script>'));
  new Function(js);
  assert.match(js, /"mode":"whatsapp"/);
});

test('export: ZIP has every page, assets and images; all relative links resolve', async () => {
  const s = createStore('sneakers');
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
  s.products[0].images.unshift('asset:sha256-' + 'ab'.repeat(32));
  s.products[1].images.unshift('data:image/png;base64,' + Buffer.from(png).toString('base64'));
  s.products[2].status = 'draft';
  const store = normalizeStore(s);
  const loadAsset = async id => { assert.equal(id, 'sha256-' + 'ab'.repeat(32)); return new Blob([png], { type: 'image/png' }); };
  const zip = await exportStoreZip(store, { loadAsset });
  const files = readZip(zip), root = 'solegrid/';
  const names = new Set(files.map(f => f.name));
  for (const pg of sitePages(store)) assert.ok(names.has(root + pg.path), pg.path);
  for (const f of ['index.html', 'collections/all.html', 'cart.html', 'checkout.html', 'pages/about.html', 'pages/contact.html', 'assets/styles.css', 'assets/store.js', 'README.txt']) assert.ok(names.has(root + f), f);
  assert.ok(!names.has(root + `products/${store.products[2].slug}.html`), 'draft not exported');
  assert.ok(names.has(root + 'images/abababababababab.png'));
  const pngs = files.filter(f => f.name.endsWith('.png'));
  assert.equal(pngs.length, 2); for (const f of pngs) assert.deepEqual([...f.data], [...png]);
  assert.ok(files.filter(f => f.name.endsWith('.svg')).length >= 6);
  for (const ref of imageRefs(store)) assert.ok(!ref.startsWith('gen:') || files.some(f => f.name.endsWith('.svg')));
  const dec = new TextDecoder();
  let checked = 0;
  for (const f of files.filter(f => f.name.endsWith('.html'))) {
    const html = dec.decode(f.data), dir = posix.dirname(f.name);
    assert.doesNotMatch(html, /(src|href)="(blob:|data:|\/)/, f.name + ' uses only relative links');
    for (const [, ref] of html.matchAll(/(?:href|src)="([^"#:?]+)(?:#[^"]*)?"/g)) { assert.ok(names.has(posix.normalize(posix.join(dir, ref))), `${f.name} → ${ref}`); checked++; }
  }
  assert.ok(checked > 200, String(checked));
  const js = dec.decode(files.find(f => f.name === root + 'assets/store.js').data);
  assert.ok(js.includes('products/' + store.products[0].slug + '.html'));
  const readme = dec.decode(files.find(f => f.name === root + 'README.txt').data);
  assert.match(readme, /Netlify[\s\S]*GitHub Pages/); assert.ok(readme.includes(PHOTO_CREDITS_NOTE), 'README credits the photos');
  assert.ok(!files.some(f => /unsplash/.test(f.name)), 'curated photos stay hot-linked');
  // photos carry an offline fallback that points at an exported procedural image
  const idx = dec.decode(files.find(f => f.name === root + 'index.html').data);
  assert.match(idx, /src="https:\/\/images\.unsplash\.com\/photo-[^"]+" srcset="[^"]+ 1x, [^"]+ 2x"/);
  for (const [, fb] of idx.matchAll(/this\.src='([^']+)'/g)) assert.ok(names.has(posix.normalize(posix.join(root, fb))), 'fallback ' + fb);
  assert.match(deployInstructions(store), /never collects card details/);
});

test('preview shell contains every page and a router', () => {
  const s = createStore('books');
  const html = previewShellHtml(s, r => 'blob:x/' + r.length);
  for (const pg of sitePages(s)) assert.ok(html.includes(JSON.stringify(pg.path)), pg.path);
  assert.ok(!/<\/script>(?![\s\S]*<\/body>)/.test(html.slice(0, html.lastIndexOf('</script>'))));
  assert.equal(html.match(/<\/script>/g).length, 1, 'embedded pages cannot terminate the shell script');
});

test('templates use only curated photos from photos.js, with niche photos everywhere', () => {
  const ids = new Set(ALL_PHOTO_IDS);
  for (const t of STORE_TEMPLATES) {
    const s = createStore(t.id), json = JSON.stringify(s);
    const used = [...json.matchAll(/unsplash:([0-9a-f-]+)/g)].map(m => m[1]);
    assert.ok(used.length >= 8, t.id + ' uses photos');
    for (const id of used) assert.ok(ids.has(id), `${t.id}: ${id} is not a curated photo`);
    assert.ok(s.products.every(p => p.images.length && p.images.every(r => r.startsWith('unsplash:')) && p.art.startsWith('gen:')), t.id + ' products: photos + fallback art');
    assert.ok(s.fallbackArt.startsWith('gen:'));
    const hero = s.pages.home.find(x => x.type === 'hero');
    assert.ok(hero.settings.layout === 'text' || hero.settings.image || hero.settings.slides.length, t.id + ' hero has a photo');
    const html = renderPage(s, { page: 'home' }, { mode: 'export', imageUrl });
    for (const [, id] of html.matchAll(/images\.unsplash\.com\/photo-([0-9a-f-]+)\?/g)) assert.ok(ids.has(id), id);
  }
  const p = photoSrc('unsplash:' + ALL_PHOTO_IDS[0], 'card');
  assert.match(p.src, /w=640/); assert.match(p.srcset, /w=1280[^ ]* 2x$/); assert.ok(p.alt.length > 3);
});

test('procedural art renders every kind deterministically', () => {
  for (const k of ART_KINDS) {
    const ref = gen(k, '#f0f0f0', '#222222', '#ff6600', 3), svg = artSvg(ref);
    assert.match(svg, /^<svg [^>]*viewBox="0 0 600 600"/); assert.ok(svg.endsWith('</svg>')); assert.doesNotMatch(svg, /undefined|NaN/, k);
    assert.equal(svg, artSvg(ref));
  }
  assert.match(artSvg(gen('tent', '#ffffff', '#000000', '#ff0000', 1, true)), /viewBox="0 0 1600 900"/);
});
