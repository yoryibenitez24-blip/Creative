// Customers CSV import / export (pure).
// Columns: first_name, last_name, email, phone, company, accepts_marketing (yes|no), tags (separated by ';'), note,
//          address1, address2, city, province, zip, country (ISO alpha-2)
// Import merges rows into existing customers by email (case-insensitive); rows without an email are matched by phone,
// otherwise added as new customers.
import { parseCsv } from '../model.js';
import { normalizeCustomer } from './model.js';

export const CUSTOMER_CSV_COLUMNS = ['first_name', 'last_name', 'email', 'phone', 'company', 'accepts_marketing', 'tags', 'note', 'address1', 'address2', 'city', 'province', 'zip', 'country'];
const cell = v => { v = v == null ? '' : String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };

export function customersToCsv(customers) {
  const lines = [CUSTOMER_CSV_COLUMNS.join(',')];
  for (const c of customers) {
    const a = c.address || {};
    const row = { first_name: c.firstName, last_name: c.lastName, email: c.email, phone: c.phone, company: c.company, accepts_marketing: c.acceptsMarketing ? 'yes' : 'no', tags: c.tags.join(';'), note: c.note,
      address1: a.address1, address2: a.address2, city: a.city, province: a.province, zip: a.zip, country: a.country };
    lines.push(CUSTOMER_CSV_COLUMNS.map(k => cell(row[k])).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

/** → { customers (merged list), added, updated, errors } — the input list is not mutated. */
export function importCustomersCsv(customers, text, now) {
  const rows = parseCsv(text), errors = [];
  if (!rows.length) return { customers, added: 0, updated: 0, errors: ['The file is empty'] };
  const head = rows[0].map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
  if (!head.includes('email') && !head.includes('first_name') && !head.includes('phone')) return { customers, added: 0, updated: 0, errors: ['Missing an "email", "first_name" or "phone" column'] };
  const get = (r, k) => { const i = head.indexOf(k); return i < 0 ? null : (r[i] ?? '').trim(); };
  const out = customers.map(c => JSON.parse(JSON.stringify(c)));
  let added = 0, updated = 0;
  rows.slice(1).forEach((r, n) => {
    const email = (get(r, 'email') || '').toLowerCase(), phone = get(r, 'phone') || '';
    if (!email && !phone && !get(r, 'first_name') && !get(r, 'last_name')) { errors.push(`Row ${n + 2}: empty`); return; }
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.push(`Row ${n + 2}: "${email}" does not look like an email address`);
    const existing = email ? out.find(c => c.email === email) : phone ? out.find(c => !c.email && c.phone === phone) : null;
    const base = existing || { createdAt: new Date(now == null ? Date.now() : now).toISOString() };
    const val = (k, d) => { const v = get(r, k); return v == null || v === '' ? d : v; };
    const addr = {}; for (const k of ['address1', 'address2', 'city', 'province', 'zip', 'country']) addr[k] = val(k, base.address?.[k] || '');
    const am = get(r, 'accepts_marketing');
    const next = normalizeCustomer({
      ...base, email: email || base.email, phone: val('phone', base.phone), firstName: val('first_name', base.firstName), lastName: val('last_name', base.lastName), company: val('company', base.company),
      acceptsMarketing: am == null || am === '' ? !!base.acceptsMarketing : /^(yes|true|1|y)$/i.test(am), tags: get(r, 'tags') ? get(r, 'tags').split(';') : base.tags || [], note: val('note', base.note || ''),
      address: { ...(base.address || {}), ...addr, name: base.address?.name || [val('first_name', ''), val('last_name', '')].filter(Boolean).join(' ') },
    });
    if (existing) { out[out.indexOf(existing)] = next; updated++; } else { out.push(next); added++; }
  });
  return { customers: out, added, updated, errors };
}
