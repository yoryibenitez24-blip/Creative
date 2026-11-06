// Zertake Studio · E-commerce: a product-photo studio (batch import, AI background removal with
// edge refinement and touch-up, framing, backgrounds, ground shadows, light retouch, marketplace
// presets with a checklist, batch export to a ZIP, marketing templates).
//
// <EcomWorkspace assetStore runOp aiSegment onEditInDesigner(blob, name) onExit />
//   assetStore        AssetStore (src/engine/assets.js) — original photos and background images
//   runOp             (op, buf, params, ctx) → Promise<buf>, the pixel-op worker client
//   aiSegment         (kind, buf) → Promise<{w,h,b64}>, the on-device matte model
//   onEditInDesigner  (pngBlob, name) → void, opens a rendered template in the Designer
//   onExit            () → void, leave the workspace (the project is saved first)
// Projects persist in IndexedDB 'zertake-ecom' (see projectStore.js).

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Upload, X, Trash2, WandSparkles, CircleCheck, TriangleAlert, CircleX, Plus, Brush, Eraser, Undo2, ExternalLink, LoaderCircle, LogOut, Download, Image as ImageIcon } from 'lucide-react';
import { createPipeline, bufToCanvas, encodeBuf } from './pipeline.js';
import { openProjectStore, newProject, newItem } from './projectStore.js';
import { PRESETS, resolvePreset, marginForFill, backgroundStats, checkPreset, FORMATS, formatName, uniqueNames, baseName } from './presets.js';
import { MATTE_DEFAULTS, RETOUCH_DEFAULTS, cropBuffer } from './engine.js';
import { TEMPLATES, TEMPLATE_BY_ID, TEMPLATE_FIELDS, drawTemplate } from './templates.js';
import { createZip } from './zip.js';

const TABS = [['cutout', 'Cutout'], ['layout', 'Layout'], ['background', 'Background'], ['retouch', 'Retouch'], ['market', 'Marketplace'], ['export', 'Export'], ['templates', 'Templates']];
const PREVIEW_MAX = 1000;
const STATUS_TEXT = { imported: 'Original', working: 'Working…', cut: 'Cut out', error: 'Error' };

