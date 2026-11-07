// Selling services: bookings, service projects and their numbers (pure functions, no UI).
//
// Service products live in the store document (product.kind === 'service', schema: src/store/serviceProduct.js).
// The commerce document (src/store/admin/model.js) gets these collections, normalised by withServiceData(), which
// normalizeCommerce() calls on its result:
//
//   bookings: [{ id, productId, title (service name snapshot), customerId|null, name, email, start, end (ISO),
//                timezone (IANA, the service's), status: 'requested'|'confirmed'|'completed'|'cancelled'|'no_show',
//                location: { mode: 'online'|'in_person'|'async', meetingUrl, address },
//                intake: [{ question, answer }] (the buyer's answers to the service's intake form), notes,
//                orderId|null, projectId|null, price, createdAt, history: [{ id, at, message }], sample? }]
//   serviceProjects: [{ id, productId, title, customerId|null, name, email, orderId|null,
//                stage: 'new'|'in_progress'|'delivered'|'revision'|'completed', dueDate 'YYYY-MM-DD'|'', createdAt, updatedAt,
//                value, revisionsIncluded, revisionsUsed, deliverables: [{ id, label, done }],
//                messages: [{ id, at, from: 'merchant'|'client', text }], notes, sample? }]
//   abandonedCheckouts: [{ id, at, sessionId, customerId|null, email, country, lines: [{ productId, variantId, title, price, quantity }],
//                subtotal, recovered: bool, sample? }]
//   sampleData: { loadedAt, seed, prevNextOrderNumber } | null   (set while sample data is loaded, src/store/admin/sampleData.js)
//
// `sample: true` marks records created by "Load sample data". withServiceData() also keeps that flag on the
// orders, customers, discounts, staff notes, campaigns and analytics events normalizeCommerce() rebuilds.
import { normalizeService, isService, minutesOf } from '../serviceProduct.js';

export const BOOKING_STATUSES = [['requested', 'Requested', 'warn'], ['confirmed', 'Confirmed', 'info'], ['completed', 'Completed', 'ok'], ['cancelled', 'Cancelled', 'neutral'], ['no_show', 'No-show', 'bad']];
export const PROJECT_STAGES = [['new', 'New'], ['in_progress', 'In progress'], ['delivered', 'Delivered'], ['revision', 'Revision'], ['completed', 'Completed']];
const BOOKING_KEYS = BOOKING_STATUSES.map(s => s[0]), STAGE_KEYS = PROJECT_STAGES.map(s => s[0]);
export const ACTIVE_BOOKING = ['requested', 'confirmed'];

