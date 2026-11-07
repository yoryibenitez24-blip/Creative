// Unit tests for the settings data (src/store/admin/model.js settings part) and src/store/integrations.js
// (Stripe Connect settings, integrations, validation, publicConfig, storefront snippets).
// Run: node --test tests/settings.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCommerce, createCommerce } from '../src/store/admin/model.js';
import { createOrder } from '../src/store/admin/orders.js';
import { createStore } from '../src/store/templates.js';
import { renderPage } from '../src/store/render.js';
import {
  normalizeStripe, normalizeIntegrations, validateField, secretReason, looksSecret, integrationErrors, publicConfig, integrationSnippets,
  functionsBase, webhookUrl, onboardUrl, afterPlatformFee, statementPreview, serverSecrets, secretsCommand, scriptHosts,
  STRIPE_DEFAULTS, DEFAULT_PAYMENT_METHODS, STRIPE_WEBHOOK_EVENT_IDS, PAYMENT_METHOD_IDS,
} from '../src/store/integrations.js';

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = role => b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ iss: 'supabase', ref: 'abcdefghijklmnopqrst', role, iat: 1700000000, exp: 2000000000 }) + '.' + 'S'.repeat(43);
const ANON = jwt('anon'), SERVICE = jwt('service_role');
const URL_ = 'https://abcdefghijklmnopqrst.supabase.co';
const PK_TEST = 'pk_test_51AbCdEfGhIjKlMnOp', PK_LIVE = 'pk_live_51AbCdEfGhIjKlMnOp';
const withSettings = (settings, base = createCommerce(createStore('everyday'))) => normalizeCommerce({ ...base, settings: { ...base.settings, ...settings } });

// ---------- normalisation & migration ----------
test('normalizeStripe: defaults match the data contract', () => {
  const s = normalizeStripe(undefined);
  assert.deepEqual(s, STRIPE_DEFAULTS);
  assert.deepEqual(s.paymentMethods, ['card', 'apple_pay', 'google_pay', 'link']);
  assert.deepEqual(s.webhookEvents, STRIPE_WEBHOOK_EVENT_IDS);
  assert.equal(PAYMENT_METHOD_IDS.length, 23);
  assert.notEqual(s.paymentMethods, DEFAULT_PAYMENT_METHODS, 'defaults are copied, not shared');
});

test('normalizeStripe repairs bad values and drops secrets', () => {
  const s = normalizeStripe({ enabled: 1, mode: 'prod', connectType: 'weird', accountId: ' acct_1AbCdEfGhIjKlMn ', publishableKeyTest: 'sk_test_123456789012345', publishableKeyLive: 'whsec_abc',
    onboardingStatus: 'done', applicationFeePercent: 250, applicationFeeFixed: -3, captureMethod: 'later', paymentMethods: ['card', 'klarna', 'bitcoin', 'card'],
    statementDescriptor: 'X'.repeat(40), currency: 'EUR', threeDSecure: 'never', radar: { blockHighRisk: false }, payoutSchedule: { interval: 'hourly', weeklyAnchor: 'funday', monthlyAnchor: 99, delayDays: -1 },
    billing: { subscriptions: true, trialDays: 9999 }, webhookEvents: ['payout.paid', 'nope'] });
  assert.equal(s.enabled, true); assert.equal(s.mode, 'test'); assert.equal(s.connectType, 'standard');
  assert.equal(s.accountId, 'acct_1AbCdEfGhIjKlMn');
  assert.equal(s.publishableKeyTest, '', 'secret key is never stored'); assert.equal(s.publishableKeyLive, '');
  assert.equal(s.onboardingStatus, 'not_connected'); assert.equal(s.applicationFeePercent, 100); assert.equal(s.applicationFeeFixed, 0);
  assert.equal(s.captureMethod, 'automatic'); assert.deepEqual(s.paymentMethods, ['card', 'klarna']);
  assert.equal(s.statementDescriptor.length, 22); assert.equal(s.currency, 'eur'); assert.equal(s.threeDSecure, 'automatic');
  assert.deepEqual(s.radar, { blockHighRisk: false, review3dsFailed: true });
  assert.deepEqual(s.payoutSchedule, { interval: 'daily', weeklyAnchor: 'monday', monthlyAnchor: 31, delayDays: 0 });
  assert.equal(s.billing.subscriptions, true); assert.equal(s.billing.trialDays, 730);
  assert.deepEqual(s.webhookEvents, ['payout.paid']);
});

