// "Visitors around the world" card for Analytics: a Canvas 2D globe (globe.js) next to a ranked "Top locations" list
// that carries the same data for screen readers and keyboard users (focusing a row turns the globe to that marker).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createGlobe } from './globe.js';
import { flagEmoji } from './geo.js';

export default function VisitorGlobe({ locations, home, unlocated = 0, fmt = v => String(v), rangeLabel = '' }) {
  const canvas = useRef(null), globe = useRef(null), wrap = useRef(null);
  const [tip, setTip] = useState(null);
  const total = locations.reduce((s, l) => s + l.sessions, 0);
  const orders = locations.reduce((s, l) => s + l.orders, 0);

  useEffect(() => {
    if (!canvas.current) return undefined;
    const g = createGlobe(canvas.current, { onHover: (loc, x, y, fromFocus) => setTip(loc ? { loc, x, y, fromFocus: !!fromFocus } : null) });
    globe.current = g;
    return () => { g.destroy(); globe.current = null; };
  }, []);
  useEffect(() => { if (globe.current) globe.current.setData({ locations, home }); }, [locations, home]);

  const summary = useMemo(() => {
    if (!locations.length) return 'Globe of visitor locations. No visitor locations recorded for this period yet.';
    const top = locations.slice(0, 5).map(l => `${l.name} ${l.sessions} session${l.sessions === 1 ? '' : 's'}${l.orders ? `, ${l.orders} order${l.orders === 1 ? '' : 's'}` : ''}`).join('; ');
    return `Globe of visitor locations: ${total} session${total === 1 ? '' : 's'} from ${locations.length} countr${locations.length === 1 ? 'y' : 'ies'}${home ? `, with arcs to your store in ${home.name}` : ''}. ${top}.`;
  }, [locations, home, total]);

  const maxS = Math.max(1, ...locations.map(l => l.sessions));
  const focusRow = l => { if (globe.current) globe.current.focus(l ? l.country : null); if (!l) setTip(null); };

  return <section className="caCard caGlobeCard" aria-label="Visitors around the world">
    <header className="caGlobeHead">
      <div><h2>Visitors around the world</h2><p>{rangeLabel ? rangeLabel + ' · ' : ''}Approximate locations from each visitor’s time zone and shipping country</p></div>
      <div className="caGlobeStats">
        <span><strong>{total}</strong> located session{total === 1 ? '' : 's'}</span>
        <span><strong>{locations.length}</strong> countr{locations.length === 1 ? 'y' : 'ies'}</span>
        <span><strong>{orders}</strong> order{orders === 1 ? '' : 's'}</span>
      </div>
    </header>
    <div className="caGlobeBody">
      <div className="caGlobeStage" ref={wrap}>
        <canvas ref={canvas} className="caGlobeCanvas" role="img" aria-label={summary} />
        {!locations.length && <div className="caGlobeEmpty"><strong>No visitor locations yet</strong><span>Open <b>View store</b> and browse your shop — each visit appears here as a marker.</span></div>}
        {tip && <div className={'caGlobeTip' + (tip.fromFocus ? ' centered' : '')} role="status" style={tip.fromFocus ? undefined : { left: tip.x, top: tip.y }}>
          <strong><span aria-hidden="true">{flagEmoji(tip.loc.country)} </span>{tip.loc.city ? `${tip.loc.city}, ${tip.loc.name}` : tip.loc.name}</strong>
          <span>{tip.loc.sessions} session{tip.loc.sessions === 1 ? '' : 's'} · {tip.loc.orders} order{tip.loc.orders === 1 ? '' : 's'} · {fmt(tip.loc.sales)}</span>
        </div>}
        <span className="caGlobeHint" aria-hidden="true">Drag to rotate</span>
      </div>
      <div className="caGlobeSide">
        <h3 id="caTopLoc">Top locations</h3>
        {locations.length ? <ol className="caGlobeList" aria-labelledby="caTopLoc">
          {locations.slice(0, 8).map((l, i) => <li key={l.country}>
            <button type="button" onFocus={() => focusRow(l)} onBlur={() => focusRow(null)} onMouseEnter={() => focusRow(l)} onMouseLeave={() => focusRow(null)}
              aria-label={`${i + 1}. ${l.name}: ${l.sessions} session${l.sessions === 1 ? '' : 's'}, ${l.orders} order${l.orders === 1 ? '' : 's'}, ${fmt(l.sales)} sales, ${total ? Math.round(l.sessions / total * 100) : 0}% of located sessions`}>
              <span className="caGlobeFlag" aria-hidden="true">{flagEmoji(l.country)}</span>
              <span className="caGlobeName">{l.name}{l.city ? <small>{l.city}</small> : null}</span>
              <span className="caGlobeNum">{l.sessions}<small>{total ? Math.round(l.sessions / total * 100) : 0}%</small></span>
              <span className="caGlobeShare" aria-hidden="true"><i style={{ width: `${Math.max(3, l.sessions / maxS * 100)}%` }} /></span>
            </button>
          </li>)}
        </ol> : <p className="caGlobeNone">Locations appear after the first visits in <b>View store</b> or orders with a shipping country.</p>}
        {unlocated > 0 && <p className="caGlobeNote">{unlocated} session{unlocated === 1 ? '' : 's'} without a known location (recorded before locations were captured).</p>}
        {home && <p className="caGlobeNote"><span className="caGlobeHome" aria-hidden="true" />Arcs point to your store in {home.name}{home.fromVisitors ? ' (busiest location — add a country to Settings › General address)' : ''}.</p>}
      </div>
    </div>
  </section>;
}
