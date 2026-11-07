// Settings › Shipping and delivery, Taxes and duties, Locations, Markets, Domains, Notifications, Policies.
import React, { useState } from 'react';
import { Plus, Trash2, RotateCcw, Copy, X } from 'lucide-react';
import { useAdmin, Btn, Text, Num, Select, Check, Area } from '../ui.jsx';
import { CURRENCIES } from '../../model.js';
import { COUNTRIES, countryName, WEIGHT_UNITS, cid, NOTIFICATION_KEYS, NOTIFICATION_LABELS, NOTIFICATION_VARIABLES, DEFAULT_NOTIFICATIONS, POLICY_KEYS, POLICY_TEMPLATES, policyText, fillTemplate } from '../model.js';
import { orderVars } from '../orders.js';
import { deployInstructions } from '../../exporter.js';
import { Section, Row, Toggle, Menu, Pill, Note, flag } from './kit.jsx';

function CountryChips({ value, onChange, label }) {
  return <div className="caField"><span className="caLabel">{label}</span>
    <div className="caTags">{value.map(code => <span key={code} className="caTag">{flag(code)} {countryName(code)}<button type="button" aria-label={`Remove ${countryName(code)}`} onClick={() => onChange(value.filter(x => x !== code))}><X size={11} /></button></span>)}
      <select className="caTagInput" aria-label={`Add country to ${label}`} value="" onChange={e => { if (e.target.value) onChange([...new Set([...value, e.target.value])]); }}>
        <option value="">Add country…</option><option value="*">Rest of world</option>{COUNTRIES.filter(([k]) => !value.includes(k)).map(([k, n]) => <option key={k} value={k}>{n}</option>)}
      </select></div></div>;
}

export function Shipping({ c, edit }) {
  const unit = c.settings.general.weightUnit, k = WEIGHT_UNITS[unit];
  const Z = (zi, fn) => edit((_, x) => fn(x.settings.shipping.zones[zi]), 'shipping');
  return <>
    <Section id="zones" title="Shipping zones" desc="An address matches the zone with its country first, then a “Rest of world” zone." bare
      actions={<Btn icon={Plus} onClick={() => edit((_, x) => { x.settings.shipping.zones.push({ id: cid('z'), name: 'New zone', countries: [], rates: [{ id: cid('sr'), name: 'Standard', type: 'flat', price: 5, threshold: 0, tiers: [] }] }); }, 'shipping')}>Create zone</Btn>}>
      {!c.settings.shipping.zones.length && <div className="csCard"><Note>No shipping zones: orders can only be created without shipping.</Note></div>}
      {c.settings.shipping.zones.map((z, zi) => <div key={z.id} className="csCard" role="group" aria-label={z.name || 'Zone'}>
        <div className="csCardHead"><strong>{z.countries.slice(0, 4).map(flag).join(' ')} {z.name || 'Zone'}</strong><span className="csRowSub">{z.rates.length} {z.rates.length === 1 ? 'rate' : 'rates'}</span>
          <button type="button" className="csIconBtn" aria-label={`Delete zone ${z.name}`} onClick={() => edit((_, x) => { x.settings.shipping.zones.splice(zi, 1); }, 'shipping')}><Trash2 size={14} /></button></div>
        <div className="csPad">
          <div className="caForm two"><Text label={`Zone ${zi + 1} name`} value={z.name} onChange={v => Z(zi, zz => { zz.name = v; })} />
            <CountryChips label={`Zone ${zi + 1} countries`} value={z.countries} onChange={v => Z(zi, zz => { zz.countries = v; })} /></div>
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
          <div><Btn icon={Plus} onClick={() => Z(zi, zz => { zz.rates.push({ id: cid('sr'), name: 'New rate', type: 'flat', price: 0, threshold: 0, tiers: [] }); })}>Add rate</Btn></div>
        </div>
      </div>)}
    </Section>
  </>;
}

