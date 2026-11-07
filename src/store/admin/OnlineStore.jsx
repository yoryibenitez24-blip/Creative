// Online Store: Themes (current theme + template library, Customize opens the store builder), Pages, Navigation
// menus and Preferences (SEO, announcement bar, social links). All edits go to the store document.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Paintbrush, ExternalLink, Plus, Trash2, ArrowUp, ArrowDown, Download, FileText } from 'lucide-react';
import { useAdmin, Page, Card, Badge, Btn, Text, Area, Select, Check, Empty, download } from './ui.jsx';
import Gallery from '../Gallery.jsx';
import { createStore, STORE_TEMPLATES } from '../templates.js';
import { renderPage, esc } from '../render.js';
import { PAGE_KEYS, PAGE_LABELS, uid } from '../model.js';
import { POLICY_KEYS, policyText } from './model.js';

export function Themes() {
  const { store, commerce, customize, viewStore, imageUrl, resolver, commit, editCommerce, confirm, notify } = useAdmin();
  const tpl = STORE_TEMPLATES.find(t => t.id === store.templateId);
  const html = useMemo(() => renderPage(store, { page: 'home' }, { mode: 'preview', imageUrl, script: false, small: true }), [store, imageUrl, resolver]); // eslint-disable-line react-hooks/exhaustive-deps
  const shot = useRef(null);
  useEffect(() => {
    const el = shot.current; if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => el.style.setProperty('--s', String(el.clientWidth / 1280)));
    ro.observe(el); return () => ro.disconnect();
  }, []);
  const open = () => { if (!commerce.onboarding.steps.theme) editCommerce(d => { d.onboarding.steps.theme = true; }, 'Theme customized'); customize(); };
  const apply = async id => {
    const t = STORE_TEMPLATES.find(x => x.id === id);
    const r = await confirm({ title: `Use the ${t.name} template?`, confirmLabel: 'Apply template', initial: { mode: 'design' },
      extra: (s, set) => <div className="caRadios" role="radiogroup" aria-label="What to replace">
        <label className="caCheck"><input type="radio" name="tplmode" checked={s.mode === 'design'} onChange={() => set({ mode: 'design' })} /><span>Design only — keep my products, collections, menus and settings</span></label>
        <label className="caCheck"><input type="radio" name="tplmode" checked={s.mode === 'all'} onChange={() => set({ mode: 'all' })} /><span>Everything — replace my products and content with the template’s sample store</span></label>
      </div> });
    if (!r) return;
    const n = createStore(id);
    const next = r.mode === 'all' ? { ...n, id: store.id } : { ...store, templateId: n.templateId, theme: n.theme, layout: n.layout, pages: n.pages, announcement: n.announcement, fallbackArt: n.fallbackArt };
    commit(next, null, 'Apply template ' + t.name); notify(`${t.name} applied`);
  };
  return <Page title="Themes" actions={<Btn icon={ExternalLink} onClick={viewStore}>View store</Btn>}>
    <Card className="caTheme" title="Current theme">
      <div className="caThemeRow">
        <div className="caThemeShot" aria-hidden="true" ref={shot}><iframe title="Current theme preview" srcDoc={html} tabIndex={-1} sandbox="allow-same-origin" /></div>
        <div className="caThemeInfo">
          <h3>{tpl ? tpl.name : 'Custom theme'}</h3>
          {tpl && <p className="caMuted">{tpl.niche}</p>}
          <span className="caSwatches" aria-label="Theme colours">{['background', 'primary', 'accent', 'text'].map(k => <i key={k} title={k} style={{ background: store.theme.colors[k] }} />)}</span>
          <p className="caMuted">{Object.values(store.pages).reduce((n, l) => n + l.length, 0)} sections on {PAGE_KEYS.length} pages · {store.products.filter(p => p.status === 'active').length} active products</p>
          <div className="caInline"><Btn kind="primary" icon={Paintbrush} onClick={open}>Customize</Btn></div>
        </div>
      </div>
    </Card>
    <Card title="Theme library" className="caLibrary" pad={false}>
      <div className="caGalleryWrap"><Gallery onPick={apply} currentId={store.templateId} /></div>
    </Card>
  </Page>;
}

