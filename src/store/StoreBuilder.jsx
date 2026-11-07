import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { ArrowLeft, Undo2, Redo2, Monitor, Tablet, Smartphone, ExternalLink, Download, LayoutTemplate, Camera, ClipboardCopy, MousePointer2, Hand, ChevronDown, X } from 'lucide-react';
import { normalizeStore, PAGE_KEYS, PAGE_LABELS, STORE_VERSION, imageRefs, activeProducts, slugify, REQUIRED as REQUIRED_TYPES } from './model.js';
import { createStore, STORE_TEMPLATES } from './templates.js';
import { renderParts, composePage, diffParts, resolveHref, routeForPath, ALL_COLLECTION } from './render.js';
import { SECTIONS } from './sections.js';
import { uid } from './model.js';
import { frameOf, framePatch, productFrames, normFrame } from './frame.js';
import { exportStoreZip, deployInstructions, previewShellHtml } from './exporter.js';
import { createImageResolver, uploadImage } from './images.js';
import Gallery from './Gallery.jsx';
import { SectionsPanel, SectionInspector, ThemePanel, NavPanel, SettingsPanel, ProductsPanel, ProductEditor, CollectionsPanel, CollectionEditor } from './panels.jsx';

export { createStore, STORE_TEMPLATES };

/**
 * Online store builder.
 *
 * props:
 *   store             store document (schema: src/store/model.js) or null → the template gallery is shown first
 *   onChange(store, label)  called with the next full document on every edit (also undo/redo); the host persists it
 *   onExit()          leave the builder (optional; shows a back button)
 *   onOpenPhotoStudio()     open the product-photo studio (optional; shows "Product photo studio" buttons)
 *   assetStore        AssetStore (src/engine/assets.js) for uploaded images; without it images are stored as data: URLs
 *   commerce          optional commerce document (src/store/admin/model.js): its discounts, shipping zones, taxes and
 *                     order webhook are embedded in the preview and the exported store (discount codes, totals, order POST)
 *   discounts         optional Discount[] (src/store/admin/discounts.js) when no full commerce document is available
 *
 * Undo/redo (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y) is kept inside the builder; handled shortcuts are stopped on window
 * (capture phase) so they do not reach the rest of the app; typing in inputs is ignored.
 */
const DEVICES = { desktop: [1280, 'Desktop', Monitor], tablet: [820, 'Tablet', Tablet], mobile: [390, 'Mobile', Smartphone] };
const COALESCE_MS = 900, HISTORY = 100;

