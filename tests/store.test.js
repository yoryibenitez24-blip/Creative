// Unit tests for the online store builder (src/store/*): model, templates, renderer, cart, CSV, exporter.
// Run: node --test tests/store.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { posix } from 'node:path';
import { normalizeStore, generateVariants, normalizeProduct, productsToCsv, importProductsCsv, parseCsv, CSV_COLUMNS, PAGE_KEYS, REQUIRED, collectionProducts, imageRefs } from '../src/store/model.js';
import { STORE_TEMPLATES, TEMPLATE_CATEGORIES, createStore } from '../src/store/templates.js';
import { renderPage, sitePages, storeScript, storeCss, resolveHref, routeForPath, pagePath, renderParts, composePage, diffParts } from '../src/store/render.js';
import { SECTIONS, addableSections, PRODUCT_BLOCKS, productBlocks } from '../src/store/sections.js';
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
    assert.ok(html.includes('data-sid="sx"') || ['related-products', 'ugc', 'product-reviews', 'bundle', 'product-carousel'].includes(type), `${type} on ${page}`);
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
    if (hero) assert.ok(hero.settings.layout === 'text' || hero.settings.image || hero.settings.slides.length, t.id + ' hero has a photo');
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

test('live preview: parts, editor markers and minimal patches', () => {
  const s = createStore('voidline'), route = { page: 'home' }, opts = { mode: 'preview', imageUrl: r => 'blob:x/' + r.length, editor: true };
  const a = renderParts(s, route, opts), html = composePage(a, opts);
  for (const sec of s.pages.home) assert.ok(html.includes(`<!--zp:s:${sec.id}-->`) && html.includes(`<!--/zp:s:${sec.id}-->`));
  for (const k of ['ann', 'header', 'footer', 'overlays']) assert.ok(html.includes(`<!--zp:${k}-->`), k);
  assert.match(html, /data-edit="heading"|data-edit="slides\.0\.heading"/); assert.match(html, /data-block="/);
  assert.equal(diffParts(a, renderParts(s, route, opts)), null, 'same store → no patch');
  // editing one heading patches exactly that section
  const t = structuredClone(s), hero = t.pages.home.find(x => x.type === 'hero'); hero.settings.slides[0].heading = 'Changed';
  const p = diffParts(a, renderParts(normalizeStore(t), route, opts));
  assert.deepEqual(Object.keys(p), ['sections']); assert.deepEqual(Object.keys(p.sections), [hero.id]); assert.match(p.sections[hero.id], /Changed/);
  // theme edit → only CSS (and runtime-independent parts) change
  const th = structuredClone(s); th.theme.colors.accent = '#123456';
  const pt = diffParts(a, renderParts(normalizeStore(th), route, opts));
  assert.ok(pt.css.includes('--accent:#123456')); assert.ok(!pt.sections);
  // reorder → order only
  const ro = structuredClone(s); ro.pages.home.reverse();
  const po = diffParts(a, renderParts(normalizeStore(ro), route, opts));
  assert.deepEqual(po.order, ro.pages.home.map(x => x.id)); assert.ok(!po.sections);
  // the exported site has no editor attributes or markers
  const exp = renderPage(s, route, { mode: 'export', imageUrl: r => 'i.svg' });
  assert.doesNotMatch(exp, /data-edit=|data-block=|<!--zp:/);
});

test('fashion templates: 9 new, distinct, photos only from photos.js, varied product-page layouts', () => {
  const ids = ['voidline', 'stride', 'formfield', 'noir', 'indigo', 'littleloom', 'kinetic', 'carryall', 'basket'];
  for (const id of ids) assert.ok(STORE_TEMPLATES.some(t => t.id === id), id);
  assert.ok(STORE_TEMPLATES.length >= 35);
  const layouts = new Set(ids.map(id => createStore(id).pages.product[0].settings.layout));
  assert.deepEqual([...layouts].sort(), ['classic', 'compact', 'editorial', 'stack']);
  const s = createStore('voidline'); assert.equal(s.pages.home[0].settings.layout, 'wordmark');
  assert.equal(createStore('stride').theme.headerStyle, 'pill'); assert.equal(createStore('basket').theme.headerStyle, 'search');
  assert.match(renderPage(createStore('basket'), { page: 'home' }, { mode: 'export', imageUrl }), /class="hbadge"[^>]*>.*Delivery in 15 min/s);
  assert.match(renderPage(createStore('formfield'), { page: 'product' }, { mode: 'export', imageUrl }), /<table class="specs/);
  assert.match(renderPage(s, { page: 'home' }, { mode: 'export', imageUrl }), /class="vindex"/);
});

test('product page: every block renders in every layout; sample data is labelled and opt-in', () => {
  const s = createStore('stride'), p = s.products[0];
  for (const layout of ['classic', 'editorial', 'stack', 'compact']) {
    const st = structuredClone(s);
    st.pages.product[0].settings = { ...st.pages.product[0].settings, layout, blocks: Object.keys(PRODUCT_BLOCKS).map(type => ({ type, on: true, ...structuredClone(PRODUCT_BLOCKS[type].defaults) })) };
    st.products[0].video = 'https://example.com/v.mp4';
    const html = renderPage(normalizeStore(st), { page: 'product', productId: p.id }, { mode: 'export', imageUrl });
    assert.match(html, new RegExp('pl-' + layout));
    for (const [cls, re] of [['breadcrumb', /class="crumbs pb"/], ['price', /data-price/], ['bnpl', /data-bnpl=/], ['dispatch', /data-dispatch=/], ['social', /class="socialp pb"/], ['variants', /name="opt0"/],
      ['size guide modal', /data-modal hidden/], ['buy now', /data-buy-now/], ['delivery', /data-delivery=/], ['trust', /class="trust pb"/], ['accordions', /class="acc pb"/], ['specs', /class="specs pb"/], ['sticky bar', /data-sticky-atc/], ['video', /<video /]])
      assert.match(html, re, `${layout}: ${cls}`);
    assert.doesNotMatch(html, /undefined|NaN|could not be shown/);
  }
  // defaults: social proof (sample numbers) is off, so the exported page makes no such claim
  assert.equal(productBlocks(['social'])[0].on, false); assert.ok(!productBlocks().some(b => b.type === 'social' && b.on));
  const html = renderPage(s, { page: 'product', productId: p.id }, { mode: 'export', imageUrl });
  assert.doesNotMatch(html, /people bought this today|data-toasts/);
  // template reviews are tagged as samples; bundle and recently-viewed render
  assert.ok(p.reviewsList.length && p.reviewsList.every(r => r.sample));
  assert.match(html, /Sample review/); assert.match(html, /data-bundle-add/); assert.match(html, /data-recent=/); assert.match(html, /id="reviews"/);
  // editing a review clears the sample flag in the editor; normalisation keeps flags as given
  assert.equal(normalizeStore({ products: [{ title: 'x', reviewsList: [{ name: 'A', rating: 9, text: 'ok' }] }] }).products[0].reviewsList[0].rating, 5);
});

test('runtime: storeScript of every new template parses; free-shipping threshold reaches the runtime', () => {
  for (const id of ['voidline', 'basket', 'noir']) {
    const s = createStore(id), js = storeScript(s, imageUrl);
    new Function(js);
    assert.ok(js.includes('"freeShipping":' + s.checkout.freeShipping));
  }
});

// ---------- storefront ↔ commerce back office ----------
import { checkoutConfig, commerceKit, commerceScript } from '../src/store/commerce.js';
import { applyDiscounts } from '../src/store/admin/discounts.js';
import { normalizeCommerce } from '../src/store/admin/model.js';
import { computeOrderTotals } from '../src/store/admin/orders.js';

function commerceFixture() {
  const store = createStore('general');
  const [a, b] = store.products;
  const commerce = normalizeCommerce({
    storeId: store.id,
    settings: {
      shipping: { zones: [{ name: 'US', countries: ['US'], rates: [{ id: 'std', name: 'Standard', type: 'free_over', price: 6, threshold: 100 }, { id: 'exp', name: 'Express', type: 'flat', price: 15 }] },
        { name: 'World', countries: ['*'], rates: [{ id: 'w', name: 'Intl', type: 'weight', tiers: [{ upTo: 500, price: 10 }, { upTo: 5000, price: 25 }] }] }] },
      taxes: { inclusive: false, shippingTaxed: true, rates: [{ country: 'US', rate: 5 }, { country: 'US', region: 'CA', rate: 8.25 }] },
      backend: { orderWebhookUrl: 'https://hooks.example.com/orders' },
    },
    discounts: [{ id: 'd10', code: 'SAVE10', type: 'percentage', value: 10 }, { id: 'old', code: 'OLD', type: 'fixed', value: 5, endsAt: '2020-01-01T00:00:00Z' },
      { id: 'big', code: 'BIG', type: 'fixed', value: 20, minimum: { kind: 'amount', value: 500 } }, { id: 'ship', code: 'FREESHIP', type: 'free_shipping' }],
    productMeta: { [a.id]: { weight: 400 }, [b.id]: { weight: 900 } },
  });
  return { store, commerce, a, b };
}

test('commerce: storefront totals match the admin computeOrderTotals (discounts → shipping → tax)', () => {
  const { store, commerce, a, b } = commerceFixture();
  const cfg = checkoutConfig(store, commerce), CK = commerceKit(applyDiscounts);
  assert.equal(cfg.webhook, 'https://hooks.example.com/orders');
  assert.deepEqual(cfg.countries.map(c => c[0]), ['US', '*']);
  const lines = [{ productId: a.id, variantId: a.variants[0].id, price: 29, quantity: 2 }, { productId: b.id, variantId: b.variants[0].id, price: 79, quantity: 1 }];
  const now = '2026-11-07T12:00:00Z';
  for (const input of [{ codes: ['SAVE10'], country: 'US', region: 'CA', rateId: 'exp' }, { codes: [], country: 'US', rateId: 'std' }, { codes: ['FREESHIP', 'SAVE10'], country: 'DE', rateId: 'w' }, { codes: ['BIG', 'OLD', 'NOPE'], country: 'US' }]) {
    const mine = CK.totals(cfg, lines, input, now);
    const admin = computeOrderTotals(store, commerce, { lines, codes: input.codes, shippingRateId: input.rateId || (mine.rates[0] || {}).id, shippingAddress: { country: input.country, province: input.region } }, now);
    for (const k of ['subtotal', 'discountTotal', 'shipping', 'shippingDiscount', 'tax', 'total']) assert.equal(mine[k], admin[k], `${JSON.stringify(input)} ${k}`);
    assert.deepEqual(mine.appliedCodes, admin.appliedCodes);
  }
  const t = CK.totals(cfg, lines, { codes: ['SAVE10', 'OLD', 'NOPE', 'BIG'], country: 'US', region: 'CA', rateId: 'exp' }, now);
  assert.equal(t.discountTotal, 13.7); assert.equal(t.shipping, 15); assert.equal(t.tax, M2((137 - 13.7 + 15) * 0.0825)); assert.equal(t.total, M2(137 - 13.7 + 15 + t.tax));
  const texts = t.messages.map(m => m.text).join(' | ');
  assert.match(texts, /"OLD" has expired/); assert.match(texts, /"NOPE" is not a valid discount code/); assert.match(texts, /Add .* more to eligible items to use "BIG"/);
  // the embedded (serialised) kit gives the same result
  const embedded = new Function(commerceScript() + '\nreturn CK;')();
  assert.deepEqual(embedded.totals(cfg, lines, { codes: ['SAVE10'], country: 'US', region: 'CA', rateId: 'exp' }, now), CK.totals(cfg, lines, { codes: ['SAVE10'], country: 'US', region: 'CA', rateId: 'exp' }, now));
  // order text carries discounts, shipping, tax and total
  const K = cartKit(), D = { name: 'Shop', currency: store.currency, checkout: {} };
  const ls = [{ qty: 2, product: { title: 'Bottle' }, label: '', variant: { sku: '' }, totalCents: 5800 }];
  const text = K.orderText(ls, D, { name: 'Ada' }, t);
  assert.match(text, /Discount \(SAVE10\): −\$13\.70/); assert.match(text, /Shipping \(Express\): \$15\.00/); assert.match(text, /Tax 8\.25%/); assert.match(text, /Total: \$\d+\.\d\d/); assert.match(text, /Discount codes: SAVE10/);
});
const M2 = n => Math.round(n * 100) / 100;

test('commerce: exported store embeds discounts, shipping, tax and the order webhook; markup has the code field', async () => {
  const { store, commerce } = commerceFixture();
  const files = readZip(await exportStoreZip(store, { commerce }));
  const js = new TextDecoder().decode(files.find(f => f.name.endsWith('assets/store.js')).data);
  assert.match(js, /"code":"SAVE10"/); assert.match(js, /hooks\.example\.com\/orders/); assert.match(js, /var CK = /);
  new Function(js);
  const checkout = new TextDecoder().decode(files.find(f => f.name.endsWith('/checkout.html')).data);
  assert.match(checkout, /data-ship-fields/);
  const idx = new TextDecoder().decode(files.find(f => f.name.endsWith('/index.html')).data);
  assert.match(idx, /data-discount-box/); assert.match(idx, /data-summary/);
  // without commerce nothing is embedded
  assert.match(storeScript(store, imageUrl), /"commerce":null/);
  // discounts-only source (StoreBuilder `discounts` prop)
  const cfg = checkoutConfig(store, { discounts: commerce.discounts });
  assert.equal(cfg.discounts.length, 4); assert.deepEqual(cfg.zones, []); assert.equal(cfg.webhook, '');
});

test('template preview links: URL shape and parsing', async () => {
  const { templatePreviewUrl, requestedTemplate } = await import('../src/store/templatePreview.js');
  const { STORE_TEMPLATES } = await import('../src/store/templates.js');
  const id = STORE_TEMPLATES[0].id;
  const url = templatePreviewUrl(id, { origin: 'https://example.com', pathname: '/app/' });
  assert.equal(url, 'https://example.com/app/?template=' + id);
  assert.equal(requestedTemplate(new URL(url).search), id);
  assert.equal(requestedTemplate('?x=1'), null);
});

test('image framing: normalization fills defaults for old documents and clamps bad values', async () => {
  const { frameOf, frameStyle, moveProductImage, removeProductImage, productFrames } = await import('../src/store/frame.js');
  // a document saved before framing existed: no frame fields anywhere
  const s = normalizeStore({
    pages: { home: [{ type: 'hero', settings: { layout: 'carousel', image: 'unsplash:1441986300917-64674bd600d8', slides: [{ image: 'unsplash:1489987707025-afc232f7ea0f', heading: 'A' }] } },
      { type: 'testimonials', settings: { items: [{ quote: 'Q', name: 'N', avatar: 'unsplash:1506794778202-cad84cf45f1d' }] } }] },
    products: [{ id: 'p1', title: 'Tee', images: ['unsplash:1521572163474-6864f9cf17ab', 'unsplash:1556821840-3a63f95609a7'] }],
    collections: [{ id: 'c1', title: 'Tops', image: 'unsplash:1523381210434-271e8be1f52b' }],
  });
  const hero = s.pages.home[0].settings;
  assert.deepEqual([hero.imagePos, hero.imageFit, hero.imageZoom], [{ x: 50, y: 50 }, 'cover', 100]);
  assert.deepEqual([hero.slides[0].imagePos, hero.slides[0].imageFit, hero.slides[0].imageZoom], [{ x: 50, y: 50 }, 'cover', 100]);
  assert.equal(hero.slides[0].heading, 'A');
  assert.deepEqual(s.pages.home[1].settings.items[0].avatarPos, { x: 50, y: 50 });
  assert.deepEqual(s.products[0].imageFrames, [{ x: 50, y: 50, zoom: 100, fit: 'cover' }, { x: 50, y: 50, zoom: 100, fit: 'cover' }]);
  assert.deepEqual([s.collections[0].imagePos, s.collections[0].imageFit, s.collections[0].imageZoom], [{ x: 50, y: 50 }, 'cover', 100]);
  assert.deepEqual(normalizeStore(s), s, 'normalization is idempotent');
  for (const t of STORE_TEMPLATES) { const st = createStore(t.id); for (const p of st.products) assert.equal(p.imageFrames.length, p.images.length, t.id); }

  // bad values are clamped; frames follow their images
  const bad = normalizeStore({ pages: { home: [{ type: 'hero', settings: { imagePos: { x: 150, y: 'abc' }, imageFit: 'stretch', imageZoom: 20 } }] },
    products: [{ id: 'p', title: 'P', images: ['a', 'b', 'c'], imageFrames: [{ x: 0, y: 0 }, null] }] });
  assert.deepEqual(frameOf(bad.pages.home[0].settings), { x: 100, y: 50, zoom: 100, fit: 'cover' });
  assert.deepEqual(bad.products[0].imageFrames.map(f => [f.x, f.y]), [[0, 0], [50, 50], [50, 50]]);
  const p = structuredClone(bad.products[0]); p.imageFrames[2] = { x: 100, y: 100, zoom: 150, fit: 'cover' };
  moveProductImage(p, 2, 0); assert.deepEqual(p.images, ['c', 'a', 'b']); assert.deepEqual([p.imageFrames[0].x, p.imageFrames[1].x], [100, 0]);
  removeProductImage(p, 0); assert.deepEqual(p.images, ['a', 'b']); assert.deepEqual(productFrames(p).map(f => f.x), [0, 50]);
  assert.equal(frameStyle({ x: 50, y: 50, zoom: 100, fit: 'cover' }), '');
  assert.equal(frameStyle({ x: 30, y: 0, zoom: 150, fit: 'cover' }), 'object-position:30% 0%;scale:1.5;transform-origin:30% 0%');
  assert.equal(frameStyle({ x: 30, y: 0, zoom: 150, fit: 'contain' }), 'object-position:30% 0%;object-fit:contain');
  assert.equal(frameStyle({ x: 30, y: 0, zoom: 150, fit: 'cover' }, { zoom: false }), 'object-position:30% 0%');
});

test('image framing: preview and export render object-position; Unsplash crops stay correct; alignment edits patch only the image', () => {
  const s = createStore('everyday-goods'), home = s.pages.home;
  const hero = home.find(x => x.type === 'hero');
  hero.settings.layout = 'image'; hero.settings.image = 'unsplash:1441986300917-64674bd600d8';
  const before = normalizeStore(s);
  hero.settings.imagePos = { x: 50, y: 0 }; hero.settings.imageZoom = 140;
  const p0 = s.products.find(p => p.status === 'active' && p.images[0]); p0.imageFrames = [{ x: 0, y: 100, zoom: 100, fit: 'cover' }];
  const after = normalizeStore(s);
  for (const mode of ['export', 'preview']) {
    const html = renderPage(after, { page: 'home' }, { mode, imageUrl });
    const img = html.match(/<section[^>]*data-type="hero"[\s\S]*?(<img[^>]*>)/)[1];
    assert.match(img, /style="object-position:50% 0%;scale:1\.4;transform-origin:50% 0%"/, mode);
    assert.match(img, /class="fz"/, mode);
    assert.match(html, /style="object-position:0% 100%"/, mode + ': product card image');
    assert.equal(/data-fr=/.test(html), false, 'data-fr only in the editor');
  }
  const prod = renderPage(after, { page: 'product', productId: p0.id }, { mode: 'export', imageUrl });
  assert.match(prod.match(/<div class="pslide" data-slide="0">(<img[^>]*>)/)[1], /object-position:0% 100%/);
  assert.match(storeCss(after), /:has\(>img\.fz\)\{overflow:hidden\}/);
  // default frames add nothing to the markup
  assert.equal(/object-position/.test(renderPage(before, { page: 'home' }, { mode: 'export', imageUrl }).replace(/<style[\s\S]*?<\/style>/, '')), false);

  // fixed-size (server-cropped) photos are requested uncropped when framed, so CSS positioning applies to the whole photo
  assert.match(photoSrc('unsplash:abc', 'square').src, /&w=480&h=480/);
  const framed = photoSrc('unsplash:abc', 'square', { x: 0, y: 0, zoom: 100, fit: 'cover' }).src;
  assert.doesNotMatch(framed, /&h=/); assert.match(framed, /&w=720/);
  assert.equal(photoSrc('unsplash:abc', 'hero', { x: 0, y: 0, zoom: 100, fit: 'cover' }).src, photoSrc('unsplash:abc', 'hero').src, 'width-only sizes keep their URL');

  // live preview: an alignment change is an image-only patch of that section
  const opts = { mode: 'preview', imageUrl, editor: true };
  const a = renderParts(before, { page: 'home' }, opts);
  const moved = structuredClone(before); moved.pages.home.find(x => x.type === 'hero').settings.imagePos = { x: 50, y: 0 };
  const b = renderParts(normalizeStore(moved), { page: 'home' }, opts);
  const patch = diffParts(a, b);
  assert.deepEqual(Object.keys(patch.sections), [hero.id]);
  assert.match(composePage(b, opts), /data-fr="image"/);
  const f = patch.frames[hero.id];
  assert.equal(f.set.length, 1);
  assert.equal(f.set[0][1].style, 'object-position:50% 0%');
  assert.equal('src' in f.set[0][1], false, 'same photo URL: src is not touched');
  // a text change in the same section is a normal section patch (no frames)
  moved.pages.home.find(x => x.type === 'hero').settings.heading = 'Changed';
  assert.equal(diffParts(b, renderParts(normalizeStore(moved), { page: 'home' }, opts)).frames, undefined);
});

test('creative sections: render in preview and export, keep editor hooks, normalise old documents', () => {
  const s = createStore('general'), pic = 'unsplash:' + ALL_PHOTO_IDS[0];
  const types = ['editorial-hero', 'rail', 'polaroids', 'steps', 'spec-list', 'drop-countdown', 'split-feature'];
  for (const t of types) assert.ok(SECTIONS[t] && SECTIONS[t].pages.includes('home'), t);
  const secs = [
    { id: 'e1', type: 'editorial-hero', settings: { layout: 'split', shape: 'blob', heading: 'Made for *making*', image: pic, image2: pic, sticker: 'Capsule 001 · Small run', metaLeft: 'Capsule 001', background: '#d4f25a' } },
    { id: 'e2', type: 'editorial-hero', settings: { layout: 'stack', heading: 'Plain', image: pic } },
    { id: 'e3', type: 'editorial-hero', settings: { layout: 'collage', heading: 'Collage', image: pic, image2: pic } },
    { id: 'r1', type: 'rail', settings: { source: 'all', limit: 4 } },
    { id: 'p1', type: 'polaroids', settings: { items: [{ image: pic, caption: 'Weekday' }, { image: pic, caption: 'Weekend', link: 'collection:all' }] } },
    { id: 't1', type: 'steps', settings: {} }, { id: 't2', type: 'steps', settings: { style: 'cards' } },
    { id: 'l1', type: 'spec-list', settings: { image: pic, rows: 'Fabric | Cotton\nFit | Relaxed' } },
    { id: 'd1', type: 'drop-countdown', settings: { image: pic, endsAt: '2030-01-01T10:00' } },
    { id: 'f1', type: 'split-feature', settings: { image: pic, shape: 'arch', sticker: 'Soft · Bold' } },
    { id: 'm1', type: 'marquee', settings: { style: 'ticker', separator: '★', tilt: true, background: '#17402d', textColor: '#d4f25a' } },
    { id: 'q1', type: 'testimonials', settings: { style: 'big', rating: '4.9' } },
  ];
  const st = normalizeStore({ ...structuredClone(s), pages: { ...structuredClone(s.pages), home: secs } });
  for (const sec of st.pages.home) for (const [k, v] of Object.entries(SECTIONS[sec.type].defaults)) assert.ok(k in sec.settings, `${sec.type} default ${k} filled`);
  assert.deepEqual(st.pages.home[0].settings.imagePos, { x: 50, y: 50 }, 'image fields get frames');
  assert.ok('image2Pos' in st.pages.home[0].settings && 'imagePos' in st.pages.home[4].settings.items[0]);
  const html = renderPage(st, { page: 'home' }, { mode: 'export', imageUrl });
  assert.doesNotMatch(html, /could not be shown|undefined|NaN|\[object Object\]/);
  for (const id of secs.map(x => x.id)) assert.ok(html.includes(`data-sid="${id}"`), id);
  assert.match(html, /<h1 class="eh-title"><span>Made for <em class="it">making<\/em><\/span><i class="eh-dot"/);
  assert.match(html, /eh-sh-blob/); assert.match(html, /eh-tint/); assert.match(html, /class="sticker /); assert.match(html, /<textPath href="#stk-e1"[^>]*>CAPSULE 001 · SMALL RUN · /);
  assert.match(html, /class="rail-track" data-carousel-track/); assert.match(html, /data-carousel-prev aria-label="Previous items"/); assert.equal((html.match(/class="rail-item"/g) || []).length, 4);
  assert.match(html, /<span class="rail-no">01<\/span>/); assert.match(html, /class="rail-hanger"/);
  assert.match(html, /class="pol p1"><a href=/); assert.match(html, /steps-list n5/); assert.match(html, /st-cards/);
  assert.match(html, /<dt>Fabric<\/dt><span class="sl-dots" aria-hidden="true"><\/span><dd>Cotton<\/dd>/);
  assert.match(html, /data-countdown="2030-01-01T10:00" role="timer"/); assert.match(html, /class="burst b0"/);
  assert.match(html, /sf-media sh-arch/); assert.match(html, /mq-ticker mq-tilt mq-bg/); assert.match(html, /<i aria-hidden="true">★<\/i>/);
  assert.match(html, /tq-big/); assert.match(html, /tq-mark/);
  // editor: inline-editable headings carry the raw *markup*; the export never does
  const pv = renderPage(st, { page: 'home' }, { mode: 'preview', imageUrl, editor: true });
  assert.match(pv, /data-edit="heading" data-raw="Made for \*making\*"/); assert.match(pv, /data-edit="metaLeft"/); assert.match(pv, /data-block="items\.0"/);
  assert.doesNotMatch(html, /data-raw=/);
  // every new section works on every content page with its defaults
  for (const page of ['about', 'contact', 'product', 'collection']) for (const type of types) {
    const x = structuredClone(st); x.pages[page] = [...x.pages[page], { id: 'zz', type, settings: structuredClone(SECTIONS[type].defaults) }];
    const h = renderPage(normalizeStore(x), page === 'product' ? { page, productId: x.products[0].id } : page === 'collection' ? { page, collectionId: 'all' } : { page }, { mode: 'export', imageUrl });
    assert.doesNotMatch(h, /could not be shown|undefined|NaN/, `${type} on ${page}`);
  }
});

test('creative theme options: web fonts, accent italics, tagged cards, footer wordmark', () => {
  const s = createStore('checkmate');
  assert.equal(s.theme.fonts.accent, 'instrument'); assert.equal(s.theme.cardStyle, 'tagged');
  const css = storeCss(s);
  assert.ok(css.startsWith('@import url("https://fonts.googleapis.com/css2?family=Anton&family=Manrope'), css.slice(0, 120));
  assert.match(css, /--font-a:"Instrument Serif"/); assert.match(css, /\.pcard \.badge\{/); assert.match(css, /--on-accent:#ffffff/);
  assert.equal(storeCss(createStore('general')).startsWith('@import'), false, 'system-font themes load nothing');
  const old = normalizeStore({ theme: { fonts: { heading: 'inter', body: 'inter' }, cardStyle: 'tagged' } });
  assert.equal(old.theme.fonts.accent, 'display'); assert.equal(old.theme.cardStyle, 'tagged');
  assert.equal(normalizeStore({ theme: { fonts: { accent: 'nope' } } }).theme.fonts.accent, 'display');
  const html = renderPage(s, { page: 'home' }, { mode: 'export', imageUrl });
  assert.match(html, /class="site-footer ft-dark"/); assert.match(html, /class="ft-wordmark" aria-hidden="true" style="--wl:/);
});

test('creative templates: 10 new, flagged for the gallery, multi-page, built from the creative sections', () => {
  const ids = ['rail', 'checkmate', 'cutout', 'hyperglow', 'raster', 'kiln', 'nightshift', 'glasshouse', 'bubbleblock', 'dialtone'];
  const creative = STORE_TEMPLATES.filter(t => t.creative).map(t => t.id);
  for (const id of ids) assert.ok(creative.includes(id), id);
  assert.ok(STORE_TEMPLATES.length >= 46);
  for (const id of ids) {
    const s = createStore(id), types = new Set(s.pages.home.map(x => x.type));
    assert.ok(['editorial-hero', 'rail', 'polaroids', 'steps', 'spec-list', 'drop-countdown', 'split-feature'].filter(t => types.has(t)).length >= 3, id + ' uses creative sections');
    assert.ok(s.pages.product.some(x => x.type === 'product-main') && s.pages.about.length && s.pages.contact.length, id);
    const dc = s.pages.home.find(x => x.type === 'drop-countdown'); if (dc) assert.ok(dc.settings.endsAt, id + ' countdown has an end');
    assert.doesNotMatch(renderPage(s, { page: 'product', productId: s.products[0].id }, { mode: 'export', imageUrl }), /could not be shown|undefined|NaN/);
  }
  // upgraded classics keep their ids and gain creative sections
  assert.ok(createStore('merch').pages.home.some(x => x.type === 'drop-countdown'));
  assert.ok(createStore('coffee').pages.home.some(x => x.type === 'steps'));
  assert.ok(createStore('plants').pages.home.some(x => x.type === 'spec-list'));
  assert.ok(createStore('boutique').pages.home.some(x => x.type === 'polaroids'));
});
