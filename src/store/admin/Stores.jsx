// Multi-store layer around CommerceApp: URL routing per store, first-time setup wizard, store switcher,
// "All stores" page and the account plan (Starter 1 · Growth 3 · Pro 10 stores; no billing, a local setting).
//
// <CommerceShell> props:
//   stores, activeStoreId, plan        workspace data (see ./stores.js)
//   route                              commerce route from the URL (src/routes.js): { view: 'auto'|'new'|'stores'|'store', handle?, page?, id?, tab? }
//   navigate(route, { replace })       change the commerce URL
//   update(fn)                         fn(workspace) → next workspace (stores / activeStoreId / plan)
//   sectionBar, intro, assetStore, onExit, onOpenPhotoStudio   passed to CommerceApp
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, ChevronsUpDown, Plus, LayoutGrid, Store as StoreIcon, Pencil, Trash2, Sparkles, Lock, Sun, Moon, LogOut } from 'lucide-react';
import CommerceApp from './CommerceApp.jsx';
import Intro from './Intro.jsx';
import Gallery from '../Gallery.jsx';
import { STORE_TEMPLATES, TEMPLATE_CATEGORIES, createStore } from '../templates.js';
import { PLANS, planFor, canCreateStore, storeLimit, planForCount } from './plans.js';
import { storeEntry, findStore, renameStore, removeStore, updateStoreEntry } from './stores.js';
import { adminRoute, slugify } from '../../routes.js';
import { Modal, useConfirm } from './ui.jsx';

