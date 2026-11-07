// Settings: General, Payments, Checkout, Shipping & delivery, Taxes, Locations, Notifications, Domains, Policies.
// Edits collect in a draft of both documents; the save bar commits them (store values: name, contact, currency,
// checkout; everything else: commerce.settings).
import React, { useState } from 'react';
import { Plus, Trash2, RotateCcw, Copy, Store as StoreIcon, CreditCard, ShoppingCart, Truck, Receipt, MapPin, Bell, Globe, FileText, X } from 'lucide-react';
import { useAdmin, Page, Card, Btn, Text, Num, Select, Check, Area, Badge } from './ui.jsx';
import { normalizeStore, CURRENCIES, CHECKOUT_MODES } from '../model.js';
import { normalizeCommerce, COUNTRIES, countryName, WEIGHT_UNITS, cid, NOTIFICATION_KEYS, NOTIFICATION_LABELS, NOTIFICATION_VARIABLES, DEFAULT_NOTIFICATIONS, POLICY_KEYS, POLICY_TEMPLATES, policyText, fillTemplate } from './model.js';
import { orderVars } from './orders.js';
import { deployInstructions } from '../exporter.js';

const TABS = [['general', 'General', StoreIcon], ['payments', 'Payments', CreditCard], ['checkout', 'Checkout', ShoppingCart], ['shipping', 'Shipping and delivery', Truck], ['taxes', 'Taxes and duties', Receipt],
  ['locations', 'Locations', MapPin], ['notifications', 'Notifications', Bell], ['domains', 'Domains', Globe], ['policies', 'Policies', FileText]];

export default function Settings({ tab }) {
  const { store, commerce, commit, go, notify } = useAdmin();
  const [draft, setDraft] = useState(null);
  const s = draft ? draft.s : store, c = draft ? draft.c : commerce;
  const edit = (fn, mark) => setDraft(d => { const n = d ? structuredClone(d) : { s: structuredClone(store), c: structuredClone(commerce), marks: [] }; fn(n.s, n.c); if (mark && !n.marks.includes(mark)) n.marks.push(mark); return n; });
  const save = () => {
    const nc = structuredClone(draft.c); for (const m of draft.marks) nc.onboarding.steps[m] = true;
    commit(normalizeStore(draft.s), normalizeCommerce(nc), 'Settings saved'); setDraft(null); notify('Settings saved');
  };
  const P = { s, c, edit };
  return <Page title="Settings">
    {draft && <div className="caSaveBar" role="region" aria-label="Unsaved changes"><span>Unsaved changes</span><Btn onClick={() => setDraft(null)}>Discard</Btn><Btn kind="primary" onClick={save}>Save</Btn></div>}
    <div className="caSettings">
      <nav className="caSetNav" aria-label="Settings sections"><ul>{TABS.map(([k, l, Icon]) => <li key={k}><button type="button" className={tab === k ? 'on' : ''} aria-current={tab === k ? 'page' : undefined} onClick={() => go({ page: 'settings', tab: k })}><Icon size={15} aria-hidden="true" />{l}</button></li>)}</ul></nav>
      <div className="caSetBody">
        {tab === 'general' && <General {...P} />}
        {tab === 'payments' && <Payments {...P} />}
        {tab === 'checkout' && <Checkout {...P} />}
        {tab === 'shipping' && <Shipping {...P} />}
        {tab === 'taxes' && <Taxes {...P} />}
        {tab === 'locations' && <Locations {...P} />}
        {tab === 'notifications' && <Notifications {...P} />}
        {tab === 'domains' && <Domains {...P} />}
        {tab === 'policies' && <Policies {...P} />}
      </div>
    </div>
  </Page>;
}

