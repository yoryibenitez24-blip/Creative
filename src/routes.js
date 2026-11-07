// URL scheme (History API). Pure functions: parse a location into an app route and format a route back into a path.
//
//   /                                   home
//   /photography  /design  /web         the other tools
//   /commerce                           E-commerce (resolves to the active store, or the setup wizard when there is none)
//   /commerce/new                       new store setup
//   /commerce/stores                    all stores (switcher list, plan)
//   /commerce/<handle>                  a store's admin home
//   /commerce/<handle>/<page>[/<id>]    orders, orders/<id>, orders/new[/<draftId>], products[/<id>], inventory,
//                                       collections[/<id>], customers[/<id>], discounts[/<id>], analytics, marketing,
//                                       themes, pages, navigation, preferences, settings[/<tab>], editor (store builder)
//
// Old hash links keep working: /#home /#photo /#design /#web /#ecom (also #photography, #commerce).
//
// Route shape: { section: 'home'|'photo'|'design'|'web'|'ecom', commerce?: CommerceRoute }
//   CommerceRoute: { view: 'auto' } | { view: 'new' } | { view: 'stores' } | { view: 'store', handle, page, id?, tab? }
//   (page/id/tab use CommerceApp's internal route names: 'order', 'order-new', 'product', 'settings' + tab, 'editor', …)

export const SECTION_PATHS = { home: '/', photo: '/photography', design: '/design', web: '/web', ecom: '/commerce' };
const PATH_SECTIONS = { photography: 'photo', design: 'design', web: 'web', commerce: 'ecom' };
const HASH_ALIASES = { home: 'home', photo: 'photo', photography: 'photo', design: 'design', web: 'web', ecom: 'ecom', commerce: 'ecom' };
/** Handles that cannot name a store (they are commerce pages). */
export const RESERVED_HANDLES = ['new', 'stores'];

// list page ↔ path segment, and the detail page that "<segment>/<id>" opens
const LIST_PAGES = ['orders', 'products', 'inventory', 'collections', 'customers', 'discounts', 'analytics', 'marketing', 'themes', 'pages', 'navigation', 'preferences', 'settings', 'editor'];
const DETAIL_OF = { orders: 'order', products: 'product', collections: 'collection', customers: 'customer', discounts: 'discount' };
const LIST_OF = Object.fromEntries(Object.entries(DETAIL_OF).map(([k, v]) => [v, k]));

const seg = s => encodeURIComponent(s);
const unseg = s => { try { return decodeURIComponent(s); } catch { return s; } };

/** Turn a name into a URL handle: lower-case ascii, words joined by '-'. */
export function slugify(name) {
  const s = String(name || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/, '');
  return s || 'store';
}

/** A handle for `name` that is not in `taken` (array/Set of handles) and not reserved: "name", "name-2", "name-3"… */
export function uniqueHandle(name, taken = []) {
  const set = taken instanceof Set ? taken : new Set(taken);
  let base = slugify(name);
  if (RESERVED_HANDLES.includes(base)) base += '-store';
  let h = base, n = 2;
  while (set.has(h)) h = base + '-' + n++;
  return h;
}

/** Parse a pathname (+ optional legacy hash) into a route. Unknown paths → home. */
export function parseLocation(pathname = '/', hash = '') {
  const parts = String(pathname || '/').split('/').filter(Boolean).map(unseg);
  const h = String(hash || '').replace(/^#/, '');
  if (!parts.length) return HASH_ALIASES[h] ? withCommerce(HASH_ALIASES[h]) : { section: 'home' };
  const section = PATH_SECTIONS[parts[0]];
  if (!section) return { section: 'home' };
  if (section !== 'ecom') return { section };
  return { section, commerce: parseCommerce(parts.slice(1)) };
}
const withCommerce = section => section === 'ecom' ? { section, commerce: { view: 'auto' } } : { section };

function parseCommerce(p) {
  if (!p.length) return { view: 'auto' };
  if (p[0] === 'new' && p.length === 1) return { view: 'new' };
  if (p[0] === 'stores' && p.length === 1) return { view: 'stores' };
  const handle = p[0], [a, b, c] = p.slice(1);
  const r = { view: 'store', handle, page: 'home' };
  if (!a) return r;
  if (a === 'orders' && b === 'new') return c ? { ...r, page: 'order-new', id: c } : { ...r, page: 'order-new' };
  if (a === 'settings') return { ...r, page: 'settings', tab: b || 'general' };
  if (DETAIL_OF[a] && b) return { ...r, page: DETAIL_OF[a], id: b };
  if (LIST_PAGES.includes(a)) return { ...r, page: a };
  return r;
}

/** Format a route as a path. */
export function formatRoute(route) {
  const section = route && route.section || 'home';
  if (section !== 'ecom') return SECTION_PATHS[section] || '/';
  const c = route.commerce || { view: 'auto' };
  if (c.view === 'new') return '/commerce/new';
  if (c.view === 'stores') return '/commerce/stores';
  if (c.view !== 'store' || !c.handle) return '/commerce';
  return '/commerce/' + seg(c.handle) + commercePagePath(c);
}

/** The part of a store path after the handle ('' for home), from a CommerceApp route { page, id?, tab? }. */
export function commercePagePath({ page = 'home', id, tab } = {}) {
  if (page === 'home') return '';
  if (page === 'order-new') return '/orders/new' + (id ? '/' + seg(id) : '');
  if (page === 'settings') return '/settings' + (tab && tab !== 'general' ? '/' + seg(tab) : '');
  if (LIST_OF[page]) return '/' + LIST_OF[page] + (id ? '/' + seg(id) : '');
  return LIST_PAGES.includes(page) ? '/' + page : '';
}

/** The CommerceApp route ({ page, id?, tab? }) inside a store route. */
export function adminRoute(c) {
  const r = { page: c && c.page || 'home' };
  if (c && c.id) r.id = c.id;
  if (c && c.page === 'settings') r.tab = c.tab || 'general';
  return r;
}

const PAGE_LABELS = {
  home: 'Home', orders: 'Orders', order: 'Order', 'order-new': 'New order', products: 'Products', product: 'Product', inventory: 'Inventory',
  collections: 'Collections', collection: 'Collection', customers: 'Customers', customer: 'Customer', discounts: 'Discounts', discount: 'Discount',
  analytics: 'Analytics', marketing: 'Marketing', themes: 'Online Store', pages: 'Pages', navigation: 'Navigation', preferences: 'Preferences',
  settings: 'Settings', editor: 'Store editor',
};
const SECTION_TITLES = { photo: 'Photography', design: 'Design', web: 'Web & UI', ecom: 'Commerce' };

/** document.title for a route: "Page · Store · Zertake". */
export function routeTitle(route, storeName = '') {
  const s = route && route.section || 'home';
  if (s === 'home') return 'Zertake Studio';
  if (s !== 'ecom') return SECTION_TITLES[s] + ' · Zertake';
  const c = route.commerce || {};
  if (c.view === 'new') return 'New store · Commerce · Zertake';
  if (c.view === 'stores') return 'All stores · Commerce · Zertake';
  if (c.view === 'store') {
    let label = PAGE_LABELS[c.page] || 'Home';
    if (c.page === 'settings' && c.tab && c.tab !== 'general') label = 'Settings';
    if (c.id === 'new' && LIST_OF[c.page]) label = 'New ' + label.toLowerCase();
    return label + ' · ' + (storeName || c.handle) + ' · Zertake';
  }
  return 'Commerce · Zertake';
}

/** True when two routes format to the same path. */
export const sameRoute = (a, b) => formatRoute(a) === formatRoute(b);
