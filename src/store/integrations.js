// Integrations: Stripe Connect payment settings, third-party tags (analytics, pixels, bot protection, error monitoring),
// the backend (Supabase) and the consent banner. Pure functions shared by the admin (Settings), the storefront
// renderer (src/store/render.js) and the checkout (src/store/commerce.js).
//
// Data (inside the commerce document, src/store/admin/model.js):
//   commerce.settings.payments.stripe = normalizeStripe(...)        — see STRIPE_DEFAULTS
//   commerce.settings.integrations    = normalizeIntegrations(...)  — see INTEGRATION_DEFAULTS
//
// SECRETS ARE NEVER STORED. Only public identifiers live in these documents (they end up in a static site).
// Stripe secret keys, webhook signing secrets, the Supabase service-role key, email API keys and bot tokens belong in
// the backend's environment (see SERVER_SECRETS / secretsCommand()). normalize*() drops any value that looks secret.
//
// Backend contract used by the admin (Supabase Edge Functions; functionsUrl defaults to `${url}/functions/v1`):
//   POST {functionsUrl}/stripe-connect-onboard   headers: apikey + Authorization: Bearer <anonKey>, JSON body
//        { storeId, mode, connectType, accountId, country, email, businessType, returnUrl, refreshUrl }
//        → 200 { url (Stripe-hosted onboarding link), accountId, onboardingStatus?, chargesEnabled?, payoutsEnabled? }
//   POST {functionsUrl}/stripe-webhook           Stripe → backend (events: STRIPE_WEBHOOK_EVENTS)

// ---------- constants ----------
export const STRIPE_MODES = ['test', 'live'];
export const CONNECT_TYPES = [
  ['standard', 'Standard', 'You own a full Stripe account and dashboard. Stripe handles disputes and support.'],
  ['express', 'Express', 'Stripe-hosted onboarding and a light dashboard; the platform controls payouts and fees.'],
  ['custom', 'Custom', 'Fully white-labelled. The platform is responsible for onboarding, support and disputes.'],
];
export const ONBOARDING_STATUSES = ['not_connected', 'pending', 'connected', 'restricted'];

/** Payment method types: [id, label, group, region note]. */
export const PAYMENT_METHODS = [
  ['card', 'Credit and debit cards', 'cards', 'Visa, Mastercard, Amex, Discover, JCB, UnionPay — worldwide'],
  ['apple_pay', 'Apple Pay', 'cards', 'Worldwide · your domain must be verified with Stripe'],
  ['google_pay', 'Google Pay', 'cards', 'Worldwide · shown in Chrome and on Android'],
  ['link', 'Link', 'cards', 'Stripe’s one-click checkout · most countries'],
  ['paypal', 'PayPal', 'cards', 'EEA, UK and Switzerland through Stripe'],
  ['cashapp', 'Cash App Pay', 'cards', 'United States · USD only'],
  ['alipay', 'Alipay', 'cards', 'Customers in China · many settlement currencies'],
  ['wechat_pay', 'WeChat Pay', 'cards', 'Customers in China · QR code at checkout'],
  ['klarna', 'Klarna', 'bnpl', 'US, UK, EEA, Australia, Canada · pay later or in 4'],
  ['afterpay_clearpay', 'Afterpay / Clearpay', 'bnpl', 'US, Canada, UK, Australia, New Zealand'],
  ['affirm', 'Affirm', 'bnpl', 'United States and Canada · orders from $50'],
  ['sepa_debit', 'SEPA Direct Debit', 'bank', 'Euro payments across the EEA · settles in days'],
  ['us_bank_account', 'ACH Direct Debit', 'bank', 'United States bank accounts · USD only'],
  ['ideal', 'iDEAL', 'bank', 'Netherlands · EUR'],
  ['bancontact', 'Bancontact', 'bank', 'Belgium · EUR'],
  ['giropay', 'giropay', 'bank', 'Germany · discontinued by the scheme in 2024, kept for older setups'],
  ['eps', 'EPS', 'bank', 'Austria · EUR'],
  ['p24', 'Przelewy24', 'bank', 'Poland · EUR and PLN'],
  ['sofort', 'Sofort', 'bank', 'Germany, Austria · being replaced by Klarna'],
  ['oxxo', 'OXXO', 'vouchers', 'Mexico · cash voucher paid at a store, MXN'],
  ['boleto', 'Boleto', 'vouchers', 'Brazil · bank voucher, BRL, needs the buyer’s tax ID'],
  ['pix', 'Pix', 'realtime', 'Brazil · instant QR payment, BRL'],
  ['blik', 'BLIK', 'realtime', 'Poland · 6-digit code from the banking app, PLN'],
];
export const PAYMENT_METHOD_IDS = PAYMENT_METHODS.map(m => m[0]);
export const PAYMENT_GROUPS = [['cards', 'Cards & wallets'], ['bnpl', 'Buy now, pay later'], ['bank', 'Bank debits & redirects'], ['vouchers', 'Vouchers'], ['realtime', 'Real-time payments']];
export const DEFAULT_PAYMENT_METHODS = ['card', 'apple_pay', 'google_pay', 'link'];