function General({ s, c, edit }) {
  const g = c.settings.general;
  const G = k => v => edit((_, x) => { x.settings.general[k] = v; });
  return <>
    <Card title="Store details"><div className="caForm two">
      <Text label="Store name" value={s.name} onChange={v => edit(st => { if (st.logo.text === st.name) st.logo.text = v; st.name = v; })} />
      <Text label="Store contact email" type="email" value={s.contact.email} onChange={v => edit(st => { st.contact.email = v; })} hint="Shown on your contact page." />
      <Text label="Store phone" value={s.contact.phone} onChange={v => edit(st => { st.contact.phone = v; })} />
      <Text label="Opening hours" value={s.contact.hours} onChange={v => edit(st => { st.contact.hours = v; })} />
      <Area label="Store address" value={s.contact.address} rows={2} onChange={v => edit(st => { st.contact.address = v; })} wide />
    </div></Card>
    <Card title="Billing information"><div className="caForm two">
      <Text label="Legal business name" value={g.legalName} onChange={G('legalName')} />
      <Text label="Sender / billing email" type="email" value={g.email} onChange={G('email')} hint="Used on invoices, policies and notification emails." />
      <Text label="Billing phone" value={g.phone} onChange={G('phone')} />
      <Area label="Legal business address" value={g.address} rows={2} onChange={G('address')} wide />
    </div></Card>
    <Card title="Store defaults"><div className="caForm three">
      <Select label="Store currency" value={s.currency.code} onChange={v => edit(st => { st.currency = { code: v, locale: CURRENCIES.find(x => x[0] === v)[1] }; })} options={CURRENCIES.map(([k]) => [k, k])} hint="Prices are not converted when you change it." />
      <Select label="Unit system" value={g.unitSystem} onChange={v => edit((_, x) => { x.settings.general.unitSystem = v; x.settings.general.weightUnit = v === 'imperial' ? 'lb' : 'kg'; })} options={[['metric', 'Metric system'], ['imperial', 'Imperial system']]} />
      <Select label="Default weight unit" value={g.weightUnit} onChange={G('weightUnit')} options={Object.keys(WEIGHT_UNITS).map(u => [u, { g: 'Grams (g)', kg: 'Kilograms (kg)', lb: 'Pounds (lb)', oz: 'Ounces (oz)' }[u]])} />
    </div></Card>
    <Card title="Order ID"><div className="caForm three">
      <Text label="Order prefix" value={g.orderPrefix} onChange={G('orderPrefix')} hint={`Your next order: ${g.orderPrefix}${g.nextOrderNumber}`} />
      <Num label="Next order number" value={g.nextOrderNumber} min={1} step={1} onChange={v => G('nextOrderNumber')(Math.round(v))} hint="Can only move forward past existing orders." />
      <Num label="Low stock threshold" value={g.lowStockThreshold} min={0} step={1} onChange={v => G('lowStockThreshold')(Math.round(v))} hint="Home shows an alert at or below this quantity." />
    </div></Card>
  </>;
}

function Payments({ s, c, edit }) {
  const pm = c.settings.payments;
  return <>
    <Card title="How customers order">
      <Select label="Order method" value={s.checkout.mode} onChange={v => edit(st => { st.checkout.mode = v; }, 'payments')} options={CHECKOUT_MODES} hint="Your static store sends the order by WhatsApp or email, or links each product to a payment page (Stripe, PayPal, Square…)." />
      <div className="caForm two">
        {s.checkout.mode === 'whatsapp' && <Text label="WhatsApp number" value={s.checkout.phone} onChange={v => edit(st => { st.checkout.phone = v; }, 'payments')} hint="International format, e.g. +1 555 123 4567" />}
        {s.checkout.mode === 'email' && <Text label="Order email" type="email" value={s.checkout.email} onChange={v => edit(st => { st.checkout.email = v; }, 'payments')} />}
      </div>
    </Card>
    {s.checkout.mode === 'paymentLinks' && <Card title="Payment links" pad={false}>
      <table className="caTable compact"><thead><tr><th>Product</th><th>Payment link</th></tr></thead><tbody>{s.products.map(p => <tr key={p.id}><td>{p.title}</td>
        <td><input className="caInput" type="url" aria-label={`Payment link for ${p.title}`} placeholder="https://buy.stripe.com/…" value={s.checkout.paymentLinks[p.id] || ''} onChange={e => { const v = e.target.value; edit(st => { if (v) st.checkout.paymentLinks[p.id] = v; else delete st.checkout.paymentLinks[p.id]; }, 'payments'); }} /></td></tr>)}</tbody></table>
    </Card>}
    <Card title="Manual payment methods" actions={<Btn icon={Plus} onClick={() => edit((_, x) => { x.settings.payments.manualMethods.push({ id: cid('pm'), name: 'New method', instructions: '', enabled: true }); }, 'payments')}>Add method</Btn>}>
      <p className="caHint">Offered when you create orders and filled into payment-reminder emails as {'{{payment_instructions}}'}.</p>
      {pm.manualMethods.map((m, i) => <div key={m.id} className="caSubCard" role="group" aria-label={m.name}>
        <div className="caInline between"><Check label={`Enable ${m.name}`} checked={m.enabled} onChange={v => edit((_, x) => { x.settings.payments.manualMethods[i].enabled = v; }, 'payments')} />
          <button type="button" className="caIconBtn sm" aria-label={`Remove ${m.name}`} onClick={() => edit((_, x) => { x.settings.payments.manualMethods.splice(i, 1); })}><Trash2 size={13} /></button></div>
        <div className="caForm two"><Text label={`Payment method ${i + 1} name`} value={m.name} onChange={v => edit((_, x) => { x.settings.payments.manualMethods[i].name = v; })} />
          <Area label={`Payment method ${i + 1} instructions`} value={m.instructions} rows={2} onChange={v => edit((_, x) => { x.settings.payments.manualMethods[i].instructions = v; })} /></div>
      </div>)}
    </Card>
    <Card title="Payment provider notes"><Area label="Provider notes" value={pm.providerNotes} rows={3} onChange={v => edit((_, x) => { x.settings.payments.providerNotes = v; })} hint="Account names, dashboards, payout schedules — for your team." /></Card>
  </>;
}

