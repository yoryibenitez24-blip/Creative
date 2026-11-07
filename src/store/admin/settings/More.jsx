// Settings › Metafields, Languages, Customer privacy, Security, Developer.
import React, { useMemo, useRef, useState } from 'react';
import { Plus, Download, Upload, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useAdmin, Modal, Btn, Text, Select, Area, download, readText } from '../ui.jsx';
import { normalizeStore } from '../../model.js';
import { normalizeCommerce, createCommerce, METAFIELD_OWNERS, METAFIELD_TYPES, LANGUAGES, cid } from '../model.js';
import { CONSENT_REGIONS, secretReason, scriptHosts, serverSecrets, publicConfig } from '../../integrations.js';
import { Section, Row, Toggle, SelectRow, Menu, Pill, Note, CopyLine } from './kit.jsx';
import { ServerSecrets } from './Payments.jsx';

export function Metafields({ c, edit }) {
  const mf = c.settings.metafields, [dlg, setDlg] = useState(null);
  const i = mf.findIndex(m => m.id === dlg), m = i >= 0 ? mf[i] : null, M = fn => edit((_, x) => fn(x.settings.metafields[i]));
  const add = owner => { const id = cid('mf'); edit((_, x) => { x.settings.metafields.push({ id, owner, name: '', key: '', type: 'single_line_text', description: '' }); }); setDlg(id); };
  return <>
    {METAFIELD_OWNERS.map(([o, l]) => { const list = mf.filter(x => x.owner === o); return <Section key={o} id={'metafields-' + o} title={l} desc={`${list.length} ${list.length === 1 ? 'definition' : 'definitions'} — custom data such as care instructions, materials or gift notes.`}
      actions={<Btn icon={Plus} onClick={() => add(o)}>Add definition</Btn>}>
      {list.length ? list.map(x => <Row key={x.id} label={x.name || 'Untitled'} sub={<code>custom.{x.key || '…'}</code>} value={METAFIELD_TYPES.find(t => t[0] === x.type)[1]}
        menu={<Menu label={x.name || 'Definition'} items={[['Edit', () => setDlg(x.id)], ['Delete', () => edit((_, y) => { y.settings.metafields = y.settings.metafields.filter(z => z.id !== x.id); }), true]]} />} />)
        : <Note>No {l.toLowerCase()} metafields yet.</Note>}
    </Section>; })}
    {m && <Modal title={m.name ? `Edit ${m.name}` : 'Add metafield definition'} onClose={() => setDlg(null)} footer={<Btn kind="primary" onClick={() => setDlg(null)}>Done</Btn>}>
      <div className="caForm two">
        <Text label="Definition name" value={m.name} onChange={v => M(x => { const auto = !x.key || x.key === x.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_'); x.name = v; if (auto) x.key = v.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_'); })} />
        <Text label="Namespace and key" value={m.key} onChange={v => M(x => { x.key = v.toLowerCase().replace(/[^a-z0-9_.]+/g, '_'); })} hint={`custom.${m.key || 'key'}`} />
        <Select label="Applies to" value={m.owner} onChange={v => M(x => { x.owner = v; })} options={METAFIELD_OWNERS} />
        <Select label="Type" value={m.type} onChange={v => M(x => { x.type = v; })} options={METAFIELD_TYPES} />
        <Area label="Description" value={m.description} rows={2} onChange={v => M(x => { x.description = v; })} wide />
      </div>
    </Modal>}
  </>;
}

export function Languages({ c, edit }) {
  const L = c.settings.languages, name = k => LANGUAGES.find(l => l[0] === k)?.[1] || k;
  return <>
    <Section id="lang-default" title="Default language" desc="The language your store is written in.">
      <SelectRow id="primary-language" label="Default language" value={L.primary} onChange={v => edit((_, x) => { x.settings.languages.primary = v; x.settings.languages.published = [...new Set([v, ...x.settings.languages.published])]; })} options={LANGUAGES} />
    </Section>
    <Section id="lang-published" title="Published languages" desc="Languages customers can switch to. Translations are written by you; nothing is machine-translated.">
      {LANGUAGES.filter(([k]) => k !== L.primary).map(([k, l]) => <Toggle key={k} id={'lang-' + k} label={l} checked={L.published.includes(k)} onChange={v => edit((_, x) => { x.settings.languages.published = v ? [...new Set([...x.settings.languages.published, k])] : x.settings.languages.published.filter(y => y !== k); })} />)}
    </Section>
    <Section id="lang-redirect" title="Language detection">
      <Toggle id="auto-redirect" label="Redirect visitors to their browser language" desc={`When it is published. Otherwise they see ${name(L.primary)}.`} checked={L.autoRedirect} onChange={v => edit((_, x) => { x.settings.languages.autoRedirect = v; })} />
    </Section>
  </>;
}

