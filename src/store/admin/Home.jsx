// Commerce Dashboard: greeting + period controls (preset, "Add widget", CSV export), the automatic setup guide, KPI cards,
// total sales with the previous period and customer segments, most active weekday, repeat-customer gauge, best sellers,
// recent orders, inventory alerts and staff notes. Widgets can be hidden/shown (saved per device in localStorage).
import React, { useMemo, useState } from 'react';
import { Check, ChevronRight, Package, Paintbrush, Truck, CreditCard, Globe, Rocket, TriangleAlert, Trash2, X, Download, LayoutGrid, CalendarDays, Eye, Users, MousePointerClick, ShoppingBag, ArrowUp, ArrowDown, Star, Plus } from 'lucide-react';
import { useAdmin, Card, Badge, Btn, AreaChart, Empty, fmtDate, pct, FIN, FUL, Thumb, BigNum, Modal, download } from './ui.jsx';
import { aggregateAnalytics } from './analytics.js';
import { stockRows, productStock } from './inventory.js';
import { customerName, cid } from './model.js';
import { setupProgress, SETUP_STEPS } from './setup.js';
import { DASH_PRESETS, WEEKDAYS, dashRange, previousRange, fmtDay, change, weekdayActivity, customerSegments, repeatRate, grossProfit, dashboardCsv } from './dashboard.js';
import { exportStoreZip } from '../exporter.js';
import { slugify } from '../model.js';

