// Settings (Shopify-style): its own layout with a left settings sidebar (back to the dashboard, "Search settings" that
// filters sections and individual settings with jump-to, store card, grouped section list) and a centred main column of
// sections made of rounded row cards. Pages: src/store/admin/settings/*.jsx; styles: dist/css/settings.css ("cs").
// Edits collect in a draft of both documents; the floating "Unsaved changes" pill commits them (store values: name,
// contact, currency, checkout; everything else: commerce.settings). Field errors (public IDs, secret-looking values)
// block saving.
import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Search, X, Store as StoreIcon, Crown, Wallet, Users as UsersIcon, CreditCard, ShoppingCart, UserRound, Truck, Receipt, MapPin, Map as MapIcon,
  LayoutGrid, Megaphone, Globe, Activity, Bell, Database, Languages as LangIcon, Cookie, FileText, Lock, Code, CornerDownRight } from 'lucide-react';
import { useAdmin, Btn } from './ui.jsx';
import { normalizeStore } from '../model.js';
import { normalizeCommerce } from './model.js';
import { integrationErrors } from '../integrations.js';
import { General, Plan, Billing, Users } from './settings/General.jsx';
import { Payments } from './settings/Payments.jsx';
import { Checkout, CustomerAccounts } from './settings/Checkout.jsx';
import { Shipping, Taxes, Locations, Markets, Domains, Notifications, Policies } from './settings/Store.jsx';
import { Apps, SalesChannels, CustomerEvents } from './settings/Apps.jsx';
import { Metafields, Languages, Privacy, Security, Developer } from './settings/More.jsx';
import { STATUS } from './settings/Payments.jsx';

