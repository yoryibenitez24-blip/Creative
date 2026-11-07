// Pure cart / order logic of the exported storefront.
//
// cartKit() is fully self-contained (no outer references) because the exporter serialises it with
// Function.prototype.toString() into assets/store.js — the same code runs in the shopper's browser and in
// the Node tests. Amounts are handled as integer minor units ("cents") to avoid float drift.
//
// Runtime data (D) shape, produced by render.js runtimeData():
//   { id, name, currency: { code, locale }, checkout: { mode, phone, email, shippingNote, note },
//     products: [{ id, title, url, image, price, compareAt, options: [names], paymentLink,
//                  variants: [{ id, options: [values], price|null, sku, stock|null }] }] }
// Cart = [{ pid, vid, qty }]

export function cartKit() {
  function toCents(n) { return Math.round((+n || 0) * 100); }
  function fromCents(c) { return Math.round(c) / 100; }
  function formatMoney(amount, cur) {
    cur = cur || {};
    try { return new Intl.NumberFormat(cur.locale || 'en-US', { style: 'currency', currency: cur.code || 'USD' }).format(+amount || 0); }
    catch (e) { return (cur.code || '') + ' ' + (+amount || 0).toFixed(2); }
  }
  function product(D, pid) { for (var i = 0; i < D.products.length; i++) if (D.products[i].id === pid) return D.products[i]; return null; }
  function variant(p, vid) { if (!p) return null; for (var i = 0; i < p.variants.length; i++) if (p.variants[i].id === vid) return p.variants[i]; return null; }
  function priceOf(p, v) { return v && v.price != null ? v.price : p.price; }
  function available(v) { return !!v && (v.stock == null || v.stock > 0); }
  /** Variant whose option values equal `selected` (array aligned with product.options). */
  function findVariant(p, selected) {
    for (var i = 0; i < p.variants.length; i++) {
      var v = p.variants[i], ok = true;
      for (var k = 0; k < p.options.length; k++) if (v.options[k] !== selected[k]) { ok = false; break; }
      if (ok) return v;
    }
    return null;
  }
  function firstAvailable(p) { for (var i = 0; i < p.variants.length; i++) if (available(p.variants[i])) return p.variants[i]; return null; }
  function clampQty(q, v) { q = Math.floor(+q || 0); if (q < 0) q = 0; if (q > 999) q = 999; if (v && v.stock != null && q > v.stock) q = v.stock; return q; }
  /** Drop unknown/out-of-stock lines, merge duplicates, clamp quantities. */
  function normalize(cart, D) {
    var out = [], seen = {};
    (Array.isArray(cart) ? cart : []).forEach(function (l) {
      var p = product(D, l && l.pid), v = variant(p, l && l.vid);
      if (!p || !v) return;
      var key = p.id + '|' + v.id;
      if (seen[key]) { seen[key].qty = clampQty(seen[key].qty + (+l.qty || 0), v); return; }
      var q = clampQty(l.qty, v);
      if (q > 0) { seen[key] = { pid: p.id, vid: v.id, qty: q }; out.push(seen[key]); }
    });
    return out;
  }
  function add(cart, D, pid, vid, qty) { return normalize((cart || []).concat([{ pid: pid, vid: vid, qty: qty == null ? 1 : qty }]), D); }
  function setQty(cart, D, pid, vid, qty) {
    return normalize((cart || []).map(function (l) { return l.pid === pid && l.vid === vid ? { pid: pid, vid: vid, qty: qty } : l; }), D);
  }
  function remove(cart, D, pid, vid) { return normalize((cart || []).filter(function (l) { return !(l.pid === pid && l.vid === vid); }), D); }
  function lines(cart, D) {
    return normalize(cart, D).map(function (l) {
      var p = product(D, l.pid), v = variant(p, l.vid), unit = toCents(priceOf(p, v));
      return { pid: p.id, vid: v.id, product: p, variant: v, qty: l.qty, label: v.options.join(' / '), unitCents: unit, totalCents: unit * l.qty };
    });
  }
  function totals(ls) {
    var count = 0, sub = 0;
    ls.forEach(function (l) { count += l.qty; sub += l.totalCents; });
    return { count: count, subtotalCents: sub, subtotal: fromCents(sub) };
  }
  /** Plain-text order summary used by the WhatsApp and email checkouts. */
  function orderText(ls, D, customer) {
    var c = customer || {}, cur = D.currency, t = totals(ls), out = ['New order — ' + D.name, ''];
    ls.forEach(function (l) {
      out.push(l.qty + ' × ' + l.product.title + (l.label ? ' (' + l.label + ')' : '') + (l.variant.sku ? ' [' + l.variant.sku + ']' : '') + ' — ' + formatMoney(fromCents(l.totalCents), cur));
    });
    out.push('', 'Subtotal: ' + formatMoney(t.subtotal, cur) + ' (' + t.count + (t.count === 1 ? ' item' : ' items') + ')');
    if (D.checkout && D.checkout.shippingNote) out.push('Shipping: ' + D.checkout.shippingNote);
    var info = [['Name', c.name], ['Phone', c.phone], ['Email', c.email], ['Address', c.address], ['Notes', c.notes]].filter(function (x) { return x[1] && String(x[1]).trim(); });
    if (info.length) { out.push(''); info.forEach(function (x) { out.push(x[0] + ': ' + String(x[1]).trim()); }); }
    return out.join('\n');
  }
  function whatsappUrl(phone, text) { return 'https://wa.me/' + String(phone || '').replace(/\D/g, '') + '?text=' + encodeURIComponent(text); }
  function mailtoUrl(email, subject, body) { return 'mailto:' + encodeURIComponent(String(email || '').trim()).replace(/%40/g, '@') + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body); }
  /** Payment links needed for the cart: one entry per distinct product. */
  function paymentPlan(ls) {
    var seen = {}, out = [];
    ls.forEach(function (l) {
      if (seen[l.pid]) { seen[l.pid].qty += l.qty; return; }
      seen[l.pid] = { pid: l.pid, title: l.product.title, qty: l.qty, url: l.product.paymentLink || '' };
      out.push(seen[l.pid]);
    });
    return out;
  }
  return { toCents: toCents, fromCents: fromCents, formatMoney: formatMoney, product: product, variant: variant, priceOf: priceOf, available: available, findVariant: findVariant, firstAvailable: firstAvailable, clampQty: clampQty, normalize: normalize, add: add, setQty: setQty, remove: remove, lines: lines, totals: totals, orderText: orderText, whatsappUrl: whatsappUrl, mailtoUrl: mailtoUrl, paymentPlan: paymentPlan };
}
