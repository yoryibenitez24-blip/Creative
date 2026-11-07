// Section library of the store builder. Each entry:
//   { label, group, pages: page keys it can be added to, defaults: settings, fields: inspector schema,
//     render(settings, ctx, section) → HTML string }
// The SAME render functions produce the in-app live preview and the exported static site.
//
// Field schema: { key, label, type, options?, min?, max?, step?, item? (sub-fields for type 'list'), itemLabel?, show?(settings) }
//   types: text | textarea | number | color | select | toggle | image | link | collection | list | datetime
//
// ctx (built by render.js): { store, page, path, root, e(text), t(multiline → <p>), pic(ref, {size, alt, cls, eager, fallback}),
//   img(ref, size) → url, link(target), money(n), products(source, collectionId, limit), card(product, quickAdd, index),
//   icon(name), btn(label, target, cls), stars(rating, reviews), collectionHref(col), productHref(p), allCollections(),
//   collectionImage(col), collectionProducts(col), product, collection, checkoutEnabled, overlayHeader }

const CONTENT = ['home', 'about', 'contact', 'collection', 'product', 'cart', 'checkout'];
const linkF = (key, label) => ({ key, label, type: 'link' });
const imgF = (key = 'image', label = 'Image') => ({ key, label, type: 'image' });
const txt = (key, label) => ({ key, label, type: 'text' });
const area = (key, label) => ({ key, label, type: 'textarea' });
const head = (s, ctx, cls = '') => `<div class="sec-head ${cls}">${s.eyebrow ? `<p class="eyebrow">${ctx.e(s.eyebrow)}</p>` : ''}${s.heading ? `<h2 class="sec-title">${ctx.e(s.heading)}</h2>` : ''}${s.text ? `<div class="sec-sub">${ctx.t(s.text)}</div>` : ''}</div>`;
const hasHead = s => s.heading || s.text || s.eyebrow;
const wrap = (sec, cls, inner, style = '') => `<section class="sec ${cls}" id="${sec.id}"${style ? ` style="${style}"` : ''} data-sid="${sec.id}" data-type="${sec.type}"><div class="wrap" data-reveal>${inner}</div></section>`;
const SOURCE = { key: 'source', label: 'Products', type: 'select', options: [['featured', 'Featured products'], ['all', 'All products'], ['collection', 'From a collection'], ['newest', 'Newest'], ['sale', 'On sale']] };
const COLLECTION = { key: 'collection', label: 'Collection', type: 'collection', show: s => s.source === 'collection' };
const COLS = (o = [2, 3, 4, 5]) => ({ key: 'columns', label: 'Columns', type: 'select', options: o.map(n => [n, String(n)]) });
const EYEBROW = txt('eyebrow', 'Eyebrow');
export const FEATURE_ICONS = ['truck', 'shield', 'refresh', 'star', 'heart', 'leaf', 'clock', 'chat', 'gift', 'bolt', 'check', 'lock', 'globe', 'award', 'users', 'play', 'sparkle', 'box'];
const SOCIAL = { instagram: ['Instagram', 'camera'], facebook: ['Facebook', 'users'], tiktok: ['TikTok', 'music'], youtube: ['YouTube', 'play'], x: ['X', 'at'], pinterest: ['Pinterest', 'pin'] };
const PAY_ICON = s => /card|visa|credit|debit/i.test(s) ? 'card' : /wallet|pay|apple|google/i.test(s) ? 'wallet' : /bank|transfer|wire/i.test(s) ? 'bank' : /cash|delivery|cod/i.test(s) ? 'cash' : 'lock';

