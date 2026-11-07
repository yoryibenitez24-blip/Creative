import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check } from 'lucide-react';
import { STORE_TEMPLATES, TEMPLATE_CATEGORIES, createStore } from './templates.js';
import { renderPage } from './render.js';
import { genUrl } from './images.js';

// Template gallery: category filter, live (scaled, lazily mounted) home-page thumbnails that scroll on hover,
// "Use template". onPick(templateId); onCancel shown only when a store is already open.

function Thumb({ id, name }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { setVisible(true); io.disconnect(); } }, { rootMargin: '300px' });
    io.observe(el); return () => io.disconnect();
  }, []);
  const html = useMemo(() => visible ? renderPage(createStore(id), { page: 'home' }, { mode: 'preview', imageUrl: genUrl, script: false }) : '', [visible, id]);
  return <div className="stTplThumb" ref={ref} aria-hidden="true">{visible && <iframe title={name + ' preview'} srcDoc={html} tabIndex={-1} loading="lazy" sandbox="allow-same-origin" />}</div>;
}

export default function Gallery({ onPick, onCancel, currentId }) {
  const [cat, setCat] = useState('All');
  const list = STORE_TEMPLATES.filter(t => cat === 'All' || t.category === cat);
  return <div className="stGallery" role="region" aria-label="Store templates">
    <header className="stGalleryHead">
      {onCancel && <button type="button" className="stBtn ghost" onClick={onCancel} aria-label="Back to the builder"><ArrowLeft size={14} />Back to builder</button>}
      <div><h1>Choose a store template</h1><p>{STORE_TEMPLATES.length} templates · complete multi-page stores with sample products you can replace. Everything is editable.</p></div>
    </header>
    <div className="segmented stCats" role="group" aria-label="Template category">
      {['All', ...TEMPLATE_CATEGORIES].map(c => <button key={c} type="button" aria-pressed={cat === c} className={cat === c ? 'on' : ''} onClick={() => setCat(c)}>{c}</button>)}
    </div>
    <p className="stCount" aria-live="polite">{list.length} {list.length === 1 ? 'template' : 'templates'}</p>
    <ul className="stTplGrid">
      {list.map(t => <li key={t.id} className="stTpl">
        <Thumb id={t.id} name={t.name} />
        <div className="stTplInfo">
          <div className="stTplTop"><h2>{t.name}</h2><span className="stSwatches" aria-hidden="true">{t.swatch.map((c, i) => <i key={i} style={{ background: c }} />)}</span></div>
          <p className="stTplNiche">{t.niche}</p>
          <p className="stTplDesc">{t.description}</p>
          <button type="button" className="stBtn stPrimary" aria-label={`Use template ${t.name}`} onClick={() => onPick(t.id)}>{currentId === t.id && <Check size={13} />}Use template</button>
        </div>
      </li>)}
    </ul>
  </div>;
}
