// Section library of the store builder. Each entry:
//   { label, group, pages: page keys it can be added to ('*' = every content page),
//     defaults: settings, fields: inspector schema, render(settings, ctx, section) → HTML string }
// The SAME render functions produce the in-app live preview and the exported static site.
//
// Field schema: { key, label, type, options?, min?, max?, step?, item? (sub-fields for type 'list'), itemLabel?, show?(settings) }
//   types: text | textarea | number | color | select | toggle | image | link | collection | list | datetime
//
// ctx (built by render.js): { store, page, path, e(text), t(multiline text → <p>), img(ref), link(target), money(n),
//   products(source, collectionId, limit), card(product), icon(name), btn(label, target, cls), collectionHref(col),
//   productHref(p), allCollections(), product, collection, checkoutEnabled }

const CONTENT = ['home', 'about', 'contact', 'collection', 'product', 'cart', 'checkout'];
const linkF = (key, label) => ({ key, label, type: 'link' });
const imgF = (key = 'image', label = 'Image') => ({ key, label, type: 'image' });
const head = (s, ctx, cls = '') => (s.heading ? `<h2 class="sec-title ${cls}">${ctx.e(s.heading)}</h2>` : '') + (s.text ? `<div class="sec-sub">${ctx.t(s.text)}</div>` : '');
const wrap = (sec, cls, inner, style = '') => `<section class="sec ${cls}" id="${sec.id}"${style ? ` style="${style}"` : ''} data-sid="${sec.id}" data-type="${sec.type}"><div class="wrap">${inner}</div></section>`;
const SOURCE = { key: 'source', label: 'Products', type: 'select', options: [['featured', 'Featured products'], ['all', 'All products'], ['collection', 'From a collection'], ['newest', 'Newest'], ['sale', 'On sale']] };
const COLLECTION = { key: 'collection', label: 'Collection', type: 'collection', show: s => s.source === 'collection' };
export const FEATURE_ICONS = ['truck', 'shield', 'refresh', 'star', 'heart', 'leaf', 'clock', 'chat', 'gift', 'bolt', 'check', 'lock', 'globe', 'award', 'users', 'play'];