const MIN = 60000, DAY = 86400000;
let counter = 0;
export const sid = (p = 'x') => p + '_' + Date.now().toString(36).slice(-5) + (counter++).toString(36) + Math.random().toString(36).slice(2, 6);
const str = (v, d = '') => v == null ? d : String(v);
const num = (v, d, lo = -Infinity, hi = Infinity) => { const n = typeof v === 'string' && v.trim() === '' ? NaN : +v; return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const money = v => Math.round(num(v, 0, 0) * 100) / 100;
const arr = v => Array.isArray(v) ? v : [];
const iso = (v, d = null) => { if (v == null || v === '') return d; const t = new Date(v).getTime(); return Number.isFinite(t) ? new Date(t).toISOString() : d; };
const pickKey = (v, keys, d) => keys.includes(v) ? v : d;
const dateKey = v => /^\d{4}-\d{2}-\d{2}$/.test(str(v)) ? str(v) : '';
const flag = (o, x) => o && o.sample ? { ...x, sample: true } : x;

// ---------- normalisation ----------
export function normalizeBooking(b) {
  b = b && typeof b === 'object' ? b : {};
  const start = iso(b.start, new Date().toISOString()), end = iso(b.end, null);
  const loc = b.location || {};
  return flag(b, {
    id: str(b.id) || sid('bk'), productId: str(b.productId), title: str(b.title, 'Service') || 'Service', customerId: b.customerId ? str(b.customerId) : null,
    name: str(b.name).trim(), email: str(b.email).trim().toLowerCase(), start, end: end && end > start ? end : new Date(Date.parse(start) + 60 * MIN).toISOString(),
    timezone: str(b.timezone, 'UTC') || 'UTC', status: pickKey(b.status, BOOKING_KEYS, 'requested'),
    location: { mode: pickKey(loc.mode, ['online', 'in_person', 'async'], 'online'), meetingUrl: str(loc.meetingUrl).trim(), address: str(loc.address).trim() },
    intake: arr(b.intake).map(q => ({ question: str(q && q.question), answer: str(q && q.answer) })).filter(q => q.question),
    notes: str(b.notes), orderId: b.orderId ? str(b.orderId) : null, projectId: b.projectId ? str(b.projectId) : null, price: money(b.price),
    createdAt: iso(b.createdAt, start), history: arr(b.history).map(h => ({ id: str(h && h.id) || sid('bh'), at: iso(h && h.at, start), message: str(h && h.message) })).filter(h => h.message),
  });
}

export function normalizeProject(p) {
  p = p && typeof p === 'object' ? p : {};
  const created = iso(p.createdAt, new Date().toISOString());
  return flag(p, {
    id: str(p.id) || sid('pj'), productId: str(p.productId), title: str(p.title, 'Project').trim() || 'Project', customerId: p.customerId ? str(p.customerId) : null,
    name: str(p.name).trim(), email: str(p.email).trim().toLowerCase(), orderId: p.orderId ? str(p.orderId) : null,
    stage: pickKey(p.stage, STAGE_KEYS, 'new'), dueDate: dateKey(p.dueDate), createdAt: created, updatedAt: iso(p.updatedAt, created),
    value: money(p.value), revisionsIncluded: Math.round(num(p.revisionsIncluded, 0, 0, 99)), revisionsUsed: Math.round(num(p.revisionsUsed, 0, 0, 99)),
    deliverables: arr(p.deliverables).map(d => ({ id: str(d && d.id) || sid('dv'), label: str(d && d.label).trim(), done: !!(d && d.done) })).filter(d => d.label),
    messages: arr(p.messages).map(m => ({ id: str(m && m.id) || sid('msg'), at: iso(m && m.at, created), from: m && m.from === 'client' ? 'client' : 'merchant', text: str(m && m.text) })).filter(m => m.text.trim()),
    notes: str(p.notes),
  });
}

export function normalizeAbandoned(a) {
  a = a && typeof a === 'object' ? a : {};
  const lines = arr(a.lines).map(l => ({ productId: str(l && l.productId), variantId: str(l && l.variantId), title: str(l && l.title, 'Item'), price: money(l && l.price), quantity: Math.max(1, Math.round(num(l && l.quantity, 1, 1))) }));
  return flag(a, {
    id: str(a.id) || sid('ac'), at: iso(a.at, new Date().toISOString()), sessionId: str(a.sessionId), customerId: a.customerId ? str(a.customerId) : null,
    email: str(a.email).trim().toLowerCase(), country: /^[A-Z]{2}$/.test(str(a.country)) ? str(a.country) : '', lines,
    subtotal: a.subtotal == null ? Math.round(lines.reduce((s, l) => s + l.price * 100 * l.quantity, 0)) / 100 : money(a.subtotal), recovered: !!a.recovered,
  });
}

/** Re-mark records whose input carried `sample: true` (the base normalizers rebuild them without the flag). Matched by id. */
function keepSample(input, output) {
  const ids = new Set(); let any = false;
  for (const x of arr(input)) if (x && x.sample && x.id != null) { ids.add(String(x.id)); any = true; }
  return any ? output.map(x => ids.has(x.id) ? { ...x, sample: true } : x) : output;
}

/** Adds the service collections and sample bookkeeping to a normalised commerce document `out` (built from `input`). */
export function withServiceData(input, out) {
  const s = input && typeof input === 'object' ? input : {};
  out.orders = keepSample(s.orders, out.orders);
  out.customers = keepSample(s.customers, out.customers);
  out.discounts = keepSample(s.discounts, out.discounts);
  out.staffNotes = keepSample(s.staffNotes, out.staffNotes);
  out.marketing = { ...out.marketing, campaigns: keepSample(s.marketing && s.marketing.campaigns, out.marketing.campaigns) };
  out.analytics = { ...out.analytics, events: keepSample(s.analytics && s.analytics.events, out.analytics.events) };
  out.bookings = arr(s.bookings).map(normalizeBooking).sort((a, b) => a.start.localeCompare(b.start));
  out.serviceProjects = arr(s.serviceProjects).map(normalizeProject);
  out.abandonedCheckouts = arr(s.abandonedCheckouts).map(normalizeAbandoned).slice(-500);
  const sd = s.sampleData;
  out.sampleData = sd && typeof sd === 'object' ? { loadedAt: iso(sd.loadedAt, new Date(0).toISOString()), seed: Math.round(num(sd.seed, 1)), prevNextOrderNumber: Math.round(num(sd.prevNextOrderNumber, 1001, 1)) } : null;
  return out;
}

// ---------- time zones (Intl, no dependencies) ----------
const fmts = new Map();
function partsIn(ms, zone) {
  let f = fmts.get(zone);
  if (!f) { f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }); fmts.set(zone, f); }
  const o = {}; for (const p of f.formatToParts(new Date(ms))) o[p.type] = p.value;
  return { y: +o.year, mo: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, s: +o.second };
}
const safeZone = z => { try { partsIn(0, z); return z; } catch { return 'UTC'; } };
/** Offset of `zone` from UTC at instant `ms`, in minutes (e.g. 120 for Europe/Berlin in summer). */
export function zoneOffset(ms, zone) { const p = partsIn(ms, safeZone(zone)); return Math.round((Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000) / MIN); }
/** UTC ms of a wall-clock time ('YYYY-MM-DD', 'HH:MM') in `zone`. */
export function zonedTime(key, hhmm, zone) {
  const [y, m, d] = key.split('-').map(Number), mins = minutesOf(hhmm), guess = Date.UTC(y, m - 1, d) + mins * MIN;
  let t = guess - zoneOffset(guess, zone) * MIN;
  const t2 = guess - zoneOffset(t, zone) * MIN; // DST edge: re-evaluate at the candidate instant
  if (t2 !== t) t = t2;
  return t;
}
/** 'YYYY-MM-DD' of instant `ms` in `zone`. */
export function zonedDay(ms, zone) { const p = partsIn(ms, safeZone(zone)); return `${p.y}-${String(p.mo).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`; }
export const addDays = (key, n) => new Date(Date.parse(key + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
const weekday = key => new Date(key + 'T12:00:00Z').getUTCDay();

// ---------- booking slots ----------
/**
 * Bookable slots of a service product for `days` days from `from` ('YYYY-MM-DD' in the service's time zone).
 * Slots follow the weekly availability windows: each starts `durationMinutes + bufferMinutes` after the previous one and
 * must end inside its window. A slot is left out when it starts before `now`, when it overlaps a booking that is not cancelled in
 * `bookings` (any service: one calendar) widened by the buffer, or when the day already holds `maxPerDay` active
 * bookings of this service. → [{ date, start, end (ISO) }]
 */
export function bookingSlots(product, { from, days = 7, bookings = [], now = 0 } = {}) {
  const s = product && product.service ? product.service : normalizeService(product && product.service);
  if (!s.booking.enabled) return [];
  const zone = safeZone(s.booking.timezone), dur = s.durationMinutes * MIN, buf = s.booking.bufferMinutes * MIN;
  const busy = bookings.filter(b => b.status !== 'cancelled').map(b => [Date.parse(b.start), Date.parse(b.end), b.productId]);
  const out = [];
  for (let i = 0; i < days; i++) {
    const key = addDays(from, i);
    if (s.booking.maxPerDay) {
      const taken = busy.filter(([a, , pid]) => pid === product.id && zonedDay(a, zone) === key).length;
      if (taken >= s.booking.maxPerDay) continue;
    }
    for (const w of s.booking.availability.filter(a => a.day === weekday(key))) {
      const end = zonedTime(key, w.end, zone);
      for (let t = zonedTime(key, w.start, zone); t + dur <= end; t += dur + buf) {
        if (t < now) continue;
        if (busy.some(([a, b]) => t < b + buf && t + dur > a - buf)) continue;
        out.push({ date: key, start: new Date(t).toISOString(), end: new Date(t + dur).toISOString() });
      }
    }
  }
  return out;
}

// ---------- utilisation & KPIs ----------
/** Merge [start, end] minute intervals. */
function union(list) {
  const s = list.slice().sort((a, b) => a[0] - b[0]), out = [];
  for (const iv of s) { const last = out[out.length - 1]; if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]); else out.push([...iv]); }
  return out;
}
/**
 * Booked time / available time over [from, to] (day keys, inclusive). Available time is the union of the weekly
 * availability windows of every service with booking enabled (one person's calendar); booked time is the length of the
 * bookings in the range that are requested, confirmed, completed or no-show (cancelled ones free their time).
 * → { availableMinutes, bookedMinutes, rate (0..1, capped) }
 */