export const STRIPE_WEBHOOK_EVENTS = [
  ['checkout.session.completed', 'Checkout finished: create the order'],
  ['payment_intent.succeeded', 'Payment captured: mark the order paid'],
  ['payment_intent.payment_failed', 'Payment failed: notify the customer'],
  ['charge.refunded', 'Refund issued: update the order'],
  ['charge.dispute.created', 'Chargeback opened: alert the team'],
  ['customer.subscription.created', 'Subscription started'],
  ['customer.subscription.updated', 'Subscription changed (plan, status)'],
  ['customer.subscription.deleted', 'Subscription cancelled'],
  ['invoice.paid', 'Invoice paid (subscriptions, invoices)'],
  ['invoice.payment_failed', 'Invoice payment failed: dunning'],
  ['account.updated', 'Connected account changed: onboarding status, charges, payouts'],
  ['payout.paid', 'Payout reached the bank'],
];
export const STRIPE_WEBHOOK_EVENT_IDS = STRIPE_WEBHOOK_EVENTS.map(e => e[0]);
export const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
export const STRIPE_CURRENCIES = ['usd', 'eur', 'gbp', 'cad', 'aud', 'jpy', 'inr', 'brl', 'mxn', 'chf', 'sek', 'nzd', 'zar', 'aed', 'sgd', 'pln', 'dkk', 'nok', 'hkd'];

export const STRIPE_DEFAULTS = {
  enabled: false, mode: 'test', connectType: 'standard', accountId: '', publishableKeyTest: '', publishableKeyLive: '',
  onboardingStatus: 'not_connected', chargesEnabled: false, payoutsEnabled: false,
  applicationFeePercent: 0, applicationFeeFixed: 0, captureMethod: 'automatic', paymentMethods: DEFAULT_PAYMENT_METHODS,
  statementDescriptor: '', statementDescriptorSuffix: '', currency: 'usd', automaticTax: false, threeDSecure: 'automatic',
  savePaymentMethods: false, radar: { blockHighRisk: true, review3dsFailed: true },
  payoutSchedule: { interval: 'daily', weeklyAnchor: 'monday', monthlyAnchor: 1, delayDays: 0 },
  billing: { subscriptions: false, customerPortal: false, invoices: false, trialDays: 0 },
  webhookEvents: STRIPE_WEBHOOK_EVENT_IDS,
};

export const EMAIL_PROVIDERS = [['none', 'None (open emails in your mail app)'], ['resend', 'Resend'], ['sendgrid', 'SendGrid'], ['postmark', 'Postmark']];
export const CONSENT_REGIONS = [['eu', 'Visitors in the EU, EEA, UK and Switzerland'], ['all', 'All visitors'], ['none', 'Nobody (no banner)']];
export const INTEGRATION_DEFAULTS = {
  backend: { provider: 'none', url: '', anonKey: '', functionsUrl: '' },
  ga4: { measurementId: '' }, gtm: { containerId: '' }, metaPixel: { pixelId: '' }, tiktokPixel: { pixelId: '' }, pinterestTag: { tagId: '' },
  clarity: { projectId: '' }, turnstile: { siteKey: '' }, recaptcha: { siteKey: '' }, sentry: { dsn: '' },
  email: { provider: 'none', fromEmail: '', replyTo: '' }, discord: { guildId: '' }, telegram: { botUsername: '' },
  consent: { banner: true, region: 'eu' },
};

/** Secrets that live only in the backend environment: [env var, what it is, when it is needed (integration key)]. */
export const SERVER_SECRETS = [
  ['STRIPE_SECRET_KEY', 'Stripe secret key (sk_live_… / sk_test_…) — creates checkout sessions and connected accounts', 'stripe'],
  ['STRIPE_WEBHOOK_SECRET', 'Webhook signing secret (whsec_…) — verifies events sent to stripe-webhook', 'stripe'],
  ['SUPABASE_SERVICE_ROLE_KEY', 'Supabase service-role key — lets Edge Functions write orders past row-level security', 'supabase'],
  ['RESEND_API_KEY', 'Resend API key — sends order emails', 'resend'],
  ['SENDGRID_API_KEY', 'SendGrid API key — sends order emails', 'sendgrid'],
  ['POSTMARK_SERVER_TOKEN', 'Postmark server token — sends order emails', 'postmark'],
  ['TURNSTILE_SECRET_KEY', 'Cloudflare Turnstile secret — verifies the checkout challenge server-side', 'turnstile'],
  ['RECAPTCHA_SECRET_KEY', 'reCAPTCHA secret — verifies the token server-side', 'recaptcha'],
  ['DISCORD_BOT_TOKEN', 'Discord bot token — posts order alerts and grants buyer roles', 'discord'],
  ['TELEGRAM_BOT_TOKEN', 'Telegram bot token (from @BotFather) — order alerts', 'telegram'],
];

