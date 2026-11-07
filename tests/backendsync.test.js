// Admin ↔ backend bridge (src/store/admin/backendSync.js): magic-link hash parsing, secret guard, catalog fingerprint,
// sync labels, Stripe status patches, idempotent order/booking import and the session store.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAuthHash, issuedBy, findSecrets, fingerprint, ago, syncLabel, stripeStatusPatch, importBackendRecords, importSummary,
  captureAuthRedirect, backendClient, takeRedirectResult, resetBackendSessions, syncRecord, saveSyncRecord, subscribe } from '../src/store/admin/backendSync.js';
import { claims } from '../backend/client/api.js';
import { normalizeCommerce } from '../src/store/admin/model.js';
import { createStore } from '../src/store/templates.js';
import { catalogSnapshot } from '../src/store/commerce.js';

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = p => b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64(p) + '.sig';
const SB = 'https://abcdefghijklmnop.supabase.co';

test('parseAuthHash: tokens, errors, unrelated hashes', () => {
  assert.equal(parseAuthHash(''), null);
  assert.equal(parseAuthHash('#design'), null);
  assert.equal(parseAuthHash('#ecom'), null);
  const t = parseAuthHash('#access_token=abc&refresh_token=r&expires_in=3600&token_type=bearer&type=magiclink');
  assert.equal(t.tokens, '#access_token=abc&refresh_token=r&expires_in=3600&token_type=bearer&type=magiclink'); assert.equal(t.type, 'magiclink');
  assert.match(parseAuthHash('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired').error, /expired. Send a new one/);
  assert.equal(parseAuthHash('#error=server_error&error_description=Database+down').error, 'Database down');
});

test('claims / issuedBy: email and issuer of an access token', () => {
  const tok = jwt({ iss: SB + '/auth/v1', email: 'ada@shop.io', sub: 'u1' });
  assert.equal(claims(tok).email, 'ada@shop.io'); assert.deepEqual(claims('nope'), {});
  assert.equal(issuedBy(tok, SB), true); assert.equal(issuedBy(tok, 'https://zzzzzzzzzzzzzzzz.supabase.co'), false);
  assert.equal(issuedBy('opaque', SB), true, 'tokens without an issuer are accepted');
});

test('findSecrets: flags secret-looking values anywhere in a snapshot; a real catalog snapshot is clean', () => {
  assert.deepEqual(findSecrets({ a: 'pk_test_123', b: [{ c: 'sk_test_51AbCdEfGhIjKlMnOp' }], d: 'whsec_abc' }), ['b.0.c', 'd']);
  const store = createStore('everyday'), commerce = normalizeCommerce({ storeId: store.id });
  assert.deepEqual(findSecrets(catalogSnapshot(store, commerce)), []);
});

test('fingerprint: stable for equal snapshots, changes with price, stock or discounts', () => {
  const store = createStore('everyday'), commerce = normalizeCommerce({ storeId: store.id });
  const a = fingerprint(catalogSnapshot(store, commerce));
  assert.equal(a, fingerprint(catalogSnapshot(structuredClone(store), structuredClone(commerce))));
  const s2 = structuredClone(store); s2.products[0].price += 1;
  assert.notEqual(fingerprint(catalogSnapshot(s2, commerce)), a);
  const s3 = structuredClone(store); s3.products[0].variants[0].stock = 999;
  assert.notEqual(fingerprint(catalogSnapshot(s3, commerce)), a);
  const c2 = normalizeCommerce({ storeId: store.id, discounts: [{ id: 'd1', code: 'X', type: 'percentage', value: 5 }] });
  assert.notEqual(fingerprint(catalogSnapshot(store, c2)), a);
});