export default function StoreBuilder({ store, onChange, onExit, onOpenPhotoStudio, assetStore, commerce, discounts }) {
  const commerceSrc = useMemo(() => commerce || (Array.isArray(discounts) ? { discounts } : null), [commerce, discounts]);
  const doc = useMemo(() => store ? (store.kind === 'store' && store.version === STORE_VERSION && store.layout && store.pages ? store : normalizeStore(store)) : null, [store]);
  const [gallery, setGallery] = useState(!store);
  const [view, setView] = useState('design');            // design | products | collections | settings
  const [designTab, setDesignTab] = useState('sections'); // sections | theme | navigation
  const [route, setRoute] = useState({ page: 'home' });
  const [selected, setSelected] = useState(null);
  const [productId, setProductId] = useState(null);
  const [collectionId, setCollectionId] = useState('all');
  const [device, setDevice] = useState('desktop');
  const [interact, setInteract] = useState(false);
  const [toast, setToast] = useState('');
  const [modal, setModal] = useState(null);
  const [tick, bump] = useReducer(x => x + 1, 0);
  const hist = useRef({ past: [], future: [], last: null, at: 0 });
  const docRef = useRef(doc); docRef.current = doc;
  const page = route.page;

  // images
  const resolver = useMemo(() => createImageResolver(assetStore, () => bump()), [assetStore]);
  const imageUrl = useCallback(ref => resolver.url(ref), [resolver]);
  const upload = useCallback(file => uploadImage(file, assetStore), [assetStore]);
  const notify = useCallback(msg => { setToast(msg); clearTimeout(notify.t); notify.t = setTimeout(() => setToast(''), 4000); }, []);

  // ---------- editing & history ----------
  const commit = useCallback((next, label, coalesce) => {
    const h = hist.current, prev = docRef.current, now = Date.now();
    if (!(coalesce && h.last === coalesce && now - h.at < COALESCE_MS)) { if (prev) h.past.push(prev); if (h.past.length > HISTORY) h.past.shift(); }
    h.future = []; h.last = coalesce || null; h.at = now;
    docRef.current = next;
    onChange && onChange(next, label);
    bump();
  }, [onChange]);
  const edit = useCallback((fn, label, coalesce) => {
    const draft = structuredClone(docRef.current); fn(draft);
    commit(normalizeStore(draft), label, coalesce);
  }, [commit]);
  const replace = useCallback((next, label) => commit(normalizeStore(next), label), [commit]);
  const undo = useCallback(() => {
    const h = hist.current; if (!h.past.length) return;
    const prev = h.past.pop(); if (docRef.current) h.future.push(docRef.current); h.last = null;
    docRef.current = prev; onChange && onChange(prev, 'Undo'); bump();
  }, [onChange]);
  const redo = useCallback(() => {
    const h = hist.current; if (!h.future.length) return;
    const next = h.future.pop(); if (docRef.current) h.past.push(docRef.current); h.last = null;
    docRef.current = next; onChange && onChange(next, 'Redo'); bump();
  }, [onChange]);

  useEffect(() => {
    const onKey = e => {
      const t = e.target, typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
      if (typing || !(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); undo(); }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); e.stopPropagation(); redo(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [undo, redo]);

  const pickTemplate = id => { const s = createStore(id); commit(s, 'Apply template ' + (STORE_TEMPLATES.find(t => t.id === id)?.name || '')); setGallery(false); setRoute({ page: 'home' }); setSelected(null); setProductId(s.products[0]?.id || null); setView('design'); };

  // ---------- preview ----------
  const cur = docRef.current;
  const previewRoute = useMemo(() => {
    if (!cur) return route;
    if (view === 'products' && productId && cur.products.some(p => p.id === productId && p.status === 'active')) return { page: 'product', productId };
    if (view === 'collections') return { page: 'collection', collectionId };
    return route;
  }, [cur, route, view, productId, collectionId]);
  // ---------- live preview: one persistent document, patched part by part ----------
  const [srcdoc, setSrcdoc] = useState('');
  const frame = useRef(null);
  const live = useRef({ key: '', ready: false, shown: null, latest: null });
  const prRef = useRef(previewRoute); prRef.current = previewRoute;
  const previewOpts = useMemo(() => ({ mode: 'preview', imageUrl, editor: true, commerce: commerceSrc }), [imageUrl, commerceSrc]);
  const routeKey = cur ? [previewRoute.page, previewRoute.productId || '', previewRoute.collectionId || '', cur.id, cur.templateId].join('|') : '';
  const flush = useCallback(() => {
    const L = live.current, w = frame.current?.contentWindow;
    if (!L.ready || !w || !L.latest || L.latest === L.shown) return;
    const patch = diffParts(L.shown, L.latest);
    L.shown = L.latest;
    if (patch) w.postMessage({ storePatch: patch }, '*');
  }, []);
  useEffect(() => { if (gallery) live.current = { key: '', ready: false, shown: null, latest: null }; }, [gallery]);
  useEffect(() => {
    if (!cur || gallery) return;
    const parts = renderParts(cur, previewRoute, previewOpts), L = live.current;
    if (L.key !== routeKey || !L.shown) {   // first load, other page or other template: full document load
      live.current = { key: routeKey, ready: false, shown: parts, latest: parts };
      setSrcdoc(composePage(parts, previewOpts));
      return;
    }
    L.latest = parts; flush();
  }, [cur, routeKey, previewOpts, gallery, tick, flush]);

  // edits coming from the canvas
  const settingsTarget = (d, sid) => {
    if (sid === d.layout.header.id) return d.layout.header;
    if (sid === d.layout.footer.id) return d.layout.footer;
    return d.pages[prRef.current.page].find(x => x.id === sid);
  };
  const walk = (obj, path, create) => { const ks = path.split('.'); let o = obj; for (const k of ks.slice(0, -1)) { if (o[k] == null) { if (!create) return [null]; o[k] = {}; } o = o[k]; } return [o, ks[ks.length - 1]]; };
  const canvasEdit = useCallback(({ sid, key, value }) => {
    if (key.startsWith('@')) {
      const pr = prRef.current, field = key.slice(1);
      if (!['title', 'description', 'materials'].includes(field)) return;
      edit(d => { const p = d.products.find(x => x.id === pr.productId) || d.products.find(x => x.status === 'active'); if (p) { if (field === 'title' && p.slug === slugify(p.title)) p.slug = slugify(value); p[field] = value; } }, 'Edit text');
      return;
    }
    edit(d => { const sec = settingsTarget(d, sid); if (!sec) return; const [o, k] = walk(sec.settings, key, false); if (o && typeof o === 'object') o[k] = value; }, 'Edit text');
  }, [edit]);
  // alignment picked on the canvas (floating 3×3 grid over a framed image); key = the image's data-fr
  const canvasFrame = useCallback(({ sid, key, x, y }) => edit(d => {
    const m = /^p:(.+):(\d+)$/.exec(key), c = /^c:(.+)$/.exec(key);
    if (m) { const p = d.products.find(q => q.id === m[1]); if (!p || !p.images[+m[2]]) return; const fr = productFrames(p); fr[+m[2]] = normFrame({ ...fr[+m[2]], x, y }); p.imageFrames = fr; return; }
    if (c) { const col = d.collections.find(q => q.id === c[1]); if (col) Object.assign(col, framePatch('image', { ...frameOf(col), x, y })); return; }
    const sec = settingsTarget(d, sid); if (!sec) return;
    const [o, k] = walk(sec.settings, key, false); if (o && typeof o === 'object') Object.assign(o, framePatch(k, { ...frameOf(o, k), x, y }));
  }, 'Image position'), [edit]);
  const moveSection = useCallback((sid, before) => edit(d => {
    const l = d.pages[prRef.current.page], i = l.findIndex(x => x.id === sid); if (i < 0) return;
    const [x] = l.splice(i, 1); const j = before ? l.findIndex(y => y.id === before) : -1; l.splice(j < 0 ? l.length : j, 0, x);
  }, 'Move section'), [edit]);
  const moveBlock = useCallback(({ sid, list, from, to }) => edit(d => {
    const sec = settingsTarget(d, sid); if (!sec) return;
    if (list === 'collections' && !(sec.settings.collections || []).length) sec.settings.collections = (d.collections.length ? d.collections : [ALL_COLLECTION]).map(c => c.id);
    const [o, k] = walk(sec.settings, list, false); const arr = o && o[k];
    if (!Array.isArray(arr) || from < 0 || from >= arr.length || to < 0 || to >= arr.length) return;
    const [x] = arr.splice(from, 1); arr.splice(to, 0, x);
  }, 'Reorder blocks'), [edit]);
  const sectionAction = useCallback(({ sid, action }) => {
    const page = prRef.current.page, l = docRef.current.pages[page], i = l.findIndex(x => x.id === sid); if (i < 0) return;
    const req = REQUIRED_TYPES[page] === l[i].type;
    if (action === 'up' && i > 0) edit(d => { const a = d.pages[page]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; }, 'Move section');
    if (action === 'down' && i < l.length - 1) edit(d => { const a = d.pages[page]; [a[i + 1], a[i]] = [a[i], a[i + 1]]; }, 'Move section');
    if (action === 'duplicate' && !req) { const c = { ...structuredClone(l[i]), id: uid('s') }; edit(d => { d.pages[page].splice(i + 1, 0, c); }, 'Duplicate section'); setSelected(c.id); }
    if (action === 'hide' && !req) edit(d => { d.pages[page][i].hidden = true; }, 'Hide section');
    if (action === 'delete' && !req) { edit(d => { d.pages[page].splice(i, 1); }, 'Delete section'); setSelected(null); }
  }, [edit]);

  const scrollY = useRef(0), lastPath = useRef('');
  useEffect(() => {
    const onMsg = e => {
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      const d = e.data || {};
      if (d.storeReady) {
        const w = frame.current.contentWindow, path = w.document.documentElement.getAttribute('data-path');
        if (path === lastPath.current) w.scrollTo(0, scrollY.current); lastPath.current = path;
        w.addEventListener('scroll', () => { scrollY.current = w.scrollY; });
        w.postMessage({ storeLabels: Object.fromEntries(Object.entries(SECTIONS).map(([k, v]) => [k, v.label])), storeMode: interact ? 'interact' : 'edit', storeHighlight: selected }, '*');
        live.current.ready = true; flush();
      } else if (d.storeKey) { if (d.storeKey === 'undo') undo(); else redo();
      } else if (d.storeSelect) {
        setSelected(d.storeSelect); if (view !== 'design') setView('design'); setDesignTab('sections');
      } else if (d.storeEdit) canvasEdit(d.storeEdit);
      else if (d.storeFrame) canvasFrame(d.storeFrame);
      else if (d.storeMove) moveSection(d.storeMove.sid, d.storeMove.before);
      else if (d.storeMoveBlock) moveBlock(d.storeMoveBlock);
      else if (d.storeAction) sectionAction(d.storeAction);
      else if (d.storeNav) {
        const p = resolveHref(d.from || 'index.html', d.storeNav), r = p && routeForPath(docRef.current, p);
        if (r) { setRoute(r); setSelected(null); if (r.page === 'product') setProductId(r.productId); if (view !== 'design') setView('design'); }
      }
    };
    window.addEventListener('message', onMsg); return () => window.removeEventListener('message', onMsg);
  }, [interact, selected, view, undo, redo, flush, canvasEdit, canvasFrame, moveSection, moveBlock, sectionAction]);
  useEffect(() => { frame.current?.contentWindow?.postMessage({ storeMode: interact ? 'interact' : 'edit', storeHighlight: interact ? null : selected, scroll: true }, '*'); }, [selected, interact]);

  // fit the device width into the preview area
  const stage = useRef(null);
  const [stageW, setStageW] = useState(1000), [stageH, setStageH] = useState(700);
  useEffect(() => {
    const el = stage.current; if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => { setStageW(el.clientWidth - 32); setStageH(el.clientHeight - 32); });
    ro.observe(el); return () => ro.disconnect();
  }, [gallery]);
  const devW = DEVICES[device][0], scale = Math.min(1, stageW / devW);

  // ---------- toolbar actions ----------
  const doExport = async () => {
    try {
      notify('Building the store…');
      const zip = await exportStoreZip(cur, { loadAsset: assetStore ? id => assetStore.get(id) : undefined, commerce: commerceSrc });
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([zip], { type: 'application/zip' })); a.download = slugify(cur.name) + '-store.zip';
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      notify('Store exported as a ZIP. Unzip it and open index.html, or upload the folder to Netlify / GitHub Pages.');
    } catch (err) { notify('Export failed: ' + err.message); }
  };
  const doPreviewTab = async () => {
    const w = window.open('', '_blank');
    await resolver.ready(imageRefs(cur));
    const url = URL.createObjectURL(new Blob([previewShellHtml(cur, imageUrl, { commerce: commerceSrc })], { type: 'text/html' }));
    if (w) w.location.href = url; else notify('The browser blocked the preview tab — allow pop-ups for this site.');
  };
  const doDeploy = async () => {
    const text = deployInstructions(cur);
    try { await navigator.clipboard.writeText(text); notify('Deploy instructions copied to the clipboard.'); }
    catch { setModal({ title: 'Deploy instructions', text }); }
  };

  if (gallery || !cur) return <div className="stRoot"><Gallery onPick={pickTemplate} currentId={cur?.templateId} onCancel={cur ? () => setGallery(false) : onExit} /></div>;

  const env = { store: cur, imageUrl, upload, onOpenPhotoStudio, replace };
  const selectPage = p => { setRoute(p === 'product' ? { page: p, productId: productId || activeProducts(cur)[0]?.id } : p === 'collection' ? { page: p, collectionId: 'all' } : { page: p }); setSelected(null); setView('design'); };
  const h = hist.current;

  return <div className="stRoot">
    <header className="stTop">
      {onExit && <button type="button" className="stIconBtn" aria-label="Exit store builder" title="Exit store builder" onClick={onExit}><ArrowLeft size={16} /></button>}
      <input className="stName" aria-label="Store name" value={cur.name} onChange={e => { const v = e.target.value; edit(d => { d.name = v; if (d.logo.text === cur.name) d.logo.text = v; }, 'Store name', 'name'); }} />
      <div className="insSelect stPageSel"><select aria-label="Page" value={page} onChange={e => selectPage(e.target.value)}>{PAGE_KEYS.map(k => <option key={k} value={k}>{PAGE_LABELS[k]}</option>)}</select><ChevronDown size={14} /></div>
      <div className="segmented icons" role="group" aria-label="Preview device">
        {Object.entries(DEVICES).map(([k, [, label, Icon]]) => <button key={k} type="button" aria-label={label + ' preview'} title={label} aria-pressed={device === k} className={device === k ? 'on' : ''} onClick={() => setDevice(k)}><Icon size={15} /></button>)}
      </div>
      <div className="segmented icons" role="group" aria-label="Preview mode">
        <button type="button" aria-label="Select sections" title="Click sections to edit them" aria-pressed={!interact} className={!interact ? 'on' : ''} onClick={() => setInteract(false)}><MousePointer2 size={15} /></button>
        <button type="button" aria-label="Interact with the store" title="Use links, cart and checkout in the preview" aria-pressed={interact} className={interact ? 'on' : ''} onClick={() => setInteract(true)}><Hand size={15} /></button>
      </div>
      <button type="button" className="stIconBtn" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!h.past.length} onClick={undo}><Undo2 size={16} /></button>
      <button type="button" className="stIconBtn" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!h.future.length} onClick={redo}><Redo2 size={16} /></button>
      <span className="stSpacer" />
      <button type="button" className="stBtn ghost" onClick={() => setGallery(true)}><LayoutTemplate size={14} />Templates</button>
      {onOpenPhotoStudio && <button type="button" className="stBtn ghost" onClick={onOpenPhotoStudio}><Camera size={14} />Product photo studio</button>}
      <button type="button" className="stBtn ghost" onClick={doPreviewTab}><ExternalLink size={14} />Preview in new tab</button>
      <button type="button" className="stBtn ghost" onClick={doDeploy}><ClipboardCopy size={14} />Copy deploy instructions</button>
      <button type="button" className="stBtn stPrimary" onClick={doExport}><Download size={14} />Export store</button>
    </header>

    <div className="stBody">
      <aside className="stLeft" aria-label="Store editor">
        <div className="segmented stTabs" role="tablist" aria-label="Editor">
          {[['design', 'Design'], ['products', 'Products'], ['collections', 'Collections'], ['settings', 'Settings']].map(([k, l]) =>
            <button key={k} type="button" role="tab" aria-selected={view === k} className={view === k ? 'on' : ''} onClick={() => { setView(k); if (k === 'products' && !productId) setProductId(cur.products[0]?.id || null); }}>{l}</button>)}
        </div>
        {view === 'design' && <>
          <div className="stSubTabs" role="tablist" aria-label="Design">
            {[['sections', 'Sections'], ['theme', 'Theme'], ['navigation', 'Navigation']].map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={designTab === k} className={designTab === k ? 'on' : ''} onClick={() => setDesignTab(k)}>{l}</button>)}
          </div>
          {designTab === 'sections' && <SectionsPanel store={cur} page={page} selectedId={selected} onSelect={setSelected} edit={edit} />}
          {designTab === 'theme' && <ThemePanel store={cur} edit={edit} env={env} />}
          {designTab === 'navigation' && <NavPanel store={cur} edit={edit} />}
        </>}
        {view === 'products' && <ProductsPanel store={cur} selectedId={productId} onSelect={setProductId} edit={edit} env={env} notify={notify} />}
        {view === 'collections' && <CollectionsPanel store={cur} selectedId={collectionId} onSelect={setCollectionId} edit={edit} />}
        {view === 'settings' && <SettingsPanel store={cur} edit={edit} />}
      </aside>

      <main className="stStage" ref={stage} aria-label="Live preview">
        <div className="stFrameBox" style={{ width: devW * scale, height: stageH }}>
          <iframe ref={frame} title="Store preview" className={'stFrame ' + device} srcDoc={srcdoc}
            style={{ width: devW, height: stageH / scale, transform: `scale(${scale})` }} />
        </div>
      </main>

      <aside className="stRight" aria-label="Settings panel">
        {view === 'products' ? <ProductEditor store={cur} productId={productId} edit={edit} env={env} />
          : view === 'collections' ? <CollectionEditor store={cur} collectionId={collectionId} edit={edit} env={env} />
          : <SectionInspector store={cur} page={page} selectedId={selected} edit={edit} env={env} />}
      </aside>
    </div>
    <div className="stToast" role="status" aria-live="polite">{toast}</div>
    {modal && <div className="stModal" role="dialog" aria-modal="true" aria-label={modal.title}><div className="stModalBox">
      <div className="stModalHead"><h2>{modal.title}</h2><button type="button" className="stIconBtn" aria-label="Close" onClick={() => setModal(null)}><X size={16} /></button></div>
      <textarea className="insText" readOnly rows={18} aria-label={modal.title + ' text'} value={modal.text} onFocus={e => e.target.select()} />
    </div></div>}
  </div>;
}
