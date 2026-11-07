import React, { useMemo, useRef, useState } from 'react';
import { Plus, Trash2, Copy, Eye, EyeOff, GripVertical, ChevronUp, ChevronDown, Search, FileUp, FileDown, Camera, Upload, X, ArrowLeft, ArrowRight, Lock } from 'lucide-react';
import { SECTIONS, SECTION_GROUPS, addableSections, PRODUCT_BLOCKS } from './sections.js';
import { FONT_STACKS, CURRENCIES, CHECKOUT_MODES, REQUIRED, PAGE_LABELS, newSection, newProduct, uid, slugify, categories, productsToCsv, importProductsCsv, CSV_COLUMNS, variantPrice, collectionProducts } from './model.js';
import { Field, TextInput, TextArea, Select, Toggle, Segmented, ColorField, LinkPicker, ImageField, SchemaField, NumField, ValueSlider } from './fields.jsx';
import { formatMoney } from './render.js';

const move = (arr, from, to) => { const a = [...arr]; const [x] = a.splice(from, 1); a.splice(to, 0, x); return a; };
const sectionName = (sec) => SECTIONS[sec.type]?.label || sec.type;

// ---------------------------------------------------------------- Sections list
export function SectionsPanel({ store, page, selectedId, onSelect, edit }) {
  const list = store.pages[page];
  const [adding, setAdding] = useState(false);
  const drag = useRef(null);
  const [over, setOver] = useState(null);
  const counts = {}; list.forEach(s => { counts[s.type] = (counts[s.type] || 0) + 1; });
  const seen = {};
  const names = list.map(s => { seen[s.type] = (seen[s.type] || 0) + 1; return sectionName(s) + (counts[s.type] > 1 ? ' ' + seen[s.type] : ''); });
  const reorder = (from, to) => { if (from === to || to < 0 || to >= list.length) return; edit(d => { d.pages[page] = move(d.pages[page], from, to); }, 'Reorder sections'); };
  const add = type => {
    const sec = newSection(type);
    edit(d => { const l = d.pages[page]; const i = l.findIndex(s => s.id === selectedId); l.splice(i >= 0 ? i + 1 : l.length, 0, sec); }, 'Add section');
    onSelect(sec.id); setAdding(false);
  };
  const fixed = (id, label) => <li className={'stSecRow fixed' + (selectedId === id ? ' on' : '')}><span className="stGrip" /><button type="button" className="stSecName" aria-pressed={selectedId === id} onClick={() => onSelect(id)}>{label}</button><Lock size={12} className="stDim" aria-hidden="true" /></li>;
  return <div className="stPanelBody">
    <p className="stHeadRow"><span>{PAGE_LABELS[page]} page</span><small>{list.length} sections</small></p>
    <ul className="stSecList" aria-label="Sections">
      {fixed('announcement', 'Announcement bar')}
      {fixed(store.layout.header.id, 'Header')}
      {list.map((s, i) => {
        const req = REQUIRED[page] === s.type, n = names[i];
        return <li key={s.id} className={'stSecRow' + (selectedId === s.id ? ' on' : '') + (s.hidden ? ' hidden' : '') + (over === i ? ' over' : '')} draggable
          onDragStart={e => { drag.current = i; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', s.id); }}
          onDragOver={e => { e.preventDefault(); setOver(i); }} onDragLeave={() => setOver(o => o === i ? null : o)}
          onDrop={e => { e.preventDefault(); setOver(null); if (drag.current != null) reorder(drag.current, i); drag.current = null; }} onDragEnd={() => setOver(null)}>
          <span className="stGrip" title="Drag to reorder" aria-hidden="true"><GripVertical size={13} /></span>
          <button type="button" className="stSecName" aria-pressed={selectedId === s.id} onClick={() => onSelect(s.id)}>{n}</button>
          <span className="stRowBtns">
            <button type="button" className="insIcon" aria-label={`Move ${n} up`} disabled={i === 0} onClick={() => reorder(i, i - 1)}><ChevronUp size={13} /></button>
            <button type="button" className="insIcon" aria-label={`Move ${n} down`} disabled={i === list.length - 1} onClick={() => reorder(i, i + 1)}><ChevronDown size={13} /></button>
            {!req && <button type="button" className="insIcon" aria-label={(s.hidden ? 'Show ' : 'Hide ') + n} aria-pressed={!s.hidden} onClick={() => edit(d => { const x = d.pages[page].find(y => y.id === s.id); x.hidden = !x.hidden; }, s.hidden ? 'Show section' : 'Hide section')}>{s.hidden ? <EyeOff size={13} /> : <Eye size={13} />}</button>}
            {!req && <button type="button" className="insIcon" aria-label={'Duplicate ' + n} onClick={() => { const c = { ...structuredClone(s), id: uid('s') }; edit(d => { d.pages[page].splice(i + 1, 0, c); }, 'Duplicate section'); onSelect(c.id); }}><Copy size={13} /></button>}
            {!req && <button type="button" className="insIcon" aria-label={'Delete ' + n} onClick={() => { edit(d => { d.pages[page] = d.pages[page].filter(y => y.id !== s.id); }, 'Delete section'); if (selectedId === s.id) onSelect(null); }}><Trash2 size={13} /></button>}
          </span>
        </li>;
      })}
      {fixed(store.layout.footer.id, 'Footer')}
    </ul>
    <button type="button" className="stBtn wide" aria-expanded={adding} onClick={() => setAdding(a => !a)}><Plus size={14} />Add section</button>
    {adding && <div className="stLibrary" role="group" aria-label="Section library">
      {SECTION_GROUPS.map(g => { const items = addableSections(page).filter(x => x.group === g); return items.length ? <div key={g}><p className="stGroupTitle">{g}</p>
        <div className="stLibGrid">{items.map(x => <button key={x.type} type="button" className="stLibItem" aria-label={'Add ' + x.label} onClick={() => add(x.type)}>{x.label}</button>)}</div></div> : null; })}
    </div>}
  </div>;
}

// ---------------------------------------------------------------- Section settings (right panel)
export function SectionInspector({ store, page, selectedId, edit, env }) {
  if (selectedId === 'announcement') {
    const a = store.announcement;
    return <Inspector title="Announcement bar">
      <Toggle label="Show announcement bar" value={a.enabled} onChange={v => edit(d => { d.announcement.enabled = v; }, 'Announcement')} />
      <TextInput label="Announcement text" value={a.text} onChange={v => edit(d => { d.announcement.text = v; }, 'Announcement', 'ann-text')} />
      <Segmented label="Style" value={a.style} options={[['static', 'Static'], ['marquee', 'Scrolling ticker']]} onChange={v => edit(d => { d.announcement.style = v; }, 'Announcement')} />
      <p className="stHint">Separate several messages with “|”.</p>
      <LinkPicker label="Announcement link" value={a.link || 'home'} store={store} onChange={v => edit(d => { d.announcement.link = v; }, 'Announcement')} />
      <p className="stHint">The bar uses the theme’s primary colours and appears on every page.</p>
    </Inspector>;
  }
  const global = [store.layout.header, store.layout.footer].find(s => s.id === selectedId);
  const sec = global || store.pages[page].find(s => s.id === selectedId);
  if (!sec) return <div className="stEmpty"><p>Select a section in the list or click it in the preview to edit its settings.</p></div>;
  const def = SECTIONS[sec.type];
  const set = (k, v, coalesce) => edit(d => {
    const t = global ? d.layout[sec.type] : d.pages[page].find(x => x.id === sec.id);
    t.settings[k] = v;
  }, def.label, coalesce ? sec.id + k : undefined);
  return <Inspector title={def.label} note={REQUIRED[page] === sec.type ? 'Required on this page — it can be moved but not removed.' : global ? 'Shared by every page.' : null}>
    {sec.type === 'header' && <>
      <Segmented label="Header style" value={store.theme.headerStyle} options={[['split', 'Split'], ['left', 'Left'], ['centered', 'Centered'], ['minimal', 'Minimal'], ['pill', 'Pill'], ['search', 'Search']]} onChange={v => edit(d => { d.theme.headerStyle = v; }, 'Header style')} />
      <LogoFields store={store} edit={edit} env={env} />
      <p className="stHint">Menu links are edited under Design → Navigation.</p>
    </>}
    {def.fields.filter(f => !f.show || f.show(sec.settings)).map(f => f.type === 'blocks' ? <BlocksField key={f.key} blocks={sec.settings.blocks || []} env={env}
      onChange={(fn, label, key) => edit(d => { const t = global ? d.layout[sec.type] : d.pages[page].find(x => x.id === sec.id); fn(t.settings.blocks); }, label, key)} /> : <SchemaField key={f.key} field={f} value={sec.settings[f.key]} env={env}
      onChange={v => set(f.key, v, ['text', 'textarea'].includes(f.type))} />)}
    {sec.type === 'footer' && <p className="stHint">Footer links are edited under Design → Navigation; social links and contact details in Settings.</p>}
  </Inspector>;
}

/** Product-page blocks: toggle, reorder (also by dragging on the canvas), edit, add, remove. */
function BlocksField({ blocks, onChange, env }) {
  const [open, setOpen] = useState(-1), [adding, setAdding] = useState('');
  const mv = (i, d) => { onChange(b => { const [x] = b.splice(i, 1); b.splice(i + d, 0, x); }, 'Reorder blocks'); setOpen(-1); };
  return <div className="stList"><span className="stFieldLabel">Blocks — drag them on the page or use the arrows</span>
    {blocks.map((b, i) => { const def = PRODUCT_BLOCKS[b.type]; if (!def) return null; const name = def.label; return <div key={i} className={'stListItem' + (open === i ? ' open' : '') + (b.on ? '' : ' off')}>
      <div className="stListHead">
        <input type="checkbox" className="stCheckbox" aria-label={'Show ' + name} checked={!!b.on} onChange={e => { const on = e.target.checked; onChange(x => { x[i].on = on; }, on ? 'Show block' : 'Hide block'); }} />
        <button type="button" className="stListTitle" aria-expanded={open === i} aria-label={'Edit block ' + name} onClick={() => setOpen(open === i ? -1 : i)}>{open === i ? <ChevronDown size={13} /> : <ChevronUp size={13} style={{ transform: 'rotate(90deg)' }} />}<span>{name}</span></button>
        <button type="button" className="insIcon" aria-label={`Move block ${name} up`} disabled={!i} onClick={() => mv(i, -1)}><ChevronUp size={13} /></button>
        <button type="button" className="insIcon" aria-label={`Move block ${name} down`} disabled={i === blocks.length - 1} onClick={() => mv(i, 1)}><ChevronDown size={13} /></button>
        <button type="button" className="insIcon" aria-label={'Remove block ' + name} onClick={() => onChange(x => { x.splice(i, 1); }, 'Remove block')}><Trash2 size={13} /></button>
      </div>
      {open === i && <div className="stListBody">{def.hint && <p className="stHint">{def.hint}</p>}{def.fields.length ? def.fields.map(f => <SchemaField key={f.key} field={{ ...f, label: name + ' – ' + f.label.toLowerCase() }} value={b[f.key]} env={env}
        onChange={v => onChange(x => { x[i][f.key] = v; }, name, 'blk' + i + f.key)} />) : <p className="stHint">No settings.</p>}</div>}
    </div>; })}
    <div className="stPair">
      <Select bare label="Block to add" value={adding} options={[['', 'Add a block…'], ...Object.entries(PRODUCT_BLOCKS).map(([k, d]) => [k, d.label])]} onChange={setAdding} />
      <button type="button" className="stBtn" disabled={!adding} onClick={() => { const t = adding; onChange(x => { x.push({ type: t, on: true, ...structuredClone(PRODUCT_BLOCKS[t].defaults) }); }, 'Add block'); setAdding(''); }}><Plus size={13} />Add block</button>
    </div>
  </div>;
}

const Inspector = ({ title, note, children }) => <div className="stInspector" aria-label={title + ' settings'} role="group">
  <div className="insTitle"><span>{title}</span></div>{note && <p className="stHint pad">{note}</p>}<div className="stFields">{children}</div></div>;

function LogoFields({ store, edit, env }) {
  return <>
    <TextInput label="Logo text" value={store.logo.text} onChange={v => edit(d => { d.logo.text = v; }, 'Logo', 'logo-text')} />
    <ImageField label="Logo image" value={store.logo.image} imageUrl={env.imageUrl} onUpload={env.upload} onChange={v => edit(d => { d.logo.image = v; }, 'Logo')} />
    {store.logo.image && <ValueSlider label="Logo height" value={store.logo.height} min={16} max={120} format={v => v + ' px'} onChange={v => edit(d => { d.logo.height = v; }, 'Logo', 'logo-h')} />}
  </>;
}

// ---------------------------------------------------------------- Theme
const COLOR_LABELS = [['background', 'Background'], ['surface', 'Surface'], ['text', 'Text'], ['muted', 'Muted text'], ['primary', 'Primary'], ['primaryText', 'Text on primary'], ['accent', 'Accent'], ['border', 'Borders']];
export function ThemePanel({ store, edit, env }) {
  const t = store.theme, fonts = Object.entries(FONT_STACKS).map(([k, [l]]) => [k, l]);
  const th = (fn, label, key) => edit(d => fn(d.theme), label, key);
  return <div className="stPanelBody stFields">
    <p className="stGroupTitle">Colours</p>
    <div className="stColors">{COLOR_LABELS.map(([k, l]) => <ColorField key={k} label={l + ' colour'} value={t.colors[k]} onChange={v => th(x => { x.colors[k] = v; }, 'Theme colour', 'color-' + k)} />)}</div>
    <p className="stGroupTitle">Typography</p>
    <Select label="Heading font" value={t.fonts.heading} options={fonts} onChange={v => th(x => { x.fonts.heading = v; }, 'Heading font')} />
    <Select label="Body font" value={t.fonts.body} options={fonts} onChange={v => th(x => { x.fonts.body = v; }, 'Body font')} />
    <ValueSlider label="Heading weight" value={t.headingWeight} min={300} max={900} step={100} format={v => String(v)} onChange={v => th(x => { x.headingWeight = v; }, 'Heading weight', 'hw')} />
    <Segmented label="Heading size" value={t.headingScale} options={[['regular', 'Regular'], ['large', 'Large'], ['huge', 'Huge']]} onChange={v => th(x => { x.headingScale = v; }, 'Heading size')} />
    <Segmented label="Letter spacing" value={t.tracking} options={[['tight', 'Tight'], ['normal', 'Normal'], ['wide', 'Wide']]} onChange={v => th(x => { x.tracking = v; }, 'Letter spacing')} />
    <Segmented label="Heading case" value={t.headingCase} options={[['none', 'Normal'], ['uppercase', 'UPPERCASE']]} onChange={v => th(x => { x.headingCase = v; }, 'Heading case')} />
    <p className="stGroupTitle">Shape & layout</p>
    <ValueSlider label="Corner radius" value={t.radius} min={0} max={32} format={v => v + ' px'} onChange={v => th(x => { x.radius = v; }, 'Corner radius', 'radius')} />
    <Segmented label="Buttons" value={t.buttons} options={[['solid', 'Solid'], ['outline', 'Outline'], ['pill', 'Pill'], ['sharp', 'Sharp']]} onChange={v => th(x => { x.buttons = v; }, 'Button style')} />
    <Segmented label="Product cards" value={t.cardStyle} options={[['plain', 'Plain'], ['card', 'Card'], ['bordered', 'Bordered']]} onChange={v => th(x => { x.cardStyle = v; }, 'Card style')} />
    <Segmented label="Image shape" value={t.imageRatio} options={[['square', 'Square'], ['portrait', 'Portrait'], ['landscape', 'Landscape']]} onChange={v => th(x => { x.imageRatio = v; }, 'Image shape')} />
    <Segmented label="Shadows" value={t.shadow} options={[['none', 'None'], ['soft', 'Soft'], ['strong', 'Strong']]} onChange={v => th(x => { x.shadow = v; }, 'Shadows')} />
    <Segmented label="Spacing" value={t.density} options={[['compact', 'Compact'], ['comfortable', 'Comfortable'], ['airy', 'Airy']]} onChange={v => th(x => { x.density = v; }, 'Spacing')} />
    <Segmented label="Header style" value={t.headerStyle} options={[['split', 'Split'], ['left', 'Left'], ['centered', 'Centered'], ['minimal', 'Minimal'], ['pill', 'Pill'], ['search', 'Search']]} onChange={v => th(x => { x.headerStyle = v; }, 'Header style')} />
    <p className="stGroupTitle">Logo</p>
    <LogoFields store={store} edit={edit} env={env} />
  </div>;
}

// ---------------------------------------------------------------- Navigation
export function NavPanel({ store, edit }) {
  const menu = (key, title) => {
    const list = store.navigation[key];
    return <div className="stMenu"><p className="stGroupTitle">{title}</p>
      {list.map((n, i) => <div key={n.id} className="stMenuItem">
        <div className="stMenuTop"><input className="stInput" aria-label={`${title} link ${i + 1} label`} value={n.label} onChange={e => { const v = e.target.value; edit(d => { d.navigation[key][i].label = v; }, 'Menu', 'nav' + n.id); }} />
          <button type="button" className="insIcon" aria-label={`Move ${title} link ${i + 1} up`} disabled={!i} onClick={() => edit(d => { d.navigation[key] = move(d.navigation[key], i, i - 1); }, 'Menu')}><ChevronUp size={13} /></button>
          <button type="button" className="insIcon" aria-label={`Move ${title} link ${i + 1} down`} disabled={i === list.length - 1} onClick={() => edit(d => { d.navigation[key] = move(d.navigation[key], i, i + 1); }, 'Menu')}><ChevronDown size={13} /></button>
          <button type="button" className="insIcon" aria-label={`Delete ${title} link ${i + 1}`} onClick={() => edit(d => { d.navigation[key].splice(i, 1); }, 'Menu')}><Trash2 size={13} /></button></div>
        <LinkPicker label={`${title} link ${i + 1} target`} value={n.target} store={store} onChange={v => edit(d => { d.navigation[key][i].target = v; }, 'Menu')} />
      </div>)}
      <button type="button" className="stBtn ghost wide" onClick={() => edit(d => { d.navigation[key].push({ id: uid('n'), label: 'New link', target: 'collection:all' }); }, 'Menu')}><Plus size={13} />Add link to {title.toLowerCase()}</button>
    </div>;
  };
  return <div className="stPanelBody stFields">{menu('main', 'Main menu')}{menu('footer', 'Footer menu')}</div>;
}

// ---------------------------------------------------------------- Settings
export function SettingsPanel({ store, edit }) {
  const ck = store.checkout;
  const s = (fn, label, key) => edit(fn, label, key);
  return <div className="stPanelBody stFields">
    <p className="stGroupTitle">Store</p>
    <TextInput label="Store name" value={store.name} onChange={v => s(d => { d.name = v; }, 'Store name', 'name')} />
    <Select label="Currency" value={store.currency.code} options={CURRENCIES.map(([c]) => [c, c])} onChange={v => s(d => { d.currency = { code: v, locale: CURRENCIES.find(x => x[0] === v)[1] }; }, 'Currency')} />
    <p className="stGroupTitle">Checkout</p>
    <Select label="Checkout mode" value={ck.mode} options={CHECKOUT_MODES} onChange={v => s(d => { d.checkout.mode = v; }, 'Checkout mode')} />
    {ck.mode === 'whatsapp' && <TextInput label="WhatsApp number (with country code)" value={ck.phone} placeholder="15551234567" onChange={v => s(d => { d.checkout.phone = v; }, 'Checkout', 'ck-phone')} />}
    {ck.mode === 'email' && <TextInput label="Order email" type="email" value={ck.email} onChange={v => s(d => { d.checkout.email = v; }, 'Checkout', 'ck-email')} />}
    {ck.mode === 'paymentLinks' && <div className="stPayLinks"><p className="stHint">Paste a payment link for each product (e.g. a Stripe Payment Link, PayPal.me or Gumroad URL). Product editor → Payment link edits the same value.</p>
      {store.products.map(p => <TextInput key={p.id} label={'Payment link for ' + p.title} value={ck.paymentLinks[p.id] || ''} placeholder="https://" onChange={v => s(d => { if (v.trim()) d.checkout.paymentLinks[p.id] = v; else delete d.checkout.paymentLinks[p.id]; }, 'Payment link', 'pl' + p.id)} />)}</div>}
    {ck.mode !== 'none' && <TextInput label="Shipping note" value={ck.shippingNote} onChange={v => s(d => { d.checkout.shippingNote = v; }, 'Checkout', 'ck-ship')} />}
    {ck.mode !== 'none' && <Field label={'Free shipping from (' + store.currency.code + ', 0 = off)'}><NumField label="Free shipping threshold" value={ck.freeShipping} min={0} step={1} onChange={v => s(d => { d.checkout.freeShipping = v; }, 'Free shipping', 'ck-free')} /></Field>}
    <p className="stHint">The exported store never takes card details. WhatsApp and email checkouts send the order to you; payment links send shoppers to your own payment provider.</p>
    <p className="stGroupTitle">Contact</p>
    <TextInput label="Contact email" type="email" value={store.contact.email} onChange={v => s(d => { d.contact.email = v; }, 'Contact', 'c-email')} />
    <TextInput label="Contact phone" value={store.contact.phone} onChange={v => s(d => { d.contact.phone = v; }, 'Contact', 'c-phone')} />
    <TextInput label="Address" value={store.contact.address} onChange={v => s(d => { d.contact.address = v; }, 'Contact', 'c-addr')} />
    <TextInput label="Opening hours" value={store.contact.hours} onChange={v => s(d => { d.contact.hours = v; }, 'Contact', 'c-hours')} />
    <p className="stGroupTitle">Announcement</p>
    <Toggle label="Show announcement bar" value={store.announcement.enabled} onChange={v => s(d => { d.announcement.enabled = v; }, 'Announcement')} />
    <TextInput label="Announcement text (separate messages with |)" value={store.announcement.text} onChange={v => s(d => { d.announcement.text = v; }, 'Announcement', 'ann-text')} />
    <Segmented label="Announcement style" value={store.announcement.style} options={[['static', 'Static'], ['marquee', 'Scrolling ticker']]} onChange={v => s(d => { d.announcement.style = v; }, 'Announcement')} />
    <p className="stGroupTitle">Search engines</p>
    <TextInput label="SEO title" value={store.seo.title} onChange={v => s(d => { d.seo.title = v; }, 'SEO', 'seo-t')} />
    <TextArea label="SEO description" value={store.seo.description} onChange={v => s(d => { d.seo.description = v; }, 'SEO', 'seo-d')} />
    <p className="stGroupTitle">Social links</p>
    {['instagram', 'facebook', 'tiktok', 'youtube', 'x', 'pinterest'].map(k => <TextInput key={k} label={({ x: 'X', tiktok: 'TikTok', youtube: 'YouTube' }[k] || k[0].toUpperCase() + k.slice(1)) + ' URL'} value={store.social[k]} placeholder="https://" onChange={v => s(d => { d.social[k] = v; }, 'Social links', 'so-' + k)} />)}
  </div>;
}

// ---------------------------------------------------------------- Products list (left)
export function ProductsPanel({ store, selectedId, onSelect, edit, env, notify }) {
  const [q, setQ] = useState(''), [status, setStatus] = useState(''), [cat, setCat] = useState('');
  const file = useRef(null);
  const cats = categories(store);
  const list = store.products.filter(p => (!q || (p.title + ' ' + p.tags.join(' ') + ' ' + p.category).toLowerCase().includes(q.toLowerCase())) && (!status || p.status === status) && (!cat || p.category === cat));
  const add = () => { const p = newProduct({ title: 'New product', price: 0, status: 'active' }); edit(d => { d.products.unshift(p); }, 'Add product'); onSelect(p.id); };
  const exportCsv = () => {
    const blob = new Blob([productsToCsv(store)], { type: 'text/csv' }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = slugify(store.name) + '-products.csv'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };
  const importCsv = async f => {
    const r = importProductsCsv(store, await f.text());
    if (r.added || r.updated) env.replace(r.store, 'Import products');
    notify(`Imported ${r.added} new, updated ${r.updated} products${r.errors.length ? ` · ${r.errors.length} problem(s): ${r.errors.slice(0, 2).join('; ')}` : ''}`);
  };
  return <div className="stPanelBody">
    <div className="stProdTools">
      <button type="button" className="stBtn stPrimary" onClick={add}><Plus size={14} />Add product</button>
      <button type="button" className="stBtn ghost" onClick={() => file.current.click()} title={'CSV columns: ' + CSV_COLUMNS.join(', ')}><FileUp size={14} />Import CSV</button>
      <button type="button" className="stBtn ghost" onClick={exportCsv}><FileDown size={14} />Export CSV</button>
      <input ref={file} type="file" accept=".csv,text/csv" hidden aria-label="CSV file" onChange={e => { const f = e.target.files[0]; e.target.value = ''; if (f) importCsv(f); }} />
    </div>
    <label className="stSearch"><Search size={14} /><input aria-label="Search products" placeholder="Search products" value={q} onChange={e => setQ(e.target.value)} /></label>
    <div className="stPair">
      <Select bare label="Filter by status" value={status} options={[['', 'All statuses'], ['active', 'Active'], ['draft', 'Draft']]} onChange={setStatus} />
      <Select bare label="Filter by category" value={cat} options={[['', 'All categories'], ...cats.map(c => [c, c])]} onChange={setCat} />
    </div>
    <p className="stHeadRow"><span>{list.length} of {store.products.length} products</span></p>
    <ul className="stProdList" aria-label="Products">
      {list.map(p => {
        const stock = p.variants.some(v => v.stock == null) ? null : p.variants.reduce((a, v) => a + v.stock, 0);
        return <li key={p.id} className={'stProdRow' + (selectedId === p.id ? ' on' : '')}>
          <button type="button" className="stProdMain" aria-pressed={selectedId === p.id} aria-label={'Edit ' + p.title} onClick={() => onSelect(p.id)}>
            <span className="stProdThumb">{p.images[0] && <img src={env.imageUrl(p.images[0])} alt="" />}</span>
            <span className="stProdText"><b>{p.title}</b><small>{formatMoney(p.price, store.currency)} · {p.variants.length} variant{p.variants.length === 1 ? '' : 's'}{stock != null ? ` · ${stock} in stock` : ''}</small></span>
            <span className={'stPill ' + p.status}>{p.status === 'active' ? 'Active' : 'Draft'}</span>
          </button>
          <button type="button" className="insIcon" aria-label={'Duplicate ' + p.title} onClick={() => { const c = structuredClone(p); c.id = uid('p'); c.title += ' (copy)'; c.slug = ''; c.variants.forEach(v => { v.id = uid('v'); }); edit(d => { d.products.splice(d.products.findIndex(x => x.id === p.id) + 1, 0, c); }, 'Duplicate product'); onSelect(c.id); }}><Copy size={13} /></button>
          <button type="button" className="insIcon" aria-label={'Delete ' + p.title} onClick={() => { edit(d => { d.products = d.products.filter(x => x.id !== p.id); delete d.checkout.paymentLinks[p.id]; }, 'Delete product'); if (selectedId === p.id) onSelect(null); }}><Trash2 size={13} /></button>
        </li>;
      })}
    </ul>
    {!store.products.length && <p className="stHint">No products yet. Add one or import a CSV.</p>}
    <details className="stCsvHelp"><summary>CSV format</summary><p className="stHint">One row per variant; rows with the same <code>handle</code> are one product. Columns: {CSV_COLUMNS.join(', ')}. Tags are separated by “;”, images by “|”.</p></details>
  </div>;
}

// ---------------------------------------------------------------- Product editor (right)
export function ProductEditor({ store, productId, edit, env }) {
  const p = store.products.find(x => x.id === productId);
  const [dragI, setDragI] = useState(null), [dropOver, setDropOver] = useState(false);
  const fileRef = useRef(null);
  if (!p) return <div className="stEmpty"><p>Select a product to edit it, or add a new one.</p></div>;
  const up = (fn, label, key) => edit(d => fn(d.products.find(x => x.id === p.id), d), label, key ? p.id + key : undefined);
  const addFiles = async files => {
    const refs = [];
    for (const f of [...files].filter(f => f.type.startsWith('image/'))) refs.push(await env.upload(f));
    if (refs.length) up(x => { x.images.push(...refs); }, 'Add images');
  };
  const cur = store.currency;
  return <div className="stInspector" role="group" aria-label="Product settings">
    <div className="insTitle"><span>Product</span><small>{p.status === 'draft' ? 'Draft — hidden from the store' : 'Active'}</small></div>
    <div className="stFields">
      <TextInput label="Title" value={p.title} onChange={v => up(x => { if (!x.slug || x.slug === slugify(x.title)) x.slug = slugify(v); x.title = v; }, 'Product title', 'title')} />
      <TextInput label="URL handle" value={p.slug} onChange={v => up(x => { x.slug = slugify(v); }, 'Product handle', 'slug')} />
      <TextArea label="Description" rows={4} value={p.description} onChange={v => up(x => { x.description = v; }, 'Product description', 'desc')} />
      <div className="stPair">
        <Field label="Price"><NumField label="Price" value={p.price} min={0} step={0.01} suffix={cur.code} onChange={v => up(x => { x.price = v; }, 'Price', 'price')} /></Field>
        <Field label="Compare-at price"><NumField label="Compare-at price" value={p.compareAt ?? ''} min={0} step={0.01} placeholder="—" suffix={cur.code} onChange={v => up(x => { x.compareAt = v || null; }, 'Compare-at price', 'cmp')} /></Field>
      </div>
      <Segmented label="Status" value={p.status} options={[['active', 'Active'], ['draft', 'Draft']]} onChange={v => up(x => { x.status = v; }, 'Product status')} />
      <Toggle label="Featured product" value={p.featured} onChange={v => up(x => { x.featured = v; }, 'Featured')} />
      <div className="stPair">
        <Field label="Rating (0–5)"><NumField label="Rating" value={p.rating ?? ''} min={0} max={5} step={0.1} placeholder="—" onChange={v => up(x => { x.rating = v || null; }, 'Rating', 'rating')} /></Field>
        <Field label="Number of reviews"><NumField label="Number of reviews" value={p.reviews} min={0} step={1} onChange={v => up(x => { x.reviews = Math.round(v); }, 'Reviews', 'reviews')} /></Field>
      </div>
      <TextInput label="Category" value={p.category} list="st-cats" onChange={v => up(x => { x.category = v; }, 'Category', 'cat')} />
      <datalist id="st-cats">{categories(store).map(c => <option key={c} value={c} />)}</datalist>
      <TextInput label="Tags (comma separated)" value={p.tags.join(', ')} onChange={v => up(x => { x.tags = v.split(',').map(t => t.trim()).filter(Boolean); }, 'Tags', 'tags')} />

      <p className="stGroupTitle">Images</p>
      <div className={'stDrop' + (dropOver ? ' over' : '')} onDragOver={e => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); setDropOver(true); } }} onDragLeave={() => setDropOver(false)}
        onDrop={e => { if (e.dataTransfer.files.length) { e.preventDefault(); setDropOver(false); addFiles(e.dataTransfer.files); } }}>
        <ul className="stImgGrid" aria-label="Product images">
          {p.images.map((r, i) => <li key={r + i} draggable onDragStart={() => setDragI(i)} onDragOver={e => { if (dragI != null) e.preventDefault(); }}
            onDrop={e => { if (dragI != null) { e.preventDefault(); e.stopPropagation(); up(x => { x.images = move(x.images, dragI, i); }, 'Reorder images'); setDragI(null); } }}>
            <img src={env.imageUrl(r)} alt={`Image ${i + 1}`} />{i === 0 && <span className="stMainTag">Main</span>}
            <span className="stImgBtns">
              <button type="button" aria-label={`Move image ${i + 1} left`} disabled={!i} onClick={() => up(x => { x.images = move(x.images, i, i - 1); }, 'Reorder images')}><ArrowLeft size={12} /></button>
              <button type="button" aria-label={`Move image ${i + 1} right`} disabled={i === p.images.length - 1} onClick={() => up(x => { x.images = move(x.images, i, i + 1); }, 'Reorder images')}><ArrowRight size={12} /></button>
              <button type="button" aria-label={`Remove image ${i + 1}`} onClick={() => up(x => { x.images.splice(i, 1); }, 'Remove image')}><X size={12} /></button>
            </span></li>)}
        </ul>
        <p className="stHint center">Drop images here or</p>
        <div className="stImageBtns center">
          <button type="button" className="stBtn" onClick={() => fileRef.current.click()}><Upload size={13} />Upload images</button>
          {env.onOpenPhotoStudio && <button type="button" className="stBtn ghost" onClick={env.onOpenPhotoStudio}><Camera size={13} />Product photo studio</button>}
        </div>
        <input ref={fileRef} type="file" accept="image/*" multiple hidden aria-label="Product image files" onChange={e => { const f = [...e.target.files]; e.target.value = ''; addFiles(f); }} />
      </div>

      <p className="stGroupTitle">Options</p>
      {p.options.map((o, k) => <div key={k} className="stOption">
        <div className="stPair">
          <TextInput label={`Option ${k + 1} name`} value={o.name} placeholder="Size" onChange={v => up(x => { x.options[k].name = v || x.options[k].name; }, 'Option', 'on' + k)} />
          <OptionValues label={`Option ${k + 1} values`} values={o.values} onChange={vals => up(x => { x.options[k].values = vals; }, 'Option values', 'ov' + k)} />
        </div>
        <button type="button" className="stBtn ghost" onClick={() => up(x => { x.options.splice(k, 1); x.variants.forEach(v => v.options.splice(k, 1)); }, 'Remove option')}><Trash2 size={13} />Remove option {k + 1}</button>
      </div>)}
      {p.options.length < 3 && <button type="button" className="stBtn ghost wide" onClick={() => up(x => { const name = ['Size', 'Color', 'Material'].find(n => !x.options.some(o => o.name === n)) || 'Option'; x.options.push({ name, values: [] }); }, 'Add option')}><Plus size={13} />Add option (size, colour…)</button>}

      <p className="stGroupTitle">Variants <small>{p.variants.length} generated from options</small></p>
      <div className="stVarWrap"><table className="stVariants"><thead><tr><th>Variant</th><th>Price</th><th>SKU</th><th>Stock</th></tr></thead><tbody>
        {p.variants.map((v, i) => { const name = v.options.join(' / ') || 'Default'; return <tr key={v.id}><td>{name}</td>
          <td><input aria-label={`Price of ${name}`} type="number" min="0" step="0.01" placeholder={String(p.price)} value={v.price ?? ''} onChange={e => { const val = e.target.value; up(x => { x.variants[i].price = val === '' ? null : +val; }, 'Variant price', 'vp' + i); }} /></td>
          <td><input aria-label={`SKU of ${name}`} value={v.sku} onChange={e => { const val = e.target.value; up(x => { x.variants[i].sku = val; }, 'Variant SKU', 'vs' + i); }} /></td>
          <td><input aria-label={`Stock of ${name}`} type="number" min="0" step="1" placeholder="∞" value={v.stock ?? ''} onChange={e => { const val = e.target.value; up(x => { x.variants[i].stock = val === '' ? null : Math.max(0, Math.round(+val)); }, 'Variant stock', 'vk' + i); }} /></td></tr>; })}
      </tbody></table></div>
      <p className="stHint">Empty price = product price ({formatMoney(p.price, cur)}). Empty stock = not tracked. Showing from {formatMoney(Math.min(...p.variants.map(v => variantPrice(p, v))), cur)}.</p>

      <p className="stGroupTitle">Product page content</p>
      <TextArea label="Materials & care" value={p.materials} onChange={v => up(x => { x.materials = v; }, 'Materials', 'mat')} />
      <TextInput label="Video URL (mp4, optional)" value={p.video} placeholder="https://…/video.mp4" onChange={v => up(x => { x.video = v; }, 'Video', 'video')} />
      <ReviewsEditor product={p} up={up} env={env} />

      <p className="stGroupTitle">Payment link</p>
      <TextInput label="Payment link" value={store.checkout.paymentLinks[p.id] || ''} placeholder="https://buy.stripe.com/…" onChange={v => edit(d => { if (v.trim()) d.checkout.paymentLinks[p.id] = v; else delete d.checkout.paymentLinks[p.id]; }, 'Payment link', p.id + 'pl')} />
      <p className="stHint">Used when the checkout mode is “Payment links”{store.checkout.mode === 'paymentLinks' ? ' (active)' : ''}.</p>
    </div>
  </div>;
}