test('normalizeIntegrations: defaults, trimming, case and secret refusal', () => {
  const d = normalizeIntegrations(null);
  assert.deepEqual(d.backend, { provider: 'none', url: '', anonKey: '', functionsUrl: '' });
  assert.deepEqual(d.consent, { banner: true, region: 'eu' });
  const i = normalizeIntegrations({ backend: { provider: 'supabase', url: URL_ + '/', anonKey: SERVICE }, ga4: { measurementId: ' g-abc123xyz9 ' }, metaPixel: { pixelId: 'sk_live_abcdefghijklmnop' },
    telegram: { botUsername: '@MyStoreBot' }, email: { provider: 'mailchimp', fromEmail: 're_abcdefghijklmnopqrstu' }, consent: { banner: false, region: 'mars' } });
  assert.equal(i.backend.url, URL_, 'trailing slash removed');
  assert.equal(i.backend.anonKey, '', 'service-role key is never stored');
  assert.equal(i.ga4.measurementId, 'G-ABC123XYZ9');
  assert.equal(i.metaPixel.pixelId, '');
  assert.equal(i.telegram.botUsername, 'MyStoreBot');
  assert.equal(i.email.provider, 'none'); assert.equal(i.email.fromEmail, '', 'Resend API key refused');
  assert.deepEqual(i.consent, { banner: false, region: 'eu' });
});

test('normalizeCommerce migrates an old document without losing data and is idempotent', () => {
  const old = { kind: 'commerce', version: 1, storeId: 's1', settings: {
    general: { legalName: 'Old Co', orderPrefix: 'EG-', nextOrderNumber: 2000 },
    payments: { manualMethods: [{ id: 'pm1', name: 'Bank transfer', instructions: 'IBAN …', enabled: true }], providerNotes: 'Stripe dashboard: ops@' },
    backend: { orderWebhookUrl: 'https://example.com/orders' }, taxes: { rates: [{ country: 'US', region: 'TX', rate: 8.25 }] } } };
  const c = normalizeCommerce(old);
  assert.equal(c.settings.general.legalName, 'Old Co'); assert.equal(c.settings.general.orderPrefix, 'EG-'); assert.equal(c.settings.general.nextOrderNumber, 2000);
  assert.equal(c.settings.payments.manualMethods[0].instructions, 'IBAN …'); assert.equal(c.settings.payments.providerNotes, 'Stripe dashboard: ops@');
  assert.equal(c.settings.backend.orderWebhookUrl, 'https://example.com/orders'); assert.equal(c.settings.taxes.rates[0].rate, 8.25);
  assert.deepEqual(c.settings.payments.stripe, STRIPE_DEFAULTS);
  assert.deepEqual(c.settings.integrations, normalizeIntegrations({}));
  for (const k of ['checkout', 'customerAccounts', 'users', 'markets', 'salesChannels', 'customerEvents', 'metafields', 'languages', 'privacy', 'security']) assert.ok(k in c.settings, k);
  assert.equal(c.settings.general.orderSuffix, ''); assert.equal(c.settings.general.country, 'US'); assert.equal(c.settings.checkout.turnstile, true);
  assert.equal(c.settings.checkout.company, 'hidden'); assert.equal(c.settings.salesChannels.online.enabled, true);
  assert.deepEqual(normalizeCommerce(c), c, 'normalising twice changes nothing');
});

