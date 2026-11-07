// Analytics from local data: orders (manual, preview, imported) and storefront events recorded by "View store".
// A static exported store cannot report back without a backend; the "Connect a backend" card explains the options.
import React, { useMemo, useState } from 'react';
import { Server, Trash2, Upload } from 'lucide-react';
import { useAdmin, Page, Card, Btn, Text, Area, AreaChart, BarList, Segmented, Empty, fmtDate, pct, Check } from './ui.jsx';
import { aggregateAnalytics, presetRange } from './analytics.js';

const PRESETS = [['today', 'Today'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['90d', 'Last 90 days'], ['12m', 'Last 12 months'], ['custom', 'Custom']];

export default function Analytics() {
  const { commerce, fmt, editCommerce, confirm, go } = useAdmin();
  const tz = -new Date().getTimezoneOffset();
  const [preset, setPreset] = useState('30d');
  const [custom, setCustom] = useState(() => presetRange('30d', Date.now(), tz));
  const range = preset === 'custom' ? custom : presetRange(preset, Date.now(), tz);
  const valid = range.from && range.to && range.from <= range.to;
  const a = useMemo(() => valid ? aggregateAnalytics(commerce, { ...range, tz }) : null, [commerce, range.from, range.to, valid]); // eslint-disable-line react-hooks/exhaustive-deps
  const [compare, setCompare] = useState(false);
  const prev = useMemo(() => {
    if (!valid || !compare) return null;
    const span = a.days.length, start = Date.parse(range.from + 'T00:00:00Z') - span * 86400000;
    const from = new Date(start).toISOString().slice(0, 10), to = new Date(Date.parse(range.from + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
    return aggregateAnalytics(commerce, { from, to, tz });
  }, [commerce, compare, valid, range.from, a]); // eslint-disable-line react-hooks/exhaustive-deps
  const pts = key => a.days.map(d => ({ label: fmtDate(d.date + 'T12:00:00'), short: d.date.slice(5), value: key === 'aov' ? (d.orders ? d.sales / d.orders : 0) : d[key] }));
  const hasData = a && (a.totals.orders > 0 || a.totals.sessions > 0);
  const b = commerce.settings.backend;

  return <Page title="Analytics" subtitle={valid ? `${fmtDate(range.from + 'T12:00:00')} – ${fmtDate(range.to + 'T12:00:00')}` : 'Choose a valid date range'}
    actions={<div className="caRange">
      <select className="caInput" aria-label="Date range" value={preset} onChange={e => setPreset(e.target.value)}>{PRESETS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      {preset === 'custom' && <><input className="caInput" type="date" aria-label="From date" value={custom.from} max={custom.to} onChange={e => setCustom({ ...custom, from: e.target.value })} />
        <input className="caInput" type="date" aria-label="To date" value={custom.to} min={custom.from} onChange={e => setCustom({ ...custom, to: e.target.value })} /></>}
      <Check label="Compare to previous period" checked={compare} onChange={setCompare} />
    </div>}>
    {!valid ? <Card><p className="caWarn">The start date must be on or before the end date.</p></Card> : <>
      <div className="caKpis">
        {[['Total sales', fmt(a.totals.sales), prev && fmt(prev.totals.sales)], ['Orders', String(a.totals.orders), prev && String(prev.totals.orders)], ['Average order value', fmt(a.totals.aov), prev && fmt(prev.totals.aov)],
          ['Sessions', String(a.totals.sessions), prev && String(prev.totals.sessions)], ['Conversion rate', a.totals.sessions ? pct(a.totals.conversion) : '—', prev && (prev.totals.sessions ? pct(prev.totals.conversion) : '—')], ['Units sold', String(a.totals.unitsSold), prev && String(prev.totals.unitsSold)]]
          .map(([l, v, p]) => <div key={l} className="caKpi" role="group" aria-label={l}><span className="caKpiLabel">{l}</span><strong className="caKpiValue">{v}</strong>{p != null && <span className="caKpiChange">Previous period: {p}</span>}</div>)}
      </div>
      {!hasData && <Card><Empty art="analytics" title="No data for this period yet" action={<Btn onClick={() => go({ page: 'order-new' })}>Create an order</Btn>}>Shop your store with <strong>View store</strong> (top bar) or create orders, and the numbers show up here.</Empty></Card>}
      <div className="caGrid c2">
        <Card title="Total sales over time"><AreaChart label="Total sales over time" points={pts('sales')} compare={prev ? prev.days.map(d => ({ value: d.sales })) : null} format={(v, axis) => fmt(v, axis)} /></Card>
        <Card title="Sessions over time"><AreaChart label="Sessions over time" points={pts('sessions')} compare={prev ? prev.days.map(d => ({ value: d.sessions })) : null} format={v => String(Math.round(v * 10) / 10)} /></Card>
        <Card title="Average order value over time"><AreaChart label="Average order value over time" points={pts('aov')} format={(v, axis) => fmt(v, axis)} /></Card>
        <Card title="Conversion funnel">
          <ol className="caFunnel" aria-label="Conversion funnel">{a.funnel.map((f, i) => <li key={f.key}>
            <div className="caFunnelBar" style={{ height: `${Math.max(4, (a.funnel[0].count ? f.count / a.funnel[0].count : 0) * 100)}%` }} />
            <strong>{f.count}</strong><span>{f.label}</span><small>{!a.funnel[0].count ? '—' : i === 0 ? '100%' : pct(f.rate)}</small></li>)}</ol>
          <p className="caHint">Sessions come from “View store” visits. Orders created manually have no session, so they count in sales but not in the funnel.</p>
        </Card>
        <Card title="Top products by sales">{a.topProducts.length ? <BarList label="Top products by sales" items={a.topProducts.map(t => ({ key: t.productId || t.title, label: `${t.title} · ${t.quantity} sold`, value: t.sales }))} format={v => fmt(v)} /> : <p className="caMuted">No sales in this period.</p>}</Card>
        <Card title="Orders by source"><BarList label="Orders by source" items={[['manual', 'Created in admin'], ['preview', 'Store preview'], ['import', 'Imported from backend']].map(([k, l]) => ({ key: k, label: l, value: a.sources[k] || 0 }))} /></Card>
      </div>
    </>}
    <Card title={<span className="caRow"><Server size={16} aria-hidden="true" />Connect a backend to collect live orders</span>} className="caBackendCard">
      <p className="caText">Your exported store is a set of static files. A static site cannot write anything back into Zertake, so real visitors and real orders from your published store <strong>are not reported here</strong> unless you connect a backend. What you see above comes from orders created in this admin, orders imported from a backend, and test shopping in <strong>View store</strong>.</p>
      <ul className="caList">
        <li><strong>Form or webhook endpoint:</strong> a form service (Formspree, Basin, Getform), a serverless function (Netlify / Vercel / Cloudflare Workers) or an automation webhook (Zapier, Make, n8n) that accepts a POST with the order JSON.</li>
        <li><strong>Payment provider:</strong> payment links (Stripe, PayPal, Square) record paid orders in the provider’s dashboard; export them and import them here.</li>
        <li><strong>Analytics:</strong> a privacy-friendly analytics service (Plausible, Umami, GoatCounter) added to your host gives you live visitor numbers.</li>
      </ul>
      <div className="caForm two">
        <Text label="Order webhook URL" type="url" value={b.orderWebhookUrl} placeholder="https://example.com/orders" onChange={v => editCommerce(d => { d.settings.backend.orderWebhookUrl = v.trim(); }, 'Order webhook URL')}
          hint={'Storefronts that support it POST { type: "order", storeId, createdAt, currency, customer, lines, subtotal, note } here as JSON.'} />
        <Text label="Events webhook URL (optional)" type="url" value={b.eventsWebhookUrl} placeholder="https://example.com/events" onChange={v => editCommerce(d => { d.settings.backend.eventsWebhookUrl = v.trim(); }, 'Events webhook URL')} hint="Receives { type: &quot;event&quot;, storeId, event }." />
      </div>
      <Area label="Backend notes" value={b.notes} rows={2} onChange={v => editCommerce(d => { d.settings.backend.notes = v; }, 'Backend notes')} />
      <div className="caInline"><Btn icon={Upload} onClick={() => go('orders')}>Import collected orders (Orders › Import orders)</Btn>
        <Btn kind="danger" icon={Trash2} disabled={!commerce.analytics.events.length} onClick={async () => { if (await confirm({ title: 'Clear storefront events?', message: `Deletes ${commerce.analytics.events.length} recorded visits and cart events. Orders are kept.`, confirmLabel: 'Clear events', danger: true })) editCommerce(d => { d.analytics.events = []; }, 'Analytics events cleared'); }}>Clear storefront events</Btn></div>
    </Card>
  </Page>;
}