export function Privacy({ c, edit }) {
  const cs = c.settings.integrations.consent, pv = c.settings.privacy, C = fn => edit((_, x) => fn(x.settings.integrations.consent));
  const trackers = ['ga4.measurementId', 'gtm.containerId', 'metaPixel.pixelId', 'tiktokPixel.pixelId', 'pinterestTag.tagId', 'clarity.projectId'].filter(p => { const [a, b] = p.split('.'); return c.settings.integrations[a][b]; }).length;
  return <>
    <Section id="cookie-banner" title="Cookie banner" desc="Ask visitors before analytics and advertising tags run (GDPR, ePrivacy, UK GDPR).">
      <Toggle id="banner-on" label="Show a cookie banner" desc={trackers ? `${trackers} connected ${trackers === 1 ? 'tag waits' : 'tags wait'} for consent. Google tags use Consent Mode v2 defaults.` : 'No tracking tags are connected yet.'} checked={cs.banner} onChange={v => C(x => { x.banner = v; })} />
      {cs.banner && <SelectRow id="banner-region" label="Show the banner to" value={cs.region} onChange={v => C(x => { x.region = v; })} options={CONSENT_REGIONS} />}
      <div className="csPad"><div className="csBannerPreview" aria-label="Banner preview"><p>{pv.cookieText || 'We use cookies to measure visits and improve ads. Analytics and advertising tags load only if you accept.'}</p><div><span>Reject</span><span className="on">Accept</span></div></div></div>
      <div className="csPad"><Area label="Banner text" value={pv.cookieText} rows={2} placeholder="We use cookies to measure visits and improve ads. Analytics and advertising tags load only if you accept." onChange={v => edit((_, x) => { x.settings.privacy.cookieText = v; })} /></div>
    </Section>
    <Section id="data-sale" title="Data sharing opt-out" desc="US state privacy laws (CCPA/CPRA and others).">
      <Toggle id="opt-out" label="Show a “Do not sell or share my personal information” link" desc="Visitors who opt out are treated as having rejected advertising cookies." checked={pv.dataSaleOptOut} onChange={v => edit((_, x) => { x.settings.privacy.dataSaleOptOut = v; })} />
    </Section>
  </>;
}

/** Paths of string values in a document that look like secrets: [{ path, reason }]. */
export function findSecrets(doc, base = '') {
  const out = [];
  const walk = (v, p) => {
    if (typeof v === 'string') { const r = secretReason(v); if (r) out.push({ path: p, reason: r }); }
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}[${i}]`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, p ? `${p}.${k}` : k);
  };
  walk(doc, base); return out;
}

export function Security({ s, c, edit }) {
  const found = useMemo(() => [...findSecrets(s, 'store'), ...findSecrets(c, 'commerce')], [s, c]);
  const csp = `Content-Security-Policy: script-src ${scriptHosts(c).join(' ')} 'unsafe-inline'; frame-src https://js.stripe.com https://challenges.cloudflare.com; object-src 'none'; base-uri 'self'`;
  return <>
    <Section id="secret-scan" title="Secrets check" desc="Your store data is published as a static site. It must never contain secret keys.">
      {found.length ? found.map(f => <Row key={f.path} icon={TriangleAlert} label={<code>{f.path}</code>} sub={f.reason} value={<Pill tone="bad">Remove</Pill>} />)
        : <Row icon={ShieldCheck} label="No secrets found" sub="Checked every value in your store and commerce data." value={<Pill tone="ok">Safe</Pill>} />}
    </Section>
    <ServerSecrets secrets={serverSecrets(c)} id="security-secrets" />
    <Section id="csp" title="Content Security Policy" desc="A header for your host that only allows the scripts your connected services need.">
      <div className="csPad"><CopyLine label="Content-Security-Policy header" wrap value={csp} /></div>
    </Section>
    <Section id="admin-safety" title="Admin safety">
      <Toggle id="confirm-danger" label="Confirm destructive actions" desc="Ask before deleting orders, customers or resetting settings in Developer." checked={c.settings.security.confirmDanger} onChange={v => edit((_, x) => { x.settings.security.confirmDanger = v; })} />
    </Section>
  </>;
}