test('settings sections normalise lists and choices', () => {
  const c = withSettings({
    general: { businessEntity: 'llc', country: 'de', backupRegion: 'x1', currencyDisplay: 'code', autoFulfill: 'all', autoArchive: 1, orderSuffix: '-EUROPE-LONG' },
    checkout: { company: 'required', address2: 'nope', tipping: { enabled: true, presets: [5, 250, 'x', 30] }, abandoned: { enabled: true, delayHours: 3 } },
    markets: [{ name: 'EU', countries: ['de', 'FR', 'zz1'], currency: 'EUR' }, { name: 'UK', countries: ['GB'], primary: true, enabled: false }, { name: 'US', primary: true }],
    users: { staff: [{ name: 'Ana', email: 'ANA@X.DEV', role: 'boss', permissions: ['orders', 'root'] }, { name: '', email: '' }] },
    metafields: [{ owner: 'product', name: 'Care', key: 'Care Guide!' }, {}], languages: { primary: 'de', published: ['fr', 'xx'] },
  });
  const g = c.settings.general;
  assert.deepEqual([g.businessEntity, g.country, g.backupRegion, g.currencyDisplay, g.autoFulfill, g.autoArchive, g.orderSuffix], ['llc', 'DE', 'DE', 'code', 'all', true, '-EUROP']);
  assert.equal(c.settings.checkout.company, 'required'); assert.equal(c.settings.checkout.address2, 'optional');
  assert.deepEqual(c.settings.checkout.tipping.presets, [5, 100, 10]); assert.equal(c.settings.checkout.abandoned.delayHours, 10);
  assert.deepEqual(c.settings.markets.map(m => [m.name, m.countries.join(), m.primary, m.enabled]), [['EU', 'DE,FR', false, true], ['UK', 'GB', true, true], ['US', '', false, true]]);
  assert.deepEqual(c.settings.users.staff, [{ id: c.settings.users.staff[0].id, name: 'Ana', email: 'ana@x.dev', role: 'staff', permissions: ['orders'] }]);
  assert.deepEqual(c.settings.metafields.map(m => m.key), ['care_guide_']);
  assert.deepEqual(c.settings.languages, { primary: 'de', published: ['de', 'fr'], autoRedirect: false });
});

test('createCommerce seeds the Stripe currency from the store; order suffix is used for new orders', () => {
  const store = createStore('everyday');
  const c = createCommerce({ ...store, currency: { code: 'EUR', locale: 'de-DE' } });
  assert.equal(c.settings.payments.stripe.currency, 'eur');
  const c2 = withSettings({ general: { ...c.settings.general, orderPrefix: 'EG-', orderSuffix: '-EU' } }, c);
  const p = store.products[0];
  const r = createOrder(store, c2, { lines: [{ productId: p.id, variantId: p.variants[0].id, title: p.title, price: p.price, quantity: 1 }] });
  assert.equal(r.order.name, 'EG-1001-EU');
});

// ---------- validation ----------
test('validateField accepts public IDs and refuses malformed or secret values', () => {
  const good = [['publishableKeyTest', PK_TEST], ['publishableKeyLive', PK_LIVE], ['accountId', 'acct_1AbCdEfGhIjKlMn'], ['ga4.measurementId', 'G-ABC123XYZ9'], ['gtm.containerId', 'GTM-ABC1234'],
    ['metaPixel.pixelId', '123456789012345'], ['tiktokPixel.pixelId', 'C4ABCDEFGH1234567890'], ['pinterestTag.tagId', '2612345678901'], ['clarity.projectId', 'abcd1234ef'],
    ['turnstile.siteKey', '0x4AAAAAAABkMYinukE8nzY'], ['recaptcha.siteKey', '6L' + 'a'.repeat(38)], ['sentry.dsn', 'https://0123456789abcdef0123456789abcdef@o123456.ingest.sentry.io/1234567'],
    ['backend.url', URL_], ['backend.anonKey', ANON], ['backend.anonKey', 'sb_publishable_abcdefghijklmno'], ['backend.functionsUrl', URL_ + '/functions/v1'],
    ['discord.guildId', '123456789012345678'], ['telegram.botUsername', 'MyStoreBot'], ['email.fromEmail', 'orders@shop.dev'], ['statementDescriptor', 'EVERYDAY GOODS'], ['statementDescriptor', ''],
  ];
  for (const [k, v] of good) assert.equal(validateField(k, v), '', `${k} = ${v}`);
  const bad = [['publishableKeyTest', PK_LIVE, /live key/], ['publishableKeyLive', 'pk_live_x', /pk_live_/], ['publishableKeyTest', 'sk_test_51AbCdEfGhIjKlMnOp', /STRIPE_SECRET_KEY/], ['accountId', 'acct_1', /acct_/],
    ['ga4.measurementId', 'UA-12345-1', /G-/], ['gtm.containerId', 'GTM-<script>', /GTM-/], ['metaPixel.pixelId', '12ab', /digit/], ['turnstile.siteKey', 'abc', /0x/],
    ['sentry.dsn', 'http://0123456789abcdef0123456789abcdef@o1.ingest.sentry.io/1', /DSN/], ['backend.url', 'https://evil.example.com', /supabase\.co/],
    ['backend.anonKey', SERVICE, /service-role/], ['backend.anonKey', 'not-a-key', /anon/], ['backend.anonKey', 'sb_secret_abcdefghijk', /SUPABASE_SERVICE_ROLE_KEY/],
    ['statementDescriptor', '1234', /5–22/], ['statementDescriptor', 'BAD*NAME', /5–22/], ['telegram.botUsername', 'store', /bot/], ['metaPixel.pixelId', 'whsec_abcdef', /STRIPE_WEBHOOK_SECRET/],
  ];
  for (const [k, v, re] of bad) assert.match(validateField(k, v), re, `${k} = ${v}`);
  assert.ok(looksSecret('rk_live_abcdefghijklmnop')); assert.ok(looksSecret('SG.' + 'a'.repeat(20) + '.' + 'b'.repeat(20))); assert.ok(looksSecret('123456789:' + 'A'.repeat(35)));
  assert.equal(secretReason(ANON), ''); assert.equal(secretReason(PK_LIVE), '');
});

