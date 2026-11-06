import React, { useState } from 'react';
import { Camera, PenTool, LayoutTemplate, ShoppingBag, ArrowRight, Plus, FolderOpen } from 'lucide-react';

// Start screen and section switcher. Four sections share one app, one asset store and one workspace:
//   photo  — Library · Develop (catalog, Camera Raw-style editing)
//   design — the layered editor (Photoshop-style) with size templates
//   web    — interface design (frames, auto layout, components, prototype)
//   ecom   — product photo studio (cut-outs, marketplace sizes, banners)

export const SECTIONS = [
  { id: 'photo', name: 'Photography', icon: Camera, blurb: 'Import, rate and develop photos. Masking, presets, crop and geometry.' },
  { id: 'design', name: 'Design', icon: PenTool, blurb: 'Layers, brushes, type, effects and filters for posters, social posts and artwork.' },
  { id: 'web', name: 'Web & UI', icon: LayoutTemplate, blurb: 'Design websites and apps with frames, auto layout, components and prototypes.' },
  { id: 'ecom', name: 'E-commerce', icon: ShoppingBag, blurb: 'Cut out products, white backgrounds, marketplace sizes and sale banners.' },
];

// Design size templates (px). Kept within the editor's 8000 px limit.
export const DESIGN_TEMPLATES = [
  { group: 'Social', name: 'Instagram Post', w: 1080, h: 1080 }, { group: 'Social', name: 'Instagram Portrait', w: 1080, h: 1350 },
  { group: 'Social', name: 'Story / Reel', w: 1080, h: 1920 }, { group: 'Social', name: 'Facebook Post', w: 1200, h: 630 },
  { group: 'Social', name: 'Facebook Cover', w: 1640, h: 624 }, { group: 'Social', name: 'X / Twitter Post', w: 1600, h: 900 },
  { group: 'Social', name: 'LinkedIn Banner', w: 1584, h: 396 }, { group: 'Social', name: 'YouTube Thumbnail', w: 1280, h: 720 },
  { group: 'Social', name: 'Pinterest Pin', w: 1000, h: 1500 },
  { group: 'Print', name: 'Poster A3 (150 dpi)', w: 1754, h: 2480 }, { group: 'Print', name: 'Flyer Letter (300 dpi)', w: 2550, h: 3300 },
  { group: 'Print', name: 'Flyer A4 (300 dpi)', w: 2480, h: 3508 }, { group: 'Print', name: 'Business Card (300 dpi)', w: 1050, h: 600 },
  { group: 'Print', name: 'Postcard 6×4 in', w: 1800, h: 1200 },
  { group: 'Other', name: 'Presentation 16:9', w: 1920, h: 1080 }, { group: 'Other', name: 'Logo', w: 1000, h: 1000 },
  { group: 'Other', name: 'Desktop Wallpaper', w: 2560, h: 1440 }, { group: 'Other', name: 'Phone Wallpaper', w: 1170, h: 2532 },
];

export function SectionBar({ section, onSection }) {
  return <nav className="sectionBar" aria-label="Sections">
    <button className={'secHome' + (section === 'home' ? ' on' : '')} aria-label="Home" title="Home" onClick={() => onSection('home')}><span className="logoMini">z<span>•</span></span></button>
    {SECTIONS.map(s => { const I = s.icon; return <button key={s.id} className={section === s.id ? 'on' : ''} aria-pressed={section === s.id} onClick={() => onSection(s.id)} title={s.blurb}><I size={14} /><span>{s.name}</span></button>; })}
  </nav>;
}

export default function Home({ onSection, onNewDesign, onOpenFile, documents = [], onOpenDocument }) {
  const [w, setW] = useState(1920), [h, setH] = useState(1080);
  const groups = [...new Set(DESIGN_TEMPLATES.map(t => t.group))];
  const recent = documents.slice(-6).reverse();
  return <div className="home" role="main" aria-label="Zertake home">
    <header className="homeTop"><div className="brand"><div className="logo">z<span>•</span></div><strong>zertake<span>studio</span></strong></div><SectionBar section="home" onSection={onSection} /></header>
    <div className="homeBody">
      <h1>What are you creating today?</h1>
      <div className="homeCards">{SECTIONS.map(s => { const I = s.icon; return <button key={s.id} className={'homeCard sec-' + s.id} aria-label={'Open ' + s.name} onClick={() => onSection(s.id)}>
        <span className="homeIcon"><I size={22} /></span><strong>{s.name}</strong><p>{s.blurb}</p><span className="homeGo">Open <ArrowRight size={14} /></span></button>; })}</div>

      <section className="homeSection"><h2>Start a design</h2>
        {groups.map(g => <div key={g} className="tplGroup"><h3>{g}</h3><div className="tplRow">{DESIGN_TEMPLATES.filter(t => t.group === g).map(t => {
          const k = 46 / Math.max(t.w, t.h);
          return <button key={t.name} className="tpl" aria-label={'New ' + t.name + ' design, ' + t.w + ' by ' + t.h} onClick={() => onNewDesign(t.name, t.w, t.h)}>
            <span className="tplShape"><span style={{ width: Math.max(6, t.w * k), height: Math.max(6, t.h * k) }} /></span><strong>{t.name}</strong><small>{t.w} × {t.h}</small></button>;
        })}</div></div>)}
        <form className="tplCustom" onSubmit={e => { e.preventDefault(); if (w >= 16 && h >= 16 && w <= 8000 && h <= 8000) onNewDesign('Untitled design', w, h); }}>
          <span>Custom size</span>
          <label><input type="number" aria-label="Custom width" min={16} max={8000} value={w} onChange={e => setW(+e.target.value)} /><small>W</small></label>
          <label><input type="number" aria-label="Custom height" min={16} max={8000} value={h} onChange={e => setH(+e.target.value)} /><small>H</small></label>
          <button type="submit"><Plus size={14} />Create</button>
          <button type="button" onClick={onOpenFile}><FolderOpen size={14} />Open file…</button>
        </form>
      </section>

      {recent.length > 0 && <section className="homeSection"><h2>Recent designs</h2><div className="recentRow">{recent.map(d => <button key={d.id} className="recent" onClick={() => onOpenDocument(d.id)}>
        <span className="recentThumb" style={{ background: d.doc.bg && d.doc.bg !== 'transparent' ? d.doc.bg : '#2a2a2e', aspectRatio: d.doc.w + ' / ' + d.doc.h }} /><strong>{d.doc.name}</strong><small>{d.doc.w} × {d.doc.h} · {d.doc.layers.length} layers</small></button>)}</div></section>}
    </div>
  </div>;
}
