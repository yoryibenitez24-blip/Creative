// Storefront ↔ commerce back office (src/store/admin/**): discounts, shipping and tax in the shopper's cart.
//
//   checkoutConfig(store, commerce|{ discounts }) → cfg | null
//       The slice of the commerce document a static storefront needs (embedded in assets/store.js):
//       { discounts, zones, taxes: { inclusive, shippingTaxed, rates }, weights: { pid: { vid: grams } },
//         collections: { pid: [collectionId] }, webhook: orderWebhookUrl, countries: [[code, name]] }
//   commerceKit(applyDiscounts) → { ratesFor(cfg, country, subtotal, grams), taxRateFor(cfg, country, region),
//       computeTax(amount, rate, inclusive), totals(cfg, lines, input, now) }
//       totals() mirrors computeOrderTotals() in src/store/admin/orders.js (discounts → shipping → tax), so the storefront
//       and the admin agree on every order total. Self-contained: serialised with toString() into the storefront.
//   commerceScript() → JS source defining `var CK` (kit bound to the admin's applyDiscounts engine) for the storefront,
//       plus the Stripe Checkout / analytics layer (payRuntime) that boots itself next to the store runtime.
//   commerceEngineSource() → only the `var CK` part (also generated into backend/supabase/functions/_shared/engine.js, so
//       the create-checkout-session function prices carts with exactly the same code as the storefront).
//
// Online payments (Stripe Checkout through the Supabase backend in backend/; see docs/BACKEND.md):
//   payConfig(commerce) → null | { stripe: null | { mode, publishableKey, endpoint, statusUrl }, trackUrl, anonKey, turnstileSiteKey }
//       Public values only, derived from publicConfig() (src/store/integrations.js). checkoutConfig() embeds it as cfg.pay.
//       stripe is set when Stripe is enabled with a publishable key for the current mode AND a backend is configured;
//       trackUrl whenever a backend is configured (first-party analytics → the `track` function).
//   Storefront behaviour (payRuntime): with cfg.pay.stripe and an order method other than "catalog only", the checkout
//       form's button becomes "Continue to secure payment": it POSTs { storeId, lines [{ productId, variantId, quantity }],
//       codes, country, region, rateId, customer, returnUrl, turnstileToken, … } (CK.payPayload) to create-checkout-session
//       and redirects to the Stripe-hosted page. checkout.html?zt_checkout=success&session_id=… shows the confirmation and
//       empties the cart; cart.html?zt_checkout=cancel says the payment was cancelled. Without cfg.pay.stripe nothing
//       changes: WhatsApp / email / payment links work as before (and are the fallback when the backend is unreachable).
//   catalogSnapshot(store, commerce, { imageUrl, siteUrl }) → the body of POST sync-catalog (prices the server trusts).

import { applyDiscounts, discountStatus, toMs } from './admin/discounts.js';
import { variantWeight, countryName } from './admin/model.js';
import { publicConfig, normalizeStripe, normalizeIntegrations } from './integrations.js';

/** Public payment + backend settings for the storefront (see header). null when no backend is configured. */
export function payConfig(commerce) {
  if (!commerce || typeof commerce !== 'object' || !commerce.settings) return null;
  const pc = publicConfig(commerce), fn = pc.backend.functionsUrl;
  if (!fn) return null;
  const stripe = pc.ready ? { mode: pc.mode, publishableKey: pc.publishableKey, endpoint: fn + '/create-checkout-session', statusUrl: fn + '/order-status', slotsUrl: fn + '/booking-slots' } : null;
  return { stripe, trackUrl: fn + '/track', anonKey: pc.backend.anonKey, turnstileSiteKey: stripe ? pc.turnstileSiteKey : '' };
}

/** What the checkout asks for service products: { [productId]: { booking, durationMinutes, timezone, intake, addOns } }. */
export function serviceCheckout(store) {
  const out = {};
  for (const p of store.products || []) {
    if (p.kind !== 'service' || !p.service || p.status !== 'active') continue;
    const s = p.service;
    out[p.id] = { booking: !!s.booking?.enabled, durationMinutes: s.durationMinutes || 60, timezone: s.booking?.timezone || 'UTC',
      intake: (s.intake || []).map(q => ({ id: q.id, label: q.label, type: q.type, required: !!q.required, options: q.options || [] })),
      addOns: (s.addOns || []).map(a => ({ id: a.id, name: a.name, price: a.price })) };
  }
  return out;
}

