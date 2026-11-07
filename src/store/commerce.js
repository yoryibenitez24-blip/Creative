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
//   commerceScript() → JS source defining `var CK` (kit bound to the admin's applyDiscounts engine) for the storefront.

import { applyDiscounts, discountStatus, toMs } from './admin/discounts.js';
import { variantWeight, countryName } from './admin/model.js';

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
    webhook: String(st.backend?.orderWebhookUrl || '').trim(), countries };
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
  return { ratesFor: ratesFor, taxRateFor: taxRateFor, computeTax: computeTax, totals: totals };
}

/** Storefront source: `var CK = commerceKit(applyDiscounts)`, with the admin's discount engine embedded verbatim. */
export function commerceScript() {
  return `var CK = (function () {\n${toMs.toString()}\n${discountStatus.toString()}\n${applyDiscounts.toString()}\nreturn (${commerceKit.toString()})(${applyDiscounts.name});\n})();\n`;
}
