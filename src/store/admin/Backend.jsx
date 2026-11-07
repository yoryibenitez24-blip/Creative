// Backend session UI for the commerce admin: sign-in (magic link / one-time code / password), the header status chip,
// "Publish catalog to backend" + the auto-sync indicator, and "Sync orders from backend" (+ the 60 s auto-poll).
// State and pure helpers: src/store/admin/backendSync.js. The session never enters the commerce document.
import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import { Cloud, CloudOff, CloudUpload, CloudDownload, RefreshCw, LogOut, Mail, KeyRound, Hash } from 'lucide-react';
import { useAdmin, Btn, Modal, Segmented, Text } from './ui.jsx';
import { backendReady, functionsBase } from '../integrations.js';
import { catalogSnapshot } from '../commerce.js';
import { subscribe, sessionVersion, backendClient, syncRecord, saveSyncRecord, findSecrets, fingerprint, syncLabel, importBackendRecords, importSummary, takeRedirectResult, ago } from './backendSync.js';

export const AUTO_SYNC_DELAY = 2000, ORDERS_POLL_MS = 60_000;
const POLL_KEY = 'zertake.ordersAutoSync';
const cfgOf = c => { const b = c?.settings?.integrations?.backend; return b && backendReady(c) ? { url: b.url, anonKey: b.anonKey, functionsUrl: functionsBase(c) } : null; };
/** The shared client for a commerce document's backend (null when none is configured). */
export const clientFor = c => { const cfg = cfgOf(c); return cfg ? backendClient(cfg) : null; };
const errText = e => (e && e.message === 'Failed to fetch') ? 'Could not reach the backend (network or CORS). Check the project URL and that the functions are deployed.' : (e && e.message) || String(e);

/** { ready, be, signedIn, email } for a commerce document (draft or saved); re-renders on sign-in / sign-out. */
export function useBackend(commerce) {
  useSyncExternalStore(subscribe, sessionVersion, sessionVersion);
  const be = clientFor(commerce);
  return { ready: !!be, be, signedIn: !!be && be.signedIn(), email: be ? be.email() : '' };
}

/**
 * The admin's backend controller (CommerceApp puts it on the context as `backend`): session, catalog publish + auto-sync,
 * orders import, and the sign-in dialog. getStore/getCommerce return the latest documents.
 */