export function checkoutConfig(store, commerce) {
  if (!commerce || typeof commerce !== 'object') return null;
  const st = commerce.settings || {};
  const discounts = (Array.isArray(commerce.discounts) ? commerce.discounts : []).filter(d => d && d.enabled !== false)
    .map(d => ({ id: d.id, title: d.title || '', method: d.method, code: d.code || '', type: d.type, value: d.value, appliesTo: d.appliesTo, minimum: d.minimum, bxgy: d.bxgy,
      usageLimit: d.usageLimit ?? null, usageCount: d.usageCount || 0, oncePerCustomer: false, combinable: !!d.combinable, enabled: true, startsAt: d.startsAt || null, endsAt: d.endsAt || null }));
  const zones = st.shipping?.zones || [], taxes = st.taxes || { inclusive: false, shippingTaxed: false, rates: [] };
  const weights = {}, collections = {};
  for (const p of store.products) {
    weights[p.id] = Object.fromEntries(p.variants.map(v => [v.id, st.shipping ? variantWeight(commerce, p.id, v.id) : 0]));
    collections[p.id] = store.collections.filter(col => col.rule.type === 'all' || (col.rule.type === 'manual' ? col.rule.productIds.includes(p.id)
      : col.rule.type === 'category' ? p.category.toLowerCase() === col.rule.value.trim().toLowerCase()
      : p.tags.some(t => t.toLowerCase() === col.rule.value.trim().toLowerCase()))).map(c => c.id);
  }
  const codes = [...new Set(zones.flatMap(z => z.countries))].filter(c => c !== '*');
  const countries = codes.map(c => [c, countryName(c)]).sort((a, b) => a[1].localeCompare(b[1]));
  if (zones.some(z => z.countries.includes('*'))) countries.push(['*', 'Other country']);
  return { discounts, zones, taxes: { inclusive: !!taxes.inclusive, shippingTaxed: !!taxes.shippingTaxed, rates: taxes.rates || [] }, weights, collections,
    webhook: String(st.backend?.orderWebhookUrl || '').trim(), countries, pay: payConfig(commerce), services: serviceCheckout(store) };
}

