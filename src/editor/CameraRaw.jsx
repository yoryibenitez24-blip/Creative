import React, { useEffect, useRef, useState } from 'react';
import { developDefaults, autoTone } from '../engine/develop.js';
import { histogram } from '../engine/adjust.js';
import { resample } from '../engine/geometry.js';
import { createOpsClient } from './opsClient.js';
import { DevelopPanelStack, ProfileControls, sampleForPick, pickHint, PANELS_OPEN_DEFAULT } from './DevelopPanels.jsx';
import { useMasking, MaskingPanel, MaskCanvasLayer, MaskModeBar } from './MaskingPanel.jsx';

// Filter › Camera Raw Filter: full-screen develop workspace with the Light, Color, Effects, Curve,
// Color Mixer, Color Grading, Detail, Optics, Lens Blur and Calibration panels. The preview is a
// down-scaled copy processed in the worker with document-scale radii (ctx.scale); OK renders the
// full-resolution layer in the worker and commits one undo step. Settings are saved on the layer,
// so reopening Camera Raw on the same pixels continues from the previous settings.
// The panel controls live in DevelopPanels.jsx (shared with the Library/Develop workspace).

export default function CameraRaw({ source, initial, run, onCancel, onApply, offsetX = 0, offsetY = 0 }) {
  const [s, setS] = useState(() => ({ ...developDefaults(), ...(initial || {}) }));
  const [open, setOpen] = useState(() => ({ ...PANELS_OPEN_DEFAULT }));
  const [before, setBefore] = useState(false), [clipWarn, setClipWarn] = useState(false), [pick, setPick] = useState(null);
  const [preview, setPreview] = useState(null), [busy, setBusy] = useState(false), [err, setErr] = useState(null), [hist, setHist] = useState(null);
  const canvas = useRef(), timer = useRef(0), small = useRef(null);
  const set = patch => setS(v => ({ ...v, ...patch }));
  const setIn = (k, patch) => setS(v => ({ ...v, [k]: { ...v[k], ...patch } }));
  const toggle = id => setOpen(o => ({ ...o, [id]: !o[id] }));
  // Masking (MaskingPanel.jsx): masks live in s.masks, so OK applies them with the other settings.
  const mk = useMasking({ masks: s.masks, setMasks: masks => setS(v => ({ ...v, masks })), getSource: () => small.current?.buf, windowKeys: true });

  // Preview pipeline. Two proxies: `small` (≤1100 px, the quality preview) and `tiny` (≤480 px) that
  // is rendered while a slider is moving so the image follows the hand. Jobs never cancel each other:
  // while one renders, newer changes coalesce into a single follow-up job with the latest settings,
  // and the quality render starts once the sliders have rested for a moment.
  const client = useState(() => createOpsClient())[0];
  const sRef = useRef(s); sRef.current = s;
  const tiny = useRef(null), job = useRef({ busy: false, want: null }), alive = useRef(true);
  useEffect(() => () => { alive.current = false; clearTimeout(timer.current); client.cancel(); }, []);
  const pump = async () => {
    const j = job.current; if (j.busy || !j.want || !small.current) return;
    const kind = j.want; j.want = null;
    const src = kind === 'tiny' && tiny.current ? tiny.current : small.current;
    j.busy = true; setBusy(true); setErr(null); const t0 = performance.now();
    try { const r = await client.run('cameraRaw', src.buf, { settings: sRef.current }, { scale: src.scale, offsetX, offsetY }); if (src === small.current) { const ms = performance.now() - t0; fullMs.current = fullMs.current ? fullMs.current * 0.6 + ms * 0.4 : ms; } if (alive.current) { setPreview(r); if (src === small.current) setHist(histogram(r)); } }
    catch (e) { if (!e.cancelled && alive.current) setErr(e.message); }
    j.busy = false; if (!alive.current) return; if (j.want) pump(); else setBusy(false);
  };
  const request = kind => { const j = job.current; j.want = kind === 'full' || j.want !== 'full' ? kind : j.want; pump(); };
  // Interactive proxy size adapts to this machine: the largest proxy that renders in ~70 ms, and no
  // reduced pass at all when the quality preview is already that fast (so nothing looks soft).
  const fullMs = useRef(0);
  const sizeTiny = () => { const sm = small.current, ms = fullMs.current; if (!sm || !ms) return; const L = Math.max(sm.buf.w, sm.buf.h), want = Math.round(Math.min(L, Math.max(480, L * Math.sqrt(70 / ms))));
    if (want >= L * 0.92) { tiny.current = null; return; } const cur = tiny.current ? Math.max(tiny.current.buf.w, tiny.current.buf.h) : 0; if (Math.abs(cur - want) < want * 0.1) return;
    const k = want / L, t = resample(sm.buf, Math.max(1, Math.round(sm.buf.w * k)), Math.max(1, Math.round(sm.buf.h * k)), 'bilinear'); tiny.current = { buf: t, scale: sm.scale * t.w / sm.buf.w }; };
  const kick = () => { if (!small.current) return; sizeTiny(); request(tiny.current ? 'tiny' : 'full'); clearTimeout(timer.current); timer.current = setTimeout(() => request('full'), tiny.current ? 220 : 0); };
  // down-scaled preview sources (once)
  useEffect(() => {
    const ready = sm => { small.current = sm; request('full'); };
    const k = Math.min(1, 1100 / Math.max(source.width, source.height));
    if (k >= 1) { ready({ buf: { w: source.width, h: source.height, data: source.data }, scale: 1 }); return; }
    run('resample', { w: source.width, h: source.height, data: source.data }, { w: Math.round(source.width * k), h: Math.round(source.height * k), method: 'bilinear' }, {})
      .then(r => ready({ buf: r, scale: r.w / source.width })).catch(e => setErr(e.message));
  }, []);
  useEffect(kick, [s]);
  // draw
  useEffect(() => {
    const c = canvas.current, sm = small.current; if (!c || !sm) return;
    const img = before ? sm.buf : preview || sm.buf; c.width = sm.buf.w; c.height = sm.buf.h;
    const out = new ImageData(new Uint8ClampedArray(img.data), img.w, img.h);
    if (clipWarn && !before) for (let i = 0; i < out.data.length; i += 4) { const d = out.data; if (d[i] >= 254 || d[i + 1] >= 254 || d[i + 2] >= 254) { d[i] = 255; d[i + 1] = 0; d[i + 2] = 0; } else if (d[i] <= 1 && d[i + 1] <= 1 && d[i + 2] <= 1) { d[i] = 0; d[i + 1] = 80; d[i + 2] = 255; } }
    const ctx = c.getContext('2d');
    if (img.w === c.width && img.h === c.height) ctx.putImageData(out, 0, 0);
    else { const t = document.createElement('canvas'); t.width = img.w; t.height = img.h; t.getContext('2d').putImageData(out, 0, 0); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(t, 0, 0, c.width, c.height); }
  }, [preview, before, clipWarn]);

  const sampleAt = e => {
    const sm = small.current; if (!sm || !pick) return;
    const r = canvas.current.getBoundingClientRect(), x = Math.floor((e.clientX - r.left) / r.width * sm.buf.w), y = Math.floor((e.clientY - r.top) / r.height * sm.buf.h);
    const r2 = sampleForPick(pick, sm.buf, x, y, s);
    if (r2.setIn) setIn(...r2.setIn); else if (r2.patch) set(r2.patch);
    setPick(null);
  };
  const auto = () => { const sm = small.current; if (!sm) return; set({ ...autoTone(sm.buf) }); };
  const reset = () => setS(developDefaults());
  const histPath = ch => { if (!hist) return ''; const h = hist[ch], m = Math.max(1, ...h); return Array.from(h, (v, x) => `${x === 0 ? 'M' : 'L'}${x} ${100 - Math.sqrt(v / m) * 100}`).join('') + 'L255 100L0 100Z'; };
  const mono = s.profile === 'monochrome';

  return <div className="cameraRaw" role="dialog" aria-label="Camera Raw Filter" onKeyDown={e => { if (e.key === 'Escape') onCancel(); if ((e.key === 'y' || e.key === 'Y') && !['INPUT', 'SELECT'].includes(e.target.tagName)) setBefore(b => !b); }} tabIndex={-1}>
    <div className="crsTop"><strong>Camera Raw Filter</strong><span className="crsStatus" role="status">{err || (busy ? 'Rendering preview…' : 'Preview ready')}</span>
      <div className="crsTopRight"><label className="optCheck"><input type="checkbox" checked={before} onChange={e => setBefore(e.target.checked)} />Before (Y)</label><label className="optCheck"><input type="checkbox" checked={clipWarn} onChange={e => setClipWarn(e.target.checked)} />Clipping warnings</label></div></div>
    <div className="crsMain">
      <div className={'crsView' + (pick ? ' picking' : '')} onClick={sampleAt}><canvas ref={canvas} aria-label="Camera Raw preview" />{pick && <div className="crsHint">{pickHint(pick)}</div>}{mk.on && <MaskCanvasLayer mk={mk} canvasRef={canvas} />}</div>
      <aside className="crsSide">
        <svg className="crsHist" viewBox="0 0 255 100" preserveAspectRatio="none" aria-label="Histogram">{['r', 'g', 'b'].map(c => <path key={c} d={histPath(c)} fill={c === 'r' ? '#ff4a4a66' : c === 'g' ? '#4aff6a66' : '#4a7dff66'} />)}</svg>
        <div className="crsEdit"><strong>Edit</strong><div><button onClick={auto}>Auto</button><button aria-pressed={mono} className={mono ? 'on' : ''} onClick={() => set({ profile: mono ? 'color' : 'monochrome' })}>B&amp;W</button><button disabled title="HDR editing needs an HDR display and a high-bit pipeline, which Zertake does not have yet">HDR</button><button onClick={reset} title="Reset all settings">Reset</button></div></div>
        <MaskModeBar mk={mk} />
        {!mk.on && <ProfileControls s={s} set={set} />}
        <div className="crsScroll">
          {mk.on ? <MaskingPanel mk={mk} /> : <DevelopPanelStack s={s} set={set} setIn={setIn} open={open} toggle={toggle} hist={hist} pick={pick} setPick={setPick} getSource={() => small.current?.buf} />}
        </div>
        <footer className="crsFooter"><button onClick={onCancel}>Cancel</button><button className="primary" onClick={() => onApply(s)}>OK</button></footer>
      </aside>
    </div>
  </div>;
}
