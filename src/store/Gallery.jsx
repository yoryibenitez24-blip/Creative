import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, Eye, Link2 } from 'lucide-react';
import { templatePreviewUrl } from './templatePreview.js';
import { STORE_TEMPLATES, TEMPLATE_CATEGORIES, CREATIVE_FILTER, createStore } from './templates.js';
import { renderPage } from './render.js';
import { genUrl } from './images.js';

// Template gallery: category filter, live (scaled, lazily mounted) home-page thumbnails that scroll on hover,
// "Use template". onPick(templateId); onCancel shown only when a store is already open; initialCategory preselects a filter.

function Thumb({ id, name }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { setVisible(true); io.disconnect(); } }, { rootMargin: '300px' });
    io.observe(el); return () => io.disconnect();
  }, []);
  const html = useMemo(() => visible ? renderPage(createStore(id), { page: 'home' }, { mode: 'preview', imageUrl: genUrl, script: false, small: true }) : '', [visible, id]);
  return <div className="stTplThumb" ref={ref} aria-hidden="true">{visible && <iframe title={name + ' preview'} srcDoc={html} tabIndex={-1} loading="lazy" sandbox="allow-same-origin" />}</div>;
}

export default function Gallery({ onPick, onCancel, currentId, cancelLabel = 'Back to builder', initialCategory }) {
  const [cat, setCat] = useState(() => [CREATIVE_FILTER, ...TEMPLATE_CATEGORIES].includes(initialCategory) ? initialCategory : 'All');
  const [copied, setCopied] = useState('');
  const copy = async t => {
    const url = templatePreviewUrl(t.id);
    try { await navigator.clipboard.writeText(url); } catch { window.prompt('Preview link for ' + t.name, url); }
    setCopied(t.id); setTimeout(() => setCopied(c => c === t.id ? '' : c), 1800);
  };
  const list = STORE_TEMPLATES.filter(t => cat === 'All' || t.category === cat || (cat === CREATIVE_FILTER && t.creative));
  return <div className="stGallery" role="region" aria-label="Store templates">
    <header className="stGalleryHead">
      {onCancel && <button type="button" className="stBtn ghost" onClick={onCancel} aria-label={cancelLabel === 'Back to builder' ? 'Back to the builder' : cancelLabel}><ArrowLeft size={14} />{cancelLabel}</button>}
      <div><h1>Choose a store template</h1><p>{STORE_TEMPLATES.length} templates · complete multi-page stores with sample products you can replace. Everything is editable.</p></div>
    </header>
    <div className="segmented stCats" role="group" aria-label="Template category">
      {['All', CREATIVE_FILTER, ...TEMPLATE_CATEGORIES].map(c => <button key={c} type="button" aria-pressed={cat === c} className={cat === c ? 'on' : ''} onClick={() => setCat(c)}>{c}</button>)}
    </div>
    <p className="stCount" aria-live="polite">{list.length} {list.length === 1 ? 'template' : 'templates'}</p>
    <ul className="stTplGrid">
      {list.map(t => <li key={t.id} className="stTpl">
        <a className="stTplThumbLink" href={templatePreviewUrl(t.id)} target="_blank" rel="noopener" tabIndex={-1} aria-hidden="true"><Thumb id={t.id} name={t.name} /><span className="stTplPeek"><Eye size={14} />Live preview</span></a>
        <div className="stTplInfo">
          <div className="stTplTop"><h2>{t.name}{t.creative && <span className="stTplTag">Creative</span>}</h2><span className="stSwatches" aria-hidden="true">{t.swatch.map((c, i) => <i key={i} style={{ background: c }} />)}</span></div>
          <p className="stTplNiche">{t.niche}</p>
          <p className="stTplDesc">{t.description}</p>
          <div className="stTplActions">
            <button type="button" className="stBtn stPrimary" aria-label={`Use template ${t.name}`} onClick={() => onPick(t.id)}>{currentId === t.id && <Check size={13} />}Use template</button>
            <a className="stBtn ghost" href={templatePreviewUrl(t.id)} target="_blank" rel="noopener" aria-label={`Preview ${t.name} in a new tab`}><Eye size={13} />Preview</a>
            <button type="button" className="stBtn ghost stIconOnly" aria-label={`Copy preview link for ${t.name}`} title="Copy preview link" onClick={() => copy(t)}>{copied === t.id ? <Check size={13} /> : <Link2 size={13} />}</button>
          </div>
        </div>
      </li>)}
    </ul>
  </div>;
}
