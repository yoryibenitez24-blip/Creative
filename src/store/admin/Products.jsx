// Products: list with bulk actions and CSV, product editor (media, pricing & margin, inventory, shipping weight,
// variants, SEO, organisation), inventory with adjustments and history, collections (manual / automated).
import React, { useRef, useState } from 'react';
import { ArrowLeft, Plus, Upload, Download, Trash2, Camera, Minus, ImagePlus, Star } from 'lucide-react';
import { useAdmin, Page, Card, Badge, Btn, Text, Num, Select, Check, Area, Tags, Segmented, Empty, Thumb, fmtDate, download, readText, pct } from './ui.jsx';
import { normalizeProduct, generateVariants, newProduct, productsToCsv, importProductsCsv, collectionProducts, categories, slugify, uid, normalizeStore as normalizeStoreSafe } from '../model.js';
import { productMeta, variantMeta, WEIGHT_UNITS, cid, syncPriceCollections } from './model.js';
import { adjustStock, productStock, stockRows } from './inventory.js';

const back = (go, to, label) => <button type="button" className="caIconBtn caBack" aria-label={label} onClick={() => go(to)}><ArrowLeft size={17} /></button>;
const stockText = p => { const n = productStock(p); return n == null ? 'Not tracked' : `${n} in stock${p.variants.length > 1 ? ` for ${p.variants.length} variants` : ''}`; };

export function ProductsList() {
  const { store, commerce, go, editStore, commit, run, confirm, notify } = useAdmin();
  const [status, setStatus] = useState('all'), [q, setQ] = useState(''), [vendor, setVendor] = useState(''), [sel, setSel] = useState([]);
  const vendors = [...new Set(store.products.map(p => productMeta(commerce, p.id).vendor).filter(Boolean))].sort();
  const list = store.products.filter(p => (status === 'all' || p.status === status) && (!vendor || productMeta(commerce, p.id).vendor === vendor)
    && (p.title + ' ' + p.tags.join(' ') + ' ' + p.category + ' ' + p.variants.map(v => v.sku).join(' ')).toLowerCase().includes(q.trim().toLowerCase()));
  const allOn = list.length > 0 && list.every(p => sel.includes(p.id));
  const bulkStatus = st => { editStore(d => { for (const p of d.products) if (sel.includes(p.id)) p.status = st; }, `${sel.length} product(s) set to ${st}`); notify(`${sel.length} product(s) set to ${st === 'active' ? 'Active' : 'Draft'}`); setSel([]); };
  const bulkTag = async () => {
    const r = await confirm({ title: `Add tag to ${sel.length} product(s)`, confirmLabel: 'Add tag', initial: { tag: '' }, extra: (s, set) => <Text label="Tag" value={s.tag} onChange={v => set({ ...s, tag: v })} autoFocus /> });
    if (r && r.tag.trim()) { editStore(d => { for (const p of d.products) if (sel.includes(p.id) && !p.tags.includes(r.tag.trim())) p.tags.push(r.tag.trim()); }, 'Tag added'); notify(`Tag “${r.tag.trim()}” added`); setSel([]); }
  };
  const bulkDelete = async () => {
    if (!await confirm({ title: `Delete ${sel.length} product(s)?`, message: 'This cannot be undone. Orders keep their line items.', confirmLabel: 'Delete products', danger: true })) return;
    const ids = new Set(sel);
    const d = structuredClone(store); d.products = d.products.filter(p => !ids.has(p.id)); for (const k of Object.keys(d.checkout.paymentLinks)) if (ids.has(k)) delete d.checkout.paymentLinks[k];
    const c = structuredClone(commerce); for (const id of ids) delete c.productMeta[id];
    commit(syncPriceCollections(normalizeStoreSafe(d), c), c, 'Products deleted'); notify(`${ids.size} product(s) deleted`); setSel([]);
  };
  const importCsv = async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    const r = importProductsCsv(store, await readText(f));
    if (r.added || r.updated) commit(syncPriceCollections(r.store, commerce), null, 'Import products');
    notify(`${r.added} added, ${r.updated} updated` + (r.errors.length ? ' · ' + r.errors.slice(0, 3).join('; ') : ''));
  };
  return <Page title="Products" actions={<>
    <label className="caBtn"><Upload size={14} aria-hidden="true" />Import<input type="file" accept=".csv,text/csv" hidden aria-label="Import products CSV file" onChange={importCsv} /></label>
    <Btn icon={Download} onClick={() => download('products.csv', productsToCsv(store), 'text/csv')}>Export</Btn>
    <Btn kind="primary" icon={Plus} onClick={() => go({ page: 'product', id: 'new' })}>Add product</Btn></>}>
    <Card pad={false}>
      <div className="caToolbar">
        <Segmented label="Product status" value={status} onChange={v => { setStatus(v); setSel([]); }} options={[['all', 'All', store.products.length], ['active', 'Active', store.products.filter(p => p.status === 'active').length], ['draft', 'Draft', store.products.filter(p => p.status === 'draft').length]]} />
        <input className="caInput caFilterSearch" type="search" aria-label="Filter products" placeholder="Filter products" value={q} onChange={e => setQ(e.target.value)} />
        {vendors.length > 0 && <select className="caInput caFilterSel" aria-label="Vendor filter" value={vendor} onChange={e => setVendor(e.target.value)}><option value="">All vendors</option>{vendors.map(v => <option key={v}>{v}</option>)}</select>}
      </div>
      {sel.length > 0 && <div className="caBulk" role="toolbar" aria-label="Bulk actions"><span>{sel.length} selected</span>
        <Btn onClick={() => bulkStatus('active')}>Set as active</Btn><Btn onClick={() => bulkStatus('draft')}>Set as draft</Btn><Btn onClick={bulkTag}>Add tag</Btn><Btn kind="danger" onClick={bulkDelete}>Delete</Btn></div>}
      {list.length ? <table className="caTable">
        <thead><tr><th className="sel"><input type="checkbox" aria-label="Select all products" checked={allOn} onChange={e => setSel(e.target.checked ? list.map(p => p.id) : [])} /></th><th colSpan="2">Product</th><th>Status</th><th>Inventory</th><th>Type</th><th>Vendor</th></tr></thead>
        <tbody>{list.map(p => { const m = productMeta(commerce, p.id), n = productStock(p); return <tr key={p.id} className="click" onClick={() => go({ page: 'product', id: p.id })}>
          <td className="sel" onClick={e => e.stopPropagation()}><input type="checkbox" aria-label={`Select ${p.title}`} checked={sel.includes(p.id)} onChange={e => setSel(e.target.checked ? [...sel, p.id] : sel.filter(x => x !== p.id))} /></td>
          <td className="img"><Thumb src={p.images[0] || p.art} size={40} /></td>
          <td><button type="button" className="caLink" onClick={e => { e.stopPropagation(); go({ page: 'product', id: p.id }); }}>{p.title}</button></td>
          <td><Badge tone={p.status === 'active' ? 'ok' : 'neutral'}>{p.status === 'active' ? 'Active' : 'Draft'}</Badge></td>
          <td className={n === 0 ? 'caBad' : ''}>{stockText(p)}</td><td>{m.productType || p.category || '—'}</td><td>{m.vendor || '—'}</td></tr>; })}</tbody></table>
        : <Empty art="products" title={store.products.length ? 'No products match' : 'Add your first product'} action={<Btn kind="primary" icon={Plus} onClick={() => go({ page: 'product', id: 'new' })}>Add product</Btn>}>Products you add appear on your storefront when they are active.</Empty>}
    </Card>
  </Page>;
}