// ---------- validation ----------
const b64json = part => {
  try {
    const s = part.replace(/-/g, '+').replace(/_/g, '/'), pad = s + '='.repeat((4 - s.length % 4) % 4);
    const txt = typeof atob === 'function' ? atob(pad) : Buffer.from(pad, 'base64').toString('binary');
    return JSON.parse(txt);
  } catch { return null; }
};
const JWT = /^[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}$/;
/** Payload of a JWT (no signature check) or null. */
export const jwtPayload = v => JWT.test(String(v || '').trim()) ? b64json(String(v).trim().split('.')[1]) : null;

/** Why a value must not be stored (it looks like a server secret), or '' when it is fine. */
export function secretReason(value) {
  const v = String(value == null ? '' : value).trim();
  if (!v) return '';
  if (/^(sk|rk)_(test|live)_/.test(v)) return 'This is a Stripe secret or restricted key. Never paste it here: set STRIPE_SECRET_KEY in your backend.';
  if (/^whsec_/.test(v)) return 'This is a webhook signing secret. Set STRIPE_WEBHOOK_SECRET in your backend instead.';
  if (/^sb_secret_/.test(v)) return 'This is a Supabase secret key. Set SUPABASE_SERVICE_ROLE_KEY in your backend instead.';
  const p = jwtPayload(v);
  if (p && (p.role === 'service_role' || p.role === 'supabase_admin')) return 'This is the Supabase service-role key. It bypasses row-level security — set SUPABASE_SERVICE_ROLE_KEY in your backend and use the anon key here.';
  if (/^re_[A-Za-z0-9_]{16,}$/.test(v)) return 'This looks like a Resend API key. Set RESEND_API_KEY in your backend.';
  if (/^SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}$/.test(v)) return 'This looks like a SendGrid API key. Set SENDGRID_API_KEY in your backend.';
  if (/^\d{6,12}:[A-Za-z0-9_-]{30,}$/.test(v)) return 'This looks like a Telegram bot token. Set TELEGRAM_BOT_TOKEN in your backend.';
  if (/^[MN][A-Za-z0-9_-]{23,27}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}$/.test(v)) return 'This looks like a Discord bot token. Set DISCORD_BOT_TOKEN in your backend.';
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(v)) return 'This is a private key. Keep it on your server.';
  return '';
}
export const looksSecret = v => !!secretReason(v);

