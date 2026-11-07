// Discounts: list with status, and the discount editor (codes / automatic, percentage, fixed amount, free shipping,
// buy X get Y, minimum requirements, usage limits, combinations, active dates). Math: discounts.js.
import React, { useState } from 'react';
import { ArrowLeft, Plus, Trash2, Shuffle, Copy } from 'lucide-react';
import { useAdmin, Page, Card, Badge, Btn, Text, Num, Select, Check, Empty, fmtDate } from './ui.jsx';
import { normalizeDiscountDoc } from './model.js';
import { discountStatus, describeDiscount } from './discounts.js';

const STATUS = { active: ['Active', 'ok'], scheduled: ['Scheduled', 'info'], expired: ['Expired', 'neutral'], disabled: ['Disabled', 'neutral'], limit_reached: ['Limit reached', 'warn'] };
const TYPES = [['percentage', 'Percentage off'], ['fixed', 'Fixed amount off'], ['free_shipping', 'Free shipping'], ['bxgy', 'Buy X get Y']];
const toLocal = iso => { if (!iso) return ''; const d = new Date(iso); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const fromLocal = v => v ? new Date(v).toISOString() : null;
const randomCode = () => Array.from({ length: 8 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 31)]).join('');

export function DiscountsList() {
  const { commerce, go, fmt } = useAdmin();
  const now = Date.now();
  return <Page title="Discounts" actions={<Btn kind="primary" icon={Plus} onClick={() => go({ page: 'discount', id: 'new' })}>Create discount</Btn>}>
    <Card pad={false}>{commerce.discounts.length ? <table className="caTable"><thead><tr><th>Title</th><th>Status</th><th>Method</th><th>Type</th><th>Used</th><th>Dates</th></tr></thead>
      <tbody>{commerce.discounts.map(d => { const s = STATUS[discountStatus(d, now)]; return <tr key={d.id} className="click" onClick={() => go({ page: 'discount', id: d.id })}>
        <td><button type="button" className="caLink" onClick={e => { e.stopPropagation(); go({ page: 'discount', id: d.id }); }}>{d.method === 'code' ? d.code : d.title || 'Automatic discount'}</button><small className="caMuted block">{describeDiscount(d, fmt)}</small></td>
        <td><Badge tone={s[1]}>{s[0]}</Badge></td><td>{d.method === 'code' ? 'Code' : 'Automatic'}</td><td>{TYPES.find(t => t[0] === d.type)[1]}</td>
        <td>{d.usageCount}{d.usageLimit != null ? ' / ' + d.usageLimit : ''}</td><td>{d.startsAt ? fmtDate(d.startsAt) : 'Now'} – {d.endsAt ? fmtDate(d.endsAt) : 'No end'}</td></tr>; })}</tbody></table>
      : <Empty art="discounts" title="Manage discounts and promotions" action={<Btn kind="primary" icon={Plus} onClick={() => go({ page: 'discount', id: 'new' })}>Create discount</Btn>}>Create discount codes and automatic discounts that apply in the order editor and the storefront checkout.</Empty>}</Card>
    <p className="caHint">Discounts are applied to orders you create here. The storefront runtime applies them at checkout once your store build includes discount support.</p>
  </Page>;
}