test('integrationErrors lists every invalid field', () => {
  const c = withSettings({ payments: { stripe: { publishableKeyTest: PK_LIVE, statementDescriptor: 'ok descriptor' } }, integrations: { ga4: { measurementId: 'UA-1' }, backend: { url: 'https://x.com' } } });
  assert.deepEqual(integrationErrors(c).map(e => e.key).sort(), ['backend.url', 'ga4.measurementId', 'stripe.publishableKeyTest']);
  assert.deepEqual(integrationErrors(createCommerce(createStore('everyday'))), []);
});

// ---------- derived values ----------
test('backend URLs, fee maths, statement preview and secrets command', () => {
  const none = createCommerce(createStore('everyday'));
  assert.equal(functionsBase(none), ''); assert.equal(webhookUrl(none), ''); assert.equal(onboardUrl(none), '');
  const sb = withSettings({ integrations: { backend: { provider: 'supabase', url: URL_, anonKey: ANON } } });
  assert.equal(functionsBase(sb), URL_ + '/functions/v1');
  assert.equal(webhookUrl(sb), URL_ + '/functions/v1/stripe-webhook'); assert.equal(onboardUrl(sb), URL_ + '/functions/v1/stripe-connect-onboard');
  const own = withSettings({ integrations: { backend: { provider: 'supabase', url: URL_, anonKey: ANON, functionsUrl: 'https://api.shop.dev/fn/' } } });
  assert.equal(webhookUrl(own), 'https://api.shop.dev/fn/stripe-webhook');
  assert.deepEqual(afterPlatformFee({ applicationFeePercent: 2.5, applicationFeeFixed: 0.3 }, 100), { fee: 2.8, keep: 97.2 });
  assert.deepEqual(afterPlatformFee({ applicationFeePercent: 100, applicationFeeFixed: 5 }, 100), { fee: 100, keep: 0 });
  assert.equal(statementPreview({ statementDescriptor: 'Everyday Goods Store', statementDescriptorSuffix: 'order 1001' }), 'EVERYDAY G* ORDER 1001');
  assert.ok(statementPreview({ statementDescriptor: 'Everyday Goods', statementDescriptorSuffix: 'X'.repeat(22) }).length <= 22);
  assert.equal(statementPreview({}, 'Fallback'), 'FALLBACK');
  assert.deepEqual(serverSecrets(none).map(s => s.name), ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'SUPABASE_SERVICE_ROLE_KEY']);
  const mail = withSettings({ integrations: { email: { provider: 'resend' }, turnstile: { siteKey: '0x4AAAAAAABkMYinukE8nzY' } } });
  assert.deepEqual(serverSecrets(mail).map(s => s.name).slice(3), ['RESEND_API_KEY', 'TURNSTILE_SECRET_KEY']);
  assert.equal(secretsCommand(['STRIPE_SECRET_KEY', 'RESEND_API_KEY']), 'supabase secrets set STRIPE_SECRET_KEY=sk_live_… RESEND_API_KEY=<resend-api-key>');
});