/** Reviews shown in the product-reviews section. Template reviews are marked as samples until edited. */
function ReviewsEditor({ product: p, up, env }) {
  const set = (i, k, v) => up(x => { x.reviewsList[i][k] = v; x.reviewsList[i].sample = false; }, 'Review', 'rv' + i + k);
  return <div className="stList"><span className="stFieldLabel">Reviews ({p.reviewsList.length})</span>
    {p.reviewsList.some(r => r.sample) && <p className="stHint">Reviews marked “Sample” come from the template and show a “Sample review” tag in the store. Edit them with real reviews or delete them.</p>}
    {p.reviewsList.map((r, i) => <details key={r.id} className="stListItem"><summary className="stListHead"><span className="stListTitle"><span>{'★'.repeat(r.rating)} {r.name}{r.sample ? ' · Sample' : ''}</span></span></summary>
      <div className="stListBody">
        <TextInput label={`Review ${i + 1} name`} value={r.name} onChange={v => set(i, 'name', v)} />
        <Field label={`Review ${i + 1} rating`}><NumField label={`Review ${i + 1} rating`} value={r.rating} min={1} max={5} onChange={v => set(i, 'rating', Math.round(v))} /></Field>
        <TextInput label={`Review ${i + 1} title`} value={r.title} onChange={v => set(i, 'title', v)} />
        <TextArea label={`Review ${i + 1} text`} value={r.text} onChange={v => set(i, 'text', v)} />
        <TextInput label={`Review ${i + 1} date`} type="date" value={r.date} onChange={v => set(i, 'date', v)} />
        <ImageField label={`Review ${i + 1} photo`} value={r.photo} imageUrl={env.imageUrl} onUpload={env.upload} onChange={v => set(i, 'photo', v)} />
        <button type="button" className="stBtn ghost" onClick={() => up(x => { x.reviewsList.splice(i, 1); }, 'Delete review')}><Trash2 size={13} />Delete review {i + 1}</button>
      </div></details>)}
    <button type="button" className="stBtn ghost wide" onClick={() => up(x => { x.reviewsList.push({ id: uid('r'), name: 'Customer', rating: 5, title: '', text: '', date: new Date().toISOString().slice(0, 10), photo: null, sample: false }); }, 'Add review')}><Plus size={13} />Add review</button>
  </div>;
}