/** Sections: [key, label, icon, component, one-line description, searchable settings [[anchor id, label, keywords]]]. */
export const SETTINGS_GROUPS = [
  ['Store', [
    ['general', 'General', StoreIcon, General, 'Store details, business entity, defaults and order IDs.', [['profile', 'Store name and contact', 'email phone address hours'], ['business', 'Legal business name', 'entity country company llc'], ['currency', 'Store currency', 'money'], ['currency-display', 'Currency display', 'format symbol code'], ['backup-region', 'Backup region', 'country'], ['units', 'Unit system', 'metric imperial'], ['weight-unit', 'Default weight unit', 'kg lb'], ['timezone', 'Time zone', 'clock'], ['order-id', 'Order ID prefix and suffix', 'number'], ['auto-fulfill', 'Automatic fulfillment', 'order processing'], ['auto-archive', 'Archive orders automatically', ''], ['low-stock', 'Low stock threshold', 'inventory']]],
    ['plan', 'Plan', Crown, Plan, 'Your workspace plan and store limit.', [['plan-current', 'Plan details', 'upgrade subscription']]],
    ['billing', 'Billing', Wallet, Billing, 'Billing contact and who charges you for what.', [['billing-profile', 'Billing email and phone', 'invoice sender'], ['billing-bills', 'Bills and charges', 'fees']]],
    ['users', 'Users and permissions', UsersIcon, Users, 'Store owner and staff access.', [['owner', 'Store owner', 'account'], ['staff', 'Staff members', 'team roles permissions']]],
  ]],
  ['Selling', [
    ['payments', 'Payments', CreditCard, Payments, 'Stripe Connect, payment methods, payouts and manual methods.', [['stripe', 'Connect with Stripe', 'stripe connect account onboarding'], ['stripe-mode', 'Test mode / live mode', 'stripe'], ['stripe-keys', 'Publishable keys', 'pk_test pk_live api'], ['payment-methods', 'Payment methods', 'card apple pay google pay klarna paypal ideal sepa'], ['capture', 'Payment capture', 'authorize manual'], ['three-ds', '3D Secure', 'sca authentication'], ['descriptor', 'Statement descriptor', 'bank statement'], ['stripe-currency', 'Settlement currency', ''], ['stripe-tax', 'Stripe Tax', 'automatic tax vat'], ['platform-fee', 'Platform application fee', 'commission'], ['payouts', 'Payout schedule', 'bank transfer'], ['radar', 'Fraud protection (Radar)', 'risk'], ['stripe-billing', 'Subscriptions and invoices', 'billing portal trial recurring'], ['webhooks', 'Webhook endpoint', 'events'], ['server-secrets', 'Server secrets', 'secret key env'], ['alt-methods', 'WhatsApp, email and payment links', 'order method alternative'], ['manual-methods', 'Manual payment methods', 'bank transfer cash on delivery']]],
    ['checkout', 'Checkout', ShoppingCart, Checkout, 'Checkout form, marketing consent, tipping and bot protection.', [['contact-method', 'Customer contact method', 'email phone'], ['customer-info', 'Customer information fields', 'company address phone name'], ['marketing-options', 'Marketing opt-in', 'email sms consent'], ['tipping', 'Tipping', 'tip'], ['order-notes', 'Order notes', ''], ['terms', 'Agree to terms checkbox', 'policies'], ['abandoned', 'Abandoned checkout emails', 'cart recovery'], ['turnstile', 'Bot protection (Turnstile)', 'captcha spam'], ['order-collection', 'Order webhook URL', 'backend']]],
    ['accounts', 'Customer accounts', UserRound, CustomerAccounts, 'Sign-in, self-serve returns and store credit.', [['accounts-mode', 'Customer accounts', 'login sign in'], ['login-method', 'Sign-in method', 'password passwordless'], ['self-returns', 'Self-serve returns', ''], ['store-credit', 'Store credit', '']]],
    ['shipping', 'Shipping and delivery', Truck, Shipping, 'Zones, rates and delivery methods.', [['zones', 'Shipping zones and rates', 'delivery free shipping weight']]],
    ['taxes', 'Taxes and duties', Receipt, Taxes, 'Tax rates and how tax is shown.', [['tax-calc', 'Prices include tax', 'vat inclusive'], ['tax-rates', 'Tax rates', 'sales tax region state']]],
    ['locations', 'Locations', MapPin, Locations, 'Where you stock and ship from.', [['locations', 'Locations', 'warehouse address']]],
    ['markets', 'Markets', MapIcon, Markets, 'Countries you sell to and their currencies.', [['markets', 'Markets', 'international countries currency']]],
  ]],
  ['Growth', [
    ['apps', 'Apps and integrations', LayoutGrid, Apps, 'Backend, analytics, pixels, bot protection, email and community.', [['app-supabase', 'Supabase backend', 'database auth functions'], ['app-ga4', 'Google Analytics 4', 'ga4 analytics'], ['app-gtm', 'Google Tag Manager', 'gtm'], ['app-metaPixel', 'Meta Pixel', 'facebook instagram'], ['app-tiktokPixel', 'TikTok Pixel', ''], ['app-pinterestTag', 'Pinterest Tag', ''], ['app-clarity', 'Microsoft Clarity', 'heatmaps recordings'], ['app-sentry', 'Sentry', 'errors monitoring'], ['app-turnstile', 'Cloudflare Turnstile', 'captcha'], ['app-recaptcha', 'reCAPTCHA', 'captcha'], ['app-email', 'Email provider', 'resend sendgrid postmark'], ['app-discord', 'Discord', 'community'], ['app-telegram', 'Telegram', 'bot']]],
    ['channels', 'Sales channels', Megaphone, SalesChannels, 'Where customers find and buy your products.', [['channels', 'Sales channels', 'instagram facebook google tiktok whatsapp pinterest']]],
    ['domains', 'Domains', Globe, Domains, 'Your store’s web address.', [['domain', 'Primary domain', 'dns url']]],
    ['events', 'Customer events', Activity, CustomerEvents, 'Which storefront events reach your marketing tags.', [['events-forward', 'Share events with pixels', 'tracking conversions'], ['events-list', 'Standard events', 'purchase add to cart']]],
  ]],
  ['Content', [
    ['notifications', 'Notifications', Bell, Notifications, 'Customer emails and who sends them.', [['sender', 'Sender email', 'from'], ['customer-notifications', 'Email templates', 'order confirmation shipping refund']]],
    ['metafields', 'Metafields', Database, Metafields, 'Custom data for products, customers and orders.', [['metafields-product', 'Product metafields', 'custom fields']]],
    ['languages', 'Languages', LangIcon, Languages, 'Your store’s languages.', [['lang-default', 'Default language', 'translation locale']]],
  ]],
  ['Trust', [
    ['privacy', 'Customer privacy', Cookie, Privacy, 'Cookie banner and data-sharing opt-out.', [['cookie-banner', 'Cookie banner', 'consent gdpr'], ['data-sale', 'Do not sell my information', 'ccpa opt out']]],
    ['policies', 'Policies', FileText, Policies, 'Refund, privacy, terms and shipping policies.', [['policy-refund', 'Refund policy', 'returns'], ['policy-privacy', 'Privacy policy', ''], ['policy-terms', 'Terms of service', ''], ['policy-shipping', 'Shipping policy', '']]],
    ['security', 'Security', Lock, Security, 'Secret checks, server secrets and a Content Security Policy.', [['secret-scan', 'Secrets check', 'api key leak'], ['csp', 'Content Security Policy', 'header'], ['confirm-danger', 'Confirm destructive actions', '']]],
    ['developer', 'Developer', Code, Developer, 'JSON backup, public config and the danger zone.', [['backup', 'Export / import JSON backup', 'restore download'], ['public-config', 'Public checkout config', 'json'], ['danger', 'Danger zone', 'delete reset']]],
  ]],
];
const SECTIONS = SETTINGS_GROUPS.flatMap(([, list]) => list);
const byKey = Object.fromEntries(SECTIONS.map(x => [x[0], x]));

