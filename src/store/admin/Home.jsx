// Commerce Home (bento dashboard): greeting hero with today's sales, KPI tiles with sparklines, sales chart, recent orders,
// setup checklist with a progress gauge, inventory alerts, staff notes and tips.
import React, { useMemo, useState } from 'react';
import { Check, ChevronRight, Package, Paintbrush, Truck, CreditCard, Globe, Rocket, TriangleAlert, Lightbulb, Trash2, X, ExternalLink, Plus, DollarSign, ShoppingBag, Receipt, MousePointerClick, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { useAdmin, Card, Badge, Btn, Sparkline, AreaChart, Empty, fmtDate, pct, FIN, FUL, Thumb, BigNum, Gauge } from './ui.jsx';
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
  const { store, commerce, fmt, go, editCommerce, notify, assetStore, customize, viewStore } = useAdmin();
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
  const kpi = (label, value, series, change, Icon, hot) => <div className={'caKpi' + (hot ? ' hot' : '')} role="group" aria-label={label}>
    <div className="caKpiTop"><span className="caKpiLabel">{label}</span><span className="caKpiIcon" aria-hidden="true"><Icon size={15} /></span></div>
    <strong className="caKpiValue"><BigNum value={value} /></strong>
    {change != null ? <span className={'caKpiChange ' + (change >= 0 ? 'up' : 'down')}><b>{change >= 0 ? <ArrowUpRight size={12} aria-hidden="true" /> : <ArrowDownRight size={12} aria-hidden="true" />}{Math.abs(Math.round(change * 100))}%</b> vs previous 30 days</span>
      : <span className="caKpiChange">Last 30 days</span>}
    <Sparkline values={series} label={label + ' trend'} />
  </div>;
  const delta = (cur, prev) => prev > 0 ? (cur - prev) / prev : null;
  const greeting = (() => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; })();
  const today = a.days[a.days.length - 1] || { sales: 0, orders: 0, sessions: 0 }, yesterday = a.days[a.days.length - 2] || { sales: 0 };
  const last14 = a.days.slice(-14), max14 = Math.max(1e-9, ...last14.map(d => d.sales)), peak = last14.reduce((b, d, i) => d.sales > (last14[b]?.sales ?? -1) ? i : b, last14.length - 1);
  const todayDelta = delta(today.sales, yesterday.sales);
  const name = o => customerName(commerce.customers.find(c => c.id === o.customerId)) || o.email || 'Guest';

  return <div className="caPage caHome">
    <div className="caColMain">
      <section className="caHero" aria-label="Store overview">
        <div className="caHeroMain">
          <span className="caHeroTag"><i aria-hidden="true" />{store.name} · last 30 days</span>
          <h1>{greeting}</h1>
          <p>Here is what is happening with {store.name} in the last 30 days.</p>
          <div className="caHeroCtas">
            <button type="button" className="caPill" onClick={viewStore}><ExternalLink size={14} aria-hidden="true" />View store</button>
            <button type="button" className="caPill" onClick={() => go({ page: 'product', id: 'new' })}><Plus size={14} aria-hidden="true" />Add product</button>
            <button type="button" className="caPill ghost" onClick={() => { if (!steps.theme) toggle('theme', true); customize(); }}><Paintbrush size={14} aria-hidden="true" />Customize</button>
          </div>
        </div>
        <div className="caGlass">
          <div className="caGlassHead"><span>Sales today</span>{todayDelta != null && <b className={todayDelta >= 0 ? 'up' : 'down'}>{todayDelta >= 0 ? '+' : '−'}{Math.abs(Math.round(todayDelta * 100))}%</b>}</div>
          <strong className="caGlassValue"><BigNum value={fmt(today.sales)} /></strong>
          <small>{today.orders} {today.orders === 1 ? 'order' : 'orders'} · {today.sessions} {today.sessions === 1 ? 'visit' : 'visits'}</small>
          <div className="caMiniBars" aria-hidden="true">{last14.map((d, i) => <span key={d.date} className={i === peak && d.sales > 0 ? 'peak' : ''} style={{ height: `${Math.max(6, (d.sales / max14) * 100)}%` }}>
            {i === peak && d.sales > 0 && <em>{fmt(d.sales, true)}</em>}</span>)}</div>
        </div>
      </section>

      <div className="caKpis">
        {kpi('Total sales', fmt(a.totals.sales), a.days.map(d => d.sales), delta(a.totals.sales, a.previous.sales), DollarSign, true)}
        {kpi('Orders', String(a.totals.orders), a.days.map(d => d.orders), delta(a.totals.orders, a.previous.orders), ShoppingBag)}
        {kpi('Average order value', fmt(a.totals.aov), a.days.map(d => d.orders ? d.sales / d.orders : 0), null, Receipt)}
        {kpi('Conversion rate', a.totals.sessions ? pct(a.totals.conversion) : '—', a.days.map(d => d.sessions), null, MousePointerClick)}
      </div>

      <Card title="Sales over time" className="caSalesCard" actions={<Btn kind="plain" onClick={() => go('analytics')}>View analytics<ChevronRight size={14} /></Btn>}>
        <div className="caSalesHead"><strong><BigNum value={fmt(a.totals.sales)} /></strong><span className="caMuted">{a.totals.orders} {a.totals.orders === 1 ? 'order' : 'orders'} in the last 30 days</span></div>
        <AreaChart label="Sales over the last 30 days" points={a.days.map(d => ({ label: fmtDate(d.date + 'T12:00:00'), short: d.date.slice(5), value: d.sales }))} format={(v, axis) => fmt(v, axis)} height={170} />
      </Card>

      <Card title="Recent orders" actions={<Btn kind="plain" onClick={() => go('orders')}>All orders<ChevronRight size={14} /></Btn>}>
        {recent.length ? <ul className="caOrderList">{recent.map(o => <li key={o.id}>
          <button type="button" className="caORow" onClick={() => go({ page: 'order', id: o.id })}>
            <span className="caOAvatar" aria-hidden="true">{name(o).trim().charAt(0).toUpperCase() || '#'}</span>
            <span className="caOMain"><strong>{o.name}</strong><small>{name(o)} · {fmtDate(o.createdAt)}</small></span>
            <span className="caOTags"><Badge tone={FIN[o.financialStatus][1]}>{FIN[o.financialStatus][0]}</Badge>{o.status === 'cancelled' ? <Badge tone="bad">Cancelled</Badge> : <Badge tone={FUL[o.fulfillmentStatus][1]}>{FUL[o.fulfillmentStatus][0]}</Badge>}</span>
            <span className="caOTotal"><BigNum value={fmt(o.totals.total)} /></span>
          </button></li>)}</ul>
          : <Empty art="orders" title="No orders yet" action={<Btn kind="primary" onClick={() => go({ page: 'order-new' })}>Create order</Btn>}>Orders placed in the store preview or created by you show up here.</Empty>}
      </Card>
    </div>

    <div className="caColSide">
      {!commerce.onboarding.dismissed && <Card className="caSetup" aria-label="Set up your store" title={<span>Set up your store</span>}
        actions={<button type="button" className="caIconBtn" aria-label="Dismiss setup guide" onClick={() => editCommerce(d => { d.onboarding.dismissed = true; }, 'Setup guide dismissed')}><X size={16} /></button>}>
        <div className="caSetupGauge">
          <Gauge value={done / STEPS.length} label={Math.round((done / STEPS.length) * 100) + '%'} sub="complete" />
          <p className="caMuted">{done} of {STEPS.length} tasks complete</p>
          <div className="caProgress" role="progressbar" aria-label="Setup progress" aria-valuemin={0} aria-valuemax={STEPS.length} aria-valuenow={done}><div style={{ width: `${(done / STEPS.length) * 100}%` }} /></div>
        </div>
        <ol className="caSteps">{STEPS.map(s => { const [k, title, text, Icon, , cta] = s, on = open === k; return <li key={k} className={(steps[k] ? 'done ' : '') + (on ? 'open' : '')}>
          <button type="button" className="caStepDone" aria-label={(steps[k] ? 'Mark as not done: ' : 'Mark as done: ') + title} aria-pressed={!!steps[k]} onClick={() => toggle(k, !steps[k])}>{steps[k] && <Check size={13} />}</button>
          <div className="caStepMain">
            <button type="button" className="caStepTitle" aria-expanded={on} onClick={() => setOpen(on ? null : k)}>{title}</button>
            {on && <div className="caStepBody"><p>{text}</p><Btn kind="primary" icon={Icon} onClick={() => runStep(s)}>{cta}</Btn></div>}
          </div>
        </li>; })}</ol>
      </Card>}
      <Card title="Inventory alerts" actions={<Btn kind="plain" onClick={() => go('inventory')}>Inventory<ChevronRight size={14} /></Btn>}>
        {low.length ? <ul className="caAlerts">{low.map(r => <li key={r.variant.id}><Thumb src={r.product.images[0] || r.product.art} fallback={r.product.art} size={36} />
          <button type="button" className="caLink" onClick={() => go({ page: 'product', id: r.product.id })}>{r.product.title}{r.variant.options.length ? ' · ' + r.variant.options.join(' / ') : ''}</button>
          <Badge tone={r.out ? 'bad' : 'warn'}>{r.out ? 'Out of stock' : r.stock + ' left'}</Badge></li>)}</ul>
          : <p className="caMuted caRow"><Check size={14} /> No low-stock items (threshold {commerce.settings.general.lowStockThreshold}).</p>}
        {low.length > 0 && <p className="caHint"><TriangleAlert size={12} /> Items at or below {commerce.settings.general.lowStockThreshold} units.</p>}
      </Card>
      <StaffNotes />
      <Card title="Tips" className="caTipsCard">
        <ul className="caTips">
          <li><Lightbulb size={14} aria-hidden="true" /><span>Create a <button type="button" className="caLink" onClick={() => go({ page: 'discount', id: 'new' })}>welcome discount code</button> and share it on social media with a tracked link from <button type="button" className="caLink" onClick={() => go('marketing')}>Marketing</button>.</span></li>
          <li><Lightbulb size={14} aria-hidden="true" /><span>Add cost per item to your products to see margin and profit.</span></li>
          <li><Lightbulb size={14} aria-hidden="true" /><span>Use <strong>View store</strong> to shop your store like a customer: visits, carts and orders appear in Analytics.</span></li>
        </ul>
      </Card>
    </div>
  </div>;
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
