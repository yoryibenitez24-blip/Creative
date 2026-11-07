// Settings › Checkout and Customer accounts.
import React from 'react';
import { ShieldCheck } from 'lucide-react';
import { Text, Area, Num } from '../ui.jsx';
import { FIELD_MODES } from '../model.js';
import { validateField, backendReady } from '../../integrations.js';
import { Section, Toggle, SelectRow, Choice, Pill, Row, Note } from './kit.jsx';

export function Checkout({ s, c, edit, open }) {
  const ck = c.settings.checkout, K = fn => edit((_, x) => fn(x.settings.checkout), 'payments');
  const set = k => v => K(x => { x[k] = v; });
  const site = c.settings.integrations.turnstile.siteKey, tsReady = !!site && !validateField('turnstile.siteKey', site);
  const mail = c.settings.integrations.email.provider !== 'none';
  return <>
    <Section id="contact-method" title="Customer contact method" desc="How customers identify themselves at checkout and receive order updates.">
      <div className="csPad"><Choice label="Customer contact method" value={ck.contactMethod} onChange={set('contactMethod')} options={[
        ['email', 'Email', 'Customers enter an email address. Order updates are sent by email.'],
        ['phone_or_email', 'Phone number or email', 'Customers choose. SMS updates need an SMS provider in your backend.']]} /></div>
    </Section>

    <Section id="customer-info" title="Customer information" desc="Fields shown in the checkout form.">
      <SelectRow id="full-name" label="Full name" value={ck.fullName} onChange={set('fullName')} options={[['last_only', 'Only require last name'], ['first_and_last', 'Require first and last name']]} />
      <SelectRow id="company" label="Company name" value={ck.company} onChange={set('company')} options={FIELD_MODES} />
      <SelectRow id="address2" label="Address line 2 (apartment, unit, etc.)" value={ck.address2} onChange={set('address2')} options={FIELD_MODES} />
      <SelectRow id="shipping-phone" label="Shipping address phone number" value={ck.shippingPhone} onChange={set('shippingPhone')} options={FIELD_MODES} />
      <Toggle id="autocomplete" label="Address autocomplete" desc="Suggest addresses as customers type (uses the browser’s autofill)." checked={ck.addressAutocomplete} onChange={set('addressAutocomplete')} />
    </Section>

    <Section id="marketing-options" title="Marketing options" desc="Let customers sign up for marketing at checkout.">
      <Toggle id="optin-email" label="Email" desc="Show a sign-up option for email marketing." checked={ck.marketing.email} onChange={v => K(x => { x.marketing.email = v; })} />
      <Toggle id="optin-sms" label="SMS" desc="Show a sign-up option for text messages (needs consent wording for your region)." checked={ck.marketing.sms} onChange={v => K(x => { x.marketing.sms = v; })} />
      <Toggle id="optin-prechecked" label="Preselect the sign-up option" desc="Not allowed in the EU and UK — consent must be an active choice." checked={ck.marketing.preChecked} onChange={v => K(x => { x.marketing.preChecked = v; })} />
    </Section>

    <Section id="tipping" title="Tipping" desc="Let customers add a tip to support your business.">
      <Toggle id="tipping-on" label="Show tipping options at checkout" checked={ck.tipping.enabled} onChange={v => K(x => { x.tipping.enabled = v; })}>
        <div className="caForm three">{ck.tipping.presets.map((p, i) => <Num key={i} label={`Tip preset ${i + 1}`} value={p} min={0} max={100} step={1} suffix="%" onChange={v => K(x => { x.tipping.presets[i] = Math.round(v); })} />)}</div>
      </Toggle>
    </Section>

    <Section id="checkout-page" title="Checkout page" desc="Notes, consent and what customers read before paying.">
      <Toggle id="order-notes" label="Order notes" desc="Customers can add special instructions." checked={ck.orderNotes} onChange={set('orderNotes')} />
      <Toggle id="terms" label="Require agreement to terms" desc="A checkbox linking to your policies must be ticked to pay." checked={ck.termsCheckbox} onChange={set('termsCheckbox')} />
      <div className="csRow"><div className="csRowBody tight"><div className="caForm">
        <Text label="Shipping note" value={s.checkout.shippingNote} onChange={v => edit(st => { st.checkout.shippingNote = v; }, 'payments')} hint="Shown in the cart and at checkout, e.g. “Free shipping over $75”." />
        <Area label="Checkout note" value={s.checkout.note} rows={3} onChange={v => edit(st => { st.checkout.note = v; }, 'payments')} hint="Extra text on the checkout page." />
      </div></div></div>
    </Section>

    <Section id="abandoned" title="Abandoned checkouts" desc="Remind customers who left checkout without paying.">
      <Toggle id="abandoned-on" label="Send abandoned checkout emails automatically" desc={mail ? 'Sent by your backend through your email provider.' : 'Needs an email provider (Apps and integrations › Email) and a backend.'} checked={ck.abandoned.enabled} onChange={v => K(x => { x.abandoned.enabled = v; })}>
        <div className="caForm two">
          <div className="csInlineSelect"><SelectRow label="Send after" value={String(ck.abandoned.delayHours)} onChange={v => K(x => { x.abandoned.delayHours = +v; })} options={[['1', '1 hour'], ['6', '6 hours'], ['10', '10 hours (recommended)'], ['24', '24 hours']]} /></div>
          <div className="csInlineSelect"><SelectRow label="Send to" value={ck.abandoned.audience} onChange={v => K(x => { x.abandoned.audience = v; })} options={[['all', 'Anyone who abandons checkout'], ['subscribers', 'Email subscribers only']]} /></div>
        </div>
      </Toggle>
    </Section>

    <Section id="bot-protection" title="Bot protection" desc="Stop card-testing bots and fake orders with Cloudflare Turnstile.">
      <Toggle id="turnstile" label="Verify customers with Turnstile" desc="An invisible challenge before payment; the backend verifies the token with TURNSTILE_SECRET_KEY." checked={ck.turnstile} onChange={set('turnstile')} />
      <Row icon={ShieldCheck} label="Turnstile site key" value={tsReady ? <Pill tone="ok">Ready</Pill> : <Pill>Not set</Pill>} onClick={() => open('apps', 'app-turnstile')} />
    </Section>

    <Section id="order-collection" title="Order collection" desc="For stores without Stripe: where the storefront sends orders.">
      <div className="csPad"><Text label="Order webhook URL" type="url" value={c.settings.backend.orderWebhookUrl} onChange={v => edit((_, x) => { x.settings.backend.orderWebhookUrl = v.trim(); })} placeholder="https://example.com/orders" hint="The storefront POSTs each order there as JSON (see Analytics › Connect a backend)." /></div>
    </Section>
  </>;
}

