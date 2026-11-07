// Discount engine. Pure, dependency-free and serialisable: no imports, no outer references, JSON in → JSON out,
// so it can run in the admin, in Node tests and (copied by the storefront runtime) in the shopper's browser.
//
// Discount = {
//   id, title, method: 'code'|'automatic', code: 'SAVE10' (case-insensitive match; '' for automatic),
//   type: 'percentage' | 'fixed' | 'free_shipping' | 'bxgy',
//   value: percent 0..100 (percentage) | amount (fixed: once per order, spread over the eligible lines),
//   appliesTo: { kind: 'all'|'products'|'collections', productIds: [], collectionIds: [] },
//       (for bxgy this is the "customer buys" set)
//   minimum: { kind: 'none'|'amount'|'quantity', value }   (measured on the eligible lines before discounts)
//   bxgy: { buyQuantity, getQuantity, getProductIds: [] (empty = same set as appliesTo), getPercent: 0..100 (100 = free), maxUses|null },
//   usageLimit: int|null (total uses), usageCount: int, oncePerCustomer: bool,
//   combinable: bool (may be stacked with other combinable product/order discounts; free shipping always stacks),
//   enabled: bool, startsAt: ISO|null, endsAt: ISO|null
// }
//
// applyDiscounts(cart, discounts, now) → {
//   lines: [{ ...line, lineTotal, discount, total, allocations: [{ discountId, amount }] }],
//   subtotal, discountTotal (item discounts), originalShipping, shippingDiscount, shipping (after discount),
//   total (= subtotal − discountTotal + shipping; taxes are added by the caller), appliedCodes: ['SAVE10'],
//   applied: [{ id, title, code, type, amount }], messages: [{ level: 'error'|'info', code, text }]
// }
// cart = { lines: [{ id, productId, variantId, price, quantity, collectionIds?: [] }], codes?: [], shipping?: number,
//          customerId?, customerUsage?: { [discountId]: timesUsedByThisCustomer } }
// now: Date | ms | ISO string (default: current time). All arithmetic is done in integer cents.
// Selection rule: the single best product/order discount applies; further ones apply only when both it and every
// already-applied discount are `combinable`. Each discount works on what is left of the line after earlier discounts,
// so the total discount can never exceed the subtotal.

export function discountStatus(d, now) {
  var t = toMs(now);
  if (!d || d.enabled === false) return 'disabled';
  if (d.startsAt && t < toMs(d.startsAt)) return 'scheduled';
  if (d.endsAt && t >= toMs(d.endsAt)) return 'expired';
  if (d.usageLimit != null && d.usageLimit !== '' && (+d.usageCount || 0) >= +d.usageLimit) return 'limit_reached';
  return 'active';
}

export function toMs(v) {
  if (v == null || v === '') return Date.now();
  if (typeof v === 'number') return v;
  var t = new Date(v).getTime();
  return isFinite(t) ? t : Date.now();
}

