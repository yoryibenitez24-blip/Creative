// Marketing: campaign notes with a UTM link builder (links copied for social posts, newsletters, ads).
import React, { useState } from 'react';
import { Plus, Copy, Trash2, Pencil } from 'lucide-react';
import { useAdmin, Page, Card, Badge, Btn, Text, Num, Select, Area, Modal, Empty, fmtDate } from './ui.jsx';
import { utmUrl, cid } from './model.js';

const CHANNELS = ['Email', 'Instagram', 'Facebook', 'TikTok', 'Pinterest', 'YouTube', 'Google Ads', 'Influencer', 'Print / QR', 'Other'];
const MEDIUM = { Email: 'email', Instagram: 'social', Facebook: 'social', TikTok: 'social', Pinterest: 'social', YouTube: 'video', 'Google Ads': 'cpc', Influencer: 'referral', 'Print / QR': 'qr', Other: 'other' };

export default function Marketing() {
  const { commerce, store, editCommerce, confirm, notify, fmt } = useAdmin();
  const [edit, setEdit] = useState(null);
  const base = commerce.settings.domains.primary ? 'https://' + commerce.settings.domains.primary + '/' : '';
  const copy = text => navigator.clipboard?.writeText(text).then(() => notify('Link copied'), () => notify('Copy failed — select the link and copy it manually.'));
  const save = c => { editCommerce(d => { const i = d.marketing.campaigns.findIndex(x => x.id === c.id); if (i >= 0) d.marketing.campaigns[i] = c; else d.marketing.campaigns.unshift(c); }, 'Campaign saved'); notify('Campaign saved'); setEdit(null); };
  const blank = () => ({ id: cid('mk'), name: '', channel: 'Instagram', status: 'draft', startDate: new Date().toISOString().slice(0, 10), endDate: '', budget: 0, notes: '', utm: { url: base, source: 'instagram', medium: 'social', campaign: '', content: '', term: '' } });
  return <Page title="Marketing" subtitle="Plan campaigns and build tracked links for every channel." actions={<Btn kind="primary" icon={Plus} onClick={() => setEdit(blank())}>Create campaign</Btn>}>
    <Card title="Campaigns" pad={false}>
      {commerce.marketing.campaigns.length ? <table className="caTable"><thead><tr><th>Campaign</th><th>Channel</th><th>Status</th><th>Dates</th><th className="n">Budget</th><th>Tracked link</th><th /></tr></thead>
        <tbody>{commerce.marketing.campaigns.map(c => { const link = utmUrl(c.utm); return <tr key={c.id}>
          <td><button type="button" className="caLink" onClick={() => setEdit(structuredClone(c))}>{c.name}</button>{c.notes && <small className="caMuted block">{c.notes.slice(0, 80)}</small>}</td>
          <td>{c.channel}</td><td><Badge tone={c.status === 'active' ? 'ok' : c.status === 'draft' ? 'neutral' : 'info'}>{c.status[0].toUpperCase() + c.status.slice(1)}</Badge></td>
          <td>{c.startDate ? fmtDate(c.startDate + 'T12:00:00') : '—'}{c.endDate ? ' – ' + fmtDate(c.endDate + 'T12:00:00') : ''}</td><td className="n">{c.budget ? fmt(c.budget) : '—'}</td>
          <td>{link ? <Btn kind="plain" icon={Copy} onClick={() => copy(link)} aria-label={`Copy link for ${c.name}`}>Copy</Btn> : '—'}</td>
          <td className="n"><button type="button" className="caIconBtn sm" aria-label={`Edit ${c.name}`} onClick={() => setEdit(structuredClone(c))}><Pencil size={13} /></button>
            <button type="button" className="caIconBtn sm" aria-label={`Delete ${c.name}`} onClick={async () => { if (await confirm({ title: `Delete ${c.name}?`, confirmLabel: 'Delete campaign', danger: true })) editCommerce(d => { d.marketing.campaigns = d.marketing.campaigns.filter(x => x.id !== c.id); }, 'Campaign deleted'); }}><Trash2 size={13} /></button></td>
        </tr>; })}</tbody></table>
        : <Empty art="analytics" title="Plan your first campaign" action={<Btn kind="primary" icon={Plus} onClick={() => setEdit(blank())}>Create campaign</Btn>}>Keep campaign notes, budgets and dates together with a UTM-tagged link, so analytics tools on your host can tell where visitors came from.</Empty>}
    </Card>
    <QuickBuilder base={base} store={store} copy={copy} />
    {edit && <CampaignModal value={edit} onClose={() => setEdit(null)} onSave={save} store={store} />}
  </Page>;
}

