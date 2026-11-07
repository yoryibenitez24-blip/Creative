// Stripe Checkout Session parameters from a validated cart + server-computed totals (pure).
//
// Money flow per connectType (settings.payments.stripe.connectType):
//   'express' | 'custom' → destination charge on the platform: payment_intent_data.transfer_data.destination +
//                          on_behalf_of = the connected account, application_fee_amount = platform fee.
//   'standard'           → direct charge on the connected account (request header Stripe-Account), with
//                          application_fee_amount; coupons must then be created on that account too.
//   'none'               → plain charge on the platform account (the merchant runs the platform themselves).
// Subscriptions (any recurring line) use subscription_data.application_fee_percent (+ transfer_data for destination).

import type Stripe from 'npm:stripe@23.1.0';
import type { ValidLine } from './cart.ts';
import { isSubscription, needsShipping } from './cart.ts';
import { applicationFeeAmount, feePercent } from './fees.ts';
import { toMinor } from './money.ts';
import { STRIPE_SHIPPING_COUNTRIES } from './countries.ts';

export type ConnectType = 'express' | 'standard' | 'custom' | 'none';
export interface StripePublicConfig {
  enabled?: boolean; mode?: 'test' | 'live'; connectType?: ConnectType; accountId?: string;
  applicationFeePercent?: number; applicationFeeFixed?: number; captureMethod?: 'automatic' | 'manual';
  paymentMethods?: string[]; statementDescriptor?: string; statementDescriptorSuffix?: string; currency?: string;
  automaticTax?: boolean; threeDSecure?: 'automatic' | 'any' | 'challenge'; savePaymentMethods?: boolean;
  allowPromotionCodes?: boolean;
  billing?: { subscriptions?: boolean; customerPortal?: boolean; invoices?: boolean; trialDays?: number };
}
/** Output of the shared pricing engine (CK.totals) — the fields the server uses. */
export interface EngineTotals {
  subtotal: number; discountTotal: number; shipping: number; shippingDiscount: number; tax: number; taxRate: number; taxName: string;
  taxInclusive: boolean; total: number; shippingRateId: string | null; shippingName: string; appliedCodes: string[];
  applied: { id?: string; title?: string; code?: string; type?: string; amount: number }[];
  rates: { id: string; name: string; price: number }[];
}
export interface BuildInput {
  orderId: string; storeId: string; currency: string; lines: ValidLine[]; totals: EngineTotals; cfg: StripePublicConfig;
  accountId: string | null; successUrl: string; cancelUrl: string; country: string; zoneCountries: string[];
  customerEmail?: string; couponId?: string | null; feeEnvPercent?: string | null; sessionRef?: string; siteBase?: string;
}
export interface BuildOutput {
  params: Stripe.Checkout.SessionCreateParams; stripeAccount: string | undefined; mode: 'payment' | 'subscription';
  applicationFeeMinor: number; expectedTotalMinor: number;
}

export const PAYMENT_METHODS = new Set(['acss_debit', 'affirm', 'afterpay_clearpay', 'alipay', 'alma', 'amazon_pay', 'au_becs_debit', 'bacs_debit', 'bancontact', 'billie', 'bizum', 'blik', 'boleto', 'card', 'cashapp', 'crypto', 'customer_balance', 'eps', 'fpx', 'grabpay', 'ideal', 'kakao_pay', 'klarna', 'konbini', 'kr_card', 'link', 'mb_way', 'mobilepay', 'multibanco', 'naver_pay', 'nz_bank_account', 'oxxo', 'p24', 'pay_by_bank', 'payco', 'paynow', 'paypal', 'paypay', 'payto', 'pix', 'promptpay', 'revolut_pay', 'samsung_pay', 'satispay', 'scalapay', 'sepa_debit', 'sequra', 'swish', 'twint', 'upi', 'us_bank_account', 'wechat_pay', 'zip']);

export function connectMode(cfg: StripePublicConfig, accountId: string | null): 'destination' | 'direct' | 'platform' {
  if (!accountId || cfg.connectType === 'none') return 'platform';
  return cfg.connectType === 'standard' ? 'direct' : 'destination';
}

