// Orders: list with filters and search, order detail with lifecycle actions, and the manual / draft order editor.
import React, { useMemo, useState } from 'react';
import { ArrowLeft, Plus, Printer, Truck, CreditCard, RotateCcw, Ban, Archive, Mail, Trash2, Upload, Download, X, Pencil } from 'lucide-react';
import { useAdmin, Page, Card, Badge, Btn, Text, Num, Select, Check, Area, Tags, Segmented, Modal, Empty, Thumb, fmtDate, FIN, FUL, download, readText, openHtml } from './ui.jsx';
import { ORDER_FILTERS, filterOrders, orderMatches, computeOrderTotals, createOrder, updateDraft, completeDraft, deleteDraft, markPaid, fulfillOrder, refundOrder, cancelOrder, setArchived, addTimelineComment, orderDocumentHtml, orderEmail, refundedAmount, lineFor, ensureCustomer, importOrderPayloads } from './orders.js';
import { customerName, formatAddress, COUNTRIES, NOTIFICATION_KEYS, NOTIFICATION_LABELS, normalizeAddress } from './model.js';
import { sellable } from './inventory.js';
import { variantPrice } from '../model.js';

const back = (go, to, label) => <button type="button" className="caIconBtn caBack" aria-label={label} onClick={() => go(to)}><ArrowLeft size={17} /></button>;
const csvCell = v => { v = v == null ? '' : String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };

