// Settings › Apps and integrations, Sales channels, Customer events.
import React, { useState } from 'react';
import { Plug } from 'lucide-react';
import { Btn, Select } from '../ui.jsx';
import { SALES_CHANNELS, EVENT_TYPES } from '../model.js';
import { EMAIL_PROVIDERS, validateField, backendReady, functionsBase, serverSecrets } from '../../integrations.js';
import { Section, Toggle, Input, Pill, Note, CopyLine } from './kit.jsx';
import { ServerSecrets } from './Payments.jsx';

/**
 * Integration cards: key, name, monogram colour, what it powers, where to find the values, fields [[path, label, placeholder, hint?]].
 * path is "<integration>.<field>" inside commerce.settings.integrations (also the validator key).
 */
export const APPS = [
  { key: 'supabase', name: 'Supabase', mono: 'S', color: '#3ecf8e', powers: 'Orders database, customer accounts (Auth) and the Edge Functions that run Stripe Connect onboarding, checkout and webhooks.',
    where: 'Supabase dashboard › Project Settings › API: copy the Project URL and the “anon public” key. Never use the service_role key here.',
    fields: [['backend.url', 'Project URL', 'https://abcdefghijklmnop.supabase.co'], ['backend.anonKey', 'Anon public key', 'eyJhbGciOi…'], ['backend.functionsUrl', 'Functions URL (optional)', 'https://abcdefghijklmnop.supabase.co/functions/v1', 'Leave empty to use <project URL>/functions/v1.']] },
  { key: 'ga4', name: 'Google Analytics 4', mono: 'GA', color: '#f9ab00', powers: 'Visits, traffic sources and e-commerce reports. Loads with Consent Mode v2.',
    where: 'Google Analytics › Admin › Data streams › your web stream: “Measurement ID” (starts with G-).', fields: [['ga4.measurementId', 'Measurement ID', 'G-ABC123XYZ9']] },
  { key: 'gtm', name: 'Google Tag Manager', mono: 'GT', color: '#4285f4', powers: 'Manage tags (Google Ads, affiliate pixels…) without editing the store.',
    where: 'tagmanager.google.com › your container: the ID next to the container name (GTM-…).', fields: [['gtm.containerId', 'Container ID', 'GTM-ABC1234']] },
  { key: 'metaPixel', name: 'Meta Pixel', mono: 'M', color: '#0866ff', powers: 'Facebook and Instagram ad conversions and audiences. Loads after consent.',
    where: 'Meta Events Manager › Data sources › your pixel: the numeric “Dataset ID / Pixel ID”.', fields: [['metaPixel.pixelId', 'Pixel ID', '123456789012345']] },
  { key: 'tiktokPixel', name: 'TikTok Pixel', mono: 'T', color: '#111111', powers: 'TikTok ad conversions and audiences. Loads after consent.',
    where: 'TikTok Ads Manager › Tools › Events › Web events › your pixel: the Pixel ID (capital letters and digits).', fields: [['tiktokPixel.pixelId', 'Pixel ID', 'C4ABCDEFGH1234567890']] },
  { key: 'pinterestTag', name: 'Pinterest Tag', mono: 'P', color: '#e60023', powers: 'Pinterest ad conversions. Loads after consent.',
    where: 'Pinterest Ads › Conversions › Tag manager: the numeric Tag ID.', fields: [['pinterestTag.tagId', 'Tag ID', '2612345678901']] },
  { key: 'clarity', name: 'Microsoft Clarity', mono: 'C', color: '#6a4bff', powers: 'Session recordings and heatmaps. Loads after consent.',
    where: 'clarity.microsoft.com › your project › Settings › Overview: “Project ID”.', fields: [['clarity.projectId', 'Project ID', 'abcd1234ef']] },
  { key: 'sentry', name: 'Sentry', mono: 'Se', color: '#362d59', powers: 'JavaScript error monitoring for the storefront and checkout.',
    where: 'Sentry › Settings › Projects › your project › Client Keys (DSN). The DSN is public by design.', fields: [['sentry.dsn', 'DSN', 'https://0123456789abcdef0123456789abcdef@o123456.ingest.sentry.io/1234567']] },
  { key: 'turnstile', name: 'Cloudflare Turnstile', mono: 'CF', color: '#f38020', powers: 'Bot protection on checkout (Settings › Checkout › Bot protection).',
    where: 'Cloudflare dashboard › Turnstile › Add site: the “Site Key” (0x…). The secret key goes in your backend as TURNSTILE_SECRET_KEY.', fields: [['turnstile.siteKey', 'Site key', '0x4AAAAAAA…']] },
  { key: 'recaptcha', name: 'Google reCAPTCHA', mono: 'rC', color: '#1a73e8', powers: 'Alternative bot protection for forms.',
    where: 'google.com/recaptcha/admin › your site › Settings › reCAPTCHA keys: the site key (6L…).', fields: [['recaptcha.siteKey', 'Site key', '6Lc…']] },
  { key: 'email', name: 'Email', mono: '@', color: '#000000', powers: 'Order confirmations, shipping updates and abandoned-checkout emails sent by your backend.',
    where: 'Verify your sending domain with the provider, then use an address on that domain. The API key goes in your backend.', fields: [['email.fromEmail', 'From email', 'orders@yourstore.com'], ['email.replyTo', 'Reply-to email', 'help@yourstore.com']] },
  { key: 'discord', name: 'Discord', mono: 'D', color: '#5865f2', powers: 'Order alerts in a channel and buyer roles for community products.',
    where: 'Discord › User Settings › Advanced › Developer Mode, then right-click your server › Copy Server ID.', fields: [['discord.guildId', 'Server (guild) ID', '123456789012345678']] },
  { key: 'telegram', name: 'Telegram', mono: 'Tg', color: '#229ed9', powers: 'Order alerts from your bot, and a “Message us” link.',
    where: 'Create a bot with @BotFather; its username ends in “bot”. The bot token goes in your backend.', fields: [['telegram.botUsername', 'Bot username', 'MyStoreBot']] },
];
const get = (ig, path) => { const [a, b] = path.split('.'); return ig[a]?.[b] ?? ''; };