export function DiscountDetail({ id }) {
  const { commerce, store, go, commit, notify, confirm, fmt } = useAdmin();
  const isNew = id === 'new', orig = commerce.discounts.find(d => d.id === id);
  const [d, setD] = useState(() => orig ? structuredClone(orig) : normalizeDiscountDoc({ code: '', startsAt: new Date().toISOString() }));
  const [dirty, setDirty] = useState(isNew);
  if (!isNew && !orig) return <Page title="Discount not found" back={<button type="button" className="caIconBtn caBack" aria-label="Back to discounts" onClick={() => go('discounts')}><ArrowLeft size={17} /></button>}><Empty art="discounts" title="This discount does not exist anymore" /></Page>;
  const up = patch => { setD(x => ({ ...x, ...patch })); setDirty(true); };
  const save = () => {
    const n = normalizeDiscountDoc(d);
    if (n.method === 'code' && !n.code) { notify('Enter a discount code.'); return; }
    if (n.method === 'code' && commerce.discounts.some(x => x.id !== n.id && x.method === 'code' && x.code === n.code)) { notify(`The code ${n.code} already exists.`); return; }
    if (n.method === 'automatic' && !n.title.trim()) { notify('Give the automatic discount a title.'); return; }
    if (n.endsAt && n.startsAt && n.endsAt <= n.startsAt) { notify('The end date must be after the start date.'); return; }
    const c = structuredClone(commerce), i = c.discounts.findIndex(x => x.id === n.id);
    if (i >= 0) c.discounts[i] = n; else c.discounts.push(n);
    commit(null, c, isNew ? 'Create discount' : 'Edit discount'); setDirty(false); notify(isNew ? 'Discount created' : 'Discount saved');
    if (isNew) go({ page: 'discount', id: n.id });
  };
  const remove = async () => {
    if (!await confirm({ title: 'Delete discount?', message: `“${d.code || d.title}” stops working immediately. Past orders keep their discounts.`, confirmLabel: 'Delete discount', danger: true })) return;
    const c = structuredClone(commerce); c.discounts = c.discounts.filter(x => x.id !== d.id); commit(null, c, 'Delete discount'); notify('Discount deleted'); go('discounts');
  };
  const scope = d.appliesTo, toggleIn = (key, val, on) => up({ appliesTo: { ...scope, [key]: on ? [...scope[key], val] : scope[key].filter(x => x !== val) } });
  const pickProducts = (list, key, onToggle) => <ul className="caPickList short">{store.products.map(p => <li key={p.id}><label className="caCheck"><input type="checkbox" checked={list.includes(p.id)} onChange={e => onToggle(p.id, e.target.checked)} /><span>{p.title}</span></label></li>)}</ul>;
  const status = STATUS[discountStatus(normalizeDiscountDoc(d), Date.now())];
  return <Page title={isNew ? 'Create discount' : (orig.method === 'code' ? orig.code : orig.title)} back={<button type="button" className="caIconBtn caBack" aria-label="Back to discounts" onClick={() => go('discounts')}><ArrowLeft size={17} /></button>}
    actions={<>{!isNew && <Btn kind="danger" icon={Trash2} onClick={remove}>Delete</Btn>}<Btn kind="primary" onClick={save} disabled={!dirty}>Save discount</Btn></>}>
    <div className="caCols">
      <div className="caColMain">
        <Card title="Method">
          <div className="segmented caSeg" role="group" aria-label="Discount method">{[['code', 'Discount code'], ['automatic', 'Automatic discount']].map(([k, l]) => <button key={k} type="button" aria-pressed={d.method === k} className={d.method === k ? 'on' : ''} onClick={() => up({ method: k })}>{l}</button>)}</div>
          <div className="caForm">
            {d.method === 'code' ? <div className="caInline end"><Text label="Discount code" value={d.code} onChange={v => up({ code: v.toUpperCase().replace(/\s+/g, '') })} placeholder="SUMMER20" hint="Customers enter this code at checkout." />
              <Btn icon={Shuffle} onClick={() => up({ code: randomCode() })}>Generate</Btn>{d.code && <Btn icon={Copy} aria-label="Copy code" onClick={() => navigator.clipboard?.writeText(d.code).then(() => notify('Code copied'), () => notify('Copy failed'))}>Copy</Btn>}</div>
              : <Text label="Title" value={d.title} onChange={v => up({ title: v })} placeholder="Summer sale" hint="Customers see this in their cart and at checkout." />}
            {d.method === 'code' && <Text label="Internal title (optional)" value={d.title} onChange={v => up({ title: v })} />}
          </div>
        </Card>
        <Card title="Discount value">
          <div className="caForm two">
            <Select label="Discount type" value={d.type} onChange={v => up({ type: v, value: v === 'percentage' ? Math.min(100, d.value || 10) : d.value })} options={TYPES} />
            {d.type === 'percentage' && <Num label="Percentage" value={d.value} min={0} max={100} suffix="%" onChange={v => up({ value: v })} />}
            {d.type === 'fixed' && <Num label="Amount off" value={d.value} min={0} onChange={v => up({ value: v })} hint="Once per order, spread over eligible items." />}
          </div>
          {d.type === 'bxgy' && <><h3 className="caSub">Customer buys</h3>
            <Num label="Quantity to buy" value={d.bxgy.buyQuantity} min={1} step={1} onChange={v => up({ bxgy: { ...d.bxgy, buyQuantity: Math.max(1, Math.round(v)) } })} />
            <h3 className="caSub">Customer gets</h3>
            <div className="caForm three">
              <Num label="Quantity they get" value={d.bxgy.getQuantity} min={1} step={1} onChange={v => up({ bxgy: { ...d.bxgy, getQuantity: Math.max(1, Math.round(v)) } })} />
              <Num label="Discount on those items" value={d.bxgy.getPercent} min={0} max={100} suffix="%" onChange={v => up({ bxgy: { ...d.bxgy, getPercent: v } })} hint="100% = free" />
              <Num label="Maximum uses per order" value={d.bxgy.maxUses} min={1} step={1} allowEmpty onChange={v => up({ bxgy: { ...d.bxgy, maxUses: v == null ? null : Math.round(v) } })} hint="Blank = unlimited" />
            </div>
            <Check label="Customer gets specific products (otherwise the same items they buy)" checked={d.bxgy.getProductIds.length > 0} onChange={on => up({ bxgy: { ...d.bxgy, getProductIds: on ? [store.products[0]?.id].filter(Boolean) : [] } })} />
            {d.bxgy.getProductIds.length > 0 && pickProducts(d.bxgy.getProductIds, 'get', (pid, on) => up({ bxgy: { ...d.bxgy, getProductIds: on ? [...d.bxgy.getProductIds, pid] : d.bxgy.getProductIds.filter(x => x !== pid) } }))}
          </>}
          {d.type !== 'free_shipping' && <>
            <h3 className="caSub">{d.type === 'bxgy' ? 'Customer buys from' : 'Applies to'}</h3>
            <Select label={d.type === 'bxgy' ? 'Eligible items to buy' : 'Applies to'} value={scope.kind} onChange={v => up({ appliesTo: { ...scope, kind: v } })} options={[['all', 'All products'], ['collections', 'Specific collections'], ['products', 'Specific products']]} />
            {scope.kind === 'products' && pickProducts(scope.productIds, 'products', (pid, on) => toggleIn('productIds', pid, on))}
            {scope.kind === 'collections' && (store.collections.length ? <ul className="caPickList short">{store.collections.map(c => <li key={c.id}><label className="caCheck"><input type="checkbox" checked={scope.collectionIds.includes(c.id)} onChange={e => toggleIn('collectionIds', c.id, e.target.checked)} /><span>{c.title}</span></label></li>)}</ul> : <p className="caMuted">No collections yet.</p>)}
          </>}
        </Card>
        <Card title="Minimum purchase requirements">
          <div className="caRadios" role="radiogroup" aria-label="Minimum purchase requirement">
            {[['none', 'No minimum requirements'], ['amount', 'Minimum purchase amount'], ['quantity', 'Minimum quantity of items']].map(([k, l]) => <label key={k} className="caCheck"><input type="radio" name="minimum" checked={d.minimum.kind === k} onChange={() => up({ minimum: { ...d.minimum, kind: k } })} /><span>{l}</span></label>)}
          </div>
          {d.minimum.kind !== 'none' && <Num label={d.minimum.kind === 'amount' ? 'Minimum amount' : 'Minimum quantity'} value={d.minimum.value} min={0} step={d.minimum.kind === 'quantity' ? 1 : 'any'} onChange={v => up({ minimum: { ...d.minimum, value: v } })} />}
        </Card>
        <Card title="Maximum discount uses">
          <Check label="Limit number of times this discount can be used in total" checked={d.usageLimit != null} onChange={on => up({ usageLimit: on ? 100 : null })} />
          {d.usageLimit != null && <Num label="Total usage limit" value={d.usageLimit} min={0} step={1} onChange={v => up({ usageLimit: Math.round(v) })} />}
          <Check label="Limit to one use per customer" checked={d.oncePerCustomer} onChange={v => up({ oncePerCustomer: v })} />
        </Card>
        <Card title="Combinations">
          <Check label="Can combine with other combinable discounts" checked={d.combinable} onChange={v => up({ combinable: v })} hint="Free shipping always combines with one product or order discount." />
        </Card>
        <Card title="Active dates">
          <div className="caForm two">
            <Text label="Start date" type="datetime-local" value={toLocal(d.startsAt)} onChange={v => up({ startsAt: fromLocal(v) })} />
            <Text label="End date" type="datetime-local" value={toLocal(d.endsAt)} onChange={v => up({ endsAt: fromLocal(v) })} hint="Leave empty for no end date." />
          </div>
          <Check label="Enabled" checked={d.enabled} onChange={v => up({ enabled: v })} />
        </Card>
      </div>
      <div className="caColSide">
        <Card title="Summary">
          <p><strong>{d.method === 'code' ? d.code || 'No code yet' : d.title || 'No title yet'}</strong> <Badge tone={status[1]}>{status[0]}</Badge></p>
          <ul className="caSummary"><li>{d.method === 'code' ? 'Code' : 'Automatic'} discount</li><li>{describeDiscount(normalizeDiscountDoc(d), fmt)}</li>
            {d.usageLimit != null && <li>Limited to {d.usageLimit} use(s) in total</li>}{d.oncePerCustomer && <li>One use per customer</li>}
            <li>{d.combinable ? 'Combines with other combinable discounts' : "Can't combine with other discounts"}</li>
            <li>Active from {d.startsAt ? fmtDate(d.startsAt, true) : 'now'}{d.endsAt ? ' until ' + fmtDate(d.endsAt, true) : ''}</li>
            {!isNew && <li>Used {orig.usageCount} time(s)</li>}</ul>
        </Card>
      </div>
    </div>
  </Page>;
}
