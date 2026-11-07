// Zertake Commerce: a back-office app around the store builder (orders, products, inventory, customers, discounts,
// analytics, marketing, online store, settings). See the contract below; data schemas: src/store/admin/model.js.
import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { LayoutDashboard, Inbox, Tag, Users, Percent, BarChart3, Megaphone, Store, Settings as SettingsIcon, Search, ExternalLink, LogOut, Menu, Sun, Moon, Bell, ChevronDown, PanelLeftClose, PanelLeftOpen, LifeBuoy, Sparkles, Crown, Keyboard } from 'lucide-react';
import StoreBuilder, { createStore } from '../StoreBuilder.jsx';
import Gallery from '../Gallery.jsx';
import { normalizeStore, imageRefs, STORE_VERSION } from '../model.js';
import { previewShellHtml } from '../exporter.js';
import { createImageResolver, uploadImage } from '../images.js';
import { normalizeCommerce, createCommerce, COMMERCE_VERSION, customerName } from './model.js';
import { trackedPreviewHtml, parseTrackerMessage, addEvents } from './analytics.js';
import { createOrder, lineFor, ensureCustomer, orderMatches } from './orders.js';
import { AdminCtx, useConfirm, useMoney, Modal, Btn } from './ui.jsx';
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
 *   sectionBar               the app's section switcher (Home · Photography · Design · Web & UI · E-commerce), shown in the header
 *   onExit()                 leave the commerce app (optional; shows a back button)
 *   onOpenPhotoStudio()      open the product photo studio (optional)
 *   assetStore               AssetStore for uploaded images (optional; without it images become data: URLs)
 *   commerce                 commerce document (src/store/admin/model.js) or null → a default one is created and reported
 *   onCommerceChange(commerce, label)  next full commerce document after every back-office edit
 *   route, onRoute(route)    optional controlled routing (both or neither): route = { page, id?, tab? } as below, plus
 *                            page 'editor' for the store builder (Online Store › Customize). Without them the app keeps
 *                            its own route state (starts at Home).
 *   storeSwitcher            optional node shown in place of the store name in the sidebar (multi-store hosts)
 *   plan, onUpgrade()        optional account plan id (src/store/admin/plans.js) and a callback that opens the plan picker;
 *                            with onUpgrade the sidebar shows an "Upgrade" card (or "You're on Pro" on the top plan)
 *
 * Actions that touch both documents (e.g. "Mark as paid" decrements stock) call onChange and onCommerceChange with
 * the same label, store first. The app keeps the latest documents itself, so consecutive edits compose even when the
 * host re-renders later. Keyboard: "/" or Ctrl/⌘+K focuses search; Esc closes dialogs and the search; handled keys are stopped on
 * window (capture phase); typing in inputs is ignored. The store builder (Online Store › Customize) has its own undo.
 */