export function Developer({ dirty }) {
  const { store, commerce, commit, confirm, notify } = useAdmin();
  const file = useRef(null);
  const slug = (store.name || 'store').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'store';
  const ask = async (title, message, label) => !commerce.settings.security.confirmDanger || !!(await confirm({ title, message, confirmLabel: label, danger: true }));
  const exportJson = () => { download(`${slug}-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ kind: 'zertake-backup', version: 1, exportedAt: new Date().toISOString(), store, commerce }, null, 2), 'application/json'); notify('Backup downloaded'); };
  const importJson = async f => {
    try {
      const data = JSON.parse(await readText(f));
      const st = data?.kind === 'zertake-backup' ? data.store : data?.kind === 'store' ? data : null, cm = data?.kind === 'zertake-backup' ? data.commerce : data?.kind === 'commerce' ? data : null;
      if (!st && !cm) throw new Error('This file is not a Zertake backup.');
      if (!(await confirm({ title: 'Restore backup?', message: `This replaces ${[st && 'the store', cm && 'orders, customers and settings'].filter(Boolean).join(' and ')} with the backup from ${data.exportedAt ? new Date(data.exportedAt).toLocaleString() : 'the file'}.`, confirmLabel: 'Restore', danger: true }))) return;
      const ns = st ? normalizeStore(st) : null, nc = cm ? normalizeCommerce(cm) : null;
      const leaks = nc ? findSecrets(nc) : [];
      commit(ns, nc, 'Restore backup'); notify(leaks.length ? `Backup restored — ${leaks.length} secret-looking value(s) were dropped` : 'Backup restored');
    } catch (e) { notify(e instanceof SyntaxError ? 'The file is not valid JSON.' : e.message); }
  };
  const reset = async () => { if (await ask('Reset all settings?', 'Payments, checkout, shipping, taxes, notifications, policies and integrations go back to their defaults. Orders, customers and products are kept.', 'Reset settings')) { commit(null, normalizeCommerce({ ...commerce, settings: createCommerce(store).settings }), 'Reset settings'); notify('Settings reset'); } };
  const wipe = async (k, label) => { if (await ask(`Delete all ${label}?`, `All ${commerce[k].length} ${label} are permanently deleted from this store. Export a backup first if you might need them.`, `Delete ${label}`)) { commit(null, normalizeCommerce({ ...commerce, [k]: [] }), `Delete all ${label}`); notify(`All ${label} deleted`); } };
  return <>
    <Section id="backup" title="Backup" desc="Your store lives in this browser. Export a JSON backup regularly and before big changes.">
      <Row icon={Download} label="Export backup" sub="Store, products, orders, customers and settings in one JSON file." value={<Btn onClick={exportJson}>Export JSON</Btn>} />
      <Row icon={Upload} label="Restore from backup" sub="Replaces the current data with a Zertake backup file." value={<Btn disabled={dirty} onClick={() => file.current?.click()}>Import JSON</Btn>} />
      <input ref={file} type="file" accept="application/json,.json" hidden aria-label="Backup file" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) importJson(f); }} />
    </Section>
    <Section id="public-config" title="Public checkout config" desc="What the storefront checkout receives (publicConfig). Contains no secrets.">
      <div className="csPad"><pre className="csCode">{JSON.stringify(publicConfig(commerce), null, 2)}</pre></div>
    </Section>
    <Section id="danger" title="Danger zone" desc={dirty ? 'Save or discard your changes first.' : 'These actions cannot be undone.'}>
      <Row label="Reset settings" sub="Back to defaults; orders, customers and products stay." value={<Btn kind="danger" disabled={dirty} onClick={reset}>Reset settings</Btn>} className="danger" />
      <Row label="Delete all orders" sub={`${commerce.orders.length} orders`} value={<Btn kind="danger" disabled={dirty || !commerce.orders.length} onClick={() => wipe('orders', 'orders')}>Delete orders</Btn>} className="danger" />
      <Row label="Delete all customers" sub={`${commerce.customers.length} customers`} value={<Btn kind="danger" disabled={dirty || !commerce.customers.length} onClick={() => wipe('customers', 'customers')}>Delete customers</Btn>} className="danger" />
    </Section>
  </>;
}
