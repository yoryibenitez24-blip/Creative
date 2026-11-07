// Customers: list with search and consent filter, CSV import / export, customer detail and editor.
import React, { useState } from 'react';
import { ArrowLeft, Plus, Upload, Download, Trash2, Mail } from 'lucide-react';
import { useAdmin, Page, Card, Badge, Btn, Text, Area, Check, Tags, Segmented, Empty, fmtDate, FIN, FUL, download, readText } from './ui.jsx';
import { customerName, normalizeCustomer, formatAddress } from './model.js';
import { customerStats } from './orders.js';
import { customersToCsv, importCustomersCsv } from './customers.js';
import { AddressFields } from './Orders.jsx';

const back = go => <button type="button" className="caIconBtn caBack" aria-label="Back to customers" onClick={() => go('customers')}><ArrowLeft size={17} /></button>;

export function CustomersList() {
  const { commerce, go, fmt, editCommerce, notify } = useAdmin();
  const [q, setQ] = useState(''), [f, setF] = useState('all');
  const list = commerce.customers.filter(c => (f === 'all' || (f === 'subscribed' ? c.acceptsMarketing : f === 'buyers' ? customerStats(commerce, c.id).count > 0 : !c.acceptsMarketing))
    && (customerName(c) + ' ' + c.email + ' ' + c.phone + ' ' + c.tags.join(' ')).toLowerCase().includes(q.trim().toLowerCase()));
  const importCsv = async e => {
    const file = e.target.files[0]; e.target.value = ''; if (!file) return;
    const r = importCustomersCsv(commerce.customers, await readText(file));
    if (r.added || r.updated) editCommerce(d => { d.customers = r.customers; }, 'Import customers');
    notify(`${r.added} added, ${r.updated} updated` + (r.errors.length ? ' · ' + r.errors.slice(0, 3).join('; ') : ''));
  };
  return <Page title="Customers" actions={<>
    <label className="caBtn"><Upload size={14} aria-hidden="true" />Import<input type="file" accept=".csv,text/csv" hidden aria-label="Import customers CSV file" onChange={importCsv} /></label>
    <Btn icon={Download} onClick={() => download('customers.csv', customersToCsv(commerce.customers), 'text/csv')} disabled={!commerce.customers.length}>Export</Btn>
    <Btn kind="primary" icon={Plus} onClick={() => go({ page: 'customer', id: 'new' })}>Add customer</Btn></>}>
    <Card pad={false}>
      <div className="caToolbar">
        <Segmented label="Customer filter" value={f} onChange={setF} options={[['all', 'All'], ['buyers', 'Have ordered'], ['subscribed', 'Email subscribers'], ['unsubscribed', 'Not subscribed']]} />
        <input className="caInput caFilterSearch" type="search" aria-label="Filter customers" placeholder="Search customers" value={q} onChange={e => setQ(e.target.value)} />
      </div>
      {list.length ? <table className="caTable"><thead><tr><th>Customer</th><th>Email subscription</th><th>Location</th><th>Orders</th><th className="n">Amount spent</th></tr></thead>
        <tbody>{list.map(c => { const s = customerStats(commerce, c.id); return <tr key={c.id} className="click" onClick={() => go({ page: 'customer', id: c.id })}>
          <td><button type="button" className="caLink" onClick={e => { e.stopPropagation(); go({ page: 'customer', id: c.id }); }}>{customerName(c)}</button>{c.email && <small className="caMuted block">{c.email}</small>}</td>
          <td>{c.acceptsMarketing ? <Badge tone="ok">Subscribed</Badge> : <Badge>Not subscribed</Badge>}</td>
          <td>{[c.address.city, c.address.country].filter(Boolean).join(', ') || '—'}</td><td>{s.count}</td><td className="n">{fmt(s.totalSpent)}</td></tr>; })}</tbody></table>
        : <Empty art="customers" title={commerce.customers.length ? 'No customers match' : 'Everything customers-related in one place'} action={!commerce.customers.length && <Btn kind="primary" icon={Plus} onClick={() => go({ page: 'customer', id: 'new' })}>Add customer</Btn>}>
          {commerce.customers.length ? 'Try another filter.' : 'Customers are added when they order, or add and import them yourself.'}</Empty>}
    </Card>
  </Page>;
}