// ---------- publicConfig ----------
test('publicConfig passes only valid public values for the current mode', () => {
  const base = withSettings({ payments: { stripe: { enabled: true, mode: 'test', publishableKeyTest: PK_TEST, publishableKeyLive: PK_LIVE, accountId: 'acct_1AbCdEfGhIjKlMn', paymentMethods: ['card', 'klarna'], captureMethod: 'manual', currency: 'eur' } },
    integrations: { backend: { provider: 'supabase', url: URL_, anonKey: ANON }, turnstile: { siteKey: '0x4AAAAAAABkMYinukE8nzY' } } });
  const p = publicConfig(base);
  assert.equal(p.ready, true); assert.equal(p.mode, 'test'); assert.equal(p.publishableKey, PK_TEST); assert.equal(p.accountId, 'acct_1AbCdEfGhIjKlMn');
  assert.deepEqual(p.paymentMethods, ['card', 'klarna']); assert.equal(p.captureMethod, 'manual'); assert.equal(p.currency, 'eur');
  assert.deepEqual(p.backend, { provider: 'supabase', url: URL_, anonKey: ANON, functionsUrl: URL_ + '/functions/v1' });
  assert.equal(p.turnstileSiteKey, '0x4AAAAAAABkMYinukE8nzY');
  const live = publicConfig(withSettings({ payments: { stripe: { ...base.settings.payments.stripe, mode: 'live' } } }, base));
  assert.equal(live.publishableKey, PK_LIVE);
  const off = publicConfig(withSettings({ checkout: { turnstile: false }, payments: { stripe: { ...base.settings.payments.stripe, publishableKeyTest: 'pk_test_short' } } }, base));
  assert.equal(off.publishableKey, '', 'malformed key is not passed on'); assert.equal(off.ready, false); assert.equal(off.turnstileSiteKey, '', 'Turnstile off at checkout');
  const empty = publicConfig({});
  assert.equal(empty.ready, false); assert.equal(empty.backend.provider, 'none'); assert.deepEqual(empty.paymentMethods, DEFAULT_PAYMENT_METHODS);
  assert.doesNotMatch(JSON.stringify(p), /sk_|whsec_|service_role/);
});

// ---------- storefront snippets ----------
const tagged = (integ, extra = {}) => withSettings({ integrations: { ...normalizeIntegrations({}), ...integ }, ...extra });

test('integrationSnippets: nothing configured → empty strings', () => {
  assert.deepEqual(integrationSnippets(createCommerce(createStore('everyday'))), { head: '', bodyEnd: '' });
  assert.deepEqual(integrationSnippets(null), { head: '', bodyEnd: '' });
});

