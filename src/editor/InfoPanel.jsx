import React from 'react';

// Compact Photoshop-style Info panel (pure presentational).
// readout:   { x, y, rgb:[r,g,b], a (0..255 or 0..1, shown as %) } at the pointer, or null
// samplers:  [{ id, x, y, rgb:[r,g,b] }] (numbered #1.. in array order; Photoshop allows 10)
// ruler:     { x0, y0, x1, y1, length, angle (deg) } or null
// selection: { x, y, w, h } or null;  doc: { w, h }
// CSS: dist/css/toolui.css

const hex2 = n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
export const toHex = rgb => '#' + rgb.map(hex2).join('').toUpperCase();
export function rgbToHsb([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = Math.round(h * 60); if (h < 0) h += 360;
  return [h, Math.round(max ? d / max * 100 : 0), Math.round(max * 100)];
}
const fmt = v => v == null || !Number.isFinite(+v) ? '—' : String(Math.round(+v * 10) / 10);
const Pair = ({ k, v }) => <><dt>{k}</dt><dd>{v}</dd></>;

function Color({ rgb, a, title }) {
  const ok = Array.isArray(rgb);
  const hsb = ok ? rgbToHsb(rgb) : null;
  const alpha = a == null ? null : Math.round(a > 1 ? a / 255 * 100 : a * 100);
  return <section className="infoCell" aria-label={title}>
    <dl className="infoGrid">
      <Pair k="R" v={ok ? rgb[0] : '—'} /><Pair k="H" v={ok ? hsb[0] + '°' : '—'} />
      <Pair k="G" v={ok ? rgb[1] : '—'} /><Pair k="S" v={ok ? hsb[1] + '%' : '—'} />
      <Pair k="B" v={ok ? rgb[2] : '—'} /><Pair k="B" v={ok ? hsb[2] + '%' : '—'} />
    </dl>
    <div className="infoHex">
      <i className="infoChip" style={{ background: ok ? toHex(rgb) : 'transparent' }} aria-hidden="true" />
      <span>{ok ? toHex(rgb) : '—'}</span>
      {alpha != null && ok && <small>{alpha}% opacity</small>}
    </div>
  </section>;
}

export default function InfoPanel({ readout, samplers = [], onRemoveSampler, ruler, selection, doc }) {
  return <div className="infoPanel" role="region" aria-label="Info">
    <div className="infoTop">
      <Color title="Pointer color" rgb={readout?.rgb} a={readout?.a} />
      <section className="infoCell" aria-label="Pointer position">
        <dl className="infoGrid two">
          <Pair k="X" v={readout ? fmt(readout.x) : '—'} />
          <Pair k="Y" v={readout ? fmt(readout.y) : '—'} />
          <Pair k="W" v={selection ? fmt(selection.w) : '—'} />
          <Pair k="H" v={selection ? fmt(selection.h) : '—'} />
        </dl>
      </section>
    </div>
    {(ruler || doc) && <div className="infoLine">
      {ruler && <span aria-label="Ruler">L: {fmt(ruler.length)} px · A: {fmt(ruler.angle)}°</span>}
      {doc && <span aria-label="Document size">Doc: {doc.w} × {doc.h} px</span>}
    </div>}
    {samplers.length > 0 && <ol className="infoSamplers" aria-label="Color samplers">
      {samplers.slice(0, 10).map((s, i) => <li key={s.id} className="infoSampler">
        <b>#{i + 1}</b>
        <i className="infoChip" style={{ background: toHex(s.rgb) }} aria-hidden="true" />
        <span className="infoRgb">R {s.rgb[0]} G {s.rgb[1]} B {s.rgb[2]}</span>
        <span className="infoHexTxt">{toHex(s.rgb)}</span>
        <small>{Math.round(s.x)}, {Math.round(s.y)}</small>
        {onRemoveSampler && <button type="button" className="infoRemove" aria-label={`Remove sampler ${i + 1}`} title="Remove sampler" onClick={() => onRemoveSampler(s.id)}>×</button>}
      </li>)}
    </ol>}
  </div>;
}
