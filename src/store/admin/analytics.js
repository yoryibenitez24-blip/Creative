// Store analytics from commerce.analytics.events and commerce.orders (pure), plus the tracker that the admin
// injects into its "View store" preview tab so visits, add-to-cart, checkouts and preview orders are recorded.
import { normalizeEvent, MAX_EVENTS } from './model.js';
import { geoFromBrowser, countryGeo, countryLabel, countryFromAddress, isCountry } from './geo.js';

const DAY = 86400000;
const C = n => Math.round((+n || 0) * 100), M = c => Math.round(c) / 100;

/** 'YYYY-MM-DD' for a timestamp in a zone given by its UTC offset in minutes (local time: -new Date().getTimezoneOffset()). */
export function dayKey(ms, tzOffsetMinutes = 0) { return new Date(ms + tzOffsetMinutes * 60000).toISOString().slice(0, 10); }

/** Inclusive date range [from, to] as day keys → array of keys. */
export function dayRange(fromKey, toKey) {
  const out = []; let t = Date.parse(fromKey + 'T00:00:00Z'); const end = Date.parse(toKey + 'T00:00:00Z');
  if (!isFinite(t) || !isFinite(end)) return out;
  for (; t <= end && out.length < 1000; t += DAY) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/** Range preset ('today'|'7d'|'30d'|'90d'|'12m') ending today → { from, to } day keys. */
export function presetRange(preset, now = Date.now(), tz = 0) {
  const to = dayKey(now, tz), days = { today: 1, '7d': 7, '30d': 30, '90d': 90, '12m': 365 }[preset] || 30;
  return { from: dayKey(Date.parse(to + 'T00:00:00Z') - (days - 1) * DAY, 0), to };
}

/**
 * Aggregate over [from, to] (day keys, inclusive, in the tz offset).
 * Orders count when not drafts and not cancelled; sales are net of refunds. Sessions are distinct sessionIds of
 * storefront events. Conversion = sessions with an order_placed event / sessions.
 * → { days: [{ date, sales, orders, sessions, addToCart, checkouts }], totals: { sales, orders, aov, sessions, visits,
 *     conversion, addToCartRate, checkoutRate, unitsSold }, funnel: [{ key, label, count, rate }], topProducts: [{ productId, title, quantity, sales }],
 *     previous: { sales, orders } (same-length period before), sources: { preview, manual, import } (orders by source) }
 */
export function aggregateAnalytics(commerce, { from, to, tz = 0 } = {}) {
  const keys = dayRange(from, to), idx = new Map(keys.map((k, i) => [k, i]));
  const days = keys.map(date => ({ date, sales: 0, orders: 0, sessions: 0, addToCart: 0, checkouts: 0, _s: new Set() }));
  const span = keys.length, prevFrom = keys.length ? dayKey(Date.parse(from + 'T00:00:00Z') - span * DAY) : from, prevTo = keys.length ? dayKey(Date.parse(from + 'T00:00:00Z') - DAY) : to;
  const inRange = (k, a, b) => k >= a && k <= b;
  let salesC = 0, orders = 0, units = 0, prevSalesC = 0, prevOrders = 0;
  const top = new Map(), sources = { preview: 0, manual: 0, import: 0 };
  for (const o of commerce.orders) {
    if (o.draft || o.status === 'cancelled') continue;
    const k = dayKey(Date.parse(o.createdAt), tz);
    const net = C(o.totals.total) - o.refunds.reduce((s, r) => s + C(r.amount), 0);
    if (inRange(k, prevFrom, prevTo)) { prevSalesC += net; prevOrders++; }
    if (!idx.has(k)) continue;
    const d = days[idx.get(k)]; d.sales += net; d.orders++;
    salesC += net; orders++; sources[o.source] = (sources[o.source] || 0) + 1;
    for (const l of o.lines) {
      units += l.quantity;
      const t = top.get(l.productId || l.title) || { productId: l.productId, title: l.title, quantity: 0, sales: 0 };
      t.quantity += l.quantity; t.sales += C(l.price) * l.quantity; top.set(l.productId || l.title, t);
    }
  }
  const sess = new Set(), withCart = new Set(), withCheckout = new Set(), withOrder = new Set(); let visits = 0;
  for (const e of commerce.analytics.events) {
    const k = dayKey(Date.parse(e.at), tz);
    if (!idx.has(k) || !e.sessionId) continue;
    const d = days[idx.get(k)];
    d._s.add(e.sessionId); sess.add(e.sessionId);
    if (e.type === 'visit') visits++;
    if (e.type === 'add_to_cart') { d.addToCart++; withCart.add(e.sessionId); }
    if (e.type === 'checkout_started') { d.checkouts++; withCheckout.add(e.sessionId); }
    if (e.type === 'order_placed') withOrder.add(e.sessionId);
  }
  for (const d of days) { d.sessions = d._s.size; delete d._s; d.sales = M(d.sales); }
  const n = sess.size, rate = x => n ? x / n : 0;
  return {
    days,
    totals: { sales: M(salesC), orders, aov: orders ? M(salesC / orders) : 0, sessions: n, visits, conversion: rate(withOrder.size), addToCartRate: rate(withCart.size), checkoutRate: rate(withCheckout.size), unitsSold: units },
    funnel: [['sessions', 'Sessions', n], ['cart', 'Added to cart', withCart.size], ['checkout', 'Reached checkout', withCheckout.size], ['order', 'Placed an order', withOrder.size]].map(([key, label, count]) => ({ key, label, count, rate: rate(count) })),
    topProducts: [...top.values()].sort((a, b) => b.sales - a.sales || b.quantity - a.quantity).slice(0, 8).map(t => ({ ...t, sales: M(t.sales) })),
    previous: { sales: M(prevSalesC), orders: prevOrders },
    sources,
  };
}

/** Append events (normalised, capped at MAX_EVENTS). Returns a new commerce document. */
export function addEvents(commerce, events) {
  const c = { ...commerce, analytics: { events: [...commerce.analytics.events, ...events.map(normalizeEvent)].slice(-MAX_EVENTS) } };
  return c;
}

/**
 * Wrap the HTML of previewShellHtml() (src/store/exporter.js) with a tracker. The tracker posts
 * { zcEvent: { type, sessionId, path, productSlug?, lines?, customer? } } to window.opener:
 *   visit (first page; carries the browser's time zone `tz` and `lang`, mapped to an approximate geo in parseTrackerMessage), page_view, view_product (products/<slug>.html), add_to_cart (cart quantity grew, read from the
 *   storefront's localStorage cart 'zstore-cart:<storeId>'), checkout_started (checkout.html), order_placed (checkout form
 *   submitted or a payment link clicked; carries the cart lines [{ pid, vid, qty }] and the form's name/email/phone/address/notes).
 */
export function trackedPreviewHtml(shellHtml, storeId) {
  const script = `<script>(function(){
var op=window.opener;if(!op)return;var SID=${JSON.stringify(String(storeId))},sid='pv_'+Date.now().toString(36)+Math.random().toString(36).slice(2,8),KEY='zstore-cart:'+${JSON.stringify(String(storeId))},first=true,lastQty=null,ordered=false;
function post(ev){ev.sessionId=sid;try{op.postMessage({zcEvent:ev},'*')}catch(e){}}
function cart(){try{var c=JSON.parse(localStorage.getItem(KEY)||'[]');return Array.isArray(c)?c:[]}catch(e){return[]}}
function qty(c){var n=0;c.forEach(function(l){n+=+l.qty||0});return n}
function checkCart(){var c=cart(),q=qty(c);if(lastQty!==null&&q>lastQty)post({type:'add_to_cart',quantity:q-lastQty,lines:c});lastQty=q}
function js(k,d){try{var v=JSON.parse(localStorage.getItem(k)||'null');return v==null?d:v}catch(e){return d}}
function order(form){if(ordered)return;var c=cart();if(!c.length)return;ordered=true;var fd={};if(form)['name','email','phone','address','notes'].forEach(function(k){var el=form.elements[k];fd[k]=el?el.value:''});var sh=js('zstore-ship:'+SID,{})||{};post({type:'order_placed',lines:c,customer:fd,codes:js('zstore-codes:'+SID,[]),country:sh.country||'',region:sh.region||'',rateId:sh.rateId||''})}
lastQty=qty(cart());addEventListener('storage',function(e){if(e.key===KEY)checkCart()});setInterval(checkCart,1000);
var f=document.getElementById('f');f.addEventListener('load',function(){var w=f.contentWindow,d=w&&w.document;if(!d)return;var p=d.documentElement.getAttribute('data-path')||location.hash.slice(1)||'index.html';
if(first){var tz='',lg='';try{tz=Intl.DateTimeFormat().resolvedOptions().timeZone||''}catch(e){}try{lg=navigator.language||''}catch(e){}post({type:'visit',path:p,tz:tz,lang:lg});first=false}post({type:'page_view',path:p});var m=/^products\\/(.+)\\.html$/.exec(p);if(m)post({type:'view_product',path:p,productSlug:m[1]});if(p==='checkout.html'){ordered=false;post({type:'checkout_started',path:p})}
d.addEventListener('submit',function(e){var t=e.target;if(t&&t.matches&&t.matches('[data-checkout-form]'))order(t)},true);
d.addEventListener('click',function(e){var a=e.target&&e.target.closest&&e.target.closest('[data-pay-links] a');if(a)order(null)},true);
setTimeout(checkCart,50)});
})();</script>`;
  return shellHtml.includes('</body>') ? shellHtml.replace(/<\/body>(?![\s\S]*<\/body>)/, script + '</body>') : shellHtml + script;
}

/** Validate a tracker message into events + an optional order request. Returns null when the message is not a tracker event. */
export function parseTrackerMessage(data, store, now = Date.now()) {
  const e = data && data.zcEvent;
  if (!e || typeof e !== 'object' || typeof e.type !== 'string' || typeof e.sessionId !== 'string') return null;
  const at = new Date(now).toISOString(), base = { at, sessionId: e.sessionId.slice(0, 40), path: String(e.path || '').slice(0, 200), source: 'preview' };
  if (e.type === 'visit') { const geo = geoFromBrowser(e.tz, e.lang); return { events: [{ ...base, type: 'visit', ...(geo ? { geo } : {}) }] }; }
  if (e.type === 'page_view' || e.type === 'checkout_started') return { events: [{ ...base, type: e.type }] };
  if (e.type === 'view_product') { const p = store.products.find(x => x.slug === e.productSlug); return { events: [{ ...base, type: 'view_product', productId: p ? p.id : '' }] }; }
  const lines = (Array.isArray(e.lines) ? e.lines : []).slice(0, 100).filter(l => l && typeof l.pid === 'string' && typeof l.vid === 'string').map(l => ({ productId: l.pid, variantId: l.vid, quantity: Math.max(1, Math.min(999, Math.round(+l.qty || 1))) }));
  if (e.type === 'add_to_cart') return { events: [{ ...base, type: 'add_to_cart', quantity: Math.max(1, Math.round(+e.quantity || 1)) }] };
  if (e.type === 'order_placed' && lines.length) {
    const cu = e.customer && typeof e.customer === 'object' ? e.customer : {}, s = k => String(cu[k] || '').slice(0, 500);
    const codes = (Array.isArray(e.codes) ? e.codes : []).filter(c => typeof c === 'string').map(c => c.trim().toUpperCase().slice(0, 40)).filter(Boolean).slice(0, 10);
    const str = v => typeof v === 'string' ? v.slice(0, 60) : '';
    return { events: [], order: { sessionId: base.sessionId, lines, codes, country: str(e.country).toUpperCase().slice(0, 2), region: str(e.region), rateId: str(e.rateId), customer: { name: s('name'), email: s('email'), phone: s('phone'), address: s('address'), notes: s('notes') } } };
  }
  return null;
}

/**
 * Where visitors and buyers come from over [from, to] (same range rules as aggregateAnalytics).
 * A session's location is the geo stored on its events (the preview tracker derives it from the visitor's time zone).
 * An order's location is its shipping country (country centre, or the session's city point when it is in that country),
 * else its session's location. → [{ country, name, city, lat, lon, sessions, orders, sales }] sorted by sessions, orders, sales.
 * Sessions and orders without any location are left out (see unlocatedCount).
 */
export function visitorsByLocation(commerce, { from, to, tz = 0 } = {}) {
  const keys = new Set(dayRange(from, to)), events = commerce.analytics?.events || [];
  const sessionGeo = new Map();
  for (const e of events) if (e.sessionId && e.geo && isCountry(e.geo.country) && !sessionGeo.has(e.sessionId)) sessionGeo.set(e.sessionId, e.geo);
  const orderSession = new Map();
  for (const e of events) if (e.type === 'order_placed' && e.orderId && e.sessionId) orderSession.set(e.orderId, e.sessionId);
  const by = new Map();
  const row = (country, g) => {
    let r = by.get(country);
    if (!r) { const c = countryGeo(country); r = { country, name: countryLabel(country), city: '', lat: c.lat, lon: c.lon, sessions: 0, orders: 0, sales: 0, _pts: new Map() }; by.set(country, r); }
    if (g && g.country === country && isFinite(g.lat) && isFinite(g.lon)) { const k = g.lat + ',' + g.lon, p = r._pts.get(k) || { n: 0, g }; p.n++; r._pts.set(k, p); }
    return r;
  };
  const seen = new Set();
  for (const e of events) {
    if (!e.sessionId || seen.has(e.sessionId) || !keys.has(dayKey(Date.parse(e.at), tz))) continue;
    const g = sessionGeo.get(e.sessionId); if (!g) continue;
    seen.add(e.sessionId); row(g.country, g).sessions++;
  }
  for (const o of commerce.orders || []) {
    if (o.draft || o.status === 'cancelled' || !keys.has(dayKey(Date.parse(o.createdAt), tz))) continue;
    const sg = sessionGeo.get(orderSession.get(o.id) || o.sessionId || '');
    const ship = String(o.shippingAddress?.country || '').toUpperCase();
    const country = isCountry(ship) ? ship : sg ? sg.country : '';
    if (!country) continue;
    const r = row(country, sg && sg.country === country ? sg : null);
    r.orders++; r.sales += C(o.totals.total) - (o.refunds || []).reduce((s, x) => s + C(x.amount), 0);
  }
  return [...by.values()].map(r => {
    const best = [...r._pts.values()].sort((a, b) => b.n - a.n)[0];
    const out = { country: r.country, name: r.name, city: best ? best.g.city || '' : '', lat: best ? best.g.lat : r.lat, lon: best ? best.g.lon : r.lon, sessions: r.sessions, orders: r.orders, sales: M(r.sales) };
    return out;
  }).sort((a, b) => b.sessions - a.sessions || b.orders - a.orders || b.sales - a.sales || a.name.localeCompare(b.name));
}

/** Sessions in [from, to] whose location is unknown (recorded before locations were captured, or no usable time zone). */
export function unlocatedSessions(commerce, { from, to, tz = 0 } = {}) {
  const keys = new Set(dayRange(from, to)), events = commerce.analytics?.events || [], located = new Set(), all = new Set();
  for (const e of events) if (e.sessionId && e.geo && isCountry(e.geo.country)) located.add(e.sessionId);
  for (const e of events) if (e.sessionId && keys.has(dayKey(Date.parse(e.at), tz))) all.add(e.sessionId);
  let n = 0; for (const s of all) if (!located.has(s)) n++;
  return n;
}

/**
 * The store's own location for the globe's arcs: the country named in Settings › General address or the default
 * location's address (store contact address as a further fallback), else the busiest visitor location. → { country, name, lat, lon } | null
 */
export function storeLocation(commerce, store, locations = []) {
  const st = commerce?.settings || {};
  const def = (st.locations || []).find(l => l.isDefault) || (st.locations || [])[0];
  for (const a of [st.general?.address, def?.address, store?.contact?.address]) {
    const c = countryFromAddress(a);
    if (c) { const g = countryGeo(c); return { country: c, name: countryLabel(c), lat: g.lat, lon: g.lon }; }
  }
  const top = locations[0];
  return top ? { country: top.country, name: top.name, lat: top.lat, lon: top.lon, fromVisitors: true } : null;
}