/** 'ready' | 'invalid' | 'off' for an integration card. */
export function appStatus(app, c) {
  const ig = c.settings.integrations;
  if (app.key === 'supabase') { if (ig.backend.provider !== 'supabase' || (!ig.backend.url && !ig.backend.anonKey)) return 'off'; return app.fields.some(([p]) => validateField(p, get(ig, p))) ? 'invalid' : backendReady(c) ? 'ready' : 'off'; }
  if (app.key === 'email' && ig.email.provider === 'none') return 'off';
  const vals = app.fields.map(([p]) => [p, get(ig, p)]);
  if (vals.some(([p, v]) => validateField(p, v))) return 'invalid';
  return vals.some(([, v]) => v) ? 'ready' : 'off';
}
const STATUS_PILL = { ready: ['Ready', 'ok'], invalid: ['Check values', 'bad'], off: ['Not set', 'neutral'] };

export function Apps({ c, edit }) {
  const ig = c.settings.integrations;
  const setPath = (path, v) => edit((_, x) => { const [a, b] = path.split('.'); x.settings.integrations[a][b] = v.trim(); if (a === 'backend' && v.trim()) x.settings.integrations.backend.provider = 'supabase'; });
  const ready = APPS.filter(a => appStatus(a, c) === 'ready').length;
  return <>
    <Section id="apps-overview" title="Connected services" desc={`${ready} of ${APPS.length} ready. Only public IDs are stored here — they end up in your published store. Secrets stay in your backend.`} bare>
      <div className="csApps">{APPS.map(app => <AppCard key={app.key} app={app} c={c} ig={ig} setPath={setPath} edit={edit} />)}</div>
    </Section>
    <ServerSecrets secrets={serverSecrets(c)} id="apps-secrets" />
  </>;
}

function AppCard({ app, c, ig, setPath, edit }) {
  const st = appStatus(app, c), [label, tone] = STATUS_PILL[st];
  const [open, setOpen] = useState(st !== 'off');
  const [test, setTest] = useState(null);
  const testConnection = async () => {
    setTest({ busy: true });
    try {
      const b = ig.backend, res = await fetch(b.url.replace(/\/+$/, '') + '/rest/v1/', { headers: { apikey: b.anonKey, authorization: 'Bearer ' + b.anonKey } });
      setTest(res.ok ? { ok: true, msg: `Connected — the project answered ${res.status}.` } : res.status === 401 || res.status === 403 ? { ok: false, msg: `The project rejected the key (${res.status}). Copy the anon public key again.` } : { ok: false, msg: `The project answered ${res.status}.` });
    } catch { setTest({ ok: false, msg: 'Could not reach the project. Check the URL, your connection, and that the project is not paused.' }); }
  };
  return <article className={'csCard csApp' + (open ? ' open' : '')} id={'cs-app-' + app.key} aria-label={app.name}>
    <button type="button" className="csAppHead" aria-expanded={open} onClick={() => setOpen(v => !v)}>
      <span className="csLogo" style={{ background: app.color }} aria-hidden="true">{app.mono}</span>
      <span className="csRowMain"><span className="csRowLabel">{app.name}</span><span className="csRowSub">{app.powers}</span></span>
      <Pill tone={tone}>{label}</Pill>
    </button>
    {open && <div className="csAppBody">
      {app.key === 'email' && <Select label="Email provider" value={ig.email.provider} onChange={v => edit((_, x) => { x.settings.integrations.email.provider = v; })} options={EMAIL_PROVIDERS} />}
      {(app.key !== 'email' || ig.email.provider !== 'none') && <div className="caForm">{app.fields.map(([path, l, ph, hint]) => <Input key={path} label={l} aria-label={`${app.name}: ${l}`} vkey={path} mono={!path.startsWith('email.')} value={get(ig, path)} placeholder={ph} hint={hint} onChange={v => setPath(path, v)} />)}</div>}
      {app.key === 'supabase' && <>
        {functionsBase(c) && <CopyLine label="Edge Functions base URL" value={functionsBase(c)} />}
        <div className="csInline"><Btn icon={Plug} disabled={!backendReady(c) || test?.busy} onClick={testConnection}>{test?.busy ? 'Testing…' : 'Test connection'}</Btn>
          {ig.backend.provider === 'supabase' && <Btn kind="plain" onClick={() => edit((_, x) => { x.settings.integrations.backend = { provider: 'none', url: '', anonKey: '', functionsUrl: '' }; })}>Disconnect</Btn>}
          {test && !test.busy && <span className={test.ok ? 'csOk' : 'csErr'} role="status">{test.msg}</span>}</div>
      </>}
      <details className="csWhere"><summary>Where do I find this?</summary><p>{app.where}</p></details>
    </div>}
  </article>;
}

