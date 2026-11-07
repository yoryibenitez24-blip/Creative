// Settings › Payments: Stripe Connect (connection, keys, payment methods, capture, descriptor, fees, payouts, Radar,
// Billing, webhooks, server secrets) and the alternative / manual methods of the static store.
import React, { useState } from 'react';
import { useBackend, CatalogSync } from '../Backend.jsx';
import { stripeStatusPatch } from '../backendSync.js';
import { Plus, Trash2, ExternalLink, KeyRound, Webhook, CircleCheck, CircleAlert, RefreshCw } from 'lucide-react';
import { useAdmin, Btn, Text, Num, Select, Check, Area, Segmented } from '../ui.jsx';
import { CHECKOUT_MODES } from '../../model.js';
import { cid } from '../model.js';
import { CONNECT_TYPES, PAYMENT_METHODS, PAYMENT_GROUPS, STRIPE_WEBHOOK_EVENTS, WEEKDAYS, STRIPE_CURRENCIES, backendReady, webhookUrl,
  afterPlatformFee, statementPreview, serverSecrets, secretsCommand } from '../../integrations.js';
import { Section, Row, Toggle, SelectRow, Choice, Input, Pill, CopyLine, Note } from './kit.jsx';

export const STATUS = { not_connected: ['Not connected', 'neutral'], pending: ['Onboarding pending', 'warn'], connected: ['Connected', 'ok'], restricted: ['Restricted', 'bad'] };
const money = (n, cur) => { try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur.toUpperCase() }).format(n); } catch { return n.toFixed(2) + ' ' + cur.toUpperCase(); } };