// ---------- product editor ----------
export function ProductDetail({ id }) {
  const { store, commerce, go, commit, notify, confirm, upload, onOpenPhotoStudio, fmt } = useAdmin();
  const isNew = id === 'new';
  const original = store.products.find(p => p.id === id);
  const init = () => {
    const p = original ? structuredClone(original) : newProduct({ title: '', status: 'active', variants: [{ options: [], stock: 0, sku: '' }] });
    const pm = structuredClone(productMeta(commerce, p.id));
    const manual = store.collections.filter(c => c.rule.type === 'manual' && !commerce.collectionRules[c.id] && c.rule.productIds.includes(p.id)).map(c => c.id);
    return { p, m: pm, cols: manual };
  };
  const [st, setSt] = useState(init), [dirty, setDirty] = useState(isNew), [url, setUrl] = useState('');
  const fileRef = useRef(null);
  if (!isNew && !original) return <Page title="Product not found" back={back(go, 'products', 'Back to products')}><Empty art="products" title="This product does not exist anymore" /></Page>;
  const { p, m } = st;
  const set = fn => { setSt(s => { const n = structuredClone(s); fn(n); return n; }); setDirty(true); };
  const unit = commerce.settings.general.weightUnit, toUnit = g => g == null ? null : Math.round(g / WEIGHT_UNITS[unit] * 1000) / 1000, fromUnit = v => v == null ? null : Math.round(v * WEIGHT_UNITS[unit]);
  const single = p.options.length === 0, v0 = p.variants[0];
  const setOptions = opts => set(s => { s.p.options = opts; s.p.variants = generateVariants({ ...s.p, options: opts.filter(o => o.name && o.values.length) }); });
  const vm = vid => m.variants[vid] || { cost: null, weight: null, barcode: '', continueSelling: false };
  const setVm = (vid, k, val) => set(s => { s.m.variants[vid] = { ...vm(vid), ...(s.m.variants[vid] || {}), [k]: val }; });
  const cost = m.cost, profit = cost != null ? p.price - cost : null;

  const save = () => {
    if (!p.title.trim()) { notify('Give the product a title first.'); return; }
    const next = structuredClone(store), prod = normalizeProduct(p);
    const at = next.products.findIndex(x => x.id === prod.id);
    if (at >= 0) next.products[at] = prod; else next.products.push(prod);
    for (const col of next.collections) if (col.rule.type === 'manual' && !commerce.collectionRules[col.id]) {
      const has = col.rule.productIds.includes(prod.id), want = st.cols.includes(col.id);
      if (want && !has) col.rule.productIds.push(prod.id); else if (!want && has) col.rule.productIds = col.rule.productIds.filter(x => x !== prod.id);
    }
    let s = normalizeStoreSafe(next), c = structuredClone(commerce);
    const saved = s.products.find(x => x.id === prod.id);
    const keep = new Set(saved.variants.map(v => v.id));
    c.productMeta[prod.id] = { ...m, variants: Object.fromEntries(Object.entries(m.variants).filter(([k]) => keep.has(k))) };
    // log stock changes made in the editor
    const before = new Map((original?.variants || []).map(v => [v.id, v.stock]));
    for (const v of saved.variants) { const b = before.has(v.id) ? before.get(v.id) : null; if (v.stock != null && v.stock !== b) c.inventoryLog.push({ id: cid('inv'), at: new Date().toISOString(), productId: prod.id, variantId: v.id, delta: v.stock - (b || 0), stockAfter: v.stock, reason: 'set', orderId: null, note: 'Product editor' }); }
    c.onboarding.steps.product = true;
    s = syncPriceCollections(s, c);
    commit(s, c, isNew ? 'Add product' : 'Edit product');
    setDirty(false); notify(isNew ? 'Product created' : 'Product saved');
    if (isNew) go({ page: 'product', id: prod.id });
    else setSt({ p: structuredClone(saved), m: structuredClone(c.productMeta[prod.id]), cols: st.cols });
  };
  const remove = async () => {
    if (!await confirm({ title: `Delete ${p.title || 'product'}?`, message: 'This cannot be undone. Existing orders keep their line items.', confirmLabel: 'Delete product', danger: true })) return;
    const d = structuredClone(store); d.products = d.products.filter(x => x.id !== p.id); delete d.checkout.paymentLinks[p.id];
    const c = structuredClone(commerce); delete c.productMeta[p.id];
    commit(normalizeStoreSafe(d), c, 'Delete product'); notify('Product deleted'); go('products');
  };
  const addFiles = async files => {
    for (const f of files) { try { const ref = await upload(f); set(s => { s.p.images.push(ref); }); } catch (err) { notify('Upload failed: ' + err.message); } }
  };
  const autoCols = store.collections.filter(c => c.rule.type !== 'manual' || commerce.collectionRules[c.id]);
  const seoTitle = m.seoTitle || p.title, seoDesc = m.seoDescription || p.description.replace(/\s+/g, ' ').slice(0, 160);

  return <Page title={isNew ? 'Add product' : p.title || 'Untitled product'} back={back(go, 'products', 'Back to products')}
    actions={<>{!isNew && <Btn kind="danger" icon={Trash2} onClick={remove}>Delete</Btn>}<Btn kind="primary" onClick={save} disabled={!dirty}>Save</Btn></>}>
    {dirty && <div className="caSaveBar" role="region" aria-label="Unsaved changes"><span>Unsaved product</span><Btn onClick={() => { if (isNew) go('products'); else { setSt(init()); setDirty(false); } }}>Discard</Btn><Btn kind="primary" onClick={save}>Save</Btn></div>}
    <div className="caCols">
      <div className="caColMain">
        <Card>
          <div className="caForm">
            <Text label="Title" value={p.title} onChange={v => set(s => { s.p.title = v; })} placeholder="Short sleeve t-shirt" />
            <Area label="Description" value={p.description} onChange={v => set(s => { s.p.description = v; })} rows={7} hint="Leave a blank line between paragraphs. Shown on the product page." />
          </div>
        </Card>
        <Card title="Media" actions={<>{onOpenPhotoStudio && <Btn icon={Camera} onClick={onOpenPhotoStudio}>Photo studio</Btn>}<Btn icon={ImagePlus} onClick={() => fileRef.current?.click()}>Upload images</Btn></>}>
          <input ref={fileRef} type="file" accept="image/*" multiple hidden aria-label="Upload product images" onChange={e => { const f = [...e.target.files]; e.target.value = ''; addFiles(f); }} />
          {p.images.length ? <ul className="caMedia">{p.images.map((ref, i) => <li key={ref + i}><Thumb src={ref} size={i === 0 ? 150 : 96} alt={`Image ${i + 1} of ${p.title}`} />
            <div className="caMediaBtns">{i > 0 && <button type="button" className="caIconBtn sm" aria-label={`Make image ${i + 1} the main image`} onClick={() => set(s => { const [x] = s.p.images.splice(i, 1); s.p.images.unshift(x); })}><Star size={13} /></button>}
              <button type="button" className="caIconBtn sm" aria-label={`Remove image ${i + 1}`} onClick={() => set(s => { s.p.images.splice(i, 1); })}><Trash2 size={13} /></button></div></li>)}</ul>
            : <div className="caDrop" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); addFiles([...e.dataTransfer.files].filter(f => f.type.startsWith('image/'))); }}><ImagePlus size={22} aria-hidden="true" /><span>Drop images here or use Upload images</span></div>}
          <div className="caInline"><input className="caInput" aria-label="Image URL" placeholder="https://… image URL" value={url} onChange={e => setUrl(e.target.value)} /><Btn onClick={() => { if (/^https:\/\//.test(url.trim())) { set(s => { s.p.images.push(url.trim()); }); setUrl(''); } else notify('Enter an https:// image URL'); }} disabled={!url.trim()}>Add URL</Btn></div>
        </Card>
        <Card title="Pricing">
          <div className="caForm three">
            <Num label="Price" value={p.price} min={0} onChange={v => set(s => { s.p.price = v; })} />
            <Num label="Compare-at price" value={p.compareAt} min={0} allowEmpty onChange={v => set(s => { s.p.compareAt = v; })} hint="Original price, shown crossed out." />
            <Num label="Cost per item" value={m.cost} min={0} allowEmpty onChange={v => set(s => { s.m.cost = v; })} hint="Customers won't see this." />
          </div>
          <div className="caMetrics" aria-label="Margin">
            <div><span>Profit</span><strong>{profit == null ? '—' : fmt(profit)}</strong></div>
            <div><span>Margin</span><strong>{profit == null || !p.price ? '—' : pct(profit / p.price)}</strong></div>
          </div>
        </Card>
        {single && v0 && <Card title="Inventory">
          <Check label="Track quantity" checked={v0.stock != null} onChange={on => set(s => { s.p.variants[0].stock = on ? 0 : null; })} />
          <div className="caForm three">
            {v0.stock != null && <Num label="Quantity" value={v0.stock} min={0} step={1} onChange={v => set(s => { s.p.variants[0].stock = Math.round(v); })} />}
            <Text label="SKU (stock keeping unit)" value={v0.sku} onChange={v => set(s => { s.p.variants[0].sku = v; })} />
            <Text label="Barcode (ISBN, UPC, GTIN, etc.)" value={vm(v0.id).barcode} onChange={v => setVm(v0.id, 'barcode', v)} />
          </div>
          <Check label="Continue selling when out of stock" checked={vm(v0.id).continueSelling} onChange={v => setVm(v0.id, 'continueSelling', v)} hint="Lets you create orders beyond the available quantity in the admin." />
        </Card>}
        <Card title="Shipping">
          <div className="caForm three"><Num label={`Weight (${unit})`} value={toUnit(m.weight)} min={0} onChange={v => set(s => { s.m.weight = fromUnit(v) || 0; })} hint="Used for weight-based shipping rates." /></div>
        </Card>
        <Card title="Variants">
          <OptionsEditor options={p.options} onChange={setOptions} />
          {!single && <div className="caTableWrap"><table className="caTable compact" aria-label="Variants">
            <thead><tr><th>Variant</th><th>Price</th><th>Cost</th><th>SKU</th><th>Barcode</th><th>Track</th><th>Available</th><th>Oversell</th><th>Weight ({unit})</th></tr></thead>
            <tbody>{p.variants.map((v, i) => { const lab = v.options.join(' / '), x = vm(v.id); return <tr key={v.id}>
              <th scope="row">{lab}</th>
              <td><CellNum label={`Price of ${lab}`} value={v.price} allowEmpty placeholder={String(p.price)} onChange={val => set(s => { s.p.variants[i].price = val; })} /></td>
              <td><CellNum label={`Cost of ${lab}`} value={x.cost} allowEmpty placeholder={m.cost == null ? '' : String(m.cost)} onChange={val => setVm(v.id, 'cost', val)} /></td>
              <td><input className="caInput cell" aria-label={`SKU of ${lab}`} value={v.sku} onChange={e => set(s => { s.p.variants[i].sku = e.target.value; })} /></td>
              <td><input className="caInput cell" aria-label={`Barcode of ${lab}`} value={x.barcode} onChange={e => setVm(v.id, 'barcode', e.target.value)} /></td>
              <td><input type="checkbox" aria-label={`Track quantity of ${lab}`} checked={v.stock != null} onChange={e => set(s => { s.p.variants[i].stock = e.target.checked ? 0 : null; })} /></td>
              <td>{v.stock != null ? <CellNum label={`Available quantity of ${lab}`} value={v.stock} min={0} step={1} onChange={val => set(s => { s.p.variants[i].stock = Math.max(0, Math.round(val || 0)); })} /> : <span className="caMuted">Not tracked</span>}</td>
              <td><input type="checkbox" aria-label={`Continue selling ${lab} when out of stock`} checked={x.continueSelling} onChange={e => setVm(v.id, 'continueSelling', e.target.checked)} /></td>
              <td><CellNum label={`Weight of ${lab}`} value={toUnit(x.weight)} allowEmpty placeholder={String(toUnit(m.weight) || '')} onChange={val => setVm(v.id, 'weight', fromUnit(val))} /></td>
            </tr>; })}</tbody></table></div>}
          {!single && <p className="caHint">Blank price, cost or weight uses the product value.</p>}
        </Card>
        <Card title="Search engine listing">
          <div className="caSeo" aria-label="Search result preview"><span className="caSeoUrl">{(commerce.settings.domains.primary || 'your-store.example')} › products › {p.slug || slugify(p.title)}</span><strong>{seoTitle || 'Product title'}</strong><p>{seoDesc || 'Add a description to see how this product might appear in a search engine listing.'}</p></div>
          <div className="caForm">
            <Text label="Page title" value={m.seoTitle} placeholder={p.title} onChange={v => set(s => { s.m.seoTitle = v; })} hint={`${(m.seoTitle || p.title).length} of 70 characters used`} />
            <Area label="Meta description" value={m.seoDescription} rows={3} onChange={v => set(s => { s.m.seoDescription = v; })} hint={`${(m.seoDescription || '').length} of 160 characters used`} />
            <Text label="URL handle" value={p.slug} placeholder={slugify(p.title)} onChange={v => set(s => { s.p.slug = v; })} hint="The product page address: products/<handle>.html" />
          </div>
        </Card>
      </div>
      <div className="caColSide">
        <Card title="Status"><Select label="Product status" value={p.status} onChange={v => set(s => { s.p.status = v; })} options={[['active', 'Active'], ['draft', 'Draft']]} hint={p.status === 'draft' ? 'Hidden from the storefront.' : 'Visible on the storefront.'} />
          <Check label="Featured product" checked={p.featured} onChange={v => set(s => { s.p.featured = v; })} /></Card>
        <Card title="Product organization">
          <div className="caForm">
            <Text label="Product type" value={m.productType} onChange={v => set(s => { s.m.productType = v; })} list="caTypes" />
            <datalist id="caTypes">{[...new Set(Object.values(commerce.productMeta).map(x => x.productType).filter(Boolean))].map(t => <option key={t} value={t} />)}</datalist>
            <Text label="Vendor" value={m.vendor} onChange={v => set(s => { s.m.vendor = v; })} list="caVendors" />
            <datalist id="caVendors">{[...new Set(Object.values(commerce.productMeta).map(x => x.vendor).filter(Boolean))].map(t => <option key={t} value={t} />)}</datalist>
            <Text label="Category" value={p.category} onChange={v => set(s => { s.p.category = v; })} list="caCats" hint="Used by category collections and storefront filters." />
            <datalist id="caCats">{categories(store).map(t => <option key={t} value={t} />)}</datalist>
            <Tags label="Tags" value={p.tags} onChange={v => set(s => { s.p.tags = v; })} hint="The tag “new” shows a New badge." />
          </div>
          <h3 className="caSub">Collections</h3>
          {store.collections.filter(c => c.rule.type === 'manual' && !commerce.collectionRules[c.id]).map(c => <Check key={c.id} label={c.title} checked={st.cols.includes(c.id)} onChange={on => { setSt(s => ({ ...s, cols: on ? [...s.cols, c.id] : s.cols.filter(x => x !== c.id) })); setDirty(true); }} />)}
          {autoCols.length > 0 && <p className="caHint">Automated: {autoCols.map(c => c.title).join(', ')} — membership follows their conditions.</p>}
          {!store.collections.length && <p className="caMuted">No collections yet.</p>}
        </Card>
      </div>
    </div>
  </Page>;
}

function CellNum({ label, value, onChange, allowEmpty, placeholder, min, step = 'any' }) {
  const [t, setT] = useState(value == null ? '' : String(value)), f = useRef(false);
  if (!f.current && (value == null ? '' : String(value)) !== t && !(t !== '' && +t === value)) setT(value == null ? '' : String(value));
  return <input className="caInput cell" type="number" min={min} step={step} aria-label={label} placeholder={placeholder} value={t}
    onFocus={() => { f.current = true; }} onBlur={() => { f.current = false; }}
    onChange={e => { const x = e.target.value; setT(x); if (x.trim() === '') { if (allowEmpty) onChange(null); } else if (Number.isFinite(+x)) onChange(+x); }} />;
}

function OptionsEditor({ options, onChange }) {
  const presets = ['Size', 'Color', 'Material', 'Style'];
  return <div className="caOptions">
    {options.map((o, i) => <div key={i} className="caOption" role="group" aria-label={`Option ${i + 1}`}>
      <div className="caForm two">
        <Text label={`Option ${i + 1} name`} value={o.name} list="caOptNames" onChange={v => onChange(options.map((x, k) => k === i ? { ...x, name: v } : x))} />
        <div className="caOptBtns"><Btn kind="plain" icon={Trash2} aria-label={`Remove option ${i + 1}`} onClick={() => onChange(options.filter((_, k) => k !== i))}>Remove</Btn></div>
      </div>
      <Tags label={`Option ${i + 1} values`} value={o.values} onChange={v => onChange(options.map((x, k) => k === i ? { ...x, values: v } : x))} />
    </div>)}
    <datalist id="caOptNames">{presets.map(n => <option key={n} value={n} />)}</datalist>
    {options.length < 3 && <Btn icon={Plus} onClick={() => onChange([...options, { name: presets.find(n => !options.some(o => o.name === n)) || 'Option', values: [] }])}>{options.length ? 'Add another option' : 'Add options like size or color'}</Btn>}
  </div>;
}

// ---------- inventory ----------
export function InventoryPage() {
  const { store, commerce, run, go } = useAdmin();
  const [q, setQ] = useState(''), [only, setOnly] = useState('all');
  const rows = stockRows(store, commerce).filter(r => (only === 'all' || (only === 'low' ? r.low || r.out : r.tracked)) && (r.product.title + ' ' + r.variant.sku + ' ' + r.variant.options.join(' ')).toLowerCase().includes(q.trim().toLowerCase()));
  const name = (pid, vid) => { const p = store.products.find(x => x.id === pid), v = p?.variants.find(x => x.id === vid); return p ? p.title + (v && v.options.length ? ' · ' + v.options.join(' / ') : '') : 'Deleted product'; };
  const adj = (r, ch, label) => run((s, c) => adjustStock(s, c, [{ productId: r.product.id, variantId: r.variant.id, ...ch }], { reason: ch.set != null ? 'set' : 'manual' }), label);
  return <Page title="Inventory">
    <Card pad={false}>
      <div className="caToolbar">
        <Segmented label="Inventory filter" value={only} onChange={setOnly} options={[['all', 'All variants'], ['tracked', 'Tracked'], ['low', 'Low or out of stock']]} />
        <input className="caInput caFilterSearch" type="search" aria-label="Filter inventory" placeholder="Filter by product, SKU or option" value={q} onChange={e => setQ(e.target.value)} />
      </div>
      {rows.length ? <table className="caTable">
        <thead><tr><th colSpan="2">Product</th><th>SKU</th><th>Status</th><th>Adjust</th><th>Available</th></tr></thead>
        <tbody>{rows.map(r => { const lab = r.product.title + (r.variant.options.length ? ' ' + r.variant.options.join(' / ') : ''); return <tr key={r.variant.id}>
          <td className="img"><Thumb src={r.product.images[0] || r.product.art} size={36} /></td>
          <td><button type="button" className="caLink" onClick={() => go({ page: 'product', id: r.product.id })}>{r.product.title}</button>{r.variant.options.length > 0 && <small className="caMuted block">{r.variant.options.join(' / ')}</small>}</td>
          <td>{r.variant.sku || '—'}</td>
          <td>{!r.tracked ? <Badge>Not tracked</Badge> : r.out ? <Badge tone="bad">Out of stock</Badge> : r.low ? <Badge tone="warn">Low</Badge> : <Badge tone="ok">In stock</Badge>}{r.continueSelling && <Badge tone="info">Oversell</Badge>}</td>
          <td>{r.tracked ? <span className="caStepper"><button type="button" className="caIconBtn sm" aria-label={`Decrease ${lab} by 1`} onClick={() => adj(r, { delta: -1 }, 'Inventory adjusted')} disabled={r.stock <= 0}><Minus size={13} /></button>
            <button type="button" className="caIconBtn sm" aria-label={`Increase ${lab} by 1`} onClick={() => adj(r, { delta: 1 }, 'Inventory adjusted')}><Plus size={13} /></button></span>
            : <Btn kind="plain" onClick={() => adj(r, { set: 0 }, 'Tracking started')}>Track</Btn>}</td>
          <td>{r.tracked ? <SetQty label={`Available quantity of ${lab}`} value={r.stock} onSet={n => adj(r, { set: n }, 'Inventory updated')} /> : '∞'}</td>
        </tr>; })}</tbody></table> : <Empty art="products" title="No variants match" />}
    </Card>
    <Card title="Adjustment history" pad={false}>
      {commerce.inventoryLog.length ? <table className="caTable compact"><thead><tr><th>Date</th><th>Item</th><th>Reason</th><th className="n">Change</th><th className="n">Available after</th></tr></thead>
        <tbody>{commerce.inventoryLog.slice(-60).reverse().map(e => <tr key={e.id}><td>{fmtDate(e.at, true)}</td><td>{name(e.productId, e.variantId)}</td>
          <td>{({ manual: 'Manual adjustment', set: 'Quantity set', order: 'Order', restock: 'Restocked', import: 'Import' })[e.reason]}{e.orderId && <> · <button type="button" className="caLink" onClick={() => go({ page: 'order', id: e.orderId })}>{e.note.replace(/^(Order|Restock) /, '')}</button></>}{!e.orderId && e.note && <span className="caMuted"> · {e.note}</span>}</td>
          <td className={'n ' + (e.delta < 0 ? 'caBad' : 'caGood')}>{e.delta > 0 ? '+' : ''}{e.delta}</td><td className="n">{e.stockAfter ?? '—'}</td></tr>)}</tbody></table>
        : <p className="caMuted caCardBody">Stock changes from orders, refunds and manual adjustments are logged here.</p>}
    </Card>
  </Page>;
}
function SetQty({ label, value, onSet }) {
  const [t, setT] = useState(String(value)), [last, setLast] = useState(value);
  if (last !== value) { setLast(value); setT(String(value)); }
  const commitIt = () => { const n = Math.round(+t); if (t.trim() !== '' && Number.isFinite(n) && n >= 0 && n !== value) onSet(n); else setT(String(value)); };
  return <input className="caInput cell qty" type="number" min="0" step="1" aria-label={label} value={t} onChange={e => setT(e.target.value)} onBlur={commitIt} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commitIt(); } }} />;
}

