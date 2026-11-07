// Commerce Home (bento dashboard): greeting hero with today's sales, period controls (preset, date range, "Add widget",
// CSV export), KPI cards with change vs. the previous period, total sales with the previous period and customer segments,
// most active weekday, repeat-customer gauge, best sellers and recent orders; on the side the automatic setup guide with
// a progress gauge (src/store/admin/setup.js), inventory alerts, staff notes and tips. Widgets can be hidden/shown
// (saved per device in localStorage). Numbers: src/store/admin/dashboard.js + analytics.js.
import React, { useMemo, useState } from 'react';
import { Check, ChevronRight, Package, Paintbrush, Truck, CreditCard, Globe, Rocket, TriangleAlert, Lightbulb, Trash2, X, ExternalLink, Plus, DollarSign, ShoppingBag, Receipt, MousePointerClick, ArrowUp, ArrowDown, Download, LayoutGrid, CalendarDays, Star } from 'lucide-react';
import { useAdmin, Card, Badge, Btn, AreaChart, Empty, fmtDate, pct, FIN, FUL, Thumb, BigNum, Gauge, Modal, download } from './ui.jsx';
import { aggregateAnalytics, presetRange } from './analytics.js';
import { stockRows, productStock } from './inventory.js';
import { customerName, cid } from './model.js';
import { setupProgress, SETUP_STEPS } from './setup.js';
import { DASH_PRESETS, WEEKDAYS, dashRange, previousRange, fmtDay, change, weekdayActivity, customerSegments, repeatRate, grossProfit, dashboardCsv } from './dashboard.js';
import { exportStoreZip } from '../exporter.js';
import { slugify } from '../model.js';

const STEP_INFO = {
  product: ['Add your products', 'An active product with a title, a price and a photo: save one in the product editor or upload your own image.', Package, 'Add product'],
  theme: ['Customize your theme', 'Open the store builder to set colours, fonts and arrange your pages.', Paintbrush, 'Customize theme'],
  shipping: ['Set up shipping', 'Review the shipping zones and rates for where you deliver and save them.', Truck, 'Set up shipping'],
  payments: ['Set up payments and checkout', 'Add your WhatsApp number, order email or payment links so customers can buy.', CreditCard, 'Set up payments'],
  domain: ['Add a domain', 'Enter the domain you will point at the exported store.', Globe, 'Add domain'],
  launch: ['Launch your store', 'Export the store as a ZIP and upload it to Netlify, GitHub Pages or any static host.', Rocket, 'Export store'],
};
const WIDGETS = [['setup', 'Setup guide'], ['kpis', 'Key metrics'], ['sales', 'Total sales'], ['activeDay', 'Most active day'], ['repeat', 'Repeat customer rate'], ['best', 'Best selling products'], ['recent', 'Recent orders'], ['inventory', 'Inventory alerts'], ['notes', 'Staff notes'], ['tips', 'Tips']];
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