export function CustomerAccounts({ c, edit, open }) {
  const a = c.settings.customerAccounts, A = fn => edit((_, x) => fn(x.settings.customerAccounts));
  const ready = backendReady(c);
  return <>
    <Section id="accounts-mode" title="Customer accounts" desc="Let customers sign in to see orders, track deliveries and check out faster.">
      <div className="csPad"><Choice label="Customer accounts" value={a.mode} onChange={v => A(x => { x.mode = v; })} options={[
        ['disabled', 'Don’t use accounts', 'Customers check out as guests.'],
        ['optional', 'Accounts are optional', 'Customers can check out with or without an account.'],
        ['required', 'Accounts are required', 'Customers must sign in before they check out.']]} /></div>
      {a.mode !== 'disabled' && !ready && <Note tone="info">Sign-in needs a backend. Connect Supabase (Auth) in <button type="button" className="caLink" onClick={() => open('apps', 'app-supabase')}>Apps and integrations</button>.</Note>}
    </Section>
    <Section id="accounts-login" title="Sign-in" desc="How customers prove who they are.">
      <SelectRow id="login-method" label="Sign-in method" value={a.loginMethod} onChange={v => A(x => { x.loginMethod = v; })} options={[['code', 'One-time code by email (passwordless)'], ['password', 'Email and password']]} />
    </Section>
    <Section id="accounts-features" title="Self-serve" desc="What customers can do from their account.">
      <Toggle id="self-returns" label="Self-serve returns" desc="Customers request returns for eligible items; you approve them in Orders." checked={a.selfServeReturns} onChange={v => A(x => { x.selfServeReturns = v; })} />
      <Toggle id="store-credit" label="Store credit" desc="Refund to store credit that customers spend on their next order." checked={a.storeCredit} onChange={v => A(x => { x.storeCredit = v; })} />
    </Section>
  </>;
}