const STEP_INFO = {
  product: ['Add your products', 'An active product with a title, a price and a photo — save one in the product editor or upload your own image.', Package, 'Add product'],
  theme: ['Customize your theme', 'Open the store builder to set colours, fonts and arrange your pages.', Paintbrush, 'Customize theme'],
  shipping: ['Set up shipping', 'Review the shipping zones and rates for where you deliver and save them.', Truck, 'Set up shipping'],
  payments: ['Set up checkout', 'Add your WhatsApp number, order email or payment links so customers can buy.', CreditCard, 'Set up payments'],
  domain: ['Add a domain', 'Enter the domain you will point at the exported store.', Globe, 'Add domain'],
  launch: ['Launch your store', 'Export the store as a ZIP and upload it to any static host.', Rocket, 'Export store'],
};
const WIDGETS = [['setup', 'Setup guide'], ['kpis', 'Key metrics'], ['sales', 'Total sales'], ['activeDay', 'Most active day'], ['repeat', 'Repeat customer rate'], ['best', 'Best selling products'], ['recent', 'Recent orders'], ['inventory', 'Inventory alerts'], ['notes', 'Staff notes']];
const WKEY = 'zertake.dashboardWidgets', PKEY = 'zertake.dashboardPeriod';
const loadHidden = () => { try { const v = JSON.parse(localStorage.getItem(WKEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
const loadPeriod = () => { try { const v = localStorage.getItem(PKEY); return DASH_PRESETS.some(p => p[0] === v) ? v : '30d'; } catch { return '30d'; } };
const save = (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } };
const num = n => new Intl.NumberFormat('en-US').format(Math.round(n));

function Delta({ cur, prev }) {
  const c = change(cur, prev);
  if (c == null) return <span className={'caDelta ' + (cur > 0 ? 'up' : 'flat')}>{cur > 0 ? 'New' : '0%'}</span>;
  const tone = c > 0.0005 ? 'up' : c < -0.0005 ? 'down' : 'flat';
  return <span className={'caDelta ' + tone}>{tone === 'up' ? <ArrowUp size={11} aria-hidden="true" /> : tone === 'down' ? <ArrowDown size={11} aria-hidden="true" /> : null}{(Math.abs(c) * 100).toFixed(1)}%</span>;
}

function Kpi({ label, icon: Icon, value, cur, prev, prevText }) {
  return <div className="caKpi" role="group" aria-label={label}>
    <div className="caKpiTop"><span className="caKpiLabel">{label}</span><span className="caKpiIcon" aria-hidden="true"><Icon size={16} /></span></div>
    <strong className="caKpiValue"><BigNum value={value} /></strong>
    <div className="caKpiFoot"><Delta cur={cur} prev={prev} /><span>vs. {prevText} last period</span></div>
  </div>;
}

/** Radial gauge of many small ticks (decorative; the numbers are in the text next to it). */
function TickGauge({ value }) {
  const N = 52, on = Math.round(Math.max(0, Math.min(1, value)) * N), a0 = Math.PI * 0.75, sweep = Math.PI * 1.5;
  return <svg className="caTickGauge" viewBox="0 0 200 172" aria-hidden="true">
    {Array.from({ length: N }, (_, i) => { const a = a0 + sweep * (i / (N - 1)), c = Math.cos(a), s = Math.sin(a);
      return <line key={i} x1={100 + 70 * c} y1={96 + 70 * s} x2={100 + 88 * c} y2={96 + 88 * s} className={i < on ? 'on' : ''} />; })}
  </svg>;
}

export default function Home() {
  const { store, commerce, fmt, go, editCommerce, notify, assetStore, customize } = useAdmin();
  const tz = -new Date().getTimezoneOffset();
  const [period, setPeriod] = useState(loadPeriod);
  const [hidden, setHidden] = useState(loadHidden);
  const [picking, setPicking] = useState(false);
  const range = dashRange(period, Date.now(), tz), prev = previousRange(range);
  const a = useMemo(() => aggregateAnalytics(commerce, { ...range, tz }), [commerce, range.from, range.to]); // eslint-disable-line react-hooks/exhaustive-deps
  const b = useMemo(() => aggregateAnalytics(commerce, { ...prev, tz }), [commerce, prev.from, prev.to]); // eslint-disable-line react-hooks/exhaustive-deps
  const seg = useMemo(() => customerSegments(commerce, { ...range, tz }), [commerce, range.from, range.to]); // eslint-disable-line react-hooks/exhaustive-deps
  const rep = useMemo(() => repeatRate(commerce), [commerce]);
  const profit = useMemo(() => grossProfit(commerce, { ...range, tz }), [commerce, range.from, range.to]); // eslint-disable-line react-hooks/exhaustive-deps
  const profitPrev = useMemo(() => grossProfit(commerce, { ...prev, tz }), [commerce, prev.from, prev.to]); // eslint-disable-line react-hooks/exhaustive-deps
  const setup = useMemo(() => setupProgress(store, commerce), [store, commerce]);
  const week = weekdayActivity(a.days);
  const show = k => !hidden.includes(k);
  const greeting = (() => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; })();
  const periodLabel = DASH_PRESETS.find(p => p[0] === period)[1].toLowerCase();

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
  const runStep = k => ({
    product: () => go({ page: 'product', id: 'new' }), theme: customize, shipping: () => go({ page: 'settings', tab: 'shipping' }),
    payments: () => go({ page: 'settings', tab: 'payments' }), domain: () => go({ page: 'settings', tab: 'domains' }), launch: exportZip,
  }[k])();

  const metrics = [
    ['Total sales', a.totals.sales, b.totals.sales], ['Orders', a.totals.orders, b.totals.orders], ['Average order value', a.totals.aov, b.totals.aov],
    ['Store visits', a.totals.visits, b.totals.visits], ['Visitors', a.totals.sessions, b.totals.sessions], ['Add to carts', a.days.reduce((s, d) => s + d.addToCart, 0), b.days.reduce((s, d) => s + d.addToCart, 0)],
    ['Conversion rate %', +(a.totals.conversion * 100).toFixed(2), +(b.totals.conversion * 100).toFixed(2)], ['Units sold', a.totals.unitsSold, b.totals.unitsSold],
    ...(profit.costed ? [['Gross profit', profit.profit, profitPrev.profit]] : []),
  ];
  const exportCsv = () => { download(`${slugify(store.name)}-dashboard-${range.from}-to-${range.to}.csv`, dashboardCsv({ range, prev, metrics, days: a.days }), 'text/csv'); notify('Dashboard exported as CSV'); };
  const setP = v => { setPeriod(v); save(PKEY, v); };
  const toggleWidget = (k, on) => setHidden(h => { const n = on ? h.filter(x => x !== k) : [...new Set([...h, k])]; save(WKEY, JSON.stringify(n)); return n; });

  const salesPts = a.days.map(d => ({ label: fmtDate(d.date + 'T12:00:00'), short: fmtDay(d.date).replace(/, \d{4}$/, ''), value: d.sales }));
  const cmpPts = b.days.slice(-a.days.length).map(d => ({ value: d.sales }));
  const best = a.topProducts.slice(0, 5).map(t => ({ ...t, product: store.products.find(p => p.id === t.productId), before: b.topProducts.find(x => (x.productId || x.title) === (t.productId || t.title))?.sales || 0 }));
  const segMax = Math.max(1, seg.new, seg.returning, seg.vip);

  return <div className="caPage caDash">
    <div className="caDashHead">
      <div className="caDashTitle"><span className="caEyebrow">Dashboard</span><h1>{greeting}, {store.name}</h1><p>Here’s what’s happening with your store in the {periodLabel}.</p></div>
      <div className="caDashTools">
        <span className="caDateChip"><CalendarDays size={15} aria-hidden="true" />{fmtDay(range.from)} – {fmtDay(range.to)}</span>
        <select className="caInput caPeriod" aria-label="Dashboard period" value={period} onChange={e => setP(e.target.value)}>{DASH_PRESETS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <Btn icon={LayoutGrid} onClick={() => setPicking(true)}>Add widget</Btn>
        <Btn kind="primary" icon={Download} onClick={exportCsv}>Export</Btn>
      </div>
    </div>

    {show('setup') && !commerce.onboarding.dismissed && !setup.complete && <section className="caCard caSetup" aria-label="Set up your store">
      <div className="caSetupHead">
        <div className="caSetupIntro">
          <h2>Set up your store</h2>
          <p className="caMuted">{setup.done} of {setup.total} tasks complete · steps tick themselves off as you go</p>
          <div className="caProgress" role="progressbar" aria-label="Setup progress" aria-valuemin={0} aria-valuemax={setup.total} aria-valuenow={setup.done}><div style={{ width: `${(setup.done / setup.total) * 100}%` }} /></div>
        </div>
        <button type="button" className="caIconBtn" aria-label="Dismiss setup guide" onClick={() => editCommerce(d => { d.onboarding.dismissed = true; }, 'Setup guide dismissed')}><X size={16} /></button>
      </div>
      <ol className="caSteps">{SETUP_STEPS.map(k => { const [title, text, Icon, cta] = STEP_INFO[k], done = setup.steps[k]; return <li key={k} className={(done ? 'done' : '') + (setup.next === k ? ' next' : '')}>
        <span className="caStepIcon" aria-hidden="true">{done ? <Check size={14} /> : <Icon size={15} />}</span>
        <div className="caStepMain"><strong>{title}</strong><p>{text}</p></div>
        {done ? <span className="caStepDoneTag">Done</span> : <Btn kind={setup.next === k ? 'primary' : ''} onClick={() => runStep(k)}>{cta}</Btn>}
        <span className="caVh">{done ? 'Completed' : 'Not completed'}</span>
      </li>; })}</ol>
    </section>}

    {show('kpis') && <div className="caKpis">
      <Kpi label="Store visits" icon={Eye} value={num(a.totals.visits)} cur={a.totals.visits} prev={b.totals.visits} prevText={num(b.totals.visits)} />
      <Kpi label="Visitors" icon={Users} value={num(a.totals.sessions)} cur={a.totals.sessions} prev={b.totals.sessions} prevText={num(b.totals.sessions)} />
      <Kpi label="Conversion rate" icon={MousePointerClick} value={a.totals.sessions ? pct(a.totals.conversion) : '—'} cur={a.totals.conversion} prev={b.totals.conversion} prevText={b.totals.sessions ? pct(b.totals.conversion) : '—'} />
      <Kpi label="Orders" icon={ShoppingBag} value={String(a.totals.orders)} cur={a.totals.orders} prev={b.totals.orders} prevText={num(b.totals.orders)} />
    </div>}

    {(show('sales') || show('activeDay') || show('repeat')) && <div className="caDashRow">
      {show('sales') && <Card className="caSalesCard" title={profit.costed ? 'Total sales & profit' : 'Total sales'} actions={<Btn kind="plain" onClick={() => go('analytics')}>View analytics<ChevronRight size={14} /></Btn>}>
        <div className="caSalesTop">
          <div className="caSalesNum" role="group" aria-label="Total sales">
            <strong><BigNum value={fmt(a.totals.sales)} /></strong>
            <div className="caKpiFoot"><Delta cur={a.totals.sales} prev={b.totals.sales} /><span>vs. {fmt(b.totals.sales)} last period</span></div>
          </div>
          <dl className="caSalesStats">
            <div role="group" aria-label="Average order value"><dt>Average order value</dt><dd><BigNum value={fmt(a.totals.aov)} /></dd></div>
            <div><dt>Units sold</dt><dd>{num(a.totals.unitsSold)}</dd></div>
            {profit.costed && <div><dt>Gross profit</dt><dd><BigNum value={fmt(profit.profit)} /></dd></div>}
          </dl>
        </div>
        <div className="caLegend" aria-hidden="true"><span><i className="cur" />This period</span><span><i className="prev" />Previous period</span></div>
        <AreaChart label={`Sales, ${periodLabel}, with the previous period`} points={salesPts} compare={cmpPts} format={(v, axis) => fmt(v, axis)} height={230} />
        <div className="caSegCard" role="group" aria-label="Customers">
          <div className="caSegHead"><strong>Customers</strong><span className="caMuted">{num(seg.total)} ordered in this period</span></div>
          <div className="caSegs">
            {[['New', seg.new, 'blue'], ['Returning', seg.returning, 'green'], ['VIP (3+ orders)', seg.vip, 'amber']].map(([l, v, c]) => <div key={l} className={'caSeg2 ' + c}>
              <span>{l}</span><strong>{num(v)}</strong><i><b style={{ width: `${(v / segMax) * 100}%` }} /></i></div>)}
          </div>
        </div>
      </Card>}
      {(show('activeDay') || show('repeat')) && <div className="caDashSide">
        {show('activeDay') && <Card title="Most active day" className="caDayCard">
          <p className="caMuted caCardSub">{week.max < 0 ? 'No orders or visits in this period yet' : (week.metric === 'orders' ? 'Orders' : 'Visits') + ' by weekday · ' + periodLabel}</p>
          <div className="caDayBars" role="img" aria-label={week.max >= 0 ? `Most ${week.metric} on ${WEEKDAYS[week.max]}: ${week.values[week.max]}` : 'No activity in this period'}>
            {week.values.map((v, i) => { const mx = Math.max(1, ...week.values); return <div key={i} className={'caDayBar' + (i === week.max ? ' on' : '')}>
              <span className="caDayTrack"><span className="caDayFill" style={{ height: `${Math.max(4, (v / mx) * 100)}%` }}>{i === week.max && <em>{num(v)}</em>}</span></span><small>{WEEKDAYS[i]}</small></div>; })}
          </div>
        </Card>}
        {show('repeat') && <Card title="Repeat customer rate" className="caRepeatCard">
          <div className="caRepeat">
            <TickGauge value={rep.rate} />
            <div className="caRepeatText"><strong>{pct(rep.rate)}</strong><span>{rep.repeat} of {rep.customers} customers</span></div>
          </div>
          <div className="caRepeatFoot">
            <span className={rep.rate >= 0.3 ? 'caGood' : 'caMuted'}>{rep.customers === 0 ? 'No customers yet' : rep.rate >= 0.3 ? 'On track for the 30% target' : `${pct(0.3 - rep.rate)} below the 30% target`}</span>
            <Btn kind="plain" onClick={() => go('customers')}>Show details<ChevronRight size={14} /></Btn>
          </div>
        </Card>}
      </div>}
    </div>}

    {(show('best') || show('inventory')) && <div className="caDashRow">
      {show('best') && <Card title="Best selling products" className="caBestCard" pad={false} actions={<Btn kind="plain" onClick={() => go('products')}>All products<ChevronRight size={14} /></Btn>}>
        {best.length ? <div className="caTableWrap"><table className="caTable" aria-label="Best selling products">
          <thead><tr><th>ID</th><th>Name</th><th className="n">Sold</th><th className="n">Revenue</th><th>{best.some(t => t.product?.rating) ? 'Rating' : 'Stock'}</th></tr></thead>
          <tbody>{best.map(t => { const p = t.product, up = t.sales >= t.before, stock = p ? productStock(p) : null; return <tr key={t.productId || t.title} className={p ? 'click' : ''} onClick={() => p && go({ page: 'product', id: p.id })}>
            <td className="caMono">{p?.variants?.[0]?.sku ? p.variants[0].sku.slice(0, 12) : '—'}</td>
            <th scope="row"><span className="caProdCell"><Thumb src={p?.images?.[0] || p?.art} fallback={p?.art} size={34} /><span>{t.title}</span></span></th>
            <td className="n">{num(t.quantity)}</td>
            <td className="n"><span className={'caRev ' + (up ? 'up' : 'down')}>{up ? <ArrowUp size={12} aria-label="up" /> : <ArrowDown size={12} aria-label="down" />}<BigNum value={fmt(t.sales)} /></span></td>
            <td>{best.some(x => x.product?.rating) ? (p?.rating ? <span className="caStars" aria-label={`${p.rating} out of 5`}>{[1, 2, 3, 4, 5].map(i => <Star key={i} size={12} className={i <= Math.round(p.rating) ? 'on' : ''} aria-hidden="true" />)}</span> : '—')
              : stock == null ? <span className="caMuted">Not tracked</span> : <Badge tone={stock <= 0 ? 'bad' : stock <= commerce.settings.general.lowStockThreshold ? 'warn' : 'ok'}>{stock} in stock</Badge>}</td>
          </tr>; })}</tbody></table></div>
          : <Empty art="products" title="No sales in this period" action={<Btn kind="primary" icon={Plus} onClick={() => go({ page: 'order-new' })}>Create order</Btn>}>Products sold in the {periodLabel} are ranked here by revenue.</Empty>}
      </Card>}
      {show('inventory') && <InventoryAlerts />}
    </div>}

    {(show('recent') || show('notes')) && <div className="caDashRow">
      {show('recent') && <RecentOrders />}
      {show('notes') && <StaffNotes />}
    </div>}

    {picking && <Modal title="Dashboard widgets" onClose={() => setPicking(false)} footer={<Btn kind="primary" onClick={() => setPicking(false)}>Done</Btn>}>
      <p className="caMuted">Choose what the dashboard shows. Saved on this device.</p>
      <ul className="caWidgetList">{WIDGETS.map(([k, l]) => <li key={k}><label className="caCheck"><input type="checkbox" checked={show(k)} onChange={e => toggleWidget(k, e.target.checked)} /><span>{l}{k === 'setup' && commerce.onboarding.dismissed ? <small className="caHint">Dismissed — <button type="button" className="caLink" onClick={() => editCommerce(d => { d.onboarding.dismissed = false; }, 'Setup guide restored')}>show again</button></small> : null}</span></label></li>)}</ul>
    </Modal>}
  </div>;
}

function RecentOrders() {
  const { commerce, fmt, go } = useAdmin();
  const recent = commerce.orders.filter(o => !o.draft).slice().sort((x, y) => y.createdAt.localeCompare(x.createdAt)).slice(0, 6);
  const name = o => customerName(commerce.customers.find(c => c.id === o.customerId)) || o.email || 'Guest';
  return <Card title="Recent orders" className="caRecentCard" actions={<Btn kind="plain" onClick={() => go('orders')}>All orders<ChevronRight size={14} /></Btn>}>
    {recent.length ? <ul className="caOrderList">{recent.map(o => <li key={o.id}>
      <button type="button" className="caORow" onClick={() => go({ page: 'order', id: o.id })}>
        <span className="caOAvatar" aria-hidden="true">{name(o).trim().charAt(0).toUpperCase() || '#'}</span>
        <span className="caOMain"><strong>{o.name}</strong><small>{name(o)} · {fmtDate(o.createdAt)}</small></span>
        <span className="caOTags"><Badge tone={FIN[o.financialStatus][1]}>{FIN[o.financialStatus][0]}</Badge>{o.status === 'cancelled' ? <Badge tone="bad">Cancelled</Badge> : <Badge tone={FUL[o.fulfillmentStatus][1]}>{FUL[o.fulfillmentStatus][0]}</Badge>}</span>
        <span className="caOTotal"><BigNum value={fmt(o.totals.total)} /></span>
      </button></li>)}</ul>
      : <Empty art="orders" title="No orders yet" action={<Btn kind="primary" onClick={() => go({ page: 'order-new' })}>Create order</Btn>}>Orders placed in the store preview or created by you show up here.</Empty>}
  </Card>;
}

function InventoryAlerts() {
  const { store, commerce, go } = useAdmin();
  const low = stockRows(store, commerce).filter(r => r.low || r.out).slice(0, 6);
  return <Card title="Inventory alerts" className="caInvCard" actions={<Btn kind="plain" onClick={() => go('inventory')}>Inventory<ChevronRight size={14} /></Btn>}>
    {low.length ? <ul className="caAlerts">{low.map(r => <li key={r.variant.id}><Thumb src={r.product.images[0] || r.product.art} fallback={r.product.art} size={36} />
      <button type="button" className="caLink" onClick={() => go({ page: 'product', id: r.product.id })}>{r.product.title}{r.variant.options.length ? ' · ' + r.variant.options.join(' / ') : ''}</button>
      <Badge tone={r.out ? 'bad' : 'warn'}>{r.out ? 'Out of stock' : r.stock + ' left'}</Badge></li>)}</ul>
      : <p className="caMuted caRow"><Check size={14} /> No low-stock items (threshold {commerce.settings.general.lowStockThreshold}).</p>}
    {low.length > 0 && <p className="caHint"><TriangleAlert size={12} /> Items at or below {commerce.settings.general.lowStockThreshold} units.</p>}
  </Card>;
}

function StaffNotes() {
  const { commerce, editCommerce, confirm } = useAdmin();
  const [text, setText] = useState('');
  const add = e => { e.preventDefault(); if (!text.trim()) return; editCommerce(d => { d.staffNotes.unshift({ id: cid('sn'), at: new Date().toISOString(), author: '', text: text.trim() }); }, 'Note added'); setText(''); };
  return <Card title="Staff notes" className="caNotesCard">
    <form className="caInline" onSubmit={add}><input className="caInput" aria-label="New staff note" placeholder="Write a note for your team…" value={text} onChange={e => setText(e.target.value)} /><Btn type="submit">Add</Btn></form>
    {commerce.staffNotes.length ? <ul className="caNotes">{commerce.staffNotes.slice(0, 6).map(n => <li key={n.id}><p>{n.text}</p><small>{fmtDate(n.at, true)}</small>
      <button type="button" className="caIconBtn sm" aria-label="Delete note" onClick={async () => { if (await confirm({ title: 'Delete note?', message: n.text, confirmLabel: 'Delete', danger: true })) editCommerce(d => { d.staffNotes = d.staffNotes.filter(x => x.id !== n.id); }, 'Note deleted'); }}><Trash2 size={13} /></button></li>)}</ul>
      : <p className="caMuted">Notes are kept with the store data.</p>}
  </Card>;
}