/** Comma-separated option values; committed on blur/Enter so typing "S, M" doesn't regenerate on every key. */
function OptionValues({ label, values, onChange }) {
  const [draft, setDraft] = useState(null);
  const commit = () => { if (draft != null) { onChange([...new Set(draft.split(',').map(v => v.trim()).filter(Boolean))]); setDraft(null); } };
  return <Field label={label}><input className="stInput" aria-label={label} placeholder="S, M, L" value={draft ?? values.join(', ')} onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }} /></Field>;
}

// ---------------------------------------------------------------- Collections
export function CollectionsPanel({ store, selectedId, onSelect, edit }) {
  const add = () => { const c = { id: uid('c'), title: 'New collection', slug: '', description: '', image: null, rule: { type: 'manual', value: '', productIds: [] } }; edit(d => { d.collections.push(c); }, 'Add collection'); onSelect(c.id); };
  return <div className="stPanelBody">
    <button type="button" className="stBtn stPrimary wide" onClick={add}><Plus size={14} />Add collection</button>
    <ul className="stProdList" aria-label="Collections">
      <li className={'stProdRow' + (selectedId === 'all' ? ' on' : '')}><button type="button" className="stProdMain" aria-pressed={selectedId === 'all'} onClick={() => onSelect('all')}><span className="stProdText"><b>All products</b><small>Built in · {store.products.filter(p => p.status === 'active').length} products</small></span></button></li>
      {store.collections.map(c => <li key={c.id} className={'stProdRow' + (selectedId === c.id ? ' on' : '')}>
        <button type="button" className="stProdMain" aria-pressed={selectedId === c.id} aria-label={'Edit collection ' + c.title} onClick={() => onSelect(c.id)}><span className="stProdText"><b>{c.title}</b><small>{{ all: 'All products', manual: 'Hand-picked', category: 'Category: ' + c.rule.value, tag: 'Tag: ' + c.rule.value }[c.rule.type]} · {collectionProducts(store, c).length} products</small></span></button>
        <button type="button" className="insIcon" aria-label={'Delete collection ' + c.title} onClick={() => { edit(d => { d.collections = d.collections.filter(x => x.id !== c.id); }, 'Delete collection'); onSelect('all'); }}><Trash2 size={13} /></button>
      </li>)}
    </ul>
  </div>;
}

