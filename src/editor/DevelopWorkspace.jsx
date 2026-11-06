import { resample } from '../engine/geometry.js';
import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { developDefaults, autoTone, autoWhiteBalance } from '../engine/develop.js';
import { histogram } from '../engine/adjust.js';
import {
  emptyCatalog, normalizeCatalog, idbCatalogBackend, importPhotos, getPhoto, parseExif, formatExif,
  setRating, setFlag, setLabel, setKeywords, parseKeywords, allKeywords, filterPhotos, sortPhotos,
  addCollection, renameCollection, deleteCollection, addToCollection, removeFromCollection, removePhotos, createVirtualCopy,
  setDevelop, goToHistory, addSnapshot, applySnapshot, deleteSnapshot, pickPanels, pasteSettings, syncSettings, resetDevelop,
  describeChange, applyPreset, allPresets, savePreset, deletePreset, PANELS, ALL_PANELS,
  previewCacheKey, cachePut, fitLongEdge, planExport, settingsHash, LABELS,
} from '../engine/catalog.js';
import { DevelopPanelStack, ProfileControls, RgbHistogram, sampleForPick, pickHint, PANELS_OPEN_DEFAULT } from './DevelopPanels.jsx';

// Library + Develop workspace (Lightroom-style). A photo catalog with non-destructive develop
// settings: originals are stored once in the AssetStore and never modified; settings, history,
// snapshots, ratings, flags, labels, keywords and collections live in the catalog
// (src/engine/catalog.js, persisted in IndexedDB `zertake-catalog`). Rendering goes through
// develop() in the ops worker: a ≤1600 px preview while editing, the full-resolution original for
// export and "Edit in Zertake". Thumbnails/previews are cached as JPEG blobs in the AssetStore,
// keyed by (original asset, settings hash, size).
//
// Props: { assetStore, runOp, onClose, onEditInEditor, catalogBackend? }
//   runOp(op, buf, params, ctx) → Promise<buf>  (createOpsClient().run — give the workspace its own client)
//   onEditInEditor(blob, name)  → open the developed full-res PNG as a new document
//   catalogBackend              optional {load, save}; defaults to idbCatalogBackend()
// While mounted, keyboard shortcuts are captured at window level so they never reach the editor.

const PREVIEW_EDGE = 1600, THUMB_EDGE = 320;
const LABEL_COLORS = { red: '#e5484d', yellow: '#e5c84d', green: '#46a758', blue: '#3e7bfa', purple: '#9b5de5' };
const SORTS = [['capture', 'Capture time'], ['import', 'Import time'], ['name', 'File name'], ['rating', 'Rating']];
const typing = t => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
const baseName = n => n.replace(/\.[^.]+$/, '');

// ---------------------------------------------------------------- pixels in/out (browser)
const mkCanvas = (w, h) => typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
async function decodeBlob(blob, maxEdge = 0) {
  const probe = await createImageBitmap(blob);
  const W = probe.width, H = probe.height, { w, h } = fitLongEdge(W, H, maxEdge);
  let bmp = probe;
  if (w !== W || h !== H) { try { bmp = await createImageBitmap(blob, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' }); } catch { bmp = probe; } }
  const c = mkCanvas(w, h), ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high'; ctx.drawImage(bmp, 0, 0, w, h);
  if (bmp !== probe) bmp.close?.(); probe.close?.();
  return { buf: { w, h, data: ctx.getImageData(0, 0, w, h).data }, W, H };
}
async function encodeBuf(buf, mime, quality) {
  let c = mkCanvas(buf.w, buf.h);
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(buf.data), buf.w, buf.h), 0, 0);
  if (mime === 'image/jpeg') { const f = mkCanvas(buf.w, buf.h), x = f.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, buf.w, buf.h); x.drawImage(c, 0, 0); c = f; }
  if (c.convertToBlob) return c.convertToBlob({ type: mime, quality });
  return new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(Error('Encoding failed')), mime, quality));
}
const drawBuf = (canvas, buf, W = buf?.w, H = buf?.h) => {
  if (!canvas || !buf) return; canvas.width = W; canvas.height = H; const im = new ImageData(new Uint8ClampedArray(buf.data), buf.w, buf.h), ctx = canvas.getContext('2d');
  if (buf.w === W && buf.h === H) return ctx.putImageData(im, 0, 0);
  const t = document.createElement('canvas'); t.width = buf.w; t.height = buf.h; t.getContext('2d').putImageData(im, 0, 0); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(t, 0, 0, W, H);
};

// One worker client runs one job at a time and a new run() cancels the running one, so jobs are
// serialised here: export > preview > background thumbnails. A new preview supersedes a running
// or queued preview (real cancellation); other kinds always run to completion.
function createScheduler(runOp) {
  let active = null; const queue = [];
  const PRI = { export: 3, preview: 2, bg: 1 };
  const cancelled = () => Object.assign(Error('cancelled'), { cancelled: true });
  const start = job => {
    active = job;
    let p; try { p = runOp(job.op, job.buf, job.params, job.ctx); } catch (e) { p = Promise.reject(e); }
    p.then(r => { if (active !== job) return; active = null; job.resolve(r); pump(); }, e => { if (active !== job) return; active = null; job.reject(e); pump(); });
  };
  const pump = () => {
    if (active || !queue.length) return;
    let best = 0; for (let i = 1; i < queue.length; i++) if (PRI[queue[i].kind] > PRI[queue[best].kind]) best = i;
    start(queue.splice(best, 1)[0]);
  };
  const run = (kind, op, buf, params, ctx = {}) => new Promise((resolve, reject) => {
    const job = { kind, op, buf, params, ctx, resolve, reject };
    if (kind === 'preview') {
      for (let i = queue.length - 1; i >= 0; i--) if (queue[i].kind === 'preview') queue.splice(i, 1)[0].reject(cancelled());
      // a running preview is never killed (that restarts the worker); the newest request waits for it
    }
    queue.push(job); pump();
  });
  const dispose = () => { for (const j of queue.splice(0)) j.reject(cancelled()); active = null; };
  return { run, dispose };
}

// ---------------------------------------------------------------- small components
function Thumb({ mgr, photo, size, eager }) {
  const [, force] = useReducer(x => x + 1, 0), [seen, setSeen] = useState(!!eager), box = useRef();
  const key = previewCacheKey(photo.assetId, photo.develop, size);
  useEffect(() => mgr.subscribe(force), []);
  useEffect(() => {
    if (seen || !box.current || typeof IntersectionObserver === 'undefined') { setSeen(true); return; }
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { setSeen(true); io.disconnect(); } }, { rootMargin: '200px' });
    io.observe(box.current); return () => io.disconnect();
  }, []);
  useEffect(() => { if (seen) mgr.request(photo, size); }, [key, seen]);
  const url = mgr.url(photo, size), err = mgr.error(photo, size);
  return <div ref={box} className="dvwImgBox">{url ? <img src={url} alt="" draggable={false} /> : <span className="dvwPh" title={err || 'Rendering…'}>{err ? '!' : ''}</span>}</div>;
}