const THEME_KEY = 'zertake.commerceTheme';
const readTheme = () => { try { return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'; } catch { return 'light'; } };
function useTheme() {
  const [theme, setTheme] = useState(readTheme);
  const toggle = useCallback(() => setTheme(t => { const n = t === 'dark' ? 'light' : 'dark'; try { localStorage.setItem(THEME_KEY, n); } catch { /* storage unavailable */ } return n; }), []);
  return [theme, toggle];
}
export const CURRENCIES = [
  ['USD', 'en-US', 'US dollar'], ['EUR', 'de-DE', 'Euro'], ['GBP', 'en-GB', 'British pound'], ['CAD', 'en-CA', 'Canadian dollar'], ['AUD', 'en-AU', 'Australian dollar'],
  ['JPY', 'ja-JP', 'Japanese yen'], ['INR', 'en-IN', 'Indian rupee'], ['BRL', 'pt-BR', 'Brazilian real'], ['MXN', 'es-MX', 'Mexican peso'], ['CHF', 'de-CH', 'Swiss franc'],
  ['SEK', 'sv-SE', 'Swedish krona'], ['NZD', 'en-NZ', 'New Zealand dollar'], ['SGD', 'en-SG', 'Singapore dollar'], ['ZAR', 'en-ZA', 'South African rand'],
];
const templateOf = s => STORE_TEMPLATES.find(t => t.id === (s && s.templateId)) || null;
const countOrders = c => (c && Array.isArray(c.orders) ? c.orders.filter(o => !o.draft).length : 0);
const initialOf = name => (String(name || 'S').trim().charAt(0) || 'S').toUpperCase();

/** Small storefront mock in a template's colours (used as the store card thumbnail). */
function StoreMock({ store, size = 'lg' }) {
  const t = templateOf(store), [bg, fg, ac] = t ? t.swatch : ['#f4f1ea', '#1c1c1a', '#5b7d64'];
  return <div className={'zsMock ' + size} style={{ '--m-bg': bg, '--m-fg': fg, '--m-ac': ac }} aria-hidden="true">
    <div className="zsMockBar"><b>{store.name}</b><i /><i /><i /></div>
    <div className="zsMockHero"><span /><span /><em /></div>
    <div className="zsMockGrid"><i /><i /><i /><i /></div>
  </div>;
}

function StoreDot({ store }) {
  const t = templateOf(store), [bg, fg, ac] = t ? t.swatch : ['#e3ece4', '#1c1c1a', '#5b7d64'];
  return <span className="zsDot" style={{ background: `linear-gradient(135deg, ${ac}, ${fg})`, color: bg }} aria-hidden="true">{initialOf(store.name)}</span>;
}

// ---------------------------------------------------------------- plan
function PlanPicker({ plan, count, onPlan }) {
  return <div className="zsPlans" role="radiogroup" aria-label="Plan">
    {PLANS.map(p => {
      const on = p.id === plan, over = count > p.stores;
      return <button key={p.id} type="button" role="radio" aria-checked={on} className={'zsPlan' + (on ? ' on' : '')} onClick={() => onPlan(p.id)}>
        <span className="zsPlanTop"><strong>{p.name}</strong>{on && <span className="zsPill">Current</span>}</span>
        <span className="zsPlanBig">{p.stores}<small>{p.stores === 1 ? ' store' : ' stores'}</small></span>
        <span className="zsPlanBlurb">{p.blurb}</span>
        {over && <span className="zsPlanWarn">You have {count} stores — existing stores stay, new ones are blocked.</span>}
      </button>;
    })}
  </div>;
}
const BILLING_NOTE = 'Billing isn’t connected yet — the plan is a local setting on this device and nothing is charged.';

function LimitNote({ plan, count, onUpgrade, compact }) {
  const p = planFor(plan), next = planForCount(count + 1);
  return <div className={'zsLimit' + (compact ? ' compact' : '')} role="note">
    <Lock size={compact ? 13 : 16} aria-hidden="true" />
    <span>Your <b>{p.name}</b> plan includes {p.stores} {p.stores === 1 ? 'store' : 'stores'} and you’re using {count}.{next ? ` Upgrade to ${next.name} for up to ${next.stores}.` : ''}</span>
    {onUpgrade && next && <button type="button" className="caBtn caPrimary zsUpgrade" onClick={onUpgrade}><Sparkles size={13} aria-hidden="true" />Upgrade plan</button>}
  </div>;
}

// ---------------------------------------------------------------- store switcher (header dropdown)
export function StoreSwitcher({ stores, activeId, plan, onOpen, onNew, onAll }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const active = stores.find(s => s.id === activeId) || stores[0];
  const can = canCreateStore(plan, stores.length);
  useEffect(() => {
    if (!open) return;
    const down = e => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const key = e => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); box.current?.querySelector('.zsSwitchBtn')?.focus(); } };
    document.addEventListener('mousedown', down); window.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('mousedown', down); window.removeEventListener('keydown', key, true); };
  }, [open]);
  const pick = fn => () => { setOpen(false); fn(); };
  return <div className="zsSwitch" ref={box}>
    <button type="button" className="zsSwitchBtn" aria-haspopup="true" aria-expanded={open} aria-label={'Store: ' + active.store.name + '. Switch store'} onClick={() => setOpen(v => !v)}>
      <strong>{active.store.name}</strong><ChevronsUpDown size={16} aria-hidden="true" />
    </button>
    {open && <div className="zsMenu" role="dialog" aria-label="Switch store">
      <p className="zsMenuHead">Your stores <span>{stores.length} of {storeLimit(plan)} · {planFor(plan).name}</span></p>
      <ul className="zsMenuList">
        {stores.map(e => { const t = templateOf(e.store), on = e.id === active.id; return <li key={e.id}>
          <button type="button" className={'zsMenuItem' + (on ? ' on' : '')} aria-current={on ? 'true' : undefined} onClick={pick(() => onOpen(e))}>
            <StoreDot store={e.store} /><span className="zsMenuText"><strong>{e.store.name}</strong><small>{t ? t.name + ' template' : 'Custom'} · /{e.handle}</small></span>{on && <Check size={15} aria-label="Active store" />}
          </button></li>; })}
      </ul>
      <div className="zsMenuFoot">
        <button type="button" className="zsMenuItem" disabled={!can} onClick={pick(onNew)} aria-describedby={can ? undefined : 'zsLimitMsg'}><span className="zsMenuIcon"><Plus size={15} aria-hidden="true" /></span><span className="zsMenuText"><strong>New store</strong></span>{!can && <Lock size={13} aria-hidden="true" />}</button>
        {!can && <p className="zsMenuLimit" id="zsLimitMsg">{planFor(plan).name} plan: {stores.length} of {storeLimit(plan)} {storeLimit(plan) === 1 ? 'store' : 'stores'} used. <button type="button" className="zsLinkBtn" onClick={pick(() => onAll(true))}>Upgrade plan</button></p>}
        <button type="button" className="zsMenuItem" onClick={pick(() => onAll(false))}><span className="zsMenuIcon"><LayoutGrid size={15} aria-hidden="true" /></span><span className="zsMenuText"><strong>All stores</strong></span></button>
      </div>
    </div>}
  </div>;
}