export function utilisation({ services = [], bookings = [], from, to }) {
  const svc = services.filter(p => p && p.service && p.service.booking.enabled);
  let available = 0;
  for (let k = from; k <= to; k = addDays(k, 1)) {
    const wd = weekday(k);
    available += union(svc.flatMap(p => p.service.booking.availability.filter(a => a.day === wd).map(a => [minutesOf(a.start), minutesOf(a.end)]))).reduce((m, [a, b]) => m + b - a, 0);
  }
  let booked = 0;
  for (const b of bookings) {
    if (b.status === 'cancelled') continue;
    const ms = Date.parse(b.start), day = zonedDay(ms, b.timezone || 'UTC');
    if (day < from || day > to) continue;
    booked += Math.max(0, (Date.parse(b.end) - ms) / MIN);
  }
  return { availableMinutes: available, bookedMinutes: Math.round(booked), rate: available ? Math.min(1, booked / available) : 0 };
}

export const serviceProducts = store => (store && store.products || []).filter(isService);

/** Upcoming active bookings (start ≥ now), soonest first. */
export const upcomingBookings = (commerce, now = Date.now(), limit = Infinity) => (commerce.bookings || [])
  .filter(b => ACTIVE_BOOKING.includes(b.status) && Date.parse(b.end) >= now).sort((a, b) => a.start.localeCompare(b.start)).slice(0, limit);