export function SalesChannels({ c, edit }) {
  const ch = c.settings.salesChannels;
  const H = { whatsapp: ['WhatsApp number', '+1 555 123 4567'], instagram: ['Instagram handle', '@yourstore'], facebook: ['Facebook page URL', 'https://facebook.com/yourstore'], google: ['Merchant Center ID', '123456789'], tiktok: ['TikTok handle', '@yourstore'], pinterest: ['Pinterest profile', '@yourstore'] };
  return <Section id="channels" title="Sales channels" desc="Where customers discover and buy your products. Each channel links back to your store.">
    {SALES_CHANNELS.map(([k, l, d]) => <Toggle key={k} id={'channel-' + k} label={l} desc={d} checked={ch[k].enabled} disabled={k === 'online'} onChange={v => edit((_, x) => { x.settings.salesChannels[k].enabled = v; })}>
      {H[k] && <Input label={H[k][0]} value={ch[k].handle} placeholder={H[k][1]} onChange={v => edit((_, x) => { x.settings.salesChannels[k].handle = v; })} />}
    </Toggle>)}
  </Section>;
}

const EVENT_MAP = {
  visit: ['session_start', '—', '—'], page_view: ['page_view', 'PageView', 'Pageview'], view_product: ['view_item', 'ViewContent', 'ViewContent'],
  add_to_cart: ['add_to_cart', 'AddToCart', 'AddToCart'], checkout_started: ['begin_checkout', 'InitiateCheckout', 'InitiateCheckout'], order_placed: ['purchase', 'Purchase', 'CompletePayment'],
};
const EVENT_LABEL = { visit: 'Visit', page_view: 'Page viewed', view_product: 'Product viewed', add_to_cart: 'Added to cart', checkout_started: 'Checkout started', order_placed: 'Order placed' };

export function CustomerEvents({ c, edit }) {
  const ce = c.settings.customerEvents, ig = c.settings.integrations;
  const dest = [ig.ga4.measurementId && 'Google Analytics 4', ig.gtm.containerId && 'Google Tag Manager', ig.metaPixel.pixelId && 'Meta Pixel', ig.tiktokPixel.pixelId && 'TikTok Pixel', ig.pinterestTag.tagId && 'Pinterest Tag'].filter(Boolean);
  return <>
    <Section id="events-forward" title="Customer events" desc="Storefront events your store records, and which ones are shared with your marketing tags.">
      <Toggle id="events-on" label="Share events with connected tags" desc={dest.length ? `Sends to ${dest.join(', ')} after the visitor consents.` : 'No analytics or ad tags are connected yet (Apps and integrations).'} checked={ce.forward} onChange={v => edit((_, x) => { x.settings.customerEvents.forward = v; })} />
    </Section>
    <Section id="events-list" title="Standard events" desc="Event names each platform receives.">
      <table className="caTable compact csTable"><thead><tr><th>Event</th><th>GA4</th><th>Meta</th><th>TikTok</th><th>Share</th></tr></thead>
        <tbody>{EVENT_TYPES.map(k => <tr key={k}><td><strong>{EVENT_LABEL[k] || k}</strong><br /><code className="csMini">{k}</code></td>{EVENT_MAP[k].map((n, i) => <td key={i}><code className="csMini">{n}</code></td>)}
          <td><input type="checkbox" role="switch" className="csSwitch" aria-label={`Share ${EVENT_LABEL[k] || k}`} checked={ce.events[k]} disabled={!ce.forward} onChange={e => { const v = e.target.checked; edit((_, x) => { x.settings.customerEvents.events[k] = v; }); }} /></td></tr>)}</tbody></table>
      <Note>Events are recorded by the storefront runtime; your checkout and tags read these choices from the store data.</Note>
    </Section>
  </>;
}


