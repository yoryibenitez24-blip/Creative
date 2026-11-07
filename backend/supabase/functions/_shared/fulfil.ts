// Paid order lines → service bookings, service projects and digital download grants (pure).
// Mirrors the admin (src/store/admin/services.js newBooking / serviceProjects): bookings start 'requested', projects
// start at stage 'new' with dueDate = paid day + delivery.turnaroundDays and the product's deliverables.
import type { ServiceConfig } from './services.d.ts';

export interface PaidLine { product_id: string; title: string; quantity: number; kind: string; details: { start?: string | null; intake?: { question: string; answer: string }[]; addOns?: { id: string; name: string; price: number }[]; basePrice?: number } | null }
export interface FulfilProduct { id: string; title: string; service: ServiceConfig | null; digital: { file: string; fileName: string; downloadLimit: number | null } | null }
export interface FulfilOrder { id: string; store_id: string; customer_id: string | null; name: string; email: string; phone: string; paid_at?: string | null }

const MIN = 60_000, DAY = 86_400_000;

export function serviceRecords(order: FulfilOrder, lines: PaidLine[], products: Map<string, FulfilProduct>, now: number) {
  const bookings: Record<string, unknown>[] = [], projects: Record<string, unknown>[] = [], downloads: Record<string, unknown>[] = [];
  const attendee = { name: order.name || '', email: order.email || '', phone: order.phone || '' };
  const paid = order.paid_at ? Date.parse(order.paid_at) : now;
  for (const l of lines) {
    const p = products.get(l.product_id), d = l.details || {};
    if (l.kind === 'service' && p?.service) {
      const s = p.service;
      if (d.start && s.booking.enabled) {
        const t = Date.parse(d.start);
        bookings.push({ store_id: order.store_id, order_id: order.id, customer_id: order.customer_id, product_id: p.id, starts_at: new Date(t).toISOString(),
          ends_at: new Date(t + s.durationMinutes * MIN).toISOString(), timezone: s.booking.timezone, status: 'requested', attendee, intake: d.intake || [], add_ons: d.addOns || [],
          price: d.basePrice ?? 0, notes: '' });
      } else {
        projects.push({ store_id: order.store_id, order_id: order.id, customer_id: order.customer_id, product_id: p.id, title: p.title || l.title, stage: 'new',
          due_date: new Date(paid + s.delivery.turnaroundDays * DAY).toISOString().slice(0, 10), deliverables: s.deliverables, intake: d.intake || [], add_ons: d.addOns || [], client: attendee });
      }
    } else if (l.kind === 'digital' && p?.digital?.file) {
      const f = p.digital.file;
      if (!/^storage:[\w./-]+$/.test(f) && !/^https:\/\//.test(f)) continue; // app-local refs (asset:…) cannot be served by the backend
      const lim = p.digital.downloadLimit;
      downloads.push({ store_id: order.store_id, order_id: order.id, product_id: p.id, title: p.title || l.title, file: f, file_name: p.digital.fileName || '',
        download_limit: lim == null ? null : lim * Math.max(1, l.quantity), expires_at: new Date(paid + 365 * DAY).toISOString() });
    }
  }
  return { bookings, projects, downloads };
}