export function CustomerDetail({ id }) {
  const { commerce, go, fmt, commit, notify, confirm } = useAdmin();
  const isNew = id === 'new', orig = commerce.customers.find(c => c.id === id);
  const [c, setC] = useState(() => orig ? structuredClone(orig) : normalizeCustomer({}));
  const [dirty, setDirty] = useState(isNew);
  if (!isNew && !orig) return <Page title="Customer not found" back={back(go)}><Empty art="customers" title="This customer does not exist anymore" /></Page>;
  const up = patch => { setC(x => ({ ...x, ...patch })); setDirty(true); };
  const save = () => {
    if (!c.email.trim() && !c.firstName.trim() && !c.lastName.trim() && !c.phone.trim()) { notify('Enter at least a name, an email or a phone number.'); return; }
    const email = c.email.trim().toLowerCase();
    if (email && commerce.customers.some(x => x.email === email && x.id !== c.id)) { notify('Another customer already uses this email.'); return; }
    const d = structuredClone(commerce), next = normalizeCustomer({ ...c, marketingUpdatedAt: orig && orig.acceptsMarketing !== c.acceptsMarketing ? new Date().toISOString() : c.marketingUpdatedAt || (c.acceptsMarketing ? new Date().toISOString() : null) });
    const i = d.customers.findIndex(x => x.id === c.id); if (i >= 0) d.customers[i] = next; else d.customers.push(next);
    commit(null, d, isNew ? 'Add customer' : 'Edit customer'); setDirty(false); notify(isNew ? 'Customer created' : 'Customer saved');
    if (isNew) go({ page: 'customer', id: next.id });
  };
  const remove = async () => {
    const n = customerStats(commerce, c.id).orders.length;
    if (!await confirm({ title: `Delete ${customerName(c)}?`, message: n ? `Their ${n} order(s) are kept without a customer.` : 'This cannot be undone.', confirmLabel: 'Delete customer', danger: true })) return;
    const d = structuredClone(commerce); d.customers = d.customers.filter(x => x.id !== c.id); for (const o of d.orders) if (o.customerId === c.id) o.customerId = null;
    commit(null, d, 'Delete customer'); notify('Customer deleted'); go('customers');
  };
  const s = isNew ? null : customerStats(commerce, c.id);
  return <Page title={isNew ? 'New customer' : customerName(orig)} subtitle={!isNew ? `Customer since ${fmtDate(orig.createdAt)}` : ''} back={back(go)}
    actions={<>{!isNew && c.email && <a className="caBtn" href={'mailto:' + encodeURIComponent(c.email)}><Mail size={14} aria-hidden="true" />Email</a>}{!isNew && <Btn kind="danger" icon={Trash2} onClick={remove}>Delete</Btn>}<Btn kind="primary" onClick={save} disabled={!dirty}>Save</Btn></>}>
    {s && <div className="caKpis three"><div className="caKpi"><span className="caKpiLabel">Amount spent</span><strong className="caKpiValue">{fmt(s.totalSpent)}</strong></div>
      <div className="caKpi"><span className="caKpiLabel">Orders</span><strong className="caKpiValue">{s.count}</strong></div>
      <div className="caKpi"><span className="caKpiLabel">Last order</span><strong className="caKpiValue sm">{s.lastOrder ? fmtDate(s.lastOrder.createdAt) : '—'}</strong></div></div>}
    <div className="caCols">
      <div className="caColMain">
        <Card title="Customer overview"><div className="caForm two">
          <Text label="First name" value={c.firstName} onChange={v => up({ firstName: v })} /><Text label="Last name" value={c.lastName} onChange={v => up({ lastName: v })} />
          <Text label="Email" type="email" value={c.email} onChange={v => up({ email: v })} /><Text label="Phone number" type="tel" value={c.phone} onChange={v => up({ phone: v })} />
          <Text label="Company" value={c.company} onChange={v => up({ company: v })} wide />
        </div>
          <Check label="Customer agreed to receive marketing emails" checked={c.acceptsMarketing} onChange={v => up({ acceptsMarketing: v })} hint={c.marketingUpdatedAt ? 'Consent last changed ' + fmtDate(c.marketingUpdatedAt, true) : 'Only send marketing to customers who agreed.'} />
        </Card>
        {s && <Card title="Orders" pad={false}>{s.orders.length ? <table className="caTable"><thead><tr><th>Order</th><th>Date</th><th>Payment</th><th>Fulfillment</th><th className="n">Total</th></tr></thead>
          <tbody>{s.orders.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(o => <tr key={o.id} className="click" onClick={() => go({ page: 'order', id: o.id })}>
            <td><button type="button" className="caLink" onClick={e => { e.stopPropagation(); go({ page: 'order', id: o.id }); }}>{o.name}</button></td><td>{fmtDate(o.createdAt)}</td>
            <td><Badge tone={FIN[o.financialStatus][1]}>{FIN[o.financialStatus][0]}</Badge></td><td>{o.status === 'cancelled' ? <Badge>Cancelled</Badge> : <Badge tone={FUL[o.fulfillmentStatus][1]}>{FUL[o.fulfillmentStatus][0]}</Badge>}</td>
            <td className="n">{fmt(o.totals.total)}</td></tr>)}</tbody></table>
          : <div className="caCardBody"><p className="caMuted">No orders yet.</p><Btn onClick={() => go({ page: 'order-new' })}>Create order</Btn></div>}</Card>}
        <Card title="Default address"><AddressFields value={c.address} onChange={a => up({ address: a })} /></Card>
      </div>
      <div className="caColSide">
        <Card title="Notes"><Area label="Customer note" value={c.note} onChange={v => up({ note: v })} rows={4} /></Card>
        <Card title="Tags"><Tags label="Customer tags" value={c.tags} onChange={v => up({ tags: v })} /></Card>
        {!isNew && formatAddress(orig.address) && <Card title="Ships to"><p className="caPre">{formatAddress(orig.address)}</p></Card>}
      </div>
    </div>
  </Page>;
}