export function Taxes({ c, edit }) {
  const t = c.settings.taxes, stripeTax = c.settings.payments.stripe.automaticTax;
  return <>
    <Section id="tax-calc" title="Tax calculations" desc="How tax is shown and charged on your prices.">
      <Toggle id="tax-inclusive" label="All prices include tax" desc="Common in the EU, UK and Australia. Tax is shown as included and not added at checkout." checked={t.inclusive} onChange={v => edit((_, x) => { x.settings.taxes.inclusive = v; })} />
      <Toggle id="tax-shipping" label="Charge tax on shipping rates" checked={t.shippingTaxed} onChange={v => edit((_, x) => { x.settings.taxes.shippingTaxed = v; })} />
      {stripeTax && <Note tone="info">Stripe Tax is on (Payments): Stripe calculates tax for Stripe payments; the rates below apply to orders you create here.</Note>}
    </Section>
    <Section id="tax-rates" title="Tax rates" desc="A region rate (state, province) replaces the country rate for addresses in that region."
      actions={<Btn icon={Plus} onClick={() => edit((_, x) => { x.settings.taxes.rates.push({ id: cid('tx'), country: c.settings.general.country || 'US', region: '', name: 'Sales tax', rate: 0 }); })}>Add rate</Btn>}>
      {t.rates.length ? <table className="caTable compact csTable"><thead><tr><th>Country</th><th>Region (optional)</th><th>Name</th><th>Rate (%)</th><th /></tr></thead>
        <tbody>{t.rates.map((r, i) => { const R = fn => edit((_, x) => fn(x.settings.taxes.rates[i])), lab = `Tax rate ${i + 1}`; return <tr key={r.id}>
          <td><select className="caInput" aria-label={`${lab} country`} value={r.country} onChange={e => { const v = e.target.value; R(x => { x.country = v; }); }}>{COUNTRIES.map(([k, n]) => <option key={k} value={k}>{flag(k)} {n}</option>)}</select></td>
          <td><input className="caInput" aria-label={`${lab} region`} value={r.region} placeholder="All regions" onChange={e => { const v = e.target.value; R(x => { x.region = v; }); }} /></td>
          <td><input className="caInput" aria-label={`${lab} name`} value={r.name} onChange={e => { const v = e.target.value; R(x => { x.name = v; }); }} /></td>
          <td><input className="caInput cell" type="number" min="0" max="100" step="any" aria-label={`${lab} percent`} value={r.rate} onChange={e => { const v = +e.target.value; if (Number.isFinite(v)) R(x => { x.rate = Math.max(0, Math.min(100, v)); }); }} /></td>
          <td className="n"><button type="button" className="csIconBtn" aria-label={`Remove ${lab}`} onClick={() => edit((_, x) => { x.settings.taxes.rates.splice(i, 1); })}><Trash2 size={14} /></button></td></tr>; })}</tbody></table>
        : <Note>No tax rates: orders are created without tax.</Note>}
      <Note>Check your obligations with a tax advisor.</Note>
    </Section>
  </>;
}

export function Locations({ c, edit }) {
  return <Section id="locations" title="Locations" desc="Where you stock and ship from. The default location is the return address on packing slips."
    actions={<Btn icon={Plus} onClick={() => edit((_, x) => { x.settings.locations.push({ id: cid('loc'), name: 'New location', address: '', isDefault: !x.settings.locations.length }); })}>Add location</Btn>}>
    {c.settings.locations.map((l, i) => <Row key={l.id} label={l.name} sub={l.address.split('\n')[0] || 'No address'} value={l.isDefault ? <Pill tone="ok">Default</Pill> : null}
      menu={<Menu label={l.name} items={[!l.isDefault && ['Make default', () => edit((_, x) => { x.settings.locations.forEach((y, k) => { y.isDefault = k === i; }); })], c.settings.locations.length > 1 && ['Remove', () => edit((_, x) => { x.settings.locations.splice(i, 1); }), true]]} />}>
      <div className="caForm two" role="group" aria-label={l.name}><Text label={`Location ${i + 1} name`} value={l.name} onChange={v => edit((_, x) => { x.settings.locations[i].name = v; })} />
        <Area label={`Location ${i + 1} address`} value={l.address} rows={2} onChange={v => edit((_, x) => { x.settings.locations[i].address = v; })} /></div>
    </Row>)}
  </Section>;
}