// ---------------------------------------------------------------- top bar used by the wizard and All stores
function ShellTop({ sectionBar, theme, onTheme, children, onExit }) {
  return <header className="zsTop">
    <div className="zsBrand"><span className="caLogo zsLogo" aria-hidden="true">Z</span><span><small>Zertake</small><strong>Commerce</strong></span></div>
    {sectionBar && <div className="caSections">{sectionBar}</div>}
    <div className="zsTopTools">
      {children}
      <button type="button" className="caIconBtn caRound" aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} onClick={onTheme}>{theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}</button>
      {onExit && <button type="button" className="caIconBtn caRound" aria-label="Exit commerce" title="Exit commerce" onClick={onExit}><LogOut size={17} /></button>}
    </div>
  </header>;
}

// ---------------------------------------------------------------- setup wizard
export function SetupWizard({ stores, plan, onPlan, onCreate, onCancel, sectionBar, onExit }) {
  const [theme, toggleTheme] = useTheme();
  const first = !stores.length;
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [niche, setNiche] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [touched, setTouched] = useState(false);
  const [showPlans, setShowPlans] = useState(false);
  const can = canCreateStore(plan, stores.length);
  const handle = useMemo(() => { const taken = new Set(stores.map(s => s.handle)); let h = slugify(name || 'your-store'), n = 2; const b = h; while (taken.has(h)) h = b + '-' + n++; return h; }, [name, stores]);
  const nameOk = name.trim().length > 0;
  const next = e => { e.preventDefault(); setTouched(true); if (nameOk) setStep(2); };
  const pick = id => {
    const s = createStore(id), cur = CURRENCIES.find(c => c[0] === currency);
    s.name = name.trim(); s.logo = { ...(s.logo || {}), text: name.trim() };
    if (cur) s.currency = { code: cur[0], locale: cur[1] };
    onCreate(s);
  };

  if (!can) return <div className="caRoot zsRoot zsWizard" data-theme={theme}>
    <ShellTop sectionBar={sectionBar} theme={theme} onTheme={toggleTheme} onExit={onExit} />
    <main className="zsCenter" aria-label="New store">
      <section className="zsCard zsLimitCard">
        <span className="zsBadgeIcon"><Lock size={22} aria-hidden="true" /></span>
        <h1>You’ve reached your store limit</h1>
        <LimitNote plan={plan} count={stores.length} onUpgrade={() => setShowPlans(true)} />
        {showPlans && <><PlanPicker plan={plan} count={stores.length} onPlan={onPlan} /><p className="zsNote">{BILLING_NOTE}</p></>}
        {onCancel && <button type="button" className="caBtn zsGhost" onClick={onCancel}><ArrowLeft size={14} aria-hidden="true" />Back to your stores</button>}
      </section>
    </main>
  </div>;

  if (step === 2) return <div className="caRoot zsRoot zsWizard zsStep2" data-theme={theme}>
    <header className="zsStepBar">
      <button type="button" className="caBtn zsGhost" onClick={() => setStep(1)}><ArrowLeft size={14} aria-hidden="true" />Back</button>
      <div className="zsStepInfo"><span className="zsStepNum">Step 2 of 2</span><strong>Pick a template for <em>{name.trim()}</em></strong></div>
      <ol className="zsDots" aria-hidden="true"><li className="done" /><li className="on" /></ol>
    </header>
    <div className="zsGalleryWrap stRoot"><Gallery onPick={pick} initialCategory={niche || undefined} /></div>
  </div>;

  return <div className="caRoot zsRoot zsWizard" data-theme={theme}>
    <ShellTop sectionBar={sectionBar} theme={theme} onTheme={toggleTheme} onExit={onExit} />
    <main className="zsCenter" aria-label={first ? 'Create your store' : 'New store'}>
      <form className="zsCard zsSetup" onSubmit={next} noValidate>
        <aside className="zsSetupArt">
          <span className="zsStepNum light">Step 1 of 2</span>
          <h1>{first ? 'Create your store' : 'Create another store'}</h1>
          <p>{first ? `Name your shop, then pick one of ${STORE_TEMPLATES.length} complete templates. You can change everything later.` : 'Each store has its own products, orders, customers, theme and settings.'}</p>
          <ul className="zsPerks">
            <li><Check size={14} aria-hidden="true" />Multi-page storefront with sample products</li>
            <li><Check size={14} aria-hidden="true" />Orders, inventory, customers and discounts</li>
            <li><Check size={14} aria-hidden="true" />Analytics, marketing and a visual editor</li>
          </ul>
          <div className="zsArtShapes" aria-hidden="true"><i /><i /><i /></div>
        </aside>
        <div className="zsSetupForm">
          <label className="caField"><span className="caLabel">Store name</span>
            <input className={'caInput zsBig' + (touched && !nameOk ? ' bad' : '')} autoFocus value={name} maxLength={60} placeholder="e.g. Ironclad" aria-label="Store name" aria-invalid={touched && !nameOk} onChange={e => setName(e.target.value)} />
            {touched && !nameOk ? <span className="zsErr" role="alert">Give your store a name to continue.</span> : <span className="caHint zsUrl">{(typeof location !== 'undefined' ? location.host : '') + '/commerce/'}<b>{handle}</b></span>}
          </label>
          <fieldset className="zsChips">
            <legend className="caLabel">What will you sell? <span className="caMuted">Optional · filters the templates</span></legend>
            {TEMPLATE_CATEGORIES.map(c => <button key={c} type="button" className={'zsChip' + (niche === c ? ' on' : '')} aria-pressed={niche === c} onClick={() => setNiche(n => n === c ? '' : c)}>{c}</button>)}
          </fieldset>
          <label className="caField"><span className="caLabel">Currency</span>
            <select className="caInput" aria-label="Currency" value={currency} onChange={e => setCurrency(e.target.value)}>
              {CURRENCIES.map(([code, , label]) => <option key={code} value={code}>{code} — {label}</option>)}
            </select>
          </label>
          <div className="zsActions">
            {onCancel && <button type="button" className="caBtn zsGhost" onClick={onCancel}>Cancel</button>}
            <span className="zsPlanNote">{planFor(plan).name} plan · {stores.length + 1} of {storeLimit(plan)}</span>
            <button type="submit" className="caBtn caPrimary zsNext">Continue<ArrowRight size={15} aria-hidden="true" /></button>
          </div>
        </div>
      </form>
    </main>
  </div>;
}