/**
 * Service numbers for the Services overview. → { upcoming (active bookings in the next 7 days), requested (awaiting
 * confirmation), utilisation (next 7 days), utilisationPast (last 30 days), revenue (net service line revenue of paid
 * orders, last 30 days), revenuePrev (the 30 days before), openProjects, overdueProjects }
 */
export function serviceKpis(store, commerce, now = Date.now(), tz = 0) {
  const services = serviceProducts(store), ids = new Set(services.map(p => p.id));
  const today = new Date(now + tz * MIN).toISOString().slice(0, 10);
  const bookings = commerce.bookings || [];
  const week = now + 7 * DAY;
  const upcoming = bookings.filter(b => ACTIVE_BOOKING.includes(b.status) && Date.parse(b.start) >= now && Date.parse(b.start) < week).length;
  const requested = bookings.filter(b => b.status === 'requested' && Date.parse(b.end) >= now).length;
  const rev = (a, b) => {
    let c = 0;
    for (const o of commerce.orders || []) {
      if (o.draft || o.status === 'cancelled' || !['paid', 'partially_refunded'].includes(o.financialStatus)) continue;
      const t = Date.parse(o.createdAt); if (t < a || t >= b) continue;
      for (const l of o.lines) if (ids.has(l.productId)) c += Math.round(l.price * 100) * l.quantity;
    }
    return c / 100;
  };
  const projects = commerce.serviceProjects || [];
  return {
    upcoming, requested,
    utilisation: utilisation({ services, bookings, from: today, to: addDays(today, 6) }),
    utilisationPast: utilisation({ services, bookings, from: addDays(today, -29), to: today }),
    revenue: rev(now - 30 * DAY, now + 1), revenuePrev: rev(now - 60 * DAY, now - 30 * DAY),
    openProjects: projects.filter(p => p.stage !== 'completed').length,
    overdueProjects: projects.filter(p => p.stage !== 'completed' && p.stage !== 'delivered' && p.dueDate && p.dueDate < today).length,
  };
}

/** A booking's history entry. */
export const historyEntry = (message, now = Date.now()) => ({ id: sid('bh'), at: new Date(now).toISOString(), message });

/** New booking for a service product at `start` (ISO). Returns the normalised booking (not yet added). */
export function newBooking(product, { start, customer = null, name = '', email = '', status = 'confirmed', intake = [], notes = '', now = Date.now() } = {}) {
  const s = product.service || normalizeService(null), t = Date.parse(start);
  return normalizeBooking({
    productId: product.id, title: product.title, customerId: customer ? customer.id : null, name: name || (customer ? [customer.firstName, customer.lastName].filter(Boolean).join(' ') : ''),
    email: email || (customer ? customer.email : ''), start: new Date(t).toISOString(), end: new Date(t + s.durationMinutes * MIN).toISOString(), timezone: s.booking.timezone,
    status, location: { mode: s.delivery.mode, meetingUrl: s.delivery.meetingUrl, address: s.delivery.address }, intake, notes,
    price: s.pricing.model === 'hourly' ? Math.round(product.price * s.durationMinutes / 60 * 100) / 100 : s.pricing.model === 'package' ? Math.round(product.price / s.pricing.sessions * 100) / 100 : product.price,
    createdAt: new Date(now).toISOString(), history: [historyEntry('Booking created', now)],
  });
}
