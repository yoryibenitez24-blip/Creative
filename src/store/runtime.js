// Browser runtime of the exported storefront (becomes assets/store.js).
//
// storeRuntime(K, D, win, doc) is serialised with Function.prototype.toString(), so it must stay
// self-contained: K = cartKit() (src/store/cart.js), D = runtime data (see cart.js header).
// Features: cart (localStorage) with drawer, cart page and free-shipping progress, wishlist, search, recently viewed,
// product page (variants with sold-out states, image swatches, gallery + zoom + video, quantity, add to cart, buy now,
// sticky add-to-cart bar, low-stock alert, pay-later amount, dispatch timer, delivery dates, size-guide modal,
// sample-data pop-ups when the merchant enabled them), bundles, collection filters, checkout per mode, countdowns,
// carousels, menu drawer, reveal-on-scroll, mailto forms.
// Element behaviour is attached by hydrate(root); the builder preview calls window.__storeHydrate(node) after patching
// a part of the page in place, and window.__storeSetData(data) when products change. In the preview (D.preview)
// internal links are reported to the parent window instead of navigating.

export function storeRuntime(K, D, win, doc, CK) {
  var root = doc.documentElement.getAttribute('data-root') || '';
  doc.documentElement.classList.add('js');
  var reduce = win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var KEY = 'zstore-cart:' + D.id, WKEY = 'zstore-wish:' + D.id, RKEY = 'zstore-recent:' + D.id, mem = {};
  var $ = function (sel, el) { return (el || doc).querySelector(sel); };
  var $$ = function (sel, el) { var r = el || doc, out = Array.prototype.slice.call(r.querySelectorAll(sel)); if (r !== doc && r.matches && r.matches(sel)) out.unshift(r); return out; };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var abs = function (u) { return !u || /^(data:|blob:|https?:|\/)/.test(u) ? u : root + u; };
  var money = function (cents) { return K.formatMoney(K.fromCents(cents), D.currency); };
  var once = function (el, key) { var k = '__z' + key; if (el[k]) return false; el[k] = true; return true; };
  function getJSON(key, dflt) { try { var v = JSON.parse(win.localStorage.getItem(key) || 'null'); return v == null ? (mem[key] || dflt) : v; } catch (e) { return mem[key] || dflt; } }
  function setJSON(key, v) { mem[key] = v; try { win.localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* storage blocked: memory only */ } }
  function load() { return K.normalize(getJSON(KEY, []), D); }
  // ---------- commerce: discount codes, shipping & tax (D.commerce = checkoutConfig(); CK = commerce kit) ----------
  var CKEY = 'zstore-codes:' + D.id, AKEY = 'zstore-ship:' + D.id, lastMsg = {}, forceBox = false;
  function codes() { var v = getJSON(CKEY, []); return Array.isArray(v) ? v : []; }
  function ship() { var v = getJSON(AKEY, {}); return v && typeof v === 'object' ? v : {}; }
  function orderLines(ls) { return ls.map(function (l) { return { productId: l.pid, variantId: l.vid, title: l.product.title + (l.label ? ' (' + l.label + ')' : ''), sku: l.variant.sku, price: K.fromCents(l.unitCents), quantity: l.qty }; }); }
  function summary(ls) {
    if (!CK || !D.commerce || !ls.length) return null;
    var a = ship();
    return CK.totals(D.commerce, orderLines(ls), { codes: codes(), country: a.country || '', region: a.region || '', rateId: a.rateId }, Date.now());
  }
  function fm(n) { return K.formatMoney(n, D.currency); }
  function summaryHtml(sum, t, where) {
    if (!sum) return '<p class="subtotal"><span>Subtotal</span><strong data-cart-subtotal' + (where === 'checkout' ? ' data-checkout-total' : '') + '>' + money(t.subtotalCents) + '</strong></p>';
    var rows = '<div class="sumrow"><span>Subtotal</span><span data-cart-subtotal>' + fm(sum.subtotal) + '</span></div>';
    sum.applied.forEach(function (x) { if (x.type !== 'free_shipping' && x.amount > 0) rows += '<div class="sumrow save" data-discount-line><span>' + esc(x.code ? 'Discount · ' + x.code : x.title || 'Discount') + '</span><span>−' + fm(x.amount) + '</span></div>'; });
    var freeShip = sum.applied.filter(function (x) { return x.type === 'free_shipping'; })[0];
    if (sum.shippingRateId) rows += '<div class="sumrow"><span>Shipping · ' + esc(sum.shippingName) + '</span><span>' + (sum.originalShipping > 0 && sum.shippingDiscount > 0 ? '<s>' + fm(sum.originalShipping) + '</s> ' : '') + (sum.shipping > 0 ? fm(sum.shipping) : 'Free') + '</span></div>';
    else rows += '<div class="sumrow muted"><span>Shipping</span><span>' + (freeShip ? 'Free' + (freeShip.code ? ' · ' + esc(freeShip.code) : '') : (D.commerce.zones || []).length ? 'Calculated at checkout' : '—') + '</span></div>';
    if (sum.tax > 0) rows += '<div class="sumrow muted"><span>' + esc(sum.taxName || 'Tax') + ' ' + sum.taxRate + '%' + (sum.taxInclusive ? ' (included)' : '') + '</span><span>' + fm(sum.tax) + '</span></div>';
    rows += '<div class="sumrow total"><span>Total</span><strong' + (where === 'checkout' ? ' data-checkout-total' : '') + ' data-order-total>' + fm(sum.total) + '</strong></div>';
    return rows;
  }
  function discountBox(sum) {
    if (!CK || !D.commerce || !(D.commerce.discounts || []).some(function (d) { return d.method !== 'automatic'; }) && !codes().length) return '';
    var msgs = (sum ? sum.messages : []).concat(lastMsg.text ? [lastMsg] : []).filter(function (m, i, a) { return a.findIndex(function (x) { return x.text === m.text; }) === i; });
    return '<form class="dcode" data-discount-form><label class="sr" for="dc-' + Math.random().toString(36).slice(2, 7) + '">Discount code</label><input name="code" placeholder="Discount code" aria-label="Discount code" autocomplete="off" autocapitalize="characters"><button type="submit" class="btn btn-ghost">Apply</button></form>' +
      (codes().length ? '<ul class="dchips">' + codes().map(function (c) { return '<li>' + esc(c) + '<button type="button" data-code-remove="' + esc(c) + '" aria-label="Remove discount code ' + esc(c) + '">×</button></li>'; }).join('') + '</ul>' : '') +
      msgs.map(function (m) { return '<p class="note ' + (m.level === 'error' ? 'warn' : '') + '" role="status" data-discount-msg>' + esc(m.text) + '</p>'; }).join('');
  }
  function applyCode(code) {
    code = String(code || '').trim().toUpperCase(); if (!code) return;
    var next = codes().filter(function (c) { return c !== code; }).concat([code]), ls = K.lines(load(), D), a = ship();
    var r = CK.totals(D.commerce, orderLines(ls), { codes: next, country: a.country || '', region: a.region || '', rateId: a.rateId }, Date.now());
    var bad = r.messages.filter(function (m) { return m.code === code && m.level === 'error' && /not a valid|not active|expired|usage limit|once per customer/.test(m.text); })[0];
    lastMsg = bad ? { level: 'error', text: bad.text } : r.appliedCodes.indexOf(code) >= 0 ? { level: 'info', text: '“' + code + '” applied.' } : {};
    if (!bad) setJSON(CKEY, next);
    forceBox = true; render(); forceBox = false;
  }
  function shipFields() {
    if (!CK || !D.commerce || !(D.commerce.zones || []).length) return '';
    var a = ship(), sum = summary(K.lines(load(), D)), rates = sum ? sum.rates : [];
    return '<fieldset class="shipf"><legend>Shipping</legend><label>Country<select name="country" data-ship-country><option value="">Choose…</option>' + D.commerce.countries.map(function (c) { return '<option value="' + esc(c[0]) + '"' + (a.country === c[0] ? ' selected' : '') + '>' + esc(c[1]) + '</option>'; }).join('') + '</select></label>' +
      '<label>State / region<input name="region" data-ship-region value="' + esc(a.region || '') + '" autocomplete="address-level1"></label>' +
      (a.country ? rates.length ? '<div class="rates" role="radiogroup" aria-label="Shipping method">' + rates.map(function (r) { return '<label class="rate"><input type="radio" name="rate" value="' + esc(r.id) + '"' + (sum.shippingRateId === r.id ? ' checked' : '') + ' data-ship-rate><span>' + esc(r.name) + '</span><b>' + (r.price > 0 ? fm(r.price) : 'Free') + '</b></label>'; }).join('') + '</div>' : '<p class="note warn">We do not ship to this country yet.</p>' : '') + '</fieldset>';
  }
  function postOrder(ls, fd, sum) {
    var url = D.commerce && D.commerce.webhook; if (!url || !win.fetch) return;
    var t = K.totals(ls), body = JSON.stringify({ type: 'order', storeId: D.id, createdAt: new Date().toISOString(), currency: D.currency.code, source: 'storefront',
      customer: { name: fd.name || '', email: fd.email || '', phone: fd.phone || '', address: fd.address || '' }, lines: orderLines(ls), subtotal: K.fromCents(t.subtotalCents), note: fd.notes || '',
      codes: sum ? sum.appliedCodes : [], discountTotal: sum ? sum.discountTotal : 0, shipping: sum ? sum.shipping : 0, shippingName: sum ? sum.shippingName : '', country: (ship().country || ''), tax: sum ? sum.tax : 0, total: sum ? sum.total : K.fromCents(t.subtotalCents) });
    try {
      win.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true }).catch(function () {
        return win.fetch(url, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' }, body: body, keepalive: true });
      }).catch(function () { /* never block checkout */ });
    } catch (e) { /* never block checkout */ }
  }
  function save(c) { setJSON(KEY, c); render(); }
  function go(url, newTab) {
    if (!/^mailto:/i.test(url) && (D.preview || newTab)) {
      var w = win.open(url, '_blank');
      if (w) { try { w.opener = null; } catch (e) { /* cross-origin */ } return; }
      if (D.preview) return; // popup blocked inside the preview: the visible link stays usable
    }
    win.location.href = url;
  }
  function imgTag(p) {
    if (!p.image) return '<span class="noimg"></span>';
    return '<img src="' + esc(abs(p.image)) + '" alt=""' + (p.imageStyle ? ' style="' + esc(p.imageStyle) + '"' : '') + (p.fallback ? ' onerror="this.onerror=null;this.src=\'' + esc(abs(p.fallback)) + '\'"' : '') + '>';
  }

  // ---------- cart rendering ----------
  function lineHtml(l, editable) {
    var p = l.product;
    return '<li class="line" data-line="' + esc(l.pid + '|' + l.vid) + '">' + imgTag(p) + '<div class="line-info"><a href="' + esc(abs(p.url)) + '">' + esc(p.title) + '</a>' +
      (l.label ? '<small>' + esc(l.label) + '</small>' : '') + '<small>' + money(l.unitCents) + '</small>' +
      (editable ? '<div class="qty sm"><button type="button" data-line-step="-1" aria-label="Decrease quantity of ' + esc(p.title) + '">−</button><input type="number" min="0" max="999" value="' + l.qty + '" aria-label="Quantity of ' + esc(p.title) + '" data-line-qty><button type="button" data-line-step="1" aria-label="Increase quantity of ' + esc(p.title) + '">+</button></div><button type="button" class="link" data-line-remove>Remove</button>' : '<small>Qty ' + l.qty + '</small>') +
      '</div><strong class="line-total" data-line-total>' + money(l.totalCents) + '</strong></li>';
  }
  function render() {
    var ls = K.lines(load(), D), t = K.totals(ls), sum = summary(ls);
    $$('[data-summary]').forEach(function (el) { el.innerHTML = summaryHtml(sum, t, 'drawer'); });
    $$('[data-discount-box]').forEach(function (el) { if (forceBox || !el.contains(doc.activeElement)) el.innerHTML = ls.length ? discountBox(sum) : ''; });
    $$('[data-ship-fields]').forEach(function (el) { if (!el.contains(doc.activeElement) || doc.activeElement.type === 'radio') el.innerHTML = shipFields(); });
    $$('[data-cart-count]').forEach(function (el) { el.textContent = t.count; el.hidden = !t.count; });
    $$('[data-cart-subtotal]').forEach(function (el) { el.textContent = money(t.subtotalCents); });
    var empty = '<p class="empty">Your cart is empty.</p>';
    $$('[data-drawer-lines]').forEach(function (el) { el.innerHTML = ls.length ? '<ul class="lines">' + ls.map(function (l) { return lineHtml(l, true); }).join('') + '</ul>' : empty; });
    $$('[data-drawer-foot]').forEach(function (el) { el.hidden = !ls.length; });
    var free = K.toCents(D.checkout.freeShipping || 0);
    $$('[data-ship-bar]').forEach(function (el) {
      if (!free || !ls.length) { el.hidden = true; return; }
      var left = free - t.subtotalCents, pct = Math.min(100, Math.round(t.subtotalCents / free * 100));
      el.hidden = false;
      el.innerHTML = '<p>' + (left > 0 ? 'Add <b>' + money(left) + '</b> more for free shipping' : '<b>You have unlocked free shipping!</b>') + '</p><span class="ship-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '" aria-label="Progress to free shipping"><i style="width:' + pct + '%"></i></span>';
    });
    $$('[data-cart-page]').forEach(function (el) {
      el.innerHTML = ls.length ? '<ul class="lines">' + ls.map(function (l) { return lineHtml(l, true); }).join('') + '</ul><div class="cart-sum"><div data-discount-box>' + discountBox(sum) + '</div><div class="summary">' + summaryHtml(sum, t, 'cart') + '</div>' +
        (D.checkout.shippingNote ? '<p class="note">' + esc(D.checkout.shippingNote) + '</p>' : '') + '<a class="btn btn-wide" href="' + root + 'checkout.html">Checkout</a></div>' : '<p class="empty">' + esc(el.getAttribute('data-empty-text') || 'Your cart is empty.') + '</p>';
    });
    $$('[data-checkout-lines]').forEach(function (el) {
      el.innerHTML = ls.length ? '<ul class="lines">' + ls.map(function (l) { return lineHtml(l, false); }).join('') + '</ul><div data-discount-box>' + discountBox(sum) + '</div><div class="summary">' + summaryHtml(sum, t, 'checkout') + '</div>' : '<p class="empty">Your cart is empty. <a href="' + root + 'collections/all.html">Continue shopping</a></p>';
    });
    $$('[data-pay-links]').forEach(function (el) {
      var plan = K.paymentPlan(ls);
      el.innerHTML = plan.length ? '<ul class="paylist">' + plan.map(function (x) {
        return '<li><span>' + esc(x.title) + (x.qty > 1 ? ' × ' + x.qty : '') + '</span>' + (x.url ? '<a class="btn" href="' + esc(x.url) + '" target="_blank" rel="noopener">Pay now</a>' : '<span class="note">No payment link yet — please contact us.</span>') + '</li>';
      }).join('') + '</ul><p class="note small">Quantities above one: set the quantity on the payment page if it asks for it.</p>' : '';
    });
  }

  // ---------- wishlist + recently viewed ----------
  function wload() { var v = getJSON(WKEY, []); return (Array.isArray(v) ? v : []).filter(function (id) { return K.product(D, id); }); }
  function wsave(v) { setJSON(WKEY, v); wrender(); }
  function wrender() {
    var w = wload();
    $$('[data-wish-count]').forEach(function (el) { el.textContent = w.length; el.hidden = !w.length; });
    $$('[data-wish]').forEach(function (b) { b.setAttribute('aria-pressed', w.indexOf(b.getAttribute('data-wish')) >= 0); });
    $$('[data-wish-lines]').forEach(function (el) {
      el.innerHTML = w.length ? '<ul class="lines">' + w.map(function (id) {
        var p = K.product(D, id);
        return '<li class="line wish-item" data-wish-line="' + esc(id) + '">' + imgTag(p) + '<div class="line-info"><a href="' + esc(abs(p.url)) + '">' + esc(p.title) + '</a><small>' + K.formatMoney(p.price, D.currency) + '</small><a class="btn" href="' + esc(abs(p.url)) + '">View product</a></div><button type="button" class="link" data-wish-remove="' + esc(id) + '">Remove</button></li>';
      }).join('') + '</ul>' : '<p class="empty">Tap the heart on any product to save it here.</p>';
    });
  }
  function recent(scope) {
    $$('[data-recent]', scope).forEach(function (sec) {
      var cur = sec.getAttribute('data-recent'), list = getJSON(RKEY, []);
      if (!Array.isArray(list)) list = [];
      if (cur && once(sec, 'rv')) { list = [cur].concat(list.filter(function (x) { return x !== cur; })).slice(0, 12); setJSON(RKEY, list); }
      var show = list.filter(function (id) { return id !== cur && K.product(D, id); }).slice(0, 8), box = $('[data-recent-list]', sec);
      sec.hidden = !show.length;
      if (box) box.innerHTML = show.map(function (id) { var p = K.product(D, id); return '<a class="rcard" href="' + esc(abs(p.url)) + '">' + imgTag(p) + '<span>' + esc(p.title) + '</span><b>' + K.formatMoney(p.price, D.currency) + '</b></a>'; }).join('');
    });
  }

  // ---------- overlays: drawers, menu, search, modals ----------
  var lastFocus = null;
  function openLayer(el, focusSel) {
    if (!el) return;
    lastFocus = doc.activeElement; el.hidden = false; doc.body.classList.add('drawer-open');
    var f = $(focusSel || 'input,button', el); if (f) f.focus();
  }
  function closeLayers() {
    var any = false;
    $$('[data-drawer],[data-wish-drawer],[data-navdrawer],[data-search],[data-modal]').forEach(function (el) { if (!el.hidden) { el.hidden = true; any = true; } });
    if (any) { doc.body.classList.remove('drawer-open'); $$('[data-menu-toggle]').forEach(function (b) { b.setAttribute('aria-expanded', 'false'); }); if (lastFocus && lastFocus.focus) lastFocus.focus(); }
  }
  function openDrawer() {
    var d = $('[data-drawer]'); if (!d) { win.location.href = root + 'cart.html'; return; }
    closeLayers(); openLayer(d, '[data-drawer-close].x');
  }
  function search() {
    var inp = $('[data-search-input]'), out = $('[data-search-results]'); if (!inp || !out) return;
    var q = inp.value.trim().toLowerCase();
    var hits = D.products.filter(function (p) { return !q || (p.title + ' ' + (p.category || '')).toLowerCase().indexOf(q) >= 0; }).slice(0, 12);
    out.innerHTML = hits.length ? hits.map(function (p) { return '<a href="' + esc(abs(p.url)) + '">' + imgTag(p) + '<span>' + esc(p.title) + '</span><small>' + K.formatMoney(p.price, D.currency) + '</small></a>'; }).join('') : '<p class="empty">No products match “' + esc(inp.value) + '”.</p>';
  }

  // ---------- delegated events (work for parts patched in later) ----------
  doc.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target : e.target.parentElement; if (!t) return;
    var open = t.closest('[data-cart-open]'); if (open && $('[data-drawer]')) { e.preventDefault(); render(); openDrawer(); return; }
    if (t.closest('[data-drawer-close],[data-menu-close],[data-search-close],[data-modal-close]')) { e.preventDefault(); closeLayers(); return; }
    if (t.closest('[data-wish-open]')) { e.preventDefault(); wrender(); closeLayers(); openLayer($('[data-wish-drawer]'), '[data-drawer-close].x'); return; }
    if (t.closest('[data-search-open]')) { e.preventDefault(); closeLayers(); openLayer($('[data-search]'), '[data-search-input]'); search(); return; }
    if (t.closest('[data-menu-toggle]')) { var mt = t.closest('[data-menu-toggle]'); closeLayers(); mt.setAttribute('aria-expanded', 'true'); openLayer($('[data-navdrawer]'), '[data-menu-close].hicon'); return; }
    var mo = t.closest('[data-modal-open]'); if (mo) { e.preventDefault(); closeLayers(); openLayer(doc.getElementById(mo.getAttribute('data-modal-open')), '[data-modal-close].hicon'); return; }
    var qa = t.closest('[data-quick-add]');
    if (qa) { e.preventDefault(); e.stopPropagation(); var qp = K.product(D, qa.getAttribute('data-quick-add')), qv = qp && K.firstAvailable(qp); if (qv) { save(K.add(load(), D, qp.id, qv.id, 1)); openDrawer(); } return; }
    var wb = t.closest('[data-wish]');
    if (wb) { e.preventDefault(); e.stopPropagation(); var id = wb.getAttribute('data-wish'), w = wload(), i = w.indexOf(id); if (i >= 0) w.splice(i, 1); else w.push(id); wsave(w); return; }
    var cr = t.closest('[data-code-remove]'); if (cr) { e.preventDefault(); var rc = cr.getAttribute('data-code-remove'); lastMsg = {}; setJSON(CKEY, codes().filter(function (c) { return c !== rc; })); forceBox = true; render(); forceBox = false; return; }
    var pl = t.closest('[data-pay-links] a'); if (pl) { var pls = K.lines(load(), D); postOrder(pls, {}, summary(pls)); }
    var wr = t.closest('[data-wish-remove]'); if (wr) { wsave(wload().filter(function (x) { return x !== wr.getAttribute('data-wish-remove'); })); return; }
    var ba = t.closest('[data-bundle-add]');
    if (ba) {
      e.preventDefault(); var cart = load(), added = 0;
      $$('[data-bundle-item]', ba.closest('[data-bundle]')).forEach(function (cb) { if (!cb.checked) return; var p = K.product(D, cb.getAttribute('data-bundle-item')), v = p && K.firstAvailable(p); if (v) { cart = K.add(cart, D, p.id, v.id, 1); added++; } });
      if (added) { save(cart); openDrawer(); } return;
    }
    var sa = t.closest('[data-sticky-add]');
    if (sa) { var f = sa.closest('[data-sid]') && $('[data-product-form]', sa.closest('[data-sid]')); if (f) { var b = $('[data-add-to-cart]', f); if (f.requestSubmit) f.requestSubmit(b || undefined); else if (b) b.click(); } return; }
    var line = t.closest('[data-line]'); if (!line) return;
    var key = line.getAttribute('data-line').split('|'), c = load();
    var cur = c.filter(function (l) { return l.pid === key[0] && l.vid === key[1]; })[0];
    if (t.closest('[data-line-remove]')) save(K.remove(c, D, key[0], key[1]));
    else if (t.closest('[data-line-step]') && cur) save(K.setQty(c, D, key[0], key[1], cur.qty + +t.closest('[data-line-step]').getAttribute('data-line-step')));
  });
  doc.addEventListener('change', function (e) {
    var t = e.target; if (!t.hasAttribute) return;
    if (t.hasAttribute('data-line-qty')) { var key = t.closest('[data-line]').getAttribute('data-line').split('|'); save(K.setQty(load(), D, key[0], key[1], +t.value)); }
    if (t.hasAttribute('data-bundle-item')) bundleTotal(t.closest('[data-bundle]'));
  });
  doc.addEventListener('submit', function (e) {
    var f = e.target; if (!f.hasAttribute || !f.hasAttribute('data-discount-form')) return;
    e.preventDefault(); e.stopPropagation();
    var box = f.closest('[data-discount-box]'); applyCode(f.elements.code.value);
    var again = box && $('input[name=code]', box); if (again) again.focus();
  }, true);
  doc.addEventListener('change', function (e) {
    var t = e.target; if (!t.hasAttribute) return;
    var a = ship();
    if (t.hasAttribute('data-ship-country')) { a.country = t.value; a.rateId = null; setJSON(AKEY, a); render(); }
    else if (t.hasAttribute('data-ship-region')) { a.region = t.value; setJSON(AKEY, a); render(); }
    else if (t.hasAttribute('data-ship-rate')) { a.rateId = t.value; setJSON(AKEY, a); render(); }
  });
  doc.addEventListener('input', function (e) { if (e.target.hasAttribute && e.target.hasAttribute('data-search-input')) search(); });
  doc.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeLayers(); });
  win.addEventListener('storage', function (e) { if (e.key === KEY) render(); if (e.key === WKEY) wrender(); });
  // sticky header: solid + blurred background after scrolling
  var onScroll = function () { $$('[data-header]').forEach(function (h) { h.classList.toggle('scrolled', win.scrollY > 8); }); };
  win.addEventListener('scroll', onScroll, { passive: true });

  function bundleTotal(box) {
    if (!box) return;
    var sum = 0, n = 0;
    $$('[data-bundle-item]', box).forEach(function (cb) { if (cb.checked) { sum += K.toCents(+cb.getAttribute('data-price')); n++; } cb.closest('.bitem').classList.toggle('off', !cb.checked); });
    var tt = $('[data-bundle-total]', box); if (tt) tt.textContent = money(sum);
    var cn = $('[data-bundle-count]', box); if (cn) cn.textContent = n;
    var bt = $('[data-bundle-add]', box); if (bt) bt.disabled = !n;
  }
  function addBusinessDays(d, n) { d = new Date(d); while (n > 0) { d.setDate(d.getDate() + 1); if (d.getDay() % 6) n--; } return d; }
  function fmtDate(d) { try { return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }); } catch (e) { return d.toDateString(); } }

  // ---------- product form ----------
  function bindProduct(form) {
    var p = K.product(D, form.getAttribute('data-product-form')); if (!p) return;
    var sec = form.closest('[data-sid]') || doc, btn = $('[data-add-to-cart]', form), buyNow = $('[data-buy-now]', form);
    var label = btn ? btn.getAttribute('data-label') || btn.textContent : 'Add to cart';
    if (btn) btn.setAttribute('data-label', label);
    function selected() { return p.options.map(function (o, k) { var r = $('input[name="opt' + k + '"]:checked', form); return r ? r.value : null; }); }
    function availableWith(k, val, sel) {
      return p.variants.some(function (v) { if (!K.available(v) || v.options[k] !== val) return false; for (var j = 0; j < sel.length; j++) if (j !== k && sel[j] != null && v.options[j] !== sel[j]) return false; return true; });
    }
    function update() {
      var sel = selected(), v = K.findVariant(p, sel), price = v ? K.priceOf(p, v) : p.price, ok = K.available(v);
      sel.forEach(function (val, k) { var o = $('[data-opt-value="' + k + '"]', form); if (o) o.textContent = val || ''; });
      $$('input[type=radio][name^="opt"]', form).forEach(function (r) { var k = +r.name.slice(3); r.closest('.pill').classList.toggle('soldout', !availableWith(k, r.value, sel)); });
      $$('[data-price]', sec).forEach(function (el) { el.textContent = K.formatMoney(price, D.currency); });
      var showCmp = p.compareAt && p.compareAt > price;
      $$('[data-compare]', sec).forEach(function (el) { el.hidden = !showCmp; el.textContent = showCmp ? K.formatMoney(p.compareAt, D.currency) : ''; });
      $$('[data-saved]', sec).forEach(function (el) { el.hidden = !showCmp; el.textContent = showCmp ? 'Save ' + K.formatMoney(p.compareAt - price, D.currency) + ' (' + Math.round((1 - price / p.compareAt) * 100) + '%)' : ''; });
      $$('[data-bnpl]', sec).forEach(function (el) { el.innerHTML = esc(el.getAttribute('data-bnpl')).replace('{amount}', '<strong>' + K.formatMoney(Math.round(price * 25) / 100, D.currency) + '</strong>'); });
      $$('[data-low-stock]', sec).forEach(function (el) { var th = +el.getAttribute('data-low-stock') || 5, show = v && v.stock != null && v.stock > 0 && v.stock <= th; el.hidden = !show; var n = $('[data-left]', el); if (n && show) n.textContent = v.stock; });
      var sku = $('[data-sku]', form); if (sku) sku.textContent = v ? v.sku : '';
      var st = $('[data-stock]', form); if (st) st.textContent = !v ? 'Unavailable' : v.stock == null ? 'In stock' : v.stock > 0 ? v.stock + ' in stock' : 'Out of stock';
      if (btn) { btn.disabled = !ok; btn.textContent = !v ? 'Unavailable' : ok ? label : 'Sold out'; }
      if (buyNow) buyNow.disabled = !ok;
      $$('[data-sticky-add]', sec).forEach(function (b) { b.disabled = !ok; });
      return v;
    }
    form.addEventListener('change', function (e) {
      var im = e.target.getAttribute && e.target.getAttribute('data-image');
      if (im != null) showSlide($('[data-gallery]', sec), im);
      update();
    });
    $$('[data-qty-step]', form).forEach(function (b) {
      b.addEventListener('click', function () { var q = $('input[name=qty]', form); q.value = Math.max(1, Math.min(999, (+q.value || 1) + +b.getAttribute('data-qty-step'))); });
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = update(); if (!K.available(v)) return;
      var q = Math.max(1, Math.floor(+($('input[name=qty]', form) || {}).value || 1));
      save(K.add(load(), D, p.id, v.id, q));
      if (e.submitter && e.submitter.hasAttribute('data-buy-now')) { if (D.preview) win.parent.postMessage({ storeNav: root + 'checkout.html', from: doc.documentElement.getAttribute('data-path') }, '*'); else win.location.href = root + 'checkout.html'; }
      else openDrawer();
    });
    // sticky add-to-cart bar: visible once the main buy button has scrolled out of view
    var bar = $('[data-sticky-atc]', sec);
    if (bar && btn && 'IntersectionObserver' in win) {
      var io = new win.IntersectionObserver(function (es) { es.forEach(function (en) { var past = !en.isIntersecting && en.boundingClientRect.top < 0; bar.hidden = !past; bar.setAttribute('aria-hidden', String(!past)); }); });
      io.observe(btn);
    }
    update();
  }
  function showSlide(g, i) {
    if (!g) return; i = String(i);
    var slides = $$('[data-slide]', g), stack = g.classList.contains('pg-stack') || g.classList.contains('pg-editorial');
    if (stack) { var s = slides.filter(function (x) { return x.getAttribute('data-slide') === i; })[0]; if (s) s.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' }); return; }
    slides.forEach(function (s) { s.hidden = s.getAttribute('data-slide') !== i; var vid = $('video', s); if (vid && s.hidden) vid.pause(); });
    $$('[data-thumb]', g).forEach(function (x) { if (x.getAttribute('data-thumb') === i) x.setAttribute('aria-current', 'true'); else x.removeAttribute('aria-current'); });
  }

  // ---------- hydrate: attach behaviour to elements under `scope` (idempotent) ----------
  function hydrate(scope) {
    scope = scope || doc;
    $$('[data-product-form]', scope).forEach(function (f) { if (once(f, 'pf')) bindProduct(f); });
    $$('[data-gallery]', scope).forEach(function (g) {
      if (!once(g, 'g')) return;
      $$('[data-thumb]', g).forEach(function (t) { t.addEventListener('click', function () { showSlide(g, t.getAttribute('data-thumb')); }); });
      $$('[data-zoom]', g).forEach(function (z) {
        z.addEventListener('mousemove', function (e) { var r = z.getBoundingClientRect(); z.style.setProperty('--zx', ((e.clientX - r.left) / r.width * 100) + '%'); z.style.setProperty('--zy', ((e.clientY - r.top) / r.height * 100) + '%'); z.classList.add('zooming'); });
        z.addEventListener('mouseleave', function () { z.classList.remove('zooming'); });
      });
    });
    $$('[data-bundle]', scope).forEach(function (b) { if (once(b, 'b')) bundleTotal(b); });
    $$('[data-collection]', scope).forEach(function (box) {
      if (!once(box, 'c')) return;
      var grid = $('[data-collection-grid]', box); if (!grid) return;
      var cards = $$('[data-card]', grid);
      function apply() {
        var cat = ($('[data-filter-category]', box) || {}).value || '', mn = parseFloat(($('[data-filter-min]', box) || {}).value), mx = parseFloat(($('[data-filter-max]', box) || {}).value);
        var sort = ($('[data-sort]', box) || {}).value || 'featured', n = 0;
        var list = cards.slice().sort(function (a, b) {
          var pa = +a.getAttribute('data-price'), pb = +b.getAttribute('data-price');
          if (sort === 'price-asc') return pa - pb; if (sort === 'price-desc') return pb - pa;
          if (sort === 'title') return a.getAttribute('data-title').localeCompare(b.getAttribute('data-title'));
          return +a.getAttribute('data-index') - +b.getAttribute('data-index');
        });
        list.forEach(function (c) { var pr = +c.getAttribute('data-price'), ok = (!cat || c.getAttribute('data-category') === cat) && (isNaN(mn) || pr >= mn) && (isNaN(mx) || pr <= mx); c.hidden = !ok; if (ok) n++; grid.appendChild(c); });
        var cnt = $('[data-result-count]', box); if (cnt) cnt.textContent = n + (n === 1 ? ' product' : ' products');
        var em = $('[data-empty]', box); if (em) em.hidden = n > 0;
      }
      box.addEventListener('input', apply); box.addEventListener('change', apply);
      $$('[data-chip]', box).forEach(function (c) {
        c.addEventListener('click', function () { var sel = $('[data-filter-category]', box); if (sel) sel.value = c.getAttribute('data-chip'); $$('[data-chip]', box).forEach(function (x) { x.setAttribute('aria-pressed', x === c); }); apply(); });
      });
      var cs = $('[data-filter-category]', box);
      if (cs) cs.addEventListener('change', function () { $$('[data-chip]', box).forEach(function (x) { x.setAttribute('aria-pressed', x.getAttribute('data-chip') === cs.value); }); });
    });
    $$('[data-checkout]', scope).forEach(function (box) {
      var form = $('[data-checkout-form]', box), result = $('[data-checkout-result]', box), mode = D.checkout.mode;
      if (!form || !once(box, 'co')) return;
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var ls = K.lines(load(), D);
        if (!ls.length) { result.hidden = false; result.innerHTML = '<p class="note warn">Your cart is empty.</p>'; return; }
        var fd = {}; ['name', 'phone', 'email', 'address', 'notes'].forEach(function (k) { var el = form.elements[k]; fd[k] = el ? el.value : ''; });
        var sum = summary(ls), text = K.orderText(ls, D, fd, sum), url = mode === 'whatsapp' ? K.whatsappUrl(D.checkout.phone, text) : K.mailtoUrl(D.checkout.email, 'Order from ' + D.name + (fd.name ? ' — ' + fd.name : ''), text);
        result.hidden = false;
        result.innerHTML = '<p><strong>Almost done.</strong> ' + (mode === 'whatsapp' ? 'Send the prepared message in WhatsApp to place your order.' : 'Send the prepared email to place your order.') + '</p>' +
          '<a class="btn" data-order-link href="' + esc(url) + '"' + (mode === 'whatsapp' ? ' target="_blank" rel="noopener"' : '') + '>' + (mode === 'whatsapp' ? 'Open WhatsApp' : 'Open email') + '</a> <button type="button" class="link" data-clear-cart>Clear cart after ordering</button>';
        $('[data-clear-cart]', result).addEventListener('click', function () { save([]); result.innerHTML = '<p>Thank you! Your cart has been cleared.</p>'; });
        postOrder(ls, fd, sum);
        go(url, mode === 'whatsapp');
      });
    });
    $$('[data-countdown]', scope).forEach(function (el) {
      if (!once(el, 'cd')) return;
      var end = new Date(el.getAttribute('data-countdown')).getTime(); if (isNaN(end)) return;
      function tick() {
        var s = Math.max(0, Math.floor((end - Date.now()) / 1000)), v = { d: Math.floor(s / 86400), h: Math.floor(s / 3600) % 24, m: Math.floor(s / 60) % 60, s: s % 60 };
        Object.keys(v).forEach(function (k) { var x = $('[data-cd="' + k + '"]', el); if (x) x.textContent = String(v[k]).padStart(2, '0'); });
        return s > 0 && el.isConnected;
      }
      tick(); var timer = win.setInterval(function () { if (!tick()) win.clearInterval(timer); }, 1000);
    });
    $$('[data-dispatch]', scope).forEach(function (el) {
      if (!once(el, 'dp')) return;
      var cut = +el.getAttribute('data-dispatch'), span = $('span', el);
      function tick() {
        var now = new Date(), c = new Date(now); c.setHours(cut, 0, 0, 0);
        var wk = now.getDay() % 6 !== 0, left = c - now;
        if (wk && left > 0) { var h = Math.floor(left / 36e5), m = Math.floor(left / 6e4) % 60; span.innerHTML = 'Order within <b>' + (h ? h + ' h ' : '') + m + ' min</b> for dispatch today'; }
        else span.innerHTML = 'Order now for dispatch on <b>' + fmtDate(addBusinessDays(now, 1)) + '</b>';
        return el.isConnected;
      }
      tick(); var timer = win.setInterval(function () { if (!tick()) win.clearInterval(timer); }, 30000);
    });
    $$('[data-delivery]', scope).forEach(function (el) {
      var r = el.getAttribute('data-delivery').split(','), out = $('[data-delivery-dates]', el), now = new Date();
      if (out) out.textContent = fmtDate(addBusinessDays(now, +r[0] || 0)) + ' – ' + fmtDate(addBusinessDays(now, +r[1] || 0));
    });
    $$('[data-toasts]', scope).forEach(function (el) {
      if (!once(el, 'ts') || reduce) return;
      var msgs = []; try { msgs = JSON.parse(el.getAttribute('data-toasts')); } catch (e) { msgs = []; }
      var i = 0;
      function show() {
        if (!el.isConnected || !msgs.length) return;
        var t = doc.createElement('div'); t.className = 'toast'; t.innerHTML = '<span>' + esc(msgs[i++ % msgs.length]) + '</span><button type="button" aria-label="Dismiss">×</button>';
        t.querySelector('button').onclick = function () { t.remove(); };
        el.appendChild(t); win.setTimeout(function () { t.remove(); }, 5000); win.setTimeout(show, 14000);
      }
      win.setTimeout(show, 4000);
    });
    $$('[data-carousel-track]', scope).forEach(function (track) {
      if (!once(track, 'car')) return;
      var sec = track.closest('section') || track.parentElement, hero = sec.hasAttribute('data-carousel');
      var n = track.children.length, dots = $$('[data-dot]', sec), counter = $('[data-counter]', sec);
      var index = function () { return Math.round(track.scrollLeft / Math.max(1, track.clientWidth)); };
      var to = function (i) { track.scrollTo({ left: ((i % n) + n) % n * track.clientWidth, behavior: reduce ? 'auto' : 'smooth' }); };
      var step = function (d) { if (hero) to(index() + d); else track.scrollBy({ left: d * Math.max(200, track.clientWidth * 0.8), behavior: reduce ? 'auto' : 'smooth' }); };
      var ms = +sec.getAttribute('data-autoplay') || 0, timer = null, paused = false;
      function restart() { if (timer) win.clearInterval(timer); timer = null; if (ms && !reduce) timer = win.setInterval(function () { if (!track.isConnected) { win.clearInterval(timer); return; } if (!paused && !doc.hidden && !doc.documentElement.classList.contains('editing')) to(index() + 1); }, ms); }
      $$('[data-carousel-prev]', sec).forEach(function (b) { b.addEventListener('click', function () { step(-1); restart(); }); });
      $$('[data-carousel-next]', sec).forEach(function (b) { b.addEventListener('click', function () { step(1); restart(); }); });
      dots.forEach(function (d) { d.addEventListener('click', function () { to(+d.getAttribute('data-dot')); restart(); }); });
      var sync = function () {
        var i = index();
        dots.forEach(function (d, k) { if (k === i) d.setAttribute('aria-current', 'true'); else d.removeAttribute('aria-current'); });
        if (counter) counter.textContent = String(i + 1).padStart(2, '0') + ' / ' + String(n).padStart(2, '0');
      };
      track.addEventListener('scroll', function () { win.clearTimeout(track.__zt); track.__zt = win.setTimeout(sync, 60); });
      sec.addEventListener('mouseenter', function () { paused = true; }); sec.addEventListener('mouseleave', function () { paused = false; });
      sec.addEventListener('focusin', function () { paused = true; }); sec.addEventListener('focusout', function () { paused = false; });
      restart();
    });
    $$('[data-mailto-form]', scope).forEach(function (form) {
      if (!once(form, 'mf')) return;
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var to = form.getAttribute('data-mailto-form'), body = $$('input,textarea,select', form).filter(function (x) { return x.name; }).map(function (x) { return x.name[0].toUpperCase() + x.name.slice(1) + ': ' + x.value; }).join('\n');
        if (to) go(K.mailtoUrl(to, form.getAttribute('data-subject') || 'Message', body));
      });
    });
    var rev = $$('[data-reveal]', scope).filter(function (el) { return once(el, 'rv'); });
    if (rev.length) {
      if ('IntersectionObserver' in win && !reduce) {
        var io = new win.IntersectionObserver(function (es) { es.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } }); }, { rootMargin: '0px 0px -8% 0px' });
        rev.forEach(function (el) { io.observe(el); });
      } else rev.forEach(function (el) { el.classList.add('in'); });
    }
    recent(scope);
    render(); wrender(); onScroll();
  }
  win.__storeHydrate = hydrate;
  win.__storeSetData = function (nd) { Object.keys(D).forEach(function (k) { delete D[k]; }); Object.keys(nd).forEach(function (k) { D[k] = nd[k]; }); render(); wrender(); };

  // ---------- builder / new-tab preview: report internal navigation to the host ----------
  if (D.preview) {
    doc.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[href]'); if (!a || e.defaultPrevented) return;
      var href = a.getAttribute('href');
      if (/^(https?:|mailto:|tel:)/i.test(href)) { e.preventDefault(); win.open(href, '_blank', 'noopener'); return; }
      if (href.charAt(0) === '#') return;
      e.preventDefault();
      win.parent.postMessage({ storeNav: href, from: doc.documentElement.getAttribute('data-path') }, '*');
    });
  }
  hydrate(doc);
}
