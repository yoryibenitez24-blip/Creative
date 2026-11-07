// Zertake Commerce: a back-office app around the store builder (orders, products, inventory, customers, discounts,
// analytics, marketing, online store, settings). See the contract below; data schemas: src/store/admin/model.js.
import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { House, Inbox, Tag, Users, Percent, BarChart3, Megaphone, Store, Settings as SettingsIcon, Search, ExternalLink, ArrowLeft, Menu } from 'lucide-react';
import StoreBuilder, { createStore } from '../StoreBuilder.jsx';
import Gallery from '../Gallery.jsx';
import { normalizeStore, imageRefs, STORE_VERSION } from '../model.js';
import { previewShellHtml } from '../exporter.js';
import { createImageResolver, uploadImage } from '../images.js';
import { normalizeCommerce, createCommerce, COMMERCE_VERSION, customerName } from './model.js';
import { trackedPreviewHtml, parseTrackerMessage, addEvents } from './analytics.js';
import { createOrder, lineFor, ensureCustomer, orderMatches } from './orders.js';
import { AdminCtx, useConfirm, useMoney } from './ui.jsx';
import Intro, { shouldPlayIntro } from './Intro.jsx';
import Home from './Home.jsx';
import { OrdersList, OrderDetail, OrderEditor } from './Orders.jsx';
import { ProductsList, ProductDetail, InventoryPage, CollectionsList, CollectionDetail } from './Products.jsx';
import { CustomersList, CustomerDetail } from './Customers.jsx';
import { DiscountsList, DiscountDetail } from './Discounts.jsx';
import Analytics from './Analytics.jsx';
import Marketing from './Marketing.jsx';
import { Themes, PagesPage, NavigationPage, Preferences } from './OnlineStore.jsx';
import Settings from './Settings.jsx';

/**
 * Commerce admin.
 *
 * props:
 *   store                    store document (src/store/model.js) or null → the template gallery is shown first
 *   onChange(store, label)   next full store document after every store edit (products, stock, theme, settings…)
 *   onExit()                 leave the commerce app (optional; shows a back button)
 *   onOpenPhotoStudio()      open the product photo studio (optional)
 *   assetStore               AssetStore for uploaded images (optional; without it images become data: URLs)
 *   commerce                 commerce document (src/store/admin/model.js) or null → a default one is created and reported
 *   onCommerceChange(commerce, label)  next full commerce document after every back-office edit
 *
 * Actions that touch both documents (e.g. "Mark as paid" decrements stock) call onChange and onCommerceChange with
 * the same label, store first. The app keeps the latest documents itself, so consecutive edits compose even when the
 * host re-renders later. Keyboard: "/" focuses search; Esc closes dialogs and the search; handled keys are stopped on
 * window (capture phase); typing in inputs is ignored. The store builder (Online Store › Customize) has its own undo.
 */
const NAV = [
  ['home', 'Home', House],
  ['orders', 'Orders', Inbox],
  ['products', 'Products', Tag, [['products', 'All products'], ['inventory', 'Inventory'], ['collections', 'Collections']]],
  ['customers', 'Customers', Users],
  ['discounts', 'Discounts', Percent],
  ['analytics', 'Analytics', BarChart3],
  ['marketing', 'Marketing', Megaphone],
  ['themes', 'Online Store', Store, [['themes', 'Themes'], ['pages', 'Pages'], ['navigation', 'Navigation'], ['preferences', 'Preferences']]],
];
const SECTION_OF = { order: 'orders', 'order-new': 'orders', product: 'products', inventory: 'products', collections: 'products', collection: 'products', customer: 'customers', discount: 'discounts', pages: 'themes', navigation: 'themes', preferences: 'themes' };