export function useBackendController({ store, commerce, getStore, getCommerce, commit, notify }) {
  const { ready, be, signedIn, email } = useBackend(commerce);
  const [dialog, setDialog] = useState(null);
  const storeId = store ? store.id : '';
  const catalog = storeId ? syncRecord('catalog', storeId) : {}, orders = storeId ? syncRecord('orders', storeId) : {};
  const busy = useRef({ catalog: false, orders: false }), base = useRef({ id: null, fp: null });

  useEffect(() => { const r = takeRedirectResult(); if (r) notify(r.error || ('Signed in to your backend' + (r.email ? ' as ' + r.email : ''))); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const promptSignIn = useCallback(({ commerce: c, then } = {}) => setDialog({ c: c || null, then: then || null }), []);

  const publish = useCallback(async ({ auto = false } = {}) => {
    const s = getStore(), c = getCommerce(), client = clientFor(c);
    if (!s || !client) return null;
    if (!client.signedIn()) { if (!auto) promptSignIn({ then: () => publish() }); return null; }
    if (busy.current.catalog) return null;
    const snap = catalogSnapshot(s, c), prev = syncRecord('catalog', s.id), bad = findSecrets(snap);
    if (bad.length) { saveSyncRecord('catalog', s.id, { ...prev, status: 'error', error: `Not sent: ${bad[0]} looks like a secret key. Remove it and try again.` }); if (!auto) notify('Catalog not published: it contains a secret-looking value'); return null; }
    const fp = fingerprint(snap);
    busy.current.catalog = true; saveSyncRecord('catalog', s.id, { ...prev, status: 'syncing', error: '' });
    try {
      const r = await client.syncCatalog(snap);
      saveSyncRecord('catalog', s.id, { status: 'ok', at: Date.now(), fp, error: '', products: r && typeof r.products === 'number' ? r.products : snap.products.length });
      if (base.current.id === s.id) base.current.fp = fp;
      if (!auto) notify(`Catalog published to your backend (${snap.products.length} ${snap.products.length === 1 ? 'product' : 'products'})`);
      return r;
    } catch (e) {
      saveSyncRecord('catalog', s.id, { ...prev, status: 'error', error: errText(e) });
      if (!auto) notify('Catalog sync failed: ' + errText(e));
      return null;
    } finally { busy.current.catalog = false; }
  }, [getStore, getCommerce, notify, promptSignIn]);

  // auto-sync: debounced after any change to what the checkout trusts (products, prices, stock, discounts, tax, shipping, payments)
  const fp = useMemo(() => ready && signedIn && store ? fingerprint(catalogSnapshot(store, commerce)) : '', [ready, signedIn, store, commerce]);
  useEffect(() => {
    if (!fp) { base.current = { id: null, fp: null }; return undefined; }
    if (base.current.id !== storeId) base.current = { id: storeId, fp: syncRecord('catalog', storeId).fp || fp };
    if (fp === base.current.fp) return undefined;
    const t = setTimeout(() => { base.current.fp = fp; publish({ auto: true }); }, AUTO_SYNC_DELAY);
    return () => clearTimeout(t);
  }, [fp, storeId, publish]);

  const syncOrders = useCallback(async ({ quiet = false } = {}) => {
    const s = getStore(), client = clientFor(getCommerce());
    if (!s || !client) return null;
    if (!client.signedIn()) { if (!quiet) promptSignIn({ then: () => syncOrders() }); return null; }
    if (busy.current.orders) return null;
    busy.current.orders = true; saveSyncRecord('orders', s.id, { ...syncRecord('orders', s.id), status: 'syncing', error: '' });
    try {
      const [rows, svc] = await Promise.all([client.fetchOrders(s.id), client.fetchServiceRecords(s.id)]);
      const r = importBackendRecords(getCommerce(), { orders: rows || [], bookings: svc?.bookings || [], projects: svc?.projects || [] }, getStore());
      const label = importSummary(r);
      if (r.commerce) commit(null, r.commerce, label);
      if (!quiet || r.newOrders || r.newBookings || r.newProjects) notify(label);
      saveSyncRecord('orders', s.id, { status: 'ok', at: Date.now(), error: '' });
      return r;
    } catch (e) {
      saveSyncRecord('orders', s.id, { ...syncRecord('orders', s.id), status: 'error', error: errText(e) });
      if (!quiet) notify('Order sync failed: ' + errText(e));
      return null;
    } finally { busy.current.orders = false; }
  }, [getStore, getCommerce, commit, notify, promptSignIn]);

  const dialogEl = dialog && <SignInDialog commerce={dialog.c || commerce} onClose={() => setDialog(null)} onSignedIn={() => { const then = dialog.then; setDialog(null); if (then) setTimeout(then, 0); }} />;
  return { ready, be, signedIn, email, catalog, orders, publish, syncOrders, promptSignIn, dialogEl };
}

// ---------- sign-in ----------

export function SignInForm({ commerce, onSignedIn, compact }) {
  const { be, signedIn, email } = useBackend(commerce);
  const [mode, setMode] = useState('link');
  const [addr, setAddr] = useState(''), [code, setCode] = useState(''), [pw, setPw] = useState('');
  const [sent, setSent] = useState(''), [busy, setBusy] = useState(false), [err, setErr] = useState('');
  if (!be) return <p className="csDim">Add your Supabase project URL and anon key to sign in.</p>;
  if (signedIn) return <div className="caBeSigned" role="group" aria-label="Backend account">
    <span className="caBeAvatar" aria-hidden="true">{(email || '?').charAt(0).toUpperCase()}</span>
    <span className="caBeWho"><strong>Signed in as {email || 'store owner'}</strong><small>Session kept in this browser tab only — it is never saved in your store data or exports.</small></span>
    <Btn icon={LogOut} onClick={() => be.signOut()}>Sign out</Btn>
  </div>;
  const go = fn => async e => {
    e.preventDefault(); setErr(''); setBusy(true);
    try { await fn(); } catch (x) { setErr(errText(x)); } finally { setBusy(false); }
  };
  const redirect = () => { try { return location.origin + location.pathname + location.search; } catch { return undefined; } };
  const send = go(async () => { if (!/^\S+@\S+\.\S+$/.test(addr.trim())) throw new Error('Enter the email address of your store account.'); await be.sendMagicLink(addr.trim(), mode === 'link' ? redirect() : undefined); setSent(addr.trim()); });
  const verify = go(async () => { await be.verifyCode(sent || addr.trim(), code); onSignedIn && onSignedIn(); });
  const password = go(async () => { await be.signInWithPassword(addr.trim(), pw); onSignedIn && onSignedIn(); });
  return <form className={'caBeForm' + (compact ? ' compact' : '')} aria-label="Sign in to your backend" onSubmit={mode === 'password' ? password : sent && mode === 'code' ? verify : send}>
    <Segmented label="Sign-in method" value={mode} onChange={m => { setMode(m); setErr(''); setSent(''); }} options={[['link', 'Magic link'], ['code', 'One-time code'], ['password', 'Password']]} />
    <Text label="Account email" type="email" autoComplete="email" value={addr} placeholder="you@yourstore.com" onChange={v => { setAddr(v); setSent(''); }} />
    {mode === 'password' && <Text label="Password" type="password" autoComplete="current-password" value={pw} onChange={setPw} />}
    {mode === 'code' && sent && <Text label="6-digit code" inputMode="numeric" autoComplete="one-time-code" maxLength={10} value={code} onChange={v => setCode(v.replace(/\s/g, ''))} />}
    <div className="csInline">
      {mode === 'password' ? <Btn kind="primary" icon={KeyRound} type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</Btn>
        : mode === 'code' && sent ? <><Btn kind="primary" icon={Hash} type="submit" disabled={busy || code.length < 6}>{busy ? 'Checking…' : 'Verify code'}</Btn><Btn kind="plain" onClick={send} disabled={busy}>Send a new code</Btn></>
        : <Btn kind="primary" icon={Mail} type="submit" disabled={busy}>{busy ? 'Sending…' : mode === 'link' ? 'Email me a sign-in link' : 'Email me a code'}</Btn>}
    </div>
    {sent && mode === 'link' && <p className="csOk" role="status">Link sent to {sent}. Open it in this browser — it brings you back here signed in (the link signs in the tab it opens).</p>}
    {sent && mode === 'code' && <p className="csDim" role="status">Code sent to {sent}. It is in the same email as the sign-in link.</p>}
    {err && <p className="csErr" role="alert">{err}</p>}
  </form>;
}

export function SignInDialog({ commerce, onClose, onSignedIn }) {
  return <Modal title="Sign in to your backend" onClose={onClose}>
    <p className="caText">Publishing your catalog, connecting Stripe and importing orders need your store account on your Supabase project. The public anon key cannot manage a store.</p>
    <SignInForm commerce={commerce} onSignedIn={onSignedIn} compact />
  </Modal>;
}

// ---------- status ----------

const useTick = (ms = 30_000) => { const [, t] = useReducer(x => x + 1, 0); useEffect(() => { const i = setInterval(t, ms); return () => clearInterval(i); }, [ms]); };

/** Compact chip for the admin header: session + catalog sync state. Hidden when no backend is configured. */
export function BackendChip() {
  const { backend, go } = useAdmin(); useTick();
  if (!backend || !backend.ready) return null;
  if (!backend.signedIn) return <button type="button" className="caBeChip off" onClick={() => backend.promptSignIn()} title="Sign in to your backend to publish the catalog and import orders"><CloudOff size={15} aria-hidden="true" /><span>Sign in to backend</span></button>;
  const [label, tone] = syncLabel(backend.catalog);
  return <button type="button" className={'caBeChip ' + tone} aria-label={`Backend: signed in as ${backend.email}. Catalog: ${label}`} title={`Signed in as ${backend.email}\nCatalog: ${label}`}
    onClick={() => go({ page: 'settings', tab: 'apps' })}><Cloud size={15} aria-hidden="true" /><span className="caBeChipDot" aria-hidden="true" /><span>{label}</span></button>;
}

/** "Publish catalog to backend" + "Synced 2 min ago / Sync failed — retry". */
export function CatalogSync({ showHint }) {
  const { backend } = useAdmin(); useTick();
  if (!backend || !backend.ready) return null;
  const st = backend.catalog, [label, tone] = syncLabel(st);
  return <span className="caBeSync" role="group" aria-label="Catalog sync">
    {backend.signedIn && <span className={'caBeState ' + tone} role="status" title={st.error || undefined}>{st.status === 'error' ? <>Sync failed — <button type="button" className="caLink" onClick={() => backend.publish()}>retry</button></> : label}</span>}
    <Btn icon={CloudUpload} onClick={() => backend.publish()} disabled={st.status === 'syncing'}>Publish catalog to backend</Btn>
    {showHint && st.status === 'error' && st.error && <span className="csErr">{st.error}</span>}
  </span>;
}

/** "Sync orders from backend" with an optional 60 s auto-poll while mounted (Orders, Bookings). */
export function OrdersSync() {
  const { backend } = useAdmin(); useTick();
  const [auto, setAuto] = useState(() => { try { return localStorage.getItem(POLL_KEY) !== 'off'; } catch { return true; } });
  const live = !!(backend && backend.ready && backend.signedIn), sync = backend && backend.syncOrders;
  useEffect(() => {
    if (!live || !auto) return undefined;
    const i = setInterval(() => sync({ quiet: true }), ORDERS_POLL_MS);
    return () => clearInterval(i);
  }, [live, auto, sync]);
  if (!backend || !backend.ready) return null;
  const st = backend.orders;
  return <span className="caBeSync" role="group" aria-label="Order sync">
    {live && <label className="caBeAuto" title="Check the backend for new orders every minute while this page is open"><input type="checkbox" checked={auto} onChange={e => { const v = e.target.checked; setAuto(v); try { localStorage.setItem(POLL_KEY, v ? 'on' : 'off'); } catch { /* storage blocked */ } }} />Auto</label>}
    {live && st.status && <span className={'caBeState ' + (st.status === 'error' ? 'bad' : st.status === 'syncing' ? 'info' : 'ok')} role="status" title={st.error || undefined}>{st.status === 'error' ? 'Sync failed' : st.status === 'syncing' ? 'Syncing…' : 'Checked ' + ago(st.at)}</span>}
    <Btn icon={st.status === 'syncing' ? RefreshCw : CloudDownload} onClick={() => backend.syncOrders()} disabled={st.status === 'syncing'}>Sync orders from backend</Btn>
  </span>;
}
