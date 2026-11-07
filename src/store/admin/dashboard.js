// Pure numbers behind the commerce Dashboard (src/store/admin/Home.jsx): date presets, previous period, weekday activity,
// customer segments, repeat-customer rate, profit and the CSV export. Analytics totals come from ./analytics.js.
import { dayKey, presetRange } from './analytics.js';

const DAY = 86400000;
export const DASH_PRESETS = [['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['90d', 'Last 90 days'], ['ytd', 'This year']];
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const valid = o => !o.draft && o.status !== 'cancelled';
const k2ms = k => Date.parse(k + 'T00:00:00Z');

/** Preset ('7d'|'30d'|'90d'|'ytd') ending today → { from, to } day keys. 'ytd' starts on January 1 of the current year. */
export function dashRange(preset, now = Date.now(), tz = 0) {
  if (preset === 'ytd') { const to = dayKey(now, tz); return { from: to.slice(0, 4) + '-01-01', to }; }
  return presetRange(preset, now, tz);
}
/** The same-length period just before { from, to }. */
export function previousRange({ from, to }) {
  const span = Math.round((k2ms(to) - k2ms(from)) / DAY) + 1;
  return { from: dayKey(k2ms(from) - span * DAY), to: dayKey(k2ms(from) - DAY) };
}
/** 'YYYY-MM-DD' → 'Jan 1, 2025'. */
export const fmtDay = k => new Date(k2ms(k)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** Relative change, or null when there is nothing to compare with. */
export const change = (cur, prev) => prev > 0 ? (cur - prev) / prev : null;

/** Orders (or, with no orders, sessions) per weekday from aggregateAnalytics().days → { values: [7], metric: 'orders'|'sessions', max: index|-1 }. */
export function weekdayActivity(days) {
  const orders = Array(7).fill(0), sessions = Array(7).fill(0);
  for (const d of days) { const w = new Date(k2ms(d.date)).getUTCDay(); orders[w] += d.orders; sessions[w] += d.sessions; }
  const useOrders = orders.some(Boolean) || !sessions.some(Boolean);
  const values = useOrders ? orders : sessions;
  const top = Math.max(...values);
  return { values, metric: useOrders ? 'orders' : 'sessions', max: top > 0 ? values.indexOf(top) : -1 };
}

const buyerKey = o => o.customerId || (o.email ? 'e:' + o.email.toLowerCase() : '');

/**
 * Customers who ordered in [from, to] split into segments: VIP (3+ orders in total), Returning (ordered before the range)
 * and New (first order in the range, guest checkouts included). → { new, returning, vip, total }
 */
export function customerSegments(commerce, { from, to, tz = 0 }) {
  const all = new Map(), inRange = new Set(); let guests = 0;
  for (const o of commerce.orders) {
    if (!valid(o)) continue;
    const k = dayKey(Date.parse(o.createdAt), tz), b = buyerKey(o);
    if (k > to) continue;
    if (!b) { if (k >= from) guests++; continue; }
    const e = all.get(b) || { count: 0, before: false }; e.count++; if (k < from) e.before = true; all.set(b, e);
    if (k >= from) inRange.add(b);
  }
  const out = { new: guests, returning: 0, vip: 0, total: guests };
  for (const b of inRange) { const e = all.get(b); out.total++; if (e.count >= 3) out.vip++; else if (e.before) out.returning++; else out.new++; }
  return out;
}

/** Share of customers (lifetime) who ordered more than once → { rate, repeat, customers }. */
export function repeatRate(commerce) {
  const n = new Map();
  for (const o of commerce.orders) { if (!valid(o)) continue; const b = buyerKey(o); if (b) n.set(b, (n.get(b) || 0) + 1); }
  const customers = n.size, repeat = [...n.values()].filter(x => x > 1).length;
  return { rate: customers ? repeat / customers : 0, repeat, customers };
}

/** Gross profit of orders in [from, to] for lines whose cost is known → { profit, costed: bool } (costed false = no costs entered). */
export function grossProfit(commerce, { from, to, tz = 0 }) {
  let cents = 0, costed = false;
  for (const o of commerce.orders) {
    if (!valid(o)) continue;
    const k = dayKey(Date.parse(o.createdAt), tz); if (k < from || k > to) continue;
    for (const l of o.lines) {
      const m = commerce.productMeta?.[l.productId]; if (!m) continue;
      const vc = m.variants?.[l.variantId]?.cost, cost = vc != null ? vc : m.cost;
      if (cost == null || !(cost > 0)) continue;
      costed = true; cents += Math.round((l.price - cost) * 100) * l.quantity;
    }
  }
  return { profit: cents / 100, costed };
}

const cell = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
/** CSV of the dashboard: one row per metric (current, previous, change %), then one row per day. */
export function dashboardCsv({ range, prev, metrics, days }) {
  const rows = [['Period', range.from + ' to ' + range.to, 'Previous ' + prev.from + ' to ' + prev.to, ''], ['Metric', 'Current', 'Previous', 'Change %']];
  for (const [label, cur, before] of metrics) { const c = change(cur, before); rows.push([label, cur, before, c == null ? '' : (Math.round(c * 1000) / 10).toFixed(1)]); }
  rows.push([], ['Date', 'Sales', 'Orders', 'Sessions', 'Add to cart', 'Checkouts']);
  for (const d of days) rows.push([d.date, d.sales, d.orders, d.sessions, d.addToCart, d.checkouts]);
  return rows.map(r => r.map(cell).join(',')).join('\n') + '\n';
}