function Kpi({ label, icon: Icon, value, cur, prev, prevText, hot }) {
  return <div className={'caKpi' + (hot ? ' hot' : '')} role="group" aria-label={label}>
    <div className="caKpiTop"><span className="caKpiLabel">{label}</span><span className="caKpiIcon" aria-hidden="true"><Icon size={15} /></span></div>
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
  const { store, commerce, fmt, go, editCommerce, notify, assetStore, customize, viewStore } = useAdmin();
  const tz = -new Date().getTimezoneOffset();
  const [period, setPeriod] = useState(loadPeriod);
  const [hidden, setHidden] = useState(loadHidden);
  const [picking, setPicking] = useState(false);
  const range = dashRange(period, Date.now(), tz), prev = previousRange(range);
  const a = useMemo(() => aggregateAnalytics(commerce, { ...range, tz }), [commerce, range.from, range.to]); // eslint-disable-line react-hooks/exhaustive-deps
  const b = useMemo(() => aggregateAnalytics(commerce, { ...prev, tz }), [commerce, prev.from, prev.to]); // eslint-disable-line react-hooks/exhaustive-deps
  // the hero's "Sales today" card always looks at the last two weeks, whatever the period
  const recent = presetRange('30d', Date.now(), tz);
  const r = useMemo(() => aggregateAnalytics(commerce, { ...recent, tz }), [commerce, recent.from, recent.to]); // eslint-disable-line react-hooks/exhaustive-deps
  const seg = useMemo(() => customerSegments(commerce, { ...range, tz }), [commerce, range.from, range.to]); // eslint-disable-line react-hooks/exhaustive-deps
  const rep = useMemo(() => repeatRate(commerce), [commerce]);
  const profit = useMemo(() => grossProfit(commerce, { ...range, tz }), [commerce, range.from, range.to]); // eslint-disable-line react-hooks/exhaustive-deps
  const profitPrev = useMemo(() => grossProfit(commerce, { ...prev, tz }), [commerce, prev.from, prev.to]); // eslint-disable-line react-hooks/exhaustive-deps
  const setup = useMemo(() => setupProgress(store, commerce), [store, commerce]);
  const [open, setOpen] = useState(undefined); // expanded setup step (undefined → the next one)
  const openStep = open === undefined ? setup.next : open;
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

  const today = r.days[r.days.length - 1] || { sales: 0, orders: 0, sessions: 0 }, yesterday = r.days[r.days.length - 2] || { sales: 0 };
  const last14 = r.days.slice(-14), max14 = Math.max(1e-9, ...last14.map(d => d.sales)), peak = last14.reduce((bi, d, i) => d.sales > (last14[bi]?.sales ?? -1) ? i : bi, last14.length - 1);
  const todayDelta = change(today.sales, yesterday.sales);
  const salesPts = a.days.map(d => ({ label: fmtDate(d.date + 'T12:00:00'), short: fmtDay(d.date).replace(/, \d{4}$/, ''), value: d.sales }));
  const cmpPts = b.days.slice(-a.days.length).map(d => ({ value: d.sales }));
  const best = a.topProducts.slice(0, 5).map(t => ({ ...t, product: store.products.find(p => p.id === t.productId), before: b.topProducts.find(x => (x.productId || x.title) === (t.productId || t.title))?.sales || 0 }));
  const segMax = Math.max(1, seg.new, seg.returning, seg.vip);
  const showSetup = show('setup') && !commerce.onboarding.dismissed && !setup.complete;

  return <div className="caPage caHome">
    <div className="caColMain">
      <section className="caHero" aria-label="Store overview">
        <div className="caHeroMain">
          <span className="caHeroTag"><i aria-hidden="true" />{store.name} · {periodLabel}</span>
          <h1>{greeting}</h1>
          <p>Here is what is happening with {store.name} in the {periodLabel}.</p>
          <div className="caHeroCtas">
            <button type="button" className="caPill" onClick={viewStore}><ExternalLink size={14} aria-hidden="true" />View store</button>
            <button type="button" className="caPill" onClick={() => go({ page: 'product', id: 'new' })}><Plus size={14} aria-hidden="true" />Add product</button>
            <button type="button" className="caPill ghost" onClick={customize}><Paintbrush size={14} aria-hidden="true" />Customize</button>
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

      <div className="caDashBar" role="toolbar" aria-label="Dashboard period and widgets">
        <span className="caDateChip"><CalendarDays size={15} aria-hidden="true" />{fmtDay(range.from)} – {fmtDay(range.to)}</span>
        <select className="caInput caPeriod" aria-label="Dashboard period" value={period} onChange={e => setP(e.target.value)}>{DASH_PRESETS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <span className="caSpacer" />
        <Btn icon={LayoutGrid} onClick={() => setPicking(true)}>Add widget</Btn>
        <Btn kind="primary" icon={Download} onClick={exportCsv}>Export CSV</Btn>
      </div>

      {show('kpis') && <div className="caKpis">
        <Kpi hot label="Total sales" icon={DollarSign} value={fmt(a.totals.sales)} cur={a.totals.sales} prev={b.totals.sales} prevText={fmt(b.totals.sales)} />
        <Kpi label="Orders" icon={ShoppingBag} value={String(a.totals.orders)} cur={a.totals.orders} prev={b.totals.orders} prevText={num(b.totals.orders)} />
        <Kpi label="Average order value" icon={Receipt} value={fmt(a.totals.aov)} cur={a.totals.aov} prev={b.totals.aov} prevText={fmt(b.totals.aov)} />
        <Kpi label="Conversion rate" icon={MousePointerClick} value={a.totals.sessions ? pct(a.totals.conversion) : '—'} cur={a.totals.conversion} prev={b.totals.conversion} prevText={b.totals.sessions ? pct(b.totals.conversion) : '—'} />
      </div>}

      {show('sales') && <Card className="caSalesCard" title={profit.costed ? 'Total sales & profit' : 'Total sales'} actions={<Btn kind="plain" onClick={() => go('analytics')}>View analytics<ChevronRight size={14} /></Btn>}>
        <div className="caSalesTop">
          <div className="caSalesNum">
            <strong><BigNum value={fmt(a.totals.sales)} /></strong>
            <div className="caKpiFoot"><Delta cur={a.totals.sales} prev={b.totals.sales} /><span>vs. {fmt(b.totals.sales)} last period</span></div>
          </div>
          <dl className="caSalesStats">
            <div><dt>Orders</dt><dd>{num(a.totals.orders)}</dd></div>
            <div><dt>Units sold</dt><dd>{num(a.totals.unitsSold)}</dd></div>
            {profit.costed && <div><dt>Gross profit</dt><dd><BigNum value={fmt(profit.profit)} /></dd></div>}
          </dl>
        </div>
        <div className="caLegend" aria-hidden="true"><span><i className="cur" />This period</span><span><i className="prev" />Previous period</span></div>
        <AreaChart label={`Sales, ${periodLabel}, with the previous period`} points={salesPts} compare={cmpPts} format={(v, axis) => fmt(v, axis)} height={190} />
        <div className="caSegCard" role="group" aria-label="Customers">
          <div className="caSegHead"><strong>Customers</strong><span className="caMuted">{num(seg.total)} ordered in this period</span></div>
          <div className="caSegs">
            {[['New', seg.new, 'a'], ['Returning', seg.returning, 'b'], ['VIP (3+ orders)', seg.vip, 'c']].map(([l, v, c]) => <div key={l} className={'caSeg2 ' + c}>
              <span>{l}</span><strong>{num(v)}</strong><i><b style={{ width: `${(v / segMax) * 100}%` }} /></i></div>)}
          </div>
        </div>
      </Card>}

      {(show('activeDay') || show('repeat')) && <div className="caDashPair">
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
            <Btn kind="plain" onClick={() => go('customers')}>Details<ChevronRight size={14} /></Btn>
          </div>
        </Card>}
      </div>}

      {show('best') && <Card title="Best selling products" className="caBestCard" pad={false} actions={<Btn kind="plain" onClick={() => go('products')}>All products<ChevronRight size={14} /></Btn>}>
        {best.length ? <div className="caTableWrap"><table className="caTable" aria-label="Best selling products">
          <thead><tr><th>SKU</th><th>Name</th><th className="n">Sold</th><th className="n">Revenue</th><th>{best.some(t => t.product?.rating) ? 'Rating' : 'Stock'}</th></tr></thead>
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

      {show('recent') && <RecentOrders />}
    </div>

    <div className="caColSide">
      {showSetup && <Card className="caSetup" aria-label="Set up your store" title={<span>Set up your store</span>}
        actions={<button type="button" className="caIconBtn" aria-label="Dismiss setup guide" onClick={() => editCommerce(d => { d.onboarding.dismissed = true; }, 'Setup guide dismissed')}><X size={16} /></button>}>
        <div className="caSetupGauge">
          <Gauge value={setup.done / setup.total} label={Math.round((setup.done / setup.total) * 100) + '%'} sub="complete" />
          <p className="caMuted">{setup.done} of {setup.total} tasks complete</p>
          <div className="caProgress" role="progressbar" aria-label="Setup progress" aria-valuemin={0} aria-valuemax={setup.total} aria-valuenow={setup.done}><div style={{ width: `${(setup.done / setup.total) * 100}%` }} /></div>
          <p className="caHint caSetupNote">Steps tick themselves off as you go.</p>
        </div>
        <ol className="caSteps">{SETUP_STEPS.map(k => { const [title, text, Icon, cta] = STEP_INFO[k], done = setup.steps[k], on = openStep === k; return <li key={k} className={(done ? 'done ' : '') + (on ? 'open' : '')}>
          <span className="caStepDone" aria-hidden="true">{done && <Check size={13} />}</span>
          <div className="caStepMain">
            <button type="button" className="caStepTitle" aria-expanded={on} onClick={() => setOpen(on ? null : k)}>{title}<span className="caVh">{done ? ' (completed)' : ' (not completed)'}</span></button>
            {on && <div className="caStepBody"><p>{text}</p>{done ? <span className="caStepDoneTag"><Check size={12} aria-hidden="true" />Done</span> : <Btn kind="primary" icon={Icon} onClick={() => runStep(k)}>{cta}</Btn>}</div>}
          </div>
        </li>; })}</ol>
      </Card>}
      {show('inventory') && <InventoryAlerts />}
      {show('notes') && <StaffNotes />}
      {show('tips') && <Card title="Tips" className="caTipsCard">
        <ul className="caTips">
          <li><Lightbulb size={14} aria-hidden="true" /><span>Create a <button type="button" className="caLink" onClick={() => go({ page: 'discount', id: 'new' })}>welcome discount code</button> and share it on social media with a tracked link from <button type="button" className="caLink" onClick={() => go('marketing')}>Marketing</button>.</span></li>
          <li><Lightbulb size={14} aria-hidden="true" /><span>Add cost per item to your products to see margin and profit.</span></li>
          <li><Lightbulb size={14} aria-hidden="true" /><span>Use <strong>View store</strong> to shop your store like a customer: visits, carts and orders appear in Analytics.</span></li>
        </ul>
      </Card>}
    </div>

    {picking && <Modal title="Dashboard widgets" onClose={() => setPicking(false)} footer={<Btn kind="primary" onClick={() => setPicking(false)}>Done</Btn>}>
      <p className="caMuted">Choose what Home shows. Saved on this device.</p>
      <ul className="caWidgetList">{WIDGETS.map(([k, l]) => <li key={k}><label className="caCheck"><input type="checkbox" checked={show(k)} onChange={e => toggleWidget(k, e.target.checked)} /><span>{l}{k === 'setup' && commerce.onboarding.dismissed ? <small className="caHint">Dismissed · <button type="button" className="caLink" onClick={() => editCommerce(d => { d.onboarding.dismissed = false; }, 'Setup guide restored')}>show again</button></small> : k === 'setup' && setup.complete ? <small className="caHint">All steps complete</small> : null}</span></label></li>)}</ul>
    </Modal>}
  </div>;
}

function RecentOrders() {
  const { commerce, fmt, go } = useAdmin();
  const recent = commerce.orders.filter(o => !o.draft).slice().sort((x, y) => y.createdAt.localeCompare(x.createdAt)).slice(0, 6);
  const name = o => customerName(commerce.customers.find(c => c.id === o.customerId)) || o.email || 'Guest';
  return <Card title="Recent orders" actions={<Btn kind="plain" onClick={() => go('orders')}>All orders<ChevronRight size={14} /></Btn>}>
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
  return <Card title="Inventory alerts" actions={<Btn kind="plain" onClick={() => go('inventory')}>Inventory<ChevronRight size={14} /></Btn>}>
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
  return <Card title="Staff notes">
    <form className="caInline" onSubmit={add}><input className="caInput" aria-label="New staff note" placeholder="Write a note for your team…" value={text} onChange={e => setText(e.target.value)} /><Btn type="submit">Add</Btn></form>
    {commerce.staffNotes.length ? <ul className="caNotes">{commerce.staffNotes.slice(0, 8).map(n => <li key={n.id}><p>{n.text}</p><small>{fmtDate(n.at, true)}</small>
      <button type="button" className="caIconBtn sm" aria-label="Delete note" onClick={async () => { if (await confirm({ title: 'Delete note?', message: n.text, confirmLabel: 'Delete', danger: true })) editCommerce(d => { d.staffNotes = d.staffNotes.filter(x => x.id !== n.id); }, 'Note deleted'); }}><Trash2 size={13} /></button></li>)}</ul>
      : <p className="caMuted">Notes are kept with the store data.</p>}
  </Card>;
}