// ---------------------------------------------------------------- all stores
export function AllStores({ stores, activeStoreId, plan, onPlan, onOpen, onNew, onRename, onDelete, onBack, sectionBar, onExit, focusPlan }) {
  const [theme, toggleTheme] = useTheme();
  const [confirmEl, confirm] = useConfirm();
  const [renaming, setRenaming] = useState(null);
  const can = canCreateStore(plan, stores.length);
  const planRef = useRef(null);
  useEffect(() => { if (focusPlan && planRef.current) planRef.current.scrollIntoView({ block: 'start' }); }, [focusPlan]);
  const active = stores.find(s => s.id === activeStoreId);
  const del = async e => {
    const ok = await confirm({ title: 'Delete ' + e.store.name + '?', danger: true, confirmLabel: 'Delete store', message: `This permanently removes ${e.store.name} with its ${e.store.products?.length || 0} products, ${countOrders(e.commerce)} orders, customers and settings from this device. This can’t be undone.` });
    if (ok) onDelete(e);
  };
  return <div className="caRoot zsRoot zsAll" data-theme={theme}>
    <ShellTop sectionBar={sectionBar} theme={theme} onTheme={toggleTheme} onExit={onExit}>
      {active && <button type="button" className="caBtn zsGhost zsBackBtn" onClick={onBack}><ArrowLeft size={14} aria-hidden="true" /><span>Back to {active.store.name}</span></button>}
    </ShellTop>
    <main className="zsAllMain" aria-label="All stores">
      <div className="zsAllHead">
        <div><h1>Your stores</h1><p>{stores.length} of {storeLimit(plan)} {storeLimit(plan) === 1 ? 'store' : 'stores'} on the <b>{planFor(plan).name}</b> plan</p></div>
        <button type="button" className="caBtn caPrimary" disabled={!can} onClick={onNew} aria-describedby={can ? undefined : 'zsAllLimit'}><Plus size={15} aria-hidden="true" />New store</button>
      </div>
      {!can && <div id="zsAllLimit"><LimitNote plan={plan} count={stores.length} onUpgrade={() => planRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })} /></div>}
      <ul className="zsStoreGrid">
        {stores.map(e => { const t = templateOf(e.store), on = e.id === activeStoreId; return <li key={e.id} className={'zsStoreCard' + (on ? ' on' : '')}>
          <button type="button" className="zsStoreThumb" onClick={() => onOpen(e)} aria-label={'Open ' + e.store.name} tabIndex={-1}><StoreMock store={e.store} /></button>
          <div className="zsStoreInfo">
            <div className="zsStoreTitle"><h2>{e.store.name}</h2>{on && <span className="zsPill">Active</span>}</div>
            <p className="zsStoreSub">{t ? t.name + ' template' : 'Custom'} · <span className="zsMono">/commerce/{e.handle}</span></p>
            <dl className="zsStats"><div><dt>Products</dt><dd>{e.store.products?.length || 0}</dd></div><div><dt>Orders</dt><dd>{countOrders(e.commerce)}</dd></div><div><dt>Currency</dt><dd>{e.store.currency?.code || 'USD'}</dd></div></dl>
            <div className="zsStoreActions">
              <button type="button" className="caBtn caPrimary" onClick={() => onOpen(e)} aria-label={'Open ' + e.store.name + ' admin'}>Open<ArrowRight size={14} aria-hidden="true" /></button>
              <button type="button" className="caBtn" onClick={() => setRenaming({ id: e.id, name: e.store.name })} aria-label={'Rename ' + e.store.name}><Pencil size={13} aria-hidden="true" />Rename</button>
              <button type="button" className="caBtn caDanger zsIcon" onClick={() => del(e)} aria-label={'Delete ' + e.store.name} title="Delete store"><Trash2 size={14} aria-hidden="true" /></button>
            </div>
          </div>
        </li>; })}
        {can && <li className="zsStoreCard zsAdd"><button type="button" onClick={onNew}><span className="zsAddIcon"><Plus size={22} aria-hidden="true" /></span><strong>New store</strong><small>{storeLimit(plan) - stores.length} more on {planFor(plan).name}</small></button></li>}
      </ul>
      <section className="zsCard zsPlanCard" ref={planRef} aria-labelledby="zsPlanTitle">
        <div className="zsPlanHead"><h2 id="zsPlanTitle">Plan</h2><p>Pick how many stores this workspace can run.</p></div>
        <PlanPicker plan={plan} count={stores.length} onPlan={onPlan} />
        <p className="zsNote"><Lock size={12} aria-hidden="true" />{BILLING_NOTE}</p>
      </section>
    </main>
    {renaming && <Modal title="Rename store" onClose={() => setRenaming(null)} footer={<>
      <button type="button" className="caBtn" onClick={() => setRenaming(null)}>Cancel</button>
      <button type="button" className="caBtn caPrimary" disabled={!renaming.name.trim()} onClick={() => { onRename(renaming.id, renaming.name); setRenaming(null); }}>Save</button></>}>
      <label className="caField"><span className="caLabel">Store name</span><input className="caInput" aria-label="New store name" value={renaming.name} onChange={e => setRenaming({ ...renaming, name: e.target.value })} onKeyDown={e => { if (e.key === 'Enter' && renaming.name.trim()) { onRename(renaming.id, renaming.name); setRenaming(null); } }} /></label>
      <p className="caHint">The store’s address changes to /commerce/{slugify(renaming.name)}.</p>
    </Modal>}
    {confirmEl}
  </div>;
}

