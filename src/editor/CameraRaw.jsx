import React, { useEffect, useRef, useState } from 'react';
import { developDefaults, autoTone } from '../engine/develop.js';
import { histogram } from '../engine/adjust.js';
import { DevelopPanelStack, ProfileControls, sampleForPick, pickHint, PANELS_OPEN_DEFAULT } from './DevelopPanels.jsx';

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

  // down-scaled preview source (once)
  useEffect(() => {
    const k = Math.min(1, 1100 / Math.max(source.width, source.height));
    if (k >= 1) { small.current = { buf: { w: source.width, h: source.height, data: source.data }, scale: 1 }; setPreview(p => p); kick(); return; }
    run('resample', { w: source.width, h: source.height, data: source.data }, { w: Math.round(source.width * k), h: Math.round(source.height * k), method: 'bilinear' }, {})
      .then(r => { small.current = { buf: r, scale: r.w / source.width }; kick(); }).catch(e => setErr(e.message));
  }, []);
  const kick = () => { clearTimeout(timer.current); timer.current = setTimeout(async () => {
    const sm = small.current; if (!sm) return;
    setBusy(true); setErr(null);
    try { const r = await run('cameraRaw', sm.buf, { settings: s }, { scale: sm.scale, offsetX, offsetY }); setPreview(r); setHist(histogram(r)); setBusy(false); }
    catch (e) { if (!e.cancelled) { setErr(e.message); setBusy(false); } }
  }, 90); };
  useEffect(kick, [s]);
  // draw
  useEffect(() => {
    const c = canvas.current, sm = small.current; if (!c || !sm) return;
    const img = before ? sm.buf : preview || sm.buf; c.width = img.w; c.height = img.h;
    const out = new ImageData(new Uint8ClampedArray(img.data), img.w, img.h);
    if (clipWarn && !before) for (let i = 0; i < out.data.length; i += 4) { const d = out.data; if (d[i] >= 254 || d[i + 1] >= 254 || d[i + 2] >= 254) { d[i] = 255; d[i + 1] = 0; d[i + 2] = 0; } else if (d[i] <= 1 && d[i + 1] <= 1 && d[i + 2] <= 1) { d[i] = 0; d[i + 1] = 80; d[i + 2] = 255; } }
    c.getContext('2d').putImageData(out, 0, 0);
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
      <div className={'crsView' + (pick ? ' picking' : '')} onClick={sampleAt}><canvas ref={canvas} aria-label="Camera Raw preview" />{pick && <div className="crsHint">{pickHint(pick)}</div>}</div>
      <aside className="crsSide">
        <svg className="crsHist" viewBox="0 0 255 100" preserveAspectRatio="none" aria-label="Histogram">{['r', 'g', 'b'].map(c => <path key={c} d={histPath(c)} fill={c === 'r' ? '#ff4a4a66' : c === 'g' ? '#4aff6a66' : '#4a7dff66'} />)}</svg>
        <div className="crsEdit"><strong>Edit</strong><div><button onClick={auto}>Auto</button><button aria-pressed={mono} className={mono ? 'on' : ''} onClick={() => set({ profile: mono ? 'color' : 'monochrome' })}>B&amp;W</button><button disabled title="HDR editing needs an HDR display and a high-bit pipeline, which Zertake does not have yet">HDR</button><button onClick={reset} title="Reset all settings">Reset</button></div></div>
        <ProfileControls s={s} set={set} />
        <div className="crsScroll">
          <DevelopPanelStack s={s} set={set} setIn={setIn} open={open} toggle={toggle} hist={hist} pick={pick} setPick={setPick} getSource={() => small.current?.buf} />
        </div>
        <footer className="crsFooter"><button onClick={onCancel}>Cancel</button><button className="primary" onClick={() => onApply(s)}>OK</button></footer>
      </aside>
    </div>
  </div>;
}
