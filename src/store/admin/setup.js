// "Set up your store" guide on the commerce Dashboard: every step is detected from the real store and commerce
// documents (pure, no UI). Nothing is ticked by hand.
//
// Rules (setupProgress(store, commerce)):
//   product   an active product with a title, a price > 0 and at least one image, AND evidence that the merchant
//             worked on the catalogue: a product was saved in the product editor / imported (commerce.onboarding.steps.product,
//             set automatically on save) or a product image is the merchant's own (an uploaded 'asset:'/'data:' image or an
//             https URL) instead of a template sample ('unsplash:' photo / 'gen:' art).
//   theme     the store builder was used: opened from Online Store › Customize or a change was committed there
//             (commerce.onboarding.steps.theme, set automatically by the admin).
//   shipping  a shipping zone that covers at least one country and has at least one rate, AND the zones were saved in
//             Settings › Shipping (steps.shipping, set automatically on save) or differ from the defaults every new store gets.
//   payments  the checkout method is configured with real contact data: WhatsApp → a phone number that is not a template
//             placeholder (555 numbers), Email → an address that is not on an example domain, Payment links → at least one
//             http(s) link. "Catalog only" does not count.
//   domain    settings.domains.primary holds a host name (with a dot).
//   launch    the store was exported as a ZIP at least once (steps.launch, set by the export).
// Old manual flags for payments and domain (from the previous hand-ticked checklist) are ignored; the other flags were
// always written by the matching action, so they are kept as evidence of that action.
import { createCommerce } from './model.js';

export const SETUP_STEPS = ['product', 'theme', 'shipping', 'payments', 'domain', 'launch'];

const OWN_IMAGE = /^(asset:|data:image\/|https?:\/\/)/;
const digits = s => String(s || '').replace(/\D/g, '');

/** A phone number that is not a placeholder (needs ≥ 7 digits; fictional 555 numbers like +1 555 0100 do not count). */
export function realPhone(phone) {
  const d = digits(phone);
  if (d.length < 7) return false;
  return !/^1?555\d*$/.test(d) && !/^1?\d{3}555\d{4}$/.test(d) && !/^(\d)\1+$/.test(d);
}
/** An email address that is not on a reserved example domain. */
export function realEmail(email) {
  const m = /^[^\s@]+@([^\s@]+\.[^\s@]+)$/.exec(String(email || '').trim());
  if (!m) return false;
  return !/(^|\.)(example(\.(com|org|net))?|test|invalid|localhost)$/i.test(m[1]);
}

const priceOf = p => Math.max(+p.price || 0, ...(p.variants || []).map(v => +v.price || 0));
/** Products that are ready to sell: active, titled, priced and with an image. */
export const sellableProducts = store => (store?.products || []).filter(p => p.status !== 'draft' && String(p.title || '').trim() && priceOf(p) > 0 && (p.images || []).length > 0);

const zoneSig = zones => JSON.stringify((zones || []).map(z => [z.name, [...(z.countries || [])].sort(), (z.rates || []).map(r => [r.name, r.type, +r.price || 0, +r.threshold || 0, (r.tiers || []).map(t => [t.upTo, t.price])])]));

/** Is the checkout configured with real contact data? */
export function checkoutConfigured(store) {
  const c = store?.checkout || {};
  if (c.mode === 'whatsapp') return realPhone(c.phone);
  if (c.mode === 'email') return realEmail(c.email);
  if (c.mode === 'paymentLinks') return Object.values(c.paymentLinks || {}).some(u => /^https?:\/\/\S+\.\S+/.test(String(u).trim()));
  return false;
}

/**
 * → { steps: { product, theme, shipping, payments, domain, launch: bool }, done: number, total: 6, complete: bool, next: key|null }
 */
export function setupProgress(store, commerce) {
  const flags = commerce?.onboarding?.steps || {};
  const ready = sellableProducts(store);
  const product = ready.length > 0 && (!!flags.product || ready.some(p => p.images.some(r => OWN_IMAGE.test(r))));
  const zones = commerce?.settings?.shipping?.zones || [];
  const hasRate = zones.some(z => (z.countries || []).length > 0 && (z.rates || []).length > 0);
  const shipping = hasRate && (!!flags.shipping || zoneSig(zones) !== zoneSig(createCommerce(store || {}).settings.shipping.zones));
  const steps = {
    product,
    theme: !!flags.theme,
    shipping,
    payments: checkoutConfigured(store),
    domain: /\.[a-z0-9-]{2,}$/i.test(String(commerce?.settings?.domains?.primary || '').trim()),
    launch: !!flags.launch,
  };
  const done = SETUP_STEPS.filter(k => steps[k]).length;
  return { steps, done, total: SETUP_STEPS.length, complete: done === SETUP_STEPS.length, next: SETUP_STEPS.find(k => !steps[k]) || null };
}