function Badges({ p }) {
  return <div className="dvwBadges">
    <span className="dvwStars" aria-label={p.rating + ' stars'}>{'★'.repeat(p.rating)}<i>{'★'.repeat(5 - p.rating)}</i></span>
    {p.flag && <span className={'dvwFlag ' + p.flag} title={p.flag === 'pick' ? 'Pick' : 'Rejected'}>{p.flag === 'pick' ? '⚑' : '✕'}</span>}
    {p.virtualOf && <span className="dvwVirtual" title="Virtual copy">⧉</span>}
    {p.label && <span className="dvwLabel" style={{ background: LABEL_COLORS[p.label] }} title={p.label + ' label'} />}
  </div>;
}

function PanelPicker({ title, okLabel, withName, onOk, onCancel }) {
  const [sel, setSel] = useState(() => new Set(ALL_PANELS)), [name, setName] = useState('');
  const flip = k => setSel(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  return <div className="dvwModalBack"><div className="opDialog dvwModal" role="dialog" aria-label={title}>
    <h3>{title}</h3>
    {withName && <label className="dvwField"><span>Preset name</span><input aria-label="Preset name" value={name} onChange={e => setName(e.target.value)} autoFocus /></label>}
    <div className="dvwChecks">{ALL_PANELS.map(k => <label key={k} className="optCheck"><input type="checkbox" checked={sel.has(k)} onChange={() => flip(k)} />{PANELS[k].name}</label>)}</div>
    <div className="dvwRowBtns"><button onClick={() => setSel(new Set(ALL_PANELS))}>Check All</button><button onClick={() => setSel(new Set())}>Check None</button></div>
    <footer><button onClick={onCancel}>Cancel</button><button className="primary" disabled={!sel.size || (withName && !name.trim())} onClick={() => onOk(ALL_PANELS.filter(k => sel.has(k)), name)}>{okLabel}</button></footer>
  </div></div>;
}

function ExportDialog({ photos, render, onClose }) {
  const [format, setFormat] = useState('jpeg'), [quality, setQuality] = useState(90), [resize, setResize] = useState(false), [edge, setEdge] = useState(2048);
  const [template, setTemplate] = useState('{name}'), [startSeq, setStartSeq] = useState(1);
  const [state, setState] = useState({ running: false, done: 0, files: [], error: null }), stop = useRef(false), made = useRef([]);
  const plan = planExport(photos, { format, quality, longEdge: resize ? edge : 0, template, startSeq });
  // object URLs live until the dialog closes (links must keep working while it is open)
  useEffect(() => () => { stop.current = true; made.current.forEach(u => URL.revokeObjectURL(u)); }, []);
  const go = async () => {
    stop.current = false;
    setState({ running: true, done: 0, files: [], error: null });
    const files = [];
    try {
      for (const [i, item] of plan.entries()) {
        if (stop.current) return;
        const blob = await render(photos[i], { w: item.w, h: item.h }, item.mime, item.quality);
        const url = URL.createObjectURL(blob); made.current.push(url);
        files.push({ name: item.fileName, url, size: blob.size });
        setState({ running: true, done: i + 1, files: [...files], error: null });
      }
      setState({ running: false, done: files.length, files, error: null });
    } catch (e) { setState({ running: false, done: files.length, files, error: e.message }); }
  };
  return <div className="dvwModalBack"><div className="opDialog dvwModal dvwExport" role="dialog" aria-label="Export photos">
    <h3>Export {photos.length} photo{photos.length === 1 ? '' : 's'}</h3>
    <label className="dvwField"><span>Format</span><select aria-label="Export format" value={format} onChange={e => setFormat(e.target.value)}><option value="jpeg">JPEG</option><option value="png">PNG</option></select></label>
    {format === 'jpeg' && <label className="dvwField"><span>Quality {quality}</span><input type="range" aria-label="JPEG quality" min={10} max={100} value={quality} onChange={e => setQuality(+e.target.value)} /></label>}
    <label className="optCheck"><input type="checkbox" aria-label="Resize to fit long edge" checked={resize} onChange={e => setResize(e.target.checked)} />Resize to fit (long edge)</label>
    {resize && <label className="dvwField"><span>Long edge (px)</span><input type="number" aria-label="Long edge pixels" min={16} max={30000} value={edge} onChange={e => setEdge(Math.max(16, +e.target.value || 16))} /></label>}
    <label className="dvwField"><span>File name</span><input aria-label="File name template" value={template} onChange={e => setTemplate(e.target.value)} /></label>
    <p className="hint">Tokens: {'{name}'} original name, {'{seq}'} or {'{seq:3}'} sequence number, {'{date}'} capture date. Example: {plan[0]?.fileName}</p>
    <label className="dvwField"><span>Start number</span><input type="number" aria-label="Start number" min={0} value={startSeq} onChange={e => setStartSeq(Math.max(0, Math.round(+e.target.value || 0)))} /></label>
    <div className="dvwStatusLine" role="status">{state.running ? `Rendering ${state.done + 1} of ${photos.length} at full resolution…` : state.error ? 'Export failed: ' + state.error : state.files.length ? `${state.files.length} file${state.files.length === 1 ? '' : 's'} ready. Click to download:` : ''}</div>
    {!!state.files.length && <ul className="dvwFiles">{state.files.map(f => <li key={f.url}><a href={f.url} download={f.name}>{f.name}</a> <span>{(f.size / 1024).toFixed(0)} KB</span></li>)}</ul>}
    <footer><button onClick={() => { stop.current = true; onClose(); }}>{state.files.length && !state.running ? 'Done' : 'Cancel'}</button><button className="primary" disabled={state.running || !photos.length} onClick={go}>Export</button></footer>
  </div></div>;
}

function InlineName({ initial, label, onDone }) {
  const [v, setV] = useState(initial);
  return <input className="dvwInline" aria-label={label} value={v} autoFocus onChange={e => setV(e.target.value)} onBlur={() => onDone(v)} onKeyDown={e => { if (e.key === 'Enter') onDone(v); if (e.key === 'Escape') onDone(null); }} />;
}

// ---------------------------------------------------------------- workspace
export default function DevelopWorkspace({ assetStore, runOp, onClose, onEditInEditor, catalogBackend }) {
  const backend = useMemo(() => catalogBackend || idbCatalogBackend(), []);
  const [cat, setCatState] = useState(null), catRef = useRef(null), [loadErr, setLoadErr] = useState(null);
  // catRef is the synchronous source of truth so async jobs never apply updates to a stale catalog
  const setCat = fn => { const n = typeof fn === 'function' ? fn(catRef.current) : fn; if (n === catRef.current) return; catRef.current = n; setCatState(n); };
  const [module, setModule] = useState('library'), [view, setView] = useState('grid');
  const [source, setSource] = useState('all'), [filter, setFilter] = useState({ text: '', minRating: 0, flag: 'any', label: 'any', keyword: '' });
  const [sort, setSort] = useState({ key: 'capture', dir: 'asc' }), [thumbSize, setThumbSize] = useState(160);
  const [sel, setSel] = useState({ ids: [], active: null, anchor: null });
  const [msg, setMsg] = useState(''), [busy, setBusy] = useState(false), [dialog, setDialog] = useState(null);
  const [editingCol, setEditingCol] = useState(null), [kwText, setKwText] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const runOpRef = useRef(runOp); runOpRef.current = runOp;
  const sched = useMemo(() => createScheduler((...a) => runOpRef.current(...a)), []);
  const fileInput = useRef(), gridRef = useRef();

  // ---- load / save catalog
  useEffect(() => { backend.load().then(raw => { const c = normalizeCatalog(raw); catRef.current = c; setCatState(c); }).catch(e => { setLoadErr(e.message); const c = emptyCatalog(); catRef.current = c; setCatState(c); }); }, []);
  const saveTimer = useRef(0), loaded = useRef(false);
  useEffect(() => {
    if (!cat) return; if (!loaded.current) { loaded.current = true; return; }
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => backend.save(cat).catch(e => setMsg('Could not save the catalog: ' + e.message)), 400);
  }, [cat]);

  // ---- decoded pixels + thumbnail/preview manager (AssetStore-cached JPEGs)
  const mgr = useMemo(() => {
    const urls = new Map(), last = new Map(), errors = new Map(), inflight = new Set(), subs = new Set(), decoded = new Map();
    let slots = 2; const waiting = [];
    const notify = () => subs.forEach(f => f());
    const acquire = () => slots > 0 ? (slots--, Promise.resolve()) : new Promise(r => waiting.push(r));
    const release = () => { const n = waiting.shift(); if (n) n(); else slots++; };
    const getDecoded = (assetId, edge) => {
      const k = assetId + '|' + edge;
      if (decoded.has(k)) { const v = decoded.get(k); decoded.delete(k); decoded.set(k, v); return v; }
      const p = assetStore.get(assetId).then(b => decodeBlob(b, edge));
      decoded.set(k, p); p.catch(() => decoded.delete(k));
      const limit = 40; for (const key of decoded.keys()) { if (decoded.size <= limit) break; decoded.delete(key); }
      return p;
    };
    const urlFor = (id, blob) => { if (!urls.has(id)) urls.set(id, URL.createObjectURL(blob)); return urls.get(id); };
    const request = async (photo, size) => {
      const key = previewCacheKey(photo.assetId, photo.develop, size), slot = photo.id + '|' + size;
      const cached = catRef.current?.cache[key];
      if (cached && urls.has(cached)) { if (last.get(slot) !== urls.get(cached)) { last.set(slot, urls.get(cached)); notify(); } return; }
      if (inflight.has(key)) return; inflight.add(key);
      try {
        if (cached) { try { last.set(slot, urlFor(cached, await assetStore.get(cached))); errors.delete(slot); notify(); return; } catch { /* regenerate below */ } }
        await acquire();
        try {
          const { buf, W } = await getDecoded(photo.assetId, size);
          const plain = settingsHash(photo.develop) === settingsHash({});
          const out = plain ? buf : await sched.run('bg', 'cameraRaw', buf, { settings: photo.develop }, { scale: buf.w / W });
          const blob = await encodeBuf(out, 'image/jpeg', 0.85), id = await assetStore.put(blob);
          setCat(c => cachePut(c, key, id));
          last.set(slot, urlFor(id, blob)); errors.delete(slot); notify();
        } finally { release(); }
      } catch (e) { if (!e.cancelled) { errors.set(slot, e.message); notify(); } }
      finally { inflight.delete(key); }
    };
    return {
      request, getDecoded, subscribe: f => { subs.add(f); return () => subs.delete(f); },
      url: (photo, size) => { const id = catRef.current?.cache[previewCacheKey(photo.assetId, photo.develop, size)]; return (id && urls.get(id)) || last.get(photo.id + '|' + size) || null; },
      error: (photo, size) => errors.get(photo.id + '|' + size) || null,
      dispose: () => { urls.forEach(u => URL.revokeObjectURL(u)); urls.clear(); },
    };
  }, []);
  useEffect(() => () => { mgr.dispose(); sched.dispose(); }, []);

  // ---- visible photos & selection
  const visible = useMemo(() => cat ? sortPhotos(filterPhotos(cat, { ...filter, source }), sort.key, sort.dir) : [], [cat, filter, source, sort]);
  const active = cat && sel.active ? getPhoto(cat, sel.active) : null;
  const selectedIds = sel.ids.length ? sel.ids : sel.active ? [sel.active] : [];
  const targets = () => (module === 'library' && view === 'grid') ? selectedIds : sel.active ? [sel.active] : [];
  const selectOnly = id => setSel({ ids: id ? [id] : [], active: id, anchor: id });
  const clickPhoto = (e, id) => {
    if (e.shiftKey && sel.anchor) {
      const a = visible.findIndex(p => p.id === sel.anchor), b = visible.findIndex(p => p.id === id);
      if (a >= 0 && b >= 0) { const range = visible.slice(Math.min(a, b), Math.max(a, b) + 1).map(p => p.id); setSel(s => ({ ids: e.ctrlKey || e.metaKey ? [...new Set([...s.ids, ...range])] : range, active: id, anchor: s.anchor })); return; }
    }
    if (e.ctrlKey || e.metaKey) { setSel(s => { const has = s.ids.includes(id), ids = has ? s.ids.filter(x => x !== id) : [...s.ids, id]; return { ids, active: has ? ids[ids.length - 1] || null : id, anchor: id }; }); return; }
    selectOnly(id);
  };
  useEffect(() => { if (sel.active && cat && !getPhoto(cat, sel.active)) setSel(s => ({ ids: s.ids.filter(id => getPhoto(cat, id)), active: null, anchor: null })); }, [cat]);
  useEffect(() => { if (!sel.active && visible.length && module === 'develop') selectOnly(visible[0].id); }, [module, visible.length]);
  const curActive = useRef(null), [prevId, setPrevId] = useState(null);
  useEffect(() => { if (sel.active !== curActive.current) { if (curActive.current) setPrevId(curActive.current); curActive.current = sel.active; } }, [sel.active]);

  // ---- develop: live settings, debounced commit with per-control history labels
  const [s, setS] = useState(developDefaults()), sRef = useRef(s), pending = useRef(null), commitTimer = useRef(0);
  const flush = label => {
    clearTimeout(commitTimer.current); const p = pending.current; pending.current = null;
    if (p) setCat(c => getPhoto(c, p.id) ? setDevelop(c, p.id, p.settings, label || p.label) : c);
  };
  const change = (next, label) => {
    const id = sel.active; if (!id) return;
    const lbl = label || describeChange(sRef.current, next);
    if (pending.current && (pending.current.id !== id || pending.current.label !== lbl)) flush();
    sRef.current = next; setS(next);
    pending.current = { id, settings: next, label: lbl };
    if (label) flush(); else { clearTimeout(commitTimer.current); commitTimer.current = setTimeout(() => flush(), 700); }
  };
  const set = patch => change({ ...sRef.current, ...patch });
  const setIn = (k, patch) => change({ ...sRef.current, [k]: { ...sRef.current[k], ...patch } });
  useEffect(() => {
    if (!active || (pending.current && pending.current.id === active.id)) return;
    if (settingsHash(active.develop) !== settingsHash(sRef.current)) { sRef.current = active.develop; setS(active.develop); }
  }, [active?.id, active?.develop]);
  useEffect(() => { flush(); }, [sel.active, module]);
  // every explicit catalog action first commits a pending slider edit
  const act = fn => { flush(); setCat(fn); };

  // ---- develop preview
  const [src, setSrc] = useState(null), [preview, setPreview] = useState(null), [hist, setHist] = useState(null), [rendering, setRendering] = useState(false);
  const [ba, setBa] = useState('after'), [pick, setPick] = useState(null), [open, setOpen] = useState(() => ({ ...PANELS_OPEN_DEFAULT }));
  const afterCanvas = useRef(), beforeCanvas = useRef(), previewTimer = useRef(0);
  useEffect(() => {
    if (module !== 'develop' || !active) { return; }
    if (src && src.assetId === active.assetId) return;
    let alive = true; setPreview(null); setHist(null); setSrc(null);
    mgr.getDecoded(active.assetId, PREVIEW_EDGE).then(d => { if (alive) setSrc({ assetId: active.assetId, buf: d.buf, scale: d.buf.w / d.W }); }).catch(e => alive && setMsg('Could not decode ' + active.name + ': ' + e.message));
    return () => { alive = false; };
  }, [module, active?.assetId]);
  useEffect(() => {
    if (module !== 'develop' || !src) return;
    // fast low-resolution pass right away, full preview once the sliders rest
    const render = async (b, scale, full) => {
      setRendering(true);
      try { const r = await sched.run('preview', 'cameraRaw', b, { settings: sRef.current }, { scale }); setPreview(r); if (full) setHist(histogram(r)); setRendering(false); }
      catch (e) { if (!e.cancelled) { setMsg('Preview failed: ' + e.message); setRendering(false); } }
    };
    // interactive proxy sized to this machine (largest that renders in ~70 ms; none if the full preview is that fast)
    const L = Math.max(src.buf.w, src.buf.h), ms = src.fullMs || 0, want = ms ? Math.round(Math.min(L, Math.max(480, L * Math.sqrt(70 / ms)))) : 0;
    if (!ms || want >= L * 0.92) src.tiny = null;
    else if (!src.tiny || Math.abs(Math.max(src.tiny.w, src.tiny.h) - want) > want * 0.1) { const k = want / L; src.tiny = resample(src.buf, Math.max(1, Math.round(src.buf.w * k)), Math.max(1, Math.round(src.buf.h * k)), 'bilinear'); }
    if (src.tiny) render(src.tiny, src.scale * src.tiny.w / src.buf.w, false);
    clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(async () => { const t0 = performance.now(); await render(src.buf, src.scale, true); const d = performance.now() - t0; src.fullMs = src.fullMs ? src.fullMs * 0.6 + d * 0.4 : d; }, src.tiny ? 220 : 0);
  }, [s, src, module]);
  useEffect(() => { if (module === 'develop' && src) { drawBuf(afterCanvas.current, ba === 'before' ? src.buf : preview || src.buf, src.buf.w, src.buf.h); if (ba === 'split') drawBuf(beforeCanvas.current, src.buf); } }, [preview, src, ba, module]);
  const sampleAt = e => {
    if (!pick || !src) return;
    const r = e.currentTarget.getBoundingClientRect(), x = Math.floor((e.clientX - r.left) / r.width * src.buf.w), y = Math.floor((e.clientY - r.top) / r.height * src.buf.h);
    const res = sampleForPick(pick, src.buf, x, y, sRef.current);
    if (res.setIn) setIn(...res.setIn); else if (res.patch) set(res.patch);
    setPick(null);
  };

  // ---- full-resolution render (export, Edit in Zertake)
  const renderFull = async (photo, size, mime, quality) => {
    const settings = photo.id === sel.active && pending.current ? pending.current.settings : photo.develop;
    const { buf } = await decodeBlob(await assetStore.get(photo.assetId), 0);
    let out = await sched.run('export', 'cameraRaw', buf, { settings }, { scale: 1 });
    if (size && (size.w !== out.w || size.h !== out.h)) out = await sched.run('export', 'resample', out, { w: size.w, h: size.h, method: 'bicubic' }, {});
    return encodeBuf(out, mime, quality);
  };
  const editInZertake = async () => {
    if (!active) return; flush(); setBusy(true); setMsg('Rendering ' + active.name + ' at full resolution…');
    try { const blob = await renderFull(active, null, 'image/png'); setMsg(''); onEditInEditor(blob, baseName(active.name)); }
    catch (e) { setMsg('Could not render: ' + e.message); } finally { setBusy(false); }
  };

  // ---- import
  const importFiles = async files => {
    files = [...files]; if (!files.length || !catRef.current) return;
    setBusy(true); const records = [], failed = [];
    for (const [i, f] of files.entries()) {
      setMsg(`Importing ${i + 1} of ${files.length}: ${f.name}`);
      try {
        const bytes = new Uint8Array(await f.arrayBuffer());
        const bmp = await createImageBitmap(f).catch(() => null);
        if (!bmp) { failed.push(f.name); continue; }
        const w = bmp.width, h = bmp.height; bmp.close?.();
        const assetId = await assetStore.put(new Blob([bytes], { type: f.type || 'application/octet-stream' }));
        records.push({ assetId, name: f.name, w, h, exif: parseExif(bytes) });
      } catch (e) { failed.push(f.name + ' (' + e.message + ')'); }
    }
    const res = importPhotos(catRef.current, records); setCat(res.cat);
    setBusy(false);
    const added = res?.added.length || 0;
    setMsg(`Imported ${added} photo${added === 1 ? '' : 's'}` + (res?.duplicates.length ? `, skipped ${res.duplicates.length} duplicate${res.duplicates.length === 1 ? '' : 's'}` : '') + (failed.length ? `. Could not decode: ${failed.join(', ')}` : ''));
    if (added) { setSource('recent'); setView('grid'); selectOnly(res.added[0]); }
  };

  // ---- quick develop (library)
  const quick = async (label, fn, needsPixels = false) => {
    const ids = targets(); if (!ids.length) return; flush(); setBusy(true);
    try {
      for (const id of ids) {
        const p = getPhoto(catRef.current, id); if (!p) continue;
        const buf = needsPixels ? (await mgr.getDecoded(p.assetId, THUMB_EDGE)).buf : null;
        setCat(c => { const q = getPhoto(c, id); return q ? setDevelop(c, id, { ...q.develop, ...fn(q.develop, buf) }, label) : c; });
      }
    } catch (e) { setMsg(label + ' failed: ' + e.message); } finally { setBusy(false); }
  };
  const exposureStep = (d, l) => quick('Exposure ' + l, s0 => ({ exposure: Math.max(-5, Math.min(5, Math.round((s0.exposure + d) * 100) / 100)) }));

  // ---- navigation & keyboard
  const move = delta => {
    if (!visible.length) return;
    const i = visible.findIndex(p => p.id === sel.active), j = Math.max(0, Math.min(visible.length - 1, (i < 0 ? 0 : i + delta)));
    selectOnly(visible[j].id);
  };
  const gridCols = () => { const el = gridRef.current; return el ? Math.max(1, Math.floor((el.clientWidth - 16 + 8) / (thumbSize + 8))) : 1; };
  const removeSelected = () => { const ids = targets(); if (ids.length) setDialog({ type: 'remove', ids }); };
  const virtualCopy = () => { if (!sel.active) return; flush(); const r = createVirtualCopy(catRef.current, sel.active); setCat(r.cat); if (r.id) selectOnly(r.id); };
  const [clip, setClip] = useState(null);
  const keyRef = useRef(); keyRef.current = (e, fromInput) => {
    if (dialog) { if (e.key === 'Escape') { setDialog(null); e.preventDefault(); } return; }
    if (fromInput) return;
    const k = e.key, mod = e.ctrlKey || e.metaKey, t = targets();
    let handled = true;
    if (mod && (k === 'a' || k === 'A') && !e.shiftKey) setSel(x => ({ ids: visible.map(p => p.id), active: x.active || visible[0]?.id || null, anchor: x.anchor }));
    else if (mod && e.shiftKey && (k === 'c' || k === 'C') && active) setDialog({ type: 'copy' });
    else if (mod && e.shiftKey && (k === 'v' || k === 'V') && clip) act(c => pasteSettings(c, selectedIds, clip));
    else if (mod && k === "'") virtualCopy();
    else if (mod || e.altKey) handled = false;
    else if (k >= '0' && k <= '5') act(c => setRating(c, t, +k));
    else if (k >= '6' && k <= '9') act(c => setLabel(c, t, LABELS[+k - 6]));
    else if (k === 'p' || k === 'P') act(c => setFlag(c, t, 'pick'));
    else if (k === 'x' || k === 'X') act(c => setFlag(c, t, 'reject'));
    else if (k === 'u' || k === 'U') act(c => setFlag(c, t, null));
    else if (k === 'g' || k === 'G') { setModule('library'); setView('grid'); }
    else if (k === 'e' || k === 'E') { if (sel.active || visible.length) { if (!sel.active) selectOnly(visible[0].id); setModule('library'); setView('loupe'); } }
    else if (k === 'd' || k === 'D') { if (visible.length || sel.active) setModule('develop'); }
    else if (k === '\\' && module === 'develop') setBa(b => b === 'before' ? 'after' : 'before');
    else if (k === 'ArrowLeft') move(-1);
    else if (k === 'ArrowRight') move(1);
    else if (k === 'ArrowUp') move(module === 'library' && view === 'grid' ? -gridCols() : -1);
    else if (k === 'ArrowDown') move(module === 'library' && view === 'grid' ? gridCols() : 1);
    else if (k === 'Delete' || k === 'Backspace') removeSelected();
    else if (k === 'Escape') { if (pick) setPick(null); else if (module === 'library' && view === 'loupe') setView('grid'); else handled = false; }
    else handled = false;
    if (handled) e.preventDefault();
  };
  useEffect(() => {
    // Capture phase on window: runs before the editor's window listeners. Keys typed into our own
    // inputs pass through untouched (the editor ignores typing); all other keys stop here.
    const h = e => { if (typing(e.target)) { if (e.key === 'Escape') keyRef.current(e, true); return; } e.stopPropagation(); keyRef.current(e); };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, []);

  const close = async () => { flush(); clearTimeout(saveTimer.current); await Promise.resolve(); try { if (catRef.current) await backend.save(catRef.current); } catch (e) { setMsg('Could not save the catalog: ' + e.message); return; } onClose(); };

  if (!cat) return <div className="dvw" role="dialog" aria-label="Library and Develop"><div className="dvwLoading" role="status">Opening catalog…</div></div>;

  const counts = { all: cat.photos.length, picks: cat.photos.filter(p => p.flag === 'pick').length, recent: cat.photos.filter(p => p.importBatch === cat.lastImport).length };
  const keywords = allKeywords(cat), presets = allPresets(cat);
  const many = selectedIds.length > 1;

  // ---------------- render pieces
  const filmstrip = <div className="dvwFilm" role="listbox" aria-label="Filmstrip" aria-multiselectable="true">
    {visible.map(p => <div key={p.id} role="option" aria-selected={selectedIds.includes(p.id)} aria-label={p.name} className={'dvwFilmCell' + (selectedIds.includes(p.id) ? ' sel' : '') + (p.id === sel.active ? ' active' : '')} onClick={e => clickPhoto(e, p.id)} onDoubleClick={() => { selectOnly(p.id); if (module === 'library') setView('loupe'); }}>
      <Thumb mgr={mgr} photo={p} size={THUMB_EDGE} />{p.label && <span className="dvwLabel" style={{ background: LABEL_COLORS[p.label] }} />}</div>)}
  </div>;

  const importArea = <div className="dvwImport">
    <button className="primary" onClick={() => fileInput.current.click()} disabled={busy}>Import Photos…</button>
    <input ref={fileInput} type="file" hidden multiple aria-label="Import photo files" accept="image/jpeg,image/png,image/webp,image/tiff,.jpg,.jpeg,.png,.webp,.tif,.tiff" onChange={e => { importFiles(e.target.files); e.target.value = ''; }} />
    <p className="hint">Drop files anywhere here. JPEG, PNG and WebP (TIFF only if this browser can decode it). Camera RAW files (CR3, NEF, ARW, DNG…) are not supported.</p>
  </div>;

  const libraryLeft = <aside className="dvwLeft" aria-label="Library panels">
    {importArea}
    <section className="dvwSec"><h4>Catalog</h4>
      {[['all', 'All Photographs'], ['picks', 'Picks'], ['recent', 'Recent Import']].map(([k, l]) => <button key={k} className={'dvwSrc' + (source === k ? ' on' : '')} aria-pressed={source === k} onClick={() => setSource(k)}><span>{l}</span><em>{counts[k]}</em></button>)}
    </section>
    <section className="dvwSec"><h4>Collections <button className="dvwMini" aria-label="New collection" title="New collection" onClick={() => setEditingCol('new')}>+</button></h4>
      {editingCol === 'new' && <InlineName initial="New Collection" label="New collection name" onDone={v => { setEditingCol(null); if (v && v.trim()) { const r = addCollection(catRef.current, v); setCat(r.cat); setSource(r.id); } }} />}
      {cat.collections.map(c => editingCol === c.id ? <InlineName key={c.id} initial={c.name} label={'Rename ' + c.name} onDone={v => { setEditingCol(null); if (v && v.trim()) setCat(x => renameCollection(x, c.id, v)); }} />
        : <div key={c.id} className="dvwColRow"><button className={'dvwSrc' + (source === c.id ? ' on' : '')} aria-pressed={source === c.id} onClick={() => setSource(c.id)}><span>{c.name}</span><em>{cat.photos.filter(p => p.collections.includes(c.id)).length}</em></button>
          <button className="dvwMini" aria-label={'Rename collection ' + c.name} title="Rename" onClick={() => setEditingCol(c.id)}>✎</button>
          <button className="dvwMini" aria-label={'Delete collection ' + c.name} title="Delete" onClick={() => setDialog({ type: 'deleteCol', id: c.id, name: c.name })}>🗑</button></div>)}
      {!cat.collections.length && editingCol !== 'new' && <p className="hint">No collections yet.</p>}
    </section>
  </aside>;

  const tp = targets().map(id => getPhoto(cat, id)).filter(Boolean), one = tp[0];
  const libraryRight = <aside className="dvwRight" aria-label="Library details">
    <section className="dvwSec"><h4>Quick Develop {tp.length > 1 && <em>({tp.length} photos)</em>}</h4>
      <div className="dvwBtnGrid">
        <button disabled={!tp.length || busy} onClick={() => quick('Auto Tone', (s0, buf) => autoTone(buf), true)}>Auto Tone</button>
        <button disabled={!tp.length || busy} onClick={() => quick('White Balance: As Shot', () => ({ wb: 'asShot', temp: 0, tint: 0 }))}>WB As Shot</button>
        <button disabled={!tp.length || busy} onClick={() => quick('White Balance: Auto', (s0, buf) => ({ wb: 'auto', ...autoWhiteBalance(buf) }), true)}>WB Auto</button>
        <button disabled={!tp.length || busy} onClick={() => quick('Reset Settings', () => developDefaults())}>Reset All</button>
      </div>
      <div className="dvwExpo"><span>Exposure</span>
        <button aria-label="Exposure −1" disabled={!tp.length} onClick={() => exposureStep(-1, '−1')}>◀◀</button>
        <button aria-label="Exposure −1/3" disabled={!tp.length} onClick={() => exposureStep(-1 / 3, '−1/3')}>◀</button>
        <button aria-label="Exposure +1/3" disabled={!tp.length} onClick={() => exposureStep(1 / 3, '+1/3')}>▶</button>
        <button aria-label="Exposure +1" disabled={!tp.length} onClick={() => exposureStep(1, '+1')}>▶▶</button></div>
    </section>
    <section className="dvwSec"><h4>Attributes</h4>
      <div className="dvwAttr" role="group" aria-label="Rating">{[0, 1, 2, 3, 4, 5].map(r => <button key={r} aria-label={'Rating ' + r} aria-pressed={!!one && one.rating === r} disabled={!tp.length} onClick={() => act(c => setRating(c, targets(), r))}>{r ? '★'.repeat(r) : '0'}</button>)}</div>
      <div className="dvwAttr" role="group" aria-label="Flag">{[['pick', 'Pick'], ['reject', 'Reject'], [null, 'Unflag']].map(([f, l]) => <button key={l} aria-pressed={!!one && one.flag === f} disabled={!tp.length} onClick={() => act(c => setFlag(c, targets(), f))}>{l}</button>)}</div>
      <div className="dvwAttr" role="group" aria-label="Color label">{LABELS.map(l => <button key={l} className="dvwSwatch" aria-label={'Label ' + l} aria-pressed={!!one && one.label === l} style={{ background: LABEL_COLORS[l] }} disabled={!tp.length} onClick={() => act(c => setLabel(c, targets(), l))} />)}
        <button aria-label="No label" disabled={!tp.length} onClick={() => act(c => setLabel(c, targets(), null))}>None</button></div>
      {!!cat.collections.length && <div className="dvwCollAdd"><select aria-label="Target collection" defaultValue="" onChange={e => { const v = e.target.value; e.target.value = ''; if (v) act(c => addToCollection(c, targets(), v)); }} disabled={!tp.length}><option value="" disabled>Add to collection…</option>{cat.collections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        {cat.collections.some(c => c.id === source) && <button disabled={!tp.length} onClick={() => act(c => removeFromCollection(c, targets(), source))}>Remove from this collection</button>}</div>}
      <div className="dvwRowBtns"><button disabled={!sel.active} onClick={virtualCopy}>Create Virtual Copy</button><button disabled={!tp.length} onClick={removeSelected}>Remove…</button></div>
    </section>
    <section className="dvwSec"><h4>Keywords</h4>
      {one ? <>
        <div className="dvwChips">{one.keywords.map(k => <span key={k} className="dvwChip">{k}<button aria-label={'Remove keyword ' + k} onClick={() => act(c => setKeywords(c, one.id, one.keywords.filter(x => x !== k)))}>×</button></span>)}{!one.keywords.length && <span className="hint">No keywords</span>}</div>
        <form onSubmit={e => { e.preventDefault(); const add = parseKeywords(kwText); if (!add.length) return; act(c => { let x = c; for (const id of targets()) { const p = getPhoto(x, id); x = setKeywords(x, id, [...new Set([...p.keywords, ...add])]); } return x; }); setKwText(''); }}>
          <input aria-label="Add keywords" placeholder="Add keywords, comma separated" value={kwText} onChange={e => setKwText(e.target.value)} /><button type="submit">Add</button></form>
      </> : <p className="hint">Select a photo.</p>}
    </section>
    <section className="dvwSec"><h4>Metadata</h4>
      {one ? <dl className="dvwMeta">
        <dt>File</dt><dd>{one.name}</dd><dt>Dimensions</dt><dd>{one.w} × {one.h}</dd>
        <dt>Imported</dt><dd>{new Date(one.importedAt).toLocaleString()}</dd>
        {formatExif(one.exif).map(([k, v]) => <React.Fragment key={k}><dt>{k}</dt><dd>{v}</dd></React.Fragment>)}
        {!one.exif && <><dt>EXIF</dt><dd>None found</dd></>}
      </dl> : <p className="hint">Select a photo.</p>}
    </section>
  </aside>;

  const filterBar = <div className="dvwFilterBar" role="toolbar" aria-label="Library filter">
    <input type="search" aria-label="Search photos" placeholder="Search name, keyword, camera" value={filter.text} onChange={e => setFilter(f => ({ ...f, text: e.target.value }))} />
    <label>Rating <select aria-label="Minimum rating" value={filter.minRating} onChange={e => setFilter(f => ({ ...f, minRating: +e.target.value }))}><option value={0}>Any</option>{[1, 2, 3, 4, 5].map(r => <option key={r} value={r}>≥ {'★'.repeat(r)}</option>)}</select></label>
    <label>Flag <select aria-label="Flag filter" value={filter.flag} onChange={e => setFilter(f => ({ ...f, flag: e.target.value }))}><option value="any">Any</option><option value="pick">Picked</option><option value="unflagged">Unflagged</option><option value="reject">Rejected</option></select></label>
    <label>Label <select aria-label="Label filter" value={filter.label} onChange={e => setFilter(f => ({ ...f, label: e.target.value }))}><option value="any">Any</option><option value="none">No label</option>{LABELS.map(l => <option key={l} value={l}>{l[0].toUpperCase() + l.slice(1)}</option>)}</select></label>
    <label>Keyword <select aria-label="Keyword filter" value={filter.keyword} onChange={e => setFilter(f => ({ ...f, keyword: e.target.value }))}><option value="">Any</option>{keywords.map(k => <option key={k} value={k}>{k}</option>)}</select></label>
    <button onClick={() => setFilter({ text: '', minRating: 0, flag: 'any', label: 'any', keyword: '' })}>Clear filters</button>
    <span className="dvwSpacer" />
    <label>Sort <select aria-label="Sort by" value={sort.key} onChange={e => setSort(x => ({ ...x, key: e.target.value }))}>{SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
    <button aria-label={sort.dir === 'asc' ? 'Sort ascending (click for descending)' : 'Sort descending (click for ascending)'} onClick={() => setSort(x => ({ ...x, dir: x.dir === 'asc' ? 'desc' : 'asc' }))}>{sort.dir === 'asc' ? '↑' : '↓'}</button>
    {view === 'grid' && <label>Size <input type="range" aria-label="Thumbnail size" min={80} max={320} value={thumbSize} onChange={e => setThumbSize(+e.target.value)} /></label>}
  </div>;

  const grid = <div ref={gridRef} className="dvwGrid" role="listbox" aria-label="Photos" aria-multiselectable="true" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${thumbSize}px, 1fr))` }} onClick={e => { if (e.target === e.currentTarget) setSel({ ids: [], active: null, anchor: null }); }}>
    {visible.map((p, i) => <div key={p.id} role="option" aria-selected={selectedIds.includes(p.id)} aria-label={p.name} className={'dvwCell' + (selectedIds.includes(p.id) ? ' sel' : '') + (p.id === sel.active ? ' active' : '')} style={{ height: thumbSize + 34 }} onClick={e => clickPhoto(e, p.id)} onDoubleClick={() => { selectOnly(p.id); setView('loupe'); }}>
      <span className="dvwIdx">{i + 1}</span><Thumb mgr={mgr} photo={p} size={THUMB_EDGE} /><Badges p={p} /></div>)}
    {!visible.length && <div className="dvwEmpty">{cat.photos.length ? 'No photos match the current filter.' : 'The catalog is empty. Import photos to begin.'}</div>}
  </div>;

  const loupe = <div className="dvwLoupe" aria-label="Loupe view">{active ? <><div className="dvwLoupeImg"><Thumb key={active.id} mgr={mgr} photo={active} size={PREVIEW_EDGE} eager /></div><div className="dvwLoupeInfo"><strong>{active.name}</strong> · {active.w} × {active.h} <Badges p={active} /></div></> : <div className="dvwEmpty">Select a photo.</div>}</div>;

  // develop
  const history = active?.history || [];
  const devLeft = <aside className="dvwLeft" aria-label="Develop panels">
    <section className="dvwSec"><h4>Presets <button className="dvwMini" aria-label="Create preset" title="Create preset from current settings" disabled={!active} onClick={() => setDialog({ type: 'preset' })}>+</button></h4>
      <div className="dvwList">{presets.map(p => <div key={p.id} className="dvwListRow"><button className="dvwItem" aria-label={'Apply preset ' + p.name} disabled={!active} onClick={() => change(applyPreset(sRef.current, p), 'Preset: ' + p.name)}>{p.name}{p.builtin && <em> built-in</em>}</button>
        {!p.builtin && <button className="dvwMini" aria-label={'Delete preset ' + p.name} onClick={() => setCat(c => deletePreset(c, p.id))}>×</button>}</div>)}</div>
    </section>
    <section className="dvwSec"><h4>Snapshots <button className="dvwMini" aria-label="Create snapshot" title="Create snapshot" disabled={!active} onClick={() => setDialog({ type: 'snapshot' })}>+</button></h4>
      <div className="dvwList">{(active?.snapshots || []).map((sn, i) => <div key={i} className="dvwListRow"><button className="dvwItem" aria-label={'Apply snapshot ' + sn.name} onClick={() => act(c => applySnapshot(c, active.id, i))}>{sn.name}</button><button className="dvwMini" aria-label={'Delete snapshot ' + sn.name} onClick={() => act(c => deleteSnapshot(c, active.id, i))}>×</button></div>)}
        {active && !active.snapshots.length && <p className="hint">No snapshots.</p>}</div>
    </section>
    <section className="dvwSec dvwHistSec"><h4>History</h4>
      <div className="dvwList" role="list" aria-label="Develop history">{history.map((h, i) => ({ h, i })).reverse().map(({ h, i }) => <button key={i} className={'dvwItem' + (i === active.historyIndex ? ' on' : '') + (i > active.historyIndex ? ' undone' : '')} aria-label={'History step ' + (i + 1) + ': ' + h.label} aria-current={i === active.historyIndex} onClick={() => act(c => goToHistory(c, active.id, i))}>{h.label}</button>)}</div>
    </section>
    <div className="dvwRowBtns"><button disabled={!active} onClick={() => setDialog({ type: 'copy' })}>Copy…</button><button disabled={!clip || !selectedIds.length} onClick={() => act(c => pasteSettings(c, selectedIds, clip))}>Paste</button></div>
  </aside>;

  const mono = s.profile === 'monochrome';
  const devRight = <aside className="crsSide dvwDevRight" aria-label="Develop settings">
    <RgbHistogram hist={hist} />
    <div className="crsEdit"><strong>Edit</strong><div>
      <button disabled={!src} onClick={() => src && change({ ...sRef.current, ...autoTone(src.buf) }, 'Auto Tone')}>Auto</button>
      <button aria-pressed={mono} className={mono ? 'on' : ''} onClick={() => set({ profile: mono ? 'color' : 'monochrome' })}>B&amp;W</button></div></div>
    <ProfileControls s={s} set={set} />
    <div className="crsScroll"><DevelopPanelStack s={s} set={set} setIn={setIn} open={open} toggle={id => setOpen(o => ({ ...o, [id]: !o[id] }))} hist={hist} pick={pick} setPick={setPick} getSource={() => src?.buf} /></div>
    <footer className="crsFooter dvwDevFoot">
      <button disabled={!prevId || !active || prevId === active.id || !getPhoto(cat, prevId)} title="Apply all settings of the previously selected photo" onClick={() => { const pv = getPhoto(catRef.current, prevId); if (pv) change(structuredClone(pv.develop), 'Previous Settings'); }}>Previous</button>
      <button disabled={!active} onClick={() => change(developDefaults(), 'Reset Settings')}>Reset</button>
      <button disabled={!many} title="Sync settings from the active photo to the other selected photos" onClick={() => setDialog({ type: 'sync' })}>Sync…</button>
    </footer>
  </aside>;

  const devCenter = <div className="dvwDevCenter">
    <div className="dvwDevBar" role="toolbar" aria-label="Develop view">
      <div className="segmented" role="group" aria-label="Before and after">{[['after', 'After'], ['before', 'Before (\\)'], ['split', 'Before | After']].map(([k, l]) => <button key={k} aria-pressed={ba === k} className={ba === k ? 'on' : ''} onClick={() => setBa(k)}>{l}</button>)}</div>
      <span className="crsStatus" role="status">{!active ? '' : !src ? 'Loading preview…' : rendering ? 'Rendering preview…' : 'Preview ready'}</span>
      <span className="dvwSpacer" />
      <button disabled={!active} onClick={virtualCopy}>Create Virtual Copy</button>
      <button disabled={!active || busy} onClick={editInZertake}>Edit in Zertake</button>
    </div>
    <div className={'dvwDevView' + (pick ? ' picking' : '') + (ba === 'split' ? ' split' : '')}>
      {!active ? <div className="dvwEmpty">Select a photo in the Library.</div> : <>
        {ba === 'split' && <figure key="before"><canvas ref={beforeCanvas} aria-label="Before preview" /><figcaption>Before</figcaption></figure>}
        <figure key="after" onClick={sampleAt}><canvas ref={afterCanvas} aria-label="Develop preview" />{ba === 'split' && <figcaption>After</figcaption>}{ba === 'before' && <figcaption>Before</figcaption>}</figure>
        {pick && <div className="crsHint">{pickHint(pick)}</div>}</>}
    </div>
  </div>;

  const dlg = dialog && (
    dialog.type === 'remove' ? <div className="dvwModalBack"><div className="opDialog dvwModal" role="alertdialog" aria-label="Remove from catalog"><h3>Remove {dialog.ids.length} photo{dialog.ids.length === 1 ? '' : 's'} from the catalog?</h3><p className="hint">Develop settings, ratings and keywords are removed too (virtual copies of a removed master go with it). Your original files on disk are not touched.</p>
      <footer><button autoFocus onClick={() => setDialog(null)}>Cancel</button><button className="primary" onClick={() => { act(c => removePhotos(c, dialog.ids)); setSel({ ids: [], active: null, anchor: null }); setDialog(null); }}>Remove</button></footer></div></div>
    : dialog.type === 'deleteCol' ? <div className="dvwModalBack"><div className="opDialog dvwModal" role="alertdialog" aria-label="Delete collection"><h3>Delete the collection “{dialog.name}”?</h3><p className="hint">The photos stay in the catalog.</p>
      <footer><button autoFocus onClick={() => setDialog(null)}>Cancel</button><button className="primary" onClick={() => { setCat(c => deleteCollection(c, dialog.id)); if (source === dialog.id) setSource('all'); setDialog(null); }}>Delete</button></footer></div></div>
    : dialog.type === 'copy' ? <PanelPicker title="Copy Settings" okLabel="Copy" onCancel={() => setDialog(null)} onOk={panels => { flush(); setClip(pickPanels(sRef.current && module === 'develop' ? sRef.current : active.develop, panels)); setDialog(null); setMsg('Settings copied (' + panels.length + ' panel' + (panels.length === 1 ? '' : 's') + '). Select photos and press Paste.'); }} />
    : dialog.type === 'sync' ? <PanelPicker title="Synchronize Settings" okLabel="Synchronize" onCancel={() => setDialog(null)} onOk={panels => { act(c => syncSettings(c, sel.active, selectedIds, panels)); setDialog(null); }} />
    : dialog.type === 'preset' ? <PanelPicker title="New Develop Preset" okLabel="Create" withName onCancel={() => setDialog(null)} onOk={(panels, name) => { setCat(c => savePreset(c, name, sRef.current, panels).cat); setDialog(null); }} />
    : dialog.type === 'snapshot' ? <div className="dvwModalBack"><form className="opDialog dvwModal" role="dialog" aria-label="New snapshot" onSubmit={e => { e.preventDefault(); const n = new FormData(e.currentTarget).get('name'); act(c => addSnapshot(c, active.id, n)); setDialog(null); }}><h3>New Snapshot</h3>
      <label className="dvwField"><span>Snapshot name</span><input name="name" aria-label="Snapshot name" defaultValue={new Date().toLocaleString()} autoFocus /></label>
      <footer><button type="button" onClick={() => setDialog(null)}>Cancel</button><button type="submit" className="primary">Create</button></footer></form></div>
    : dialog.type === 'export' ? <ExportDialog photos={dialog.ids.map(id => getPhoto(cat, id)).filter(Boolean)} render={renderFull} onClose={() => setDialog(null)} />
    : null);

  return <div className={'dvw' + (dragOver ? ' dragging' : '')} role="dialog" aria-label="Library and Develop"
    onDragOver={e => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); setDragOver(true); } }} onDragLeave={e => { if (e.currentTarget === e.target) setDragOver(false); }}
    onDrop={e => { e.preventDefault(); setDragOver(false); importFiles(e.dataTransfer.files); }}>
    <header className="dvwTop">
      <strong>Library &amp; Develop</strong>
      <span className="dvwMsg" role="status">{loadErr ? 'Catalog could not be loaded (' + loadErr + '); a new one was started.' : msg}</span>
      <span className="dvwSpacer" />
      <button disabled={!selectedIds.length || busy} onClick={() => { flush(); setDialog({ type: 'export', ids: [...selectedIds] }); }}>Export…</button>
      <nav className="dvwModules" aria-label="Module">{[['library', 'Library'], ['develop', 'Develop']].map(([k, l]) => <button key={k} aria-pressed={module === k} className={module === k ? 'on' : ''} onClick={() => setModule(k)}>{l}</button>)}</nav>
      <button onClick={close} aria-label="Close Library and Develop">Close</button>
    </header>
    <div className="dvwBody">
      {module === 'library' ? <>{libraryLeft}<main className="dvwCenter">{filterBar}{view === 'grid' ? grid : loupe}
        <div className="dvwViewBar"><div className="segmented" role="group" aria-label="Library view"><button aria-pressed={view === 'grid'} className={view === 'grid' ? 'on' : ''} onClick={() => setView('grid')}>Grid (G)</button><button aria-pressed={view === 'loupe'} className={view === 'loupe' ? 'on' : ''} onClick={() => { if (!sel.active && visible[0]) selectOnly(visible[0].id); setView('loupe'); }}>Loupe (E)</button></div>
          <span>{visible.length} of {cat.photos.length} photos · {selectedIds.length} selected</span></div>
      </main>{libraryRight}</> : <>{devLeft}<main className="dvwCenter">{devCenter}</main>{devRight}</>}
    </div>
    {filmstrip}
    {dragOver && <div className="dvwDrop">Drop photos to import</div>}
    {dlg}
  </div>;
}