export function Markets({ s, c, edit }) {
  const ms = c.settings.markets, M = (i, fn) => edit((_, x) => fn(x.settings.markets[i]));
  const [open, setOpen] = useState(null);
  const add = primary => { const id = cid('mkt'); edit((_, x) => { x.settings.markets.push({ id, name: primary ? countryName(c.settings.general.country) : 'International', countries: primary ? [c.settings.general.country] : ['*'], currency: '', enabled: true, primary: !!primary || !x.settings.markets.length }); }); setOpen(id); };
  return <Section id="markets" title="Markets" desc="Group countries you sell to, with their own currency and availability." actions={<Btn icon={Plus} onClick={() => add(!ms.length)}>Add market</Btn>}>
    {!ms.length && <Row label="No markets yet" sub={`You sell everywhere in ${s.currency.code}. Add a primary market to start localizing.`} value={<Btn onClick={() => add(true)}>Create primary market</Btn>} />}
    {ms.map((m, i) => <Row key={m.id} label={<>{m.countries.slice(0, 5).map(flag).join(' ')} {m.name}</>} sub={`${m.countries.map(countryName).join(', ') || 'No countries'} · ${m.currency || s.currency.code}`}
      value={<>{m.primary && <Pill tone="info">Primary</Pill>}<Pill tone={m.enabled ? 'ok' : 'neutral'}>{m.enabled ? 'Active' : 'Inactive'}</Pill></>}
      menu={<Menu label={m.name} items={[['Edit', () => setOpen(open === m.id ? null : m.id)], !m.primary && ['Make primary', () => edit((_, x) => { x.settings.markets.forEach((y, k) => { y.primary = k === i; }); })],
        !m.primary && [m.enabled ? 'Deactivate' : 'Activate', () => M(i, x => { x.enabled = !x.enabled; })], ['Remove', () => edit((_, x) => { x.settings.markets.splice(i, 1); }), true]]} />}>
      {open === m.id && <div className="caForm two" role="group" aria-label={`${m.name} market`}>
        <Text label={`Market ${i + 1} name`} value={m.name} onChange={v => M(i, x => { x.name = v; })} />
        <Select label={`Market ${i + 1} currency`} value={m.currency} onChange={v => M(i, x => { x.currency = v; })} options={[['', `Store currency (${s.currency.code})`], ...CURRENCIES.map(([k]) => [k, k])]} />
        <CountryChips label={`Market ${i + 1} countries`} value={m.countries} onChange={v => M(i, x => { x.countries = v; })} />
      </div>}
    </Row>)}
    <Note>Prices are shown in the market currency only when your storefront supports conversion; the store currency is used for orders.</Note>
  </Section>;
}

const DNS = {
  netlify: ['Netlify', 'In Netlify: Site configuration › Domain management › Add a domain. At your registrar, add a CNAME record for www pointing to <site>.netlify.app and an A record for the apex (@) pointing to Netlify’s load balancer IP shown in the dashboard.'],
  github: ['GitHub Pages', 'In the repository: Settings › Pages › Custom domain. At your registrar, add a CNAME record for www pointing to <user>.github.io and A records for the apex (@) with the four GitHub Pages IPs listed in GitHub’s documentation. Enable “Enforce HTTPS”.'],
  cloudflare: ['Cloudflare Pages', 'In Cloudflare Pages: your project › Custom domains › Set up a domain. If the domain uses Cloudflare DNS the record is created for you; otherwise add the CNAME shown.'],
  vercel: ['Vercel', 'In Vercel: Project › Settings › Domains › Add. Follow the A / CNAME records Vercel shows for your domain.'],
  other: ['Other host', 'Ask your host for the DNS records to add (usually a CNAME for www and an A record for the apex domain), then add them at your domain registrar.'],
};
export function Domains({ s, c, edit }) {
  const { notify } = useAdmin();
  const d = c.settings.domains, D = k => v => edit((_, x) => { x.settings.domains[k] = v; }, 'domain');
  return <>
    <Section id="domain" title="Domain" desc="The address customers type to reach your store.">
      <Row label={d.primary || 'No domain yet'} sub={DNS[d.provider][0]} value={d.connected ? <Pill tone="ok">Connected</Pill> : <Pill tone="warn">Not connected</Pill>} />
      <div className="csPad"><div className="caForm two">
        <Text label="Primary domain" value={d.primary} placeholder="www.mystore.com" onChange={D('primary')} hint="Used in previews (SEO listing, tracked links). Buy domains from any registrar." />
        <Select label="Hosting provider" value={d.provider} onChange={D('provider')} options={Object.entries(DNS).map(([k, v]) => [k, v[0]])} />
      </div>
        <Check label="Domain is connected and serving my store" checked={d.connected} onChange={D('connected')} /></div>
    </Section>
    <Section id="domain-connect" title={`Connect ${d.primary || 'your domain'} on ${DNS[d.provider][0]}`}>
      <div className="csPad">
        <ol className="caList num"><li>Export your store (Home › Launch your store) and upload the unzipped folder to {DNS[d.provider][0]}.</li><li>{DNS[d.provider][1]}</li><li>Wait for DNS to update (minutes to a few hours), then open https://{d.primary || 'your-domain'} to check.</li></ol>
        <div className="caInline"><Btn icon={Copy} onClick={() => navigator.clipboard?.writeText(deployInstructions(s)).then(() => notify('Deploy instructions copied'), () => notify('Copy failed'))}>Copy full deploy instructions</Btn></div>
      </div>
    </Section>
    <Section id="domain-notes" title="Notes"><div className="csPad"><Area label="Domain notes" value={d.notes} rows={3} onChange={D('notes')} hint="Registrar, renewal date, DNS provider…" /></div></Section>
  </>;
}

