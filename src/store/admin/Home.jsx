// Commerce Home: setup checklist, KPI cards with sparklines, sales chart, recent orders, low stock, staff notes, tips.
import React, { useMemo, useState } from 'react';
import { Check, ChevronRight, Package, Paintbrush, Truck, CreditCard, Globe, Rocket, TriangleAlert, Lightbulb, Trash2, X } from 'lucide-react';
import { useAdmin, Page, Card, Badge, Btn, Sparkline, AreaChart, Empty, fmtDate, pct, FIN, FUL, Thumb } from './ui.jsx';
import { aggregateAnalytics, presetRange } from './analytics.js';
import { stockRows } from './inventory.js';
import { customerName, cid } from './model.js';
import { exportStoreZip } from '../exporter.js';
import { slugify } from '../model.js';

const STEPS = [
  ['product', 'Add or review your products', 'Give every product a title, photos, a price and stock.', Package, { page: 'products' }, 'Go to products'],
  ['theme', 'Customize your theme', 'Pick a template, set colours and fonts and arrange your pages.', Paintbrush, { page: 'themes' }, 'Customize theme'],
  ['shipping', 'Set up shipping', 'Create shipping zones and rates for where you deliver.', Truck, { page: 'settings', tab: 'shipping' }, 'Set up shipping'],
  ['payments', 'Set up payments and checkout', 'Choose how customers order: WhatsApp, email or payment links, plus manual payment methods.', CreditCard, { page: 'settings', tab: 'payments' }, 'Set up payments'],
  ['domain', 'Add a domain', 'Read how to point your own domain at the exported store on your host.', Globe, { page: 'settings', tab: 'domains' }, 'Domain instructions'],
  ['launch', 'Launch your store', 'Export the store as a ZIP and upload it to Netlify, GitHub Pages or any static host.', Rocket, null, 'Export store'],
];