export function OrdersList() {
  const { commerce, store, fmt, go, run, notify } = useAdmin();
  const [filter, setFilter] = useState('all'), [q, setQ] = useState(''), [sel, setSel] = useState([]);
  const list = useMemo(() => filterOrders(commerce.orders, filter).filter(o => orderMatches(o, q, commerce.customers)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [commerce, filter, q]);
  const counts = Object.fromEntries(ORDER_FILTERS.map(([k]) => [k, filterOrders(commerce.orders, k).length]));
  const importJson = async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try { const data = JSON.parse(await readText(f)); run((s, c) => { const r = importOrderPayloads(s, c, data); if (r.errors.length) setTimeout(() => notify(`Imported ${r.imported} order(s). ${r.errors.join('; ')}`), 50); return r; }, 'Orders imported'); }
    catch (err) { notify('Could not read the file: ' + err.message); }
  };
  const exportCsv = () => {
    const head = ['order', 'date', 'customer', 'email', 'financial_status', 'fulfillment_status', 'status', 'subtotal', 'discount', 'shipping', 'tax', 'total', 'refunded', 'items'];
    const rows = commerce.orders.filter(o => !o.draft).map(o => [o.name, o.createdAt, customerName(commerce.customers.find(c => c.id === o.customerId)), o.email, o.financialStatus, o.fulfillmentStatus, o.status, o.totals.subtotal, o.totals.discountTotal, o.totals.shipping, o.totals.tax, o.totals.total, refundedAmount(o), o.lines.map(l => `${l.quantity}x ${l.title}${l.variantTitle ? ' (' + l.variantTitle + ')' : ''}`).join('; ')]);
    download('orders.csv', [head, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n', 'text/csv');
  };
  const bulk = (fn, label) => { run((s, c) => { let st = s, co = c; for (const id of sel) { const r = fn(st, co, id); st = r.store || st; co = r.commerce || co; } return { store: st, commerce: co }; }, label); setSel([]); };
  const allOn = list.length > 0 && list.every(o => sel.includes(o.id));
  return <Page title="Orders" actions={<>
    <label className="caBtn"><Upload size={14} aria-hidden="true" />Import orders<input type="file" accept="application/json,.json" hidden aria-label="Import orders JSON file" onChange={importJson} /></label>
    <Btn icon={Download} onClick={exportCsv} disabled={!commerce.orders.some(o => !o.draft)}>Export CSV</Btn>
    <Btn kind="primary" icon={Plus} onClick={() => go({ page: 'order-new' })}>Create order</Btn></>}>
    <Card pad={false}>
      <div className="caToolbar">
        <Segmented label="Order filter" value={filter} onChange={v => { setFilter(v); setSel([]); }} options={ORDER_FILTERS.map(([k, l]) => [k, l, counts[k]])} />
        <input className="caInput caFilterSearch" type="search" aria-label="Filter orders" placeholder="Filter by order, customer, product…" value={q} onChange={e => setQ(e.target.value)} />
      </div>
      {sel.length > 0 && <div className="caBulk" role="toolbar" aria-label="Bulk actions"><span>{sel.length} selected</span>
        <Btn onClick={() => bulk((s, c, id) => { const o = c.orders.find(x => x.id === id); return o.financialStatus === 'pending' && o.status !== 'cancelled' && !o.draft ? markPaid(s, c, id) : {}; }, 'Orders marked as paid')}>Mark as paid</Btn>
        <Btn onClick={() => bulk((s, c, id) => { const o = c.orders.find(x => x.id === id); return o.fulfillmentStatus === 'unfulfilled' && o.status !== 'cancelled' && !o.draft ? fulfillOrder(s, c, id, {}) : {}; }, 'Orders fulfilled')}>Mark as fulfilled</Btn>
        <Btn onClick={() => bulk((s, c, id) => ({ commerce: c.orders.find(x => x.id === id).draft ? c : setArchived(c, id, true) }), 'Orders archived')}>Archive</Btn>
      </div>}
      {list.length ? <table className="caTable">
        <thead><tr><th className="sel"><input type="checkbox" aria-label="Select all orders" checked={allOn} onChange={e => setSel(e.target.checked ? list.map(o => o.id) : [])} /></th>
          <th>Order</th><th>Date</th><th>Customer</th><th>Payment</th><th>Fulfillment</th><th>Items</th><th className="n">Total</th></tr></thead>
        <tbody>{list.map(o => <tr key={o.id} className="click" onClick={() => go({ page: o.draft ? 'order-new' : 'order', id: o.id })}>
          <td className="sel" onClick={e => e.stopPropagation()}><input type="checkbox" aria-label={`Select order ${o.name}`} checked={sel.includes(o.id)} onChange={e => setSel(e.target.checked ? [...sel, o.id] : sel.filter(x => x !== o.id))} /></td>
          <td><button type="button" className="caLink" onClick={e => { e.stopPropagation(); go({ page: o.draft ? 'order-new' : 'order', id: o.id }); }}>{o.name}</button>{o.source === 'preview' && <Badge tone="info">Preview</Badge>}</td>
          <td>{fmtDate(o.createdAt, true)}</td><td>{customerName(commerce.customers.find(c => c.id === o.customerId)) || o.email || '—'}</td>
          <td>{o.draft ? <Badge>Draft</Badge> : <Badge tone={FIN[o.financialStatus][1]}>{FIN[o.financialStatus][0]}</Badge>}</td>
          <td>{o.status === 'cancelled' ? <Badge>Cancelled</Badge> : o.draft ? '—' : <Badge tone={FUL[o.fulfillmentStatus][1]}>{FUL[o.fulfillmentStatus][0]}</Badge>}{o.status === 'archived' && <Badge>Archived</Badge>}</td>
          <td>{o.lines.reduce((n, l) => n + l.quantity, 0)}</td><td className="n">{fmt(o.totals.total)}</td>
        </tr>)}</tbody></table>
        : <Empty art="orders" title={commerce.orders.length ? 'No orders match' : 'Your orders will show here'} action={!commerce.orders.length && <Btn kind="primary" icon={Plus} onClick={() => go({ page: 'order-new' })}>Create order</Btn>}>
          {commerce.orders.length ? 'Try another filter or search.' : 'Create orders for sales made by phone, in person or by message, or shop your store with View store.'}</Empty>}
    </Card>
    <p className="caHint">Static stores cannot send orders back here by themselves. Import order JSON collected by your own backend (see Analytics › Connect a backend), or create orders manually.</p>
  </Page>;
}

export function OrderDetail({ id }) {
  const { commerce, store, fmt, go, run, editCommerce, notify, confirm } = useAdmin();
  const o = commerce.orders.find(x => x.id === id);
  const [dialog, setDialog] = useState(null), [comment, setComment] = useState('');
  if (!o) return <Page title="Order not found" back={back(go, 'orders', 'Back to orders')}><Empty art="orders" title="This order does not exist anymore" /></Page>;
  const cu = commerce.customers.find(c => c.id === o.customerId), t = o.totals, refunded = refundedAmount(o), cancelled = o.status === 'cancelled';
  const print = kind => { if (!openHtml(orderDocumentHtml(store, commerce, o, kind))) notify('The browser blocked the new tab — allow pop-ups for this site.'); };
  const email = key => { const m = orderEmail(store, commerce, o, key); editCommerce(d => { d.orders.find(x => x.id === o.id).timeline.push({ id: 'em' + Date.now(), at: new Date().toISOString(), type: 'email', message: NOTIFICATION_LABELS[key] + ' email prepared for ' + (m.to || 'the customer') }); }, 'Email prepared'); window.location.href = m.mailto; };
  return <Page title={<span className="caTitleRow">{o.name}{o.draft ? <Badge>Draft</Badge> : <><Badge tone={FIN[o.financialStatus][1]}>{FIN[o.financialStatus][0]}</Badge>{cancelled ? <Badge tone="bad">Cancelled</Badge> : <Badge tone={FUL[o.fulfillmentStatus][1]}>{FUL[o.fulfillmentStatus][0]}</Badge>}</>}{o.status === 'archived' && <Badge>Archived</Badge>}</span>}
    subtitle={fmtDate(o.createdAt, true) + ' · ' + ({ manual: 'Created manually', preview: 'Store preview', import: 'Imported' }[o.source])} back={back(go, 'orders', 'Back to orders')}
    actions={<>
      <Btn icon={Printer} onClick={() => print('packing')}>Packing slip</Btn><Btn icon={Printer} onClick={() => print('invoice')}>Invoice</Btn>
      {!cancelled && !o.draft && <Btn icon={Archive} onClick={() => run((s, c) => ({ commerce: setArchived(c, o.id, o.status !== 'archived') }), o.status === 'archived' ? 'Order re-opened' : 'Order archived')}>{o.status === 'archived' ? 'Unarchive' : 'Archive'}</Btn>}
      {!cancelled && !o.draft && <Btn kind="danger" icon={Ban} onClick={() => setDialog('cancel')}>Cancel order</Btn>}
    </>}>
    <div className="caCols">
      <div className="caColMain">
        <Card title={o.fulfillmentStatus === 'fulfilled' ? 'Fulfilled' : 'Unfulfilled'} actions={!cancelled && o.fulfillmentStatus === 'unfulfilled' && <Btn kind="primary" icon={Truck} onClick={() => setDialog('fulfill')}>Fulfill items</Btn>}>
          <ul className="caLines">{o.lines.map(l => <li key={l.id}><Thumb src={l.image} size={44} /><div><strong>{l.title}</strong>{l.variantTitle && <small>{l.variantTitle}</small>}{l.sku && <small>SKU: {l.sku}</small>}</div>
            <span className="caMuted">{fmt(l.price)} × {l.quantity}</span><strong className="n">{fmt(l.price * l.quantity)}</strong></li>)}</ul>
          {o.fulfillments.map(f => <p key={f.id} className="caHint"><Truck size={12} /> Fulfilled {fmtDate(f.at, true)}{f.trackingNumber && <> · {f.carrier} tracking {f.trackingUrl ? <a href={f.trackingUrl} target="_blank" rel="noopener noreferrer">{f.trackingNumber}</a> : f.trackingNumber}</>}</p>)}
        </Card>
        <Card title="Payment" actions={!cancelled && <>{o.financialStatus === 'pending' && <Btn kind="primary" icon={CreditCard} onClick={async () => { if (await confirm({ title: 'Mark as paid?', message: `Record a payment of ${fmt(t.total)}. Tracked stock for these items is reduced now.`, confirmLabel: 'Mark as paid' })) run((s, c) => markPaid(s, c, o.id), 'Order marked as paid'); }}>Mark as paid</Btn>}
          {(o.financialStatus === 'paid' || o.financialStatus === 'partially_refunded') && <Btn icon={RotateCcw} onClick={() => setDialog('refund')}>Refund</Btn>}</>}>
          <dl className="caTotals">
            <dt>Subtotal <small>{o.lines.reduce((n, l) => n + l.quantity, 0)} items</small></dt><dd>{fmt(t.subtotal)}</dd>
            {t.applied.filter(a => a.type !== 'free_shipping').map(a => <React.Fragment key={a.id}><dt>Discount <small>{a.code || a.title}</small></dt><dd>−{fmt(a.amount)}</dd></React.Fragment>)}
            <dt>Shipping <small>{o.shippingName || 'None'}{t.shippingDiscount > 0 ? ' · free shipping applied' : ''}</small></dt><dd>{fmt(t.shipping)}</dd>
            <dt>{t.taxInclusive ? 'Tax (included)' : 'Tax'}</dt><dd>{fmt(t.tax)}</dd>
            <dt className="grand">Total</dt><dd className="grand">{fmt(t.total)}</dd>
            {refunded > 0 && <><dt>Refunded</dt><dd>−{fmt(refunded)}</dd><dt className="grand">Net payment</dt><dd className="grand">{fmt(t.total - refunded)}</dd></>}
          </dl>
          {o.paymentMethod && <p className="caHint">Payment method: {o.paymentMethod}</p>}
        </Card>
        <Card title="Timeline">
          <form className="caInline" onSubmit={e => { e.preventDefault(); if (!comment.trim()) return; run((s, c) => ({ commerce: addTimelineComment(c, o.id, comment.trim()) }), 'Comment added'); setComment(''); }}>
            <input className="caInput" aria-label="Leave a comment" placeholder="Leave a comment…" value={comment} onChange={e => setComment(e.target.value)} /><Btn type="submit">Post</Btn></form>
          <ol className="caTimeline">{o.timeline.slice().reverse().map(e => <li key={e.id} className={e.type}><span>{e.message}</span><small>{fmtDate(e.at, true)}</small></li>)}</ol>
        </Card>
      </div>
      <div className="caColSide">
        <Card title="Customer">
          {cu ? <><button type="button" className="caLink" onClick={() => go({ page: 'customer', id: cu.id })}>{customerName(cu)}</button><p className="caMuted">{commerce.orders.filter(x => x.customerId === cu.id && !x.draft).length} order(s)</p></> : <p className="caMuted">No customer</p>}
          <h3 className="caSub">Contact</h3><p>{o.email || cu?.email || '—'}<br />{o.phone || cu?.phone || ''}</p>
          <h3 className="caSub">Shipping address</h3><p className="caPre">{formatAddress(o.shippingAddress) || '—'}</p>
        </Card>
        <Card title="Notify customer">
          <div className="caStack">{NOTIFICATION_KEYS.map(k => <Btn key={k} icon={Mail} onClick={() => email(k)}>{NOTIFICATION_LABELS[k]}</Btn>)}</div>
          <p className="caHint">Opens your email app with the template from Settings › Notifications filled in.</p>
        </Card>
        <Card title="Notes"><Area label="Order note" value={o.note} onChange={v => editCommerce(d => { d.orders.find(x => x.id === o.id).note = v; }, 'Order note')} rows={3} />
          <Tags label="Order tags" value={o.tags} onChange={v => editCommerce(d => { d.orders.find(x => x.id === o.id).tags = v; }, 'Order tags')} /></Card>
      </div>
    </div>
    {dialog === 'fulfill' && <FulfillDialog order={o} onClose={() => setDialog(null)} />}
    {dialog === 'refund' && <RefundDialog order={o} onClose={() => setDialog(null)} />}
    {dialog === 'cancel' && <CancelDialog order={o} onClose={() => setDialog(null)} />}
  </Page>;
}

function FulfillDialog({ order, onClose }) {
  const { commerce, run } = useAdmin();
  const [v, set] = useState({ carrier: '', trackingNumber: '', trackingUrl: '', locationId: commerce.settings.locations.find(l => l.isDefault)?.id || '' });
  const up = k => x => set({ ...v, [k]: x });
  return <Modal title={'Fulfill ' + order.name} onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" onClick={() => { if (run((s, c) => fulfillOrder(s, c, order.id, v), 'Order fulfilled')) onClose(); }}>Fulfill items</Btn></>}>
    <div className="caForm">
      {commerce.settings.locations.length > 0 && <Select label="Ship from location" value={v.locationId} onChange={up('locationId')} options={commerce.settings.locations.map(l => [l.id, l.name])} />}
      <Select label="Carrier" value={v.carrier} onChange={up('carrier')} options={[['', 'Choose a carrier'], 'UPS', 'USPS', 'FedEx', 'DHL', 'Royal Mail', 'Canada Post', 'Australia Post', 'La Poste', 'Correos', 'Other']} />
      <Text label="Tracking number" value={v.trackingNumber} onChange={up('trackingNumber')} />
      <Text label="Tracking URL" type="url" value={v.trackingUrl} onChange={up('trackingUrl')} placeholder="https://" />
    </div>
  </Modal>;
}
function RefundDialog({ order, onClose }) {
  const { run, fmt } = useAdmin();
  const left = Math.round((order.totals.total - refundedAmount(order)) * 100) / 100;
  const [v, set] = useState({ amount: left, reason: '', restock: true });
  return <Modal title={'Refund ' + order.name} onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="danger" onClick={() => { if (run((s, c) => refundOrder(s, c, order.id, v), 'Refund recorded')) onClose(); }}>Refund {fmt(v.amount || 0)}</Btn></>}>
    <div className="caForm">
      <Num label="Refund amount" value={v.amount} min={0} max={left} onChange={x => set({ ...v, amount: x })} hint={`Up to ${fmt(left)} can be refunded.`} />
      <Text label="Reason" value={v.reason} onChange={x => set({ ...v, reason: x })} />
      <Check label="Restock items" checked={v.restock} onChange={x => set({ ...v, restock: x })} hint="Puts the ordered quantities back into tracked inventory." />
      <p className="caHint">Record the refund here after sending the money back through your payment provider.</p>
    </div>
  </Modal>;
}
function CancelDialog({ order, onClose }) {
  const { run } = useAdmin();
  const [v, set] = useState({ reason: '', restock: true });
  const paid = order.financialStatus === 'paid' || order.financialStatus === 'partially_refunded';
  return <Modal title={'Cancel ' + order.name + '?'} onClose={onClose} footer={<><Btn onClick={onClose}>Keep order</Btn><Btn kind="danger" onClick={() => { if (run((s, c) => cancelOrder(s, c, order.id, v), 'Order cancelled')) onClose(); }}>Cancel order</Btn></>}>
    <p className="caText">Cancelling cannot be undone.{paid ? ' The paid amount is recorded as refunded.' : ''}</p>
    <div className="caForm">
      <Select label="Reason" value={v.reason} onChange={x => set({ ...v, reason: x })} options={[['', 'Choose a reason'], 'Customer changed their mind', 'Payment not received', 'Fraudulent order', 'Items unavailable', 'Other']} />
      <Check label="Restock items" checked={v.restock} onChange={x => set({ ...v, restock: x })} />
    </div>
  </Modal>;
}

// ---------- manual / draft order editor ----------
export function OrderEditor({ id }) {
  const { commerce, store, fmt, go, run, confirm } = useAdmin();
  const draft = id ? commerce.orders.find(o => o.id === id && o.draft) : null;
  const [v, setV] = useState(() => draft ? { lines: draft.lines, customerId: draft.customerId || '', email: draft.email, phone: draft.phone, shippingAddress: draft.shippingAddress, codes: draft.codes, shippingRateId: draft.shippingRateId || '', paymentMethod: draft.paymentMethod, note: draft.note, tags: draft.tags }
    : { lines: [], customerId: '', email: '', phone: '', shippingAddress: normalizeAddress({ country: commerce.settings.shipping.zones.find(z => !z.countries.includes('*'))?.countries[0] || 'US' }), codes: [], shippingRateId: '', paymentMethod: '', note: '', tags: [] });
  const [newCu, setNewCu] = useState({ firstName: '', lastName: '', email: '' });
  const [pick, setPick] = useState(''), [code, setCode] = useState(''), [paid, setPaid] = useState(false);
  const up = patch => setV(x => ({ ...x, ...patch }));
  const t = useMemo(() => computeOrderTotals(store, commerce, { ...v, id: draft?.id, shippingRateId: v.shippingRateId || null, customerId: v.customerId || null }), [store, commerce, v, draft]);
  const variantsList = store.products.flatMap(p => p.variants.map(vr => ({ key: p.id + '|' + vr.id, p, vr, label: p.title + (vr.options.length ? ' — ' + vr.options.join(' / ') : '') + ' · ' + fmt(variantPrice(p, vr)) + (vr.stock != null ? ` · ${vr.stock} in stock` : '') + (p.status === 'draft' ? ' (draft)' : '') })));
  const addLine = () => {
    const it = variantsList.find(x => x.key === pick); if (!it) return;
    const ex = v.lines.find(l => l.productId === it.p.id && l.variantId === it.vr.id);
    up({ lines: ex ? v.lines.map(l => l === ex ? { ...l, quantity: l.quantity + 1 } : l) : [...v.lines, lineFor(store, it.p.id, it.vr.id, 1)] }); setPick('');
  };
  const overs = v.lines.filter(l => l.quantity > sellable(store, commerce, l.productId, l.variantId));
  const cu = commerce.customers.find(c => c.id === v.customerId);
  const methods = commerce.settings.payments.manualMethods.filter(m => m.enabled).map(m => m.name);
  const input = (c) => ({ ...v, customerId: c?.id || null, email: v.email || c?.email || '', shippingRateId: v.shippingRateId || null, source: draft?.source || 'manual' });
  const withCustomer = (s, c) => {
    if (v.customerId) return { commerce: c, customer: c.customers.find(x => x.id === v.customerId) };
    if (newCu.email || newCu.firstName || newCu.lastName) return ensureCustomer(c, { ...newCu, phone: v.phone, address: v.shippingAddress });
    return { commerce: c, customer: null };
  };
  const save = asDraft => {
    if (!v.lines.length) return;
    let createdId = null;
    const r = run((s, c) => {
      const ec = withCustomer(s, c);
      if (draft) {
        const u = updateDraft(s, ec.commerce, draft.id, input(ec.customer));
        if (asDraft) { createdId = draft.id; return u; }
        const done = completeDraft(u.store, u.commerce, draft.id, { paid }); createdId = done.order.id; return done;
      }
      const res = createOrder(s, ec.commerce, { ...input(ec.customer), draft: asDraft, paid: !asDraft && paid }); createdId = res.order.id; return res;
    }, asDraft ? 'Draft saved' : 'Order created');
    if (r && createdId) go(asDraft ? 'orders' : { page: 'order', id: createdId });
  };
  return <Page title={draft ? 'Draft order ' + draft.name : 'Create order'} back={back(go, 'orders', 'Back to orders')}
    actions={draft && <Btn kind="danger" icon={Trash2} onClick={async () => { if (await confirm({ title: 'Delete draft ' + draft.name + '?', message: 'This cannot be undone.', confirmLabel: 'Delete draft', danger: true })) { run((s, c) => ({ commerce: deleteDraft(c, draft.id) }), 'Draft deleted'); go('orders'); } }}>Delete draft</Btn>}>
    <div className="caCols">
      <div className="caColMain">
        <Card title="Products">
          <div className="caInline">
            <select className="caInput" aria-label="Product to add" value={pick} onChange={e => setPick(e.target.value)}>
              <option value="">Choose a product…</option>{variantsList.map(x => <option key={x.key} value={x.key}>{x.label}</option>)}
            </select>
            <Btn icon={Plus} onClick={addLine} disabled={!pick}>Add</Btn>
          </div>
          {v.lines.length ? <ul className="caLines edit">{v.lines.map((l, i) => <li key={l.id}><Thumb src={l.image} size={40} /><div><strong>{l.title}</strong>{l.variantTitle && <small>{l.variantTitle}</small>}</div>
            <span className="caMuted">{fmt(l.price)}</span>
            <input className="caInput qty" type="number" min="1" max="999" aria-label={`Quantity of ${l.title}${l.variantTitle ? ' ' + l.variantTitle : ''}`} value={l.quantity} onChange={e => up({ lines: v.lines.map((x, k) => k === i ? { ...x, quantity: Math.max(1, Math.min(999, Math.round(+e.target.value || 1))) } : x) })} />
            <strong className="n">{fmt(l.price * l.quantity)}</strong>
            <button type="button" className="caIconBtn sm" aria-label={`Remove ${l.title}`} onClick={() => up({ lines: v.lines.filter((_, k) => k !== i) })}><X size={14} /></button></li>)}</ul>
            : <p className="caMuted">Add products to the order.</p>}
          {overs.length > 0 && <p className="caWarn" role="alert">Not enough stock for: {overs.map(l => l.title + (l.variantTitle ? ' (' + l.variantTitle + ')' : '')).join(', ')}. Paying the order sets their stock to 0 — enable “Continue selling when out of stock” on the variant to allow overselling.</p>}
        </Card>
        <Card title="Payment">
          <div className="caInline">
            <input className="caInput" aria-label="Discount code" placeholder="Discount code" value={code} onChange={e => setCode(e.target.value.toUpperCase())} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (code.trim()) { up({ codes: [...new Set([...v.codes, code.trim()])] }); setCode(''); } } }} />
            <Btn onClick={() => { if (code.trim()) { up({ codes: [...new Set([...v.codes, code.trim()])] }); setCode(''); } }} disabled={!code.trim()}>Apply code</Btn>
          </div>
          {v.codes.length > 0 && <div className="caTags plain">{v.codes.map(c => <span key={c} className={'caTag' + (t.appliedCodes.includes(c) ? ' ok' : ' bad')}>{c}<button type="button" aria-label={`Remove code ${c}`} onClick={() => up({ codes: v.codes.filter(x => x !== c) })}><X size={11} /></button></span>)}</div>}
          {t.messages.map((m, i) => <p key={i} className={m.level === 'error' ? 'caWarn' : 'caHint'}>{m.text}</p>)}
          <div className="caForm two">
            <Select label="Shipping rate" value={v.shippingRateId} onChange={x => up({ shippingRateId: x })} options={[['', 'No shipping'], ...t.rates.map(r => [r.id, `${r.name} — ${r.price ? fmt(r.price) : 'Free'}`])]} hint={t.rates.length ? '' : 'No shipping rates for this country — add one in Settings › Shipping.'} />
            <Select label="Payment method" value={v.paymentMethod} onChange={x => up({ paymentMethod: x })} options={[['', 'Not specified'], ...methods, ...['Card (payment link)', 'Cash', 'Other'].filter(m => !methods.includes(m))]} />
          </div>
          <dl className="caTotals" aria-label="Order totals">
            <dt>Subtotal</dt><dd data-total="subtotal">{fmt(t.subtotal)}</dd>
            {t.applied.filter(a => a.type !== 'free_shipping').map(a => <React.Fragment key={a.id}><dt>Discount <small>{a.code || a.title}</small></dt><dd>−{fmt(a.amount)}</dd></React.Fragment>)}
            <dt>Shipping <small>{t.shippingName || 'None'}{t.shippingDiscount > 0 ? ' · free shipping' : ''}</small></dt><dd data-total="shipping">{fmt(t.shipping)}</dd>
            <dt>{t.taxInclusive ? 'Tax (included)' : 'Tax'} <small>{t.taxRate ? `${t.taxName} ${t.taxRate}%` : 'No tax rate for this address'}</small></dt><dd data-total="tax">{fmt(t.tax)}</dd>
            <dt className="grand">Total</dt><dd className="grand" data-total="total">{fmt(t.total)}</dd>
          </dl>
          <div className="caFootActions">
            <Check label="Mark as paid" checked={paid} onChange={setPaid} />
            <span className="caSpacer" />
            <Btn onClick={() => save(true)} disabled={!v.lines.length}>Save as draft</Btn>
            <Btn kind="primary" onClick={() => save(false)} disabled={!v.lines.length}>{draft ? 'Complete order' : 'Create order'}</Btn>
          </div>
        </Card>
      </div>
      <div className="caColSide">
        <Card title="Customer">
          <Select label="Existing customer" value={v.customerId} onChange={x => { const c = commerce.customers.find(y => y.id === x); up({ customerId: x, email: c?.email || v.email, phone: c?.phone || v.phone, shippingAddress: c && c.address.address1 ? { ...c.address, name: c.address.name || customerName(c) } : v.shippingAddress }); }}
            options={[['', 'New or no customer'], ...commerce.customers.map(c => [c.id, customerName(c) + (c.email ? ' · ' + c.email : '')])]} />
          {!cu && <div className="caForm two"><Text label="First name" value={newCu.firstName} onChange={x => setNewCu({ ...newCu, firstName: x })} /><Text label="Last name" value={newCu.lastName} onChange={x => setNewCu({ ...newCu, lastName: x })} />
            <Text label="Customer email" type="email" wide value={newCu.email} onChange={x => { setNewCu({ ...newCu, email: x }); up({ email: x }); }} /></div>}
          {cu && <Text label="Order email" type="email" value={v.email} onChange={x => up({ email: x })} />}
          <Text label="Phone" value={v.phone} onChange={x => up({ phone: x })} />
        </Card>
        <Card title="Shipping address">
          <AddressFields value={v.shippingAddress} onChange={a => up({ shippingAddress: a })} />
        </Card>
        <Card title="Notes"><Area label="Note" value={v.note} onChange={x => up({ note: x })} rows={3} /><Tags label="Tags" value={v.tags} onChange={x => up({ tags: x })} /></Card>
      </div>
    </div>
  </Page>;
}

export function AddressFields({ value, onChange, prefix = '' }) {
  const a = value || {}, up = k => x => onChange({ ...a, [k]: x });
  return <div className="caForm two">
    <Text label={prefix + 'Full name'} value={a.name} onChange={up('name')} wide />
    <Text label={prefix + 'Company'} value={a.company} onChange={up('company')} wide />
    <Text label={prefix + 'Address'} value={a.address1} onChange={up('address1')} wide />
    <Text label={prefix + 'Apartment, suite, etc.'} value={a.address2} onChange={up('address2')} wide />
    <Text label={prefix + 'City'} value={a.city} onChange={up('city')} />
    <Text label={prefix + 'Postal code'} value={a.zip} onChange={up('zip')} />
    <Text label={prefix + 'State / province'} value={a.province} onChange={up('province')} />
    <Select label={prefix + 'Country'} value={a.country} onChange={up('country')} options={[['', 'Choose…'], ...COUNTRIES]} />
  </div>;
}
