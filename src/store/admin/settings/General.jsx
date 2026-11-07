// Settings › General, Plan, Billing, Users and permissions.
import React, { useState } from 'react';
import { Store as StoreIcon, Mail, Phone, MapPin, Clock, Plus } from 'lucide-react';
import { useAdmin, Modal, Btn, Text, Num, Area, Select, Check } from '../ui.jsx';
import { CURRENCIES } from '../../model.js';
import { COUNTRIES, countryName, WEIGHT_UNITS, BUSINESS_ENTITIES, STAFF_ROLES, STAFF_PERMISSIONS, cid } from '../model.js';
import { PLANS, planFor } from '../plans.js';
import { Section, Row, Toggle, SelectRow, Menu, Pill, flag, Note } from './kit.jsx';

const ZONES = (() => { try { return Intl.supportedValuesOf('timeZone'); } catch { return ['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Sao_Paulo', 'Europe/London', 'Europe/Berlin', 'Europe/Paris', 'Europe/Madrid', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney', 'Pacific/Auckland']; } })();
const zoneLabel = z => { try { const off = new Intl.DateTimeFormat('en-US', { timeZone: z, timeZoneName: 'shortOffset' }).formatToParts(new Date()).find(p => p.type === 'timeZoneName')?.value || ''; return `(${off.replace('GMT', 'GMT')}) ${z.replace(/_/g, ' ')}`; } catch { return z; } };
const COUNTRY_OPTS = COUNTRIES.map(([k, n]) => [k, `${flag(k)}  ${n}`]);

/** Contact dialogs: key → [title, fields [label, path in store.contact | store]]. */
const DIALOGS = {
  name: ['Store name', [['Store name', 'name']]],
  email: ['Store email', [['Store contact email', 'contact.email', 'email', 'Customers see it on your contact page and in order emails.']]],
  phone: ['Store phone', [['Store phone', 'contact.phone', 'tel']]],
  address: ['Store address', [['Store address', 'contact.address', 'area']]],
  hours: ['Opening hours', [['Opening hours', 'contact.hours']]],
};
const getPath = (o, p) => p.split('.').reduce((x, k) => x?.[k], o);

export function General({ s, c, edit }) {
  const g = c.settings.general, G = k => v => edit((_, x) => { x.settings.general[k] = v; });
  const [dlg, setDlg] = useState(null);
  const nextId = `${g.orderPrefix}${g.nextOrderNumber}${g.orderSuffix}`;
  const fmtSample = (() => { const code = s.currency.code; try { const nf = new Intl.NumberFormat(s.currency.locale, { style: 'currency', currency: code, currencyDisplay: g.currencyDisplay === 'code' ? 'code' : 'symbol' }); const t = nf.format(1234.56); return g.currencyDisplay === 'symbol_code' ? `${t} ${code}` : t; } catch { return code + ' 1,234.56'; } })();
  return <>
    <Section id="profile" title="Store details" desc="How customers and Zertake identify and reach your store.">
      <Row icon={StoreIcon} label="Store name" value={s.name} onClick={() => setDlg('name')} />
      <Row icon={Mail} label="Store email" value={s.contact.email || 'Add email'} tone={s.contact.email ? '' : 'dim'} onClick={() => setDlg('email')} />
      <Row icon={Phone} label="Store phone" value={s.contact.phone || 'Add phone'} tone={s.contact.phone ? '' : 'dim'} onClick={() => setDlg('phone')} />
      <Row icon={MapPin} label="Store address" value={(s.contact.address || 'Add address').split('\n')[0]} tone={s.contact.address ? '' : 'dim'} onClick={() => setDlg('address')} />
      <Row icon={Clock} label="Opening hours" value={s.contact.hours || 'Not set'} tone={s.contact.hours ? '' : 'dim'} onClick={() => setDlg('hours')} />
    </Section>
    {dlg && <Modal title={`Edit ${DIALOGS[dlg][0].toLowerCase()}`} onClose={() => setDlg(null)} footer={<Btn kind="primary" onClick={() => setDlg(null)}>Done</Btn>}>
      <div className="caForm">{DIALOGS[dlg][1].map(([label, path, type, hint]) => {
        const set = v => edit(st => { if (path === 'name') { if (st.logo.text === st.name) st.logo.text = v; st.name = v; } else st.contact[path.split('.')[1]] = v; });
        return type === 'area' ? <Area key={path} label={label} value={getPath(s, path)} rows={3} onChange={set} /> : <Text key={path} label={label} type={type || 'text'} value={getPath(s, path)} hint={hint} onChange={set} />;
      })}</div>
      <p className="caHint">Changes are kept as unsaved until you press Save.</p>
    </Modal>}

    <Section id="business" title="Business details" desc="Used on invoices, policies, tax documents and when you connect Stripe.">
      <div className="csPad"><div className="caForm two">
        <Text label="Legal business name" value={g.legalName} onChange={G('legalName')} />
        <Select label="Business entity" value={g.businessEntity} onChange={G('businessEntity')} options={BUSINESS_ENTITIES} />
        <Select label="Country / region" value={g.country} onChange={v => edit((_, x) => { x.settings.general.country = v; if (!x.settings.general.backupRegion) x.settings.general.backupRegion = v; })} options={COUNTRY_OPTS} hint="Where your business is registered." />
        <Area label="Legal business address" value={g.address} rows={2} onChange={G('address')} wide />
      </div></div>
    </Section>

    <Section id="defaults" title="Store defaults" desc="Currency, region and units used across your store and admin.">
      <SelectRow id="currency" label="Store currency" desc="Prices are not converted when you change it." value={s.currency.code} onChange={v => edit(st => { st.currency = { code: v, locale: CURRENCIES.find(x => x[0] === v)[1] }; })} options={CURRENCIES.map(([k]) => [k, k])} />
      <SelectRow id="currency-display" label="Currency display" desc={`Example: ${fmtSample}`} value={g.currencyDisplay} onChange={G('currencyDisplay')} options={[['symbol', 'Symbol ($1,234.56)'], ['code', 'Code (USD 1,234.56)'], ['symbol_code', 'Symbol and code ($1,234.56 USD)']]} />
      <SelectRow id="backup-region" label="Backup region" desc="Used for customers whose location can’t be determined." value={g.backupRegion} onChange={G('backupRegion')} options={COUNTRY_OPTS} />
      <SelectRow id="units" label="Unit system" value={g.unitSystem} onChange={v => edit((_, x) => { x.settings.general.unitSystem = v; x.settings.general.weightUnit = v === 'imperial' ? 'lb' : 'kg'; })} options={[['metric', 'Metric system'], ['imperial', 'Imperial system']]} />
      <SelectRow id="weight-unit" label="Default weight unit" value={g.weightUnit} onChange={G('weightUnit')} options={Object.keys(WEIGHT_UNITS).map(u => [u, { g: 'Grams (g)', kg: 'Kilograms (kg)', lb: 'Pounds (lb)', oz: 'Ounces (oz)' }[u]])} />
      <SelectRow id="timezone" label="Time zone" desc="Sets the time for when orders and analytics are recorded." value={g.timezone} onChange={G('timezone')} options={(ZONES.includes(g.timezone) ? ZONES : [g.timezone, ...ZONES]).map(z => [z, zoneLabel(z)])} />
    </Section>

    <Section id="order-id" title="Order ID" desc="Shown on the order page, the customer’s order status page and emails.">
      <div className="csPad"><div className="caForm three">
        <Text label="Prefix" value={g.orderPrefix} maxLength={6} onChange={G('orderPrefix')} />
        <Text label="Suffix" value={g.orderSuffix} maxLength={6} onChange={G('orderSuffix')} placeholder="Optional" />
        <Num label="Next order number" value={g.nextOrderNumber} min={1} step={1} onChange={v => G('nextOrderNumber')(Math.round(v))} />
      </div>
        <div className="csPreview" aria-live="polite"><span>Your next order ID</span><strong>{nextId}</strong><small>then {g.orderPrefix}{g.nextOrderNumber + 1}{g.orderSuffix}, {g.orderPrefix}{g.nextOrderNumber + 2}{g.orderSuffix}… The number can only move forward past existing orders.</small></div>
      </div>
    </Section>

    <Section id="order-processing" title="Order processing" desc="What happens after a customer pays.">
      <SelectRow id="auto-fulfill" label="After an order has been paid" value={g.autoFulfill} onChange={G('autoFulfill')} options={[['none', 'Don’t fulfill any line items automatically'], ['digital', 'Automatically fulfill only gift cards and digital items'], ['all', 'Automatically fulfill all line items']]} />
      <Toggle id="auto-archive" label="Automatically archive the order" desc="Archive orders after they are fulfilled, paid and not refunded." checked={g.autoArchive} onChange={G('autoArchive')} />
      <div className="csRow" id="cs-low-stock"><div className="csRowBody tight"><Num label="Low stock threshold" value={g.lowStockThreshold} min={0} step={1} onChange={v => G('lowStockThreshold')(Math.round(v))} hint="Home shows an alert at or below this quantity." /></div></div>
    </Section>
  </>;
}

export function Plan() {
  const { plan, onUpgrade, store } = useAdmin();
  const cur = planFor(plan);
  return <>
    <Section id="plan-current" title="Plan details" desc="Your Zertake workspace plan. Plans are a local setting — there is no subscription charge.">
      <Row label={`${cur.name} plan`} sub={cur.blurb} value={<Pill tone="ok">Current plan</Pill>} />
      <Row label="Stores included" value={`${cur.stores} ${cur.stores === 1 ? 'store' : 'stores'}`} />
      <Row label="This store" value={store.name} />
      {onUpgrade && <div className="csRowFoot"><Btn kind="primary" onClick={onUpgrade}>Change plan</Btn></div>}
    </Section>
    <Section id="plan-compare" title="All plans" desc="Every plan includes every commerce feature; plans differ in how many stores you run.">
      {PLANS.map(p => <Row key={p.id} label={p.name} sub={p.blurb} value={p.id === cur.id ? <Pill tone="ok">Current</Pill> : `${p.stores} ${p.stores === 1 ? 'store' : 'stores'}`} />)}
    </Section>
  </>;
}

export function Billing({ c, edit }) {
  const g = c.settings.general, G = k => v => edit((_, x) => { x.settings.general[k] = v; });
  return <>
    <Section id="billing-profile" title="Billing profile" desc="Contact details printed on invoices, packing slips and policy pages.">
      <div className="csPad"><div className="caForm two">
        <Text label="Sender / billing email" type="email" value={g.email} onChange={G('email')} hint="Used on invoices, policies and notification emails." />
        <Text label="Billing phone" value={g.phone} onChange={G('phone')} />
      </div></div>
    </Section>
    <Section id="billing-bills" title="Bills and charges" desc="What you pay, and to whom.">
      <Row label="Zertake" sub="Runs in your browser; plans are local." value="$0.00" />
      <Row label="Payment processing" sub="Stripe charges its processing fees directly to your connected account. See Payments › Platform fee." value="Billed by Stripe" />
      <Row label="Backend and email" sub="Supabase, Resend and similar services bill you directly on their own plans." value="Billed by provider" />
    </Section>
  </>;
}

export function Users({ c, edit }) {
  const u = c.settings.users, [dlg, setDlg] = useState(null);
  const owner = { name: u.owner.name, email: u.owner.email || c.settings.general.email };
  const S = (i, fn) => edit((_, x) => fn(x.settings.users.staff[i]));
  const roleName = r => STAFF_ROLES.find(x => x[0] === r)?.[1] || r;
  const i = dlg == null ? -1 : c.settings.users.staff.findIndex(m => m.id === dlg), m = i >= 0 ? c.settings.users.staff[i] : null;
  return <>
    <Section id="owner" title="Store owner" desc="The person responsible for the store and its data.">
      <div className="csPad"><div className="caForm two">
        <Text label="Owner name" value={u.owner.name} onChange={v => edit((_, x) => { x.settings.users.owner.name = v; })} />
        <Text label="Owner email" type="email" value={u.owner.email} placeholder={c.settings.general.email} onChange={v => edit((_, x) => { x.settings.users.owner.email = v.trim(); })} />
      </div></div>
    </Section>
    <Section id="staff" title="Staff" desc="People who help run the store and what they can see." actions={<Btn icon={Plus} onClick={() => { const id = cid('st'); edit((_, x) => { x.settings.users.staff.push({ id, name: '', email: '', role: 'staff', permissions: ['orders', 'products'] }); }); setDlg(id); }}>Add staff</Btn>}>
      <Row label={owner.name || 'Store owner'} sub={owner.email || 'No email'} value={<Pill tone="info">Owner</Pill>} />
      {c.settings.users.staff.map((s, k) => <Row key={s.id} label={s.name || 'Unnamed staff member'} sub={s.email || 'No email'} value={<Pill>{roleName(s.role)}</Pill>}
        menu={<Menu label={s.name || 'Staff member'} items={[['Edit', () => setDlg(s.id)], ['Remove', () => edit((_, x) => { x.settings.users.staff.splice(k, 1); }), true]]} />} />)}
      <Note>Staff entries are a record for your team. Signing in as staff needs a backend with authentication (Supabase Auth in Apps and integrations).</Note>
    </Section>
    {m && <Modal title={m.name ? `Edit ${m.name}` : 'Add staff member'} onClose={() => setDlg(null)} footer={<Btn kind="primary" onClick={() => setDlg(null)}>Done</Btn>}>
      <div className="caForm two">
        <Text label="Staff name" value={m.name} onChange={v => S(i, x => { x.name = v; })} />
        <Text label="Staff email" type="email" value={m.email} onChange={v => S(i, x => { x.email = v; })} />
        <Select label="Role" value={m.role} onChange={v => S(i, x => { x.role = v; if (v === 'admin') x.permissions = STAFF_PERMISSIONS.map(p => p[0]); if (v === 'limited') x.permissions = ['orders']; })} options={STAFF_ROLES} wide />
      </div>
      <fieldset className="csFieldset"><legend>Permissions</legend><div className="csChecks">{STAFF_PERMISSIONS.map(([k, l]) => <Check key={k} label={l} checked={m.permissions.includes(k)} disabled={m.role === 'admin'}
        onChange={v => S(i, x => { x.permissions = v ? [...new Set([...x.permissions, k])] : x.permissions.filter(p => p !== k); })} />)}</div></fieldset>
    </Modal>}
  </>;
}