// ------------------------------------------------------------------ small controls ----------
function Range({ label, min, max, step = 1, unit, value, onChange, disabled }) {
  const set = v => { if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v))); };
  return <label className="opField"><span>{label}</span>
    <input type="range" aria-label={label} min={min} max={max} step={step} value={value} disabled={disabled} style={{ '--p': (value - min) / (max - min) }} onChange={e => set(+e.target.value)} />
    <input type="number" aria-label={label + ' value'} min={min} max={max} step={step} value={value} disabled={disabled} onChange={e => set(+e.target.value)} />{unit && <small>{unit}</small>}</label>;
}
const Check = ({ label, checked, onChange, disabled }) => <label className="optCheck ecCheck"><input type="checkbox" aria-label={label} checked={!!checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />{label}</label>;
const Color = ({ label, value, onChange }) => <label className="opField"><span>{label}</span><input type="color" aria-label={label} value={value} onChange={e => onChange(e.target.value)} /></label>;
function Seg({ label, value, options, onChange }) {
  return <div className="segmented ecSeg" role="group" aria-label={label}>{options.map(([v, l]) => <button key={v} type="button" aria-pressed={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>)}</div>;
}
const Section = ({ title, children }) => <section className="ecSection"><h3>{title}</h3>{children}</section>;
const StatusIcon = ({ s }) => s === 'pass' ? <CircleCheck size={15} aria-hidden="true" /> : s === 'warn' ? <TriangleAlert size={15} aria-hidden="true" /> : <CircleX size={15} aria-hidden="true" />;

function download(blob, name) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
const checker = (ctx, w, h) => { const s = 12; ctx.fillStyle = '#d9d9de'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#f4f4f6'; for (let y = 0; y < h; y += s) for (let x = (y / s) % 2 ? s : 0; x < w; x += 2 * s) ctx.fillRect(x, y, s, s); };
const canvasToBlob = c => new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(Error('Encoding failed')), 'image/png'));

// ------------------------------------------------------------------ workspace ---------------
export default function EcomWorkspace({ assetStore, runOp, aiSegment, onEditInDesigner, onExit }) {
  const pipe = useMemo(() => createPipeline({ assetStore, runOp }), [assetStore, runOp]);
  const storeRef = useRef(null);
  const [projects, setProjects] = useState([]);
  const [project, setProject] = useState(null);
  const projectRef = useRef(null); projectRef.current = project;
  const [sel, setSel] = useState(() => new Set());
  const [activeId, setActiveId] = useState(null);
  const [tab, setTab] = useState('cutout');
  const [view, setView] = useState('result');
  const [brush, setBrush] = useState({ mode: 'erase', size: 4, hardness: 60 });
  const [aiKind, setAiKind] = useState('subject');
  const [busy, setBusy] = useState(null); // {label, done, total}
  const [message, setMessage] = useState(null); // {kind:'info'|'error', text}
  const [quickRows, setQuickRows] = useState(null);
  const [fullCheck, setFullCheck] = useState(null); // {key, rows, bytes}
  const [checking, setChecking] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [renderCount, setRenderCount] = useState(0);
  const [exportScope, setExportScope] = useState('selected');
  const [thumbs, setThumbs] = useState({});
  const [renaming, setRenaming] = useState(false);
  const [drag, setDrag] = useState(false);
  const canvasRef = useRef(null), tplCanvasRef = useRef(null), fileRef = useRef(null), bgFileRef = useRef(null), genRef = useRef(0), strokeRef = useRef(null), lastClick = useRef(null);
  const [liveStroke, setLiveStroke] = useState(null);
  const [cursor, setCursor] = useState(null);

  const say = (text, kind = 'info') => setMessage({ text, kind, at: Date.now() });
  useEffect(() => { if (message?.kind !== 'info') return; const t = setTimeout(() => setMessage(m => m === message ? null : m), 5000); return () => clearTimeout(t); }, [message]);
  const fail = e => { if (e?.cancelled) return; console.error(e); say(e?.message || String(e), 'error'); };

  // ---------------- project load / save
  const loadProject = useCallback(async id => {
    const p = await storeRef.current.get(id); if (!p) return;
    setProject(p); setSel(new Set(p.items[0] ? [p.items[0].id] : [])); setActiveId(p.items[0]?.id || null); setFullCheck(null); setQuickRows(null);
  }, []);
  useEffect(() => {
    let dead = false;
    (async () => {
      const st = await openProjectStore(); storeRef.current = st;
      let list = await st.list();
      if (!list.length) { const p = newProject('My products'); await st.put(p); list = await st.list(); }
      if (dead) return;
      setProjects(list); await loadProject(list[0].id);
    })().catch(fail);
    return () => { dead = true; };
  }, [loadProject]);
  useEffect(() => {
    if (!project || !storeRef.current) return;
    const t = setTimeout(async () => { try { await storeRef.current.put({ ...project, updated: Date.now() }); setProjects(await storeRef.current.list()); } catch (e) { fail(e); } }, 300);
    return () => clearTimeout(t);
  }, [project]);
  const flush = async () => { if (projectRef.current) await storeRef.current?.put({ ...projectRef.current, updated: Date.now() }); };

  // thumbnails: object URLs of the original assets
  useEffect(() => {
    if (!project) return;
    let dead = false;
    (async () => {
      const add = {};
      for (const it of project.items) if (!thumbs[it.assetId]) { try { add[it.assetId] = URL.createObjectURL(await assetStore.get(it.assetId)); } catch { /* missing asset: shown as an error tile */ } }
      if (!dead && Object.keys(add).length) setThumbs(t => ({ ...t, ...add }));
    })();
    return () => { dead = true; };
  }, [project?.items.map(i => i.assetId).join()]); // eslint-disable-line

  const items = project?.items || [];
  const active = items.find(i => i.id === activeId) || items.find(i => sel.has(i.id)) || items[0] || null;
  const settings = project?.settings;
  const selectedItems = items.filter(i => sel.has(i.id));
  const targets = selectedItems.length ? selectedItems : active ? [active] : [];
  const targetIds = new Set(targets.map(t => t.id));
  const preset = settings ? resolvePreset(settings.presetId, settings.custom) : null;

  const updateItems = (ids, fn) => setProject(p => ({ ...p, items: p.items.map(it => ids.has(it.id) ? fn(it) : it) }));
  const patchItem = (id, patch) => updateItems(new Set([id]), it => ({ ...it, ...patch }));
  const setS = (sec, key, v) => setProject(p => ({ ...p, settings: { ...p.settings, [sec]: key == null ? v : { ...p.settings[sec], [key]: v } } }));

  // ---------------- import
  const importFiles = async files => {
    const list = [...files].filter(f => /^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(f.name));
    if (!list.length) return say('Drop or choose image files (JPEG, PNG, WebP).', 'error');
    setBusy({ label: 'Importing photos', done: 0, total: list.length });
    const added = [];
    try {
      for (const f of list) {
        const bmp = await createImageBitmap(f), w = bmp.width, h = bmp.height; bmp.close?.();
        const id = await assetStore.put(f);
        added.push(newItem(f.name, id, w, h));
        setBusy(b => ({ ...b, done: b.done + 1 }));
      }
    } catch (e) { fail(Error('Could not import a file: ' + e.message)); }
    if (added.length) {
      setProject(p => ({ ...p, items: [...p.items, ...added] }));
      setSel(new Set(added.map(a => a.id))); setActiveId(added[0].id);
      say(`Imported ${added.length} photo${added.length > 1 ? 's' : ''}.`);
    }
    setBusy(null);
  };

  // ---------------- background removal (AI matte, cached per item in item.ai)
  const removeBackground = async () => {
    const all = targets, todo = all.filter(i => !i.ai).length ? all.filter(i => !i.ai) : all;
    if (!todo.length) return;
    setBusy({ label: 'Removing backgrounds', done: 0, total: todo.length });
    for (const it0 of todo) {
      patchItem(it0.id, { status: 'working', error: null });
      try {
        const buf = await pipe.workImage(it0);
        const ai = await aiSegment(aiKind, buf);
        const it = { ...projectRef.current.items.find(i => i.id === it0.id), ai, aiKind, workW: buf.w, workH: buf.h };
        const c = await pipe.cutoutOf(it);
        patchItem(it0.id, { ai, aiKind, status: 'cut', workW: buf.w, workH: buf.h, bounds: c.bounds });
      } catch (e) { patchItem(it0.id, { status: 'error', error: e.message }); fail(e); }
      setBusy(b => b && ({ ...b, done: b.done + 1 }));
    }
    setBusy(null); setView('result');
  };

  // ---------------- selection
  const clickItem = (e, it) => {
    const idx = items.findIndex(i => i.id === it.id);
    if (e.shiftKey && lastClick.current != null) {
      const a = Math.min(lastClick.current, idx), b = Math.max(lastClick.current, idx);
      setSel(new Set(items.slice(a, b + 1).map(i => i.id)));
    } else if (e.metaKey || e.ctrlKey) {
      setSel(s => { const n = new Set(s); n.has(it.id) ? n.delete(it.id) : n.add(it.id); return n; }); lastClick.current = idx;
    } else { setSel(new Set([it.id])); lastClick.current = idx; }
    setActiveId(it.id);
  };
  const deleteItems = () => {
    if (!selectedItems.length) return;
    setProject(p => ({ ...p, items: p.items.filter(i => !sel.has(i.id)) }));
    setSel(new Set()); setActiveId(null);
  };

  // ---------------- render key (what the preview depends on)
  const itemKey = it => it ? JSON.stringify([it.id, it.assetId, it.ai ? it.ai.b64.length + it.ai.b64.slice(0, 32) : 0, it.matte, it.strokes.length, it.strokes.at(-1)?.pts?.length, it.retouch]) : '';
  const { template: _t, export: exp, ...renderSettings } = settings || {};
  const boundsKey = settings?.framing.sizing === 'uniform' ? items.map(i => i.bounds ? `${i.bounds.w}x${i.bounds.h}/${i.workW}` : '-').join() : '';
  const renderKey = active && settings ? itemKey(active) + JSON.stringify(renderSettings) + boundsKey : '';
  const checkKey = renderKey + (exp ? exp.format + exp.quality : '');

  // ---------------- preview
  useEffect(() => {
    if (!active || !settings || tab === 'templates') return;
    const gen = ++genRef.current;
    const t = setTimeout(async () => {
      const cv = canvasRef.current; if (!cv) return;
      setRendering(true);
      try {
        if (view === 'cutout' || !active.ai) {
          const img = await pipe.retouchedImage(active), k = Math.min(1, PREVIEW_MAX / Math.max(img.w, img.h));
          const c = active.ai ? await pipe.cutoutOf(active) : null;
          if (gen !== genRef.current) return;
          cv.width = Math.round(img.w * k); cv.height = Math.round(img.h * k);
          const x = cv.getContext('2d');
          if (c) { checker(x, cv.width, cv.height); x.globalAlpha = 0.22; x.drawImage(bufToCanvas(img), 0, 0, cv.width, cv.height); x.globalAlpha = 1; x.drawImage(bufToCanvas(c.cut), 0, 0, cv.width, cv.height); }
          else x.drawImage(bufToCanvas(img), 0, 0, cv.width, cv.height);
          setQuickRows(null);
        } else {
          const k = Math.min(1, PREVIEW_MAX / Math.max(preset.w, preset.h));
          const r = await pipe.render(active, { settings, items, scale: k });
          if (gen !== genRef.current) return;
          const b = active.bounds;
          if (!b || b.w !== r.bounds.w || b.h !== r.bounds.h || b.x !== r.bounds.x || b.y !== r.bounds.y || active.workW !== r.workW) patchItem(active.id, { bounds: r.bounds, workW: r.workW, workH: r.workH });
          cv.width = r.buf.w; cv.height = r.buf.h;
          const x = cv.getContext('2d');
          if (settings.background.type === 'transparent') { checker(x, cv.width, cv.height); x.drawImage(bufToCanvas(r.buf), 0, 0); } else x.putImageData(new ImageData(r.buf.data, r.buf.w, r.buf.h), 0, 0);
          const stats = backgroundStats(r.buf, r.place, r.product), inv = 1 / k;
          setQuickRows({ key: checkKey, rows: checkPreset(preset, { w: preset.w, h: preset.h, place: { x: r.place.x * inv, y: r.place.y * inv, w: r.place.w * inv, h: r.place.h * inv }, stats, upscale: r.upscale, format: settings.export.format }) });
        }
        setRenderCount(n => n + 1);
      } catch (e) { if (gen === genRef.current) fail(e); }
      finally { if (gen === genRef.current) setRendering(false); }
    }, 120);
    return () => clearTimeout(t);
  }, [renderKey, view, tab, settings?.export.format]); // eslint-disable-line

  // full-size check (encodes the real file) while the Marketplace tab is open
  const runFullCheck = async () => {
    if (!active?.ai) return;
    const key = checkKey; setChecking(true);
    try { const r = await pipe.check(active, { settings, items }); if (key === checkKeyRef.current) setFullCheck({ key, rows: r.rows, bytes: r.blob.size }); }
    catch (e) { fail(e); } finally { setChecking(false); }
  };
  const checkKeyRef = useRef(''); checkKeyRef.current = checkKey;
  useEffect(() => {
    if (tab !== 'market' || !active?.ai || fullCheck?.key === checkKey) return;
    const t = setTimeout(runFullCheck, 600);
    return () => clearTimeout(t);
  }, [tab, checkKey, renderCount]); // eslint-disable-line

  // ---------------- touch-up brush (Cutout view)
  const brushOn = view === 'cutout' && !!active?.ai && tab !== 'templates';
  const toNorm = e => { const r = canvasRef.current.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
  const onPointerDown = e => {
    if (!brushOn || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    strokeRef.current = { mode: brush.mode, size: brush.size / 100, hardness: brush.hardness / 100, pts: toNorm(e) };
    setLiveStroke({ ...strokeRef.current });
  };
  const onPointerMove = e => {
    if (brushOn) { const r = canvasRef.current.getBoundingClientRect(); setCursor({ x: e.clientX - r.left, y: e.clientY - r.top }); }
    if (!strokeRef.current) return;
    strokeRef.current.pts.push(...toNorm(e)); setLiveStroke({ ...strokeRef.current, pts: [...strokeRef.current.pts] });
  };
  const onPointerUp = () => {
    const st = strokeRef.current; strokeRef.current = null; setLiveStroke(null);
    if (!st || !active) return;
    const pts = st.pts.map(v => Math.round(v * 10000) / 10000);
    patchItem(active.id, { strokes: [...active.strokes, { ...st, pts }] });
  };

  // ---------------- per-item settings applied to the targets (selected items)
  const setMatte = (k, v) => updateItems(targetIds, it => ({ ...it, matte: { ...it.matte, [k]: v } }));
  const setRetouch = (k, v) => updateItems(targetIds, it => ({ ...it, retouch: { ...it.retouch, [k]: v } }));

  // ---------------- background image
  const chooseBgImage = async f => {
    if (!f) return;
    try { const id = await assetStore.put(f); setProject(p => ({ ...p, settings: { ...p.settings, background: { ...p.settings.background, type: 'image', imageId: id, imageName: f.name } } })); }
    catch (e) { fail(e); }
  };

  // ---------------- export
  const doExport = async () => {
    const list = (exportScope === 'current' ? [active] : exportScope === 'selected' ? selectedItems : items).filter(Boolean);
    const ready = list.filter(i => i.ai), skipped = list.length - ready.length, ids = settings.export.presets.filter(id => PRESETS.some(p => p.id === id));
    if (!ready.length) return say('Remove the background of the items to export first.', 'error');
    if (!ids.length) return say('Choose at least one preset to export.', 'error');
    const fmt = settings.export.format, f = FORMATS[fmt], files = [];
    setBusy({ label: 'Exporting', done: 0, total: ready.length * ids.length });
    try {
      for (const pid of ids) {
        const pr = resolvePreset(pid, settings.custom);
        for (let n = 0; n < ready.length; n++) {
          const r = await pipe.render(ready[n], { settings, presetId: pid, items, scale: 1 });
          const blob = await encodeBuf(r.buf, fmt, settings.export.quality);
          files.push({ name: formatName(settings.export.template, { name: ready[n].name, preset: pr.id, n: n + 1, w: pr.w, h: pr.h }, f.ext), blob });
          setBusy(b => b && ({ ...b, done: b.done + 1 }));
        }
      }
      const names = uniqueNames(files.map(x => x.name));
      if (settings.export.zip) {
        const zip = createZip(await Promise.all(files.map(async (x, i) => ({ name: names[i], data: new Uint8Array(await x.blob.arrayBuffer()) }))));
        download(new Blob([zip], { type: 'application/zip' }), formatName(project.name, {}, 'zip'));
      } else for (let i = 0; i < files.length; i++) { download(files[i].blob, names[i]); await new Promise(r => setTimeout(r, 250)); }
      say(`Exported ${files.length} image${files.length > 1 ? 's' : ''}${skipped ? ` — skipped ${skipped} without a removed background` : ''}.`);
    } catch (e) { fail(e); }
    setBusy(null);
  };
  const togglePreset = (id, on) => setS('export', 'presets', on ? [...new Set([...settings.export.presets, id])] : settings.export.presets.filter(x => x !== id));

  // ---------------- templates
  const tpl = TEMPLATE_BY_ID[settings?.template.id] || TEMPLATES[0];
  const tplParams = { ...tpl.defaults, ...(settings?.template.params?.[tpl.id] || {}) };
  const setTplParam = (k, v) => setProject(p => ({ ...p, settings: { ...p.settings, template: { ...p.settings.template, params: { ...p.settings.template.params, [tpl.id]: { ...(p.settings.template.params?.[tpl.id] || {}), [k]: v } } } } }));
  const [tplRendered, setTplRendered] = useState(0);
  useEffect(() => {
    if (tab !== 'templates' || !settings) return;
    let dead = false;
    (async () => {
      let product = null;
      if (active?.ai) { const c = await pipe.cutoutOf(active); if (c.bounds) product = bufToCanvas(cropBuffer(c.cut, c.bounds)); }
      const cv = tplCanvasRef.current; if (dead || !cv) return;
      cv.width = tpl.w; cv.height = tpl.h;
      drawTemplate(cv.getContext('2d'), tpl, tplParams, product);
      setTplRendered(n => n + 1);
    })().catch(fail);
    return () => { dead = true; };
  }, [tab, tpl.id, JSON.stringify(tplParams), active && itemKey(active)]); // eslint-disable-line
  const tplName = () => formatName(`${tpl.name} ${active ? baseName(active.name) : ''}`.trim(), {}, 'png');
  const tplDownload = async () => { try { download(await canvasToBlob(tplCanvasRef.current), tplName()); } catch (e) { fail(e); } };
  const tplDesigner = async () => { try { onEditInDesigner?.(await canvasToBlob(tplCanvasRef.current), tplName()); } catch (e) { fail(e); } };

  // ---------------- projects
  const createProject = async () => { await flush(); const p = newProject('Project ' + (projects.length + 1)); await storeRef.current.put(p); setProjects(await storeRef.current.list()); await loadProject(p.id); };
  const switchProject = async id => { await flush(); pipe.clear(); await loadProject(id); };
  const deleteProject = async () => {
    if (!project || !window.confirm(`Delete the project “${project.name}”? The photos stay in the asset store.`)) return;
    const id = project.id; setProject(null); await storeRef.current.delete(id);
    let list = await storeRef.current.list();
    if (!list.length) { const p = newProject('My products'); await storeRef.current.put(p); list = await storeRef.current.list(); }
    setProjects(list); await loadProject(list[0].id);
  };
  const exit = async () => { try { await flush(); } catch (e) { fail(e); } onExit?.(); };

  if (!project) return <div className="ecom ecLoading" role="region" aria-label="E-commerce studio"><LoaderCircle className="ecSpin" size={20} aria-hidden="true" /> Loading projects…</div>;

  const t = targets[0], tm = t?.matte || MATTE_DEFAULTS, tr = t?.retouch || RETOUCH_DEFAULTS, s = settings, nT = targets.length;
  const rows = fullCheck?.key === checkKey ? fullCheck.rows : quickRows?.key === checkKey ? quickRows.rows : null;
  const passAll = rows && rows.every(r => r.status === 'pass');
  const tplStyle = tab === 'templates';

  return (
    <div className={'ecom' + (drag ? ' dragging' : '')} role="region" aria-label="E-commerce studio" data-busy={busy ? '1' : '0'} data-rendering={rendering ? '1' : '0'}
      onDragOver={e => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); setDrag(true); } }} onDragLeave={e => { if (e.currentTarget === e.target) setDrag(false); }}
      onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) importFiles(e.dataTransfer.files); }}>
      <header className="ecTop">
        <strong className="ecTitle">E-commerce studio</strong>
        <label className="ecProject"><span className="ecDim">Project</span>
          {renaming
            ? <input aria-label="Project name" autoFocus defaultValue={project.name} onBlur={e => { const v = e.target.value.trim(); if (v) setProject(p => ({ ...p, name: v })); setRenaming(false); }} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setRenaming(false); }} />
            : <select aria-label="Project" value={project.id} onChange={e => switchProject(e.target.value)}>{projects.map(p => <option key={p.id} value={p.id}>{p.id === project.id ? project.name : p.name} ({p.id === project.id ? items.length : p.count})</option>)}</select>}
        </label>
        <button className="optButton" type="button" onClick={() => setRenaming(true)}>Rename</button>
        <button className="optButton" type="button" onClick={createProject}><Plus size={14} aria-hidden="true" /> New project</button>
        <button className="optButton" type="button" onClick={deleteProject} aria-label="Delete project"><Trash2 size={14} aria-hidden="true" /></button>
        <span className="ecGrow" />
        <button className="optButton primary" type="button" onClick={() => fileRef.current.click()}><Upload size={14} aria-hidden="true" /> Import photos</button>
        <input ref={fileRef} className="ecHidden" type="file" accept="image/*" multiple aria-label="Import product photos" onChange={e => { importFiles(e.target.files); e.target.value = ''; }} />
        <button className="optButton" type="button" onClick={exit}><LogOut size={14} aria-hidden="true" /> Exit</button>
      </header>

      <aside className="ecItems" aria-label="Products">
        <div className="ecItemsBar">
          <span className="ecDim">{items.length} photo{items.length === 1 ? '' : 's'} · {selectedItems.length} selected</span>
          <button type="button" className="ecLink" onClick={() => setSel(new Set(items.map(i => i.id)))} disabled={!items.length}>Select all</button>
          <button type="button" className="ecIconBtn" aria-label="Remove selected photos" onClick={deleteItems} disabled={!selectedItems.length}><Trash2 size={14} aria-hidden="true" /></button>
        </div>
        {!items.length && <button type="button" className="ecDrop" onClick={() => fileRef.current.click()}><ImageIcon size={26} aria-hidden="true" /><span>Drop product photos here<br />or click to choose</span></button>}
        <ul className="ecGrid" role="listbox" aria-label="Product photos" aria-multiselectable="true">
          {items.map(it => (
            <li key={it.id} role="option" aria-selected={sel.has(it.id)} aria-label={it.name} className={'ecTile' + (sel.has(it.id) ? ' sel' : '') + (active?.id === it.id ? ' active' : '')} onClick={e => clickItem(e, it)} title={it.error || it.name}>
              {thumbs[it.assetId] ? <img src={thumbs[it.assetId]} alt="" draggable={false} /> : <div className="ecTileMissing">missing</div>}
              <span className={'ecBadge ' + it.status} data-status={it.status}>{it.status === 'working' && <LoaderCircle className="ecSpin" size={11} aria-hidden="true" />}{STATUS_TEXT[it.status] || it.status}</span>
              <span className="ecTileName">{it.name}</span>
            </li>))}
        </ul>
      </aside>

      <main className="ecStage">
        <div className="ecStageBar">
          {!tplStyle && <Seg label="Preview" value={view} onChange={setView} options={[['result', 'Result'], ['cutout', 'Cutout & touch-up']]} />}
          {tplStyle && <span className="ecDim">{tpl.name} · {tpl.w} × {tpl.h}</span>}
          {!tplStyle && preset && <span className="ecDim">{preset.name} · {preset.w} × {preset.h}</span>}
          <span className="ecGrow" />
          {(rendering || checking) && <span className="ecDim"><LoaderCircle className="ecSpin" size={13} aria-hidden="true" /> {checking ? 'Checking at full size…' : 'Rendering…'}</span>}
        </div>
        <div className={'ecCanvasWrap' + (brushOn ? ' brushing' : '')}>
          {!active && !tplStyle && <p className="ecEmpty">Import product photos to start. JPEG, PNG and WebP work; you can drop several at once.</p>}
          <div className="ecCanvasBox" style={{ display: tplStyle || !active ? 'none' : undefined }}>
            <canvas ref={canvasRef} aria-label="Product preview" data-renders={renderCount} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onPointerLeave={() => setCursor(null)} />
            {brushOn && cursor && canvasRef.current && <div className="ecBrushCursor" style={{ left: cursor.x, top: cursor.y, width: brush.size / 100 * Math.max(canvasRef.current.clientWidth, canvasRef.current.clientHeight), height: brush.size / 100 * Math.max(canvasRef.current.clientWidth, canvasRef.current.clientHeight) }} />}
            {liveStroke && canvasRef.current && (() => { const cw = canvasRef.current.clientWidth, ch = canvasRef.current.clientHeight; return <svg className="ecLive" width={cw} height={ch} aria-hidden="true"><polyline points={liveStroke.pts.reduce((a, v, i) => a + (i % 2 ? v * ch + ' ' : v * cw + ','), '')} fill="none" stroke={liveStroke.mode === 'erase' ? 'rgba(255,80,80,.55)' : 'rgba(80,220,140,.55)'} strokeWidth={liveStroke.size * Math.max(cw, ch)} strokeLinecap="round" strokeLinejoin="round" /></svg>; })()}
          </div>
          <div className="ecCanvasBox" style={{ display: tplStyle ? undefined : 'none' }}><canvas ref={tplCanvasRef} aria-label="Template preview" data-renders={tplRendered} /></div>
        </div>
        {busy && <div className="ecProgress"><span>{busy.label} — {busy.done} / {busy.total}</span><div role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={busy.total} aria-valuenow={busy.done}><i style={{ width: (busy.total ? busy.done / busy.total * 100 : 0) + '%' }} /></div></div>}
        {message && <div className={'ecMessage ' + message.kind} role={message.kind === 'error' ? 'alert' : 'status'}><span>{message.text}</span><button type="button" className="ecIconBtn" aria-label="Dismiss message" onClick={() => setMessage(null)}><X size={13} aria-hidden="true" /></button></div>}
      </main>

      <aside className="ecPanel" aria-label="Settings">
        <div className="ecTabs" role="tablist" aria-label="Studio sections">
          {TABS.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>)}
        </div>
        <div className="ecPanelBody" role="tabpanel" aria-label={TABS.find(x => x[0] === tab)[1]}>
          {tab === 'cutout' && <>
            <Section title="Background removal">
              <label className="opField"><span>Model</span><select aria-label="Segmentation model" value={aiKind} onChange={e => setAiKind(e.target.value)}><option value="subject">Product (U²-Netp)</option><option value="people">People / apparel on a model (MODNet)</option></select></label>
              <button type="button" className="optButton primary ecWide" disabled={!nT || !!busy} onClick={removeBackground}><WandSparkles size={14} aria-hidden="true" /> {targets.length && targets.every(i => i.ai) ? 'Detect again' : 'Remove background'}{nT > 1 ? ` (${nT})` : ''}</button>
              <p className="ecHint">Runs on this device. The matte is stored with each photo, so it is detected only once.</p>
            </Section>
            <Section title={`Edge refinement${nT > 1 ? ` · ${nT} photos` : ''}`}>
              <Range label="Edge shift" min={-10} max={10} unit="px" value={tm.edgeShift} onChange={v => setMatte('edgeShift', v)} disabled={!t} />
              <Range label="Feather" min={0} max={20} step={0.5} unit="px" value={tm.feather} onChange={v => setMatte('feather', v)} disabled={!t} />
              <Range label="Edge contrast" min={0} max={100} unit="%" value={tm.contrast} onChange={v => setMatte('contrast', v)} disabled={!t} />
              <Check label="Decontaminate edge colours" checked={tm.decontaminate} onChange={v => setMatte('decontaminate', v)} disabled={!t} />
              {tm.decontaminate && <Range label="Decontamination amount" min={0} max={100} unit="%" value={tm.decontaminateAmount} onChange={v => setMatte('decontaminateAmount', v)} disabled={!t} />}
            </Section>
            <Section title="Touch-up brush">
              <Seg label="Brush mode" value={brush.mode} onChange={m => { setBrush(b => ({ ...b, mode: m })); setView('cutout'); }} options={[['erase', <><Eraser size={13} aria-hidden="true" /> Erase</>], ['restore', <><Brush size={13} aria-hidden="true" /> Restore</>]]} />
              <Range label="Brush size" min={0.5} max={20} step={0.5} unit="%" value={brush.size} onChange={v => setBrush(b => ({ ...b, size: v }))} />
              <Range label="Brush hardness" min={0} max={100} unit="%" value={brush.hardness} onChange={v => setBrush(b => ({ ...b, hardness: v }))} />
              <p className="ecHint">{active?.ai ? (view === 'cutout' ? 'Paint on the preview to erase or restore parts of the product.' : 'Switch the preview to “Cutout & touch-up” to paint.') : 'Remove the background first.'}</p>
              <div className="ecRow">
                <button type="button" className="optButton" disabled={!active?.strokes.length} onClick={() => patchItem(active.id, { strokes: active.strokes.slice(0, -1) })}><Undo2 size={14} aria-hidden="true" /> Undo stroke</button>
                <button type="button" className="optButton" disabled={!active?.strokes.length} onClick={() => patchItem(active.id, { strokes: [] })}>Clear touch-ups</button>
              </div>
            </Section>
          </>}

          {tab === 'layout' && <Section title="Product framing">
            <Range label="Margin" min={0} max={40} step={0.5} unit="%" value={s.framing.margin} onChange={v => setS('framing', 'margin', v)} />
            <button type="button" className="optButton ecWide" onClick={() => setS('framing', 'margin', marginForFill(preset.fill))}>Use {preset.name} fill ({Math.round(preset.fill * 100)} %)</button>
            <div className="ecField"><span>Alignment</span><Seg label="Alignment" value={s.framing.align} onChange={v => setS('framing', 'align', v)} options={[['center', 'Centre'], ['bottom', 'Bottom (floor line)']]} /></div>
            <div className="ecField"><span>Batch sizing</span><Seg label="Batch sizing" value={s.framing.sizing} onChange={v => setS('framing', 'sizing', v)} options={[['fit', 'Fill frame'], ['uniform', 'Uniform scale']]} /></div>
            <p className="ecHint">The product is cropped to its bounds automatically. “Uniform scale” gives every photo of the project the same scale, so products shot with the same set-up keep their real relative sizes; the largest one fills the frame.</p>
          </Section>}

          {tab === 'background' && <>
            <Section title="Background">
              <Seg label="Background type" value={s.background.type} onChange={v => setS('background', 'type', v)} options={[['transparent', 'None'], ['white', 'White'], ['color', 'Colour'], ['gradient', 'Gradient'], ['image', 'Image']]} />
              {s.background.type === 'white' && <p className="ecHint">Pure white #FFFFFF — what Amazon and Mercado Libre check for.</p>}
              {s.background.type === 'transparent' && <p className="ecHint">Exported as transparent PNG/WebP; JPEG is flattened onto white.</p>}
              {(s.background.type === 'color' || s.background.type === 'gradient') && <Color label={s.background.type === 'gradient' ? 'Gradient start colour' : 'Background colour'} value={s.background.color} onChange={v => setS('background', 'color', v)} />}
              {s.background.type === 'gradient' && <><Color label="Gradient end colour" value={s.background.color2} onChange={v => setS('background', 'color2', v)} /><Range label="Gradient angle" min={0} max={360} unit="°" value={s.background.angle} onChange={v => setS('background', 'angle', v)} /></>}
              {s.background.type === 'image' && <div className="ecRow"><button type="button" className="optButton" onClick={() => bgFileRef.current.click()}><ImageIcon size={14} aria-hidden="true" /> Choose image…</button><span className="ecDim ecEllipsis">{s.background.imageName || 'No image chosen'}</span></div>}
              <input ref={bgFileRef} className="ecHidden" type="file" accept="image/*" aria-label="Background image file" onChange={e => { chooseBgImage(e.target.files[0]); e.target.value = ''; }} />
            </Section>
            <Section title="Ground shadow">
              <Check label="Contact shadow" checked={s.shadow.contact} onChange={v => setS('shadow', 'contact', v)} />
              {s.shadow.contact && <>
                <Range label="Contact shadow opacity" min={0} max={100} unit="%" value={s.shadow.contactOpacity} onChange={v => setS('shadow', 'contactOpacity', v)} />
                <Range label="Contact shadow blur" min={0.5} max={20} step={0.5} unit="%" value={s.shadow.contactBlur} onChange={v => setS('shadow', 'contactBlur', v)} />
                <Range label="Contact shadow width" min={40} max={160} unit="%" value={s.shadow.contactWidth} onChange={v => setS('shadow', 'contactWidth', v)} />
              </>}
              <Check label="Drop shadow" checked={s.shadow.drop} onChange={v => setS('shadow', 'drop', v)} />
              {s.shadow.drop && <>
                <Range label="Drop shadow opacity" min={0} max={100} unit="%" value={s.shadow.dropOpacity} onChange={v => setS('shadow', 'dropOpacity', v)} />
                <Range label="Drop shadow blur" min={0} max={30} step={0.5} unit="%" value={s.shadow.dropBlur} onChange={v => setS('shadow', 'dropBlur', v)} />
                <Range label="Drop shadow offset" min={0} max={30} step={0.5} unit="%" value={s.shadow.dropDistance} onChange={v => setS('shadow', 'dropDistance', v)} />
                <Range label="Drop shadow angle" min={0} max={360} unit="°" value={s.shadow.dropAngle} onChange={v => setS('shadow', 'dropAngle', v)} />
              </>}
              {(s.shadow.contact || s.shadow.drop) && <Color label="Shadow colour" value={s.shadow.color} onChange={v => setS('shadow', 'color', v)} />}
              <p className="ecHint">Generated from the product's matte. Blur and offset are relative to the product size.</p>
            </Section>
            <Section title="Reflection">
              <Check label="Reflection" checked={s.reflection.enabled} onChange={v => setS('reflection', 'enabled', v)} />
              {s.reflection.enabled && <>
                <Range label="Reflection opacity" min={0} max={100} unit="%" value={s.reflection.opacity} onChange={v => setS('reflection', 'opacity', v)} />
                <Range label="Reflection height" min={5} max={100} unit="%" value={s.reflection.height} onChange={v => setS('reflection', 'height', v)} />
                <Range label="Reflection gap" min={0} max={10} step={0.5} unit="%" value={s.reflection.gap} onChange={v => setS('reflection', 'gap', v)} />
              </>}
            </Section>
          </>}

          {tab === 'retouch' && <Section title={`Light retouch${nT > 1 ? ` · ${nT} photos` : ''}`}>
            <Check label="Auto white balance" checked={tr.autoWB} onChange={v => setRetouch('autoWB', v)} disabled={!t} />
            <Check label="Auto tone" checked={tr.autoTone} onChange={v => setRetouch('autoTone', v)} disabled={!t} />
            <Range label="Brightness" min={-100} max={100} value={tr.brightness} onChange={v => setRetouch('brightness', v)} disabled={!t} />
            <Range label="Contrast" min={-100} max={100} value={tr.contrast} onChange={v => setRetouch('contrast', v)} disabled={!t} />
            <Range label="Saturation" min={-100} max={100} value={tr.saturation} onChange={v => setRetouch('saturation', v)} disabled={!t} />
            <Range label="Sharpen" min={0} max={100} value={tr.sharpen} onChange={v => setRetouch('sharpen', v)} disabled={!t} />
            <button type="button" className="optButton ecWide" disabled={!t} onClick={() => updateItems(targetIds, it => ({ ...it, retouch: { ...RETOUCH_DEFAULTS } }))}>Reset retouch</button>
            <p className="ecHint">Applies to the selected photos (select several to retouch a batch). Non-destructive: the originals are kept.</p>
          </Section>}

          {tab === 'market' && <>
            <Section title="Marketplace preset">
              <div className="ecPresetList" role="radiogroup" aria-label="Marketplace preset">
                {PRESETS.map(p => <label key={p.id} className={'ecPreset' + (s.presetId === p.id ? ' on' : '')}><input type="radio" name="ecPreset" aria-label={p.name} checked={s.presetId === p.id} onChange={() => setS('presetId', null, p.id)} /><span>{p.name}</span><small>{p.custom ? `${s.custom.w} × ${s.custom.h}` : `${p.w} × ${p.h}`}</small></label>)}
              </div>
              {preset.custom && <div className="ecRow">
                <label className="opField ecNum"><span>Width</span><input type="number" aria-label="Custom width" min={16} max={8000} value={s.custom.w} onChange={e => setS('custom', 'w', Math.max(16, Math.min(8000, +e.target.value || 16)))} /><small>px</small></label>
                <label className="opField ecNum"><span>Height</span><input type="number" aria-label="Custom height" min={16} max={8000} value={s.custom.h} onChange={e => setS('custom', 'h', Math.max(16, Math.min(8000, +e.target.value || 16)))} /><small>px</small></label>
              </div>}
              <p className="ecHint">{preset.note}</p>
              {Math.abs(marginForFill(preset.fill) - s.framing.margin) > 0.05 && <button type="button" className="optButton ecWide" onClick={() => setS('framing', 'margin', marginForFill(preset.fill))}>Apply recommended fill ({Math.round(preset.fill * 100)} %)</button>}
              {preset.white === 'required' && s.background.type !== 'white' && <button type="button" className="optButton ecWide" onClick={() => setS('background', 'type', 'white')}>Use pure white background</button>}
            </Section>
            <Section title="Checklist">
              {!active?.ai ? <p className="ecHint">Remove the background of a photo to check it.</p> : !rows ? <p className="ecHint">Measuring…</p> :
                <ul className="ecChecklist" aria-label="Marketplace checklist" data-pass={passAll ? '1' : '0'} data-full={fullCheck?.key === checkKey ? '1' : '0'}>
                  {rows.map(r => <li key={r.id} className={r.status} data-status={r.status}><StatusIcon s={r.status} /><div><b>{r.label}</b><span>{r.detail}</span></div></li>)}
                </ul>}
              <button type="button" className="optButton ecWide" disabled={!active?.ai || checking} onClick={runFullCheck}>{checking ? 'Checking…' : 'Check at full size'}</button>
              <p className="ecHint">{fullCheck?.key === checkKey ? 'Measured on the full-size file as it will be exported.' : 'Measured on the preview; the full-size check also encodes the file to measure its size.'}</p>
            </Section>
          </>}

          {tab === 'export' && <>
            <Section title="Format">
              <Seg label="Export format" value={s.export.format} onChange={v => setS('export', 'format', v)} options={Object.entries(FORMATS).map(([k, f]) => [k, f.label])} />
              {s.export.format !== 'png' && <Range label="Quality" min={40} max={100} unit="%" value={s.export.quality} onChange={v => setS('export', 'quality', v)} />}
              <label className="opField ecText"><span>File names</span><input type="text" aria-label="File name template" value={s.export.template} onChange={e => setS('export', 'template', e.target.value)} /></label>
              <p className="ecHint">Tokens: {'{name}'} original name, {'{preset}'} preset, {'{n}'} number, {'{w}'}/{'{h}'} size. Example: {formatName(s.export.template, { name: active?.name || 'photo.jpg', preset: s.export.presets[0] || s.presetId, n: 1, w: preset.w, h: preset.h }, FORMATS[s.export.format].ext)}</p>
            </Section>
            <Section title="Presets to export">
              <div className="ecPresetChecks">{PRESETS.map(p => <Check key={p.id} label={'Export ' + p.name} checked={s.export.presets.includes(p.id)} onChange={v => togglePreset(p.id, v)} />)}</div>
            </Section>
            <Section title="Photos and delivery">
              <Seg label="Photos to export" value={exportScope} onChange={setExportScope} options={[['current', 'Current'], ['selected', `Selected (${selectedItems.length})`], ['all', `All (${items.length})`]]} />
              <Seg label="Delivery" value={s.export.zip ? 'zip' : 'files'} onChange={v => setS('export', 'zip', v === 'zip')} options={[['zip', 'One ZIP file'], ['files', 'Separate files']]} />
              <button type="button" className="optButton primary ecWide" disabled={!!busy || !items.length} onClick={doExport}><Download size={14} aria-hidden="true" /> Export</button>
            </Section>
          </>}

          {tab === 'templates' && <>
            <Section title="Template">
              <div className="ecTplGrid" role="radiogroup" aria-label="Marketing template">
                {TEMPLATES.map(x => <button key={x.id} type="button" role="radio" aria-checked={tpl.id === x.id} className={tpl.id === x.id ? 'on' : ''} onClick={() => setS('template', 'id', x.id)}><b>{x.name}</b><small>{x.w} × {x.h}</small></button>)}
              </div>
              {!active?.ai && <p className="ecHint">Remove the background of the current photo to place it in the template.</p>}
            </Section>
            <Section title="Content">
              {tpl.fields.map(k => /Color$/.test(k)
                ? <Color key={k} label={TEMPLATE_FIELDS[k]} value={tplParams[k]} onChange={v => setTplParam(k, v)} />
                : <label key={k} className="opField ecText"><span>{TEMPLATE_FIELDS[k]}</span><input type="text" aria-label={TEMPLATE_FIELDS[k]} value={tplParams[k]} onChange={e => setTplParam(k, e.target.value)} /></label>)}
              <button type="button" className="optButton ecWide" onClick={() => setProject(p => ({ ...p, settings: { ...p.settings, template: { ...p.settings.template, params: { ...p.settings.template.params, [tpl.id]: {} } } } }))}>Reset text and colours</button>
            </Section>
            <Section title="Use">
              <div className="ecRow">
                <button type="button" className="optButton" onClick={tplDownload}><Download size={14} aria-hidden="true" /> Download PNG</button>
                {onEditInDesigner && <button type="button" className="optButton primary" onClick={tplDesigner}><ExternalLink size={14} aria-hidden="true" /> Open in Designer</button>}
              </div>
            </Section>
          </>}
        </div>
      </aside>
      {drag && <div className="ecDropOverlay" aria-hidden="true"><Upload size={32} /> Drop photos to import</div>}
    </div>
  );
}