/** Stripe statement descriptor suffix: ≤ 22 chars, latin letters/digits/space and a few symbols, at least one letter. */
export function descriptorSuffix(s: unknown): string {
  const v = String(s ?? '').replace(/[<>\\'"*]/g, '').replace(/[^\x20-\x7E]/g, '').trim().slice(0, 22);
  return /[A-Za-z]/.test(v) ? v : '';
}

const absImage = (src: string, base?: string): string => {
  try { const u = new URL(src, base || undefined); return u.protocol === 'https:' ? u.href : ''; } catch { return ''; }
};
const clip = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/** Coupon for the server-computed item discount (null when there is none). Created per checkout, single use. */
export function couponFor(totals: EngineTotals, currency: string, orderId: string): Stripe.CouponCreateParams | null {
  const off = toMinor(totals.discountTotal, currency);
  if (off <= 0) return null;
  const codes = totals.appliedCodes.length ? totals.appliedCodes.join(', ') : (totals.applied.find(a => a.amount > 0 && a.type !== 'free_shipping')?.title || '');
  return { amount_off: off, currency: currency.toLowerCase(), duration: 'once', max_redemptions: 1, name: clip(codes ? `Discount (${codes})` : 'Discount', 40), metadata: { order_id: orderId } };
}

export function buildSessionParams(i: BuildInput): BuildOutput {
  const cur = i.currency.toLowerCase(), cfg = i.cfg, t = i.totals;
  const sub = isSubscription(i.lines); // recurring lines (retainers, subscriptions) always need subscription mode
  const mode: 'payment' | 'subscription' = sub ? 'subscription' : 'payment';
  const how = connectMode(cfg, i.accountId);
  const taxBehavior: 'inclusive' | 'exclusive' | undefined = cfg.automaticTax ? (t.taxInclusive ? 'inclusive' : 'exclusive') : undefined;
  const meta: Record<string, string> = { order_id: i.orderId, store_id: i.storeId, ...(t.appliedCodes.length ? { codes: t.appliedCodes.join(',').slice(0, 500) } : {}), ...(i.sessionRef ? { session_ref: i.sessionRef.slice(0, 100) } : {}) };

  const line_items: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
  for (const l of i.lines) {
    // retainer with its own Stripe recurring price: charge that price; add-ons become one-time extras
    if (sub && l.stripePriceId) {
      line_items.push({ price: l.stripePriceId, quantity: l.quantity });
      for (const a of l.addOns) line_items.push({ quantity: l.quantity, price_data: { currency: cur, unit_amount: toMinor(a.price, i.currency), product_data: { name: clip(`${l.title} – ${a.name}`, 250), metadata: { product_id: l.productId, addon_id: a.id } } } });
    } else line_items.push(lineItem(l));
  }
  function lineItem(l: ValidLine): Stripe.Checkout.SessionCreateParams.LineItem {
    const img = l.image ? absImage(l.image, i.siteBase) : '';
    const desc = [l.start ? 'Booked for ' + l.start.replace('T', ' ').slice(0, 16) + ' UTC' : '', l.addOns.length ? 'Extras: ' + l.addOns.map(a => a.name).join(', ') : ''].filter(Boolean).join(' · ');
    return {
      quantity: l.quantity,
      price_data: {
        currency: cur, unit_amount: toMinor(l.price, i.currency),
        product_data: { name: clip(l.title + (l.variantTitle ? ' – ' + l.variantTitle : ''), 250), ...(desc ? { description: clip(desc, 500) } : {}), ...(img ? { images: [img] } : {}), metadata: { product_id: l.productId, variant_id: l.variantId, ...(l.sku ? { sku: l.sku } : {}), ...(l.start ? { start: l.start } : {}) } },
        ...(sub && l.recurring ? { recurring: { interval: l.recurring.interval, interval_count: l.recurring.intervalCount || 1 } } : {}),
        ...(taxBehavior ? { tax_behavior: taxBehavior } : {}),
      },
    };
  }
  let expected = i.lines.reduce((s, l) => s + toMinor(l.price, i.currency) * l.quantity, 0);

  // tax from the store's own tax table (only when Stripe Tax is off and prices exclude tax)
  if (!cfg.automaticTax && t.tax > 0 && !t.taxInclusive) {
    const amt = toMinor(t.tax, i.currency);
    line_items.push({ quantity: 1, price_data: { currency: cur, unit_amount: amt, product_data: { name: clip(`${t.taxName || 'Tax'} ${t.taxRate}%`, 250), metadata: { kind: 'tax' } } } });
    expected += amt;
  }

  const params: Stripe.Checkout.SessionCreateParams = {
    mode, line_items, success_url: i.successUrl, cancel_url: i.cancelUrl, client_reference_id: i.orderId, metadata: meta,
    locale: 'auto', billing_address_collection: 'auto',
  };
  if (i.customerEmail) params.customer_email = i.customerEmail;
  if (cfg.automaticTax) params.automatic_tax = { enabled: true };

  // shipping: the shopper picked country + rate on the storefront; Stripe collects the address for that country only
  if (needsShipping(i.lines)) {
    const c = i.country.toUpperCase();
    const countries = c && c !== '*' ? [c] : STRIPE_SHIPPING_COUNTRIES.filter(x => !i.zoneCountries.includes(x));
    params.shipping_address_collection = { allowed_countries: countries as Stripe.Checkout.SessionCreateParams.ShippingAddressCollection.AllowedCountry[] };
    if (t.shippingRateId) {
      const amt = toMinor(t.shipping, i.currency), name = clip(t.shippingName || 'Shipping', 100);
      if (mode === 'payment') params.shipping_options = [{ shipping_rate_data: { type: 'fixed_amount', display_name: name, fixed_amount: { amount: amt, currency: cur }, ...(taxBehavior ? { tax_behavior: 'exclusive' as const } : {}), metadata: { rate_id: t.shippingRateId } } }];
      else if (amt > 0) line_items.push({ quantity: 1, price_data: { currency: cur, unit_amount: amt, product_data: { name: `Shipping – ${name}`, metadata: { kind: 'shipping' } } } });
      expected += amt;
    }
  }

  // discount: one single-use coupon for the server-computed amount, or Stripe promotion codes typed on the Stripe page
  if (i.couponId) { params.discounts = [{ coupon: i.couponId }]; expected -= toMinor(t.discountTotal, i.currency); }
  else if (cfg.allowPromotionCodes) params.allow_promotion_codes = true;

  const methods = (cfg.paymentMethods || []).filter(m => PAYMENT_METHODS.has(m));
  if (methods.length) params.allowed_payment_method_types = methods as Stripe.Checkout.SessionCreateParams.AllowedPaymentMethodType[];
  if (cfg.threeDSecure === 'any' || cfg.threeDSecure === 'challenge') params.payment_method_options = { card: { request_three_d_secure: cfg.threeDSecure } };

  const suffix = descriptorSuffix(cfg.statementDescriptorSuffix);
  let fee = 0;
  if (mode === 'payment') {
    fee = how === 'platform' ? 0 : applicationFeeAmount(expected, i.currency, cfg, i.feeEnvPercent);
    const pid: Stripe.Checkout.SessionCreateParams.PaymentIntentData = { metadata: meta, capture_method: cfg.captureMethod === 'manual' ? 'manual' : 'automatic' };
    if (suffix) pid.statement_descriptor_suffix = suffix;
    if (cfg.savePaymentMethods) pid.setup_future_usage = 'off_session';
    if (fee > 0) pid.application_fee_amount = fee;
    if (how === 'destination' && i.accountId) { pid.transfer_data = { destination: i.accountId }; pid.on_behalf_of = i.accountId; }
    params.payment_intent_data = pid;
    if (cfg.savePaymentMethods || cfg.billing?.customerPortal) params.customer_creation = 'always';
    if (cfg.billing?.invoices) params.invoice_creation = { enabled: true, invoice_data: { metadata: meta } };
  } else {
    const sd: Stripe.Checkout.SessionCreateParams.SubscriptionData = { metadata: meta };
    const pct = how === 'platform' ? 0 : feePercent(cfg, i.feeEnvPercent);
    if (pct > 0) sd.application_fee_percent = pct;
    if (how === 'destination' && i.accountId) { sd.transfer_data = { destination: i.accountId }; sd.on_behalf_of = i.accountId; }
    const trial = Math.round(Number(cfg.billing?.trialDays || 0));
    if (trial >= 1 && trial <= 730) sd.trial_period_days = trial;
    params.subscription_data = sd;
  }
  return { params, stripeAccount: how === 'direct' && i.accountId ? i.accountId : undefined, mode, applicationFeeMinor: fee, expectedTotalMinor: Math.max(0, expected) };
}