export default function CommerceApp({ store, onChange, onExit, onOpenPhotoStudio, assetStore, commerce, onCommerceChange }) {
  const [, bump] = useReducer(x => x + 1, 0);
  // latest documents (props are adopted when they change; our own commits are visible immediately)
  const S = useRef(null), K = useRef(null), seen = useRef({ store: undefined, commerce: undefined });
  if (seen.current.store !== store) { seen.current.store = store; S.current = store ? (store.kind === 'store' && store.version === STORE_VERSION && store.pages ? store : normalizeStore(store)) : null; }
  if (seen.current.commerce !== commerce || (!K.current && S.current)) {
    seen.current.commerce = commerce;
    K.current = commerce && commerce.kind === 'commerce' ? (commerce.version === COMMERCE_VERSION && commerce.settings ? commerce : normalizeCommerce(commerce)) : S.current ? createCommerce(S.current) : null;
  }
  const cur = S.current, com = K.current;

  const commit = useCallback((nextStore, nextCommerce, label) => {
    if (nextStore && nextStore !== S.current) { S.current = nextStore; onChange && onChange(nextStore, label); }
    if (nextCommerce && nextCommerce !== K.current) { K.current = nextCommerce; onCommerceChange && onCommerceChange(nextCommerce, label); }
    bump();
  }, [onChange, onCommerceChange]);
  // report a freshly created commerce document once
  useEffect(() => { if (cur && com && (!commerce || commerce.kind !== 'commerce')) onCommerceChange && onCommerceChange(com, 'Set up commerce'); }, [cur && cur.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const [route, setRoute] = useState({ page: 'home' });
  const [intro, setIntro] = useState(() => shouldPlayIntro());
  const [customizing, setCustomizing] = useState(false);
  const [toast, setToast] = useState('');
  const [navOpen, setNavOpen] = useState(false);
  const [confirmEl, confirm] = useConfirm();
  const toastT = useRef(0);
  const notify = useCallback(msg => { setToast(msg); clearTimeout(toastT.current); toastT.current = setTimeout(() => setToast(''), 4200); }, []);
  const resolver = useMemo(() => createImageResolver(assetStore, () => bump()), [assetStore]);
  const imageUrl = useCallback(ref => resolver.url(ref), [resolver]);
  const upload = useCallback(file => uploadImage(file, assetStore), [assetStore]);
  const fmt = useMoney(cur);
  const main = useRef(null);
  const go = useCallback(r => { setRoute(typeof r === 'string' ? { page: r } : r); setNavOpen(false); if (main.current) main.current.scrollTop = 0; }, []);

  const editStore = useCallback((fn, label) => { const d = structuredClone(S.current); fn(d); commit(normalizeStore(d), null, label); }, [commit]);
  const editCommerce = useCallback((fn, label) => { const d = structuredClone(K.current); fn(d); commit(null, normalizeCommerce(d), label); }, [commit]);
  /** run(fn, label): fn(store, commerce) → { store?, commerce? }; errors become a toast. Returns the result or null. */
  const run = useCallback((fn, label) => {
    try { const r = fn(S.current, K.current) || {}; commit(r.store || null, r.commerce || null, label); if (label) notify(label); return r; }
    catch (err) { notify(err.message || String(err)); return null; }
  }, [commit, notify]);

  // ---------- "View store": preview tab with the tracker; its events land in analytics ----------
  const previewWin = useRef(null);
  const viewStore = useCallback(async () => {
    const w = window.open('', '_blank');
    await resolver.ready(imageRefs(S.current));
    const html = trackedPreviewHtml(previewShellHtml(S.current, imageUrl), S.current.id);
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    if (w) { w.location.href = url; previewWin.current = w; } else notify('The browser blocked the preview tab — allow pop-ups for this site.');
  }, [resolver, imageUrl, notify]);
  useEffect(() => {
    const onMsg = e => {
      if (!previewWin.current || e.source !== previewWin.current) return;
      const m = parseTrackerMessage(e.data, S.current); if (!m) return;
      if (m.events.length) commit(null, addEvents(K.current, m.events), 'Store activity');
      if (m.order) {
        let c = K.current;
        const lines = m.order.lines.map(l => lineFor(S.current, l.productId, l.variantId, l.quantity)).filter(Boolean);
        if (!lines.length) return;
        const [firstName, ...rest] = m.order.customer.name.trim().split(/\s+/);
        const ec = ensureCustomer(c, { email: m.order.customer.email, phone: m.order.customer.phone, firstName: firstName || '', lastName: rest.join(' ') }); c = ec.commerce;
        const r = createOrder(S.current, c, { lines, customerId: ec.customer?.id || null, email: m.order.customer.email, phone: m.order.customer.phone, shippingAddress: { name: m.order.customer.name, address1: m.order.customer.address }, note: m.order.customer.notes, source: 'preview', sessionId: m.order.sessionId });
        commit(r.store, r.commerce, 'Order ' + r.order.name + ' placed in the store preview');
        notify('New order ' + r.order.name + ' from the store preview');
      }
    };
    window.addEventListener('message', onMsg); return () => window.removeEventListener('message', onMsg);
  }, [commit, notify]);

  // ---------- search ----------
  const [q, setQ] = useState(''), [qOpen, setQOpen] = useState(false), [qi, setQi] = useState(0);
  const searchRef = useRef(null);
  const results = useMemo(() => {
    const s = q.trim().toLowerCase(); if (!s || !cur || !com) return [];
    const out = [];
    for (const o of com.orders) if (orderMatches(o, s, com.customers)) out.push({ kind: 'Order', label: o.name, sub: o.email || customerName(com.customers.find(c => c.id === o.customerId)), route: { page: 'order', id: o.id } });
    for (const p of cur.products) if ((p.title + ' ' + p.variants.map(v => v.sku).join(' ') + ' ' + p.tags.join(' ')).toLowerCase().includes(s)) out.push({ kind: 'Product', label: p.title, sub: p.status === 'draft' ? 'Draft' : p.category, route: { page: 'product', id: p.id } });
    for (const c of com.customers) if ((customerName(c) + ' ' + c.email + ' ' + c.phone).toLowerCase().includes(s)) out.push({ kind: 'Customer', label: customerName(c), sub: c.email, route: { page: 'customer', id: c.id } });
    return out.slice(0, 12);
  }, [q, cur, com]);
  const pickResult = r => { go(r.route); setQ(''); setQOpen(false); };

  // ---------- keyboard (capture on window; only handled keys are stopped; inputs ignored) ----------
  useEffect(() => {
    if (customizing || intro) return;
    const onKey = e => {
      const t = e.target, typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
      if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey && !document.querySelector('.caModal')) { e.preventDefault(); e.stopPropagation(); searchRef.current?.focus(); setQOpen(true); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [customizing, intro]);

  // ---------- no store yet: pick a template first ----------
  if (!cur) return <div className="caRoot caPicker stRoot"><Gallery onPick={id => commit(createStore(id), null, 'Create store')} onCancel={onExit} /></div>;
  if (customizing) return <StoreBuilder store={cur} onChange={(s, label) => commit(s, null, label)} onExit={() => setCustomizing(false)} onOpenPhotoStudio={onOpenPhotoStudio} assetStore={assetStore} />;

  const ctx = { store: cur, commerce: com, commit, editStore, editCommerce, run, fmt, imageUrl, upload, resolver, notify, confirm, go, route, assetStore, onOpenPhotoStudio, customize: () => setCustomizing(true), viewStore };
  const section = SECTION_OF[route.page] || route.page;
  const toFulfill = com.orders.filter(o => !o.draft && o.status === 'open' && o.fulfillmentStatus === 'unfulfilled').length;
  const page = (() => {
    switch (route.page) {
      case 'home': return <Home />;
      case 'orders': return <OrdersList />;
      case 'order': return <OrderDetail id={route.id} />;
      case 'order-new': return <OrderEditor id={route.id} />;
      case 'products': return <ProductsList />;
      case 'product': return <ProductDetail id={route.id} />;
      case 'inventory': return <InventoryPage />;
      case 'collections': return <CollectionsList />;
      case 'collection': return <CollectionDetail id={route.id} />;
      case 'customers': return <CustomersList />;
      case 'customer': return <CustomerDetail id={route.id} />;
      case 'discounts': return <DiscountsList />;
      case 'discount': return <DiscountDetail id={route.id} />;
      case 'analytics': return <Analytics />;
      case 'marketing': return <Marketing />;
      case 'themes': return <Themes />;
      case 'pages': return <PagesPage />;
      case 'navigation': return <NavigationPage />;
      case 'preferences': return <Preferences />;
      case 'settings': return <Settings tab={route.tab || 'general'} />;
      default: return <Home />;
    }
  })();

  return <AdminCtx.Provider value={ctx}>
    <div className="caRoot">
      <header className="caTop">
        <button type="button" className="caIconBtn caNavToggle" aria-label="Toggle navigation" aria-expanded={navOpen} onClick={() => setNavOpen(v => !v)}><Menu size={18} /></button>
        {onExit && <button type="button" className="caIconBtn" aria-label="Exit commerce" title="Exit commerce" onClick={onExit}><ArrowLeft size={17} /></button>}
        <div className="caBrand"><span className="caBrandMark" aria-hidden="true">{(cur.name || 'S').trim().charAt(0).toUpperCase()}</span><strong>{cur.name}</strong></div>
        <div className="caSearch" role="search">
          <Search size={15} aria-hidden="true" />
          <input ref={searchRef} type="search" aria-label="Search orders, products and customers" placeholder="Search orders, products, customers  ( / )" value={q}
            role="combobox" aria-expanded={qOpen && results.length > 0} aria-controls="caSearchList" aria-autocomplete="list"
            onChange={e => { setQ(e.target.value); setQOpen(true); setQi(0); }} onFocus={() => setQOpen(true)} onBlur={() => setTimeout(() => setQOpen(false), 150)}
            onKeyDown={e => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setQi(i => Math.min(results.length - 1, i + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setQi(i => Math.max(0, i - 1)); }
              else if (e.key === 'Enter' && results[qi]) { e.preventDefault(); pickResult(results[qi]); }
              else if (e.key === 'Escape') { e.stopPropagation(); setQOpen(false); e.target.blur(); }
            }} />
          {qOpen && q.trim() && <ul className="caSearchList" id="caSearchList" role="listbox" aria-label="Search results">
            {results.length ? results.map((r, i) => <li key={r.kind + r.route.id} role="option" aria-selected={i === qi} className={i === qi ? 'on' : ''} onMouseDown={e => { e.preventDefault(); pickResult(r); }}>
              <span className="caSearchKind">{r.kind}</span><strong>{r.label}</strong><small>{r.sub}</small></li>) : <li className="caSearchNone">No results for “{q.trim()}”</li>}
          </ul>}
        </div>
        <span className="caSpacer" />
        <button type="button" className="caBtn" onClick={viewStore}><ExternalLink size={14} aria-hidden="true" />View store</button>
      </header>
      <div className="caBody">
        <nav className={'caNav' + (navOpen ? ' open' : '')} aria-label="Commerce">
          <ul>
            {NAV.map(([key, label, Icon, children]) => <li key={key}>
              <button type="button" className={'caNavItem' + (section === key ? ' on' : '')} aria-current={route.page === key ? 'page' : undefined} onClick={() => go(key)}>
                <Icon size={16} aria-hidden="true" /><span>{label}</span>{key === 'orders' && toFulfill > 0 && <span className="caNavBadge" aria-label={`${toFulfill} to fulfill`}>{toFulfill}</span>}
              </button>
              {children && section === key && <ul className="caSubNav">{children.map(([k, l]) => <li key={k}>
                <button type="button" className={'caNavSub' + ((route.page === k || SECTION_OF[route.page] === k || (k === 'products' && route.page === 'product') || (k === 'collections' && route.page === 'collection')) ? ' on' : '')} aria-current={route.page === k ? 'page' : undefined} onClick={() => go(k)}>{l}</button>
              </li>)}</ul>}
            </li>)}
          </ul>
          <div className="caNavFoot">
            <button type="button" className={'caNavItem' + (section === 'settings' ? ' on' : '')} aria-current={route.page === 'settings' ? 'page' : undefined} onClick={() => go({ page: 'settings', tab: 'general' })}><SettingsIcon size={16} aria-hidden="true" /><span>Settings</span></button>
          </div>
        </nav>
        <main className="caMain" ref={main} aria-label="Commerce content">{page}</main>
      </div>
      <div className="caToast" role="status" aria-live="polite">{toast && <span>{toast}</span>}</div>
      {confirmEl}
      {intro && <Intro storeName={cur.name} onDone={() => setIntro(false)} />}
    </div>
  </AdminCtx.Provider>;
}