// [key, label, icon, sub-pages?]. The sidebar shows NAV_MAIN, a divider, NAV_MORE; Settings and Help sit at the bottom.
const NAV_MAIN = [
  ['home', 'Dashboard', LayoutDashboard],
  ['orders', 'Orders', Inbox],
  ['products', 'Products', Tag, [['products', 'All products'], ['inventory', 'Inventory'], ['collections', 'Collections']]],
  ['customers', 'Customers', Users],
  ['themes', 'Online Store', Store, [['themes', 'Themes'], ['pages', 'Pages'], ['navigation', 'Navigation'], ['preferences', 'Preferences']]],
];
const NAV_MORE = [
  ['analytics', 'Analytics', BarChart3],
  ['discounts', 'Discounts', Percent],
  ['marketing', 'Marketing', Megaphone],
];
const NAV = [...NAV_MAIN, ...NAV_MORE];
const COLLAPSE_KEY = 'zertake.commerceNavCollapsed';
const loadCollapsed = () => { try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; } };
const isMac = () => { try { return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || ''); } catch { return false; } };
const markTheme = c => ({ ...c, onboarding: { ...c.onboarding, steps: { ...c.onboarding.steps, theme: true } } });
const THEME_KEY = 'zertake.commerceTheme';
const loadTheme = () => { try { return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'; } catch { return 'light'; } };
const SECTION_OF = { order: 'orders', 'order-new': 'orders', product: 'products', inventory: 'products', collections: 'products', collection: 'products', customer: 'customers', discount: 'discounts', pages: 'themes', navigation: 'themes', preferences: 'themes' };

export default function CommerceApp({ store, onChange, onExit, onOpenPhotoStudio, assetStore, commerce, onCommerceChange, intro: playIntro, sectionBar, route: routeProp, onRoute, storeSwitcher, plan, onUpgrade }) {
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

  const [routeState, setRoute] = useState({ page: 'home' });
  const controlled = routeProp !== undefined && !!onRoute;
  const route = controlled ? (routeProp || { page: 'home' }) : routeState;
  const onRouteRef = useRef(onRoute); onRouteRef.current = controlled ? onRoute : null;
  // intro: true → play the entrance animation now; false → never; undefined → first open in this browser session
  const [intro, setIntro] = useState(() => playIntro === undefined ? shouldPlayIntro() : !!playIntro);
  const [entering, setEntering] = useState(false);
  const endIntro = useCallback(() => { setIntro(false); setEntering(true); setTimeout(() => setEntering(false), 1100); }, []);
  const introEl = intro ? <Intro storeName={cur ? cur.name : ''} onDone={endIntro} /> : null;
  const [customizingState, setCustomizingState] = useState(false);
  const customizing = controlled ? route.page === 'editor' : customizingState;
  const setCustomizing = useCallback(on => { if (onRouteRef.current) onRouteRef.current(on ? { page: 'editor' } : { page: 'themes' }); else setCustomizingState(on); }, []);
  const [toast, setToast] = useState('');
  const [navOpen, setNavOpen] = useState(false);
  const [theme, setTheme] = useState(loadTheme);
  const toggleTheme = useCallback(() => setTheme(t => { const n = t === 'dark' ? 'light' : 'dark'; try { localStorage.setItem(THEME_KEY, n); } catch { /* storage unavailable */ } return n; }), []);
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const toggleCollapsed = useCallback(() => setCollapsed(v => { try { localStorage.setItem(COLLAPSE_KEY, v ? '0' : '1'); } catch { /* storage unavailable */ } return !v; }), []);
  const [openGroups, setOpenGroups] = useState({});
  const [help, setHelp] = useState(false);
  const [confirmEl, confirm] = useConfirm();
  const toastT = useRef(0);
  const notify = useCallback(msg => { setToast(msg); clearTimeout(toastT.current); toastT.current = setTimeout(() => setToast(''), 4200); }, []);
  const resolver = useMemo(() => createImageResolver(assetStore, () => bump()), [assetStore]);
  const imageUrl = useCallback(ref => resolver.url(ref), [resolver]);
  const upload = useCallback(file => uploadImage(file, assetStore), [assetStore]);
  const fmt = useMoney(cur);
  const main = useRef(null);
  const go = useCallback(r => { const next = typeof r === 'string' ? { page: r } : r; if (onRouteRef.current) onRouteRef.current(next); else setRoute(next); setNavOpen(false); if (main.current) main.current.scrollTop = 0; }, []);

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
    const html = trackedPreviewHtml(previewShellHtml(S.current, imageUrl, { commerce: K.current }), S.current.id);
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
        const r = createOrder(S.current, c, { lines, customerId: ec.customer?.id || null, email: m.order.customer.email, phone: m.order.customer.phone, shippingAddress: { name: m.order.customer.name, address1: m.order.customer.address, country: m.order.country || '', province: m.order.region || '' }, codes: m.order.codes || [], shippingRateId: m.order.rateId || undefined, note: m.order.customer.notes, source: 'preview', sessionId: m.order.sessionId });
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
      const cmdK = (e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey;
      if ((cmdK || (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey)) && !document.querySelector('.caModal')) { e.preventDefault(); e.stopPropagation(); searchRef.current?.focus(); searchRef.current?.select(); setQOpen(true); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [customizing, intro]);

  // ---------- no store yet: pick a template first ----------
  if (!cur) return <div className="caRoot caPicker stRoot">{sectionBar && <div className="caPickerBar">{sectionBar}</div>}<Gallery onPick={id => commit(createStore(id), null, 'Create store')} onCancel={onExit} cancelLabel="Exit commerce" />{introEl}</div>;
  if (customizing) return <StoreBuilder store={cur} commerce={com} onChange={(s, label) => commit(s, K.current && !K.current.onboarding.steps.theme ? markTheme(K.current) : null, label)} onExit={() => setCustomizing(false)} onOpenPhotoStudio={onOpenPhotoStudio} assetStore={assetStore} />;

  const ctx = { store: cur, commerce: com, commit, editStore, editCommerce, run, fmt, imageUrl, upload, resolver, notify, confirm, go, route, assetStore, onOpenPhotoStudio, customize: () => { if (!K.current.onboarding.steps.theme) commit(null, markTheme(K.current), 'Theme customized'); setCustomizing(true); }, viewStore };
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

  const sectionEntry = NAV.find(n => n[0] === section);
  const subPages = sectionEntry && sectionEntry[3];
  const subOn = k => route.page === k || (k === 'products' && route.page === 'product') || (k === 'collections' && route.page === 'collection');
  const initial = (cur.name || 'S').trim().charAt(0).toUpperCase();
  const topPlan = plan === 'pro';
  const navItem = ([key, label, Icon, subs]) => {
    const open = !collapsed && subs && (openGroups[key] ?? section === key);
    return <li key={key} className={subs ? 'caGroup' + (open ? ' open' : '') : undefined}>
      <div className="caNavRow">
        <button type="button" className={'caNavItem' + (section === key ? ' on' : '')} aria-current={route.page === key ? 'page' : undefined} aria-describedby={key === 'orders' && toFulfill > 0 ? 'caToFulfill' : undefined}
          onClick={() => { go(key); if (subs) setOpenGroups(g => ({ ...g, [key]: true })); }}>
          <Icon size={18} aria-hidden="true" /><span className="caNavLabel">{label}</span>{key === 'orders' && toFulfill > 0 && <span className="caNavBadge" aria-hidden="true">{toFulfill}</span>}
        </button>
        {subs && !collapsed && <button type="button" className="caNavCaret" aria-label={(open ? 'Hide ' : 'Show ') + label + ' pages'} aria-expanded={!!open} onClick={() => setOpenGroups(g => ({ ...g, [key]: !open }))}><ChevronDown size={15} aria-hidden="true" /></button>}
      </div>
      {open && <ul className="caSubNav">{subs.map(([k, l]) => <li key={k}><button type="button" className={'caNavSub' + (subOn(k) ? ' on' : '')} aria-current={route.page === k ? 'page' : undefined} onClick={() => go(k)}>{l}</button></li>)}</ul>}
    </li>;
  };

  return <AdminCtx.Provider value={ctx}>
    <div className={'caRoot caShell' + (collapsed ? ' collapsed' : '') + (entering ? ' caEnter' : '')} data-theme={theme}>
      <nav className={'caNav' + (navOpen ? ' open' : '')} aria-label="Commerce">
        <div className="caSide">
          <div className="caSideHead">
            <span className="caLogo" aria-hidden="true">Z</span>
            <div className="caBrand"><span className="caBrandEyebrow">Zertake Commerce</span>{storeSwitcher || <strong>{cur.name}</strong>}</div>
            <button type="button" className="caIconBtn caCollapse" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={toggleCollapsed}>{collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}</button>
          </div>
          <div className="caSideScroll">
            <ul className="caRail">{NAV_MAIN.map(navItem)}</ul>
            <div className="caRailSep"><span>Growth</span></div>
            <ul className="caRail">{NAV_MORE.map(navItem)}</ul>
          </div>
          <div className="caSideFoot">
            <ul className="caRail">
              <li><div className="caNavRow"><button type="button" className={'caNavItem' + (section === 'settings' ? ' on' : '')} aria-current={route.page === 'settings' ? 'page' : undefined} onClick={() => go({ page: 'settings', tab: 'general' })}><SettingsIcon size={18} aria-hidden="true" /><span className="caNavLabel">Settings</span></button></div></li>
              <li><div className="caNavRow"><button type="button" className="caNavItem" onClick={() => setHelp(true)}><LifeBuoy size={18} aria-hidden="true" /><span className="caNavLabel">Help &amp; Support</span></button></div></li>
              {onExit && <li><div className="caNavRow"><button type="button" className="caNavItem caExit" aria-label="Exit commerce" onClick={onExit}><LogOut size={18} aria-hidden="true" /><span className="caNavLabel" aria-hidden="true">Exit commerce</span></button></div></li>}
            </ul>
            {onUpgrade && (topPlan
              ? <div className="caPlanCard pro"><Crown size={16} aria-hidden="true" /><span className="caPlanText"><strong>You’re on Pro</strong><small>Every feature, up to 10 stores.</small></span></div>
              : collapsed
                ? <button type="button" className="caIconBtn caUpgradeMini" aria-label="Upgrade plan" title="Upgrade plan" onClick={onUpgrade}><Sparkles size={17} /></button>
                : <div className="caUpgrade">
                  <span className="caUpgradeIcon" aria-hidden="true"><Sparkles size={16} /></span>
                  <strong>Upgrade to Premium!</strong>
                  <p>Upgrade your account and unlock all of the benefits.</p>
                  <button type="button" className="caUpgradeBtn" onClick={onUpgrade}>Upgrade plan</button>
                </div>)}
          </div>
          {toFulfill > 0 && <span id="caToFulfill" hidden>{toFulfill} to fulfill</span>}
        </div>
        {collapsed && subPages && <div className="caTabs">
          {subPages.map(([k, l]) => <button key={k} type="button" className={'caNavSub' + (subOn(k) ? ' on' : '')} aria-current={route.page === k ? 'page' : undefined} onClick={() => go(k)}>{l}</button>)}
        </div>}
      </nav>
      {navOpen && <div className="caScrim" aria-hidden="true" onClick={() => setNavOpen(false)} />}
      <header className="caTop">
        <button type="button" className="caIconBtn caNavToggle" aria-label="Toggle navigation" aria-expanded={navOpen} onClick={() => setNavOpen(v => !v)}><Menu size={18} /></button>
        <div className="caSearch" role="search">
          <Search size={16} aria-hidden="true" className="caSearchIcon" />
          <input ref={searchRef} type="search" aria-label="Search orders, products and customers" placeholder="Search anything…" value={q}
            role="combobox" aria-expanded={qOpen && results.length > 0} aria-controls="caSearchList" aria-autocomplete="list" aria-keyshortcuts="Control+K Meta+K /"
            onChange={e => { setQ(e.target.value); setQOpen(true); setQi(0); }} onFocus={() => setQOpen(true)} onBlur={() => setTimeout(() => setQOpen(false), 150)}
            onKeyDown={e => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setQi(i => Math.min(results.length - 1, i + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setQi(i => Math.max(0, i - 1)); }
              else if (e.key === 'Enter' && results[qi]) { e.preventDefault(); pickResult(results[qi]); }
              else if (e.key === 'Escape') { e.stopPropagation(); setQOpen(false); e.target.blur(); }
            }} />
          <kbd className="caKbd" aria-hidden="true">{isMac() ? '⌘K' : 'Ctrl K'}</kbd>
          {qOpen && q.trim() && <ul className="caSearchList" id="caSearchList" role="listbox" aria-label="Search results">
            {results.length ? results.map((r, i) => <li key={r.kind + r.route.id} role="option" aria-selected={i === qi} className={i === qi ? 'on' : ''} onMouseDown={e => { e.preventDefault(); pickResult(r); }}>
              <span className="caSearchKind">{r.kind}</span><strong>{r.label}</strong><small>{r.sub}</small></li>) : <li className="caSearchNone">No results for “{q.trim()}”</li>}
          </ul>}
        </div>
        {sectionBar && <div className="caSections">{sectionBar}</div>}
        <div className="caTopTools">
          <button type="button" className="caIconBtn caRound" aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} title={theme === 'dark' ? 'Light theme' : 'Dark theme'} onClick={toggleTheme}>{theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}</button>
          <button type="button" className="caIconBtn caRound caBell" aria-label={toFulfill ? `${toFulfill} ${toFulfill === 1 ? 'order' : 'orders'} to fulfill` : 'No orders to fulfill'} title="Orders to fulfill" onClick={() => go('orders')}><Bell size={17} />{toFulfill > 0 && <i aria-hidden="true" />}</button>
          <button type="button" className="caBtn caViewStore" onClick={viewStore}><ExternalLink size={14} aria-hidden="true" />View store</button>
          <button type="button" className="caAvatar" title={cur.name + ' · store settings'} aria-label="Store settings" onClick={() => go({ page: 'settings', tab: 'general' })}>{initial}</button>
        </div>
      </header>
      <main className="caMain" ref={main} aria-label="Commerce content">{page}</main>
      <div className="caToast" role="status" aria-live="polite">{toast && <span>{toast}</span>}</div>
      {help && <HelpDialog onClose={() => setHelp(false)} go={r => { setHelp(false); go(r); }} />}
      {confirmEl}
      {introEl}
    </div>
  </AdminCtx.Provider>;
}

function HelpDialog({ onClose, go }) {
  const mod = isMac() ? '⌘' : 'Ctrl';
  return <Modal title="Help & Support" onClose={onClose} footer={<Btn kind="primary" onClick={onClose}>Done</Btn>}>
    <p className="caText">Zertake Commerce runs entirely in your browser: products, orders and settings are saved on this device and the store is exported as a static site.</p>
    <div className="caHelpGrid">
      <section><h3><Keyboard size={14} aria-hidden="true" />Keyboard shortcuts</h3>
        <dl className="caKeys"><dt><kbd>{mod}</kbd><kbd>K</kbd> or <kbd>/</kbd></dt><dd>Search orders, products and customers</dd><dt><kbd>Esc</kbd></dt><dd>Close dialogs and search</dd></dl></section>
      <section><h3><LifeBuoy size={14} aria-hidden="true" />Common tasks</h3>
        <ul className="caHelpLinks">
          <li><button type="button" className="caLink" onClick={() => go('home')}>Finish the setup guide</button></li>
          <li><button type="button" className="caLink" onClick={() => go({ page: 'settings', tab: 'payments' })}>Choose how customers check out</button></li>
          <li><button type="button" className="caLink" onClick={() => go({ page: 'settings', tab: 'shipping' })}>Shipping zones and rates</button></li>
          <li><button type="button" className="caLink" onClick={() => go({ page: 'settings', tab: 'domains' })}>Connect your domain</button></li>
          <li><button type="button" className="caLink" onClick={() => go('analytics')}>Collect live orders with a backend</button></li>
        </ul></section>
    </div>
  </Modal>;
}