// ---------- collections ----------
const ruleText = (col, commerce, fmt) => {
  const pr = commerce.collectionRules[col.id];
  if (pr) return 'Price ' + (pr.min != null ? '≥ ' + fmt(pr.min) : '') + (pr.min != null && pr.max != null ? ' and ' : '') + (pr.max != null ? '≤ ' + fmt(pr.max) : '');
  return { all: 'All active products', manual: 'Manual selection', category: 'Category is ' + col.rule.value, tag: 'Tagged ' + col.rule.value }[col.rule.type];
};
export function CollectionsList() {
  const { store, commerce, go, fmt } = useAdmin();
  return <Page title="Collections" actions={<Btn kind="primary" icon={Plus} onClick={() => go({ page: 'collection', id: 'new' })}>Create collection</Btn>}>
    <Card pad={false}>{store.collections.length ? <table className="caTable"><thead><tr><th colSpan="2">Title</th><th>Products</th><th>Conditions</th></tr></thead>
      <tbody>{store.collections.map(c => <tr key={c.id} className="click" onClick={() => go({ page: 'collection', id: c.id })}><td className="img"><Thumb src={c.image} size={36} /></td>
        <td><button type="button" className="caLink" onClick={e => { e.stopPropagation(); go({ page: 'collection', id: c.id }); }}>{c.title}</button></td><td>{collectionProducts(store, c).length}</td><td>{ruleText(c, commerce, fmt)}</td></tr>)}</tbody></table>
      : <Empty art="products" title="Group your products into collections" action={<Btn kind="primary" onClick={() => go({ page: 'collection', id: 'new' })}>Create collection</Btn>}>Collections make products easier to find, e.g. by category, tag or price.</Empty>}</Card>
  </Page>;
}

