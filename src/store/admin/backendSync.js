// The admin's bridge to the merchant's backend (Supabase, backend/): the signed-in session and the pure helpers behind
// "Publish catalog to backend", the catalog auto-sync, "Sync orders from backend" and the Stripe status refresh.
// UI: src/store/admin/Backend.jsx. Client: backend/client/api.js (+ orders.js for rows → admin documents).
//
// Session: kept in memory and in sessionStorage only (per browser tab; gone when the tab closes). It is never written
// into the commerce document, the store document or any exported file.
// Magic links come back as '<admin URL>#access_token=…&refresh_token=…&expires_in=…' (or '#error=…'):
// captureAuthRedirect() (called once at boot, before the router normalizes the URL) takes the tokens out of the URL;
// the first backendClient() for the project that issued them signs in with them.

import { createBackend, claims } from '../../../backend/client/api.js';
import { backendToCommerce, mergeBackend } from '../../../backend/client/orders.js';
import { looksSecret } from '../integrations.js';
import { normalizeCommerce } from './model.js';

// ---------- pure helpers ----------

/** '#access_token=…' → { tokens: hash }, '#error=…' → { error: message }, anything else → null. */
export function parseAuthHash(hash) {
  const h = String(hash || '').replace(/^#/, '');
  if (!h || !/(^|&)(access_token|error|error_description)=/.test(h)) return null;
  const q = new URLSearchParams(h);
  if (q.get('access_token')) return { tokens: '#' + h, type: q.get('type') || '' };
  const msg = (q.get('error_description') || q.get('error') || 'Sign-in failed').replace(/\+/g, ' ');
  return { error: /expired|invalid/i.test(msg) ? 'The sign-in link is invalid or has expired. Send a new one.' : msg };
}

/** True when an access token was issued by this Supabase project (tokens without an issuer are accepted). */
export function issuedBy(token, url) {
  const iss = String(claims(token).iss || ''), base = String(url || '').replace(/\/+$/, '');
  return !iss || !base || iss.startsWith(base);
}

/** Paths of string values that look like secrets (Stripe secret keys, service-role JWTs…). [] = safe to send. */
export function findSecrets(value, path = '') {
  if (typeof value === 'string') return looksSecret(value) ? [path || '(root)'] : [];
  if (!value || typeof value !== 'object') return [];
  const out = [];
  for (const [k, v] of Array.isArray(value) ? value.entries() : Object.entries(value)) out.push(...findSecrets(v, path ? path + '.' + k : String(k)));
  return out;
}

/** Short, stable fingerprint of a catalog snapshot (FNV-1a over its JSON) — "has the catalog changed since the last sync?". */
export function fingerprint(snapshot) {
  const s = JSON.stringify(snapshot ?? null);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36) + '.' + s.length.toString(36);
}

/** "just now" / "2 min ago" / "3 h ago" / "2 days ago". */
export function ago(at, now = Date.now()) {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60); if (m < 60) return m + ' min ago';
  const h = Math.round(m / 60); if (h < 24) return h + ' h ago';
  const d = Math.round(h / 24); return d + (d === 1 ? ' day ago' : ' days ago');
}

/** Catalog sync state → [label, tone]. state: { status: 'idle'|'syncing'|'ok'|'error', at?, error? } */
export function syncLabel(state, now = Date.now()) {
  const st = state || { status: 'idle' };
  if (st.status === 'syncing') return ['Syncing…', 'info'];
  if (st.status === 'error') return ['Sync failed', 'bad'];
  if (st.status === 'ok' && st.at) return ['Synced ' + ago(st.at, now), 'ok'];
  return ['Not published yet', 'neutral'];
}

/** Answer of stripe-connect-onboard / stripe-connect-status → the fields it may change in settings.payments.stripe. */
export function stripeStatusPatch(data) {
  const d = data && typeof data === 'object' ? data : {}, out = {};
  if (typeof d.accountId === 'string' && /^acct_[A-Za-z0-9]+$/.test(d.accountId)) out.accountId = d.accountId;
  if (['not_connected', 'pending', 'connected', 'restricted'].includes(d.onboardingStatus)) out.onboardingStatus = d.onboardingStatus;
  else if (d.connected === false) out.onboardingStatus = 'not_connected';
  if (typeof d.chargesEnabled === 'boolean') out.chargesEnabled = d.chargesEnabled;
  if (typeof d.payoutsEnabled === 'boolean') out.payoutsEnabled = d.payoutsEnabled;
  return out;
}

const NONE = { orders: [], bookings: [], serviceProjects: [] };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/**
 * Backend rows → merged, normalized commerce document plus counts. Idempotent: records keep their backend id
 * ('sb_<uuid>'), so importing the same rows again adds nothing. commerce is null when nothing changed.
 */
