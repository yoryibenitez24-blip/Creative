// Browser runtime of the exported storefront (becomes assets/store.js).
//
// storeRuntime(K, D, win, doc) is serialised with Function.prototype.toString(), so it must stay
// self-contained: K = cartKit() (src/store/cart.js), D = runtime data (see cart.js header).
// Features: cart in localStorage, cart drawer, cart page, product variant selection + quantity,
// quick add, collection filters/sort, checkout per mode (WhatsApp / email / payment links),
// countdowns, carousels, mobile menu, tabs, mailto forms. In the builder preview (D.preview) internal
// links are reported to the parent window instead of navigating.

export function storeRuntime(K, D, win, doc) {
  var root = doc.documentElement.getAttribute('data-root') || '';
  doc.documentElement.classList.add('js');
  var reduce = win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var KEY = 'zstore-cart:' + D.id, memory = [];
  var $ = function (sel, el) { return (el || doc).querySelector(sel); };
  var $$ = function (sel, el) { return Array.prototype.slice.call((el || doc).querySelectorAll(sel)); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var abs = function (u) { return !u || /^(data:|blob:|https?:|\/)/.test(u) ? u : root + u; };
  var money = function (cents) { return K.formatMoney(K.fromCents(cents), D.currency); };
  function load() { try { var v = JSON.parse(win.localStorage.getItem(KEY) || '[]'); return K.normalize(v, D); } catch (e) { return K.normalize(memory, D); } }
  function save(c) { memory = c; try { win.localStorage.setItem(KEY, JSON.stringify(c)); } catch (e) { /* storage blocked: keep in memory */ } render(); }
  function go(url, newTab) {
    if (!/^mailto:/i.test(url) && (D.preview || newTab)) {
      var w = win.open(url, '_blank');
      if (w) { try { w.opener = null; } catch (e) { /* cross-origin */ } return; }
      if (D.preview) return; // popup blocked inside the preview: the visible link stays usable
    }
    win.location.href = url;
  }

  // ---------- cart rendering ----------
  function lineHtml(l, editable) {
    var p = l.product, img = imgTag(p);
    return '<li class="line" data-line="' + esc(l.pid + '|' + l.vid) + '">' + img + '<div class="line-info"><a href="' + esc(abs(p.url)) + '">' + esc(p.title) + '</a>' +
      (l.label ? '<small>' + esc(l.label) + '</small>' : '') + '<small>' + money(l.unitCents) + '</small>' +
      (editable ? '<div class="qty sm"><button type="button" data-line-step="-1" aria-label="Decrease quantity of ' + esc(p.title) + '">−</button><input type="number" min="0" max="999" value="' + l.qty + '" aria-label="Quantity of ' + esc(p.title) + '" data-line-qty><button type="button" data-line-step="1" aria-label="Increase quantity of ' + esc(p.title) + '">+</button></div><button type="button" class="link" data-line-remove>Remove</button>' : '<small>Qty ' + l.qty + '</small>') +
      '</div><strong class="line-total" data-line-total>' + money(l.totalCents) + '</strong></li>';
  }
  function imgTag(p) {
    if (!p.image) return '<span class="noimg"></span>';
    return '<img src="' + esc(abs(p.image)) + '" alt=""' + (p.fallback ? ' onerror="this.onerror=null;this.src=\'' + esc(abs(p.fallback)) + '\'"' : '') + '>';
  }
  // ---------- wishlist (localStorage) ----------
  var WKEY = 'zstore-wish:' + D.id, wmem = [];
  function wload() { var v; try { v = JSON.parse(win.localStorage.getItem(WKEY) || '[]'); } catch (e) { v = wmem; } return (Array.isArray(v) ? v : []).filter(function (id) { return K.product(D, id); }); }
  function wsave(v) { wmem = v; try { win.localStorage.setItem(WKEY, JSON.stringify(v)); } catch (e) { /* memory only */ } wrender(); }
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
  // ---------- overlays: cart / wishlist drawers, menu drawer, search ----------
  var lastFocus = null;
  function openLayer(el, focusSel) {
    if (!el) return;
    lastFocus = doc.activeElement; el.hidden = false; doc.body.classList.add('drawer-open');
    var f = $(focusSel || 'input,button', el); if (f) f.focus();
  }
  function closeLayers() {
    var any = false;
    $$('[data-drawer],[data-wish-drawer],[data-navdrawer],[data-search]').forEach(function (el) { if (!el.hidden) { el.hidden = true; any = true; } });
    if (any) { doc.body.classList.remove('drawer-open'); $$('[data-menu-toggle]').forEach(function (b) { b.setAttribute('aria-expanded', 'false'); }); if (lastFocus && lastFocus.focus) lastFocus.focus(); }
  }
  function render() {
    var ls = K.lines(load(), D), t = K.totals(ls);
    $$('[data-cart-count]').forEach(function (el) { el.textContent = t.count; el.hidden = !t.count; });
    $$('[data-cart-subtotal]').forEach(function (el) { el.textContent = money(t.subtotalCents); });
    var empty = '<p class="empty">Your cart is empty.</p>';
    $$('[data-drawer-lines]').forEach(function (el) { el.innerHTML = ls.length ? '<ul class="lines">' + ls.map(function (l) { return lineHtml(l, true); }).join('') + '</ul>' : empty; });
    $$('[data-drawer-foot]').forEach(function (el) { el.hidden = !ls.length; });
    $$('[data-cart-page]').forEach(function (el) {
      el.innerHTML = ls.length ? '<ul class="lines">' + ls.map(function (l) { return lineHtml(l, true); }).join('') + '</ul><div class="cart-sum"><p class="subtotal"><span>Subtotal</span><strong data-cart-subtotal>' + money(t.subtotalCents) + '</strong></p>' +
        (D.checkout.shippingNote ? '<p class="note">' + esc(D.checkout.shippingNote) + '</p>' : '') + '<a class="btn btn-wide" href="' + root + 'checkout.html">Checkout</a></div>' : '<p class="empty">' + esc(el.getAttribute('data-empty-text') || 'Your cart is empty.') + '</p>';
    });
    $$('[data-checkout-lines]').forEach(function (el) {
      el.innerHTML = ls.length ? '<ul class="lines">' + ls.map(function (l) { return lineHtml(l, false); }).join('') + '</ul><p class="subtotal"><span>Subtotal</span><strong data-checkout-total>' + money(t.subtotalCents) + '</strong></p>' : '<p class="empty">Your cart is empty. <a href="' + root + 'collections/all.html">Continue shopping</a></p>';
    });
    $$('[data-pay-links]').forEach(function (el) {
      var plan = K.paymentPlan(ls);
      el.innerHTML = plan.length ? '<ul class="paylist">' + plan.map(function (x) {
        return '<li><span>' + esc(x.title) + (x.qty > 1 ? ' × ' + x.qty : '') + '</span>' + (x.url ? '<a class="btn" href="' + esc(x.url) + '" target="_blank" rel="noopener">Pay now</a>' : '<span class="note">No payment link yet — please contact us.</span>') + '</li>';
      }).join('') + '</ul><p class="note small">Quantities above one: set the quantity on the payment page if it asks for it.</p>' : '';
    });
  }
  function openDrawer() {
    var d = $('[data-drawer]'); if (!d) { win.location.href = root + 'cart.html'; return; }
    closeLayers(); openLayer(d, '[data-drawer-close].x');
  }

  // ---------- product form ----------
  $$('[data-product-form]').forEach(function (form) {
    var p = K.product(D, form.getAttribute('data-product-form')); if (!p) return;
    var btn = $('[data-add-to-cart]', form), label = form.getAttribute('data-button-label') || 'Add to cart';
    function selected() { return p.options.map(function (o, k) { var r = $('input[name="opt' + k + '"]:checked', form); return r ? r.value : null; }); }
    function update() {
      var sel = selected(), v = K.findVariant(p, sel), price = v ? K.priceOf(p, v) : p.price;
      sel.forEach(function (val, k) { var o = $('[data-opt-value="' + k + '"]', form); if (o) o.textContent = val || ''; });
      var pr = $('[data-price]'); if (pr) pr.textContent = K.formatMoney(price, D.currency);
      var cmp = $('[data-compare]'); if (cmp) { var show = p.compareAt && p.compareAt > price; cmp.hidden = !show; cmp.textContent = show ? K.formatMoney(p.compareAt, D.currency) : ''; }
      var sku = $('[data-sku]', form); if (sku) sku.textContent = v ? v.sku : '';
      var st = $('[data-stock]', form); if (st) st.textContent = !v ? 'Unavailable' : v.stock == null ? 'In stock' : v.stock > 0 ? v.stock + ' in stock' : 'Out of stock';
      if (btn) { var ok = K.available(v); btn.disabled = !ok; btn.textContent = !v ? 'Unavailable' : ok ? label : 'Sold out'; }
      return v;
    }
    form.addEventListener('change', update);
    $$('[data-qty-step]', form).forEach(function (b) {
      b.addEventListener('click', function () { var q = $('input[name=qty]', form); q.value = Math.max(1, Math.min(999, (+q.value || 1) + +b.getAttribute('data-qty-step'))); });
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = update(); if (!K.available(v)) return;
      var q = Math.max(1, Math.floor(+($('input[name=qty]', form) || {}).value || 1));
      save(K.add(load(), D, p.id, v.id, q)); openDrawer();
    });
    update();
  });
  $$('[data-gallery]').forEach(function (g) {
    $$('[data-thumb]', g).forEach(function (t) {
      t.addEventListener('click', function () {
        var i = t.getAttribute('data-thumb');
        $$('[data-slide]', g).forEach(function (s) { s.hidden = s.getAttribute('data-slide') !== i; });
        $$('[data-thumb]', g).forEach(function (x) { x.removeAttribute('aria-current'); }); t.setAttribute('aria-current', 'true');
      });
    });
  });
  $$('[data-quick-add]').forEach(function (b) {
    b.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      var p = K.product(D, b.getAttribute('data-quick-add')), v = p && K.firstAvailable(p);
      if (v) { save(K.add(load(), D, p.id, v.id, 1)); openDrawer(); }
    });
  });

  // ---------- cart events (drawer + cart page share the markup) ----------
  doc.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target : e.target.parentElement;
    var open = t.closest('[data-cart-open]'); if (open && $('[data-drawer]')) { e.preventDefault(); render(); openDrawer(); return; }
    if (t.closest('[data-drawer-close],[data-menu-close],[data-search-close]')) { e.preventDefault(); closeLayers(); return; }
    if (t.closest('[data-wish-open]')) { e.preventDefault(); wrender(); closeLayers(); openLayer($('[data-wish-drawer]'), '[data-drawer-close].x'); return; }
    if (t.closest('[data-search-open]')) { e.preventDefault(); closeLayers(); openLayer($('[data-search]'), '[data-search-input]'); search(); return; }
    var wb = t.closest('[data-wish]');
    if (wb) { e.preventDefault(); e.stopPropagation(); var id = wb.getAttribute('data-wish'), w = wload(), i = w.indexOf(id); if (i >= 0) w.splice(i, 1); else w.push(id); wsave(w); return; }
    var wr = t.closest('[data-wish-remove]'); if (wr) { wsave(wload().filter(function (x) { return x !== wr.getAttribute('data-wish-remove'); })); return; }
    var line = t.closest('[data-line]'); if (!line) return;
    var key = line.getAttribute('data-line').split('|'), cart = load();
    var cur = cart.filter(function (l) { return l.pid === key[0] && l.vid === key[1]; })[0];
    if (t.closest('[data-line-remove]')) save(K.remove(cart, D, key[0], key[1]));
    else if (t.closest('[data-line-step]') && cur) save(K.setQty(cart, D, key[0], key[1], cur.qty + +t.closest('[data-line-step]').getAttribute('data-line-step')));
  });
  doc.addEventListener('change', function (e) {
    var t = e.target; if (!t.hasAttribute || !t.hasAttribute('data-line-qty')) return;
    var key = t.closest('[data-line]').getAttribute('data-line').split('|');
    save(K.setQty(load(), D, key[0], key[1], +t.value));
  });
  doc.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeLayers(); });
  win.addEventListener('storage', function (e) { if (e.key === KEY) render(); if (e.key === WKEY) wrender(); });
  function search() {
    var inp = $('[data-search-input]'), out = $('[data-search-results]'); if (!inp || !out) return;
    var q = inp.value.trim().toLowerCase();
    var hits = D.products.filter(function (p) { return !q || (p.title + ' ' + (p.category || '')).toLowerCase().indexOf(q) >= 0; }).slice(0, 12);
    out.innerHTML = hits.length ? hits.map(function (p) { return '<a href="' + esc(abs(p.url)) + '">' + imgTag(p) + '<span>' + esc(p.title) + '</span><small>' + K.formatMoney(p.price, D.currency) + '</small></a>'; }).join('') : '<p class="empty">No products match “' + esc(inp.value) + '”.</p>';
  }
  $$('[data-search-input]').forEach(function (inp) { inp.addEventListener('input', search); });

  // ---------- collection filters ----------
  $$('[data-collection]').forEach(function (box) {
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
      list.forEach(function (c) {
        var pr = +c.getAttribute('data-price'), ok = (!cat || c.getAttribute('data-category') === cat) && (isNaN(mn) || pr >= mn) && (isNaN(mx) || pr <= mx);
        c.hidden = !ok; if (ok) n++; grid.appendChild(c);
      });
      var cnt = $('[data-result-count]', box); if (cnt) cnt.textContent = n + (n === 1 ? ' product' : ' products');
      var em = $('[data-empty]', box); if (em) em.hidden = n > 0;
    }
    box.addEventListener('input', apply); box.addEventListener('change', apply);
    $$('[data-chip]', box).forEach(function (c) {
      c.addEventListener('click', function () {
        var sel = $('[data-filter-category]', box); if (sel) sel.value = c.getAttribute('data-chip');
        $$('[data-chip]', box).forEach(function (x) { x.setAttribute('aria-pressed', x === c); });
        apply();
      });
    });
    var cs = $('[data-filter-category]', box);
    if (cs) cs.addEventListener('change', function () { $$('[data-chip]', box).forEach(function (x) { x.setAttribute('aria-pressed', x.getAttribute('data-chip') === cs.value); }); });
  });

  // ---------- checkout ----------
  $$('[data-checkout]').forEach(function (box) {
    var form = $('[data-checkout-form]', box), result = $('[data-checkout-result]', box), mode = D.checkout.mode;
    if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var ls = K.lines(load(), D);
      if (!ls.length) { result.hidden = false; result.innerHTML = '<p class="note warn">Your cart is empty.</p>'; return; }
      var fd = {}; ['name', 'phone', 'email', 'address', 'notes'].forEach(function (k) { var el = form.elements[k]; fd[k] = el ? el.value : ''; });
      var text = K.orderText(ls, D, fd), url;
      if (mode === 'whatsapp') url = K.whatsappUrl(D.checkout.phone, text);
      else url = K.mailtoUrl(D.checkout.email, 'Order from ' + D.name + (fd.name ? ' — ' + fd.name : ''), text);
      result.hidden = false;
      result.innerHTML = '<p><strong>Almost done.</strong> ' + (mode === 'whatsapp' ? 'Send the prepared message in WhatsApp to place your order.' : 'Send the prepared email to place your order.') + '</p>' +
        '<a class="btn" data-order-link href="' + esc(url) + '"' + (mode === 'whatsapp' ? ' target="_blank" rel="noopener"' : '') + '>' + (mode === 'whatsapp' ? 'Open WhatsApp' : 'Open email') + '</a> <button type="button" class="link" data-clear-cart>Clear cart after ordering</button>';
      $('[data-clear-cart]', result).addEventListener('click', function () { save([]); result.innerHTML = '<p>Thank you! Your cart has been cleared.</p>'; });
      go(url, mode === 'whatsapp');
    });
  });

  // ---------- small widgets ----------
  $$('[data-countdown]').forEach(function (el) {
    var end = new Date(el.getAttribute('data-countdown')).getTime();
    function tick() {
      var s = Math.max(0, Math.floor((end - Date.now()) / 1000));
      var v = { d: Math.floor(s / 86400), h: Math.floor(s / 3600) % 24, m: Math.floor(s / 60) % 60, s: s % 60 };
      Object.keys(v).forEach(function (k) { var x = $('[data-cd="' + k + '"]', el); if (x) x.textContent = String(v[k]).padStart(2, '0'); });
      return s > 0;
    }
    if (isNaN(end)) return;
    tick(); var timer = win.setInterval(function () { if (!tick()) win.clearInterval(timer); }, 1000);
  });
  $$('[data-carousel-track]').forEach(function (track) {
    var sec = track.closest('section') || track.parentElement, hero = sec.hasAttribute('data-carousel');
    var n = track.children.length, dots = $$('[data-dot]', sec), counter = $('[data-counter]', sec);
    var index = function () { return Math.round(track.scrollLeft / Math.max(1, track.clientWidth)); };
    var go = function (i) { track.scrollTo({ left: ((i % n) + n) % n * track.clientWidth, behavior: reduce ? 'auto' : 'smooth' }); };
    var step = function (d) {
      if (hero) go(index() + d);
      else track.scrollBy({ left: d * Math.max(200, track.clientWidth * 0.8), behavior: reduce ? 'auto' : 'smooth' });
    };
    $$('[data-carousel-prev]', sec).forEach(function (b) { b.addEventListener('click', function () { step(-1); restart(); }); });
    $$('[data-carousel-next]', sec).forEach(function (b) { b.addEventListener('click', function () { step(1); restart(); }); });
    dots.forEach(function (d) { d.addEventListener('click', function () { go(+d.getAttribute('data-dot')); restart(); }); });
    var sync = function () {
      var i = index();
      dots.forEach(function (d, k) { if (k === i) d.setAttribute('aria-current', 'true'); else d.removeAttribute('aria-current'); });
      if (counter) counter.textContent = String(i + 1).padStart(2, '0') + ' / ' + String(n).padStart(2, '0');
    };
    track.addEventListener('scroll', function () { win.clearTimeout(track._t); track._t = win.setTimeout(sync, 60); });
    var ms = +sec.getAttribute('data-autoplay') || 0, timer = null, paused = false;
    function restart() { if (timer) win.clearInterval(timer); timer = null; if (ms && !reduce) timer = win.setInterval(function () { if (!paused && !doc.hidden) go(index() + 1); }, ms); }
    sec.addEventListener('mouseenter', function () { paused = true; }); sec.addEventListener('mouseleave', function () { paused = false; });
    sec.addEventListener('focusin', function () { paused = true; }); sec.addEventListener('focusout', function () { paused = false; });
    restart();
  });
  $$('[data-menu-toggle]').forEach(function (b) {
    b.addEventListener('click', function () { b.setAttribute('aria-expanded', 'true'); openLayer($('[data-navdrawer]'), '[data-menu-close].hicon'); });
  });
  // sticky header: solid + blurred background after scrolling
  $$('[data-header]').forEach(function (h) {
    var f = function () { h.classList.toggle('scrolled', win.scrollY > 8); };
    win.addEventListener('scroll', f, { passive: true }); f();
  });
  // reveal on scroll
  var rev = $$('[data-reveal]');
  if (rev.length) {
    if ('IntersectionObserver' in win && !reduce) {
      var io = new win.IntersectionObserver(function (es) { es.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } }); }, { rootMargin: '0px 0px -8% 0px' });
      rev.forEach(function (el) { io.observe(el); });
    } else rev.forEach(function (el) { el.classList.add('in'); });
  }
  $$('[data-tabs]').forEach(function (box) {
    var tabs = $$('[role=tab]', box);
    function sel(t) { tabs.forEach(function (x) { var on = x === t; x.setAttribute('aria-selected', on); x.tabIndex = on ? 0 : -1; doc.getElementById(x.getAttribute('aria-controls')).hidden = !on; }); }
    tabs.forEach(function (t, i) {
      t.addEventListener('click', function () { sel(t); });
      t.addEventListener('keydown', function (e) { var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if (d) { var n = tabs[(i + d + tabs.length) % tabs.length]; sel(n); n.focus(); } });
    });
  });
  $$('[data-mailto-form]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var to = form.getAttribute('data-mailto-form'), body = $$('input,textarea,select', form).filter(function (x) { return x.name; }).map(function (x) { return x.name[0].toUpperCase() + x.name.slice(1) + ': ' + x.value; }).join('\n');
      if (!to) return;
      go(K.mailtoUrl(to, form.getAttribute('data-subject') || 'Message', body));
    });
  });

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
  render(); wrender();
}
