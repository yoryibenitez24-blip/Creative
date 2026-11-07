// Product kinds beyond physical goods: services (consultations, projects, retainers) and digital downloads.
//
// Optional fields on a store product (src/store/model.js). A physical product carries none of them, so documents saved
// before product kinds existed (and every physical product) normalise exactly as before.
//
//   kind: 'service' | 'digital'          (absent = 'physical')
//   service: {
//     pricing:  { model: 'fixed'|'hourly'|'package'|'retainer', sessions (package: number of sessions, ≥ 2),
//                 stripePriceId (retainer: Stripe recurring price id 'price_…', billed monthly) }
//               product.price is the fixed price, the hourly rate, the package price or the monthly retainer.
//     durationMinutes: 15..480 (one session)
//     delivery: { mode: 'online'|'in_person'|'async', meetingUrl (online), address (in person), turnaroundDays (async) }
//     booking:  { enabled, timezone (IANA), bufferMinutes 0..240, maxPerDay 0..48 (0 = no limit),
//                 availability: [{ day: 0..6 (0 = Sunday), start: 'HH:MM', end: 'HH:MM' }] }   (weekly slots, in `timezone`)
//     intake:   [{ id, label, type: 'text'|'textarea'|'email'|'url'|'select'|'checkbox', required, options: string[] }]
//               (custom questions the buyer answers at checkout)
//     deliverables: string[], revisions: 0..99 (included revision rounds),
//     addOns:   [{ id, name, price }]  (optional extras), faq: [{ id, q, a }]
//   }
//   digital: { file: ImageRef|url|'' (the downloadable asset), fileName, downloadLimit: number|null (null = unlimited) }
//   sample: true                         (created by "Load sample data"; removed by "Clear sample data")

export const PRODUCT_KINDS = [['physical', 'Physical product'], ['service', 'Service'], ['digital', 'Digital download']];
export const PRICING_MODELS = [['fixed', 'Fixed price'], ['hourly', 'Hourly rate'], ['package', 'Package of sessions'], ['retainer', 'Monthly retainer']];
export const DELIVERY_MODES = [['online', 'Online meeting'], ['in_person', 'In person'], ['async', 'Async delivery']];
export const INTAKE_TYPES = [['text', 'Short answer'], ['textarea', 'Paragraph'], ['email', 'Email'], ['url', 'Link'], ['select', 'Dropdown'], ['checkbox', 'Checkbox']];
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

let n = 0;
const sid = p => p + '_' + Date.now().toString(36).slice(-4) + (n++).toString(36) + Math.random().toString(36).slice(2, 5);
const str = (v, d = '') => v == null ? d : String(v);
const num = (v, d, lo = -Infinity, hi = Infinity) => { const x = typeof v === 'string' && v.trim() === '' ? NaN : +v; return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d; };
const int = (v, d, lo, hi) => Math.round(num(v, d, lo, hi));
const pick = (v, list, d) => list.some(x => x[0] === v) ? v : d;
const arr = v => Array.isArray(v) ? v : [];
const hhmm = (v, d) => { const m = /^(\d{1,2}):(\d{2})$/.exec(str(v).trim()); if (!m) return d; const h = Math.min(23, +m[1]), mi = Math.min(59, +m[2]); return String(h).padStart(2, '0') + ':' + String(mi).padStart(2, '0'); };
export const minutesOf = t => { const [h, m] = String(t).split(':'); return (+h || 0) * 60 + (+m || 0); };
const validZone = z => { if (!z) return false; try { new Intl.DateTimeFormat('en-US', { timeZone: z }); return true; } catch { return false; } };

/** Monday–Friday 09:00–17:00. */
export const DEFAULT_AVAILABILITY = [1, 2, 3, 4, 5].map(day => ({ day, start: '09:00', end: '17:00' }));