function Checkout({ s, c, edit }) {
  return <>
    <Card title="Checkout page"><div className="caForm">
      <Text label="Shipping note" value={s.checkout.shippingNote} onChange={v => edit(st => { st.checkout.shippingNote = v; }, 'payments')} hint="Shown in the cart and at checkout, e.g. “Free shipping over $75”." />
      <Area label="Checkout note" value={s.checkout.note} rows={3} onChange={v => edit(st => { st.checkout.note = v; }, 'payments')} hint="Extra text on the checkout page." />
    </div></Card>
    <Card title="Order collection">
      <p className="caText">Orders sent by WhatsApp or email reach you directly. To collect orders automatically, set an order webhook URL; the storefront POSTs each order there as JSON (see Analytics › Connect a backend).</p>
      <Text label="Order webhook URL" type="url" value={c.settings.backend.orderWebhookUrl} onChange={v => edit((_, x) => { x.settings.backend.orderWebhookUrl = v.trim(); })} placeholder="https://example.com/orders" />
    </Card>
  </>;
}

function CountryChips({ value, onChange, label }) {
  return <div className="caField"><span className="caLabel">{label}</span>
    <div className="caTags">{value.map(code => <span key={code} className="caTag">{countryName(code)}<button type="button" aria-label={`Remove ${countryName(code)}`} onClick={() => onChange(value.filter(x => x !== code))}><X size={11} /></button></span>)}
      <select className="caTagInput" aria-label={`Add country to ${label}`} value="" onChange={e => { if (e.target.value) onChange([...new Set([...value, e.target.value])]); }}>
        <option value="">Add country…</option><option value="*">Rest of world</option>{COUNTRIES.filter(([k]) => !value.includes(k)).map(([k, n]) => <option key={k} value={k}>{n}</option>)}
      </select></div></div>;
}

