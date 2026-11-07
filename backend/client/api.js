// Browser client for the Zertake backend, for the admin (no dependencies: fetch against Supabase Auth, PostgREST and the
// Edge Functions). The admin itself is still local (IndexedDB); this is the bridge to the live store's data.
//
//   const be = createBackend({ url, anonKey, functionsUrl? }, { storage: localStorage })   // values from Settings › Integrations › Backend
//   await be.sendMagicLink(email, redirectTo) / await be.verifyCode(email, '123456') / await be.signInWithPassword(email, pw)
//   be.signedIn() / be.signOut()
//   await be.syncCatalog(catalogSnapshot(store, commerce))         → { ok, products, deactivated }   (src/store/commerce.js)
//   await be.connectOnboard({ storeId, mode, connectType, country, email, returnUrl, refreshUrl })  → { url, accountId, onboardingStatus, … }
//   await be.connectStatus(storeId)                                → { connected, onboardingStatus, chargesEnabled, … }
//   await be.fetchOrders(storeId, { since })                       → rows of orders with order_lines (RLS: owner only)
//   await be.fetchServiceRecords(storeId, { since })               → { bookings, projects }
//   await be.resendConfirmation(orderId)                           → { ok }
// Then backendToCommerce(rows, …) (backend/client/orders.js) turns rows into admin orders / bookings / projects.

export function createBackend({ url, anonKey, functionsUrl } = {}, { storage = null, fetchImpl = globalThis.fetch } = {}) {
  const base = String(url || '').replace(/\/+$/, ''), fn = String(functionsUrl || (base ? base + '/functions/v1' : '')).replace(/\/+$/, '');
  const KEY = 'zt-backend-session:' + base;
  let session = null;
  try { session = storage ? JSON.parse(storage.getItem(KEY) || 'null') : null; } catch { session = null; }
  const save = s => { session = s; try { if (storage) s ? storage.setItem(KEY, JSON.stringify(s)) : storage.removeItem(KEY); } catch { /* storage blocked */ } };
  const accept = j => { if (!j || !j.access_token) throw new Error((j && (j.error_description || j.msg || j.message)) || 'Sign-in failed'); save({ access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + (j.expires_in ?? 3600) * 1000, email: j.user?.email || '' }); return session; };

  async function call(u, init = {}, auth = true) {
    const headers = { apikey: anonKey, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}) };
    if (auth) { const t = await token(); if (t) headers.Authorization = 'Bearer ' + t; }
    const r = await fetchImpl(u, { ...init, headers });
    const text = await r.text(); let j = null; try { j = text ? JSON.parse(text) : null; } catch { j = { message: text }; }
    if (!r.ok) { const e = new Error(j?.error?.message || j?.message || j?.msg || `HTTP ${r.status}`); e.status = r.status; e.code = j?.error?.code || j?.code; throw e; }
    return j;
  }
  async function token() {
    if (!session) return '';
    if (session.expires_at - Date.now() > 60_000) return session.access_token;
    try { accept(await call(`${base}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', body: JSON.stringify({ refresh_token: session.refresh_token }) }, false)); }
    catch { save(null); return ''; }
    return session.access_token;
  }
  const post = (name, body) => call(`${fn}/${name}`, { method: 'POST', body: JSON.stringify(body) });

  return {
    signedIn: () => !!session, email: () => session?.email || '', signOut: () => save(null),
    sendMagicLink: (email, redirectTo) => call(`${base}/auth/v1/otp${redirectTo ? '?redirect_to=' + encodeURIComponent(redirectTo) : ''}`, { method: 'POST', body: JSON.stringify({ email, create_user: true }) }, false),
    verifyCode: async (email, code) => accept(await call(`${base}/auth/v1/verify`, { method: 'POST', body: JSON.stringify({ type: 'email', email, token: String(code).trim() }) }, false)),
    signInWithPassword: async (email, password) => accept(await call(`${base}/auth/v1/token?grant_type=password`, { method: 'POST', body: JSON.stringify({ email, password }) }, false)),
    /** After a magic link redirect: '#access_token=…&refresh_token=…&expires_in=…' */
    acceptRedirect: hash => { const q = new URLSearchParams(String(hash || '').replace(/^#/, '')); return q.get('access_token') ? accept({ access_token: q.get('access_token'), refresh_token: q.get('refresh_token'), expires_in: +q.get('expires_in') || 3600 }) : null; },
    syncCatalog: snapshot => post('sync-catalog', snapshot),
    connectOnboard: body => post('stripe-connect-onboard', body),
    connectStatus: storeId => call(`${fn}/stripe-connect-status?store=${encodeURIComponent(storeId)}`),
    resendConfirmation: orderId => post('send-email', { orderId, force: true }),
    fetchOrders: (storeId, { since = '', limit = 500 } = {}) =>
      call(`${base}/rest/v1/orders?store_id=eq.${encodeURIComponent(storeId)}&status=neq.pending${since ? '&updated_at=gt.' + encodeURIComponent(since) : ''}&select=*,order_lines(*),refunds(*)&order=created_at.asc&limit=${limit}`),
    fetchServiceRecords: async (storeId, { since = '' } = {}) => {
      const f = since ? '&updated_at=gt.' + encodeURIComponent(since) : '';
      const [bookings, projects] = await Promise.all([
        call(`${base}/rest/v1/bookings?store_id=eq.${encodeURIComponent(storeId)}${f}&order=starts_at.asc`),
        call(`${base}/rest/v1/service_projects?store_id=eq.${encodeURIComponent(storeId)}${f}&order=created_at.asc`),
      ]);
      return { bookings, projects };
    },
  };
}