export function commerceKit(applyDiscounts) {
  function C(n) { return Math.round((+n || 0) * 100); }
  function M(c) { return Math.round(c) / 100; }
  function zoneFor(cfg, country) {
    var zs = cfg.zones || [], i;
    for (i = 0; i < zs.length; i++) if (country && country !== '*' && zs[i].countries.indexOf(country) >= 0) return zs[i];
    for (i = 0; i < zs.length; i++) if (zs[i].countries.indexOf('*') >= 0) return zs[i];
    return null;
  }
  function ratePrice(rate, subtotal, grams) {
    if (rate.type === 'flat') return rate.price;
    if (rate.type === 'free_over') return C(subtotal) >= C(rate.threshold) && rate.threshold >= 0 ? 0 : rate.price;
    var tiers = rate.tiers || [];
    for (var i = 0; i < tiers.length; i++) if (grams <= tiers[i].upTo) return tiers[i].price;
    return null;
  }
  function ratesFor(cfg, country, subtotal, grams) {
    var z = zoneFor(cfg, country); if (!z) return [];
    return z.rates.map(function (r) { return { id: r.id, zoneId: z.id, zoneName: z.name, name: r.name, type: r.type, price: ratePrice(r, subtotal, grams || 0) }; }).filter(function (r) { return r.price != null; });
  }
  function taxRateFor(cfg, country, region) {
    var rates = ((cfg.taxes || {}).rates || []).filter(function (r) { return r.country === country; }), reg = String(region || '').trim().toLowerCase(), exact = null, base = null;
    rates.forEach(function (r) { if (reg && r.region && r.region.toLowerCase() === reg && !exact) exact = r; if (!r.region && !base) base = r; });
    var r = exact || base;
    return r ? { rate: r.rate, name: r.name } : { rate: 0, name: '' };
  }
  function computeTax(amount, ratePercent, inclusive) {
    var a = C(amount), r = (+ratePercent || 0) / 100;
    if (r <= 0 || a <= 0) return 0;
    return M(inclusive ? a - Math.round(a / (1 + r)) : Math.round(a * r));
  }
  /** lines: [{ productId, variantId, price, quantity }]; input: { codes, country, region, rateId ('none' = no shipping) } */
  function totals(cfg, lines, input, now) {
    input = input || {};
    var ls = lines.map(function (l) { var o = {}; for (var k in l) o[k] = l[k]; o.collectionIds = (cfg.collections || {})[l.productId] || []; return o; });
    var sub = 0, grams = 0;
    ls.forEach(function (l) { sub += C(l.price) * l.quantity; grams += (((cfg.weights || {})[l.productId] || {})[l.variantId] || 0) * l.quantity; });
    var country = input.country || '', rates = country ? ratesFor(cfg, country, M(sub), grams) : [];
    var rate = null;
    if (input.rateId !== 'none') for (var i = 0; i < rates.length; i++) if (rates[i].id === input.rateId) rate = rates[i];
    if (!rate && input.rateId !== 'none' && rates.length) rate = rates[0];
    var d = applyDiscounts({ lines: ls, codes: input.codes || [], shipping: rate ? rate.price : 0, customerUsage: {} }, cfg.discounts || [], now);
    var tx = cfg.taxes || {}, tr = taxRateFor(cfg, country, input.region);
    var taxable = M(C(d.subtotal) - C(d.discountTotal) + (tx.shippingTaxed ? C(d.shipping) : 0));
    var tax = computeTax(taxable, tr.rate, tx.inclusive);
    var out = {}; for (var k2 in d) out[k2] = d[k2];
    out.rates = rates; out.shippingRateId = rate ? rate.id : null; out.shippingName = rate ? rate.name : ''; out.tax = tax; out.taxRate = tr.rate; out.taxName = tr.name;
    out.taxInclusive = !!tx.inclusive; out.total = M(C(d.total) + (tx.inclusive ? 0 : C(tax))); out.grams = grams;
    return out;
  }
  // ---------- online payments (Stripe Checkout via the backend) + analytics events ----------
  /** Stripe Checkout replaces the order flow when it is configured and the store takes orders at all. */
  function payReady(cfg, checkoutMode) {
    var p = cfg && cfg.pay && cfg.pay.stripe;
    return !!(p && p.endpoint && p.publishableKey) && checkoutMode !== 'none';
  }
  function clip(v, n) { return String(v == null ? '' : v).trim().slice(0, n); }
  /** Body of POST create-checkout-session. lines: [{ productId, variantId, quantity, price }] — price is informational only. */
  function payPayload(cfg, storeId, lines, input) {
    input = input || {};
    var c = input.customer || {}, codes = Array.isArray(input.codes) ? input.codes : [];
    return {
      storeId: storeId, checkoutId: clip(input.checkoutId, 64), currency: clip(input.currency, 3).toUpperCase(),
      lines: lines.map(function (l) {
        var o = { productId: l.productId, variantId: l.variantId, quantity: l.quantity, price: l.price };
        if (l.start) o.start = clip(l.start, 40);
        if (Array.isArray(l.intake) && l.intake.length) o.intake = l.intake.slice(0, 50).map(function (a) { return { question: clip(a.question, 200), answer: clip(a.answer, 4000) }; });
        if (Array.isArray(l.addOns) && l.addOns.length) o.addOns = l.addOns.slice(0, 50).map(function (a) { return clip(a, 80); });
        return o;
      }),
      codes: codes.map(function (x) { return clip(x, 40).toUpperCase(); }).filter(Boolean).slice(0, 10),
      country: clip(input.country, 2).toUpperCase(), region: clip(input.region, 100), rateId: input.rateId == null || input.rateId === '' ? null : clip(input.rateId, 80),
      customer: { name: clip(c.name, 200), email: clip(c.email, 200), phone: clip(c.phone, 50), address: clip(c.address, 500) }, note: clip(input.note, 1000),
      returnUrl: clip(input.returnUrl, 2000), turnstileToken: clip(input.turnstileToken, 2048), sessionRef: clip(input.sessionRef, 64),
      expectedTotal: input.expectedTotal == null || !isFinite(+input.expectedTotal) ? null : +input.expectedTotal,
    };
  }
  /** location.search of a page Stripe sent the shopper back to → { status: 'success'|'cancel'|null, sessionId, orderId }. */
  function payReturn(search) {
    var q = {};
    String(search || '').replace(/^\?/, '').split('&').forEach(function (kv) {
      var i = kv.indexOf('='); if (i <= 0) return;
      try { q[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' ')); } catch (e) { /* malformed */ }
    });
    var st = q.zt_checkout === 'success' || q.zt_checkout === 'cancel' ? q.zt_checkout : null;
    return { status: st, sessionId: /^cs_[A-Za-z0-9_]{8,250}$/.test(q.session_id || '') ? q.session_id : '', orderId: /^[0-9a-f-]{36}$/i.test(q.order || '') ? q.order : '' };
  }
  /** One analytics event for the `track` function (types as in commerce.analytics.events). */
  function trackEvent(e) {
    e = e || {};
    var o = { type: clip(e.type, 30), path: clip(e.path, 200), at: e.at || new Date().toISOString() };
    if (e.productId) o.productId = clip(e.productId, 80);
    if (e.variantId) o.variantId = clip(e.variantId, 80);
    if (e.quantity) o.quantity = Math.max(0, Math.min(9999, Math.round(+e.quantity || 0)));
    if (e.value) o.value = Math.round((+e.value || 0) * 100) / 100;
    if (e.type === 'visit') { o.tz = clip(e.tz, 60); o.lang = clip(e.lang, 20); o.referrer = clip(e.referrer, 200); if (e.utm) o.utm = e.utm; }
    return o;
  }
  return { ratesFor: ratesFor, taxRateFor: taxRateFor, computeTax: computeTax, totals: totals, payReady: payReady, payPayload: payPayload, payReturn: payReturn, trackEvent: trackEvent };
}

/** `var CK = commerceKit(applyDiscounts)`, with the admin's discount engine embedded verbatim (storefront + backend). */
export function commerceEngineSource() {
  return `var CK = (function () {\n${toMs.toString()}\n${discountStatus.toString()}\n${applyDiscounts.toString()}\nreturn (${commerceKit.toString()})(${applyDiscounts.name});\n})();\n`;
}