export default function Home() {
  const { store, commerce, fmt, go, editCommerce, notify, assetStore, customize } = useAdmin();
  const tz = -new Date().getTimezoneOffset();
  const range = presetRange('30d', Date.now(), tz);
  const a = useMemo(() => aggregateAnalytics(commerce, { ...range, tz }), [commerce, range.from, range.to]); // eslint-disable-line react-hooks/exhaustive-deps
  const steps = commerce.onboarding.steps, done = Object.values(steps).filter(Boolean).length;
  const [open, setOpen] = useState(() => STEPS.find(s => !steps[s[0]])?.[0] || null);
  const low = stockRows(store, commerce).filter(r => r.low || r.out).slice(0, 6);
  const recent = commerce.orders.filter(o => !o.draft).slice().sort((x, y) => y.createdAt.localeCompare(x.createdAt)).slice(0, 6);
  const toggle = (k, v) => editCommerce(d => { d.onboarding.steps[k] = v; }, v ? 'Step completed' : 'Step re-opened');
  const exportZip = async () => {
    try {
      notify('Building the store…');
      const zip = await exportStoreZip(store, { loadAsset: assetStore ? id => assetStore.get(id) : undefined, commerce });
      const el = document.createElement('a'); el.href = URL.createObjectURL(new Blob([zip], { type: 'application/zip' })); el.download = slugify(store.name) + '-store.zip';
      document.body.appendChild(el); el.click(); el.remove(); setTimeout(() => URL.revokeObjectURL(el.href), 10000);
      editCommerce(d => { d.onboarding.steps.launch = true; }, 'Store exported');
      notify('Store exported as a ZIP. Upload the unzipped folder to your static host.');
    } catch (err) { notify('Export failed: ' + err.message); }
  };
  const runStep = s => { if (s[0] === 'launch') exportZip(); else if (s[0] === 'theme') { toggle('theme', true); customize(); } else go(s[4]); };
  const kpi = (label, value, series, change) => <div className="caKpi" role="group" aria-label={label}>
    <span className="caKpiLabel">{label}</span><strong className="caKpiValue">{value}</strong>
    {change != null && <span className={'caKpiChange ' + (change >= 0 ? 'up' : 'down')}>{change >= 0 ? '▲' : '▼'} {Math.abs(Math.round(change * 100))}% vs previous 30 days</span>}
    <Sparkline values={series} label={label + ' trend'} />
  </div>;
  const delta = (cur, prev) => prev > 0 ? (cur - prev) / prev : null;
  const greeting = (() => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; })();

  return <Page title={greeting} subtitle={`Here is what is happening with ${store.name} in the last 30 days.`}>
    {!commerce.onboarding.dismissed && <Card className="caSetup" title={<span>Set up your store <small className="caMuted">{done} of {STEPS.length} tasks complete</small></span>}
      actions={<button type="button" className="caIconBtn" aria-label="Dismiss setup guide" onClick={() => editCommerce(d => { d.onboarding.dismissed = true; }, 'Setup guide dismissed')}><X size={16} /></button>}>
      <div className="caProgress" role="progressbar" aria-label="Setup progress" aria-valuemin={0} aria-valuemax={STEPS.length} aria-valuenow={done}><div style={{ width: `${(done / STEPS.length) * 100}%` }} /></div>
      <ol className="caSteps">{STEPS.map(s => { const [k, title, text, Icon, , cta] = s, on = open === k; return <li key={k} className={(steps[k] ? 'done ' : '') + (on ? 'open' : '')}>
        <button type="button" className="caStepDone" aria-label={(steps[k] ? 'Mark as not done: ' : 'Mark as done: ') + title} aria-pressed={!!steps[k]} onClick={() => toggle(k, !steps[k])}>{steps[k] && <Check size={13} />}</button>
        <div className="caStepMain">
          <button type="button" className="caStepTitle" aria-expanded={on} onClick={() => setOpen(on ? null : k)}>{title}</button>
          {on && <div className="caStepBody"><p>{text}</p><Btn kind="primary" icon={Icon} onClick={() => runStep(s)}>{cta}</Btn></div>}
        </div>
      </li>; })}</ol>
    </Card>}

    <div className="caKpis">
      {kpi('Total sales', fmt(a.totals.sales), a.days.map(d => d.sales), delta(a.totals.sales, a.previous.sales))}
      {kpi('Orders', String(a.totals.orders), a.days.map(d => d.orders), delta(a.totals.orders, a.previous.orders))}
      {kpi('Average order value', fmt(a.totals.aov), a.days.map(d => d.orders ? d.sales / d.orders : 0))}
      {kpi('Conversion rate', a.totals.sessions ? pct(a.totals.conversion) : '—', a.days.map(d => d.sessions))}
    </div>

    <div className="caCols">
      <div className="caColMain">
        <Card title="Sales over time" actions={<Btn kind="plain" onClick={() => go('analytics')}>View analytics<ChevronRight size={14} /></Btn>}>
          <AreaChart label="Sales over the last 30 days" points={a.days.map(d => ({ label: fmtDate(d.date + 'T12:00:00'), short: d.date.slice(5), value: d.sales }))} format={(v, axis) => fmt(v, axis)} height={200} />
        </Card>
        <Card title="Recent orders" actions={<Btn kind="plain" onClick={() => go('orders')}>All orders<ChevronRight size={14} /></Btn>} pad={false}>
          {recent.length ? <table className="caTable"><thead><tr><th>Order</th><th>Date</th><th>Customer</th><th>Payment</th><th>Fulfillment</th><th className="n">Total</th></tr></thead>
            <tbody>{recent.map(o => <tr key={o.id} className="click" onClick={() => go({ page: 'order', id: o.id })}>
              <td><button type="button" className="caLink" onClick={e => { e.stopPropagation(); go({ page: 'order', id: o.id }); }}>{o.name}</button></td><td>{fmtDate(o.createdAt)}</td>
              <td>{customerName(commerce.customers.find(c => c.id === o.customerId)) || o.email || '—'}</td>
              <td><Badge tone={FIN[o.financialStatus][1]}>{FIN[o.financialStatus][0]}</Badge></td><td>{o.status === 'cancelled' ? <Badge>Cancelled</Badge> : <Badge tone={FUL[o.fulfillmentStatus][1]}>{FUL[o.fulfillmentStatus][0]}</Badge>}</td>
              <td className="n">{fmt(o.totals.total)}</td></tr>)}</tbody></table>
            : <Empty art="orders" title="No orders yet" action={<Btn kind="primary" onClick={() => go({ page: 'order-new' })}>Create order</Btn>}>Orders placed in the store preview or created by you show up here.</Empty>}
        </Card>
      </div>
      <div className="caColSide">
        <Card title="Inventory alerts" actions={<Btn kind="plain" onClick={() => go('inventory')}>Inventory</Btn>}>
          {low.length ? <ul className="caAlerts">{low.map(r => <li key={r.variant.id}><Thumb src={r.product.images[0] || r.product.art} fallback={r.product.art} size={32} />
            <button type="button" className="caLink" onClick={() => go({ page: 'product', id: r.product.id })}>{r.product.title}{r.variant.options.length ? ' · ' + r.variant.options.join(' / ') : ''}</button>
            <Badge tone={r.out ? 'bad' : 'warn'}>{r.out ? 'Out of stock' : r.stock + ' left'}</Badge></li>)}</ul>
            : <p className="caMuted caRow"><Check size={14} /> No low-stock items (threshold {commerce.settings.general.lowStockThreshold}).</p>}
          {low.length > 0 && <p className="caHint"><TriangleAlert size={12} /> Items at or below {commerce.settings.general.lowStockThreshold} units.</p>}
        </Card>
        <StaffNotes />
        <Card title="Tips">
          <ul className="caTips">
            <li><Lightbulb size={14} aria-hidden="true" /><span>Create a <button type="button" className="caLink" onClick={() => go({ page: 'discount', id: 'new' })}>welcome discount code</button> and share it on social media with a tracked link from <button type="button" className="caLink" onClick={() => go('marketing')}>Marketing</button>.</span></li>
            <li><Lightbulb size={14} aria-hidden="true" /><span>Add cost per item to your products to see margin and profit.</span></li>
            <li><Lightbulb size={14} aria-hidden="true" /><span>Use <strong>View store</strong> to shop your store like a customer: visits, carts and orders appear in Analytics.</span></li>
          </ul>
        </Card>
      </div>
    </div>
  </Page>;
}