export function PagesPage() {
  const { store, commerce, customize, go } = useAdmin();
  const policyHtml = k => { const p = commerce.settings.policies[k], body = p.body || policyText(k, p, store, commerce);
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(p.title)} – ${esc(store.name)}</title><style>body{font:16px/1.65 system-ui,sans-serif;max-width:720px;margin:48px auto;padding:0 20px;color:#222}h1{font-size:28px}</style></head><body><h1>${esc(p.title)}</h1>${body.split(/\n\s*\n/).map(x => '<p>' + esc(x).replace(/\n/g, '<br>') + '</p>').join('')}</body></html>`; };
  return <Page title="Pages">
    <Card title="Store pages" pad={false}>
      <table className="caTable"><thead><tr><th>Page</th><th>Sections</th><th>Visible</th><th /></tr></thead>
        <tbody>{PAGE_KEYS.map(k => <tr key={k}><td>{PAGE_LABELS[k]}</td><td>{store.pages[k].length}</td><td>{store.pages[k].filter(s => !s.hidden).length}</td>
          <td className="n"><Btn kind="plain" icon={Paintbrush} onClick={customize} aria-label={`Customize ${PAGE_LABELS[k]} page`}>Customize</Btn></td></tr>)}</tbody></table>
      <p className="caHint caCardBody">Pages are edited in the theme editor: pick the page in its top bar.</p>
    </Card>
    <Card title="Policy pages" pad={false}>
      <table className="caTable"><thead><tr><th>Policy</th><th>Status</th><th /></tr></thead>
        <tbody>{POLICY_KEYS.map(k => { const p = commerce.settings.policies[k]; return <tr key={k}><td>{p.title}</td><td>{p.body ? <Badge tone="ok">Written</Badge> : <Badge>Template</Badge>}</td>
          <td className="n"><Btn kind="plain" icon={FileText} onClick={() => go({ page: 'settings', tab: 'policies' })} aria-label={`Edit ${p.title}`}>Edit</Btn>
            <Btn kind="plain" icon={Download} onClick={() => download(k + '-policy.html', policyHtml(k), 'text/html')} aria-label={`Download ${p.title} as HTML`}>HTML</Btn></td></tr>; })}</tbody></table>
      <p className="caHint caCardBody">Add the downloaded policy pages next to your exported store and link them from the footer menu (Navigation › Footer menu › Custom URL).</p>
    </Card>
  </Page>;
}

function TargetPicker({ label, value, onChange, store }) {
  const custom = value.startsWith('url:') || value.startsWith('#');
  const opts = [['home', 'Home'], ['collection:all', 'All products'], ['page:about', 'About page'], ['page:contact', 'Contact page'], ['cart', 'Cart'], ['checkout', 'Checkout'],
    ...store.collections.map(c => ['collection:' + c.id, 'Collection: ' + c.title]), ...store.products.map(p => ['product:' + p.id, 'Product: ' + p.title]), ['custom', 'Custom URL…']];
  return <div className="caTarget">
    <select className="caInput" aria-label={label} value={custom ? 'custom' : value} onChange={e => onChange(e.target.value === 'custom' ? 'url:https://' : e.target.value)}>{opts.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
    {custom && <input className="caInput" aria-label={label + ' URL'} value={value.startsWith('url:') ? value.slice(4) : value} onChange={e => { const x = e.target.value.trim(); onChange(x.startsWith('#') ? x : 'url:' + x); }} placeholder="https://… or mailto:…" />}
  </div>;
}

export function NavigationPage() {
  const { store, editStore } = useAdmin();
  const menu = (key, title) => {
    const items = store.navigation[key];
    const ed = (fn, label) => editStore(d => fn(d.navigation[key]), label);
    return <Card title={title} actions={<Btn icon={Plus} onClick={() => ed(l => { l.push({ id: uid('n'), label: 'New link', target: 'home' }); }, 'Add menu item')}>Add menu item</Btn>}>
      {items.length ? <ol className="caMenu" aria-label={title}>{items.map((it, i) => <li key={it.id}>
        <input className="caInput" aria-label={`${title} item ${i + 1} label`} value={it.label} onChange={e => { const v = e.target.value; ed(l => { l[i].label = v; }, 'Edit menu item'); }} />
        <TargetPicker label={`${title} item ${i + 1} link`} value={it.target} store={store} onChange={v => ed(l => { l[i].target = v; }, 'Edit menu link')} />
        <span className="caMenuBtns">
          <button type="button" className="caIconBtn sm" aria-label={`Move ${it.label} up`} disabled={!i} onClick={() => ed(l => { [l[i - 1], l[i]] = [l[i], l[i - 1]]; }, 'Reorder menu')}><ArrowUp size={13} /></button>
          <button type="button" className="caIconBtn sm" aria-label={`Move ${it.label} down`} disabled={i === items.length - 1} onClick={() => ed(l => { [l[i + 1], l[i]] = [l[i], l[i + 1]]; }, 'Reorder menu')}><ArrowDown size={13} /></button>
          <button type="button" className="caIconBtn sm" aria-label={`Remove ${it.label}`} onClick={() => ed(l => { l.splice(i, 1); }, 'Remove menu item')}><Trash2 size={13} /></button>
        </span></li>)}</ol> : <p className="caMuted">This menu is empty.</p>}
    </Card>;
  };
  return <Page title="Navigation" subtitle="Menus shown in your store header and footer.">{menu('main', 'Main menu')}{menu('footer', 'Footer menu')}</Page>;
}

export function Preferences() {
  const { store, editStore } = useAdmin();
  const title = store.seo.title || store.name, desc = store.seo.description;
  return <Page title="Preferences">
    <Card title="Title and meta description">
      <div className="caSeo" aria-label="Home page search result preview"><span className="caSeoUrl">your-store.example</span><strong>{title}</strong><p>{desc || 'Add a description to control how your store appears in search results.'}</p></div>
      <div className="caForm">
        <Text label="Home page title" value={store.seo.title} placeholder={store.name} onChange={v => editStore(d => { d.seo.title = v; }, 'SEO title')} hint={`${title.length} of 70 characters used`} />
        <Area label="Home page meta description" value={store.seo.description} rows={3} onChange={v => editStore(d => { d.seo.description = v; }, 'SEO description')} hint={`${desc.length} of 160 characters used`} />
      </div>
    </Card>
    <Card title="Announcement bar">
      <Check label="Show announcement bar" checked={store.announcement.enabled} onChange={v => editStore(d => { d.announcement.enabled = v; }, 'Announcement bar')} />
      <div className="caForm two">
        <Text label="Announcement text" value={store.announcement.text} onChange={v => editStore(d => { d.announcement.text = v; }, 'Announcement text')} hint="Marquee style: separate messages with |" wide />
        <Select label="Announcement style" value={store.announcement.style} onChange={v => editStore(d => { d.announcement.style = v; }, 'Announcement style')} options={[['static', 'Static'], ['marquee', 'Scrolling marquee']]} />
        <div className="caField"><span className="caLabel">Announcement link</span><TargetPicker label="Announcement link" value={store.announcement.link || 'home'} store={store} onChange={v => editStore(d => { d.announcement.link = v; }, 'Announcement link')} /></div>
      </div>
    </Card>
    <Card title="Social media">
      <div className="caForm two">{['instagram', 'facebook', 'tiktok', 'youtube', 'x', 'pinterest'].map(k => <Text key={k} label={k === 'x' ? 'X (Twitter)' : k[0].toUpperCase() + k.slice(1)} type="url" placeholder="https://" value={store.social[k]} onChange={v => editStore(d => { d.social[k] = v; }, 'Social links')} />)}</div>
    </Card>
  </Page>;
}