export const SECTIONS = {
  announcement: {
    label: 'Announcement bar', group: 'Layout', pages: [], global: true, defaults: {}, fields: [],
    render: (s, ctx) => {
      const a = ctx.store.announcement;
      if (!a.enabled || !a.text) return '';
      const inner = ctx.e(a.text);
      return `<div class="ann" data-sid="announcement" data-type="announcement">${a.link ? `<a href="${ctx.link(a.link)}">${inner}</a>` : inner}</div>`;
    },
  },

  header: {
    label: 'Header', group: 'Layout', pages: [], global: true,
    defaults: { sticky: true, showSearch: false },
    fields: [{ key: 'sticky', label: 'Sticky header', type: 'toggle' }],
    render: (s, ctx, sec) => {
      const st = ctx.store, style = st.theme.headerStyle;
      const logo = st.logo.image ? `<img src="${ctx.img(st.logo.image)}" alt="${ctx.e(st.logo.text || st.name)}" style="height:${st.logo.height}px">` : `<span>${ctx.e(st.logo.text || st.name)}</span>`;
      const nav = st.navigation.main.map(n => `<a href="${ctx.link(n.target)}"${ctx.isCurrent(n.target) ? ' aria-current="page"' : ''}>${ctx.e(n.label)}</a>`).join('');
      const cart = ctx.checkoutEnabled ? `<a class="cart-btn" href="${ctx.link('cart')}" data-cart-open aria-label="Open cart">${ctx.icon('bag')}<span class="cart-count" data-cart-count hidden>0</span></a>` : '';
      return `<header class="site-header hdr-${style}${s.sticky ? ' sticky' : ''}" data-sid="${sec.id}" data-type="header"><div class="wrap hdr-in">
        <button class="menu-toggle" type="button" aria-label="Menu" aria-expanded="false" aria-controls="site-nav" data-menu-toggle>${ctx.icon('menu')}</button>
        <a class="logo" href="${ctx.link('home')}">${logo}</a>
        <nav class="nav" id="site-nav" aria-label="Main">${nav}</nav>
        <div class="hdr-actions">${cart}</div></div></header>`;
    },
  },

  footer: {
    label: 'Footer', group: 'Layout', pages: [], global: true,
    defaults: { text: 'Thoughtfully made goods, shipped with care.', showSocial: true, showContact: true, copyright: '' },
    fields: [{ key: 'text', label: 'About text', type: 'textarea' }, { key: 'showContact', label: 'Show contact details', type: 'toggle' }, { key: 'showSocial', label: 'Show social links', type: 'toggle' }, { key: 'copyright', label: 'Copyright line', type: 'text' }],
    render: (s, ctx, sec) => {
      const st = ctx.store, c = st.contact;
      const menu = st.navigation.footer.length ? `<div><h3>Explore</h3><ul>${st.navigation.footer.map(n => `<li><a href="${ctx.link(n.target)}">${ctx.e(n.label)}</a></li>`).join('')}</ul></div>` : '';
      const contact = s.showContact && (c.email || c.phone || c.address) ? `<div><h3>Contact</h3><ul>${c.email ? `<li><a href="mailto:${ctx.e(c.email)}">${ctx.e(c.email)}</a></li>` : ''}${c.phone ? `<li><a href="tel:${ctx.e(c.phone.replace(/[^\d+]/g, ''))}">${ctx.e(c.phone)}</a></li>` : ''}${c.address ? `<li>${ctx.e(c.address)}</li>` : ''}</ul></div>` : '';
      const soc = Object.entries(st.social).filter(([, u]) => u);
      const social = s.showSocial && soc.length ? `<div><h3>Follow</h3><ul class="social">${soc.map(([k, u]) => `<li><a href="${ctx.e(u)}" rel="noopener" target="_blank">${{ x: 'X', tiktok: 'TikTok', youtube: 'YouTube' }[k] || k[0].toUpperCase() + k.slice(1)}</a></li>`).join('')}</ul></div>` : '';
      return `<footer class="site-footer" data-sid="${sec.id}" data-type="footer"><div class="wrap"><div class="ft-grid">
        <div class="ft-brand"><a class="logo" href="${ctx.link('home')}">${ctx.e(st.logo.text || st.name)}</a>${s.text ? `<p>${ctx.e(s.text)}</p>` : ''}</div>${menu}${contact}${social}</div>
        <p class="ft-copy">${ctx.e(s.copyright || `© ${new Date().getFullYear()} ${st.name}`)}</p></div></footer>`;
    },
  },

  hero: {
    label: 'Hero', group: 'Intro', pages: CONTENT,
    defaults: { layout: 'image', eyebrow: '', heading: 'Made for everyday', text: 'Discover our latest collection.', buttonLabel: 'Shop now', buttonLink: 'collection:all', button2Label: '', button2Link: 'page:about', image: null, slides: [], align: 'left', height: 'large', overlay: 35 },
    fields: [
      { key: 'layout', label: 'Layout', type: 'select', options: [['image', 'Full image'], ['split', 'Split image'], ['gradient', 'Moving gradient'], ['carousel', 'Carousel'], ['text', 'Text only']] },
      { key: 'eyebrow', label: 'Eyebrow', type: 'text' }, { key: 'heading', label: 'Headline', type: 'text' }, { key: 'text', label: 'Text', type: 'textarea' },
      { key: 'buttonLabel', label: 'Button label', type: 'text' }, linkF('buttonLink', 'Button link'), { key: 'button2Label', label: 'Second button label', type: 'text' }, linkF('button2Link', 'Second button link'),
      { ...imgF(), show: s => s.layout === 'image' || s.layout === 'split' },
      { key: 'slides', label: 'Slides', type: 'list', itemLabel: 'Slide', show: s => s.layout === 'carousel', item: [imgF(), { key: 'heading', label: 'Headline', type: 'text' }, { key: 'text', label: 'Text', type: 'text' }, { key: 'buttonLabel', label: 'Button label', type: 'text' }, linkF('buttonLink', 'Button link')] },
      { key: 'align', label: 'Alignment', type: 'select', options: [['left', 'Left'], ['center', 'Center']] },
      { key: 'height', label: 'Height', type: 'select', options: [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']] },
      { key: 'overlay', label: 'Image overlay', type: 'number', min: 0, max: 85, show: s => s.layout === 'image' || s.layout === 'carousel' },
    ],
    render: (s, ctx, sec) => {
      const btns = (a, al, b, bl) => (a || b) ? `<div class="btns">${a ? ctx.btn(a, al) : ''}${b ? ctx.btn(b, bl, 'btn-alt') : ''}</div>` : '';
      const copy = `${s.eyebrow ? `<p class="eyebrow">${ctx.e(s.eyebrow)}</p>` : ''}<h1 class="hero-title">${ctx.e(s.heading)}</h1>${s.text ? `<div class="hero-text">${ctx.t(s.text)}</div>` : ''}${btns(s.buttonLabel, s.buttonLink, s.button2Label, s.button2Link)}`;
      const cls = `hero hl-${s.layout} h-${s.height} al-${s.align}`;
      const ov = `--ov:${(s.overlay || 0) / 100}`;
      if (s.layout === 'split') return `<section class="sec ${cls}" data-sid="${sec.id}" data-type="hero"><div class="wrap hero-split"><div class="hero-copy">${copy}</div><div class="hero-media">${s.image ? `<img src="${ctx.img(s.image)}" alt="">` : ''}</div></div></section>`;
      if (s.layout === 'carousel') {
        const slides = (s.slides && s.slides.length ? s.slides : [{ image: s.image, heading: s.heading, text: s.text, buttonLabel: s.buttonLabel, buttonLink: s.buttonLink }]);
        return `<section class="${cls}" data-sid="${sec.id}" data-type="hero" aria-roledescription="carousel" aria-label="${ctx.e(s.heading || 'Highlights')}"><div class="hero-track" data-carousel-track tabindex="0">${slides.map((sl, i) => `<div class="hero-slide" role="group" aria-roledescription="slide" aria-label="${i + 1} of ${slides.length}" style="${ov}">${sl.image ? `<img src="${ctx.img(sl.image)}" alt="" ${i ? 'loading="lazy"' : ''}>` : ''}<div class="wrap hero-copy">${i === 0 && s.eyebrow ? `<p class="eyebrow">${ctx.e(s.eyebrow)}</p>` : ''}<${i ? 'h2' : 'h1'} class="hero-title">${ctx.e(sl.heading || '')}</${i ? 'h2' : 'h1'}>${sl.text ? `<div class="hero-text"><p>${ctx.e(sl.text)}</p></div>` : ''}${btns(sl.buttonLabel, sl.buttonLink || 'collection:all')}</div></div>`).join('')}</div>
          ${slides.length > 1 ? `<button class="car-btn prev" type="button" data-carousel-prev aria-label="Previous slide">${ctx.icon('left')}</button><button class="car-btn next" type="button" data-carousel-next aria-label="Next slide">${ctx.icon('right')}</button>` : ''}</section>`;
      }
      if (s.layout === 'image') return `<section class="${cls}" data-sid="${sec.id}" data-type="hero" style="${ov}">${s.image ? `<img class="hero-bg" src="${ctx.img(s.image)}" alt="">` : ''}<div class="wrap hero-copy">${copy}</div></section>`;
      return `<section class="${cls}" data-sid="${sec.id}" data-type="hero"><div class="wrap hero-copy">${copy}</div></section>`;
    },
  },

  'featured-products': {
    label: 'Featured products', group: 'Products', pages: CONTENT,
    defaults: { heading: 'Best sellers', text: '', source: 'featured', collection: '', limit: 8, columns: 4, showQuickAdd: true, buttonLabel: 'View all', buttonLink: 'collection:all' },
    fields: [{ key: 'heading', label: 'Heading', type: 'text' }, { key: 'text', label: 'Text', type: 'textarea' }, SOURCE, COLLECTION, { key: 'limit', label: 'Products shown', type: 'number', min: 1, max: 24 },
      { key: 'columns', label: 'Columns', type: 'select', options: [[2, '2'], [3, '3'], [4, '4'], [5, '5']] }, { key: 'showQuickAdd', label: 'Quick add buttons', type: 'toggle' },
      { key: 'buttonLabel', label: 'Button label', type: 'text' }, linkF('buttonLink', 'Button link')],
    render: (s, ctx, sec) => {
      const ps = ctx.products(s.source, s.collection, s.limit);
      return wrap(sec, 'featured', `<div class="sec-head">${head(s, ctx)}</div>${ps.length ? `<div class="grid pgrid cols-${s.columns}">${ps.map(p => ctx.card(p, s.showQuickAdd)).join('')}</div>` : '<p class="empty">No products to show yet.</p>'}${s.buttonLabel ? `<div class="center-btn">${ctx.btn(s.buttonLabel, s.buttonLink, 'btn-alt')}</div>` : ''}`);
    },
  },

  'product-carousel': {
    label: 'Product carousel', group: 'Products', pages: CONTENT,
    defaults: { heading: 'New arrivals', source: 'newest', collection: '', limit: 10 },
    fields: [{ key: 'heading', label: 'Heading', type: 'text' }, SOURCE, COLLECTION, { key: 'limit', label: 'Products shown', type: 'number', min: 2, max: 24 }],
    render: (s, ctx, sec) => {
      const ps = ctx.products(s.source, s.collection, s.limit);
      return wrap(sec, 'pcarousel', `<div class="sec-head row">${s.heading ? `<h2 class="sec-title">${ctx.e(s.heading)}</h2>` : ''}<div class="car-nav"><button class="icon-btn" type="button" data-carousel-prev aria-label="Scroll back">${ctx.icon('left')}</button><button class="icon-btn" type="button" data-carousel-next aria-label="Scroll forward">${ctx.icon('right')}</button></div></div>
        <div class="ptrack" data-carousel-track tabindex="0" aria-label="${ctx.e(s.heading || 'Products')}">${ps.map(p => ctx.card(p, true)).join('')}</div>`);
    },
  },

  'collection-list': {
    label: 'Collection list', group: 'Products', pages: CONTENT,
    defaults: { heading: 'Shop by category', collections: [], columns: 3 },
    fields: [{ key: 'heading', label: 'Heading', type: 'text' }, { key: 'columns', label: 'Columns', type: 'select', options: [[2, '2'], [3, '3'], [4, '4']] }],
    render: (s, ctx, sec) => {
      const cols = ctx.allCollections();
      return wrap(sec, 'clist', `${head(s, ctx)}<div class="grid cols-${s.columns}">${cols.map(c => {
        const im = c.image || ctx.collectionImage(c);
        return `<a class="ccard" href="${ctx.collectionHref(c)}">${im ? `<img src="${ctx.img(im)}" alt="" loading="lazy">` : ''}<span class="ccard-title">${ctx.e(c.title)}</span></a>`;
      }).join('')}</div>`);
    },
  },

  'image-text': {
    label: 'Image with text', group: 'Content', pages: CONTENT,
    defaults: { image: null, heading: 'Our story', text: 'Tell customers what makes your products special.', buttonLabel: '', buttonLink: 'page:about', imageSide: 'left' },
    fields: [imgF(), { key: 'heading', label: 'Heading', type: 'text' }, { key: 'text', label: 'Text', type: 'textarea' }, { key: 'buttonLabel', label: 'Button label', type: 'text' }, linkF('buttonLink', 'Button link'), { key: 'imageSide', label: 'Image side', type: 'select', options: [['left', 'Left'], ['right', 'Right']] }],
    render: (s, ctx, sec) => wrap(sec, 'imgtext', `<div class="split ${s.imageSide === 'right' ? 'rev' : ''}"><div class="split-media">${s.image ? `<img src="${ctx.img(s.image)}" alt="" loading="lazy">` : ''}</div><div class="split-copy"><h2 class="sec-title">${ctx.e(s.heading)}</h2><div class="prose">${ctx.t(s.text)}</div>${s.buttonLabel ? ctx.btn(s.buttonLabel, s.buttonLink) : ''}</div></div>`),
  },

  features: {
    label: 'Features / benefits', group: 'Content', pages: CONTENT,
    defaults: { heading: '', columns: 3, items: [{ icon: 'truck', title: 'Free shipping', text: 'On orders over 50.' }, { icon: 'refresh', title: '30-day returns', text: 'Change your mind? No problem.' }, { icon: 'shield', title: 'Secure checkout', text: 'Your details stay private.' }] },
    fields: [{ key: 'heading', label: 'Heading', type: 'text' }, { key: 'columns', label: 'Columns', type: 'select', options: [[2, '2'], [3, '3'], [4, '4']] },
      { key: 'items', label: 'Features', type: 'list', itemLabel: 'Feature', item: [{ key: 'icon', label: 'Icon', type: 'select', options: FEATURE_ICONS.map(i => [i, i[0].toUpperCase() + i.slice(1)]) }, { key: 'title', label: 'Title', type: 'text' }, { key: 'text', label: 'Text', type: 'textarea' }] }],
    render: (s, ctx, sec) => wrap(sec, 'features', `${head(s, ctx)}<div class="grid cols-${s.columns}">${(s.items || []).map(it => `<div class="feature"><span class="f-icon" aria-hidden="true">${ctx.icon(it.icon)}</span><h3>${ctx.e(it.title)}</h3><p>${ctx.e(it.text)}</p></div>`).join('')}</div>`),
  },

  testimonials: {
    label: 'Testimonials', group: 'Social proof', pages: CONTENT,
    defaults: { heading: 'What customers say', items: [{ quote: 'Exactly as described and beautifully packed.', name: 'Sam R.', role: 'Verified buyer' }, { quote: 'Fast delivery and great quality. Ordering again!', name: 'Priya K.', role: 'Verified buyer' }, { quote: 'My new favourite shop.', name: 'Leo M.', role: 'Verified buyer' }] },
    fields: [{ key: 'heading', label: 'Heading', type: 'text' }, { key: 'items', label: 'Testimonials', type: 'list', itemLabel: 'Testimonial', item: [{ key: 'quote', label: 'Quote', type: 'textarea' }, { key: 'name', label: 'Name', type: 'text' }, { key: 'role', label: 'Role', type: 'text' }] }],
    render: (s, ctx, sec) => wrap(sec, 'testimonials', `${head(s, ctx)}<div class="grid cols-3">${(s.items || []).map(it => `<figure class="quote"><div class="stars" aria-label="5 out of 5 stars">★★★★★</div><blockquote>“${ctx.e(it.quote)}”</blockquote><figcaption><strong>${ctx.e(it.name)}</strong>${it.role ? ` · ${ctx.e(it.role)}` : ''}</figcaption></figure>`).join('')}</div>`),
  },

  logos: {
    label: 'Logos strip', group: 'Social proof', pages: CONTENT,
    defaults: { heading: 'As featured in', items: [{ name: 'Northwind' }, { name: 'Lumen Daily' }, { name: 'The Habit' }, { name: 'Field Notes' }, { name: 'Kinfolk & Co' }] },
    fields: [{ key: 'heading', label: 'Heading', type: 'text' }, { key: 'items', label: 'Logos', type: 'list', itemLabel: 'Logo', item: [{ key: 'name', label: 'Name', type: 'text' }, imgF('image', 'Logo image')] }],
    render: (s, ctx, sec) => wrap(sec, 'logos', `${s.heading ? `<p class="logos-title">${ctx.e(s.heading)}</p>` : ''}<ul class="logo-row">${(s.items || []).map((it, i) => `<li>${it.image ? `<img src="${ctx.img(it.image)}" alt="${ctx.e(it.name)}">` : `<span class="wordmark wm${i % 4}">${ctx.e(it.name)}</span>`}</li>`).join('')}</ul>`),
  },

  faq: {
    label: 'FAQ', group: 'Content', pages: CONTENT,
    defaults: { heading: 'Frequently asked questions', items: [{ q: 'How long does shipping take?', a: 'Orders ship within 2 business days.' }, { q: 'Can I return an item?', a: 'Yes, within 30 days of delivery.' }] },
    fields: [{ key: 'heading', label: 'Heading', type: 'text' }, { key: 'items', label: 'Questions', type: 'list', itemLabel: 'Question', item: [{ key: 'q', label: 'Question', type: 'text' }, { key: 'a', label: 'Answer', type: 'textarea' }] }],
    render: (s, ctx, sec) => wrap(sec, 'faq narrow', `${head(s, ctx)}<div class="faq-list">${(s.items || []).map(it => `<details><summary>${ctx.e(it.q)}</summary><div class="prose">${ctx.t(it.a)}</div></details>`).join('')}</div>`),
  },

  newsletter: {
    label: 'Newsletter', group: 'Content', pages: CONTENT,
    defaults: { heading: 'Join the list', text: 'New arrivals and offers, once a month. No spam.', buttonLabel: 'Subscribe', action: '' },
    fields: [{ key: 'heading', label: 'Heading', type: 'text' }, { key: 'text', label: 'Text', type: 'textarea' }, { key: 'buttonLabel', label: 'Button label', type: 'text' },
      { key: 'action', label: 'Form action URL (blank = email to the store)', type: 'text' }],
    render: (s, ctx, sec) => {
      const action = s.action && /^https?:\/\//.test(s.action) ? `action="${ctx.e(s.action)}" method="post"` : `data-mailto-form="${ctx.e(ctx.store.contact.email || ctx.store.checkout.email)}" data-subject="Newsletter sign-up"`;
      return wrap(sec, 'newsletter narrow', `${head(s, ctx)}<form class="nl-form" ${action}><label class="sr" for="nl-${sec.id}">Email address</label><input id="nl-${sec.id}" type="email" name="email" required placeholder="you@example.com" autocomplete="email"><button class="btn" type="submit">${ctx.e(s.buttonLabel || 'Subscribe')}</button></form>`);
    },
  },

  'rich-text': {
    label: 'Rich text', group: 'Content', pages: CONTENT,
    defaults: { heading: 'Our promise', text: 'We design products to last, source responsibly and stand behind everything we sell.', align: 'center' },
    fields: [{ key: 'heading', label: 'Heading', type: 'text' }, { key: 'text', label: 'Text', type: 'textarea' }, { key: 'align', label: 'Alignment', type: 'select', options: [['left', 'Left'], ['center', 'Center']] }],
    render: (s, ctx, sec) => wrap(sec, `richtext narrow al-${s.align}`, `${s.heading ? `<h2 class="sec-title">${ctx.e(s.heading)}</h2>` : ''}<div class="prose">${ctx.t(s.text)}</div>`),
  },

  banner: {
    label: 'Banner / CTA', group: 'Intro', pages: CONTENT,
    defaults: { heading: 'Free shipping this week', text: 'On every order, no minimum.', buttonLabel: 'Shop now', buttonLink: 'collection:all', image: null, style: 'solid' },
    fields: [{ key: 'heading', label: 'Heading', type: 'text' }, { key: 'text', label: 'Text', type: 'textarea' }, { key: 'buttonLabel', label: 'Button label', type: 'text' }, linkF('buttonLink', 'Button link'),
      { key: 'style', label: 'Style', type: 'select', options: [['solid', 'Accent colour'], ['image', 'Background image'], ['outline', 'Outline']] }, { ...imgF(), show: s => s.style === 'image' }],
    render: (s, ctx, sec) => wrap(sec, `banner b-${s.style}`, `<div class="banner-in">${s.style === 'image' && s.image ? `<img class="banner-bg" src="${ctx.img(s.image)}" alt="">` : ''}<div class="banner-copy"><h2 class="sec-title">${ctx.e(s.heading)}</h2>${s.text ? `<div class="sec-sub">${ctx.t(s.text)}</div>` : ''}${s.buttonLabel ? ctx.btn(s.buttonLabel, s.buttonLink, s.style === 'solid' ? 'btn-inv' : '') : ''}</div></div>`),
  },

  countdown: {
    label: 'Countdown / sale', group: 'Intro', pages: CONTENT,
    defaults: { heading: 'The sale ends soon', text: 'Up to 30% off selected styles.', endsAt: '', buttonLabel: 'Shop the sale', buttonLink: 'collection:all' },
    fields: [{ key: 'heading', label: 'Heading', type: 'text' }, { key: 'text', label: 'Text', type: 'textarea' }, { key: 'endsAt', label: 'Ends at', type: 'datetime' }, { key: 'buttonLabel', label: 'Button label', type: 'text' }, linkF('buttonLink', 'Button link')],
    render: (s, ctx, sec) => {
      const end = s.endsAt || new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 16);
      const unit = (k, l) => `<div><span data-cd="${k}">00</span><small>${l}</small></div>`;
      return wrap(sec, 'countdown', `${head(s, ctx)}<div class="cd" data-countdown="${ctx.e(end)}" role="timer" aria-label="Time remaining">${unit('d', 'Days')}${unit('h', 'Hours')}${unit('m', 'Minutes')}${unit('s', 'Seconds')}</div>${s.buttonLabel ? `<div class="center-btn">${ctx.btn(s.buttonLabel, s.buttonLink)}</div>` : ''}`);
    },
  },

  curriculum: {
    label: 'Course curriculum', group: 'Courses & services', pages: CONTENT,
    defaults: { heading: 'What you will learn', text: '', modules: [{ title: 'Module 1 — Foundations', duration: '45 min', lessons: 'Welcome\nCore concepts\nYour first project' }, { title: 'Module 2 — Going deeper', duration: '1 h 20 min', lessons: 'Techniques\nCommon mistakes\nPractice' }] },
    fields: [{ key: 'heading', label: 'Heading', type: 'text' }, { key: 'text', label: 'Text', type: 'textarea' }, { key: 'modules', label: 'Modules', type: 'list', itemLabel: 'Module', item: [{ key: 'title', label: 'Title', type: 'text' }, { key: 'duration', label: 'Duration', type: 'text' }, { key: 'lessons', label: 'Lessons (one per line)', type: 'textarea' }] }],
    render: (s, ctx, sec) => wrap(sec, 'curriculum narrow', `${head(s, ctx)}<ol class="modules">${(s.modules || []).map((m, i) => {
      const ls = String(m.lessons || '').split('\n').map(x => x.trim()).filter(Boolean);
      return `<li><details${i === 0 ? ' open' : ''}><summary><span class="m-no">${String(i + 1).padStart(2, '0')}</span><span class="m-title">${ctx.e(m.title)}</span><span class="m-meta">${ls.length} lessons${m.duration ? ' · ' + ctx.e(m.duration) : ''}</span></summary><ul>${ls.map(l => `<li>${ctx.icon('play')}<span>${ctx.e(l)}</span></li>`).join('')}</ul></details></li>`;
    }).join('')}</ol>`),
  },

  pricing: {
    label: 'Pricing plans', group: 'Courses & services', pages: CONTENT,
    defaults: { heading: 'Plans', text: '', plans: [{ name: 'Starter', price: '49', period: '/ month', features: 'Feature one\nFeature two', buttonLabel: 'Get started', buttonLink: 'page:contact', highlight: false }, { name: 'Pro', price: '99', period: '/ month', features: 'Everything in Starter\nPriority support', buttonLabel: 'Get started', buttonLink: 'page:contact', highlight: true }] },
    fields: [{ key: 'heading', label: 'Heading', type: 'text' }, { key: 'text', label: 'Text', type: 'textarea' }, { key: 'plans', label: 'Plans', type: 'list', itemLabel: 'Plan', item: [{ key: 'name', label: 'Name', type: 'text' }, { key: 'price', label: 'Price', type: 'text' }, { key: 'period', label: 'Period', type: 'text' }, { key: 'features', label: 'Features (one per line)', type: 'textarea' }, { key: 'buttonLabel', label: 'Button label', type: 'text' }, linkF('buttonLink', 'Button link'), { key: 'highlight', label: 'Highlight', type: 'toggle' }] }],
    render: (s, ctx, sec) => wrap(sec, 'pricing', `${head(s, ctx)}<div class="grid cols-${Math.min(4, Math.max(1, (s.plans || []).length))}">${(s.plans || []).map(p => `<div class="plan${p.highlight ? ' hl' : ''}">${p.highlight ? '<span class="badge">Most popular</span>' : ''}<h3>${ctx.e(p.name)}</h3><p class="plan-price">${/^\d+(\.\d+)?$/.test(String(p.price).trim()) ? ctx.money(+p.price) : ctx.e(p.price)}<small>${ctx.e(p.period || '')}</small></p><ul>${String(p.features || '').split('\n').filter(x => x.trim()).map(f => `<li>${ctx.icon('check')}<span>${ctx.e(f)}</span></li>`).join('')}</ul>${p.buttonLabel ? ctx.btn(p.buttonLabel, p.buttonLink, p.highlight ? '' : 'btn-alt') : ''}</div>`).join('')}</div>`),
  },

  gallery: {
    label: 'Gallery', group: 'Media', pages: CONTENT,
    defaults: { heading: 'Gallery', columns: 3, images: [] },
    fields: [{ key: 'heading', label: 'Heading', type: 'text' }, { key: 'columns', label: 'Columns', type: 'select', options: [[2, '2'], [3, '3'], [4, '4']] }, { key: 'images', label: 'Images', type: 'list', itemLabel: 'Image', item: [imgF(), { key: 'caption', label: 'Caption', type: 'text' }] }],
    render: (s, ctx, sec) => wrap(sec, 'gallery', `${head(s, ctx)}<div class="grid cols-${s.columns}">${(s.images || []).filter(i => i.image).map(i => `<figure>${`<img src="${ctx.img(i.image)}" alt="${ctx.e(i.caption || '')}" loading="lazy">`}${i.caption ? `<figcaption>${ctx.e(i.caption)}</figcaption>` : ''}</figure>`).join('')}</div>`),
  },

  'insta-grid': {
    label: 'Instagram-style grid', group: 'Media', pages: CONTENT,
    defaults: { heading: 'Follow along', handle: '@yourstore', images: [] },
    fields: [{ key: 'heading', label: 'Heading', type: 'text' }, { key: 'handle', label: 'Handle', type: 'text' }, { key: 'images', label: 'Images', type: 'list', itemLabel: 'Image', item: [imgF()] }],
    render: (s, ctx, sec) => {
      const url = ctx.store.social.instagram;
      const imgs = (s.images || []).filter(i => i.image).map(i => i.image);
      const list = imgs.length ? imgs : ctx.products('all', '', 6).map(p => p.images[0]).filter(Boolean);
      return wrap(sec, 'insta', `<div class="sec-head center">${s.heading ? `<h2 class="sec-title">${ctx.e(s.heading)}</h2>` : ''}${s.handle ? (url ? `<a class="handle" href="${ctx.e(url)}" target="_blank" rel="noopener">${ctx.e(s.handle)}</a>` : `<p class="handle">${ctx.e(s.handle)}</p>`) : ''}</div><div class="insta-grid">${list.slice(0, 6).map(r => `<div class="insta-cell"><img src="${ctx.img(r)}" alt="" loading="lazy"></div>`).join('')}</div>`);
    },
  },

  locations: {
    label: 'Locations & hours', group: 'Content', pages: CONTENT,
    defaults: { heading: 'Visit us', items: [{ name: 'Main store', address: '12 Market Street', hours: 'Mon–Sat 9:00–18:00', phone: '' }] },
    fields: [{ key: 'heading', label: 'Heading', type: 'text' }, { key: 'items', label: 'Locations', type: 'list', itemLabel: 'Location', item: [{ key: 'name', label: 'Name', type: 'text' }, { key: 'address', label: 'Address', type: 'textarea' }, { key: 'hours', label: 'Hours', type: 'textarea' }, { key: 'phone', label: 'Phone', type: 'text' }] }],
    render: (s, ctx, sec) => wrap(sec, 'locations', `${head(s, ctx)}<div class="grid cols-${Math.min(3, Math.max(1, (s.items || []).length))}">${(s.items || []).map(l => `<div class="loc"><h3>${ctx.e(l.name)}</h3><p>${ctx.icon('pin')}<span>${ctx.e(l.address).replace(/\n/g, '<br>')}</span></p>${l.hours ? `<p>${ctx.icon('clock')}<span>${ctx.e(l.hours).replace(/\n/g, '<br>')}</span></p>` : ''}${l.phone ? `<p>${ctx.icon('chat')}<a href="tel:${ctx.e(l.phone.replace(/[^\d+]/g, ''))}">${ctx.e(l.phone)}</a></p>` : ''}</div>`).join('')}</div>`),
  },

  'page-title': {
    label: 'Page title', group: 'Intro', pages: CONTENT,
    defaults: { heading: 'Page title', text: '' },
    fields: [{ key: 'heading', label: 'Heading', type: 'text' }, { key: 'text', label: 'Text', type: 'textarea' }],
    render: (s, ctx, sec) => wrap(sec, 'ptitle', `<h1 class="sec-title">${ctx.e(s.heading)}</h1>${s.text ? `<div class="sec-sub">${ctx.t(s.text)}</div>` : ''}`),
  },

  'contact-form': {
    label: 'Contact form', group: 'Content', pages: CONTENT,
    defaults: { heading: 'Send us a message', text: 'We reply within one business day.', buttonLabel: 'Send message' },
    fields: [{ key: 'heading', label: 'Heading', type: 'text' }, { key: 'text', label: 'Text', type: 'textarea' }, { key: 'buttonLabel', label: 'Button label', type: 'text' }],
    render: (s, ctx, sec) => {
      const c = ctx.store.contact, to = c.email || ctx.store.checkout.email;
      const det = [c.email && `<li>${ctx.icon('chat')}<a href="mailto:${ctx.e(c.email)}">${ctx.e(c.email)}</a></li>`, c.phone && `<li>${ctx.icon('chat')}<a href="tel:${ctx.e(c.phone.replace(/[^\d+]/g, ''))}">${ctx.e(c.phone)}</a></li>`, c.address && `<li>${ctx.icon('pin')}<span>${ctx.e(c.address)}</span></li>`, c.hours && `<li>${ctx.icon('clock')}<span>${ctx.e(c.hours)}</span></li>`].filter(Boolean).join('');
      return wrap(sec, 'contact', `<div class="split"><div class="split-copy">${head(s, ctx)}<ul class="contact-list">${det}</ul></div>
        <form class="form" data-mailto-form="${ctx.e(to)}" data-subject="Message from the website">
        <label>Name<input name="name" required autocomplete="name"></label><label>Email<input type="email" name="email" required autocomplete="email"></label>
        <label>Message<textarea name="message" rows="5" required></textarea></label><button class="btn" type="submit">${ctx.e(s.buttonLabel || 'Send')}</button>
        ${to ? '' : '<p class="note">Add a contact email in the store settings to receive messages.</p>'}</form></div>`);
    },
  },

  'collection-main': {
    label: 'Product grid with filters', group: 'Products', pages: ['collection'],
    defaults: { showFilters: true, showSort: true, columns: 3, showQuickAdd: true },
    fields: [{ key: 'showFilters', label: 'Category & price filters', type: 'toggle' }, { key: 'showSort', label: 'Sorting', type: 'toggle' }, { key: 'columns', label: 'Columns', type: 'select', options: [[2, '2'], [3, '3'], [4, '4']] }, { key: 'showQuickAdd', label: 'Quick add buttons', type: 'toggle' }],
    render: (s, ctx, sec) => {
      const col = ctx.collection, ps = ctx.collectionProducts(col), cats = [...new Set(ps.map(p => p.category).filter(Boolean))].sort();
      const filters = s.showFilters ? `<label>Category<select data-filter-category><option value="">All</option>${cats.map(c => `<option>${ctx.e(c)}</option>`).join('')}</select></label>
        <label>Min price<input type="number" min="0" step="any" inputmode="decimal" data-filter-min></label><label>Max price<input type="number" min="0" step="any" inputmode="decimal" data-filter-max></label>` : '';
      const sort = s.showSort ? `<label>Sort by<select data-sort><option value="featured">Featured</option><option value="price-asc">Price, low to high</option><option value="price-desc">Price, high to low</option><option value="title">Alphabetically</option></select></label>` : '';
      return wrap(sec, 'cmain', `<div class="ptitle"><h1 class="sec-title">${ctx.e(col.title)}</h1>${col.description ? `<div class="sec-sub">${ctx.t(col.description)}</div>` : ''}</div>
        <div data-collection>${filters || sort ? `<div class="toolbar">${filters}${sort}<span class="count" data-result-count aria-live="polite">${ps.length} products</span></div>` : ''}
        <div class="grid pgrid cols-${s.columns}" data-collection-grid>${ps.map((p, i) => ctx.card(p, s.showQuickAdd, i)).join('')}</div>
        <p class="empty" data-empty ${ps.length ? 'hidden' : ''}>No products match these filters.</p></div>`);
    },
  },

  'product-main': {
    label: 'Product details', group: 'Products', pages: ['product'],
    defaults: { showSku: true, showStock: true, tab2Title: 'Shipping & returns', tab2Text: 'Ships within 2 business days. Free returns within 30 days.', tab3Title: '', tab3Text: '', buttonLabel: 'Add to cart' },
    fields: [{ key: 'buttonLabel', label: 'Button label', type: 'text' }, { key: 'showSku', label: 'Show SKU', type: 'toggle' }, { key: 'showStock', label: 'Show stock', type: 'toggle' },
      { key: 'tab2Title', label: 'Second tab title', type: 'text' }, { key: 'tab2Text', label: 'Second tab text', type: 'textarea' }, { key: 'tab3Title', label: 'Third tab title', type: 'text' }, { key: 'tab3Text', label: 'Third tab text', type: 'textarea' }],
    render: (s, ctx, sec) => {
      const p = ctx.product;
      if (!p) return wrap(sec, 'pmain', '<p class="empty">Add a product to see this page.</p>');
      const v0 = p.variants.find(v => v.stock == null || v.stock > 0) || p.variants[0];
      const price = v0 && v0.price != null ? v0.price : p.price, cmp = p.compareAt && p.compareAt > price ? p.compareAt : null;
      const imgs = p.images.length ? p.images : [];
      const gallery = `<div class="pgallery" data-gallery>${imgs.length ? `<div class="pmain-img"><img data-main-image src="${ctx.img(imgs[0])}" alt="${ctx.e(p.title)}"></div>` : '<div class="pmain-img noimg"></div>'}
        ${imgs.length > 1 ? `<div class="thumbs">${imgs.map((r, i) => `<button type="button" class="thumb" data-thumb="${ctx.img(r)}" aria-label="Show image ${i + 1}"${i ? '' : ' aria-current="true"'}><img src="${ctx.img(r)}" alt="" loading="lazy"></button>`).join('')}</div>` : ''}</div>`;
      const opts = p.options.map((o, k) => `<fieldset class="opt"><legend>${ctx.e(o.name)}: <span data-opt-value="${k}">${ctx.e(v0 ? v0.options[k] : '')}</span></legend><div class="pills">${o.values.map(val => `<label class="pill"><input type="radio" name="opt${k}" value="${ctx.e(val)}"${v0 && v0.options[k] === val ? ' checked' : ''}><span>${ctx.e(val)}</span></label>`).join('')}</div></fieldset>`).join('');
      const tabs = [['Description', p.description], [s.tab2Title, s.tab2Text], [s.tab3Title, s.tab3Text]].filter(([t, x]) => t && x);
      const tabHtml = tabs.length ? `<div class="tabs" data-tabs><div role="tablist" aria-label="Product information">${tabs.map(([t], i) => `<button type="button" role="tab" id="tab-${i}" aria-controls="panel-${i}" aria-selected="${i === 0}" tabindex="${i ? -1 : 0}">${ctx.e(t)}</button>`).join('')}</div>${tabs.map(([, x], i) => `<div role="tabpanel" id="panel-${i}" aria-labelledby="tab-${i}" class="prose"${i ? ' hidden' : ''}>${ctx.t(x)}</div>`).join('')}</div>` : '';
      const buy = ctx.checkoutEnabled ? `<div class="buy"><div class="qty"><button type="button" data-qty-step="-1" aria-label="Decrease quantity">−</button><input type="number" name="qty" value="1" min="1" max="999" aria-label="Quantity" inputmode="numeric"><button type="button" data-qty-step="1" aria-label="Increase quantity">+</button></div>
        <button class="btn btn-wide" type="submit" data-add-to-cart${v0 && (v0.stock == null || v0.stock > 0) ? '' : ' disabled'}>${ctx.e(v0 && (v0.stock == null || v0.stock > 0) ? s.buttonLabel || 'Add to cart' : 'Sold out')}</button></div>` : `<p class="note">${ctx.store.contact.email ? `To order, <a href="${ctx.link('page:contact')}">contact us</a>.` : 'Online ordering is not available.'}</p>`;
      return wrap(sec, 'pmain', `<nav class="crumbs" aria-label="Breadcrumb"><a href="${ctx.link('home')}">Home</a><span aria-hidden="true">/</span><a href="${ctx.link('collection:all')}">Shop</a><span aria-hidden="true">/</span><span aria-current="page">${ctx.e(p.title)}</span></nav>
        <div class="product">${gallery}<div class="pinfo">${p.category ? `<p class="eyebrow">${ctx.e(p.category)}</p>` : ''}<h1 class="ptitle-h">${ctx.e(p.title)}</h1>
        <p class="pprice"><span data-price>${ctx.money(price)}</span> <s class="compare" data-compare${cmp ? '' : ' hidden'}>${cmp ? ctx.money(cmp) : ''}</s></p>
        <form class="pform" data-product-form="${p.id}" data-button-label="${ctx.e(s.buttonLabel || 'Add to cart')}">${opts}
        <p class="pmeta">${s.showSku ? `<span>SKU: <span data-sku>${ctx.e(v0?.sku || '')}</span></span>` : ''}${s.showStock ? `<span data-stock>${v0 && v0.stock != null ? (v0.stock > 0 ? v0.stock + ' in stock' : 'Out of stock') : 'In stock'}</span>` : ''}</p>${buy}</form>${tabHtml}</div></div>`);
    },
  },

  'related-products': {
    label: 'Related products', group: 'Products', pages: ['product'],
    defaults: { heading: 'You may also like', limit: 4 },
    fields: [{ key: 'heading', label: 'Heading', type: 'text' }, { key: 'limit', label: 'Products shown', type: 'number', min: 1, max: 12 }],
    render: (s, ctx, sec) => {
      const p = ctx.product, all = ctx.products('all', '', 999).filter(x => !p || x.id !== p.id);
      const same = p ? all.filter(x => x.category === p.category) : [];
      const ps = [...same, ...all.filter(x => !same.includes(x))].slice(0, s.limit);
      return ps.length ? wrap(sec, 'related', `${s.heading ? `<h2 class="sec-title">${ctx.e(s.heading)}</h2>` : ''}<div class="grid pgrid cols-4">${ps.map(x => ctx.card(x, true)).join('')}</div>`) : '';
    },
  },

  'cart-main': {
    label: 'Cart', group: 'Products', pages: ['cart'],
    defaults: { heading: 'Your cart', emptyText: 'Your cart is empty.' },
    fields: [{ key: 'heading', label: 'Heading', type: 'text' }, { key: 'emptyText', label: 'Empty cart text', type: 'text' }],
    render: (s, ctx, sec) => wrap(sec, 'cartpage narrow', `<h1 class="sec-title">${ctx.e(s.heading)}</h1>${ctx.checkoutEnabled ? `<div data-cart-page data-empty-text="${ctx.e(s.emptyText)}"><p class="empty">${ctx.e(s.emptyText)}</p></div>
      <noscript><p class="note">Turn on JavaScript to use the cart.</p></noscript>` : '<p class="note">This store does not take orders online.</p>'}`),
  },

  'checkout-main': {
    label: 'Checkout', group: 'Products', pages: ['checkout'],
    defaults: { heading: 'Checkout', note: '' },
    fields: [{ key: 'heading', label: 'Heading', type: 'text' }, { key: 'note', label: 'Extra note', type: 'textarea' }],
    render: (s, ctx, sec) => {
      const ck = ctx.store.checkout, mode = ck.mode;
      const how = { whatsapp: 'Your order is sent to us as a WhatsApp message. We confirm availability, shipping and payment with you in the chat.', email: 'Your order is sent to us by email from your mail app. We reply to confirm shipping and payment.', paymentLinks: 'Each product is paid on our payment provider’s secure page.', none: 'This store does not take orders online.' }[mode];
      const fields = mode === 'whatsapp' || mode === 'email' ? `<form class="form" data-checkout-form>
        <label>Full name<input name="name" required autocomplete="name"></label><label>Phone<input name="phone" type="tel" autocomplete="tel"${mode === 'whatsapp' ? '' : ''}></label>
        ${mode === 'email' ? '<label>Email<input name="email" type="email" required autocomplete="email"></label>' : ''}
        <label>Delivery address<textarea name="address" rows="3" autocomplete="street-address"></textarea></label><label>Notes<textarea name="notes" rows="2"></textarea></label>
        <button class="btn btn-wide" type="submit">${mode === 'whatsapp' ? 'Send order on WhatsApp' : 'Send order by email'}</button></form>` : mode === 'paymentLinks' ? '<div data-pay-links></div>' : '';
      const missing = (mode === 'whatsapp' && !ck.phone) || (mode === 'email' && !ck.email);
      return wrap(sec, 'checkout', `<h1 class="sec-title">${ctx.e(s.heading)}</h1><div class="co-grid" data-checkout data-mode="${mode}">
        <div class="co-form"><p class="sec-sub">${ctx.e(how)}</p>${missing ? '<p class="note warn">The store owner has not set up the order contact yet.</p>' : ''}${fields}
        <div class="co-result" data-checkout-result hidden></div>${s.note ? `<div class="prose note">${ctx.t(s.note)}</div>` : ''}${ck.shippingNote ? `<p class="note">${ctx.icon('truck')} ${ctx.e(ck.shippingNote)}</p>` : ''}
        ${mode !== 'none' ? '<p class="note small">Payments are handled outside this website — by the store owner directly or by their own payment links/provider. This site never asks for card details.</p>' : ''}</div>
        <aside class="co-summary" aria-label="Order summary"><h2>Order summary</h2><div data-checkout-lines><p class="empty">Your cart is empty.</p></div></aside></div>`);
    },
  },
};

export const SECTION_GROUPS = ['Intro', 'Products', 'Content', 'Social proof', 'Media', 'Courses & services'];
/** Section types that can be added to a page (excluding the shared layout sections). */
export const addableSections = page => Object.entries(SECTIONS).filter(([, d]) => !d.global && d.pages.includes(page)).map(([type, d]) => ({ type, label: d.label, group: d.group }));