/**
 * Storefront source: the engine (`var CK`) + the payment/analytics layer. It boots on the next tick next to the store
 * runtime (render.js storeScript() declares `K` and `D` in the same scope); CK.payRuntime(K, CK, D, window, document)
 * can also be called directly — it runs once per page.
 */
export function commerceScript() {
  return commerceEngineSource() + `CK.payRuntime = ${payRuntime.toString()};
if (typeof window !== 'undefined' && window.document) window.setTimeout(function () { if (typeof D !== 'undefined' && typeof K !== 'undefined') CK.payRuntime(K, CK, D, window, document); }, 0);
`;
}

/**
 * Browser layer of online payments + first-party analytics (serialised into assets/store.js; must stay self-contained).
 * K = cartKit(), CK = commerce kit, D = runtime data (D.commerce.pay = payConfig()). Reads the cart the store runtime
 * keeps in localStorage ('zstore-cart:<id>', codes 'zstore-codes:<id>', shipping 'zstore-ship:<id>') and nudges the
 * runtime to re-render with a synthetic `storage` event.
 */
export function payRuntime(K, CK, D, win, doc) {
  var cfg = D && D.commerce, pay = cfg && cfg.pay;
  if (!pay || win.__ztPay) return;
  win.__ztPay = true;
  var root = doc.documentElement.getAttribute('data-root') || '';
  var KEY = 'zstore-cart:' + D.id, CKEY = 'zstore-codes:' + D.id, AKEY = 'zstore-ship:' + D.id, OKEY = 'zstore-co:' + D.id, SKEY = 'zt-sid:' + D.id;
  var $ = function (sel, el) { return (el || doc).querySelector(sel); };
  var $$ = function (sel, el) { return Array.prototype.slice.call((el || doc).querySelectorAll(sel)); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  function get(area, k, d) { try { var v = JSON.parse(win[area].getItem(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } }
  function set(area, k, v) { try { if (v == null) win[area].removeItem(k); else win[area].setItem(k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } }
  function rerender() { try { win.dispatchEvent(new win.StorageEvent('storage', { key: KEY })); } catch (e) { /* old browser */ } }
  function headers(json) {
    var h = json ? { 'Content-Type': 'application/json' } : {};
    if (pay.anonKey) { h.apikey = pay.anonKey; if (/^eyJ/.test(pay.anonKey)) h.Authorization = 'Bearer ' + pay.anonKey; }
    return h;
  }
  var path = doc.documentElement.getAttribute('data-path') || (win.location.pathname.split('/').pop() || 'index.html');

  // ---------- first-party analytics → backend `track` (cookieless; waits for consent when a banner is configured) ----------
  var nav = win.navigator || {};
  var canTrack = !!pay.trackUrl && !D.preview && !nav.globalPrivacyControl && nav.doNotTrack !== '1' && win.doNotTrack !== '1';
  function startTracking() {
    var sid = get('sessionStorage', SKEY, ''), q = [], timer = null;
    if (!sid) { sid = 's_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); set('sessionStorage', SKEY, sid); }
    function flush() {
      timer = null; if (!q.length) return;
      var body = JSON.stringify({ storeId: D.id, sessionId: sid, events: q.splice(0, 20) }), sent = false;
      try { if (nav.sendBeacon && win.Blob) sent = nav.sendBeacon(pay.trackUrl, new win.Blob([body], { type: 'text/plain;charset=UTF-8' })); } catch (e) { sent = false; }
      if (!sent && win.fetch) try { win.fetch(pay.trackUrl, { method: 'POST', mode: 'no-cors', keepalive: true, headers: { 'Content-Type': 'text/plain' }, body: body }).catch(function () {}); } catch (e) { /* never block the page */ }
      if (q.length) timer = win.setTimeout(flush, 300);
    }
    function push(e) { e.path = e.path || path; q.push(CK.trackEvent(e)); if (!timer) timer = win.setTimeout(flush, 1200); }
    if (!get('sessionStorage', SKEY + ':v', false)) {
      set('sessionStorage', SKEY + ':v', true);
      var utm = {}, tz = '', ref = '';
      String(win.location.search).replace(/^\?/, '').split('&').forEach(function (kv) { var p = kv.split('='); if (/^utm_(source|medium|campaign|content|term)$/.test(p[0])) try { utm[p[0].slice(4)] = decodeURIComponent(p[1] || '').slice(0, 100); } catch (e) { /* bad escape */ } });
      try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { tz = ''; }
      try { ref = doc.referrer ? new URL(doc.referrer).origin : ''; } catch (e) { ref = ''; }
      if (ref === win.location.origin) ref = '';
      push({ type: 'visit', tz: tz, lang: nav.language || '', referrer: ref, utm: Object.keys(utm).length ? utm : null });
    }
    push({ type: 'page_view' });
    var pm = /^products\/.+\.html$/.test(path) && D.products.filter(function (p) { return p.url === path; })[0];
    if (pm) push({ type: 'view_product', productId: pm.id });
    if (path === 'checkout.html') push({ type: 'checkout_started' });
    var qty = function () { var n = 0; K.normalize(get('localStorage', KEY, []), D).forEach(function (l) { n += l.qty; }); return n; }, last = qty();
    win.setInterval(function () { var n = qty(); if (n > last) push({ type: 'add_to_cart', quantity: n - last }); last = n; }, 1500);
    win.addEventListener('pagehide', flush);
    doc.addEventListener('visibilitychange', function () { if (doc.visibilityState === 'hidden') flush(); });
  }
  if (canTrack) { if (win.ztConsent && typeof win.ztConsent.run === 'function') win.ztConsent.run(startTracking); else startTracking(); }

  // ---------- Stripe Checkout ----------
  if (!CK.payReady(cfg, D.checkout.mode) || !win.fetch) return;
  var ret = CK.payReturn(win.location.search);
  var LOCK = '<svg class="ico" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';

  function renderTurnstile(el) {
    if (!pay.turnstileSiteKey || el.__ztTs) return;
    function go() {
      if (!win.turnstile || typeof win.turnstile.render !== 'function' || el.__ztTs) return !!el.__ztTs;
      el.__ztTs = true;
      try { el.__ztId = win.turnstile.render(el, { sitekey: pay.turnstileSiteKey, action: 'checkout' }); } catch (e) { /* widget error: the server will refuse the payment */ }
      return true;
    }
    if (go()) return;
    if (!$('script[src*="challenges.cloudflare.com/turnstile"]')) { var s = doc.createElement('script'); s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; s.async = true; doc.head.appendChild(s); }
    var n = 0, t = win.setInterval(function () { if (go() || ++n > 150) win.clearInterval(t); }, 200);
  }
  function enhance(scope) {
    $$('[data-checkout]', scope && scope.querySelectorAll ? scope : doc).forEach(function (box) {
      if (box.__ztPay) return; box.__ztPay = true;
      var col = $('.co-form', box) || box, form = $('[data-checkout-form]', box), result = $('[data-checkout-result]', box);
      $$('.note.warn', col).forEach(function (n) { if (/not set up the order contact/.test(n.textContent)) n.remove(); });
      var how = $('.sec-sub', col); if (how) how.textContent = 'You pay on Stripe’s secure checkout page. Cards, wallets and local payment methods are accepted.';
      $$('.note.small', col).forEach(function (n) { if (/Payments are handled outside/.test(n.textContent)) n.innerHTML = LOCK + ' Payments are processed securely by Stripe. This site never sees your card details.'; });
      if (!form) {
        $$('[data-pay-links]', col).forEach(function (n) { n.hidden = true; });
        form = doc.createElement('form'); form.className = 'form'; form.setAttribute('data-checkout-form', ''); form.setAttribute('data-zt-pay-form', '');
        form.innerHTML = '<label>Email<input name="email" type="email" autocomplete="email"></label><div data-ship-fields></div><button class="btn btn-lg btn-wide" type="submit">Pay</button>';
        col.insertBefore(form, result || null);
        rerender();
      }
      var btn = $('button[type=submit]', form);
      if (btn) { btn.innerHTML = LOCK + ' Continue to secure payment'; btn.setAttribute('data-zt-pay', ''); }
      var msg = doc.createElement('p'); msg.className = 'note warn'; msg.setAttribute('data-zt-pay-msg', ''); msg.setAttribute('role', 'alert'); msg.hidden = true;
      form.insertBefore(msg, btn || null);
      var svc = doc.createElement('div'); svc.setAttribute('data-zt-services', ''); form.insertBefore(svc, msg); renderServices(svc);
      if (pay.turnstileSiteKey) { var ts = doc.createElement('div'); ts.className = 'zt-turnstile'; ts.setAttribute('data-zt-turnstile', ''); ts.setAttribute('data-sitekey', pay.turnstileSiteKey); ts.setAttribute('data-action', 'checkout'); form.insertBefore(ts, msg); renderTurnstile(ts); }
      if (ret.status === 'success') showSuccess(box);
    });
  }
  // services in the cart: booking time (free slots from the backend), intake questions, paid extras
  function renderServices(el) {
    var S = cfg.services || {}, ls = K.lines(K.normalize(get('localStorage', KEY, []), D), D).filter(function (l) { return S[l.pid]; });
    if (!ls.length) { el.innerHTML = ''; return; }
    el.innerHTML = ls.map(function (l) {
      var s = S[l.pid], h = '<fieldset class="shipf zt-svc" data-zt-svc="' + esc(l.pid + '|' + l.vid) + '"><legend>' + esc(l.product.title) + '</legend>';
      if (s.booking) h += '<label>Date<select data-zt-day><option value="">Loading times…</option></select></label><label>Time<select data-zt-slot required><option value="">Choose a date first</option></select></label><p class="note small">Times in ' + esc(s.timezone) + ' · ' + s.durationMinutes + ' min</p>';
      s.intake.forEach(function (q) {
        var req = q.required ? ' required' : '', lab = esc(q.label) + (q.required ? ' *' : ''), at = ' data-zt-q="' + esc(q.label) + '"' + req;
        if (q.type === 'textarea') h += '<label>' + lab + '<textarea rows="3"' + at + '></textarea></label>';
        else if (q.type === 'select') h += '<label>' + lab + '<select' + at + '><option value="">Choose…</option>' + q.options.map(function (o) { return '<option>' + esc(o) + '</option>'; }).join('') + '</select></label>';
        else if (q.type === 'checkbox') h += '<label class="chk"><input type="checkbox"' + at + '> ' + lab + '</label>';
        else h += '<label>' + lab + '<input type="' + (q.type === 'email' ? 'email' : q.type === 'url' ? 'url' : 'text') + '"' + at + '></label>';
      });
      if (s.addOns.length) h += '<div class="zt-addons" role="group" aria-label="Extras for ' + esc(l.product.title) + '">' + s.addOns.map(function (a) { return '<label class="chk"><input type="checkbox" data-zt-addon="' + esc(a.id) + '"> ' + esc(a.name) + ' <b>+' + esc(K.formatMoney(a.price, D.currency)) + '</b></label>'; }).join('') + '<p class="note small">Extras are added to the total on the payment page.</p></div>';
      return h + '</fieldset>';
    }).join('');
    $$('[data-zt-svc]', el).forEach(function (fs) {
      var pid = fs.getAttribute('data-zt-svc').split('|')[0], day = $('[data-zt-day]', fs), slot = $('[data-zt-slot]', fs);
      if (!day) return;
      if (D.preview) { day.innerHTML = '<option value="">Times are shown on the published store</option>'; return; }
      win.fetch(pay.stripe.slotsUrl + '?store=' + encodeURIComponent(D.id) + '&product=' + encodeURIComponent(pid) + '&days=21', { headers: headers(false) })
        .then(function (r) { return r.ok ? r.json() : { slots: [] }; }, function () { return { slots: [] }; })
        .then(function (j) {
          var by = {}, order = [], tz = j.timezone || 'UTC';
          (j.slots || []).forEach(function (x) { if (!by[x.date]) { by[x.date] = []; order.push(x.date); } by[x.date].push(x); });
          var fmt = function (iso, o) { try { o.timeZone = tz; return new Intl.DateTimeFormat(undefined, o).format(new Date(iso)); } catch (e) { return iso; } };
          day.innerHTML = order.length ? '<option value="">Choose a date</option>' + order.map(function (d) { return '<option value="' + d + '">' + esc(fmt(by[d][0].start, { weekday: 'short', day: 'numeric', month: 'short' })) + '</option>'; }).join('') : '<option value="">No free times in the next 3 weeks</option>';
          day.onchange = function () { slot.innerHTML = '<option value="">Choose a time</option>' + (by[day.value] || []).map(function (x) { return '<option value="' + esc(x.start) + '">' + esc(fmt(x.start, { hour: '2-digit', minute: '2-digit' })) + '</option>'; }).join(''); };
        });
    });
  }
  function serviceDetails(form, pid, vid) {
    var fs = $$('[data-zt-svc]', form).filter(function (x) { return x.getAttribute('data-zt-svc') === pid + '|' + vid; })[0];
    if (!fs) return null;
    var slot = $('[data-zt-slot]', fs);
    return {
      start: slot ? slot.value : '',
      intake: $$('[data-zt-q]', fs).map(function (q) { return { question: q.getAttribute('data-zt-q'), answer: q.type === 'checkbox' ? (q.checked ? 'Yes' : '') : q.value }; }).filter(function (a) { return a.answer; }),
      addOns: $$('[data-zt-addon]', fs).filter(function (c) { return c.checked; }).map(function (c) { return c.getAttribute('data-zt-addon'); }),
    };
  }
  function showSuccess(box) {
    $$('[data-checkout-form]', box).forEach(function (f) { f.hidden = true; });
    var res = $('[data-checkout-result]', box); if (!res) return;
    res.hidden = false;
    res.innerHTML = '<div class="zt-paid" data-zt-paid role="status"><p><strong>Thank you — your payment was received.</strong></p><p data-zt-order-status>We are confirming your order. You will receive a confirmation email shortly.</p>' +
      (ret.sessionId ? '<p class="note small">Payment reference: …' + esc(ret.sessionId.slice(-12)) + '</p>' : '') + '</div>';
  }
  function pollStatus(n) {
    if (!ret.sessionId || !pay.stripe.statusUrl) return;
    win.fetch(pay.stripe.statusUrl + '?store=' + encodeURIComponent(D.id) + '&session_id=' + encodeURIComponent(ret.sessionId), { headers: headers(false) })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        var o = j && j.order;
        if (o && (o.financialStatus === 'paid' || o.financialStatus === 'authorized')) {
          $$('[data-zt-order-status]').forEach(function (el) { el.innerHTML = '<strong>Order #' + esc(o.number) + '</strong> is confirmed' + (o.total != null ? ' — ' + esc(K.formatMoney(o.total, { code: o.currency || D.currency.code, locale: D.currency.locale })) : '') + '.' + (o.email ? ' A confirmation is on its way to ' + esc(o.email) + '.' : ''); });
        } else if (n < 6) win.setTimeout(function () { pollStatus(n + 1); }, 2000);
      }, function () { if (n < 6) win.setTimeout(function () { pollStatus(n + 1); }, 3000); });
  }
  if (ret.status === 'success') {
    set('localStorage', KEY, []); set('localStorage', CKEY, null); set('sessionStorage', OKEY, null);
    rerender(); pollStatus(0);
  } else if (ret.status === 'cancel') {
    var where = $('[data-cart-page]') || $('[data-checkout-result]');
    if (where) {
      var note = doc.createElement('p'); note.className = 'note'; note.setAttribute('data-zt-pay-cancel', ''); note.setAttribute('role', 'status');
      note.textContent = 'Payment cancelled — nothing was charged. Your cart is saved, so you can try again whenever you are ready.';
      if (where.hasAttribute('data-checkout-result')) { where.hidden = false; where.appendChild(note); } else where.parentNode.insertBefore(note, where);
    }
  }
  enhance(doc);
  if (typeof win.__storeHydrate === 'function') { var hy = win.__storeHydrate; win.__storeHydrate = function (n) { hy(n); enhance(n); }; }

  function startPay(form) {
    if (form.__ztBusy) return;
    var box = form.closest('[data-checkout]') || doc, btn = $('[data-zt-pay]', form), msg = $('[data-zt-pay-msg]', form), ts = $('[data-zt-turnstile]', form);
    var label = btn ? btn.innerHTML : '';
    function fail(text, offerFallback) {
      form.__ztBusy = false;
      if (btn) { btn.disabled = false; btn.removeAttribute('aria-busy'); btn.innerHTML = label; }
      if (ts && win.turnstile && ts.__ztId != null) try { win.turnstile.reset(ts.__ztId); } catch (e) { /* ignore */ }
      if (!msg) return;
      msg.hidden = false; msg.textContent = text;
      var mode = D.checkout.mode;
      if (offerFallback && (mode === 'whatsapp' || mode === 'email') && !$('[data-zt-pay-fallback]', msg)) {
        var b = doc.createElement('button'); b.type = 'button'; b.className = 'link'; b.setAttribute('data-zt-pay-fallback', '');
        b.textContent = mode === 'whatsapp' ? 'Send the order on WhatsApp instead' : 'Send the order by email instead';
        b.addEventListener('click', function () { form.__ztBypass = true; if (form.requestSubmit) form.requestSubmit(); else form.submit(); form.__ztBypass = false; });
        msg.appendChild(doc.createTextNode(' ')); msg.appendChild(b);
      }
    }
    if (msg) { msg.hidden = true; msg.textContent = ''; }
    var ls = K.lines(K.normalize(get('localStorage', KEY, []), D), D);
    if (!ls.length) return fail('Your cart is empty.');
    var a = get('localStorage', AKEY, {}) || {}, codes = get('localStorage', CKEY, []);
    var lines = ls.map(function (l) { return { productId: l.pid, variantId: l.vid, quantity: l.qty, price: K.fromCents(l.unitCents) }; });
    var sum = CK.totals(cfg, lines, { codes: Array.isArray(codes) ? codes : [], country: a.country || '', region: a.region || '', rateId: a.rateId }, Date.now());
    for (var i = 0; i < lines.length; i++) {
      var sd = serviceDetails(form, lines[i].productId, lines[i].variantId); if (!sd) continue;
      if ((cfg.services[lines[i].productId] || {}).booking && !sd.start) return fail('Choose a date and time for “' + ls[i].product.title + '”.');
      lines[i].start = sd.start || null; lines[i].intake = sd.intake; lines[i].addOns = sd.addOns;
    }
    var token = '';
    if (ts && pay.turnstileSiteKey) { var ti = $('input[name="cf-turnstile-response"]', ts); token = ti ? ti.value : ''; if (!token) return fail('Please complete the security check above.'); }
    if (D.preview) return fail('Card payment opens Stripe on your published store; it is not available in this preview.');
    var coId = get('sessionStorage', OKEY, '');
    if (!coId) { coId = 'co_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12); set('sessionStorage', OKEY, coId); }
    var fd = {}; ['name', 'email', 'phone', 'address', 'notes'].forEach(function (k) { var el = form.elements[k]; fd[k] = el ? el.value : ''; });
    var base = ''; try { base = new URL(root || './', win.location.href).href; } catch (e) { base = ''; }
    var body = CK.payPayload(cfg, D.id, lines, { checkoutId: coId, currency: D.currency.code, codes: codes, country: a.country, region: a.region, rateId: sum.shippingRateId,
      customer: fd, note: fd.notes, returnUrl: base, turnstileToken: token, sessionRef: get('sessionStorage', SKEY, ''), expectedTotal: sum.total });
    form.__ztBusy = true;
    if (btn) { btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.textContent = 'Redirecting to secure payment…'; }
    win.fetch(pay.stripe.endpoint, { method: 'POST', headers: headers(true), body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j || {} }; }); })
      .then(function (res) {
        if (res.ok && typeof res.j.url === 'string' && /^https?:\/\//.test(res.j.url)) { win.location.assign(res.j.url); return; }
        var err = res.j.error || {};
        if (err.code === 'shipping_required') { var sel = $('[data-ship-country]', box); if (sel) sel.focus(); }
        fail(err.message || 'The payment could not be started. Please try again.', !err.code);
      }, function () { fail('We could not reach the payment service. Check your connection and try again.', true); });
  }
  doc.addEventListener('submit', function (e) {
    var f = e.target;
    if (!f || !f.matches || !f.matches('[data-checkout] [data-checkout-form]') || f.__ztBypass) return;
    e.preventDefault(); e.stopImmediatePropagation();
    startPay(f);
  }, true);
}

/**
 * Catalog + checkout settings the backend trusts (body of POST sync-catalog). Prices, stock and discount rules come
 * from here — never from the shopper's browser. imageUrl(ref) → URL of an image ref (optional; only absolute https
 * URLs are kept); siteUrl defaults to https://<primary domain>.
 */
export function catalogSnapshot(store, commerce, { imageUrl, siteUrl } = {}) {
  const st = commerce?.settings || {}, sp = normalizeStripe(st.payments?.stripe), ig = normalizeIntegrations(st.integrations);
  const cfg = checkoutConfig(store, commerce) || {};
  const site = String(siteUrl || (st.domains?.primary ? 'https://' + String(st.domains.primary).replace(/^https?:\/\//, '').replace(/\/+$/, '') : '')).trim();
  const abs = ref => { const u = ref ? (imageUrl ? imageUrl(ref) : ref) : ''; try { const x = new URL(u, site || undefined); return x.protocol === 'https:' ? x.href : ''; } catch { return ''; } };
  const origin = (() => { try { return site ? new URL(site).origin : ''; } catch { return ''; } })();
  return {
    store: { id: store.id, name: store.name, currency: String(store.currency?.code || 'USD').toUpperCase(), siteUrl: site, allowedOrigins: origin ? [origin] : [] },
    config: { discounts: cfg.discounts || [], zones: cfg.zones || [], taxes: cfg.taxes || { inclusive: false, shippingTaxed: false, rates: [] }, weights: cfg.weights || {}, collections: cfg.collections || {}, countries: cfg.countries || [] },
    payments: { enabled: sp.enabled, mode: sp.mode, connectType: sp.connectType, applicationFeePercent: sp.applicationFeePercent, applicationFeeFixed: sp.applicationFeeFixed,
      captureMethod: sp.captureMethod, paymentMethods: sp.paymentMethods, statementDescriptor: sp.statementDescriptor, statementDescriptorSuffix: sp.statementDescriptorSuffix,
      currency: sp.currency, automaticTax: sp.automaticTax, threeDSecure: sp.threeDSecure, savePaymentMethods: sp.savePaymentMethods, billing: sp.billing },
    email: { provider: ig.email.provider, fromEmail: ig.email.fromEmail, replyTo: ig.email.replyTo, senderName: st.notifications?.senderName || store.name, orderPrefix: st.general?.orderPrefix ?? '#' },
    products: store.products.map(p => {
      const retainer = p.kind === 'service' && p.service?.pricing?.model === 'retainer';
      return {
        id: p.id, title: p.title, active: p.status === 'active', price: +p.price || 0, compareAt: p.compareAt ?? null, image: abs(p.images?.[0] || ''),
        kind: p.kind === 'service' || p.kind === 'digital' ? p.kind : 'physical', recurring: retainer ? { interval: 'month', intervalCount: 1 } : null,
        ...(p.kind === 'service' && p.service ? { service: p.service } : {}),
        // digital files the backend can serve: 'storage:<store id>/<file>' (Supabase Storage bucket digital-products) or an https URL
        ...(p.kind === 'digital' && p.digital ? { digital: { file: /^(storage:|https:\/\/)/.test(p.digital.file || '') ? p.digital.file : '', fileName: p.digital.fileName || '', downloadLimit: p.digital.downloadLimit ?? null } } : {}),
        variants: p.variants.map(v => ({ id: v.id, title: (v.options || []).filter(Boolean).join(' / '), options: v.options || [], price: v.price ?? null, sku: v.sku || '', stock: v.stock ?? null })),
      };
    }),
  };
}