test('integrationSnippets: GA4 + GTM with Consent Mode v2 defaults, pixels gated behind consent, banner', () => {
  const c = tagged({ ga4: { measurementId: 'G-ABC123XYZ9' }, gtm: { containerId: 'GTM-ABC1234' }, metaPixel: { pixelId: '123456789012345' }, tiktokPixel: { pixelId: 'C4ABCDEFGH1234567890' },
    pinterestTag: { tagId: '2612345678901' }, clarity: { projectId: 'abcd1234ef' }, sentry: { dsn: 'https://0123456789abcdef0123456789abcdef@o123456.ingest.sentry.io/1234567' } });
  const { head, bodyEnd } = integrationSnippets(c);
  assert.match(head, /gtag\("consent","default",\{ad_storage:g,ad_user_data:g,ad_personalization:g,analytics_storage:g/);
  assert.ok(head.indexOf('gtag("consent","default"') < head.indexOf('googletagmanager.com/gtag/js'), 'consent defaults come before the GA4 tag');
  assert.match(head, /googletagmanager\.com\/gtag\/js\?id=G-ABC123XYZ9/); assert.match(head, /gtm\.js\?id='\+i\+dl.*"GTM-ABC1234"/s);
  assert.match(head, /ztConsent\.run\(function\(\)\{[^]*fbq\('init',"123456789012345"\)[^]*ttq\.load\("C4ABCDEFGH1234567890"\)[^]*pintrk\('load',"2612345678901"\)[^]*clarity\.ms\/tag/);
  assert.match(head, /js\.sentry-cdn\.com\/0123456789abcdef0123456789abcdef\.min\.js/);
  assert.match(bodyEnd, /id="zt-consent" role="dialog"/); assert.match(bodyEnd, /data-zt-consent="granted"/); assert.match(bodyEnd, /googletagmanager\.com\/ns\.html\?id=GTM-ABC1234/);
  assert.match(head, /R="eu"/);
  for (const html of [head, bodyEnd]) for (const m of html.matchAll(/<script>([^]*?)<\/script>/g)) assert.doesNotThrow(() => new Function(m[1]), 'inline script parses');
});

test('integrationSnippets: consent options, trackers off, Turnstile, escaping', () => {
  const c = tagged({ ga4: { measurementId: 'G-ABC123XYZ9' }, metaPixel: { pixelId: '123456789012345' }, turnstile: { siteKey: '0x4AAAAAAABkMYinukE8nzY' } });
  const granted = integrationSnippets(c, { consent: 'granted' });
  assert.match(granted.head, /F="granted"/); assert.doesNotMatch(granted.bodyEnd, /zt-consent/, 'no banner when consent is given');
  const nobanner = integrationSnippets(tagged({ ga4: { measurementId: 'G-ABC123XYZ9' }, consent: { banner: false, region: 'all' } }));
  assert.match(nobanner.head, /R="none"/); assert.equal(nobanner.bodyEnd, '');
  const fn = integrationSnippets(c, { trackers: false });
  assert.doesNotMatch(fn.head, /gtag|fbq/); assert.match(fn.head, /challenges\.cloudflare\.com\/turnstile\/v0\/api\.js/); assert.match(fn.head, /content="0x4AAAAAAABkMYinukE8nzY"/);
  const off = integrationSnippets(tagged({ turnstile: { siteKey: '0x4AAAAAAABkMYinukE8nzY' } }, { checkout: { turnstile: false } }));
  assert.equal(off.head, '');
  // malformed / hostile values never reach the page
  const evil = { settings: { integrations: { ga4: { measurementId: 'G-1"></script><script>alert(1)</script>' }, metaPixel: { pixelId: '1</script>' } }, privacy: { cookieText: '<img src=x onerror=alert(1)>' } } };
  const e = integrationSnippets(evil);
  assert.doesNotMatch(e.head + e.bodyEnd, /alert\(1\)<\/script>|<img/);
  const banner = integrationSnippets({ settings: { integrations: { ga4: { measurementId: 'G-ABC123XYZ9' }, consent: { region: 'all' } }, privacy: { cookieText: '<b>We & cookies</b>' } } });
  assert.match(banner.bodyEnd, /&lt;b&gt;We &amp; cookies&lt;\/b&gt;/);
});

test('scriptHosts lists the hosts of configured tags', () => {
  const c = tagged({ ga4: { measurementId: 'G-ABC123XYZ9' }, clarity: { projectId: 'abcd1234ef' } }, { payments: { stripe: { enabled: true } } });
  assert.deepEqual(scriptHosts(c), ["'self'", 'https://www.googletagmanager.com', 'https://www.clarity.ms', 'https://js.stripe.com']);
});

test('render hook: exported pages carry the tags; previews only functional ones; the editor none', () => {
  const store = createStore('everyday');
  const c = tagged({ ga4: { measurementId: 'G-ABC123XYZ9' }, turnstile: { siteKey: '0x4AAAAAAABkMYinukE8nzY' } });
  const exp = renderPage(store, { page: 'home' }, { mode: 'export', imageUrl: r => r, commerce: c });
  assert.match(exp, /gtag\/js\?id=G-ABC123XYZ9[^]*<\/head>/); assert.match(exp, /id="zt-consent"[^]*<\/body>/);
  const pre = renderPage(store, { page: 'home' }, { mode: 'preview', imageUrl: r => r, commerce: c, script: false });
  assert.doesNotMatch(pre, /gtag\/js/); assert.match(pre, /turnstile\/v0\/api\.js/);
  const ed = renderPage(store, { page: 'home' }, { mode: 'preview', imageUrl: r => r, commerce: c, script: false, editor: true });
  assert.doesNotMatch(ed, /turnstile|gtag/);
  const plain = renderPage(store, { page: 'home' }, { mode: 'export', imageUrl: r => r });
  assert.doesNotMatch(plain, /zt-consent|gtag/);
});