export function Payments({ s, c, edit, open }) {
  const sp = c.settings.payments.stripe, g = c.settings.general;
  const T = fn => edit((_, x) => fn(x.settings.payments.stripe), 'payments');
  const set = k => v => T(t => { t[k] = v; });
  const [busy, setBusy] = useState(''), [err, setErr] = useState(''), [link, setLink] = useState('');
  const { backend } = useAdmin();
  const { be, signedIn, email } = useBackend(c);
  const ready = backendReady(c), hook = webhookUrl(c);
  const [label, tone] = STATUS[sp.onboardingStatus];
  // both calls need the merchant's access token (Authorization: Bearer <token>, apikey: anon) — sign in first
  const needSignIn = then => { if (be && be.signedIn()) return false; backend?.promptSignIn({ commerce: c, then }); return true; };
  const failed = e => setErr(e.message === 'Failed to fetch' ? 'Could not reach the backend (network or CORS). Check that the Stripe Connect functions are deployed.' : e.message);
  const connect = async () => {
    setErr(''); setLink('');
    if (needSignIn(connect)) return;
    setBusy('connect');
    try {
      const data = await be.connectOnboard({ storeId: s.id, mode: sp.mode, connectType: sp.connectType, accountId: sp.accountId || null, country: g.country, email: g.email || s.contact.email, businessType: g.businessEntity, storeName: s.name, currency: s.currency?.code, returnUrl: location.href, refreshUrl: location.href });
      const patch = stripeStatusPatch(data);
      T(t => { Object.assign(t, patch); if (!patch.onboardingStatus || patch.onboardingStatus === 'not_connected') t.onboardingStatus = 'pending'; t.enabled = true; });
      if (typeof data?.url === 'string' && /^https:\/\//.test(data.url)) { if (!window.open(data.url, '_blank', 'noopener')) setLink(data.url); }
      else setErr('The backend did not return an onboarding link.');
    } catch (e) { failed(e); }
    finally { setBusy(''); }
  };
  const refresh = async () => {
    setErr('');
    if (needSignIn(refresh)) return;
    setBusy('refresh');
    try { const patch = stripeStatusPatch(await be.connectStatus(s.id)); T(t => { Object.assign(t, patch); }); }
    catch (e) { failed(e); }
    finally { setBusy(''); }
  };
  const fee = afterPlatformFee(sp, 100), cur = sp.currency, active = sp.paymentMethods.length;
  const preview = statementPreview(sp, s.name);
  const secrets = serverSecrets(c);
  return <>
    <Section id="stripe" title="Stripe" desc="Accept cards, wallets and local payment methods through Stripe Connect.">
      <div className="csConnect">
        <span className="csLogo stripe" aria-hidden="true">S</span>
        <div className="csConnectText"><strong>Stripe Connect <Pill tone={tone}>{label}</Pill>{sp.mode === 'test' && <Pill tone="warn">Test mode</Pill>}</strong>
          <span>{sp.accountId ? <>Account <code>{sp.accountId}</code> · {CONNECT_TYPES.find(t => t[0] === sp.connectType)[1]}</> : 'No Stripe account connected yet.'}</span></div>
        <div className="csInline">
          <Btn icon={RefreshCw} disabled={!ready || !!busy} onClick={refresh}>{busy === 'refresh' ? 'Refreshing…' : 'Refresh status'}</Btn>
          <Btn kind="primary" icon={ExternalLink} disabled={!ready || !!busy} onClick={connect}>{busy === 'connect' ? 'Connecting…' : sp.accountId ? 'Continue onboarding' : 'Connect with Stripe'}</Btn>
        </div>
      </div>
      {ready && <Note tone={signedIn ? '' : 'info'}>{signedIn ? <>Signed in to your backend as <strong>{email}</strong>. Connecting and refreshing use your session.</> : <>Connecting Stripe needs your store account: <button type="button" className="caLink" onClick={() => backend?.promptSignIn({ commerce: c })}>sign in to your backend</button>.</>}</Note>}
      {link && <Note tone="info">Your browser blocked the new tab. <a className="caLink" href={link} target="_blank" rel="noopener noreferrer">Open Stripe onboarding</a></Note>}
      {!ready && <Note tone="info">Connecting needs your backend: add your Supabase project in <button type="button" className="caLink" onClick={() => open('apps', 'app-supabase')}>Apps and integrations</button> and deploy the <code>stripe-connect-onboard</code> function. Until then you can paste an existing account ID below.</Note>}
      {err && <Note tone="bad" role="alert">{err}</Note>}
      <Toggle id="stripe-enabled" label="Accept payments with Stripe" desc="Shows Stripe’s payment form at checkout once a publishable key and backend are set." checked={sp.enabled} onChange={set('enabled')} />
      <Row id="stripe-mode" label="Mode" sub={sp.mode === 'test' ? 'Use test cards like 4242 4242 4242 4242 — no real money moves.' : 'Real payments. Make sure the live key and webhook are set.'}
        aside={<Segmented label="Stripe mode" value={sp.mode} onChange={set('mode')} options={[['test', 'Test'], ['live', 'Live']]} />} />
      <div className="csRow" id="cs-stripe-account"><div className="csRowBody tight"><div className="caForm two">
        <Input label="Connected account ID" vkey="accountId" mono value={sp.accountId} placeholder="acct_1A2b3C4d5E6f7G8h" onChange={v => T(t => { t.accountId = v.trim(); if (!v.trim()) t.onboardingStatus = 'not_connected'; else if (t.onboardingStatus === 'not_connected') t.onboardingStatus = 'pending'; })} />
        <Select label="Account type" value={sp.connectType} onChange={set('connectType')} options={CONNECT_TYPES.map(([k, l]) => [k, l])} hint={CONNECT_TYPES.find(t => t[0] === sp.connectType)[2]} />
      </div></div></div>
      <Row label="Charges" sub="Reported by Stripe (account.updated webhook) — Refresh status reads it now." value={sp.chargesEnabled ? <span className="csOk"><CircleCheck size={14} aria-hidden="true" />Enabled</span> : <span className="csDim"><CircleAlert size={14} aria-hidden="true" />Not yet</span>} />
      <Row label="Payouts" value={sp.payoutsEnabled ? <span className="csOk"><CircleCheck size={14} aria-hidden="true" />Enabled</span> : <span className="csDim"><CircleAlert size={14} aria-hidden="true" />Not yet</span>} />
    </Section>

    {ready && <Section id="catalog-sync" title="Catalog on your backend" desc="The checkout charges the prices, stock, discounts, shipping and tax your backend has. Edits are published automatically while you are signed in.">
      <div className="csPad"><CatalogSync showHint /></div>
    </Section>}

    <Section id="stripe-keys" title="Publishable keys" desc="Public keys the checkout loads Stripe.js with. Find them in Stripe › Developers › API keys.">
      <div className="csPad"><div className="caForm">
        <Input label="Test publishable key" vkey="publishableKeyTest" mono value={sp.publishableKeyTest} placeholder="pk_test_…" onChange={v => T(t => { t.publishableKeyTest = v.trim(); })} />
        <Input label="Live publishable key" vkey="publishableKeyLive" mono value={sp.publishableKeyLive} placeholder="pk_live_…" onChange={v => T(t => { t.publishableKeyLive = v.trim(); })} />
      </div>
        <Note><KeyRound size={14} aria-hidden="true" /> Never paste a secret key (sk_…) here — it is a server secret. Set it as STRIPE_SECRET_KEY in your backend (see Server secrets below).</Note>
      </div>
    </Section>

    <Section id="payment-methods" title="Payment methods" desc={`${active} active. Stripe shows each method only where the customer’s country and currency support it.`} bare>
      {PAYMENT_GROUPS.map(([gk, gl]) => <div key={gk} className="csCard csGroupCard" role="group" aria-label={gl}>
        <div className="csGroupHead">{gl}<span>{PAYMENT_METHODS.filter(m => m[2] === gk && sp.paymentMethods.includes(m[0])).length} on</span></div>
        {PAYMENT_METHODS.filter(m => m[2] === gk).map(([k, l, , note]) => <Toggle key={k} id={'pm-' + k} label={l} desc={note} checked={sp.paymentMethods.includes(k)}
          onChange={v => T(t => { t.paymentMethods = v ? [...new Set([...t.paymentMethods, k])] : t.paymentMethods.filter(x => x !== k); })} />)}
      </div>)}
    </Section>

    <Section id="capture" title="Payment capture" desc="When the money is taken from the customer’s card.">
      <div className="csPad"><Choice label="Capture method" value={sp.captureMethod} onChange={set('captureMethod')} options={[
        ['automatic', 'Automatically at checkout', 'The payment is captured as soon as the order is placed.'],
        ['manual', 'Manually', 'Authorize at checkout and capture when you fulfill. Authorizations expire after 7 days for most cards.']]} /></div>
      <SelectRow id="three-ds" label="3D Secure" desc="Extra authentication from the card issuer. Required for most cards in Europe (SCA)." value={sp.threeDSecure} onChange={set('threeDSecure')} options={[['automatic', 'When required (recommended)'], ['any', 'Whenever possible']]} />
      <Toggle id="save-methods" label="Let customers save payment methods" desc="Faster repeat checkout; needed for subscriptions and off-session charges." checked={sp.savePaymentMethods} onChange={set('savePaymentMethods')} />
    </Section>

    <Section id="descriptor" title="Statement descriptor" desc="The text customers see on their bank or card statement.">
      <div className="csPad"><div className="caForm two">
        <Input label="Statement descriptor" vkey="statementDescriptor" counter={22} maxLength={22} value={sp.statementDescriptor} placeholder={s.name.toUpperCase().slice(0, 22)} onChange={v => T(t => { t.statementDescriptor = v; })} />
        <Input label="Shortened descriptor suffix" vkey="statementDescriptorSuffix" counter={22} maxLength={22} value={sp.statementDescriptorSuffix} placeholder="ORDER" onChange={v => T(t => { t.statementDescriptorSuffix = v; })} hint="Optional. Added per payment, e.g. the order number." />
      </div>
        <div className="csStatement" aria-label="Statement preview"><span className="csStmtHead"><span>Date</span><span>Description</span><span>Amount</span></span>
          <span className="csStmtLine"><span>{new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span><span className="mono">{preview || 'YOUR STORE'}</span><span>{money(42, cur)}</span></span></div>
      </div>
    </Section>

    <Section id="currency-tax" title="Currency and tax">
      <SelectRow id="stripe-currency" label="Settlement currency" desc="Currency your Stripe balance and payouts use." value={sp.currency} onChange={set('currency')} options={STRIPE_CURRENCIES.map(k => [k, k.toUpperCase()])} />
      <Toggle id="stripe-tax" label="Calculate tax with Stripe Tax" desc="Stripe works out sales tax, VAT and GST at checkout from the customer’s address (Stripe Tax fees apply). Replaces your manual tax rates for Stripe payments." checked={sp.automaticTax} onChange={set('automaticTax')} />
    </Section>

    <Section id="platform-fee" title="Platform fee" desc="An application fee the platform keeps from each payment (Express and Custom accounts, or direct charges).">
      <div className="csPad"><div className="caForm two">
        <Num label="Fee percentage" value={sp.applicationFeePercent} min={0} max={100} step={0.1} suffix="%" onChange={v => T(t => { t.applicationFeePercent = v; })} />
        <Num label="Fixed fee per order" value={sp.applicationFeeFixed} min={0} step={0.01} prefix={cur.toUpperCase()} onChange={v => T(t => { t.applicationFeeFixed = v; })} />
      </div>
        <div className="csPreview"><span>On a {money(100, cur)} order</span><strong>you keep {money(fee.keep, cur)}</strong><small>The platform keeps {money(fee.fee, cur)}. Stripe’s processing fees are charged on top by Stripe.</small></div>
      </div>
    </Section>

    <Section id="payouts" title="Payouts" desc="How often Stripe sends your balance to your bank account.">
      <SelectRow id="payout-interval" label="Payout schedule" value={sp.payoutSchedule.interval} onChange={v => T(t => { t.payoutSchedule.interval = v; })} options={[['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['manual', 'Manual (you trigger payouts)']]} />
      {sp.payoutSchedule.interval === 'weekly' && <SelectRow label="Payout day" value={sp.payoutSchedule.weeklyAnchor} onChange={v => T(t => { t.payoutSchedule.weeklyAnchor = v; })} options={WEEKDAYS.map(d => [d, d[0].toUpperCase() + d.slice(1)])} />}
      {sp.payoutSchedule.interval === 'monthly' && <SelectRow label="Payout day of the month" value={String(sp.payoutSchedule.monthlyAnchor)} onChange={v => T(t => { t.payoutSchedule.monthlyAnchor = +v; })} options={Array.from({ length: 31 }, (_, i) => [String(i + 1), String(i + 1) + (i === 30 ? ' (or last day)' : '')])} />}
      {sp.payoutSchedule.interval !== 'manual' && <SelectRow id="payout-delay" label="Delay" desc="Days between a payment and its payout. Minimum depends on your country." value={String(sp.payoutSchedule.delayDays)} onChange={v => T(t => { t.payoutSchedule.delayDays = +v; })} options={[['0', 'Minimum for my country'], ...[2, 3, 4, 5, 7, 10, 14, 30].map(d => [String(d), `${d} days`])]} />}
    </Section>

    <Section id="radar" title="Fraud protection" desc="Stripe Radar rules applied to your payments.">
      <Toggle id="radar-block" label="Block payments with a high risk level" desc="Radar blocks payments it scores as high risk." checked={sp.radar.blockHighRisk} onChange={v => T(t => { t.radar.blockHighRisk = v; })} />
      <Toggle id="radar-3ds" label="Review payments that fail 3D Secure" desc="Places them in review instead of charging." checked={sp.radar.review3dsFailed} onChange={v => T(t => { t.radar.review3dsFailed = v; })} />
    </Section>

    <Section id="stripe-billing" title="Billing and subscriptions" desc="Recurring payments and invoices with Stripe Billing.">
      <Toggle id="subscriptions" label="Sell subscriptions" desc="Recurring products charged automatically each period." checked={sp.billing.subscriptions} onChange={v => T(t => { t.billing.subscriptions = v; if (v) t.savePaymentMethods = true; })}>
        <Num label="Free trial (days)" value={sp.billing.trialDays} min={0} max={730} step={1} onChange={v => T(t => { t.billing.trialDays = Math.round(v); })} hint="0 = no trial." />
      </Toggle>
      <Toggle id="customer-portal" label="Customer portal" desc="Customers update cards, download invoices and cancel subscriptions themselves." checked={sp.billing.customerPortal} onChange={v => T(t => { t.billing.customerPortal = v; })} />
      <Toggle id="invoices" label="Send invoices" desc="Email a payable invoice instead of collecting at checkout (B2B, custom orders)." checked={sp.billing.invoices} onChange={v => T(t => { t.billing.invoices = v; })} />
    </Section>

    <Section id="webhooks" title="Webhook endpoint" desc="Add this endpoint in Stripe › Developers › Webhooks (enable “Listen to events on Connected accounts”).">
      <div className="csPad">
        {hook ? <CopyLine label="Webhook endpoint URL" value={hook} /> : <Note tone="info"><Webhook size={14} aria-hidden="true" /> The endpoint is <code>{'{functionsUrl}'}/stripe-webhook</code> — set up your backend in Apps and integrations to see the full URL.</Note>}
        <div className="csInline between"><strong className="csMini">Events to send ({sp.webhookEvents.length} of {STRIPE_WEBHOOK_EVENTS.length})</strong><CopyLine label="event list" value={sp.webhookEvents.join(',')} /></div>
      </div>
      {STRIPE_WEBHOOK_EVENTS.map(([k, d]) => <div key={k} className="csRow compact"><div className="csRowHead">
        <Check label={k} checked={sp.webhookEvents.includes(k)} onChange={v => T(t => { t.webhookEvents = v ? [...new Set([...t.webhookEvents, k])] : t.webhookEvents.filter(x => x !== k); })} />
        <span className="csRowSub grow">{d}</span><CopyLine label={k} value={k} /></div></div>)}
    </Section>

    <ServerSecrets secrets={secrets} />

    <AlternativeMethods s={s} c={c} edit={edit} />
  </>;
}

export function ServerSecrets({ secrets, id = 'server-secrets' }) {
  return <Section id={id} title="Server secrets" desc="Never stored here. Set them in your backend’s environment, e.g. with the Supabase CLI.">
    {secrets.map(x => <Row key={x.name} icon={KeyRound} label={<code>{x.name}</code>} sub={x.description} value={<Pill tone="neutral">server secret — set in your backend</Pill>} />)}
    <div className="csPad"><CopyLine label="supabase secrets command" wrap value={secretsCommand(secrets.map(x => x.name))} /></div>
  </Section>;
}

function AlternativeMethods({ s, c, edit }) {
  const pm = c.settings.payments;
  return <>
    <Section id="alt-methods" title="Alternative and manual methods" desc="Orders by WhatsApp or email, per-product payment links, and payments you collect yourself.">
      <div className="csPad">
        <Select label="Order method" value={s.checkout.mode} onChange={v => edit(st => { st.checkout.mode = v; }, 'payments')} options={CHECKOUT_MODES} hint="How the static storefront sends orders when Stripe is not used: WhatsApp, email, or a payment page per product (Stripe Payment Links, PayPal, Square…)." />
        <div className="caForm two">
          {s.checkout.mode === 'whatsapp' && <Text label="WhatsApp number" value={s.checkout.phone} onChange={v => edit(st => { st.checkout.phone = v; }, 'payments')} hint="International format, e.g. +1 555 123 4567" />}
          {s.checkout.mode === 'email' && <Text label="Order email" type="email" value={s.checkout.email} onChange={v => edit(st => { st.checkout.email = v; }, 'payments')} />}
        </div>
      </div>
      {s.checkout.mode === 'paymentLinks' && <table className="caTable compact csTable"><thead><tr><th>Product</th><th>Payment link</th></tr></thead><tbody>{s.products.map(p => <tr key={p.id}><td>{p.title}</td>
        <td><input className="caInput" type="url" aria-label={`Payment link for ${p.title}`} placeholder="https://buy.stripe.com/…" value={s.checkout.paymentLinks[p.id] || ''} onChange={e => { const v = e.target.value; edit(st => { if (v) st.checkout.paymentLinks[p.id] = v; else delete st.checkout.paymentLinks[p.id]; }, 'payments'); }} /></td></tr>)}</tbody></table>}
    </Section>
    <Section id="manual-methods" title="Manual payment methods" desc="Offered when you create orders and filled into payment-reminder emails as {{payment_instructions}}."
      actions={<Btn icon={Plus} onClick={() => edit((_, x) => { x.settings.payments.manualMethods.push({ id: cid('pm'), name: 'New method', instructions: '', enabled: true }); }, 'payments')}>Add method</Btn>}>
      {pm.manualMethods.map((m, i) => <div key={m.id} className="csRow" role="group" aria-label={m.name}>
        <div className="csRowHead"><Check label={`Enable ${m.name}`} checked={m.enabled} onChange={v => edit((_, x) => { x.settings.payments.manualMethods[i].enabled = v; }, 'payments')} />
          <button type="button" className="csIconBtn" aria-label={`Remove ${m.name}`} onClick={() => edit((_, x) => { x.settings.payments.manualMethods.splice(i, 1); })}><Trash2 size={14} /></button></div>
        <div className="csRowBody"><div className="caForm two"><Text label={`Payment method ${i + 1} name`} value={m.name} onChange={v => edit((_, x) => { x.settings.payments.manualMethods[i].name = v; })} />
          <Area label={`Payment method ${i + 1} instructions`} value={m.instructions} rows={2} onChange={v => edit((_, x) => { x.settings.payments.manualMethods[i].instructions = v; })} /></div></div>
      </div>)}
      {!pm.manualMethods.length && <Note>No manual methods.</Note>}
    </Section>
    <Section id="provider-notes" title="Payment provider notes">
      <div className="csPad"><Area label="Provider notes" value={pm.providerNotes} rows={3} onChange={v => edit((_, x) => { x.settings.payments.providerNotes = v; })} hint="Account names, dashboards, payout schedules — for your team." /></div>
    </Section>
  </>;
}