test('ago + syncLabel', () => {
  const now = 1_000_000_000;
  assert.equal(ago(now - 10_000, now), 'just now'); assert.equal(ago(now - 120_000, now), '2 min ago'); assert.equal(ago(now - 3 * 3600_000, now), '3 h ago'); assert.equal(ago(now - 86400_000, now), '1 day ago');
  assert.deepEqual(syncLabel({ status: 'ok', at: now - 120_000 }, now), ['Synced 2 min ago', 'ok']);
  assert.deepEqual(syncLabel({ status: 'error', error: 'x' }, now), ['Sync failed', 'bad']);
  assert.deepEqual(syncLabel({ status: 'syncing' }, now), ['Syncing…', 'info']);
  assert.deepEqual(syncLabel({}, now), ['Not published yet', 'neutral']);
});

test('stripeStatusPatch: only known fields with valid values', () => {
  assert.deepEqual(stripeStatusPatch({ connected: true, accountId: 'acct_1Abc', onboardingStatus: 'connected', chargesEnabled: true, payoutsEnabled: false, requirementsDue: ['x'] }),
    { accountId: 'acct_1Abc', onboardingStatus: 'connected', chargesEnabled: true, payoutsEnabled: false });
  assert.deepEqual(stripeStatusPatch({ connected: false }), { onboardingStatus: 'not_connected' });
  assert.deepEqual(stripeStatusPatch({ accountId: 'evil<script>', onboardingStatus: 'hacked' }), {});
  assert.deepEqual(stripeStatusPatch(null), {});
});

const orderRow = (id, number) => ({ id, number, status: 'open', financial_status: 'paid', fulfillment_status: 'unfulfilled', email: 'buyer@x.io', created_at: '2026-11-01T10:00:00Z', updated_at: '2026-11-01T10:05:00Z', paid_at: '2026-11-01T10:05:00Z',
  subtotal: 40, discount_total: 0, shipping: 6, shipping_discount: 0, tax: 2, total: 48, tax_inclusive: false, shipping_address: { name: 'Ada', country: 'US' },
  order_lines: [{ id: id + 'l', product_id: 'p1', variant_id: 'v1', title: 'Mug', unit_price: 20, quantity: 2, position: 0 }], refunds: [] });
const bookingRow = { id: 'b1', product_id: 'svc', title: 'Call', attendee: { name: 'Ada', email: 'ada@x.io' }, starts_at: '2030-01-07T09:00:00.000Z', ends_at: '2030-01-07T10:00:00.000Z', timezone: 'UTC', status: 'requested', order_id: 'u1', price: 120, created_at: '2026-11-01T10:05:00Z' };

test('importBackendRecords: imports, then re-running adds and changes nothing; updates are counted', () => {
  const store = createStore('everyday'), c0 = normalizeCommerce({ storeId: store.id });
  const rows = { orders: [orderRow('u1', 1001), orderRow('u2', 1002)], bookings: [bookingRow], projects: [] };
  const r1 = importBackendRecords(c0, rows, store);
  assert.equal(r1.newOrders, 2); assert.equal(r1.newBookings, 1); assert.equal(r1.updated, 0);
  assert.equal(r1.commerce.orders.filter(o => o.id.startsWith('sb_')).length, 2);
  assert.equal(importSummary(r1), 'Imported 2 orders, 1 booking');
  const r2 = importBackendRecords(r1.commerce, rows, store);
  assert.equal(r2.commerce, null, 'nothing changed'); assert.equal(r2.newOrders + r2.newBookings + r2.updated, 0);
  assert.equal(importSummary(r2), 'Imported 0 orders, 0 bookings — already up to date');
  const refunded = { ...rows, orders: [{ ...orderRow('u1', 1001), financial_status: 'refunded', updated_at: '2026-11-02T00:00:00Z' }] };
  const r3 = importBackendRecords(r1.commerce, refunded, store);
  assert.equal(r3.newOrders, 0); assert.equal(r3.updated, 1); assert.equal(r3.commerce.orders.length, r1.commerce.orders.length);
  assert.equal(r3.commerce.orders.find(o => o.id === 'sb_u1').financialStatus, 'refunded');
  assert.equal(importSummary(r3), 'Imported 0 orders, 0 bookings · 1 updated');
  assert.equal(importBackendRecords(c0, {}, store).commerce, null);
});