export function applyDiscounts(cart, discounts, now) {
  cart = cart || {};
  var t = toMs(now);
  var C = function (n) { return Math.round((+n || 0) * 100); };
  var M = function (c) { return Math.round(c) / 100; };
  var fmt = function (c) { return (Math.round(c) / 100).toFixed(2); };
  var lines = (Array.isArray(cart.lines) ? cart.lines : []).map(function (l) {
    var q = Math.max(0, Math.floor(+l.quantity || 0)), p = Math.max(0, C(l.price));
    return { src: l, unit: p, qty: q, base: p * q, left: p * q, alloc: {} };
  });
  var subtotal = 0; lines.forEach(function (l) { subtotal += l.base; });
  var shipC = Math.max(0, C(cart.shipping));
  var messages = [], usage = cart.customerUsage || {};
  var list = Array.isArray(discounts) ? discounts : [];

  function inSet(line, ids, cols) {
    if (ids && ids.indexOf(line.src.productId) >= 0) return true;
    var lc = line.src.collectionIds || [];
    if (cols) for (var i = 0; i < cols.length; i++) if (lc.indexOf(cols[i]) >= 0) return true;
    return false;
  }
  function scope(d, l) {
    var a = d.appliesTo || {};
    if (!a.kind || a.kind === 'all') return true;
    if (a.kind === 'products') return inSet(l, a.productIds || [], null);
    return inSet(l, null, a.collectionIds || []);
  }
  function getScope(d, l) {
    var g = (d.bxgy && d.bxgy.getProductIds) || [];
    return g.length ? g.indexOf(l.src.productId) >= 0 : scope(d, l);
  }
  function label(d) { return d.code || d.title || 'Discount'; }
  function err(code, text) { messages.push({ level: 'error', code: code, text: text }); }

  // which discounts are candidates
  var entered = [];
  (Array.isArray(cart.codes) ? cart.codes : []).forEach(function (c) {
    c = String(c || '').trim().toUpperCase(); if (c && entered.indexOf(c) < 0) entered.push(c);
  });
  var cands = [];
  entered.forEach(function (code) {
    var d = null;
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].method !== 'automatic' && String(list[i].code || '').toUpperCase() === code) { d = list[i]; break; }
    if (!d) { err(code, '"' + code + '" is not a valid discount code.'); return; }
    var st = discountStatus(d, t);
    if (st === 'disabled') return err(code, '"' + code + '" is not active.');
    if (st === 'scheduled') return err(code, '"' + code + '" is not active yet.');
    if (st === 'expired') return err(code, '"' + code + '" has expired.');
    if (st === 'limit_reached') return err(code, '"' + code + '" has reached its usage limit.');
    if (d.oncePerCustomer && (+usage[d.id] || 0) > 0) return err(code, '"' + code + '" can only be used once per customer.');
    cands.push({ d: d, code: code });
  });
  list.forEach(function (d) {
    if (!d || d.method !== 'automatic' || discountStatus(d, t) !== 'active') return;
    if (d.oncePerCustomer && (+usage[d.id] || 0) > 0) return;
    cands.push({ d: d, code: '' });
  });

  // minimum requirements (eligible lines, before discounts)
  cands = cands.filter(function (c) {
    var d = c.d, m = d.minimum || {}, amt = 0, qty = 0;
    lines.forEach(function (l) { if (scope(d, l)) { amt += l.base; qty += l.qty; } });
    if (m.kind === 'amount' && amt < C(m.value)) { if (c.code) err(c.code, 'Add ' + fmt(C(m.value) - amt) + ' more to eligible items to use "' + c.code + '".'); return false; }
    if (m.kind === 'quantity' && qty < Math.floor(+m.value || 0)) { if (c.code) err(c.code, 'Add ' + (Math.floor(+m.value) - qty) + ' more eligible item(s) to use "' + c.code + '".'); return false; }
    return true;
  });

  // amount a discount would take from the current remaining line amounts → { total, per: [cents per line] }
  function spread(total, idx) {
    var per = lines.map(function () { return 0; });
    var pool = 0; idx.forEach(function (i) { pool += lines[i].left; });
    total = Math.min(total, pool);
    if (total <= 0 || pool <= 0) return { total: 0, per: per };
    var given = 0, rema = [];
    idx.forEach(function (i) { var exact = total * lines[i].left / pool, f = Math.floor(exact); per[i] = f; given += f; rema.push([exact - f, i]); });
    rema.sort(function (a, b) { return b[0] - a[0] || a[1] - b[1]; });
    for (var k = 0; given < total && k < rema.length; k++) { per[rema[k][1]]++; given++; }
    return { total: total, per: per };
  }
  function evaluate(d) {
    var idx = []; lines.forEach(function (l, i) { if (scope(d, l) && l.left > 0) idx.push(i); });
    if (d.type === 'percentage') {
      var pool = 0; idx.forEach(function (i) { pool += lines[i].left; });
      return spread(Math.round(pool * Math.min(100, Math.max(0, +d.value || 0)) / 100), idx);
    }
    if (d.type === 'fixed') return spread(Math.max(0, C(d.value)), idx);
    if (d.type === 'bxgy') {
      var b = d.bxgy || {}, X = Math.max(1, Math.floor(+b.buyQuantity || 1)), Y = Math.max(1, Math.floor(+b.getQuantity || 1));
      var pct = b.getPercent == null ? 100 : Math.min(100, Math.max(0, +b.getPercent)), maxUses = b.maxUses == null || b.maxUses === '' ? Infinity : Math.max(1, Math.floor(+b.maxUses));
      var units = [];
      lines.forEach(function (l, i) { for (var u = 0; u < l.qty; u++) units.push({ i: i, p: l.unit, buy: scope(d, l), get: getScope(d, l), used: false }); });
      var buys = units.filter(function (u) { return u.buy; }).sort(function (a, c) { return c.p - a.p; });
      var gets = units.filter(function (u) { return u.get; }).sort(function (a, c) { return a.p - c.p; });
      var free = lines.map(function () { return 0; }), uses = 0;
      while (uses < maxUses) {
        var pickB = [], pickG = [], k;
        for (k = 0; k < buys.length && pickB.length < X; k++) if (!buys[k].used) pickB.push(buys[k]);
        if (pickB.length < X) break;
        pickB.forEach(function (u) { u.used = true; });
        for (k = 0; k < gets.length && pickG.length < Y; k++) if (!gets[k].used) pickG.push(gets[k]);
        if (pickG.length < Y) { pickB.forEach(function (u) { u.used = false; }); break; }
        pickG.forEach(function (u) { u.used = true; free[u.i] += u.p; });
        uses++;
      }
      var per = lines.map(function (l, i) { return Math.min(l.left, Math.round(free[i] * pct / 100)); }), tot = 0;
      per.forEach(function (x) { tot += x; });
      return { total: tot, per: per };
    }
    return { total: 0, per: lines.map(function () { return 0; }) };
  }

  var itemCands = cands.filter(function (c) { return c.d.type !== 'free_shipping'; });
  var shipCands = cands.filter(function (c) { return c.d.type === 'free_shipping'; });
  itemCands.forEach(function (c) { c.preview = evaluate(c.d).total; });
  itemCands.sort(function (a, b) { return b.preview - a.preview || (a.code ? 0 : 1) - (b.code ? 0 : 1); });

  var applied = [], appliedCodes = [], discountC = 0;
  itemCands.forEach(function (c) {
    if (c.preview <= 0) { if (c.code) err(c.code, '"' + c.code + '" does not apply to the items in the cart.'); return; }
    var stackable = applied.every(function (a) { return a.d.combinable; }) && (applied.length === 0 || c.d.combinable);
    if (!stackable) { if (c.code) err(c.code, '"' + c.code + '" cannot be combined with ' + applied.map(function (a) { return '"' + label(a.d) + '"'; }).join(', ') + '.'); return; }
    var r = evaluate(c.d);
    if (r.total <= 0) { if (c.code) err(c.code, '"' + c.code + '" does not apply to the items in the cart.'); return; }
    r.per.forEach(function (x, i) { if (x > 0) { lines[i].left -= x; lines[i].alloc[c.d.id] = (lines[i].alloc[c.d.id] || 0) + x; } });
    discountC += r.total;
    applied.push({ d: c.d, code: c.code, amount: r.total });
    if (c.code) appliedCodes.push(c.code);
  });

  var shipDiscC = 0;
  if (shipCands.length) {
    var s = shipCands[0];
    shipDiscC = shipC;
    applied.push({ d: s.d, code: s.code, amount: shipC });
    if (s.code) appliedCodes.push(s.code);
    if (s.code && shipC === 0) messages.push({ level: 'info', code: s.code, text: '"' + s.code + '" gives free shipping once a paid shipping rate is chosen.' });
    shipCands.slice(1).forEach(function (o) { if (o.code) err(o.code, '"' + o.code + '" was not applied: free shipping is already applied.'); });
  }

  return {
    lines: lines.map(function (l) {
      var out = {}; for (var k in l.src) out[k] = l.src[k];
      out.lineTotal = M(l.base); out.discount = M(l.base - l.left); out.total = M(l.left);
      out.allocations = Object.keys(l.alloc).map(function (id) { return { discountId: id, amount: M(l.alloc[id]) }; });
      return out;
    }),
    subtotal: M(subtotal), discountTotal: M(discountC), originalShipping: M(shipC), shippingDiscount: M(shipDiscC), shipping: M(shipC - shipDiscC),
    total: M(subtotal - discountC + shipC - shipDiscC), appliedCodes: appliedCodes,
    applied: applied.map(function (a) { return { id: a.d.id, title: a.d.title || '', code: a.code || a.d.code || '', type: a.d.type, amount: M(a.amount) }; }),
    messages: messages,
  };
}

/** Short human summary of a discount ("15% off all products · min. 50.00"). formatMoney(amount) is optional. */
export function describeDiscount(d, formatMoney) {
  var f = formatMoney || function (n) { return (+n || 0).toFixed(2); };
  var a = d.appliesTo || {}, what = !a.kind || a.kind === 'all' ? 'all products' : a.kind === 'products' ? (a.productIds || []).length + ' product(s)' : (a.collectionIds || []).length + ' collection(s)';
  var main = d.type === 'percentage' ? (+d.value || 0) + '% off ' + what
    : d.type === 'fixed' ? f(d.value) + ' off ' + what
    : d.type === 'free_shipping' ? 'Free shipping'
    : 'Buy ' + ((d.bxgy || {}).buyQuantity || 1) + ', get ' + ((d.bxgy || {}).getQuantity || 1) + ' ' + (((d.bxgy || {}).getPercent == null || d.bxgy.getPercent >= 100) ? 'free' : d.bxgy.getPercent + '% off');
  var m = d.minimum || {};
  if (m.kind === 'amount' && +m.value > 0) main += ' · min. ' + f(m.value);
  if (m.kind === 'quantity' && +m.value > 0) main += ' · min. ' + m.value + ' items';
  return main;
}