function NotFound({ handle, onAll, sectionBar, onExit }) {
  const [theme, toggleTheme] = useTheme();
  return <div className="caRoot zsRoot" data-theme={theme}>
    <ShellTop sectionBar={sectionBar} theme={theme} onTheme={toggleTheme} onExit={onExit} />
    <main className="zsCenter" aria-label="Store not found"><section className="zsCard zsLimitCard">
      <span className="zsBadgeIcon"><StoreIcon size={22} aria-hidden="true" /></span>
      <h1>No store at /{handle}</h1><p className="caMuted">It may have been renamed or deleted.</p>
      <button type="button" className="caBtn caPrimary" onClick={onAll}><LayoutGrid size={14} aria-hidden="true" />All stores</button>
    </section></main>
  </div>;
}

// ---------------------------------------------------------------- shell
export default function CommerceShell({ stores = [], activeStoreId, plan, route, navigate, update, sectionBar, intro, assetStore, onExit, onOpenPhotoStudio }) {
  const view = route && route.view || 'auto';
  const entry = view === 'store' ? findStore(stores, route.handle) : null;
  const active = findStore(stores, activeStoreId) || stores[0] || null;
  const introNext = useRef(intro);
  const [focusPlan, setFocusPlan] = useState(false);
  const [, setIntroShown] = useState(0); // re-render once the wizard's entrance animation is over
  const toStore = useCallback((e, page = { page: 'home' }, opts) => navigate({ view: 'store', handle: e.handle, ...page }, opts), [navigate]);

  // /commerce → active store (or the setup wizard); unknown handle with no stores → wizard
  useEffect(() => {
    if (view === 'auto') { if (active) toStore(active, undefined, { replace: true }); else navigate({ view: 'new' }, { replace: true }); }
    else if (view === 'store' && !entry && !stores.length) navigate({ view: 'new' }, { replace: true });
    else if (view === 'stores' && !stores.length) navigate({ view: 'new' }, { replace: true });
  }, [view, entry, active, stores.length]); // eslint-disable-line react-hooks/exhaustive-deps
  // opening a store makes it the active one
  useEffect(() => { if (entry && entry.id !== activeStoreId) update(ws => ({ ...ws, activeStoreId: entry.id })); }, [entry && entry.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // the entrance animation plays for the first store opened in this visit (and for a newly created store), not on switches
  useEffect(() => { if (entry) introNext.current = false; }, [entry && entry.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const onPlan = useCallback(id => update(ws => ({ ...ws, plan: id })), [update]);
  const onNew = useCallback(() => navigate({ view: 'new' }), [navigate]);
  const onAll = useCallback(upgrade => { setFocusPlan(!!upgrade); navigate({ view: 'stores' }); }, [navigate]);

  // the entrance animation also plays when the first screen is the setup wizard (no store yet)
  const wizardIntro = introNext.current && <Intro onDone={() => { introNext.current = false; setIntroShown(n => n + 1); }} />;
  if (view === 'new') return <>{wizardIntro}<SetupWizard stores={stores} plan={plan} onPlan={onPlan} sectionBar={sectionBar} onExit={onExit}
    onCancel={stores.length ? () => (active ? toStore(active) : navigate({ view: 'stores' })) : null}
    onCreate={store => {
      const e = storeEntry(store, { stores });
      introNext.current = true;
      update(ws => ({ ...ws, stores: [...(ws.stores || []), e], activeStoreId: e.id }));
      toStore(e, undefined, { replace: true });
    }} /></>;
  if (view === 'stores') return <AllStores stores={stores} activeStoreId={active && active.id} plan={plan} onPlan={onPlan} sectionBar={sectionBar} onExit={onExit} focusPlan={focusPlan}
    onOpen={e => toStore(e)} onNew={onNew} onBack={() => active && toStore(active)}
    onRename={(id, name) => update(ws => renameStore(ws, id, name))}
    onDelete={e => update(ws => removeStore(ws, e.id))} />;
  if (view === 'store' && !entry) return stores.length ? <NotFound handle={route.handle} sectionBar={sectionBar} onExit={onExit} onAll={() => navigate({ view: 'stores' })} /> : null;
  if (!entry) return null;

  const switcher = <StoreSwitcher stores={stores} activeId={entry.id} plan={plan} onOpen={e => toStore(e)} onNew={onNew} onAll={onAll} />;
  const id = entry.id;
  return <CommerceApp key={id} store={entry.store} commerce={entry.commerce} assetStore={assetStore} sectionBar={sectionBar} intro={introNext.current}
    storeSwitcher={switcher} onExit={onExit} onOpenPhotoStudio={onOpenPhotoStudio} plan={plan} onUpgrade={() => onAll(true)}
    route={adminRoute(route)}
    onRoute={r => { const cur = adminRoute(route); toStore(entry, r, { replace: cur.id === 'new' && r.page === cur.page && r.id && r.id !== 'new' }); }}
    onChange={doc => update(ws => updateStoreEntry(ws, id, { store: doc }))}
    onCommerceChange={doc => update(ws => updateStoreEntry(ws, id, { commerce: doc }))} />;
}