export function importBackendRecords(commerce, { orders = [], bookings = [], projects = [] } = {}, store = null) {
  const add = orders.length || bookings.length || projects.length ? backendToCommerce(orders, bookings, projects, store) : NONE;
  const merged = normalizeCommerce(mergeBackend(commerce, add));
  const count = (key, list) => {
    const before = new Map((commerce[key] || []).map(x => [x.id, x]));
    let added = 0, updated = 0;
    for (const { id } of list) { const old = before.get(id), now = merged[key].find(x => x.id === id); if (!old) added++; else if (!same(old, now)) updated++; }
    return [added, updated];
  };
  const [newOrders, updOrders] = count('orders', add.orders), [newBookings, updBookings] = count('bookings', add.bookings), [newProjects, updProjects] = count('serviceProjects', add.serviceProjects);
  const updated = updOrders + updBookings + updProjects, changed = newOrders + newBookings + newProjects + updated > 0;
  return { commerce: changed ? merged : null, newOrders, newBookings, newProjects, updated };
}

/** Toast text for an import result. */
export function importSummary(r) {
  const pl = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  let t = `Imported ${pl(r.newOrders, 'order')}, ${pl(r.newBookings, 'booking')}`;
  if (r.newProjects) t += `, ${pl(r.newProjects, 'project')}`;
  if (r.updated) t += ` · ${r.updated} updated`;
  if (!r.newOrders && !r.newBookings && !r.newProjects && !r.updated) t += ' — already up to date';
  return t;
}

// ---------- session store (browser) ----------

const listeners = new Set(), clients = new Map();
let version = 0, pendingTokens = '', redirectError = '', redirectEmail = null;
const emit = () => { version++; for (const f of listeners) f(); };
export const subscribe = f => { listeners.add(f); return () => listeners.delete(f); };
export const sessionVersion = () => version;

function tabStorage() { try { const s = globalThis.sessionStorage; s.getItem('x'); return s; } catch { return null; } }

/**
 * Take magic-link tokens (or an error) out of the current URL. Call once at boot, before routing rewrites the URL.
 * Returns the parsed hash (see parseAuthHash) or null. The tokens stay in memory until a backendClient() claims them.
 */
export function captureAuthRedirect(loc = globalThis.location, hist = globalThis.history) {
  const p = loc ? parseAuthHash(loc.hash) : null;
  if (!p) return null;
  if (p.tokens) pendingTokens = p.tokens; else redirectError = p.error;
  try { hist && hist.replaceState(hist.state, '', loc.pathname + loc.search); } catch { /* not a browser */ }
  emit();
  return p;
}
/** What happened to the last magic-link redirect, once: { error } | { email } | null. */
export function takeRedirectResult() { const r = redirectError ? { error: redirectError } : redirectEmail !== null ? { email: redirectEmail } : null; redirectError = ''; redirectEmail = null; return r; }

/**
 * The shared client for a backend config ({ url, anonKey, functionsUrl } from publicConfig(commerce).backend), or null.
 * Every method notifies subscribers when it settles, so the UI follows sign-in / sign-out / an expired session.
 */
export function backendClient(cfg, { storage = tabStorage(), fetchImpl } = {}) {
  if (!cfg || !cfg.url || !cfg.anonKey) return null;
  const key = cfg.url + '|' + cfg.anonKey + '|' + (cfg.functionsUrl || '');
  if (clients.has(key)) return claim(clients.get(key), cfg);
  const raw = createBackend(cfg, { storage, ...(fetchImpl ? { fetchImpl } : {}) });
  const be = { ...raw };
  for (const [k, f] of Object.entries(raw)) {
    if (k === 'signedIn' || k === 'email' || k === 'acceptRedirect') continue;
    be[k] = (...a) => {
      let r; try { r = f(...a); } catch (e) { emit(); throw e; }
      if (!r || typeof r.then !== 'function') { emit(); return r; }
      return r.then(v => { emit(); return v; }, e => { if (e && e.status === 401 && raw.signedIn() && k !== 'verifyCode' && k !== 'signInWithPassword' && k !== 'sendMagicLink') { raw.signOut(); e.message = 'Your backend session has expired. Sign in again.'; } emit(); throw e; });
    };
  }
  clients.set(key, be);
  return claim(be, cfg);
}
function claim(be, cfg) {
  if (pendingTokens) {
    const t = new URLSearchParams(pendingTokens.slice(1)).get('access_token');
    if (issuedBy(t, cfg.url)) { try { be.acceptRedirect(pendingTokens); redirectEmail = be.email(); } catch { redirectError = 'Sign-in failed. Send a new link.'; } pendingTokens = ''; queueMicrotask(emit); }
  }
  return be;
}

// per-store sync bookkeeping (not secret; survives a reload of this tab, never stored in documents)
const memo = new Map();
export function syncRecord(kind, storeId) {
  const k = 'zt-sync:' + kind + ':' + storeId;
  if (!memo.has(k)) { let v = null; try { v = JSON.parse(tabStorage()?.getItem(k) || 'null'); } catch { v = null; } memo.set(k, v || {}); }
  return memo.get(k);
}
export function saveSyncRecord(kind, storeId, value) {
  const k = 'zt-sync:' + kind + ':' + storeId; memo.set(k, value);
  try { tabStorage()?.setItem(k, JSON.stringify(value)); } catch { /* storage blocked */ }
  emit();
}
/** Test hook: forget clients, pending tokens and bookkeeping. */
export function resetBackendSessions() { clients.clear(); memo.clear(); pendingTokens = ''; redirectError = ''; redirectEmail = null; emit(); }