function Shipping({ c, edit }) {
  const unit = c.settings.general.weightUnit, k = WEIGHT_UNITS[unit];
  const Z = (zi, fn) => edit((_, x) => fn(x.settings.shipping.zones[zi]), 'shipping');
  return <>
    <Card title="Shipping zones" actions={<Btn icon={Plus} onClick={() => edit((_, x) => { x.settings.shipping.zones.push({ id: cid('z'), name: 'New zone', countries: [], rates: [{ id: cid('sr'), name: 'Standard', type: 'flat', price: 5, threshold: 0, tiers: [] }] }); }, 'shipping')}>Create zone</Btn>}>
      <p className="caHint">Rates apply to orders you create here (and to storefronts that support them). An address matches the zone with its country first, then a “Rest of world” zone.</p>
      {!c.settings.shipping.zones.length && <p className="caMuted">No shipping zones: orders can only be created without shipping.</p>}
    </Card>
    {c.settings.shipping.zones.map((z, zi) => <Card key={z.id} title={z.name || 'Zone'} actions={<button type="button" className="caIconBtn sm" aria-label={`Delete zone ${z.name}`} onClick={() => edit((_, x) => { x.settings.shipping.zones.splice(zi, 1); }, 'shipping')}><Trash2 size={14} /></button>}>
      <div className="caForm two"><Text label={`Zone ${zi + 1} name`} value={z.name} onChange={v => Z(zi, zz => { zz.name = v; })} />
        <CountryChips label={`Zone ${zi + 1} countries`} value={z.countries} onChange={v => Z(zi, zz => { zz.countries = v; })} /></div>
      <h3 className="caSub">Rates</h3>
      {z.rates.map((r, ri) => { const R = fn => Z(zi, zz => fn(zz.rates[ri])), lab = `Zone ${zi + 1} rate ${ri + 1}`; return <div key={r.id} className="caSubCard" role="group" aria-label={lab}>
        <div className="caForm four">
          <Text label={`${lab} name`} value={r.name} onChange={v => R(x => { x.name = v; })} />
          <Select label={`${lab} type`} value={r.type} onChange={v => R(x => { x.type = v; if (v === 'weight' && !x.tiers.length) x.tiers = [{ upTo: 1000, price: x.price || 5 }]; })} options={[['flat', 'Flat rate'], ['free_over', 'Free over an amount'], ['weight', 'Based on weight']]} />
          {r.type !== 'weight' && <Num label={`${lab} price`} value={r.price} min={0} onChange={v => R(x => { x.price = v; })} />}
          {r.type === 'free_over' && <Num label={`${lab} free from order subtotal`} value={r.threshold} min={0} onChange={v => R(x => { x.threshold = v; })} />}
        </div>
        {r.type === 'weight' && <div className="caTiers">{r.tiers.map((t, ti) => <div key={ti} className="caInline">
          <Num label={`${lab} tier ${ti + 1} up to (${unit})`} value={Math.round(t.upTo / k * 1000) / 1000} min={0} onChange={v => R(x => { x.tiers[ti].upTo = Math.round(v * k); })} />
          <Num label={`${lab} tier ${ti + 1} price`} value={t.price} min={0} onChange={v => R(x => { x.tiers[ti].price = v; })} />
          <button type="button" className="caIconBtn sm" aria-label={`Remove ${lab} tier ${ti + 1}`} onClick={() => R(x => { x.tiers.splice(ti, 1); })}><Trash2 size={13} /></button></div>)}
          <Btn kind="plain" icon={Plus} onClick={() => R(x => { const last = x.tiers[x.tiers.length - 1]; x.tiers.push({ upTo: last ? last.upTo * 2 : 1000, price: last ? last.price : 5 }); })}>Add weight tier</Btn></div>}
        <div className="caInline end"><Btn kind="plain" icon={Trash2} onClick={() => Z(zi, zz => { zz.rates.splice(ri, 1); })}>Remove rate</Btn></div>
      </div>; })}
      <Btn icon={Plus} onClick={() => Z(zi, zz => { zz.rates.push({ id: cid('sr'), name: 'New rate', type: 'flat', price: 0, threshold: 0, tiers: [] }); })}>Add rate</Btn>
    </Card>)}
  </>;
}