export function CollectionDetail({ id }) {
  const { store, commerce, go, commit, notify, confirm, upload, fmt } = useAdmin();
  const isNew = id === 'new', orig = store.collections.find(c => c.id === id);
  const init = () => {
    const c = orig ? structuredClone(orig) : { id: uid('c'), title: '', slug: '', description: '', image: null, rule: { type: 'manual', value: '', productIds: [] } };
    const pr = commerce.collectionRules[c.id];
    return { c, kind: pr ? 'price' : c.rule.type, min: pr?.min ?? null, max: pr?.max ?? null };
  };
  const [st, setSt] = useState(init), [dirty, setDirty] = useState(isNew), [q, setQ] = useState('');
  if (!isNew && !orig) return <Page title="Collection not found" back={back(go, 'collections', 'Back to collections')}><Empty title="This collection does not exist anymore" /></Page>;
  const set = patch => { setSt(s => ({ ...s, ...patch })); setDirty(true); };
  const setC = patch => set({ c: { ...st.c, ...patch } });
  const automated = st.kind !== 'manual';
  const preview = st.kind === 'price' ? store.products.filter(p => p.status === 'active' && (st.min == null || p.price >= st.min) && (st.max == null || p.price <= st.max))
    : collectionProducts(store, { ...st.c, rule: { ...st.c.rule, type: st.kind } });
  const save = () => {
    if (!st.c.title.trim()) { notify('Give the collection a title first.'); return; }
    const d = structuredClone(store), c = structuredClone(commerce);
    const col = { ...st.c, rule: st.kind === 'price' ? { type: 'manual', value: '', productIds: [] } : { ...st.c.rule, type: st.kind } };
    const i = d.collections.findIndex(x => x.id === col.id); if (i >= 0) d.collections[i] = col; else d.collections.push(col);
    if (st.kind === 'price') c.collectionRules[col.id] = { type: 'price', min: st.min, max: st.max }; else delete c.collectionRules[col.id];
    commit(syncPriceCollections(normalizeStoreSafe(d), c), c, isNew ? 'Create collection' : 'Edit collection');
    setDirty(false); notify(isNew ? 'Collection created' : 'Collection saved');
    if (isNew) go({ page: 'collection', id: col.id });
  };
  const remove = async () => {
    if (!await confirm({ title: `Delete ${st.c.title}?`, message: 'Products are not deleted. Menu links to this collection will point to the home page.', confirmLabel: 'Delete collection', danger: true })) return;
    const d = structuredClone(store); d.collections = d.collections.filter(x => x.id !== st.c.id);
    for (const k of ['main', 'footer']) for (const n of d.navigation[k]) if (n.target === 'collection:' + st.c.id) n.target = 'home';
    const c = structuredClone(commerce); delete c.collectionRules[st.c.id];
    commit(normalizeStoreSafe(d), c, 'Delete collection'); notify('Collection deleted'); go('collections');
  };
  const manualIds = st.c.rule.productIds;
  return <Page title={isNew ? 'Create collection' : st.c.title} back={back(go, 'collections', 'Back to collections')} actions={<>{!isNew && <Btn kind="danger" icon={Trash2} onClick={remove}>Delete</Btn>}<Btn kind="primary" onClick={save} disabled={!dirty}>Save</Btn></>}>
    <div className="caCols">
      <div className="caColMain">
        <Card><div className="caForm"><Text label="Collection title" value={st.c.title} onChange={v => setC({ title: v })} placeholder="Summer collection" /><Area label="Collection description" value={st.c.description} onChange={v => setC({ description: v })} rows={4} /></div></Card>
        <Card title="Collection type">
          <Select label="Products in this collection" value={st.kind} onChange={v => set({ kind: v })} options={[['manual', 'Manual — choose products'], ['category', 'Automated — category equals'], ['tag', 'Automated — product tag equals'], ['price', 'Automated — price range'], ['all', 'Automated — all active products']]} />
          {(st.kind === 'category' || st.kind === 'tag') && <Text label={st.kind === 'category' ? 'Category' : 'Tag'} value={st.c.rule.value} list={st.kind === 'category' ? 'caColCats' : 'caColTags'} onChange={v => setC({ rule: { ...st.c.rule, value: v } })} />}
          <datalist id="caColCats">{categories(store).map(t => <option key={t} value={t} />)}</datalist>
          <datalist id="caColTags">{[...new Set(store.products.flatMap(p => p.tags))].map(t => <option key={t} value={t} />)}</datalist>
          {st.kind === 'price' && <div className="caForm two"><Num label="Minimum price" value={st.min} allowEmpty min={0} onChange={v => set({ min: v })} /><Num label="Maximum price" value={st.max} allowEmpty min={0} onChange={v => set({ max: v })} /></div>}
          {st.kind === 'price' && <p className="caHint">Price collections are kept up to date whenever products are saved here in Commerce.</p>}
        </Card>
        <Card title={`Products (${automated ? preview.length : manualIds.length})`}>
          {automated ? (preview.length ? <ul className="caPickList">{preview.map(p => <li key={p.id}><Thumb src={p.images[0] || p.art} size={32} /><span>{p.title}</span><span className="caMuted">{fmt(p.price)}</span></li>)}</ul> : <p className="caMuted">No active products match these conditions.</p>)
            : <><input className="caInput" type="search" aria-label="Filter products to add" placeholder="Search products" value={q} onChange={e => setQ(e.target.value)} />
              <ul className="caPickList">{store.products.filter(p => p.title.toLowerCase().includes(q.trim().toLowerCase())).map(p => <li key={p.id}>
                <label className="caCheck"><input type="checkbox" checked={manualIds.includes(p.id)} onChange={e => setC({ rule: { ...st.c.rule, productIds: e.target.checked ? [...manualIds, p.id] : manualIds.filter(x => x !== p.id) } })} /><Thumb src={p.images[0] || p.art} size={32} /><span>{p.title}{p.status === 'draft' && ' (draft)'}</span></label></li>)}</ul></>}
        </Card>
      </div>
      <div className="caColSide">
        <Card title="Collection image">
          {st.c.image ? <><Thumb src={st.c.image} size={200} alt="Collection image" /><Btn kind="plain" icon={Trash2} onClick={() => setC({ image: null })}>Remove image</Btn></> : <p className="caMuted">No image</p>}
          <label className="caBtn"><ImagePlus size={14} aria-hidden="true" />Upload image<input type="file" accept="image/*" hidden aria-label="Upload collection image" onChange={async e => { const f = e.target.files[0]; e.target.value = ''; if (f) { try { setC({ image: await upload(f) }); } catch (err) { notify('Upload failed: ' + err.message); } } }} /></label>
        </Card>
      </div>
    </div>
  </Page>;
}