test('session store: magic-link redirect is captured from the URL, claimed by the matching project, kept in tab storage only', async () => {
  resetBackendSessions();
  const mem = new Map(), storage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: k => mem.delete(k) };
  const tok = jwt({ iss: SB + '/auth/v1', email: 'owner@shop.io' });
  const loc = { hash: '#access_token=' + tok + '&refresh_token=r1&expires_in=3600&type=magiclink', pathname: '/commerce/shop/settings/apps', search: '' };
  let replaced = null; const hist = { state: null, replaceState: (_, __, u) => { replaced = u; } };
  let pings = 0; const off = subscribe(() => pings++);
  assert.ok(captureAuthRedirect(loc, hist).tokens);
  assert.equal(replaced, '/commerce/shop/settings/apps', 'tokens removed from the URL, route kept');
  const other = backendClient({ url: 'https://zzzzzzzzzzzzzzzz.supabase.co', anonKey: 'anon' }, { storage });
  assert.equal(other.signedIn(), false, 'another project does not claim the tokens');
  const calls = [];
  const fetchImpl = async (u, init) => { calls.push({ u, h: init.headers, body: init.body }); return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, products: 3 }) }; };
  const be = backendClient({ url: SB, anonKey: 'anon-key' }, { storage, fetchImpl });
  assert.equal(be.signedIn(), true); assert.equal(be.email(), 'owner@shop.io');
  assert.deepEqual(takeRedirectResult(), { email: 'owner@shop.io' }); assert.equal(takeRedirectResult(), null);
  assert.ok([...mem.keys()].some(k => k.startsWith('zt-backend-session:')), 'session in the given (tab) storage');
  assert.equal(backendClient({ url: SB, anonKey: 'anon-key' }, { storage, fetchImpl }), be, 'one shared client per project');
  await be.syncCatalog({ store: { id: 's1' } });
  assert.equal(calls[0].u, SB + '/functions/v1/sync-catalog'); assert.equal(calls[0].h.Authorization, 'Bearer ' + tok); assert.equal(calls[0].h.apikey, 'anon-key');
  assert.ok(pings > 0, 'subscribers notified');
  be.signOut(); assert.equal(be.signedIn(), false); assert.equal(mem.size, 0);
  off();
});

test('session store: an expired / revoked session (401) signs out with a clear message', async () => {
  resetBackendSessions();
  const mem = new Map(), storage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: k => mem.delete(k) };
  const fetchImpl = async u => /grant_type=password/.test(u) ? { ok: true, status: 200, text: async () => JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_in: 3600, user: { email: 'o@x.io' } }) }
    : { ok: false, status: 401, text: async () => JSON.stringify({ error: { code: 'auth_required', message: 'Sign in' } }) };
  const be = backendClient({ url: SB, anonKey: 'k2' }, { storage, fetchImpl });
  await be.signInWithPassword('o@x.io', 'pw'); assert.equal(be.email(), 'o@x.io');
  await assert.rejects(be.connectStatus('s1'), /session has expired/);
  assert.equal(be.signedIn(), false);
});

test('captureAuthRedirect: error hashes are reported once; normal URLs are untouched', () => {
  resetBackendSessions();
  let replaced = null; const hist = { state: null, replaceState: (_, __, u) => { replaced = u; } };
  assert.equal(captureAuthRedirect({ hash: '#ecom', pathname: '/', search: '' }, hist), null); assert.equal(replaced, null);
  captureAuthRedirect({ hash: '#error=access_denied&error_description=Email+link+is+invalid+or+has+expired', pathname: '/commerce', search: '?x=1' }, hist);
  assert.equal(replaced, '/commerce?x=1'); assert.match(takeRedirectResult().error, /expired/); assert.equal(takeRedirectResult(), null);
  saveSyncRecord('catalog', 's9', { status: 'ok', at: 5, fp: 'f' }); assert.deepEqual(syncRecord('catalog', 's9'), { status: 'ok', at: 5, fp: 'f' });
});