function Taxes({ c, edit }) {
  const t = c.settings.taxes;
  return <>
    <Card title="Tax calculations">
      <Check label="All prices include tax" checked={t.inclusive} onChange={v => edit((_, x) => { x.settings.taxes.inclusive = v; })} hint="Common in the EU, UK and Australia. Tax is shown as included and not added at checkout." />
      <Check label="Charge tax on shipping rates" checked={t.shippingTaxed} onChange={v => edit((_, x) => { x.settings.taxes.shippingTaxed = v; })} />
    </Card>
    <Card title="Tax rates" actions={<Btn icon={Plus} onClick={() => edit((_, x) => { x.settings.taxes.rates.push({ id: cid('tx'), country: 'US', region: '', name: 'Sales tax', rate: 0 }); })}>Add rate</Btn>} pad={false}>
      {t.rates.length ? <table className="caTable compact"><thead><tr><th>Country</th><th>Region (optional)</th><th>Name</th><th>Rate (%)</th><th /></tr></thead>
        <tbody>{t.rates.map((r, i) => { const R = fn => edit((_, x) => fn(x.settings.taxes.rates[i])), lab = `Tax rate ${i + 1}`; return <tr key={r.id}>
          <td><select className="caInput" aria-label={`${lab} country`} value={r.country} onChange={e => { const v = e.target.value; R(x => { x.country = v; }); }}>{COUNTRIES.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></td>
          <td><input className="caInput" aria-label={`${lab} region`} value={r.region} placeholder="All regions" onChange={e => { const v = e.target.value; R(x => { x.region = v; }); }} /></td>
          <td><input className="caInput" aria-label={`${lab} name`} value={r.name} onChange={e => { const v = e.target.value; R(x => { x.name = v; }); }} /></td>
          <td><input className="caInput cell" type="number" min="0" max="100" step="any" aria-label={`${lab} percent`} value={r.rate} onChange={e => { const v = +e.target.value; if (Number.isFinite(v)) R(x => { x.rate = Math.max(0, Math.min(100, v)); }); }} /></td>
          <td className="n"><button type="button" className="caIconBtn sm" aria-label={`Remove ${lab}`} onClick={() => edit((_, x) => { x.settings.taxes.rates.splice(i, 1); })}><Trash2 size={13} /></button></td></tr>; })}</tbody></table>
        : <p className="caMuted caCardBody">No tax rates: orders are created without tax.</p>}
      <p className="caHint caCardBody">A region rate (state, province) replaces the country rate for addresses in that region. Check your obligations with a tax advisor.</p>
    </Card>
  </>;
}

function Locations({ c, edit }) {
  return <Card title="Locations" actions={<Btn icon={Plus} onClick={() => edit((_, x) => { x.settings.locations.push({ id: cid('loc'), name: 'New location', address: '', isDefault: !x.settings.locations.length }); })}>Add location</Btn>}>
    <p className="caHint">Where you stock and ship from. The default location is the return address on packing slips and the “ship from” choice when fulfilling.</p>
    {c.settings.locations.map((l, i) => <div key={l.id} className="caSubCard" role="group" aria-label={l.name}>
      <div className="caForm two"><Text label={`Location ${i + 1} name`} value={l.name} onChange={v => edit((_, x) => { x.settings.locations[i].name = v; })} />
        <Area label={`Location ${i + 1} address`} value={l.address} rows={2} onChange={v => edit((_, x) => { x.settings.locations[i].address = v; })} /></div>
      <div className="caInline between">{l.isDefault ? <Badge tone="ok">Default location</Badge> : <Btn kind="plain" onClick={() => edit((_, x) => { x.settings.locations.forEach((y, k) => { y.isDefault = k === i; }); })}>Make default</Btn>}
        <Btn kind="plain" icon={Trash2} disabled={c.settings.locations.length < 2} onClick={() => edit((_, x) => { x.settings.locations.splice(i, 1); })}>Remove</Btn></div>
    </div>)}
  </Card>;
}

function Notifications({ s, c, edit }) {
  const { store, commerce } = useAdmin();
  const [key, setKey] = useState(NOTIFICATION_KEYS[0]);
  const n = c.settings.notifications, t = n.templates[key];
  const sample = commerce.orders.filter(o => !o.draft).slice(-1)[0] || { name: '#1001', createdAt: new Date().toISOString(), customerId: null, email: 'customer@example.com', shippingAddress: { name: 'Alex Doe' }, paymentMethod: '',
    lines: [{ title: s.products[0]?.title || 'Product', variantTitle: '', quantity: 1, price: s.products[0]?.price || 25 }], totals: { total: s.products[0]?.price || 25 }, fulfillments: [{ carrier: 'UPS', trackingNumber: '1Z999AA10123456784', trackingUrl: 'https://www.ups.com/track' }], refunds: [{ amount: 10 }] };
  const vars = orderVars(store, { ...commerce, settings: c.settings }, sample);
  const T = (k2, v) => edit((_, x) => { x.settings.notifications.templates[key][k2] = v; });
  return <>
    <Card title="Sender"><div className="caForm two">
      <Text label="Sender name" value={n.senderName} onChange={v => edit((_, x) => { x.settings.notifications.senderName = v; })} placeholder={s.name} />
      <Text label="Sender email" type="email" value={n.senderEmail} onChange={v => edit((_, x) => { x.settings.notifications.senderEmail = v; })} hint="Emails open in your own email app, sent from your account." />
    </div></Card>
    <Card title="Customer notifications">
      <div className="caNotify">
        <ul className="caNotifyList" role="tablist" aria-label="Notification templates">{NOTIFICATION_KEYS.map(k => <li key={k}><button type="button" role="tab" aria-selected={key === k} className={key === k ? 'on' : ''} onClick={() => setKey(k)}>{NOTIFICATION_LABELS[k]}</button></li>)}</ul>
        <div className="caNotifyEdit" role="tabpanel" aria-label={NOTIFICATION_LABELS[key]}>
          <Text label="Email subject" value={t.subject} onChange={v => T('subject', v)} />
          <Area label="Email body" value={t.body} rows={10} onChange={v => T('body', v)} />
          <div className="caVars" aria-label="Variables">{NOTIFICATION_VARIABLES.map(v => <button key={v} type="button" className="caChip" onClick={() => T('body', t.body + '{{' + v + '}}')} aria-label={`Insert variable ${v}`}>{'{{' + v + '}}'}</button>)}</div>
          <div className="caInline"><Btn kind="plain" icon={RotateCcw} onClick={() => edit((_, x) => { x.settings.notifications.templates[key] = { ...DEFAULT_NOTIFICATIONS[key] }; })}>Reset to default</Btn></div>
          <h3 className="caSub">Preview</h3>
          <div className="caMailPreview" aria-label="Email preview"><strong>{fillTemplate(t.subject, vars)}</strong><pre>{fillTemplate(t.body, vars)}</pre></div>
        </div>
      </div>
    </Card>
  </>;
}

const DNS = {
  netlify: ['Netlify', 'In Netlify: Site configuration › Domain management › Add a domain. At your registrar, add a CNAME record for www pointing to <site>.netlify.app and an A record for the apex (@) pointing to Netlify’s load balancer IP shown in the dashboard.'],
  github: ['GitHub Pages', 'In the repository: Settings › Pages › Custom domain. At your registrar, add a CNAME record for www pointing to <user>.github.io and A records for the apex (@) with the four GitHub Pages IPs listed in GitHub’s documentation. Enable “Enforce HTTPS”.'],
  cloudflare: ['Cloudflare Pages', 'In Cloudflare Pages: your project › Custom domains › Set up a domain. If the domain uses Cloudflare DNS the record is created for you; otherwise add the CNAME shown.'],
  vercel: ['Vercel', 'In Vercel: Project › Settings › Domains › Add. Follow the A / CNAME records Vercel shows for your domain.'],
  other: ['Other host', 'Ask your host for the DNS records to add (usually a CNAME for www and an A record for the apex domain), then add them at your domain registrar.'],
};
function Domains({ s, c, edit }) {
  const { notify } = useAdmin();
  const d = c.settings.domains;
  const D = k => v => edit((_, x) => { x.settings.domains[k] = v; }, 'domain');
  return <>
    <Card title="Domain"><div className="caForm two">
      <Text label="Primary domain" value={d.primary} placeholder="www.mystore.com" onChange={D('primary')} hint="Used in previews (SEO listing, tracked links). Buy domains from any registrar." />
      <Select label="Hosting provider" value={d.provider} onChange={D('provider')} options={Object.entries(DNS).map(([k, v]) => [k, v[0]])} />
    </div>
      <Check label="Domain is connected and serving my store" checked={d.connected} onChange={D('connected')} />
    </Card>
    <Card title={`Connect ${d.primary || 'your domain'} on ${DNS[d.provider][0]}`}>
      <ol className="caList num"><li>Export your store (Home › Launch your store) and upload the unzipped folder to {DNS[d.provider][0]}.</li><li>{DNS[d.provider][1]}</li><li>Wait for DNS to update (minutes to a few hours), then open https://{d.primary || 'your-domain'} to check.</li></ol>
      <div className="caInline"><Btn icon={Copy} onClick={() => navigator.clipboard?.writeText(deployInstructions(s)).then(() => notify('Deploy instructions copied'), () => notify('Copy failed'))}>Copy full deploy instructions</Btn></div>
    </Card>
    <Card title="Notes"><Area label="Domain notes" value={d.notes} rows={3} onChange={D('notes')} hint="Registrar, renewal date, DNS provider…" /></Card>
  </>;
}

function Policies({ s, c, edit }) {
  const { store, commerce } = useAdmin();
  return <>{POLICY_KEYS.map(k => { const p = c.settings.policies[k], tpl = POLICY_TEMPLATES[k], P = fn => edit((_, x) => fn(x.settings.policies[k]));
    return <Card key={k} title={p.title}>
      <details className="caDetails"><summary>Template details</summary>
        <div className="caForm two">{tpl.fields.map(([f, label, def]) => <Text key={f} label={label} value={p.values[f] ?? ''} placeholder={def} onChange={v => P(x => { x.values[f] = v; })} />)}</div>
        <Btn icon={RotateCcw} onClick={() => P(x => { x.body = policyText(k, x, s, { ...commerce, settings: c.settings }); })}>{p.body ? 'Regenerate from template' : 'Create from template'}</Btn>
      </details>
      <Text label={`${tpl.title} title`} value={p.title} onChange={v => P(x => { x.title = v; })} />
      <Area label={`${tpl.title} text`} value={p.body} rows={p.body ? 12 : 3} placeholder="Create from the template, then edit the text." onChange={v => P(x => { x.body = v; })} />
    </Card>; })}</>;
}