export function CollectionEditor({ store, collectionId, edit, env }) {
  const c = store.collections.find(x => x.id === collectionId);
  if (!c) return <div className="stEmpty"><p>{collectionId === 'all' ? '“All products” always lists every active product. Add a collection to group products by category, tag or by hand.' : 'Select a collection.'}</p></div>;
  const up = (fn, label, key) => edit(d => fn(d.collections.find(x => x.id === c.id)), label, key ? c.id + key : undefined);
  return <div className="stInspector" role="group" aria-label="Collection settings">
    <div className="insTitle"><span>Collection</span><small>{collectionProducts(store, c).length} products</small></div>
    <div className="stFields">
      <TextInput label="Collection title" value={c.title} onChange={v => up(x => { x.title = v; }, 'Collection title', 'title')} />
      <TextArea label="Collection description" value={c.description} onChange={v => up(x => { x.description = v; }, 'Collection description', 'desc')} />
      <ImageField label="Collection image" value={c.image} imageUrl={env.imageUrl} onUpload={env.upload} onOpenPhotoStudio={env.onOpenPhotoStudio} onChange={v => up(x => { x.image = v; }, 'Collection image')} />
      <Segmented label="Products in this collection" value={c.rule.type} options={[['manual', 'Hand-picked'], ['category', 'Category'], ['tag', 'Tag'], ['all', 'All']]} onChange={v => up(x => { x.rule.type = v; }, 'Collection rule')} />
      {c.rule.type === 'category' && <Select label="Category" value={c.rule.value} options={[['', 'Choose…'], ...categories(store).map(x => [x, x])]} onChange={v => up(x => { x.rule.value = v; }, 'Collection rule')} />}
      {c.rule.type === 'tag' && <TextInput label="Tag" value={c.rule.value} onChange={v => up(x => { x.rule.value = v; }, 'Collection rule', 'tag')} />}
      {c.rule.type === 'manual' && <div className="stChecks" role="group" aria-label="Products">{store.products.map(p => <label key={p.id} className="stCheck"><input type="checkbox" checked={c.rule.productIds.includes(p.id)}
        onChange={e => { const on = e.target.checked; up(x => { x.rule.productIds = on ? [...x.rule.productIds, p.id] : x.rule.productIds.filter(i => i !== p.id); }, 'Collection products'); }} /><span>{p.title}</span></label>)}</div>}
    </div>
  </div>;
}