function btns(ctx, a, al, b, bl, cls = '') {
  return (a || b) ? `<div class="btns ${cls}">${a ? ctx.btn(a, al, 'btn-lg') : ''}${b ? ctx.btn(b, bl, 'btn-lg btn-ghost') : ''}</div>` : '';
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
    defaults: { sticky: true, transparent: true, showSearch: true, showWishlist: true },
    fields: [{ key: 'sticky', label: 'Sticky header', type: 'toggle' }, { key: 'transparent', label: 'Transparent over the hero', type: 'toggle' },
      { key: 'showSearch', label: 'Search button', type: 'toggle' }, { key: 'showWishlist', label: 'Wishlist button', type: 'toggle' }],
    render: (s, ctx, sec) => {
      const st = ctx.store, style = st.theme.headerStyle;
      const logo = st.logo.image ? `<img src="${ctx.img(st.logo.image, 'logo')}" alt="${ctx.e(st.logo.text || st.name)}" style="height:${st.logo.height}px">` : `<span>${ctx.e(st.logo.text || st.name)}</span>`;
      const links = st.navigation.main.map(n => `<a href="${ctx.link(n.target)}"${ctx.isCurrent(n.target) ? ' aria-current="page"' : ''}>${ctx.e(n.label)}</a>`).join('');
      const icons = [
        s.showSearch ? `<button type="button" class="hicon" data-search-open aria-label="Search">${ctx.icon('search')}</button>` : '',
        s.showWishlist ? `<button type="button" class="hicon" data-wish-open aria-label="Wishlist">${ctx.icon('heart')}<span class="hcount" data-wish-count hidden>0</span></button>` : '',
        ctx.checkoutEnabled ? `<a class="hicon" href="${ctx.link('cart')}" data-cart-open aria-label="Open cart">${ctx.icon('bag')}<span class="hcount" data-cart-count hidden>0</span></a>` : '',
      ].join('');
      return `<header class="site-header hdr-${style}${s.sticky ? ' sticky' : ''}${ctx.overlayHeader ? ' over' : ''}" data-sid="${sec.id}" data-type="header" data-header><div class="wrap hdr-in">
        <button class="hicon menu-toggle" type="button" aria-label="Open menu" aria-expanded="false" aria-controls="nav-drawer" data-menu-toggle>${ctx.icon('menu')}</button>
        <a class="logo" href="${ctx.link('home')}">${logo}</a>
        <nav class="nav" aria-label="Main">${links}</nav>
        <div class="hdr-actions">${icons}</div></div></header>
        <div class="navdrawer" id="nav-drawer" data-navdrawer hidden><div class="drawer-scrim" data-menu-close></div><nav class="navdrawer-panel" aria-label="Menu">
        <div class="drawer-head"><a class="logo" href="${ctx.link('home')}">${ctx.e(st.logo.text || st.name)}</a><button type="button" class="hicon" data-menu-close aria-label="Close menu">${ctx.icon('close')}</button></div>
        <div class="navdrawer-links">${st.navigation.main.map(n => `<a href="${ctx.link(n.target)}">${ctx.e(n.label)}${ctx.icon('arrow')}</a>`).join('')}</div></nav></div>`;
    },
  },

  footer: {
    label: 'Footer', group: 'Layout', pages: [], global: true,
    defaults: { text: 'Thoughtfully made goods, shipped with care.', showSocial: true, showContact: true, payments: '', copyright: '', newsletter: true },
    fields: [area('text', 'About text'), { key: 'newsletter', label: 'Newsletter sign-up', type: 'toggle' }, { key: 'showContact', label: 'Show contact details', type: 'toggle' }, { key: 'showSocial', label: 'Show social links', type: 'toggle' },
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
      return `<footer class="site-footer" data-sid="${sec.id}" data-type="footer"><div class="wrap"><div class="ft-grid">
        <div class="ft-brand"><a class="logo" href="${ctx.link('home')}">${ctx.e(st.logo.text || st.name)}</a>${s.text ? `<p>${ctx.e(s.text)}</p>` : ''}${social}</div>${menu}${contact}${nl}</div>
        <div class="ft-bottom"><p>${ctx.e(s.copyright || `© ${new Date().getFullYear()} ${st.name}`)}</p>${pays.length ? `<ul class="pays" aria-label="Payment methods">${pays.map(p => `<li title="${ctx.e(p)}">${ctx.icon(PAY_ICON(p))}<span>${ctx.e(p)}</span></li>`).join('')}</ul>` : ''}</div></div></footer>`;
    },
  },

  hero: {
    label: 'Hero', group: 'Intro', pages: CONTENT,
    defaults: { layout: 'image', eyebrow: '', heading: 'Made for everyday', text: 'Discover our latest collection.', buttonLabel: 'Shop now', buttonLink: 'collection:all', button2Label: '', button2Link: 'page:about', image: null, slides: [], align: 'left', height: 'large', overlay: 35, background: '', textColor: '', autoplay: 6 },
    fields: [
      { key: 'layout', label: 'Layout', type: 'select', options: [['image', 'Full-bleed photo'], ['carousel', 'Photo carousel'], ['split', 'Split with photo'], ['gradient', 'Moving gradient'], ['text', 'Big type only']] },
      EYEBROW, txt('heading', 'Headline'), area('text', 'Text'),
      txt('buttonLabel', 'Button label'), linkF('buttonLink', 'Button link'), txt('button2Label', 'Second button label'), linkF('button2Link', 'Second button link'),
      { ...imgF(), show: s => s.layout !== 'carousel' && s.layout !== 'text' },
      { key: 'slides', label: 'Slides', type: 'list', itemLabel: 'Slide', show: s => s.layout === 'carousel', item: [imgF(), txt('heading', 'Headline'), txt('text', 'Text'), txt('buttonLabel', 'Button label'), linkF('buttonLink', 'Button link')] },
      { key: 'autoplay', label: 'Autoplay (seconds, 0 = off)', type: 'number', min: 0, max: 20, show: s => s.layout === 'carousel' },
      { key: 'align', label: 'Alignment', type: 'select', options: [['left', 'Left'], ['center', 'Center']] },
      { key: 'height', label: 'Height', type: 'select', options: [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large'], ['full', 'Full screen']] },
      { key: 'overlay', label: 'Photo shade (%)', type: 'number', min: 0, max: 85, show: s => s.layout === 'image' || s.layout === 'carousel' },
      { key: 'background', label: 'Background colour', type: 'color' }, { key: 'textColor', label: 'Text colour', type: 'color' },
    ],
    render: (s, ctx, sec) => {
      const vars = [`--ov:${(s.overlay || 0) / 100}`, s.background ? `--hero-bg:${s.background}` : '', s.textColor ? `--hero-fg:${s.textColor}` : ''].filter(Boolean).join(';');
      const cls = `hero hl-${s.layout} h-${s.height} al-${s.align}${ctx.overlayHeader && ctx.firstSectionId === sec.id ? ' under-header' : ''}`;
      const open = (extra = '') => `<section class="${cls}" id="${sec.id}" data-sid="${sec.id}" data-type="hero" style="${vars}"${extra}>`;
      const copy = (x, tag = 'h1') => `<div class="hero-copy">${x.eyebrow ? `<p class="eyebrow">${ctx.e(x.eyebrow)}</p>` : ''}<${tag} class="hero-title">${ctx.e(x.heading || '')}</${tag}>${x.text ? `<div class="hero-text">${ctx.t(x.text)}</div>` : ''}${btns(ctx, x.buttonLabel, x.buttonLink || 'collection:all', x.button2Label, x.button2Link)}</div>`;
      if (s.layout === 'carousel') {
        const slides = s.slides && s.slides.length ? s.slides : [{ image: s.image, heading: s.heading, text: s.text, buttonLabel: s.buttonLabel, buttonLink: s.buttonLink }];
        const n = slides.length;
        return open(` aria-roledescription="carousel" aria-label="${ctx.e(s.heading || 'Highlights')}" data-carousel${s.autoplay > 0 && n > 1 ? ` data-autoplay="${s.autoplay * 1000}"` : ''}`) +
          `<div class="hero-track" data-carousel-track tabindex="0">${slides.map((sl, i) => `<div class="hero-slide" role="group" aria-roledescription="slide" aria-label="${i + 1} of ${n}">
            <div class="hero-media">${sl.image ? ctx.pic(sl.image, { size: 'hero', eager: i === 0 }) : ''}</div><div class="hero-shade"></div>
            <div class="wrap">${copy({ ...sl, eyebrow: i === 0 ? s.eyebrow : sl.eyebrow, button2Label: i === 0 ? s.button2Label : '', button2Link: s.button2Link }, i ? 'h2' : 'h1')}</div></div>`).join('')}</div>
          ${n > 1 ? `<div class="wrap hero-ctrl"><div class="dots" role="group" aria-label="Choose slide">${slides.map((_, i) => `<button type="button" data-dot="${i}" aria-label="Slide ${i + 1}"${i ? '' : ' aria-current="true"'}></button>`).join('')}</div>
          <span class="counter" data-counter>01 / ${String(n).padStart(2, '0')}</span><div class="arrows"><button class="round" type="button" data-carousel-prev aria-label="Previous slide">${ctx.icon('left')}</button><button class="round" type="button" data-carousel-next aria-label="Next slide">${ctx.icon('right')}</button></div></div>` : ''}</section>`;
      }
      if (s.layout === 'split') return open() + `<div class="wrap hero-split"><div class="hero-panel">${copy(s)}</div><div class="hero-media rounded">${s.image ? ctx.pic(s.image, { size: 'wide', eager: true }) : ''}</div></div></section>`;
      if (s.layout === 'image') return open() + `<div class="hero-media">${s.image ? ctx.pic(s.image, { size: 'hero', eager: true }) : ''}</div><div class="hero-shade"></div><div class="wrap">${copy(s)}</div></section>`;
      if (s.layout === 'gradient') return open() + `<div class="hero-orbs" aria-hidden="true"><i></i><i></i><i></i></div><div class="wrap hero-grad">${copy(s)}${s.image ? `<div class="hero-float">${ctx.pic(s.image, { size: 'wide', eager: true })}</div>` : ''}</div></section>`;
      return open() + `<div class="wrap">${copy(s)}</div></section>`;
    },
  },

  marquee: {
    label: 'Scrolling text', group: 'Intro', pages: CONTENT,
    defaults: { text: 'New season | Free shipping | Easy returns | Made to last', style: 'solid', speed: 30 },
    fields: [txt('text', 'Words (separated by |)'), { key: 'style', label: 'Style', type: 'select', options: [['solid', 'Solid'], ['outline', 'Outline'], ['accent', 'Accent band']] }, { key: 'speed', label: 'Seconds per loop', type: 'number', min: 8, max: 120 }],
    render: (s, ctx, sec) => {
      const words = String(s.text || '').split('|').map(x => x.trim()).filter(Boolean);
      const run = words.map(w => `<span>${ctx.e(w)}</span><i aria-hidden="true">✦</i>`).join('');
      return `<section class="marquee mq-${s.style}" id="${sec.id}" data-sid="${sec.id}" data-type="marquee" style="--speed:${s.speed || 30}s"><div class="mq-track" aria-hidden="true"><div class="mq-run">${run}${run}</div><div class="mq-run">${run}${run}</div></div><p class="sr">${ctx.e(words.join(', '))}</p></section>`;
    },
  },

  'featured-products': {
    label: 'Featured products', group: 'Products', pages: CONTENT,
    defaults: { eyebrow: '', heading: 'Best sellers', text: '', source: 'featured', collection: '', limit: 8, columns: 4, showQuickAdd: true, buttonLabel: 'View all', buttonLink: 'collection:all' },
    fields: [EYEBROW, txt('heading', 'Heading'), area('text', 'Text'), SOURCE, COLLECTION, { key: 'limit', label: 'Products shown', type: 'number', min: 1, max: 24 }, COLS(),
      { key: 'showQuickAdd', label: 'Quick add buttons', type: 'toggle' }, txt('buttonLabel', 'Button label'), linkF('buttonLink', 'Button link')],
    render: (s, ctx, sec) => {
      let ps = ctx.products(s.source, s.collection, s.limit);
      if (ps.length > s.columns && ps.length % s.columns) ps = ps.slice(0, ps.length - ps.length % s.columns); // no orphan row
      return wrap(sec, 'featured', `<div class="sec-head row">${head(s, ctx, 'flat')}${s.buttonLabel ? `<a class="more" href="${ctx.link(s.buttonLink)}">${ctx.e(s.buttonLabel)}${ctx.icon('arrow')}</a>` : ''}</div>${ps.length ? `<div class="grid pgrid cols-${s.columns}">${ps.map((p, i) => ctx.card(p, s.showQuickAdd, i)).join('')}</div>` : '<p class="empty">No products to show yet.</p>'}`);
    },
  },

  'product-carousel': {
    label: 'Product carousel', group: 'Products', pages: CONTENT,
    defaults: { eyebrow: '', heading: 'New arrivals', source: 'newest', collection: '', limit: 10 },
    fields: [EYEBROW, txt('heading', 'Heading'), SOURCE, COLLECTION, { key: 'limit', label: 'Products shown', type: 'number', min: 2, max: 24 }],
    render: (s, ctx, sec) => {
      const ps = ctx.products(s.source, s.collection, s.limit);
      return wrap(sec, 'pcarousel', `<div class="sec-head row">${head(s, ctx, 'flat')}<div class="arrows"><button class="round light" type="button" data-carousel-prev aria-label="Scroll back">${ctx.icon('left')}</button><button class="round" type="button" data-carousel-next aria-label="Scroll forward">${ctx.icon('right')}</button></div></div>
        <div class="ptrack" data-carousel-track tabindex="0" aria-label="${ctx.e(s.heading || 'Products')}">${ps.map((p, i) => ctx.card(p, true, i)).join('')}</div>`);
    },
  },

  'collection-list': {
    label: 'Category cards', group: 'Products', pages: CONTENT,
    defaults: { eyebrow: '', heading: 'Shop by category', collections: [], columns: 4, style: 'tall' },
    fields: [EYEBROW, txt('heading', 'Heading'), COLS([2, 3, 4]), { key: 'style', label: 'Card shape', type: 'select', options: [['tall', 'Tall'], ['square', 'Square'], ['wide', 'Wide']] }],
    render: (s, ctx, sec) => {
      const cols = ctx.allCollections();
      return wrap(sec, 'clist', `${hasHead(s) ? head(s, ctx) : ''}<div class="grid cols-${s.columns} cc-${s.style}">${cols.map(c => {
        const im = c.image || ctx.collectionImage(c), n = ctx.collectionProducts(c).length;
        return `<a class="ccard" href="${ctx.collectionHref(c)}">${im ? ctx.pic(im, { size: 'card', alt: '' }) : ''}<span class="ccard-label"><span><b>${ctx.e(c.title)}</b><small>${n} ${n === 1 ? 'product' : 'products'}</small></span><span class="round sm">${ctx.icon('arrow')}</span></span></a>`;
      }).join('')}</div>`);
    },
  },

  'image-text': {
    label: 'Editorial image with text', group: 'Content', pages: CONTENT,
    defaults: { image: null, eyebrow: '', heading: 'Our story', text: 'Tell customers what makes your products special.', buttonLabel: '', buttonLink: 'page:about', imageSide: 'left', layout: 'split' },
    fields: [imgF(), EYEBROW, txt('heading', 'Heading'), area('text', 'Text'), txt('buttonLabel', 'Button label'), linkF('buttonLink', 'Button link'),
      { key: 'imageSide', label: 'Image side', type: 'select', options: [['left', 'Left'], ['right', 'Right']] }, { key: 'layout', label: 'Layout', type: 'select', options: [['split', 'Side by side'], ['overlap', 'Overlapping card'], ['full', 'Full-width photo']] }],
    render: (s, ctx, sec) => wrap(sec, `imgtext it-${s.layout}`, `<div class="split ${s.imageSide === 'right' ? 'rev' : ''}"><div class="split-media">${s.image ? ctx.pic(s.image, { size: 'wide' }) : ''}</div>
      <div class="split-copy">${s.eyebrow ? `<p class="eyebrow">${ctx.e(s.eyebrow)}</p>` : ''}<h2 class="sec-title">${ctx.e(s.heading)}</h2><div class="prose">${ctx.t(s.text)}</div>${s.buttonLabel ? `<div class="btns">${ctx.btn(s.buttonLabel, s.buttonLink, 'btn-lg')}</div>` : ''}</div></div>`),
  },

  bento: {
    label: 'Bento grid', group: 'Content', pages: CONTENT,
    defaults: { eyebrow: '', heading: 'Why people love us', items: [{ image: null, title: 'Made to last', text: 'Quality you can feel.', link: 'collection:all' }, { image: null, title: 'Free shipping', text: 'On every order over 50.', link: '' }, { image: null, title: 'Easy returns', text: '30 days, no questions.', link: '' }] },
    fields: [EYEBROW, txt('heading', 'Heading'), { key: 'items', label: 'Tiles', type: 'list', itemLabel: 'Tile', item: [imgF(), txt('title', 'Title'), area('text', 'Text'), linkF('link', 'Link')] }],
    render: (s, ctx, sec) => wrap(sec, 'bento', `${hasHead(s) ? head(s, ctx) : ''}<div class="bento-grid n${Math.min(5, (s.items || []).length)}">${(s.items || []).map((it, i) => {
      const inner = `${it.image ? ctx.pic(it.image, { size: i === 0 ? 'wide' : 'card' }) : ''}<div class="bento-copy"><h3>${ctx.e(it.title)}</h3>${it.text ? `<p>${ctx.e(it.text)}</p>` : ''}</div>${it.link ? `<span class="round sm">${ctx.icon('arrow')}</span>` : ''}`;
      const cls = `tile${it.image ? ' has-img' : ''} t${i}`;
      return it.link ? `<a class="${cls}" href="${ctx.link(it.link)}">${inner}</a>` : `<div class="${cls}">${inner}</div>`;
    }).join('')}</div>`),
  },

  features: {
    label: 'Features / benefits', group: 'Content', pages: CONTENT,
    defaults: { heading: '', columns: 3, style: 'cards', items: [{ icon: 'truck', title: 'Free shipping', text: 'On orders over 50.' }, { icon: 'refresh', title: '30-day returns', text: 'Change your mind? No problem.' }, { icon: 'shield', title: 'Secure checkout', text: 'Your details stay private.' }] },
    fields: [txt('heading', 'Heading'), COLS([2, 3, 4]), { key: 'style', label: 'Style', type: 'select', options: [['cards', 'Cards'], ['strip', 'Compact strip']] },
      { key: 'items', label: 'Features', type: 'list', itemLabel: 'Feature', item: [{ key: 'icon', label: 'Icon', type: 'select', options: FEATURE_ICONS.map(i => [i, i[0].toUpperCase() + i.slice(1)]) }, txt('title', 'Title'), area('text', 'Text')] }],
    render: (s, ctx, sec) => wrap(sec, `features f-${s.style}`, `${s.heading ? `<div class="sec-head"><h2 class="sec-title">${ctx.e(s.heading)}</h2></div>` : ''}<div class="grid cols-${s.columns}">${(s.items || []).map(it => `<div class="feature"><span class="f-icon" aria-hidden="true">${ctx.icon(it.icon)}</span><div><h3>${ctx.e(it.title)}</h3><p>${ctx.e(it.text)}</p></div></div>`).join('')}</div>`),
  },

  testimonials: {
    label: 'Testimonials', group: 'Social proof', pages: CONTENT,
    defaults: { eyebrow: 'Reviews', heading: 'What customers say', items: [{ quote: 'Exactly as described and beautifully packed.', name: 'Sam R.', role: 'Verified buyer', avatar: null }, { quote: 'Fast delivery and great quality. Ordering again!', name: 'Priya K.', role: 'Verified buyer', avatar: null }, { quote: 'My new favourite shop.', name: 'Leo M.', role: 'Verified buyer', avatar: null }] },
    fields: [EYEBROW, txt('heading', 'Heading'), { key: 'items', label: 'Testimonials', type: 'list', itemLabel: 'Testimonial', item: [area('quote', 'Quote'), txt('name', 'Name'), txt('role', 'Role'), imgF('avatar', 'Photo')] }],
    render: (s, ctx, sec) => wrap(sec, 'testimonials', `${head(s, ctx, 'center')}<div class="grid cols-3">${(s.items || []).map(it => `<figure class="quote"><div class="stars" role="img" aria-label="5 out of 5 stars">${ctx.icon('star-fill').repeat(5)}</div><blockquote>“${ctx.e(it.quote)}”</blockquote>
      <figcaption>${it.avatar ? ctx.pic(it.avatar, { size: 'avatar', cls: 'avatar', alt: '' }) : `<span class="avatar initials" aria-hidden="true">${ctx.e(String(it.name || '?').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase())}</span>`}<span><strong>${ctx.e(it.name)}</strong>${it.role ? `<small>${ctx.e(it.role)}</small>` : ''}</span></figcaption></figure>`).join('')}</div>`),
  },

  logos: {
    label: 'Logos strip', group: 'Social proof', pages: CONTENT,
    defaults: { heading: 'As featured in', items: [{ name: 'Northwind' }, { name: 'Lumen Daily' }, { name: 'The Habit' }, { name: 'Field Notes' }, { name: 'Kinfolk & Co' }] },
    fields: [txt('heading', 'Heading'), { key: 'items', label: 'Logos', type: 'list', itemLabel: 'Logo', item: [txt('name', 'Name'), imgF('image', 'Logo image')] }],
    render: (s, ctx, sec) => wrap(sec, 'logos', `${s.heading ? `<p class="logos-title">${ctx.e(s.heading)}</p>` : ''}<ul class="logo-row">${(s.items || []).map((it, i) => `<li>${it.image ? `<img src="${ctx.img(it.image, 'logo')}" alt="${ctx.e(it.name)}">` : `<span class="wordmark wm${i % 4}">${ctx.e(it.name)}</span>`}</li>`).join('')}</ul>`),
  },

  faq: {
    label: 'FAQ', group: 'Content', pages: CONTENT,
    defaults: { eyebrow: 'FAQ', heading: 'Questions, answered', text: '', items: [{ q: 'How long does shipping take?', a: 'Orders ship within 2 business days.' }, { q: 'Can I return an item?', a: 'Yes, within 30 days of delivery.' }] },
    fields: [EYEBROW, txt('heading', 'Heading'), area('text', 'Text'), { key: 'items', label: 'Questions', type: 'list', itemLabel: 'Question', item: [txt('q', 'Question'), area('a', 'Answer')] }],
    render: (s, ctx, sec) => wrap(sec, 'faq', `<div class="faq-grid">${head(s, ctx)}<div class="faq-list">${(s.items || []).map(it => `<details><summary><span>${ctx.e(it.q)}</span><i aria-hidden="true">${ctx.icon('plus')}</i></summary><div class="prose">${ctx.t(it.a)}</div></details>`).join('')}</div></div>`),
  },

  newsletter: {
    label: 'Newsletter', group: 'Content', pages: CONTENT,
    defaults: { eyebrow: '', heading: 'Join the list', text: 'New arrivals and offers, once a month. No spam.', buttonLabel: 'Subscribe', action: '', image: null },
    fields: [EYEBROW, txt('heading', 'Heading'), area('text', 'Text'), txt('buttonLabel', 'Button label'), imgF('image', 'Background photo'), txt('action', 'Form action URL (blank = email to the store)')],
    render: (s, ctx, sec) => {
      const action = s.action && /^https?:\/\//.test(s.action) ? `action="${ctx.e(s.action)}" method="post"` : `data-mailto-form="${ctx.e(ctx.store.contact.email || ctx.store.checkout.email)}" data-subject="Newsletter sign-up"`;
      return wrap(sec, `newsletter${s.image ? ' nl-photo' : ''}`, `<div class="nl-card">${s.image ? `<div class="nl-media">${ctx.pic(s.image, { size: 'hero' })}</div>` : ''}<div class="nl-body">${head(s, ctx, 'center')}
        <form class="nl-form" ${action}><label class="sr" for="nl-${sec.id}">Email address</label><input id="nl-${sec.id}" type="email" name="email" required placeholder="you@example.com" autocomplete="email"><button class="btn" type="submit">${ctx.e(s.buttonLabel || 'Subscribe')}</button></form></div></div>`);
    },
  },

  'rich-text': {
    label: 'Statement text', group: 'Content', pages: CONTENT,
    defaults: { eyebrow: '', heading: 'Our promise', text: 'We design products to last, source responsibly and stand behind everything we sell.', align: 'center', size: 'large' },
    fields: [EYEBROW, txt('heading', 'Heading'), area('text', 'Text'), { key: 'align', label: 'Alignment', type: 'select', options: [['left', 'Left'], ['center', 'Center']] }, { key: 'size', label: 'Text size', type: 'select', options: [['regular', 'Regular'], ['large', 'Large statement']] }],
    render: (s, ctx, sec) => wrap(sec, `richtext al-${s.align} rt-${s.size}`, `${s.eyebrow ? `<p class="eyebrow">${ctx.e(s.eyebrow)}</p>` : ''}${s.heading ? `<h2 class="sec-title">${ctx.e(s.heading)}</h2>` : ''}<div class="prose">${ctx.t(s.text)}</div>`),
  },

  banner: {
    label: 'Banner / CTA', group: 'Intro', pages: CONTENT,
    defaults: { eyebrow: '', heading: 'Free shipping this week', text: 'On every order, no minimum.', buttonLabel: 'Shop now', buttonLink: 'collection:all', image: null, style: 'solid' },
    fields: [EYEBROW, txt('heading', 'Heading'), area('text', 'Text'), txt('buttonLabel', 'Button label'), linkF('buttonLink', 'Button link'),
      { key: 'style', label: 'Style', type: 'select', options: [['solid', 'Accent colour'], ['image', 'Background photo'], ['outline', 'Outline']] }, { ...imgF(), show: s => s.style === 'image' }],
    render: (s, ctx, sec) => wrap(sec, `banner b-${s.style}`, `<div class="banner-in">${s.style === 'image' && s.image ? `<div class="banner-media">${ctx.pic(s.image, { size: 'hero' })}</div>` : ''}<div class="banner-copy">${s.eyebrow ? `<p class="eyebrow">${ctx.e(s.eyebrow)}</p>` : ''}<h2 class="sec-title">${ctx.e(s.heading)}</h2>${s.text ? `<div class="sec-sub">${ctx.t(s.text)}</div>` : ''}${s.buttonLabel ? ctx.btn(s.buttonLabel, s.buttonLink, 'btn-lg btn-inv') : ''}</div></div>`),
  },

  countdown: {
    label: 'Countdown / sale', group: 'Intro', pages: CONTENT,
    defaults: { eyebrow: 'Limited time', heading: 'The sale ends soon', text: 'Up to 30% off selected styles.', endsAt: '', buttonLabel: 'Shop the sale', buttonLink: 'collection:all', image: null },
    fields: [EYEBROW, txt('heading', 'Heading'), area('text', 'Text'), { key: 'endsAt', label: 'Ends at', type: 'datetime' }, txt('buttonLabel', 'Button label'), linkF('buttonLink', 'Button link'), imgF('image', 'Side photo')],
    render: (s, ctx, sec) => {
      const end = s.endsAt || new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 16);
      const unit = (k, l) => `<div><span data-cd="${k}">00</span><small>${l}</small></div>`;
      return wrap(sec, `countdown${s.image ? ' cd-photo' : ''}`, `<div class="cd-card"><div class="cd-copy">${head(s, ctx)}<div class="cd" data-countdown="${ctx.e(end)}" role="timer" aria-label="Time remaining">${unit('d', 'Days')}${unit('h', 'Hours')}${unit('m', 'Min')}${unit('s', 'Sec')}</div>${s.buttonLabel ? `<div class="btns">${ctx.btn(s.buttonLabel, s.buttonLink, 'btn-lg')}</div>` : ''}</div>${s.image ? `<div class="cd-media">${ctx.pic(s.image, { size: 'wide' })}</div>` : ''}</div>`);
    },
  },

  curriculum: {
    label: 'Course curriculum', group: 'Courses & services', pages: CONTENT,
    defaults: { eyebrow: 'Curriculum', heading: 'What you will learn', text: '', modules: [{ title: 'Module 1 — Foundations', duration: '45 min', lessons: 'Welcome\nCore concepts\nYour first project' }, { title: 'Module 2 — Going deeper', duration: '1 h 20 min', lessons: 'Techniques\nCommon mistakes\nPractice' }] },
    fields: [EYEBROW, txt('heading', 'Heading'), area('text', 'Text'), { key: 'modules', label: 'Modules', type: 'list', itemLabel: 'Module', item: [txt('title', 'Title'), txt('duration', 'Duration'), area('lessons', 'Lessons (one per line)')] }],
    render: (s, ctx, sec) => wrap(sec, 'curriculum', `<div class="faq-grid">${head(s, ctx)}<ol class="modules">${(s.modules || []).map((m, i) => {
      const ls = String(m.lessons || '').split('\n').map(x => x.trim()).filter(Boolean);
      return `<li><details${i === 0 ? ' open' : ''}><summary><span class="m-no">${String(i + 1).padStart(2, '0')}</span><span class="m-title">${ctx.e(m.title)}<small>${ls.length} lessons${m.duration ? ' · ' + ctx.e(m.duration) : ''}</small></span><i aria-hidden="true">${ctx.icon('plus')}</i></summary><ul>${ls.map(l => `<li>${ctx.icon('play')}<span>${ctx.e(l)}</span></li>`).join('')}</ul></details></li>`;
    }).join('')}</ol></div>`),
  },

  pricing: {
    label: 'Pricing plans', group: 'Courses & services', pages: CONTENT,
    defaults: { eyebrow: 'Pricing', heading: 'Plans', text: '', plans: [{ name: 'Starter', price: '49', period: '/ month', features: 'Feature one\nFeature two', buttonLabel: 'Get started', buttonLink: 'page:contact', highlight: false }, { name: 'Pro', price: '99', period: '/ month', features: 'Everything in Starter\nPriority support', buttonLabel: 'Get started', buttonLink: 'page:contact', highlight: true }] },
    fields: [EYEBROW, txt('heading', 'Heading'), area('text', 'Text'), { key: 'plans', label: 'Plans', type: 'list', itemLabel: 'Plan', item: [txt('name', 'Name'), txt('price', 'Price'), txt('period', 'Period'), area('features', 'Features (one per line)'), txt('buttonLabel', 'Button label'), linkF('buttonLink', 'Button link'), { key: 'highlight', label: 'Highlight', type: 'toggle' }] }],
    render: (s, ctx, sec) => wrap(sec, 'pricing', `${head(s, ctx, 'center')}<div class="grid cols-${Math.min(4, Math.max(1, (s.plans || []).length))}">${(s.plans || []).map(p => `<div class="plan${p.highlight ? ' hl' : ''}">${p.highlight ? '<span class="badge">Most popular</span>' : ''}<h3>${ctx.e(p.name)}</h3><p class="plan-price">${/^\d+(\.\d+)?$/.test(String(p.price).trim()) ? ctx.money(+p.price) : ctx.e(p.price)}<small>${ctx.e(p.period || '')}</small></p><ul>${String(p.features || '').split('\n').filter(x => x.trim()).map(f => `<li>${ctx.icon('check')}<span>${ctx.e(f)}</span></li>`).join('')}</ul>${p.buttonLabel ? ctx.btn(p.buttonLabel, p.buttonLink, p.highlight ? 'btn-wide' : 'btn-wide btn-ghost') : ''}</div>`).join('')}</div>`),
  },

  gallery: {
    label: 'Gallery', group: 'Media', pages: CONTENT,
    defaults: { heading: 'Gallery', columns: 3, images: [] },
    fields: [txt('heading', 'Heading'), COLS([2, 3, 4]), { key: 'images', label: 'Images', type: 'list', itemLabel: 'Image', item: [imgF(), txt('caption', 'Caption')] }],
    render: (s, ctx, sec) => wrap(sec, 'gallery', `${s.heading ? `<div class="sec-head"><h2 class="sec-title">${ctx.e(s.heading)}</h2></div>` : ''}<div class="grid cols-${s.columns}">${(s.images || []).filter(i => i.image).map((i, n) => `<figure class="g${n % 5}">${ctx.pic(i.image, { size: 'card', alt: i.caption || '' })}${i.caption ? `<figcaption>${ctx.e(i.caption)}</figcaption>` : ''}</figure>`).join('')}</div>`),
  },

  'insta-grid': {
    label: 'Instagram-style grid', group: 'Media', pages: CONTENT,
    defaults: { heading: 'Follow along', handle: '@yourstore', images: [] },
    fields: [txt('heading', 'Heading'), txt('handle', 'Handle'), { key: 'images', label: 'Images', type: 'list', itemLabel: 'Image', item: [imgF()] }],
    render: (s, ctx, sec) => {
      const url = ctx.store.social.instagram;
      const imgs = (s.images || []).filter(i => i.image).map(i => i.image);
      const list = (imgs.length ? imgs : ctx.products('all', '', 12).map(p => p.images[0]).filter(Boolean)).filter((r, i, a) => a.indexOf(r) === i);
      const cell = r => `<div class="insta-cell">${ctx.pic(r, { size: 'square', alt: '' })}<span aria-hidden="true">${ctx.icon('camera')}</span></div>`;
      return wrap(sec, 'insta', `<div class="sec-head center">${s.heading ? `<h2 class="sec-title">${ctx.e(s.heading)}</h2>` : ''}${s.handle ? (url ? `<a class="handle" href="${ctx.e(url)}" target="_blank" rel="noopener">${ctx.e(s.handle)}</a>` : `<p class="handle">${ctx.e(s.handle)}</p>`) : ''}</div><div class="insta-grid">${list.slice(0, 6).map(cell).join('')}</div>`);
    },
  },

  locations: {
    label: 'Locations & hours', group: 'Content', pages: CONTENT,
    defaults: { heading: 'Visit us', items: [{ name: 'Main store', address: '12 Market Street', hours: 'Mon–Sat 9:00–18:00', phone: '' }], image: null },
    fields: [txt('heading', 'Heading'), imgF('image', 'Photo'), { key: 'items', label: 'Locations', type: 'list', itemLabel: 'Location', item: [txt('name', 'Name'), area('address', 'Address'), area('hours', 'Hours'), txt('phone', 'Phone')] }],
    render: (s, ctx, sec) => wrap(sec, `locations${s.image ? ' loc-photo' : ''}`, `<div class="loc-wrap">${s.image ? `<div class="loc-media">${ctx.pic(s.image, { size: 'wide' })}</div>` : ''}<div class="loc-body">${s.heading ? `<h2 class="sec-title">${ctx.e(s.heading)}</h2>` : ''}${(s.items || []).map(l => `<div class="loc"><h3>${ctx.e(l.name)}</h3><p>${ctx.icon('pin')}<span>${ctx.e(l.address).replace(/\n/g, '<br>')}</span></p>${l.hours ? `<p>${ctx.icon('clock')}<span>${ctx.e(l.hours).replace(/\n/g, '<br>')}</span></p>` : ''}${l.phone ? `<p>${ctx.icon('phone')}<a href="tel:${ctx.e(l.phone.replace(/[^\d+]/g, ''))}">${ctx.e(l.phone)}</a></p>` : ''}</div>`).join('')}</div></div>`),
  },

  'page-title': {
    label: 'Page title', group: 'Intro', pages: CONTENT,
    defaults: { eyebrow: '', heading: 'Page title', text: '', image: null },
    fields: [EYEBROW, txt('heading', 'Heading'), area('text', 'Text'), imgF('image', 'Banner photo')],
    render: (s, ctx, sec) => wrap(sec, `ptitle${s.image ? ' pt-photo' : ''}`, `${s.image ? `<div class="pt-media">${ctx.pic(s.image, { size: 'hero', eager: true })}</div>` : ''}<div class="pt-copy">${s.eyebrow ? `<p class="eyebrow">${ctx.e(s.eyebrow)}</p>` : ''}<h1 class="sec-title">${ctx.e(s.heading)}</h1>${s.text ? `<div class="sec-sub">${ctx.t(s.text)}</div>` : ''}</div>`),
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
        <label>Message<textarea name="message" rows="5" required></textarea></label><button class="btn btn-lg" type="submit">${ctx.e(s.buttonLabel || 'Send')}</button>
        ${to ? '' : '<p class="note">Add a contact email in the store settings to receive messages.</p>'}</form></div>`);
    },
  },

  'collection-main': {
    label: 'Product grid with filters', group: 'Products', pages: ['collection'],
    defaults: { showFilters: true, showSort: true, columns: 4, showQuickAdd: true },
    fields: [{ key: 'showFilters', label: 'Category & price filters', type: 'toggle' }, { key: 'showSort', label: 'Sorting', type: 'toggle' }, COLS([2, 3, 4]), { key: 'showQuickAdd', label: 'Quick add buttons', type: 'toggle' }],
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
    label: 'Product details', group: 'Products', pages: ['product'],
    defaults: { showSku: true, showStock: true, tab2Title: 'Shipping & returns', tab2Text: 'Ships within 2 business days. Free returns within 30 days.', tab3Title: '', tab3Text: '', buttonLabel: 'Add to cart', perks: 'Free shipping over 50|30-day returns|Secure checkout' },
    fields: [txt('buttonLabel', 'Button label'), { key: 'showSku', label: 'Show SKU', type: 'toggle' }, { key: 'showStock', label: 'Show stock', type: 'toggle' }, txt('perks', 'Perks under the button (separated by |)'),
      txt('tab2Title', 'Second tab title'), area('tab2Text', 'Second tab text'), txt('tab3Title', 'Third tab title'), area('tab3Text', 'Third tab text')],
    render: (s, ctx, sec) => {
      const p = ctx.product;
      if (!p) return wrap(sec, 'pmain', '<p class="empty">Add a product to see this page.</p>');
      const v0 = p.variants.find(v => v.stock == null || v.stock > 0) || p.variants[0];
      const ok = v0 && (v0.stock == null || v0.stock > 0);
      const price = v0 && v0.price != null ? v0.price : p.price, cmp = p.compareAt && p.compareAt > price ? p.compareAt : null;
      const imgs = p.images;
      const gallery = `<div class="pgallery" data-gallery>${imgs.length > 1 ? `<div class="thumbs">${imgs.map((r, i) => `<button type="button" class="thumb" data-thumb="${i}" aria-label="Show image ${i + 1}"${i ? '' : ' aria-current="true"'}>${ctx.pic(r, { size: 'thumb', alt: '', fallback: p.art })}</button>`).join('')}</div>` : ''}
        <div class="pmain-img">${imgs.map((r, i) => `<div class="pslide" data-slide="${i}"${i ? ' hidden' : ''}>${ctx.pic(r, { size: 'large', alt: i ? '' : p.title, eager: !i, fallback: p.art })}</div>`).join('') || (p.art ? ctx.pic(p.art, { size: 'large', alt: p.title }) : '')}
        ${cmp ? `<span class="badge sale">−${Math.round((1 - price / cmp) * 100)}%</span>` : p.tags.includes('new') ? '<span class="badge">New</span>' : ''}</div></div>`;
      const opts = p.options.map((o, k) => {
        const sw = ctx.isSwatch(o.name);
        return `<fieldset class="opt"><legend>${ctx.e(o.name)}: <span data-opt-value="${k}">${ctx.e(v0 ? v0.options[k] : '')}</span></legend><div class="pills${sw ? ' swatches' : ''}">${o.values.map(val => `<label class="pill"><input type="radio" name="opt${k}" value="${ctx.e(val)}"${v0 && v0.options[k] === val ? ' checked' : ''}><span>${sw ? `<i style="background:${ctx.colorOf(val)}"></i>` : ''}${ctx.e(val)}</span></label>`).join('')}</div></fieldset>`;
      }).join('');
      const tabs = [['Description', p.description], [s.tab2Title, s.tab2Text], [s.tab3Title, s.tab3Text]].filter(([t, x]) => t && x);
      const acc = tabs.map(([t, x], i) => `<details${i ? '' : ' open'}><summary><span>${ctx.e(t)}</span><i aria-hidden="true">${ctx.icon('plus')}</i></summary><div class="prose">${ctx.t(x)}</div></details>`).join('');
      const perks = String(s.perks || '').split('|').map(x => x.trim()).filter(Boolean);
      const buy = ctx.checkoutEnabled ? `<div class="buy"><div class="qty"><button type="button" data-qty-step="-1" aria-label="Decrease quantity">−</button><input type="number" name="qty" value="1" min="1" max="999" aria-label="Quantity" inputmode="numeric"><button type="button" data-qty-step="1" aria-label="Increase quantity">+</button></div>
        <button class="btn btn-lg" type="submit" data-add-to-cart${ok ? '' : ' disabled'}>${ctx.e(ok ? s.buttonLabel || 'Add to cart' : 'Sold out')}</button>
        <button type="button" class="round light wish-lg" data-wish="${p.id}" aria-pressed="false" aria-label="Save ${ctx.e(p.title)} to wishlist">${ctx.icon('heart')}</button></div>` : `<p class="note">${ctx.store.contact.email ? `To order, <a href="${ctx.link('page:contact')}">contact us</a>.` : 'Online ordering is not available.'}</p>`;
      return wrap(sec, 'pmain', `<nav class="crumbs" aria-label="Breadcrumb"><a href="${ctx.link('home')}">Home</a><span aria-hidden="true">/</span><a href="${ctx.link('collection:all')}">Shop</a><span aria-hidden="true">/</span><span aria-current="page">${ctx.e(p.title)}</span></nav>
        <div class="product">${gallery}<div class="pinfo">${p.category ? `<p class="eyebrow">${ctx.e(p.category)}</p>` : ''}<h1 class="ptitle-h">${ctx.e(p.title)}</h1>${p.rating ? ctx.stars(p.rating, p.reviews) : ''}
        <p class="pprice"><span data-price>${ctx.money(price)}</span> <s class="compare" data-compare${cmp ? '' : ' hidden'}>${cmp ? ctx.money(cmp) : ''}</s></p>
        <form class="pform" data-product-form="${p.id}" data-button-label="${ctx.e(s.buttonLabel || 'Add to cart')}">${opts}
        <p class="pmeta">${s.showSku ? `<span>SKU <span data-sku>${ctx.e(v0?.sku || '')}</span></span>` : ''}${s.showStock ? `<span class="stock" data-stock>${v0 && v0.stock != null ? (v0.stock > 0 ? v0.stock + ' in stock' : 'Out of stock') : 'In stock'}</span>` : ''}</p>${buy}</form>
        ${perks.length ? `<ul class="perks">${perks.map((x, i) => `<li>${ctx.icon(['truck', 'refresh', 'shield', 'gift'][i % 4])}<span>${ctx.e(x)}</span></li>`).join('')}</ul>` : ''}
        <div class="acc">${acc}</div></div></div>`);
    },
  },

  'related-products': {
    label: 'Related products', group: 'Products', pages: ['product'],
    defaults: { heading: 'You may also like', limit: 4 },
    fields: [txt('heading', 'Heading'), { key: 'limit', label: 'Products shown', type: 'number', min: 1, max: 12 }],
    render: (s, ctx, sec) => {
      const p = ctx.product, all = ctx.products('all', '', 999).filter(x => !p || x.id !== p.id);
      const same = p ? all.filter(x => x.category === p.category) : [];
      const ps = [...same, ...all.filter(x => !same.includes(x))].slice(0, s.limit);
      return ps.length ? wrap(sec, 'related', `${s.heading ? `<div class="sec-head"><h2 class="sec-title">${ctx.e(s.heading)}</h2></div>` : ''}<div class="grid pgrid cols-4">${ps.map((x, i) => ctx.card(x, true, i)).join('')}</div>`) : '';
    },
  },

  'cart-main': {
    label: 'Cart', group: 'Products', pages: ['cart'],
    defaults: { heading: 'Your cart', emptyText: 'Your cart is empty.' },
    fields: [txt('heading', 'Heading'), txt('emptyText', 'Empty cart text')],
    render: (s, ctx, sec) => wrap(sec, 'cartpage', `<h1 class="sec-title">${ctx.e(s.heading)}</h1>${ctx.checkoutEnabled ? `<div data-cart-page data-empty-text="${ctx.e(s.emptyText)}"><p class="empty">${ctx.e(s.emptyText)}</p></div>
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
        <label>Delivery address<textarea name="address" rows="3" autocomplete="street-address"></textarea></label><label>Notes<textarea name="notes" rows="2"></textarea></label>
        <button class="btn btn-lg btn-wide" type="submit">${ctx.icon(mode === 'whatsapp' ? 'chat' : 'mail')}${mode === 'whatsapp' ? 'Send order on WhatsApp' : 'Send order by email'}</button></form>` : mode === 'paymentLinks' ? '<div data-pay-links></div>' : '';
      const missing = (mode === 'whatsapp' && !ck.phone) || (mode === 'email' && !ck.email);
      return wrap(sec, 'checkout', `<h1 class="sec-title">${ctx.e(s.heading)}</h1><div class="co-grid" data-checkout data-mode="${mode}">
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
