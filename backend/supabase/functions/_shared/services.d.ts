// Types of the generated service helpers (services.js, bundled from src/store/admin/services.js + src/store/serviceProduct.js).
export interface ServiceIntakeQuestion { id: string; label: string; type: 'text' | 'textarea' | 'email' | 'url' | 'select' | 'checkbox'; required: boolean; options: string[] }
export interface ServiceConfig {
  pricing: { model: 'fixed' | 'hourly' | 'package' | 'retainer'; sessions: number; stripePriceId: string };
  durationMinutes: number;
  delivery: { mode: 'online' | 'in_person' | 'async'; meetingUrl: string; address: string; turnaroundDays: number };
  booking: { enabled: boolean; timezone: string; bufferMinutes: number; maxPerDay: number; availability: { day: number; start: string; end: string }[] };
  intake: ServiceIntakeQuestion[]; deliverables: string[]; revisions: number; addOns: { id: string; name: string; price: number }[]; faq: unknown[];
}
export interface Slot { date: string; start: string; end: string }
export declare function bookingSlots(product: { id: string; service?: ServiceConfig | null }, opts: { from: string; days?: number; bookings?: { start: string; end: string; status: string; productId: string }[]; now?: number }): Slot[];
export declare function zonedDay(ms: number, zone: string): string;
export declare function normalizeService(s: unknown): ServiceConfig;
export declare function normalizeDigital(d: unknown): { file: string; fileName: string; downloadLimit: number | null };