const RX = {
  pkTest: /^pk_test_[A-Za-z0-9]{10,}$/, pkLive: /^pk_live_[A-Za-z0-9]{10,}$/, acct: /^acct_[A-Za-z0-9]{8,32}$/,
  ga4: /^G-[A-Z0-9]{4,12}$/, gtm: /^GTM-[A-Z0-9]{4,10}$/, metaPixel: /^\d{10,20}$/, tiktokPixel: /^[A-Z0-9]{15,25}$/, pinterestTag: /^\d{10,16}$/,
  clarity: /^[a-z0-9]{6,14}$/, turnstile: /^[0-3]x[A-Za-z0-9_-]{16,}$/, recaptcha: /^6L[A-Za-z0-9_-]{38}$/,
  sentry: /^https:\/\/[0-9a-f]{32}@[a-z0-9.-]+\.[a-z]{2,}\/\d+$/, supabaseUrl: /^https:\/\/[a-z0-9][a-z0-9-]{2,62}\.supabase\.co$/,
  httpsUrl: /^https:\/\/[A-Za-z0-9.-]+(:\d+)?(\/[A-Za-z0-9._~\/-]*)?$/, email: /^[^\s@<>"]+@[^\s@<>"]+\.[A-Za-z]{2,}$/,
  discord: /^\d{17,20}$/, telegram: /^[A-Za-z][A-Za-z0-9_]{3,30}[Bb][Oo][Tt]$/, descriptor: /^(?=.*[A-Za-z])[^<>\\'"*]{5,22}$/,
};

/** Field checks: field key → (value, ctx) → error message or ''. Empty values are always valid (= not set). */
export const VALIDATORS = {
  publishableKeyTest: v => RX.pkTest.test(v) ? '' : /^pk_live_/.test(v) ? 'This is a live key — put it in the live field.' : 'A test publishable key starts with pk_test_.',
  publishableKeyLive: v => RX.pkLive.test(v) ? '' : /^pk_test_/.test(v) ? 'This is a test key — put it in the test field.' : 'A live publishable key starts with pk_live_.',
  accountId: v => RX.acct.test(v) ? '' : 'A connected account ID looks like acct_1A2b3C4d5E6f7G8h.',
  statementDescriptor: v => RX.descriptor.test(v) ? '' : '5–22 characters with at least one letter, without < > \\ \' " *.',
  statementDescriptorSuffix: v => /^(?=.*[A-Za-z0-9])[^<>\\'"*]{1,22}$/.test(v) ? '' : 'Up to 22 characters, without < > \\ \' " *.',
  'backend.url': v => RX.supabaseUrl.test(v.replace(/\/+$/, '')) ? '' : 'Your project URL looks like https://abcdefghijklmnop.supabase.co',
  'backend.anonKey': v => { if (/^sb_publishable_[A-Za-z0-9_-]{10,}$/.test(v)) return ''; const p = jwtPayload(v); return p && p.role === 'anon' ? '' : 'Paste the anon (public) key: a long token starting with eyJ, or sb_publishable_….'; },
  'backend.functionsUrl': v => RX.httpsUrl.test(v.replace(/\/+$/, '')) ? '' : 'An https:// URL, e.g. https://abcdefghijklmnop.supabase.co/functions/v1',
  'ga4.measurementId': v => RX.ga4.test(v) ? '' : 'A GA4 measurement ID looks like G-ABC123XYZ9 (not the UA- or numeric property ID).',
  'gtm.containerId': v => RX.gtm.test(v) ? '' : 'A container ID looks like GTM-ABC1234.',
  'metaPixel.pixelId': v => RX.metaPixel.test(v) ? '' : 'The Meta Pixel ID is a 10–20 digit number.',
  'tiktokPixel.pixelId': v => RX.tiktokPixel.test(v) ? '' : 'The TikTok Pixel ID is 15–25 capital letters and digits, e.g. C4ABCDEFGH1234567890.',
  'pinterestTag.tagId': v => RX.pinterestTag.test(v) ? '' : 'The Pinterest tag ID is a 10–16 digit number.',
  'clarity.projectId': v => RX.clarity.test(v) ? '' : 'The Clarity project ID is 6–14 lowercase letters and digits.',
  'turnstile.siteKey': v => RX.turnstile.test(v) ? '' : 'A Turnstile site key starts with 0x (e.g. 0x4AAAAAAAB…).',
  'recaptcha.siteKey': v => RX.recaptcha.test(v) ? '' : 'A reCAPTCHA site key is 40 characters starting with 6L.',
  'sentry.dsn': v => RX.sentry.test(v) ? '' : 'A DSN looks like https://<32 hex>@o123456.ingest.sentry.io/1234567',
  'email.fromEmail': v => RX.email.test(v) ? '' : 'Enter an email address.',
  'email.replyTo': v => RX.email.test(v) ? '' : 'Enter an email address.',
  'discord.guildId': v => RX.discord.test(v) ? '' : 'A server (guild) ID is a 17–20 digit number. Turn on Developer Mode in Discord, then right-click the server › Copy Server ID.',
  'telegram.botUsername': v => RX.telegram.test(v.replace(/^@/, '')) ? '' : 'A bot username ends in “bot”, e.g. MyStoreBot.',
};

/** Error for one field ('' = valid or empty). Secret-looking values are always an error. */
export function validateField(key, value) {
  const v = String(value == null ? '' : value).trim();
  if (!v) return '';
  const s = secretReason(v); if (s) return s;
  const f = VALIDATORS[key];
  return f ? f(v) : '';
}
const ok = (key, v) => !!v && !validateField(key, v);

// ---------- normalisation ----------
const str = (v, d = '') => v == null ? d : String(v);
const pick = (v, list, d) => list.includes(v) ? v : d;
const bool = (v, d = false) => v == null ? d : !!v;
const num = (v, d, lo = -Infinity, hi = Infinity) => { const n = typeof v === 'string' && v.trim() === '' ? NaN : +v; return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
/** Trimmed public value; '' when it looks like a secret (secrets are never stored). */
const pub = (v, max = 400) => { const s = str(v).trim().slice(0, max); return looksSecret(s) ? '' : s; };
const o = v => v && typeof v === 'object' ? v : {};

export function normalizeStripe(input) {
  const s = o(input), D = STRIPE_DEFAULTS, ps = o(s.payoutSchedule), b = o(s.billing), r = o(s.radar);
  const methods = Array.isArray(s.paymentMethods) ? [...new Set(s.paymentMethods.map(String).filter(m => PAYMENT_METHOD_IDS.includes(m)))] : D.paymentMethods.slice();
  const events = Array.isArray(s.webhookEvents) ? [...new Set(s.webhookEvents.map(String).filter(e => STRIPE_WEBHOOK_EVENT_IDS.includes(e)))] : D.webhookEvents.slice();
  return {
    enabled: bool(s.enabled), mode: pick(s.mode, STRIPE_MODES, 'test'), connectType: pick(s.connectType, CONNECT_TYPES.map(c => c[0]), 'standard'),
    accountId: pub(s.accountId, 64), publishableKeyTest: pub(s.publishableKeyTest, 200), publishableKeyLive: pub(s.publishableKeyLive, 200),
    onboardingStatus: pick(s.onboardingStatus, ONBOARDING_STATUSES, 'not_connected'), chargesEnabled: bool(s.chargesEnabled), payoutsEnabled: bool(s.payoutsEnabled),
    applicationFeePercent: Math.round(num(s.applicationFeePercent, 0, 0, 100) * 100) / 100, applicationFeeFixed: Math.round(num(s.applicationFeeFixed, 0, 0, 1e6) * 100) / 100,
    captureMethod: pick(s.captureMethod, ['automatic', 'manual'], 'automatic'), paymentMethods: methods,
    statementDescriptor: str(s.statementDescriptor).slice(0, 22), statementDescriptorSuffix: str(s.statementDescriptorSuffix).slice(0, 22),
    currency: /^[a-z]{3}$/.test(str(s.currency).trim().toLowerCase()) ? str(s.currency).trim().toLowerCase() : D.currency,
    automaticTax: bool(s.automaticTax), threeDSecure: pick(s.threeDSecure, ['automatic', 'any'], 'automatic'), savePaymentMethods: bool(s.savePaymentMethods),
    radar: { blockHighRisk: bool(r.blockHighRisk, true), review3dsFailed: bool(r.review3dsFailed, true) },
    payoutSchedule: { interval: pick(ps.interval, ['daily', 'weekly', 'monthly', 'manual'], 'daily'), weeklyAnchor: pick(ps.weeklyAnchor, WEEKDAYS, 'monday'),
      monthlyAnchor: Math.round(num(ps.monthlyAnchor, 1, 1, 31)), delayDays: Math.round(num(ps.delayDays, 0, 0, 365)) },
    billing: { subscriptions: bool(b.subscriptions), customerPortal: bool(b.customerPortal), invoices: bool(b.invoices), trialDays: Math.round(num(b.trialDays, 0, 0, 730)) },
    webhookEvents: events,
  };
}

export function normalizeIntegrations(input) {
  const s = o(input), D = INTEGRATION_DEFAULTS, be = o(s.backend), em = o(s.email), cs = o(s.consent);
  const one = (k, f) => ({ [f]: pub(o(s[k])[f]) });
  return {
    backend: { provider: pick(be.provider, ['none', 'supabase'], 'none'), url: pub(be.url).replace(/\/+$/, ''), anonKey: pub(be.anonKey, 2000), functionsUrl: pub(be.functionsUrl).replace(/\/+$/, '') },
    ga4: { measurementId: pub(o(s.ga4).measurementId).toUpperCase() }, gtm: { containerId: pub(o(s.gtm).containerId).toUpperCase() },
    metaPixel: one('metaPixel', 'pixelId'), tiktokPixel: { pixelId: pub(o(s.tiktokPixel).pixelId).toUpperCase() }, pinterestTag: one('pinterestTag', 'tagId'),
    clarity: { projectId: pub(o(s.clarity).projectId).toLowerCase() }, turnstile: one('turnstile', 'siteKey'), recaptcha: one('recaptcha', 'siteKey'), sentry: one('sentry', 'dsn'),
    email: { provider: pick(em.provider, EMAIL_PROVIDERS.map(p => p[0]), 'none'), fromEmail: pub(em.fromEmail), replyTo: pub(em.replyTo) },
    discord: one('discord', 'guildId'), telegram: { botUsername: pub(o(s.telegram).botUsername).replace(/^@/, '') },
    consent: { banner: bool(cs.banner, D.consent.banner), region: pick(cs.region, CONSENT_REGIONS.map(r => r[0]), D.consent.region) },
  };
}

/** Every field error in the payment + integration settings: [{ key, message }] (empty → safe to save). */
export function integrationErrors(commerce) {
  const st = commerce?.settings || {}, sp = st.payments?.stripe || {}, ig = st.integrations || {}, out = [];
  for (const k of ['publishableKeyTest', 'publishableKeyLive', 'accountId', 'statementDescriptor', 'statementDescriptorSuffix']) { const e = validateField(k, sp[k]); if (e) out.push({ key: 'stripe.' + k, message: e }); }
  for (const k of Object.keys(VALIDATORS).filter(k => k.includes('.'))) { const [a, b] = k.split('.'); const e = validateField(k, ig[a]?.[b]); if (e) out.push({ key: k, message: e }); }
  return out;
}

// ---------- derived values ----------
/** Edge Functions base URL: the explicit one, else `${url}/functions/v1` for Supabase. '' when no backend. */
export function functionsBase(commerce) {
  const b = commerce?.settings?.integrations?.backend || {};
  if (b.provider !== 'supabase') return '';
  if (ok('backend.functionsUrl', b.functionsUrl)) return b.functionsUrl.replace(/\/+$/, '');
  return ok('backend.url', b.url) ? b.url.replace(/\/+$/, '') + '/functions/v1' : '';
}
export const backendReady = commerce => { const b = commerce?.settings?.integrations?.backend || {}; return b.provider === 'supabase' && ok('backend.url', b.url) && ok('backend.anonKey', b.anonKey); };
export const webhookUrl = commerce => { const f = functionsBase(commerce); return f ? f + '/stripe-webhook' : ''; };
export const onboardUrl = commerce => { const f = functionsBase(commerce); return f ? f + '/stripe-connect-onboard' : ''; };

/** Amount the merchant keeps from an order of `amount` after the platform application fee (before Stripe's own fees). */
export function afterPlatformFee(stripe, amount = 100) {
  const fee = Math.min(amount, Math.round((amount * (+stripe?.applicationFeePercent || 0) / 100 + (+stripe?.applicationFeeFixed || 0)) * 100) / 100);
  return { fee, keep: Math.round((amount - fee) * 100) / 100 };
}

/** How the charge appears on a bank statement (prefix shortened so prefix + "* " + suffix fits in 22 characters). */
export function statementPreview(stripe, fallback = '') {
  const base = (stripe?.statementDescriptor || fallback || '').toUpperCase().slice(0, 22);
  const suf = (stripe?.statementDescriptorSuffix || '').toUpperCase();
  if (!suf) return base;
  const room = Math.max(2, 22 - 2 - suf.length);
  return (base.slice(0, Math.min(10, room)).trim() + '* ' + suf).slice(0, 22);
}

/** Server secrets the current configuration needs: [{ name, description }]. */
export function serverSecrets(commerce) {
  const ig = commerce?.settings?.integrations || INTEGRATION_DEFAULTS;
  const want = new Set(['stripe', 'supabase']);
  if (ig.email?.provider && ig.email.provider !== 'none') want.add(ig.email.provider);
  if (ig.turnstile?.siteKey) want.add('turnstile');
  if (ig.recaptcha?.siteKey) want.add('recaptcha');
  if (ig.discord?.guildId) want.add('discord');
  if (ig.telegram?.botUsername) want.add('telegram');
  return SERVER_SECRETS.filter(s => want.has(s[2])).map(([name, description, key]) => ({ name, description, key }));
}
const PLACEHOLDER = { STRIPE_SECRET_KEY: 'sk_live_…', STRIPE_WEBHOOK_SECRET: 'whsec_…', SUPABASE_SERVICE_ROLE_KEY: '<service-role-key>' };
/** `supabase secrets set NAME=… …` for the given secret names (placeholders only, never real values). */
export function secretsCommand(names) {
  return 'supabase secrets set ' + names.map(n => `${n}=${PLACEHOLDER[n] || '<' + n.toLowerCase().replace(/_/g, '-') + '>'}`).join(' ');
}

/**
 * Non-secret configuration for the storefront checkout (src/store/commerce.js). Only valid values are passed on:
 * { ready, mode, publishableKey (for the current mode), accountId, connectType, paymentMethods, captureMethod, currency,
 *   automaticTax, threeDSecure, savePaymentMethods, statementDescriptorSuffix,
 *   backend: { provider, url, anonKey, functionsUrl }, turnstileSiteKey }
 * ready = Stripe is enabled, a publishable key for the current mode is set and a backend is configured.
 */
export function publicConfig(commerce) {
  const st = commerce?.settings || {}, sp = normalizeStripe(st.payments?.stripe), ig = normalizeIntegrations(st.integrations);
  const live = sp.mode === 'live', key = live ? sp.publishableKeyLive : sp.publishableKeyTest, doc = { settings: { integrations: ig } };
  const backend = backendReady(doc) ? { provider: 'supabase', url: ig.backend.url, anonKey: ig.backend.anonKey, functionsUrl: functionsBase(doc) } : { provider: 'none', url: '', anonKey: '', functionsUrl: '' };
  const publishableKey = ok(live ? 'publishableKeyLive' : 'publishableKeyTest', key) ? key : '';
  return {
    ready: !!(sp.enabled && publishableKey && backend.functionsUrl), enabled: sp.enabled, mode: sp.mode, publishableKey,
    accountId: ok('accountId', sp.accountId) ? sp.accountId : '', connectType: sp.connectType,
    paymentMethods: sp.paymentMethods.slice(), captureMethod: sp.captureMethod, currency: sp.currency, automaticTax: sp.automaticTax,
    threeDSecure: sp.threeDSecure, savePaymentMethods: sp.savePaymentMethods,
    statementDescriptorSuffix: ok('statementDescriptorSuffix', sp.statementDescriptorSuffix) ? sp.statementDescriptorSuffix : '',
    backend, turnstileSiteKey: ok('turnstile.siteKey', ig.turnstile.siteKey) && st.checkout?.turnstile !== false ? ig.turnstile.siteKey : '',
  };
}

// ---------- storefront snippets ----------
const escHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const js = v => JSON.stringify(String(v)).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/[\u2028\u2029]/g, '');
const EU = ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO', 'GB', 'CH'];

/**
 * Third-party tags for a storefront page: { head, bodyEnd } HTML strings ('' when nothing is configured).
 * opts.trackers (default true): include analytics/advertising tags; false keeps only functional ones (Turnstile).
 * opts.consent: 'granted' | 'denied' forces the consent state (no banner); default: the store's consent settings.
 * GA4 and GTM load with Google Consent Mode v2 defaults (denied where a banner applies); Meta, TikTok, Pinterest and
 * Clarity are injected only after the visitor accepts. The choice is remembered in localStorage ("zt-consent").
 */
export function integrationSnippets(commerce, opts = {}) {
  const ig = normalizeIntegrations(commerce?.settings?.integrations), trackers = opts.trackers !== false;
  const id = (k, v) => ok(k, v) ? v : '';
  const ga = trackers ? id('ga4.measurementId', ig.ga4.measurementId) : '', gtm = trackers ? id('gtm.containerId', ig.gtm.containerId) : '';
  const meta = trackers ? id('metaPixel.pixelId', ig.metaPixel.pixelId) : '', tt = trackers ? id('tiktokPixel.pixelId', ig.tiktokPixel.pixelId) : '';
  const pin = trackers ? id('pinterestTag.tagId', ig.pinterestTag.tagId) : '', cl = trackers ? id('clarity.projectId', ig.clarity.projectId) : '';
  const dsn = trackers ? id('sentry.dsn', ig.sentry.dsn) : '';
  const ts = commerce?.settings?.checkout?.turnstile === false ? '' : id('turnstile.siteKey', ig.turnstile.siteKey);
  const head = [], body = [];
  const gated = [];
  if (meta) gated.push(`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init',${js(meta)});fbq('track','PageView');`);
  if (tt) gated.push(`!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"];ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.load=function(e){var n="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{};ttq._i[e]=[];ttq._u=n;ttq._t=ttq._t||{};ttq._t[e]=+new Date;var s=d.createElement("script");s.async=!0;s.src=n+"?sdkid="+e+"&lib="+t;var a=d.getElementsByTagName("script")[0];a.parentNode.insertBefore(s,a)};ttq.load(${js(tt)});ttq.page()}(window,document,'ttq');`);
  if (pin) gated.push(`!function(e){if(!window.pintrk){window.pintrk=function(){window.pintrk.queue.push(Array.prototype.slice.call(arguments))};var n=window.pintrk;n.queue=[],n.version="3.0";var t=document.createElement("script");t.async=!0,t.src=e;var r=document.getElementsByTagName("script")[0];r.parentNode.insertBefore(t,r)}}("https://s.pinimg.com/ct/core.js");pintrk('load',${js(pin)});pintrk('page');`);
  if (cl) gated.push(`(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y)})(window,document,"clarity","script",${js(cl)});`);
  const google = !!(ga || gtm), needsConsent = google || gated.length > 0;
  const forced = opts.consent === 'granted' || opts.consent === 'denied' ? opts.consent : '';
  const region = forced ? 'none' : ig.consent.banner ? ig.consent.region : 'none';
  if (needsConsent) {
    // consent manager: decides whether a banner applies, applies Consent Mode defaults, runs gated tags after "Accept"
    head.push(`<script>(function(w,d){var K="zt-consent",F=${js(forced)},R=${js(region)},EU=${JSON.stringify(EU)};
w.dataLayer=w.dataLayer||[];w.gtag=w.gtag||function(){w.dataLayer.push(arguments)};
var tz="";try{tz=Intl.DateTimeFormat().resolvedOptions().timeZone||""}catch(e){}
var inEU=/^(Europe\\/|Atlantic\\/(Reykjavik|Canary|Madeira|Azores|Faroe))/.test(tz);
var need=!F&&(R==="all"||(R==="eu"&&inEU));var saved="";try{saved=localStorage.getItem(K)||""}catch(e){}
var state=F||(need?(saved||"pending"):"granted");
var g=state==="granted"?"granted":"denied";
gtag("consent","default",{ad_storage:g,ad_user_data:g,ad_personalization:g,analytics_storage:g,functionality_storage:"granted",security_storage:"granted",wait_for_update:500});
var Z=w.ztConsent={state:state,need:need&&!saved,queue:[],run:function(f){if(Z.state==="granted")try{f()}catch(e){}else Z.queue.push(f)},
set:function(v){Z.state=v;Z.need=false;try{localStorage.setItem(K,v)}catch(e){}var x=v==="granted"?"granted":"denied";gtag("consent","update",{ad_storage:x,ad_user_data:x,ad_personalization:x,analytics_storage:x});
if(v==="granted"){var q=Z.queue;Z.queue=[];for(var i=0;i<q.length;i++)try{q[i]()}catch(e){}}var b=d.getElementById("zt-consent");if(b)b.hidden=true}};})(window,document);</script>`);
  }
  if (gtm) head.push(`<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f)})(window,document,'script','dataLayer',${js(gtm)});</script>`);
  if (ga) head.push(`<script async src="https://www.googletagmanager.com/gtag/js?id=${escHtml(ga)}"></script>\n<script>gtag("js",new Date());gtag("config",${js(ga)});</script>`);
  if (gated.length) head.push(`<script>ztConsent.run(function(){${gated.join('\n')}});</script>`);
  if (dsn) head.push(`<script src="https://js.sentry-cdn.com/${escHtml(/^https:\/\/([0-9a-f]{32})@/.exec(dsn)[1])}.min.js" crossorigin="anonymous"></script>`);
  if (ts) head.push(`<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" async defer></script>\n<meta name="zt-turnstile-sitekey" content="${escHtml(ts)}">`);
  if (gtm) body.push(`<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${escHtml(gtm)}" height="0" width="0" style="display:none;visibility:hidden" title="Google Tag Manager"></iframe></noscript>`);
  if (needsConsent && region !== 'none') {
    body.push(`<div id="zt-consent" role="dialog" aria-live="polite" aria-label="Cookie consent" hidden style="position:fixed;left:16px;right:16px;bottom:16px;z-index:2147483000;max-width:560px;margin:0 auto;padding:16px 18px;border-radius:14px;background:#111;color:#fff;font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;box-shadow:0 18px 50px rgba(0,0,0,.35)">
<p style="margin:0 0 12px">${escHtml(String(commerce?.settings?.privacy?.cookieText || '').trim().slice(0, 600) || 'We use cookies to measure visits and improve ads. Analytics and advertising tags load only if you accept.')}</p>
<div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" data-zt-consent="denied" style="padding:8px 14px;border-radius:999px;border:1px solid rgba(255,255,255,.35);background:transparent;color:#fff;cursor:pointer">Reject</button><button type="button" data-zt-consent="granted" style="padding:8px 14px;border-radius:999px;border:0;background:#fff;color:#111;font-weight:600;cursor:pointer">Accept</button></div></div>
<script>(function(){var b=document.getElementById("zt-consent"),Z=window.ztConsent;if(!b||!Z)return;b.addEventListener("click",function(e){var v=e.target&&e.target.getAttribute("data-zt-consent");if(v)Z.set(v)});if(Z.need)b.hidden=false;})();</script>`);
  }
  return { head: head.join('\n'), bodyEnd: body.join('\n') };
}

/** Script hosts the configured tags load from (for a Content-Security-Policy). */
export function scriptHosts(commerce) {
  const ig = normalizeIntegrations(commerce?.settings?.integrations), sp = commerce?.settings?.payments?.stripe || {}, h = new Set(["'self'"]);
  if (ig.ga4.measurementId || ig.gtm.containerId) h.add('https://www.googletagmanager.com');
  if (ig.metaPixel.pixelId) h.add('https://connect.facebook.net');
  if (ig.tiktokPixel.pixelId) h.add('https://analytics.tiktok.com');
  if (ig.pinterestTag.tagId) h.add('https://s.pinimg.com');
  if (ig.clarity.projectId) h.add('https://www.clarity.ms');
  if (ig.sentry.dsn) h.add('https://js.sentry-cdn.com');
  if (ig.turnstile.siteKey) h.add('https://challenges.cloudflare.com');
  if (ig.recaptcha.siteKey) h.add('https://www.google.com').add('https://www.gstatic.com');
  if (sp.enabled) h.add('https://js.stripe.com');
  return [...h];
}