export function normalizeService(s) {
  s = s && typeof s === 'object' ? s : {};
  const pr = s.pricing || {}, dl = s.delivery || {}, bk = s.booking || {};
  const model = pick(pr.model, PRICING_MODELS, 'fixed');
  return {
    pricing: { model, sessions: int(pr.sessions, 4, 2, 100), stripePriceId: str(pr.stripePriceId).trim().slice(0, 120) },
    durationMinutes: int(s.durationMinutes, 60, 15, 480),
    delivery: { mode: pick(dl.mode, DELIVERY_MODES, 'online'), meetingUrl: str(dl.meetingUrl).trim(), address: str(dl.address).trim(), turnaroundDays: int(dl.turnaroundDays, 7, 0, 365) },
    booking: {
      enabled: bk.enabled == null ? true : !!bk.enabled, timezone: validZone(str(bk.timezone).trim()) ? str(bk.timezone).trim() : 'UTC',
      bufferMinutes: int(bk.bufferMinutes, 15, 0, 240), maxPerDay: int(bk.maxPerDay, 0, 0, 48),
      availability: (Array.isArray(bk.availability) ? bk.availability : DEFAULT_AVAILABILITY)
        .map(a => ({ day: int(a && a.day, 1, 0, 6), start: hhmm(a && a.start, '09:00'), end: hhmm(a && a.end, '17:00') }))
        .filter(a => minutesOf(a.end) > minutesOf(a.start))
        .sort((a, b) => a.day - b.day || minutesOf(a.start) - minutesOf(b.start)),
    },
    intake: arr(s.intake).map(q => ({ id: str(q && q.id) || sid('q'), label: str(q && q.label).trim(), type: pick(q && q.type, INTAKE_TYPES, 'text'), required: !!(q && q.required),
      options: [...new Set(arr(q && q.options).map(o => str(o).trim()).filter(Boolean))] })).filter(q => q.label),
    deliverables: arr(s.deliverables).map(d => str(d).trim()).filter(Boolean),
    revisions: int(s.revisions, 0, 0, 99),
    addOns: arr(s.addOns).map(a => ({ id: str(a && a.id) || sid('ao'), name: str(a && a.name).trim(), price: Math.round(num(a && a.price, 0, 0) * 100) / 100 })).filter(a => a.name),
    faq: arr(s.faq).map(f => ({ id: str(f && f.id) || sid('fq'), q: str(f && f.q).trim(), a: str(f && f.a).trim() })).filter(f => f.q),
  };
}

export function normalizeDigital(d) {
  d = d && typeof d === 'object' ? d : {};
  const lim = d.downloadLimit;
  return { file: typeof d.file === 'string' ? d.file.trim() : '', fileName: str(d.fileName).trim(), downloadLimit: lim == null || lim === '' ? null : int(lim, 3, 1, 1000) };
}

/**
 * The kind-specific fields of a product, normalised: {} for a physical product (so its document is unchanged),
 * { kind: 'service', service } or { kind: 'digital', digital }; plus { sample: true } for sample products.
 */
export function normalizeProductKind(p) {
  const out = {};
  if (p && p.kind === 'service') { out.kind = 'service'; out.service = normalizeService(p.service); }
  else if (p && p.kind === 'digital') { out.kind = 'digital'; out.digital = normalizeDigital(p.digital); }
  if (p && p.sample) out.sample = true;
  return out;
}

export const productKind = p => p && (p.kind === 'service' || p.kind === 'digital') ? p.kind : 'physical';
export const isService = p => productKind(p) === 'service';

/** "$90 / hour", "$450 · 3 sessions", "$1,200 / month" — price text for a service product (fmt formats money). */
export function servicePriceLabel(p, fmt = v => String(v)) {
  if (!isService(p)) return fmt(p.price);
  const s = p.service || normalizeService(null);
  if (s.pricing.model === 'hourly') return fmt(p.price) + ' / hour';
  if (s.pricing.model === 'package') return fmt(p.price) + ' · ' + s.pricing.sessions + ' sessions';
  if (s.pricing.model === 'retainer') return fmt(p.price) + ' / month';
  return fmt(p.price);
}