function UtmFields({ utm, onChange, store }) {
  const up = k => v => onChange({ ...utm, [k]: v });
  return <div className="caForm two">
    <Text label="Destination URL" type="url" value={utm.url} onChange={up('url')} wide placeholder="https://your-store.example/products/item.html" hint="Your published store address plus the page, e.g. /collections/all.html" />
    <Text label="Campaign source" value={utm.source} onChange={up('source')} placeholder="instagram" />
    <Text label="Campaign medium" value={utm.medium} onChange={up('medium')} placeholder="social" />
    <Text label="Campaign name" value={utm.campaign} onChange={up('campaign')} placeholder="summer-sale" />
    <Text label="Campaign content" value={utm.content} onChange={up('content')} placeholder="story-1" />
  </div>;
}

function QuickBuilder({ base, store, copy }) {
  const [utm, setUtm] = useState({ url: base, source: 'newsletter', medium: 'email', campaign: '', content: '', term: '' });
  const link = utmUrl(utm);
  return <Card title="UTM link builder">
    <UtmFields utm={utm} onChange={setUtm} store={store} />
    <div className="caInline"><input className="caInput mono" readOnly aria-label="Tracked link" value={link} placeholder="Enter a destination URL" onFocus={e => e.target.select()} /><Btn icon={Copy} disabled={!link} onClick={() => copy(link)}>Copy link</Btn></div>
  </Card>;
}

function CampaignModal({ value, onClose, onSave, store }) {
  const [c, setC] = useState(value);
  const up = patch => setC(x => ({ ...x, ...patch }));
  return <Modal title={value.name ? 'Edit campaign' : 'Create campaign'} wide onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" disabled={!c.name.trim()} onClick={() => onSave(c)}>Save campaign</Btn></>}>
    <div className="caForm two">
      <Text label="Campaign name" value={c.name} onChange={v => up({ name: v, utm: { ...c.utm, campaign: c.utm.campaign && c.utm.campaign !== slug(c.name) ? c.utm.campaign : slug(v) } })} wide />
      <Select label="Channel" value={c.channel} onChange={v => up({ channel: v, utm: { ...c.utm, source: v.toLowerCase().replace(/[^a-z0-9]+/g, '-'), medium: MEDIUM[v] } })} options={CHANNELS} />
      <Select label="Status" value={c.status} onChange={v => up({ status: v })} options={[['draft', 'Draft'], ['active', 'Active'], ['ended', 'Ended']]} />
      <Text label="Start date" type="date" value={c.startDate} onChange={v => up({ startDate: v })} />
      <Text label="End date" type="date" value={c.endDate} onChange={v => up({ endDate: v })} />
      <Num label="Budget" value={c.budget} min={0} onChange={v => up({ budget: v })} />
      <Area label="Notes" value={c.notes} onChange={v => up({ notes: v })} rows={3} wide />
    </div>
    <h3 className="caSub">Tracked link</h3>
    <UtmFields utm={c.utm} onChange={utm => up({ utm })} store={store} />
    <input className="caInput mono" readOnly aria-label="Campaign tracked link" value={utmUrl(c.utm)} onFocus={e => e.target.select()} />
  </Modal>;
}
const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