/** Search: sections whose label/description match and individual settings (with their section). */
export function searchSettings(q) {
  const s = q.trim().toLowerCase(); if (!s) return { sections: SECTIONS.map(x => x[0]), items: [] };
  const words = s.split(/\s+/), has = t => words.every(w => t.toLowerCase().includes(w));
  const items = [];
  for (const [key, label, , , , list] of SECTIONS) for (const [id, l, kw] of list) if (has(`${l} ${kw}`)) items.push({ tab: key, id, label: l, section: label });
  const sections = SECTIONS.filter(([key, label, , , desc]) => has(`${label} ${desc}`) || items.some(i => i.tab === key)).map(x => x[0]);
  return { sections, items: items.slice(0, 8) };
}

export default function Settings({ tab }) {
  const { store, commerce, commit, go, notify } = useAdmin();
  const [draft, setDraft] = useState(null);
  const [q, setQ] = useState('');
  const [jump, setJump] = useState(null);
  const key = byKey[tab] ? tab : 'general', sec = byKey[key];
  const s = draft ? draft.s : store, c = draft ? draft.c : commerce;
  const edit = (fn, mark) => setDraft(d => { const n = d ? structuredClone(d) : { s: structuredClone(store), c: structuredClone(commerce), marks: [] }; fn(n.s, n.c); if (mark && !n.marks.includes(mark)) n.marks.push(mark); return n; });
  const errors = useMemo(() => draft ? integrationErrors(draft.c) : [], [draft]);
  const save = () => {
    if (errors.length) return;
    const nc = structuredClone(draft.c); for (const m of draft.marks) nc.onboarding.steps[m] = true;
    commit(normalizeStore(draft.s), normalizeCommerce(nc), 'Settings saved'); setDraft(null); notify('Settings saved');
  };
  const open = (t, id) => { if (t !== key) go({ page: 'settings', tab: t }); setJump(id || null); };
  useEffect(() => { // jump to a setting after its section rendered: scroll it into view, focus its first control, flash it
    if (!jump) return undefined;
    const t = setTimeout(() => {
      const el = document.getElementById('cs-' + jump); setJump(null); if (!el) return;
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.classList.remove('csFlash'); void el.offsetWidth; el.classList.add('csFlash');
      el.querySelector('input:not([type=hidden]),select,textarea,button')?.focus({ preventScroll: true });
    }, 60);
    return () => clearTimeout(t);
  }, [jump, key]);
  const found = useMemo(() => searchSettings(q), [q]);
  const P = { s, c, edit, go, open, dirty: !!draft };
  const Page = sec[3];
  const initial = (s.name || 'S').trim().charAt(0).toUpperCase();
  const handle = c.settings.domains.primary || (s.name || 'store').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.zertake.store';
  const sp = c.settings.payments.stripe;
  return <div className="csShell">
    <aside className="csSide" aria-label="Settings">
      <button type="button" className="csBack" onClick={() => go('home')}><ArrowLeft size={16} aria-hidden="true" />Back to dashboard</button>
      <div className="csStore"><span className="csAvatar" aria-hidden="true">{initial}</span><span className="csStoreText"><strong>{s.name}</strong><small>{handle}</small></span></div>
      <div className="csSearch" role="search">
        <Search size={15} aria-hidden="true" />
        <input type="search" aria-label="Search settings" placeholder="Search settings" value={q} onChange={e => setQ(e.target.value)}
          onKeyDown={e => { if (e.key === 'Escape' && q) { e.stopPropagation(); setQ(''); } else if (e.key === 'Enter') { const f = found.items[0]; if (f) open(f.tab, f.id); else if (found.sections[0]) open(found.sections[0]); } }} />
        {q && <button type="button" className="csIconBtn" aria-label="Clear search" onClick={() => setQ('')}><X size={14} /></button>}
      </div>
      {q && <div className="csResults" aria-label="Matching settings" role="group">
        {found.items.length ? <ul>{found.items.map(r => <li key={r.tab + r.id}><button type="button" onClick={() => open(r.tab, r.id)}><CornerDownRight size={13} aria-hidden="true" /><span><strong>{r.label}</strong><small>{r.section}</small></span></button></li>)}</ul>
          : !found.sections.length && <p className="csNone">No settings match “{q.trim()}”.</p>}
      </div>}
      <nav className="csNav" aria-label="Settings sections">
        {SETTINGS_GROUPS.map(([g, list]) => { const shown = list.filter(x => found.sections.includes(x[0])); return shown.length > 0 && <div key={g} className="csGroup">
          <span className="csGroupLabel" aria-hidden="true">{g}</span>
          <ul>{shown.map(([k, l, Icon]) => <li key={k}><button type="button" className={key === k ? 'on' : ''} aria-current={key === k ? 'page' : undefined} onClick={() => open(k)}>
            <Icon size={16} aria-hidden="true" /><span>{l}</span>{k === 'payments' && sp.onboardingStatus !== 'not_connected' && <i className={'csDot ' + STATUS[sp.onboardingStatus][1]} aria-hidden="true" />}</button></li>)}</ul>
        </div>; })}
      </nav>
    </aside>
    <div className="csMain">
      {draft && <div className="csSaveDock"><div className="csSavePill" role="region" aria-label="Unsaved changes">
        <span className="csSaveText">{errors.length ? <><b className="csSaveErr">{errors.length}</b> {errors.length === 1 ? 'field needs' : 'fields need'} attention</> : 'Unsaved changes'}</span>
        <Btn onClick={() => setDraft(null)}>Discard</Btn><Btn kind="primary" disabled={errors.length > 0} title={errors.map(e => e.message).join('\n') || undefined} onClick={save}>Save</Btn>
      </div></div>}
      <div className="csColumn">
        <header className="csHead"><span className="csHeadIcon" aria-hidden="true">{React.createElement(sec[2], { size: 18 })}</span><div><h1>{sec[1]}</h1><p>{sec[4]}</p></div></header>
        <Page {...P} />
      </div>
    </div>
  </div>;
}