export function Notifications({ s, c, edit, open }) {
  const { store, commerce } = useAdmin();
  const [key, setKey] = useState(NOTIFICATION_KEYS[0]);
  const n = c.settings.notifications, t = n.templates[key], prov = c.settings.integrations.email.provider;
  const sample = commerce.orders.filter(o => !o.draft).slice(-1)[0] || { name: '#1001', createdAt: new Date().toISOString(), customerId: null, email: 'customer@example.com', shippingAddress: { name: 'Alex Doe' }, paymentMethod: '',
    lines: [{ title: s.products[0]?.title || 'Product', variantTitle: '', quantity: 1, price: s.products[0]?.price || 25 }], totals: { total: s.products[0]?.price || 25 }, fulfillments: [{ carrier: 'UPS', trackingNumber: '1Z999AA10123456784', trackingUrl: 'https://www.ups.com/track' }], refunds: [{ amount: 10 }] };
  const vars = orderVars(store, { ...commerce, settings: c.settings }, sample);
  const T = (k2, v) => edit((_, x) => { x.settings.notifications.templates[key][k2] = v; });
  return <>
    <Section id="sender" title="Sender" desc="Who customer emails come from.">
      <Row label="Email delivery" sub={prov === 'none' ? 'Emails open in your own email app, sent from your account.' : 'Sent automatically by your backend.'} value={prov === 'none' ? 'Your mail app' : prov[0].toUpperCase() + prov.slice(1)} onClick={() => open('apps', 'app-email')} />
      <div className="csPad"><div className="caForm two">
        <Text label="Sender name" value={n.senderName} onChange={v => edit((_, x) => { x.settings.notifications.senderName = v; })} placeholder={s.name} />
        <Text label="Sender email" type="email" value={n.senderEmail} onChange={v => edit((_, x) => { x.settings.notifications.senderEmail = v; })} />
      </div></div>
    </Section>
    <Section id="customer-notifications" title="Customer notifications" desc="Templates for the emails customers receive.">
      <div className="csPad"><div className="caNotify">
        <ul className="caNotifyList" role="tablist" aria-label="Notification templates">{NOTIFICATION_KEYS.map(k => <li key={k}><button type="button" role="tab" aria-selected={key === k} className={key === k ? 'on' : ''} onClick={() => setKey(k)}>{NOTIFICATION_LABELS[k]}</button></li>)}</ul>
        <div className="caNotifyEdit" role="tabpanel" aria-label={NOTIFICATION_LABELS[key]}>
          <Text label="Email subject" value={t.subject} onChange={v => T('subject', v)} />
          <Area label="Email body" value={t.body} rows={10} onChange={v => T('body', v)} />
          <div className="caVars" aria-label="Variables">{NOTIFICATION_VARIABLES.map(v => <button key={v} type="button" className="caChip" onClick={() => T('body', t.body + '{{' + v + '}}')} aria-label={`Insert variable ${v}`}>{'{{' + v + '}}'}</button>)}</div>
          <div className="caInline"><Btn kind="plain" icon={RotateCcw} onClick={() => edit((_, x) => { x.settings.notifications.templates[key] = { ...DEFAULT_NOTIFICATIONS[key] }; })}>Reset to default</Btn></div>
          <h3 className="caSub">Preview</h3>
          <div className="caMailPreview" aria-label="Email preview"><strong>{fillTemplate(t.subject, vars)}</strong><pre>{fillTemplate(t.body, vars)}</pre></div>
        </div>
      </div></div>
    </Section>
  </>;
}

export function Policies({ s, c, edit }) {
  const { commerce } = useAdmin();
  return <>{POLICY_KEYS.map(k => { const p = c.settings.policies[k], tpl = POLICY_TEMPLATES[k], P = fn => edit((_, x) => fn(x.settings.policies[k]));
    return <Section key={k} id={'policy-' + k} title={p.title} desc={p.body ? `${p.body.split(/\s+/).length} words` : 'Not written yet'}>
      <div className="csPad">
        <details className="caDetails"><summary>Template details</summary>
          <div className="caForm two">{tpl.fields.map(([f, label, def]) => <Text key={f} label={label} value={p.values[f] ?? ''} placeholder={def} onChange={v => P(x => { x.values[f] = v; })} />)}</div>
          <Btn icon={RotateCcw} onClick={() => P(x => { x.body = policyText(k, x, s, { ...commerce, settings: c.settings }); })}>{p.body ? 'Regenerate from template' : 'Create from template'}</Btn>
        </details>
        <Text label={`${tpl.title} title`} value={p.title} onChange={v => P(x => { x.title = v; })} />
        <Area label={`${tpl.title} text`} value={p.body} rows={p.body ? 12 : 3} placeholder="Create from the template, then edit the text." onChange={v => P(x => { x.body = v; })} />
      </div>
    </Section>; })}</>;
}