function StaffNotes() {
  const { commerce, editCommerce, confirm } = useAdmin();
  const [text, setText] = useState('');
  const add = e => { e.preventDefault(); if (!text.trim()) return; editCommerce(d => { d.staffNotes.unshift({ id: cid('sn'), at: new Date().toISOString(), author: '', text: text.trim() }); }, 'Note added'); setText(''); };
  return <Card title="Staff notes">
    <form className="caInline" onSubmit={add}><input className="caInput" aria-label="New staff note" placeholder="Write a note for your team…" value={text} onChange={e => setText(e.target.value)} /><Btn type="submit">Add</Btn></form>
    {commerce.staffNotes.length ? <ul className="caNotes">{commerce.staffNotes.slice(0, 8).map(n => <li key={n.id}><p>{n.text}</p><small>{fmtDate(n.at, true)}</small>
      <button type="button" className="caIconBtn sm" aria-label="Delete note" onClick={async () => { if (await confirm({ title: 'Delete note?', message: n.text, confirmLabel: 'Delete', danger: true })) editCommerce(d => { d.staffNotes = d.staffNotes.filter(x => x.id !== n.id); }, 'Note deleted'); }}><Trash2 size={13} /></button></li>)}</ul>
      : <p className="caMuted">Notes are kept with the store data.</p>}
  </Card>;
}
